use super::test_support::*;
use super::*;

#[test]
fn read_log_records_keep_field_and_record_separators() {
    let repo = TempRepo::new("log");
    repo.commit("one.txt", "one\n", "first: one");
    repo.commit("two.txt", "two\n", "second: two");

    let raw = read_log_in(repo.path(), 10, 0).expect("log read");
    let records = records_of(&raw);
    assert_eq!(records.len(), 2, "one record per commit, newest first");
    let head = run_git(repo.path(), &["rev-parse", "--verify", "HEAD"]).expect("rev-parse");
    assert_eq!(
        records[0][1].trim_start_matches('\n'),
        head.trim(),
        "the hash field is the commit sha"
    );
    assert!(
        records[0][6].contains("second: two"),
        "%B lands in the last field"
    );
}

#[test]
fn read_log_order_matches_read_log_shape_and_delta_excludes_the_since_base() {
    let repo = TempRepo::new("delta");
    repo.commit("one.txt", "one\n", "first");
    let old_head = read_log_order_in(repo.path(), 10).expect("ordering read");
    repo.commit("two.txt", "two\n", "second");

    let order = read_log_order_in(repo.path(), 10).expect("ordering read");
    let lines: Vec<&str> = order.lines().collect();
    assert_eq!(lines.len(), 2, "one line per commit, nothing else");
    let raw = read_log_in(repo.path(), 10, 0).expect("log read");
    let hashes: Vec<String> = records_of(&raw)
        .iter()
        .map(|r| r[1].trim_start_matches('\n').to_string())
        .collect();
    assert_eq!(
        hashes, lines,
        "read_log and read_log_order describe the same window"
    );

    let delta = read_log_delta_in(repo.path(), old_head.trim(), 500).expect("delta read");
    let delta_hashes: Vec<String> = records_of(&delta)
        .iter()
        .map(|r| r[1].trim_start_matches('\n').to_string())
        .collect();
    assert_eq!(
        delta_hashes,
        vec![lines[0]],
        "only the commit newer than `since` comes back"
    );
}

#[test]
fn read_log_excludes_the_stash_stack() {
    let repo = TempRepo::new("stash");
    repo.commit("one.txt", "one\n", "first");
    std::fs::write(repo.0.join("one.txt"), "two\n").expect("edit");
    git(&repo.0, &["stash", "-q"]);
    let stash_hash = run_git(repo.path(), &["rev-parse", "refs/stash"]).expect("stash ref");
    repo.commit("two.txt", "two\n", "second");

    for raw in [
        read_log_in(repo.path(), 10, 0).expect("log read"),
        read_log_order_in(repo.path(), 10).expect("order read"),
    ] {
        assert!(
            !raw.contains(&stash_hash),
            "the stash commit must stay out of history: {raw}"
        );
    }

    let stashes = read_stashes_in(repo.path()).expect("stash read");
    let records = records_of(&stashes);
    assert_eq!(
        records.len(),
        1,
        "the reflog is the only view over every entry"
    );
    assert!(
        records[0][0]
            .trim_start_matches('\n')
            .starts_with("stash@{")
    );
    assert_eq!(records[0][1], stash_hash.trim());
}
