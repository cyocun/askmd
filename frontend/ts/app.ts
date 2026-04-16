import { byId, clear, createEl } from './dom';
import { createAsk } from './ask';
import type { AskStreamEvent } from './ask';
import { createPalette } from './palette';
import { createSearch } from './search';
import type { SearchHit } from './search';
import { createTreeView } from './tree';
import { addCopyButtons, extractTitle, parseFrontmatter, processAdmonitions, render, renderMermaidBlocks } from './renderer';
import { currentTheme, initTheme } from './theme';
import { initLang, getLang, toggleLang, t } from './i18n';
import type { DiffInfo, FileChangeInfo, OutlineItem, TreeNode } from './types';
import { createEditor } from './editor';
import type { EditorHandle } from './editor';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '../styles/app.css';

// ─── AI プロバイダー型 ───
interface AiProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

// ─── 最近開いたディレクトリ型 ───
interface RecentDir {
  path: string;
  name: string;
}

// ─── スクロール位置永続化 ───
function scrollKey(filePath: string): string {
  const rel = currentRoot && filePath.startsWith(currentRoot.path)
    ? filePath.slice(currentRoot.path.length)
    : filePath;
  return `askmd-scroll:${rel}`;
}
function saveScrollPos(filePath: string, top: number): void {
  try { localStorage.setItem(scrollKey(filePath), String(Math.round(top))); } catch {}
}
function loadScrollPos(filePath: string): number | null {
  try {
    const v = localStorage.getItem(scrollKey(filePath));
    return v != null ? parseInt(v, 10) : null;
  } catch { return null; }
}

// ─── 状態 ───
let currentRoot: { path: string; tree: TreeNode } | null = null;
let currentFile: string | null = null;
const cache = new Map<string, { rendered: string; title: string; fmHtml: HTMLElement | null; rawBody: string }>();
// レンダリング済み DOM をファイルパスごとに保持 (スクロール位置・Ask パネル含む)
interface DomSnapshot {
  header: DocumentFragment;
  body: HTMLElement;        // docContent の中身
  scrollTop: number;
}
const domCache = new Map<string, DomSnapshot>();
let activeProviderName = 'Claude';
let aiAvailable = false; // どれか1つでも AI プロバイダーが利用可能か
let activeEditor: EditorHandle | null = null; // Cmd+E 編集モード

const leftPane = byId('leftPane');
const treeContainer = byId('treeContainer');
const rootLabel = byId('rootLabel');
const docHeader = byId('docHeader');
const docContent = byId('docContent');
const filterInput = byId('filterInput') as HTMLInputElement;
const toast = byId('toast');
const dropOverlay = byId('dropOverlay');
const providerBtn = byId('providerBtn') as HTMLButtonElement;
const providerMenu = byId('providerMenu');

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

// 見出しごとに <section> でラップして sticky の入れ替わりを実現する。
// sticky 要素は親の範囲内でのみ固定されるため、
// セクション分割しないとすべての見出しが .md-body 末尾までずっと sticky になる。
function wrapSections(body: HTMLElement): void {
  const children = Array.from(body.childNodes);
  let section: HTMLElement | null = null;

  for (const child of children) {
    const el = child as HTMLElement;
    const isHeading = child.nodeType === Node.ELEMENT_NODE && /^H[1-4]$/.test(el.tagName);
    if (isHeading) {
      section = document.createElement('section');
      section.className = 'md-section';
      body.insertBefore(section, child);
      section.appendChild(child);
    } else if (section) {
      section.appendChild(child);
    }
    // 見出し前のコンテンツ (section === null) はそのまま body 直下に残る
  }
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
    await invoke('ask_ai_stream', args);
  },
  subscribe: (h) => {
    askSubscribers.add(h);
    return () => {
      askSubscribers.delete(h);
    };
  },
  getProviderName: () => activeProviderName,
  renderMarkdown: (md) => render(md),
  postProcessContent: (container) => addCopyButtons(container),
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
    showToast(t('toast.deleted'));
    if (currentFile === path) {
      currentFile = null;
      clear(docHeader);
      clear(docContent);
      const emptyEl = createEl(
        'div',
        { id: 'emptyState' },
        createEl('h1', {}, 'askmd'),
        createEl('p', { class: 'empty-sub' }, t('empty.selectFile')),
      );
      docContent.appendChild(emptyEl);
    }
    await refreshTree();
  } catch (e) {
    showToast(t('toast.deleteFail', String(e)));
  }
}

