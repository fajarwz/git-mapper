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
fn stash_push_shelves_staged_unstaged_and_untracked_work() {
    let repo = TempRepo::new("stash-push");
    repo.commit("a.txt", "a\n", "first");
    std::fs::write(repo.0.join("a.txt"), "edited\n").expect("edit");
    std::fs::write(repo.0.join("new.txt"), "new\n").expect("untracked");

    stash_push_in(repo.path(), "  my parked work ").expect("the stash ran");

    let list = git_out(&repo.0, &["stash", "list"]);
    assert_eq!(list.lines().count(), 1);
    assert!(list.contains("my parked work"), "the name landed: {list}");
    assert!(git_out(&repo.0, &["status", "--porcelain"]).trim().is_empty());
    assert!(!repo.0.join("new.txt").exists(), "untracked file was shelved too");

    // A blank name keeps git's default, and a leading dash is a name, not a flag.
    std::fs::write(repo.0.join("a.txt"), "again\n").expect("edit");
    stash_push_in(repo.path(), "  ").expect("blank stash ran");
    std::fs::write(repo.0.join("a.txt"), "third\n").expect("edit");
    stash_push_in(repo.path(), "--all").expect("dash name ran");
    let list = git_out(&repo.0, &["stash", "list"]);
    assert_eq!(list.lines().count(), 3);
    assert!(list.lines().next().expect("newest").contains("--all"));
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

fn clone_with_remote_branch(label: &str) -> (TempRepo, TempRepo) {
    let remote = TempRepo::new(&format!("{label}-remote"));
    remote.commit("a.txt", "a\n", "first");
    git(&remote.0, &["checkout", "-q", "-b", "feature/x"]);
    remote.commit("x.txt", "x\n", "feature work");
    git(&remote.0, &["checkout", "-q", "main"]);
    let repo = TempRepo::new(label);
    repo.commit("b.txt", "b\n", "local");
    git(&repo.0, &["remote", "add", "origin", remote.path()]);
    fetch_remote_in(repo.path()).expect("fetched");
    (remote, repo)
}

#[test]
fn checkout_remote_branch_creates_a_tracking_branch() {
    let (_remote, repo) = clone_with_remote_branch("remote-create");
    assert!(!local_branch_exists_in(repo.path(), "feature/x").unwrap());

    checkout_remote_branch_in(repo.path(), "origin/feature/x", "feature/x", RemoteCheckoutMode::Create)
        .expect("the branch is created");

    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/x");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "--abbrev-ref", "feature/x@{upstream}"]),
        "origin/feature/x",
        "the new branch tracks the remote one"
    );
    assert!(local_branch_exists_in(repo.path(), "feature/x").unwrap());
}

#[test]
fn checkout_remote_branch_refuses_a_taken_or_invalid_name() {
    let (_remote, repo) = clone_with_remote_branch("remote-guard");
    git(&repo.0, &["branch", "taken"]);

    let err = checkout_remote_branch_in(repo.path(), "origin/feature/x", "taken", RemoteCheckoutMode::Create)
        .unwrap_err();
    assert!(err.contains("already exists"), "got: {err}");
    let err = checkout_remote_branch_in(repo.path(), "origin/feature/x", "bad name", RemoteCheckoutMode::Create)
        .unwrap_err();
    assert!(err.contains("not a valid branch name"), "got: {err}");
    let err = checkout_remote_branch_in(repo.path(), "origin/nope", "nope", RemoteCheckoutMode::Create)
        .unwrap_err();
    assert!(err.contains("not a remote branch"), "got: {err}");
    let err = checkout_remote_branch_in(repo.path(), "origin/feature/x", "missing", RemoteCheckoutMode::Existing)
        .unwrap_err();
    assert!(err.contains("no local branch"), "got: {err}");
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
}

