use base64::Engine as _;
use serde::Serialize;

use std::path::Path;

use super::*;

#[derive(Serialize)]
pub struct FilePayload {
    pub numstat: String,
    pub name_status: String,
    /// Empty when with_patch is false; per-file patches come from read_file_patch.
    pub diff: String,
}

/// Untracked files never appear in `git diff HEAD`, so the working-tree view builds their
/// numstat / name-status / patch entries itself, shaped the way git prints a new file.
pub fn untracked_entry(dir: &str, path: &str) -> (String, String, String) {
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

pub fn read_commit_files_in(
    dir: &str,
    hash: &str,
    with_patch: bool,
) -> Result<FilePayload, String> {
    if hash == "wip" {
        // The diff flavours are independent reads; a fourth lists untracked paths, whose
        // numstat / name-status entries are appended right after. Lock-free: run_git_no_locks.
        let reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + '_>> = vec![
            Box::new(|| run_git_no_locks(dir, &["diff", "--numstat", "--no-color", "HEAD"])),
            Box::new(|| run_git_no_locks(dir, &["diff", "--name-status", "--no-color", "HEAD"])),
            Box::new(|| {
                if with_patch {
                    run_git_no_locks(dir, &["diff", "--no-color", "HEAD"])
                } else {
                    Ok(String::new())
                }
            }),
            Box::new(|| {
                run_git_no_locks(dir, &["ls-files", "--others", "--exclude-standard", "-z"])
            }),
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
    let parents: Vec<String> = line.split_whitespace().skip(1).map(String::from).collect();
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
        vec![
            extra(Some("--numstat")),
            extra(Some("--name-status")),
            extra(None),
        ]
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

pub fn read_file_patch_in(dir: &str, hash: &str, path: &str) -> Result<String, String> {
    if hash == "wip" {
        let tracked =
            run_git_no_locks(dir, &["diff", "--no-color", "HEAD", "--", path]).unwrap_or_default();
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
        None => run_git(
            dir,
            &[
                "show",
                "--root",
                "--format=",
                "--no-color",
                hash,
                "--",
                path,
            ],
        )?,
    };
    if patch.is_empty() && parents.len() >= 3 {
        patch = run_git(
            dir,
            &["show", "--no-color", "--format=", &parents[2], "--", path],
        )?;
    }
    Ok(patch)
}

pub fn args(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// Git output that must stay bytes (a blob) instead of the lossy-text run_git.
pub fn run_git_bytes(dir: &str, args: &[&str]) -> Result<Vec<u8>, String> {
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
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

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

pub const IMAGE_MIME_BY_EXT: &[(&str, &str)] = &[
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

pub fn image_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    IMAGE_MIME_BY_EXT
        .iter()
        .find(|(name, _)| *name == ext)
        .map(|(_, mime)| *mime)
        .unwrap_or("application/octet-stream")
}

/// The blob bytes at `<rev>:<path>`, or None when that path does not exist there (added/deleted).
pub fn blob_bytes(dir: &str, rev: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
    run_git_bytes(dir, &["cat-file", "blob", &format!("{rev}:{path}")])
        .map(Some)
        .or_else(|_| Ok(None))
}

/// A renamed (R) or copied (C) entry in the parent→commit patch whose destination is `path`;
/// its source path is where the old image lives. Missing when the file simply moved untouched.
pub fn rename_source(dir: &str, parent: &str, hash: &str, path: &str) -> Option<String> {
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

pub fn version_of(bytes: Vec<u8>, path: &str) -> ImageVersion {
    if bytes.len() > MAX_IMAGE_BYTES {
        return ImageVersion {
            url: String::new(),
            bytes: bytes.len(),
            too_large: true,
        };
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

pub fn read_image_versions_in(dir: &str, hash: &str, path: &str) -> Result<ImageVersions, String> {
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
        std::fs::read(Path::new(dir).join(path))
            .ok()
            .map(|data| version_of(data, path))
    } else {
        blob_bytes(dir, hash, path)?.map(|data| version_of(data, path))
    };

    Ok(ImageVersions { old, new })
}
