use super::test_support::*;
use super::*;

#[test]
fn fetch_remote_tracks_the_upstream_and_skips_remoless_repos() {
    // The remote repository's history grows after the origin link is made; the fetch must
    // pull that growth into the local tracking refs.
    let remote = TempRepo::new("fetch-remote");
    remote.commit("a.txt", "a\n", "first");
    let repo = TempRepo::new("fetch");
    repo.commit("b.txt", "b\n", "second");
    git(&repo.0, &["remote", "add", "origin", remote.path()]);

    // A repository with a remote but no new objects still fetches fine; the tracking ref
    // now exists and points at the remote's head.
    fetch_remote_in(repo.path()).expect("the fetch ran");
    let tracked = git_out(&repo.0, &["rev-parse", "origin/main"]);
    assert_eq!(tracked, git_out(&remote.0, &["rev-parse", "HEAD"]));

    // New work on the remote moves origin/main only after a fetch.
    let before = git_out(&repo.0, &["rev-parse", "origin/main"]);
    remote.commit("c.txt", "c\n", "third");
    fetch_remote_in(repo.path()).expect("the second fetch ran");
    assert_ne!(
        git_out(&repo.0, &["rev-parse", "origin/main"]),
        before,
        "the fetch caught up with the remote"
    );

    // A repository without remotes is not an error — there is simply nothing to read.
    let lone = TempRepo::new("fetch-lone");
    lone.commit("l.txt", "l\n", "lonely");
    fetch_remote_in(lone.path()).expect("a remoless repo fetches as a no-op");
}

#[test]
fn stash_actions_apply_pop_and_drop_the_entry() {
    let repo = TempRepo::new("stash-actions");
    repo.commit("a.txt", "a\n", "first");

    // A stashed working-tree edit: the index clean, the edit parked in the entry.
    std::fs::write(repo.0.join("a.txt"), "b\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);

    // Apply restores the change and KEEPS the entry — the stash list still shows one.
    stash_action_in(repo.path(), 0, "apply").expect("the apply ran");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "b\n"
    );
    assert_eq!(git_out(&repo.0, &["stash", "list"]).lines().count(), 1);

    // Pop restores and drops: the list is empty after it.
    std::fs::write(repo.0.join("a.txt"), "a\n").expect("reset");
    stash_action_in(repo.path(), 0, "pop").expect("the pop ran");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "b\n"
    );
    assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());

    // Drop removes the entry without touching anything else — and because saving a
    // stash resets the worktree to HEAD first, the file is back at the committed text.
    std::fs::write(repo.0.join("a.txt"), "c\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);
    stash_action_in(repo.path(), 0, "drop").expect("the drop ran");
    assert!(git_out(&repo.0, &["stash", "list"]).trim().is_empty());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );

    // Actions outside the stack are refused, as is an unknown op.
    let err = stash_action_in(repo.path(), 0, "clear").unwrap_err();
    assert!(err.contains("is not a stash action"), "got: {err}");
    let err = stash_action_in(repo.path(), 5, "apply").unwrap_err();
    assert!(!err.is_empty(), "an absent entry errors, not panics");
}

#[test]
fn checkout_commit_detaches_onto_a_commit() {
    let repo = TempRepo::new("detach");
    repo.commit("a.txt", "a\n", "first");
    let first = git_out(&repo.0, &["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "second");
    let second = git_out(&repo.0, &["rev-parse", "HEAD"]);

    checkout_commit_in(repo.path(), &first[..7]).expect("the short hash detaches");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "HEAD"]),
        first,
        "HEAD sits on the commit"
    );
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "HEAD",
        "no branch is checked out"
    );
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "refs/heads/main"]),
        second,
        "the branch did not move with the checkout"
    );
}

#[test]
fn checkout_commit_rejects_everything_but_a_hash() {
    let repo = TempRepo::new("detach-guard");
    repo.commit("a.txt", "a\n", "first");

    // A branch name is refused before git sees it — --detach is hash-only.
    let err = checkout_commit_in(repo.path(), "main").unwrap_err();
    assert!(err.contains("is not a commit hash"), "got: {err}");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main",
        "HEAD did not move"
    );
}
