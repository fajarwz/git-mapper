use super::shell::{run_git, run_git_no_prompt};
use serde::{Deserialize, Serialize};

fn require_commit_hash(hash: &str) -> Result<(), String> {
    if hash.len() < 4 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("\"{hash}\" is not a commit hash"));
    }
    Ok(())
}

pub fn checkout_branch_in(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteCheckoutMode {
    Create,
    Existing,
}

pub fn local_branch_exists_in(dir: &str, name: &str) -> Result<bool, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(false);
    }
    Ok(run_git(dir, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_ok())
}

// A remote name may itself hold a slash, so the longest configured remote that prefixes the ref wins.
fn split_remote_ref(dir: &str, remote_ref: &str) -> Result<(String, String), String> {
    let remotes = run_git(dir, &["remote"])?;
    remotes
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .filter_map(|remote| {
            remote_ref
                .strip_prefix(remote)
                .and_then(|rest| rest.strip_prefix('/'))
                .filter(|branch| !branch.is_empty())
                .map(|branch| (remote.to_string(), branch.to_string()))
        })
        .max_by_key(|(remote, _)| remote.len())
        .ok_or_else(|| format!("\"{remote_ref}\" is not a remote branch"))
}

// A diverged `Existing` branch stays checked out and the pull's error comes back: never merge unasked.
pub fn checkout_remote_branch_in(
    dir: &str,
    remote_ref: &str,
    local_name: &str,
    mode: RemoteCheckoutMode,
) -> Result<(), String> {
    let remote_ref = remote_ref.trim();
    let local_name = local_name.trim();
    run_git(dir, &["show-ref", "--verify", "--quiet", &format!("refs/remotes/{remote_ref}")])
        .map_err(|_| format!("\"{remote_ref}\" is not a remote branch"))?;
    run_git(dir, &["check-ref-format", "--branch", local_name])
        .map_err(|_| format!("\"{local_name}\" is not a valid branch name"))?;
    let exists = local_branch_exists_in(dir, local_name)?;
    match mode {
        RemoteCheckoutMode::Create => {
            if exists {
                return Err(format!("A branch named \"{local_name}\" already exists"));
            }
            run_git(dir, &["checkout", "-b", local_name, "--track", remote_ref]).map(|_| ())
        }
        RemoteCheckoutMode::Existing => {
            if !exists {
                return Err(format!("There is no local branch named \"{local_name}\""));
            }
            let (remote, branch) = split_remote_ref(dir, remote_ref)?;
            run_git(dir, &["checkout", local_name])?;
            run_git_no_prompt(dir, &["pull", "--ff-only", "--no-edit", &remote, &branch])
                .map(|_| ())
                .map_err(|pull_error| {
                    format!("Checked out {local_name}, but it could not be pulled: {pull_error}")
                })
        }
    }
}

/// Detaches HEAD onto a commit. The app asks first — the dialog warns that new commits made
/// on a detached HEAD are lost unless a branch is created — so this never runs unconfirmed.

