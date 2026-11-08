use super::test_support::*;
use super::*;

#[test]
fn undo_commit_returns_the_tip_to_the_index() {
    let repo = TempRepo::new("undo-commit");
    repo.commit("a.txt", "a\n", "first");
    repo.commit("b.txt", "b\n", "second");
    let tip = git_out(&repo.0, &["rev-parse", "HEAD"]);

    undo_commit_in(repo.path()).expect("the undo ran");

    // HEAD stepped back and the tip left HEAD's history entirely…
    assert_ne!(
        git_out(&repo.0, &["rev-parse", "HEAD"]),
        tip,
        "HEAD moved back"
    );
    assert!(
        !git_out(&repo.0, &["rev-list", "HEAD"]).contains(&tip),
        "the tip is no longer in HEAD's history"
    );
    // …but nothing was lost: the tip's file is back STAGED (index has it, HEAD does not,
    // the worktree still matches the index).
    assert_eq!(
        git_out(&repo.0, &["diff", "--cached", "--name-only"]),
        "b.txt",
        "the tip's file came back staged"
    );
    assert!(
        git_out(&repo.0, &["diff", "--name-only"]).trim().is_empty(),
        "the worktree matches the index — no unstaged fallout"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("b.txt")).expect("file"),
        "b\n"
    );
}

#[test]
fn discard_refuses_unmerged_paths() {
    let repo = conflicting_repo("discard-conflict");
    let err = discard_files_in(repo.path(), &["a.txt".to_string()]).unwrap_err();
    assert!(err.contains("unmerged"), "got: {err}");
    // Nothing was acted on: the file still reads as conflicted afterwards.
    assert!(gs_v2(repo.path()).contains("u "));
}

#[test]
fn undo_commit_refuses_root_and_merge_tips() {
    // The root commit has nothing to undo ONTO; a soft reset there is undefined.
    let root = TempRepo::new("undo-root");
    root.commit("a.txt", "a\n", "only");
    let err = undo_commit_in(root.path()).unwrap_err();
    assert!(err.contains("root"), "got: {err}");

    // A merge tip has two parents: `HEAD~1` (first parent) would strand the merged
    // branch behind, so the command refuses rather than half-explaining the undo.
    let repo = TempRepo::new("undo-merge");
    repo.commit("a.txt", "a\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    std::fs::write(repo.0.join("side.txt"), "s\n").expect("side file");
    git(&repo.0, &["add", "side.txt"]);
    git(&repo.0, &["commit", "-q", "-m", "side work"]);
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("b.txt", "b\n", "main work");
    git(&repo.0, &["merge", "-q", "--no-ff", "side", "-m", "merge"]);
    let err = undo_commit_in(repo.path()).unwrap_err();
    assert!(err.contains("merge"), "got: {err}");
}

#[test]
fn staging_writes_commit_unstage_and_walk_renames_back() {
    let repo = TempRepo::new("staging-writes");
    repo.commit("a.txt", "a\n", "c1");

    // Stage a modification and commit it: HEAD moves, worktree is clean.
    std::fs::write(repo.0.join("a.txt"), "b\n").expect("edit");
    stage_files_in(repo.path(), &["a.txt".into()]).expect("add");
    commit_staged_in(repo.path(), "made from the rail").expect("commit");
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .is_empty()
    );
    let log = git_out(&repo.0, &["log", "--format=%s", "-1"]);
    assert_eq!(log.trim(), "made from the rail");

    // Unstage an index-only add: the file stays on disk as untracked.
    std::fs::write(repo.0.join("b.txt"), "staged but uncommitted\n").expect("new file");
    stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .iter()
            .any(|e| e.staged)
    );
    unstage_files_in(repo.path(), &["b.txt".into()]).expect("unstage");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "b.txt" && e.untracked)
    );
    assert!(!snap.entries.iter().any(|e| e.staged));

    // A staged rename unstage walks the file back to its original name. The rename
    // source must live in HEAD for git to report it as `2 R`; stage + commit first.
    stage_files_in(repo.path(), &["b.txt".into()]).expect("re-add");
    commit_staged_in(repo.path(), "add b.txt").expect("commit b");
    git(&repo.0, &["mv", "b.txt", "moved.txt"]);
    unstage_files_in(repo.path(), &["moved.txt".into()]).expect("rename unstage");
    assert!(
        repo.0.join("b.txt").exists(),
        "the file is back at its original name"
    );
    assert!(
        !repo.0.join("moved.txt").exists(),
        "the rename destination is gone"
    );
    let snap = read_worktree_files_in(repo.path()).expect("read");
    assert!(
        snap.entries.is_empty(),
        "the unstage leaves a clean state: {:?}",
        snap.entries
    );
}

