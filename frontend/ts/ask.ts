import { byId } from './dom.js';

// Cmd+L 質問パネル。選択テキストを引用として Claude CLI に渡す。
export interface Ask {
  open(selection: string, context: { title: string; path: string }): void;
  close(): void;
  isOpen(): boolean;
}

export function createAsk(
  invokeAskClaude: (prompt: string) => Promise<string>,
): Ask {
  const panel = byId('askPanel');
  const quote = byId('askQuote');
  const input = byId('askInput') as HTMLInputElement;
  const sendBtn = byId('askSend') as HTMLButtonElement;
  const answer = byId('askAnswer');
  const closeBtn = byId('askClose') as HTMLButtonElement;

  let currentSelection = '';
  let currentCtx = { title: '', path: '' };

  const close = () => {
    panel.hidden = true;
  };

  const send = async () => {
    const question = input.value.trim();
    if (!question) return;
    answer.textContent = '';
    answer.classList.add('loading');
    sendBtn.disabled = true;
    const prompt = buildPrompt(currentSelection, currentCtx, question);
    try {
      const text = await invokeAskClaude(prompt);
      answer.textContent = text;
    } catch (e) {
      answer.textContent = `エラー: ${String(e)}`;
    } finally {
      answer.classList.remove('loading');
      sendBtn.disabled = false;
    }
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    } else if (ev.key === 'Escape') {
      close();
    }
  });
  closeBtn.addEventListener('click', close);

  return {
    open(selection, context) {
      currentSelection = selection;
      currentCtx = context;
      quote.textContent = selection;
      input.value = '';
      answer.textContent = '';
      answer.classList.remove('loading');
      panel.hidden = false;
      input.focus();
    },
    close,
    isOpen: () => !panel.hidden,
  };
}

function buildPrompt(
  selection: string,
  ctx: { title: string; path: string },
  question: string,
): string {
  return [
    `以下は "${ctx.title}" (${ctx.path}) の抜粋です:`,
    '',
    '```',
    selection,
    '```',
    '',
    `質問: ${question}`,
  ].join('\n');
}
