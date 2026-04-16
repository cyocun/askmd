// テキスト入力を求めるシンプルなモーダル。
// Webview では window.prompt が制限されるため自前で用意。
// Promise<string | null> を返す。null は「キャンセル」。
import { createEl } from './dom';
import { t } from './i18n';

export interface PromptOptions {
  title: string;
  initialValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  // 検証が通らない場合はエラーメッセージ、通ったら null
  validate?: (value: string) => string | null;
}

export function promptText(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = createEl('div', { class: 'prompt-overlay' });
    const input = createEl('input', {
      class: 'prompt-input',
      type: 'text',
      value: opts.initialValue || '',
      spellcheck: false,
      autocomplete: 'off',
    }) as HTMLInputElement;
    const error = createEl('div', { class: 'prompt-error' });
    error.hidden = true;

    const cancel = () => {
      cleanup();
      resolve(null);
    };
    const confirm = () => {
      const v = input.value.trim();
      if (opts.validate) {
        const err = opts.validate(v);
        if (err) {
          error.textContent = err;
          error.hidden = false;
          return;
        }
      }
      cleanup();
      resolve(v);
    };

    const okBtn = createEl('button', {
      class: 'btn-primary',
      onClick: confirm,
    }, opts.okLabel || t('rename.ok'));
    const cancelBtn = createEl('button', {
      class: 'btn-ghost',
      onClick: cancel,
    }, opts.cancelLabel || t('rename.cancel'));

    const box = createEl('div', { class: 'prompt-box' },
      createEl('div', { class: 'prompt-title' }, opts.title),
      input,
      error,
      createEl('div', { class: 'prompt-actions' }, cancelBtn, okBtn),
    );

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const onKey = (ev: KeyboardEvent) => {
      const composing = ev.isComposing || ev.keyCode === 229;
      if (ev.key === 'Escape' && !composing) { ev.preventDefault(); cancel(); }
      if (ev.key === 'Enter' && !composing) { ev.preventDefault(); confirm(); }
    };
    input.addEventListener('keydown', onKey);

    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) cancel();
    });

    const cleanup = () => {
      overlay.remove();
    };

    // 拡張子を除いた部分だけを選択
    requestAnimationFrame(() => {
      input.focus();
      const v = input.value;
      const dot = v.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
  });
}