#[test]
fn discard_classifies_untracked_index_adds_and_tracked_paths() {
    let repo = TempRepo::new("discard");
    repo.commit("a.txt", "a\n", "c1");
    std::fs::create_dir_all(repo.0.join("sub/nested")).expect("dir");
    repo.commit("sub/nested/deep.txt", "deep\n", "c2");

    // A tracked modification goes back to HEAD's text; an untracked file is deleted.
    std::fs::write(repo.0.join("a.txt"), "changed\n").expect("edit");
    std::fs::write(repo.0.join("sub/nested/deep.txt"), "deep edit\n").expect("nested edit");
    std::fs::write(repo.0.join("tossed.txt"), "doomed\n").expect("untracked file");
    discard_files_in(
        repo.path(),
        &[
            "a.txt".into(),
            "sub/nested/deep.txt".into(),
            "tossed.txt".into(),
        ],
    )
    .expect("discard");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.0.join("sub/nested/deep.txt")).expect("file"),
        "deep\n",
        "nested paths restore too — HEAD's tree is read recursively, not top-level only"
    );
    assert!(
        !repo.0.join("tossed.txt").exists(),
        "untracked files are removed from disk"
    );

    // An index-only add is unstaged, NOT deleted: the content survives as untracked.
    std::fs::write(repo.0.join("b.txt"), "precious\n").expect("new file");
    stage_files_in(repo.path(), &["b.txt".into()]).expect("add");
    discard_files_in(repo.path(), &["b.txt".into()]).expect("discard");
    let listing: Vec<_> = std::fs::read_dir(&repo.0)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        repo.0.join("b.txt").exists(),
        "the staged-only add is not wiped from disk"
    );

    // Discard-all: every tracked change resets and untracked paths (with dirs) disappear.
    std::fs::write(repo.0.join("a.txt"), "dirty\n").expect("edit");
    std::fs::create_dir(repo.0.join("untracked-dir")).expect("dir");
    std::fs::write(repo.0.join("untracked-dir/x.txt"), "x\n").expect("nested");
    discard_all_in(repo.path()).expect("discard all");
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "a\n"
    );
    assert!(
        !repo.0.join("untracked-dir").exists(),
        "clean -fd removes untracked dirs"
    );
    assert!(
        !repo.0.join("b.txt").exists(),
        "b.txt stayed untracked after its unstage, so it goes"
    );
    assert!(
        read_worktree_files_in(repo.path())
            .expect("read")
            .entries
            .is_empty()
    );
}

#[test]
fn a_partial_commit_of_staged_files_keeps_the_worktree_copy() {
    // A README-style workflow: stage half of a dirty pair, commit, the other half stays.
    let repo = TempRepo::new("partial");
    repo.commit("one.txt", "one\n", "c1");
    repo.commit("two.txt", "two\n", "c2");

    std::fs::write(repo.0.join("one.txt"), "one edit\n").expect("edit");
    stage_files_in(repo.path(), &["one.txt".into()]).expect("add");
    std::fs::write(repo.0.join("one.txt"), "one edit more\n").expect("edit after staging");
    std::fs::write(repo.0.join("two.txt"), "two edit\n").expect("edit");

    commit_staged_in(repo.path(), "one of two").expect("commit");
    let snap = read_worktree_files_in(repo.path()).expect("read");
    // one.txt: the index copy was consumed by the commit; the later disk edit remains.
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "one.txt" && e.status == "modified")
    );
    assert!(
        snap.entries
            .iter()
            .any(|e| e.path == "two.txt" && e.status == "modified")
    );
    // The commit only carried the staged copy.
    let head = git_out(&repo.0, &["show", "HEAD:one.txt"]);
    assert_eq!(head.trim(), "one edit");
}
