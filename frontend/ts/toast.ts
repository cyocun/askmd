// 画面右下の軽量トースト。2.4 秒で自動で消える。
// グローバルな #toast 要素は index.html 側に用意されている前提。
import { byId } from './dom';

const toast = byId('toast');
let toastTimer: number | null = null;

export function showToast(msg: string): void {
  toast.textContent = msg;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}
