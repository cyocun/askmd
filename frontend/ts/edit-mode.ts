// 編集モード: reading ↔ source の 2 段トグル。
// ソース編集側は editor.ts 内で CM6 の HighlightStyle + line decoration により
// 「見出しが見出しっぽく、コードはコードっぽく」見えるようスタイリング済み。
// 書くファイルは生の Markdown のまま (装飾は decoration のみ)。
import { invoke } from '@tauri-apps/api/core';
import { clear, createEl } from './dom';
import { createEditor } from './editor';
import { t } from './i18n';
import { state } from './state';
import { showToast } from './toast';
import { currentTheme } from './theme';

export type EditorMode = 'reading' | 'source';

export interface EditModeDeps {
  docContent: HTMLElement;
  saveDomSnapshot(): void;
  restoreDomSnapshot(path: string): boolean;
  /** キャッシュにない時に本体の読み込みフローを使う */
  reopenFile(path: string): Promise<void>;
  updateFileAskBtn(): void;
  /** モード変更のたびに呼ばれる (doc header の表示更新用) */
  onModeChange?(mode: EditorMode): void;
}

export interface EditMode {
  getMode(): EditorMode;
  /** 特定モードへ。`reading` は exit と同義 */
  setMode(mode: EditorMode): void;
  /** reading ↔ source */
  toggle(): void;
  exit(): void;
}

export function createEditMode(deps: EditModeDeps): EditMode {
  const notify = (m: EditorMode): void => deps.onModeChange?.(m);

  function setupContainer(): HTMLElement {
    clear(deps.docContent);
    deps.docContent.dataset.editing = 'true';
    const container = createEl('div', { class: 'editor-container' });
    deps.docContent.appendChild(container);
    return container;
  }

  async function enter(): Promise<void> {
    if (!state.currentFile || state.activeEditor) return;
    const path = state.currentFile;
    try {
      const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
      // 読みモードの DOM (Ask パネル含む) を退避
      deps.saveDomSnapshot();
      const container = setupContainer();
      const isDark = currentTheme().includes('dark');
      state.activeEditor = createEditor(container, {
        content: result.content,
        isDark,
        onSave: async (saved) => {
          try {
            await invoke('restore_file', { path, content: saved });
            // fs-changed で読みモードに戻る
            exit();
            showToast(t('toast.saved'));
          } catch (e) {
            showToast(t('toast.saveFail', String(e)));
          }
        },
        onCancel: () => exit(),
      });
      state.activeEditor.focus();
      deps.updateFileAskBtn();
      notify('source');
    } catch (e) {
      showToast(t('toast.readFail', String(e)));
    }
  }

  function exit(): void {
    if (!state.activeEditor) {
      notify('reading');
      return;
    }
    state.activeEditor.destroy();
    state.activeEditor = null;
    delete deps.docContent.dataset.editing;
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
    notify('reading');
  }

  function getMode(): EditorMode {
    return state.activeEditor ? 'source' : 'reading';
  }

  function toggle(): void {
    if (state.activeEditor) exit();
    else void enter();
  }

  function setMode(mode: EditorMode): void {
    if (mode === getMode()) return;
    if (mode === 'reading') exit();
    else void enter();
  }

  return { getMode, setMode, toggle, exit };
}
