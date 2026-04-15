import { clear, createEl } from './dom.js';
import { iconFile, iconFolder, iconFolderOpen } from './icons.js';
import type { TreeNode } from './types.js';

export interface TreeView {
  render(root: TreeNode | null, rootPath: string | null): void;
  setActive(path: string | null): void;
  select(path: string): void;
  moveSelection(delta: number): void;
  openSelected(): void;
  applyFilter(query: string): void;
  flatten(): TreeNode[];
}

interface Internal {
  root: TreeNode | null;
  rootPath: string | null;
  flat: { node: TreeNode; el: HTMLElement; parentDirs: string[] }[];
  expanded: Set<string>;
  selected: string | null;
  active: string | null;
}

export function createTreeView(
  container: HTMLElement,
  onOpen: (node: TreeNode) => void,
): TreeView {
  const state: Internal = {
    root: null,
    rootPath: null,
    flat: [],
    expanded: new Set(),
    selected: null,
    active: null,
  };

  const refreshSelectionClasses = () => {
    for (const entry of state.flat) {
      entry.el.classList.toggle('selected', entry.node.path === state.selected);
      entry.el.classList.toggle('active', entry.node.path === state.active);
    }
  };

  const scrollSelectedIntoView = () => {
    const hit = state.flat.find((f) => f.node.path === state.selected);
    hit?.el.scrollIntoView({ block: 'nearest' });
  };

  const toggleDir = (dirPath: string) => {
    if (state.expanded.has(dirPath)) state.expanded.delete(dirPath);
    else state.expanded.add(dirPath);
    buildDom();
  };

  const select = (path: string) => {
    state.selected = path;
    refreshSelectionClasses();
    scrollSelectedIntoView();
  };

  const activate = (node: TreeNode) => {
    state.active = node.path;
    state.selected = node.path;
    refreshSelectionClasses();
    onOpen(node);
  };

  const buildNode = (
    node: TreeNode,
    depth: number,
    parentDirs: string[],
  ): HTMLElement => {
    if (node.is_dir) {
      const isOpen = state.expanded.has(node.path);
      const headerEl = createEl('div', {
        class: 'tree-node',
        style: `padding-left:${6 + depth * 12}px;`,
        onClick: () => toggleDir(node.path),
      });
      headerEl.appendChild(isOpen ? iconFolderOpen() : iconFolder());
      headerEl.appendChild(createEl('span', { class: 'tree-name' }, node.name));

      const wrapper = createEl('div', { class: 'tree-group' }, headerEl);
      state.flat.push({ node, el: headerEl, parentDirs });

      if (isOpen && node.children) {
        const childrenWrap = createEl('div', { class: 'tree-children' });
        for (const child of node.children) {
          childrenWrap.appendChild(
            buildNode(child, depth + 1, [...parentDirs, node.name]),
          );
        }
        wrapper.appendChild(childrenWrap);
      }
      return wrapper;
    }

    const el = createEl('div', {
      class: 'tree-node',
      style: `padding-left:${6 + depth * 12}px;`,
      onClick: () => activate(node),
    });
    el.appendChild(iconFile());
    el.appendChild(createEl('span', { class: 'tree-name' }, node.name));
    state.flat.push({ node, el, parentDirs });
    return el;
  };

  const buildDom = () => {
    state.flat = [];
    clear(container);
    if (!state.root) return;
    // root 自体は描画せず、その子から描画する (root 名は別 UI で表示)
    if (state.root.children) {
      for (const child of state.root.children) {
        container.appendChild(buildNode(child, 0, []));
      }
    }
    refreshSelectionClasses();
  };

  const expandAncestors = (leafPath: string) => {
    // 祖先ディレクトリを自動展開 (pallete などで直接 file にジャンプした場合用)
    if (!state.root) return;
    const walk = (n: TreeNode, chain: string[]): boolean => {
      if (n.path === leafPath) {
        for (const d of chain) state.expanded.add(d);
        return true;
      }
      if (n.is_dir && n.children) {
        for (const c of n.children) {
          if (walk(c, n.path === state.root!.path ? chain : [...chain, n.path])) return true;
        }
      }
      return false;
    };
    walk(state.root, []);
  };

  return {
    render(root, rootPath) {
      state.root = root;
      state.rootPath = rootPath;
      state.expanded = new Set();
      if (root?.children) {
        // デフォルトでルート直下のディレクトリは全て開く (回遊のしやすさ優先)
        for (const c of root.children) if (c.is_dir) state.expanded.add(c.path);
      }
      buildDom();
      const firstFile = state.flat.find((f) => !f.node.is_dir);
      if (firstFile) state.selected = firstFile.node.path;
      refreshSelectionClasses();
    },
    setActive(path) {
      state.active = path;
      if (path) {
        expandAncestors(path);
        buildDom();
      } else {
        refreshSelectionClasses();
      }
    },
    select,
    moveSelection(delta) {
      if (state.flat.length === 0) return;
      const visible = state.flat.filter((f) => !f.el.classList.contains('hidden'));
      if (visible.length === 0) return;
      let idx = visible.findIndex((f) => f.node.path === state.selected);
      if (idx < 0) idx = delta > 0 ? -1 : 0;
      idx = Math.max(0, Math.min(visible.length - 1, idx + delta));
      state.selected = visible[idx].node.path;
      refreshSelectionClasses();
      scrollSelectedIntoView();
    },
    openSelected() {
      const hit = state.flat.find((f) => f.node.path === state.selected);
      if (!hit) return;
      if (hit.node.is_dir) toggleDir(hit.node.path);
      else activate(hit.node);
    },
    applyFilter(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        for (const entry of state.flat) entry.el.classList.remove('hidden');
        return;
      }
      // ファイル名に含まれれば表示、さらに親ディレクトリも表示し展開する
      const matchedDirs = new Set<string>();
      for (const entry of state.flat) {
        if (entry.node.is_dir) continue;
        const hit = entry.node.name.toLowerCase().includes(q);
        entry.el.classList.toggle('hidden', !hit);
        if (hit) {
          // 親ディレクトリを全部 matched 扱い
          let cur = entry.node.path;
          while (true) {
            const slash = cur.lastIndexOf('/');
            if (slash <= 0) break;
            cur = cur.slice(0, slash);
            matchedDirs.add(cur);
          }
        }
      }
      for (const entry of state.flat) {
        if (!entry.node.is_dir) continue;
        entry.el.classList.toggle('hidden', !matchedDirs.has(entry.node.path));
      }
    },
    flatten() {
      return state.flat.filter((f) => !f.node.is_dir).map((f) => f.node);
    },
  };
}
