use crate::commands::cli::{create_new_window, WindowInits};
use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

fn is_ja() -> bool {
    std::env::var("LANG")
        .unwrap_or_default()
        .to_lowercase()
        .starts_with("ja")
}

/// 日英のラベルを返す
macro_rules! l {
    ($ja:expr, $en:expr) => {
        if is_ja() { $ja } else { $en }
    };
}

pub fn build(handle: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let about = PredefinedMenuItem::about(handle, Some(l!("askmd について", "About askmd")), Some(
        AboutMetadataBuilder::new()
            .name(Some("askmd"))
            .version(Some(env!("CARGO_PKG_VERSION")))
            .build(),
    ))?;
    let quit = PredefinedMenuItem::quit(handle, Some(l!("askmd を終了", "Quit askmd")))?;
    let hide = PredefinedMenuItem::hide(handle, Some(l!("askmd を隠す", "Hide askmd")))?;
    let hide_others = PredefinedMenuItem::hide_others(handle, Some(l!("ほかを隠す", "Hide Others")))?;
    let show_all = PredefinedMenuItem::show_all(handle, Some(l!("すべてを表示", "Show All")))?;
    let separator = || PredefinedMenuItem::separator(handle);

    let app_menu = SubmenuBuilder::new(handle, "askmd")
        .item(&about)
        .item(&separator()?)
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .item(&separator()?)
        .item(&quit)
        .build()?;

    // File
    let new_window = MenuItemBuilder::with_id("new_window", l!("新しいウインドウ", "New Window"))
        .accelerator("CmdOrCtrl+N")
        .build(handle)?;
    let new_tab = MenuItemBuilder::with_id("new_tab", l!("新しいタブ", "New Tab"))
        .accelerator("CmdOrCtrl+T")
        .build(handle)?;
    let open_dir = MenuItemBuilder::with_id("open_dir", l!("ディレクトリを開く…", "Open Directory…"))
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    // Cmd+W はタブを閉じる (JS で処理)。最後のタブなら window を閉じる。
    let close_tab = MenuItemBuilder::with_id("close_tab", l!("タブを閉じる", "Close Tab"))
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let file_menu = SubmenuBuilder::new(handle, l!("ファイル", "File"))
        .item(&new_window)
        .item(&new_tab)
        .item(&separator()?)
        .item(&open_dir)
        .item(&separator()?)
        .item(&close_tab)
        .build()?;

    // Edit
    let undo_delete = MenuItemBuilder::with_id("undo_delete", l!("削除を元に戻す", "Undo Delete"))
        .accelerator("CmdOrCtrl+Z")
        .build(handle)?;
    let cut = PredefinedMenuItem::cut(handle, Some(l!("カット", "Cut")))?;
    let copy = PredefinedMenuItem::copy(handle, Some(l!("コピー", "Copy")))?;
    let paste = PredefinedMenuItem::paste(handle, Some(l!("ペースト", "Paste")))?;
    let select_all = PredefinedMenuItem::select_all(handle, Some(l!("すべてを選択", "Select All")))?;
    let edit_menu = SubmenuBuilder::new(handle, l!("編集", "Edit"))
        .item(&undo_delete)
        .item(&separator()?)
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .build()?;

    // View
    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", l!("サイドバー", "Sidebar"))
        .accelerator("CmdOrCtrl+B")
        .build(handle)?;
    let quick_switch = MenuItemBuilder::with_id("quick_switch", l!("クイックスイッチ", "Quick Switch"))
        .accelerator("CmdOrCtrl+P")
        .build(handle)?;
    let search = MenuItemBuilder::with_id("search", l!("全文検索", "Full-text Search"))
        .accelerator("CmdOrCtrl+F")
        .build(handle)?;
    let view_menu = SubmenuBuilder::new(handle, l!("表示", "View"))
        .item(&toggle_sidebar)
        .item(&separator()?)
        .item(&quick_switch)
        .item(&search)
        .build()?;

    // Tools
    let ask_ai = MenuItemBuilder::with_id("ask_ai", l!("AI に質問", "Ask AI"))
        .accelerator("CmdOrCtrl+L")
        .build(handle)?;
    let translate = MenuItemBuilder::with_id("translate", l!("翻訳", "Translate"))
        .accelerator("CmdOrCtrl+Shift+T")
        .build(handle)?;
    let reveal_finder = MenuItemBuilder::with_id("reveal_finder", l!("Finder で表示", "Reveal in Finder"))
        .build(handle)?;
    let tools_menu = SubmenuBuilder::new(handle, l!("ツール", "Tools"))
        .item(&ask_ai)
        .item(&translate)
        .item(&separator()?)
        .item(&reveal_finder)
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, l!("ウインドウ", "Window"))
        .item(&PredefinedMenuItem::minimize(handle, Some(l!("しまう", "Minimize")))?)
        .item(&PredefinedMenuItem::maximize(handle, Some(l!("拡大/縮小", "Zoom")))?)
        .item(&separator()?)
        .item(&PredefinedMenuItem::fullscreen(handle, Some(l!("フルスクリーン", "Full Screen")))?)
        .build()?;

    MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&tools_menu)
        .item(&window_menu)
        .build()
}

pub fn handle_event(handle: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    // 新規ウィンドウは Rust 側で完結。新規タブ / タブを閉じるは HTML 実装なので JS に転送。
    if id == "new_window" {
        let inits = handle.state::<WindowInits>();
        let _ = create_new_window(handle, None, &inits);
        return;
    }
    let _ = handle.emit("menu-action", id);
}
