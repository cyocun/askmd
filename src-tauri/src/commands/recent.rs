use super::util;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MAX_RECENT: usize = 5;

#[derive(Serialize, Deserialize, Clone)]
pub struct RecentDir {
    pub path: String,
    pub name: String,
}

fn recent_file() -> Option<PathBuf> {
    util::app_data_dir().map(|d| d.join("recent.json"))
}

fn load() -> Vec<RecentDir> {
    let Some(path) = recent_file() else {
        return vec![];
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return vec![];
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save(dirs: &[RecentDir]) {
    let Some(path) = recent_file() else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(dirs).unwrap_or_default());
}

#[tauri::command]
pub async fn get_recent_dirs() -> Vec<RecentDir> {
    load()
}

#[tauri::command]
pub async fn add_recent_dir(path: String) -> Vec<RecentDir> {
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    let mut dirs = load();
    dirs.retain(|d| d.path != path);
    dirs.insert(0, RecentDir { path, name });
    dirs.truncate(MAX_RECENT);
    save(&dirs);
    dirs
}
