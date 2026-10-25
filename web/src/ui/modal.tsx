import { h, VNode, ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { Icon } from '../components/Icons.js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  width?: number | string;
  children: ComponentChildren;
  className?: string;
}

export function Modal({
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
            <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default Modal;
