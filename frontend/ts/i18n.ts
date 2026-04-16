// シンプルな i18n: システムロケールで自動判定、日英対応
type Lang = 'ja' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  // ─ Empty state ─
  'empty.open': { ja: 'ディレクトリを開く…', en: 'Open Directory…' },
  'empty.hint': { ja: 'Drop / ⌘O', en: 'Drop / ⌘O' },
  'empty.recent': { ja: '最近開いたフォルダ', en: 'Recent' },
  'empty.selectFile': { ja: 'ファイルを選んでください', en: 'Select a file' },
  // ─ Filter / Search ─
  'filter.placeholder': { ja: '@ でファイル絞り込み', en: '@ to filter files' },
  'palette.placeholder': { ja: 'ファイル名で検索…', en: 'Search by filename…' },
  'search.placeholder': { ja: '全文検索: .md を横断', en: 'Full-text search across .md' },
  'search.min': { ja: '2 文字以上で検索します', en: 'Type at least 2 characters' },
  'search.searching': { ja: '検索中…', en: 'Searching…' },
  'search.noMatch': { ja: 'マッチなし', en: 'No matches' },
  'search.results': { ja: '{0} 件 (上限 200)', en: '{0} results (max 200)' },
  // ─ Toolbar titles ─
  'tb.sidebar': { ja: 'サイドバー (⌘B)', en: 'Sidebar (⌘B)' },
  'tb.search': { ja: '全文検索 (⌘F)', en: 'Search (⌘F)' },
  'tb.palette': { ja: 'クイックスイッチ (⌘P)', en: 'Quick Switch (⌘P)' },
  // ─ Header actions ─
  'header.finder': { ja: 'Finder で表示', en: 'Reveal in Finder' },
  'header.translate': { ja: '翻訳 (⌘⇧T)', en: 'Translate (⌘⇧T)' },
  'header.clickToSelect': { ja: 'クリックで選択', en: 'Click to select' },
  // ─ Translate ─
  'translate.btn': { ja: '翻訳', en: 'Translate' },
  'translate.restoreBtn': { ja: '原文に戻す', en: 'Original' },
  'translate.loading': { ja: '翻訳中…', en: 'Translating…' },
  'translate.done': { ja: '翻訳完了 (ホバーで原文)', en: 'Translated (hover for original)' },
  'translate.restored': { ja: '原文に戻しました', en: 'Restored original' },
  'translate.noDoc': { ja: '翻訳するドキュメントがありません', en: 'No document to translate' },
  'translate.noText': { ja: '翻訳するテキストがありません', en: 'No text to translate' },
  'translate.fail': { ja: '翻訳失敗: {0}', en: 'Translation failed: {0}' },
  // ─ Toast / errors ─
  'toast.deleted': { ja: '削除しました (⌘Z で戻す)', en: 'Deleted (⌘Z to undo)' },
  'toast.deleteFail': { ja: '削除失敗: {0}', en: 'Delete failed: {0}' },
  'toast.noUndo': { ja: '戻せる削除はありません', en: 'Nothing to undo' },
  'toast.restored': { ja: '復元しました', en: 'Restored' },
  'toast.restoreFail': { ja: '復元失敗: {0}', en: 'Restore failed: {0}' },
  'toast.readFail': { ja: '読み込み失敗: {0}', en: 'Read failed: {0}' },
  'toast.scanFail': { ja: 'スキャン失敗: {0}', en: 'Scan failed: {0}' },
  'toast.noMd': { ja: 'そのディレクトリには .md が見つかりません', en: 'No .md files found in this directory' },
  'toast.openDirFirst': { ja: '先にディレクトリを開いてください', en: 'Open a directory first' },
  'toast.noProvider': { ja: 'AI プロバイダーが見つかりません', en: 'No AI provider found' },
  'toast.selectText': { ja: '質問するテキストを本文中で選択してください', en: 'Select text in the document to ask' },
  'toast.switched': { ja: '{0} に切り替えました', en: 'Switched to {0}' },
  // ─ Provider ─
  'provider.title': { ja: 'AI プロバイダー切替', en: 'Switch AI Provider' },
  'provider.unavailable': { ja: '未検出', en: 'Not found' },
  // ─ Ask panel ─
  'ask.thinking': { ja: '考え中…', en: 'Thinking…' },
  'ask.toolRunning': { ja: '{0} 実行中…', en: 'Running {0}…' },
  'ask.error': { ja: 'エラー: {0}', en: 'Error: {0}' },
  'ask.unknownError': { ja: '不明なエラー', en: 'Unknown error' },
  'ask.continuing': { ja: '会話継続中', en: 'Continuing' },
  'ask.close': { ja: '閉じる (Esc)', en: 'Close (Esc)' },
  'ask.askProvider': { ja: '{0} に質問', en: 'Ask {0}' },
  'ask.inputPlaceholder': { ja: '何を聞きますか?', en: 'Ask a question…' },
  'ask.send': { ja: '送信', en: 'Send' },
  'ask.btn': { ja: '⌘L Ask', en: '⌘L Ask' },
  // ─ Delete ─
  'delete.title': { ja: 'Delete で削除 (確認あり)', en: 'Delete (with confirmation)' },
  // ─ Theme ─
  'theme.title': { ja: 'テーマ切替', en: 'Switch Theme' },
  // ─ Drop overlay ─
  'drop.text': { ja: 'ここにフォルダをドロップ', en: 'Drop folder here' },
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
