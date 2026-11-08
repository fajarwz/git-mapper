use base64::Engine as _;

use super::test_support::*;
use super::*;

#[test]
fn wip_files_list_untracked_paths_and_the_binary_hunk() {
    let repo = TempRepo::new("wip");
    repo.commit("tracked.txt", "one\n", "first");

    std::fs::write(repo.0.join("tracked.txt"), "one\ntwo\n").expect("edit");
    std::fs::write(repo.0.join("new.txt"), "l1\nl2\n").expect("untracked text");
    std::fs::write(repo.0.join("blob.bin"), [0u8, 1, 255, 9, 0]).expect("untracked binary");

    let payload = read_commit_files_in(repo.path(), "wip", true).expect("wip payload");
    assert!(payload.name_status.contains("M\ttracked.txt"));
    assert!(payload.numstat.contains("2\t0\tnew.txt"));
    assert!(
        payload.name_status.contains("A\tnew.txt"),
        "`git diff` alone never lists untracked paths"
    );
    assert!(payload.diff.contains("+++ b/new.txt"));
    assert!(payload.numstat.contains("-\t-\tblob.bin"));
    assert!(
        payload.diff.contains("@@ Binary file, not shown @@"),
        "the panel needs a reason for an empty patch"
    );
}

#[test]
fn file_patch_reads_one_path_and_strips_from_the_list_read() {
    let repo = TempRepo::new("lazy");
    repo.commit("one.txt", "one\n", "first");
    std::fs::write(repo.0.join("two.txt"), "t\n").expect("file");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    let second = second.trim().to_string();

    let stripped = read_commit_files_in(repo.path(), &second, false).expect("stripped");
    assert_eq!(stripped.diff, "", "no patch body rides on the list read");
    assert!(stripped.numstat.contains("1\t0\ttwo.txt"));
    assert!(stripped.name_status.contains("A\ttwo.txt"));

    let history = read_file_patch_in(repo.path(), &second, "two.txt").expect("history patch");
    assert!(history.contains("+++ b/two.txt"), "got: {history}");
    assert!(
        !history.contains("one.txt"),
        "a single-path read stays single-path: {history}"
    );
    assert_eq!(
        history,
        read_commit_files_in(repo.path(), &second, true)
            .expect("full")
            .diff
            .split("diff --git")
            .find(|part| part.contains("+++ b/two.txt"))
            .map(|part| format!("diff --git{part}"))
            .expect("the full payload shows two.txt"),
        "the lazy patch is the same lines the full read carried"
    );

    std::fs::write(repo.0.join("new.txt"), "l1\n").expect("untracked written");
    let wip_untracked = read_file_patch_in(repo.path(), "wip", "new.txt").expect("untracked patch");
    assert!(
        wip_untracked.contains("+++ b/new.txt"),
        "got: {wip_untracked}"
    );
    std::fs::write(repo.0.join("one.txt"), "one\ntwo\n").expect("tracked edited");
    let wip_tracked = read_file_patch_in(repo.path(), "wip", "one.txt").expect("tracked patch");
    assert!(wip_tracked.contains("@@"), "got: {wip_tracked}");
}

#[test]
fn commit_files_diff_against_the_first_parent_and_handle_roots_and_renames() {
    let repo = TempRepo::new("files");
    repo.commit("root.txt", "root\n", "root commit");
    let root_hash = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    let root_hash = root_hash.trim().to_string();

    std::fs::write(repo.0.join("other.txt"), "o\n").expect("file");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let second_hash = second_hash.trim().to_string();

    // Root commits diff against the empty tree; the `^1` of a root resolves to nothing.
    let root_files = read_commit_files_in(repo.path(), &root_hash, true).expect("root files");
    assert!(
        root_files.numstat.contains("1\t0\troot.txt"),
        "got: {}",
        root_files.numstat
    );

    let files = read_commit_files_in(repo.path(), &second_hash, true).expect("parent diff");
    assert!(files.name_status.contains("A\tother.txt"));

    // git mv keeps the rename visible.
    git(&repo.0, &["mv", "root.txt", "renamed.txt"]);
    git(&repo.0, &["commit", "-q", "-m", "renamed"]);
    let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let renamed_hash = renamed_hash.trim().to_string();
    let renamed = read_commit_files_in(repo.path(), &renamed_hash, true).expect("renamed files");
    assert!(
        renamed.name_status.contains("R100\troot.txt\trenamed.txt"),
        "got: {}",
        renamed.name_status
    );
}

