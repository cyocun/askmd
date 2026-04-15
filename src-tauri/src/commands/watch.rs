use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState {
    current: Mutex<Option<RecommendedWatcher>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn start_watch(
    app: AppHandle,
    path: String,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let app_for_event = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else {
            return;
        };
        if !matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        ) {
            return;
        }
        let changed: Vec<String> = event
            .paths
            .iter()
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| matches!(e, "md" | "markdown" | "mdown" | "mkd"))
                    .unwrap_or(false)
            })
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if !changed.is_empty() {
            let _ = app_for_event.emit("fs-changed", changed);
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&target, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // 前回の watcher を drop して置き換え、ルート切替に追従する。
    let mut slot = state.current.lock().map_err(|e| e.to_string())?;
    *slot = Some(watcher);
    Ok(())
}
