use super::pulls::{classify_failure, host_of, providers_for, settle, Attempt, Provider, PAGE_SIZE};
use super::test_support::*;
use super::*;

#[test]
fn no_remote_wins_over_the_auth_hint_its_message_ends_with() {
    // gh's real text for a repo whose remote is not GitHub: it mentions `gh auth login`.
    let gh = "none of the git remotes configured for this repository point to a known GitHub host. \
              To tell gh about a new GitHub host, please use `gh auth login`";
    assert_eq!(classify_failure(gh), Some(Attempt::NoRemote));
    let glab = "none of the git remotes configured for this repository point to a known GitLab host. \
                Please use `glab auth login` to authenticate";
    assert_eq!(classify_failure(glab), Some(Attempt::NoRemote));
}

#[test]
fn sorts_signed_out_from_real_failures() {
    assert_eq!(
        classify_failure("To get started with GitHub CLI, please run:  gh auth login"),
        Some(Attempt::Unauthenticated)
    );
    assert_eq!(
        classify_failure("You are not logged into any GitHub hosts."),
        Some(Attempt::Unauthenticated)
    );
    assert_eq!(classify_failure("HTTP 401: Bad credentials"), Some(Attempt::Unauthenticated));
    assert_eq!(classify_failure("401 Unauthorized"), Some(Attempt::Unauthenticated));
    assert_eq!(classify_failure("HTTP 502: Bad Gateway"), None);
}

#[test]
fn reads_the_host_out_of_every_remote_shape() {
    for (url, host) in [
        ("git@github.com:fajarwz/git-mapper.git", "github.com"),
        ("https://github.com/o/r.git", "github.com"),
        ("https://user:token@gitlab.example.org:8443/g/p.git", "gitlab.example.org"),
        ("ssh://git@GitLab.com:2222/g/p.git", "gitlab.com"),
        ("git@git.corp.dev:team/app.git", "git.corp.dev"),
    ] {
        assert_eq!(host_of(url).as_deref(), Some(host), "{url}");
    }
    assert_eq!(host_of(""), None);
}

#[test]
fn a_named_host_asks_only_its_own_cli_and_an_unknown_one_asks_both() {
    assert_eq!(providers_for(Some("gitlab.com")), (vec![Provider::GitLab], true));
    assert_eq!(providers_for(Some("gitlab.example.org")), (vec![Provider::GitLab], true));
    assert_eq!(providers_for(Some("github.com")), (vec![Provider::GitHub], true));
    assert_eq!(
        providers_for(Some("git.corp.dev")),
        (vec![Provider::GitHub, Provider::GitLab], false)
    );
    assert_eq!(providers_for(None), (vec![Provider::GitHub, Provider::GitLab], false));
}

fn status(attempts: Vec<(Provider, Attempt)>, matched: bool) -> (String, String) {
    let payload = settle(attempts, matched).unwrap();
    (payload.status, payload.provider)
}

#[test]
fn settles_every_outcome_into_one_answer() {
    let gl = Provider::GitLab;
    let gh = Provider::GitHub;
    // Success from the second provider of an unknown host wins.
    assert_eq!(
        status(vec![(gh, Attempt::NoRemote), (gl, Attempt::Ok("[]".into()))], false),
        ("ok".into(), "gitlab".into())
    );
    // A GitLab host with no glab: install it. With glab that does not know the host: sign in.
    assert_eq!(status(vec![(gl, Attempt::Missing)], true), ("cli-missing".into(), "gitlab".into()));
    assert_eq!(
        status(vec![(gl, Attempt::NoRemote)], true),
        ("cli-unauthenticated".into(), "gitlab".into())
    );
    assert_eq!(
        status(vec![(gh, Attempt::Unauthenticated)], true),
        ("cli-unauthenticated".into(), "github".into())
    );
    // Unknown host: neither CLI installed asks for one; a CLI that says "not mine" hides the button.
    assert_eq!(
        status(vec![(gh, Attempt::Missing), (gl, Attempt::Missing)], false),
        ("cli-missing".into(), "".into())
    );
    assert_eq!(
        status(vec![(gh, Attempt::NoRemote), (gl, Attempt::Missing)], false),
        ("unsupported-remote".into(), "".into())
    );
}

#[test]
fn real_failures_surface_but_glab_noise_on_an_unknown_host_does_not() {
    let gl = Provider::GitLab;
    let gh = Provider::GitHub;
    assert_eq!(
        settle(vec![(gl, Attempt::Failed("HTTP 502".into()))], true),
        Err("HTTP 502".into())
    );
    assert_eq!(
        settle(vec![(gh, Attempt::Failed("HTTP 502".into())), (gl, Attempt::Missing)], false),
        Err("HTTP 502".into())
    );
    // A Bitbucket remote: gh says not-mine, glab prints something we do not recognise.
    assert_eq!(
        status(vec![(gh, Attempt::NoRemote), (gl, Attempt::Failed("weird".into()))], false),
        ("unsupported-remote".into(), "".into())
    );
}

