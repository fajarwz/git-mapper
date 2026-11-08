//! Fixtures shared by every `*_tests.rs`: throwaway repos driven by the real `git` CLI.
use std::path::{Path, PathBuf};
use std::process::Command;

use super::*;

/// A throw-away repository on disk, real `git` CLI driving every command below it.
pub(super) struct TempRepo(pub(super) PathBuf);

pub(super) fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git ran");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Identity and line-ending settings every fixture needs. A fresh clone carries
/// its own config, so this runs again right after `git clone`.
pub(super) fn set_identity(dir: &Path) {
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

impl TempRepo {
    pub(super) fn new(label: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("git-mapper-test-{}-{label}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp repo created");
        // Pin the branch name: `git init` still defaults to master on some machines
        // (the GitHub ubuntu runner does) and every expectation below names main.
        git(&dir, &["init", "-q", "-b", "main"]);
        set_identity(&dir);
        TempRepo(dir)
    }

    pub(super) fn path(&self) -> &str {
        self.0.to_string_lossy().replace('\\', "/").leak()
    }

    pub(super) fn commit(&self, file: &str, body: &str, message: &str) {
        std::fs::write(self.0.join(file), body).expect("file written");
        git(&self.0, &["add", file]);
        git(&self.0, &["commit", "-q", "-m", message]);
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git ran");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}
pub(super) fn records_of(raw: &str) -> Vec<Vec<String>> {
    raw.split('\u{1e}')
        .filter(|r| !r.trim().is_empty())
        .map(|r| r.trim_matches('\n').split('\0').map(String::from).collect())
        .collect()
}
/// A repository with a two-side edit conflict on `a.txt`, merge in progress.
pub(super) fn conflicting_repo(label: &str) -> TempRepo {
    let repo = TempRepo::new(label);
    repo.commit("a.txt", "base\n", "base");
    git(&repo.0, &["checkout", "-q", "-b", "side"]);
    repo.commit("a.txt", "side\n", "side edit");
    git(&repo.0, &["checkout", "-q", "main"]);
    repo.commit("a.txt", "main\n", "main edit");
    let merged = Command::new("git")
        .args(["merge", "side", "--no-edit"])
        .current_dir(&repo.0)
        .output()
        .expect("merge ran");
    assert!(!merged.status.success(), "the merge must conflict");
    repo
}

/// Fresh porcelain v2 status text (NUL-separated), straight from git.
pub(super) fn gs_v2(dir: &str) -> String {
    run_git(dir, &["status", "--porcelain=v2", "--untracked-files=all", "-z"])
        .unwrap_or_default()
}

/// A bare repository to push/pull against: a local-path remote, no network.
pub(super) fn bare_repo(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-mapper-test-{}-{label}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("bare repo created");
    Command::new("git")
        .args(["init", "--bare", "-q", "-b", "main"])
        .current_dir(&dir)
        .output()
        .expect("git ran");
    dir
}
