import { byId, clear, createEl } from './dom.js';
import { createAsk } from './ask.js';
import type { AskStreamEvent } from './ask.js';
import { createPalette } from './palette.js';
import { createSearch } from './search.js';
import type { SearchHit } from './search.js';
import { createTreeView } from './tree.js';
import { extractTitle, parseFrontmatter, render } from './renderer.js';
import type { OutlineItem, TreeNode } from './types.js';

const TAURI = (window as any).__TAURI__;
if (!TAURI) {
  console.error('Tauri bridge not available');
}
const invoke = TAURI.core.invoke as (cmd: string, args?: Record<string, unknown>) => Promise<any>;
const convertFileSrc = TAURI.core.convertFileSrc as (path: string, protocol?: string) => string;
const listen = TAURI.event.listen as (event: string, handler: (ev: { payload: unknown }) => void) => Promise<() => void>;

// ─── 状態 ───
let currentRoot: { path: string; tree: TreeNode } | null = null;
let currentFile: string | null = null;
const cache = new Map<string, { rendered: string; title: string; fmHtml: HTMLElement | null }>();

const leftPane = byId('leftPane');
const treeContainer = byId('treeContainer');
const rootLabel = byId('rootLabel');
const docHeader = byId('docHeader');
const docContent = byId('docContent');
const openBtn = byId('openBtn') as HTMLButtonElement;
const filterInput = byId('filterInput') as HTMLInputElement;
const toast = byId('toast');
const dropOverlay = byId('dropOverlay');

// 選択の始点を含む "最も内側の" md ブロックを anchor として返す。
// 狙い: リストの途中で質問したら UL 全体の後ではなくその LI の直下に挿入したい。
// UL/OL 自体は anchor 候補に含めない (LI/P が優先されるように)。
// endContainer は triple-click や shift 選択で次ブロック先頭に飛ぶため startContainer を基準。
const INLINE_BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR',
]);
function anchorBlockOf(range: Range): HTMLElement | null {
  let node: Node | null = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  let el = node as HTMLElement | null;
  while (el) {
    if (el.classList?.contains('md-body')) return null;
    if (INLINE_BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

// 選択 range の各行矩形を .md-body 相対座標の overlay として描画。
// pre/コードブロック内も含めて「今質問中の引用元」を視覚的に残す用途。
// 返り値は cleanup (overlay 除去)。
function highlightRange(range: Range): () => void {
  let mdBody: HTMLElement | null = null;
  let n: Node | null = range.startContainer;
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList?.contains('md-body')) {
      mdBody = n as HTMLElement;
      break;
    }
    n = n.parentNode;
  }
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

// sanitize 済み HTML を DOMParser 経由で挿入する。
// markdown-it の生成結果は render() 内で DOMPurify に通してから渡る。
function insertSanitizedHtml(host: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  while (doc.body.firstChild) {
    host.appendChild(doc.body.firstChild);
  }
}

// ─── トースト ───
let toastTimer: number | null = null;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

// ─── Claude CLI ストリーム呼び出し ───
// 1 つのグローバル listen からすべての panel に配信する
const askSubscribers = new Set<(ev: AskStreamEvent) => void>();
void listen('ask-stream', (ev) => {
  for (const h of askSubscribers) h(ev.payload as AskStreamEvent);
});

const ask = createAsk({
  startStream: async (args) => {
    await invoke('ask_claude_stream', args);
  },
  subscribe: (h) => {
    askSubscribers.add(h);
    return () => {
      askSubscribers.delete(h);
    };
  },
});

// ─── ツリー ───
// 削除した .md の内容を戻す用の Undo スタック (メモリ上、最大 10)
const deleteUndoStack: Array<{ path: string; content: string }> = [];

const tree = createTreeView(treeContainer, {
  onOpen: (node) => {
    void openFile(node.path);
  },
  onDelete: (node) => {
    void deleteMd(node.path);
  },
  onJumpHeading: (anchorId) => {
    scrollToHeadingId(anchorId);
  },
});

// 矢印キー移動後のプレビュー (150ms デバウンスで連打時の I/O を抑える)
let previewTimer: number | null = null;
function schedulePreview(): void {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    const n = tree.getSelectedNode();
    if (n && n.path !== currentFile) void openFile(n.path);
  }, 150);
}