#[test]
fn a_repository_without_a_known_remote_never_panics() {
    // Whatever CLIs this machine has, the answer is an expected status or a plain error string,
    // and nothing is listed for a repo that has no remote at all.
    let repo = TempRepo::new("pulls-none");
    repo.commit("a.txt", "a\n", "first");
    if let Ok(payload) = read_pull_requests_in(repo.path(), "open", None, None, None) {
        assert_ne!(payload.status, "ok");
        assert!(payload.raw.is_empty());
    }
}

#[test]
fn a_repo_with_no_remotes_at_all_is_no_remote_not_an_error() {
    assert_eq!(classify_failure("error parsing \"owner\" value: no git remotes found"), Some(Attempt::NoRemote));
}

#[test]
fn github_pages_ask_a_light_query_and_only_name_what_they_need() {
    let first = Provider::GitHub.args("open", None, None);
    assert_eq!(&first[..2], ["api", "graphql"]);
    assert!(first.contains(&"owner={owner}".to_string()), "gh fills in the repo from the working directory");
    assert!(first.contains(&"states[]=OPEN".to_string()), "the open scope filters server-side");
    assert!(!first.iter().any(|arg| arg.starts_with("after=")), "no cursor on the first page");
    let query = first.last().unwrap();
    assert!(query.starts_with("query="));
    assert!(query.contains(&format!("first: {PAGE_SIZE}")), "the page size reaches the query");
    assert!(query.contains("statusCheckRollup { state }"), "only the rollup's one-word state is asked for");
    assert!(!query.contains("contexts"), "never the per-check list: that is what times out");

    let all = Provider::GitHub.args("all", Some("Y3Vyc29y"), None);
    assert!(!all.contains(&"states[]=OPEN".to_string()), "all states means no filter");
    assert!(all.contains(&"after=Y3Vyc29y".to_string()), "a follow-up page carries its cursor");
}

#[test]
fn gitlab_pages_by_number_and_all_means_all_states() {
    let open = Provider::GitLab.args("open", None, None);
    let joined = open.join(" ");
    assert_eq!(joined, format!("mr list --per-page {PAGE_SIZE} --page 1 --output json"));

    let all = Provider::GitLab.args("all", Some("3"), None).join(" ");
    assert_eq!(all, format!("mr list --per-page {PAGE_SIZE} --page 3 --all --output json"));
    assert!(
        Provider::GitLab.args("open", Some("junk"), None).join(" ").contains("--page 1"),
        "a cursor that is not a number falls back to the first page"
    );
}

#[test]
fn the_merged_scope_filters_by_merged_state_on_both_providers() {
    let github = Provider::GitHub.args("merged", None, None);
    assert!(github.contains(&"states[]=MERGED".to_string()));
    assert!(!github.contains(&"states[]=OPEN".to_string()));
    let gitlab = Provider::GitLab.args("merged", None, None).join(" ");
    assert_eq!(gitlab, format!("mr list --per-page {PAGE_SIZE} --page 1 --merged --output json"));
}

#[test]
fn a_github_search_is_one_query_over_the_whole_repo_in_the_scope() {
    let args = Provider::GitHub.args("merged", Some("c9"), Some("  webview focus  "));
    let q = args.iter().find(|arg| arg.starts_with("q=")).expect("the search string is passed as q");
    assert_eq!(q, "q=repo:{owner}/{repo} is:pr is:merged sort:created-desc webview focus");
    assert!(!args.contains(&"owner={owner}".to_string()), "the search names the repo inside q instead");
    assert!(args.contains(&"after=c9".to_string()), "a search pages by cursor too");
    let query = args.last().unwrap();
    assert!(query.contains("search(query: $q"), "it uses GitHub's search, not the repository list");
    assert!(query.contains("... on PullRequest"), "and keeps only the PR fields");
    assert!(query.contains(&format!("first: {PAGE_SIZE}")));

    let open = Provider::GitHub.args("open", None, Some("x"));
    assert!(open.iter().any(|arg| arg.contains("is:pr is:open sort:created-desc x")));
    let all = Provider::GitHub.args("all", None, Some("x"));
    assert!(all.iter().any(|arg| arg == "q=repo:{owner}/{repo} is:pr sort:created-desc x"), "all adds no state");
}

#[test]
fn a_blank_search_is_the_plain_list() {
    assert_eq!(Provider::GitHub.args("open", None, Some("   ")), Provider::GitHub.args("open", None, None));
    assert_eq!(Provider::GitLab.args("open", None, Some("")), Provider::GitLab.args("open", None, None));
}

#[test]
fn a_gitlab_search_adds_the_search_flag() {
    let args = Provider::GitLab.args("all", Some("2"), Some("runner")).join(" ");
    assert_eq!(args, format!("mr list --per-page {PAGE_SIZE} --page 2 --all --search runner --output json"));
}
