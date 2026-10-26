import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { WorkspaceScope } from '@doks/shared';
import {
  transferNodesAcrossScopes,
  createBoard,
  currentScope,
  setScope
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromScope: WorkspaceScope;
  boardId: string;
  nodeIds: string[];
}

export function TransferModal({
  isOpen,
  onClose,
  fromScope,
  boardId,
  nodeIds
}: TransferModalProps) {
  if (!isOpen) return null;

  const targetScope: WorkspaceScope = fromScope === 'solo' ? 'team' : 'solo';
  const isPromote = fromScope === 'solo';

  const [newBoardTitle, setNewBoardTitle] = useState<string>(
    isPromote ? 'Командная доска (из Соло)' : 'Личная доска (из Команды)'
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // Create new board in target scope
      const savedScope = currentScope.value;
      setScope(targetScope);
      const finalTargetBoardId = createBoard(
        newBoardTitle.trim() || (isPromote ? 'Командная доска' : 'Личная доска')
      );
      setScope(savedScope);

      if (nodeIds.length > 0) {
        const res = await transferNodesAcrossScopes({
          fromScope,
          toScope: targetScope,
          boardId,
          targetBoardId: finalTargetBoardId,
          nodeIds,
          includeLinkedNotes: true,
          mode: 'copy'
        });

        if (res.success) {
          showToast(`Доска скопирована в ${targetScope === 'team' ? 'Команду' : 'Соло'}`);
          onClose();
        } else {
          setErrorMsg(res.error || 'Ошибка переноса элементов');
        }
      } else {
        showToast(`Доска скопирована в ${targetScope === 'team' ? 'Команду' : 'Соло'}`);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Сбой сети при переносе');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="modal-overlay doks-modal-backdrop transfer-modal-backdrop" onClick={onClose}>
      <div
        class="modal-card doks-modal-dialog transfer-modal liquid-glass-surface"
        style={{ maxWidth: '440px', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <div class="modal-header-icon-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span class="scope-icon-large text-accent">
              <Icon name={isPromote ? 'globe-mesh' : 'lock'} size={24} />
            </span>
            <div>
              <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                {isPromote ? 'Опубликовать в Команду' : 'Форкнуть в Соло'}
              </h3>
              <p class="modal-subtitle" style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                {isPromote
                  ? 'Копирует текущую доску со всеми объектами в P2P меш'
                  : 'Создает изолированную приватную копию на вашем ПК'}
              </p>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {errorMsg && <div class="modal-alert-error">{errorMsg}</div>}

          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', marginBottom: '6px' }}>
              Название новой доски ({targetScope === 'team' ? 'Команда' : 'Соло'})
            </label>
            <input
              type="text"
              class="form-input"
              value={newBoardTitle}
              onInput={(e) => setNewBoardTitle((e.target as HTMLInputElement).value)}
              placeholder="Введите название..."
              style={{ width: '100%' }}
              autoFocus
            />
          </div>

          <div style={{ fontSize: '12px', color: '#94a3b8', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px' }}>
            Включает {nodeIds.length} объектов доски и связанные markdown-заметки. Оригинальная доска в {fromScope === 'solo' ? 'Соло' : 'Команде'} останется без изменений.
          </div>
        </div>

        <div class="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <button class="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </button>
          <button
            class="btn btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ minWidth: '160px' }}
          >
            {isSubmitting ? 'Копирование...' : isPromote ? 'Скопировать в Команду' : 'Скопировать в Соло'}
          </button>
        </div>
      </div>
    </div>
  );
}
