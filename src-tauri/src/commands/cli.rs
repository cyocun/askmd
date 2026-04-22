use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// ウィンドウラベル → (初期ルート, 初期ファイル) のマップ。
/// 各ウィンドウは起動時に自分のラベルで引き当てて使う。
/// main プロセスが起動時に "main" を入れ、`new_window` が増分ラベルで追加する。
pub struct WindowInits {
    inner: Mutex<HashMap<String, (Option<String>, Option<String>)>>,
    counter: Mutex<u32>,
}

impl WindowInits {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            counter: Mutex::new(1), // main は 1、次は 2 から
        }
    }

    pub fn set(&self, label: String, root: Option<String>, file: Option<String>) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(label, (root, file));
        }
    }

    pub fn get_root(&self, label: &str) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|m| m.get(label).and_then(|(r, _)| r.clone()))
    }

    pub fn take_file(&self, label: &str) -> Option<String> {
        // file は「起動時に一度だけ開く」ので取り出し時にクリア
        self.inner.lock().ok().and_then(|mut m| {
            m.get_mut(label).and_then(|(_, f)| f.take())
        })
    }

    fn next_label(&self) -> String {
        let mut c = self.counter.lock().expect("counter lock");
        *c += 1;
        format!("win-{}", *c)
    }
}

/// Dock アイコンドロップや Finder "Open With" から届くパスを、
/// JS 側のリスナ登録前に受け取っても取りこぼさないためのキュー。
pub struct PendingOpens(pub Mutex<Vec<String>>);

impl PendingOpens {
    pub fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
    pub fn push(&self, path: String) {
        if let Ok(mut q) = self.0.lock() {
            q.push(path);
        }
    }
}

/// CLI 引数やドロップされたパスを (ルートディレクトリ, 起動時に開くファイル) に解決する。
pub fn resolve_initial(arg: &str) -> (Option<String>, Option<String>) {
    let expanded = if let Some(stripped) = arg.strip_prefix("~/") {
        dirs::home_dir()
            .map(|h| h.join(stripped))
            .unwrap_or_else(|| std::path::PathBuf::from(arg))
    } else {
        std::path::PathBuf::from(arg)
    };
    if expanded.is_dir() {
        (Some(expanded.to_string_lossy().into_owned()), None)
    } else if expanded.is_file()
        && expanded
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
    {
        let root = expanded
            .parent()
            .map(|p| p.to_string_lossy().into_owned());
        let file = expanded.to_string_lossy().into_owned();
        (root, Some(file))
    } else {
        (None, None)
    }
}

#[tauri::command]
pub fn get_initial_path(window: tauri::Window, state: State<'_, WindowInits>) -> Option<String> {
    state.get_root(window.label())
}

#[tauri::command]
pub fn get_initial_file(window: tauri::Window, state: State<'_, WindowInits>) -> Option<String> {
    state.take_file(window.label())
}

#[tauri::command]
pub fn take_pending_opens(state: State<'_, PendingOpens>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

/// パスから macOS タブラベルに使うタイトルを作る。
/// ディレクトリ / .md ファイルなら basename、解決できなければ "新しいウインドウ" にフォールバック。
fn title_from_path(path: Option<&str>) -> String {
    path.and_then(|p| {
        let pb = Path::new(p);
        pb.file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    })
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| "新しいウインドウ".to_string())
}

/// 新しいウィンドウを同一プロセス内に生成する。
/// `path` があれば (ディレクトリ or .md ファイル) として解決し、そのウィンドウの初期状態にする。
/// 無ければ recent ディレクトリ一覧を出す空のウィンドウになる。
///
/// macOS のネイティブタブ機能に対応するため tabbing_identifier を揃えているので、
/// OS 設定「書類を開くときはタブで開く」に従って自動的にタブ化される。
/// タブのラベルは window title がそのまま使われるので、パスから決めた固有名を渡す
/// (全窓同じ "askmd" だと全タブが "askmd" で区別できない)。
pub fn create_new_window(
    app: &AppHandle,
    path: Option<String>,
    inits: &WindowInits,
) -> Result<String, String> {
    let title = title_from_path(path.as_deref());
    let (root, file) = match path {
        Some(p) => resolve_initial(&p),
        None => (None, None),
    };
    let label = inits.next_label();
    inits.set(label.clone(), root, file);

    // 新窓のサイズは既存窓 (フォーカス中 > それ以外の main > fallback) に合わせる。
    // 固定 1100x750 で作るとタブグループに合流したとき macOS がグループ全体を
    // 新窓サイズへリサイズし、既存タブまで意図せぬサイズに揺れる。
    let windows = app.webview_windows();
    let reference = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next());
    let (init_w, init_h) = reference
        .and_then(|w| {
            let scale = w.scale_factor().ok()?;
            let size = w.inner_size().ok()?;
            Some((size.width as f64 / scale, size.height as f64 / scale))
        })
        .unwrap_or((1100.0, 750.0));

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title(&title)
        .inner_size(init_w, init_h)
        .min_inner_size(600.0, 400.0);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder.build().map_err(|e| e.to_string())?;
    Ok(label)
}


#[tauri::command]
pub fn new_window(
    app: AppHandle,
    path: Option<String>,
    state: State<'_, WindowInits>,
) -> Result<String, String> {
    create_new_window(&app, path, &state)
}
