// 「変更のあるファイル」「最近更新したメモ」など、
// 一覧を overlay + panel で見せる UI の共通化。
// 挙動: 外側クリック/Esc/× で閉じる。Enter/上下は未対応 (シンプルなボタンリスト)。
import { createEl } from './dom';

export interface ListOverlayItem {
  primary: string;
  secondary?: string;
  /** 右端に出る補助ラベル (バッジ・相対時刻など) */
  meta?: string;
  onSelect: () => void;
}

export interface ListOverlayHandle {
  close(): void;
  isOpen(): boolean;
}

export function openListOverlay(title: string, items: ListOverlayItem[]): ListOverlayHandle {
  const overlay = createEl('div', { class: 'changes-overlay' });
  const panel = createEl('div', { class: 'changes-panel' });

  let opened = true;
  const close = (): void => {
    if (!opened) return;
    opened = false;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };

  const header = createEl('div', { class: 'changes-header' },
    createEl('span', {}, title),
    createEl('button', { class: 'btn-ghost', onClick: close }, '×'),
  );
  const list = createEl('div', { class: 'changes-list' });
  for (const it of items) {
    const item = createEl('button', {
      class: 'changes-item',
      onClick: () => {
        close();
        it.onSelect();
      },
    },
      createEl('span', { class: 'changes-item-name' }, it.primary),
      it.secondary ? createEl('span', { class: 'changes-item-path' }, it.secondary) : null,
      it.meta ? createEl('span', { class: 'changes-item-count' }, it.meta) : null,
    );
    list.appendChild(item);
  }

  panel.appendChild(header);
  panel.appendChild(list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  return {
    close,
    isOpen: () => opened,
  };
}

// root 配下のパス full を表示用の相対パスに整形。root 外ならフル表示。
export function relativeFromRoot(full: string, root: string | null): string {
  if (root && full.startsWith(root)) {
    return full.slice(root.length).replace(/^\/+/, '');
  }
  return full;
}