async function deleteMd(path: string): Promise<void> {
  try {
    const content = (await invoke('trash_file', { path })) as string;
    deleteUndoStack.push({ path, content });
    if (deleteUndoStack.length > 10) deleteUndoStack.shift();
    showToast('削除しました (⌘Z で戻す)');
    if (currentFile === path) {
      currentFile = null;
      clear(docHeader);
      clear(docContent);
      docContent.appendChild(
        createEl(
          'div',
          { id: 'emptyState' },
          createEl('h1', {}, 'askmd'),
          createEl('p', { class: 'empty-sub' }, 'ファイルを選んでください'),
        ),
      );
    }
    await refreshTree();
  } catch (e) {
    showToast(`削除失敗: ${String(e)}`);
  }
}

async function undoDelete(): Promise<void> {
  const last = deleteUndoStack.pop();
  if (!last) {
    showToast('戻せる削除はありません');
    return;
  }
  try {
    await invoke('restore_file', { path: last.path, content: last.content });
    showToast('復元しました');
    await refreshTree();
    // 復元したファイルを開いておく
    await openFile(last.path);
  } catch (e) {
    deleteUndoStack.push(last);
    showToast(`復元失敗: ${String(e)}`);
  }
}

async function refreshTree(): Promise<void> {
  if (!currentRoot) return;
  const fresh = (await invoke('scan_markdown_tree', {
    root: currentRoot.path,
  })) as TreeNode | null;
  if (!fresh) return;
  currentRoot.tree = fresh;
  tree.render(fresh, currentRoot.path);
  if (currentFile) tree.setActive(currentFile);
}

// 本文 DOM から h1-h3 を抽出、id を付与してアウトライン項目を返す
function extractOutlineFromDom(body: HTMLElement): OutlineItem[] {
  const items: OutlineItem[] = [];
  const hs = body.querySelectorAll('h1, h2, h3');
  hs.forEach((h, idx) => {
    let id = h.id;
    if (!id) {
      const slug = (h.textContent || '')
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
      id = `h-${idx}-${slug || 'x'}`;
      h.id = id;
    }
    const lvl = Math.min(3, Math.max(1, parseInt(h.tagName.slice(1), 10))) as 1 | 2 | 3;
    items.push({ level: lvl, text: (h.textContent || '').trim(), anchorId: id });
  });
  return items;
}

