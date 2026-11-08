use std::path::Path;

use super::*;

pub fn stage_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_git(dir, &args).map(|_| ())
}

pub fn unstage_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    // A staged rename is really delete-source + add-destination inside the index. Unstaging
    // only the destination would leave "source deleted" staged. Both sides restore to HEAD,
    // and the file walks back to its original name on disk, so the rename simply vanishes.
    let raw = run_git(
        dir,
        &["status", "--porcelain=v2", "--untracked-files=all", "-z"],
    )
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
        let _ = std::fs::rename(
            Path::new(dir).join(destination),
            Path::new(dir).join(source),
        );
    }
    Ok(())
}

pub fn discard_files_in(dir: &str, paths: &[String]) -> Result<(), String> {
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
    let mut conflicted: Vec<String> = Vec::new();
    for_each_status_v2(&raw, |x, y, path, _orig| {
        if !wanted.contains(path.as_str()) {
            return;
        }
        if x == 'U' || y == 'U' {
            conflicted.push(path);
        } else if y == '?' {
            clean.push(path);
        } else if x != '.' {
            from_index.push(path);
        } else if head_paths.contains(path.as_str()) {
            from_head.push(path);
        } else {
            from_disk.push(path);
        }
    });
    if let Some(path) = conflicted.first() {
        return Err(format!("{path} is unmerged — resolve the conflict first"));
    }

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

pub fn discard_all_in(dir: &str) -> Result<(), String> {
    // The panel's "every change" dialog: tracked paths reset (staged copies included) and
    // untracked files are deleted — directory entries too, so an empty folder never lingers.
    let head = run_git(dir, &["rev-parse", "--verify", "HEAD"]).map(|_| ());
    if head.is_ok() {
        run_git(dir, &["reset", "--hard", "-q"]).map(|_| ())?;
    }
    run_git(dir, &["clean", "-qfd"]).map(|_| ())
}

pub fn commit_staged_in(dir: &str, message: &str) -> Result<(), String> {
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

pub fn undo_commit_in(dir: &str) -> Result<(), String> {
    // `rev-list --parents -1 HEAD` answers both guards in one spawn: the parent count.
    // Zero parents = the root commit (nothing to undo ONTO: deleting history is not this
    // command's business), several = a merge, where `HEAD~1` is first-parent shorthand and
    // a reset there strands the merged branch behind.
    let heads = run_git(dir, &["rev-list", "--parents", "-1", "HEAD"])?;
    let parent_count = heads.split_whitespace().count() - 1;
    if parent_count == 0 {
        return Err(
            "the tip is the repository's root commit — there is nothing to undo onto".into(),
        );
    }
    if parent_count > 1 {
        return Err("the tip is a merge commit — its undo is not a soft reset".into());
    }
    run_git(dir, &["reset", "--soft", "HEAD~1"]).map(|_| ())
}
