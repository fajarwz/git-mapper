use serde::Serialize;

use super::*;

/// Stage presence per conflict side, from `git ls-files -s -u`: (base, ours, theirs).
pub fn stage_presence(dir: &str, path: &str) -> (bool, bool, bool) {
    let raw = run_git(dir, &["ls-files", "-s", "-u", "--", path]).unwrap_or_default();
    let mut seen = [false, false, false];
    for line in raw.lines() {
        if let Some((meta, _)) = line.split_once('\t') {
            if let Some(n) = meta.split_whitespace().nth(2) {
                if let Ok(stage) = n.parse::<usize>() {
                    if (1..=3).contains(&stage) {
                        seen[stage - 1] = true;
                    }
                }
            }
        }
    }
    (seen[0], seen[1], seen[2])
}

#[derive(Serialize)]
pub struct MergeOutcome {
    pub merged: bool,
    pub conflicts: Vec<String>,
}

/// Merges a ref into the current branch. A clean merge lands with git's own message; a
/// conflicted one reports its unmerged paths instead of failing — the rail offers the
/// sides, abort and complete from that list. A wrong ref is still an error.
pub fn merge_branch_in(dir: &str, target: &str) -> Result<MergeOutcome, String> {
    if target.trim().is_empty() {
        return Err("the merge target is empty".into());
    }
    match run_git(dir, &["merge", "-q", "--no-edit", "--", target]) {
        Ok(_) => Ok(MergeOutcome {
            merged: true,
            conflicts: Vec::new(),
        }),
        Err(msg) => {
            let status = run_git(dir, &["status", "-sb"])?;
            let conflicts = unmerged_paths_of(&status);
            if conflicts.is_empty() {
                Err(msg)
            } else {
                Ok(MergeOutcome {
                    merged: false,
                    conflicts,
                })
            }
        }
    }
}

/// Resolves each path by taking one side's index stage, then staging it. Taking a side
/// whose stage is absent (a delete/modify pair) resolves as that deletion: the file goes.
pub fn resolve_conflicts_in(dir: &str, paths: &[String], side: &str) -> Result<(), String> {
    if side != "ours" && side != "theirs" {
        return Err(format!("{side} is not a side of a conflict"));
    }
    if paths.is_empty() {
        return Err("no path is selected".into());
    }
    for path in paths {
        let (base, ours, theirs) = stage_presence(dir, path);
        if !base && !ours && !theirs {
            return Err(format!("{path} is not conflicted"));
        }
        let our_side = side == "ours";
        let has_stage = if our_side { ours } else { theirs };
        if has_stage {
            let flag = if our_side { "--ours" } else { "--theirs" };
            run_git(dir, &["checkout", "-q", flag, "--", path]).map(|_| ())?;
            run_git(dir, &["add", "--", path]).map(|_| ())?;
        } else {
            run_git(dir, &["rm", "-q", "-f", "--", path]).map(|_| ())?;
        }
    }
    Ok(())
}

