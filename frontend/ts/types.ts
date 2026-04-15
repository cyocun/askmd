export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[] | null;
}

export interface Frontmatter {
  title?: string;
  date?: string;
  tags?: string[];
  raw: Record<string, unknown>;
  body: string;
}
