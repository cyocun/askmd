// ツリー右クリック / D&D / 削除 Undo の実装。
// state と既存 UI (openFile / refreshTree / tree.setActive / ask ボタン更新) に
// 依存するため factory で deps を受け取り、呼び出し側でバインドする。
import { invoke } from '@tauri-apps/api/core';
import { showContextMenu } from './context-menu';
import { promptText } from './prompt-modal';
import { quickLookFor } from './quick-look';
import { state } from './state';
import { showToast } from './toast';
import { t } from './i18n';
import type { TreeNode } from './types';

export interface FileOpsDeps {
  openFile(path: string): Promise<void>;
  refreshTree(): Promise<void>;
  treeSetActive(path: string | null): void;
  /** 右ペインを emptyState に戻す (currentFile を削除 / 移動した直後用) */
  showEmptyState(): void;
  /** 右下「このメモについて聞く」ボタンの表示更新 */
  updateFileAskBtn(): void;
}

export interface FileOps {
  copyToClipboard(text: string): Promise<void>;
  deleteMd(path: string): Promise<void>;
  undoDelete(): Promise<void>;
  duplicateNode(path: string): Promise<void>;
  renameNode(path: string, currentName: string): Promise<void>;
  createNewMarkdownIn(dir: string): Promise<void>;
  moveFileTo(src: string, dstDir: string): Promise<void>;
  handleTreeContextMenu(node: TreeNode, ev: MouseEvent): void;
}

export function createFileOps(deps: FileOpsDeps): FileOps {
  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('toast.copied'));
    } catch {
      // noop — clipboard API は WebView 環境で失敗することがある
    }
  }

  async function deleteMd(path: string): Promise<void> {
    try {
      const content = (await invoke('trash_file', { path })) as string;
      state.deleteUndoStack.push({ path, content });
      if (state.deleteUndoStack.length > 10) state.deleteUndoStack.shift();
      showToast(t('toast.deleted'));
      if (state.currentFile === path) {
        state.currentFile = null;
        deps.showEmptyState();
        deps.updateFileAskBtn();
      }
      await deps.refreshTree();
    } catch (e) {
      showToast(t('toast.deleteFail', String(e)));
    }
  }

  async function undoDelete(): Promise<void> {
    const last = state.deleteUndoStack.pop();
    if (!last) {
      showToast(t('toast.noUndo'));
      return;
    }
    try {
      await invoke('restore_file', { path: last.path, content: last.content });
      showToast(t('toast.restored'));
      // 復元後の内容で開き直すため、旧描画キャッシュを破棄 (部分編集の undo で必須)
      state.cache.delete(last.path);
      state.domCache.delete(last.path);
      await deps.refreshTree();
      // 復元したファイルを開く
      await deps.openFile(last.path);
    } catch (e) {
      state.deleteUndoStack.push(last);
      showToast(t('toast.restoreFail', String(e)));
    }
  }

  async function duplicateNode(path: string): Promise<void> {
    try {
      const newPath = (await invoke('duplicate_file', { path })) as string;
      showToast(t('toast.duplicated'));
      await deps.refreshTree();
      await deps.openFile(newPath);
    } catch (e) {
      showToast(t('toast.duplicateFail', String(e)));
    }
  }

  async function renameNode(
    path: string,
    currentName: string,
    opts?: { deleteOnCancel?: boolean },
  ): Promise<void> {
    const newName = await promptText({
      title: t('rename.title'),
      initialValue: currentName,
      okLabel: t('rename.ok'),
      cancelLabel: t('rename.cancel'),
      validate: (v) => {
        if (!v) return t('rename.invalid');
        if (v.includes('/') || v.includes('\\')) return t('rename.invalid');
        return null;
      },
    });
    // キャンセル時、新規作成直後なら作ったファイルを残さず片付ける
    if (!newName) {
      if (opts?.deleteOnCancel) {
        try {
          await invoke('trash_file', { path });
          if (state.currentFile === path) {
            state.currentFile = null;
            state.cache.delete(path);
            state.domCache.delete(path);
            deps.showEmptyState();
            deps.updateFileAskBtn();
          }
          await deps.refreshTree();
        } catch {
          // 片付け失敗は致命的でないので黙って無視
        }
      }
      return;
    }
    if (newName === currentName) return;
    try {
      const newPath = (await invoke('rename_file', { path, newName })) as string;
      showToast(t('toast.renamed'));
      // 古いパスのキャッシュは残してもゴミにはならないが、混線を避けるため drop
      await deps.refreshTree();
      if (state.currentFile === path) {
        state.currentFile = null;
        state.cache.delete(path);
        state.domCache.delete(path);
      }
      await deps.openFile(newPath);
    } catch (e) {
      showToast(t('toast.renameFail', String(e)));
    }
  }

  async function createNewMarkdownIn(dir: string): Promise<void> {
    try {
      const newPath = (await invoke('create_new_markdown', { dir })) as string;
      await deps.refreshTree();
      await deps.openFile(newPath);
      // 作成直後にすぐ名前を決めてもらう。キャンセルしたら untitled.md を残さない。
      const defaultName = newPath.split('/').pop() || 'untitled.md';
      await renameNode(newPath, defaultName, { deleteOnCancel: true });
    } catch (e) {
      showToast(t('toast.saveFail', String(e)));
    }
  }

  async function moveFileTo(src: string, dstDir: string): Promise<void> {
    const parent = src.substring(0, src.lastIndexOf('/'));
    if (parent === dstDir) return; // 同じ親 → no-op
    try {
      const newPath = (await invoke('move_file', { src, dstDir })) as string;
      showToast(t('toast.moved'));
      state.cache.delete(src);
      state.domCache.delete(src);
      await deps.refreshTree();
      if (state.currentFile === src) {
        state.currentFile = null;
        await deps.openFile(newPath);
      }
    } catch (e) {
      showToast(t('toast.moveFail', String(e)));
    }
  }

  function handleTreeContextMenu(node: TreeNode, ev: MouseEvent): void {
    if (node.is_dir) {
      showContextMenu(ev.clientX, ev.clientY, [
        { label: t('ctx.newFile'), onClick: () => void createNewMarkdownIn(node.path) },
        { separator: true },
        { label: t('ctx.reveal'), onClick: () => void invoke('reveal_in_finder', { path: node.path }) },
        { label: t('ctx.copyPath'), onClick: () => void copyToClipboard(node.path) },
      ]);
      return;
    }
    showContextMenu(ev.clientX, ev.clientY, [
      { label: t('ctx.open'), onClick: () => void deps.openFile(node.path) },
      { label: t('ctx.preview'), onClick: () => void quickLookFor(node.path) },
      { separator: true },
      { label: t('ctx.reveal'), onClick: () => void invoke('reveal_in_finder', { path: node.path }) },
      { label: t('ctx.copyPath'), onClick: () => void copyToClipboard(node.path) },
      { label: t('ctx.copyName'), onClick: () => void copyToClipboard(node.name) },
      { separator: true },
      { label: t('ctx.duplicate'), onClick: () => void duplicateNode(node.path) },
      { label: t('ctx.rename'), onClick: () => void renameNode(node.path, node.name) },
      { separator: true },
      { label: t('ctx.trash'), danger: true, onClick: () => void deleteMd(node.path) },
    ]);
  }

  return {
    copyToClipboard,
    deleteMd,
    undoDelete,
    duplicateNode,
    renameNode,
    createNewMarkdownIn,
    moveFileTo,
    handleTreeContextMenu,
  };
}
