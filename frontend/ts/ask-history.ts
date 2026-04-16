// Ask パネルの会話履歴を localStorage に永続化する。
// ファイル (絶対パス) 単位で直近の Q/A と sessionId を持ち、次回開いた時に復元する。
// 実行時にサーバへ履歴を再送しない — Claude CLI は sessionId で文脈を覚えているため、
// UI 上の表示だけを再生する。
const STORAGE_PREFIX = 'askmd-ask-history:';
const MAX_TURNS = 20;

export interface HistoryTurn {
  q: string;
  a: string;
  ts: number;
}

export interface HistoryEntry {
  turns: HistoryTurn[];
  sessionId: string | null;
  updatedAt: number;
}

function key(path: string): string {
  return STORAGE_PREFIX + path;
}

export function loadHistory(path: string): HistoryEntry | null {
  try {
    const raw = localStorage.getItem(key(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HistoryEntry;
    if (!parsed || !Array.isArray(parsed.turns)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveHistory(path: string, entry: HistoryEntry): void {
  try {
    localStorage.setItem(key(path), JSON.stringify(entry));
  } catch {
    // Quota 超過などは握り潰す (履歴は消えてもアプリ動作は止めない)
  }
}

export function pushTurn(
  path: string,
  turn: HistoryTurn,
  sessionId: string | null,
): void {
  const existing = loadHistory(path) ?? { turns: [], sessionId: null, updatedAt: 0 };
  existing.turns.push(turn);
  // 古いものから間引き
  if (existing.turns.length > MAX_TURNS) {
    existing.turns = existing.turns.slice(-MAX_TURNS);
  }
  if (sessionId) existing.sessionId = sessionId;
  existing.updatedAt = Date.now();
  saveHistory(path, existing);
}

export function clearHistory(path: string): void {
  try {
    localStorage.removeItem(key(path));
  } catch {
    // noop
  }
}
