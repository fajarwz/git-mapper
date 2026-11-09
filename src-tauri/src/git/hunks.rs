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

/// Cuts a hunk down to the chosen changed lines. `selected` counts only `+`/`-` lines (0-based,
/// in hunk order). A skipped line must read as untouched in the file the patch lands on: forward
/// that is the old text (skipped `+` vanishes, skipped `-` becomes context); reversed it is the
/// new text (skipped `+` becomes context, skipped `-` vanishes). `--recount` fixes the header.
fn trim_hunk(hunk: &[u8], selected: &[usize], reverse: bool) -> Result<Vec<u8>, String> {
    let mut lines = hunk.split_inclusive(|byte| *byte == b'\n');
    let mut out = lines.next().map(<[u8]>::to_vec).unwrap_or_default();
    let mut ordinal = 0;
    let mut kept_prev = true;
    for line in lines {
        match line.first() {
            Some(b'+') | Some(b'-') => {
                let is_add = line[0] == b'+';
                let chosen = selected.contains(&ordinal);
                ordinal += 1;
                if chosen {
                    out.extend_from_slice(line);
                    kept_prev = true;
                } else if is_add == reverse {
                    out.push(b' ');
                    out.extend_from_slice(&line[1..]);
                    kept_prev = true;
                } else {
                    kept_prev = false;
                }
            }
            // "\ No newline at end of file" belongs to the line above it.
            Some(b'\\') => {
                if kept_prev {
                    out.extend_from_slice(line);
                }
            }
            _ => {
                out.extend_from_slice(line);
                kept_prev = true;
            }
        }
    }
    if selected.is_empty() || selected.iter().any(|n| *n >= ordinal) {
        return Err("select at least one changed line of this hunk".into());
    }
    Ok(out)
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
    apply_selection_in(dir, path, side, hunk_index, hunk_header, action, None)
}

/// Same verbs on chosen lines of one hunk. Files that appear or vanish are refused: their patch
/// header says create/delete, which a partial selection no longer is — the hunk buttons cover them.
pub fn apply_hunk_lines_in(
    dir: &str,
    path: &str,
    side: &str,
    hunk_index: usize,
    hunk_header: &str,
    action: &str,
    lines: &[usize],
) -> Result<(), String> {
    apply_selection_in(dir, path, side, hunk_index, hunk_header, action, Some(lines))
}

fn apply_selection_in(
    dir: &str,
    path: &str,
    side: &str,
    hunk_index: usize,
    hunk_header: &str,
    action: &str,
    lines: Option<&[usize]>,
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
            if lines.is_some() {
                return Err("a new file has no lines to pick from yet — stage the hunk instead".into());
            }
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
    match lines {
        None => patch.extend_from_slice(hunk),
        Some(selected) => {
            let creates_or_deletes = patch
                .split(|byte| *byte == b'\n')
                .any(|l| l.starts_with(b"new file mode") || l.starts_with(b"deleted file mode"));
            if creates_or_deletes {
                return Err("lines can only be picked in a file that exists on both sides — use the hunk buttons".into());
            }
            patch.extend_from_slice(&trim_hunk(hunk, selected, flags.contains(&"--reverse"))?);
        }
    }
    git_apply(dir, flags, &patch)
}
