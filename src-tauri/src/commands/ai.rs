use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

// ───────── プロバイダー定義 ─────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Claude,
    Copilot,
    Codex,
}

impl ProviderId {
    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Copilot => "Copilot",
            Self::Codex => "Codex",
        }
    }

    fn command_name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            // 旧 `gh copilot` 拡張は 2025-10 で非推奨。単体の新 Copilot CLI を見る。
            Self::Copilot => "copilot",
            // OpenAI のターミナルツールは codex (旧 chatgpt CLI は実体が曖昧)。
            Self::Codex => "codex",
        }
    }

    /// PATH 上にコマンドが存在するか (同期チェック)
    fn is_available(self) -> bool {
        std::process::Command::new("which")
            .arg(self.command_name())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

const ALL_PROVIDERS: [ProviderId; 3] = [ProviderId::Claude, ProviderId::Copilot, ProviderId::Codex];

// ───────── Tauri managed state ─────────

pub struct ActiveProvider(pub Mutex<ProviderId>);

impl ActiveProvider {
    pub fn new() -> Self {
        Self(Mutex::new(ProviderId::Claude))
    }
}

// ───────── StreamEvent (claude.rs から移動) ─────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub request_id: String,
    pub kind: String, // "session" | "tool" | "text" | "done" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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

// ───────── フロント向け provider 情報 ─────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    id: ProviderId,
    name: String,
    available: bool,
}

#[tauri::command]
pub fn get_ai_providers() -> Vec<ProviderInfo> {
    ALL_PROVIDERS
        .iter()
        .map(|&p| ProviderInfo {
            id: p,
            name: p.label().to_string(),
            available: p.is_available(),
        })
        .collect()
}

#[tauri::command]
pub fn get_active_provider(state: State<'_, ActiveProvider>) -> ProviderId {
    *state.0.lock().unwrap()
}

#[tauri::command]
pub fn set_active_provider(
    state: State<'_, ActiveProvider>,
    provider: ProviderId,
) -> Result<(), String> {
    if !provider.is_available() {
        return Err(format!(
            "{} ({}) が PATH 上に見つかりません。インストール状況を確認してください。",
            provider.label(),
            provider.command_name()
        ));
    }
    *state.0.lock().unwrap() = provider;
    Ok(())
}

// ───────── 実行中リクエストの停止 ─────────
// request_id → 子プロセス pid。フロントの「停止」ボタンから cancel_ask で kill する。

static RUNNING: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CANCELLED: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn register_child(request_id: &str, pid: Option<u32>) {
    if let Some(pid) = pid {
        if let Ok(mut m) = RUNNING.lock() {
            m.insert(request_id.to_string(), pid);
        }
    }
}

/// 登録を外し、停止要求が出ていたかを返す
fn unregister_child(request_id: &str) -> bool {
    if let Ok(mut m) = RUNNING.lock() {
        m.remove(request_id);
    }
    CANCELLED
        .lock()
        .map(|mut s| s.remove(request_id))
        .unwrap_or(false)
}

#[tauri::command]
pub fn cancel_ask(request_id: String) {
    let pid = RUNNING
        .lock()
        .ok()
        .and_then(|m| m.get(&request_id).copied());
    if let Some(pid) = pid {
        if let Ok(mut s) = CANCELLED.lock() {
            s.insert(request_id);
        }
        // SIGTERM。CLI が無視しても kill_on_drop が最終的に始末する
        let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
    }
}

// ───────── 統合ストリームコマンド ─────────

#[tauri::command]
pub async fn ask_ai_stream(
    app: AppHandle,
    state: State<'_, ActiveProvider>,
    request_id: String,
    prompt: String,
    root: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let provider = *state.0.lock().unwrap();
    match provider {
        ProviderId::Claude => run_claude(app, request_id, prompt, root, session_id).await,
        ProviderId::Copilot => run_plain_text(app, request_id, prompt, root, provider).await,
        ProviderId::Codex => run_plain_text(app, request_id, prompt, root, provider).await,
    }
}

// ───────── Claude: stream-json モード ─────────

async fn run_claude(
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
        .arg("--exclude-dynamic-system-prompt-sections")
        // askmd は「読むが主」。質問用途で AI に編集系 (Edit/Write/Bash) を許すと
        // Dropbox 配下を勝手に書き換える事故になり得るため、読み取り専用ツールに絞る。
        .arg("--allowedTools")
        .arg("Read,Glob,Grep");
    if let Some(sid) = session_id.as_deref() {
        if !sid.is_empty() {
            cmd.arg("--resume").arg(sid);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // アプリ終了/future drop 時に子プロセス (claude) を確実に kill して孤児化を防ぐ
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "claude CLI の実行に失敗しました: {}. Claude Code が PATH に通っているか確認してください。",
            e
        )
    })?;

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

    let app_clone = app.clone();
    let rid = request_id.clone();
    // result 行で done/error を emit 済みかを返す。これを見て下の status 判定で
    // 二重に done/error を飛ばさないようにする。
    let stdout_task = tokio::spawn(async move {
        let mut saw_result = false;
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(v) => saw_result |= handle_claude_message(&app_clone, &rid, &v),
                Err(_) => {
                    let mut ev = StreamEvent::new(&rid, "text");
                    ev.text = Some(line);
                    let _ = app_clone.emit("ask-stream", ev);
                }
            }
        }
        saw_result
    });

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

    register_child(&request_id, child.id());
    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            unregister_child(&request_id);
            return Err(format!("claude の終了待機に失敗: {}", e));
        }
    };
    let was_cancelled = unregister_child(&request_id);

    let saw_result = stdout_task.await.unwrap_or(false);
    let err_text = if let Some(t) = stderr_task {
        t.await.unwrap_or_default()
    } else {
        String::new()
    };

    // 停止ボタン経由の終了。フロントは停止時点で UI を確定済みなので何も emit しない
    if was_cancelled {
        return Ok(());
    }

    // result 行で既に done/error を emit している場合は、status ベースの終端を出さない
    // (正常終了でも exit code 非0 の警告ケースで二重終端になるのを防ぐ)。
    // Err を返すと JS 側の catch がもう一度 showError して UI が二重終端になるため、
    // 終端イベントを emit したら戻り値は常に Ok にする。
    if saw_result {
        return Ok(());
    }

    if !status.success() {
        let mut ev = StreamEvent::new(&request_id, "error");
        ev.message = Some(format!(
            "claude CLI がエラーで終了しました (exit: {:?}): {}",
            status.code(),
            err_text.trim()
        ));
        let _ = app.emit("ask-stream", ev);
        return Ok(());
    }

    let mut done = StreamEvent::new(&request_id, "done");
    done.message = Some(String::new());
    let _ = app.emit("ask-stream", done);
    Ok(())
}

