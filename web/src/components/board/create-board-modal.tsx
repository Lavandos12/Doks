import { h, VNode } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import type { WorkspaceScope } from '@doks/shared';
import { createBoard, selectBoardWithScope } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { t } from '../../i18n/index.js';

export interface CreateBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (boardId: string, scope: WorkspaceScope) => void;
}

export function CreateBoardModal({
  isOpen,
  onClose,
  onCreated
}: CreateBoardModalProps): VNode | null {
  if (!isOpen) return null;

  const [title, setTitle] = useState(t('create_board.default_title'));
  const [selectedScope, setSelectedScope] = useState<WorkspaceScope>('solo');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSubmit = (e?: Event) => {
    if (e) e.preventDefault();
    const finalTitle = title.trim() || t('create_board.default_title');
    const newId = createBoard(finalTitle, null, selectedScope, false);
    selectBoardWithScope(newId, selectedScope, finalTitle);
    onClose();

    if (selectedScope === 'team') {
      showToast(t('create_board.board_created'), 'info');
    }

    if (onCreated) {
      onCreated(newId, selectedScope);
    }
  };

  return (
    <div
      class="modal-backdrop doks-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 2000 }}
    >
      <div
        class="modal-card doks-modal-dialog liquid-glass-surface create-board-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px', width: '92vw' }}
      >
        {/* Header */}
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="layout" size={20} class="text-accent" />
            <h3 class="modal-title">{t('topbar.create_board')}</h3>
          </div>
          <button
            type="button"
            class="modal-close-btn"
            onClick={onClose}
            title={t('sidebar.cancel')}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div class="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label class="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('create_board.name_label')}
            </label>
            <input
              ref={inputRef}
              type="text"
              class="form-input text-input"
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder={t('create_board.name_placeholder')}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none'
              }}
            />
          </div>

          <div class="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label class="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('create_board.scope_label')}
            </label>
            <div class="board-scope-choice-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Option 1: Solo */}
              <div
                class={`scope-choice-card ${selectedScope === 'solo' ? 'active' : ''}`}
                onClick={() => setSelectedScope('solo')}
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border: `1.5px solid ${selectedScope === 'solo' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.12)'}`,
                  background: selectedScope === 'solo' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c084fc' }}>
                  <Icon name="lock" size={20} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t('topbar.solo')}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {t('create_board.solo_desc')}
                </div>
              </div>

              {/* Option 2: Team */}
              <div
                class={`scope-choice-card ${selectedScope === 'team' ? 'active' : ''}`}
                onClick={() => setSelectedScope('team')}
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border: `1.5px solid ${selectedScope === 'team' ? '#10b981' : 'rgba(255, 255, 255, 0.12)'}`,
                  background: selectedScope === 'team' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399' }}>
                  <Icon name="globe-mesh" size={20} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t('topbar.team')}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {t('create_board.team_desc')}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div class="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              class="btn-secondary"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="submit"
              class="btn-primary"
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                background: selectedScope === 'team' ? '#10b981' : '#7c3aed',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t('topbar.create_board')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
