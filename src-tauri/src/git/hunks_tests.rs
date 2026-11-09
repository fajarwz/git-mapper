use super::test_support::{TempRepo, git_out};
use super::*;

/// Twenty numbered lines: edits at line 2 and line 19 sit in separate hunks (3 lines of context).
fn numbered() -> String {
    (1..=20).map(|n| format!("line {n}\n")).collect()
}

fn two_hunk_repo(label: &str) -> TempRepo {
    let repo = TempRepo::new(label);
    repo.commit("a.txt", &numbered(), "base");
    let edited = numbered().replace("line 2\n", "line two\n").replace("line 19\n", "line nineteen\n");
    std::fs::write(repo.0.join("a.txt"), edited).expect("edit");
    repo
}

fn header_of(repo: &TempRepo, side: &str, index: usize) -> String {
    let payload = read_wip_side_in(repo.path(), side).expect("side read");
    payload
        .diff
        .lines()
        .filter(|line| line.starts_with("@@ "))
        .nth(index)
        .expect("hunk header")
        .to_string()
}

#[test]
fn stage_hunk_takes_one_of_two_hunks() {
    let repo = two_hunk_repo("hunk-stage");
    let header = header_of(&repo, "unstaged", 1);
    apply_hunk_in(repo.path(), "a.txt", "unstaged", 1, &header, "stage").expect("stage");

    let cached = git_out(&repo.0, &["diff", "--cached", "-U0"]);
    assert!(cached.contains("+line nineteen"), "{cached}");
    assert!(!cached.contains("line two"), "the first hunk stays out of the index");
    let worktree = git_out(&repo.0, &["diff", "-U0"]);
    assert!(worktree.contains("+line two"), "{worktree}");
    assert!(!worktree.contains("line nineteen"), "the staged hunk left the unstaged diff");
}

#[test]
fn unstage_hunk_puts_one_back() {
    let repo = two_hunk_repo("hunk-unstage");
    git_out(&repo.0, &["add", "a.txt"]);
    let header = header_of(&repo, "staged", 0);
    apply_hunk_in(repo.path(), "a.txt", "staged", 0, &header, "unstage").expect("unstage");

    let cached = git_out(&repo.0, &["diff", "--cached", "-U0"]);
    assert!(cached.contains("+line nineteen") && !cached.contains("line two"), "{cached}");
    let worktree = git_out(&repo.0, &["diff", "-U0"]);
    assert!(worktree.contains("+line two"), "the unstaged hunk is back in the worktree diff");
}

#[test]
fn discard_hunk_restores_the_index_copy_of_that_hunk_only() {
    let repo = two_hunk_repo("hunk-discard");
    let header = header_of(&repo, "unstaged", 0);
    apply_hunk_in(repo.path(), "a.txt", "unstaged", 0, &header, "discard").expect("discard");

    let body = std::fs::read_to_string(repo.0.join("a.txt")).expect("read");
    assert!(body.contains("line 2\n") && !body.contains("line two"), "first hunk reverted");
    assert!(body.contains("line nineteen"), "the other hunk's edit survives");
}

#[test]
fn a_stale_hunk_is_refused_not_misapplied() {
    let repo = two_hunk_repo("hunk-stale");
    let header = header_of(&repo, "unstaged", 1);
    // The file changes under the UI: a line is dropped above, shifting every later header.
    let edited = numbered()
        .replacen("line 1\n", "", 1)
        .replace("line 2\n", "line two\n")
        .replace("line 19\n", "line nineteen\n");
    std::fs::write(repo.0.join("a.txt"), edited).expect("edit");
    let err = apply_hunk_in(repo.path(), "a.txt", "unstaged", 1, &header, "stage").unwrap_err();
    assert!(err.contains("changed") || err.contains("gone"), "{err}");
    assert!(git_out(&repo.0, &["diff", "--cached"]).is_empty(), "nothing reached the index");
}