/// True while `MERGE_HEAD` exists — the only state abort/complete may act on.
fn merging(dir: &str) -> bool {
    run_git(dir, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
}

pub fn abort_merge_in(dir: &str) -> Result<(), String> {
    if !merging(dir) {
        return Err("not in a merge — nothing to abort".into());
    }
    run_git(dir, &["merge", "--abort"]).map(|_| ())
}

pub fn complete_merge_in(dir: &str) -> Result<(), String> {
    if !merging(dir) {
        return Err("not in a merge — nothing to complete".into());
    }
    if let Some(path) = unmerged_paths_of(&run_git(dir, &["status", "-sb"])?).first() {
        return Err(format!("{path} is still unresolved — take a side or stage it first"));
    }
    run_git(dir, &["commit", "--no-edit", "-q"]).map(|_| ())
}

#[derive(Serialize)]
pub struct ConflictSnapshot {
    pub ours_patch: String,
    pub theirs_patch: String,
    /// The file as it sits on disk, conflict markers included; empty when unreadable or binary.
    pub worktree_text: String,
    /// What the user merged in: the branch from git's own merge message, else a short hash.
    pub incoming: String,
}

/// The branch being merged, named the way `git merge` was told: `Merge branch 'x'` and
/// `Merge remote-tracking branch 'x'` in MERGE_MSG; a bare commit falls back to its short hash.
fn incoming_name(dir: &str) -> String {
    let from_message = run_git(dir, &["rev-parse", "--git-path", "MERGE_MSG"])
        .ok()
        .and_then(|rel| std::fs::read_to_string(std::path::Path::new(dir).join(rel.trim())).ok())
        .and_then(|msg| {
            let first = msg.lines().next()?.to_string();
            let start = first.find('\'')? + 1;
            let len = first[start..].find('\'')?;
            Some(first[start..start + len].to_string())
        });
    from_message
        .or_else(|| {
            run_git(dir, &["rev-parse", "--short", "MERGE_HEAD"])
                .ok()
                .map(|hash| hash.trim().to_string())
        })
        .unwrap_or_default()
}

fn has_conflict_markers(text: &str) -> bool {
    text.lines()
        .any(|line| line.starts_with("<<<<<<<") || line.starts_with(">>>>>>>"))
}

/// Writes the user's block-by-block resolution into a conflicted file. Once no marker line is
/// left the file is staged, which is what marks the path resolved; until then it stays unmerged.
pub fn write_conflict_resolution_in(dir: &str, path: &str, content: &str) -> Result<(), String> {
    let status = run_git(dir, &["status", "-sb"])?;
    if !unmerged_paths_of(&status).iter().any(|p| p == path) {
        return Err(format!("{path} is not conflicted"));
    }
    std::fs::write(std::path::Path::new(dir).join(path), content)
        .map_err(|e| format!("could not write {path}: {e}"))?;
    if !has_conflict_markers(content) {
        run_git(dir, &["add", "--", path])?;
    }
    Ok(())
}

/// A file added on both sides has no base stage, so git prints no patch for either side; the
/// panel still needs one, so the content is wrapped in the same unified shape
/// `parseDiffSections` reads (every line added, against /dev/null).
fn added_patch(path: &str, body: &str) -> String {
    let content = body.strip_suffix('\n').unwrap_or(body);
    let lines: Vec<&str> = if content.is_empty() {
        Vec::new()
    } else {
        content.split('\n').map(|l| l.trim_end_matches('\r')).collect()
    };
    let mut out = format!(
        "diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{} @@\n",
        lines.len()
    );
    for line in lines {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Each side as a patch against the shared base (`:1:<path> -> :2/<3>:<path>`), plus the file
/// on disk, where git left its conflict markers. A side with no index stage (delete/modify
/// pairs) yields an empty patch — the panel reads that as "that side deleted it"; a side with
/// no *base* stage (add/add) yields a synthesized addition.
pub fn read_conflict_files_in(dir: &str, path: &str) -> Result<ConflictSnapshot, String> {
    let (base, ours, theirs) = stage_presence(dir, path);
    let blob = |stage: u8| -> String { format!(":{stage}:{path}") };
    let side_patch = |stage: u8, present: bool| -> Result<String, String> {
        if !present {
            return Ok(String::new());
        }
        if base {
            run_git(dir, &["diff", "--no-color", &blob(1), &blob(stage)])
        } else {
            Ok(added_patch(path, &run_git(dir, &["show", &blob(stage)])?))
        }
    };
    let reads = parallel_git(vec![
        Box::new(|| side_patch(2, ours)),
        Box::new(|| side_patch(3, theirs)),
        Box::new(|| {
            if !(base || ours || theirs) {
                return Ok(String::new());
            }
            let file = std::path::Path::new(dir).join(path);
            Ok(std::fs::read_to_string(file).unwrap_or_default())
        }),
    ]);
    let mut reads = reads.into_iter();
    let mut next_read = || reads.next().unwrap_or_else(|| Err("no read returned".into()));
    Ok(ConflictSnapshot {
        ours_patch: next_read()?,
        theirs_patch: next_read()?,
        worktree_text: next_read()?,
        incoming: incoming_name(dir),
    })
}
