use serde::Serialize;
use std::path::{Path, PathBuf};

use super::*;

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

/// Cheap FNV-1a digest: these stamps are only ever compared for equality between two reads,
/// so a short, stable hash is enough — no crypto, no git plumbing call.
pub fn digest(text: &str) -> String {
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
pub fn worktree_stamp(
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

pub fn open_repository_in(dir: &str) -> Result<RepoInfo, String> {
    let inside = run_git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    if inside.trim() != "true" {
        return Err(format!("{} is not a Git repository", dir));
    }
    let path = run_git(dir, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    // Git prints Windows paths with forward slashes from MSYS builds
    // (C:/Users/you/repo); keep that form so path comparisons stay consistent.
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(RepoInfo { path, name })
}

pub fn read_status_in(dir: &str) -> Result<StatusInfo, String> {
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
        let worktree = worktree_stamp(dir, &out, changed, || tracked_patch.join().ok().flatten());
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

pub fn status_kind(letter: char) -> &'static str {
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
pub fn for_each_status_v2(raw: &str, mut visit: impl FnMut(char, char, String, Option<String>)) {
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
pub fn numstat_map(raw: &str) -> std::collections::HashMap<String, (u32, u32)> {
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
pub fn counts_for(
    map: &std::collections::HashMap<String, (u32, u32)>,
    path: &str,
    old: Option<&str>,
) -> (u32, u32) {
    if let Some(counts) = map.get(path) {
        return *counts;
    }
    let _ = old;
    (0, 0)
}

/// Line count of an untracked file: what the wip view pretends a new file's numstat is. Binary
/// (or unreadable) files show as an uncounted addition rather than guessing at lines.
pub fn untracked_counts(dir: &str, path: &str) -> (u32, u32) {
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

pub fn read_worktree_files_in(dir: &str) -> Result<WorktreeSnapshot, String> {
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
