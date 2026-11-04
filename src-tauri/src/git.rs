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
    /// Empty when with_patch is false; per-file patches come from read_file_patch.
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

// ------------------------------------------------------------------ Staging rail reads/writes
//
// The rail is driven by three sources of truth, read in ONE command so a click never spawns
// three independent git scans:
//   * `git status --porcelain=v2 -z` — which paths differ in the index and/or worktree;
//   * `git diff --numstat -z --cached` — the index copy's line counts (staged vs HEAD);
//   * `git diff --numstat -z`            — the worktree copy's counts (worktree vs index).
// Untracked files appear in the status only; their counts are read off disk like the wip view
// does (untracked_entry), reusing the same binary/line-count rule.

#[derive(Serialize, Debug)]
pub struct WorktreeEntry {
    /// Stable identifier: `index:<path>` or `worktree:<path>`. One path can legitimately appear
    /// as BOTH (staged once, then edited again on disk), and each row means one of the copies.
    pub key: String,
    pub path: String,
    /// Rename/copy source (`git mv` / detected rename) in the same state.
    pub old_path: Option<String>,
    /// "added" | "modified" | "deleted" | "renamed" — v2 porcelain letters shaped for the UI.
    pub status: String,
    /// True = this entry is the index copy (what a commit would take); false = working tree.
    pub staged: bool,
    /// True when the worktree side is an untracked file (the discard moves delete it from disk).
    pub untracked: bool,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct WorktreeSnapshot {
    pub entries: Vec<WorktreeEntry>,
}

fn status_kind(letter: char) -> &'static str {
    match letter {
        'A' => "added",
        'D' => "deleted",
        'R' | 'C' => "renamed",
        // 'M' plus T (typechange) — the panel has no typechange voice, modified tells the story.
        _ => "modified",
    }
}

/// Walks `status --porcelain=v2 -z` records. Every entry begins with a record kind — `1`
/// (tracked), `2` (renamed/copied), `?` (untracked, carries no XY at all: `? <path>`) — then
/// the XY pair, header hashes, and (for renames) `<origPath><NUL>` right after the path.
/// Conflicts (`u` records) are skipped: a viewer without a merge editor cannot act on them
/// and staging refuses quietly.
fn for_each_status_v2(raw: &str, mut visit: impl FnMut(char, char, String, Option<String>)) {
    let mut cursor = 0usize;
    while cursor < raw.len() {
        let Some(rel_end) = raw[cursor..].find('\0') else {
            break;
        };
        let record = raw[cursor..cursor + rel_end].trim_end();
        cursor += rel_end + 1;
        if record.is_empty() {
            continue; // rename records are `path\0orig\0`; the empty gap is the terminator
        }
        let Some(kind_end) = record.find(' ') else {
            continue;
        };
        let (kind, rest) = (&record[..kind_end], &record[kind_end + 1..]);
        if kind == "u" {
            continue; // unmerged: outside the viewer's scope
        }
        if kind == "?" {
            // `? <path>`, NUL-terminated: the rest is the whole path, spaces included.
            visit('?', '?', rest.to_string(), None);
            continue;
        }
        if kind != "1" && kind != "2" {
            continue;
        }
        if rest.len() < 2 {
            continue;
        }
        // XY pair, ASCII by grammar, then several space-separated header fields — six of them
        // for kind 1 (sub, mH, mI, mW, hH, hI), a rename score extra for kind 2 — and the path
        // is everything after them, spaces included.
        let x = rest.as_bytes()[0] as char;
        let y = rest.as_bytes()[1] as char;
        let tail = &rest[2..];
        let headers = if kind == "2" { 8 } else { 7 };
        let mut seen = 0usize;
        let mut path_at = None;
        for (offset, c) in tail.char_indices() {
            if c == ' ' {
                seen += 1;
                if seen == headers {
                    path_at = Some(offset + 1);
                    break;
                }
            }
        }
        let Some(at) = path_at else {
            continue;
        };
        let path = tail[at..].trim_end().to_string();
        let orig = if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            let Some(rel_orig_end) = raw[cursor..].find('\0') else {
                break;
            };
            let orig = raw[cursor..cursor + rel_orig_end].to_string();
            cursor += rel_orig_end + 1;
            Some(orig)
        } else {
            None
        };
        visit(x, y, path, orig);
    }
}

