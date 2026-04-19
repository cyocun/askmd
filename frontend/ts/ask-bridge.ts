// Ask (LLM) 関連の UI 配線: 選択フロートバー / 右下「このメモについて聞く」 /
// Cmd+L・メニューから共通で呼ぶ ask ヘルパ。ask.ts (LLM ストリームの核) を
// アプリ状態と結線する薄い橋渡し。
import { createEl } from './dom';
import { t } from './i18n';
import { createSelectionBar } from './selection-bar';
import { showLoading as tpLoading, showResult as tpResult, showError as tpError } from './translate-popover';
import { openRangeEditor } from './block-editor';
import { showToast } from './toast';
import { state } from './state';
import type { Ask, AskContext } from './ask';
import { invoke } from '@tauri-apps/api/core';

const MD_BODY = 'md-body';
const MD_SECTION = 'md-section';

// 引用対象となる "最も内側の" md ブロック。UL/OL 自体は候補外 (内部の LI/P が優先)。
const INLINE_BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR',
]);

function elementOf(node: Node): HTMLElement | null {
  const n = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  return n as HTMLElement | null;
}

// promoteToTop: block 候補が見つかる前に md-body/md-section の直下に到達したら、
// その要素 (UL/OL など) を返す。Ask panel は親の兄弟として挿入しないと range の
// 内側に入り込んで getClientRects() の矩形が panel 内まで伸びる。
function findBlock(from: Node, promoteToTop: boolean): HTMLElement | null {
  let el = elementOf(from);
  while (el) {
    if (el.classList.contains(MD_BODY)) return null;
    if (INLINE_BLOCK_TAGS.has(el.tagName)) return el;
    const parent = el.parentElement;
    if (promoteToTop && (parent?.classList.contains(MD_BODY) || parent?.classList.contains(MD_SECTION))) {
      return el;
    }
    el = parent;
  }
  return null;
}

// 引用/編集対象として最も内側の block。endContainer は triple-click / shift 選択で
// 次ブロック先頭に飛ぶため startContainer を基準にする。
export function anchorBlockOf(range: Range): HTMLElement | null {
  return findBlock(range.startContainer, false);
}

// Ask panel 挿入用の anchor。range 全体を覆う要素を返し、その afterend に panel を置く。
export function askAnchorOf(range: Range): HTMLElement | null {
  return findBlock(range.commonAncestorContainer, true);
}

