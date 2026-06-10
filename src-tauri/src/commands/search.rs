use super::util;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub snippet: String,
}

/// root ごとにファイル内容をメモリキャッシュ
struct FileCache {
    files: HashMap<String, String>,
}

static FILE_CACHE: std::sync::LazyLock<Mutex<HashMap<String, FileCache>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn build_cache(root: &Path) -> FileCache {
    let mut md_files = Vec::new();
    util::collect_md_paths(root, &mut md_files);
    let mut files = HashMap::new();
    for path in &md_files {
        if let Ok(content) = fs::read_to_string(path) {
            files.insert(path.to_string_lossy().into_owned(), content);
        }
    }
    FileCache { files }
}

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
        // 別スレッドの panic で poison しても検索自体は続行できる
        let mut cache = match FILE_CACHE.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if !cache.contains_key(&root) {
            cache.insert(root.clone(), build_cache(&root_path));
        }
        let fc = cache.get(&root).unwrap();

        let q_lower = q.to_lowercase();
        let mut hits = Vec::new();

        // HashMap の順は不定なので、検索のたびに結果順が変わらないよう path 順に固定
        let mut entries: Vec<(&String, &String)> = fc.files.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));

        // 全ファイルを行単位で部分文字列マッチ
        for (path, content) in entries {
            if hits.len() >= 200 {
                break;
            }
            for (i, line) in content.lines().enumerate() {
                if hits.len() >= 200 {
                    break;
                }
                if line.to_lowercase().contains(&q_lower) {
                    let trimmed: String = line.trim().chars().take(240).collect();
                    hits.push(SearchHit {
                        path: path.clone(),
                        line: (i + 1) as u32,
                        snippet: trimmed,
                    });
                }
            }
        }

        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ファイル変更時にキャッシュをクリアして再読み込みを促す
pub fn invalidate_index(root: &str) {
    if let Ok(mut cache) = FILE_CACHE.lock() {
        cache.remove(root);
    }
}
