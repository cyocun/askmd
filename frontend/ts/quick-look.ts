// Space キーで ツリー選択中のファイルを軽量プレビュー。
// Space / Esc / 外側クリックで閉じる。既に開いている状態で再呼び出しされたら
// いったん閉じて別ファイルを開き直す。
import { createEl, insertSanitizedHtml } from './dom';
import { t } from './i18n';
import { parseFrontmatter, render, extractTitle, addCopyButtons, renderMermaidBlocks } from './renderer';
import { showToast } from './toast';
import { state } from './state';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

let overlayEl: HTMLElement | null = null;

export function isQuickLookOpen(): boolean {
  return overlayEl !== null;
}

export function closeQuickLook(): void {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

export async function quickLookFor(path: string): Promise<void> {
  // 既に開いている状態で呼ばれたら閉じて開き直す (別ファイル)
  closeQuickLook();
  try {
    const cached = state.cache.get(path);
    let rendered: string;
    let title: string;
    if (cached) {
      rendered = cached.rendered;
      title = cached.title;
    } else {
      const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
      const fm = parseFrontmatter(result.content);
      const filename = path.split('/').pop() || path;
      title = extractTitle(fm.body, fm, filename);
      rendered = render(fm.body);
    }

    const overlay = createEl('div', { class: 'ql-overlay' });
    const head = createEl('div', { class: 'ql-head' },
      createEl('div', { class: 'ql-head-title' }, title),
      createEl('span', { class: 'ql-head-hint' }, t('ql.hint')),
    );
    const body = createEl('div', { class: 'ql-body' });
    const article = createEl('article', { class: 'md-body' });
    insertSanitizedHtml(article, rendered);
    body.appendChild(article);

    // 画像の相対パス解決 (本体と同じ振る舞い)
    const dir = path.substring(0, path.lastIndexOf('/'));
    article.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|blob:|asset:)/.test(src)) return;
      const absolute = src.startsWith('/') ? src : `${dir}/${src}`;
      try { img.src = convertFileSrc(absolute, 'asset'); } catch {}
    });

    const panel = createEl('div', { class: 'ql-panel' }, head, body);
    overlay.appendChild(panel);

    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) closeQuickLook();
    });

    document.body.appendChild(overlay);
    overlayEl = overlay;
    void renderMermaidBlocks();
    addCopyButtons(article);
  } catch (e) {
    showToast(t('toast.readFail', String(e)));
  }
}