// 選択 range の各行矩形を .md-body 相対座標の overlay として描画。
// 質問中の引用元を視覚的に残すため。返り値は cleanup (overlay 除去)。
export function highlightRange(range: Range): () => void {
  const mdBody = elementOf(range.startContainer)?.closest(`.${MD_BODY}`) as HTMLElement | null;
  if (!mdBody) return () => {};

  const bodyRect = mdBody.getBoundingClientRect();
  const overlays: HTMLElement[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    const el = createEl('div', { class: 'ask-highlight' });
    el.style.top = `${r.top - bodyRect.top + mdBody.scrollTop}px`;
    el.style.left = `${r.left - bodyRect.left + mdBody.scrollLeft}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    mdBody.appendChild(el);
    overlays.push(el);
  }
  return () => overlays.forEach((o) => o.remove());
}

export interface AskBridgeDeps {
  ask: Ask;
  docContent: HTMLElement;
}

export interface AskOpenOpts {
  prefill?: string;
  autoSend?: boolean;
}

export interface AskBridge {
  /** 選択文で質問 (⌘L / 選択バーの「聞く」・「要約」から呼ばれる) */
  askForSelection(selection: string, range: Range, opts?: AskOpenOpts): void;
  /** ファイル全体で質問 (⌘L 選択なし / 右下ボタン) */
  askForFile(opts?: AskOpenOpts): void;
  /** 右下「このメモについて聞く」の表示更新 */
  updateFileAskBtn(): void;
  /** 選択が変わった/確定したときに呼ぶ (selection-bar と fileAskBtn 両方を更新) */
  onSelectionChanged(): void;
  /** selection が空になった時のクリーンアップ (document selectionchange 側) */
  onSelectionCleared(): void;
}

export function createAskBridge(deps: AskBridgeDeps): AskBridge {
  function currentCtx(): AskContext | null {
    if (!state.currentFile || !state.currentRoot) return null;
    const cached = state.cache.get(state.currentFile);
    const filename = state.currentFile.split('/').pop() || '';
    return {
      title: filename.replace(/\.md$/i, ''),
      path: state.currentFile,
      root: state.currentRoot.path,
      fileContent: cached?.rawBody,
    };
  }

  function askForSelection(selection: string, range: Range, opts?: AskOpenOpts): void {
    if (!state.aiAvailable) { showToast(t('toast.noProvider')); return; }
    const ctx = currentCtx();
    if (!ctx) { showToast(t('toast.openFile')); return; }
    const anchor = askAnchorOf(range);
    deps.ask.open(selection, ctx, anchor, {
      onOpen: () => highlightRange(range),
      prefill: opts?.prefill,
      autoSend: opts?.autoSend,
    });
  }

  function askForFile(opts?: AskOpenOpts): void {
    if (!state.aiAvailable) { showToast(t('toast.noProvider')); return; }
    const ctx = currentCtx();
    if (!ctx) { showToast(t('toast.openFile')); return; }
    deps.ask.open('', ctx, null, { prefill: opts?.prefill, autoSend: opts?.autoSend });
  }

  // 選択フロートバー
  const selectionBar = createSelectionBar({
    aiAvailable: () => state.aiAvailable && !!state.currentFile,
    onAsk: () => {
      const sel = window.getSelection();
      const text = sel?.toString() || '';
      if (!text.trim() || !sel || sel.rangeCount === 0) return;
      askForSelection(text, sel.getRangeAt(0));
    },
    onTranslate: () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!text || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0).cloneRange();
      tpLoading({ range, originalText: text });
      selectionBar.hide();
      void (async () => {
        try {
          const translated = (await invoke('translate_text', { text: text.slice(0, 4000) })) as string;
          tpResult(translated);
        } catch (e) {
          tpError(t('translate.fail', String(e)));
        }
      })();
    },
    onSummarize: () => {
      const sel = window.getSelection();
      const text = sel?.toString() || '';
      if (!text.trim() || !sel || sel.rangeCount === 0) return;
      askForSelection(text, sel.getRangeAt(0), { prefill: t('ask.tpl.summarize'), autoSend: true });
    },
    onCopy: () => {
      const text = window.getSelection()?.toString() || '';
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => showToast(t('toast.copied'))).catch(() => {});
    },
    onEdit: () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !state.currentFile) return;
      const text = sel.toString();
      if (!text.trim()) {
        showToast(t('block.noRange'));
        return;
      }
      const anchor = anchorBlockOf(sel.getRangeAt(0));
      selectionBar.hide();
      void openRangeEditor(state.currentFile, text, anchor);
    },
  });

  // 右下: 「このメモについて聞く」常時ボタン
  const fileAskBtn = createEl('button', { id: 'fileAskBtn', class: 'file-ask-btn' },
    createEl('span', { class: 'file-ask-icon' }, '✦'),
    createEl('span', {}, t('ask.askFile')),
  );
  fileAskBtn.hidden = true;
  fileAskBtn.addEventListener('click', () => askForFile());
  document.body.appendChild(fileAskBtn);

  function updateFileAskBtn(): void {
    const sel = window.getSelection()?.toString().trim() || '';
    const show = state.aiAvailable && !!state.currentFile && !sel;
    fileAskBtn.hidden = !show;
  }

  function onSelectionChanged(): void {
    selectionBar.updateFor(deps.docContent);
    updateFileAskBtn();
  }

  function onSelectionCleared(): void {
    const sel = window.getSelection()?.toString().trim() || '';
    if (!sel) {
      selectionBar.hide();
      updateFileAskBtn();
    }
  }

  return {
    askForSelection,
    askForFile,
    updateFileAskBtn,
    onSelectionChanged,
    onSelectionCleared,
  };
}
