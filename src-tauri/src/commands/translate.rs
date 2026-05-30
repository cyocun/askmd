// Google Translate 非公式エンドポイント (API キー不要)。
// VS Code 拡張と同じ手法。レスポンスは数百 ms。

fn detect_target_lang(text: &str) -> (&'static str, &'static str) {
    // 日本語文字が多ければ → en、それ以外 → ja
    let jp_count = text
        .chars()
        .filter(|c| ('\u{3000}'..='\u{9FFF}').contains(c) || ('\u{FF00}'..='\u{FF9F}').contains(c))
        .count();
    let total = text.chars().count().max(1);
    if jp_count * 100 / total > 30 {
        ("ja", "en")
    } else {
        ("auto", "ja")
    }
}

#[tauri::command]
pub async fn translate_text(
    text: String,
    target_lang: Option<String>,
) -> Result<String, String> {
    let (source, default_target) = detect_target_lang(&text);
    let target = target_lang
        .as_deref()
        .unwrap_or(default_target);

    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t",
        source,
        target,
    );

    // 回線断で「翻訳中」のまま固まらないよう必ずタイムアウトを張る
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("クライアント初期化失敗: {}", e))?;
    let resp = client
        .post(&url)
        .form(&[("q", text.as_str())])
        .send()
        .await
        .map_err(|e| format!("リクエスト失敗: {}", e))?;

    // レート制限 (429) や障害時は Google が HTML を返すため、status を先に見て
    // 「パース失敗」ではなく意味のあるメッセージにする。
    if !resp.status().is_success() {
        return Err(format!(
            "翻訳サービスが応答しませんでした (HTTP {})。少し待って再試行してください。",
            resp.status().as_u16()
        ));
    }

    let body = resp.text().await.map_err(|e| format!("レスポンス読み取り失敗: {}", e))?;

    // レスポンスは [[["translated","original",...],...],...] の形式
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("パース失敗: {}", e))?;

    let mut result = String::new();
    if let Some(chunks) = parsed.get(0).and_then(|v| v.as_array()) {
        for chunk in chunks {
            if let Some(translated) = chunk.get(0).and_then(|v| v.as_str()) {
                result.push_str(translated);
            }
        }
    }

    if result.is_empty() {
        return Err("翻訳結果が空です".into());
    }

    Ok(result)
}
