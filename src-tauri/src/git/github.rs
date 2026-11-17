use serde::Serialize;

use super::*;

/// Fields TS needs from `gh pr list`; the parse lives there, like the log's.
const PR_FIELDS: &str = "number,title,state,isDraft,author,headRefName,baseRefName,isCrossRepository,\
url,updatedAt,reviewDecision,statusCheckRollup";

#[derive(Serialize, Debug, PartialEq)]
pub struct PullRequestsPayload {
    /// "ok" | "gh-missing" (not installed) | "gh-unauthenticated" | "not-github" (no GitHub remote).
    /// Each non-ok state is an expected answer, not an error: the UI explains it in place.
    pub status: String,
    /// `gh pr list --json` output; empty unless the status is "ok".
    pub raw: String,
}

fn answer(status: &str, raw: String) -> PullRequestsPayload {
    PullRequestsPayload {
        status: status.to_string(),
        raw,
    }
}

/// Sorts a failed `gh` run into one of the expected states, or `None` for a real failure
/// (network down, API error) that should surface as an error.
pub fn classify_gh_failure(stderr: &str) -> Option<&'static str> {
    let text = stderr.to_lowercase();
    if text.contains("gh auth login")
        || text.contains("not logged in")
        || text.contains("authentication")
        || text.contains("http 401")
    {
        Some("gh-unauthenticated")
    } else if text.contains("none of the git remotes")
        || text.contains("no github remotes")
        || text.contains("could not determine base repo")
        || text.contains("not a github")
    {
        Some("not-github")
    } else {
        None
    }
}

/// The repository's pull requests (open, closed and merged, newest 100) through the `gh` CLI.
pub fn read_pull_requests_in(dir: &str) -> Result<PullRequestsPayload, String> {
    let out = match gh_command(dir)
        .args(["pr", "list", "--state", "all", "--limit", "100", "--json", PR_FIELDS])
        .output()
    {
        Ok(out) => out,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(answer("gh-missing", String::new()));
        }
        Err(error) => return Err(format!("failed to run gh: {error}")),
    };
    if out.status.success() {
        return Ok(answer("ok", String::from_utf8_lossy(&out.stdout).to_string()));
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    match classify_gh_failure(&stderr) {
        Some(status) => Ok(answer(status, String::new())),
        None => Err(stderr),
    }
}
