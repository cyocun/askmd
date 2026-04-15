import type { Frontmatter } from './types.js';

const md = window.markdownit({
  html: false,
  breaks: true,
  linkify: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch {}
    }
    try {
      return hljs.highlightAuto(str).value;
    } catch {}
    return '';
  },
});

// `^---\nYAML\n---\n本文` を切り出す。YAML パーサは持たず、
// タイトル / 日付 / タグ程度の単純フィールドだけ抽出する割り切り。
const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseSimpleYaml(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      out[key] = val.slice(1, -1);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function parseFrontmatter(text: string): Frontmatter {
  const m = text.match(FM_REGEX);
  if (!m) return { raw: {}, body: text };
  const raw = parseSimpleYaml(m[1]);
  return {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    date: typeof raw.date === 'string' ? raw.date : undefined,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    raw,
    body: m[2],
  };
}

// 本文 H1 が無ければフロントマター title、それも無ければファイル名を表示用タイトルに。
export function extractTitle(body: string, fm: Frontmatter, fallback: string): string {
  if (fm.title) return fm.title;
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (m) return m[1];
  return fallback.replace(/\.md$/i, '');
}

export function render(markdown: string): string {
  return DOMPurify.sanitize(md.render(markdown), { ADD_ATTR: ['target', 'rel'] });
}
