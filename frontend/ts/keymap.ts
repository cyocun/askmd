// アプリ全体のグローバルキーボードハンドラ。
// どのキーが何を呼ぶかだけをここで俯瞰できるように、各アクションの実体は
// deps 経由で受け取る。
import { closeQuickLook, isQuickLookOpen, quickLookFor } from './quick-look';
import { showToast } from './toast';
import { state } from './state';
import { t } from './i18n';
import { anchorBlockOf } from './ask-bridge';
import { openRangeEditor, isBlockEditorOpen } from './block-editor';
import { decreaseFontScale, increaseFontScale, resetFontScale } from './font-scale';
import type { Ask } from './ask';
import type { AskBridge } from './ask-bridge';
import type { Palette } from './palette';
import type { Search } from './search';
import type { FindInFile } from './find-in-file';
import type { TreeView } from './tree';
import type { FileOps } from './file-ops';

export interface KeymapDeps {
  ask: Ask;
  askBridge: AskBridge;
  palette: Palette;
  search: Search;
  findInFile: FindInFile;
  tree: TreeView;
  fileOps: FileOps;
  filterInput: HTMLInputElement;
  leftPane: HTMLElement;
  treeContainer: HTMLElement;
  docContent: HTMLElement;
  toggleSidebar(): void;
  pickAndLoad(): Promise<void>;
  translateCurrentDoc(): Promise<void>;
  schedulePreview(): void;
  openFile(path: string): Promise<void>;
  /** タブ切替 (Cmd+1..9 / Cmd+Shift+[ / Cmd+Shift+]) */
  switchTabByIndex(idx: number): void;
  switchTabRelative(delta: number): void;
}

export function installGlobalKeymap(deps: KeymapDeps): void {
  document.addEventListener('keydown', (ev) => {
    const meta = ev.metaKey || ev.ctrlKey;

    // 部分編集の CM6 (contenteditable) が開いている間は、グローバルショートカットを
    // 一切横取りしない。Cmd+Z (undo) / Cmd+S (保存) / Escape / 文字入力は
    // すべて CM6 自身の keymap が処理する。これをしないと編集中の Cmd+Z が
    // 削除取り消しに化け、j/k/h/l/Space/矢印 がツリー操作に奪われて打てない。
    if (isBlockEditorOpen()) return;

    // Quick Look が開いている間はモーダル扱い。Space/Esc で閉じ、それ以外の
    // キーは飲み込んで裏のツリー/本文を動かさない (j/k で裏が動く・Enter で
    // 裏のファイルが開く幽霊操作を防ぐ)。
    if (isQuickLookOpen()) {
      if (ev.key === ' ' || ev.key === 'Escape') {
        ev.preventDefault();
        closeQuickLook();
      }
      return;
    }

    if (meta && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      deps.toggleSidebar();
      return;
    }
    // 本文の文字サイズ (Cmd+= / Cmd+- / Cmd+0)
    // US キーボードでは Cmd++ が Cmd+= として届くので両方を拾う
    if (meta && (ev.key === '=' || ev.key === '+')) {
      ev.preventDefault();
      increaseFontScale();
      return;
    }
    if (meta && ev.key === '-') {
      ev.preventDefault();
      decreaseFontScale();
      return;
    }
    if (meta && ev.key === '0') {
      ev.preventDefault();
      resetFontScale();
      return;
    }
    // 選択 → 鉛筆ボタン と同じ流れ。選択が無い時は無反応。
    if (meta && ev.key.toLowerCase() === 'e') {
      ev.preventDefault();
      const sel = window.getSelection();
      const text = sel?.toString() || '';
      if (!text.trim() || !sel || sel.rangeCount === 0 || !state.currentFile) return;
      const anchor = anchorBlockOf(sel.getRangeAt(0));
      void openRangeEditor(state.currentFile, text, anchor);
      return;
    }

    if (meta && ev.key.toLowerCase() === 'o') {
      ev.preventDefault();
      void deps.pickAndLoad();
      return;
    }
    // Cmd+1..9 で N 番目のタブへ (Safari / Chrome 流)
    if (meta && !ev.shiftKey && /^[1-9]$/.test(ev.key)) {
      ev.preventDefault();
      deps.switchTabByIndex(parseInt(ev.key, 10) - 1);
      return;
    }
    // Cmd+Shift+[ / Cmd+Shift+] で前後のタブ
    if (meta && ev.shiftKey && (ev.key === '[' || ev.key === '{')) {
      ev.preventDefault();
      deps.switchTabRelative(-1);
      return;
    }
    if (meta && ev.shiftKey && (ev.key === ']' || ev.key === '}')) {
      ev.preventDefault();
      deps.switchTabRelative(1);
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
    // Cmd+Shift+F: 全文横断検索 (旧 Cmd+F)
    if (meta && ev.shiftKey && ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      if (!state.currentRoot) {
        showToast(t('toast.openDirFirst'));
        return;
      }
      deps.search.open(state.currentRoot.path);
      return;
    }
    // Cmd+F: ファイル内検索 (ブラウザ風)
    if (meta && !ev.shiftKey && ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      if (!state.currentFile) return;
      deps.findInFile.open();
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
    const focusTag = document.activeElement?.tagName;
    if (ev.key === '@' && focusTag !== 'INPUT' && focusTag !== 'TEXTAREA') {
      ev.preventDefault();
      deps.filterInput.focus();
      deps.filterInput.select();
      return;
    }
    if (ev.key === 'Escape') {
      // 開いている最前面のものを 1 つだけ閉じる。フォーカス位置に依らず
      // 「Escape で今開いたものが閉じる」を保証する (ask パネルもここで閉じる)。
      if (deps.findInFile.isOpen()) deps.findInFile.close();
      else if (deps.search.isOpen()) deps.search.close();
      else if (deps.palette.isOpen()) deps.palette.close();
      else if (deps.ask.closeLast()) { /* ask パネルを閉じた */ }
      else deps.tree.cancelPendingDelete();
      return;
    }

    const ae = document.activeElement as HTMLElement | null;
    const inInput =
      !!ae && (['INPUT', 'TEXTAREA'].includes(ae.tagName) || ae.isContentEditable);

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
