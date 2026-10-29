import { h } from 'preact';
import { useState } from 'preact/hooks';
import { notes, createNote } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

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
    const titleToUse = newTitle.trim() || t('notes.default_title');
    const newId = createNote(titleToUse);
    onSelectNote(newId, titleToUse);
    onClose();
  };

  return (
    <div class="modal-overlay doks-modal-backdrop note-picker-backdrop" onClick={onClose}>
      <div class="modal-card doks-modal-dialog note-picker-dialog liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="file-text" size={18} class="text-accent" />
            <h3 class="modal-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{t('notePicker.title')}</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body">
          {isCreating ? (
            <div class="note-picker-create-form">
              <label class="modal-label">{t('notePicker.createNew')}</label>
              <input
                type="text"
                class="modal-input"
                placeholder={t('notePicker.newPlaceholder')}
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
                  {t('common.cancel')}
                </button>
                <button class="btn btn-primary" onClick={handleCreate}>
                  {t('notePicker.createAndAdd')}
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
                  placeholder={t('sidebar.search_placeholder')}
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
                  <span>{t('notePicker.createNew')}</span>
                </button>
              </div>

              <div class="note-picker-list">
                {filteredNotes.length === 0 ? (
                  <div class="empty-state-notice">
                    {query ? t('notePicker.notFound') : t('notePicker.noneAvailable')}
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
