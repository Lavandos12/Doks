import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { WorkspaceScope } from '@doks/shared';
import {
  transferNodesAcrossScopes,
  createBoard,
  currentScope,
  soloMaps,
  teamMaps
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

  const [destinationType, setDestinationType] = useState<'new' | 'existing'>('new');
  const [selectedTargetBoardId, setSelectedTargetBoardId] = useState<string>('');
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');

  const [newBoardTitle, setNewBoardTitle] = useState<string>(
    isPromote ? 'Командная доска (из Соло)' : 'Личная доска (из Команды)'
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Collect existing boards in target scope
  const targetBoardsMap = targetScope === 'solo' ? soloMaps.boards : teamMaps.boards;
  const existingBoards: { id: string; title: string }[] = [];
  targetBoardsMap.forEach((b) => {
    if (!b.deleted) {
      existingBoards.push({ id: b.id, title: b.title });
    }
  });

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let finalTargetBoardId = selectedTargetBoardId;

      if (destinationType === 'new' || !finalTargetBoardId) {
        // Direct creation in target scope without flickering scope switch
        finalTargetBoardId = createBoard(
          newBoardTitle.trim() || (isPromote ? 'Командная доска' : 'Личная доска'),
          null,
          targetScope,
          false
        );
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
          showToast(`Элементы успешно ${actionText} в ${targetScope === 'team' ? 'Команду' : 'Соло'}`);
          onClose();
        } else {
          setErrorMsg(res.error || 'Ошибка переноса элементов');
        }
      } else {
        const actionText = transferMode === 'move' ? 'перемещена' : 'скопирована';
        showToast(`Доска успешно ${actionText} в ${targetScope === 'team' ? 'Команду' : 'Соло'}`);
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
        style={{ maxWidth: '460px', width: '100%' }}
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
                  ? 'Перенос карточек в общее P2P меш-пространство'
                  : 'Создание изолированной копии на вашем компьютере'}
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
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', marginBottom: '6px' }}>
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

          {/* Destination Type: New Board vs Existing Board */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9', marginBottom: '6px' }}>
              Целевая доска ({targetScope === 'team' ? 'Команда' : 'Соло'})
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
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
                disabled={existingBoards.length === 0}
                onClick={() => {
                  setDestinationType('existing');
                  if (!selectedTargetBoardId && existingBoards.length > 0) {
                    setSelectedTargetBoardId(existingBoards[0].id);
                  }
                }}
              >
                Существующая ({existingBoards.length})
              </button>
            </div>

            {destinationType === 'new' ? (
              <input
                type="text"
                class="form-input"
                value={newBoardTitle}
                onInput={(e) => setNewBoardTitle((e.target as HTMLInputElement).value)}
                placeholder="Введите название новой доски..."
                style={{ width: '100%' }}
                autoFocus
              />
            ) : (
              <select
                class="form-input"
                style={{ width: '100%', padding: '8px', background: '#181b24', color: '#f1f5f9' }}
                value={selectedTargetBoardId}
                onChange={(e) => setSelectedTargetBoardId((e.target as HTMLSelectElement).value)}
              >
                {existingBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
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
            disabled={isSubmitting}
            style={{ minWidth: '160px' }}
          >
            {isSubmitting
              ? 'Обработка...'
              : transferMode === 'move'
              ? (isPromote ? 'Переместить в Команду' : 'Переместить в Соло')
              : (isPromote ? 'Скопировать в Команду' : 'Скопировать в Соло')}
          </button>
        </div>
      </div>
    </div>
  );
}
