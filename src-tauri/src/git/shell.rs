use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Builds the git command every read runs through. `CREATE_NO_WINDOW` matters on Windows in
/// release: the app is a GUI-subsystem process there (see the attribute in main.rs), so a child
/// console app like git.exe opens its own visible cmd window on every spawn — and this app
/// spawns git constantly (refresh probes, worktree digests, image blobs). In dev the app is a
/// console process and children inherit the terminal's console, which is why `tauri dev` never
/// shows them.
pub fn git_command(dir: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

pub fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    git_command(dir)
        .args(args)
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

/// A git read that stats the worktree. `git diff HEAD` refreshes the index opportunistically
/// (taking index.lock), and the wip view runs three of those side by side, so the env var
/// turns that opportunistic write off and the concurrent reads cannot lock-race. Everything
/// serial (status above all) keeps its locks: the refreshed index it writes back is the stat
/// cache every later read hits — without it a WSL mount re-stat's every tracked file, a
/// ~20s scan, on every single call.
pub fn run_git_no_locks(dir: &str, args: &[&str]) -> Result<String, String> {
    git_command(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(args)
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

/// Runs a blocking git body on a worker thread. A sync `#[tauri::command]` executes on the main
/// thread, so one slow read (a 20-second `git status` over a `\\wsl.localhost` mount) greyed the
/// whole window out with "Not responding". Every command below is a thin async wrapper around
/// its sync `*_in` body; this is the one await they share.
pub async fn run_blocking<T, F>(op: &str, work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("the {op} task failed: {e}"))?
}

/// Cheap FNV-1a digest: these stamps are only ever compared for equality between two reads,
/// so a short, stable hash is enough — no crypto, no git plumbing call.

/// process startup, so the commit panel's back-to-back reads used to stack several of
/// those startups in a row; run side by side, the wall time is just the slowest read.
pub fn parallel_git<'a>(
    reads: Vec<Box<dyn FnOnce() -> Result<String, String> + Send + 'a>>,
) -> Vec<Result<String, String>> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = reads.into_iter().map(|read| scope.spawn(read)).collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("a git read crashed".into()))
            })
            .collect()
    })
}
