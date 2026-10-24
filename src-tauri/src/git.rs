use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct StatusInfo {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    /// True when the working tree has any change (staged, unstaged or untracked).
    pub dirty: bool,
}

#[derive(Serialize)]
pub struct FilePayload {
    pub numstat: String,
    pub name_status: String,
    pub diff: String,
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
        .and_then(|out| {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        })
}

#[tauri::command]
pub fn open_repository(dir: &str) -> Result<RepoInfo, String> {
    let inside = run_git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    if inside.trim() != "true" {
        return Err(format!("{} is not a Git repository", dir));
    }
    let path = run_git(dir, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    // Git prints Windows paths with forward slashes from MSYS builds
    // (C:/DATA/lab/x); keep that form so path comparisons stay consistent.
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(RepoInfo { path, name })
}

#[tauri::command]
pub fn read_status(dir: &str) -> Result<StatusInfo, String> {
    let out = run_git(dir, &["status", "-sb"])?;
    // First line: "## main...origin/main [ahead 1, behind 2]" with any piece optional.
    let mut info = StatusInfo {
        branch: String::new(),
        ahead: 0,
        behind: 0,
        dirty: out.lines().any(|l| !l.starts_with("## ")),
    };
    if let Some(line) = out.lines().find(|l| l.starts_with("## ")) {
        let head = line.trim_start_matches("## ");
        // Branch name may contain dots; the upstream is after "..." and the counts in brackets.
        let (branch_part, tail) = head.split_once("...").unwrap_or((head, ""));
        info.branch = branch_part.to_string();
        let bracket = tail.split_once('[').map(|(_, r)| r).unwrap_or(tail);
        if let Some(close) = bracket.split_once(']') {
            for part in close.0.split(", ") {
                match part.split_once(' ') {
                    Some(("ahead", n)) => info.ahead = n.parse().unwrap_or(0),
                    Some(("behind", n)) => info.behind = n.parse().unwrap_or(0),
                    _ => {}
                }
            }
        }
        Ok(info)
    } else {
        // Detached HEAD or unborn branch: still return a usable row.
        info.branch = "HEAD detached".into();
        Ok(info)
    }
}

/// Raw log for TS-side parsing: fields split on \x00, records on \x1e.
/// Decorations (%d) lead each record; %B is last so multi-line bodies survive the split.
#[tauri::command]
pub fn read_log(dir: &str, limit: u32, skip: u32) -> Result<String, String> {
    run_git(
        dir,
        &[
            "log",
            "--all",
            &format!("--max-count={limit}"),
            &format!("--skip={skip}"),
            "--date=iso-strict",
            "--pretty=tformat:%d%x00%H%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
        ],
    )
}

/// All branch/remote/tag tips: raw `hash\tfullref` lines for TS-side parsing.
/// Decorations on log rows miss tips that point outside the loaded window.
#[tauri::command]
pub fn read_refs(dir: &str) -> Result<String, String> {
    run_git(
        dir,
        &[
            "for-each-ref",
            "--format=%(objectname)%09%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )
}

/// Checks out an existing branch by name; refuses with git's own error when the
/// working tree would lose changes (dirty tree with conflicting paths).
#[tauri::command]
pub fn checkout_branch(dir: &str, branch: &str) -> Result<(), String> {
    run_git(dir, &["checkout", branch]).map(|_| ())
}

/// Files of one commit. "wip" means the uncommitted working tree vs HEAD.
/// Otherwise: diff against the first parent; root commits use the --root forms.
#[tauri::command]
pub fn read_commit_files(dir: &str, hash: &str) -> Result<FilePayload, String> {
    if hash == "wip" {
        let numstat: Vec<String> = vec!["diff".into(), "--numstat".into(), "--no-color".into(), "HEAD".into()];
        let name_status: Vec<String> = vec!["diff".into(), "--name-status".into(), "--no-color".into(), "HEAD".into()];
        let diff: Vec<String> = vec!["diff".into(), "--no-color".into(), "HEAD".into()];
        return Ok(FilePayload {
            numstat: run_git(dir, &numstat.iter().map(String::as_str).collect::<Vec<&str>>())?,
            name_status: run_git(dir, &name_status.iter().map(String::as_str).collect::<Vec<&str>>())?,
            diff: run_git(dir, &diff.iter().map(String::as_str).collect::<Vec<&str>>())?,
        });
    }

    let is_root_rev = format!("{hash}^1");
    let is_root = run_git(dir, &["rev-parse", "--verify", &is_root_rev]).is_err();

    let base: Vec<String> = if is_root {
        vec![
            "show".into(),
            "--root".into(),
            "--format=".into(),
            "--no-color".into(),
            hash.to_string(),
        ]
    } else {
        vec!["diff".into(), "--no-color".into(), format!("{hash}^1"), hash.to_string()]
    };

    let insert = |item: &str| -> Vec<String> {
        let mut v = base.clone();
        v.insert(1, item.into());
        v
    };
    let numstat_args = insert("--numstat");
    let name_status_args = insert("--name-status");
    Ok(FilePayload {
        numstat: run_git(dir, &args(&numstat_args))?,
        name_status: run_git(dir, &args(&name_status_args))?,
        diff: run_git(dir, &args(&base))?,
    })
}

fn args(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}
