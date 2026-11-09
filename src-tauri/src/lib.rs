mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Relaunch after an update has been downloaded and installed.
        .plugin(tauri_plugin_process::init())
        // The About links (GitHub) open in the system browser.
        .plugin(tauri_plugin_opener::init())
        // Remembers window size, position and maximized state between runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            git::open_repository,
            git::read_status,
            git::read_worktree_files,
            git::stage_files,
            git::unstage_files,
            git::discard_files,
            git::discard_all,
            git::read_wip_side,
            git::apply_hunk,
            git::apply_hunk_lines,
            git::commit_staged,
            git::undo_commit,
            git::pull_branch,
            git::push_branch,
            git::read_log,
            git::read_log_delta,
            git::read_log_order,
            git::read_refs,
            git::read_stashes,
            git::read_commit_files,
            git::read_file_patch,
            git::read_image_versions,
            git::checkout_branch,
            git::checkout_commit,
            git::merge_branch,
            git::resolve_conflicts,
            git::abort_merge,
            git::complete_merge,
            git::read_conflict_files,
            git::write_conflict_resolution,
            git::fetch_remote,
            git::stash_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
