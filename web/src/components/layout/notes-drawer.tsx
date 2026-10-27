import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  notes,
  createNote,
  currentScope,
  yjsClient,
  getScopedNoteDocName
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface NotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onDropNoteToCanvas?: (noteId: string, title: string, text: string) => void;
}

export function NotesDrawer({
  isOpen,
  onClose,
  onDropNoteToCanvas
}: NotesDrawerProps): VNode | null {
  if (!isOpen) return null;

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const [selectedId, setSelectedId] = useState<string>(() => {
    return activeNotes[0]?.id || '';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');

  // If selectedId changed or list changed, sync current note data
  useEffect(() => {
    if (!selectedId && activeNotes.length > 0) {
      setSelectedId(activeNotes[0].id);
      return;
    }

    if (selectedId) {
      const n = activeNotes.find((x) => x.id === selectedId);
      if (n) {
        setNoteTitle(n.title);
        try {
          const doc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, selectedId));
          const yText = doc.getText('text');
          setNoteText(yText.toString());
        } catch {
          setNoteText('');
        }
      }
    }
  }, [selectedId, activeNotes.length, currentScope.value]);

  const handleCreateNew = () => {
    const newId = createNote('Новая заметка');
    setSelectedId(newId);
    showToast('Создана новая заметка');
  };

  const handleTextChange = (newVal: string) => {
    setNoteText(newVal);
    if (selectedId) {
      try {
        const doc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, selectedId));
        const yText = doc.getText('text');
        doc.transact(() => {
          yText.delete(0, yText.length);
          yText.insert(0, newVal);
        }, 'user');
      } catch (err) {
        console.error('Failed to sync note text:', err);
      }
    }
  };

  const handleDropToCanvas = () => {
    if (!selectedId) return;
    onDropNoteToCanvas?.(selectedId, noteTitle || 'Заметка', noteText);
    showToast(`Заметка "${noteTitle}" добавлена на холст`);
  };

  const filtered = activeNotes.filter((n) =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      class="notes-slide-drawer miro-notes-drawer liquid-glass-surface"
      data-testid="notes-slide-drawer"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div class="notes-drawer-header">
        <div class="notes-drawer-title-row">
          <Icon name="file-text" size={17} class="text-accent" />
          <span>Заметки ({currentScope.value === 'solo' ? 'Соло' : 'Команда'})</span>
        </div>
        <div class="notes-drawer-actions">
          <button class="btn-primary-xs" onClick={handleCreateNew} title="Создать заметку">
            <Icon name="plus" size={13} />
            <span>Новая</span>
          </button>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div class="notes-drawer-body">
        {/* Search */}
        <div class="notes-drawer-search-bar">
          <Icon name="search" size={13} color="#94a3b8" />
          <input
            type="text"
            class="notes-drawer-search-input"
            placeholder="Поиск по заметкам..."
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Note list */}
        {filtered.length > 0 && (
          <div class="notes-drawer-list">
            {filtered.map((n) => (
              <div
                key={n.id}
                class={`notes-drawer-item ${n.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(n.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  <Icon name="file-text" size={12} />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {n.title || 'Без названия'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Editor Area */}
        {selectedId ? (
          <div class="notes-drawer-editor-area">
            <input
              type="text"
              class="notes-drawer-note-title"
              value={noteTitle}
              onInput={(e) => setNoteTitle((e.target as HTMLInputElement).value)}
              placeholder="Название заметки..."
            />
            <textarea
              class="notes-drawer-editor-body"
              value={noteText}
              onInput={(e) => handleTextChange((e.target as HTMLTextAreaElement).value)}
              placeholder="Пишите markdown здесь... Поддерживаются списки - [ ], заголовки #, ссылки [[связи]]."
            />
          </div>
        ) : (
          <div class="miro-empty-notes">
            <Icon name="file-text" size={32} />
            <p>Нет заметок в этом пространстве</p>
            <button class="btn-primary-sm" onClick={handleCreateNew}>
              Создать первую заметку
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedId && (
        <div class="notes-drawer-footer">
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            Автосохранение в Markdown
          </span>
          <button class="btn-drop-to-canvas" onClick={handleDropToCanvas} title="Поместить заметку на холст">
            <Icon name="plus" size={13} />
            <span>На доску</span>
          </button>
        </div>
      )}
    </div>
  );
}