#[test]
fn hunk_verbs_refuse_the_wrong_side() {
    let repo = two_hunk_repo("hunk-side");
    let err = apply_hunk_in(repo.path(), "a.txt", "staged", 0, "@@", "stage").unwrap_err();
    assert!(err.contains("cannot"), "{err}");
}

#[test]
fn untracked_file_is_one_hunk_so_stage_and_discard_take_it_whole() {
    let repo = TempRepo::new("hunk-untracked");
    repo.commit("a.txt", "a\n", "base");
    std::fs::write(repo.0.join("new.txt"), "x\ny\n").expect("new file");
    let header = header_of(&repo, "unstaged", 0);
    apply_hunk_in(repo.path(), "new.txt", "unstaged", 0, &header, "stage").expect("stage");
    assert!(git_out(&repo.0, &["diff", "--cached", "--name-only"]).contains("new.txt"));

    std::fs::write(repo.0.join("other.txt"), "z\n").expect("second file");
    apply_hunk_in(repo.path(), "other.txt", "unstaged", 0, "", "discard").expect("discard");
    assert!(!repo.0.join("other.txt").exists(), "an untracked discard deletes the file");
}

#[test]
fn crlf_files_and_missing_final_newlines_survive_a_hunk_stage() {
    let repo = TempRepo::new("hunk-crlf");
    let base: String = (1..=20).map(|n| format!("row {n}\r\n")).collect();
    repo.commit("c.txt", &base, "base");
    let edited = base.replace("row 2\r\n", "row two\r\n").replace("row 20\r\n", "row twenty");
    std::fs::write(repo.0.join("c.txt"), &edited).expect("edit");

    let header = header_of(&repo, "unstaged", 1);
    apply_hunk_in(repo.path(), "c.txt", "unstaged", 1, &header, "stage").expect("stage");
    let staged = git_out(&repo.0, &["show", ":c.txt"]);
    assert!(staged.contains("row twenty"), "{staged:?}");
    assert!(staged.contains("row 2\r"), "the unstaged hunk's line stays as committed");
}

#[test]
fn side_reads_split_staged_from_unstaged() {
    let repo = two_hunk_repo("hunk-sides");
    let header = header_of(&repo, "unstaged", 0);
    apply_hunk_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage").expect("stage");
    let staged = read_wip_side_in(repo.path(), "staged").expect("staged");
    let unstaged = read_wip_side_in(repo.path(), "unstaged").expect("unstaged");
    assert!(staged.diff.contains("+line two") && !staged.diff.contains("nineteen"));
    assert!(unstaged.diff.contains("+line nineteen") && !unstaged.diff.contains("line two"));
    assert!(read_wip_side_in(repo.path(), "bogus").is_err());
}

/// One hunk holding three unrelated edits: lines 2, 3 and 4 become x2, x3, x4 (changed lines 0-5
/// are -2 +x2 ... in hunk order: remove-add pairs are grouped as -2 -3 -4 +x2 +x3 +x4).
fn one_hunk_repo(label: &str) -> TempRepo {
    let repo = TempRepo::new(label);
    repo.commit("a.txt", &numbered(), "base");
    let edited = numbered()
        .replace("line 2\n", "x2\n")
        .replace("line 3\n", "x3\n")
        .replace("line 4\n", "x4\n");
    std::fs::write(repo.0.join("a.txt"), edited).expect("edit");
    repo
}

#[test]
fn stage_lines_takes_only_the_chosen_lines_of_a_hunk() {
    let repo = one_hunk_repo("lines-stage");
    let header = header_of(&repo, "unstaged", 0);
    // -line 2 (0), -line 3 (1), -line 4 (2), +x2 (3), +x3 (4), +x4 (5): pick the x3 swap.
    apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage", &[1, 4]).expect("stage");

    let staged = git_out(&repo.0, &["show", ":a.txt"]);
    assert!(staged.contains("line 2\n") && staged.contains("x3\n") && staged.contains("line 4\n"), "{staged}");
    assert!(!staged.contains("line 3\n") && !staged.contains("x2") && !staged.contains("x4"), "{staged}");
    let rest = git_out(&repo.0, &["diff", "-U0"]);
    assert!(rest.contains("+x2") && rest.contains("+x4") && !rest.contains("+x3"), "{rest}");
}

