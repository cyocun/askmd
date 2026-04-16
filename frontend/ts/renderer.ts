import type { Frontmatter } from './types.js';

declare const katex: { renderToString(tex: string, opts?: Record<string, unknown>): string };
declare const mermaid: { initialize(config: Record<string, unknown>): void; run(opts: Record<string, unknown>): Promise<void> };
declare const markdownitFootnote: (md: any) => void;

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
  html: true,
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

// ─── 脚注プラグイン ───
if (typeof markdownitFootnote === 'function') {
  md.use(markdownitFootnote);
}

// ─── ==highlight== マーカー ───
function highlightInline(state: any, silent: boolean): boolean {
  if (state.src.slice(state.pos, state.pos + 2) !== '==') return false;
  const start = state.pos + 2;
  let end = start;
  while (end < state.posMax - 1) {
    if (state.src[end] === '=' && state.src[end + 1] === '=') break;
    end++;
  }
  if (end >= state.posMax - 1) return false;
  if (!silent) {
    const token = state.push('mark_open', 'mark', 1);
    token.markup = '==';
    state.md.inline.tokenize(state);
    const content = state.src.slice(start, end);
    const t = state.push('text', '', 0);
    t.content = content;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}
md.inline.ruler.after('emphasis', 'mark', highlightInline);

// ─── チェックボックス (タスクリスト) ───
// `- [x]` / `- [ ]` をチェックボックスに変換
const defaultListItemOpen = md.renderer.rules.list_item_open || function(tokens: any[], idx: number, options: any, _env: any, self: any) {
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.list_item_open = function(tokens: any[], idx: number, options: any, env: any, self: any) {
  const contentToken = tokens[idx + 2]; // inline token
  if (contentToken && contentToken.type === 'inline' && contentToken.content) {
    const m = contentToken.content.match(/^\[([ xX])\]\s*/);
    if (m) {
      const checked = m[1] !== ' ';
      contentToken.content = contentToken.content.slice(m[0].length);
      // children から先頭のチェックボックステキストを除去
      if (contentToken.children && contentToken.children.length > 0) {
        const first = contentToken.children[0];
        if (first.type === 'text') {
          first.content = first.content.replace(/^\[([ xX])\]\s*/, '');
        }
      }
      tokens[idx].attrSet('class', 'task-list-item');
      return defaultListItemOpen(tokens, idx, options, env, self) +
        `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
    }
  }
  return defaultListItemOpen(tokens, idx, options, env, self);
};

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
function getMermaidTheme(): string {
  const t = document.documentElement.getAttribute('data-theme') || '';
  return t.includes('dark') ? 'dark' : 'default';
}

if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme(), securityLevel: 'loose' });
}

export function reinitMermaidTheme(): void {
  if (typeof mermaid === 'undefined') return;
  mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme(), securityLevel: 'loose' });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function expandIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7']) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

// DOM に描画済みの .mermaid 要素をレンダリングし、拡大ボタンを追加する
export async function renderMermaidBlocks(): Promise<void> {
  if (typeof mermaid === 'undefined') return;
  const blocks = document.querySelectorAll('.mermaid');
  if (blocks.length === 0) return;
  try {
    await mermaid.run({ nodes: blocks });
  } catch (e) {
    console.warn('mermaid render error:', e);
    return;
  }

  blocks.forEach((block) => {
    if (block.parentElement?.classList.contains('mermaid-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-wrap';
    block.parentElement!.insertBefore(wrap, block);
    wrap.appendChild(block);

    const expandBtn = document.createElement('button');
    expandBtn.className = 'mermaid-expand';
    expandBtn.title = '拡大表示';
    expandBtn.appendChild(expandIcon());
    expandBtn.addEventListener('click', () => openMermaidFullscreen(block as HTMLElement));
    wrap.appendChild(expandBtn);
  });
}

function openMermaidFullscreen(block: HTMLElement): void {
  const existing = document.getElementById('mermaidFullscreen');
  if (existing) existing.remove();
  document.getElementById('mermaidFullscreenClose')?.remove();

  const svg = block.querySelector('svg');
  if (!svg) return;

  const overlay = document.createElement('div');
  overlay.id = 'mermaidFullscreen';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'mermaidFullscreenClose';
  closeBtn.textContent = '×';

  const clone = svg.cloneNode(true) as SVGElement;
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.maxWidth = '95vw';
  clone.style.maxHeight = '90vh';

  overlay.appendChild(clone);
  document.body.appendChild(overlay);
  document.body.appendChild(closeBtn);

  const close = () => { overlay.remove(); closeBtn.remove(); document.removeEventListener('keydown', onKey); };
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

// ─── GitHub Admonitions (> [!NOTE] 等) ポストプロセス ───
const ADMONITION_MAP: Record<string, { label: string; cls: string }> = {
  NOTE:      { label: 'Note',      cls: 'admonition-note' },
  TIP:       { label: 'Tip',       cls: 'admonition-tip' },
  IMPORTANT: { label: 'Important', cls: 'admonition-important' },
  WARNING:   { label: 'Warning',   cls: 'admonition-warning' },
  CAUTION:   { label: 'Caution',   cls: 'admonition-caution' },
};

export function processAdmonitions(body: HTMLElement): void {
  body.querySelectorAll('blockquote').forEach((bq) => {
    const first = bq.querySelector('p');
    if (!first) return;
    const text = first.textContent || '';
    const m = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
    if (!m) return;
    const key = m[1].toUpperCase();
    const info = ADMONITION_MAP[key];
    if (!info) return;
    bq.classList.add('admonition', info.cls);
    // ラベルを挿入し、マッチ部分を除去
    const label = document.createElement('strong');
    label.className = 'admonition-title';
    label.textContent = info.label;
    first.textContent = text.slice(m[0].length);
    first.insertBefore(label, first.firstChild);
    first.insertBefore(document.createTextNode(' '), label.nextSibling);
  });
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
    ADD_ATTR: ['target', 'rel', 'checked', 'disabled', 'type'],
    ADD_TAGS: ['input', 'details', 'summary', 'mark', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mspace', 'mphantom', 'mpadded', 'menclose', 'math'],
  });
}