function scrollToHeadingId(anchorId: string): void {
  const body = docContent.querySelector('.md-body') as HTMLElement | null;
  if (!body) return;
  const target = body.querySelector(`#${CSS.escape(anchorId)}`) as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const containerRect = docContent.getBoundingClientRect();
  const top = docContent.scrollTop + (rect.top - containerRect.top) - 60;
  docContent.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

// ─── パレット (Cmd+P) ───
const palette = createPalette((node) => {
  void openFile(node.path);
  tree.setActive(node.path);
});

// ─── 全文横断検索 (Cmd+F) ───
const search = createSearch(
  async (root, query) =>
    (await invoke('search_markdown', { root, query })) as SearchHit[],
  (hit, query) => {
    void openFile(hit.path, { scrollQuery: query });
  },
);

// ─── ファイルを開く ───
interface OpenOptions {
  // 開いたあと本文内を textContent ベースで検索して scroll + 一時ハイライト
  scrollQuery?: string;
}
async function openFile(path: string, options?: OpenOptions): Promise<void> {
  currentFile = path;
  tree.setActive(path);

  const cached = cache.get(path);
  if (cached) {
    renderDoc(path, cached.title, cached.rendered, cached.fmHtml);
    if (options?.scrollQuery) scrollToQuery(options.scrollQuery);
    return;
  }
  try {
    const text = (await invoke('read_markdown', { path })) as string;
    const fm = parseFrontmatter(text);
    const filename = path.split('/').pop() || path;
    const title = extractTitle(fm.body, fm, filename);
    const rendered = render(fm.body);
    const fmHtml = buildFmHeader(fm, title, path);
    cache.set(path, { rendered, title, fmHtml });
    renderDoc(path, title, rendered, fmHtml);
    if (options?.scrollQuery) scrollToQuery(options.scrollQuery);
  } catch (e) {
    showToast(`読み込み失敗: ${String(e)}`);
  }
}

// 描画後の docContent 内で query を textContent ベースに最初の出現へスクロール + 一時ハイライト。
// 行番号ベースでないのは、レンダ後の DOM に行番号が載らない (markdown-it のトークン map を使ってない) ため。
// 実用的にはクエリ文字列で十分ジャンプできる。
function scrollToQuery(query: string): void {
  const q = query.trim();
  if (!q) return;
  const body = docContent.querySelector('.md-body') as HTMLElement | null;
  if (!body) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const qLower = q.toLowerCase();
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = (node as Text).textContent || '';
    const idx = text.toLowerCase().indexOf(qLower);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + q.length);
      const rect = range.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const containerRect = docContent.getBoundingClientRect();
      const targetTop = docContent.scrollTop + (rect.top - containerRect.top) - 120;
      docContent.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      // 一時ハイライト (2.4 秒でフェード)
      const overlay = createEl('div', { class: 'search-jump-highlight' });
      overlay.style.top = `${rect.top - bodyRect.top + body.scrollTop}px`;
      overlay.style.left = `${rect.left - bodyRect.left + body.scrollLeft}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 2500);
      return;
    }
    node = walker.nextNode();
  }
}

function buildFmHeader(
  fm: ReturnType<typeof parseFrontmatter>,
  _title: string,
  path: string,
): HTMLElement | null {
  const meta = createEl('div', { class: 'doc-meta' });
  if (fm.date) meta.appendChild(createEl('span', { class: 'doc-meta-tag' }, fm.date));
  if (fm.tags) {
    for (const tag of fm.tags) meta.appendChild(createEl('span', { class: 'doc-meta-tag' }, `#${tag}`));
  }
  const pathEl = createEl('div', { class: 'doc-title' }, path);
  const container = createEl('div');
  container.appendChild(pathEl);
  if (meta.children.length > 0) container.appendChild(meta);
  return container;
}

function renderDoc(
  path: string,
  _title: string,
  renderedHtml: string,
  header: HTMLElement | null,
): void {
  clear(docHeader);
  if (header) docHeader.appendChild(header);
  docHeader.classList.toggle('empty', !header);

  clear(docContent);
  const body = createEl('article', { class: 'md-body' });
  insertSanitizedHtml(body, renderedHtml);
  docContent.appendChild(body);
  docContent.scrollTop = 0;

  // 画像の相対パスを asset URL に解決
  const dir = path.substring(0, path.lastIndexOf('/'));
  body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || /^(https?:|data:|blob:|asset:)/.test(src)) return;
    const absolute = src.startsWith('/') ? src : `${dir}/${src}`;
    try {
      img.src = convertFileSrc(absolute, 'asset');
    } catch {}
  });

  // 外部リンクは新規タブ、.md 相対リンクは内部遷移
  body.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href) return;
    if (/^https?:/.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      return;
    }
    if (href.startsWith('#')) return;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const resolved = href.startsWith('/') ? href : `${dir}/${href}`;
      if (/\.md($|#)/i.test(resolved)) {
        const clean = resolved.split('#')[0];
        void openFile(clean);
      }
    });
  });

  // アクティブファイルの見出しアウトラインをツリーに反映
  const outline = extractOutlineFromDom(body);
  tree.setOutline(path, outline);
}