pub fn checkout_commit_in(dir: &str, hash: &str) -> Result<(), String> {
    let hash = hash.trim();
    // The arg goes straight into git's CLI: only an abbreviated/full hex hash is accepted, so
    // a branch name or any other string can never turn this into something else. A short hash
    // that matches nothing comes back as git's "does not exist" error, which the toast shows.
    require_commit_hash(hash)?;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeleteOutcome {
    Deleted,
    NotMerged,
}

pub fn create_branch_in(dir: &str, name: &str, hash: &str, checkout: bool) -> Result<(), String> {
    let name = name.trim();
    let hash = hash.trim();
    require_commit_hash(hash)?;
    run_git(dir, &["check-ref-format", "--branch", name])
        .map_err(|_| format!("\"{name}\" is not a valid branch name"))?;
    if local_branch_exists_in(dir, name)? {
        return Err(format!("A branch named \"{name}\" already exists"));
    }
    if checkout {
        run_git(dir, &["checkout", "-b", name, hash]).map(|_| ())
    } else {
        run_git(dir, &["branch", name, hash]).map(|_| ())
    }
}

// `git branch -d` words its refusal differently per locale, so merged-ness is decided here
// with plain ancestry: into HEAD or into the branch's own upstream, the two cases `-d` accepts.
fn branch_is_merged(dir: &str, name: &str) -> bool {
    let branch = format!("refs/heads/{name}");
    run_git(dir, &["merge-base", "--is-ancestor", &branch, "HEAD"]).is_ok()
        || run_git(
            dir,
            &["merge-base", "--is-ancestor", &branch, &format!("{branch}@{{upstream}}")],
        )
        .is_ok()
}

/// Deletes a local branch, or (`remote`) a remote one by its `origin/x` name via `push --delete`.
/// An unmerged local branch is reported as `NotMerged` and left alone until `force` is set.
pub fn delete_branch_in(
    dir: &str,
    name: &str,
    remote: bool,
    force: bool,
) -> Result<DeleteOutcome, String> {
    let name = name.trim();
    if remote {
        let (remote_name, branch) = split_remote_ref(dir, name)?;
        run_git_no_prompt(dir, &["push", "--delete", &remote_name, &branch])?;
        return Ok(DeleteOutcome::Deleted);
    }
    if !local_branch_exists_in(dir, name)? {
        return Err(format!("There is no local branch named \"{name}\""));
    }
    if !force && !branch_is_merged(dir, name) {
        return Ok(DeleteOutcome::NotMerged);
    }
    run_git(dir, &["branch", if force { "-D" } else { "-d" }, "--", name])?;
    Ok(DeleteOutcome::Deleted)
}

pub fn tag_exists_in(dir: &str, name: &str) -> Result<bool, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(false);
    }
    Ok(run_git(dir, &["show-ref", "--verify", "--quiet", &format!("refs/tags/{name}")]).is_ok())
}

/// Tags a commit. A non-blank `message` makes an annotated tag, otherwise a lightweight one.
pub fn create_tag_in(dir: &str, name: &str, hash: &str, message: &str) -> Result<(), String> {
    let name = name.trim();
    let hash = hash.trim();
    require_commit_hash(hash)?;
    // A leading dash would read as an option; check-ref-format alone lets it through.
    if name.starts_with('-') || run_git(dir, &["check-ref-format", &format!("refs/tags/{name}")]).is_err() {
        return Err(format!("\"{name}\" is not a valid tag name"));
    }
    if tag_exists_in(dir, name)? {
        return Err(format!("A tag named \"{name}\" already exists"));
    }
    let message = message.trim();
    if message.is_empty() {
        run_git(dir, &["tag", "--", name, hash]).map(|_| ())
    } else {
        run_git(dir, &["tag", "-a", "-m", message, "--", name, hash]).map(|_| ())
    }
}

/// Deletes a local tag. A pushed copy on the remote is left alone.
pub fn delete_tag_in(dir: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if !tag_exists_in(dir, name)? {
        return Err(format!("There is no tag named \"{name}\""));
    }
    run_git(dir, &["tag", "-d", "--", name]).map(|_| ())
}

/// Pushes one tag to a remote. An existing remote tag that differs is refused by git (no
/// force), and that error surfaces.
pub fn push_tag_in(dir: &str, name: &str, remote: &str) -> Result<(), String> {
    let (name, remote) = (name.trim(), remote.trim());
    if !tag_exists_in(dir, name)? {
        return Err(format!("There is no tag named \"{name}\""));
    }
    require_known_remote(dir, remote)?;
    run_git_no_prompt(dir, &["push", "--", remote, &format!("refs/tags/{name}")]).map(|_| ())
}

/// Deletes a tag from one remote only; the local tag stays.
pub fn delete_remote_tag_in(dir: &str, name: &str, remote: &str) -> Result<(), String> {
    let (name, remote) = (name.trim(), remote.trim());
    if name.is_empty() || name.starts_with('-') {
        return Err(format!("\"{name}\" is not a valid tag name"));
    }
    require_known_remote(dir, remote)?;
    run_git_no_prompt(dir, &["push", "--delete", "--", remote, &format!("refs/tags/{name}")]).map(|_| ())
}

