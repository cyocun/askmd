use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    // .md ファイルの場合のみ入る。frontmatter の title: か最初の `# ` 見出し。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub children: Option<Vec<TreeNode>>,
}

fn should_skip_dir(name: &str) -> bool {
    // 隠しディレクトリ + よくあるノイズ。ユーザー docs の "正味" を浮かび上がらせる。
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor" | ".git"
        )
}

// ファイル先頭 100 行を読み、frontmatter title か最初の `# 見出し` を返す。
// 見つからなければ None。I/O エラーも None。
fn extract_title(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut in_fm = false;
    let mut fm_checked_first = false;
    for (idx, line_res) in reader.lines().enumerate().take(100) {
        let Ok(line) = line_res else { break; };
        // 1 行目: `---` なら frontmatter 開始
        if idx == 0 && line.trim() == "---" {
            in_fm = true;
            fm_checked_first = true;
            continue;
        }
        if !fm_checked_first {
            fm_checked_first = true;
        }
        if in_fm {
            if line.trim() == "---" {
                in_fm = false;
                continue;
            }
            // title: の行を拾う
            if let Some(rest) = line.strip_prefix("title:") {
                let t = rest
                    .trim()
                    .trim_matches(|c| c == '"' || c == '\'')
                    .to_string();
                if !t.is_empty() {
                    return Some(t);
                }
            }
            continue;
        }
        // 本文内の最初の H1
        if let Some(rest) = line.strip_prefix("# ") {
            let t = rest.trim().to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn scan(path: &Path) -> Option<TreeNode> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let path_str = path.to_string_lossy().into_owned();

    if path.is_file() {
        let ext = path.extension().and_then(|e| e.to_str());
        if matches!(ext, Some("md") | Some("markdown") | Some("mdown") | Some("mkd")) {
            return Some(TreeNode {
                name,
                path: path_str,
                is_dir: false,
                title: extract_title(path),
                children: None,
            });
        }
        return None;
    }

    if should_skip_dir(&name) {
        return None;
    }

    let entries = std::fs::read_dir(path).ok()?;
    let mut children: Vec<TreeNode> = entries
        .flatten()
        .filter_map(|e| scan(&e.path()))
        .collect();

    if children.is_empty() {
        return None;
    }

    children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Some(TreeNode {
        name,
        path: path_str,
        is_dir: true,
        title: None,
        children: Some(children),
    })
}

#[tauri::command]
pub async fn scan_markdown_tree(root: String) -> Result<Option<TreeNode>, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    tauri::async_runtime::spawn_blocking(move || scan(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let result = path.and_then(|fp| {
            fp.as_path().map(|p| p.to_string_lossy().into_owned())
        });
        let _ = tx.send(result);
    });
    rx.await.ok().flatten()
}

// 削除前にファイル内容を読み取り、trash に移動する。
// 戻り値はファイル内容 (Undo で書き戻すため)。
#[tauri::command]
pub async fn trash_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.is_file() {
            return Err(format!("ファイルが見つかりません: {}", path));
        }
        let content = fs::read_to_string(&p)
            .map_err(|e| format!("ファイルの読み取りに失敗: {}", e))?;
        trash::delete(&p).map_err(|e| format!("ゴミ箱への移動に失敗: {}", e))?;
        Ok(content)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Undo: メモリスタックに残した path に内容を書き戻す。
// 親ディレクトリが無ければ作る (稀にディレクトリごと消えてるケース)。
#[tauri::command]
pub async fn restore_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("親ディレクトリ作成に失敗: {}", e))?;
            }
        }
        fs::write(&p, content.as_bytes())
            .map_err(|e| format!("書き戻しに失敗: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
