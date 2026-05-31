// AI CLI が無いユーザー (デザイナー/PM 想定) 向けの「web 橋渡し」。
// 選択 + 全文 + 質問を自己完結したプロンプトに整形してクリップボードへコピーし、
// ブラウザの ChatGPT / Claude を開く。API キーも CLI も要らず、ユーザーが既に
// 持っている web 契約にそのまま乗る。橋渡し先は毎回選ばせ、前回分を記憶しておく。
import { invoke } from '@tauri-apps/api/core';
import { createEl, clear } from './dom';
import { t } from './i18n';
import { relPathOf } from './ask';
import type { AskContext } from './ask';

const WEB_LIMIT = 8000;
const PREF_KEY = 'askmd-web-ask-target';

type Target = 'chatgpt' | 'claude';
// 橋渡し先ごとの URL とラベルを 1 箇所に集約 (web 版はファイルを読めないので
// プロンプトには全文をインライン同梱する前提)。
const TARGETS: Record<Target, { url: string; askKey: string; openKey: string }> = {
  chatgpt: { url: 'https://chatgpt.com/', askKey: 'webask.chatgpt', openKey: 'webask.openChatgpt' },
  claude: { url: 'https://claude.ai/new', askKey: 'webask.claude', openKey: 'webask.openClaude' },
};

function lastTarget(): Target {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === 'chatgpt' || v === 'claude') return v;
  } catch { /* ignore */ }
  return 'chatgpt';
}

// CLI 用 buildPrompt と違い、ファイル読み込み指示を一切入れず全文をインライン化する。
function buildWebPrompt(selection: string, ctx: AskContext, question: string): string {
  const relPath = relPathOf(ctx);

  const parts: string[] = [];
  parts.push('以下のドキュメントについての質問です。');
  parts.push('');
  parts.push(`# ${ctx.title} (${relPath})`);
  parts.push('');

  if (ctx.fileContent) {
    const body = ctx.fileContent.length <= WEB_LIMIT
      ? ctx.fileContent
      : `${ctx.fileContent.slice(0, WEB_LIMIT)}\n…(以下省略)`;
    parts.push('--- ドキュメント全文 ---');
    parts.push(body);
    parts.push('--- ここまで ---');
    parts.push('');
  }

  if (selection) {
    parts.push('質問は次の選択部分についてです:');
    parts.push(selection.split('\n').map((l) => `> ${l}`).join('\n'));
    parts.push('');
  }

  parts.push(`質問: ${question}`);
  return parts.join('\n');
}

let pop: HTMLElement | null = null;

