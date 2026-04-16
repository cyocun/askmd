// 汎用コンテキストメニュー。右クリックで任意の位置に出す。
// macOS のメニュー感覚: 項目は左詰め、区切り (separator) あり、
// danger 系は赤。クリック外で自動で閉じる。
import { createEl } from './dom';

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: true;
}

let activeMenu: HTMLElement | null = null;

function closeActive(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

document.addEventListener('mousedown', (ev) => {
  if (!activeMenu) return;
  if (activeMenu.contains(ev.target as Node)) return;
  closeActive();
});

document.addEventListener('keydown', (ev) => {
  if (!activeMenu) return;
  if (ev.key === 'Escape') {
    closeActive();
    ev.preventDefault();
  }
});

window.addEventListener('blur', () => closeActive());
window.addEventListener('resize', () => closeActive());

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeActive();
  const menu = createEl('div', { class: 'context-menu' });
  for (const it of items) {
    if (it.separator) {
      menu.appendChild(createEl('div', { class: 'context-menu-sep' }));
      continue;
    }
    const btn = createEl('button', {
      class: `context-menu-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}`,
      onClick: () => {
        if (it.disabled) return;
        closeActive();
        if (it.onClick) it.onClick();
      },
    }, it.label || '');
    if (it.disabled) (btn as HTMLButtonElement).disabled = true;
    menu.appendChild(btn);
  }

  // 一旦画面外に置いて実寸を測定してから位置決定
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - rect.width - 4;
  if (top + rect.height > window.innerHeight - 4) top = window.innerHeight - rect.height - 4;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';

  activeMenu = menu;
}

export function closeContextMenu(): void {
  closeActive();
}
