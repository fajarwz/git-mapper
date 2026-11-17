use serde::Serialize;

use super::*;

/// One page of the list. The TS side (`PR_PAGE_SIZE`) infers "is there a next GitLab page" from
/// a full page, so the two constants must agree.
pub const PAGE_SIZE: u32 = 30;

/// One GraphQL query instead of `gh pr list --json`: that command's `statusCheckRollup` pulls
/// every individual check of every PR, which 504s on a busy repo (tauri-apps/tauri: ~12s, then a
/// gateway timeout). The rollup's one-word `state` is all the UI needs and costs almost nothing.
/// `{owner}`/`{repo}` (passed below) are gh's placeholders for the working directory's remote.
const GITHUB_QUERY: &str = "query($owner: String!, $name: String!, $states: [PullRequestState!], $after: String) { \
repository(owner: $owner, name: $name) { pullRequests(first: __PAGE__, states: $states, after: $after, \
orderBy: {field: CREATED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { \
number title state isDraft headRefName baseRefName isCrossRepository url updatedAt reviewDecision \
author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }";

/// The text-search twin of the query above: GitHub's search returns issues and PRs alike, so the
/// `is:pr` qualifier in `q` narrows it and the fragment keeps only PR fields. Its count is
/// `issueCount`, not `totalCount`.
const GITHUB_SEARCH: &str = "query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: __PAGE__, \
after: $after) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { \
number title state isDraft headRefName baseRefName isCrossRepository url updatedAt reviewDecision \
author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }";

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

    fn from_name(name: &str) -> Option<Provider> {
        match name {
            "github" => Some(Provider::GitHub),
            "gitlab" => Some(Provider::GitLab),
            _ => None,
        }
    }

    /// CLI arguments for one page. `scope` is "open" (open and draft), "merged" or "all"; `cursor`
    /// is GitHub's `endCursor` or GitLab's page number, `None` asking for the first page; `query`
    /// is free text matched server-side across the WHOLE repository, so a search is not limited to
    /// the pages already loaded.
    pub fn args(self, scope: &str, cursor: Option<&str>, query: Option<&str>) -> Vec<String> {
        let query = query.map(str::trim).filter(|text| !text.is_empty());
        match self {
            Provider::GitHub => {
                let mut args: Vec<String> = Vec::new();
                let graphql = match query {
                    Some(text) => {
                        let state = match scope {
                            "open" => " is:open",
                            "merged" => " is:merged",
                            _ => "",
                        };
                        // -F fills {owner}/{repo} from the working directory's remote; the value
                        // starts with "repo:" so -F cannot coerce it into a number or boolean.
                        args.extend(["api", "graphql", "-F"].map(String::from));
                        args.push(format!("q=repo:{{owner}}/{{repo}} is:pr{state} sort:created-desc {text}"));
                        GITHUB_SEARCH
                    }
                    None => {
                        args.extend(["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}"].map(String::from));
                        match scope {
                            "open" => args.extend(["-F".to_string(), "states[]=OPEN".to_string()]),
                            "merged" => args.extend(["-F".to_string(), "states[]=MERGED".to_string()]),
                            _ => {}
                        }
                        GITHUB_QUERY
                    }
                };
                if let Some(cursor) = cursor {
                    // -f, not -F: -F would coerce a cursor that happens to look like a number.
                    args.extend(["-f".to_string(), format!("after={cursor}")]);
                }
                let graphql = graphql.replace("__PAGE__", &PAGE_SIZE.to_string());
                args.extend(["-f".to_string(), format!("query={graphql}")]);
                args
            }
            Provider::GitLab => {
                let page = cursor.and_then(|c| c.parse::<u32>().ok()).unwrap_or(1);
                let mut args: Vec<String> = ["mr", "list", "--per-page"].map(String::from).to_vec();
                args.extend([PAGE_SIZE.to_string(), "--page".to_string(), page.to_string()]);
                match scope {
                    "merged" => args.push("--merged".to_string()),
                    "open" => {}
                    _ => args.push("--all".to_string()),
                }
                if let Some(text) = query {
                    args.extend(["--search".to_string(), text.to_string()]);
                }
                args.extend(["--output".to_string(), "json".to_string()]);
                args
            }
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
        || text.contains("no git remotes found")
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

fn attempt(dir: &str, provider: Provider, scope: &str, cursor: Option<&str>, query: Option<&str>) -> Attempt {
    let out = match cli_command(provider.program(), dir).args(provider.args(scope, cursor, query)).output() {
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

/// One page of the repository's pull/merge requests (`scope` "open" or "all", newest first)
/// through the provider's own CLI: `gh` for GitHub, `glab` for GitLab, picked from the origin
/// remote's host. A follow-up page names the provider that answered the first one: a cursor means
/// nothing to the other CLI, and an unknown host would otherwise ask both again.
pub fn read_pull_requests_in(
    dir: &str,
    scope: &str,
    cursor: Option<&str>,
    provider: Option<&str>,
    query: Option<&str>,
) -> Result<PullRequestsPayload, String> {
    let host = remote_host(dir);
    let (providers, matched) = match provider.and_then(Provider::from_name) {
        Some(known) => (vec![known], true),
        None => providers_for(host.as_deref()),
    };
    let mut attempts = Vec::new();
    for provider in providers {
        let result = attempt(dir, provider, scope, cursor, query);
        let done = matches!(result, Attempt::Ok(_));
        attempts.push((provider, result));
        if done {
            break;
        }
    }
    settle(attempts, matched)
}
