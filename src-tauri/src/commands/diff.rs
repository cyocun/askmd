use super::util;
use serde::Serialize;
use similar::{ChangeTag, TextDiff};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};

#[derive(Serialize, Clone, Default)]
pub struct DiffInfo {
    pub added: Vec<u32>,
    pub changed: Vec<u32>,
    pub change_count: u32,
}

#[derive(Serialize)]
pub struct FileChangeInfo {
    pub path: String,
    pub name: String,
    pub title: Option<String>,
    pub change_count: u32,
}

// ─── git ヘルパー ───

static GIT_PATH: LazyLock<String> = LazyLock::new(|| {
    for path in ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"] {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }
    "git".to_string()
});

fn git_command() -> Command {
    Command::new(GIT_PATH.as_str())
}

static GIT_REPO_CACHE: LazyLock<Mutex<HashMap<PathBuf, Option<PathBuf>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn git_toplevel(root: &Path) -> Option<PathBuf> {
    if let Ok(cache) = GIT_REPO_CACHE.lock() {
        if let Some(cached) = cache.get(root) {
            return cached.clone();
        }
    }
    let output = git_command()
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(root)
        .output()
        .ok()?;
    let result = if output.status.success() {
        Some(PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()))
    } else {
        None
    };
    if let Ok(mut cache) = GIT_REPO_CACHE.lock() {
        cache.insert(root.to_path_buf(), result.clone());
    }
    result
}

fn is_git_repo(root: &Path) -> bool {
    git_toplevel(root).is_some()
}

/// 直近コミットでファイルが変更された際の比較対象コミットを取得。
/// そのファイルを変更した直近のコミットの "1 つ前" を返す。
/// (= 最後に変更される前の状態)
fn git_prev_commit_for_file(path: &Path, git_root: &Path) -> Option<String> {
    let output = git_command()
        .args(["log", "--format=%H", "-2", "--follow", "--diff-filter=ACMR", "--"])
        .arg(path)
        .current_dir(git_root)
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let commits: Vec<&str> = text.lines().collect();
    commits.get(1).map(|s| s.to_string())
}

// ─── git diff (単一ファイル: 直近コミットの変更) ───

fn git_diff_lines(path: &Path, git_root: &Path) -> Option<DiffInfo> {
    // まず uncommitted changes をチェック
    let uncommitted = git_command()
        .args(["diff", "HEAD", "--unified=0", "--"])
        .arg(path)
        .current_dir(git_root)
        .output()
        .ok();

    if let Some(ref out) = uncommitted {
        if out.status.success() && !out.stdout.is_empty() {
            let diff_text = String::from_utf8_lossy(&out.stdout);
            if !diff_text.trim().is_empty() {
                let info = parse_unified_diff(&diff_text);
                if info.change_count > 0 { return Some(info); }
            }
        }
    }

    // uncommitted がなければ、直近コミットでの変更を取得
    let prev = git_prev_commit_for_file(path, git_root)?;
    let output = git_command()
        .args(["diff", &format!("{}..HEAD", prev), "--unified=0", "--"])
        .arg(path)
        .current_dir(git_root)
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let diff_text = String::from_utf8_lossy(&output.stdout);
    let info = parse_unified_diff(&diff_text);
    if info.change_count > 0 { Some(info) } else { None }
}

fn parse_unified_diff(diff_text: &str) -> DiffInfo {
    let mut added = Vec::new();
    let mut changed = Vec::new();

    for line in diff_text.lines() {
        if let Some(rest) = line.strip_prefix("@@") {
            if let Some(plus_part) = rest.split('+').nth(1) {
                let nums: Vec<&str> = plus_part.split(|c: char| !c.is_ascii_digit()).collect();
                let start: u32 = nums.first().and_then(|s| s.parse().ok()).unwrap_or(0);
                let count: u32 = nums.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
                if count == 0 {
                    if start > 0 {
                        changed.push(start);
                    }
                } else {
                    for i in start..start + count {
                        added.push(i);
                    }
                }
            }
        }
    }

    let change_count = (added.len() + changed.len()) as u32;
    DiffInfo { added, changed, change_count }
}

// ─── git: 全変更ファイルを一括取得 (直近 7 日間のコミット) ───

