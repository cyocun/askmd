use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub snippet: String,
}

// directory.rs と揃えるため同じ除外ルール。
fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor" | ".git"
        )
}

fn is_markdown(p: &Path) -> bool {
    let ext = p.extension().and_then(|e| e.to_str());
    matches!(ext, Some("md") | Some("markdown") | Some("mdown") | Some("mkd"))
}

fn search_in_file(
    path: &Path,
    query_lower: &str,
    hits: &mut Vec<SearchHit>,
    limit: usize,
) {
    let Ok(file) = fs::File::open(path) else { return; };
    let reader = BufReader::new(file);
    let path_str = path.to_string_lossy().into_owned();
    for (i, line_res) in reader.lines().enumerate() {
        if hits.len() >= limit {
            return;
        }
        let Ok(line) = line_res else { continue; };
        if line.to_lowercase().contains(query_lower) {
            let trimmed: String = line.trim().chars().take(240).collect();
            hits.push(SearchHit {
                path: path_str.clone(),
                line: (i + 1) as u32,
                snippet: trimmed,
            });
        }
    }
}

fn walk(path: &Path, query_lower: &str, hits: &mut Vec<SearchHit>, limit: usize) {
    if hits.len() >= limit {
        return;
    }
    if path.is_file() {
        if is_markdown(path) {
            search_in_file(path, query_lower, hits, limit);
        }
        return;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return; };
    if should_skip_dir(name) {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else { return; };
    for e in entries.flatten() {
        walk(&e.path(), query_lower, hits, limit);
        if hits.len() >= limit {
            return;
        }
    }
}

// 大文字小文字を区別しない部分一致検索。結果は最大 200 件で打ち切り。
#[tauri::command]
pub async fn search_markdown(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let q_lower = q.to_lowercase();
        let mut hits = Vec::new();
        walk(&root_path, &q_lower, &mut hits, 200);
        hits
    })
    .await
    .map_err(|e| e.to_string())
}
