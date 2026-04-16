use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexWriter, ReloadPolicy};

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub snippet: String,
}

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

// tantivy インデックスを root ごとにキャッシュ (RAM ディレクトリ)。
// ファイル変更時にはインデックスを再構築する。
struct SearchIndex {
    index: Index,
    path_field: Field,
    body_field: Field,
    // 行単位スニペット用に元テキストを保持
    files: HashMap<String, String>,
}

static INDEX_CACHE: std::sync::LazyLock<Mutex<HashMap<String, SearchIndex>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn collect_md_files(dir: &Path, out: &mut Vec<PathBuf>) {
    if dir.is_file() {
        if is_markdown(dir) {
            out.push(dir.to_path_buf());
        }
        return;
    }
    let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    if should_skip_dir(name) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        collect_md_files(&e.path(), out);
    }
}

fn build_index(root: &Path) -> Result<SearchIndex, String> {
    let mut schema_builder = Schema::builder();
    let path_field = schema_builder.add_text_field("path", STRING | STORED);
    let body_field = schema_builder.add_text_field("body", TEXT);
    let schema = schema_builder.build();

    let index = Index::create_in_ram(schema);
    let mut writer: IndexWriter = index
        .writer(15_000_000)
        .map_err(|e| format!("index writer: {}", e))?;

    let mut md_files = Vec::new();
    collect_md_files(root, &mut md_files);

    let mut files = HashMap::new();
    for path in &md_files {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let path_str = path.to_string_lossy().into_owned();
        writer
            .add_document(doc!(
                path_field => path_str.clone(),
                body_field => content.clone(),
            ))
            .map_err(|e| format!("add doc: {}", e))?;
        files.insert(path_str, content);
    }

    writer.commit().map_err(|e| format!("commit: {}", e))?;

    Ok(SearchIndex {
        index,
        path_field,
        body_field,
        files,
    })
}

// tantivy でヒットしたファイルの中から、行単位でクエリ文字列を含む行を返す。
fn extract_line_hits(
    content: &str,
    path: &str,
    query_lower: &str,
    hits: &mut Vec<SearchHit>,
    limit: usize,
) {
    for (i, line) in content.lines().enumerate() {
        if hits.len() >= limit {
            return;
        }
        if line.to_lowercase().contains(query_lower) {
            let trimmed: String = line.trim().chars().take(240).collect();
            hits.push(SearchHit {
                path: path.to_string(),
                line: (i + 1) as u32,
                snippet: trimmed,
            });
        }
    }
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
        // インデックスを取得 or 構築
        let mut cache = INDEX_CACHE.lock().unwrap();
        if !cache.contains_key(&root) {
            let idx = build_index(&root_path)?;
            cache.insert(root.clone(), idx);
        }
        let si = cache.get(&root).unwrap();

        let reader = si
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| format!("reader: {}", e))?;
        let searcher = reader.searcher();
        let query_parser = QueryParser::for_index(&si.index, vec![si.body_field]);

        // tantivy クエリでマッチするドキュメントを取得
        let parsed = query_parser
            .parse_query(&q)
            .map_err(|e| format!("parse query: {}", e))?;
        let top_docs = searcher
            .search(&parsed, &TopDocs::with_limit(50))
            .map_err(|e| format!("search: {}", e))?;

        let q_lower = q.to_lowercase();
        let mut hits = Vec::new();

        for (_score, doc_address) in top_docs {
            if hits.len() >= 200 {
                break;
            }
            let doc: tantivy::TantivyDocument = searcher
                .doc(doc_address)
                .map_err(|e| format!("doc: {}", e))?;
            if let Some(path_val) = doc.get_first(si.path_field) {
                if let Some(path_str) = path_val.as_str() {
                    if let Some(content) = si.files.get(path_str) {
                        extract_line_hits(content, path_str, &q_lower, &mut hits, 200);
                    }
                }
            }
        }

        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ファイル変更時にインデックスをクリアして再構築を促す
pub fn invalidate_index(root: &str) {
    if let Ok(mut cache) = INDEX_CACHE.lock() {
        cache.remove(root);
    }
}
