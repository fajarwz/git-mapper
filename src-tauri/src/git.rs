use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Debug)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct StatusInfo {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    /// True when the working tree has any change (staged, unstaged or untracked).
    pub dirty: bool,
    /// Changed paths in the working tree, untracked files counted individually.
    pub changed: u32,
    /// Current HEAD commit; empty on an unborn branch. Lets the UI detect work done elsewhere.
    pub head: String,
    /// Digest of the working tree itself. `changed` only counts paths, so an edit inside an
    /// already-modified file would look identical; this digest notices the content moving.
    pub worktree: String,
}

#[derive(Serialize)]
pub struct FilePayload {
    pub numstat: String,
    pub name_status: String,
    pub diff: String,
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
        .and_then(|out| {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        })
}

/// Cheap FNV-1a digest: these stamps are only ever compared for equality between two reads,
/// so a short, stable hash is enough — no crypto, no git plumbing call.
fn digest(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:x}:{}", text.len())
}

/// Fingerprint of the working tree: the status list (paths + codes) plus the tracked patch,
/// plus size/mtime of every untracked file (git keeps those out of any diff).
/// Only the equality of two stamps matters, so the length and hash of the text both go in.
fn worktree_stamp(dir: &str, status_out: &str, changed: u32) -> String {
    let mut stamp = status_out.to_string();
    if changed == 0 {
        return digest(&stamp);
    }
    // An edit inside a path the status list already had only shows up in the patch.
    if let Ok(patch) = run_git(dir, &["diff", "--no-color", "HEAD"]) {
        stamp.push_str(&patch);
    }
    // Untracked files are absent from that patch; stat them instead of reading them.
    for line in status_out.lines() {
        let Some(path) = line.strip_prefix("?? ") else {
            continue;
        };
        if let Ok(meta) = std::fs::metadata(Path::new(dir).join(path)) {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|age| age.as_nanos())
                .unwrap_or(0);
            stamp.push_str(&format!("\u{1}{path}:{}:{modified}", meta.len()));
        }
    }
    digest(&stamp)
}

