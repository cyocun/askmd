// 読むモードで本文を選択 → 「編集」→ **その選択範囲だけ**を
// 浮かべた小さな CM6 で編集する。最小介入の編集パス。
//
// 原理
// - DOM の selection.toString() = レンダ後のプレーンテキスト (記法は落ちる)
// - それを Markdown body の中で文字列検索して一致位置を特定
// - 検索範囲は anchor block (選択の起点がある block) の行範囲内を優先、
//   ヒットしなければ body 全体にフォールバック
// - 見つけた range を mini editor に投入、⌘S で body 内の該当 offset を置換
// - 記法 (`**...**` 等) は選択外なので見えない / 触らない / そのまま残る

import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { GFM } from '@lezer/markdown';
import { invoke } from '@tauri-apps/api/core';

import { createEl } from './dom';
import { mdHighlightStyle, mdBlockDecorations } from './editor-md-decoration';
import { tableNavKeymap } from './editor-table-nav';
import { showToast } from './toast';
import { currentTheme } from './theme';
import { t } from './i18n';

// ─ Markdown 本文内の文字 offset range (end-exclusive) ─
interface CharRange {
  from: number;
  to: number;
}

// ファイル冒頭の frontmatter を取り出す。body の文字 offset は fm を除いた後の相対。
function splitFrontmatter(content: string): { fm: string; body: string } {
  const m = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  if (!m) return { fm: '', body: content };
  return { fm: m[1], body: m[2] };
}

// 行番号 (0-based) → 文字 offset
function lineOffset(text: string, lineNo: number): number {
  if (lineNo <= 0) return 0;
  let pos = 0;
  let remain = lineNo;
  while (remain > 0) {
    const nl = text.indexOf('\n', pos);
    if (nl < 0) return text.length;
    pos = nl + 1;
    remain--;
  }
  return pos;
}

// selectedText を body 内で検索。anchor 内を優先して探し、無ければ body 全体へ。
// 同一文字列が複数マッチする場合は、anchor 内の最初のヒットを採用する。
function findRange(
  body: string,
  selectedText: string,
  anchor?: { startLine: number; endLine: number },
): CharRange | null {
  if (!selectedText) return null;
  if (anchor) {
    const start = lineOffset(body, anchor.startLine);
    const end = lineOffset(body, anchor.endLine);
    const idx = body.indexOf(selectedText, start);
    if (idx >= 0 && idx + selectedText.length <= end) {
      return { from: idx, to: idx + selectedText.length };
    }
  }
  const idx = body.indexOf(selectedText);
  if (idx >= 0) return { from: idx, to: idx + selectedText.length };
  return null;
}

// 同時にひとつだけ開く
let activeOverlay: HTMLElement | null = null;
function closeActive(): void {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

export interface BlockEditorDeps {
  onSaved?(): void;
}

export async function openRangeEditor(
  path: string,
  selectedText: string,
  anchor: HTMLElement | null,
  deps: BlockEditorDeps = {},
): Promise<void> {
  if (!selectedText.trim()) {
    showToast(t('block.noRange'));
    return;
  }

  let content: string;
  try {
    const result = (await invoke('read_markdown', { path })) as { content: string; modified: number | null };
    content = result.content;
  } catch (e) {
    showToast(t('toast.readFail', String(e)));
    return;
  }

  const { fm, body } = splitFrontmatter(content);

  // anchor (選択起点の block) の data-lines を ヒントに検索精度を上げる
  let anchorHint: { startLine: number; endLine: number } | undefined;
  const attr = anchor?.getAttribute('data-lines');
  if (attr) {
    const [s, e] = attr.split(',').map((n) => parseInt(n, 10));
    if (!Number.isNaN(s) && !Number.isNaN(e)) anchorHint = { startLine: s, endLine: e };
  }

  // まず選択プレーンテキストで検索。見つからなければ (= 選択に記法が混ざっていて
  // レンダ後テキストと body テキストが不一致) anchor block 全体にフォールバックする。
  let range = findRange(body, selectedText, anchorHint);
  if (!range && anchorHint) {
    const from = lineOffset(body, anchorHint.startLine);
    const toRaw = lineOffset(body, anchorHint.endLine);
    // endLine は次の行の先頭 (markdown-it map の to は exclusive)。
    // 末尾の改行を 1 文字分戻して block そのものの終端に揃える。
    const to = toRaw > from && body[toRaw - 1] === '\n' ? toRaw - 1 : toRaw;
    range = { from, to };
  }
  if (!range) {
    showToast(t('block.noRange'));
    return;
  }

  const slice = body.slice(range.from, range.to);

  closeActive();

  const overlay = createEl('div', { class: 'block-editor-overlay' });
  const panel = createEl('div', { class: 'block-editor-panel' });
  const header = createEl('div', { class: 'block-editor-header' },
    createEl('span', {}, t('block.editing')),
    createEl('span', { class: 'block-editor-hint' }, t('block.hint')),
  );
  const bodyEl = createEl('div', { class: 'block-editor-body' });
  panel.appendChild(header);
  panel.appendChild(bodyEl);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  const isDark = currentTheme().includes('dark');
  const themeExt = isDark ? oneDark : EditorView.theme({
    '&': { fontSize: '13.5px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' },
    '.cm-content': { caretColor: 'var(--accent)', lineHeight: '1.7' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: 'var(--accent-soft) !important',
    },
  }, { dark: false });

  const save = async (view: EditorView): Promise<boolean> => {
    const edited = view.state.doc.toString();
    if (edited === slice) {
      closeActive();
      return true;
    }
    const newBody = body.slice(0, range.from) + edited + body.slice(range.to);
    const newContent = fm + newBody;
    try {
      await invoke('restore_file', { path, content: newContent });
      showToast(t('toast.saved'));
      closeActive();
      deps.onSaved?.();
      return true;
    } catch (e) {
      showToast(t('toast.saveFail', String(e)));
      return true;
    }
  };

  const view = new EditorView({
    state: EditorState.create({
      doc: slice,
      extensions: [
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        history(),
        markdown({ codeLanguages: languages, extensions: GFM }),
        syntaxHighlighting(mdHighlightStyle, { fallback: true }),
        mdBlockDecorations,
        themeExt,
        keymap.of([
          { key: 'Mod-s', run: (v) => { void save(v); return true; } },
          { key: 'Escape', run: () => { closeActive(); return true; } },
          ...tableNavKeymap,
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
      ],
    }),
    parent: bodyEl,
  });

  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay) closeActive();
  });

  // 初期フォーカス + 全選択 (すぐ打鍵し直せるように)
  requestAnimationFrame(() => {
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: slice.length } });
  });
}

export function closeBlockEditor(): void {
  closeActive();
}

export function isBlockEditorOpen(): boolean {
  return activeOverlay !== null;
}
