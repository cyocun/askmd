// サムネイル一覧: ルートを開いた直後で本文が未選択のとき右カラムに並ぶ
// 「紙面の縮小プレビュー」。本文は doc と同じ renderer.render() を通し、
// カード枠に md-body としてそのまま配置した上で transform: scale で縮小する。
//
// IntersectionObserver で可視カードだけ hydrate する (read_markdown を都度発火)。
// 1 ルート 200 件で動かしても初期表示は可視領域の数枚のみ。
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createEl, insertSanitizedHtml } from './dom';
import { parseFrontmatter, processAdmonitions, render } from './renderer';
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

// 本文を doc と同じ render() (markdown-it + DOMPurify + highlight + KaTeX) に通し、
// そのまま md-body クラスで配置する。mermaid は pre 要素のままになるが、
// サムネでは SVG 化しない (コスト回避)。transform: scale での縮小は CSS 側。
function buildThumbnailCanvas(body: string, fileDir: string): HTMLElement {
  const canvas = createEl('article', { class: 'thumb-canvas md-body' });
  const html = render(body);
  insertSanitizedHtml(canvas, html);

  // 画像の相対パスを asset URL に解決
  canvas.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src && !/^(https?:|data:|blob:|asset:)/.test(src)) {
      const absolute = src.startsWith('/') ? src : `${fileDir}/${src}`;
      try { img.src = convertFileSrc(absolute, 'asset'); } catch { /* ignore */ }
    }
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
  });

  // リンクはカードクリックを奪わないよう href を剥がす
  canvas.querySelectorAll('a').forEach((a) => a.removeAttribute('href'));

  // GitHub Admonition (> [!NOTE] …) の色付けは doc と同じ処理を借りる
  processAdmonitions(canvas);

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
    const canvas = buildThumbnailCanvas(fm.body, dir);
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