/// Untracked files never appear in `git diff HEAD`, so the working-tree view builds their
/// numstat / name-status / patch entries itself, shaped the way git prints a new file.
fn untracked_entry(dir: &str, path: &str) -> (String, String, String) {
    const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
    let bytes = std::fs::read(Path::new(dir).join(path)).unwrap_or_default();
    let binary = bytes.len() as u64 > MAX_TEXT_BYTES || bytes.contains(&0);
    let header = format!("diff --git a/{path} b/{path}\nnew file mode 100644\n");
    if binary {
        // Nothing readable to patch: a single hunk line so the panel still says why it is empty.
        return (
            format!("-\t-\t{path}\n"),
            format!("A\t{path}\n"),
            format!("{header}--- /dev/null\n+++ b/{path}\n@@ Binary file, not shown @@\n"),
        );
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut body = String::new();
    let mut lines = 0usize;
    for line in text.split_terminator('\n') {
        body.push('+');
        body.push_str(line.strip_suffix('\r').unwrap_or(line));
        body.push('\n');
        lines += 1;
    }
    if lines == 0 {
        return (format!("0\t0\t{path}\n"), format!("A\t{path}\n"), header);
    }
    (
        format!("{lines}\t0\t{path}\n"),
        format!("A\t{path}\n"),
        format!("{header}--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{lines} @@\n{body}"),
    )
}

#[tauri::command]
pub fn open_repository(dir: &str) -> Result<RepoInfo, String> {
    let inside = run_git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    if inside.trim() != "true" {
        return Err(format!("{} is not a Git repository", dir));
    }
    let path = run_git(dir, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    // Git prints Windows paths with forward slashes from MSYS builds
    // (C:/Users/you/repo); keep that form so path comparisons stay consistent.
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(RepoInfo { path, name })
}

#[tauri::command]
pub fn read_status(dir: &str) -> Result<StatusInfo, String> {
    // -uall so untracked files are counted one by one instead of per directory.
    let out = run_git(dir, &["status", "-sb", "--untracked-files=all"])?;
    let changed = out
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with("## "))
        .count() as u32;
    let worktree = worktree_stamp(dir, &out, changed);
    // First line: "## main...origin/main [ahead 1, behind 2]" with any piece optional.
    let head = run_git(dir, &["rev-parse", "--verify", "HEAD"])
        .map(|sha| sha.trim().to_string())
        .unwrap_or_default();
    let mut info = StatusInfo {
        branch: String::new(),
        ahead: 0,
        behind: 0,
        dirty: changed > 0,
        changed,
        head,
        worktree,
    };
    if let Some(line) = out.lines().find(|l| l.starts_with("## ")) {
        let head = line.trim_start_matches("## ");
        // Branch name may contain dots; the upstream is after "..." and the counts in brackets.
        let (branch_part, tail) = head.split_once("...").unwrap_or((head, ""));
        info.branch = branch_part.to_string();
        let bracket = tail.split_once('[').map(|(_, r)| r).unwrap_or(tail);
        if let Some(close) = bracket.split_once(']') {
            for part in close.0.split(", ") {
                match part.split_once(' ') {
                    Some(("ahead", n)) => info.ahead = n.parse().unwrap_or(0),
                    Some(("behind", n)) => info.behind = n.parse().unwrap_or(0),
                    _ => {}
                }
            }
        }
        Ok(info)
    } else {
        // Detached HEAD or unborn branch: still return a usable row.
        info.branch = "HEAD detached".into();
        Ok(info)
    }
}

/// `--all` includes refs/stash, which drags in the stash commit and the index snapshot it
/// points at as if they were history. Stashes get their own rows (read_stashes), so they are
/// excluded here — and from the delta/order reads, which have to describe the same set.
const EXCLUDE_STASH: &str = "--exclude=refs/stash";

/// Raw log for TS-side parsing: fields split on \x00, records on \x1e.
/// Decorations (%d) lead each record; %B is last so multi-line bodies survive the split.
#[tauri::command]
pub fn read_log(dir: &str, limit: u32, skip: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all", "--date-order",
            &format!("--max-count={limit}"),
            &format!("--skip={skip}"),
            "--date=iso-strict",
            "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
        ],
    )
}

/// Commits reachable from any ref but not from `since`: the delta a focus refresh needs,
/// so the UI never re-reads the whole history for one new commit.
#[tauri::command]
pub fn read_log_delta(dir: &str, since: &str, limit: u32) -> Result<String, String> {
    if since.trim().is_empty() {
        return read_log(dir, limit, 0);
    }
    let exclude = format!("^{since}");
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all", "--date-order",
            &format!("--max-count={limit}"),
            &exclude,
            "--date=iso-strict",
            "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
        ],
    )
}

/// Commit hashes in the exact order `read_log` returns them. A refresh fetches only the new
/// commits, so it needs this cheap list to splice them in where git would put them: someone
/// else's older commit can land below rows that are already on screen.
#[tauri::command]
pub fn read_log_order(dir: &str, limit: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all", "--date-order",
            &format!("--max-count={limit}"),
            "--date=iso-strict",
            "--pretty=tformat:%H",
        ],
    )
}

