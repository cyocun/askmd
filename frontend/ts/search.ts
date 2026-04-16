import { byId, clear, createEl } from './dom';
import { t } from './i18n';

// Cmd+F 全文横断検索。root 配下の .md を横断して行単位でマッチを返す。
// 結果を選ぶと onSelect(hit) が呼ばれ、呼び出し元でファイルを開いて該当箇所に scroll する。
export interface SearchHit {
  path: string;
  line: number;
  snippet: string;
}

export interface Search {
  open(root: string): void;
  close(): void;
  isOpen(): boolean;
}

export function createSearch(
  invokeSearch: (root: string, query: string) => Promise<SearchHit[]>,
  onSelect: (hit: SearchHit, query: string) => void,
): Search {
  const overlay = byId('searchOverlay');
  const input = byId('searchInput') as HTMLInputElement;
  const results = byId('searchResults');
  const status = byId('searchStatus');

  let currentRoot = '';
  let currentQuery = '';
  let hits: SearchHit[] = [];
  let activeIdx = 0;
  // 実行中クエリを世代で管理: 遅延した古いレスポンスが UI を上書きしないように
  let reqSeq = 0;

  const redraw = () => {
    clear(results);
    hits.forEach((h, i) => {
      const name = h.path.split('/').pop() || h.path;
      const shortPath = shortenPath(h.path, currentRoot);
      const item = createEl(
        'div',
        {
          class: 'search-item' + (i === activeIdx ? ' active' : ''),
          onClick: () => {
            pick(i);
          },
        },
        createEl(
          'div',
          { class: 'search-item-head' },
          createEl('span', { class: 'search-item-name' }, name),
          createEl('span', { class: 'search-item-line' }, `:${h.line}`),
          createEl('span', { class: 'search-item-path' }, shortPath),
        ),
        createEl('div', { class: 'search-item-snippet' }, h.snippet),
      );
      results.appendChild(item);
    });
    results.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    close();
    onSelect(hit, currentQuery);
  };

  const runSearch = async () => {
    const q = input.value.trim();
    currentQuery = q;
    if (!q) {
      hits = [];
      activeIdx = 0;
      status.textContent = '';
      redraw();
      return;
    }
    if (q.length < 2) {
      hits = [];
      activeIdx = 0;
      status.textContent = t('search.min');
      redraw();
      return;
    }
    const seq = ++reqSeq;
    status.textContent = t('search.searching');
    try {
      const r = await invokeSearch(currentRoot, q);
      if (seq !== reqSeq) return;
      hits = r;
      activeIdx = 0;
      status.textContent = hits.length === 0 ? t('search.noMatch') : t('search.results', hits.length);
      redraw();
    } catch (e) {
      if (seq !== reqSeq) return;
      hits = [];
      activeIdx = 0;
      status.textContent = t('search.error', String(e));
      redraw();
    }
  };

  const close = () => {
    overlay.hidden = true;
  };

  // デバウンス: 入力のたびに叩かず 180ms 待つ
  let debounceTimer: number | null = null;
  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(runSearch, 180);
  });

  input.addEventListener('keydown', (ev) => {
    const composing = ev.isComposing || ev.keyCode === 229;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIdx = Math.min(hits.length - 1, activeIdx + 1);
      redraw();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      redraw();
    } else if (ev.key === 'Enter' && !composing) {
      ev.preventDefault();
      pick(activeIdx);
    } else if (ev.key === 'Escape' && !composing) {
      close();
    }
  });

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  return {
    open(root) {
      currentRoot = root;
      input.value = '';
      hits = [];
      activeIdx = 0;
      status.textContent = '';
      clear(results);
      overlay.hidden = false;
      input.focus();
    },
    close,
    isOpen: () => !overlay.hidden,
  };
}

function shortenPath(full: string, root: string): string {
  if (root && full.startsWith(root)) {
    return full.slice(root.length).replace(/^\/+/, '');
  }
  // root が無ければ末尾 3 パーツ
  const parts = full.split('/').filter(Boolean);
  return parts.slice(Math.max(0, parts.length - 3)).join(' / ');
}
