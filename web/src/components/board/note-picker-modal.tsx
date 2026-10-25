import { h } from 'preact';
import { useState } from 'preact/hooks';
import { notes, createNote } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

interface NotePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string, title: string) => void;
}

export function NotePickerModal({ isOpen, onClose, onSelectNote }: NotePickerModalProps) {
  if (!isOpen) return null;

  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const filteredNotes = query.trim()
    ? activeNotes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase()))
    : activeNotes;

  const handleCreate = () => {
    const titleToUse = newTitle.trim() || 'Новая заметка';
    const newId = createNote(titleToUse);
    onSelectNote(newId, titleToUse);
    onClose();
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-dialog note-picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title-row">
            <Icon name="file-text" size={18} />
            <h3>Добавить карточку заметки на доску</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body">
          {isCreating ? (
            <div class="note-picker-create-form">
              <label class="modal-label">Название новой заметки:</label>
              <input
                type="text"
                class="modal-input"
                placeholder="Введите название..."
                value={newTitle}
                onInput={(e) => setNewTitle((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setIsCreating(false);
                }}
                autoFocus
              />
              <div class="modal-actions-row" style={{ marginTop: '12px' }}>
                <button class="btn btn-secondary" onClick={() => setIsCreating(false)}>
                  Назад к списку
                </button>
                <button class="btn btn-primary" onClick={handleCreate}>
                  Создать и прикрепить
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div class="note-picker-search-bar">
                <Icon name="search" size={14} class="search-bar-icon" />
                <input
                  type="text"
                  class="modal-input search-input"
                  placeholder="Поиск заметки по названию..."
                  value={query}
                  onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                  autoFocus
                />
              </div>

              <div class="note-picker-actions-bar" style={{ margin: '10px 0' }}>
                <button
                  class="btn btn-secondary btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => setIsCreating(true)}
                >
                  <Icon name="plus" size={14} />
                  <span>Создать новую заметку</span>
                </button>
              </div>

              <div class="note-picker-list">
                {filteredNotes.length === 0 ? (
                  <div class="empty-state-notice">
                    {query ? 'Заметки не найдены' : 'Нет доступных заметок'}
                  </div>
                ) : (
                  filteredNotes.map((note) => (
                    <div
                      key={note.id}
                      class="note-picker-item"
                      onClick={() => {
                        onSelectNote(note.id, note.title);
                        onClose();
                      }}
                    >
                      <Icon name="file-text" size={15} />
                      <span class="note-picker-item-title">{note.title}</span>
                      <span class="note-picker-item-date">
                        {new Date(note.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
