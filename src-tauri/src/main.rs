#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::ai::ActiveProvider;
use commands::cli::InitialPath;
use commands::watch::WatcherState;

fn main() {
    // CLI 引数: `askmd ~/path/to/repo` で起動時にディレクトリを開く
    let initial = std::env::args().nth(1).and_then(|arg| {
        let expanded = if let Some(stripped) = arg.strip_prefix("~/") {
            dirs::home_dir()
                .map(|h| h.join(stripped))
                .unwrap_or_else(|| std::path::PathBuf::from(&arg))
        } else {
            std::path::PathBuf::from(&arg)
        };
        if expanded.is_dir() {
            Some(expanded.to_string_lossy().into_owned())
        } else {
            None
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(InitialPath(initial))
        .manage(WatcherState::new())
        .manage(ActiveProvider::new())
        .invoke_handler(tauri::generate_handler![
            commands::directory::pick_directory,
            commands::directory::scan_markdown_tree,
            commands::directory::trash_file,
            commands::directory::restore_file,
            commands::markdown::read_markdown,
            commands::claude::ask_claude_stream,
            commands::ai::ask_ai_stream,
            commands::ai::get_ai_providers,
            commands::ai::get_active_provider,
            commands::ai::set_active_provider,
            commands::search::search_markdown,
            commands::watch::start_watch,
            commands::cli::get_initial_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running askmd");
}
