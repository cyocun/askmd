export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  title?: string | null; // .md のみ。frontmatter title か最初の # 見出し
  children: TreeNode[] | null;
}

export interface OutlineItem {
  level: 1 | 2 | 3;
  text: string;
  anchorId: string;
}

export interface Frontmatter {
  title?: string;
  date?: string;
  tags?: string[];
  raw: Record<string, unknown>;
  body: string;
}