fn git_all_changes(git_root: &Path) -> HashMap<PathBuf, u32> {
    let mut result = HashMap::new();

    // 直近 7 日間にコミットで変更された .md ファイルと変更量
    if let Ok(output) = git_command()
        .args(["log", "--since=7 days ago", "--numstat", "--pretty=format:", "--diff-filter=ACMR", "--"])
        .current_dir(git_root)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() != 3 { continue; }
                let file = parts[2];
                let abs_path = git_root.join(file);
                if !util::is_markdown(&abs_path) { continue; }
                let added: u32 = parts[0].parse().unwrap_or(0);
                let removed: u32 = parts[1].parse().unwrap_or(0);
                // 同じファイルが複数コミットで変更された場合は合算
                let entry = result.entry(abs_path).or_insert(0u32);
                *entry += added + removed;
            }
        }
    }

    // uncommitted changes も含める
    if let Ok(output) = git_command()
        .args(["diff", "HEAD", "--numstat", "--"])
        .current_dir(git_root)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() != 3 { continue; }
                let abs_path = git_root.join(parts[2]);
                if !util::is_markdown(&abs_path) { continue; }
                let added: u32 = parts[0].parse().unwrap_or(0);
                let removed: u32 = parts[1].parse().unwrap_or(0);
                let entry = result.entry(abs_path).or_insert(0u32);
                *entry += added + removed;
            }
        }
    }

    // untracked .md ファイル
    if let Ok(output) = git_command()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(git_root)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let path = git_root.join(line.trim());
                if util::is_markdown(&path) {
                    let count = fs::File::open(&path)
                        .map(|f| std::io::BufRead::lines(std::io::BufReader::new(f)).count() as u32)
                        .unwrap_or(0);
                    if count > 0 {
                        result.insert(path, count);
                    }
                }
            }
        }
    }

    result
}

// ─── スナップショットベース diff ───

fn snapshot_dir(root: &Path) -> Option<PathBuf> {
    let mut hasher = DefaultHasher::new();
    root.to_string_lossy().hash(&mut hasher);
    let hash = format!("{:016x}", hasher.finish());
    util::app_data_dir().map(|d| d.join("snapshots").join(hash))
}

fn snapshot_path(root: &Path, file_path: &Path) -> Option<PathBuf> {
    let rel = file_path.strip_prefix(root).ok()?;
    let mut snap = snapshot_dir(root)?;
    snap.push(rel);
    snap.set_extension("snapshot");
    Some(snap)
}

fn snapshot_diff_lines(path: &Path, root: &Path) -> Option<DiffInfo> {
    let snap_path = snapshot_path(root, path)?;
    let current = fs::read_to_string(path).ok()?;

    if !snap_path.exists() {
        save_snapshot_inner(root, path, &current);
        return None;
    }

    let old = fs::read_to_string(&snap_path).ok()?;
    if old == current {
        return None;
    }

    let diff = TextDiff::from_lines(&old, &current);
    let mut added_set = HashSet::new();
    let mut added = Vec::new();
    let mut changed = Vec::new();
    let mut new_line: u32 = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => { new_line += 1; }
            ChangeTag::Insert => {
                new_line += 1;
                added_set.insert(new_line);
                added.push(new_line);
            }
            ChangeTag::Delete => {
                changed.push(new_line + 1);
            }
        }
    }

    changed.retain(|line| !added_set.contains(line));
    changed.sort();
    changed.dedup();

    let change_count = (added.len() + changed.len()) as u32;
    if change_count == 0 { return None; }
    Some(DiffInfo { added, changed, change_count })
}

fn save_snapshot_inner(root: &Path, file_path: &Path, content: &str) {
    if let Some(snap) = snapshot_path(root, file_path) {
        if let Some(parent) = snap.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&snap, content);
    }
}

// ─── Tauri コマンド ───

#[tauri::command]
pub async fn get_diff(path: String, root: String) -> Result<Option<DiffInfo>, String> {
    let file_path = PathBuf::from(&path);
    let root_path = PathBuf::from(&root);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(git_root) = git_toplevel(&root_path) {
            Ok(git_diff_lines(&file_path, &git_root))
        } else {
            Ok(snapshot_diff_lines(&file_path, &root_path))
        }
    })
    .await
    .map_err(|e| format!("spawn error: {}", e))?
}

/// 文字単位ハイライト付きリッチ diff HTML を返す
#[tauri::command]
pub async fn get_diff_text(path: String, root: String) -> Result<Option<String>, String> {
    let file_path = PathBuf::from(&path);
    let root_path = PathBuf::from(&root);
    tauri::async_runtime::spawn_blocking(move || {
        let (old, new) = match get_old_new_content(&file_path, &root_path) {
            Some(pair) => pair,
            None => return Ok(None),
        };
        if old == new { return Ok(None); }
        Ok(Some(generate_rich_diff_html(&old, &new)))
    })
    .await
    .map_err(|e| format!("spawn error: {}", e))?
}

/// ファイルの旧版と現行版を取得
fn get_old_new_content(path: &Path, root: &Path) -> Option<(String, String)> {
    let new_content = fs::read_to_string(path).ok()?;

    if let Some(git_root) = git_toplevel(root) {
        // git: まず uncommitted の旧版 (HEAD)
        if let Ok(output) = git_command()
            .args(["show", &format!("HEAD:{}", path.strip_prefix(&git_root).ok()?.to_string_lossy())])
            .current_dir(&git_root)
            .output()
        {
            if output.status.success() {
                let head_content = String::from_utf8_lossy(&output.stdout).to_string();
                if head_content != new_content {
                    return Some((head_content, new_content));
                }
            }
        }
        // 直近コミットの前の版
        if let Some(prev) = git_prev_commit_for_file(path, &git_root) {
            if let Ok(output) = git_command()
                .args(["show", &format!("{}:{}", prev, path.strip_prefix(&git_root).ok()?.to_string_lossy())])
                .current_dir(&git_root)
                .output()
            {
                if output.status.success() {
                    return Some((String::from_utf8_lossy(&output.stdout).to_string(), new_content));
                }
            }
        }
        None
    } else {
        // スナップショット
        let snap = snapshot_path(root, path)?;
        if !snap.exists() { return None; }
        let old = fs::read_to_string(&snap).ok()?;
        Some((old, new_content))
    }
}

