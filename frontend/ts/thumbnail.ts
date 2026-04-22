// サムネイル一覧: ルートを開いた直後で本文が未選択のとき右カラムに並ぶ
// 「紙面の縮小プレビュー」。本文テキストは灰色バーに置き換え、見出し/画像/
// 表/コード枠は構造として描画する。mermaid/KaTeX/highlight は通さないので速い。
//
// IntersectionObserver で可視カードだけ hydrate する (read_markdown を都度発火)。
// 1 ルート 200 件で動かしても初期表示は可視領域の数枚のみ。
import MarkdownIt from 'markdown-it';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createEl } from './dom';
import { parseFrontmatter } from './renderer';
import { t } from './i18n';

interface RecentFile {
  path: string;
  name: string;
  title: string | null;
  modified: number;
}

interface MarkdownFile {
  content: string;
  modified: number | null;
}

const thumbMd = MarkdownIt({ html: false, breaks: true, linkify: false });

function formatRelativeTime(epochSecs: number): string {
  const now = Date.now() / 1000;
  const diff = now - epochSecs;
  if (diff < 60) return t('thumb.justNow');
  if (diff < 3600) return t('thumb.minutesAgo', Math.floor(diff / 60));
  if (diff < 86400) return t('thumb.hoursAgo', Math.floor(diff / 3600));
  if (diff < 86400 * 7) return t('thumb.daysAgo', Math.floor(diff / 86400));
  const d = new Date(epochSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function resolveImgSrc(src: string, fileDir: string): string {
  if (!src) return '';
  if (/^(https?:|data:|blob:|asset:)/.test(src)) return src;
  const absolute = src.startsWith('/') ? src : `${fileDir}/${src}`;
  try { return convertFileSrc(absolute, 'asset'); } catch { return ''; }
}

// 同じ seed でカードを再描画しても幅が変わらないよう、path をキーに pseudo-random
function seededRand(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// markdown-it の token stream を舐めて軽量 DOM を構築
function buildThumbnailCanvas(body: string, fileDir: string, seedKey: string): HTMLElement {
  const canvas = createEl('div', { class: 'thumb-canvas' });
  const tokens = thumbMd.parse(body, {});
  let listDepth = 0;
  let barCounter = 0;
  const randWidth = (min: number, max: number): number => {
    const r = seededRand(seedKey, barCounter++);
    return Math.round(min + r * (max - min));
  };

  const appendParagraphBars = (text: string) => {
    // 文字数から行数を推定 (1 行 ~40 文字、最大 8 行まで表示)
    const textLen = text.length;
    if (textLen === 0) return;
    const lines = Math.max(1, Math.min(8, Math.ceil(textLen / 40)));
    const para = createEl('div', { class: 'th-para' });
    for (let li = 0; li < lines; li++) {
      const bar = createEl('div', { class: 'th-bar' });
      const isLast = li === lines - 1;
      const w = isLast ? randWidth(35, 75) : randWidth(90, 100);
      bar.style.width = `${w}%`;
      para.appendChild(bar);
    }
    canvas.appendChild(para);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (tk.type === 'heading_open') {
      const lvl = Math.max(1, Math.min(6, parseInt(tk.tag.slice(1), 10)));
      const inline = tokens[i + 1];
      const text = inline?.content?.trim() || '';
      if (text) {
        canvas.appendChild(
          createEl('div', { class: `th-heading th-h${lvl}` }, text.slice(0, 90)),
        );
      }
      while (i < tokens.length && tokens[i].type !== 'heading_close') i++;
      continue;
    }

    if (tk.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      if (inline && inline.type === 'inline') {
        // 画像トークンを抽出して実描画
        const images = (inline.children || []).filter((c: any) => c.type === 'image');
        if (images.length > 0) {
          const imgRow = createEl('div', { class: 'th-img-row' });
          for (const img of images) {
            const src = img.attrGet ? img.attrGet('src') : '';
            if (!src) continue;
            const resolved = resolveImgSrc(src, fileDir);
            const imgEl = document.createElement('img');
            imgEl.className = 'th-img';
            imgEl.loading = 'lazy';
            imgEl.src = resolved;
            imgEl.onerror = () => imgEl.remove();
            imgRow.appendChild(imgEl);
          }
          if (imgRow.children.length > 0) canvas.appendChild(imgRow);
        }
        // 画像以外のテキスト部分を行バーに
        const textOnly = (inline.children || [])
          .filter((c: any) => c.type !== 'image')
          .map((c: any) => c.content || '')
          .join('');
        appendParagraphBars(textOnly.trim());
      }
      while (i < tokens.length && tokens[i].type !== 'paragraph_close') i++;
      continue;
    }

    if (tk.type === 'fence' || tk.type === 'code_block') {
      const code = createEl('div', { class: 'th-code' });
      const lines = (tk.content || '').split('\n').slice(0, 8);
      for (const line of lines) {
        if (!line.trim()) {
          code.appendChild(createEl('div', { class: 'th-code-line th-code-line-empty' }));
          continue;
        }
        const w = Math.min(100, Math.max(20, line.length * 1.6));
        const cl = createEl('div', { class: 'th-code-line' });
        cl.style.width = `${w}%`;
        code.appendChild(cl);
      }
      canvas.appendChild(code);
      continue;
    }

    if (tk.type === 'bullet_list_open' || tk.type === 'ordered_list_open') {
      listDepth++;
      continue;
    }
    if (tk.type === 'bullet_list_close' || tk.type === 'ordered_list_close') {
      listDepth = Math.max(0, listDepth - 1);
      continue;
    }

    if (tk.type === 'list_item_open') {
      // 次に続く inline からテキスト長を拾う
      let textLen = 0;
      for (let j = i + 1; j < tokens.length && j < i + 6; j++) {
        if (tokens[j].type === 'inline') {
          textLen = (tokens[j].content || '').length;
          break;
        }
      }
      const li = createEl('div', { class: 'th-li' });
      li.style.marginLeft = `${(Math.max(1, listDepth) - 1) * 14}px`;
      li.appendChild(createEl('span', { class: 'th-li-dot' }));
      const bar = createEl('div', { class: 'th-bar' });
      bar.style.width = `${Math.min(90, Math.max(25, textLen * 1.6))}%`;
      li.appendChild(bar);
      canvas.appendChild(li);
      continue;
    }

    if (tk.type === 'blockquote_open') {
      const quote = createEl('div', { class: 'th-quote' });
      for (let li = 0; li < 2; li++) {
        const bar = createEl('div', { class: 'th-bar' });
        bar.style.width = `${randWidth(60, 95)}%`;
        quote.appendChild(bar);
      }
      canvas.appendChild(quote);
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') i++;
      continue;
    }

    if (tk.type === 'hr') {
      canvas.appendChild(createEl('div', { class: 'th-hr' }));
      continue;
    }

    if (tk.type === 'table_open') {
      const table = createEl('div', { class: 'th-table' });
      for (let r = 0; r < 3; r++) {
        const row = createEl('div', { class: 'th-tr' });
        for (let c = 0; c < 3; c++) row.appendChild(createEl('div', { class: 'th-td' }));
        table.appendChild(row);
      }
      canvas.appendChild(table);
      while (i < tokens.length && tokens[i].type !== 'table_close') i++;
      continue;
    }
  }

  return canvas;
}

function createCardSkeleton(
  file: RecentFile,
  onOpenFile: (path: string) => void,
): HTMLElement {
  const title = file.title || file.name.replace(/\.md$/i, '');
  const card = createEl('button', {
    class: 'thumb-card',
    dataset: { path: file.path },
    title,
    onClick: () => onOpenFile(file.path),
  });
  const frame = createEl('div', { class: 'thumb-frame' });
  frame.appendChild(createEl('div', { class: 'thumb-skeleton' }));
  card.appendChild(frame);
  const footer = createEl('div', { class: 'thumb-footer' });
  footer.appendChild(createEl('div', { class: 'thumb-title' }, title));
  footer.appendChild(createEl('div', { class: 'thumb-meta' }, formatRelativeTime(file.modified)));
  card.appendChild(footer);
  return card;
}

async function hydrateCard(card: HTMLElement, path: string): Promise<void> {
  try {
    const result = (await invoke('read_markdown', { path })) as MarkdownFile;
    const fm = parseFrontmatter(result.content);
    const dir = path.substring(0, path.lastIndexOf('/'));
    const canvas = buildThumbnailCanvas(fm.body, dir, path);
    const frame = card.querySelector('.thumb-frame');
    if (!frame) return;
    const skeleton = frame.querySelector('.thumb-skeleton');
    if (skeleton) skeleton.remove();
    frame.appendChild(canvas);
  } catch (e) {
    console.warn('thumbnail hydrate failed:', path, e);
  }
}

// 列数は CSS の @container で決める (1/2/3)。ここで測るのは scale だけ。
// 1 枚目のカードの実幅 → canvas 実寸 800px との比率で scale を算出する。
// これで「container query で列が切り替わった瞬間の新しいカード幅」にも追従する。
const THUMB_CANVAS_W = 800;

function updateThumbScale(grid: HTMLElement): void {
  const firstCard = grid.firstElementChild as HTMLElement | null;
  if (!firstCard) return;
  const cardW = firstCard.getBoundingClientRect().width;
  if (cardW <= 0) return;
  const scale = Math.max(0.15, cardW / THUMB_CANVAS_W);
  grid.style.setProperty('--thumb-scale', scale.toFixed(3));
}

export async function renderThumbnailGrid(
  host: HTMLElement,
  root: string,
  onOpenFile: (path: string) => void,
): Promise<void> {
  host.classList.add('thumb-grid-host');
  const container = createEl('div', { class: 'thumb-grid-container' });
  const grid = createEl('div', { class: 'thumb-grid' });
  container.appendChild(grid);
  host.appendChild(container);

  // 列数は CSS の @container で切り替わる。scale (連続値) はカード実幅から
  // 逆算するため、grid のサイズ変化を監視して 1 枚目のカードを測り直す。
  const resize = new ResizeObserver(() => updateThumbScale(grid));
  resize.observe(grid);

  let files: RecentFile[] = [];
  try {
    files = (await invoke('get_recent_files', { root, limit: 200 })) as RecentFile[];
  } catch (e) {
    console.warn('get_recent_files failed:', e);
  }

  if (files.length === 0) {
    container.appendChild(createEl('div', { class: 'thumb-empty' }, t('thumb.empty')));
    return;
  }

  // 可視カードだけ hydrate。rootMargin で少し先読み。
  const obs = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        const card = ent.target as HTMLElement;
        if (card.dataset.rendered === 'true') continue;
        card.dataset.rendered = 'true';
        obs.unobserve(card);
        const path = card.dataset.path || '';
        if (path) void hydrateCard(card, path);
      }
    },
    { root: host, rootMargin: '200px 0px' },
  );

  for (const file of files) {
    const card = createCardSkeleton(file, onOpenFile);
    grid.appendChild(card);
    obs.observe(card);
  }
  // ResizeObserver の初回発火タイミングはブラウザ依存なので、ここで一度
  // 明示的にカード実幅を測って scale を確定する (fallback の 0.225 で一瞬
  // 見えないようにする)。
  updateThumbScale(grid);
}