/// `--numstat -z` records: `added\tdeleted\tpath` NUL-terminated; a rename appends the source
/// path as an extra token. A token that cannot parse as a numstat triplet right after a record
/// is that record's rename source.
fn numstat_map(raw: &str) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map = std::collections::HashMap::new();
    for token in raw.split('\0') {
        if token.trim().is_empty() {
            continue;
        }
        let mut fields = token.split('\t');
        let (Some(add), Some(del), Some(path)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let counts = (
            add.trim().parse::<u32>().unwrap_or(0),
            del.trim().parse::<u32>().unwrap_or(0),
        );
        // Rename detection in numstat prints rename records as a plain delete + add, so the
        // destination path is always the direct key — no partner tokens to sort through.
        map.insert(path.to_string(), counts);
    }
    map
}

/// A dirty-looking rename destination whose numstat came back keyed the old way (`a\tb\t{old => new}`):
/// both spellings are tried so a rename's counts survive git's two formats.
/// `git mv`-made renames (with content untouched) hand a status R row but numstat keys only
/// the destination, so a miss falls back to zero counts rather than a crash — the panel still
/// shows the rename story.
fn counts_for(map: &std::collections::HashMap<String, (u32, u32)>, path: &str, old: Option<&str>) -> (u32, u32) {
    if let Some(counts) = map.get(path) {
        return *counts;
    }
    let _ = old;
    (0, 0)
}

/// Line count of an untracked file: what the wip view pretends a new file's numstat is. Binary
/// (or unreadable) files show as an uncounted addition rather than guessing at lines.
fn untracked_counts(dir: &str, path: &str) -> (u32, u32) {
    let bytes = std::fs::read(Path::new(dir).join(path)).unwrap_or_default();
    if bytes.len() as u64 > 2 * 1024 * 1024 || bytes.contains(&0) {
        return (0, 0);
    }
    (String::from_utf8_lossy(&bytes).lines().count() as u32, 0)
}

#[tauri::command]
pub async fn read_worktree_files(dir: String) -> Result<WorktreeSnapshot, String> {
    run_blocking("worktree files read", move || read_worktree_files_in(&dir)).await
}

fn read_worktree_files_in(dir: &str) -> Result<WorktreeSnapshot, String> {
    let out = parallel_git(vec![
        Box::new(|| {
            run_git(
                dir,
                &["status", "--porcelain=v2", "--untracked-files=all", "-z"],
            )
        }),
        Box::new(|| run_git(dir, &["diff", "--numstat", "-z", "--cached"])),
        Box::new(|| run_git(dir, &["diff", "--numstat", "-z"])),
    ]);
    let status_raw = out[0].clone()?;
    let staged_counts = out[1].clone().unwrap_or_default(); // unborn HEAD: no index copy to count
    let worktree_counts = out[2].clone().unwrap_or_default();
    let staged_map = numstat_map(&staged_counts);
    let worktree_map = numstat_map(&worktree_counts);

    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut push_entry = |key_prefix: &str,
                          path: &str,
                          old_path: Option<String>,
                          status: String,
                          untracked: bool,
                          counts: (u32, u32)| {
        entries.push(WorktreeEntry {
            key: format!("{key_prefix}:{path}"),
            path: path.to_string(),
            old_path,
            status,
            staged: key_prefix == "index",
            untracked,
            additions: counts.0,
            deletions: counts.1,
        });
    };

    let mut dirty_index = |x: char, y: char, path: &str, old: &Option<String>| {
        // Untracked records visit with x = '?' (`? <path>` carries no real XY): they belong
        // to the worktree section only, never the index.
        if x != '.' && x != '?' {
            push_entry(
                "index",
                path,
                old.clone(),
                status_kind(x).to_string(),
                false,
                counts_for(&staged_map, path, old.as_deref()),
            );
        }
        if y != '.' && y != '?' {
            push_entry(
                "worktree",
                path,
                old.clone(),
                status_kind(y).to_string(),
                false,
                counts_for(&worktree_map, path, old.as_deref()),
            );
        } else if y == '?' {
            push_entry(
                "worktree",
                path,
                None,
                "added".to_string(),
                true,
                untracked_counts(dir, path),
            );
        }
    };
    for_each_status_v2(&status_raw, |x, y, path, orig| {
        dirty_index(x, y, &path, &orig);
    });
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    entries.sort_by_key(|entry| !entry.staged);
    Ok(WorktreeSnapshot { entries })
}

