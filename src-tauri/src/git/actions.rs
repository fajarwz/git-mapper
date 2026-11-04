use super::shell::run_git;
pub fn checkout_branch_in(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
}

/// Detaches HEAD onto a commit. The app asks first — the dialog warns that new commits made
/// on a detached HEAD are lost unless a branch is created — so this never runs unconfirmed.

pub fn checkout_commit_in(dir: &str, hash: &str) -> Result<(), String> {
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

pub fn stash_action_in(dir: &str, index: u32, action: &str) -> Result<(), String> {
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

pub fn fetch_remote_in(dir: &str) -> Result<(), String> {
    let remotes = run_git(dir, &["remote"])?;
    if remotes.trim().is_empty() {
        // A repository without remotes has nothing to read; the error would only confuse.
        return Ok(());
    }
    run_git(dir, &["fetch", "--all", "--prune", "--quiet"]).map(|_| ())
}
