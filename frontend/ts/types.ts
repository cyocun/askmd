export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  title?: string | null; // .md のみ。frontmatter title か最初の # 見出し
  mtime?: number; // .md のみ。unix epoch 秒。「最後に見た日」との比較に使う
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
