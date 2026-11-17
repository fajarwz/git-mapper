use super::github::classify_gh_failure;
use super::test_support::*;
use super::*;

#[test]
fn sorts_expected_gh_failures_from_real_ones() {
    assert_eq!(
        classify_gh_failure("To get started with GitHub CLI, please run:  gh auth login"),
        Some("gh-unauthenticated")
    );
    assert_eq!(
        classify_gh_failure("You are not logged into any GitHub hosts."),
        Some("gh-unauthenticated")
    );
    assert_eq!(classify_gh_failure("HTTP 401: Bad credentials"), Some("gh-unauthenticated"));
    assert_eq!(
        classify_gh_failure("none of the git remotes configured for this repository point to a known GitHub host."),
        Some("not-github")
    );
    assert_eq!(classify_gh_failure("HTTP 502: Bad Gateway"), None);
}

#[test]
fn a_repository_without_a_github_remote_never_panics() {
    // Whatever this machine has — no gh, gh signed out, gh signed in — the answer is a payload
    // with an expected status or a plain error string, and nothing is listed for a repo that
    // has no GitHub remote.
    let repo = TempRepo::new("gh-none");
    repo.commit("a.txt", "a\n", "first");
    if let Ok(payload) = read_pull_requests_in(repo.path()) {
        assert_ne!(payload.status, "ok");
        assert!(payload.raw.is_empty());
    }
}
