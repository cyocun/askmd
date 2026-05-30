use super::util;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// ウィンドウラベル → watcher のマップ。
/// ウィンドウ毎に異なる root を watch するため、ラベルで区別する。
/// 同じラベルで再度 start_watch が呼ばれたら古い watcher は drop で置き換わる。
pub struct WatcherState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn start_watch(
    app: AppHandle,
    window: tauri::Window,
    path: String,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let app_for_event = app.clone();
    let path_for_invalidate = path.clone();
    let window_label = window.label().to_string();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else {
            return;
        };
        // macOS FSEvents は粒度が粗く、外部編集が Modify ではなく Any / Other
        // として届くことがある (Dropbox 等の同期フォルダで顕著)。読み取り専用の
        // Access だけを除外し、それ以外は通して取りこぼしを防ぐ。
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let changed: Vec<String> = event
            .paths
            .iter()
            .filter(|p| util::is_markdown(p))
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if !changed.is_empty() {
            // tantivy インデックスをクリアして次回検索時に再構築
            super::search::invalidate_index(&path_for_invalidate);
            // 発火元ウィンドウにのみ通知 (別窓の state を汚さない)
            let _ = app_for_event.emit_to(window_label.as_str(), "fs-changed", changed);
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&target, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut map = state.watchers.lock().map_err(|e| e.to_string())?;
    map.insert(window.label().to_string(), watcher);
    Ok(())
}
