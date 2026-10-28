import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { WorkspaceScope } from '@doks/shared';
import {
  allBoards,
  renameBoard,
  deleteBoard,
  convertBoardScope,
  selectBoardWithScope,
  agentStatus
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

export interface BoardSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  scope: WorkspaceScope;
  boardTitle: string;
  onClearBoard?: () => void;
  onSeedTemplate?: () => void;
}

export function BoardSettingsModal({
  isOpen,
  onClose,
  boardId,
  scope,
  boardTitle,
  onClearBoard,
  onSeedTemplate
}: BoardSettingsModalProps): VNode | null {
  if (!isOpen) return null;

  const [title, setTitle] = useState(boardTitle);
  const [isConverting, setIsConverting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    setTitle(boardTitle);
  }, [boardTitle]);

  const handleSaveTitle = () => {
    const finalTitle = title.trim();
    if (finalTitle && finalTitle !== boardTitle) {
      renameBoard(boardId, finalTitle, scope);
      showToast(`Название доски изменено на "${finalTitle}"`, 'info');
    }
  };

  const handleConvertScope = async () => {
    const targetScope: WorkspaceScope = scope === 'solo' ? 'team' : 'solo';
    setIsConverting(true);
    try {
      await convertBoardScope(boardId, scope, targetScope);
      onClose();
    } catch (err) {
      console.error('Failed to convert board scope:', err);
      showToast('Ошибка при смене режима доступа доски', 'error');
    } finally {
      setIsConverting(false);
    }
  };

  const handleDelete = () => {
    deleteBoard(boardId, scope);
    showToast(`Доска "${boardTitle}" удалена в корзину`, 'info');
    onClose();

    // Switch to another remaining board if available
    const remaining = allBoards.value.filter((b) => b.id !== boardId && !b.deleted);
    if (remaining.length > 0) {
      selectBoardWithScope(remaining[0].id, remaining[0].scope || 'solo', remaining[0].title);
    }
  };

  const status = agentStatus.value;
  const effectiveIp = status?.radminIp || status?.effectiveIp || '127.0.0.1';
  const webPort = (status as any)?.webPort || window.location.port || '3000';
  const browserLink = `http://${effectiveIp}:${webPort}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(browserLink);
    setCopiedLink(true);
    showToast('Ссылка на доску скопирована в буфер', 'success');
    setTimeout(() => setCopiedLink(false), 2000);
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
        class="modal-card doks-modal-dialog liquid-glass-surface board-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '540px', width: '92vw', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="settings" size={20} class="text-accent" />
            <h3 class="modal-title">Параметры и доступ доски</h3>
          </div>
          <button
            type="button"
            class="modal-close-btn"
            onClick={onClose}
            title="Закрыть"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Body */}
        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '16px 20px' }}>
          {/* Section 1: Title */}
          <div class="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Название доски
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                class="form-input text-input"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveTitle();
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  outline: 'none'
                }}
              />
              <button
                type="button"
                class="btn-secondary"
                onClick={handleSaveTitle}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                Сохранить
              </button>
            </div>
          </div>

          {/* Section 2: Access Mode */}
          <div class="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Режим доступа
              </span>
              <span
                class={`miro-scope-badge ${scope}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 6,
                  color: scope === 'team' ? '#34d399' : '#60a5fa',
                  background: scope === 'team' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  border: `1px solid ${scope === 'team' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                }}
              >
                {scope === 'team' ? 'Общая доска' : 'Личная доска'}
              </span>
            </div>

            {scope === 'solo' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Сейчас это Личная доска (доступна только вам на этом ПК, не видна в сети).
                </div>
                <button
                  type="button"
                  disabled={isConverting}
                  onClick={handleConvertScope}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    background: 'rgba(16, 185, 129, 0.12)',
                    color: '#34d399',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon name="globe-mesh" size={15} />
                  <span>{isConverting ? 'Перенос объектов...' : 'Сделать доску Общей (Открыть для команды)'}</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Сейчас это Общая доска (синхронизируется по сети Radmin VPN / LAN с живыми курсорами).
                </div>
                <button
                  type="button"
                  disabled={isConverting}
                  onClick={handleConvertScope}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: '#60a5fa',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: isConverting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon name="lock" size={15} />
                  <span>{isConverting ? 'Перенос объектов...' : 'Сделать доску Личной (Скрыть из сети)'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 3: Network Connection for Shared Boards */}
          {scope === 'team' && (
            <div class="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Сетевое подключение к Общей доске
              </span>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Отправьте эту ссылку коллегам в Radmin VPN или локальной сети для входа через браузер:
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={browserLink}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 6,
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontFamily: 'monospace'
                  }}
                />
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={handleCopyLink}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Icon name="share" size={13} />
                  <span>{copiedLink ? 'Скопировано' : 'Копировать'}</span>
                </button>
              </div>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('doks:open-network'));
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <Icon name="network" size={13} />
                <span>Открыть настройки Radmin VPN и список комнат</span>
              </button>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('doks:open-bridge'));
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  color: '#a5b4fc',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Icon name="share" size={13} />
                <span>Показать QR-код для телефона (Режим моста)</span>
              </button>
            </div>
          )}

          {/* Section 4: Actions */}
          <div class="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Действия с доской
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {onSeedTemplate && (
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => {
                    onSeedTemplate();
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 13
                  }}
                >
                  <Icon name="sparkles" size={14} class="text-accent" />
                  <span>Заполнить шаблоном задач</span>
                </button>
              )}

              {onClearBoard && (
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => {
                    onClearBoard();
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(248, 113, 113, 0.3)',
                    background: 'rgba(239, 68, 68, 0.06)',
                    color: '#f87171',
                    cursor: 'pointer',
                    fontSize: 13
                  }}
                >
                  <Icon name="eraser" size={14} />
                  <span>Очистить все объекты на доске</span>
                </button>
              )}

              <button
                type="button"
                class="btn-danger"
                onClick={handleDelete}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  background: 'rgba(239, 68, 68, 0.14)',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                <Icon name="trash" size={14} />
                <span>Удалить доску в корзину</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
