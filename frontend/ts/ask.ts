import { createEl } from './dom.js';

// 複数の Ask パネルを管理する Manager。
// - open() のたびに新しいパネルを DOM に挿入 (排他しない)
// - 各パネルは独自の session_id / 会話ログ / 入力欄を持つ
// - 選択なし ⌘L は「最後に触れたパネル」に focus (継続質問)
export interface AskContext {
  title: string;
  path: string;
  root: string;
}

export interface AskStreamEvent {
  requestId: string;
  kind: 'session' | 'tool' | 'text' | 'done' | 'error';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  text?: string;
  sessionId?: string;
  message?: string;
}

export interface AskDeps {
  startStream: (args: {
    requestId: string;
    prompt: string;
    root: string;
    sessionId: string | null;
  }) => Promise<void>;
  subscribe: (handler: (ev: AskStreamEvent) => void) => () => void;
  getProviderName: () => string;
}

export interface AskOpenOptions {
  /** 開いた時に呼ばれる。返り値は close 時に呼ばれる cleanup。
   *  選択範囲のハイライト overlay などの後始末をここで行う。 */
  onOpen?: () => (() => void) | void;
}

export interface Ask {
  open(
    selection: string,
    context: AskContext,
    anchor: HTMLElement | null,
    options?: AskOpenOptions,
  ): void;
  focusLast(): void;
  hasAny(): boolean;
}

interface PanelHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  focus(): void;
}

export function createAsk(deps: AskDeps): Ask {
  const panels: PanelHandle[] = [];
  let lastActive: PanelHandle | null = null;

  const prunePanels = () => {
    for (let i = panels.length - 1; i >= 0; i--) {
      if (!panels[i].el.isConnected) panels.splice(i, 1);
    }
    if (lastActive && !lastActive.el.isConnected) lastActive = null;
  };

  const openPanel = (
    selection: string,
    ctx: AskContext,
    anchor: HTMLElement | null,
    options?: AskOpenOptions,
  ): void => {
    prunePanels();
    const cleanup = options?.onOpen ? options.onOpen() || undefined : undefined;
    const handle = buildPanel(
      selection,
      ctx,
      deps,
      (h) => {
        if (cleanup) cleanup();
        h.el.remove();
        const idx = panels.indexOf(h);
        if (idx >= 0) panels.splice(idx, 1);
        if (lastActive === h) lastActive = panels[panels.length - 1] ?? null;
      },
      (h) => {
        lastActive = h;
        for (const p of panels) p.el.classList.toggle('active', p === h);
      },
    );

    if (anchor && anchor.isConnected) {
      anchor.insertAdjacentElement('afterend', handle.el);
    } else {
      handle.el.classList.add('floating');
      document.body.appendChild(handle.el);
    }
    panels.push(handle);
    lastActive = handle;
    for (const p of panels) p.el.classList.toggle('active', p === handle);

    handle.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    handle.input.focus({ preventScroll: true });
  };

  return {
    open: openPanel,
    focusLast() {
      prunePanels();
      if (lastActive) {
        lastActive.focus();
        lastActive.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },
    hasAny() {
      prunePanels();
      return panels.length > 0;
    },
  };
}

// ───────── 1 ターン (Q → tools → A) の UI ─────────
interface TurnHandle {
  addTool(name: string, input: Record<string, unknown> | undefined): void;
  appendText(text: string): void;
  hasText(): boolean;
  showError(message: string): void;
  finalize(fallbackText?: string): void;
}

function createTurn(log: HTMLElement, question: string): TurnHandle {
  const q = createEl('div', { class: 'ask-q' }, question);
  const tools = createEl('div', { class: 'ask-tools' });
  const a = createEl('div', { class: 'ask-a loading' });
  const turn = createEl('div', { class: 'ask-turn' }, q, tools, a);
  log.appendChild(turn);

  return {
    addTool(name, input) {
      const summary = summarizeToolCall(name, input);
      const chip = createEl(
        'span',
        { class: 'ask-tool-chip', title: summary },
        createEl('span', { class: 'ask-tool-name' }, name),
        summary ? createEl('span', { class: 'ask-tool-arg' }, summary) : null,
      );
      tools.appendChild(chip);
    },
    appendText(text) {
      a.classList.remove('loading');
      a.textContent = (a.textContent || '') + text;
    },
    hasText() {
      return (a.textContent || '').length > 0;
    },
    showError(message) {
      a.classList.remove('loading');
      a.classList.add('error');
      a.textContent = `エラー: ${message}`;
    },
    finalize(fallbackText) {
      a.classList.remove('loading');
      if (fallbackText && !a.textContent) a.textContent = fallbackText;
    },
  };
}

function summarizeToolCall(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const pick = (k: string): string => {
    const v = input[k];
    return typeof v === 'string' ? v : '';
  };
  if (name === 'Read') return pick('file_path');
  if (name === 'Glob') {
    const p = pick('pattern');
    const path = pick('path');
    return path ? `${p} @ ${path}` : p;
  }
  if (name === 'Grep') {
    const p = pick('pattern');
    const path = pick('path');
    return path ? `${p} in ${path}` : p;
  }
  // それ以外のツールは JSON を短く出す
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  } catch {
    return '';
  }
}

