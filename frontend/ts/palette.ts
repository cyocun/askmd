import { byId, clear, createEl } from './dom.js';
import type { TreeNode } from './types.js';

// Cmd+P クイックスイッチャー。ファイル名にインクリメンタル絞り込み。
export interface Palette {
  open(files: TreeNode[]): void;
  close(): void;
  isOpen(): boolean;
}

function scoreMatch(query: string, name: string): number {
  // 簡易 fuzzy: 連続一致 > 先頭一致 > 含む > 文字順一致
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 500;
  const idx = n.indexOf(q);
  if (idx >= 0) return 200 - idx;
  // 順番に文字が現れるか
  let ni = 0;
  for (const c of q) {
    const pos = n.indexOf(c, ni);
    if (pos < 0) return -1;
    ni = pos + 1;
  }
  return 50;
}

export function createPalette(onSelect: (node: TreeNode) => void): Palette {
  const overlay = byId('paletteOverlay');
  const input = byId('paletteInput') as HTMLInputElement;
  const list = byId('paletteList');
  let all: TreeNode[] = [];
  let filtered: TreeNode[] = [];
  let activeIdx = 0;

  const shortPath = (full: string): string => {
    const parts = full.split('/').filter(Boolean);
    const slice = parts.slice(Math.max(0, parts.length - 3));
    return slice.join(' / ');
  };

  const redraw = () => {
    clear(list);
    filtered.forEach((f, i) => {
      const item = createEl(
        'div',
        {
          class: 'palette-item' + (i === activeIdx ? ' active' : ''),
          onClick: () => {
            onSelect(f);
            close();
          },
        },
        createEl('span', { class: 'name' }, f.name),
        createEl('span', { class: 'path' }, shortPath(f.path)),
      );
      list.appendChild(item);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const update = () => {
    const q = input.value.trim();
    if (!q) {
      filtered = all.slice(0, 60);
    } else {
      filtered = all
        .map((n) => ({ n, s: scoreMatch(q, n.name) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.n);
    }
    activeIdx = 0;
    redraw();
  };

  const close = () => {
    overlay.hidden = true;
  };

  input.addEventListener('input', update);
  input.addEventListener('keydown', (ev) => {
    // IME 変換中は Enter/Escape をスキップ (変換確定の Enter で誤ってファイルを開かないため)
    const composing = ev.isComposing || ev.keyCode === 229;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIdx = Math.min(filtered.length - 1, activeIdx + 1);
      redraw();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      redraw();
    } else if (ev.key === 'Enter' && !composing) {
      ev.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) {
        onSelect(pick);
        close();
      }
    } else if (ev.key === 'Escape' && !composing) {
      close();
    }
  });

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  return {
    open(files) {
      all = files;
      input.value = '';
      overlay.hidden = false;
      update();
      input.focus();
    },
    close,
    isOpen: () => !overlay.hidden,
  };
}
