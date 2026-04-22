// 「最後に見た日より後に更新があった」ファイルにドットを出すための状態管理。
// ファイルを開いて一定時間経つと Date.now() を記録。途中で別ファイルに切り替えたらキャンセル。
// Rust 側の mtime (unix 秒) と localStorage の lastViewed (ms) を比較する。
import { state } from './state';

const VIEW_DWELL_MS = 3000;

function key(filePath: string): string {
  const rel = state.currentRoot && filePath.startsWith(state.currentRoot.path)
    ? filePath.slice(state.currentRoot.path.length)
    : filePath;
  return `askmd-lastViewed:${rel}`;
}

function read(filePath: string): number | null {
  try {
    const v = localStorage.getItem(key(filePath));
    return v != null ? parseInt(v, 10) : null;
  } catch { return null; }
}

function write(filePath: string): void {
  try { localStorage.setItem(key(filePath), String(Date.now())); } catch {}
}

/** 未読 (記録なし) または mtime が lastViewed より新しい場合に true */
export function isUpdated(filePath: string, mtime: number | undefined): boolean {
  const last = read(filePath);
  if (last == null) return true;
  if (mtime == null) return false;
  return mtime * 1000 > last;
}

let dwellTimer: ReturnType<typeof setTimeout> | null = null;
let dwellPath: string | null = null;

/** 一定時間経過したら既読化。別パスでの呼び直しで前のタイマーはキャンセルされる。 */
export function scheduleMarkViewed(filePath: string, onConfirmed: (path: string) => void): void {
  if (dwellTimer != null) clearTimeout(dwellTimer);
  dwellPath = filePath;
  dwellTimer = setTimeout(() => {
    dwellTimer = null;
    if (dwellPath !== filePath) return;
    dwellPath = null;
    write(filePath);
    onConfirmed(filePath);
  }, VIEW_DWELL_MS);
}
