import { clear, createEl } from './dom';
import { iconFile, iconFolder, iconFolderOpen, iconOutline, iconTrash } from './icons';
import { t } from './i18n';
import type { OutlineItem, TreeNode } from './types';

// ナビゲーション可能な「行」の抽象: ファイル / ディレクトリ / アウトライン見出し
type RowKind = 'file' | 'dir' | 'outline';
interface Row {
  kind: RowKind;
  key: string;         // file/dir: path、outline: `${path}#${anchorId}`
  node?: TreeNode;     // file/dir 用
  outline?: OutlineItem;
  el: HTMLElement;
}

export interface TreeViewHandlers {
  onOpen: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onJumpHeading: (anchorId: string) => void;
  onContextMenu?: (node: TreeNode, ev: MouseEvent) => void;
  onMoveFile?: (src: TreeNode, dstDir: TreeNode) => void;
}

export type NavMode = 'file' | 'outline';

export interface TreeView {
  render(root: TreeNode | null, rootPath: string | null): void;
  setActive(path: string | null): void;
  setOutline(path: string | null, items: OutlineItem[]): void;
  select(key: string): void;
  moveSelection(delta: number): void;
  openSelected(): void;
  getSelectedNode(): TreeNode | null;
  getSelectedKind(): RowKind | null;
  getNavMode(): NavMode;
  expandSelected(): void;
  collapseSelected(): void;
  enterOutlineMode(): boolean;
  exitOutlineMode(): boolean;
  requestDeleteSelected(): void;
  cancelPendingDelete(): void;
  applyFilter(query: string): void;
  flatten(): TreeNode[];
}

