use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Builds the git command every read runs through. `CREATE_NO_WINDOW` matters on Windows in
/// release: the app is a GUI-subsystem process there (see the attribute in main.rs), so a child
/// console app like git.exe opens its own visible cmd window on every spawn — and this app
/// spawns git constantly (refresh probes, worktree digests, image blobs). In dev the app is a
/// console process and children inherit the terminal's console, which is why `tauri dev` never
/// shows them.
fn git_command(dir: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

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
    git_command(dir)
        .args(args)
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

/// A git read that stats the worktree. `git diff HEAD` refreshes the index opportunistically
/// (taking index.lock), and the wip view runs three of those side by side, so the env var
/// turns that opportunistic write off and the concurrent reads cannot lock-race. Everything
/// serial (status above all) keeps its locks: the refreshed index it writes back is the stat
/// cache every later read hits — without it a WSL mount re-stat's every tracked file, a
/// ~20s scan, on every single call.
fn run_git_no_locks(dir: &str, args: &[&str]) -> Result<String, String> {
    git_command(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(args)
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

/// Runs a blocking git body on a worker thread. A sync `#[tauri::command]` executes on the main
/// thread, so one slow read (a 20-second `git status` over a `\\wsl.localhost` mount) greyed the
/// whole window out with "Not responding". Every command below is a thin async wrapper around
/// its sync `*_in` body; this is the one await they share.
async fn run_blocking<T, F>(op: &str, work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("the {op} task failed: {e}"))?
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
/// `tracked_patch` hands in the `git diff HEAD` output — read_status_in starts that read
/// beside the status scan instead of after it, so a dirty tree costs one cold scan, not two.
fn worktree_stamp(
    dir: &str,
    status_out: &str,
    changed: u32,
    tracked_patch: impl FnOnce() -> Option<String>,
) -> String {
    let mut stamp = status_out.to_string();
    if changed == 0 {
        return digest(&stamp);
    }
    // An edit inside a path the status list already had only shows up in the patch.
    if let Some(patch) = tracked_patch() {
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
pub async fn open_repository(dir: String) -> Result<RepoInfo, String> {
    run_blocking("open", move || open_repository_in(&dir)).await
}

fn open_repository_in(dir: &str) -> Result<RepoInfo, String> {
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
pub async fn read_status(dir: String) -> Result<StatusInfo, String> {
    run_blocking("status read", move || read_status_in(&dir)).await
}

fn read_status_in(dir: &str) -> Result<StatusInfo, String> {
    // The digest's `git diff HEAD` starts beside the status read, not after it: on a slow
    // mount (\\wsl.localhost) both are full worktree scans, and back to back they doubled
    // every open and focus probe of a dirty repo. A clean tree never joins the result —
    // the spare read finishes on its thread and is dropped.
    std::thread::scope(|scope| {
        let tracked_patch = scope.spawn(|| run_git(dir, &["diff", "--no-color", "HEAD"]).ok());
        // -uall so untracked files are counted one by one instead of per directory.
        let out = run_git(dir, &["status", "-sb", "--untracked-files=all"])?;
        let changed = out
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with("## "))
            .count() as u32;
        let worktree = worktree_stamp(dir, &out, changed, || {
            tracked_patch.join().ok().flatten()
        });
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
    })
}

/// `--all` includes refs/stash, which drags in the stash commit and the index snapshot it
/// points at as if they were history. Stashes get their own rows (read_stashes), so they are
/// excluded here — and from the delta/order reads, which have to describe the same set.
const EXCLUDE_STASH: &str = "--exclude=refs/stash";

/// Raw log for TS-side parsing: fields split on \x00, records on \x1e.
/// Decorations (%d) lead each record; %B is last so multi-line bodies survive the split.
#[tauri::command]
pub async fn read_log(dir: String, limit: u32, skip: u32) -> Result<String, String> {
    run_blocking("log read", move || read_log_in(&dir, limit, skip)).await
}

fn read_log_in(dir: &str, limit: u32, skip: u32) -> Result<String, String> {
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
pub async fn read_log_delta(dir: String, since: String, limit: u32) -> Result<String, String> {
    run_blocking("log delta", move || read_log_delta_in(&dir, &since, limit)).await
}

fn read_log_delta_in(dir: &str, since: &str, limit: u32) -> Result<String, String> {
    if since.trim().is_empty() {
        return read_log_in(dir, limit, 0);
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
pub async fn read_log_order(dir: String, limit: u32) -> Result<String, String> {
    run_blocking("log order", move || read_log_order_in(&dir, limit)).await
}

fn read_log_order_in(dir: &str, limit: u32) -> Result<String, String> {
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
pub async fn read_refs(dir: String) -> Result<String, String> {
    run_blocking("refs read", move || read_refs_in(&dir)).await
}

fn read_refs_in(dir: &str) -> Result<String, String> {
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
pub async fn read_stashes(dir: String) -> Result<String, String> {
    run_blocking("stash read", move || read_stashes_in(&dir)).await
}

fn read_stashes_in(dir: &str) -> Result<String, String> {
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
pub async fn checkout_branch(dir: String, branch: String) -> Result<(), String> {
    run_blocking("checkout", move || checkout_branch_in(&dir, &branch)).await
}

fn checkout_branch_in(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
}

/// Detaches HEAD onto a commit. The app asks first — the dialog warns that new commits made
/// on a detached HEAD are lost unless a branch is created — so this never runs unconfirmed.
#[tauri::command]
pub async fn checkout_commit(dir: String, hash: String) -> Result<(), String> {
    run_blocking("checkout", move || checkout_commit_in(&dir, &hash)).await
}

fn checkout_commit_in(dir: &str, hash: &str) -> Result<(), String> {
    let hash = hash.trim();
    // The arg goes straight into git's CLI: only an abbreviated/full hex hash is accepted, so
    // a branch name or any other string can never turn this into something else. A short hash
    // that matches nothing comes back as git's "does not exist" error, which the toast shows.
    if hash.len() < 4 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("\"{hash}\" is not a commit hash"));
    }
    // --detach is the explicit form: it detaches even when the hash sits on a branch tip.
    run_git(dir, &["checkout", "--detach", hash]).map(|_| ())
}

/// Pulls the current branch from its upstream. Fast-forward only: a pull that would need a
/// merge is refused with git's own message instead of half-merging inside a history viewer.
/// Runs on a blocking thread (network IO — a sync command would freeze the window) and
/// refuses terminal prompts, so a credential-hungry remote errors instead of hanging.
#[tauri::command]
pub async fn pull_branch(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_command(&dir)
            .args(["pull", "--ff-only", "--no-edit"])
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
        git_command(&dir)
            .args(["push", "-u", "origin", "HEAD"])
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

/// Runs a command's git reads concurrently and returns their results in call order.
/// Every `git` spawn over a `\\wsl.localhost` mount pays the slow 9P protocol for its own
/// process startup, so the commit panel's back-to-back reads used to stack several of
/// those startups in a row; run side by side, the wall time is just the slowest read.
fn parallel_git<'a>(
    reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + 'a>>,
) -> Vec<Result<String, String>> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = reads.into_iter().map(|read| scope.spawn(read)).collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap_or_else(|_| Err("a git read crashed".into())))
            .collect()
    })
}

/// Files of one commit. "wip" means the uncommitted working tree vs HEAD.
/// Otherwise: diff against the first parent; root commits use the --root forms.
#[tauri::command]
pub async fn read_commit_files(dir: String, hash: String) -> Result<FilePayload, String> {
    run_blocking("commit files read", move || read_commit_files_in(&dir, &hash)).await
}

fn read_commit_files_in(dir: &str, hash: &str) -> Result<FilePayload, String> {
    if hash == "wip" {
        // The three diff flavours are independent reads; a fourth one lists untracked
        // paths, whose numstat / name-status / patch entries are appended right after.
        // All four stat the worktree, so they run lock-free (see run_git_no_locks).
        let out = parallel_git(vec![
            Box::new(|| run_git_no_locks(dir, &["diff", "--numstat", "--no-color", "HEAD"])),
            Box::new(|| run_git_no_locks(dir, &["diff", "--name-status", "--no-color", "HEAD"])),
            Box::new(|| run_git_no_locks(dir, &["diff", "--no-color", "HEAD"])),
            Box::new(|| run_git_no_locks(dir, &["ls-files", "--others", "--exclude-standard", "-z"])),
        ]);
        let mut payload = FilePayload {
            numstat: out[0].clone().unwrap_or_default(),
            name_status: out[1].clone().unwrap_or_default(),
            diff: out[2].clone().unwrap_or_default(),
        };
        for path in out[3]
            .clone()?
            .split('\u{0}')
            .filter(|entry| !entry.is_empty())
        {
            let (num, status, patch) = untracked_entry(dir, path);
            payload.numstat.push_str(&num);
            payload.name_status.push_str(&status);
            payload.diff.push_str(&patch);
        }
        return Ok(payload);
    }

    // One git spawn answers every structural question the reads below need: `rev-list
    // --parents` prints the commit followed by its parents, so an empty list says this is
    // a root (diffing from the empty tree) and a third entry is a `stash -u` snapshot —
    // previously two extra `rev-parse --verify` probes, each a whole git spawn.
    let line = run_git(dir, &["rev-list", "--parents", "-1", hash])?;
    let parents: Vec<String> = line
        .split_whitespace()
        .skip(1)
        .map(String::from)
        .collect();
    let first = parents.first().cloned();
    let base: Vec<String> = match first {
        Some(parent) => vec!["diff".into(), "--no-color".into(), parent, hash.to_string()],
        None => vec![
            "show".into(),
            "--root".into(),
            "--format=".into(),
            "--no-color".into(),
            hash.to_string(),
        ],
    };
    let insert = |item: &str| -> Vec<String> {
        let mut v = base.clone();
        v.insert(1, item.into());
        v
    };
    let numstat_args = insert("--numstat");
    let name_status_args = insert("--name-status");
    // `git stash -u` keeps the untracked-but-stashed files in a third parent: a parentless
    // commit whose tree holds nothing but those files, so `git show` on it prints them as
    // the additions they were, and `diff ^1 ^3` (a full tree against that fragment) prints
    // every other file as deleted.
    let stash_args: Option<Vec<Vec<String>>> = (parents.len() >= 3).then(|| {
        let extra = |flag: Option<&str>| -> Vec<String> {
            let mut v: Vec<String> = vec!["show".into()];
            if let Some(flag) = flag {
                v.push(flag.into());
            }
            v.push("--no-color".into());
            v.push("--format=".into());
            v.push(parents[2].clone());
            v
        };
        vec![extra(Some("--numstat")), extra(Some("--name-status")), extra(None)]
    });

    let mut reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + '_>> = vec![
        Box::new(|| run_git(dir, &args(&numstat_args))),
        Box::new(|| run_git(dir, &args(&name_status_args))),
        Box::new(|| run_git(dir, &args(&base))),
    ];
    if let Some([s_numstat, s_status, s_diff]) = stash_args.as_deref() {
        reads.push(Box::new(|| run_git(dir, &args(s_numstat))));
        reads.push(Box::new(|| run_git(dir, &args(s_status))));
        reads.push(Box::new(|| run_git(dir, &args(s_diff))));
    }
    let out = parallel_git(reads);
    let mut payload = FilePayload {
        numstat: out[0].clone()?,
        name_status: out[1].clone()?,
        diff: out[2].clone()?,
    };
    if stash_args.is_some() {
        payload.numstat.push_str(&out[3].clone()?);
        payload.name_status.push_str(&out[4].clone()?);
        payload.diff.push_str(&out[5].clone()?);
    }
    Ok(payload)
}

fn args(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// Git output that must stay bytes (a blob) instead of the lossy-text run_git.
fn run_git_bytes(dir: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    git_command(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
        .and_then(|out| {
            if out.status.success() {
                Ok(out.stdout)
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        })
}

/// Above this a blob is no longer previewable — encoding it into a data URL would freeze the
/// webview's IPC. The pane shows the size and a "too large" note instead of the picture.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize, Debug)]
pub struct ImageVersion {
    /// Formed data URL; empty when the blob is over the cap.
    pub url: String,
    /// Byte size, shown even when too large to preview.
    pub bytes: usize,
    pub too_large: bool,
}

#[derive(Serialize, Default, Debug)]
pub struct ImageVersions {
    /// The parent's copy (empty for a root commit, and for a file HEAD cannot see).
    pub old: Option<ImageVersion>,
    /// The commit's copy (empty when the commit deleted the file).
    pub new: Option<ImageVersion>,
}

const IMAGE_MIME_BY_EXT: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    ("avif", "image/avif"),
    ("apng", "image/apng"),
];

fn image_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    IMAGE_MIME_BY_EXT
        .iter()
        .find(|(name, _)| *name == ext)
        .map(|(_, mime)| *mime)
        .unwrap_or("application/octet-stream")
}

/// The blob bytes at `<rev>:<path>`, or None when that path does not exist there (added/deleted).
fn blob_bytes(dir: &str, rev: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
    run_git_bytes(dir, &["cat-file", "blob", &format!("{rev}:{path}")])
        .map(Some)
        .or_else(|_| Ok(None))
}

/// A renamed (R) or copied (C) entry in the parent→commit patch whose destination is `path`;
/// its source path is where the old image lives. Missing when the file simply moved untouched.
fn rename_source(dir: &str, parent: &str, hash: &str, path: &str) -> Option<String> {
    let out = run_git(dir, &["diff", "--no-color", "--name-status", parent, hash]).ok()?;
    for line in out.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 3 || !(fields[0].starts_with('R') || fields[0].starts_with('C')) {
            continue;
        }
        if fields[2] == path {
            return Some(fields[1].to_string());
        }
    }
    None
}

fn version_of(bytes: Vec<u8>, path: &str) -> ImageVersion {
    if bytes.len() > MAX_IMAGE_BYTES {
        return ImageVersion { url: String::new(), bytes: bytes.len(), too_large: true };
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    ImageVersion {
        url: format!("data:{};base64,{encoded}", image_mime(path)),
        bytes: bytes.len(),
        too_large: false,
    }
}

/// Both sides of an image file change, the way GitHub diffs pictures: old = the parent's blob
/// (HEAD's for `wip`), new = the commit's (the working file on disk for `wip`). The webview
/// turns the data URLs into <img> elements with pixel-lossless copies of what git stores.
#[tauri::command]
pub async fn read_image_versions(
    dir: String,
    hash: String,
    path: String,
) -> Result<ImageVersions, String> {
    run_blocking("image versions read", move || {
        read_image_versions_in(&dir, &hash, &path)
    })
    .await
}

fn read_image_versions_in(dir: &str, hash: &str, path: &str) -> Result<ImageVersions, String> {
    // The revision the OLD side comes from; empty means "no previous copy exists".
    let old_rev: String = if hash == "wip" {
        if run_git(dir, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            "HEAD".to_string()
        } else {
            String::new() // Unborn branch: an untracked image has no history at all.
        }
    } else {
        let parent = format!("{hash}^1");
        if run_git(dir, &["rev-parse", "--verify", &parent]).is_ok() {
            parent
        } else {
            String::new() // Root commit: the file was born in it.
        }
    };

    let old = if old_rev.is_empty() {
        None
    } else {
        let mut bytes = blob_bytes(dir, &old_rev, path)?;
        if bytes.is_none() {
            // The image may have been renamed (or copied) into `path`; the old name holds the blob.
            if let Some(source) = rename_source(dir, &old_rev, hash, path) {
                bytes = blob_bytes(dir, &old_rev, &source)?;
            }
        }
        bytes.map(|data| version_of(data, path))
    };

    let new = if hash == "wip" {
        std::fs::read(Path::new(dir).join(path)).ok().map(|data| version_of(data, path))
    } else {
        blob_bytes(dir, hash, path)?.map(|data| version_of(data, path))
    };

    Ok(ImageVersions { old, new })
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

    fn git_out(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").args(args).current_dir(dir).output().expect("git ran");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn checkout_commit_detaches_onto_a_commit() {
        let repo = TempRepo::new("detach");
        repo.commit("a.txt", "a\n", "first");
        let first = git_out(&repo.0, &["rev-parse", "HEAD"]);
        repo.commit("b.txt", "b\n", "second");
        let second = git_out(&repo.0, &["rev-parse", "HEAD"]);

        checkout_commit_in(repo.path(), &first[..7]).expect("the short hash detaches");
        assert_eq!(git_out(&repo.0, &["rev-parse", "HEAD"]), first, "HEAD sits on the commit");
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
        assert_eq!((clean.dirty, clean.changed), (false, 0), "a committed tree is clean");
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
        git(&repo.0, &["branch", "--set-upstream-to=origin/main", "main"]);
        repo.commit("tracked.txt", "pushed\n", "c2");
        let ahead = read_status_in(repo.path()).expect("status read");
        assert_eq!(ahead.ahead, 1);
        assert_eq!((dirty.behind, dirty.ahead), (0, 0), "the pre-push read stays at zero");
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
        assert_eq!(first.worktree, again.worktree, "an untouched tree stamps identically");

        // Same path count (one modified file), different content: only the patch moves the stamp.
        std::fs::write(repo.0.join("tracked.txt"), "one\n").expect("touch");
        let pre_edit = read_status_in(repo.path()).expect("read with one change");
        std::fs::write(repo.0.join("tracked.txt"), "two\n").expect("edit");
        let post_edit = read_status_in(repo.path()).expect("read with same count");
        assert_ne!(pre_edit.worktree, post_edit.worktree, "an edit inside one file moves the stamp");
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
        assert!(records[0][6].contains("second: two"), "%B lands in the last field");
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
        assert_eq!(hashes, lines, "read_log and read_log_order describe the same window");

        let delta = read_log_delta_in(repo.path(), old_head.trim(), 500).expect("delta read");
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

        let payload = read_commit_files_in(repo.path(), "wip").expect("wip payload");
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
        let root_files = read_commit_files_in(repo.path(), &root_hash).expect("root files");
        assert!(root_files.numstat.contains("1\t0\troot.txt"), "got: {}", root_files.numstat);

        let files = read_commit_files_in(repo.path(), &second_hash).expect("parent diff");
        assert!(files.name_status.contains("A\tother.txt"));

        // git mv keeps the rename visible.
        git(&repo.0, &["mv", "root.txt", "renamed.txt"]);
        git(&repo.0, &["commit", "-q", "-m", "renamed"]);
        let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
        let renamed_hash = renamed_hash.trim().to_string();
        let renamed = read_commit_files_in(repo.path(), &renamed_hash).expect("renamed files");
        assert!(renamed.name_status.contains("R100\troot.txt\trenamed.txt"), "got: {}", renamed.name_status);
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
        assert!(new.url.starts_with("data:image/png;base64,"), "got: {}", new.url);
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
        assert_eq!(image_mime("photo.JPEG"), "image/jpeg", "the lookup is case-insensitive");

        // Renamed in this commit: the old blob is found under the source path.
        std::fs::write(repo.0.join("a.jpg").with_extension("jpeg"), &new_bytes).expect("file");
        git(&repo.0, &["mv", "a.jpg", "renamed.jpeg"]);
        git(&repo.0, &["commit", "-q", "-m", "renamed"]);
        let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
        let renamed_hash = renamed_hash.trim().to_string();
        let renamed = read_image_versions_in(repo.path(), &renamed_hash, "renamed.jpeg").expect("renamed");
        assert_eq!(renamed.old.expect("rename keeps the old blob").bytes, new_bytes.len());
        assert_eq!(renamed.new.expect("renamed keeps the blob").url.starts_with("data:image/jpeg;base64,"), true);

        // wip: old side = HEAD's blob, new side = the file on disk.
        let disk_bytes = vec![1u8, 2, 3, 4, 5];
        std::fs::write(repo.0.join("renamed.jpeg"), &disk_bytes).expect("edited on disk");
        let wip = read_image_versions_in(repo.path(), "wip", "renamed.jpeg").expect("wip versions");
        assert_eq!(wip.old.expect("HEAD blob").bytes, new_bytes.len(), "the old side is HEAD's copy");
        assert_eq!(wip.new.expect("disk copy").bytes, disk_bytes.len(), "the new side is the working file");
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

        let files = read_commit_files_in(repo.path(), merge_hash.trim()).expect("merge files");
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
