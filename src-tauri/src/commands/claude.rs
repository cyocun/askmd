use serde::Serialize;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

// stream-json をフロントへ中継する際の 1 イベント。
// 受け手側 (ask.ts) は kind で分岐。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub request_id: String,
    pub kind: String,                   // "session" | "tool" | "text" | "done" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,        // error / done メッセージ用
}

impl StreamEvent {
    fn new(request_id: &str, kind: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            tool_name: None,
            tool_input: None,
            text: None,
            session_id: None,
            message: None,
        }
    }
}

// `claude -p --output-format stream-json` で逐次受信し、
// `ask-stream` イベントでフロントに転送する。
//
//  - stream-json は --verbose が必須 (Claude CLI の仕様)
//  - プロンプトは stdin 経由 (variadic フラグとの argv 衝突回避)
//  - 許可ツール: Read, Glob, Grep のみ (Edit/Write/Bash は呼ばれない)
#[tauri::command]
pub async fn ask_claude_stream(
    app: AppHandle,
    request_id: String,
    prompt: String,
    root: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let mut cmd = Command::new("claude");
    if let Some(r) = root.as_deref() {
        if !r.is_empty() {
            cmd.current_dir(r);
        }
    }
    cmd.arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--allowedTools")
        .arg("Read,Glob,Grep,Edit,Write,Bash");
    if let Some(sid) = session_id.as_deref() {
        if !sid.is_empty() {
            cmd.arg("--resume").arg(sid);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "claude CLI の実行に失敗しました: {}. Claude Code が PATH に通っているか確認してください。",
            e
        )
    })?;

    // プロンプトを stdin に書き込み、EOF。
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("claude への入力送信に失敗: {}", e))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("stdin close 失敗: {}", e))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "claude の stdout を取得できませんでした".to_string())?;
    let stderr = child.stderr.take();

    // stdout を行単位で読んで emit
    let app_clone = app.clone();
    let request_id_clone = request_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(v) => handle_message(&app_clone, &request_id_clone, &v),
                Err(_) => {
                    // JSON パース失敗行はデバッグ用にそのまま text として流す
                    let mut ev = StreamEvent::new(&request_id_clone, "text");
                    ev.text = Some(line);
                    let _ = app_clone.emit("ask-stream", ev);
                }
            }
        }
    });

    // stderr はまとめて読み、エラー時のメッセージに使う
    let stderr_task = if let Some(err_pipe) = stderr {
        Some(tokio::spawn(async move {
            let mut reader = BufReader::new(err_pipe);
            let mut buf = String::new();
            let _ = reader.read_to_string(&mut buf).await;
            buf
        }))
    } else {
        None
    };

    let status = child
        .wait()
        .await
        .map_err(|e| format!("claude の終了待機に失敗: {}", e))?;

    let _ = stdout_task.await;
    let err_text = if let Some(t) = stderr_task {
        t.await.unwrap_or_default()
    } else {
        String::new()
    };

    if !status.success() {
        let mut ev = StreamEvent::new(&request_id, "error");
        ev.message = Some(format!(
            "claude CLI がエラーで終了しました (exit: {:?}): {}",
            status.code(),
            err_text.trim()
        ));
        let _ = app.emit("ask-stream", ev);
        return Err(err_text.trim().to_string());
    }

    let mut done = StreamEvent::new(&request_id, "done");
    done.message = Some(String::new());
    let _ = app.emit("ask-stream", done);
    Ok(())
}

// stream-json の 1 メッセージを解釈して、必要なものだけ emit する。
fn handle_message(app: &AppHandle, request_id: &str, v: &serde_json::Value) {
    let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match typ {
        // 初期化メッセージ: session_id を拾う
        "system" => {
            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                let mut ev = StreamEvent::new(request_id, "session");
                ev.session_id = Some(sid.to_string());
                let _ = app.emit("ask-stream", ev);
            }
        }
        // assistant の発話 (text / tool_use が content 配列で流れてくる)
        "assistant" => {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    let it = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match it {
                        "text" => {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if !text.is_empty() {
                                    let mut ev = StreamEvent::new(request_id, "text");
                                    ev.text = Some(text.to_string());
                                    let _ = app.emit("ask-stream", ev);
                                }
                            }
                        }
                        "tool_use" => {
                            let name = item
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            let input = item.get("input").cloned();
                            let mut ev = StreamEvent::new(request_id, "tool");
                            ev.tool_name = Some(name);
                            ev.tool_input = input;
                            let _ = app.emit("ask-stream", ev);
                        }
                        _ => {}
                    }
                }
            }
        }
        // 最終結果: session_id と result を done として送る
        "result" => {
            let sid = v
                .get("session_id")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
            let result_text = v
                .get("result")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string());
            let is_error = v
                .get("is_error")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            if is_error {
                let mut ev = StreamEvent::new(request_id, "error");
                ev.message = result_text.or(Some("claude が is_error=true を返しました".into()));
                let _ = app.emit("ask-stream", ev);
            } else {
                let mut ev = StreamEvent::new(request_id, "done");
                ev.session_id = sid;
                ev.message = result_text;
                let _ = app.emit("ask-stream", ev);
            }
        }
        _ => {
            // tool_result (user ロール) などは現時点では UI で扱わないので無視
        }
    }
}