#[test]
fn unstage_lines_puts_only_the_chosen_lines_back() {
    let repo = one_hunk_repo("lines-unstage");
    git_out(&repo.0, &["add", "a.txt"]);
    let header = header_of(&repo, "staged", 0);
    apply_hunk_lines_in(repo.path(), "a.txt", "staged", 0, &header, "unstage", &[1, 4]).expect("unstage");

    let staged = git_out(&repo.0, &["show", ":a.txt"]);
    assert!(staged.contains("x2\n") && staged.contains("line 3\n") && staged.contains("x4\n"), "{staged}");
    let worktree = std::fs::read_to_string(repo.0.join("a.txt")).expect("read");
    assert!(worktree.contains("x3\n"), "the disk copy is untouched");
}

#[test]
fn discard_lines_reverts_only_the_chosen_lines_on_disk() {
    let repo = one_hunk_repo("lines-discard");
    let header = header_of(&repo, "unstaged", 0);
    apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "discard", &[1, 4]).expect("discard");

    let body = std::fs::read_to_string(repo.0.join("a.txt")).expect("read");
    assert!(body.contains("x2\n") && body.contains("line 3\n") && body.contains("x4\n"), "{body}");
    assert!(!body.contains("x3"), "{body}");
}

#[test]
fn a_lone_added_line_can_be_picked_out_of_a_block() {
    let repo = TempRepo::new("lines-add-only");
    repo.commit("a.txt", "one\ntwo\n", "base");
    std::fs::write(repo.0.join("a.txt"), "one\nA\nB\ntwo\n").expect("edit");
    let header = header_of(&repo, "unstaged", 0);
    apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage", &[1]).expect("stage");
    assert_eq!(git_out(&repo.0, &["show", ":a.txt"]), "one\nB\ntwo");
}

#[test]
fn line_selection_is_validated() {
    let repo = one_hunk_repo("lines-invalid");
    let header = header_of(&repo, "unstaged", 0);
    let none = apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage", &[]);
    assert!(none.unwrap_err().contains("at least one"));
    let beyond = apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage", &[99]);
    assert!(beyond.unwrap_err().contains("at least one"));
    assert!(git_out(&repo.0, &["diff", "--cached"]).is_empty(), "nothing reached the index");
}

#[test]
fn lines_are_refused_for_new_files() {
    let repo = TempRepo::new("lines-new-file");
    repo.commit("a.txt", "a\n", "base");
    std::fs::write(repo.0.join("n.txt"), "x\ny\n").expect("new");
    let err = apply_hunk_lines_in(repo.path(), "n.txt", "unstaged", 0, "@@ -0,0 +1,2 @@", "stage", &[0])
        .unwrap_err();
    assert!(err.contains("new file"), "{err}");

    git_out(&repo.0, &["add", "n.txt"]);
    let header = header_of(&repo, "staged", 0);
    let staged = apply_hunk_lines_in(repo.path(), "n.txt", "staged", 0, &header, "unstage", &[0]);
    assert!(staged.unwrap_err().contains("both sides"));
}

#[test]
fn stage_lines_keeps_a_missing_final_newline_with_its_line() {
    let repo = TempRepo::new("lines-eof");
    repo.commit("a.txt", "one\ntwo\nthree", "base");
    std::fs::write(repo.0.join("a.txt"), "ONE\ntwo\nTHREE").expect("edit");
    let header = header_of(&repo, "unstaged", 0);
    // -one -three\ No newline +ONE +THREE\ No newline: take only the first swap.
    apply_hunk_lines_in(repo.path(), "a.txt", "unstaged", 0, &header, "stage", &[0, 1]).expect("stage");
    assert_eq!(git_out(&repo.0, &["show", ":a.txt"]), "ONE\ntwo\nthree");
}
