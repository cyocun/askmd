use std::path::Path;

/// 隠しディレクトリ + よくあるノイズをスキップ。
/// directory.rs / search.rs / watch.rs で共通利用。
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
