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
            git::read_log,
            git::read_log_delta,
            git::read_log_order,
            git::read_refs,
            git::read_stashes,
            git::read_commit_files,
            git::checkout_branch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