#[tauri::command]
pub async fn stage_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("stage", move || stage_files_in(&dir, &paths)).await
}

fn stage_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_git(dir, &args).map(|_| ())
}

#[tauri::command]
pub async fn unstage_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("unstage", move || unstage_files_in(&dir, &paths)).await
}

fn unstage_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    // A staged rename is really delete-source + add-destination inside the index. Unstaging
    // only the destination would leave "source deleted" staged. Both sides restore to HEAD,
    // and the file walks back to its original name on disk, so the rename simply vanishes.
    let raw = run_git(dir, &["status", "--porcelain=v2", "--untracked-files=all", "-z"])
        .unwrap_or_default();
    let mut rename_sources: Vec<(String, String)> = Vec::new();
    for_each_status_v2(&raw, |x, _y, path, orig| {
        if x == 'R' && paths.iter().any(|p| p == &path) {
            if let Some(source) = orig {
                rename_sources.push((path.clone(), source.trim().to_string()));
            }
        }
    });

    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    args.extend(rename_sources.iter().map(|(_, source)| source.as_str()));
    run_git(dir, &args).map(|_| ())?;
    for (destination, source) in &rename_sources {
        // Plain fs rename: the worktree now carries the staged, uncommitted move of that file.
        let _ = std::fs::rename(Path::new(dir).join(destination), Path::new(dir).join(source));
    }
    Ok(())
}

#[tauri::command]
pub async fn discard_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("discard", move || discard_files_in(&dir, &paths)).await
}

fn discard_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    // Per-surface semantics the panel offers:
    //   * untracked file -> delete from disk (`git clean -f`);
    //   * file whose index copy differs from HEAD (something is staged) -> the worktree row's
    //     discard returns ONLY the extra edits (restore the worktree from the index);
    //   * otherwise a tracked path -> `checkout -f HEAD --` puts index AND worktree back.
    // Everything is classified from one fresh status read, never from what the UI remembers.
    let wanted: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();
    let raw = run_git(
        dir,
        &["status", "--porcelain=v2", "--untracked-files=all", "-z"],
    )?;
    // HEAD's paths in one listing: `checkout -f HEAD --` errors for a path it does not carry.
    // `-r` walks the whole tree — without it the set holds only top-level entries, and any
    // nested modified path fell through to the intent-to-add branch, which deletes the file.
    let head_paths: std::collections::HashSet<String> =
        match run_git(dir, &["ls-tree", "-r", "--name-only", "-z", "HEAD"]) {
            Ok(tree) => tree.split('\0').map(String::from).collect(),
            Err(_) => std::collections::HashSet::new(), // unborn branch: everything is "not in HEAD"
        };

    let mut clean: Vec<String> = Vec::new();
    let mut from_index: Vec<String> = Vec::new();
    let mut from_head: Vec<String> = Vec::new();
    let mut from_disk: Vec<String> = Vec::new(); // intent-to-add: index holds an empty blob only
    for_each_status_v2(&raw, |x, y, path, _orig| {
        if !wanted.contains(path.as_str()) {
            return;
        }
        if y == '?' {
            clean.push(path);
        } else if x != '.' {
            from_index.push(path);
        } else if head_paths.contains(path.as_str()) {
            from_head.push(path);
        } else {
            from_disk.push(path);
        }
    });

    let git = |prefix: &[&str], list: &[String]| -> Result<(), String> {
        let mut args: Vec<&str> = prefix.to_vec();
        args.extend(list.iter().map(String::as_str));
        run_git(dir, &args).map(|_| ())
    };
    // An empty group must NOT run: `clean -qf --` and especially `checkout -f HEAD --`
    // without a pathspec act on the whole tree, wiping staged adds wholesale.
    if !clean.is_empty() {
        git(&["clean", "-qf", "--"], &clean)?;
    }
    if !from_index.is_empty() {
        git(&["checkout", "--"], &from_index)?;
    }
    if !from_head.is_empty() {
        git(&["checkout", "-f", "HEAD", "--"], &from_head)?;
    }
    // Files with an intent-to-add entry have no HEAD copy and an empty index blob: deleting
    // the disk file IS the discard. `clean -f` skips tracked paths, so removed directly.
    for path in &from_disk {
        let _ = std::fs::remove_file(Path::new(dir).join(path));
    }
    Ok(())
}

