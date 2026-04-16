export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  title?: string | null; // .md のみ。frontmatter title か最初の # 見出し
  children: TreeNode[] | null;
  has_changes?: boolean;
  change_count?: number;
}

export interface OutlineItem {
  level: 1 | 2 | 3;
  text: string;
  anchorId: string;
}

export interface DiffInfo {
  added: number[];
  changed: number[];
  change_count: number;
}

export interface FileChangeInfo {
  path: string;
  name: string;
  title: string | null;
  change_count: number;
}

export interface Frontmatter {
  title?: string;
  date?: string;
  tags?: string[];
  raw: Record<string, unknown>;
  body: string;
}
