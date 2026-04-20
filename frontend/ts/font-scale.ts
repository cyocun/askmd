// 読書領域 (.md-body) の文字サイズを Cmd+= / Cmd+- で増減する小さな state。
// CSS 変数 --md-font-scale を通じて倍率を反映するだけなので、
// DOM 再レンダは不要 (あらゆる em ベース指定が自動で追従)。

const STORAGE_KEY = 'askmd-font-scale';
const STEPS = [0.85, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6, 1.8];

function clampToStep(v: number): number {
  // 近い step にスナップ (浮動小数ずれで無限に細かくならないように)
  let best = STEPS[0];
  let min = Infinity;
  for (const s of STEPS) {
    const d = Math.abs(s - v);
    if (d < min) { min = d; best = s; }
  }
  return best;
}

function load(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return 1.0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? clampToStep(n) : 1.0;
}

function apply(scale: number): void {
  document.documentElement.style.setProperty('--md-font-scale', String(scale));
  localStorage.setItem(STORAGE_KEY, String(scale));
}

export function initFontScale(): void {
  apply(load());
}

function bump(delta: number): void {
  const cur = load();
  const i = STEPS.indexOf(clampToStep(cur));
  const next = Math.max(0, Math.min(STEPS.length - 1, i + delta));
  apply(STEPS[next]);
}

export function increaseFontScale(): void { bump(1); }
export function decreaseFontScale(): void { bump(-1); }
export function resetFontScale(): void { apply(1.0); }
