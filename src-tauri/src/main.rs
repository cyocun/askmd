#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod path_env;

use commands::ai::ActiveProvider;
use commands::cli::{resolve_initial, PendingOpens, WindowInits};
use commands::watch::WatcherState;
use tauri::{Emitter, Manager};

fn main() {
    path_env::fix();

    // CLI 引数: `askmd ~/path/to/repo` または `askmd ~/path/to/file.md`
    let (initial_root, initial_file) = std::env::args()
        .nth(1)
        .map(|arg| resolve_initial(&arg))
        .unwrap_or((None, None));

    let window_inits = WindowInits::new();
    window_inits.set("main".to_string(), initial_root, initial_file);

    tauri::Builder::default()
        // window-state は main 窓だけ保存/復元。新タブ (win-*) の状態を覚えると
        // Cmd+T で開くたび別サイズで復元され、タブグループの幅が暴れる。
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(window_inits)
        .manage(PendingOpens::new())
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
            commands::cli::get_initial_file,
            commands::cli::take_pending_opens,
            commands::cli::new_window,
            commands::translate::translate_text,
            commands::recent::get_recent_dirs,
            commands::recent::add_recent_dir,
            commands::recent_files::get_recent_files,
            commands::finder::reveal_in_finder,
            commands::finder::open_url,
            commands::finder::open_in_terminal,
        ])
        .menu(|handle| menu::build(handle))
        .on_menu_event(menu::handle_event)
        .on_window_event(|window, event| {
            // main ウィンドウの閉じるボタンはアプリを終了せずに隠すだけ (Mail.app 流)。
            // Dock 再クリックで復帰。二つ目以降のウィンドウ/タブは普通に閉じる。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
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
        .build(tauri::generate_context!())
        .expect("error while building askmd")
        .run(|app_handle, event| {
            // Dock アイコン再クリック (macOS) で hide 済みウィンドウを復帰させる
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            // Dock アイコンや Finder "Open With" からのファイル受け取り (macOS)。
            // main window のフロントに渡し、「現在 root と同じなら open、違えば new_window」を判断させる。
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    // JS 未ロードでも取りこぼさないようキューにも積む (frontend が init 時に drain)
                    let pending = app_handle.state::<PendingOpens>();
                    for p in &paths {
                        pending.push(p.clone());
                    }
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("askmd://external-open", paths);
                    }
                }
            }
        });
}
