use std::io::Write;
use std::process::Stdio;

use super::*;

/// Files of one side of the uncommitted changes, patches included (a side is small and the
/// pane reads it whole). The unstaged side also lists untracked files, shaped like new files.
pub fn read_wip_side_in(dir: &str, side: &str) -> Result<FilePayload, String> {
    let staged = match side {
        "staged" => true,
        "unstaged" => false,
        other => return Err(format!("unknown side: {other}")),
    };
    let flavour = |flag: &'static str| -> Vec<&'static str> {
        let mut args = vec!["diff", flag, "--no-color"];
        if staged {
            args.push("--cached");
        }
        args
    };
    let numstat = flavour("--numstat");
    let name_status = flavour("--name-status");
    let patch = flavour("-U3");
    let reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + '_>> = vec![
        Box::new(|| run_git_no_locks(dir, &numstat)),
        Box::new(|| run_git_no_locks(dir, &name_status)),
        Box::new(|| run_git_no_locks(dir, &patch)),
        Box::new(|| {
            if staged {
                Ok(String::new())
            } else {
                run_git_no_locks(dir, &["ls-files", "--others", "--exclude-standard", "-z"])
            }
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
        payload.diff.push_str(&patch);
    }
    Ok(payload)
}

/// Splits a one-file diff into its header (up to the first `@@`) and its hunks. Content lines
/// start with ' ', '+', '-' or '\', so a line opening with "@@ " is always a hunk header.
fn split_hunks(diff: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
    let mut header = Vec::new();
    let mut hunks: Vec<Vec<u8>> = Vec::new();
    for line in diff.split_inclusive(|byte| *byte == b'\n') {
        if line.starts_with(b"@@ ") {
            hunks.push(Vec::new());
        }
        match hunks.last_mut() {
            Some(hunk) => hunk.extend_from_slice(line),
            None => header.extend_from_slice(line),
        }
    }
    (header, hunks)
}

fn first_line(hunk: &[u8]) -> String {
    let end = hunk.iter().position(|byte| *byte == b'\n').unwrap_or(hunk.len());
    String::from_utf8_lossy(&hunk[..end]).trim_end_matches('\r').to_string()
}

fn git_apply(dir: &str, flags: &[&str], patch: &[u8]) -> Result<(), String> {
    let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
    args.extend_from_slice(flags);
    args.push("-");
    let mut child = git_command(dir)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("git apply took no input")?
        .write_all(patch)
        .map_err(|e| format!("could not hand the hunk to git: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("git apply failed: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// `stage` / `discard` act on a hunk of the unstaged diff, `unstage` on one of the staged diff.
/// Everything is rebuilt from a fresh diff: the index and the disk decide, never what the UI saw.
pub fn apply_hunk_in(
    dir: &str,
    path: &str,
    side: &str,
    hunk_index: usize,
    hunk_header: &str,
    action: &str,
) -> Result<(), String> {
    let (staged, flags): (bool, &[&str]) = match (action, side) {
        ("stage", "unstaged") => (false, &["--cached"]),
        ("discard", "unstaged") => (false, &["--reverse"]),
        ("unstage", "staged") => (true, &["--cached", "--reverse"]),
        _ => return Err(format!("cannot {action} a hunk of the {side} diff")),
    };

    // An untracked file has no index copy to diff against; it is one all-added hunk, so the
    // whole-file verbs are exactly the hunk verbs.
    if !staged {
        let untracked =
            run_git_no_locks(dir, &["ls-files", "--others", "--exclude-standard", "--", path])?;
        if !untracked.trim().is_empty() {
            let paths = [path.to_string()];
            return match action {
                "stage" => stage_files_in(dir, &paths),
                _ => discard_files_in(dir, &paths),
            };
        }
    }

    let mut args = vec!["diff", "--no-color", "--no-renames", "-U3"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    let diff = run_git_bytes(dir, &args)?;
    let (header, hunks) = split_hunks(&diff);
    let Some(hunk) = hunks.get(hunk_index) else {
        return Err("that hunk is gone — the file changed, refresh and try again".into());
    };
    if first_line(hunk) != hunk_header.trim_end_matches('\r') {
        return Err("that hunk changed since it was shown — refresh and try again".into());
    }
    let mut patch = header;
    patch.extend_from_slice(hunk);
    git_apply(dir, flags, &patch)
}
