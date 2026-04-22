// アプリ全体で共有する状態を 1 か所に集約。
// - app.ts がブートストラップだけを担うように、
//   機能別モジュール (file-ops, quick-look, ask-bridge 等) からも参照できる。
// - セッターではなく state.xxx への直接代入で使う (薄く速く)。
import type { TreeNode } from './types';

export interface DocCacheEntry {
  rendered: string;
  title: string;
  fmHtml: HTMLElement | null;
  rawBody: string;
}

export interface DomSnapshot {
  header: DocumentFragment;
  body: HTMLElement;
  scrollTop: number;
}

export interface DeleteUndoItem {
  path: string;
  content: string;
}

export interface AppState {
  currentRoot: { path: string; tree: TreeNode } | null;
  currentFile: string | null;
  aiAvailable: boolean;
  activeProviderName: string;
  /** 別ファイル切替時の読み直しを避けるためのレンダリング結果キャッシュ */
  cache: Map<string, DocCacheEntry>;
  /** スクロール位置・AskPanel まで含めた DOM スナップショット */
  domCache: Map<string, DomSnapshot>;
  /** 直近の削除 (Cmd+Z で戻す) */
  deleteUndoStack: DeleteUndoItem[];
}

export const state: AppState = {
  currentRoot: null,
  currentFile: null,
  aiAvailable: false,
  activeProviderName: 'Claude',
  cache: new Map(),
  domCache: new Map(),
  deleteUndoStack: [],
};
