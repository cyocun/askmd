import { byId, clear, createEl, insertSanitizedHtml } from './dom';
import { showToast } from './toast';
import { createAsk } from './ask';
import type { AskStreamEvent } from './ask';
import { createAskBridge, highlightQuoteIn } from './ask-bridge';
import { createPalette } from './palette';
import { createSearch } from './search';
import { createFindInFile } from './find-in-file';
import type { SearchHit } from './search';
import { createFileOps } from './file-ops';
import { installGlobalKeymap } from './keymap';
import { isBlockEditorOpen, setBlockEditorOnSaved } from './block-editor';
import { closeTranslatePopover } from './translate-popover';
import { openListOverlay, relativeFromRoot } from './list-overlay';
import { createTreeView } from './tree';
import { createTabs } from './tabs';
import { addCopyButtons, extractTitle, parseFrontmatter, processAdmonitions, render, renderMermaidBlocks } from './renderer';
import { renderThumbnailGrid } from './thumbnail';
import { currentTheme, initTheme } from './theme';
import { initFontScale } from './font-scale';
import { initLang, getLang, toggleLang, t } from './i18n';
import { scheduleMarkViewed } from './last-viewed';
import type { OutlineItem, TreeNode } from './types';
import { state } from './state';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
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
  icon?: string | null;
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+\//, '~/');
}

// ─── スクロール位置永続化 ───
function scrollKey(filePath: string): string {
  const rel = state.currentRoot && filePath.startsWith(state.currentRoot.path)
    ? filePath.slice(state.currentRoot.path.length)
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

// ─── DOM 参照 ───
const leftPane = byId('leftPane');
const treeContainer = byId('treeContainer');
const rootLabel = byId('rootLabel');
const docHeader = byId('docHeader');
const docContent = byId('docContent');
const commentsPane = byId('commentsPane');
const filterInput = byId('filterInput') as HTMLInputElement;
const dropOverlay = byId('dropOverlay');
const providerBtn = byId('providerBtn') as HTMLButtonElement;
const providerMenu = byId('providerMenu');

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
  cancelStream: async (requestId) => {
    await invoke('cancel_ask', { requestId });
  },
  subscribe: (h) => {
    askSubscribers.add(h);
    return () => {
      askSubscribers.delete(h);
    };
  },
  getProviderName: () => state.activeProviderName,
  renderMarkdown: (md) => render(md),
  postProcessContent: (container) => addCopyButtons(container),
  commentsPane,
  highlightQuote: (quote, onClick) => highlightQuoteIn(docContent, quote, onClick),
});

// ─── Ask UI 配線 (選択バー / 右下ボタン / ask ヘルパ) ───
const askBridge = createAskBridge({ ask, docContent });

// ─── ファイル操作 (ツリー右クリック / D&D / 削除 Undo) ───
const fileOps = createFileOps({
  openFile: (path) => openFile(path),
  refreshTree: () => refreshTree(),
  treeSetActive: (path) => tree.setActive(path),
  showEmptyState: () => {
    disposeThumbGrid();
    clear(docHeader);
    clear(docContent);
    docContent.classList.remove('thumb-grid-host');
    docContent.dataset.path = '';
    ask.syncForFile(null);
    docContent.appendChild(createEl(
      'div',
      { id: 'emptyState' },
      createEl('h1', {}, 'askmd'),
      createEl('p', { class: 'empty-sub' }, t('empty.selectFile')),
    ));
  },
  updateFileAskBtn: () => askBridge.updateFileAskBtn(),
});

// ─── ツリー ───
const tree = createTreeView(treeContainer, {
  onOpen: (node) => {
    void openFile(node.path);
  },
  onDelete: (node) => {
    void fileOps.deleteMd(node.path);
  },
  onJumpHeading: (anchorId) => {
    scrollToHeadingId(anchorId);
  },
  onContextMenu: (node, ev) => {
    fileOps.handleTreeContextMenu(node, ev);
  },
  onMoveFile: (src, dstDir) => {
    void fileOps.moveFileTo(src.path, dstDir.path);
  },
});

