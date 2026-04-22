#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Finder を開けませんでした: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("URL を開けませんでした: {}", e))?;
    Ok(())
}

// 指定ディレクトリをターミナルで開く。iTerm2 が入っていれば iTerm2 優先、
// なければ macOS 標準の Terminal.app にフォールバック。
// `/Applications/iTerm.app` 直打ちだと Homebrew cask や `~/Applications/` に
// 置いているケースを拾えないので、Spotlight の bundle id 検索で判定する。
#[tauri::command]
pub async fn open_in_terminal(path: String) -> Result<(), String> {
    let iterm_installed = std::process::Command::new("mdfind")
        .arg("kMDItemCFBundleIdentifier == 'com.googlecode.iterm2'")
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    let app = if iterm_installed { "iTerm" } else { "Terminal" };
    std::process::Command::new("open")
        .args(["-a", app, &path])
        .spawn()
        .map_err(|e| format!("ターミナルを開けませんでした: {}", e))?;
    Ok(())
}