/// 文字単位ハイライト付き HTML を生成
fn generate_rich_diff_html(old: &str, new: &str) -> String {
    let diff = TextDiff::from_lines(old, new);
    let mut html = String::new();

    for (gi, group) in diff.grouped_ops(3).iter().enumerate() {
        if gi > 0 {
            html.push_str("<div class=\"diff-sep\">⋯</div>\n");
        }
        for op in group {
            let changes: Vec<_> = diff.iter_changes(op).collect();
            let mut i = 0;
            while i < changes.len() {
                let change = &changes[i];
                match change.tag() {
                    ChangeTag::Equal => {
                        html.push_str("<div class=\"diff-ctx\"><span class=\"diff-sign\"> </span>");
                        html.push_str(&html_escape(change.value().trim_end_matches('\n')));
                        html.push_str("</div>\n");
                        i += 1;
                    }
                    ChangeTag::Delete => {
                        // Delete + Insert のペアを探して文字単位 diff
                        if i + 1 < changes.len() && changes[i + 1].tag() == ChangeTag::Insert {
                            let old_line = change.value().trim_end_matches('\n');
                            let new_line = changes[i + 1].value().trim_end_matches('\n');
                            let (del_html, ins_html) = char_level_diff(old_line, new_line);
                            html.push_str(&format!("<div class=\"diff-del\"><span class=\"diff-sign\">−</span>{}</div>\n", del_html));
                            html.push_str(&format!("<div class=\"diff-add\"><span class=\"diff-sign\">+</span>{}</div>\n", ins_html));
                            i += 2;
                        } else {
                            html.push_str("<div class=\"diff-del\"><span class=\"diff-sign\">−</span>");
                            html.push_str(&html_escape(change.value().trim_end_matches('\n')));
                            html.push_str("</div>\n");
                            i += 1;
                        }
                    }
                    ChangeTag::Insert => {
                        html.push_str("<div class=\"diff-add\"><span class=\"diff-sign\">+</span>");
                        html.push_str(&html_escape(change.value().trim_end_matches('\n')));
                        html.push_str("</div>\n");
                        i += 1;
                    }
                }
            }
        }
    }
    html
}

/// 2 つの行の文字単位 diff → (削除側 HTML, 追加側 HTML)
fn char_level_diff(old: &str, new: &str) -> (String, String) {
    let diff = TextDiff::from_chars(old, new);
    let mut del_html = String::new();
    let mut ins_html = String::new();

    for change in diff.iter_all_changes() {
        let escaped = html_escape(&change.to_string_lossy());
        match change.tag() {
            ChangeTag::Equal => {
                del_html.push_str(&escaped);
                ins_html.push_str(&escaped);
            }
            ChangeTag::Delete => {
                del_html.push_str(&format!("<span class=\"diff-em\">{}</span>", escaped));
            }
            ChangeTag::Insert => {
                ins_html.push_str(&format!("<span class=\"diff-em\">{}</span>", escaped));
            }
        }
    }
    (del_html, ins_html)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
}

#[tauri::command]
pub async fn mark_as_read(path: String, root: String) {
    let file_path = PathBuf::from(&path);
    let root_path = PathBuf::from(&root);
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if !is_git_repo(&root_path) {
            if let Ok(content) = fs::read_to_string(&file_path) {
                save_snapshot_inner(&root_path, &file_path, &content);
            }
        }
    })
    .await;
}

#[tauri::command]
pub async fn get_changed_files(root: String) -> Vec<FileChangeInfo> {
    let root_path = PathBuf::from(&root);
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();

        if let Some(git_root) = git_toplevel(&root_path) {
            let changes = git_all_changes(&git_root);
            for (path, count) in changes {
                if !path.starts_with(&root_path) { continue; }
                let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                let title = super::directory::extract_title(&path);
                results.push(FileChangeInfo {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    title,
                    change_count: count,
                });
            }
        } else {
            let mut md_files = Vec::new();
            util::collect_md_paths(&root_path, &mut md_files);
            for path in md_files {
                if let Some(d) = snapshot_diff_lines(&path, &root_path) {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                    let title = super::directory::extract_title(&path);
                    results.push(FileChangeInfo {
                        path: path.to_string_lossy().into_owned(),
                        name,
                        title,
                        change_count: d.change_count,
                    });
                }
            }
        }

        results.sort_by(|a, b| b.change_count.cmp(&a.change_count));
        results
    })
    .await
    .unwrap_or_default()
}
