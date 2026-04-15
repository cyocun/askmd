// DOM 構築ヘルパ。innerHTML を避けて安全に要素を組み立てる。
type ElAttrs<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'style' | 'dataset' | 'children'>
> & {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
  onClick?: (ev: MouseEvent) => void;
  onInput?: (ev: Event) => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
};

export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElAttrs<K>,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'class') el.className = v as string;
      else if (k === 'style') el.setAttribute('style', v as string);
      else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) {
          el.dataset[dk] = dv;
        }
      } else if (k === 'onClick') el.addEventListener('click', v as EventListener);
      else if (k === 'onInput') el.addEventListener('input', v as EventListener);
      else if (k === 'onKeyDown') el.addEventListener('keydown', v as EventListener);
      else (el as any)[k] = v;
    }
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: #${id}`);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
