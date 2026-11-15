use super::submodules::parse_submodule_status;
use super::test_support::*;
use super::*;

#[test]
fn parses_every_state_and_keeps_paths_with_spaces() {
    let raw = " 1111111111111111111111111111111111111111 libs/api (heads/main)\n\
               +2222222222222222222222222222222222222222 libs/web (v1-3-gabc)\n\
               -3333333333333333333333333333333333333333 vendor/not cloned\n\
               U4444444444444444444444444444444444444444 libs/clash (heads/x)\n";
    let parsed = parse_submodule_status(raw);
    let seen: Vec<(&str, &str)> = parsed
        .iter()
        .map(|sub| (sub.path.as_str(), sub.state.as_str()))
        .collect();
    assert_eq!(
        seen,
        vec![
            ("libs/api", "ok"),
            ("libs/web", "moved"),
            ("vendor/not cloned", "uninitialized"),
            ("libs/clash", "conflict"),
        ]
    );
    assert_eq!(parsed[0].commit, "1".repeat(40));
}

#[test]
fn repository_without_gitmodules_has_none() {
    let repo = TempRepo::new("subs-none");
    repo.commit("a.txt", "a\n", "first");
    assert!(read_submodules_in(repo.path()).unwrap().is_empty());
}

#[test]
fn reads_a_real_submodule_and_notices_it_moving() {
    let inner = TempRepo::new("subs-inner");
    inner.commit("lib.txt", "one\n", "inner one");
    let outer = TempRepo::new("subs-outer");
    outer.commit("a.txt", "a\n", "outer one");
    // A local-path submodule needs file transport allowed on modern git.
    git(
        &outer.0,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            inner.path(),
            "vendor/inner",
        ],
    );
    git(&outer.0, &["commit", "-q", "-m", "add submodule"]);

    let listed = read_submodules_in(outer.path()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, "vendor/inner");
    assert_eq!(listed[0].state, "ok");
    assert_eq!(listed[0].commit, git_out(&inner.0, &["rev-parse", "HEAD"]));

    // A new commit inside the submodule leaves the recorded pointer behind: "moved".
    let checked_out = outer.0.join("vendor/inner");
    set_identity(&checked_out);
    std::fs::write(checked_out.join("lib.txt"), "two\n").unwrap();
    git(&checked_out, &["commit", "-q", "-am", "inner two"]);
    assert_eq!(read_submodules_in(outer.path()).unwrap()[0].state, "moved");
}
