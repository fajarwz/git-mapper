use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::*;

/// A throw-away repository on disk, real `git` CLI driving every command below it.
pub(super) struct TempRepo(pub(super) PathBuf);

pub(super) fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git ran");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Identity and line-ending settings every fixture needs. A fresh clone carries
/// its own config, so this runs again right after `git clone`.
fn set_identity(dir: &Path) {
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

impl TempRepo {
    pub(super) fn new(label: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("git-mapper-test-{}-{label}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp repo created");
        // Pin the branch name: `git init` still defaults to master on some machines
        // (the GitHub ubuntu runner does) and every expectation below names main.
        git(&dir, &["init", "-q", "-b", "main"]);
        set_identity(&dir);
        TempRepo(dir)
    }

    pub(super) fn path(&self) -> &str {
        self.0.to_string_lossy().replace('\\', "/").leak()
    }

    pub(super) fn commit(&self, file: &str, body: &str, message: &str) {
        std::fs::write(self.0.join(file), body).expect("file written");
        git(&self.0, &["add", file]);
        git(&self.0, &["commit", "-q", "-m", message]);
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn records_of(raw: &str) -> Vec<Vec<String>> {
    raw.split('\u{1e}')
        .filter(|r| !r.trim().is_empty())
        .map(|r| r.trim_matches('\n').split('\0').map(String::from).collect())
        .collect()
}

pub(super) fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git ran");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn status_scanner_yields_unmerged_paths() {
    // A merge with an edit conflict leaves porcelain v2 `u` records in the status output;
    // the scanner must hand them to the visitor — the staging rail resolves them, so the
    // old "outside the viewer's scope" skip hid the whole merge state.
    let repo = TempRepo::new("conflict-scan");
    repo.commit("a.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("a.txt", "side\n", "side edit");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("a.txt", "main\n", "main edit");

    let merged = Command::new("git")
        .args(["merge", "side", "--no-edit"])
        .current_dir(&repo.0)
        .output()
        .expect("merge ran");
    assert!(!merged.status.success(), "the merge must conflict");

    let raw = run_git(
        repo.path(),
        &["status", "--porcelain=v2", "--untracked-files=all", "-z"],
    )
    .expect("status read");
    assert!(raw.starts_with("u "), "the fixture must hold a u record");

    let mut unmerged: Vec<(char, char, String)> = Vec::new();
    for_each_status_v2(&raw, |x, y, path, _orig| {
        if x == 'U' || y == 'U' {
            unmerged.push((x, y, path));
        }
    });
    assert_eq!(
        unmerged,
        vec![('U', 'U', "a.txt".to_string())],
        "the conflicted path arrives with its both-modified pair"
    );

    // A sane base case in the same test: the visitor on a finished merge (abort) yields
    // nothing unmerged again.
    git(&repo.0, &["merge", "--abort"]);
    let raw = run_git(
        repo.path(),
        &["status", "--porcelain=v2", "--untracked-files=all", "-z"],
    )
    .expect("status read");
    let mut again: Vec<String> = Vec::new();
    for_each_status_v2(&raw, |x, y, path, _orig| {
        if x == 'U' || y == 'U' {
            again.push(path);
        }
    });
    assert!(again.is_empty(), "an aborted merge carries no unmerged paths");
}

#[test]
fn read_status_reports_a_merge_and_its_conflicts() {
    let repo = conflicting_repo("status-conflict");
    let info = read_status_in(repo.path()).expect("status read");
    assert!(info.merging, "MERGE_HEAD sits unresolved");
    assert_eq!(info.conflicts, vec!["a.txt".to_string()]);
    assert!(info.dirty);

    // After the abort both pieces drop together.
    git(&repo.0, &["merge", "--abort"]);
    let info = read_status_in(repo.path()).expect("status read");
    assert!(!info.merging);
    assert!(info.conflicts.is_empty());
    assert!(!info.dirty);
}

#[test]
fn fetch_remote_tracks_the_upstream_and_skips_remoless_repos() {
    // The remote repository's history grows after the origin link is made; the fetch must
    // pull that growth into the local tracking refs.
    let remote = TempRepo::new("fetch-remote");
    remote.commit("a.txt", "a\n", "first");
    let repo = TempRepo::new("fetch");
    repo.commit("b.txt", "b\n", "second");
    git(&repo.0, &["remote", "add", "origin", remote.path()]);

    // A repository with a remote but no new objects still fetches fine; the tracking ref
    // now exists and points at the remote's head.
    fetch_remote_in(repo.path()).expect("the fetch ran");
    let tracked = git_out(&repo.0, &["rev-parse", "origin/main"]);
    assert_eq!(tracked, git_out(&remote.0, &["rev-parse", "HEAD"]));

    // New work on the remote moves origin/main only after a fetch.
    let before = git_out(&repo.0, &["rev-parse", "origin/main"]);
    remote.commit("c.txt", "c\n", "third");
    fetch_remote_in(repo.path()).expect("the second fetch ran");
    assert_ne!(
        git_out(&repo.0, &["rev-parse", "origin/main"]),
        before,
        "the fetch caught up with the remote"
    );

    // A repository without remotes is not an error — there is simply nothing to read.
    let lone = TempRepo::new("fetch-lone");
    lone.commit("l.txt", "l\n", "lonely");
    fetch_remote_in(lone.path()).expect("a remoless repo fetches as a no-op");
}

#[test]
fn stash_actions_apply_pop_and_drop_the_entry() {
    let repo = TempRepo::new("stash-actions");
    repo.commit("a.txt", "a\n", "first");

    // A stashed working-tree edit: the index clean, the edit parked in the entry.
    std::fs::write(repo.0.join("a.txt"), "b\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);

    // Apply restores the change and KEEPS the entry — the stash list still shows one.
    stash_action_in(repo.path(), 0, "apply").expect("the apply ran");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "b\n"
    );
    assert_eq!(git_out(&repo.0, &["stash", "list"]).lines().count(), 1);

    // Pop restores and drops: the list is empty after it.
    std::fs::write(repo.0.join("a.txt"), "a\n").expect("reset");
    stash_action_in(repo.path(), 0, "pop").expect("the pop ran");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "b\n"
    );
    assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());

    // Drop removes the entry without touching anything else — and because saving a
    // stash resets the worktree to HEAD first, the file is back at the committed text.
    std::fs::write(repo.0.join("a.txt"), "c\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);
    stash_action_in(repo.path(), 0, "drop").expect("the drop ran");
    assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );

    // Actions outside the stack are refused, as is an unknown op.
    let err = stash_action_in(repo.path(), 0, "clear").unwrap_err();
    assert!(err.contains("is not a stash action"), "got: {err}");
    let err = stash_action_in(repo.path(), 5, "apply").unwrap_err();
    assert!(!err.is_empty(), "an absent entry errors, not panics");
}

#[test]
fn undo_commit_returns_the_tip_to_the_index() {
    let repo = TempRepo::new("undo-commit");
    repo.commit("a.txt", "a\n", "first");
    repo.commit("b.txt", "b\n", "second");
    let tip = git_out(&repo.0, &["rev-parse", "HEAD"]);

    undo_commit_in(repo.path()).expect("the undo ran");

    // HEAD stepped back and the tip left HEAD's history entirely…
    assert_ne!(
        git_out(&repo.0, &["rev-parse", "HEAD"]),
        tip,
        "HEAD moved back"
    );
    assert!(
        !git_out(&repo.0, &["rev-list", "HEAD"]).contains(&tip),
        "the tip is no longer in HEAD's history"
    );
    // …but nothing was lost: the tip's file is back STAGED (index has it, HEAD does not,
    // the worktree still matches the index).
    assert_eq!(
        git_out(&repo.0, &["diff", "--cached", "--name-only"]),
        "b.txt",
        "the tip's file came back staged"
    );
    assert!(
        git_out(&repo.0, &["diff", "--name-only"]).trim().is_empty(),
        "the worktree matches the index — no unstaged fallout"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("b.txt")).expect("file"),
        "b\n"
    );
}