/// All branch/remote/tag tips: raw `hash\tfullref` lines for TS-side parsing.
/// Decorations on log rows miss tips that point outside the loaded window.
#[tauri::command]
pub fn read_refs(dir: &str) -> Result<String, String> {
    run_git(
        dir,
        &[
            "for-each-ref",
            "--format=%(objectname)%09%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )
}

/// Stash entries, newest first. Only `refs/stash` is a real ref and it points at the newest
/// entry, so for-each-ref and `log --all` can never see the older ones: the reflog is the only
/// place the full list exists. Same record/field separators as read_log.
#[tauri::command]
pub fn read_stashes(dir: &str) -> Result<String, String> {
    run_git(
        dir,
        &[
            "stash",
            "list",
            "--pretty=tformat:%gd%x00%H%x00%P%x00%an%x00%ae%x00%cI%x00%gs%x1e",
        ],
    )
}

/// Checks out an existing branch by name; refuses with git's own error when the
/// working tree would lose changes (dirty tree with conflicting paths).
#[tauri::command]
pub fn checkout_branch(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
}

/// Pulls the current branch from its upstream. Fast-forward only: a pull that would need a
/// merge is refused with git's own message instead of half-merging inside a history viewer.
/// Runs on a blocking thread (network IO — a sync command would freeze the window) and
/// refuses terminal prompts, so a credential-hungry remote errors instead of hanging.
#[tauri::command]
pub async fn pull_branch(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Command::new("git")
            .args(["pull", "--ff-only", "--no-edit"])
            .current_dir(&dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("failed to run git: {e}"))
            .and_then(|out| {
                if out.status.success() {
                    Ok(String::from_utf8_lossy(&out.stdout).to_string())
                } else {
                    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
                }
            })
    })
    .await
    .map_err(|e| format!("the pull task failed: {e}"))?
}

/// Pushes the current branch to origin. `-u` sets the upstream on the first push and is
/// harmless on every later one; a rejected push comes back as git's own error text. Blocking
/// thread for the same reason as the pull.
#[tauri::command]
pub async fn push_branch(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Command::new("git")
            .args(["push", "-u", "origin", "HEAD"])
            .current_dir(&dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("failed to run git: {e}"))
            .and_then(|out| {
                if out.status.success() {
                    Ok(String::from_utf8_lossy(&out.stdout).to_string())
                } else {
                    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
                }
            })
    })
    .await
    .map_err(|e| format!("the push task failed: {e}"))?
}

