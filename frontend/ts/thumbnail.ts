// サムネイル一覧: ルートを開いた直後で本文が未選択のとき右カラムに並ぶ
// 「紙面の縮小プレビュー」。本文は md-body としてカードに流し込み、
// transform: scale で縮小する。
//
// 最適化:
// - state.cache に openFile 由来のフル render 結果があればそれを流用
//   (hljs / KaTeX 込みでリッチに見える)。無ければサムネ専用の軽量
//   renderLight (hljs / KaTeX なし) で render して速く描く
// - IntersectionObserver で可視カードだけ hydrate、rootMargin で先読み
// - grid 破棄時に ResizeObserver / IntersectionObserver を disconnect
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createEl, insertSanitizedHtml } from './dom';
import { parseFrontmatter, processAdmonitions, renderLight } from './renderer';
import { state } from './state';
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

// html を受け取って .thumb-canvas (md-body) を構築する。画像 src / リンク /
// admonition の後処理も同じ。
function buildCanvasFromHtml(html: string, fileDir: string): HTMLElement {
  const canvas = createEl('article', { class: 'thumb-canvas md-body' });
  insertSanitizedHtml(canvas, html);

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

  // GitHub Admonition の色付け
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
    const dir = path.substring(0, path.lastIndexOf('/'));
    let html: string;
    const cached = state.cache.get(path);
    if (cached) {
      // 既に openFile でフル render 済み → そのまま流用 (hljs/KaTeX 込み)
      html = cached.rendered;
    } else {
      // 未読ファイル: 軽量 render でサムネだけ描く (state.cache には入れない。
      // openFile 側が後で本格 render してキャッシュする)
      const result = (await invoke('read_markdown', { path })) as MarkdownFile;
      const fm = parseFrontmatter(result.content);
      html = renderLight(fm.body);
    }
    const canvas = buildCanvasFromHtml(html, dir);
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

/**
 * ルート直下のすべての .md をサムネカードとして host に敷き詰める。
 * 返り値は cleanup 関数。呼び出し側は別ビュー (本文 / 空状態) に切り替える
 * タイミングで呼び、Observer を disconnect してリークを防ぐ。
 */
export async function renderThumbnailGrid(
  host: HTMLElement,
  root: string,
  onOpenFile: (path: string) => void,
): Promise<() => void> {
  host.classList.add('thumb-grid-host');
  const container = createEl('div', { class: 'thumb-grid-container' });
  const grid = createEl('div', { class: 'thumb-grid' });
  container.appendChild(grid);
  host.appendChild(container);

  // 列数は CSS の @container で切り替わる。scale (連続値) はカード実幅から
  // 逆算するため、grid のサイズ変化を監視して 1 枚目のカードを測り直す。
  const resize = new ResizeObserver(() => updateThumbScale(grid));
  resize.observe(grid);

  // 可視カードだけ hydrate。rootMargin で少し先読み (400px ≒ カード 2 行ぶん)。
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
    { root: host, rootMargin: '400px 0px' },
  );

  const cleanup = (): void => {
    resize.disconnect();
    obs.disconnect();
  };

  let files: RecentFile[] = [];
  try {
    files = (await invoke('get_recent_files', { root, limit: 200 })) as RecentFile[];
  } catch (e) {
    console.warn('get_recent_files failed:', e);
  }

  if (files.length === 0) {
    container.appendChild(createEl('div', { class: 'thumb-empty' }, t('thumb.empty')));
    return cleanup;
  }

  for (const file of files) {
    const card = createCardSkeleton(file, onOpenFile);
    grid.appendChild(card);
    obs.observe(card);
  }
  // ResizeObserver の初回発火タイミングはブラウザ依存なので、ここで一度
  // 明示的にカード実幅を測って scale を確定する (fallback の 0.225 で一瞬
  // 見えないようにする)。
  updateThumbScale(grid);

  return cleanup;
}
