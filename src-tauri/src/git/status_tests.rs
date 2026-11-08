use std::path::PathBuf;
use std::process::Command;

use super::test_support::*;
use super::*;

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
