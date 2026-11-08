use std::process::Command;

use super::test_support::*;
use super::*;

#[test]
fn merge_branch_lands_clean_and_reports_conflicts() {
    let repo = TempRepo::new("merge-clean");
    repo.commit("a.txt", "a\\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("side.txt", "s\\n", "side work");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("b.txt", "b\\n", "main work");

    let landed = merge_branch_in(repo.path(), "side").expect("the merge ran");
    assert!(landed.merged, "a clean merge lands");
    assert!(landed.conflicts.is_empty());
    // `rev-list --parents -1`: the tip's line lists both parents.
    assert_eq!(
        git_out(&repo.0, &["rev-list", "--parents", "-1", "HEAD"])
            .split_whitespace()
            .count()
            - 1,
        2,
        "the tip is a two-parent merge"
    );

    // A conflicting merge reports its unmerged paths instead of failing the command:
    // the UI re-reads the rail from the returned list and offers actions.
    let conflicted = conflicting_repo("merge-conflict-outcome");
    let outcome = merge_branch_in(conflicted.path(), "side").expect("the merge ran");
    assert!(!outcome.merged);
    assert_eq!(outcome.conflicts, vec!["a.txt".to_string()]);
}

#[test]
fn resolve_takes_ours_or_theirs_and_stages_it() {
    let ours = conflicting_repo("resolve-ours");
    resolve_conflicts_in(ours.path(), &["a.txt".into()], "ours").expect("ours resolved");
    assert_eq!(
        std::fs::read_to_string(ours.0.join("a.txt")).expect("file"),
        "main\n"
    );
    assert!(!gs_v2(ours.path()).contains("a.txt"), "the index is resolved");

    let theirs = conflicting_repo("resolve-theirs");
    resolve_conflicts_in(theirs.path(), &["a.txt".into()], "theirs").expect("theirs resolved");
    assert_eq!(
        std::fs::read_to_string(theirs.0.join("a.txt")).expect("file"),
        "side\n"
    );

    // A clean repository has no sides to take — the command refuses with the scene.
    let clean = TempRepo::new("resolve-clean");
    clean.commit("a.txt", "a\\n", "base");
    let err =
        resolve_conflicts_in(clean.path(), &["a.txt".into()], "ours").unwrap_err();
    assert!(!err.is_empty());
    // And a made-up side never reaches git.
    assert!(resolve_conflicts_in(clean.path(), &[], "inside").is_err());
}

#[test]
fn abort_and_complete_move_the_merge_state() {
    // Guard first: no merge in progress, nothing to abort or complete.
    let clean = TempRepo::new("merge-absent");
    clean.commit("a.txt", "a\\n", "base");
    assert!(abort_merge_in(clean.path()).is_err());
    assert!(complete_merge_in(clean.path()).is_err());

    let repo = conflicting_repo("abort");
    abort_merge_in(repo.path()).expect("the merge aborted");
    assert!(run_git(repo.path(), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    assert_eq!(
        std::fs::read_to_string(repo.0.join("a.txt")).expect("file"),
        "main\n"
    );

    // Completing refuses while any path is unresolved; after a full resolve it commits
    // with git's own merge message, no editor involved.
    let repo = conflicting_repo("complete");
    assert!(complete_merge_in(repo.path()).is_err(), "conflicts remain");
    resolve_conflicts_in(repo.path(), &["a.txt".into()], "ours").expect("ours resolved");
    complete_merge_in(repo.path()).expect("the merge completed");
    assert!(run_git(repo.path(), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    assert_eq!(git_out(&repo.0, &["log", "--format=%s", "-1"]), "Merge branch 'side'");
}

#[test]
fn read_conflict_files_returns_both_sides() {
    let repo = conflicting_repo("conflict-payload");
    let snap = read_conflict_files_in(repo.path(), "a.txt").expect("conflict read");
    assert!(
        snap.ours_patch.contains("-base"),
        "diff of stage1 -> stage2: {}",
        snap.ours_patch
    );
    assert!(snap.ours_patch.contains("+main"));
    assert!(snap.theirs_patch.contains("+side"));

    // The file on disk mid-conflict still holds git's markers, verbatim.
    assert!(
        snap.worktree_text.contains("<<<<<<< HEAD\nmain\n=======\nside\n>>>>>>> side"),
        "worktree: {}",
        snap.worktree_text
    );

    assert_eq!(snap.incoming, "side", "the merged branch, named from git's merge message");

    // A path outside the conflict list has no stages at all — everything empty, not an error.
    let absent = read_conflict_files_in(repo.path(), "missing.txt").expect("absent is empty");
    assert!(
        absent.ours_patch.is_empty()
            && absent.theirs_patch.is_empty()
            && absent.worktree_text.is_empty()
    );
}

#[test]
fn write_conflict_resolution_stages_only_a_marker_free_file() {
    let repo = conflicting_repo("conflict-write");
    // Markers left: the text lands on disk but the path stays unmerged.
    write_conflict_resolution_in(repo.path(), "a.txt", "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> side\n")
        .expect("partial write");
    assert!(unmerged_paths_of(&run_git(repo.path(), &["status", "-sb"]).unwrap()).contains(&"a.txt".to_string()));

    write_conflict_resolution_in(repo.path(), "a.txt", "main\nside\n").expect("full write");
    assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).expect("file"), "main\nside\n");
    assert!(unmerged_paths_of(&run_git(repo.path(), &["status", "-sb"]).unwrap()).is_empty());
    complete_merge_in(repo.path()).expect("the merge completes on the hand-made result");

    // A path git does not list as conflicted is never written.
    assert!(write_conflict_resolution_in(repo.path(), "other.txt", "x").is_err());
}

#[test]
fn read_conflict_files_synthesizes_both_added_sides() {
    let repo = TempRepo::new("conflict-add-add");
    repo.commit("a.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("both.txt", "from side\n", "side adds");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("both.txt", "from main\n", "main adds");
    let merged = Command::new("git")
        .args(["merge", "side", "--no-edit"])
        .current_dir(&repo.0)
        .output()
        .expect("merge ran");
    assert!(!merged.status.success(), "the merge must conflict");

    // No base stage means no git patch for either side, so both arrive synthesized as additions
    // rather than empty (which the panel would read as "that side deleted it").
    let snap = read_conflict_files_in(repo.path(), "both.txt").expect("conflict read");
    assert!(
        snap.ours_patch.contains("+from main"),
        "ours: {}",
        snap.ours_patch
    );
    assert!(
        snap.theirs_patch.contains("+from side"),
        "theirs: {}",
        snap.theirs_patch
    );
    assert!(
        snap.worktree_text.contains("<<<<<<< HEAD"),
        "worktree: {}",
        snap.worktree_text
    );
}