// ───────── Plain text モード (Copilot / Codex 等) ─────────
// stdout をそのまま text イベントとして逐次転送。
// セッション継続・ツール呼び出しはサポートしない。

async fn run_plain_text(
    app: AppHandle,
    request_id: String,
    prompt: String,
    root: Option<String>,
    provider: ProviderId,
) -> Result<(), String> {
    let mut cmd = build_plain_command(provider, &prompt);
    if let Some(r) = root.as_deref() {
        if !r.is_empty() {
            cmd.current_dir(r);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let label = provider.label();
    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "{} CLI の実行に失敗しました: {}. {} が PATH に通っているか確認してください。",
            label,
            e,
            provider.command_name()
        )
    })?;

    // stdin にプロンプトを送るプロバイダーの場合
    if needs_stdin(provider) {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(prompt.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{} の stdout を取得できませんでした", label))?;
    let stderr = child.stderr.take();

    // stdout を行単位で逐次 emit (擬似ストリーミング)
    let app_clone = app.clone();
    let rid = request_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut ev = StreamEvent::new(&rid, "text");
            ev.text = Some(format!("{}\n", line));
            let _ = app_clone.emit("ask-stream", ev);
        }
    });

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

    register_child(&request_id, child.id());
    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            unregister_child(&request_id);
            return Err(format!("{} の終了待機に失敗: {}", label, e));
        }
    };
    let was_cancelled = unregister_child(&request_id);

    let _ = stdout_task.await;
    let err_text = if let Some(t) = stderr_task {
        t.await.unwrap_or_default()
    } else {
        String::new()
    };

    if was_cancelled {
        return Ok(());
    }

    if !status.success() {
        let mut ev = StreamEvent::new(&request_id, "error");
        ev.message = Some(format!(
            "{} がエラーで終了しました (exit: {:?}): {}",
            label,
            status.code(),
            err_text.trim()
        ));
        let _ = app.emit("ask-stream", ev);
        // error イベントで通知済み。Err を返すと JS 側 catch で二重表示になる。
        return Ok(());
    }

    let mut done = StreamEvent::new(&request_id, "done");
    done.message = Some(String::new());
    let _ = app.emit("ask-stream", done);
    Ok(())
}

/// プロバイダーごとの Command を組み立てる
fn build_plain_command(provider: ProviderId, prompt: &str) -> Command {
    match provider {
        ProviderId::Copilot => {
            // 新 Copilot CLI: copilot -p "<prompt>" -s (-s = セッションメタを抑えた素のテキスト出力)
            let mut cmd = Command::new("copilot");
            cmd.arg("-p").arg(prompt).arg("-s");
            cmd
        }
        ProviderId::Codex => {
            // OpenAI Codex CLI: codex exec "<prompt>" (非対話。--json で ndjson も可だが
            // ここでは行単位の素テキストを擬似ストリーミングする)
            let mut cmd = Command::new("codex");
            cmd.arg("exec").arg(prompt);
            cmd
        }
        ProviderId::Claude => unreachable!("Claude は run_claude を使う"),
    }
}

/// stdin 経由でプロンプトを渡すプロバイダーか (現状はどちらも引数渡し)
fn needs_stdin(provider: ProviderId) -> bool {
    match provider {
        ProviderId::Copilot => false,
        ProviderId::Codex => false,
        ProviderId::Claude => false, // run_claude 側で処理
    }
}

// ───────── Claude stream-json パーサー ─────────

/// 戻り値: result 行を処理して done/error を emit した場合 true。
fn handle_claude_message(app: &AppHandle, request_id: &str, v: &serde_json::Value) -> bool {
    let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match typ {
        "system" => {
            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                let mut ev = StreamEvent::new(request_id, "session");
                ev.session_id = Some(sid.to_string());
                let _ = app.emit("ask-stream", ev);
            }
        }
        // content_block_delta: テキストの逐次チャンク
        "content_block_delta" => {
            if let Some(delta) = v.get("delta") {
                let dt = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if dt == "text_delta" {
                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        if !text.is_empty() {
                            let mut ev = StreamEvent::new(request_id, "text");
                            ev.text = Some(text.to_string());
                            let _ = app.emit("ask-stream", ev);
                        }
                    }
                }
            }
        }
        // assistant: メッセージ (テキスト + ツール呼び出し)
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
                ev.message =
                    result_text.or(Some("claude が is_error=true を返しました".into()));
                let _ = app.emit("ask-stream", ev);
            } else {
                let mut ev = StreamEvent::new(request_id, "done");
                ev.session_id = sid;
                ev.message = result_text;
                let _ = app.emit("ask-stream", ev);
            }
            return true;
        }
        _ => {}
    }
    false
}