/// The remote a branch pushes to and the branch name it maps to there; `None` without an upstream.
fn upstream_target_in(dir: &str, branch: &str) -> Option<(String, String)> {
    let remote = run_git(dir, &["config", "--get", &format!("branch.{branch}.remote")]).ok()?;
    let merge = run_git(dir, &["config", "--get", &format!("branch.{branch}.merge")]).ok()?;
    let remote = remote.trim();
    let merge = merge.trim().strip_prefix("refs/heads/")?;
    (!remote.is_empty() && remote != ".").then(|| (remote.to_string(), merge.to_string()))
}

/// The remote a branch with no upstream publishes to: `origin` when it exists, else the only
/// remote there is. Several remotes and none called `origin` is a choice only the user can make.
fn default_push_remote_in(dir: &str) -> Result<String, String> {
    let listed = run_git(dir, &["remote"])?;
    let remotes: Vec<&str> = listed.lines().map(str::trim).filter(|name| !name.is_empty()).collect();
    match remotes.as_slice() {
        [] => Err("This repository has no remotes. Add one first.".into()),
        _ if remotes.contains(&"origin") => Ok("origin".into()),
        [only] => Ok((*only).to_string()),
        _ => Err("This branch has no upstream and there is no origin. Use Push to… on the branch to pick a remote.".into()),
    }
}

/// What `push_branch` hands git: the branch's own upstream when it has one, else the default remote.
pub fn push_args_in(dir: &str) -> Result<Vec<String>, String> {
    let branch = run_git(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_default();
    let branch = branch.trim();
    match upstream_target_in(dir, branch) {
        Some((remote, target)) if !branch.is_empty() => {
            Ok(vec!["push".into(), "-u".into(), remote, format!("HEAD:refs/heads/{target}")])
        }
        _ => Ok(vec!["push".into(), "-u".into(), default_push_remote_in(dir)?, "HEAD".into()]),
    }
}

fn require_remote_branch_name(dir: &str, name: &str) -> Result<(), String> {
    if name.starts_with('-') || run_git(dir, &["check-ref-format", "--branch", name]).is_err() {
        return Err(format!("\"{name}\" is not a valid branch name"));
    }
    Ok(())
}

fn require_known_remote(dir: &str, remote: &str) -> Result<(), String> {
    if run_git(dir, &["remote"])?.lines().any(|known| known.trim() == remote) {
        Ok(())
    } else {
        Err(format!("There is no remote named \"{remote}\""))
    }
}

/// Points a local branch at `<remote>/<remote_branch>`; that remote branch has to exist already.
pub fn set_upstream_in(dir: &str, branch: &str, remote: &str, remote_branch: &str) -> Result<(), String> {
    let (branch, remote, remote_branch) = (branch.trim(), remote.trim(), remote_branch.trim());
    if !local_branch_exists_in(dir, branch)? {
        return Err(format!("There is no local branch named \"{branch}\""));
    }
    require_known_remote(dir, remote)?;
    require_remote_branch_name(dir, remote_branch)?;
    run_git(dir, &["show-ref", "--verify", "--quiet", &format!("refs/remotes/{remote}/{remote_branch}")])
        .map_err(|_| format!("\"{remote}/{remote_branch}\" does not exist; fetch or push it first"))?;
    run_git(
        dir,
        &["branch", &format!("--set-upstream-to={remote}/{remote_branch}"), "--", branch],
    )
    .map(|_| ())
}

/// Publishes a local branch to a chosen remote as `remote_branch` and makes that its upstream.
pub fn push_branch_to_in(dir: &str, branch: &str, remote: &str, remote_branch: &str) -> Result<(), String> {
    let (branch, remote, remote_branch) = (branch.trim(), remote.trim(), remote_branch.trim());
    if !local_branch_exists_in(dir, branch)? {
        return Err(format!("There is no local branch named \"{branch}\""));
    }
    require_known_remote(dir, remote)?;
    require_remote_branch_name(dir, remote_branch)?;
    run_git_no_prompt(
        dir,
        &["push", "-u", remote, &format!("refs/heads/{branch}:refs/heads/{remote_branch}")],
    )
    .map(|_| ())
}
