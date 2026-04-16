import { byId, createEl, clear } from './dom.js';

export type ThemeId = 'github-light' | 'github-dark' | 'solarized-light' | 'solarized-dark';

interface ThemeDef {
  id: ThemeId;
  label: string;
  hljs: string; // <link> 要素の id
}

const THEMES: ThemeDef[] = [
  { id: 'github-light',    label: 'GitHub Light',    hljs: 'hljs-theme-light' },
  { id: 'github-dark',     label: 'GitHub Dark',     hljs: 'hljs-theme-dark' },
  { id: 'solarized-light', label: 'Solarized Light', hljs: 'hljs-theme-solarized-light' },
  { id: 'solarized-dark',  label: 'Solarized Dark',  hljs: 'hljs-theme-solarized-dark' },
];

const STORAGE_KEY = 'askmd-theme';

function activateHljsTheme(activeHljsId: string): void {
  for (const t of THEMES) {
    const link = document.getElementById(t.hljs) as HTMLLinkElement | null;
    if (link) link.disabled = t.hljs !== activeHljsId;
  }
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
  const def = THEMES.find((t) => t.id === id);
  if (def) activateHljsTheme(def.hljs);
  localStorage.setItem(STORAGE_KEY, id);
}

export function currentTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  if (saved && THEMES.some((t) => t.id === saved)) return saved;
  return 'github-light';
}

// テーマメニューをセットアップし、切替コールバックを返す
export function initTheme(onChanged?: () => void): void {
  applyTheme(currentTheme());

  const btn = byId('themeBtn') as HTMLButtonElement;
  const menu = byId('themeMenu');

  clear(menu);
  for (const t of THEMES) {
    const item = createEl(
      'button',
      {
        class: `theme-item${t.id === currentTheme() ? ' active' : ''}`,
        dataset: { id: t.id },
      },
      t.label,
    );
    item.addEventListener('click', () => {
      applyTheme(t.id);
      menu.querySelectorAll('.theme-item').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset['id'] === t.id);
      });
      menu.hidden = true;
      onChanged?.();
    });
    menu.appendChild(item);
  }

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', () => {
    menu.hidden = true;
  });
}
