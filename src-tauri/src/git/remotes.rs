use super::shell::run_git;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

// A password or token in `https://user:secret@host/...` must never reach the screen.
fn mask_credentials(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let (authority, tail) = rest.split_once('/').map_or((rest, ""), |(a, t)| (a, t));
    match authority.rsplit_once('@') {
        Some((userinfo, host)) if userinfo.contains(':') => {
            let user = userinfo.split(':').next().unwrap_or_default();
            let slash = if rest.contains('/') { "/" } else { "" };
            format!("{scheme}://{user}@{host}{slash}{tail}")
        }
        _ => url.to_string(),
    }
}

fn require_remote_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || name.chars().any(|c| c.is_whitespace()) {
        return Err(format!("\"{name}\" is not a valid remote name"));
    }
    Ok(())
}

pub fn list_remotes_in(dir: &str) -> Result<Vec<RemoteInfo>, String> {
    let out = run_git(dir, &["remote", "-v"])?;
    let mut remotes: Vec<RemoteInfo> = Vec::new();
    for line in out.lines().filter(|line| line.ends_with("(fetch)")) {
        let Some((name, rest)) = line.split_once('\t') else { continue };
        let url = rest.trim_end_matches("(fetch)").trim();
        remotes.push(RemoteInfo { name: name.to_string(), url: mask_credentials(url) });
    }
    Ok(remotes)
}

fn remote_exists(dir: &str, name: &str) -> Result<bool, String> {
    Ok(run_git(dir, &["remote"])?.lines().any(|remote| remote.trim() == name))
}

pub fn add_remote_in(dir: &str, name: &str, url: &str) -> Result<(), String> {
    let name = name.trim();
    let url = url.trim();
    require_remote_name(name)?;
    if url.is_empty() || url.starts_with('-') {
        return Err(format!("\"{url}\" is not a valid remote URL"));
    }
    if remote_exists(dir, name)? {
        return Err(format!("A remote named \"{name}\" already exists"));
    }
    run_git(dir, &["remote", "add", "--", name, url]).map(|_| ())
}

pub fn rename_remote_in(dir: &str, old: &str, new: &str) -> Result<(), String> {
    let old = old.trim();
    let new = new.trim();
    require_remote_name(new)?;
    if !remote_exists(dir, old)? {
        return Err(format!("There is no remote named \"{old}\""));
    }
    if remote_exists(dir, new)? {
        return Err(format!("A remote named \"{new}\" already exists"));
    }
    run_git(dir, &["remote", "rename", "--", old, new]).map(|_| ())
}

pub fn remove_remote_in(dir: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    // `remote remove` takes no `--`, so a leading dash is refused up front instead.
    require_remote_name(name)?;
    if !remote_exists(dir, name)? {
        return Err(format!("There is no remote named \"{name}\""));
    }
    run_git(dir, &["remote", "remove", name]).map(|_| ())
}
