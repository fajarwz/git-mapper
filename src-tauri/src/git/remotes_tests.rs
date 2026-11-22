use super::test_support::*;
use super::*;

#[test]
fn add_list_rename_and_remove_a_remote() {
    let remote = TempRepo::new("remotes-origin");
    remote.commit("a.txt", "a\n", "first");
    let repo = TempRepo::new("remotes");
    repo.commit("b.txt", "b\n", "local");
    assert!(list_remotes_in(repo.path()).unwrap().is_empty());

    add_remote_in(repo.path(), "origin", remote.path()).expect("added");
    let listed = list_remotes_in(repo.path()).unwrap();
    assert_eq!(listed, vec![RemoteInfo { name: "origin".into(), url: remote.path().into() }]);

    fetch_remote_in(repo.path()).expect("fetched");
    rename_remote_in(repo.path(), "origin", "upstream").expect("renamed");
    assert_eq!(list_remotes_in(repo.path()).unwrap()[0].name, "upstream");
    assert!(!git_out(&repo.0, &["branch", "-r"]).contains("origin/"), "tracking refs moved");
    assert!(git_out(&repo.0, &["branch", "-r"]).contains("upstream/main"));

    remove_remote_in(repo.path(), "upstream").expect("removed");
    assert!(list_remotes_in(repo.path()).unwrap().is_empty());
}

#[test]
fn remote_edits_refuse_bad_names_urls_and_missing_remotes() {
    let repo = TempRepo::new("remotes-guard");
    repo.commit("a.txt", "a\n", "first");
    add_remote_in(repo.path(), "origin", "https://example.com/a.git").expect("added");

    let err = add_remote_in(repo.path(), "origin", "https://example.com/b.git").unwrap_err();
    assert!(err.contains("already exists"), "got: {err}");
    for bad in ["", "-f", "has space"] {
        let err = add_remote_in(repo.path(), bad, "https://example.com/c.git").unwrap_err();
        assert!(err.contains("not a valid remote name"), "got: {err}");
    }
    let err = add_remote_in(repo.path(), "x", "--upload-pack=evil").unwrap_err();
    assert!(err.contains("not a valid remote URL"), "got: {err}");
    assert!(add_remote_in(repo.path(), "x", "  ").is_err());

    add_remote_in(repo.path(), "fork", "https://example.com/f.git").expect("added");
    let err = rename_remote_in(repo.path(), "fork", "origin").unwrap_err();
    assert!(err.contains("already exists"), "got: {err}");
    assert!(rename_remote_in(repo.path(), "ghost", "other").is_err());
    assert!(remove_remote_in(repo.path(), "ghost").is_err());
}

#[test]
fn listed_urls_never_carry_a_password() {
    let repo = TempRepo::new("remotes-mask");
    repo.commit("a.txt", "a\n", "first");
    add_remote_in(repo.path(), "origin", "https://me:secret-token@example.com/a/b.git").expect("added");
    add_remote_in(repo.path(), "plain", "git@example.com:a/b.git").expect("added");

    let listed = list_remotes_in(repo.path()).unwrap();
    assert_eq!(listed[0].url, "https://me@example.com/a/b.git");
    assert_eq!(listed[1].url, "git@example.com:a/b.git");
    assert!(!listed.iter().any(|r| r.url.contains("secret")));
}