function ensurePop(): HTMLElement {
  if (pop) return pop;
  pop = createEl('div', { id: 'webAskPopover', class: 'web-ask-popover' });
  pop.hidden = true;
  // 選択を消さないため mousedown を止める
  pop.addEventListener('mousedown', (ev) => ev.preventDefault());
  document.body.appendChild(pop);
  document.addEventListener('mousedown', (ev) => {
    if (!pop || pop.hidden) return;
    if (pop.contains(ev.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pop && !pop.hidden) close();
  });
  return pop;
}

function close(): void {
  if (pop) pop.hidden = true;
}

function position(el: HTMLElement, range?: Range): void {
  const w = el.offsetWidth || 280;
  const h = el.offsetHeight || 120;
  let top: number;
  let left: number;
  if (range) {
    const rect = range.getBoundingClientRect();
    top = rect.bottom + 8;
    left = rect.left;
    if (top + h > window.innerHeight - 12) top = rect.top - h - 8;
  } else {
    // 選択なし (全文質問) は右下の fileAskBtn 近くに
    top = window.innerHeight - h - 72;
    left = window.innerWidth - w - 24;
  }
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (left < 12) left = 12;
  if (top < 12) top = 12;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export interface WebAskOpts {
  selection: string;
  ctx: AskContext;
  /** 要約など質問が確定済みの場合。未指定なら入力欄を出す。 */
  question?: string;
  range?: Range;
}

// 末尾に「CLI を入れれば画面内で直接使える」案内を添える (非 CLI ユーザーの教育)。
function appendCliHint(el: HTMLElement): void {
  el.appendChild(createEl('div', { class: 'web-ask-cli-hint' }, t('webask.cliHint')));
}

// CLI 不在時の「聞く / 要約」から呼ぶ。2 ステップ:
//   1) 質問入力 + 橋渡し先を選ぶ
//   2) 「コピーした」旨 + ブラウザを開くボタン + 貼り付け説明を提示 (即開かない)
export function openWebAsk(opts: WebAskOpts): void {
  const el = ensurePop();
  el.hidden = false;
  renderChoose(el, opts);
}

// ── ステップ 1: 質問 + 橋渡し先選択 ──
function renderChoose(el: HTMLElement, opts: WebAskOpts): void {
  clear(el);
  el.appendChild(createEl('div', { class: 'web-ask-head' }, t('webask.head')));

  let input: HTMLInputElement | null = null;
  if (opts.question == null) {
    input = createEl('input', {
      class: 'web-ask-input',
      type: 'text',
      placeholder: t('webask.placeholder'),
    }) as HTMLInputElement;
    el.appendChild(input);
  }

  const resolveQuestion = (): string | null => {
    if (opts.question != null) return opts.question;
    const q = input?.value.trim() || '';
    return q || null;
  };

  const proceed = (target: Target): void => {
    const question = resolveQuestion();
    if (!question) { input?.focus(); return; }
    const prompt = buildWebPrompt(opts.selection, opts.ctx, question);
    void renderConfirm(el, opts, target, prompt);
  };

  const last = lastTarget();
  const makeTargetBtn = (target: Target, label: string): HTMLButtonElement => {
    const btn = createEl('button', {
      class: `web-ask-target${target === last ? ' last' : ''}`,
      onClick: () => proceed(target),
    }, label) as HTMLButtonElement;
    if (target === last) {
      btn.appendChild(createEl('span', { class: 'web-ask-last-hint' }, t('webask.last')));
    }
    return btn;
  };

  const row = createEl('div', { class: 'web-ask-targets' });
  // 前回選んだ方を先頭に並べる
  const order: Target[] = last === 'claude' ? ['claude', 'chatgpt'] : ['chatgpt', 'claude'];
  for (const tg of order) {
    row.appendChild(makeTargetBtn(tg, t(TARGETS[tg].askKey)));
  }
  el.appendChild(row);

  if (input) {
    input.addEventListener('keydown', (ev) => {
      // IME 変換確定の Enter を送信と誤認しない
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter') { ev.preventDefault(); proceed(last); }
    });
  }

  appendCliHint(el);
  position(el, opts.range);
  input?.focus();
}

// ── ステップ 2: コピー済みを伝え、ブラウザを開く操作を提示 ──
async function renderConfirm(
  el: HTMLElement,
  opts: WebAskOpts,
  target: Target,
  prompt: string,
): Promise<void> {
  // この時点でクリップボードへコピー (ボタンを押す前に確実にコピーしておく)
  try { await navigator.clipboard.writeText(prompt); } catch { /* 失敗してもボタンは出す */ }
  try { localStorage.setItem(PREF_KEY, target); } catch { /* ignore */ }

  clear(el);
  el.appendChild(createEl('div', { class: 'web-ask-copied' }, t('webask.copiedTitle')));

  el.appendChild(createEl('button', {
    class: 'web-ask-open',
    onClick: () => { void invoke('open_url', { url: TARGETS[target].url }); close(); },
  }, t(TARGETS[target].openKey)));

  el.appendChild(createEl('div', { class: 'web-ask-paste-hint' }, t('webask.pasteHint')));
  appendCliHint(el);
  position(el, opts.range);
}
