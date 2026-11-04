use super::*;

/// `--all` includes refs/stash, which drags in the stash commit and the index snapshot it
/// points at as if they were history. Stashes get their own rows (read_stashes), so they are
/// excluded here — and from the delta/order reads, which have to describe the same set.
pub const EXCLUDE_STASH: &str = "--exclude=refs/stash";

pub fn read_log_in(dir: &str, limit: u32, skip: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all",
            "--date-order",
            &format!("--max-count={limit}"),
            &format!("--skip={skip}"),
            "--date=iso-strict",
            "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
        ],
    )
}

pub fn read_log_delta_in(dir: &str, since: &str, limit: u32) -> Result<String, String> {
    if since.trim().is_empty() {
        return read_log_in(dir, limit, 0);
    }
    let exclude = format!("^{since}");
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all",
            "--date-order",
            &format!("--max-count={limit}"),
            &exclude,
            "--date=iso-strict",
            "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
        ],
    )
}

pub fn read_log_order_in(dir: &str, limit: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
            EXCLUDE_STASH,
            "--all",
            "--date-order",
            &format!("--max-count={limit}"),
            "--date=iso-strict",
            "--pretty=tformat:%H",
        ],
    )
}

pub fn read_refs_in(dir: &str) -> Result<String, String> {
    run_git(
        dir,
        &[
            "for-each-ref",
            "--format=%(objectname)%09%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )
}

pub fn read_stashes_in(dir: &str) -> Result<String, String> {
    run_git(
        dir,
        &[
            "stash",
            "list",
            "--pretty=tformat:%gd%x00%H%x00%P%x00%an%x00%ae%x00%cI%x00%gs%x1e",
        ],
    )
}