/// Files of one commit. "wip" means the uncommitted working tree vs HEAD.
/// Otherwise: diff against the first parent; root commits use the --root forms.
#[tauri::command]
pub fn read_commit_files(dir: &str, hash: &str) -> Result<FilePayload, String> {
    if hash == "wip" {
        // Unborn branch: `diff HEAD` has nothing to compare against, so start from empty.
        let diff = run_git(dir, &["diff", "--no-color", "HEAD"]).unwrap_or_default();
        let numstat =
            run_git(dir, &["diff", "--numstat", "--no-color", "HEAD"]).unwrap_or_default();
        let name_status =
            run_git(dir, &["diff", "--name-status", "--no-color", "HEAD"]).unwrap_or_default();
        // `git diff` ignores untracked paths entirely, so a brand-new file would never show up.
        let untracked = run_git(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;
        let mut payload = FilePayload {
            numstat,
            name_status,
            diff,
        };
        for path in untracked.split('\u{0}').filter(|entry| !entry.is_empty()) {
            let (num, status, patch) = untracked_entry(dir, path);
            payload.numstat.push_str(&num);
            payload.name_status.push_str(&status);
            payload.diff.push_str(&patch);
        }
        return Ok(payload);
    }

    let is_root_rev = format!("{hash}^1");
    let is_root = run_git(dir, &["rev-parse", "--verify", &is_root_rev]).is_err();

    let base: Vec<String> = if is_root {
        vec![
            "show".into(),
            "--root".into(),
            "--format=".into(),
            "--no-color".into(),
            hash.to_string(),
        ]
    } else {
        vec!["diff".into(), "--no-color".into(), format!("{hash}^1"), hash.to_string()]
    };

    let insert = |item: &str| -> Vec<String> {
        let mut v = base.clone();
        v.insert(1, item.into());
        v
    };
    let numstat_args = insert("--numstat");
    let name_status_args = insert("--name-status");
    let mut payload = FilePayload {
        numstat: run_git(dir, &args(&numstat_args))?,
        name_status: run_git(dir, &args(&name_status_args))?,
        diff: run_git(dir, &args(&base))?,
    };

    // `git stash -u` keeps the untracked-but-stashed files in a third parent: a parentless
    // commit whose tree holds nothing but those files, so `git show` on it prints them as the
    // additions they were, and `diff ^1 ^3` (a full tree against that fragment) prints every
    // other file as deleted.
    let third = format!("{hash}^3");
    if run_git(dir, &["rev-parse", "--verify", &third]).is_ok() {
        let stash_extra = |flag: Option<&str>| -> Result<String, String> {
            let mut v: Vec<String> = vec!["show".into()];
            if let Some(flag) = flag {
                v.push(flag.into());
            }
            v.push("--no-color".into());
            v.push("--format=".into());
            v.push(third.clone());
            run_git(dir, &args(&v))
        };
        payload.numstat.push_str(&stash_extra(Some("--numstat"))?);
        payload.name_status.push_str(&stash_extra(Some("--name-status"))?);
        payload.diff.push_str(&stash_extra(None)?);
    }
    Ok(payload)
}

fn args(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throw-away repository on disk, real `git` CLI driving every command below it.
    struct TempRepo(PathBuf);

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().expect("git ran");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    impl TempRepo {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("git-mapper-test-{}-{label}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("temp repo created");
            git(&dir, &["init", "-q"]);
            git(&dir, &["config", "user.name", "Test User"]);
            git(&dir, &["config", "user.email", "test@example.com"]);
            git(&dir, &["config", "core.autocrlf", "false"]);
            TempRepo(dir)
        }

        fn path(&self) -> &str {
            self.0.to_string_lossy().replace('\\', "/").leak()
        }

        fn commit(&self, file: &str, body: &str, message: &str) {
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

    #[test]
    fn open_repository_names_the_toplevel() {
        let repo = TempRepo::new("open");
        let info = open_repository(repo.path()).expect("the repo opens");
        assert_eq!(info.path, repo.path());
        assert_eq!(info.name, PathBuf::from(repo.path()).file_name().unwrap().to_string_lossy());
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
        let err = open_repository(&target).unwrap_err();
        assert!(err.contains("is not a Git repository"), "got: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_status_counts_modified_plus_untracked_and_sees_ahead() {
        let repo = TempRepo::new("status");
        repo.commit("tracked.txt", "one\n", "c1");
        repo.0.join("untracked.txt");

        let clean = read_status(repo.path()).expect("status read");
        assert_eq!((clean.dirty, clean.changed), (false, 0), "a committed tree is clean");
        assert!(!clean.head.is_empty(), "HEAD is present");
        assert_eq!((clean.ahead, clean.behind), (0, 0));

        // One modified tracked path + one untracked path, each counted individually.
        std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\n").expect("edit");
        std::fs::write(repo.0.join("untracked.txt"), "new\n").expect("untracked");
        let dirty = read_status(repo.path()).expect("status read");
        assert_eq!((dirty.dirty, dirty.changed), (true, 2));

        // A commit after a push lands the branch ahead by exactly one.
        git(&repo.0, &["stash", "-q"]);
        git(&repo.0, &["remote", "add", "origin", repo.path()]);
        git(&repo.0, &["fetch", "-q", "origin", "main"]);
        git(&repo.0, &["branch", "--set-upstream-to=origin/main", "main"]);
        repo.commit("tracked.txt", "pushed\n", "c2");
        let ahead = read_status(repo.path()).expect("status read");
        assert_eq!(ahead.ahead, 1);
        assert_eq!((dirty.behind, dirty.ahead), (0, 0), "the pre-push read stays at zero");
    }

    #[test]
    fn read_status_survives_an_unborn_branch() {
        let repo = TempRepo::new("unborn");
        let info = read_status(repo.path()).expect("a repo without commits still reads");
        // git status prints "## No commits yet on main"; the loader shows the branch hint as-is.
        assert_eq!(info.branch, "No commits yet on main");
        assert_eq!(info.head, "");
        assert_eq!(info.dirty, false);
    }

    #[test]
    fn the_worktree_digest_notices_an_edit_the_count_misses() {
        let repo = TempRepo::new("digest");
        repo.commit("tracked.txt", "one\n", "c1");

        let first = read_status(repo.path()).expect("first read");
        let again = read_status(repo.path()).expect("second read");
        assert_eq!(first.worktree, again.worktree, "an untouched tree stamps identically");

        // Same path count (one modified file), different content: only the patch moves the stamp.
        std::fs::write(repo.0.join("tracked.txt"), "one\n").expect("touch");
        let pre_edit = read_status(repo.path()).expect("read with one change");
        std::fs::write(repo.0.join("tracked.txt"), "two\n").expect("edit");
        let post_edit = read_status(repo.path()).expect("read with same count");
        assert_ne!(pre_edit.worktree, post_edit.worktree, "an edit inside one file moves the stamp");
    }

    #[test]
    fn read_log_records_keep_field_and_record_separators() {
        let repo = TempRepo::new("log");
        repo.commit("one.txt", "one\n", "first: one");
        repo.commit("two.txt", "two\n", "second: two");

        let raw = read_log(repo.path(), 10, 0).expect("log read");
        let records = records_of(&raw);
        assert_eq!(records.len(), 2, "one record per commit, newest first");
        let head = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
        assert_eq!(
            records[0][1].trim_start_matches('\n'),
            head.trim(),
            "the hash field is the commit sha"
        );
        assert!(records[0][6].contains("second: two"), "%B lands in the last field");
    }

    #[test]
    fn read_log_order_matches_read_log_shape_and_delta_excludes_the_since_base() {
        let repo = TempRepo::new("delta");
        repo.commit("one.txt", "one\n", "first");
        let old_head = read_log_order(repo.path(), 10).expect("ordering read");
        repo.commit("two.txt", "two\n", "second");

        let order = read_log_order(repo.path(), 10).expect("ordering read");
        let lines: Vec<&str> = order.lines().collect();
        assert_eq!(lines.len(), 2, "one line per commit, nothing else");
        let raw = read_log(repo.path(), 10, 0).expect("log read");
        let hashes: Vec<String> = records_of(&raw)
            .iter()
            .map(|r| r[1].trim_start_matches('\n').to_string())
            .collect();
        assert_eq!(hashes, lines, "read_log and read_log_order describe the same window");

        let delta = read_log_delta(repo.path(), old_head.trim(), 500).expect("delta read");
        let delta_hashes: Vec<String> = records_of(&delta)
            .iter()
            .map(|r| r[1].trim_start_matches('\n').to_string())
            .collect();
        assert_eq!(delta_hashes, vec![lines[0]], "only the commit newer than `since` comes back");
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
            read_log(repo.path(), 10, 0).expect("log read"),
            read_log_order(repo.path(), 10).expect("order read"),
        ] {
            assert!(
                !raw.contains(&stash_hash),
                "the stash commit must stay out of history: {raw}"
            );
        }

        let stashes = read_stashes(repo.path()).expect("stash read");
        let records = records_of(&stashes);
        assert_eq!(records.len(), 1, "the reflog is the only view over every entry");
        assert!(records[0][0].trim_start_matches('\n').starts_with("stash@{"));
        assert_eq!(records[0][1], stash_hash.trim());
    }

    #[test]
    fn wip_files_list_untracked_paths_and_the_binary_hunk() {
        let repo = TempRepo::new("wip");
        repo.commit("tracked.txt", "one\n", "first");

        std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\n").expect("edit");
        std::fs::write(repo.0.join("new.txt"), "l1\nl2\n").expect("untracked text");
        std::fs::write(repo.0.join("blob.bin"), [0u8, 1, 255, 9, 0]).expect("untracked binary");

        let payload = read_commit_files(repo.path(), "wip").expect("wip payload");
        assert!(payload.name_status.contains("M\ttracked.txt"));
        assert!(payload.numstat.contains("2\t0\tnew.txt"));
        assert!(payload.name_status.contains("A\tnew.txt"), "`git diff` alone never lists untracked paths");
        assert!(payload.diff.contains("+++ b/new.txt"));
        assert!(payload.numstat.contains("-\t-\tblob.bin"));
        assert!(payload.diff.contains("@@ Binary file, not shown @@"), "the panel needs a reason for an empty patch");
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
        let root_files = read_commit_files(repo.path(), &root_hash).expect("root files");
        assert!(root_files.numstat.contains("1\t0\troot.txt"), "got: {}", root_files.numstat);

        let files = read_commit_files(repo.path(), &second_hash).expect("parent diff");
        assert!(files.name_status.contains("A\tother.txt"));

        // git mv keeps the rename visible.
        git(&repo.0, &["mv", "root.txt", "renamed.txt"]);
        git(&repo.0, &["commit", "-q", "-m", "renamed"]);
        let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
        let renamed_hash = renamed_hash.trim().to_string();
        let renamed = read_commit_files(repo.path(), &renamed_hash).expect("renamed files");
        assert!(renamed.name_status.contains("R100\troot.txt\trenamed.txt"), "got: {}", renamed.name_status);
    }

    /// A bare repository to push/pull against: a local-path remote, no network.
    fn bare_repo(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("git-mapper-test-{}-{label}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("bare repo created");
        Command::new("git")
            .args(["init", "--bare", "-q"])
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
        git(&repo.0, &["remote", "add", "origin", origin.to_str().expect("origin path")]);

        tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
            .expect("the first push publishes and sets the upstream");
        repo.commit("more.txt", "more\n", "second");
        tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
            .expect("a later push is a plain update");

        let pushed = run_git(origin.to_str().expect("origin path"), &["rev-parse", "HEAD"])
            .expect("origin read");
        let local = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("local read");
        assert_eq!(pushed.trim(), local.trim(), "origin carries the pushed commit");
        let upstream = run_git(repo.path(), &["rev-parse", "--abbrev-ref", "@{u}"])
            .expect("upstream read");
        assert!(upstream.trim().starts_with("origin/"), "`-u` set the upstream");
        let _ = std::fs::remove_dir_all(&origin);
    }

    #[test]
    fn pull_fast_forwards_and_refuses_a_diverged_branch() {
        let origin = bare_repo("pull-origin");
        let work = TempRepo::new("pull-work");
        work.commit("base.txt", "base\n", "base");
        git(&work.0, &["remote", "add", "origin", origin.to_str().expect("origin path")]);
        tauri::async_runtime::block_on(push_branch(work.path().to_string()))
            .expect("the seed push");

        // A second clone plays the other machine: it commits and pushes.
        let other = work.0.parent().unwrap().join("pull-other");
        git(
            &work.0.parent().unwrap().to_path_buf(),
            &["clone", "-q", origin.to_str().unwrap(), other.to_str().unwrap()],
        );
        std::fs::write(other.join("theirs.txt"), "theirs\n").expect("file written");
        git(&other, &["add", "theirs.txt"]);
        git(&other, &["commit", "-q", "-m", "theirs"]);

        tauri::async_runtime::block_on(pull_branch(work.path().to_string()))
            .expect("the fast-forward pull");
        let head = run_git(work.path(), &["rev-parse", "HEAD"]).expect("head read");
        let upstream = run_git(work.path(), &["rev-parse", "@{u}"]).expect("upstream read");
        assert_eq!(head.trim(), upstream.trim(), "the pull caught the other machine's commit");

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
}