#[test]
fn checkout_remote_branch_existing_switches_and_fast_forwards() {
    let (remote, repo) = clone_with_remote_branch("remote-existing");
    git(&repo.0, &["branch", "feature/x", "origin/feature/x"]);
    git(&remote.0, &["checkout", "-q", "feature/x"]);
    remote.commit("y.txt", "y\n", "more feature work");
    git(&remote.0, &["checkout", "-q", "main"]);
    fetch_remote_in(repo.path()).expect("fetched");

    checkout_remote_branch_in(repo.path(), "origin/feature/x", "feature/x", RemoteCheckoutMode::Existing)
        .expect("checked out and pulled");

    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/x");
    assert_eq!(
        git_out(&repo.0, &["rev-parse", "HEAD"]),
        git_out(&repo.0, &["rev-parse", "origin/feature/x"]),
        "the local branch caught up"
    );
}

#[test]
fn checkout_remote_branch_existing_keeps_a_diverged_branch_checked_out() {
    let (remote, repo) = clone_with_remote_branch("remote-diverged");
    git(&repo.0, &["branch", "feature/x", "origin/feature/x"]);
    git(&repo.0, &["checkout", "-q", "feature/x"]);
    repo.commit("mine.txt", "m\n", "local only");
    git(&repo.0, &["checkout", "-q", "main"]);
    git(&remote.0, &["checkout", "-q", "feature/x"]);
    remote.commit("theirs.txt", "t\n", "remote only");
    git(&remote.0, &["checkout", "-q", "main"]);
    fetch_remote_in(repo.path()).expect("fetched");

    let err = checkout_remote_branch_in(repo.path(), "origin/feature/x", "feature/x", RemoteCheckoutMode::Existing)
        .unwrap_err();
    assert!(err.contains("could not be pulled"), "got: {err}");
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/x");
}

