use std::sync::Mutex;
use tauri::State;

pub struct InitialPath(pub Option<String>);
pub struct InitialFile(pub Option<String>);

/// Dock アイコンドロップや Finder "Open With" から届くパスを、
/// JS 側のリスナ登録前に受け取っても取りこぼさないためのキュー。
pub struct PendingOpens(pub Mutex<Vec<String>>);

impl PendingOpens {
    pub fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
    pub fn push(&self, path: String) {
        if let Ok(mut q) = self.0.lock() {
            q.push(path);
        }
    }
}

#[tauri::command]
pub fn get_initial_path(state: State<'_, InitialPath>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
pub fn get_initial_file(state: State<'_, InitialFile>) -> Option<String> {
    state.0.clone()
}

#[tauri::command]
pub fn take_pending_opens(state: State<'_, PendingOpens>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

/// 現在の askmd バイナリを別プロセスで起動し、指定パス (ディレクトリ or .md) を CLI 引数として渡す。
/// 既に開いている window とは独立した新ウィンドウを増やす用途。
#[tauri::command]
pub fn open_new_instance(path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
