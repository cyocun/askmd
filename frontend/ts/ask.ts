import { createEl } from './dom';
import { t } from './i18n';

// 複数の Ask パネルを管理する Manager。
// - open() のたびに新しいパネルを DOM に挿入 (排他しない)
// - 各パネルは独自の session_id / 会話ログ / 入力欄を持つ
// - 選択なし ⌘L は「最後に触れたパネル」に focus (継続質問)
export interface AskContext {
  title: string;
  path: string;
  root: string;
  fileContent?: string;
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
  renderMarkdown: (md: string) => string;
  postProcessContent?: (container: HTMLElement) => void;
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

function createTurn(log: HTMLElement, question: string, deps: AskDeps, root: string): TurnHandle {
  // ユーザーメッセージ (badge + text、同じ grid 構造)
  const qRow = createEl('div', { class: 'ask-msg' },
    createEl('span', { class: 'ask-badge' }, 'You'),
    createEl('span', { class: 'ask-q-text' }, question),
  );

  // AI 回答 (badge + body、同じ grid 構造)
  // ツールとテキストを時系列で単一フローに追加
  const aFlow = createEl('div', { class: 'ask-a-flow' });
  const aStatus = createEl('div', { class: 'ask-a-status' },
    createEl('span', { class: 'ask-a-spinner' }),
    createEl('span', {}, t('ask.thinking')),
  );
  const aBody = createEl('div', { class: 'ask-a-body' }, aStatus, aFlow);
  const aRow = createEl('div', { class: 'ask-msg' },
    createEl('span', { class: 'ask-badge ask-badge-ai' }, 'AI'),
    aBody,
  );

  const turn = createEl('div', { class: 'ask-turn' }, qRow, aRow);
  log.appendChild(turn);

  let rawText = '';
  let currentTextEl: HTMLElement | null = null;
  let currentToolRow: HTMLElement | null = null;

  const renderMd = () => {
    if (!currentTextEl) return;
    const html = deps.renderMarkdown(rawText);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    while (currentTextEl.firstChild) currentTextEl.removeChild(currentTextEl.firstChild);
    currentTextEl.classList.add('md-body');
    while (doc.body.firstChild) currentTextEl.appendChild(doc.body.firstChild);
  };

  return {
    addTool(name, input) {
      const summary = summarizeToolCall(name, input, root);
      while (aStatus.firstChild) aStatus.removeChild(aStatus.firstChild);
      aStatus.appendChild(createEl('span', { class: 'ask-a-spinner' }));
      aStatus.appendChild(createEl('span', {}, t('ask.toolRunning', name)));
      if (!currentToolRow) {
        currentToolRow = createEl('div', { class: 'ask-tools' });
        aFlow.appendChild(currentToolRow);
      }
      const chip = createEl(
        'span',
        { class: 'ask-tool-chip', title: summary },
        createEl('span', { class: 'ask-tool-name' }, name),
        summary ? createEl('span', { class: 'ask-tool-arg' }, summary) : null,
      );
      currentToolRow.appendChild(chip);
      currentTextEl = null;
    },
    appendText(text) {
      aStatus.hidden = true;
      rawText += text;
      currentToolRow = null;
      if (!currentTextEl) {
        currentTextEl = createEl('div', { class: 'ask-a' });
        aFlow.appendChild(currentTextEl);
      }
      renderMd();
    },
    hasText() {
      return rawText.length > 0;
    },
    showError(message) {
      aStatus.hidden = true;
      const errEl = createEl('div', { class: 'ask-a error' });
      errEl.textContent = t('ask.error', message);
      aFlow.appendChild(errEl);
    },
    finalize(fallbackText) {
      aStatus.hidden = true;
      if (!rawText && fallbackText) {
        rawText = fallbackText;
        if (!currentTextEl) {
          currentTextEl = createEl('div', { class: 'ask-a' });
          aFlow.appendChild(currentTextEl);
        }
      }
      renderMd();
      if (deps.postProcessContent) deps.postProcessContent(aFlow);
    },
  };
}

function shortenPath(fullPath: string, root: string): string {
  if (root && fullPath.startsWith(root)) {
    return fullPath.slice(root.length).replace(/^\/+/, '');
  }
  // ルート外ならファイル名だけ
  return fullPath.split('/').pop() || fullPath;
}

function summarizeToolCall(name: string, input: Record<string, unknown> | undefined, root: string): string {
  if (!input) return '';
  const pick = (k: string): string => {
    const v = input[k];
    return typeof v === 'string' ? v : '';
  };
  const shortFile = (k: string) => shortenPath(pick(k), root);

  if (name === 'Read') return shortFile('file_path');
  if (name === 'Edit' || name === 'Write') return shortFile('file_path');
  if (name === 'Glob') {
    const p = pick('pattern');
    const path = pick('path');
    return path ? `${p} @ ${shortenPath(path, root)}` : p;
  }
  if (name === 'Grep') {
    const p = pick('pattern');
    const path = pick('path');
    return path ? `${p} in ${shortenPath(path, root)}` : p;
  }
  if (name === 'Bash') return pick('command');
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

  const badge = createEl('span', { class: 'ask-session-badge' }, t('ask.continuing'));
  badge.hidden = true;

  const closeBtn = createEl(
    'button',
    { class: 'btn-ghost', title: t('ask.close') },
    '×',
  );

  const providerLabel = createEl('span', {}, t('ask.askProvider', deps.getProviderName()));

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
    placeholder: t('ask.inputPlaceholder'),
    spellcheck: false,
    autocomplete: 'off',
  }) as HTMLInputElement;

  const sendBtn = createEl(
    'button',
    { class: 'btn-primary ask-send' },
    t('ask.send'),
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

    const turn = createTurn(log, question, deps, ctx.root);
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
          turn.showError(ev.message || t('ask.unknownError'));
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

// 初回は引用 + ファイル全文 + 周辺参照の指示を付与。resume 継続時は Claude 側が文脈を覚えているので質問のみ。
const FILE_CONTENT_LIMIT = 8000;

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
  } else {
    parts.push(`対象ドキュメント: "${ctx.title}" (${relPath})`);
  }
  parts.push('必要に応じて Read / Glob / Grep で周辺ファイル (同ディレクトリの他 .md、参照先など) も読んで答えてください。');
  parts.push('');

  // ファイル全体をコンテキストとして含める
  if (ctx.fileContent) {
    if (ctx.fileContent.length <= FILE_CONTENT_LIMIT) {
      parts.push('--- ドキュメント全文 ---');
      parts.push(ctx.fileContent);
      parts.push('--- ここまで ---');
    } else {
      parts.push(`--- ドキュメント冒頭 (${FILE_CONTENT_LIMIT} 文字、全文は Read で ${relPath} を参照) ---`);
      parts.push(ctx.fileContent.slice(0, FILE_CONTENT_LIMIT));
      parts.push('--- ここまで ---');
    }
    parts.push('');
  }

  if (selection) {
    parts.push('選択部分:');
    parts.push('```');
    parts.push(selection);
    parts.push('```');
    parts.push('');
  }

  parts.push(`質問: ${question}`);
  return parts.join('\n');
}