/// A repository with a two-side edit conflict on `a.txt`, merge in progress.
fn conflicting_repo(label: &str) -> TempRepo {
    let repo = TempRepo::new(label);
    repo.commit("a.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("a.txt", "side\n", "side edit");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("a.txt", "main\n", "main edit");
    let merged = Command::new("git")
        .args(["merge", "side", "--no-edit"])
        .current_dir(&repo.0)
        .output()
        .expect("merge ran");
    assert!(!merged.status.success(), "the merge must conflict");
    repo
}

#[test]
fn discard_refuses_unmerged_paths() {
    let repo = conflicting_repo("discard-conflict");
    let err = discard_files_in(repo.path(), &["a.txt".to_string()]).unwrap_err();
    assert!(err.contains("unmerged"), "got: {err}");
    // Nothing was acted on: the file still reads as conflicted afterwards.
    assert!(gs_v2(repo.path()).contains("u "));
}

/// Fresh porcelain v2 status text (NUL-separated), straight from git.
fn gs_v2(dir: &str) -> String {
    run_git(dir, &["status", "--porcelain=v2", "--untracked-files=all", "-z"])
        .unwrap_or_default()
}

#[test]
fn undo_commit_refuses_root_and_merge_tips() {
    // The root commit has nothing to undo ONTO; a soft reset there is undefined.
    let root = TempRepo::new("undo-root");
    root.commit("a.txt", "a\n", "only");
    let err = undo_commit_in(root.path()).unwrap_err();
    assert!(err.contains("root"), "got: {err}");

    // A merge tip has two parents: `HEAD~1` (first parent) would strand the merged
    // branch behind, so the command refuses rather than half-explaining the undo.
    let repo = TempRepo::new("undo-merge");
    repo.commit("a.txt", "a\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    std::fs::write(repo.0.join("side.txt"), "s\n").expect("side file");
    git(&repo.0, &["add", "side.txt"]);
    git(&repo.0, &["commit", "-q", "-m", "side work"]);
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("b.txt", "b\n", "main work");
    git(&repo.0, &["merge", "-q", "--no-ff", "side", "-m", "merge"]);
    let err = undo_commit_in(repo.path()).unwrap_err();
    assert!(err.contains("merge"), "got: {err}");
}

#[test]
fn checkout_commit_detaches_onto_a_commit() {
    let repo = TempRepo::new("detach");
    repo.commit("a.txt", "a\n", "first");
    let first = git_out(&repo.0, &["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "second");
    let second = git_out(&repo.0, &["rev-parse", "HEAD"]);

    checkout_commit_in(repo.path(), &first[..7]).expect("the short hash detaches");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "HEAD"]),
        first,
        "HEAD sits on the commit"
    );
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD",
        "no branch is checked out"
    );
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "refs/heads/main"]),
        second,
        "the branch did not move with the checkout"
    );
}

