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

/// macOS GUI アプリでは PATH が制限されるため、フルパスも試す
fn git_command() -> Command {
    // まず PATH 上の git を試す
    if let Ok(output) = Command::new("git").arg("--version").output() {
        if output.status.success() {
            return Command::new("git");
        }
    }
    // Xcode CLT / Homebrew の一般的なパスを試す
    for path in ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"] {
        if Path::new(path).exists() {
            return Command::new(path);
        }
    }
    Command::new("git")
}

static GIT_REPO_CACHE: LazyLock<Mutex<HashMap<PathBuf, Option<PathBuf>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// git リポジトリのルートパスを返す。リポジトリ外なら None。
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

// ─── git diff (単一ファイル) ───

fn git_diff_lines(path: &Path, git_root: &Path) -> Option<DiffInfo> {
    let output = git_command()
        .args(["diff", "HEAD", "--unified=0", "--"])
        .arg(path)
        .current_dir(git_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let diff_text = String::from_utf8_lossy(&output.stdout);
    if diff_text.trim().is_empty() {
        // untracked ファイルかチェック
        let untracked = git_command()
            .args(["ls-files", "--others", "--exclude-standard", "--"])
            .arg(path)
            .current_dir(git_root)
            .output()
            .ok()?;
        if String::from_utf8_lossy(&untracked.stdout).trim().is_empty() {
            return None;
        }
        let file = fs::File::open(path).ok()?;
        let line_count = std::io::BufRead::lines(std::io::BufReader::new(file)).count() as u32;
        let added: Vec<u32> = (1..=line_count).collect();
        return Some(DiffInfo {
            change_count: line_count,
            added,
            changed: vec![],
        });
    }

    let info = parse_unified_diff(&diff_text);
    if info.change_count == 0 { return None; }
    Some(info)
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

// ─── git diff (リポジトリ全体を一括取得) ───

fn git_all_changes(git_root: &Path) -> HashMap<PathBuf, u32> {
    let mut result = HashMap::new();

    // --numstat: machine-parseable "added\tremoved\tpath" 形式
    if let Ok(output) = git_command()
        .args(["diff", "HEAD", "--numstat", "--"])
        .current_dir(git_root)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() != 3 { continue; }
                let file = parts[2];
                let abs_path = git_root.join(file);
                if !util::is_markdown(&abs_path) { continue; }
                let added: u32 = parts[0].parse().unwrap_or(0);
                let removed: u32 = parts[1].parse().unwrap_or(0);
                let count = added + removed;
                if count > 0 {
                    result.insert(abs_path, count);
                }
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
            ChangeTag::Equal => {
                new_line += 1;
            }
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
    if change_count == 0 {
        return None;
    }
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
pub async fn get_diff(path: String, root: String) -> Option<DiffInfo> {
    let file_path = PathBuf::from(&path);
    let root_path = PathBuf::from(&root);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(git_root) = git_toplevel(&root_path) {
            git_diff_lines(&file_path, &git_root)
        } else {
            snapshot_diff_lines(&file_path, &root_path)
        }
    })
    .await
    .ok()
    .flatten()
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
            // root 配下のファイルのみ返す (サブディレクトリで開いた場合)
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
