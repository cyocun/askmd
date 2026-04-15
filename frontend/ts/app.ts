import { byId, clear, createEl } from './dom.js';
import { createAsk } from './ask.js';
import { createPalette } from './palette.js';
import { createTreeView } from './tree.js';
import { extractTitle, parseFrontmatter, render } from './renderer.js';
import type { TreeNode } from './types.js';

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

const treeContainer = byId('treeContainer');
const rootLabel = byId('rootLabel');
const docHeader = byId('docHeader');
const docContent = byId('docContent');
const openBtn = byId('openBtn') as HTMLButtonElement;
const filterInput = byId('filterInput') as HTMLInputElement;
const toast = byId('toast');

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

// ─── Claude CLI 呼び出し ───
const ask = createAsk(async (prompt) => invoke('ask_claude', { prompt }));

// ─── ツリー ───
const tree = createTreeView(treeContainer, (node) => {
  void openFile(node.path);
});

// ─── パレット (Cmd+P) ───
const palette = createPalette((node) => {
  void openFile(node.path);
  tree.setActive(node.path);
});

// ─── ファイルを開く ───
async function openFile(path: string): Promise<void> {
  currentFile = path;
  tree.setActive(path);

  const cached = cache.get(path);
  if (cached) {
    renderDoc(path, cached.title, cached.rendered, cached.fmHtml);
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
  } catch (e) {
    showToast(`読み込み失敗: ${String(e)}`);
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

filterInput.addEventListener('input', () => {
  tree.applyFilter(filterInput.value);
});
filterInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    filterInput.value = '';
    tree.applyFilter('');
    filterInput.blur();
  } else if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    tree.moveSelection(1);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    tree.moveSelection(-1);
  } else if (ev.key === 'Enter') {
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
  if (meta && ev.key.toLowerCase() === 'l') {
    ev.preventDefault();
    const sel = window.getSelection()?.toString() || '';
    if (!sel.trim()) {
      showToast('質問するテキストを本文中で選択してください');
      return;
    }
    const filename = currentFile?.split('/').pop() || '';
    ask.open(sel, {
      title: filename.replace(/\.md$/i, ''),
      path: currentFile || '',
    });
    return;
  }
  if (ev.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    ev.preventDefault();
    filterInput.focus();
    filterInput.select();
    return;
  }
  if (ev.key === 'Escape') {
    if (palette.isOpen()) palette.close();
    else if (ask.isOpen()) ask.close();
    return;
  }
  const inInput = ['INPUT', 'TEXTAREA'].includes(
    document.activeElement?.tagName || '',
  );
  if (inInput) return;

  if (ev.key === 'ArrowDown' || ev.key === 'j') {
    ev.preventDefault();
    tree.moveSelection(1);
  } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
    ev.preventDefault();
    tree.moveSelection(-1);
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
