// HTML タブ管理。1 タブ = 1 ルート (フォルダ)。切替時は loadRoot + openFile
// を再実行する (キャッシュ共有はしない単純路線 MVP)。
import { clear, createEl } from './dom';

export interface Tab {
  id: string;
  rootPath: string | null;
  currentFile: string | null;
  label: string;
}

export interface TabsDeps {
  /** タブ切替時: target に対応する状態をフロント全体で再構築する。prev は切替前のタブ (保存用) */
  onSwitchTo: (target: Tab, prev: Tab | null) => Promise<void>;
  /** + ボタン押下 / Cmd+T */
  onAddTab: () => void;
  /** タブを閉じた直後のフック (キャッシュ開放等が必要なら) */
  onCloseTab?: (closed: Tab) => void;
  /** 最後の 1 枚を閉じた時。ウィンドウを閉じる等を呼ぶ側で実装。 */
  onLastTabClose: () => void;
}

let nextId = 1;
function genId(): string {
  return `t${nextId++}`;
}

export function createTabs(container: HTMLElement, deps: TabsDeps) {
  const tabs: Tab[] = [];
  let activeId: string | null = null;
  // 切替は直列化する。フラグで「捨てる」と、切替中にタブを閉じた時に
  // activeId が削除済みタブを指したまま render されず UI が固まる。
  let switchChain: Promise<void> = Promise.resolve();

  function render(): void {
    clear(container);
    for (const tab of tabs) {
      container.appendChild(buildTabEl(tab, tab.id === activeId));
    }
    const addBtn = createEl('button', {
      class: 'tab-add-btn',
      title: '新しいタブ (⌘T)',
      onClick: () => deps.onAddTab(),
    }, '+');
    container.appendChild(addBtn);

    document.body.classList.toggle('tabs-multiple', tabs.length > 1);
  }

  function buildTabEl(tab: Tab, active: boolean): HTMLElement {
    const el = createEl('div', {
      class: 'tab' + (active ? ' active' : ''),
      dataset: { tabId: tab.id },
      title: tab.rootPath ?? tab.label,
    });
    const close = createEl('button', {
      class: 'tab-close',
      title: 'タブを閉じる (⌘W)',
    }, '×');
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void closeTab(tab.id);
    });
    const label = createEl('span', { class: 'tab-label' }, tab.label || '新規');
    el.appendChild(close);
    el.appendChild(label);
    el.addEventListener('click', (ev) => {
      // close ボタンクリックとの競合回避
      if ((ev.target as HTMLElement).closest('.tab-close')) return;
      void switchTo(tab.id);
    });
    // 中クリックでタブを閉じる (ブラウザの慣例)
    el.addEventListener('auxclick', (ev) => {
      if ((ev as MouseEvent).button === 1) {
        ev.preventDefault();
        void closeTab(tab.id);
      }
    });
    return el;
  }

  function add(rootPath: string | null, label: string): Tab {
    const t: Tab = { id: genId(), rootPath, currentFile: null, label };
    tabs.push(t);
    render();
    return t;
  }

  async function addAndActivate(rootPath: string | null, label: string): Promise<Tab> {
    const t = add(rootPath, label);
    await switchTo(t.id);
    return t;
  }

  async function doSwitch(id: string): Promise<void> {
    if (activeId === id) { render(); return; }
    const target = tabs.find((t) => t.id === id);
    if (!target) { render(); return; }
    const prev = activeId ? tabs.find((t) => t.id === activeId) ?? null : null;
    activeId = id;
    render();
    await deps.onSwitchTo(target, prev);
  }

  function switchTo(id: string): Promise<void> {
    switchChain = switchChain.then(() => doSwitch(id)).catch(() => {});
    return switchChain;
  }

  async function closeTab(id: string): Promise<void> {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const closed = tabs[idx];
    tabs.splice(idx, 1);
    deps.onCloseTab?.(closed);
    if (tabs.length === 0) {
      activeId = null;
      deps.onLastTabClose();
      return;
    }
    if (activeId === id) {
      const nextIdx = Math.min(idx, tabs.length - 1);
      await switchTo(tabs[nextIdx].id);
    } else {
      render();
    }
  }

  function getActive(): Tab | null {
    return activeId ? tabs.find((t) => t.id === activeId) ?? null : null;
  }

  function updateActive(patch: Partial<Omit<Tab, 'id'>>): void {
    const t = getActive();
    if (!t) return;
    Object.assign(t, patch);
    render();
  }

  async function closeActive(): Promise<void> {
    if (!activeId) { deps.onLastTabClose(); return; }
    if (tabs.length === 1) { deps.onLastTabClose(); return; }
    await closeTab(activeId);
  }

  async function switchByIndex(idx: number): Promise<void> {
    if (idx < 0 || idx >= tabs.length) return;
    await switchTo(tabs[idx].id);
  }

  async function switchRelative(delta: number): Promise<void> {
    if (tabs.length < 2 || !activeId) return;
    const cur = tabs.findIndex((t) => t.id === activeId);
    const next = (cur + delta + tabs.length) % tabs.length;
    await switchTo(tabs[next].id);
  }

  return {
    add,
    addAndActivate,
    switchTo,
    closeTab,
    closeActive,
    switchByIndex,
    switchRelative,
    getActive,
    updateActive,
    list: () => tabs.slice(),
    render,
  };
}
