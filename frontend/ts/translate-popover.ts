// 選択範囲翻訳の結果を軽量ポップオーバーで見せる。
// 本文の翻訳 (translateCurrentDoc) とは別物: こちらは「選択 → 即訳」専用。
import { createEl } from './dom';
import { t } from './i18n';

interface ShowOpts {
  range: Range;
  originalText: string;
}

let pop: HTMLElement | null = null;
let currentRange: Range | null = null;

function ensurePop(): HTMLElement {
  if (pop) return pop;
  pop = createEl('div', { id: 'translatePopover', class: 'translate-popover' });
  pop.hidden = true;
  document.body.appendChild(pop);
  // クリックでテキスト選択可能、外側クリックで閉じる
  document.addEventListener('mousedown', (ev) => {
    if (!pop || pop.hidden) return;
    if (pop.contains(ev.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pop && !pop.hidden) {
      close();
    }
  });
  return pop;
}

function close(): void {
  if (pop) pop.hidden = true;
  currentRange = null;
}

function position(el: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect();
  const w = el.offsetWidth || 420;
  const h = el.offsetHeight || 120;
  let left = rect.left;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (left < 12) left = 12;
  // 縦長 (複数行) の選択だと rect が画面いっぱいに広がり、選択下や選択上に
  // 置こうとすると top がビューポート外へ飛んでポップオーバーが消える。
  // 選択下を基本に、入りきらなければ選択上、それも無理なら最終的に
  // 必ずビューポート内へクランプして「結果が出ない」事故を防ぐ。
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 12) {
    const above = rect.top - h - 8;
    top = above >= 12 ? above : window.innerHeight - h - 12;
  }
  if (top < 12) top = 12;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export function showLoading(opts: ShowOpts): void {
  const el = ensurePop();
  currentRange = opts.range;
  el.hidden = false;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(createEl('div', { class: 'translate-popover-head' }, t('translate.loading')));
  el.appendChild(createEl('div', { class: 'translate-popover-spinner' }));
  position(el, opts.range);
}

export function showResult(translated: string): void {
  const el = ensurePop();
  if (!currentRange) return;
  el.hidden = false;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(createEl('div', { class: 'translate-popover-body' }, translated));
  const foot = createEl('div', { class: 'translate-popover-foot' },
    createEl('button', {
      class: 'btn-ghost',
      onClick: () => {
        navigator.clipboard.writeText(translated).catch(() => {});
      },
    }, t('selbar.copy')),
    createEl('span', { class: 'translate-popover-hint' }, 'Esc'),
  );
  el.appendChild(foot);
  position(el, currentRange);
}

export function showError(message: string): void {
  const el = ensurePop();
  if (!currentRange) return;
  el.hidden = false;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(createEl('div', { class: 'translate-popover-body error' }, message));
  position(el, currentRange);
}

export function closeTranslatePopover(): void {
  close();
}
