import { h, VNode } from 'preact';
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Modal } from './modal.js';
import { Icon } from '../components/Icons.js';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  resolve: (value: string | null) => void;
}

const activeConfirm = signal<ConfirmOptions | null>(null);
const activePrompt = signal<PromptOptions | null>(null);

export function showConfirm(options: Omit<ConfirmOptions, 'resolve'>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    activeConfirm.value = { ...options, resolve };
  });
}

export function showPrompt(options: Omit<PromptOptions, 'resolve'>): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    activePrompt.value = { ...options, resolve };
  });
}

function PromptForm({ options }: { options: PromptOptions }) {
  const [val, setVal] = useState(options.defaultValue || '');

  const handleConfirm = () => {
    options.resolve(val.trim());
    activePrompt.value = null;
  };

  const handleCancel = () => {
    options.resolve(null);
    activePrompt.value = null;
  };

  return (
    <div class="dialog-content">
      {options.message && <p class="dialog-message">{options.message}</p>}
      <input
        type="text"
        class="modal-input"
        placeholder={options.placeholder || ''}
        value={val}
        onInput={(e) => setVal((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleConfirm();
          if (e.key === 'Escape') handleCancel();
        }}
        autoFocus
      />
      <div class="modal-buttons">
        <button class="btn-cancel" onClick={handleCancel}>
          {options.cancelText || 'Отмена'}
        </button>
        <button class="btn-primary" onClick={handleConfirm}>
          {options.confirmText || 'Подтвердить'}
        </button>
      </div>
    </div>
  );
}

export function DialogContainer(): VNode {
  const confirm = activeConfirm.value;
  const prompt = activePrompt.value;

  return (
    <>
      {confirm && (
        <Modal
          isOpen={true}
          onClose={() => {
            confirm.resolve(false);
            activeConfirm.value = null;
          }}
          title={confirm.title}
          width={420}
        >
          <div class="dialog-content">
            <p class="dialog-message">{confirm.message}</p>
            <div class="modal-buttons">
              <button
                class="btn-cancel"
                onClick={() => {
                  confirm.resolve(false);
                  activeConfirm.value = null;
                }}
              >
                {confirm.cancelText || 'Отмена'}
              </button>
              <button
                class={confirm.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => {
                  confirm.resolve(true);
                  activeConfirm.value = null;
                }}
                autoFocus
              >
                {confirm.confirmText || 'Подтвердить'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {prompt && (
        <Modal
          isOpen={true}
          onClose={() => {
            prompt.resolve(null);
            activePrompt.value = null;
          }}
          title={prompt.title}
          width={440}
        >
          <PromptForm options={prompt} />
        </Modal>
      )}
    </>
  );
}
