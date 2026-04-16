// 「最近更新」用: root 配下の .md をファイルシステム mtime で降順に返す。
// recent.rs (最近開いたフォルダ) とは別物。
use super::directory::extract_title;
use super::util;
use serde::Serialize;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub title: Option<String>,
    pub modified: f64,
}

const DEFAULT_LIMIT: usize = 30;

#[tauri::command]
pub async fn get_recent_files(root: String, limit: Option<usize>) -> Result<Vec<RecentFile>, String> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(200).max(1);
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = PathBuf::from(&root);
        if !root_path.is_dir() {
            return Err(format!("フォルダではありません: {}", root));
        }
        let mut paths: Vec<PathBuf> = Vec::new();
        util::collect_md_paths(&root_path, &mut paths);

        let mut entries: Vec<(PathBuf, f64)> = paths
            .into_iter()
            .filter_map(|p| {
                let m = std::fs::metadata(&p).ok()?;
                let t = m.modified().ok()?;
                let d = t.duration_since(UNIX_EPOCH).ok()?;
                Some((p, d.as_secs_f64()))
            })
            .collect();

        // 新しい順
        entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        entries.truncate(limit);

        Ok(entries
            .into_iter()
            .map(|(p, modified)| {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                RecentFile {
                    title: extract_title(&p),
                    path: p.to_string_lossy().into_owned(),
                    name,
                    modified,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
