import type { Frontmatter } from './types.js';

declare const katex: { renderToString(tex: string, opts?: Record<string, unknown>): string };
declare const mermaid: { initialize(config: Record<string, unknown>): void; run(opts: Record<string, unknown>): Promise<void> };

// ─── KaTeX: markdown-it inline/block ルール ───

// $$...$$ ブロック数式
function mathBlock(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const maxPos = state.eMarks[startLine];
  if (startPos + 2 > maxPos) return false;
  if (state.src.slice(startPos, startPos + 2) !== '$$') return false;
  if (silent) return true;
  let nextLine = startLine;
  let found = false;
  while (++nextLine < endLine) {
    const pos = state.bMarks[nextLine] + state.tShift[nextLine];
    const end = state.eMarks[nextLine];
    if (state.src.slice(pos, end).trim() === '$$') { found = true; break; }
  }
  if (!found) return false;
  state.line = nextLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], true).replace(/\n$/, '');
  token.map = [startLine, state.line];
  return true;
}

// $...$ インライン数式
function mathInline(state: any, silent: boolean): boolean {
  if (state.src[state.pos] !== '$') return false;
  // $$ はブロックに任せる
  if (state.src[state.pos + 1] === '$') return false;
  const start = state.pos + 1;
  let end = start;
  while (end < state.posMax && state.src[end] !== '$') end++;
  if (end >= state.posMax) return false;
  const content = state.src.slice(start, end);
  if (!content.trim()) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    return `<code class="katex-error">${tex}</code>`;
  }
}

// ─── markdown-it 構築 ───

const md = window.markdownit({
  html: false,
  breaks: true,
  linkify: true,
  highlight(str: string, lang: string): string {
    // mermaid フェンスはそのまま保持 (レンダリング後に mermaid.run で置換)
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${str}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(str, { language: lang }).value; } catch {}
    }
    try { return hljs.highlightAuto(str).value; } catch {}
    return '';
  },
});

// KaTeX ルール登録
md.block.ruler.after('blockquote', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.inline.ruler.after('escape', 'math_inline', mathInline);
md.renderer.rules['math_block'] = (tokens: any[], idx: number) => renderKatex(tokens[idx].content, true);
md.renderer.rules['math_inline'] = (tokens: any[], idx: number) => renderKatex(tokens[idx].content, false);

// mermaid フェンスのレンダリング: highlight 内で <pre class="mermaid"> を返すが、
// markdown-it のデフォルト fence ルールが外側に <pre><code> を被せるため
// fence ルールをオーバーライドして mermaid だけ特別扱いする。
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// ─── Mermaid 初期化 ───
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
}

// DOM に描画済みの .mermaid 要素をレンダリングする
export async function renderMermaidBlocks(): Promise<void> {
  if (typeof mermaid === 'undefined') return;
  const blocks = document.querySelectorAll('.mermaid');
  if (blocks.length === 0) return;
  try {
    await mermaid.run({ nodes: blocks });
  } catch (e) {
    console.warn('mermaid render error:', e);
  }
}

// ─── フロントマター ───

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

export function extractTitle(body: string, fm: Frontmatter, fallback: string): string {
  if (fm.title) return fm.title;
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (m) return m[1];
  return fallback.replace(/\.md$/i, '');
}

export function render(markdown: string): string {
  return DOMPurify.sanitize(md.render(markdown), {
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mspace', 'mphantom', 'mpadded', 'menclose', 'math'],
  });
}
