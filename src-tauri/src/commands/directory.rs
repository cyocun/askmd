use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
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
