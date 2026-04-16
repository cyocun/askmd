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
