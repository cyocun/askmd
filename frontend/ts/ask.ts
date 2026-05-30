import { createEl } from './dom';
import { t } from './i18n';
import { loadHistory, pushTurn, clearHistory } from './ask-history';

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

/** 引用テキストを本文内で見つけたときのハンドル。 */
export interface QuoteHighlight {
  /** ハイライト箇所を画面内へスクロール */
  scroll(): void;
  /** ハイライト overlay を消す */
  cleanup(): void;
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
  /** コメントカードを積む右列のコンテナ。 */
  commentsPane: HTMLElement;
  /** 引用テキストを現在の本文内で探してハイライト。onClick を渡すと overlay がクリック可能になる。 */
  highlightQuote: (quote: string, onClick?: () => void) => QuoteHighlight | null;
}

export interface AskOpenOptions {
  /** 入力欄にあらかじめ入れておく文字列。 */
  prefill?: string;
  /** prefill した時に即送信する。 */
  autoSend?: boolean;
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
  /** 最前面 (最後に触った) パネルを閉じる。閉じたら true。Escape の一元処理用。 */
  closeLast(): boolean;
  /** ファイル切替/本文再描画時に呼ぶ。現在ファイルのカードだけ出し、引用ハイライトを貼り直す。 */
  syncForFile(path: string | null): void;
  /** 本文のサイズ変化 (リサイズ/列開閉) 時に引用ハイライトの位置だけ貼り直す。 */
  reanchorHighlights(): void;
}

interface PanelHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  focus(): void;
  submit(): void;
  close(): void;
  /** このカードが属するファイル (ファイル単位でコメントを出し分ける)。 */
  path: string;
  /** 引用元テキスト (本文ジャンプ用)。ファイル全体への質問では空。 */
  quote: string;
  /** 作成時の引用元ブロック (文書順ソート用、再描画後は stale になり得る)。 */
  anchor: HTMLElement | null;
}

