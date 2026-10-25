import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { WorkspaceScope, BoardSummary } from '@doks/shared';
import {
  transferNodesAcrossScopes,
  createBoard,
  currentScope,
  setScope,
  openTab
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

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

  const [targetBoards, setTargetBoards] = useState<BoardSummary[]>([]);
  const [selectedTargetBoardId, setSelectedTargetBoardId] = useState<string>('new');
  const [newBoardTitle, setNewBoardTitle] = useState<string>(
    isPromote ? 'Командная доска (из Соло)' : 'Личная доска (из Команды)'
  );
  const [includeLinkedNotes, setIncludeLinkedNotes] = useState<boolean>(true);
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Fetch boards in target scope
    const loadBoards = async () => {
      try {
        const res = await fetch(`/api/boards?scope=${targetScope}`);
        if (res.ok) {
          const data: BoardSummary[] = await res.json();
          setTargetBoards(data);
          if (data.length > 0) {
            setSelectedTargetBoardId(data[0].id);
          } else {
            setSelectedTargetBoardId('new');
          }
        }
      } catch (err) {
        console.error('[TransferModal] Failed to load target boards:', err);
      }
    };
    loadBoards();
  }, [targetScope]);

  const handleSubmit = async () => {
    if (nodeIds.length === 0) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let finalTargetBoardId = selectedTargetBoardId;

      if (finalTargetBoardId === 'new') {
        // Temporarily switch scope to create target board
        const savedScope = currentScope.value;
        setScope(targetScope);
        finalTargetBoardId = createBoard(newBoardTitle.trim() || 'Новая доска');
        setScope(savedScope);
      }

      const res = await transferNodesAcrossScopes({
        fromScope,
        toScope: targetScope,
        boardId,
        targetBoardId: finalTargetBoardId,
        nodeIds,
        includeLinkedNotes,
        mode: transferMode
      });

      if (res.success) {
        onClose();
      } else {
        setErrorMsg(res.error || 'Ошибка переноса элементов');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Сбой сети при переносе');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-card transfer-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-header-icon-title">
            <span class="scope-icon-large">{isPromote ? '🌐' : '🔒'}</span>
            <div>
              <h3 class="modal-title">
                {isPromote ? 'Опубликовать в Команду' : 'Форкнуть в Соло'}
              </h3>
              <p class="modal-subtitle">
                {isPromote
                  ? 'Выбранные элементы будут сгруппированы во фрейм и отправлены в P2P меш'
                  : 'Создает полностью изолированную приватную копию на вашем ПК'}
              </p>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div class="modal-body">
          {errorMsg && <div class="modal-alert-error">{errorMsg}</div>}

          <div class="form-group">
            <label class="form-label">Выбрано элементов</label>
            <div class="transfer-count-chip">
              <span>{nodeIds.length} объектов на доске</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Целевая доска ({targetScope === 'team' ? 'Команда' : 'Соло'})</label>
            <select
              class="form-select"
              value={selectedTargetBoardId}
              onChange={(e) => setSelectedTargetBoardId((e.target as HTMLSelectElement).value)}
            >
              {targetBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.nodeCount} эл.)
                </option>
              ))}
              <option value="new">+ Создать новую доску в {targetScope === 'team' ? 'Команде' : 'Соло'}</option>
            </select>
          </div>

          {selectedTargetBoardId === 'new' && (
            <div class="form-group">
              <label class="form-label">Название новой доски</label>
              <input
                type="text"
                class="form-input"
                value={newBoardTitle}
                onInput={(e) => setNewBoardTitle((e.target as HTMLInputElement).value)}
                placeholder="Введите название..."
              />
            </div>
          )}

          <div class="form-group-checkbox">
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={includeLinkedNotes}
                onChange={(e) => setIncludeLinkedNotes((e.target as HTMLInputElement).checked)}
              />
              <span>Клонировать связанные markdown-заметки</span>
            </label>
          </div>

          {isPromote && (
            <div class="form-group">
              <label class="form-label">Режим переноса</label>
              <div class="segmented-control">
                <button
                  type="button"
                  class={`seg-btn ${transferMode === 'copy' ? 'active' : ''}`}
                  onClick={() => setTransferMode('copy')}
                >
                  Копировать (сохранить в Соло)
                </button>
                <button
                  type="button"
                  class={`seg-btn ${transferMode === 'move' ? 'active' : ''}`}
                  onClick={() => setTransferMode('move')}
                >
                  Переместить
                </button>
              </div>
            </div>
          )}
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </button>
          <button
            class="btn btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting || nodeIds.length === 0}
          >
            {isSubmitting
              ? 'Перенос...'
              : isPromote
              ? 'Опубликовать в Команду'
              : 'Форкнуть в Соло'}
          </button>
        </div>
      </div>
    </div>
  );
}
