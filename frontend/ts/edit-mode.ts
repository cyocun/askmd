// Cmd+E の編集モード (ソース編集 ↔ レンダ表示の往復)。
// doc-view の DOM スナップショットに依存するため、save/restore と
// 関連 UI フックを deps で受け取る。WYSIWYG 拡張時にはここを差し替える。
import { invoke } from '@tauri-apps/api/core';
import { clear, createEl } from './dom';
import { createEditor } from './editor';
import { t } from './i18n';
import { state } from './state';
import { showToast } from './toast';
import { currentTheme } from './theme';

export interface EditModeDeps {
  docContent: HTMLElement;
  saveDomSnapshot(): void;
  restoreDomSnapshot(path: string): boolean;
  /** キャッシュにない時に本体の読み込みフローを使う */
  reopenFile(path: string): Promise<void>;
  updateFileAskBtn(): void;
}

export interface EditMode {
  enter(): Promise<void>;
  exit(): void;
  toggle(): void;
}

export function createEditMode(deps: EditModeDeps): EditMode {
  async function enter(): Promise<void> {
    if (!state.currentFile || state.activeEditor) return;
    const path = state.currentFile;
    try {
      const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
      // 現在の読みモードの DOM を退避 (Ask パネル含む)
      deps.saveDomSnapshot();
      clear(deps.docContent);
      deps.docContent.dataset.editing = 'true';

      const editorContainer = createEl('div', { class: 'editor-container' });
      deps.docContent.appendChild(editorContainer);

      const isDark = currentTheme().includes('dark');
      state.activeEditor = createEditor(editorContainer, {
        content: result.content,
        isDark,
        onSave: async (content) => {
          try {
            await invoke('restore_file', { path, content });
            // fs-changed イベントが発火し、自動で読みモードに戻る
            exit();
            showToast(t('toast.saved'));
          } catch (e) {
            showToast(t('toast.saveFail', String(e)));
          }
        },
        onCancel: () => {
          exit();
        },
      });
      state.activeEditor.focus();
      deps.updateFileAskBtn();
    } catch (e) {
      showToast(t('toast.readFail', String(e)));
    }
  }

  function exit(): void {
    if (!state.activeEditor) return;
    state.activeEditor.destroy();
    state.activeEditor = null;
    delete deps.docContent.dataset.editing;
    // キャッシュから DOM 復元、なければ再読み込みで読みモードに
    if (state.currentFile) {
      const snap = state.domCache.get(state.currentFile);
      if (snap) {
        deps.restoreDomSnapshot(state.currentFile);
      } else {
        state.cache.delete(state.currentFile);
        void deps.reopenFile(state.currentFile);
      }
    }
    deps.updateFileAskBtn();
  }

  function toggle(): void {
    if (state.activeEditor) exit();
    else void enter();
  }

  return { enter, exit, toggle };
}
