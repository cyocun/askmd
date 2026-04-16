use std::fs;
use std::path::{Path, PathBuf};

/// 隠しディレクトリ + よくあるノイズをスキップ。
/// directory.rs / search.rs / watch.rs / diff.rs で共通利用。
pub fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor" | ".git"
        )
}

/// パスが Markdown 拡張子 (.md, .markdown, .mdown, .mkd) かどうか
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e, "md" | "markdown" | "mdown" | "mkd"))
}

/// アプリデータディレクトリのベースパス
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.cyocun.askmd"))
}

/// ディレクトリ内の .md ファイルを再帰的に収集
pub fn collect_md_paths(dir: &Path, out: &mut Vec<PathBuf>) {
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
        collect_md_paths(&e.path(), out);
    }
}
