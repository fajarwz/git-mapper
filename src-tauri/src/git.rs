use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
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

/// Raw log for TS-side parsing: fields split on \x00, records on \x1e.
/// Decorations (%d) lead each record; %B is last so multi-line bodies survive the split.
#[tauri::command]
pub fn read_log(dir: &str, limit: u32, skip: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
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

/// Checks out an existing branch by name; refuses with git's own error when the
/// working tree would lose changes (dirty tree with conflicting paths).
#[tauri::command]
pub fn checkout_branch(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
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
    Ok(FilePayload {
        numstat: run_git(dir, &args(&numstat_args))?,
        name_status: run_git(dir, &args(&name_status_args))?,
        diff: run_git(dir, &args(&base))?,
    })
}

fn args(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}