export function createTreeView(
  container: HTMLElement,
  handlers: TreeViewHandlers,
): TreeView {
  let rootNode: TreeNode | null = null;
  let expanded = new Set<string>();
  let rows: Row[] = [];
  let selectedKey: string | null = null;
  let activePath: string | null = null;
  let outlineItems: OutlineItem[] = [];
  let outlineForPath: string | null = null;
  // Delete 1 押目で確認状態になるファイルパス
  let pendingDeletePath: string | null = null;
  // ナビゲーションモード: file = ファイル間移動、outline = 見出し間移動
  let navMode: NavMode = 'file';
  // アウトラインはデフォルト閉じ。→ で展開 (outline mode 移行)、← で折畳
  let outlineExpanded = false;

  const visibleRowsForMode = (): Row[] => {
    return rows.filter((r) => {
      if (r.el.classList.contains('hidden')) return false;
      return navMode === 'outline' ? r.kind === 'outline' : r.kind !== 'outline';
    });
  };

  const refreshClasses = () => {
    for (const r of rows) {
      r.el.classList.toggle('selected', r.key === selectedKey);
      r.el.classList.toggle(
        'active',
        r.kind === 'file' && r.node?.path === activePath,
      );
      r.el.classList.toggle(
        'confirm-delete',
        r.kind === 'file' && r.node?.path === pendingDeletePath,
      );
    }
  };

  const scrollSelectedIntoView = () => {
    rows.find((r) => r.key === selectedKey)?.el.scrollIntoView({ block: 'nearest' });
  };

  const toggleDir = (dirPath: string) => {
    if (expanded.has(dirPath)) expanded.delete(dirPath);
    else expanded.add(dirPath);
    buildDom();
  };

  const buildFileNode = (node: TreeNode, depth: number): HTMLElement => {
    const indent = 6 + depth * 12;
    const hasOutline =
      node.path === activePath &&
      node.path === outlineForPath &&
      outlineItems.length > 0;
    // アウトライン展開インジケータ (active + outline がある場合のみ表示)
    const indicator = hasOutline
      ? (() => {
          const btn = createEl('span', { class: 'tree-outline-indicator' });
          const ic = iconOutline();
          ic.style.width = '14px';
          ic.style.height = '14px';
          if (outlineExpanded) ic.style.opacity = '1';
          btn.appendChild(ic);
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            outlineExpanded = !outlineExpanded;
            if (outlineExpanded) navMode = 'outline';
            else navMode = 'file';
            buildDom();
            refreshClasses();
          });
          return btn;
        })()
      : null;
    const nameWrap = createEl(
      'div',
      { class: 'tree-name-wrap' },
      createEl('span', { class: 'tree-name' }, node.name),
      node.title ? createEl('span', { class: 'tree-title' }, node.title) : null,
    );
    const delBtn = createEl(
      'button',
      { class: 'tree-delete', title: t('delete.title') },
    );
    delBtn.appendChild(iconTrash());
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onDelete(node);
    });

    const el = createEl('div', {
      class: 'tree-node',
      style: `padding-left:${indent}px;`,
      onClick: () => {
        selectedKey = node.path;
        refreshClasses();
        handlers.onOpen(node);
      },
    });
    el.appendChild(iconFile());
    el.appendChild(nameWrap);
    if (node.has_changes) {
      const badge = createEl('span', {
        class: 'tree-change-badge',
        title: `${node.change_count || '?'} lines changed`,
      });
      el.appendChild(badge);
    }
    if (indicator) el.appendChild(indicator);
    el.appendChild(delBtn);
    // 右クリックメニュー + 選択状態もついでに更新
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      selectedKey = node.path;
      refreshClasses();
      handlers.onContextMenu?.(node, ev);
    });
    // D&D: ファイルをドラッグ可能にし、ディレクトリ先へドロップ (app 側で rename_file 呼ぶ)
    if (handlers.onMoveFile) {
      el.draggable = true;
      el.addEventListener('dragstart', (ev) => {
        if (!ev.dataTransfer) return;
        ev.dataTransfer.setData('application/x-askmd-path', node.path);
        ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
      });
    }
    rows.push({ kind: 'file', key: node.path, node, el });
    return el;
  };

  const buildOutlineItem = (item: OutlineItem): HTMLElement => {
    // h1 → 基準 (ファイル行と揃える)、h2/h3 は 1 段ずつ深く
    const indent = 30 + (item.level - 1) * 14;
    const el = createEl(
      'div',
      {
        class: `tree-outline-item tree-outline-h${item.level}`,
        style: `padding-left:${indent}px;`,
        onClick: () => {
          selectedKey = `${activePath}#${item.anchorId}`;
          refreshClasses();
          handlers.onJumpHeading(item.anchorId);
        },
      },
      createEl('span', {}, item.text),
    );
    rows.push({
      kind: 'outline',
      key: `${activePath}#${item.anchorId}`,
      outline: item,
      el,
    });
    return el;
  };

  const buildDirNode = (node: TreeNode, depth: number): HTMLElement => {
    const isOpen = expanded.has(node.path);
    const headerEl = createEl('div', {
      class: 'tree-node',
      style: `padding-left:${6 + depth * 12}px;`,
      onClick: () => toggleDir(node.path),
    });
    headerEl.appendChild(isOpen ? iconFolderOpen() : iconFolder());
    headerEl.appendChild(
      createEl(
        'div',
        { class: 'tree-name-wrap' },
        createEl('span', { class: 'tree-name' }, node.name),
      ),
    );
    headerEl.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      handlers.onContextMenu?.(node, ev);
    });
    // ドロップ先として受け入れる
    if (handlers.onMoveFile) {
      headerEl.addEventListener('dragover', (ev) => {
        if (!ev.dataTransfer) return;
        if (!ev.dataTransfer.types.includes('application/x-askmd-path')) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        headerEl.classList.add('drop-target');
      });
      headerEl.addEventListener('dragleave', () => {
        headerEl.classList.remove('drop-target');
      });
      headerEl.addEventListener('drop', (ev) => {
        headerEl.classList.remove('drop-target');
        const src = ev.dataTransfer?.getData('application/x-askmd-path');
        if (!src) return;
        ev.preventDefault();
        ev.stopPropagation();
        const srcRow = rows.find((r) => r.kind === 'file' && r.node?.path === src);
        if (srcRow?.node) handlers.onMoveFile!(srcRow.node, node);
      });
    }
    rows.push({ kind: 'dir', key: node.path, node, el: headerEl });
    const wrapper = createEl('div', { class: 'tree-group' }, headerEl);

    if (isOpen && node.children) {
      const childrenWrap = createEl('div', { class: 'tree-children' });
      for (const child of node.children) {
        if (child.is_dir) {
          childrenWrap.appendChild(buildDirNode(child, depth + 1));
        } else {
          childrenWrap.appendChild(buildFileNode(child, depth + 1));
          // アクティブファイル & outline 展開中のみアウトラインを差し込む
          if (
            outlineExpanded &&
            child.path === activePath &&
            child.path === outlineForPath &&
            outlineItems.length > 0
          ) {
            const ol = createEl('div', { class: 'tree-outline' });
            for (const item of outlineItems) ol.appendChild(buildOutlineItem(item));
            childrenWrap.appendChild(ol);
          }
        }
      }
      wrapper.appendChild(childrenWrap);
    }
    return wrapper;
  };

  const buildDom = () => {
    rows = [];
    clear(container);
    if (!rootNode || !rootNode.children) return;
    for (const child of rootNode.children) {
      if (child.is_dir) {
        container.appendChild(buildDirNode(child, 0));
      } else {
        container.appendChild(buildFileNode(child, 0));
        if (
          outlineExpanded &&
          child.path === activePath &&
          child.path === outlineForPath &&
          outlineItems.length > 0
        ) {
          const ol = createEl('div', { class: 'tree-outline' });
          for (const item of outlineItems) ol.appendChild(buildOutlineItem(item));
          container.appendChild(ol);
        }
      }
    }
    refreshClasses();
  };

  const expandAncestors = (leafPath: string) => {
    if (!rootNode) return;
    const walk = (n: TreeNode, chain: string[]): boolean => {
      if (n.path === leafPath) {
        for (const d of chain) expanded.add(d);
        return true;
      }
      if (n.is_dir && n.children) {
        for (const c of n.children) {
          if (walk(c, n.path === rootNode!.path ? chain : [...chain, n.path])) return true;
        }
      }
      return false;
    };
    walk(rootNode, []);
  };

  const cancelPendingDelete = () => {
    if (pendingDeletePath) {
      pendingDeletePath = null;
      refreshClasses();
    }
  };

  return {
    render(root, _rootPath) {
      rootNode = root;
      expanded = new Set();
      outlineItems = [];
      outlineForPath = null;
      pendingDeletePath = null;
      navMode = 'file';
      outlineExpanded = false;
      if (root?.children) {
        for (const c of root.children) if (c.is_dir) expanded.add(c.path);
      }
      buildDom();
      const firstFileRow = rows.find((r) => r.kind === 'file');
      if (firstFileRow) selectedKey = firstFileRow.key;
      refreshClasses();
    },
    setActive(path) {
      activePath = path;
      // 別のファイルに切り替わったらアウトラインは閉じる
      if (path !== outlineForPath) {
        outlineExpanded = false;
        navMode = 'file';
      }
      if (path) expandAncestors(path);
      buildDom();
    },
    setOutline(path, items) {
      outlineForPath = path;
      outlineItems = items;
      buildDom();
    },
    select(key) {
      selectedKey = key;
      refreshClasses();
      scrollSelectedIntoView();
    },
    moveSelection(delta) {
      const visible = visibleRowsForMode();
      if (visible.length === 0) return;
      let idx = visible.findIndex((r) => r.key === selectedKey);
      if (idx < 0) idx = delta > 0 ? -1 : 0;
      idx = Math.max(0, Math.min(visible.length - 1, idx + delta));
      const nextRow = visible[idx];
      selectedKey = nextRow.key;
      // 別のファイル/行に動いたら削除確認をキャンセル
      pendingDeletePath = null;
      refreshClasses();
      scrollSelectedIntoView();
      // outline モードの移動は即座に本文をスクロール (フォーカス追従)
      if (navMode === 'outline' && nextRow.kind === 'outline' && nextRow.outline) {
        handlers.onJumpHeading(nextRow.outline.anchorId);
      }
    },
    openSelected() {
      const row = rows.find((r) => r.key === selectedKey);
      if (!row) return;
      if (row.kind === 'dir' && row.node) toggleDir(row.node.path);
      else if (row.kind === 'file' && row.node) handlers.onOpen(row.node);
      else if (row.kind === 'outline' && row.outline) {
        handlers.onJumpHeading(row.outline.anchorId);
      }
    },
    getSelectedNode() {
      const row = rows.find((r) => r.key === selectedKey);
      return row?.kind === 'file' ? row.node ?? null : null;
    },
    getSelectedKind() {
      return rows.find((r) => r.key === selectedKey)?.kind ?? null;
    },
    getNavMode() {
      return navMode;
    },
    expandSelected() {
      const row = rows.find((r) => r.key === selectedKey);
      if (row?.kind === 'dir' && row.node && !expanded.has(row.node.path)) {
        expanded.add(row.node.path);
        buildDom();
      }
    },
    collapseSelected() {
      const row = rows.find((r) => r.key === selectedKey);
      if (row?.kind === 'dir' && row.node && expanded.has(row.node.path)) {
        expanded.delete(row.node.path);
        buildDom();
      }
    },
    enterOutlineMode() {
      const row = rows.find((r) => r.key === selectedKey);
      if (!row || row.kind !== 'file' || !row.node) return false;
      if (outlineForPath !== row.node.path || outlineItems.length === 0) return false;
      // 展開 + DOM 再構築で outline 行を生成
      outlineExpanded = true;
      buildDom();
      navMode = 'outline';
      const firstOutline = rows.find((r) => r.kind === 'outline');
      if (!firstOutline) return false;
      selectedKey = firstOutline.key;
      refreshClasses();
      scrollSelectedIntoView();
      if (firstOutline.outline) handlers.onJumpHeading(firstOutline.outline.anchorId);
      return true;
    },
    exitOutlineMode() {
      if (navMode !== 'outline') return false;
      if (outlineForPath) selectedKey = outlineForPath;
      // 折畳 + DOM 再構築で outline 行を消す
      outlineExpanded = false;
      navMode = 'file';
      buildDom();
      refreshClasses();
      scrollSelectedIntoView();
      return true;
    },
    requestDeleteSelected() {
      const row = rows.find((r) => r.key === selectedKey);
      if (!row || row.kind !== 'file' || !row.node) return;
      if (pendingDeletePath === row.node.path) {
        // 2 度目: 実行
        const target = row.node;
        pendingDeletePath = null;
        handlers.onDelete(target);
      } else {
        pendingDeletePath = row.node.path;
        refreshClasses();
      }
    },
    cancelPendingDelete,
    applyFilter(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        for (const r of rows) r.el.classList.remove('hidden');
        return;
      }
      const matchedDirs = new Set<string>();
      for (const r of rows) {
        if (r.kind !== 'file' || !r.node) continue;
        const haystack = `${r.node.name} ${r.node.title ?? ''}`.toLowerCase();
        const hit = haystack.includes(q);
        r.el.classList.toggle('hidden', !hit);
        if (hit) {
          let cur = r.node.path;
          while (true) {
            const slash = cur.lastIndexOf('/');
            if (slash <= 0) break;
            cur = cur.slice(0, slash);
            matchedDirs.add(cur);
          }
        }
      }
      for (const r of rows) {
        if (r.kind !== 'dir' || !r.node) continue;
        r.el.classList.toggle('hidden', !matchedDirs.has(r.node.path));
      }
      // outline は hide しない (active file についてくる)
    },
    flatten() {
      return rows.filter((r) => r.kind === 'file').map((r) => r.node!);
    },
  };
}
