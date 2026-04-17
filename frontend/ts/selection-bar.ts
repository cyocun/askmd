// 選択範囲の直下に浮く 5 ボタンのフロートバー。
// 聞く / 訳す / 要約 / コピー / 編集 を 1 クリックで実行。
// mousedown で preventDefault して選択が消えないようにしているのがポイント。
import { createEl } from './dom';
import { iconSparkle, iconTranslate, iconSummary, iconCopy, iconPencil } from './icons';
import { t } from './i18n';

export interface SelectionBarActions {
  onAsk: () => void;
  onTranslate: () => void;
  onSummarize: () => void;
  onCopy: () => void;
  onEdit: () => void;
  // 使用可能判定 (AI が繋がっているか)
  aiAvailable: () => boolean;
}

export interface SelectionBar {
  updateFor(container: HTMLElement): void;
  hide(): void;
}

export function createSelectionBar(
  actions: SelectionBarActions,
  options?: { parent?: HTMLElement },
): SelectionBar {
  const bar = createEl('div', { id: 'selectionBar', class: 'selection-bar' });
  bar.hidden = true;

  // 選択を消さないため mousedown で止める
  bar.addEventListener('mousedown', (ev) => ev.preventDefault());

  const makeBtn = (
    iconEl: SVGElement,
    label: string,
    handler: () => void,
    opts?: { primary?: boolean; aiOnly?: boolean },
  ): HTMLButtonElement => {
    const btn = createEl('button', {
      class: `sel-btn${opts?.primary ? ' primary' : ''}`,
      title: label,
    }) as HTMLButtonElement;
    btn.appendChild(iconEl);
    btn.appendChild(createEl('span', { class: 'sel-btn-label' }, label));
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (opts?.aiOnly && !actions.aiAvailable()) return;
      handler();
    });
    return btn;
  };

  const askBtn = makeBtn(iconSparkle(), t('selbar.ask'), actions.onAsk, { primary: true, aiOnly: true });
  const trBtn = makeBtn(iconTranslate(), t('selbar.translate'), actions.onTranslate);
  const sumBtn = makeBtn(iconSummary(), t('selbar.summarize'), actions.onSummarize, { aiOnly: true });
  const cpBtn = makeBtn(iconCopy(), t('selbar.copy'), actions.onCopy);
  const editBtn = makeBtn(iconPencil(), t('selbar.edit'), actions.onEdit);

  bar.appendChild(askBtn);
  bar.appendChild(trBtn);
  bar.appendChild(sumBtn);
  bar.appendChild(cpBtn);
  bar.appendChild(editBtn);

  (options?.parent || document.body).appendChild(bar);

  const showFor = (container: HTMLElement): void => {
    const selObj = window.getSelection();
    const sel = selObj?.toString().trim() || '';
    if (!sel) { bar.hidden = true; return; }
    if (!selObj || selObj.rangeCount === 0) { bar.hidden = true; return; }
    const range = selObj.getRangeAt(0);
    if (!container.contains(range.startContainer)) { bar.hidden = true; return; }
    const rect = range.getBoundingClientRect();
    if (rect.width < 1) { bar.hidden = true; return; }

    // AI が無ければ AI 系ボタンを無効化表示
    const ai = actions.aiAvailable();
    askBtn.classList.toggle('disabled', !ai);
    sumBtn.classList.toggle('disabled', !ai);

    // 一度表示して実寸取得してから位置調整
    bar.hidden = false;
    const barW = bar.offsetWidth || 220;
    const barH = bar.offsetHeight || 36;
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - barW / 2;
    if (left + barW > window.innerWidth - 8) left = window.innerWidth - barW - 8;
    if (left < 8) left = 8;
    if (top + barH > window.innerHeight - 8) top = rect.top - barH - 8;
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
  };

  return {
    updateFor: showFor,
    hide() { bar.hidden = true; },
  };
}