#[test]
fn checkout_commit_rejects_everything_but_a_hash() {
    let repo = TempRepo::new("detach-guard");
    repo.commit("a.txt", "a\n", "first");

    // A branch name is refused before git sees it — --detach is hash-only.
    let err = checkout_commit_in(repo.path(), "main").unwrap_err();
    assert!(err.contains("is not a commit hash"), "got: {err}");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main",
        "HEAD did not move"
    );
}

#[test]
fn open_repository_names_the_toplevel() {
    let repo = TempRepo::new("open");
    let info = open_repository_in(repo.path()).expect("the repo opens");
    assert_eq!(info.path, repo.path());
    assert_eq!(
        info.name,
        PathBuf::from(repo.path())
            .file_name()
            .unwrap()
            .to_string_lossy()
    );
}

#[test]
fn open_repository_rejects_a_worktreeless_directory() {
    // A bare repo has no work tree, which is exactly the check open_repository guards.
    let dir = std::env::temp_dir().join(format!("git-mapper-test-{}-bare", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir created");
    let bare = Command::new("git")
        .arg("init")
        .arg("--bare")
        .arg("-q")
        .current_dir(&dir)
        .output()
        .expect("git ran");
    assert!(bare.status.success());
    let target = dir.to_string_lossy().replace('\\', "/");
    let err = open_repository_in(&target).unwrap_err();
    assert!(err.contains("is not a Git repository"), "got: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn read_status_counts_modified_plus_untracked_and_sees_ahead() {
    let repo = TempRepo::new("status");
    repo.commit("tracked.txt", "one\n", "c1");
    repo.0.join("untracked.txt");

    let clean = read_status_in(repo.path()).expect("status read");
    assert_eq!(
        (clean.dirty, clean.changed),
        (false, 0),
        "a committed tree is clean"
    );
    assert!(!clean.head.is_empty(), "HEAD is present");
    assert_eq!((clean.ahead, clean.behind), (0, 0));

    // One modified tracked path + one untracked path, each counted individually.
    std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\n").expect("edit");
    std::fs::write(repo.0.join("untracked.txt"), "new\n").expect("untracked");
    let dirty = read_status_in(repo.path()).expect("status read");
    assert_eq!((dirty.dirty, dirty.changed), (true, 2));

    // A commit after a push lands the branch ahead by exactly one.
    git(&repo.0, &["stash", "-q"]);
    git(&repo.0, &["remote", "add", "origin", repo.path()]);
    git(&repo.0, &["fetch", "-q", "origin", "main"]);
    git(
        &repo.0,
        &["branch", "--set-upstream-to=origin/main", "main"],
    );
    repo.commit("tracked.txt", "pushed\n", "c2");
    let ahead = read_status_in(repo.path()).expect("status read");
    assert_eq!(ahead.ahead, 1);
    assert_eq!(
        (dirty.behind, dirty.ahead),
        (0, 0),
        "the pre-push read stays at zero"
    );
}

#[test]
fn read_status_survives_an_unborn_branch() {
    let repo = TempRepo::new("unborn");
    let info = read_status_in(repo.path()).expect("a repo without commits still reads");
    // git status prints "## No commits yet on main"; the loader shows the branch hint as-is.
    assert_eq!(info.branch, "No commits yet on main");
    assert_eq!(info.head, "");
    assert_eq!(info.dirty, false);
}

#[test]
fn the_worktree_digest_notices_an_edit_the_count_misses() {
    let repo = TempRepo::new("digest");
    repo.commit("tracked.txt", "one\n", "c1");

    let first = read_status_in(repo.path()).expect("first read");
    let again = read_status_in(repo.path()).expect("second read");
    assert_eq!(
        first.worktree, again.worktree,
        "an untouched tree stamps identically"
    );

    // Same path count (one modified file), different content: only the patch moves the stamp.
    std::fs::write(repo.0.join("tracked.txt"), "one\n").expect("touch");
    let pre_edit = read_status_in(repo.path()).expect("read with one change");
    std::fs::write(repo.0.join("tracked.txt"), "two\n").expect("edit");
    let post_edit = read_status_in(repo.path()).expect("read with same count");
    assert_ne!(
        pre_edit.worktree, post_edit.worktree,
        "an edit inside one file moves the stamp"
    );
}

#[test]
fn read_log_records_keep_field_and_record_separators() {
    let repo = TempRepo::new("log");
    repo.commit("one.txt", "one\n", "first: one");
    repo.commit("two.txt", "two\n", "second: two");

    let raw = read_log_in(repo.path(), 10, 0).expect("log read");
    let records = records_of(&raw);
    assert_eq!(records.len(), 2, "one record per commit, newest first");
    let head = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    assert_eq!(
        records[0][1].trim_start_matches('\n'),
        head.trim(),
        "the hash field is the commit sha"
    );
    assert!(
        records[0][6].contains("second: two"),
        "%B lands in the last field"
    );
}

#[test]
fn read_log_order_matches_read_log_shape_and_delta_excludes_the_since_base() {
    let repo = TempRepo::new("delta");
    repo.commit("one.txt", "one\n", "first");
    let old_head = read_log_order_in(repo.path(), 10).expect("ordering read");
    repo.commit("two.txt", "two\n", "second");

    let order = read_log_order_in(repo.path(), 10).expect("ordering read");
    let lines: Vec<&str> = order.lines().collect();
    assert_eq!(lines.len(), 2, "one line per commit, nothing else");
    let raw = read_log_in(repo.path(), 10, 0).expect("log read");
    let hashes: Vec<String> = records_of(&raw)
        .iter()
        .map(|r| r[1].trim_start_matches('\n').to_string())
        .collect();
    assert_eq!(
        hashes, lines,
        "read_log and read_log_order describe the same window"
    );

    let delta = read_log_delta_in(repo.path(), old_head.trim(), 500).expect("delta read");
    let delta_hashes: Vec<String> = records_of(&delta)
        .iter()
        .map(|r| r[1].trim_start_matches('\n').to_string())
        .collect();
    assert_eq!(
        delta_hashes,
        vec![lines[0]],
        "only the commit newer than `since` comes back"
    );
}

#[test]
fn read_log_excludes_the_stash_stack() {
    let repo = TempRepo::new("stash");
    repo.commit("one.txt", "one\n", "first");
    std::fs::write(repo.0.join("one.txt"), "two\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);
    let stash_hash = run_git(repo.path(), &["rev-parse", "refs/stash"]).expect("stash ref");
    repo.commit("two.txt", "two\n", "second");

    for raw in [
        read_log_in(repo.path(), 10, 0).expect("log read"),
        read_log_order_in(repo.path(), 10).expect("order read"),
    ] {
        assert!(
            !raw.contains(&stash_hash),
            "the stash commit must stay out of history: {raw}"
        );
    }

    let stashes = read_stashes_in(repo.path()).expect("stash read");
    let records = records_of(&stashes);
    assert_eq!(
        records.len(),
        1,
        "the reflog is the only view over every entry"
    );
    assert!(
        records[0][0]
            .trim_start_matches('\n')
            .starts_with("stash@{")
    );
    assert_eq!(records[0][1], stash_hash.trim());
}

#[test]
fn wip_files_list_untracked_paths_and_the_binary_hunk() {
    let repo = TempRepo::new("wip");
    repo.commit("tracked.txt", "one\n", "first");

    std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\n").expect("edit");
    std::fs::write(repo.0.join("new.txt"), "l1\nl2\n").expect("untracked text");
    std::fs::write(repo.0.join("blob.bin"), [0u8, 1, 255, 9, 0]).expect("untracked binary");

    let payload = read_commit_files_in(repo.path(), "wip", true).expect("wip payload");
    assert!(payload.name_status.contains("M\ttracked.txt"));
    assert!(payload.numstat.contains("2\t0\tnew.txt"));
    assert!(
        payload.name_status.contains("A\tnew.txt"),
        "`git diff` alone never lists untracked paths"
    );
    assert!(payload.diff.contains("+++ b/new.txt"));
    assert!(payload.numstat.contains("-\t-\tblob.bin"));
    assert!(
        payload.diff.contains("@@ Binary file, not shown @@"),
        "the panel needs a reason for an empty patch"
    );
}

#[test]
fn file_patch_reads_one_path_and_strips_from_the_list_read() {
    let repo = TempRepo::new("lazy");
    repo.commit("one.txt", "one\n", "first");
    std::fs::write(repo.0.join("two.txt"), "t\n").expect("file");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    let second = second.trim().to_string();

    let stripped = read_commit_files_in(repo.path(), &second, false).expect("stripped");
    assert_eq!(stripped.diff, "", "no patch body rides on the list read");
    assert!(stripped.numstat.contains("1\t0\ttwo.txt"));
    assert!(stripped.name_status.contains("A\ttwo.txt"));

    let history = read_file_patch_in(repo.path(), &second, "two.txt").expect("history patch");
    assert!(history.contains("+++ b/two.txt"), "got: {history}");
    assert!(
        !history.contains("one.txt"),
        "a single-path read stays single-path: {history}"
    );
    assert_eq!(
        history,
        read_commit_files_in(repo.path(), &second, true)
            .expect("full")
            .diff
            .split("diff --git")
            .find(|part| part.contains("+++ b/two.txt"))
            .map(|part| format!("diff --git{part}"))
            .expect("the full payload shows two.txt"),
        "the lazy patch is the same lines the full read carried"
    );

    std::fs::write(repo.0.join("new.txt"), "l1\n").expect("untracked written");
    let wip_untracked = read_file_patch_in(repo.path(), "wip", "new.txt").expect("untracked patch");
    assert!(
        wip_untracked.contains("+++ b/new.txt"),
        "got: {wip_untracked}"
    );
    std::fs::write(repo.0.join("one.txt"), "one\ntwo\n").expect("tracked edited");
    let wip_tracked = read_file_patch_in(repo.path(), "wip", "one.txt").expect("tracked patch");
    assert!(wip_tracked.contains("@@"), "got: {wip_tracked}");
}

#[test]
fn commit_files_diff_against_the_first_parent_and_handle_roots_and_renames() {
    let repo = TempRepo::new("files");
    repo.commit("root.txt", "root\n", "root commit");
    let root_hash = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    let root_hash = root_hash.trim().to_string();

    std::fs::write(repo.0.join("other.txt"), "o\n").expect("file");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let second_hash = second_hash.trim().to_string();

    // Root commits diff against the empty tree; the `^1` of a root resolves to nothing.
    let root_files = read_commit_files_in(repo.path(), &root_hash, true).expect("root files");
    assert!(
        root_files.numstat.contains("1\t0\troot.txt"),
        "got: {}",
        root_files.numstat
    );

    let files = read_commit_files_in(repo.path(), &second_hash, true).expect("parent diff");
    assert!(files.name_status.contains("A\tother.txt"));

    // git mv keeps the rename visible.
    git(&repo.0, &["mv", "root.txt", "renamed.txt"]);
    git(&repo.0, &["commit", "-q", "-m", "renamed"]);
    let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let renamed_hash = renamed_hash.trim().to_string();
    let renamed = read_commit_files_in(repo.path(), &renamed_hash, true).expect("renamed files");
    assert!(
        renamed.name_status.contains("R100\troot.txt\trenamed.txt"),
        "got: {}",
        renamed.name_status
    );
}

#[test]
fn image_versions_carry_both_sides_and_fall_back_for_roots_renames_and_wip() {
    let repo = TempRepo::new("images");
    let old_bytes = vec![137u8, 80, 78, 71, 13, 10, 1, 1];
    std::fs::write(repo.0.join("a.png"), &old_bytes).expect("old image written");
    git(&repo.0, &["add", "a.png"]);
    git(&repo.0, &["commit", "-q", "-m", "add image"]);
    let root_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let root_hash = root_hash.trim().to_string();

    // Root commit: the file was born here, so there is no previous copy.
    let root = read_image_versions_in(repo.path(), &root_hash, "a.png").expect("root versions");
    assert!(root.old.is_none(), "a root commit has no old side");
    let new = root.new.expect("new side");
    assert_eq!(new.bytes, old_bytes.len());
    assert!(
        new.url.starts_with("data:image/png;base64,"),
        "got: {}",
        new.url
    );
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(new.url.split_once(',').expect("comma").1)
            .expect("round trip"),
        old_bytes,
        "the data URL carries the exact blob content"
    );

    let new_bytes = vec![255u8, 216, 255, 224, 9, 0];
    std::fs::write(repo.0.join("a.jpg"), &new_bytes).expect("new image written");
    std::fs::remove_file(repo.0.join("a.png")).expect("removed");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let second_hash = second_hash.trim().to_string();

    // Deleted in this commit: only the parent's copy comes back.
    let deleted = read_image_versions_in(repo.path(), &second_hash, "a.png").expect("deleted");
    assert!(deleted.new.is_none(), "the commit deleted the image");
    let old = deleted.old.expect("the parent held the image");
    assert_eq!(old.bytes, old_bytes.len());
    assert_eq!(image_mime("a.png"), "image/png");
    assert_eq!(
        image_mime("photo.JPEG"),
        "image/jpeg",
        "the lookup is case-insensitive"
    );

    // Renamed in this commit: the old blob is found under the source path.
    std::fs::write(repo.0.join("a.jpg").with_extension("jpeg"), &new_bytes).expect("file");
    git(&repo.0, &["mv", "a.jpg", "renamed.jpeg"]);
    git(&repo.0, &["commit", "-q", "-m", "renamed"]);
    let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let renamed_hash = renamed_hash.trim().to_string();
    let renamed =
        read_image_versions_in(repo.path(), &renamed_hash, "renamed.jpeg").expect("renamed");
    assert_eq!(
        renamed.old.expect("rename keeps the old blob").bytes,
        new_bytes.len()
    );
    assert_eq!(
        renamed
            .new
            .expect("renamed keeps the blob")
            .url
            .starts_with("data:image/jpeg;base64,"),
        true
    );

    // wip: old side = HEAD's blob, new side = the file on disk.
    let disk_bytes = vec![1u8, 2, 3, 4, 5];
    std::fs::write(repo.0.join("renamed.jpeg"), &disk_bytes).expect("edited on disk");
    let wip = read_image_versions_in(repo.path(), "wip", "renamed.jpeg").expect("wip versions");
    assert_eq!(
        wip.old.expect("HEAD blob").bytes,
        new_bytes.len(),
        "the old side is HEAD's copy"
    );
    assert_eq!(
        wip.new.expect("disk copy").bytes,
        disk_bytes.len(),
        "the new side is the working file"
    );
}

/// A two-parent merge is NOT a stash: no third parent is probed or appended, and the
/// first-parent diff shows the incoming branch's changes, not the merge base's.
#[test]
fn merge_commit_files_stay_first_parent_only() {
    let repo = TempRepo::new("merge");
    repo.commit("base.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("side.txt", "side\n", "side commit");
    git(&repo.0, &["checkout", "-q", "-"]);
    repo.commit("main.txt", "main\n", "main commit");
    git(&repo.0, &["merge", "-q", "--no-ff", "side"]);
    let merge_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    // Sanity: the merge really has two parents.
    assert_eq!(
        run_git(repo.path(), &["rev-list", "--parents", "-1", "HEAD"])
            .expect("parents")
            .split_whitespace()
            .count(),
        3
    );

    let files = read_commit_files_in(repo.path(), merge_hash.trim(), true).expect("merge files");
    assert!(
        files.name_status.contains("A\tside.txt"),
        "the first-parent diff carries the merged branch's change: {}",
        files.name_status
    );
    assert!(
        !files.name_status.contains("main.txt"),
        "main.txt was already in the first parent: {}",
        files.name_status
    );
}

/// A bare repository to push/pull against: a local-path remote, no network.
fn bare_repo(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-mapper-test-{}-{label}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("bare repo created");
    Command::new("git")
        .args(["init", "--bare", "-q", "-b", "main"])
        .current_dir(&dir)
        .output()
        .expect("git ran");
    dir
}

#[test]
fn push_publishes_the_branch_and_sets_the_upstream() {
    let origin = bare_repo("push-origin");
    let repo = TempRepo::new("push-work");
    repo.commit("base.txt", "base\n", "base");
    git(
        &repo.0,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("origin path"),
        ],
    );

    tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
        .expect("the first push publishes and sets the upstream");
    repo.commit("more.txt", "more\n", "second");
    tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
        .expect("a later push is a plain update");

    let pushed = run_git(
        origin.to_str().expect("origin path"),
        &["rev-parse", "HEAD"],
    )
    .expect("origin read");
    let local = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("local read");
    assert_eq!(
        pushed.trim(),
        local.trim(),
        "origin carries the pushed commit"
    );
    let upstream =
        run_git(repo.path(), &["rev-parse", "--abbrev-ref", "@{u}"]).expect("upstream read");
    assert!(
        upstream.trim().starts_with("origin/"),
        "`-u` set the upstream"
    );
    let _ = std::fs::remove_dir_all(&origin);
}

#[test]
fn pull_fast_forwards_and_refuses_a_diverged_branch() {
    let origin = bare_repo("pull-origin");
    let work = TempRepo::new("pull-work");
    work.commit("base.txt", "base\n", "base");
    git(
        &work.0,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("origin path"),
        ],
    );
    tauri::async_runtime::block_on(push_branch(work.path().to_string())).expect("the seed push");

    // A second clone plays the other machine: it commits and pushes.
    let other = work.0.parent().unwrap().join("pull-other");
    git(
        &work.0.parent().unwrap().to_path_buf(),
        &[
            "clone",
            "-q",
            origin.to_str().unwrap(),
            other.to_str().unwrap(),
        ],
    );
    set_identity(&other);
    std::fs::write(other.join("theirs.txt"), "theirs\n").expect("file written");
    git(&other, &["add", "theirs.txt"]);
    git(&other, &["commit", "-q", "-m", "theirs"]);

    tauri::async_runtime::block_on(pull_branch(work.path().to_string()))
        .expect("the fast-forward pull");
    let head = run_git(work.path(), &["rev-parse", "HEAD"]).expect("head read");
    let upstream = run_git(work.path(), &["rev-parse", "@{u}"]).expect("upstream read");
    assert_eq!(
        head.trim(),
        upstream.trim(),
        "the pull caught the other machine's commit"
    );

    // Diverged: both sides commit; ff-only refuses instead of merging in a viewer.
    work.commit("ours.txt", "ours\n", "ours");
    std::fs::write(other.join("theirs2.txt"), "t\n").expect("file written");
    git(&other, &["add", "theirs2.txt"]);
    git(&other, &["commit", "-q", "-m", "theirs 2"]);
    git(&other, &["push", "-q"]);
    assert!(
        tauri::async_runtime::block_on(pull_branch(work.path().to_string())).is_err(),
        "a diverged pull must be refused, not merged"
    );

    let _ = std::fs::remove_dir_all(&other);
    let _ = std::fs::remove_dir_all(&origin);
}

#[test]
fn worktree_snapshot_splits_index_and_worktree_states_with_counts() {
    let repo = TempRepo::new("snapshot");
    repo.commit("tracked.txt", "one\n", "c1");

    // Clean tree: nothing to show.
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .is_empty()
    );

    // Worktree-only modification: one unstaged row, counts from the index diff.
    std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\nthree\n").expect("edit");
    std::fs::write(repo.0.join("fresh.txt"), "a\nb\n").expect("untracked file");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    let tracked = snap
        .entries
        .iter()
        .find(|e| e.path == "tracked.txt")
        .expect("tracked row");
    assert_eq!(
        (tracked.staged, tracked.status == "modified"),
        (false, true)
    );
    assert_eq!((tracked.additions, tracked.deletions), (2, 0));
    let fresh = snap
        .entries
        .iter()
        .find(|e| e.path == "fresh.txt")
        .expect("fresh row");
    assert_eq!((fresh.staged, fresh.untracked), (false, true));
    assert_eq!((fresh.status == "added", fresh.additions), (true, 2));

    // Stage it: the same path becomes an index copy; `git add` of fresh.txt brings it in too.
    stage_files_in(repo.path(), &["tracked.txt".into(), "fresh.txt".into()]).expect("add");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    let staged: Vec<_> = snap.entries.iter().filter(|e| e.staged).collect();
    assert_eq!(staged.len(), 2, "both paths moved into the index");
    assert_eq!(
        staged[0].additions, 2,
        "counts are the staged-vs-HEAD numstat"
    );

    // A staged file edited again on disk appears twice: index copy and the worktree remainder.
    std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\nthree\nfour\n").expect("edit again");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    let rows: Vec<_> = snap
        .entries
        .iter()
        .filter(|e| e.path == "tracked.txt")
        .collect();
    assert_eq!(
        rows.len(),
        2,
        "both copies of a partially staged file are listed"
    );
    assert!(rows.iter().any(|e| e.staged) && rows.iter().any(|e| !e.staged));
    assert_eq!(
        rows.iter().map(|e| e.key.clone()).collect::<Vec<_>>().len(),
        2,
        "keys stay unique"
    );
}

#[test]
fn staging_writes_commit_unstage_and_walk_renames_back() {
    let repo = TempRepo::new("staging-writes");
    repo.commit("a.txt", "a\n", "c1");

    // Stage a modification and commit it: HEAD moves, worktree is clean.
    std::fs::write(repo.0.join("a.txt"), "b\n").expect("edit");
    stage_files_in(repo.path(), &["a.txt".into()]).expect("add");
    commit_staged_in(repo.path(), "made from the rail").expect("commit");
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .is_empty()
    );
    let log = git_out(&repo.0, &["log", "--format=%s", "-1"]);
    assert_eq!(log.trim(), "made from the rail");

    // Unstage an index-only add: the file stays on disk as untracked.
    std::fs::write(repo.0.join("b.txt"), "staged but uncommitted\n").expect("new file");
    stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .iter()
            .any(|e| e.staged)
    );
    unstage_files_in(repo.path(), &["b.txt".into()]).expect("unstage");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "b.txt" && e.untracked)
    );
    assert!(!snap.entries.iter().any(|e| e.staged));

    // A staged rename unstage walks the file back to its original name. The rename
    // source must live in HEAD for git to report it as `2 R`; stage + commit first.
    stage_files_in(repo.path(), &["b.txt".into()]).expect("re-add");
    commit_staged_in(repo.path(), "add b.txt").expect("commit b");
    git(&repo.0, &["mv", "b.txt", "moved.txt"]);
    unstage_files_in(repo.path(), &["moved.txt".into()]).expect("rename unstage");
    assert!(
        repo.0.join("b.txt").exists(),
        "the file is back at its original name"
    );
    assert!(
        !repo.0.join("moved.txt").exists(),
        "the rename destination is gone"
    );
    let snap = read_worktree_files_in(repo.path()).expect("read");
    assert!(
        snap.entries.is_empty(),
        "the unstage leaves a clean state: {:?}",
        snap.entries
    );
}