// 矢印キー移動後のプレビュー (150ms デバウンスで連打時の I/O を抑える)
let previewTimer: number | null = null;
function schedulePreview(): void {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    const n = tree.getSelectedNode();
    if (n && n.path !== state.currentFile) void openFile(n.path);
  }, 150);
}

async function refreshTree(): Promise<void> {
  if (!state.currentRoot) return;
  const fresh = (await invoke('scan_markdown_tree', {
    root: state.currentRoot.path,
  })) as TreeNode | null;
  if (!fresh) return;
  state.currentRoot.tree = fresh;
  tree.render(fresh, state.currentRoot.path);
  if (state.currentFile) tree.setActive(state.currentFile);
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

// ─── 全文横断検索 (Cmd+Shift+F) ───
const search = createSearch(
  async (root, query) =>
    (await invoke('search_markdown', { root, query })) as SearchHit[],
  (hit, query) => {
    void openFile(hit.path, { scrollQuery: query, scrollLine: hit.line });
  },
);

// ─── ファイル内検索 (Cmd+F) ───
const findInFile = createFindInFile({ docContent });

// 大量の md を回遊するのが主用途なので、キャッシュは上限付きで持つ。
// domCache は detached DOM (重い) なので小さめ、cache は HTML 文字列なので多め。
const CACHE_LIMIT = 80;
const DOM_CACHE_LIMIT = 12;
function setBounded<V>(map: Map<string, V>, key: string, value: V, limit: number): void {
  // LRU 風: 既存キーは入れ直して最新扱いにし、溢れたら最古を捨てる
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

// ─── ファイルを開く ───
interface OpenOptions {
  // 開いたあと本文内を textContent ベースで検索して scroll + 一時ハイライト
  scrollQuery?: string;
  // 検索ヒットのファイル行番号 (1-based)。data-lines で該当ブロックを特定して
  // 同語の別出現ではなくヒット行付近へ正確にジャンプするために使う
  scrollLine?: number;
  // localStorage の保存済みスクロール位置を復元しない (呼び出し側が位置を制御する時)
  skipSavedScroll?: boolean;
}
async function openFile(path: string, options?: OpenOptions): Promise<void> {
  state.currentFile = path;
  tree.setActive(path);
  tabs.updateActive({ currentFile: path });
  // 一定時間開いていたら既読化してドットを消す (途中で切り替えたらキャンセル)
  scheduleMarkViewed(path, (p) => tree.refreshUpdatedDot(p));

  // 検索ジャンプ時は保存済みスクロール位置の復元と競合する (rAF が後から
  // 上書きしてジャンプ先に届かない) ので復元を抑止する
  const skipSavedScroll = !!options?.skipSavedScroll || !!options?.scrollQuery;

  // 検索ヒットのファイル行番号 → body 行番号 (0-based)。frontmatter 行数を引く。
  const bodyLineOf = (fmLines: number): number | undefined => {
    if (options?.scrollLine == null) return undefined;
    const l = options.scrollLine - 1 - fmLines;
    return l >= 0 ? l : undefined;
  };

  const cached = state.cache.get(path);
  if (cached) {
    // 表示中のファイルが evict されないよう recency を更新
    setBounded(state.cache, path, cached, CACHE_LIMIT);
    renderDoc(path, cached.title, cached.rendered, cached.fmHtml, skipSavedScroll);
    if (options?.scrollQuery) scrollToQuery(options.scrollQuery, bodyLineOf(cached.fmLines));
    askBridge.updateFileAskBtn();
    return;
  }
  try {
    const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
    const fm = parseFrontmatter(result.content);
    const filename = path.split('/').pop() || path;
    const title = extractTitle(fm.body, fm, filename);
    const rendered = render(fm.body);
    const fmHtml = buildFmHeader(fm, title, path, result.modified);
    // body は content の末尾部分なので、差分の改行数 = frontmatter の行数
    const fmLines = result.content.length > fm.body.length
      ? result.content.slice(0, result.content.length - fm.body.length).split('\n').length - 1
      : 0;
    setBounded(state.cache, path, { rendered, title, fmHtml, rawBody: fm.body, fmLines }, CACHE_LIMIT);
    renderDoc(path, title, rendered, fmHtml, skipSavedScroll);
    if (options?.scrollQuery) scrollToQuery(options.scrollQuery, bodyLineOf(fmLines));
    askBridge.updateFileAskBtn();
  } catch (e) {
    showToast(t('toast.readFail', String(e)));
  }
}

// 描画後の docContent 内で query の出現へスクロール + 一時ハイライト。
// bodyLine (0-based、frontmatter 除外後) があれば data-lines でヒット行を含む
// block を特定し、そのスコープ内を優先して探す。これで同語の別出現に飛ばない。
// block 内でクエリが見つからない場合 (記法でテキストノードが分断、ソース記法に
// マッチした等) でも block 自体へスクロールするので「無反応」にならない。
function scrollToQuery(query: string, bodyLine?: number): void {
  const q = query.trim();
  if (!q) return;
  const body = docContent.querySelector('.md-body') as HTMLElement | null;
  if (!body) return;

  const scrollAndFlash = (rect: DOMRect) => {
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
  };

  // ヒット行を含む block (一番内側に当たったもの) をスコープにする
  let scope: HTMLElement = body;
  if (bodyLine != null) {
    body.querySelectorAll<HTMLElement>('[data-lines]').forEach((el) => {
      const [s, e] = (el.getAttribute('data-lines') || '').split(',').map(Number);
      if (!Number.isNaN(s) && !Number.isNaN(e) && bodyLine >= s && bodyLine < e) {
        scope = el; // querySelectorAll は文書順なのでネストした内側が後勝ち
      }
    });
  }

  const findIn = (root: HTMLElement): Range | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const qLower = q.toLowerCase();
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node as Text).textContent || '';
      const idx = text.toLowerCase().indexOf(qLower);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        // toLowerCase で長さが変わる Unicode があるため node 長でクランプ
        range.setEnd(node, Math.min(text.length, idx + q.length));
        return range;
      }
      node = walker.nextNode();
    }
    return null;
  };

  const range = findIn(scope);
  if (range) {
    scrollAndFlash(range.getBoundingClientRect());
  } else if (scope !== body) {
    // block 内でクエリ不一致 (記法分断 / ソース記法へのマッチ) → block ごと示す
    scrollAndFlash(scope.getBoundingClientRect());
  }
  // scope が body 全体で不一致なら何もしない (従来挙動)
}

