import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { WorkspaceScope } from '@doks/shared';
import {
  transferNodesAcrossScopes,
  createBoard,
  allBoards
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

  const candidateBoards = allBoards.value.filter((b) => b.id !== boardId && !b.deleted);

  const [destinationType, setDestinationType] = useState<'new' | 'existing'>(
    candidateBoards.length > 0 ? 'existing' : 'new'
  );
  const [selectedTargetBoardId, setSelectedTargetBoardId] = useState<string>(
    candidateBoards[0]?.id || ''
  );
  const [newBoardScope, setNewBoardScope] = useState<WorkspaceScope>(fromScope === 'solo' ? 'team' : 'solo');
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');

  const [newBoardTitle, setNewBoardTitle] = useState<string>(
    fromScope === 'solo' ? 'Общая доска' : 'Черновик'
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let finalTargetBoardId = selectedTargetBoardId;
      let targetScope: WorkspaceScope = fromScope;

      if (destinationType === 'new' || !finalTargetBoardId) {
        targetScope = newBoardScope;
        finalTargetBoardId = createBoard(
          newBoardTitle.trim() || 'Новая доска',
          null,
          targetScope,
          false
        );
      } else {
        const found = candidateBoards.find((b) => b.id === finalTargetBoardId);
        targetScope = found?.scope || fromScope;
      }

      if (nodeIds.length > 0) {
        const res = await transferNodesAcrossScopes({
          fromScope,
          toScope: targetScope,
          boardId,
          targetBoardId: finalTargetBoardId,
          nodeIds,
          includeLinkedNotes: true,
          mode: transferMode
        });

        if (res.success) {
          const actionText = transferMode === 'move' ? 'перемещены' : 'скопированы';
          showToast(`Элементы успешно ${actionText} на целевую доску`, 'success');
          onClose();
        } else {
          setErrorMsg(res.error || 'Ошибка переноса элементов');
        }
      } else {
        showToast('Нет выбранных объектов для переноса', 'info');
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
        style={{ maxWidth: '480px', width: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <div class="modal-header-icon-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span class="scope-icon-large text-accent">
              <Icon name="share" size={22} />
            </span>
            <div>
              <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                Перенос объектов на другую доску
              </h3>
              <p class="modal-subtitle" style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Копирование или перемещение карточек и схем между досками
              </p>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {errorMsg && <div class="modal-alert-error">{errorMsg}</div>}

          {/* Mode Selector: Copy vs Move */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', marginBottom: '6px', display: 'block' }}>
              Режим операции
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                class={`btn-secondary ${transferMode === 'copy' ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: transferMode === 'copy' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                  borderColor: transferMode === 'copy' ? '#6366f1' : 'rgba(255,255,255,0.14)',
                  color: transferMode === 'copy' ? '#a5b4fc' : '#cbd5e1'
                }}
                onClick={() => setTransferMode('copy')}
              >
                Копировать
              </button>
              <button
                type="button"
                class={`btn-secondary ${transferMode === 'move' ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: transferMode === 'move' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                  borderColor: transferMode === 'move' ? '#6366f1' : 'rgba(255,255,255,0.14)',
                  color: transferMode === 'move' ? '#a5b4fc' : '#cbd5e1'
                }}
                onClick={() => setTransferMode('move')}
              >
                Переместить
              </button>
            </div>
          </div>

          {/* Destination Type: Existing Board vs New Board */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', marginBottom: '6px', display: 'block' }}>
              Целевая доска
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                type="button"
                class={`btn-secondary ${destinationType === 'existing' ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: destinationType === 'existing' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                  borderColor: destinationType === 'existing' ? '#6366f1' : 'rgba(255,255,255,0.14)'
                }}
                disabled={candidateBoards.length === 0}
                onClick={() => {
                  setDestinationType('existing');
                  if (!selectedTargetBoardId && candidateBoards.length > 0) {
                    setSelectedTargetBoardId(candidateBoards[0].id);
                  }
                }}
              >
                Существующая ({candidateBoards.length})
              </button>
              <button
                type="button"
                class={`btn-secondary ${destinationType === 'new' ? 'active' : ''}`}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: destinationType === 'new' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                  borderColor: destinationType === 'new' ? '#6366f1' : 'rgba(255,255,255,0.14)'
                }}
                onClick={() => setDestinationType('new')}
              >
                Новая доска
              </button>
            </div>

            {destinationType === 'existing' ? (
              <select
                class="form-input text-input"
                style={{ width: '100%', padding: '8px 10px', background: '#12151f', color: '#f1f5f9', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)' }}
                value={selectedTargetBoardId}
                onChange={(e) => setSelectedTargetBoardId((e.target as HTMLSelectElement).value)}
              >
                {candidateBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} [{b.scope === 'team' ? 'Общая' : 'Личная'}]
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  class="form-input text-input"
                  value={newBoardTitle}
                  onInput={(e) => setNewBoardTitle((e.target as HTMLInputElement).value)}
                  placeholder="Введите название новой доски..."
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff' }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    class={`btn-secondary ${newBoardScope === 'solo' ? 'active' : ''}`}
                    onClick={() => setNewBoardScope('solo')}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      background: newBoardScope === 'solo' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      borderColor: newBoardScope === 'solo' ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                      color: newBoardScope === 'solo' ? '#60a5fa' : 'var(--text-secondary)'
                    }}
                  >
                    Личная
                  </button>
                  <button
                    type="button"
                    class={`btn-secondary ${newBoardScope === 'team' ? 'active' : ''}`}
                    onClick={() => setNewBoardScope('team')}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      background: newBoardScope === 'team' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                      borderColor: newBoardScope === 'team' ? '#10b981' : 'rgba(255,255,255,0.12)',
                      color: newBoardScope === 'team' ? '#34d399' : 'var(--text-secondary)'
                    }}
                  >
                    Общая
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ fontSize: '12px', color: '#94a3b8', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px' }}>
            Объектов к переносу: {nodeIds.length}. Связанные markdown-заметки будут скопированы автоматически.
          </div>
        </div>

        <div class="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <button class="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </button>
          <button
            class="btn btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting || (destinationType === 'existing' && candidateBoards.length === 0)}
            style={{ minWidth: '150px' }}
          >
            {isSubmitting
              ? 'Обработка...'
              : transferMode === 'move'
              ? 'Переместить'
              : 'Скопировать'}
          </button>
        </div>
      </div>
    </div>
  );
}
