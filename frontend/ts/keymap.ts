// アプリ全体のグローバルキーボードハンドラ。
// どのキーが何を呼ぶかだけをここで俯瞰できるように、各アクションの実体は
// deps 経由で受け取る。編集モード中は一部ショートカットを握り潰す。
import { closeQuickLook, isQuickLookOpen, quickLookFor } from './quick-look';
import { showToast } from './toast';
import { state } from './state';
import { t } from './i18n';
import type { Ask } from './ask';
import type { AskBridge } from './ask-bridge';
import type { Palette } from './palette';
import type { Search } from './search';
import type { TreeView } from './tree';
import type { FileOps } from './file-ops';
import type { EditMode } from './edit-mode';

export interface KeymapDeps {
  ask: Ask;
  askBridge: AskBridge;
  palette: Palette;
  search: Search;
  tree: TreeView;
  fileOps: FileOps;
  editMode: EditMode;
  filterInput: HTMLInputElement;
  leftPane: HTMLElement;
  treeContainer: HTMLElement;
  docContent: HTMLElement;
  toggleSidebar(): void;
  pickAndLoad(): Promise<void>;
  translateCurrentDoc(): Promise<void>;
  schedulePreview(): void;
  openFile(path: string): Promise<void>;
}

export function installGlobalKeymap(deps: KeymapDeps): void {
  document.addEventListener('keydown', (ev) => {
    const meta = ev.metaKey || ev.ctrlKey;

    // Quick Look が開いている間は Space/Esc で閉じる (最優先)
    if (isQuickLookOpen()) {
      if (ev.key === ' ' || ev.key === 'Escape') {
        ev.preventDefault();
        closeQuickLook();
        return;
      }
    }

    if (meta && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      deps.toggleSidebar();
      return;
    }
    if (meta && ev.key.toLowerCase() === 'e') {
      ev.preventDefault();
      deps.editMode.toggle();
      return;
    }
    // 編集モード中は他のグローバルショートカットを無効化 (Cmd+S, Escape は editor.ts 内で処理)
    if (state.activeEditor) return;

    if (meta && ev.key.toLowerCase() === 'o') {
      ev.preventDefault();
      void deps.pickAndLoad();
      return;
    }
    if (meta && ev.key.toLowerCase() === 'p') {
      ev.preventDefault();
      deps.palette.open(deps.tree.flatten());
      return;
    }
    if (meta && ev.shiftKey && ev.key.toLowerCase() === 't') {
      ev.preventDefault();
      void deps.translateCurrentDoc();
      return;
    }
    if (meta && ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      if (!state.currentRoot) {
        showToast(t('toast.openDirFirst'));
        return;
      }
      deps.search.open(state.currentRoot.path);
      return;
    }
    if (meta && ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      const selObj = window.getSelection();
      const sel = selObj?.toString() || '';
      if (sel.trim() && selObj && selObj.rangeCount > 0) {
        deps.askBridge.askForSelection(sel, selObj.getRangeAt(0));
      } else if (deps.ask.hasAny()) {
        // 選択なしでも既存パネルがあれば最後に触ったやつに focus (継続質問)
        deps.ask.focusLast();
      } else {
        deps.askBridge.askForFile();
      }
      return;
    }
    if (ev.key === '@' && document.activeElement?.tagName !== 'INPUT') {
      ev.preventDefault();
      deps.filterInput.focus();
      deps.filterInput.select();
      return;
    }
    if (ev.key === 'Escape') {
      // ask パネルは内部で自身を閉じる
      if (deps.search.isOpen()) deps.search.close();
      else if (deps.palette.isOpen()) deps.palette.close();
      else deps.tree.cancelPendingDelete();
      return;
    }

    const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');

    // Cmd+Z は input/textarea の native undo を邪魔しないので、そこ以外で削除 undo
    if (meta && ev.key.toLowerCase() === 'z' && !inInput && !ev.shiftKey) {
      ev.preventDefault();
      void deps.fileOps.undoDelete();
      return;
    }

    if (inInput) return;

    // Delete / Backspace でツリー選択中のファイル削除 (2 段階確認)
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      deps.tree.requestDeleteSelected();
      return;
    }

    // Tab で左右ペイン切替
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const onLeft = deps.leftPane.contains(document.activeElement);
      const target = onLeft ? deps.docContent : deps.treeContainer;
      target.focus();
      document.body.classList.toggle('focus-tree', !onLeft);
      return;
    }

    // 右ペインフォーカス時は矢印/Space/PageUp/Down でスクロール
    if (document.activeElement === deps.docContent) {
      if (ev.key === 'ArrowLeft' || ev.key === 'h') {
        ev.preventDefault();
        deps.treeContainer.focus();
        document.body.classList.add('focus-tree');
        return;
      }
      const step = 40;
      const page = Math.max(80, deps.docContent.clientHeight * 0.9);
      if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); deps.docContent.scrollBy({ top: step }); return; }
      if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); deps.docContent.scrollBy({ top: -step }); return; }
      if (ev.key === ' ' || ev.key === 'PageDown') { ev.preventDefault(); deps.docContent.scrollBy({ top: page }); return; }
      if (ev.key === 'PageUp') { ev.preventDefault(); deps.docContent.scrollBy({ top: -page }); return; }
      if (ev.key === 'Home') { ev.preventDefault(); deps.docContent.scrollTo({ top: 0 }); return; }
      if (ev.key === 'End') { ev.preventDefault(); deps.docContent.scrollTo({ top: deps.docContent.scrollHeight }); return; }
    }

    // 左ペイン側: 矢印/j/k で tree 移動、Enter で開く、Space で Quick Look
    document.body.classList.add('focus-tree');
    if (ev.key === 'ArrowDown' || ev.key === 'j') {
      ev.preventDefault();
      deps.tree.moveSelection(1);
      deps.schedulePreview();
    } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
      ev.preventDefault();
      deps.tree.moveSelection(-1);
      deps.schedulePreview();
    } else if (ev.key === 'ArrowRight' || ev.key === 'l') {
      ev.preventDefault();
      const kind = deps.tree.getSelectedKind();
      if (kind === 'dir') {
        deps.tree.expandSelected();
      } else if (deps.tree.getNavMode() === 'file') {
        if (!deps.tree.enterOutlineMode()) {
          const n = deps.tree.getSelectedNode();
          if (n) void deps.openFile(n.path).then(() => deps.tree.enterOutlineMode());
        }
      } else if (deps.tree.getNavMode() === 'outline') {
        deps.docContent.focus();
        document.body.classList.remove('focus-tree');
      }
    } else if (ev.key === 'ArrowLeft' || ev.key === 'h') {
      ev.preventDefault();
      const kind = deps.tree.getSelectedKind();
      if (kind === 'dir') {
        deps.tree.collapseSelected();
      } else {
        deps.tree.exitOutlineMode();
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      deps.tree.openSelected();
    } else if (ev.key === ' ') {
      const n = deps.tree.getSelectedNode();
      if (n) {
        ev.preventDefault();
        void quickLookFor(n.path);
      }
    }
  });
}
