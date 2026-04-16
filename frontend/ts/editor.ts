// 簡易編集機能 — Cmd+E でレンダリング表示と CodeMirror 6 ソース編集をトグル
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

// CSS variables ベースのライトテーマ
const lightTheme = EditorView.theme({
  '&': {
    fontSize: '13.5px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    lineHeight: '1.6',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: 'var(--accent-soft) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-faint)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
}, { dark: false });

export interface EditorHandle {
  getContent(): string;
  destroy(): void;
  focus(): void;
  /** カーソル位置に文字列を挿入。挿入後カーソルは末尾へ。 */
  insertAtCursor(text: string): void;
}

export interface EditorOptions {
  content: string;
  isDark: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function createEditor(container: HTMLElement, opts: EditorOptions): EditorHandle {
  const themeExtension = opts.isDark ? oneDark : lightTheme;

  const state = EditorState.create({
    doc: opts.content,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      history(),
      markdown({ codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      themeExtension,
      keymap.of([
        // Cmd+S → 保存
        {
          key: 'Mod-s',
          run: (view) => {
            opts.onSave(view.state.doc.toString());
            return true;
          },
        },
        // Escape → キャンセル
        {
          key: 'Escape',
          run: () => {
            opts.onCancel();
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  return {
    getContent: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
    focus: () => view.focus(),
    insertAtCursor: (text: string) => {
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
      view.focus();
    },
  };
}