// ─── ディレクトリ読み込み ───
async function loadRoot(path: string): Promise<void> {
  try {
    const node = (await invoke('scan_markdown_tree', { root: path })) as TreeNode | null;
    if (!node) {
      showToast('そのディレクトリには .md が見つかりません');
      return;
    }
    currentRoot = { path, tree: node };
    rootLabel.textContent = node.name;
    rootLabel.title = path;
    tree.render(node, path);
    try {
      await invoke('start_watch', { path });
    } catch (e) {
      console.warn('start_watch failed:', e);
    }
  } catch (e) {
    showToast(`スキャン失敗: ${String(e)}`);
  }
}

async function pickAndLoad(): Promise<void> {
  const picked = (await invoke('pick_directory')) as string | null;
  if (picked) await loadRoot(picked);
}

// ─── イベント配線 ───
openBtn.addEventListener('click', pickAndLoad);
document.getElementById('openBtnLarge')?.addEventListener('click', pickAndLoad);

// ─── フォルダ D&D (Tauri の OS ネイティブ drag-drop イベント) ───
void listen('tauri://drag-enter', () => {
  dropOverlay.hidden = false;
});
void listen('tauri://drag-leave', () => {
  dropOverlay.hidden = true;
});
void listen('tauri://drag-drop', async (ev) => {
  dropOverlay.hidden = true;
  const paths = (ev.payload as { paths?: string[] } | undefined)?.paths;
  const first = paths && paths[0];
  if (!first) return;
  await loadRoot(first);
});

filterInput.addEventListener('input', () => {
  tree.applyFilter(filterInput.value);
});
filterInput.addEventListener('keydown', (ev) => {
  // 絞り込み入力中の IME 変換確定 Enter で誤ってファイルが開かないよう除外。
  const composing = ev.isComposing || ev.keyCode === 229;
  if (ev.key === 'Escape' && !composing) {
    filterInput.value = '';
    tree.applyFilter('');
    filterInput.blur();
  } else if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    tree.moveSelection(1);
    schedulePreview();
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    tree.moveSelection(-1);
    schedulePreview();
  } else if (ev.key === 'Enter' && !composing) {
    ev.preventDefault();
    tree.openSelected();
  }
});

