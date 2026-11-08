mod actions;
mod files;
mod log;
mod merge;
mod shell;
mod staging;
mod status;
#[cfg(test)]
mod tests;

pub use actions::*;
pub use files::*;
pub use log::*;
pub use merge::*;
pub use shell::*;
pub use staging::*;
pub use status::*;

#[tauri::command]
pub async fn open_repository(dir: String) -> Result<RepoInfo, String> {
    run_blocking("open", move || open_repository_in(&dir)).await
}
#[tauri::command]
pub async fn read_status(dir: String) -> Result<StatusInfo, String> {
    run_blocking("status read", move || read_status_in(&dir)).await
}
#[tauri::command]
pub async fn stage_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("stage", move || stage_files_in(&dir, &paths)).await
}
#[tauri::command]
pub async fn unstage_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("unstage", move || unstage_files_in(&dir, &paths)).await
}
#[tauri::command]
pub async fn discard_files(dir: String, paths: Vec<String>) -> Result<(), String> {
    run_blocking("discard", move || discard_files_in(&dir, &paths)).await
}
#[tauri::command]
pub async fn discard_all(dir: String) -> Result<(), String> {
    run_blocking("discard all", move || discard_all_in(&dir)).await
}
#[tauri::command]
pub async fn commit_staged(dir: String, message: String) -> Result<(), String> {
    run_blocking("commit", move || commit_staged_in(&dir, &message)).await
}
/// Raw log for TS-side parsing: fields split on \x00, records on \x1e.
/// Decorations (%d) lead each record; %B is last so multi-line bodies survive the split.
#[tauri::command]
pub async fn read_log(dir: String, limit: u32, skip: u32) -> Result<String, String> {
    run_blocking("log read", move || read_log_in(&dir, limit, skip)).await
}
/// Commits reachable from any ref but not from `since`: the delta a focus refresh needs,
/// so the UI never re-reads the whole history for one new commit.
#[tauri::command]
pub async fn read_log_delta(dir: String, since: String, limit: u32) -> Result<String, String> {
    run_blocking("log delta", move || read_log_delta_in(&dir, &since, limit)).await
}
/// Commit hashes in the exact order `read_log` returns them. A refresh fetches only the new
/// commits, so it needs this cheap list to splice them in where git would put them: someone
/// else's older commit can land below rows that are already on screen.
#[tauri::command]
pub async fn read_log_order(dir: String, limit: u32) -> Result<String, String> {
    run_blocking("log order", move || read_log_order_in(&dir, limit)).await
}
/// All branch/remote/tag tips: raw `hash\tfullref` lines for TS-side parsing.
/// Decorations on log rows miss tips that point outside the loaded window.
#[tauri::command]
pub async fn read_refs(dir: String) -> Result<String, String> {
    run_blocking("refs read", move || read_refs_in(&dir)).await
}
/// Stash entries, newest first. Only `refs/stash` is a real ref and it points at the newest
/// entry, so for-each-ref and `log --all` can never see the older ones: the reflog is the only
/// place the full list exists. Same record/field separators as read_log.
#[tauri::command]
pub async fn read_stashes(dir: String) -> Result<String, String> {
    run_blocking("stash read", move || read_stashes_in(&dir)).await
}
/// Checks out an existing branch by name; refuses with git's own error when the
/// working tree would lose changes (dirty tree with conflicting paths).
#[tauri::command]
pub async fn checkout_branch(dir: String, branch: String) -> Result<(), String> {
    run_blocking("checkout", move || checkout_branch_in(&dir, &branch)).await
}
/// Detaches HEAD onto a commit. The app asks first — the dialog warns that new commits made
/// on a detached HEAD are lost unless a branch is created — so this never runs unconfirmed.
#[tauri::command]
pub async fn checkout_commit(dir: String, hash: String) -> Result<(), String> {
    run_blocking("checkout", move || checkout_commit_in(&dir, &hash)).await
}
/// Applies, pops or drops a stash entry addressed by its `stash@{n}` position (0 is the
/// newest). Drop loses the entry for good, pop drops it after a clean apply — both come
/// through a confirm dialog in the app; apply is quiet because git refuses to overwrite
/// conflicting working-tree changes and keeps the entry in that case.
#[tauri::command]
pub async fn stash_action(dir: String, index: u32, action: String) -> Result<(), String> {
    run_blocking("stash action", move || {
        stash_action_in(&dir, index, &action)
    })
    .await
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
/// Pulls every remote into the local tracking refs (`fetch --all --prune`). Ahead/behind are
/// counts against the tracking refs, so they only tell the whole story after a quiet fetch —
/// the app runs this on open and on window focus (throttled), and tolerates failures offline.
#[tauri::command]
pub async fn fetch_remote(dir: String) -> Result<(), String> {
    run_blocking("fetch", move || fetch_remote_in(&dir)).await
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

/// Merges a branch into the checked-out one. Conflicts do not fail the command — the
/// outcome names them and the staging rail takes over with the resolve/abort/complete
/// verbs. `run_blocking` because merge can walk the whole worktree on slow mounts.
#[tauri::command]
pub async fn merge_branch(dir: String, target: String) -> Result<MergeOutcome, String> {
    run_blocking("merge", move || merge_branch_in(&dir, &target)).await
}
/// Chooses one side of each unmerged path from the index stages and stages it.
#[tauri::command]
pub async fn resolve_conflicts(dir: String, paths: Vec<String>, side: String) -> Result<(), String> {
    run_blocking("resolve conflicts", move || {
        resolve_conflicts_in(&dir, &paths, &side)
    })
    .await
}
/// Discards the merge entirely: back to the pre-merge branch tip, behind a danger confirm.
#[tauri::command]
pub async fn abort_merge(dir: String) -> Result<(), String> {
    run_blocking("merge abort", move || abort_merge_in(&dir)).await
}
/// Commits the resolved merge with git's own prepared message; refuses paths unresolved.
#[tauri::command]
pub async fn complete_merge(dir: String) -> Result<(), String> {
    run_blocking("merge complete", move || complete_merge_in(&dir)).await
}
/// Saves a hand-resolved conflicted file; staged once no conflict marker is left in it.
#[tauri::command]
pub async fn write_conflict_resolution(
    dir: String,
    path: String,
    content: String,
) -> Result<(), String> {
    run_blocking("conflict write", move || {
        write_conflict_resolution_in(&dir, &path, &content)
    })
    .await
}
/// Both conflict sides of one path, patched against the shared base; missing stage = empty.
#[tauri::command]
pub async fn read_conflict_files(dir: String, path: String) -> Result<ConflictSnapshot, String> {
    run_blocking("conflict read", move || read_conflict_files_in(&dir, &path)).await
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

/// Files of one commit. "wip" means the uncommitted working tree vs HEAD.
/// Otherwise: diff against the first parent; root commits use the --root forms.
/// with_patch=false skips the patch reads (the heavy part); read_file_patch fetches one.
#[tauri::command]
pub async fn read_commit_files(
    dir: String,
    hash: String,
    with_patch: bool,
) -> Result<FilePayload, String> {
    run_blocking("commit files read", move || {
        read_commit_files_in(&dir, &hash, with_patch)
    })
    .await
}

/// One file's patch ("wip" = worktree vs HEAD). The lazy tail of read_commit_files.
#[tauri::command]
pub async fn read_file_patch(dir: String, hash: String, path: String) -> Result<String, String> {
    run_blocking("file patch read", move || {
        read_file_patch_in(&dir, &hash, &path)
    })
    .await
}
