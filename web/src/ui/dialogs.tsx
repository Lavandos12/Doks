import { h, VNode, ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useState, useEffect } from 'preact/hooks';
import { Icon } from '../components/Icons.js';
import { t } from '../i18n/index.js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  width?: number | string;
  children: ComponentChildren;
  className?: string;
}

function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  width,
  children,
  className = ''
}: ModalProps): VNode | null {
  if (!isOpen) return null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div class="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        class={`modal-card liquid-glass-surface ${className}`}
        style={width ? { maxWidth: typeof width === 'number' ? `${width}px` : width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon) && (
          <div class="modal-header">
            <div class="modal-title-group">
              {icon && <Icon name={icon as any} size={20} class="modal-header-icon" />}
              <div>
                {title && <h3 class="modal-title">{title}</h3>}
                {subtitle && <p class="modal-subtitle">{subtitle}</p>}
              </div>
            </div>
            <button class="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

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
          {options.cancelText || t('common.cancel')}
        </button>
        <button class="btn-primary" onClick={handleConfirm}>
          {options.confirmText || t('common.confirm')}
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
                {confirm.cancelText || t('common.cancel')}
              </button>
              <button
                class={confirm.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => {
                  confirm.resolve(true);
                  activeConfirm.value = null;
                }}
                autoFocus
              >
                {confirm.confirmText || t('common.confirm')}
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
