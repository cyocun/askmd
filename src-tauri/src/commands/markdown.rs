use serde::Serialize;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct MarkdownFile {
    pub content: String,
    /// Unix epoch seconds (フロントで表示フォーマット)
    pub modified: Option<f64>,
}

#[tauri::command]
pub fn read_markdown(path: String) -> Result<MarkdownFile, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let modified = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64());
    Ok(MarkdownFile { content, modified })
}