// ───────── パネル 1 つ分を組み立てる ─────────
function buildPanel(
  selection: string,
  ctx: AskContext,
  deps: AskDeps,
  onClose: (h: PanelHandle) => void,
  onActivate: (h: PanelHandle) => void,
): PanelHandle {
  let sessionId: string | null = null;

  const badge = createEl('span', { class: 'ask-session-badge' }, '会話継続中');
  badge.hidden = true;

  const closeBtn = createEl(
    'button',
    { class: 'btn-ghost', title: '閉じる (Esc)' },
    '×',
  );

  const providerLabel = createEl('span', {}, `${deps.getProviderName()} に質問`);

  const header = createEl(
    'div',
    { class: 'ask-header' },
    providerLabel,
    badge,
    createEl('span', { class: 'ask-spacer' }),
    closeBtn,
  );

  const quote = createEl('div', { class: 'ask-quote' }, selection);
  quote.hidden = !selection;

  const log = createEl('div', { class: 'ask-log' });

  const input = createEl('input', {
    class: 'ask-input',
    type: 'text',
    placeholder: '何を聞きますか? (Read/Glob/Grep で周辺ファイルも読めます)',
    spellcheck: false,
    autocomplete: 'off',
  }) as HTMLInputElement;

  const sendBtn = createEl(
    'button',
    { class: 'btn-primary ask-send' },
    '送信',
  ) as HTMLButtonElement;

  const inputRow = createEl('div', { class: 'ask-input-row' }, input, sendBtn);

  const panelEl = createEl(
    'div',
    { class: 'ask-panel inline' },
    header,
    quote,
    log,
    inputRow,
  );

  const handle: PanelHandle = {
    el: panelEl,
    input,
    focus: () => input.focus({ preventScroll: true }),
  };

  const send = async () => {
    const question = input.value.trim();
    if (!question) return;

    const turn = createTurn(log, question);
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const finalizeUi = () => {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus({ preventScroll: true });
    };

    const unsubscribe = deps.subscribe((ev) => {
      if (ev.requestId !== requestId) return;
      switch (ev.kind) {
        case 'session':
          if (ev.sessionId) {
            sessionId = ev.sessionId;
            badge.hidden = false;
          }
          break;
        case 'tool':
          turn.addTool(ev.toolName || '', ev.toolInput);
          break;
        case 'text':
          turn.appendText(ev.text || '');
          break;
        case 'done':
          if (ev.sessionId) {
            sessionId = ev.sessionId;
            badge.hidden = false;
          }
          // done.message には result 全文が入ることがある (stream text が空だった場合の保険)
          turn.finalize(ev.message && !turn.hasText() ? ev.message : undefined);
          unsubscribe();
          finalizeUi();
          break;
        case 'error':
          turn.showError(ev.message || '不明なエラー');
          unsubscribe();
          finalizeUi();
          break;
      }
    });

    const prompt = buildPrompt(selection, ctx, question, sessionId != null);
    try {
      await deps.startStream({
        requestId,
        prompt,
        root: ctx.root,
        sessionId,
      });
    } catch (e) {
      turn.showError(String(e));
      unsubscribe();
      finalizeUi();
    }
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (ev) => {
    const composing = ev.isComposing || ev.keyCode === 229;
    if (ev.key === 'Enter' && !ev.shiftKey && !composing) {
      ev.preventDefault();
      send();
    } else if (ev.key === 'Escape' && !composing) {
      onClose(handle);
    }
  });
  closeBtn.addEventListener('click', () => onClose(handle));

  panelEl.addEventListener('focusin', () => onActivate(handle));
  panelEl.addEventListener('mousedown', () => onActivate(handle));

  return handle;
}

// 初回は引用 + 周辺参照の指示を付与。resume 継続時は Claude 側が文脈を覚えているので質問のみ。
function buildPrompt(
  selection: string,
  ctx: AskContext,
  question: string,
  isContinuation: boolean,
): string {
  if (isContinuation) return question;

  const relPath = ctx.root && ctx.path.startsWith(ctx.root)
    ? ctx.path.slice(ctx.root.length).replace(/^\/+/, '')
    : ctx.path;

  const parts: string[] = [];
  if (selection) {
    parts.push(`以下は "${ctx.title}" (${relPath}) の抜粋です。`);
    parts.push('必要に応じて Read / Glob / Grep で周辺ファイル (同ディレクトリの他 .md、参照先など) も読んで答えてください。');
    parts.push('');
    parts.push('```');
    parts.push(selection);
    parts.push('```');
    parts.push('');
  } else {
    parts.push(`対象ドキュメント: "${ctx.title}" (${relPath})`);
    parts.push('必要に応じて Read / Glob / Grep で該当ファイルや周辺を読んで答えてください。');
    parts.push('');
  }
  parts.push(`質問: ${question}`);
  return parts.join('\n');
}