#[test]
fn create_branch_points_at_the_commit_with_or_without_checkout() {
    let repo = TempRepo::new("create-branch");
    repo.commit("a.txt", "a\n", "first");
    let first = git_out(&repo.0, &["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "second");

    create_branch_in(repo.path(), "old", &first[..7], false).expect("created");
    assert_eq!(git_out(&repo.0, &["rev-parse", "old"]), first);
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "main", "no checkout asked");

    create_branch_in(repo.path(), "feature/y", &first, true).expect("created and checked out");
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/y");
}

#[test]
fn create_branch_refuses_a_taken_name_a_bad_name_and_a_non_hash() {
    let repo = TempRepo::new("create-branch-guard");
    repo.commit("a.txt", "a\n", "first");
    let head = git_out(&repo.0, &["rev-parse", "HEAD"]);

    let err = create_branch_in(repo.path(), "main", &head, false).unwrap_err();
    assert!(err.contains("already exists"), "got: {err}");
    let err = create_branch_in(repo.path(), "bad name", &head, false).unwrap_err();
    assert!(err.contains("not a valid branch name"), "got: {err}");
    let err = create_branch_in(repo.path(), "x", "main", false).unwrap_err();
    assert!(err.contains("is not a commit hash"), "got: {err}");
}

#[test]
fn delete_branch_keeps_an_unmerged_branch_until_forced() {
    let repo = TempRepo::new("delete-branch");
    repo.commit("a.txt", "a\n", "first");
    git(&repo.0, &["branch", "merged"]);
    git(&repo.0, &["checkout", "-q", "-b", "wip"]);
    repo.commit("w.txt", "w\n", "unmerged work");
    git(&repo.0, &["checkout", "-q", "main"]);

    assert_eq!(delete_branch_in(repo.path(), "merged", false, false).unwrap(), DeleteOutcome::Deleted);
    assert!(!local_branch_exists_in(repo.path(), "merged").unwrap());

    assert_eq!(delete_branch_in(repo.path(), "wip", false, false).unwrap(), DeleteOutcome::NotMerged);
    assert!(local_branch_exists_in(repo.path(), "wip").unwrap(), "still there");
    assert_eq!(delete_branch_in(repo.path(), "wip", false, true).unwrap(), DeleteOutcome::Deleted);
    assert!(!local_branch_exists_in(repo.path(), "wip").unwrap());

    let err = delete_branch_in(repo.path(), "main", false, true).unwrap_err();
    assert!(!err.is_empty(), "the checked-out branch cannot be deleted");
    assert!(delete_branch_in(repo.path(), "ghost", false, false).is_err());
}

#[test]
fn delete_branch_removes_a_remote_branch_from_the_remote() {
    let (remote, repo) = clone_with_remote_branch("delete-remote");

    assert_eq!(
        delete_branch_in(repo.path(), "origin/feature/x", true, false).unwrap(),
        DeleteOutcome::Deleted
    );
    let gone = std::process::Command::new("git")
        .args(["rev-parse", "--verify", "-q", "refs/heads/feature/x"])
        .current_dir(&remote.0)
        .output()
        .expect("git ran");
    assert!(!gone.status.success(), "the remote no longer has the branch");
}

#[test]
fn create_tag_is_lightweight_without_a_message_and_annotated_with_one() {
    let repo = TempRepo::new("create-tag");
    repo.commit("a.txt", "a\n", "first");
    let first = git_out(&repo.0, &["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "second");

    create_tag_in(repo.path(), "v0", &first[..7], "").expect("lightweight tag");
    assert_eq!(git_out(&repo.0, &["cat-file", "-t", "v0"]), "commit");
    assert_eq!(git_out(&repo.0, &["rev-parse", "v0^{commit}"]), first);

    create_tag_in(repo.path(), "v1", &first, "  release one  ").expect("annotated tag");
    assert_eq!(git_out(&repo.0, &["cat-file", "-t", "v1"]), "tag");
    assert_eq!(git_out(&repo.0, &["rev-parse", "v1^{commit}"]), first);
    assert!(git_out(&repo.0, &["tag", "-n1", "v1"]).contains("release one"));
}

#[test]
fn create_tag_refuses_a_taken_name_a_bad_name_and_a_non_hash() {
    let repo = TempRepo::new("create-tag-guard");
    repo.commit("a.txt", "a\n", "first");
    let head = git_out(&repo.0, &["rev-parse", "HEAD"]);
    create_tag_in(repo.path(), "v1", &head, "").expect("first tag");

    let err = create_tag_in(repo.path(), "v1", &head, "").unwrap_err();
    assert!(err.contains("already exists"), "got: {err}");
    for bad in ["bad name", "-f", "a..b"] {
        let err = create_tag_in(repo.path(), bad, &head, "").unwrap_err();
        assert!(err.contains("not a valid tag name"), "got: {err}");
    }
    let err = create_tag_in(repo.path(), "x", "main", "").unwrap_err();
    assert!(err.contains("is not a commit hash"), "got: {err}");
}

#[test]
fn delete_tag_removes_a_local_tag_and_refuses_a_missing_one() {
    let repo = TempRepo::new("delete-tag");
    repo.commit("a.txt", "a\n", "first");
    let head = git_out(&repo.0, &["rev-parse", "HEAD"]);
    create_tag_in(repo.path(), "v1", &head, "note").expect("tagged");

    delete_tag_in(repo.path(), "v1").expect("deleted");
    assert!(!tag_exists_in(repo.path(), "v1").unwrap());
    assert!(delete_tag_in(repo.path(), "v1").is_err());
}

#[test]
fn push_tag_and_delete_remote_tag_round_trip_through_origin() {
    let (remote, repo) = clone_with_remote_branch("push-tag");
    let head = git_out(&repo.0, &["rev-parse", "HEAD"]);
    create_tag_in(repo.path(), "v1", &head, "").expect("tagged");
    let remote_has = || {
        std::process::Command::new("git")
            .args(["rev-parse", "--verify", "-q", "refs/tags/v1"])
            .current_dir(&remote.0)
            .output()
            .expect("git ran")
            .status
            .success()
    };
    assert!(!remote_has());

    push_tag_in(repo.path(), "v1", "origin").expect("pushed");
    assert!(remote_has(), "the remote has the tag");

    delete_remote_tag_in(repo.path(), "v1", "origin").expect("deleted on the remote");
    assert!(!remote_has());
    assert!(tag_exists_in(repo.path(), "v1").unwrap(), "the local tag stays");

    assert!(push_tag_in(repo.path(), "ghost", "origin").is_err());
    assert!(push_tag_in(repo.path(), "v1", "nowhere").is_err(), "an unknown remote is refused");
    assert!(delete_remote_tag_in(repo.path(), "v1", "nowhere").is_err());
}

#[test]
fn set_upstream_needs_a_known_remote_and_an_existing_remote_branch() {
    let (_remote, repo) = clone_with_remote_branch("set-upstream");
    git(&repo.0, &["branch", "topic"]);

    set_upstream_in(repo.path(), "topic", "origin", "feature/x").expect("upstream set");
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "topic@{u}"]), "origin/feature/x");

    let err = set_upstream_in(repo.path(), "topic", "origin", "nope").unwrap_err();
    assert!(err.contains("does not exist"), "got: {err}");
    let err = set_upstream_in(repo.path(), "topic", "ghost", "main").unwrap_err();
    assert!(err.contains("no remote named"), "got: {err}");
    let err = set_upstream_in(repo.path(), "ghost", "origin", "main").unwrap_err();
    assert!(err.contains("no local branch"), "got: {err}");
    let err = set_upstream_in(repo.path(), "topic", "origin", "-x").unwrap_err();
    assert!(err.contains("not a valid branch name"), "got: {err}");
}

