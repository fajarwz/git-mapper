use serde::Serialize;

use super::*;

const GITHUB_FIELDS: &str = "number,title,state,isDraft,author,headRefName,baseRefName,isCrossRepository,\
url,updatedAt,reviewDecision,statusCheckRollup";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provider {
    GitHub,
    GitLab,
}

impl Provider {
    fn name(self) -> &'static str {
        match self {
            Provider::GitHub => "github",
            Provider::GitLab => "gitlab",
        }
    }

    fn program(self) -> &'static str {
        match self {
            Provider::GitHub => "gh",
            Provider::GitLab => "glab",
        }
    }

    fn args(self) -> Vec<&'static str> {
        match self {
            Provider::GitHub => vec!["pr", "list", "--state", "all", "--limit", "100", "--json", GITHUB_FIELDS],
            Provider::GitLab => vec!["mr", "list", "--all", "--per-page", "100", "--output", "json"],
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct PullRequestsPayload {
    /// "ok" | "cli-missing" (gh/glab not installed) | "cli-unauthenticated" | "unsupported-remote"
    /// (no GitHub or GitLab remote). Each non-ok state is an expected answer, not an error: the
    /// UI explains it in place.
    pub status: String,
    /// "github" | "gitlab", or empty when the remote's host does not say and nothing answered.
    pub provider: String,
    /// The CLI's `--json` output; empty unless the status is "ok".
    pub raw: String,
}

fn payload(status: &str, provider: Option<Provider>, raw: String) -> PullRequestsPayload {
    PullRequestsPayload {
        status: status.to_string(),
        provider: provider.map(|p| p.name()).unwrap_or("").to_string(),
        raw,
    }
}

#[derive(Debug, PartialEq)]
pub enum Attempt {
    Ok(String),
    Missing,
    Unauthenticated,
    /// The CLI ran and found no host of its own kind among the remotes.
    NoRemote,
    Failed(String),
}

/// Sorts a failed CLI run into an expected state, or `None` for a real failure (network down,
/// API error). "No remote" is tested FIRST: gh's and glab's message for it ends with a hint
/// to `auth login`, which would otherwise read as "signed out".
pub fn classify_failure(stderr: &str) -> Option<Attempt> {
    let text = stderr.to_lowercase();
    if text.contains("none of the git remotes")
        || text.contains("no github remotes")
        || text.contains("no gitlab remotes")
        || text.contains("could not determine base repo")
        || text.contains("not a github")
        || text.contains("not a gitlab")
    {
        Some(Attempt::NoRemote)
    } else if text.contains("auth login")
        || text.contains("not logged in")
        || text.contains("authentication")
        || text.contains("http 401")
        || text.contains("401 unauthorized")
    {
        Some(Attempt::Unauthenticated)
    } else {
        None
    }
}

/// The host of a remote URL: `https://user@host:8443/p`, `ssh://git@host/p` and scp-like
/// `git@host:p` all give `host`, lower-cased.
pub fn host_of(url: &str) -> Option<String> {
    let url = url.trim();
    let authority = match url.split_once("://") {
        Some((_, rest)) => rest.split('/').next()?,
        None => url.split([':', '/']).next()?,
    };
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then(|| host.to_lowercase())
}

/// Which CLIs to ask, and whether the host named one outright. A host with "github" or
/// "gitlab" in it (github.com, gitlab.com, gitlab.example.org) is that provider and nobody
/// else; any other host (a self-hosted instance, Bitbucket) asks gh, then glab.
pub fn providers_for(host: Option<&str>) -> (Vec<Provider>, bool) {
    match host {
        Some(host) if host.contains("gitlab") => (vec![Provider::GitLab], true),
        Some(host) if host.contains("github") => (vec![Provider::GitHub], true),
        _ => (vec![Provider::GitHub, Provider::GitLab], false),
    }
}

/// Collapses the attempts into one answer. With an unknown host, glab's failures on a repo
/// that is probably not GitLab at all are ignored rather than shown as errors.
pub fn settle(attempts: Vec<(Provider, Attempt)>, matched: bool) -> Result<PullRequestsPayload, String> {
    for (provider, attempt) in &attempts {
        if let Attempt::Ok(raw) = attempt {
            return Ok(payload("ok", Some(*provider), raw.clone()));
        }
    }
    for (index, (_, attempt)) in attempts.iter().enumerate() {
        if let Attempt::Failed(message) = attempt {
            if matched || index == 0 {
                return Err(message.clone());
            }
        }
    }
    if let Some((provider, _)) = attempts.iter().find(|(_, a)| *a == Attempt::Unauthenticated) {
        return Ok(payload("cli-unauthenticated", Some(*provider), String::new()));
    }
    if matched {
        let (provider, attempt) = &attempts[0];
        // The host is plainly this provider's, so a CLI that does not know it is signed out.
        let status = if *attempt == Attempt::Missing { "cli-missing" } else { "cli-unauthenticated" };
        return Ok(payload(status, Some(*provider), String::new()));
    }
    if attempts.iter().all(|(_, a)| *a == Attempt::Missing) {
        return Ok(payload("cli-missing", None, String::new()));
    }
    Ok(payload("unsupported-remote", None, String::new()))
}

fn remote_host(dir: &str) -> Option<String> {
    let url = run_git(dir, &["remote", "get-url", "origin"]).or_else(|_| {
        let remotes = run_git(dir, &["remote"])?;
        let first = remotes.lines().next().ok_or_else(String::new)?.to_string();
        run_git(dir, &["remote", "get-url", &first])
    });
    url.ok().and_then(|url| host_of(&url))
}

fn attempt(dir: &str, provider: Provider) -> Attempt {
    let out = match cli_command(provider.program(), dir).args(provider.args()).output() {
        Ok(out) => out,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Attempt::Missing,
        Err(error) => return Attempt::Failed(format!("failed to run {}: {error}", provider.program())),
    };
    if out.status.success() {
        return Attempt::Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    classify_failure(&stderr).unwrap_or(Attempt::Failed(stderr))
}

/// The repository's pull/merge requests (open, closed and merged, newest 100) through the
/// provider's own CLI: `gh` for GitHub, `glab` for GitLab, picked from the origin remote's host.
pub fn read_pull_requests_in(dir: &str) -> Result<PullRequestsPayload, String> {
    let host = remote_host(dir);
    let (providers, matched) = providers_for(host.as_deref());
    let mut attempts = Vec::new();
    for provider in providers {
        let result = attempt(dir, provider);
        let done = matches!(result, Attempt::Ok(_));
        attempts.push((provider, result));
        if done {
            break;
        }
    }
    settle(attempts, matched)
}
