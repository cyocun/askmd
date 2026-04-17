#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(InitialPath(initial))
        .manage(WatcherState::new())
        .manage(ActiveProvider::new())
        .invoke_handler(tauri::generate_handler![
            commands::directory::pick_directory,
            commands::directory::scan_markdown_tree,
            commands::directory::trash_file,
            commands::directory::restore_file,
            commands::directory::rename_file,
            commands::directory::duplicate_file,
            commands::directory::move_file,
            commands::directory::create_new_markdown,
            commands::markdown::read_markdown,
            commands::ai::ask_ai_stream,
            commands::ai::get_ai_providers,
            commands::ai::get_active_provider,
            commands::ai::set_active_provider,
            commands::search::search_markdown,
            commands::watch::start_watch,
            commands::cli::get_initial_path,
            commands::translate::translate_text,
            commands::recent::get_recent_dirs,
            commands::recent::add_recent_dir,
            commands::recent_files::get_recent_files,
            commands::finder::reveal_in_finder,
            commands::finder::open_url,
            commands::diff::get_diff,
            commands::diff::get_diff_text,
            commands::diff::mark_as_read,
            commands::diff::get_changed_files,
        ])
        .menu(|handle| menu::build(handle))
        .on_menu_event(menu::handle_event)
        .setup(|app| {
            let handle = app.handle().clone();
            // 起動 5 秒後に初回チェック、以降 6 時間周期
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                loop {
                    if let Ok(updater) = tauri_plugin_updater::UpdaterExt::updater(&handle) {
                        if let Ok(Some(update)) = updater.check().await {
                            let _: Result<(), _> = update
                                .download_and_install(
                                    |_chunk_len: usize, _content_len: Option<u64>| {},
                                    || {},
                                )
                                .await;
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running askmd");
}
