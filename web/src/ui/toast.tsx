import { h, VNode } from 'preact';
import { signal } from '@preact/signals';
import { Icon, type IconName } from '../components/Icons.js';

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

export const toasts = signal<ToastItem[]>([]);

export function showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', duration = 3500): void {
  const id = Math.random().toString(36).slice(2, 9);
  const item: ToastItem = { id, message, type, duration };
  toasts.value = [...toasts.value, item];

  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function ToastContainer(): VNode {
  const items = toasts.value;
  if (items.length === 0) return <></>;

  const getIcon = (type: ToastItem['type']): IconName => {
    switch (type) {
      case 'success': return 'check';
      case 'warning': return 'alert-triangle';
      case 'error': return 'x';
      default: return 'info';
    }
  };

  return (
    <div class="toast-viewport">
      {items.map((t) => (
        <div key={t.id} class={`toast-card toast-${t.type} liquid-glass-surface`}>
          <Icon name={getIcon(t.type)} size={16} class="toast-icon" />
          <span class="toast-message">{t.message}</span>
          <button class="toast-close" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
