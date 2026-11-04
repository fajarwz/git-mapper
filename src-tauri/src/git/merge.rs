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
}

/// Both sides as patches against the shared base: `:1:<path> -> :2/<3>:<path>` — each runs
/// beside the other, and a missing stage (delete/modify pairs) yields an empty patch that
/// the panel renders as an absent side. `git diff -- <path>` would answer in git's
/// combined `--cc` shape, which no parser in this app speaks.
pub fn read_conflict_files_in(dir: &str, path: &str) -> Result<ConflictSnapshot, String> {
    let (base, ours, theirs) = stage_presence(dir, path);
    let blob = |stage: u8| -> String { format!(":{stage}:{path}") };
    let stage_diff = |from: bool, to: bool, from_n: u8, to_n: u8| -> Result<String, String> {
        if !from || !to {
            return Ok(String::new());
        }
        run_git(dir, &["diff", "--no-color", &blob(from_n), &blob(to_n)])
    };
    let reads = parallel_git(vec![
        Box::new(|| stage_diff(base, ours, 1, 2)),
        Box::new(|| stage_diff(base, theirs, 1, 3)),
    ]);
    Ok(ConflictSnapshot {
        ours_patch: reads
            .first()
            .cloned()
            .unwrap_or_else(|| Err("no read returned".into()))?,
        theirs_patch: reads
            .get(1)
            .cloned()
            .unwrap_or_else(|| Err("no read returned".into()))?,
    })
}