#[tauri::command]
pub async fn discard_all(dir: String) -> Result<(), String> {
    run_blocking("discard all", move || discard_all_in(&dir)).await
}

fn discard_all_in(dir: &str) -> Result<(), String> {
    // The panel's "every change" dialog: tracked paths reset (staged copies included) and
    // untracked files are deleted — directory entries too, so an empty folder never lingers.
    let head = run_git(dir, &["rev-parse", "--verify", "HEAD"]).map(|_| ());
    if head.is_ok() {
        run_git(dir, &["reset", "--hard", "-q"]).map(|_| ())?;
    }
    run_git(dir, &["clean", "-qfd"]).map(|_| ())
}

#[tauri::command]
pub async fn commit_staged(dir: String, message: String) -> Result<(), String> {
    run_blocking("commit", move || commit_staged_in(&dir, &message)).await
}

fn commit_staged_in(dir: &str, message: &str) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("the commit message is empty".into());
    }
    // Nothing staged: git's "nothing to commit" rides stdout, which run_git drops on
    // failures — an empty error would just say "" in the toast.
    let staged = run_git(dir, &["diff", "--cached", "--name-only", "-z"]).unwrap_or_default();
    if staged.contains('\0') || staged.trim() != "" {
        // `-m` keeps the editor out of the picture entirely: no terminal, no prompt, no hang.
        run_git(dir, &["commit", "-q", "-m", message]).map(|_| ())
    } else {
        Err("nothing is staged to commit".into())
    }
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

/// Applies, pops or drops a stash entry addressed by its `stash@{n}` position (0 is the
/// newest). Drop loses the entry for good, pop drops it after a clean apply — both come
/// through a confirm dialog in the app; apply is quiet because git refuses to overwrite
/// conflicting working-tree changes and keeps the entry in that case.
#[tauri::command]
pub async fn stash_action(dir: String, index: u32, action: String) -> Result<(), String> {
    run_blocking("stash action", move || stash_action_in(&dir, index, &action)).await
}

fn stash_action_in(dir: &str, index: u32, action: &str) -> Result<(), String> {
    // The action goes straight into git's CLI and `stash@{n}` lands as a single spawn
    // argument (no shell quoting involved). The index is typed so nothing but a stash
    // position can arrive — a stray branch name or garbage has no way past the u32 — and
    // the verb is whitelisted to the three moves off the stash stack.
    let verb = match action {
        "apply" | "pop" | "drop" => action,
        other => return Err(format!("\"{other}\" is not a stash action")),
    };
    run_git(dir, &["stash", verb, &format!("stash@{{{index}}}")]).map(|_| ())
}

/// Takes the checked-out tip back one commit: `reset --soft HEAD~1` returns the tip's tree
/// to the index, so the work comes back staged and the next refresh re-lands the uncommitted
/// row. Nothing is deleted — the Git Mapper twin of the staging rail's commit. The UI only
/// offers this on the unpushed, non-merge tip; the guards below keep the command honest even
/// when it arrives through a stale or future UI.
#[tauri::command]
pub async fn undo_commit(dir: String) -> Result<(), String> {
    run_blocking("undo commit", move || undo_commit_in(&dir)).await
}

fn undo_commit_in(dir: &str) -> Result<(), String> {
    // `rev-list --parents -1 HEAD` answers both guards in one spawn: the parent count.
    // Zero parents = the root commit (nothing to undo ONTO: deleting history is not this
    // command's business), several = a merge, where `HEAD~1` is first-parent shorthand and
    // a reset there strands the merged branch behind.
    let heads = run_git(dir, &["rev-list", "--parents", "-1", "HEAD"])?;
    let parent_count = heads.split_whitespace().count() - 1;
    if parent_count == 0 {
        return Err("the tip is the repository's root commit — there is nothing to undo onto".into());
    }
    if parent_count > 1 {
        return Err("the tip is a merge commit — its undo is not a soft reset".into());
    }
    run_git(dir, &["reset", "--soft", "HEAD~1"]).map(|_| ())
}

/// Pulls every remote into the local tracking refs (`fetch --all --prune`). Ahead/behind are
/// counts against the tracking refs, so they only tell the whole story after a quiet fetch —
/// the app runs this on open and on window focus (throttled), and tolerates failures offline.
#[tauri::command]
pub async fn fetch_remote(dir: String) -> Result<(), String> {
    run_blocking("fetch", move || fetch_remote_in(&dir)).await
}

