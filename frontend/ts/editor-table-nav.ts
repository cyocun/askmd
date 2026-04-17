// Markdown テーブル内での Tab / Shift-Tab / Enter を Advanced Tables 風にハンドルする。
// - Tab: 次のセルへ移動 (行末なら次の行の先頭セルへ、最終セルなら新しい空行を追加して先頭へ)
// - Shift-Tab: 前のセルへ
// - Enter: テーブル直後に空行を挿入 (table を抜ける)
// テーブル外では false を返してデフォルト挙動 (indentWithTab 等) にフォールバック。
//
// セル検出は 1 行内の `|` 位置ベース。シンプル実装 (エスケープ `\|` は考慮せず)。
import type { EditorView, KeyBinding } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

function tableNodeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(view.state);
  let found: { from: number; to: number } | null = null;
  tree.iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name === 'Table') {
        found = { from: node.from, to: node.to };
      }
    },
  });
  // resolve でも確認 (iterate がカバーしない境界ケース対策)
  if (!found) {
    let cursor = tree.resolve(pos, -1);
    while (cursor) {
      if (cursor.name === 'Table') {
        found = { from: cursor.from, to: cursor.to };
        break;
      }
      if (!cursor.parent) break;
      cursor = cursor.parent;
    }
  }
  return found;
}

// 1 行内の `|` の offset (行頭からの相対位置) を列挙
function pipePositions(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|') out.push(i);
  }
  return out;
}

// 区切り行 (`|---|---|`) はスキップ対象
function isSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

// 同じ構造の空行を作る (| セル | セル | → |  |  |)
function makeEmptyRow(line: string): string {
  const pipes = pipePositions(line);
  if (pipes.length < 2) return line;
  let out = '';
  for (let i = 0; i < pipes.length; i++) {
    if (i === 0) {
      // 先頭のパイプ前の空白 (leading pipe の場合は '') を保つ
      out += line.slice(0, pipes[0] + 1);
    } else {
      out += ' |';
    }
  }
  return out;
}

function leadingSpaceLen(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === ' ') n++;
  return n;
}

function handleTab(view: EditorView, backward: boolean): boolean {
  const pos = view.state.selection.main.head;
  const table = tableNodeAt(view, pos);
  if (!table) return false;

  if (backward) {
    const newPos = prevCellPos(view, pos, table.from);
    if (newPos == null) return false;
    view.dispatch({ selection: { anchor: newPos } });
    return true;
  }

  // 次セル
  const line = view.state.doc.lineAt(pos);
  const pipes = pipePositions(line.text);
  if (pipes.length === 0) return false;
  const col = pos - line.from;
  const nextPipe = pipes.find((p) => p > col);

  if (nextPipe !== undefined && nextPipe < pipes[pipes.length - 1]) {
    const target = line.from + nextPipe + 1 + leadingSpaceLen(line.text.slice(nextPipe + 1));
    view.dispatch({ selection: { anchor: target } });
    return true;
  }

  // 次の行を探す
  let nextLineStart = line.to + 1;
  while (nextLineStart <= table.to && nextLineStart <= view.state.doc.length) {
    const nl = view.state.doc.lineAt(nextLineStart);
    if (isSeparatorLine(nl.text)) {
      nextLineStart = nl.to + 1;
      continue;
    }
    const p = pipePositions(nl.text);
    if (p.length === 0) break;
    const first = nl.from + p[0] + 1 + leadingSpaceLen(nl.text.slice(p[0] + 1));
    view.dispatch({ selection: { anchor: first } });
    return true;
  }

  // 最終セル: 新しい行を追加
  const template = makeEmptyRow(line.text);
  const insertAt = table.to;
  const insertText = '\n' + template;
  const firstPipe = template.indexOf('|');
  const firstCell = insertAt + 1 /* \n */ + firstPipe + 1;
  view.dispatch({
    changes: { from: insertAt, insert: insertText },
    selection: { anchor: firstCell + leadingSpaceLen(template.slice(firstPipe + 1)) },
  });
  return true;
}

function prevCellPos(view: EditorView, pos: number, tableFrom: number): number | null {
  const state = view.state;
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const pipes = pipePositions(line.text);
  if (pipes.length === 0) return null;

  // 現在列より左のパイプで最大のもの
  const prevPipes = pipes.filter((p) => p < col);
  if (prevPipes.length >= 2) {
    // 1 つ前のセル開始 = 2 個前のパイプの直後
    const target = prevPipes[prevPipes.length - 2];
    return line.from + target + 1 + leadingSpaceLen(line.text.slice(target + 1));
  }

  // 前の行の最終セルへ
  let prevLineEnd = line.from - 1;
  while (prevLineEnd >= tableFrom) {
    const pl = state.doc.lineAt(prevLineEnd);
    if (isSeparatorLine(pl.text)) {
      prevLineEnd = pl.from - 1;
      continue;
    }
    const p = pipePositions(pl.text);
    if (p.length < 2) break;
    // 最終セル = 最後から 2 番目のパイプの直後
    const target = p[p.length - 2];
    return pl.from + target + 1 + leadingSpaceLen(pl.text.slice(target + 1));
  }
  return null;
}

function handleEnter(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const table = tableNodeAt(view, pos);
  if (!table) return false;
  // テーブル直後に空行を入れて抜ける
  view.dispatch({
    changes: { from: table.to, insert: '\n\n' },
    selection: { anchor: table.to + 2 },
  });
  return true;
}

export const tableNavKeymap: readonly KeyBinding[] = [
  { key: 'Tab', run: (v) => handleTab(v, false) },
  { key: 'Shift-Tab', run: (v) => handleTab(v, true) },
  { key: 'Enter', run: handleEnter },
];