export function createAsk(deps: AskDeps): Ask {
  const panels: PanelHandle[] = [];
  let lastActive: PanelHandle | null = null;
  // 表示中カードの引用ハイライト (panel → overlay ハンドル)
  const highlights = new Map<PanelHandle, QuoteHighlight>();
  // syncForFile が走っている間に現在対象としているファイル
  let activePath: string | null = null;

  const prunePanels = () => {
    for (let i = panels.length - 1; i >= 0; i--) {
      if (!panels[i].el.isConnected) panels.splice(i, 1);
    }
    if (lastActive && !lastActive.el.isConnected) lastActive = null;
  };

  const setActive = (h: PanelHandle) => {
    lastActive = h;
    for (const p of panels) p.el.classList.toggle('active', p === h);
  };

  const doClose = (h: PanelHandle) => {
    const hl = highlights.get(h);
    if (hl) { hl.cleanup(); highlights.delete(h); }
    h.el.remove();
    const idx = panels.indexOf(h);
    if (idx >= 0) panels.splice(idx, 1);
    if (lastActive === h) lastActive = panels[panels.length - 1] ?? null;
    document.body.classList.toggle('has-comments', panels.some((p) => !p.el.hidden));
  };

  // 引用元へジャンプ (ハイライトが無ければ貼り直してから)
  const jumpTo = (p: PanelHandle) => {
    let hl = highlights.get(p);
    if (!hl && p.quote) {
      const fresh = deps.highlightQuote(p.quote, () => revealCard(p));
      if (fresh) { highlights.set(p, fresh); hl = fresh; }
    }
    hl?.scroll();
  };

  // 本文のハイライトをクリックされたとき: 対応するカードをコメント列で見せる
  const revealCard = (p: PanelHandle) => {
    setActive(p);
    p.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // anchor の文書順で挿入位置を決める。ファイル全体への質問 (anchor なし) は先頭。
  // 比較は現在ファイルの生きた anchor 同士 (別ファイルの stale anchor は DISCONNECTED で素通り)。
  const docOrderIndex = (anchor: HTMLElement | null): number => {
    if (!anchor) return 0;
    for (let i = 0; i < panels.length; i++) {
      const a = panels[i].anchor;
      if (!a || !a.isConnected) continue;
      const pos = anchor.compareDocumentPosition(a);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return i;
    }
    return panels.length;
  };

  // 表示中カードの引用ハイライトを今の本文に貼り直す (位置だけ。並べ替えはしない)。
  const reanchorHighlights = (): void => {
    for (const [, hl] of highlights) hl.cleanup();
    highlights.clear();
    for (const p of panels) {
      if (!p.el.hidden && p.quote) {
        const hl = deps.highlightQuote(p.quote, () => revealCard(p));
        if (hl) highlights.set(p, hl);
      }
    }
  };

  // 現在ファイルのカードだけ表示し、コメント列へ文書順に並べ、引用ハイライトを貼り直す。
  const syncForFile = (path: string | null): void => {
    prunePanels();
    activePath = path;

    let visible = 0;
    for (const p of panels) {
      const show = !!path && p.path === path;
      p.el.hidden = !show;
      if (show) {
        visible++;
        deps.commentsPane.appendChild(p.el); // 配列順 = 文書順で並べ直す
      }
    }
    reanchorHighlights();
    document.body.classList.toggle('has-comments', visible > 0);
  };

  const openPanel = (
    selection: string,
    ctx: AskContext,
    anchor: HTMLElement | null,
    options?: AskOpenOptions,
  ): void => {
    prunePanels();
    const handle = buildPanel(selection, ctx, deps, doClose, setActive);
    handle.anchor = anchor && anchor.isConnected ? anchor : null;

    const idx = docOrderIndex(handle.anchor);
    panels.splice(idx, 0, handle);

    // 引用元クリックで本文へジャンプ
    const quoteEl = handle.el.querySelector('.ask-quote');
    if (quoteEl) quoteEl.addEventListener('click', () => jumpTo(handle));

    // syncForFile 内の prunePanels に未接続として消されないよう、先に列へ入れておく
    deps.commentsPane.appendChild(handle.el);
    lastActive = handle;
    syncForFile(ctx.path); // 並べ替え + 可視化 + ハイライト + has-comments
    for (const p of panels) p.el.classList.toggle('active', p === handle);

    handle.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    handle.input.focus({ preventScroll: true });

    if (options?.prefill) {
      handle.input.value = options.prefill;
      if (options.autoSend) handle.submit();
    }
  };

  return {
    open: openPanel,
    focusLast() {
      prunePanels();
      // 現在ファイルで表示中のものを優先
      const target =
        (lastActive && !lastActive.el.hidden && lastActive) ||
        [...panels].reverse().find((p) => !p.el.hidden) ||
        null;
      if (target) {
        target.focus();
        target.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    },
    hasAny() {
      prunePanels();
      return panels.some((p) => activePath != null && p.path === activePath);
    },
    closeLast() {
      prunePanels();
      const last =
        (lastActive && !lastActive.el.hidden && lastActive) ||
        [...panels].reverse().find((p) => !p.el.hidden) ||
        null;
      if (last) {
        last.close();
        return true;
      }
      return false;
    },
    syncForFile,
    reanchorHighlights,
  };
}

// ───────── 1 ターン (Q → tools → A) の UI ─────────
interface TurnHandle {
  addTool(name: string, input: Record<string, unknown> | undefined): void;
  appendText(text: string): void;
  hasText(): boolean;
  getAnswerText(): string;
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
    getAnswerText() {
      return rawText;
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
  // 履歴と sessionId の扱い:
  // - 選択なし (ファイル全体への質問) → 履歴を復元し session を継続する
  // - 選択あり (選択バーの「聞く」「要約」) → 新しい切り口なので毎回新規。
  //   過去履歴を resume すると Claude が前の文脈で答えて引用が無視される。
  //   保存もしないので、別話題で selection を質問しても file 履歴を汚さない。
  const useHistory = !selection && !!ctx.path;
  const history = useHistory ? loadHistory(ctx.path) : null;
  let sessionId: string | null = history?.sessionId ?? null;

  const badge = createEl('span', { class: 'ask-session-badge' }, t('ask.continuing'));
  badge.hidden = sessionId == null;

  const closeBtn = createEl(
    'button',
    { class: 'btn-ghost', title: t('ask.close') },
    '×',
  );

  // タイトル ("Ask Claude") は出さない。継続バッジと閉じるボタンだけの薄いヘッダー。
  const header = createEl(
    'div',
    { class: 'ask-header' },
    badge,
    createEl('span', { class: 'ask-spacer' }),
    closeBtn,
  );

  const quote = createEl('div', { class: 'ask-quote' }, selection);
  quote.hidden = !selection;

  const log = createEl('div', { class: 'ask-log' });

  // ─ 履歴の復元 ─
  let historyBar: HTMLElement | null = null;
  if (history && history.turns.length > 0) {
    historyBar = createEl('div', { class: 'ask-history-bar' },
      createEl('span', { class: 'ask-history-label' }, `${t('ask.history.title')} (${history.turns.length})`),
      createEl('button', {
        class: 'ask-history-clear',
        onClick: () => {
          clearHistory(ctx.path);
          if (historyBar) historyBar.remove();
          log.querySelectorAll('.ask-turn.history').forEach((el) => el.remove());
          // セッションもリセット (新しい会話として続ける)
          sessionId = null;
          badge.hidden = true;
        },
      }, t('ask.history.clear')),
    );
    log.appendChild(historyBar);
    for (const ht of history.turns) {
      const restored = createTurn(log, ht.q, deps, ctx.root);
      restored.appendText(ht.a);
      restored.finalize();
      // 復元した turn に .history クラスを付けて視覚的に区別
      const last = log.lastElementChild as HTMLElement | null;
      if (last) last.classList.add('history');
    }
  }

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

  // よく使うテンプレート (質問を 1 つも送っていない間だけ表示)
  const TEMPLATES: Array<{ key: string; text: string }> = [
    { key: 'ask.tpl.summarize', text: t('ask.tpl.summarize') },
    { key: 'ask.tpl.explain',   text: t('ask.tpl.explain')   },
  ];
  const templates = createEl('div', { class: 'ask-templates' });
  templates.appendChild(createEl('span', { class: 'ask-templates-label' }, t('ask.pickTemplate')));
  for (const tpl of TEMPLATES) {
    const chip = createEl('button', {
      class: 'ask-template-chip',
      onClick: () => {
        // 送信中 (input.disabled) の連打で同一パネルに二重リクエストが走るのを防ぐ
        if (input.disabled) return;
        input.value = tpl.text;
        input.focus();
        void send();
      },
    }, tpl.text);
    templates.appendChild(chip);
  }
  // 履歴がある (過去に会話した) 場合はチップを最初から隠す
  if (history && history.turns.length > 0) {
    templates.hidden = true;
  }

  const panelEl = createEl(
    'div',
    { class: 'ask-panel inline' },
    header,
    quote,
    log,
    templates,
    inputRow,
  );

  const handle: PanelHandle = {
    el: panelEl,
    input,
    focus: () => input.focus({ preventScroll: true }),
    submit: () => void send(),
    close: () => onClose(handle),
    path: ctx.path,
    quote: selection,
    anchor: null,
  };

  const send = async () => {
    const question = input.value.trim();
    if (!question) return;

    // 最初の送信でテンプレート行を隠す (邪魔にならないように)
    templates.hidden = true;

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
          // 履歴に保存 (パスがあれば)
          if (useHistory) {
            const answer = turn.getAnswerText();
            if (question && answer) {
              pushTurn(ctx.path, { q: question, a: answer, ts: Date.now() }, sessionId);
            }
          }
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
      // ここで閉じるので、グローバル keymap の Escape (closeLast) に伝播させない。
      // 伝播すると複数パネル時に隣のパネルまで閉じてしまう。
      ev.stopPropagation();
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
  // 3 プロバイダ (Claude / Copilot / Codex) とも今やファイルを読めるエージェント型 CLI
  // なので、特定ツール名に依らない中立な指示にする。
  parts.push('必要なら同じフォルダの関連する .md も読んで答えてください。');
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
