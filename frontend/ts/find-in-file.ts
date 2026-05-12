// Cmd+F ファイル内検索 (ブラウザ風)。
// docContent 内の .md-body をテキストノード単位でスキャンし、マッチを <mark> で包む。
// 横断検索 (search.ts) とは別物。

export interface FindInFile {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** ファイル切替時にハイライトを撤去する */
  reset(): void;
}

export function createFindInFile(opts: { docContent: HTMLElement }): FindInFile {
  const bar = document.getElementById('findInFileBar') as HTMLElement;
  const input = document.getElementById('findInFileInput') as HTMLInputElement;
  const status = document.getElementById('findInFileStatus') as HTMLElement;
  const prevBtn = document.getElementById('findInFilePrev') as HTMLButtonElement;
  const nextBtn = document.getElementById('findInFileNext') as HTMLButtonElement;
  const closeBtn = document.getElementById('findInFileClose') as HTMLButtonElement;

  let hits: HTMLElement[] = [];
  let activeIdx = -1;

  const clearHighlights = (): void => {
    if (hits.length === 0) return;
    const body = opts.docContent.querySelector('.md-body');
    for (const m of hits) {
      const parent = m.parentNode;
      if (!parent) continue;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
    if (body) (body as HTMLElement).normalize();
    hits = [];
    activeIdx = -1;
  };

  const updateStatus = (): void => {
    if (!input.value) { status.textContent = ''; return; }
    if (hits.length === 0) { status.textContent = '0 件'; return; }
    status.textContent = `${activeIdx + 1} / ${hits.length}`;
  };

  const gotoActive = (smooth = true): void => {
    hits.forEach((m, i) => m.classList.toggle('find-hit-current', i === activeIdx));
    const cur = hits[activeIdx];
    if (cur) cur.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    updateStatus();
  };

  const runSearch = (): void => {
    clearHighlights();
    const q = input.value;
    if (!q) { updateStatus(); return; }
    const body = opts.docContent.querySelector('.md-body') as HTMLElement | null;
    if (!body) { updateStatus(); return; }
    const qLower = q.toLowerCase();
    // テキストノードを先に全部集めてからマッチ処理 (途中で splitText するため Walker は使い回せない)
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // 自分が挿入した <mark> 内のテキストは弾く (重複防止)
        let p = node.parentNode as HTMLElement | null;
        while (p && p !== body) {
          if (p.classList?.contains('find-hit')) return NodeFilter.FILTER_REJECT;
          p = p.parentNode as HTMLElement | null;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null = walker.nextNode();
    while (n) {
      textNodes.push(n as Text);
      n = walker.nextNode();
    }
    for (const tn of textNodes) {
      let current: Text = tn;
      while (true) {
        const text = current.textContent || '';
        const idx = text.toLowerCase().indexOf(qLower);
        if (idx === -1) break;
        const matchNode = current.splitText(idx);     // idx 以降を分離
        const afterNode = matchNode.splitText(q.length); // マッチ長さ以降をさらに分離
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        matchNode.parentNode!.insertBefore(mark, matchNode);
        mark.appendChild(matchNode);
        hits.push(mark);
        current = afterNode;
      }
    }
    if (hits.length > 0) {
      activeIdx = 0;
      gotoActive(false);
    } else {
      activeIdx = -1;
    }
    updateStatus();
  };

  const goNext = (): void => {
    if (!hits.length) return;
    activeIdx = (activeIdx + 1) % hits.length;
    gotoActive();
  };
  const goPrev = (): void => {
    if (!hits.length) return;
    activeIdx = (activeIdx - 1 + hits.length) % hits.length;
    gotoActive();
  };

  const closeBar = (): void => {
    clearHighlights();
    bar.hidden = true;
  };

  let debounce: number | null = null;
  input.addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = window.setTimeout(runSearch, 100);
  });
  input.addEventListener('keydown', (ev) => {
    const composing = ev.isComposing || ev.keyCode === 229;
    if (ev.key === 'Enter' && !composing) {
      ev.preventDefault();
      if (ev.shiftKey) goPrev(); else goNext();
    } else if (ev.key === 'Escape' && !composing) {
      ev.preventDefault();
      closeBar();
      opts.docContent.focus();
    }
  });
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  closeBtn.addEventListener('click', closeBar);

  return {
    open() {
      bar.hidden = false;
      const sel = window.getSelection()?.toString() || '';
      if (sel.trim() && sel.length < 200 && sel.indexOf('\n') === -1) {
        input.value = sel.trim();
      }
      input.focus();
      input.select();
      if (input.value) runSearch();
    },
    close: closeBar,
    isOpen: () => !bar.hidden,
    reset: clearHighlights,
  };
}
