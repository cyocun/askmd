use super::util;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const MAX_RECENT: usize = 10;

/// 末尾の `/` を剥がしてパスを正規化する。
/// `~/foo/bar` と `~/foo/bar/` を同一エントリとして扱うため。
/// ルート `/` だけは剥がさない。
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredRecentDir {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct RecentDir {
    pub path: String,
    pub name: String,
    pub icon: Option<String>,
}

fn recent_file() -> Option<PathBuf> {
    util::app_data_dir().map(|d| d.join("recent.json"))
}

fn load() -> Vec<StoredRecentDir> {
    let Some(path) = recent_file() else {
        return vec![];
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return vec![];
    };
    let raw: Vec<StoredRecentDir> = serde_json::from_str(&data).unwrap_or_default();
    // 末尾 `/` の有無だけ違う重複を排除 (先勝ち = 新しい方を残す)
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(raw.len());
    for mut entry in raw {
        entry.path = normalize_path(&entry.path);
        if seen.insert(entry.path.clone()) {
            out.push(entry);
        }
    }
    out
}

fn save(dirs: &[StoredRecentDir]) {
    let Some(path) = recent_file() else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(dirs).unwrap_or_default());
}

// package.json → git remote → pyproject.toml の順で「プロジェクト名」を解決する。
// どれも当たらなければ None → フロント側で basename フォールバック。
fn resolve_project_name(project_path: &str) -> Option<String> {
    let canonical = fs::canonicalize(project_path).ok()?;
    if !canonical.is_dir() {
        return None;
    }
    let p = canonical.as_path();

    let pkg = p.join("package.json");
    if pkg.exists() {
        if let Ok(content) = fs::read_to_string(&pkg) {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(name) = data.get("name").and_then(|v| v.as_str()) {
                    if !name.is_empty() && name != "undefined" {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }

    let canonical_str = canonical.to_string_lossy().to_string();
    if let Ok(output) = Command::new("git")
        .args(["-C", &canonical_str, "remote", "get-url", "origin"])
        .output()
    {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !url.is_empty() {
            let cleaned = url.trim_end_matches('/').trim_end_matches(".git");
            let parts: Vec<&str> = cleaned.split('/').collect();
            if parts.len() >= 2 {
                let repo = parts[parts.len() - 1];
                let mut owner = parts[parts.len() - 2].to_string();
                if let Some(pos) = owner.rfind(':') {
                    owner = owner[pos + 1..].to_string();
                }
                return Some(format!("{}/{}", owner, repo));
            }
        }
    }

    let pyproj = p.join("pyproject.toml");
    if pyproj.exists() {
        if let Ok(content) = fs::read_to_string(&pyproj) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("name") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        let name = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        if !name.is_empty() {
                            return Some(name);
                        }
                    }
                }
            }
        }
    }

    None
}

// favicon 類を探して Base64 data URI で返す。256KB 超は skip (重い SVG/PNG 対策)。
fn resolve_project_icon(project_path: &str) -> Option<String> {
    let base = std::path::Path::new(project_path);
    if !base.is_dir() {
        return None;
    }

    const CANDIDATES: &[&str] = &[
        "favicon.ico",
        "favicon.png",
        "favicon.svg",
        "public/favicon.ico",
        "public/favicon.png",
        "public/favicon.svg",
        "assets/icon.png",
        "assets/icon.svg",
        "src-tauri/icons/icon.png",
    ];

    for candidate in CANDIDATES {
        let path = base.join(candidate);
        if path.is_file() {
            if let Ok(bytes) = fs::read(&path) {
                if bytes.len() > 256 * 1024 {
                    continue;
                }
                let mime = match path.extension().and_then(|e| e.to_str()) {
                    Some("ico") => "image/x-icon",
                    Some("png") => "image/png",
                    Some("svg") => "image/svg+xml",
                    Some("jpg") | Some("jpeg") => "image/jpeg",
                    _ => "image/png",
                };
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return Some(format!("data:{};base64,{}", mime, b64));
            }
        }
    }

    None
}

fn enrich(stored: StoredRecentDir) -> RecentDir {
    let name = resolve_project_name(&stored.path).unwrap_or(stored.name);
    let icon = resolve_project_icon(&stored.path);
    RecentDir {
        path: stored.path,
        name,
        icon,
    }
}

#[tauri::command]
pub async fn get_recent_dirs() -> Vec<RecentDir> {
    // 旧データの末尾 `/` 重複を load() が dedup するので、そのまま永続側にも反映しておく
    let dirs = load();
    save(&dirs);
    dirs.into_iter().map(enrich).collect()
}

#[tauri::command]
pub async fn add_recent_dir(path: String) -> Vec<RecentDir> {
    let path = normalize_path(&path);
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    let mut dirs = load();
    dirs.retain(|d| d.path != path);
    dirs.insert(0, StoredRecentDir { path, name });
    dirs.truncate(MAX_RECENT);
    save(&dirs);
    dirs.into_iter().map(enrich).collect()
}
