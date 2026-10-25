import { h } from 'preact';
import { useState } from 'preact/hooks';
import {
  currentView,
  selectedNoteId,
  selectedBoardId,
  notes,
  boards,
  folders,
  openTab,
  createNote,
  createBoard,
  createFolder,
  renameFolder,
  deleteNote,
  deleteBoard,
  deleteFolder,
  theme,
  setTheme,
  searchQuery,
  isCommandPaletteOpen
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

export function Sidebar() {
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [targetParentFolderId, setTargetParentFolderId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const activeBoards = boards.value.filter((b) => !b.deleted);
  const activeFolders = folders.value.filter((f) => !f.deleted);

  const query = searchQuery.value.trim().toLowerCase();
  const displayedNotes = query
    ? activeNotes.filter((n) => n.title.toLowerCase().includes(query))
    : activeNotes;

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim(), targetParentFolderId);
      setNewFolderName('');
      setShowFolderModal(false);
    }
  };

  const startRenameFolder = (id: string, name: string) => {
    setEditingFolderId(id);
    setEditingFolderName(name);
  };

  const commitRenameFolder = (id: string) => {
    if (editingFolderName.trim()) {
      renameFolder(id, editingFolderName.trim());
    }
    setEditingFolderId(null);
  };

  // Render a folder and its nested items recursively
  const renderFolder = (folderId: string, level = 0) => {
    const folder = activeFolders.find((f) => f.id === folderId);
    if (!folder) return null;

    const isCollapsed = Boolean(collapsedFolders[folderId]);
    const childFolders = activeFolders.filter((f) => f.parent === folderId);
    const childNotes = displayedNotes.filter((n) => n.folder === folderId);
    const isEditing = editingFolderId === folderId;

    return (
      <div key={folder.id} class="tree-folder-group" style={{ paddingLeft: `${level * 12}px` }}>
        <div class="tree-folder-row" onClick={() => toggleFolder(folder.id)}>
          <button class="tree-toggle-btn" onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}>
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={14} />
          </button>
          <Icon name="folder" size={15} class="tree-folder-icon" />

          {isEditing ? (
            <input
              type="text"
              class="tree-inline-input"
              value={editingFolderName}
              onInput={(e) => setEditingFolderName((e.target as HTMLInputElement).value)}
              onBlur={() => commitRenameFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRenameFolder(folder.id);
                if (e.key === 'Escape') setEditingFolderId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              class="tree-folder-name"
              onDblClick={(e) => {
                e.stopPropagation();
                startRenameFolder(folder.id, folder.name);
              }}
            >
              {folder.name}
            </span>
          )}

          <div class="tree-folder-actions" onClick={(e) => e.stopPropagation()}>
            <button
              class="tree-action-btn"
              title="Создать заметку в папке"
              onClick={() => createNote('Новая заметка', folder.id)}
            >
              <Icon name="plus" size={13} />
            </button>
            <button
              class="tree-action-btn"
              title="Переименовать папку"
              onClick={() => startRenameFolder(folder.id, folder.name)}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              class="tree-action-btn danger"
              title="Удалить папку"
              onClick={() => {
                if (confirm(`Удалить папку "${folder.name}"?`)) {
                  deleteFolder(folder.id);
                }
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div class="tree-folder-children">
            {childFolders.map((cf) => renderFolder(cf.id, level + 1))}
            {childNotes.map((note) => renderNoteItem(note, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderNoteItem = (note: any, level = 0) => {
    const isSelected = selectedNoteId.value === note.id;
    return (
      <div
        key={note.id}
        class={`tree-note-item ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${level * 12 + 18}px` }}
        onClick={() => openTab('note', note.id, note.title)}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer?.setData('application/doks-note-id', note.id);
          e.dataTransfer?.setData('text/plain', note.title);
        }}
      >
        <Icon name="file-text" size={14} class="tree-note-icon" />
        <span class="tree-note-title" title={note.title}>{note.title}</span>
        <button
          class="tree-action-btn danger"
          title="В корзину"
          onClick={(e) => {
            e.stopPropagation();
            deleteNote(note.id);
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
    );
  };

  const rootFolders = activeFolders.filter((f) => !f.parent);
  const rootNotes = displayedNotes.filter((n) => !n.folder);

  return (
    <aside class="sidebar-container">
      {/* 1. Leftmost Activity Bar */}
      <nav class="activity-bar">
        <div class="activity-top">
          <div class="activity-logo" title="Doks - Local-first Workspace">
            <Icon name="sparkles" size={20} class="brand-sparkle" />
          </div>

          <button
            class={`activity-btn ${currentView.value === 'notes' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'notes')}
            title="Заметки"
          >
            <Icon name="file-text" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'board' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'board')}
            title="Доски (Canvas)"
          >
            <Icon name="layout" size={19} />
          </button>

          <button
            class="activity-btn"
            onClick={() => (isCommandPaletteOpen.value = true)}
            title="Поиск и Команды (Ctrl+P)"
          >
            <Icon name="search" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'network' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'network')}
            title="Сеть и Участники"
          >
            <Icon name="wifi" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'history' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'history')}
            title="История и Снимки"
          >
            <Icon name="history" size={19} />
          </button>
        </div>

        <div class="activity-bottom">
          <button
            class="activity-btn"
            onClick={() => setTheme(theme.value === 'dark' ? 'light' : 'dark')}
            title={`Переключить на ${theme.value === 'dark' ? 'светлую' : 'тёмную'} тему`}
          >
            <Icon name={theme.value === 'dark' ? 'sun' : 'moon'} size={19} />
          </button>
        </div>
      </nav>

      {/* 2. Explorer Primary Pane */}
      <div class="explorer-pane">
        {currentView.value === 'notes' && (
          <div class="explorer-section">
            <div class="explorer-header">
              <span class="explorer-title">Заметки</span>
              <div class="explorer-header-actions">
                <button
                  class="header-icon-btn"
                  title="Новая папка"
                  onClick={() => {
                    setTargetParentFolderId(null);
                    setShowFolderModal(true);
                  }}
                >
                  <Icon name="folder-plus" size={16} />
                </button>
                <button
                  class="header-icon-btn"
                  title="Создать заметку"
                  onClick={() => createNote()}
                >
                  <Icon name="plus" size={16} />
                </button>
              </div>
            </div>

            <div class="explorer-search-box">
              <Icon name="search" size={14} class="explorer-search-icon" />
              <input
                type="text"
                class="explorer-search-input"
                placeholder="Фильтр по названию..."
                value={searchQuery.value}
                onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
              />
              {searchQuery.value && (
                <button class="explorer-search-clear" onClick={() => (searchQuery.value = '')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>

            <div class="explorer-tree-content">
              {rootFolders.map((f) => renderFolder(f.id, 0))}
              {rootNotes.map((n) => renderNoteItem(n, 0))}

              {displayedNotes.length === 0 && activeFolders.length === 0 && (
                <div class="explorer-empty">
                  <p>Нет заметок</p>
                  <button class="btn-secondary-sm" onClick={() => createNote()}>
                    Создать первую
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView.value === 'board' && (
          <div class="explorer-section">
            <div class="explorer-header">
              <span class="explorer-title">Доски</span>
              <button
                class="header-icon-btn"
                title="Новая доска"
                onClick={() => createBoard()}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>

            <div class="explorer-tree-content">
              {activeBoards.length === 0 ? (
                <div class="explorer-empty">
                  <p>Нет досок</p>
                  <button class="btn-secondary-sm" onClick={() => createBoard()}>
                    Создать доску
                  </button>
                </div>
              ) : (
                activeBoards.map((b) => {
                  const isSelected = selectedBoardId.value === b.id;
                  return (
                    <div
                      key={b.id}
                      class={`tree-board-item ${isSelected ? 'active' : ''}`}
                      onClick={() => openTab('board', b.id, b.title)}
                    >
                      <Icon name="layout" size={15} class="tree-board-icon" />
                      <span class="tree-board-title">{b.title}</span>
                      <button
                        class="tree-action-btn danger"
                        title="Удалить доску"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBoard(b.id);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {currentView.value !== 'notes' && currentView.value !== 'board' && (
          <div class="explorer-section compact">
            <div class="explorer-header">
              <span class="explorer-title">
                {currentView.value === 'network' ? 'Сеть' : 'История'}
              </span>
            </div>
            <div class="explorer-hint">
              {currentView.value === 'network'
                ? 'Настройка подключения и участники команды'
                : 'Снимки состояний и восстановление'}
            </div>
          </div>
        )}
      </div>

      {showFolderModal && (
        <div class="modal-backdrop" onClick={() => setShowFolderModal(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3>Создать папку</h3>
              <button class="modal-close-btn" onClick={() => setShowFolderModal(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <input
              type="text"
              class="modal-input"
              placeholder="Название папки"
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