fn fetch_remote_in(dir: &str) -> Result<(), String> {
    let remotes = run_git(dir, &["remote"])?;
    if remotes.trim().is_empty() {
        // A repository without remotes has nothing to read; the error would only confuse.
        return Ok(());
    }
    run_git(dir, &["fetch", "--all", "--prune", "--quiet"]).map(|_| ())
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
/// with_patch=false skips the patch reads (the heavy part); read_file_patch fetches one.
#[tauri::command]
pub async fn read_commit_files(dir: String, hash: String, with_patch: bool) -> Result<FilePayload, String> {
    run_blocking("commit files read", move || read_commit_files_in(&dir, &hash, with_patch)).await
}

fn read_commit_files_in(dir: &str, hash: &str, with_patch: bool) -> Result<FilePayload, String> {
    if hash == "wip" {
        // The diff flavours are independent reads; a fourth lists untracked paths, whose
        // numstat / name-status entries are appended right after. Lock-free: run_git_no_locks.
        let mut reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + '_>> = vec![
            Box::new(|| run_git_no_locks(dir, &["diff", "--numstat", "--no-color", "HEAD"])),
            Box::new(|| run_git_no_locks(dir, &["diff", "--name-status", "--no-color", "HEAD"])),
            Box::new(|| {
                if with_patch {
                    run_git_no_locks(dir, &["diff", "--no-color", "HEAD"])
                } else {
                    Ok(String::new())
                }
            }),
            Box::new(|| run_git_no_locks(dir, &["ls-files", "--others", "--exclude-standard", "-z"])),
        ];
        let out = parallel_git(reads);
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
            if with_patch {
                payload.diff.push_str(&patch);
            }
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
        // The heavy read; without with_patch the slot stays empty.
        Box::new(move || {
            if with_patch {
                run_git(dir, &args(&base))
            } else {
                Ok(String::new())
            }
        }),
    ];
    if let Some([s_numstat, s_status, s_diff]) = stash_args.as_deref() {
        reads.push(Box::new(|| run_git(dir, &args(s_numstat))));
        reads.push(Box::new(|| run_git(dir, &args(s_status))));
        reads.push(Box::new(move || {
            if with_patch {
                run_git(dir, &args(s_diff))
            } else {
                Ok(String::new())
            }
        }));
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

/// One file's patch ("wip" = worktree vs HEAD). The lazy tail of read_commit_files.
#[tauri::command]
pub async fn read_file_patch(dir: String, hash: String, path: String) -> Result<String, String> {
    run_blocking("file patch read", move || read_file_patch_in(&dir, &hash, &path)).await
}

fn read_file_patch_in(dir: &str, hash: &str, path: &str) -> Result<String, String> {
    if hash == "wip" {
        let tracked = run_git_no_locks(dir, &["diff", "--no-color", "HEAD", "--", path])
            .unwrap_or_default();
        if !tracked.is_empty() {
            return Ok(tracked);
        }
        let (_, _, patch) = untracked_entry(dir, path);
        return Ok(patch);
    }

    let line = run_git(dir, &["rev-list", "--parents", "-1", hash])?;
    let parents: Vec<String> = line.split_whitespace().skip(1).map(String::from).collect();
    let mut patch = match parents.first() {
        Some(parent) => run_git(dir, &["diff", "--no-color", parent, hash, "--", path])?,
        None => run_git(dir, &["show", "--root", "--format=", "--no-color", hash, "--", path])?,
    };
    if patch.is_empty() && parents.len() >= 3 {
        patch = run_git(dir, &["show", "--no-color", "--format=", &parents[2], "--", path])?;
    }
    Ok(patch)
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

    /// Identity and line-ending settings every fixture needs. A fresh clone carries
    /// its own config, so this runs again right after `git clone`.
    fn set_identity(dir: &Path) {
        git(dir, &["config", "user.name", "Test User"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "core.autocrlf", "false"]);
    }

    impl TempRepo {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("git-mapper-test-{}-{label}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("temp repo created");
            // Pin the branch name: `git init` still defaults to master on some machines
            // (the GitHub ubuntu runner does) and every expectation below names main.
            git(&dir, &["init", "-q", "-b", "main"]);
            set_identity(&dir);
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
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "b\n");
        assert_eq!(git_out(&repo.0, &["stash", "list"]).lines().count(), 1);

        // Pop restores and drops: the list is empty after it.
        std::fs::write(repo.0.join("a.txt"), "a\n").expect("reset");
        stash_action_in(repo.path(), 0, "pop").expect("the pop ran");
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "b\n");
        assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());

        // Drop removes the entry without touching anything else — and because saving a
        // stash resets the worktree to HEAD first, the file is back at the committed text.
        std::fs::write(repo.0.join("a.txt"), "c\n").expect("edit");
        git(&repo.0, &["stash", "-q"]);
        stash_action_in(repo.path(), 0, "drop").expect("the drop ran");
        assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "a\n");

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
        assert_ne!(git_out(&repo.0, &["rev-parse", "HEAD"]), tip, "HEAD moved back");
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
        assert_eq!(std::fs::read_to_string(repo.0.join("b.txt")).expect("file"), "b\n");
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

        let payload = read_commit_files_in(repo.path(), "wip", true).expect("wip payload");
        assert!(payload.name_status.contains("M\ttracked.txt"));
        assert!(payload.numstat.contains("2\t0\tnew.txt"));
        assert!(payload.name_status.contains("A\tnew.txt"), "`git diff` alone never lists untracked paths");
        assert!(payload.diff.contains("+++ b/new.txt"));
        assert!(payload.numstat.contains("-\t-\tblob.bin"));
        assert!(payload.diff.contains("@@ Binary file, not shown @@"), "the panel needs a reason for an empty patch");
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
        assert!(!history.contains("one.txt"), "a single-path read stays single-path: {history}");
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
        assert!(wip_untracked.contains("+++ b/new.txt"), "got: {wip_untracked}");
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
        assert!(root_files.numstat.contains("1\t0\troot.txt"), "got: {}", root_files.numstat);

        let files = read_commit_files_in(repo.path(), &second_hash, true).expect("parent diff");
        assert!(files.name_status.contains("A\tother.txt"));

        // git mv keeps the rename visible.
        git(&repo.0, &["mv", "root.txt", "renamed.txt"]);
        git(&repo.0, &["commit", "-q", "-m", "renamed"]);
        let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
        let renamed_hash = renamed_hash.trim().to_string();
        let renamed = read_commit_files_in(repo.path(), &renamed_hash, true).expect("renamed files");
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
        set_identity(&other);
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

    #[test]
    fn worktree_snapshot_splits_index_and_worktree_states_with_counts() {
        let repo = TempRepo::new("snapshot");
        repo.commit("tracked.txt", "one\n", "c1");

        // Clean tree: nothing to show.
        assert!(read_worktree_files_in(repo.path()).expect("read").entries.is_empty());

        // Worktree-only modification: one unstaged row, counts from the index diff.
        std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\nthree\n").expect("edit");
        std::fs::write(repo.0.join("fresh.txt"), "a\nb\n").expect("untracked file");
        let snap = read_worktree_files_in(repo.path()).expect("read");
        let tracked = snap.entries.iter().find(|e| e.path == "tracked.txt").expect("tracked row");
        assert_eq!((tracked.staged, tracked.status == "modified"), (false, true));
        assert_eq!((tracked.additions, tracked.deletions), (2, 0));
        let fresh = snap.entries.iter().find(|e| e.path == "fresh.txt").expect("fresh row");
        assert_eq!((fresh.staged, fresh.untracked), (false, true));
        assert_eq!((fresh.status == "added", fresh.additions), (true, 2));

        // Stage it: the same path becomes an index copy; `git add` of fresh.txt brings it in too.
        stage_files_in(repo.path(), &["tracked.txt".into(), "fresh.txt".into()]).expect("add");
        let snap = read_worktree_files_in(repo.path()).expect("read");
        let staged: Vec<_> = snap.entries.iter().filter(|e| e.staged).collect();
        assert_eq!(staged.len(), 2, "both paths moved into the index");
        assert_eq!(staged[0].additions, 2, "counts are the staged-vs-HEAD numstat");

        // A staged file edited again on disk appears twice: index copy and the worktree remainder.
        std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\nthree\nfour\n").expect("edit again");
        let snap = read_worktree_files_in(repo.path()).expect("read");
        let rows: Vec<_> = snap.entries.iter().filter(|e| e.path == "tracked.txt").collect();
        assert_eq!(rows.len(), 2, "both copies of a partially staged file are listed");
        assert!(rows.iter().any(|e| e.staged) && rows.iter().any(|e| !e.staged));
        assert_eq!(rows.iter().map(|e| e.key.clone()).collect::<Vec<_>>().len(), 2, "keys stay unique");
    }

    #[test]
    fn staging_writes_commit_unstage_and_walk_renames_back() {
        let repo = TempRepo::new("staging-writes");
        repo.commit("a.txt", "a\n", "c1");

        // Stage a modification and commit it: HEAD moves, worktree is clean.
        std::fs::write(repo.0.join("a.txt"), "b\n").expect("edit");
        stage_files_in(repo.path(), &["a.txt".into()]).expect("add");
        commit_staged_in(repo.path(), "made from the rail").expect("commit");
        assert!(read_worktree_files_in(repo.path()).expect("read").entries.is_empty());
        let log = git_out(&repo.0, &["log", "--format=%s", "-1"]);
        assert_eq!(log.trim(), "made from the rail");

        // Unstage an index-only add: the file stays on disk as untracked.
        std::fs::write(repo.0.join("b.txt"), "staged but uncommitted\n").expect("new file");
        stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
        assert!(read_worktree_files_in(repo.path()).expect("read").entries.iter().any(|e| e.staged));
        unstage_files_in(repo.path(), &["b.txt".into()]).expect("unstage");
        let snap = read_worktree_files_in(repo.path()).expect("read");
        assert!(snap.entries.iter().any(|e| e.path == "b.txt" && e.untracked));
        assert!(!snap.entries.iter().any(|e| e.staged));

        // A staged rename unstage walks the file back to its original name. The rename
        // source must live in HEAD for git to report it as `2 R`; stage + commit first.
        stage_files_in(repo.path(), &["b.txt".into()]).expect("re-add");
        commit_staged_in(repo.path(), "add b.txt").expect("commit b");
        git(&repo.0, &["mv", "b.txt", "moved.txt"]);
        unstage_files_in(repo.path(), &["moved.txt".into()]).expect("rename unstage");
        assert!(repo.0.join("b.txt").exists(), "the file is back at its original name");
        assert!(!repo.0.join("moved.txt").exists(), "the rename destination is gone");
        let snap = read_worktree_files_in(repo.path()).expect("read");
        assert!(snap.entries.is_empty(), "the unstage leaves a clean state: {:?}", snap.entries);
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
            &["a.txt".into(), "sub/nested/deep.txt".into(), "tossed.txt".into()],
        )
        .expect("discard");
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "a\n");
        assert_eq!(
            std::fs::read_to_string(repo.0.join("sub/nested/deep.txt")).expect("file"),
            "deep\n",
            "nested paths restore too — HEAD's tree is read recursively, not top-level only"
        );
        assert!(!repo.0.join("tossed.txt").exists(), "untracked files are removed from disk");

        // An index-only add is unstaged, NOT deleted: the content survives as untracked.
        std::fs::write(repo.0.join("b.txt"), "precious\n").expect("new file");
        stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
        discard_files_in(repo.path(), &["b.txt".into()]).expect("discard");
        let listing: Vec<_> = std::fs::read_dir(&repo.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(repo.0.join("b.txt").exists(), "the staged-only add is not wiped from disk");

        // Discard-all: every tracked change resets and untracked paths (with dirs) disappear.
        std::fs::write(repo.0.join("a.txt"), "dirty\n").expect("edit");
        std::fs::create_dir(repo.0.join("untracked-dir")).expect("dir");
        std::fs::write(repo.0.join("untracked-dir/x.txt"), "x\n").expect("nested");
        discard_all_in(repo.path()).expect("discard all");
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "a\n");
        assert!(!repo.0.join("untracked-dir").exists(), "clean -fd removes untracked dirs");
        assert!(!repo.0.join("b.txt").exists(), "b.txt stayed untracked after its unstage, so it goes");
        assert!(read_worktree_files_in(repo.path()).expect("read").entries.is_empty());
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
        assert!(snap.entries.iter().any(|e| e.path == "one.txt" && e.status == "modified"));
        assert!(snap.entries.iter().any(|e| e.path == "two.txt" && e.status == "modified"));
        // The commit only carried the staged copy.
        let head = git_out(&repo.0, &["show", "HEAD:one.txt"]);
        assert_eq!(head.trim(), "one edit");
    }
}
