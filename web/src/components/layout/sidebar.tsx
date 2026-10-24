import { h } from 'preact';
import { useState } from 'preact/hooks';
import {
  currentView,
  selectedNoteId,
  selectedBoardId,
  notes,
  boards,
  folders,
  createNote,
  createBoard,
  createFolder,
  deleteNote,
  deleteBoard,
  deleteFolder,
  theme,
  searchQuery
} from '../../state/app-state.js';

export function Sidebar() {
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const activeBoards = boards.value.filter((b) => !b.deleted);
  const activeFolders = folders.value.filter((f) => !f.deleted);

  // Filter notes by search query if present
  const query = searchQuery.value.trim().toLowerCase();
  const displayedNotes = query
    ? activeNotes.filter((n) => n.title.toLowerCase().includes(query))
    : activeNotes;

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim(), activeFolderId);
      setNewFolderName('');
      setShowFolderModal(false);
    }
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <span class="logo-icon">💠</span>
          <span class="logo-title">Doks</span>
        </div>
        <div class="header-actions">
          <button
            class="theme-toggle"
            title="Переключить тему"
            onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}
          >
            {theme.value === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      <div class="search-box">
        <input
          type="text"
          class="search-input"
          placeholder="Поиск заметок..."
          value={searchQuery.value}
          onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
        />
        {searchQuery.value && (
          <button class="clear-search" onClick={() => (searchQuery.value = '')}>
            ✕
          </button>
        )}
      </div>

      <div class="nav-tabs">
        <button
          class={`tab-btn ${currentView.value === 'notes' ? 'active' : ''}`}
          onClick={() => (currentView.value = 'notes')}
        >
          Заметки
        </button>
        <button
          class={`tab-btn ${currentView.value === 'board' ? 'active' : ''}`}
          onClick={() => (currentView.value = 'board')}
        >
          Доски
        </button>
        <button
          class={`tab-btn ${currentView.value === 'network' ? 'active' : ''}`}
          onClick={() => (currentView.value = 'network')}
        >
          Сеть
        </button>
        <button
          class={`tab-btn ${currentView.value === 'history' ? 'active' : ''}`}
          onClick={() => (currentView.value = 'history')}
        >
          История
        </button>
      </div>

      <div class="sidebar-content">
        {currentView.value === 'notes' && (
          <div class="notes-tree-section">
            <div class="section-title-bar">
              <span class="section-title">Все заметки</span>
              <div class="action-buttons">
                <button
                  class="icon-btn"
                  title="Новая папка"
                  onClick={() => setShowFolderModal(true)}
                >
                  📁+
                </button>
                <button
                  class="icon-btn"
                  title="Новая заметка"
                  onClick={() => createNote('Новая заметка', activeFolderId)}
                >
                  📝+
                </button>
              </div>
            </div>

            {/* Folders List */}
            {activeFolders.length > 0 && (
              <div class="folders-group">
                {activeFolders.map((f) => (
                  <div
                    key={f.id}
                    class={`folder-item ${activeFolderId === f.id ? 'selected' : ''}`}
                    onClick={() =>
                      setActiveFolderId(activeFolderId === f.id ? null : f.id)
                    }
                  >
                    <span class="folder-icon">📂</span>
                    <span class="folder-name">{f.name}</span>
                    <button
                      class="delete-btn"
                      title="Удалить папку"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFolder(f.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Notes List */}
            <div class="notes-list">
              {displayedNotes.length === 0 ? (
                <div class="empty-state">Нет заметок</div>
              ) : (
                displayedNotes.map((note) => (
                  <div
                    key={note.id}
                    class={`note-tree-item ${
                      selectedNoteId.value === note.id ? 'active' : ''
                    }`}
                    onClick={() => {
                      selectedNoteId.value = note.id;
                      currentView.value = 'notes';
                    }}
                  >
                    <span class="note-icon">📄</span>
                    <span class="note-item-title">{note.title}</span>
                    <button
                      class="delete-btn"
                      title="Удалить"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {currentView.value === 'board' && (
          <div class="boards-section">
            <div class="section-title-bar">
              <span class="section-title">Доски</span>
              <button
                class="icon-btn"
                title="Новая доска"
                onClick={() => createBoard()}
              >
                ➕
              </button>
            </div>
            <div class="boards-list">
              {activeBoards.length === 0 ? (
                <div class="empty-state">Нет досок</div>
              ) : (
                activeBoards.map((b) => (
                  <div
                    key={b.id}
                    class={`board-tree-item ${
                      selectedBoardId.value === b.id ? 'active' : ''
                    }`}
                    onClick={() => {
                      selectedBoardId.value = b.id;
                      currentView.value = 'board';
                    }}
                  >
                    <span class="board-icon">📋</span>
                    <span class="board-item-title">{b.title}</span>
                    <button
                      class="delete-btn"
                      title="Удалить"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteBoard(b.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {showFolderModal && (
        <div class="modal-backdrop" onClick={() => setShowFolderModal(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Создать папку</h3>
            <input
              type="text"
              class="modal-input"
              placeholder="Имя папки"
              value={newFolderName}
              onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              autoFocus
            />
            <div class="modal-buttons">
              <button class="btn-cancel" onClick={() => setShowFolderModal(false)}>
                Отмена
              </button>
              <button class="btn-primary" onClick={handleCreateFolder}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