#[test]
fn discard_classifies_untracked_index_adds_and_tracked_paths() {
    let repo = TempRepo::new("discard");
    repo.commit("a.txt", "a\n", "c1");
    std::fs::create_dir_all(repo.0.join("sub/nested")).expect("dir");
    repo.commit("sub/nested/deep.txt", "deep\n", "c2");

    // A tracked modification goes back to HEAD's text; an untracked file is deleted.
    std::fs::write(repo.0.join("a.txt"), "changed\n").expect("edit");
    std::fs::write(repo.0.join("sub/nested/deep.txt"), "deep edit\n").expect("nested edit");
    std::fs::write(repo.0.join("tossed.txt"), "doomed\n").expect("untracked file");
    discard_files_in(
        repo.path(),
        &[
            "a.txt".into(),
            "sub/nested/deep.txt".into(),
            "tossed.txt".into(),
        ],
    )
    .expect("discard");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("sub/nested/deep.txt")).expect("file"),
        "deep\n",
        "nested paths restore too — HEAD's tree is read recursively, not top-level only"
    );
    assert!(
        !repo.0.join("tossed.txt").exists(),
        "untracked files are removed from disk"
    );

    // An index-only add is unstaged, NOT deleted: the content survives as untracked.
    std::fs::write(repo.0.join("b.txt"), "precious\n").expect("new file");
    stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
    discard_files_in(repo.path(), &["b.txt".into()]).expect("discard");
    let listing: Vec<_> = std::fs::read_dir(&repo.0)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        repo.0.join("b.txt").exists(),
        "the staged-only add is not wiped from disk"
    );

    // Discard-all: every tracked change resets and untracked paths (with dirs) disappear.
    std::fs::write(repo.0.join("a.txt"), "dirty\n").expect("edit");
    std::fs::create_dir(repo.0.join("untracked-dir")).expect("dir");
    std::fs::write(repo.0.join("untracked-dir/x.txt"), "x\n").expect("nested");
    discard_all_in(repo.path()).expect("discard all");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );
    assert!(
        !repo.0.join("untracked-dir").exists(),
        "clean -fd removes untracked dirs"
    );
    assert!(
        !repo.0.join("b.txt").exists(),
        "b.txt stayed untracked after its unstage, so it goes"
    );
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .is_empty()
    );
}

