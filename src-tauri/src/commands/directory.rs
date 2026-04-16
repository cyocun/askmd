use super::util;
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

// ファイル先頭 100 行を読み、frontmatter title か最初の `# 見出し` を返す。
// 見つからなければ None。I/O エラーも None。
pub(super) fn extract_title(path: &Path) -> Option<String> {
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
        if util::is_markdown(path) {
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

    if util::should_skip_dir(&name) {
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

// 名前を変更。new_name は末尾だけ (ディレクトリ部分は同じまま)。
// 拡張子が無ければ元の拡張子を継承。
#[tauri::command]
pub async fn rename_file(path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.is_file() {
            return Err(format!("ファイルが見つかりません: {}", path));
        }
        let parent = p.parent().ok_or_else(|| "親ディレクトリが無い".to_string())?;
        let trimmed = new_name.trim();
        if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
            return Err("使えない名前です".to_string());
        }
        // 拡張子補完: 末尾が .md 系でなければ元の拡張子を付ける
        let has_md_ext = [".md", ".markdown", ".mdown", ".mkd"]
            .iter()
            .any(|ext| trimmed.to_lowercase().ends_with(ext));
        let final_name = if has_md_ext {
            trimmed.to_string()
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            format!("{}.{}", trimmed, ext)
        } else {
            format!("{}.md", trimmed)
        };
        let new_path = parent.join(&final_name);
        if new_path.exists() && new_path != p {
            return Err("同じ名前のファイルが既にあります".to_string());
        }
        fs::rename(&p, &new_path).map_err(|e| format!("名前変更に失敗: {}", e))?;
        Ok(new_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

// 複製。ファイル名の末尾に " copy" を付け、衝突したら " copy 2", " copy 3"...
#[tauri::command]
pub async fn duplicate_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.is_file() {
            return Err(format!("ファイルが見つかりません: {}", path));
        }
        let parent = p.parent().ok_or_else(|| "親ディレクトリが無い".to_string())?;
        let stem = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("md")
            .to_string();
        // 既に " copy N" 付きなら N を抽出 (同名ファイルの連続複製)
        let base = stem.trim_end_matches(|c: char| c.is_ascii_digit()).to_string();
        let base = base.trim_end_matches(' ').to_string();
        let base = if base.ends_with(" copy") {
            base.trim_end_matches(" copy").to_string()
        } else {
            stem.clone()
        };
        let mut candidate = parent.join(format!("{} copy.{}", base, ext));
        let mut n = 2u32;
        while candidate.exists() {
            candidate = parent.join(format!("{} copy {}.{}", base, n, ext));
            n += 1;
            if n > 999 {
                return Err("複製先の名前を決められません".to_string());
            }
        }
        fs::copy(&p, &candidate).map_err(|e| format!("複製に失敗: {}", e))?;
        Ok(candidate.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ファイルを別ディレクトリに移動する (名前は保持)。同名がある場合はエラー。
#[tauri::command]
pub async fn move_file(src: String, dst_dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = PathBuf::from(&src);
        let d = PathBuf::from(&dst_dir);
        if !s.is_file() {
            return Err(format!("ファイルが見つかりません: {}", src));
        }
        if !d.is_dir() {
            return Err(format!("移動先がフォルダではありません: {}", dst_dir));
        }
        let name = s
            .file_name()
            .ok_or_else(|| "ファイル名が取得できません".to_string())?;
        let dst_path = d.join(name);
        if dst_path == s {
            return Ok(src);
        }
        if dst_path.exists() {
            return Err("移動先に同名のファイルがあります".to_string());
        }
        fs::rename(&s, &dst_path).map_err(|e| format!("移動に失敗: {}", e))?;
        Ok(dst_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

// 新規 .md を作成。dir 配下に "untitled.md" (衝突時は untitled-2.md, untitled-3.md...)。
#[tauri::command]
pub async fn create_new_markdown(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = PathBuf::from(&dir);
        if !d.is_dir() {
            return Err(format!("フォルダではありません: {}", dir));
        }
        let mut candidate = d.join("untitled.md");
        let mut n = 2u32;
        while candidate.exists() {
            candidate = d.join(format!("untitled-{}.md", n));
            n += 1;
            if n > 999 {
                return Err("新規ファイル名を決められません".to_string());
            }
        }
        fs::write(&candidate, b"# \n")
            .map_err(|e| format!("作成に失敗: {}", e))?;
        Ok(candidate.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

// 指定ファイルを dst_dir にコピー。衝突時は末尾に -2, -3... を付与。
// 編集モード中の画像 D&D 等で使う。
#[tauri::command]
pub async fn import_asset(src: String, dst_dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = PathBuf::from(&src);
        let d = PathBuf::from(&dst_dir);
        if !s.is_file() {
            return Err(format!("ファイルが見つかりません: {}", src));
        }
        if !d.is_dir() {
            return Err(format!("フォルダではありません: {}", dst_dir));
        }
        let stem = s
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("asset")
            .to_string();
        let ext = s
            .extension()
            .and_then(|x| x.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        let mut candidate = d.join(format!("{}{}", stem, ext));
        let mut n = 2u32;
        while candidate.exists() {
            candidate = d.join(format!("{}-{}{}", stem, n, ext));
            n += 1;
            if n > 999 {
                return Err("保存先の名前を決められません".to_string());
            }
        }
        fs::copy(&s, &candidate).map_err(|e| format!("画像取り込みに失敗: {}", e))?;
        Ok(candidate.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
