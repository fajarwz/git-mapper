mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Remembers window size, position and maximized state between runs.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            git::open_repository,
            git::read_status,
            git::read_log,
            git::read_refs,
            git::read_commit_files,
            git::checkout_branch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