#[test]
fn a_partial_commit_of_staged_files_keeps_the_worktree_copy() {
    // A README-style workflow: stage half of a dirty pair, commit, the other half stays.
    let repo = TempRepo::new("partial");
    repo.commit("one.txt", "one\n", "c1");
    repo.commit("two.txt", "two\n", "c2");

    std::fs::write(repo.0.join("one.txt"), "one edit\n").expect("edit");
    stage_files_in(repo.path(), &["one.txt".into()]).expect("add");
    std::fs::write(repo.0.join("one.txt"), "one edit more\n").expect("edit after staging");
    std::fs::write(repo.0.join("two.txt"), "two edit\n").expect("edit");

    commit_staged_in(repo.path(), "one of two").expect("commit");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    // one.txt: the index copy was consumed by the commit; the later disk edit remains.
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "one.txt" && e.status == "modified")
    );
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "two.txt" && e.status == "modified")
    );
    // The commit only carried the staged copy.
    let head = git_out(&repo.0, &["show", "HEAD:one.txt"]);
    assert_eq!(head.trim(), "one edit");
}

#[test]
fn merge_branch_lands_clean_and_reports_conflicts() {
    let repo = TempRepo::new("merge-clean");
    repo.commit("a.txt", "a\\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("side.txt", "s\\n", "side work");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("b.txt", "b\\n", "main work");

    let landed = merge_branch_in(repo.path(), "side").expect("the merge ran");
    assert!(landed.merged, "a clean merge lands");
    assert!(landed.conflicts.is_empty());
    // `rev-list --parents -1`: the tip's line lists both parents.
    assert_eq!(
        git_out(&repo.0, &["rev-list", "--parents", "-1", "HEAD"])
            .split_whitespace()
            .count()
            - 1,
        2,
        "the tip is a two-parent merge"
    );

    // A conflicting merge reports its unmerged paths instead of failing the command:
    // the UI re-reads the rail from the returned list and offers actions.
    let conflicted = conflicting_repo("merge-conflict-outcome");
    let outcome = merge_branch_in(conflicted.path(), "side").expect("the merge ran");
    assert!(!outcome.merged);
    assert_eq!(outcome.conflicts, vec!["a.txt".to_string()]);
}

#[test]
fn resolve_takes_ours_or_theirs_and_stages_it() {
    let ours = conflicting_repo("resolve-ours");
    resolve_conflicts_in(ours.path(), &["a.txt".into()], "ours").expect("ours resolved");
    assert_eq!(
        std::fs::read_to_string(ours.0.join("a.txt")).expect("file"),
        "main\n"
    );
    assert!(!gs_v2(ours.path()).contains("a.txt"), "the index is resolved");

    let theirs = conflicting_repo("resolve-theirs");
    resolve_conflicts_in(theirs.path(), &["a.txt".into()], "theirs").expect("theirs resolved");
    assert_eq!(
        std::fs::read_to_string(theirs.0.join("a.txt")).expect("file"),
        "side\n"
    );

    // A clean repository has no sides to take — the command refuses with the scene.
    let clean = TempRepo::new("resolve-clean");
    clean.commit("a.txt", "a\\n", "base");
    let err =
        resolve_conflicts_in(clean.path(), &["a.txt".into()], "ours").unwrap_err();
    assert!(!err.is_empty());
    // And a made-up side never reaches git.
    assert!(resolve_conflicts_in(clean.path(), &[], "inside").is_err());
}

#[test]
fn abort_and_complete_move_the_merge_state() {
    // Guard first: no merge in progress, nothing to abort or complete.
    let clean = TempRepo::new("merge-absent");
    clean.commit("a.txt", "a\\n", "base");
    assert!(abort_merge_in(clean.path()).is_err());
    assert!(complete_merge_in(clean.path()).is_err());

    let repo = conflicting_repo("abort");
    abort_merge_in(repo.path()).expect("the merge aborted");
    assert!(run_git(repo.path(), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "main\n"
    );

    // Completing refuses while any path is unresolved; after a full resolve it commits
    // with git's own merge message, no editor involved.
    let repo = conflicting_repo("complete");
    assert!(complete_merge_in(repo.path()).is_err(), "conflicts remain");
    resolve_conflicts_in(repo.path(), &["a.txt".into()], "ours").expect("ours resolved");
    complete_merge_in(repo.path()).expect("the merge completed");
    assert!(run_git(repo.path(), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    assert_eq!(git_out(&repo.0, &["log", "--format=%s", "-1"]), "Merge branch 'side'");
}

#[test]
fn read_conflict_files_returns_both_sides() {
    let repo = conflicting_repo("conflict-payload");
    let snap = read_conflict_files_in(repo.path(), "a.txt").expect("conflict read");
    assert!(
        snap.ours_patch.contains("-base"),
        "diff of stage1 -> stage2: {}",
        snap.ours_patch
    );
    assert!(snap.ours_patch.contains("+main"));
    assert!(snap.theirs_patch.contains("+side"));

    // The file on disk mid-conflict still holds git's markers, verbatim.
    assert!(
        snap.worktree_text.contains("<<<<<<< HEAD\nmain\n=======\nside\n>>>>>>> side"),
        "worktree: {}",
        snap.worktree_text
    );

    assert_eq!(snap.incoming, "side", "the merged branch, named from git's merge message");

    // A path outside the conflict list has no stages at all — everything empty, not an error.
    let absent = read_conflict_files_in(repo.path(), "missing.txt").expect("absent is empty");
    assert!(
        absent.ours_patch.is_empty()
            && absent.theirs_patch.is_empty()
            && absent.worktree_text.is_empty()
    );
}

#[test]
fn write_conflict_resolution_stages_only_a_marker_free_file() {
    let repo = conflicting_repo("conflict-write");
    // Markers left: the text lands on disk but the path stays unmerged.
    write_conflict_resolution_in(repo.path(), "a.txt", "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> side\n")
        .expect("partial write");
    assert!(unmerged_paths_of(&run_git(repo.path(), &["status", "-sb"]).unwrap()).contains(&"a.txt".to_string()));

    write_conflict_resolution_in(repo.path(), "a.txt", "main\nside\n").expect("full write");
    assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "main\nside\n");
    assert!(unmerged_paths_of(&run_git(repo.path(), &["status", "-sb"]).unwrap()).is_empty());
    complete_merge_in(repo.path()).expect("the merge completes on the hand-made result");

    // A path git does not list as conflicted is never written.
    assert!(write_conflict_resolution_in(repo.path(), "other.txt", "x").is_err());
}

#[test]
fn read_conflict_files_synthesizes_both_added_sides() {
    let repo = TempRepo::new("conflict-add-add");
    repo.commit("a.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("both.txt", "from side\n", "side adds");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("both.txt", "from main\n", "main adds");
    let merged = Command::new("git")
        .args(["merge", "side", "--no-edit"])
        .current_dir(&repo.0)
        .output()
        .expect("merge ran");
    assert!(!merged.status.success(), "the merge must conflict");

    // No base stage means no git patch for either side, so both arrive synthesized as additions
    // rather than empty (which the panel would read as "that side deleted it").
    let snap = read_conflict_files_in(repo.path(), "both.txt").expect("conflict read");
    assert!(
        snap.ours_patch.contains("+from main"),
        "ours: {}",
        snap.ours_patch
    );
    assert!(
        snap.theirs_patch.contains("+from side"),
        "theirs: {}",
        snap.theirs_patch
    );
    assert!(
        snap.worktree_text.contains("<<<<<<< HEAD"),
        "worktree: {}",
        snap.worktree_text
    );
}