async function undoDelete(): Promise<void> {
  const last = deleteUndoStack.pop();
  if (!last) {
    showToast(t('toast.noUndo'));
    return;
  }
  try {
    await invoke('restore_file', { path: last.path, content: last.content });
    showToast(t('toast.restored'));
    await refreshTree();
    // 復元したファイルを開いておく
    await openFile(last.path);
  } catch (e) {
    deleteUndoStack.push(last);
    showToast(t('toast.restoreFail', String(e)));
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
    const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
    const fm = parseFrontmatter(result.content);
    const filename = path.split('/').pop() || path;
    const title = extractTitle(fm.body, fm, filename);
    const rendered = render(fm.body);
    const fmHtml = buildFmHeader(fm, title, path, result.modified);
    cache.set(path, { rendered, title, fmHtml, rawBody: fm.body });
    renderDoc(path, title, rendered, fmHtml);
    if (options?.scrollQuery) scrollToQuery(options.scrollQuery);
  } catch (e) {
    showToast(t('toast.readFail', String(e)));
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

function relativePath(absPath: string): string {
  if (currentRoot && absPath.startsWith(currentRoot.path)) {
    return absPath.slice(currentRoot.path.length).replace(/^\/+/, '');
  }
  return absPath;
}

function formatModified(epochSecs: number | null): string | null {
  if (epochSecs == null) return null;
  const d = new Date(epochSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildFmHeader(
  fm: ReturnType<typeof parseFrontmatter>,
  title: string,
  path: string,
  modified: number | null,
): HTMLElement | null {
  const container = createEl('div', { style: 'display:contents;' });

  // タイトル行（frontmatter title or 最初の H1 or ファイル名）
  container.appendChild(createEl('div', { class: 'doc-heading' }, title));

  // 情報行: パス・メタ・アクション
  const infoRow = createEl('div', { class: 'doc-info-row' });

  const pathEl = createEl('span', {
    class: 'doc-title',
    title: t('header.clickToSelect'),
    onClick: (ev) => {
      const range = document.createRange();
      range.selectNodeContents(ev.currentTarget as Node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
  }, relativePath(path));
  infoRow.appendChild(pathEl);

  // メタ情報 (更新日・tags)
  const meta = createEl('div', { class: 'doc-meta' });
  const modStr = formatModified(modified);
  if (modStr) meta.appendChild(createEl('span', { class: 'doc-meta-tag' }, modStr));
  if (fm.tags) {
    for (const tag of fm.tags) meta.appendChild(createEl('span', { class: 'doc-meta-tag' }, `#${tag}`));
  }
  if (meta.children.length > 0) {
    infoRow.appendChild(createEl('span', { class: 'doc-sep' }, '·'));
    infoRow.appendChild(meta);
  }

  // アクションボタン
  const actions = createEl('div', { class: 'doc-actions' });
  actions.appendChild(createEl('button', {
    class: 'doc-action-btn',
    title: t('header.finder'),
    onClick: () => void invoke('reveal_in_finder', { path }),
  }, 'Finder'));
  actions.appendChild(createEl('button', {
    class: 'doc-action-btn',
    title: t('header.translate'),
    dataset: { role: 'translate' },
    onClick: () => void translateCurrentDoc(),
  }, t('translate.btn')));
  actions.appendChild(createEl('button', {
    class: 'doc-action-btn',
    title: t('header.edit'),
    dataset: { role: 'edit' },
    onClick: () => {
      if (activeEditor) exitEditMode();
      else void enterEditMode();
    },
  }, t('edit.btn')));
  // 差分バッジ (非同期で取得後に表示)
  const diffBadge = createEl('button', {
    class: 'doc-action-btn doc-diff-badge',
    dataset: { role: 'diff' },
  });
  diffBadge.hidden = true;
  actions.appendChild(diffBadge);
  if (currentRoot) {
    void (async () => {
      try {
        let diff: DiffInfo | null;
        if (diffCache.has(path)) {
          diff = diffCache.get(path)!;
        } else {
          diff = (await invoke('get_diff', { path, root: currentRoot!.path })) as DiffInfo | null;
          diffCache.set(path, diff);
        }
        if (diff && diff.change_count > 0) {
          diffBadge.textContent = t('diff.changed', diff.change_count);
          diffBadge.title = t('diff.clickToView');
          diffBadge.hidden = false;
          let highlighted = false;
          diffBadge.addEventListener('click', () => {
            const mdBody = docContent.querySelector('.md-body') as HTMLElement | null;
            if (!mdBody) return;
            if (highlighted) {
              mdBody.querySelectorAll('.diff-block-add, .diff-block-change').forEach((el) => {
                el.classList.remove('diff-block-add', 'diff-block-change');
              });
              diffBadge.classList.remove('active');
              highlighted = false;
            } else {
              highlightChangedBlocks(mdBody, diff);
              diffBadge.classList.add('active');
              highlighted = true;
              const first = mdBody.querySelector('.diff-block-add, .diff-block-change');
              if (first) {
                first.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }
            }
          });
        }
      } catch (e) {
        console.warn('get_diff failed:', e);
      }
    })();
  }
  infoRow.appendChild(actions);

  container.appendChild(infoRow);
  return container;
}

// 現在表示中の DOM をキャッシュに退避
function saveDomSnapshot(): void {
  const prevPath = docContent.dataset.path || '';
  if (!prevPath) return;
  saveScrollPos(prevPath, docContent.scrollTop);
  const headerFrag = document.createDocumentFragment();
  while (docHeader.firstChild) headerFrag.appendChild(docHeader.firstChild);
  const bodyFrag = document.createDocumentFragment();
  while (docContent.firstChild) bodyFrag.appendChild(docContent.firstChild);
  const wrapper = createEl('div');
  wrapper.appendChild(bodyFrag);
  domCache.set(prevPath, {
    header: headerFrag,
    body: wrapper,
    scrollTop: docContent.scrollTop,
  });
}

// キャッシュから DOM を復元。成功したら true。
function restoreDomSnapshot(path: string): boolean {
  const snap = domCache.get(path);
  if (!snap) return false;
  domCache.delete(path);
  clear(docHeader);
  docHeader.appendChild(snap.header);
  docHeader.classList.toggle('empty', docHeader.childElementCount === 0);
  clear(docContent);
  while (snap.body.firstChild) docContent.appendChild(snap.body.firstChild);
  docContent.dataset.path = path;
  docContent.scrollTop = snap.scrollTop;
  // アウトラインを再設定
  const mdBody = docContent.querySelector('.md-body') as HTMLElement | null;
  if (mdBody) {
    const outline = extractOutlineFromDom(mdBody);
    tree.setOutline(path, outline);
  }
  return true;
}

function renderDoc(
  path: string,
  _title: string,
  renderedHtml: string,
  header: HTMLElement | null,
): void {
  const prevPath = docContent.dataset.path || '';

  // 別ファイルへの切替時のみ現在の DOM を退避。
  // 同一ファイルの再レンダリング (fs-changed 後) では旧 DOM を保存しない —
  // 保存すると直後の restoreDomSnapshot で古い内容が復元されてしまう。
  if (prevPath && prevPath !== path) {
    saveDomSnapshot();
  }

  // キャッシュに DOM があればそちらを復元
  if (restoreDomSnapshot(path)) {
    return;
  }

  clear(docHeader);
  if (header) docHeader.appendChild(header);
  docHeader.classList.toggle('empty', !header);

  clear(docContent);
  const body = createEl('article', { class: 'md-body' });
  insertSanitizedHtml(body, renderedHtml);
  wrapSections(body);
  docContent.appendChild(body);
  docContent.dataset.path = path;
  docContent.scrollTop = 0;
  // 保存済みスクロール位置の復元 (DOM レイアウト確定後)
  const savedScroll = loadScrollPos(path);
  if (savedScroll != null && savedScroll > 0) {
    requestAnimationFrame(() => { docContent.scrollTop = savedScroll; });
  }

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

  // .md 相対リンクは内部遷移（外部リンクはグローバルハンドラで処理）
  body.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href || /^https?:/.test(href) || href.startsWith('#')) return;
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

  processAdmonitions(body);
  addCopyButtons(body);
  void renderMermaidBlocks();
}

// ─── 差分ハイライト ───
const diffCache = new Map<string, DiffInfo | null>();

function highlightChangedBlocks(body: HTMLElement, diff: DiffInfo): void {
  const changedLines = new Set([...diff.added, ...diff.changed]);
  body.querySelectorAll('[data-lines]').forEach((el) => {
    const attr = el.getAttribute('data-lines');
    if (!attr) return;
    const [startStr, endStr] = attr.split(',');
    const start = parseInt(startStr, 10); // 0-based
    const end = parseInt(endStr, 10);
    // markdown-it の map は 0-based [start, end)。DiffInfo は 1-based。
    for (let line = start + 1; line <= end; line++) {
      if (changedLines.has(line)) {
        // added と changed を区別
        const isAdd = diff.added.includes(line);
        el.classList.add(isAdd ? 'diff-block-add' : 'diff-block-change');
        break;
      }
    }
  });
}

async function loadChangeBadges(root: string): Promise<void> {
  try {
    const changed = (await invoke('get_changed_files', { root })) as FileChangeInfo[];
    // await 中にルートが変わった場合はスキップ
    if (!changed.length || !currentRoot || currentRoot.path !== root) return;
    // ツリーの TreeNode に has_changes を付与して再描画
    const changedMap = new Map(changed.map((c) => [c.path, c.change_count]));
    markChanges(currentRoot.tree, changedMap);
    tree.render(currentRoot.tree, currentRoot.path);
    if (currentFile) tree.setActive(currentFile);
  } catch {
    // 無視
  }
}

function markChanges(node: TreeNode, changed: Map<string, number>): void {
  if (!node.is_dir) {
    const count = changed.get(node.path);
    node.has_changes = count != null && count > 0;
    node.change_count = count ?? 0;
    return;
  }
  if (node.children) {
    for (const child of node.children) {
      markChanges(child, changed);
    }
  }
}

// ─── ディレクトリ読み込み ───
async function loadRoot(path: string): Promise<void> {
  try {
    const node = (await invoke('scan_markdown_tree', { root: path })) as TreeNode | null;
    if (!node) {
      showToast(t('toast.noMd'));
      return;
    }
    currentRoot = { path, tree: node };
    rootLabel.textContent = node.name;
    rootLabel.title = path;
    tree.render(node, path);
    // 最近開いたディレクトリに追加
    void invoke('add_recent_dir', { path });
    // 変更バッジを非同期で取得 (ツリー描画をブロックしない)
    void loadChangeBadges(path);
    try {
      await invoke('start_watch', { path });
    } catch (e) {
      console.warn('start_watch failed:', e);
    }
  } catch (e) {
    showToast(t('toast.scanFail', String(e)));
  }
}

// ─── Diff ビュー (文字単位ハイライト付き) ───
async function showDiffView(path: string, root: string): Promise<void> {
  try {
    const diffHtml = (await invoke('get_diff_text', { path, root })) as string | null;
    if (!diffHtml) {
      showToast(t('changes.none'));
      return;
    }
    const filename = path.split('/').pop() || path;

    const overlay = createEl('div', { class: 'changes-overlay' });
    const panel = createEl('div', { class: 'diff-view-panel' });
    const header = createEl('div', { class: 'changes-header' },
      createEl('span', {}, filename),
      createEl('button', { class: 'btn-ghost', onClick: close }, '×'),
    );
    const content = createEl('div', { class: 'diff-view-content' });
    // Rust 側で HTML エスケープ済みの構造化 HTML を挿入
    const doc = new DOMParser().parseFromString(diffHtml, 'text/html');
    while (doc.body.firstChild) content.appendChild(doc.body.firstChild);

    panel.appendChild(header);
    panel.appendChild(content);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  } catch (e) {
    console.warn('get_diff_text failed:', e);
  }
}

// ─── 変更ファイル一覧パネル ───
async function showChangedFiles(): Promise<void> {
  if (!currentRoot) {
    showToast(t('toast.openDirFirst'));
    return;
  }
  const root = currentRoot.path;
  try {
    const changed = (await invoke('get_changed_files', { root })) as FileChangeInfo[];
    if (!changed.length) {
      showToast(t('changes.none'));
      return;
    }
    // パレット風オーバーレイで表示
    const overlay = createEl('div', { class: 'changes-overlay' });
    const panel = createEl('div', { class: 'changes-panel' });
    const header = createEl('div', { class: 'changes-header' },
      createEl('span', {}, t('changes.title', changed.length)),
      createEl('button', { class: 'btn-ghost', onClick: close }, '×'),
    );
    const list = createEl('div', { class: 'changes-list' });

    for (const file of changed) {
      const rel = root && file.path.startsWith(root)
        ? file.path.slice(root.length).replace(/^\/+/, '')
        : file.path;
      const item = createEl('button', {
        class: 'changes-item',
        onClick: () => {
          close();
          void openFile(file.path);
          tree.setActive(file.path);
        },
      },
        createEl('span', { class: 'changes-item-name' }, file.title || file.name),
        createEl('span', { class: 'changes-item-path' }, rel),
        createEl('span', { class: 'changes-item-count' }, `+${file.change_count}`),
      );
      list.appendChild(item);
    }

    panel.appendChild(header);
    panel.appendChild(list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  } catch {
    showToast(t('changes.fail'));
  }
}

async function pickAndLoad(): Promise<void> {
  const picked = (await invoke('pick_directory')) as string | null;
  if (picked) await loadRoot(picked);
}

// ─── 簡易編集 (Cmd+E) ───
async function enterEditMode(): Promise<void> {
  if (!currentFile || activeEditor) return;
  const path = currentFile;
  try {
    const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
    // 現在の読みモードの DOM を退避
    saveDomSnapshot();
    clear(docContent);
    docContent.dataset.editing = 'true';

    const editorContainer = createEl('div', { class: 'editor-container' });
    docContent.appendChild(editorContainer);

    const isDark = currentTheme().includes('dark');
    activeEditor = createEditor(editorContainer, {
      content: result.content,
      isDark,
      onSave: async (content) => {
        try {
          await invoke('restore_file', { path, content });
          // fs-changed イベントが発火し、自動で読みモードに戻る
          exitEditMode();
          showToast(t('toast.saved'));
        } catch (e) {
          showToast(t('toast.saveFail', String(e)));
        }
      },
      onCancel: () => {
        exitEditMode();
      },
    });
    activeEditor.focus();
  } catch (e) {
    showToast(t('toast.readFail', String(e)));
  }
}

function exitEditMode(): void {
  if (!activeEditor) return;
  activeEditor.destroy();
  activeEditor = null;
  delete docContent.dataset.editing;
  // キャッシュから復元して読みモードに戻す
  if (currentFile) {
    const snap = domCache.get(currentFile);
    if (snap) {
      restoreDomSnapshot(currentFile);
    } else {
      // キャッシュになければ再読み込み
      cache.delete(currentFile);
      void openFile(currentFile);
    }
  }
}

// ─── イベント配線 ───
document.getElementById('openBtnLarge')?.addEventListener('click', pickAndLoad);

// ペインクリックでフォーカス状態を更新 (Finder 方式)
leftPane.addEventListener('mousedown', () => document.body.classList.add('focus-tree'));
docContent.addEventListener('mousedown', () => document.body.classList.remove('focus-tree'));

function toggleSidebar(): void {
  document.body.classList.toggle('sidebar-collapsed');
  if (document.body.classList.contains('sidebar-collapsed')) {
    docContent.focus();
    document.body.classList.remove('focus-tree');
  }
}

// ─── ツールバーボタン ───
document.getElementById('tbSidebar')?.addEventListener('click', toggleSidebar);
document.getElementById('tbSearch')?.addEventListener('click', () => {
  if (currentRoot) search.open(currentRoot.path);
  else showToast(t('toast.openDirFirst'));
});
document.getElementById('tbPalette')?.addEventListener('click', () => {
  palette.open(tree.flatten());
});
document.getElementById('tbChanges')?.addEventListener('click', () => {
  void showChangedFiles();
});

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

  if (meta && ev.key.toLowerCase() === 'b') {
    ev.preventDefault();
    toggleSidebar();
    return;
  }
  if (meta && ev.key.toLowerCase() === 'e') {
    ev.preventDefault();
    if (activeEditor) {
      exitEditMode();
    } else {
      void enterEditMode();
    }
    return;
  }
  // 編集モード中は他のグローバルショートカットを無効化 (Cmd+S, Escape は editor.ts 内で処理)
  if (activeEditor) return;
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
  if (meta && ev.shiftKey && ev.key.toLowerCase() === 't') {
    ev.preventDefault();
    void translateCurrentDoc();
    return;
  }
  if (meta && ev.key.toLowerCase() === 'f') {
    ev.preventDefault();
    if (!currentRoot) {
      showToast(t('toast.openDirFirst'));
      return;
    }
    search.open(currentRoot.path);
    return;
  }
  if (meta && ev.key.toLowerCase() === 'l') {
    ev.preventDefault();
    if (!aiAvailable) {
      showToast(t('toast.noProvider'));
      return;
    }
    const selObj = window.getSelection();
    const sel = selObj?.toString() || '';
    const filename = currentFile?.split('/').pop() || '';
    const cached = currentFile ? cache.get(currentFile) : undefined;
    const ctx = {
      title: filename.replace(/\.md$/i, ''),
      path: currentFile || '',
      root: currentRoot?.path || '',
      fileContent: cached?.rawBody,
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
    } else if (currentFile) {
      // 選択なし・パネルなし: ファイル全体について質問
      ask.open('', ctx, null);
    } else {
      showToast(t('toast.openFile'));
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
    const target = onLeft ? docContent : treeContainer;
    target.focus();
    document.body.classList.toggle('focus-tree', !onLeft);
    return;
  }

  // 右ペインフォーカス時は矢印/Space/PageUp/Down でスクロール
  if (document.activeElement === docContent) {
    // ← で左ペイン (ツリー) にフォーカスを戻す
    if (ev.key === 'ArrowLeft' || ev.key === 'h') {
      ev.preventDefault();
      treeContainer.focus();
      document.body.classList.add('focus-tree');
      return;
    }
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
  document.body.classList.add('focus-tree');
  if (ev.key === 'ArrowDown' || ev.key === 'j') {
    ev.preventDefault();
    tree.moveSelection(1);
    schedulePreview();
  } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
    ev.preventDefault();
    tree.moveSelection(-1);
    schedulePreview();
  } else if (ev.key === 'ArrowRight' || ev.key === 'l') {
    ev.preventDefault();
    const kind = tree.getSelectedKind();
    if (kind === 'dir') {
      tree.expandSelected();
    } else if (tree.getNavMode() === 'file') {
      if (!tree.enterOutlineMode()) {
        const n = tree.getSelectedNode();
        if (n) void openFile(n.path).then(() => tree.enterOutlineMode());
      }
    } else if (tree.getNavMode() === 'outline') {
      docContent.focus();
      document.body.classList.remove('focus-tree');
    }
  } else if (ev.key === 'ArrowLeft' || ev.key === 'h') {
    ev.preventDefault();
    const kind = tree.getSelectedKind();
    if (kind === 'dir') {
      tree.collapseSelected();
    } else {
      tree.exitOutlineMode();
    }
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    tree.openSelected();
  }
});

// ─── 選択時フローティング Ask ボタン ───
const selAskBtn = createEl('button', { id: 'selectionAskBtn' }, t('ask.btn'));
selAskBtn.hidden = true;
document.body.appendChild(selAskBtn);

selAskBtn.addEventListener('mousedown', (ev) => {
  ev.preventDefault(); // 選択が消えないようにする
});
selAskBtn.addEventListener('click', (ev) => {
  ev.preventDefault();
  selAskBtn.hidden = true;
  // Cmd+L と同じロジックを発火
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
});

function updateSelectionAskBtn(): void {
  const selObj = window.getSelection();
  const sel = selObj?.toString().trim() || '';
  if (!sel || !aiAvailable || !currentFile) {
    selAskBtn.hidden = true;
    return;
  }
  // 選択範囲が docContent 内かチェック
  if (!selObj || selObj.rangeCount === 0) { selAskBtn.hidden = true; return; }
  const range = selObj.getRangeAt(0);
  if (!docContent.contains(range.startContainer)) { selAskBtn.hidden = true; return; }

  const rect = range.getBoundingClientRect();
  if (rect.width < 1) { selAskBtn.hidden = true; return; }

  // 選択範囲の末尾下にボタンを配置
  let top = rect.bottom + 6;
  let left = rect.right - 40;
  // 画面外に出ないよう調整
  const btnW = 100;
  const btnH = 28;
  if (left + btnW > window.innerWidth - 8) left = window.innerWidth - btnW - 8;
  if (left < 8) left = 8;
  if (top + btnH > window.innerHeight - 8) top = rect.top - btnH - 6;

  selAskBtn.style.top = `${top}px`;
  selAskBtn.style.left = `${left}px`;
  selAskBtn.hidden = false;
}

docContent.addEventListener('mouseup', () => {
  // mouseup 直後は selection がまだ確定していないことがあるので少し待つ
  requestAnimationFrame(updateSelectionAskBtn);
});
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection()?.toString().trim() || '';
  if (!sel) selAskBtn.hidden = true;
});

// ─── ファイル変更監視 ───
void listen('fs-changed', async (ev) => {
  const paths = ev.payload as string[];
  for (const p of paths) {
    cache.delete(p);
    domCache.delete(p);
    diffCache.delete(p);
  }
  if (currentFile && paths.includes(currentFile)) {
    const scrollTop = docContent.scrollTop;
    await openFile(currentFile);
    docContent.scrollTop = scrollTop;
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

// ─── AI プロバイダー切替メニュー ───

function updateProviderBtnLabel(name: string): void {
  clear(providerBtn);
  providerBtn.appendChild(document.createTextNode(`${name} `));
  providerBtn.appendChild(createEl('span', { class: 'provider-caret' }, '▾'));
}

async function initProviderMenu(): Promise<void> {
  try {
    const providers = (await invoke('get_ai_providers')) as AiProviderInfo[];
    const anyAvailable = providers.some((p) => p.available);
    aiAvailable = anyAvailable;

    // AI プロバイダーが 1 つもなければセレクターを隠してビューア専用モード
    const providerSelector = byId('providerSelector');
    if (!anyAvailable) {
      providerSelector.hidden = true;
      return;
    }
    providerSelector.hidden = false;

    const activeId = (await invoke('get_active_provider')) as string;
    let active = providers.find((p) => p.id === activeId);

    // デフォルトプロバイダーが利用不可なら最初の利用可能なものに自動切替
    if (!active?.available) {
      const fallback = providers.find((p) => p.available);
      if (fallback) {
        await invoke('set_active_provider', { provider: fallback.id });
        active = fallback;
      }
    }

    if (active) {
      activeProviderName = active.name;
      updateProviderBtnLabel(active.name);
    }

    // メニュー項目を構築
    clear(providerMenu);
    for (const p of providers) {
      const item = createEl(
        'button',
        {
          class: `provider-item${p.id === active?.id ? ' active' : ''}${!p.available ? ' unavailable' : ''}`,
          dataset: { id: p.id },
        },
        p.name,
      );
      if (!p.available) {
        item.appendChild(createEl('span', { class: 'provider-unavail-hint' }, t('provider.unavailable')));
      }
      item.addEventListener('click', () => void selectProvider(p.id, p.name));
      providerMenu.appendChild(item);
    }
  } catch (e) {
    console.warn('provider init failed:', e);
  }
}

async function selectProvider(id: string, name: string): Promise<void> {
  try {
    await invoke('set_active_provider', { provider: id });
    activeProviderName = name;
    updateProviderBtnLabel(name);
    providerMenu.hidden = true;
    // active クラス更新
    providerMenu.querySelectorAll('.provider-item').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset['id'] === id);
    });
    showToast(t('toast.switched', name));
  } catch (e) {
    showToast(String(e));
  }
}

providerBtn.addEventListener('click', (ev) => {
  ev.stopPropagation();
  providerMenu.hidden = !providerMenu.hidden;
});

// メニュー外クリックで閉じる
document.addEventListener('click', () => {
  providerMenu.hidden = true;
});

// 外部リンク (http/https) はデフォルトブラウザで開く（WebView 内遷移を防止）
document.addEventListener('click', (ev) => {
  const a = (ev.target as HTMLElement).closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (/^https?:/.test(href)) {
    ev.preventDefault();
    void invoke('open_url', { url: href });
  }
});

// ─── 最近開いたディレクトリを emptyState に表示 ───
async function renderRecentDirs(): Promise<void> {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  try {
    const recent = (await invoke('get_recent_dirs')) as RecentDir[];
    if (recent.length === 0) return;
    const existing = emptyState.querySelector('.recent-list');
    if (existing) existing.remove();

    const heading = createEl('div', { class: 'recent-heading' }, t('empty.recent'));
    emptyState.appendChild(heading);
    const ul = createEl('ul', { class: 'recent-list' });
    for (const dir of recent) {
      const btn = createEl(
        'button',
        {
          class: 'recent-item',
          onClick: () => void loadRoot(dir.path),
        },
        createEl('span', { class: 'recent-item-name' }, dir.name),
        createEl('span', { class: 'recent-item-path' }, dir.path),
      );
      ul.appendChild(createEl('li', {}, btn));
    }
    emptyState.appendChild(ul);
  } catch (e) {
    console.warn('recent dirs load failed:', e);
  }
}

// ─── 翻訳 (Cmd+Shift+T): 原文をインライン置換、ホバーで原文表示 ───
const translateTooltip = createEl('div', { id: 'translateTooltip' });
translateTooltip.hidden = true;
document.body.appendChild(translateTooltip);

docContent.addEventListener('mouseover', (ev) => {
  const target = (ev.target as HTMLElement).closest('[data-original-text]') as HTMLElement | null;
  if (!target) return;
  const original = target.getAttribute('data-original-text');
  if (!original) return;
  translateTooltip.textContent = original;
  const rect = target.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left;
  if (top + 180 > window.innerHeight) top = rect.top - translateTooltip.offsetHeight - 6;
  if (left + 420 > window.innerWidth) left = window.innerWidth - 420 - 8;
  if (left < 8) left = 8;
  translateTooltip.style.top = `${top}px`;
  translateTooltip.style.left = `${left}px`;
  translateTooltip.hidden = false;
});

docContent.addEventListener('mouseout', (ev) => {
  const related = (ev as MouseEvent).relatedTarget as Node | null;
  if (related && (related as HTMLElement).closest?.('[data-original-text]')) return;
  translateTooltip.hidden = true;
});

async function translateCurrentDoc(): Promise<void> {
  const body = docContent.querySelector('.md-body') as HTMLElement | null;
  if (!body) {
    showToast(t('translate.noDoc'));
    return;
  }

  const btn = docHeader.querySelector('[data-role="translate"]') as HTMLElement | null;

  // トグル: 翻訳済み → 原文に戻す
  if (body.dataset.translated === 'true') {
    body.querySelectorAll('[data-original-html]').forEach((el) => {
      const htm = el as HTMLElement;
      const saved = htm.getAttribute('data-original-html') || '';
      clear(htm);
      insertSanitizedHtml(htm, saved);
      htm.removeAttribute('data-original-html');
      htm.removeAttribute('data-original-text');
    });
    delete body.dataset.translated;
    if (btn) btn.textContent = t('translate.btn');
    showToast(t('translate.restored'));
    return;
  }

  // 翻訳対象のブロック要素を収集
  const blocks: HTMLElement[] = [];
  body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, th, td').forEach((el) => {
    const htm = el as HTMLElement;
    const text = htm.innerText?.trim();
    // 子にさらにブロック要素を持つ li (ネストリスト) はスキップ
    if (htm.tagName === 'LI' && htm.querySelector('ul, ol')) return;
    if (text && text.length > 1) blocks.push(htm);
  });
  if (blocks.length === 0) {
    showToast(t('translate.noText'));
    return;
  }

  if (btn) { btn.classList.add('loading'); btn.textContent = t('translate.loading'); }

  // 各ブロックを1行に潰して \n で結合。Translate API は改行を保持するので分割可能
  const lines = blocks.map((b) => b.innerText.trim().replace(/\n+/g, ' '));
  const joined = lines.join('\n');

  try {
    const translated = (await invoke('translate_text', {
      text: joined.slice(0, 8000),
    })) as string;
    const parts = translated.split('\n');

    const count = Math.min(blocks.length, parts.length);
    for (let i = 0; i < count; i++) {
      const block = blocks[i];
      const part = parts[i]?.trim();
      if (!part) continue;
      // DOMPurify 通過済みの元 HTML を保存 (復元用)
      block.setAttribute('data-original-html', block.innerHTML);
      block.setAttribute('data-original-text', block.innerText);
      block.textContent = part;
    }

    body.dataset.translated = 'true';
    if (btn) btn.textContent = t('translate.restoreBtn');
    showToast(t('translate.done'));
  } catch (e) {
    showToast(t('translate.fail', String(e)));
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ─── メニューイベント受信 ───
void listen('menu-action', (ev) => {
  const id = ev.payload as string;
  switch (id) {
    case 'open_dir': void pickAndLoad(); break;
    case 'undo_delete': void undoDelete(); break;
    case 'toggle_sidebar': toggleSidebar(); break;
    case 'quick_switch': palette.open(tree.flatten()); break;
    case 'search':
      if (currentRoot) search.open(currentRoot.path);
      else showToast(t('toast.openDirFirst'));
      break;
    case 'ask_ai':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
      break;
    case 'translate': void translateCurrentDoc(); break;
    case 'reveal_finder':
      if (currentFile) void invoke('reveal_in_finder', { path: currentFile });
      break;
    case 'edit_toggle':
      if (activeEditor) exitEditMode();
      else void enterEditMode();
      break;
  }
});

// ─── アプリ終了時にスクロール位置を保存 ───
window.addEventListener('beforeunload', () => {
  if (currentFile) saveScrollPos(currentFile, docContent.scrollTop);
});

// ─── 起動 ───
initLang();
initTheme();

// HTML 内の静的テキストを i18n 化
filterInput.placeholder = t('filter.placeholder');
(byId('searchInput') as HTMLInputElement).placeholder = t('search.placeholder');
(byId('paletteInput') as HTMLInputElement).placeholder = t('palette.placeholder');
const openBtnLarge = document.getElementById('openBtnLarge');
if (openBtnLarge) openBtnLarge.textContent = t('empty.open');
const emptyHint = document.querySelector('#emptyState .empty-hint');
if (emptyHint) emptyHint.textContent = t('empty.hint');
const dropText = document.querySelector('#dropOverlayInner p');
if (dropText) dropText.textContent = t('drop.text');
document.getElementById('tbSidebar')?.setAttribute('title', t('tb.sidebar'));
document.getElementById('tbSearch')?.setAttribute('title', t('tb.search'));
document.getElementById('tbPalette')?.setAttribute('title', t('tb.palette'));
document.getElementById('tbChanges')?.setAttribute('title', t('tb.changes'));
byId('providerBtn').title = t('provider.title');
byId('themeBtn').title = t('theme.title');

// 言語切替ボタン
const langBtn = byId('langBtn');
langBtn.textContent = getLang() === 'ja' ? 'EN' : 'JA';
langBtn.title = getLang() === 'ja' ? 'Switch to English' : '日本語に切替';
langBtn.addEventListener('click', () => {
  toggleLang();
  location.reload();
});

(async () => {
  try {
    await initProviderMenu();
    const initial = (await invoke('get_initial_path')) as string | null;
    if (initial) {
      await loadRoot(initial);
    } else {
      await renderRecentDirs();
    }
  } catch (e) {
    console.error('init failed:', e);
  }
})();
