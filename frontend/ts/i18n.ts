// シンプルな i18n: システムロケールで自動判定、日英対応
type Lang = 'ja' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  // ─ Empty state ─
  'empty.open': { ja: 'フォルダを開く…', en: 'Open Folder…' },
  'empty.hint': { ja: 'ここにドロップ、または ⌘O', en: 'Drop here, or ⌘O' },
  'empty.recent': { ja: '最近開いたフォルダ', en: 'Recent Folders' },
  'empty.selectFile': { ja: '左からファイルを選んでください', en: 'Pick a file from the sidebar' },
  // ─ Filter / Search ─
  'filter.placeholder': { ja: '@ でファイル絞り込み', en: '@ to filter files' },
  'palette.placeholder': { ja: 'ファイル名で探す…', en: 'Find a file…' },
  'search.placeholder': { ja: 'すべてのメモから探す', en: 'Search all notes' },
  'search.min': { ja: '2 文字以上で探します', en: 'Type at least 2 characters' },
  'search.searching': { ja: '探しています…', en: 'Searching…' },
  'search.noMatch': { ja: '見つかりませんでした', en: 'Nothing found' },
  'search.results': { ja: '{0} 件見つかりました', en: '{0} results' },
  'search.error': { ja: '検索できませんでした: {0}', en: 'Couldn\u2019t search: {0}' },
  // ─ Toolbar titles ─
  'tb.sidebar': { ja: 'サイドバー (⌘B)', en: 'Sidebar (⌘B)' },
  'tb.search': { ja: 'すべてのメモから探す (⌘F)', en: 'Search all notes (⌘F)' },
  'tb.palette': { ja: 'ファイルを探す (⌘P)', en: 'Find file (⌘P)' },
  'tb.recent': { ja: '最近', en: 'Recent' },
  // ─ Header actions ─
  'header.finder': { ja: 'Finder で表示', en: 'Reveal in Finder' },
  'header.translate': { ja: '日本語に訳す (⌘⇧T)', en: 'Translate (⌘⇧T)' },
  'header.clickToSelect': { ja: 'クリックで選択', en: 'Click to select' },
  // ─ Translate ─
  'translate.btn': { ja: '翻訳', en: 'Translate' },
  'translate.restoreBtn': { ja: '原文に戻す', en: 'Show original' },
  'translate.loading': { ja: '翻訳中…', en: 'Translating…' },
  'translate.done': { ja: '翻訳しました (ホバーで原文)', en: 'Translated \u2014 hover to see original' },
  'translate.restored': { ja: '原文に戻しました', en: 'Back to original' },
  'translate.noDoc': { ja: '翻訳できるページがありません', en: 'Nothing here to translate' },
  'translate.noText': { ja: '翻訳できる文が見つかりませんでした', en: 'No text to translate' },
  'translate.fail': { ja: '翻訳できませんでした: {0}', en: 'Couldn\u2019t translate: {0}' },
  // ─ Toast / errors ─
  'toast.deleted': { ja: 'ゴミ箱に入れました (⌘Z で元に戻す)', en: 'Moved to Trash (⌘Z to undo)' },
  'toast.deleteFail': { ja: 'ゴミ箱に移せませんでした: {0}', en: 'Couldn\u2019t move to Trash: {0}' },
  'toast.noUndo': { ja: '元に戻せる操作はありません', en: 'Nothing to undo' },
  'toast.restored': { ja: '元に戻しました', en: 'Restored' },
  'toast.restoreFail': { ja: '元に戻せませんでした: {0}', en: 'Couldn\u2019t restore: {0}' },
  'toast.readFail': { ja: 'ファイルを開けませんでした: {0}', en: 'Couldn\u2019t open the file: {0}' },
  'toast.scanFail': { ja: 'フォルダを読み込めませんでした: {0}', en: 'Couldn\u2019t read this folder: {0}' },
  'toast.noMd': { ja: 'このフォルダに Markdown はありません', en: 'No Markdown files in this folder' },
  'toast.openDirFirst': { ja: 'フォルダを開いてから試してください', en: 'Open a folder first' },
  'toast.noProvider': { ja: 'AI につながっていません (Claude / Copilot / ChatGPT の CLI を入れてください)', en: 'AI isn\u2019t connected yet (install the Claude, Copilot, or ChatGPT CLI)' },
  'toast.selectText': { ja: '聞きたい箇所を選んでください', en: 'Select the part you want to ask about' },
  'toast.openFile': { ja: 'ファイルを開いてから試してください', en: 'Open a file first' },
  'toast.saved': { ja: '保存しました', en: 'Saved' },
  'toast.saveFail': { ja: '保存できませんでした: {0}', en: 'Couldn\u2019t save: {0}' },
  'toast.copied': { ja: 'コピーしました', en: 'Copied' },
  'toast.renamed': { ja: '名前を変えました', en: 'Renamed' },
  'toast.duplicated': { ja: '複製しました', en: 'Duplicated' },
  'toast.moved': { ja: '移動しました', en: 'Moved' },
  'toast.moveFail': { ja: '移動できませんでした: {0}', en: 'Couldn\u2019t move: {0}' },
  'toast.renameFail': { ja: '名前を変えられませんでした: {0}', en: 'Couldn\u2019t rename: {0}' },
  'toast.duplicateFail': { ja: '複製できませんでした: {0}', en: 'Couldn\u2019t duplicate: {0}' },
  'toast.imageInserted': { ja: '画像を挿入しました', en: 'Image inserted' },
  'toast.imageFail': { ja: '画像を取り込めませんでした: {0}', en: 'Couldn\u2019t import image: {0}' },
  // ─ Diff / Changes ─
  'diff.changed': { ja: '{0} 行変更', en: '{0} lines changed' },
  'diff.clickToView': { ja: 'クリックで差分を見る', en: 'Click to see changes' },
  'changes.title': { ja: '変更のあるファイル ({0})', en: 'Files with changes ({0})' },
  'changes.none': { ja: '変更のあるファイルはありません', en: 'No changes' },
  'changes.fail': { ja: '変更のあるファイルを調べられませんでした', en: 'Couldn\u2019t check for changes' },
  // ─ Recent files (mtime) ─
  'recent.title': { ja: '最近更新したメモ', en: 'Recently updated' },
  'recent.none': { ja: 'まだ更新されたメモはありません', en: 'No recent updates' },
  'recent.fail': { ja: '最近のメモを調べられませんでした', en: 'Couldn\u2019t load recent notes' },
  // ─ Edit ─
  'edit.btn': { ja: '編集', en: 'Edit' },
  'edit.save': { ja: '保存', en: 'Save' },
  'edit.cancel': { ja: 'キャンセル', en: 'Cancel' },
  'header.edit': { ja: '編集 (⌘E)', en: 'Edit (⌘E)' },
  // ─ Toolbar ─
  'tb.changes': { ja: '変更のあるファイル', en: 'Files with changes' },
  'toast.switched': { ja: '{0} に切り替えました', en: 'Switched to {0}' },
  // ─ Provider ─
  'provider.title': { ja: 'AI を切り替え', en: 'Switch AI' },
  'provider.unavailable': { ja: '未インストール', en: 'Not installed' },
  // ─ Ask panel ─
  'ask.thinking': { ja: '考えています…', en: 'Thinking…' },
  'ask.toolRunning': { ja: '{0} を実行中…', en: 'Running {0}…' },
  'ask.error': { ja: 'うまくいきませんでした: {0}', en: 'Something went wrong: {0}' },
  'ask.unknownError': { ja: '原因がわかりませんでした', en: 'Unknown error' },
  'ask.continuing': { ja: '会話を続けています', en: 'Continuing' },
  'ask.close': { ja: '閉じる (Esc)', en: 'Close (Esc)' },
  'ask.askProvider': { ja: '{0} に聞く', en: 'Ask {0}' },
  'ask.inputPlaceholder': { ja: '何を聞きますか?', en: 'Ask anything\u2026' },
  'ask.send': { ja: '送信', en: 'Send' },
  'ask.btn': { ja: '聞く', en: 'Ask' },
  'ask.askFile': { ja: 'このメモについて聞く', en: 'Ask about this note' },
  'ask.pickTemplate': { ja: 'よく使う聞きかた', en: 'Quick prompts' },
  'ask.tpl.summarize': { ja: '3 行で要約して', en: 'Summarize in 3 lines' },
  'ask.tpl.explain': { ja: '専門用語をやさしく解説して', en: 'Explain the jargon in plain words' },
  'ask.tpl.next': { ja: '次のアクションを抽出して', en: 'Extract next actions' },
  'ask.tpl.translate': { ja: '日本語に訳して', en: 'Translate to English' },
  'ask.tpl.simple': { ja: 'もっとやさしく言い換えて', en: 'Rephrase more simply' },
  'ask.history.title': { ja: 'これまでのやりとり', en: 'Previous conversation' },
  'ask.history.clear': { ja: 'ここから捨てる', en: 'Clear from here' },
  'ask.history.restored': { ja: '前回の会話を復元しました', en: 'Restored previous conversation' },
  // ─ Selection floating bar ─
  'selbar.ask': { ja: '聞く', en: 'Ask' },
  'selbar.translate': { ja: '訳す', en: 'Translate' },
  'selbar.summarize': { ja: '要約', en: 'Summarize' },
  'selbar.copy': { ja: 'コピー', en: 'Copy' },
  // ─ Context menu (tree right-click) ─
  'ctx.open': { ja: '開く', en: 'Open' },
  'ctx.preview': { ja: 'プレビュー (Space)', en: 'Quick Look (Space)' },
  'ctx.reveal': { ja: 'Finder で表示', en: 'Reveal in Finder' },
  'ctx.copyPath': { ja: 'パスをコピー', en: 'Copy path' },
  'ctx.copyName': { ja: '名前をコピー', en: 'Copy name' },
  'ctx.duplicate': { ja: '複製', en: 'Duplicate' },
  'ctx.rename': { ja: '名前を変更', en: 'Rename' },
  'ctx.trash': { ja: 'ゴミ箱へ移動', en: 'Move to Trash' },
  'ctx.newFile': { ja: '新しいメモ', en: 'New Note' },
  // ─ Rename dialog ─
  'rename.title': { ja: '新しい名前を入力', en: 'New name' },
  'rename.ok': { ja: '変更', en: 'Rename' },
  'rename.cancel': { ja: 'キャンセル', en: 'Cancel' },
  'rename.invalid': { ja: '使えない名前です', en: 'That name can\u2019t be used' },
  'rename.exists': { ja: 'すでに同じ名前のファイルがあります', en: 'A file with that name already exists' },
  // ─ Quick Look ─
  'ql.hint': { ja: 'Space で閉じる', en: 'Space to close' },
  // ─ Delete ─
  'delete.title': { ja: 'Delete キーでゴミ箱へ (確認あり)', en: 'Delete to move to Trash (with confirmation)' },
  // ─ Theme ─
  'theme.title': { ja: 'テーマを切り替え', en: 'Switch theme' },
  // ─ Drop overlay ─
  'drop.text': { ja: 'ここにフォルダをドロップ', en: 'Drop a folder here' },
};

let currentLang: Lang = 'ja';

const STORAGE_KEY = 'askmd-lang';

export function initLang(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'ja' || saved === 'en') {
    currentLang = saved;
  } else {
    const sysLang = navigator.language || '';
    currentLang = sysLang.startsWith('ja') ? 'ja' : 'en';
  }
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
}

export function toggleLang(): Lang {
  const next: Lang = currentLang === 'ja' ? 'en' : 'ja';
  setLang(next);
  return next;
}

export function t(key: string, ...args: (string | number)[]): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[currentLang] || entry['en'] || key;
  for (let i = 0; i < args.length; i++) {
    text = text.replace(`{${i}}`, String(args[i]));
  }
  return text;
}