function relativePath(absPath: string): string {
  if (state.currentRoot && absPath.startsWith(state.currentRoot.path)) {
    return absPath.slice(state.currentRoot.path.length).replace(/^\/+/, '');
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
  infoRow.appendChild(actions);

  container.appendChild(infoRow);
  return container;
}

// 現在表示中の DOM をキャッシュに退避
function saveDomSnapshot(): void {
  const prevPath = docContent.dataset.path || '';
  if (!prevPath) return;
  saveScrollPos(prevPath, docContent.scrollTop);
  // 引用ハイライト overlay はスナップショットに含めない (復元時に stale で残るため)。
  // 表示し直す際は ask.syncForFile が貼り直す。
  docContent.querySelectorAll('.ask-highlight').forEach((el) => el.remove());
  const headerFrag = document.createDocumentFragment();
  while (docHeader.firstChild) headerFrag.appendChild(docHeader.firstChild);
  const bodyFrag = document.createDocumentFragment();
  while (docContent.firstChild) bodyFrag.appendChild(docContent.firstChild);
  const wrapper = createEl('div');
  wrapper.appendChild(bodyFrag);
  setBounded(state.domCache, prevPath, {
    header: headerFrag,
    body: wrapper,
    scrollTop: docContent.scrollTop,
  }, DOM_CACHE_LIMIT);
}

// キャッシュから DOM を復元。成功したら true。
function restoreDomSnapshot(path: string): boolean {
  const snap = state.domCache.get(path);
  if (!snap) return false;
  state.domCache.delete(path);
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
  skipSavedScroll = false,
): void {
  const prevPath = docContent.dataset.path || '';
  // ファイル切替 or 再レンダで find ハイライトを撤去 (バーは閉じる)
  findInFile.close();
  // 選択翻訳ポップオーバーは旧本文の Range を握っているので一緒に閉じる
  closeTranslatePopover();
  // サムネ表示からの切替に備え、先にクラスを剥がす (cached restore 経路もカバー)
  docContent.classList.remove('thumb-grid-host');
  disposeThumbGrid();

  // 別ファイルへの切替時のみ現在の DOM を退避。
  // 同一ファイルの再レンダリング (fs-changed 後) では旧 DOM を保存しない —
  // 保存すると直後の restoreDomSnapshot で古い内容が復元されてしまう。
  if (prevPath && prevPath !== path) {
    saveDomSnapshot();
  }

  // キャッシュに DOM があればそちらを復元
  if (restoreDomSnapshot(path)) {
    // 復元した本文に対し、このファイルのコメントと引用ハイライトを貼り直す
    ask.syncForFile(path);
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
  if (!skipSavedScroll) {
    const savedScroll = loadScrollPos(path);
    if (savedScroll != null && savedScroll > 0) {
      requestAnimationFrame(() => { docContent.scrollTop = savedScroll; });
    }
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

  // このファイルのコメントカードを出し、引用ハイライトを新しい本文に貼り直す
  ask.syncForFile(path);
}

// ─── サムネイル一覧 (ルートあり・ファイル未選択のときの右カラム) ───
// サムネ grid が持つ Observer を、別ビューへ切り替える時に disconnect する。
let cleanupThumbGrid: (() => void) | null = null;
function disposeThumbGrid(): void {
  cleanupThumbGrid?.();
  cleanupThumbGrid = null;
}

async function showThumbnailGrid(): Promise<void> {
  if (!state.currentRoot) return;
  disposeThumbGrid();
  state.currentFile = null;
  clear(docHeader);
  docHeader.classList.add('empty');
  clear(docContent);
  docContent.classList.remove('thumb-grid-host'); // いったん剥がして再付与
  docContent.dataset.path = '';
  docContent.scrollTop = 0;
  // ファイル未選択ではコメント列を畳む
  ask.syncForFile(null);
  cleanupThumbGrid = await renderThumbnailGrid(docContent, state.currentRoot.path, (p) => {
    void openFile(p);
    tree.setActive(p);
  });
  askBridge.updateFileAskBtn();
}

// ─── ディレクトリ読み込み ───
async function loadRoot(path: string, opts?: { skipTabUpdate?: boolean }): Promise<void> {
  try {
    const node = (await invoke('scan_markdown_tree', { root: path })) as TreeNode | null;
    if (!node) {
      showToast(t('toast.noMd'));
      return;
    }
    state.currentRoot = { path, tree: node };
    rootLabel.textContent = node.name;
    rootLabel.title = path;
    // 前のフォルダで使った @ 絞り込みが残ると新しいツリーが空に見える
    if (filterInput.value) {
      filterInput.value = '';
      tree.applyFilter('');
    }
    try { await getCurrentWebviewWindow().setTitle(node.name || 'askmd'); } catch {}
    // タブ側のラベル / rootPath を同期。skipTabUpdate=true はタブ切替中の
    // 無限ループ防止で付与される (onSwitchTo → loadRoot → updateActive → render...)
    if (!opts?.skipTabUpdate) {
      tabs.updateActive({ rootPath: path, label: node.name, currentFile: null });
    }
    tree.render(node, path);
    // 最近開いたディレクトリに追加
    void invoke('add_recent_dir', { path });
    try {
      await invoke('start_watch', { path });
    } catch (e) {
      console.warn('start_watch failed:', e);
    }
    // タブ切替経由 (skipTabUpdate=true) の場合は onSwitchTo 側が描画を決めるので呼ばない。
    // 通常の loadRoot (フォルダドロップ/CLI/最近開いた) は未選択状態でサムネ一覧を出す。
    if (!opts?.skipTabUpdate && !state.currentFile) {
      await showThumbnailGrid();
    }
  } catch (e) {
    showToast(t('toast.scanFail', String(e)));
  }
}

// ─── 最近更新したメモ一覧パネル (mtime 降順) ───
interface RecentFileInfo {
  path: string;
  name: string;
  title: string | null;
  modified: number;
}

function formatRelativeTime(epochSecs: number): string {
  const now = Date.now() / 1000;
  const diff = now - epochSecs;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 日前`;
  const d = new Date(epochSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function showRecentFiles(): Promise<void> {
  if (!state.currentRoot) {
    showToast(t('toast.openDirFirst'));
    return;
  }
  const root = state.currentRoot.path;
  try {
    const recent = (await invoke('get_recent_files', { root, limit: 30 })) as RecentFileInfo[];
    if (!recent.length) {
      showToast(t('recent.none'));
      return;
    }
    openListOverlay(t('recent.title'), recent.map((file) => ({
      primary: file.title || file.name,
      secondary: relativeFromRoot(file.path, root),
      meta: formatRelativeTime(file.modified),
      onSelect: () => {
        void openFile(file.path);
        tree.setActive(file.path);
      },
    })));
  } catch {
    showToast(t('recent.fail'));
  }
}

async function pickAndLoad(): Promise<void> {
  const picked = (await invoke('pick_directory')) as string | null;
  if (picked) await loadRoot(picked);
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
  if (state.currentRoot) search.open(state.currentRoot.path);
  else showToast(t('toast.openDirFirst'));
});
document.getElementById('tbPalette')?.addEventListener('click', () => {
  palette.open(tree.flatten());
});
document.getElementById('tbRecent')?.addEventListener('click', () => {
  void showRecentFiles();
});
document.getElementById('tbTerminal')?.addEventListener('click', () => {
  if (!state.currentRoot) {
    showToast(t('toast.openDirFirst'));
    return;
  }
  invoke('open_in_terminal', { path: state.currentRoot.path }).catch((e) => {
    showToast(t('toast.terminalFail', String(e)));
  });
});

// ─── フォルダ / md ファイル D&D / 外部オープン ───
// 1. 現在のタブが空 (root 無し): そのタブにロードする
// 2. .md 直投下で親ディレクトリが現在の root と同じ: その場でファイルを開く
// 3. それ以外 (別ディレクトリ / 別 root の .md): 新規タブを生成してそこにロード
async function handleExternalOpen(paths: string[]): Promise<void> {
  if (!paths || paths.length === 0) return;
  const first = paths[0];
  const isMd = /\.md$/i.test(first);
  const parent = (() => {
    const slash = Math.max(first.lastIndexOf('/'), first.lastIndexOf('\\'));
    return slash > 0 ? first.slice(0, slash) : null;
  })();
  const targetRoot = isMd ? parent : first;

  if (!state.currentRoot) {
    if (isMd && parent) {
      await loadRoot(parent);
      await openFile(first);
    } else {
      await loadRoot(first);
    }
    return;
  }

  if (targetRoot && targetRoot === state.currentRoot.path) {
    if (isMd) await openFile(first);
    return;
  }

  // 別ルート: 新しいタブを開く
  await tabs.addAndActivate(null, '新規');
  if (isMd && parent) {
    await loadRoot(parent);
    await openFile(first);
  } else if (targetRoot) {
    await loadRoot(targetRoot);
  }
}

void listen('tauri://drag-enter', () => {
  dropOverlay.hidden = false;
});
void listen('tauri://drag-leave', () => {
  dropOverlay.hidden = true;
});
void listen('tauri://drag-drop', async (ev) => {
  dropOverlay.hidden = true;
  const paths = (ev.payload as { paths?: string[] } | undefined)?.paths;
  await handleExternalOpen(paths ?? []);
});
// macOS: Dock アイコンへのドロップや Finder "Open With" からのファイル受領。
// Rust 側が main 窓にだけ emit するので、このリスナは全窓で付けて OK (発火するのは main のみ)。
void listen<string[]>('askmd://external-open', async (ev) => {
  await handleExternalOpen(ev.payload ?? []);
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
installGlobalKeymap({
  ask, askBridge, palette, search, findInFile, tree, fileOps,
  filterInput, leftPane, treeContainer, docContent,
  toggleSidebar,
  pickAndLoad,
  translateCurrentDoc,
  schedulePreview,
  openFile,
  switchTabByIndex: (idx) => { void tabs.switchByIndex(idx); },
  switchTabRelative: (delta) => { void tabs.switchRelative(delta); },
});

// 選択状態の変化を askBridge に橋渡し
docContent.addEventListener('mouseup', () => {
  // mouseup 直後は selection がまだ確定していないので 1 フレーム待つ
  requestAnimationFrame(() => askBridge.onSelectionChanged());
});
document.addEventListener('selectionchange', () => askBridge.onSelectionCleared());

// ─── ファイル変更監視 ───

// currentFile を読み直して再描画 (スクロール位置は維持)
async function reloadCurrentFile(): Promise<void> {
  if (!state.currentFile) return;
  const scrollTop = docContent.scrollTop;
  state.cache.delete(state.currentFile);
  state.domCache.delete(state.currentFile);
  // skipSavedScroll: localStorage の保存位置を rAF で復元されると、下の代入が
  // 先に走ったあと上書きされて今の読書位置からズレる
  await openFile(state.currentFile, { skipSavedScroll: true });
  docContent.scrollTop = scrollTop;
}

// 部分編集の保存後は開いているファイルを再描画 (キャッシュは block-editor 側で無効化済み)
setBlockEditorOnSaved(() => void reloadCurrentFile());

// 引用ハイライトは描画時の px 座標で固定されるため、本文が回り込むとズレる。
// docContent のサイズ変化 (ウィンドウリサイズ / コメント列の開閉 / サイドバー開閉 /
// フォントサイズ変更) を ResizeObserver で拾い、rAF スロットルで貼り直す。
let reanchorScheduled = false;
const docResizeObserver = new ResizeObserver(() => {
  if (reanchorScheduled) return;
  reanchorScheduled = true;
  requestAnimationFrame(() => {
    reanchorScheduled = false;
    ask.reanchorHighlights();
  });
});
docResizeObserver.observe(docContent);

void listen('fs-changed', async (ev) => {
  const paths = ev.payload as string[];
  for (const p of paths) {
    state.cache.delete(p);
    state.domCache.delete(p);
  }
  // mini editor で編集中は本文を再構築しない。editor が持つ offset range が
  // 古い本文を指したまま ⌘S すると外部変更を巻き戻して上書きしてしまう。
  if (state.currentFile && paths.includes(state.currentFile) && !isBlockEditorOpen()) {
    await reloadCurrentFile();
  }
  await refreshTree();
});

// FSEvents が環境によって発火しない場合 (一部の同期フォルダ/ネットワーク FS、
// エディタの保存方式等) の保険。askmd にフォーカスが戻ったら、開いているファイルを
// mtime ではなく本文比較で再チェックし、変わっていれば再描画する。ツリーも再スキャン。
let refreshing = false;
async function refreshFromDisk(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    if (state.currentFile && !isBlockEditorOpen()) {
      const result = (await invoke('read_markdown', { path: state.currentFile })) as { content: string; modified: number | null };
      const fm = parseFrontmatter(result.content);
      const cached = state.cache.get(state.currentFile);
      // 本文が変わっていれば再描画 (frontmatter のみの変更は読書に影響しないので無視)
      if (!cached || cached.rawBody !== fm.body) await reloadCurrentFile();
    }
    await refreshTree();
  } catch {
    // 読めない (削除/リネーム途中等) は次の機会に任せる
  } finally {
    refreshing = false;
  }
}
window.addEventListener('focus', () => void refreshFromDisk());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshFromDisk();
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
    // 開発用: CLI が通っていても web 橋渡し (CLI 不在時の体験) を確認するための強制 off。
    // devtools で localStorage.setItem('askmd-no-cli','1') → リロード。解除は removeItem。
    const forceNoCli = (() => {
      try { return localStorage.getItem('askmd-no-cli') === '1'; } catch { return false; }
    })();
    const anyAvailable = !forceNoCli && providers.some((p) => p.available);
    state.aiAvailable = anyAvailable;

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
      state.activeProviderName = active.name;
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
    state.activeProviderName = name;
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
    // 再呼出しで重複しないよう heading と list の両方を除去してから追加し直す
    emptyState.querySelectorAll('.recent-heading, .recent-list').forEach((el) => el.remove());

    const heading = createEl('div', { class: 'recent-heading' }, t('empty.recent'));
    emptyState.appendChild(heading);
    const ul = createEl('ul', { class: 'recent-list' });
    for (const dir of recent) {
      const icon = dir.icon
        ? createEl('img', { class: 'recent-item-icon', src: dir.icon, alt: '' })
        : createEl(
            'span',
            { class: 'recent-item-icon recent-item-icon-placeholder' },
            (dir.name.charAt(0) || '?').toUpperCase(),
          );
      const text = createEl(
        'div',
        { class: 'recent-item-text' },
        createEl('span', { class: 'recent-item-name' }, dir.name),
        createEl('span', { class: 'recent-item-path' }, shortPath(dir.path)),
      );
      const btn = createEl(
        'button',
        {
          class: 'recent-item',
          onClick: () => void loadRoot(dir.path),
        },
        icon,
        text,
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
  // hidden のままだと offsetHeight が 0 になり上方向表示の位置計算が壊れる。
  // 一旦不可視で実寸を測ってから位置を確定する。
  translateTooltip.style.visibility = 'hidden';
  translateTooltip.hidden = false;
  const rect = target.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left;
  if (top + translateTooltip.offsetHeight > window.innerHeight - 8) {
    top = rect.top - translateTooltip.offsetHeight - 6;
  }
  if (left + 420 > window.innerWidth) left = window.innerWidth - 420 - 8;
  if (left < 8) left = 8;
  translateTooltip.style.top = `${top}px`;
  translateTooltip.style.left = `${left}px`;
  translateTooltip.style.visibility = '';
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

  // 非公式 API は一度に送れる量に限りがあるため、行単位で ~6000 字ずつに
  // 分割して順次リクエストする (以前は 8000 字で切り捨てて後半が未翻訳だった)
  const CHUNK_LIMIT = 6000;
  const chunks: string[] = [];
  {
    let cur: string[] = [];
    let curLen = 0;
    for (const raw of lines) {
      const line = raw.length > CHUNK_LIMIT ? raw.slice(0, CHUNK_LIMIT) : raw;
      if (cur.length && curLen + line.length + 1 > CHUNK_LIMIT) {
        chunks.push(cur.join('\n'));
        cur = [];
        curLen = 0;
      }
      cur.push(line);
      curLen += line.length + 1;
    }
    if (cur.length) chunks.push(cur.join('\n'));
  }

  try {
    const parts: string[] = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      if (btn && chunks.length > 1) {
        btn.textContent = `${t('translate.loading')} ${ci + 1}/${chunks.length}`;
      }
      const translated = (await invoke('translate_text', { text: chunks[ci] })) as string;
      parts.push(...translated.split('\n'));
    }

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
    case 'undo_delete': void fileOps.undoDelete(); break;
    case 'toggle_sidebar': toggleSidebar(); break;
    case 'quick_switch': palette.open(tree.flatten()); break;
    case 'new_tab': void tabs.addAndActivate(null, '新規'); break;
    case 'close_tab': void tabs.closeActive(); break;
    case 'search':
      if (state.currentRoot) search.open(state.currentRoot.path);
      else showToast(t('toast.openDirFirst'));
      break;
    case 'ask_ai':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
      break;
    case 'translate': void translateCurrentDoc(); break;
    case 'reveal_finder':
      if (state.currentFile) void invoke('reveal_in_finder', { path: state.currentFile });
      break;
  }
});

// ─── アプリ終了時にスクロール位置を保存 ───
window.addEventListener('beforeunload', () => {
  if (state.currentFile) saveScrollPos(state.currentFile, docContent.scrollTop);
});

// ─── HTML タブ ───
// native tab は使わず (styling 困難 + cross platform 不揃い)、アプリ内で
// タブバーを描画する。1 タブ = 1 ルート (フォルダ)、切替時に loadRoot / openFile を再実行。
const tabs = createTabs(byId('tabBar'), {
  onSwitchTo: async (target, prev) => {
    // 切替前のタブに現在の状態を書き戻す
    if (prev) {
      prev.currentFile = state.currentFile;
    }
    // 切替先の状態を復元
    if (target.rootPath) {
      if (!state.currentRoot || state.currentRoot.path !== target.rootPath) {
        await loadRoot(target.rootPath, { skipTabUpdate: true });
      }
      if (target.currentFile) {
        await openFile(target.currentFile);
      } else {
        // root のみ: サムネイル一覧を出す
        await showThumbnailGrid();
      }
    } else {
      // 空タブ: ルート未選択
      state.currentRoot = null;
      state.currentFile = null;
      rootLabel.textContent = '';
      tree.render(null, null);
      resetDocToEmpty();
      void renderRecentDirs();
    }
  },
  onAddTab: () => {
    void tabs.addAndActivate(null, '新規');
  },
  onLastTabClose: () => {
    void getCurrentWebviewWindow().close();
  },
});

function resetDocToEmpty(): void {
  disposeThumbGrid();
  clear(docHeader);
  docHeader.classList.remove('empty');
  clear(docContent);
  docContent.classList.remove('thumb-grid-host');
  docContent.appendChild(createEl(
    'div',
    { id: 'emptyState' },
    createEl('button', {
      id: 'openBtnLarge',
      class: 'btn-primary btn-large',
      onClick: () => void pickAndLoad(),
    }, t('empty.open')),
    createEl('p', { class: 'empty-hint' }, t('empty.hint')),
  ));
  docContent.dataset.path = '';
  askBridge.updateFileAskBtn();
}

// ─── 起動 ───
initLang();
initTheme(() => {
  // mermaid は描画済み SVG が旧配色のまま残るため、DOM スナップショットを捨てて
  // 現在のファイルを描き直す (cache は mermaid ソースを保持しているので再 run で新配色)。
  state.domCache.clear();
  void reloadCurrentFile();
});
initFontScale();

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
document.getElementById('tbRecent')?.setAttribute('title', t('recent.title'));
document.getElementById('tbTerminal')?.setAttribute('title', t('tb.terminal'));
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
    askBridge.updateFileAskBtn();
    // 最初のタブを空状態で作る。loadRoot の updateActive がここに rootPath / label を埋める。
    tabs.add(null, '新規');
    // activeId をセットするため render は既に走ってるが、切替ロジックを介さず activeId を
    // 最初のタブに向ける必要がある。最初の 1 枚だけ直接 switchTo を呼ぶ。
    await tabs.switchTo(tabs.list()[0].id);

    const initial = (await invoke('get_initial_path')) as string | null;
    if (initial) {
      await loadRoot(initial);
      // CLI 引数が .md ファイルだった場合、loadRoot 後にそのファイルを開く
      const initialFile = (await invoke('get_initial_file')) as string | null;
      if (initialFile) await openFile(initialFile);
    } else {
      await renderRecentDirs();
    }
    // Dock/Finder からの "Open With" がリスナ登録前に届いていた場合に備えてドレイン。
    // PendingOpens はプロセス全体で 1 つなので main 窓だけが取り出す (二重オープン防止)。
    if (getCurrentWebviewWindow().label === 'main') {
      const pending = (await invoke('take_pending_opens')) as string[];
      if (pending.length > 0) await handleExternalOpen(pending);
    }
  } catch (e) {
    console.error('init failed:', e);
  }
})();