#[test]
fn push_branch_to_publishes_under_the_chosen_name_and_tracks_it() {
    let (remote, repo) = clone_with_remote_branch("push-to");
    git(&repo.0, &["branch", "topic"]);

    push_branch_to_in(repo.path(), "topic", "origin", "review/topic").expect("pushed");
    let published = std::process::Command::new("git")
        .args(["rev-parse", "refs/heads/review/topic"])
        .current_dir(&remote.0)
        .output()
        .expect("git ran");
    assert!(published.status.success(), "the remote has review/topic");
    assert_eq!(git_out(&repo.0, &["rev-parse", "--abbrev-ref", "topic@{u}"]), "origin/review/topic");

    assert!(push_branch_to_in(repo.path(), "topic", "ghost", "x").is_err());
    assert!(push_branch_to_in(repo.path(), "ghost", "origin", "x").is_err());
}

#[test]
fn push_follows_the_branch_upstream_and_falls_back_to_origin() {
    let (_remote, repo) = clone_with_remote_branch("push-args");
    assert_eq!(push_args_in(repo.path()).unwrap(), ["push", "-u", "origin", "HEAD"], "no upstream yet");

    let second = bare_repo("push-args-second");
    git(&repo.0, &["remote", "add", "mirror", second.to_str().expect("path")]);
    push_branch_to_in(repo.path(), "main", "mirror", "trunk").expect("published");
    assert_eq!(
        push_args_in(repo.path()).unwrap(),
        ["push", "-u", "mirror", "HEAD:refs/heads/trunk"],
        "the upstream's remote and branch name win"
    );
    let _ = std::fs::remove_dir_all(&second);
}

#[test]
fn status_reports_the_upstream_or_an_empty_string() {
    let (_remote, repo) = clone_with_remote_branch("status-upstream");
    assert_eq!(read_status_in(repo.path()).expect("status").upstream, "");

    git(&repo.0, &["branch", "-u", "origin/main"]);
    let info = read_status_in(repo.path()).expect("status");
    assert_eq!(info.upstream, "origin/main");
}

#[test]
fn first_push_falls_back_to_the_only_remote_and_asks_when_it_is_ambiguous() {
    let repo = TempRepo::new("push-fallback");
    repo.commit("a.txt", "a\n", "first");
    let err = push_args_in(repo.path()).unwrap_err();
    assert!(err.contains("no remotes"), "got: {err}");

    let one = bare_repo("push-fallback-one");
    let two = bare_repo("push-fallback-two");
    git(&repo.0, &["remote", "add", "fork", one.to_str().expect("path")]);
    assert_eq!(push_args_in(repo.path()).unwrap(), ["push", "-u", "fork", "HEAD"], "the only remote");

    git(&repo.0, &["remote", "add", "mirror", two.to_str().expect("path")]);
    let err = push_args_in(repo.path()).unwrap_err();
    assert!(err.contains("Push to…"), "got: {err}");

    git(&repo.0, &["remote", "add", "origin", one.to_str().expect("path")]);
    assert_eq!(push_args_in(repo.path()).unwrap(), ["push", "-u", "origin", "HEAD"], "origin wins when present");
    let _ = std::fs::remove_dir_all(&one);
    let _ = std::fs::remove_dir_all(&two);
}
