use serde::Serialize;

use super::*;

#[derive(Serialize, Debug, PartialEq)]
pub struct SubmoduleInfo {
    /// Path relative to the repository root, as recorded in `.gitmodules`.
    pub path: String,
    /// "ok" | "moved" (checked out at a commit other than the recorded one) |
    /// "uninitialized" (never cloned here) | "conflict" (merge conflict on the pointer).
    pub state: String,
    /// The commit the submodule sits at; the recorded one while it is uninitialized.
    pub commit: String,
}

/// One `git submodule status` line: a state character, the commit, the path and — when the
/// submodule is checked out — a `(describe)` suffix that is not part of the path.
pub fn parse_submodule_status(raw: &str) -> Vec<SubmoduleInfo> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let Some(prefix) = line.chars().next() else {
            continue;
        };
        let state = match prefix {
            '-' => "uninitialized",
            '+' => "moved",
            'U' => "conflict",
            ' ' => "ok",
            _ => continue,
        };
        let Some((commit, rest)) = line[1..].split_once(' ') else {
            continue;
        };
        let path = match rest.rsplit_once(" (") {
            Some((path, describe)) if describe.ends_with(')') => path,
            _ => rest,
        };
        out.push(SubmoduleInfo {
            path: path.trim_end().to_string(),
            state: state.to_string(),
            commit: commit.to_string(),
        });
    }
    out
}

/// Direct submodules only (no `--recursive`). A repository without `.gitmodules` answers
/// without spawning git at all, so the call every open and refresh makes costs nothing there.
pub fn read_submodules_in(dir: &str) -> Result<Vec<SubmoduleInfo>, String> {
    if !std::path::Path::new(dir).join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    run_git(dir, &["submodule", "status"]).map(|raw| parse_submodule_status(&raw))
}
