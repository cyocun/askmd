// Ask (LLM) 関連の UI 配線: 選択フロートバー / 右下「このメモについて聞く」 /
// Cmd+L・メニューから共通で呼ぶ ask ヘルパ。ask.ts (LLM ストリームの核) を
// アプリ状態と結線する薄い橋渡し。
import { createEl } from './dom';
import { t } from './i18n';
import { createSelectionBar } from './selection-bar';
import { showLoading as tpLoading, showResult as tpResult, showError as tpError } from './translate-popover';
import { openRangeEditor } from './block-editor';
import { showToast } from './toast';
import { openWebAsk } from './web-ask';
import { state } from './state';
import type { Ask, AskContext, QuoteHighlight } from './ask';
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
export function highlightRange(range: Range, onClick?: () => void): () => void {
  const mdBody = elementOf(range.startContainer)?.closest(`.${MD_BODY}`) as HTMLElement | null;
  if (!mdBody) return () => {};

  const bodyRect = mdBody.getBoundingClientRect();
  // 行の矩形より少し外へ広げて余白を作る (角丸と相まって目立つ「マーカー」風に)
  const PAD_X = 4;
  const PAD_Y = 2.5;
  const overlays: HTMLElement[] = [];
  let firstRect: DOMRect | null = null;
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    if (!firstRect) firstRect = r;
    // ハイライト本体はクリックを透過させ、下の文字を選択できるようにする
    const el = createEl('div', { class: 'ask-highlight' });
    el.style.top = `${r.top - bodyRect.top + mdBody.scrollTop - PAD_Y}px`;
    el.style.left = `${r.left - bodyRect.left + mdBody.scrollLeft - PAD_X}px`;
    el.style.width = `${r.width + PAD_X * 2}px`;
    el.style.height = `${r.height + PAD_Y * 2}px`;
    mdBody.appendChild(el);
    overlays.push(el);
  }

  // クリック用は本体ではなく、ハイライトの右肩に小さなアイコンだけ載せる
  // (本体を pointer-events:auto にすると文字選択を奪うため)。
  if (onClick && firstRect) {
    const MARKER = 18;
    const marker = createEl('button', { class: 'ask-highlight-marker', title: t('ask.jumpToCard') }, '✦');
    marker.style.top = `${firstRect.top - bodyRect.top + mdBody.scrollTop - PAD_Y - MARKER / 2}px`;
    marker.style.left = `${firstRect.right - bodyRect.left + mdBody.scrollLeft + PAD_X - MARKER / 2}px`;
    marker.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    mdBody.appendChild(marker);
    overlays.push(marker);
  }

  return () => overlays.forEach((o) => o.remove());
}

// 引用テキストの検索キー: 最初の非空行を 80 字まで。複数ブロックをまたぐ選択でも
// 1 行なら単一テキストノードに収まりやすく、本文ジャンプの足がかりになる。
function quoteSearchKey(quote: string): string {
  const firstLine = quote.split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
  return firstLine.slice(0, 80);
}

// md-body 内のテキストノードから key の最初の出現を Range で返す (大文字小文字無視)。
function findTextRange(root: HTMLElement, key: string): Range | null {
  if (!key) return null;
  const lower = key.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent || '';
    const idx = text.toLowerCase().indexOf(lower);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, Math.min(idx + key.length, text.length));
      return range;
    }
    node = walker.nextNode();
  }
  return null;
}

// 引用テキストを現在の本文内で探してハイライト。コメントカードの引用元ジャンプ用。
// 再描画後でもテキスト検索でアンカーし直せるよう、Range ではなく文字列で受ける。
export function highlightQuoteIn(
  docContent: HTMLElement,
  quote: string,
  onClick?: () => void,
): QuoteHighlight | null {
  const mdBody = docContent.querySelector(`.${MD_BODY}`) as HTMLElement | null;
  if (!mdBody) return null;
  const range = findTextRange(mdBody, quoteSearchKey(quote));
  if (!range) return null;
  const cleanup = highlightRange(range, onClick);
  const scroll = () => {
    const r = range.getBoundingClientRect();
    const cRect = docContent.getBoundingClientRect();
    const top = docContent.scrollTop + (r.top - cRect.top) - 100;
    docContent.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };
  return { scroll, cleanup };
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
    const ctx = currentCtx();
    if (!ctx) { showToast(t('toast.openFile')); return; }
    // CLI が無ければ web (ChatGPT / Claude) へ橋渡し。autoSend 付き (要約等) は質問確定済み。
    if (!state.aiAvailable) {
      openWebAsk({ selection, ctx, question: opts?.autoSend ? opts.prefill : undefined, range });
      return;
    }
    const anchor = askAnchorOf(range);
    deps.ask.open(selection, ctx, anchor, {
      prefill: opts?.prefill,
      autoSend: opts?.autoSend,
    });
  }

  function askForFile(opts?: AskOpenOpts): void {
    const ctx = currentCtx();
    if (!ctx) { showToast(t('toast.openFile')); return; }
    if (!state.aiAvailable) {
      openWebAsk({ selection: '', ctx, question: opts?.autoSend ? opts.prefill : undefined });
      return;
    }
    deps.ask.open('', ctx, null, { prefill: opts?.prefill, autoSend: opts?.autoSend });
  }

  // 選択フロートバー
  const selectionBar = createSelectionBar({
    canAsk: () => !!state.currentFile,
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
    // CLI 無しでも web 橋渡しで聞けるので、ファイルが開いていれば常時表示
    const show = !!state.currentFile && !sel;
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
