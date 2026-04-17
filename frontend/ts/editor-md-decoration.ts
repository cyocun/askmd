// ソースモードを「リッチな見た目」にするための装飾セット。
// - mdHighlightStyle: inline の syntax highlight (見出し・強調・リンク・コード等)
// - mdBlockDecorations: 行単位の装飾 (コードブロック背景・blockquote 左 border)
//
// 記号 (`#`, `**`, `|` 等) は隠さない。CSS / class を当てるだけなので
// 文字列の round-trip は保証される (WYSIWYG ではなくリッチソース編集)。
import { EditorView, ViewPlugin, Decoration } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { HighlightStyle, syntaxTree } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ─── inline: 見出し・強調・リンク・コード等 ───
export const mdHighlightStyle = HighlightStyle.define([
  // 見出し (lezer/markdown は heading1..6 の tag を付ける)
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600' },
  { tag: t.heading4, fontSize: '1.08em', fontWeight: '600' },
  { tag: t.heading5, fontWeight: '600' },
  { tag: t.heading6, fontWeight: '600', color: 'var(--text-secondary)' },

  // 強調 / 斜体 / 取消線
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },

  // リンク / URL
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)', textDecoration: 'underline' },

  // インラインコード (monospace だけ効かせる。背景は .cm-md-inline-code の line decoration 側)
  { tag: t.monospace, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: '0.92em' },

  // 引用は blockquote 全体に対しては line decoration 側、inline の quote tag はテキスト色
  { tag: t.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },

  // リストマーカー (*, -, 1.)
  { tag: t.list, color: 'var(--accent)' },

  // Markdown の記号類 (#, **, etc.) — 少し薄く
  { tag: t.processingInstruction, color: 'var(--text-faint)' },
  { tag: t.meta, color: 'var(--text-faint)' },
  { tag: t.contentSeparator, color: 'var(--text-faint)' },

  // コードブロック内のコード (背景は line decoration 側)
  { tag: t.keyword, color: 'var(--accent)' },
  { tag: t.string, color: '#c94b4b' },
  { tag: t.number, color: '#d29922' },
  { tag: t.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
]);

// ─── block: 行単位の class 付与 (CSS で背景色・左 border を当てる) ───
// Decoration.line は block ではないので ViewPlugin から供給して OK。
function buildBlockDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // 複数のノードタイプで同じ行に装飾が被る可能性があるため、一旦行ごとに
  // class を集めて最後に Decoration.line でまとめて積む。
  type LineClass = { classes: Set<string>; from: number };
  const byLine = new Map<number, LineClass>();

  const addLineClass = (lineStart: number, cls: string): void => {
    const existing = byLine.get(lineStart);
    if (existing) {
      existing.classes.add(cls);
    } else {
      byLine.set(lineStart, { classes: new Set([cls]), from: lineStart });
    }
  };

  const state = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        if (node.name === 'FencedCode') {
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos);
            addLineClass(line.from, 'cm-md-codeblock');
            if (line.to === state.doc.length && pos === line.from) break;
            pos = line.to + 1;
          }
        } else if (node.name === 'CodeBlock') {
          // indented code block
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos);
            addLineClass(line.from, 'cm-md-codeblock');
            if (line.to === state.doc.length && pos === line.from) break;
            pos = line.to + 1;
          }
        } else if (node.name === 'Blockquote') {
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos);
            addLineClass(line.from, 'cm-md-quote');
            if (line.to === state.doc.length && pos === line.from) break;
            pos = line.to + 1;
          }
        } else if (node.name === 'Table') {
          for (let pos = node.from; pos <= node.to;) {
            const line = state.doc.lineAt(pos);
            addLineClass(line.from, 'cm-md-table');
            if (line.to === state.doc.length && pos === line.from) break;
            pos = line.to + 1;
          }
        }
      },
    });
  }

  // 行位置でソートしてから builder に積む (RangeSetBuilder は昇順必須)
  const sorted = Array.from(byLine.values()).sort((a, b) => a.from - b.from);
  for (const { classes, from } of sorted) {
    builder.add(from, from, Decoration.line({ class: Array.from(classes).join(' ') }));
  }

  return builder.finish();
}

export const mdBlockDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildBlockDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildBlockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
