use super::test_support::*;
use super::*;

#[test]
fn push_publishes_the_branch_and_sets_the_upstream() {
    let origin = bare_repo("push-origin");
    let repo = TempRepo::new("push-work");
    repo.commit("base.txt", "base\n", "base");
    git(
        &repo.0,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("origin path"),
        ],
    );

    tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
        .expect("the first push publishes and sets the upstream");
    repo.commit("more.txt", "more\n", "second");
    tauri::async_runtime::block_on(push_branch(repo.path().to_string()))
        .expect("a later push is a plain update");

    let pushed = run_git(
        origin.to_str().expect("origin path"),
        &["rev-parse", "HEAD"],
    )
    .expect("origin read");
    let local = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("local read");
    assert_eq!(
        pushed.trim(),
        local.trim(),
        "origin carries the pushed commit"
    );
    let upstream =
        run_git(repo.path(), &["rev-parse", "--abbrev-ref", "@{u}"]).expect("upstream read");
    assert!(
        upstream.trim().starts_with("origin/"),
        "`-u` set the upstream"
    );
    let _ = std::fs::remove_dir_all(&origin);
}

#[test]
fn pull_fast_forwards_and_refuses_a_diverged_branch() {
    let origin = bare_repo("pull-origin");
    let work = TempRepo::new("pull-work");
    work.commit("base.txt", "base\n", "base");
    git(
        &work.0,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("origin path"),
        ],
    );
    tauri::async_runtime::block_on(push_branch(work.path().to_string())).expect("the seed push");

    // A second clone plays the other machine: it commits and pushes.
    let other = work.0.parent().unwrap().join("pull-other");
    git(
        &work.0.parent().unwrap().to_path_buf(),
        &[
            "clone",
            "-q",
            origin.to_str().unwrap(),
            other.to_str().unwrap(),
        ],
    );
    set_identity(&other);
    std::fs::write(other.join("theirs.txt"), "theirs\n").expect("file written");
    git(&other, &["add", "theirs.txt"]);
    git(&other, &["commit", "-q", "-m", "theirs"]);

    tauri::async_runtime::block_on(pull_branch(work.path().to_string()))
        .expect("the fast-forward pull");
    let head = run_git(work.path(), &["rev-parse", "HEAD"]).expect("head read");
    let upstream = run_git(work.path(), &["rev-parse", "@{u}"]).expect("upstream read");
    assert_eq!(
        head.trim(),
        upstream.trim(),
        "the pull caught the other machine's commit"
    );

    // Diverged: both sides commit; ff-only refuses instead of merging in a viewer.
    work.commit("ours.txt", "ours\n", "ours");
    std::fs::write(other.join("theirs2.txt"), "t\n").expect("file written");
    git(&other, &["add", "theirs2.txt"]);
    git(&other, &["commit", "-q", "-m", "theirs 2"]);
    git(&other, &["push", "-q"]);
    assert!(
        tauri::async_runtime::block_on(pull_branch(work.path().to_string())).is_err(),
        "a diverged pull must be refused, not merged"
    );

    let _ = std::fs::remove_dir_all(&other);
    let _ = std::fs::remove_dir_all(&origin);
}