// ─── グローバルキーボード ───
document.addEventListener('keydown', (ev) => {
  const meta = ev.metaKey || ev.ctrlKey;

  if (meta && ev.key.toLowerCase() === 'o') {
    ev.preventDefault();
    void pickAndLoad();
    return;
  }
  if (meta && ev.key.toLowerCase() === 'p') {
    ev.preventDefault();
    palette.open(tree.flatten());
    return;
  }
  if (meta && ev.key.toLowerCase() === 'f') {
    ev.preventDefault();
    if (!currentRoot) {
      showToast('先にディレクトリを開いてください');
      return;
    }
    search.open(currentRoot.path);
    return;
  }
  if (meta && ev.key.toLowerCase() === 'l') {
    ev.preventDefault();
    const selObj = window.getSelection();
    const sel = selObj?.toString() || '';
    const filename = currentFile?.split('/').pop() || '';
    const ctx = {
      title: filename.replace(/\.md$/i, ''),
      path: currentFile || '',
      root: currentRoot?.path || '',
    };
    if (sel.trim() && selObj && selObj.rangeCount > 0) {
      const range = selObj.getRangeAt(0);
      const anchor = anchorBlockOf(range);
      // open 時にハイライト overlay を描画、close 時に除去
      ask.open(sel, ctx, anchor, {
        onOpen: () => highlightRange(range),
      });
    } else if (ask.hasAny()) {
      // 選択なしでも既存パネルがあれば最後に触ったやつに focus (継続質問)
      ask.focusLast();
    } else {
      showToast('質問するテキストを本文中で選択してください');
    }
    return;
  }
  if (ev.key === '@' && document.activeElement?.tagName !== 'INPUT') {
    ev.preventDefault();
    filterInput.focus();
    filterInput.select();
    return;
  }
  if (ev.key === 'Escape') {
    // ask パネルは内部の input keydown で自身を閉じるのでここでは扱わない。
    if (search.isOpen()) search.close();
    else if (palette.isOpen()) palette.close();
    else tree.cancelPendingDelete();
    return;
  }
  const inInput = ['INPUT', 'TEXTAREA'].includes(
    document.activeElement?.tagName || '',
  );

  // Cmd+Z は input/textarea の native undo を邪魔しないので、そこ以外で削除 undo
  if (meta && ev.key.toLowerCase() === 'z' && !inInput && !ev.shiftKey) {
    ev.preventDefault();
    void undoDelete();
    return;
  }

  if (inInput) return;

  // Delete / Backspace でツリー選択中のファイル削除 (2 段階確認)
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    tree.requestDeleteSelected();
    return;
  }

  // Tab で左右ペイン切替 (Shift+Tab も逆サイドへ)
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const onLeft = leftPane.contains(document.activeElement);
    (onLeft ? docContent : treeContainer).focus();
    return;
  }

  // 右ペインフォーカス時は矢印/Space/PageUp/Down でスクロール
  if (document.activeElement === docContent) {
    const step = 40;
    const page = Math.max(80, docContent.clientHeight * 0.9);
    if (ev.key === 'ArrowDown' || ev.key === 'j') {
      ev.preventDefault();
      docContent.scrollBy({ top: step });
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'k') {
      ev.preventDefault();
      docContent.scrollBy({ top: -step });
      return;
    }
    if (ev.key === ' ' || ev.key === 'PageDown') {
      ev.preventDefault();
      docContent.scrollBy({ top: page });
      return;
    }
    if (ev.key === 'PageUp') {
      ev.preventDefault();
      docContent.scrollBy({ top: -page });
      return;
    }
    if (ev.key === 'Home') {
      ev.preventDefault();
      docContent.scrollTo({ top: 0 });
      return;
    }
    if (ev.key === 'End') {
      ev.preventDefault();
      docContent.scrollTo({ top: docContent.scrollHeight });
      return;
    }
  }

  // それ以外 (左ペイン側): 矢印/j/k で tree 移動、Enter で開く
  // 矢印移動 = 即プレビュー (150ms デバウンス)。Enter は確定 open で即時
  if (ev.key === 'ArrowDown' || ev.key === 'j') {
    ev.preventDefault();
    tree.moveSelection(1);
    schedulePreview();
  } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
    ev.preventDefault();
    tree.moveSelection(-1);
    schedulePreview();
  } else if (ev.key === 'ArrowRight' || ev.key === 'l') {
    // ファイル選択状態 → outline モードに入る。未オープンならまず開いてから
    ev.preventDefault();
    if (tree.getNavMode() === 'file') {
      if (!tree.enterOutlineMode()) {
        const n = tree.getSelectedNode();
        if (n) void openFile(n.path).then(() => tree.enterOutlineMode());
      }
    }
  } else if (ev.key === 'ArrowLeft' || ev.key === 'h') {
    // outline モード → ファイル選択モードに戻る
    ev.preventDefault();
    tree.exitOutlineMode();
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    tree.openSelected();
  }
});

// ─── ファイル変更監視 ───
void listen('fs-changed', async (ev) => {
  const paths = ev.payload as string[];
  if (currentFile && paths.includes(currentFile)) {
    cache.delete(currentFile);
    await openFile(currentFile);
  }
  if (currentRoot) {
    const fresh = (await invoke('scan_markdown_tree', { root: currentRoot.path })) as TreeNode | null;
    if (fresh) {
      currentRoot.tree = fresh;
      tree.render(fresh, currentRoot.path);
      if (currentFile) tree.setActive(currentFile);
    }
  }
});

// ─── 起動 ───
(async () => {
  try {
    const initial = (await invoke('get_initial_path')) as string | null;
    if (initial) await loadRoot(initial);
  } catch (e) {
    console.error('init failed:', e);
  }
})();