#[test]
fn image_versions_carry_both_sides_and_fall_back_for_roots_renames_and_wip() {
    let repo = TempRepo::new("images");
    let old_bytes = vec![137u8, 80, 78, 71, 13, 10, 1, 1];
    std::fs::write(repo.0.join("a.png"), &old_bytes).expect("old image written");
    git(&repo.0, &["add", "a.png"]);
    git(&repo.0, &["commit", "-q", "-m", "add image"]);
    let root_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let root_hash = root_hash.trim().to_string();

    // Root commit: the file was born here, so there is no previous copy.
    let root = read_image_versions_in(repo.path(), &root_hash, "a.png").expect("root versions");
    assert!(root.old.is_none(), "a root commit has no old side");
    let new = root.new.expect("new side");
    assert_eq!(new.bytes, old_bytes.len());
    assert!(
        new.url.starts_with("data:image/png;base64,"),
        "got: {}",
        new.url
    );
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(new.url.split_once(',').expect("comma").1)
            .expect("round trip"),
        old_bytes,
        "the data URL carries the exact blob content"
    );

    let new_bytes = vec![255u8, 216, 255, 224, 9, 0];
    std::fs::write(repo.0.join("a.jpg"), &new_bytes).expect("new image written");
    std::fs::remove_file(repo.0.join("a.png")).expect("removed");
    git(&repo.0, &["add", "."]);
    git(&repo.0, &["commit", "-q", "-m", "second"]);
    let second_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let second_hash = second_hash.trim().to_string();

    // Deleted in this commit: only the parent's copy comes back.
    let deleted = read_image_versions_in(repo.path(), &second_hash, "a.png").expect("deleted");
    assert!(deleted.new.is_none(), "the commit deleted the image");
    let old = deleted.old.expect("the parent held the image");
    assert_eq!(old.bytes, old_bytes.len());
    assert_eq!(image_mime("a.png"), "image/png");
    assert_eq!(
        image_mime("photo.JPEG"),
        "image/jpeg",
        "the lookup is case-insensitive"
    );

    // Renamed in this commit: the old blob is found under the source path.
    std::fs::write(repo.0.join("a.jpg").with_extension("jpeg"), &new_bytes).expect("file");
    git(&repo.0, &["mv", "a.jpg", "renamed.jpeg"]);
    git(&repo.0, &["commit", "-q", "-m", "renamed"]);
    let renamed_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    let renamed_hash = renamed_hash.trim().to_string();
    let renamed =
        read_image_versions_in(repo.path(), &renamed_hash, "renamed.jpeg").expect("renamed");
    assert_eq!(
        renamed.old.expect("rename keeps the old blob").bytes,
        new_bytes.len()
    );
    assert_eq!(
        renamed
            .new
            .expect("renamed keeps the blob")
            .url
            .starts_with("data:image/jpeg;base64,"),
        true
    );

    // wip: old side = HEAD's blob, new side = the file on disk.
    let disk_bytes = vec![1u8, 2, 3, 4, 5];
    std::fs::write(repo.0.join("renamed.jpeg"), &disk_bytes).expect("edited on disk");
    let wip = read_image_versions_in(repo.path(), "wip", "renamed.jpeg").expect("wip versions");
    assert_eq!(
        wip.old.expect("HEAD blob").bytes,
        new_bytes.len(),
        "the old side is HEAD's copy"
    );
    assert_eq!(
        wip.new.expect("disk copy").bytes,
        disk_bytes.len(),
        "the new side is the working file"
    );
}

/// A two-parent merge is NOT a stash: no third parent is probed or appended, and the
/// first-parent diff shows the incoming branch's changes, not the merge base's.
#[test]
fn merge_commit_files_stay_first_parent_only() {
    let repo = TempRepo::new("merge");
    repo.commit("base.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("side.txt", "side\n", "side commit");
    git(&repo.0, &["checkout", "-q", "-"]);
    repo.commit("main.txt", "main\n", "main commit");
    git(&repo.0, &["merge", "-q", "--no-ff", "side"]);
    let merge_hash = run_git(repo.path(), &["rev-parse", "HEAD"]).expect("rev-parse");
    // Sanity: the merge really has two parents.
    assert_eq!(
        run_git(repo.path(), &["rev-list", "--parents", "-1", "HEAD"])
            .expect("parents")
            .split_whitespace()
            .count(),
        3
    );

    let files = read_commit_files_in(repo.path(), merge_hash.trim(), true).expect("merge files");
    assert!(
        files.name_status.contains("A\tside.txt"),
        "the first-parent diff carries the merged branch's change: {}",
        files.name_status
    );
    assert!(
        !files.name_status.contains("main.txt"),
        "main.txt was already in the first parent: {}",
        files.name_status
    );
}
