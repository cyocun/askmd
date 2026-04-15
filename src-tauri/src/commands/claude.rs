use std::process::Command;

// 選択範囲 + 質問を単一プロンプトに束ねて `claude -p` に渡す。
// MVP は一発回答 (非 stream)。stream 化は Phase 2。
#[tauri::command]
pub async fn ask_claude(prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("claude")
            .arg("-p")
            .arg(&prompt)
            .output()
            .map_err(|e| {
                format!(
                    "claude CLI の実行に失敗しました: {}. Claude Code がインストールされ PATH に通っていることを確認してください。",
                    e
                )
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("claude CLI エラー: {}", stderr));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
