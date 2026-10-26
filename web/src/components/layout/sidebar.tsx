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
  renameBoard,
  deleteNote,
  deleteBoard,
  deleteFolder,
  theme,
  setTheme,
  searchQuery,
  isCommandPaletteOpen,
  currentScope,
  setScope,
  isSidebarCollapsed,
  toggleSidebar
} from '../../state/app-state.js';
import { t } from '../../i18n/index.js';
import { Icon } from '../../ui/icons.js';
import { showConfirm } from '../../ui/dialogs.js';

export function Sidebar() {
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [targetParentFolderId, setTargetParentFolderId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingBoardTitle, setEditingBoardTitle] = useState('');

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
              onClick={async () => {
                const ok = await showConfirm({
                  title: 'Удаление папки',
                  message: `Удалить папку "${folder.name}"? Заметки внутри не будут удалены.`,
                  confirmText: 'Удалить',
                  danger: true
                });
                if (ok) {
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
          e.dataTransfer?.setData('application/x-doks-note', note.id);
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
            title={t('sidebar.notes')}
          >
            <Icon name="file-text" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'board' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'board')}
            title={t('sidebar.boards')}
          >
            <Icon name="layout" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'search' ? 'active' : ''}`}
            onClick={() => (currentView.value = currentView.value === 'search' ? 'notes' : 'search')}
            title={t('search.title')}
          >
            <Icon name="search" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'network' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'network')}
            title={t('sidebar.network')}
          >
            <Icon name="wifi" size={19} />
          </button>

          <button
            class={`activity-btn ${currentView.value === 'history' ? 'active' : ''}`}
            onClick={() => (currentView.value = 'history')}
            title={t('sidebar.history')}
          >
            <Icon name="history" size={19} />
          </button>
        </div>

        <div class="activity-bottom">
          <button
            class="activity-btn toggle-sidebar-btn"
            onClick={toggleSidebar}
            title={isSidebarCollapsed.value ? 'Развернуть панель (Ctrl+B)' : 'Свернуть панель (Ctrl+B)'}
          >
            <Icon name={isSidebarCollapsed.value ? 'chevron-right' : 'sidebar-left'} size={19} />
          </button>
          <button
            class="activity-btn"
            onClick={() => setTheme(theme.value === 'dark' ? 'light' : 'dark')}
            title={`Theme: ${theme.value === 'dark' ? 'Light' : 'Dark'}`}
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
              <span class="explorer-title">{t('sidebar.notes')}</span>
              <div class="explorer-header-actions">
                <button
                  class="header-icon-btn"
                  title={t('sidebar.new_folder')}
                  onClick={() => {
                    setTargetParentFolderId(null);
                    setShowFolderModal(true);
                  }}
                >
                  <Icon name="folder-plus" size={16} />
                </button>
                <button
                  class="header-icon-btn"
                  title={t('sidebar.new_note')}
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
                placeholder={t('sidebar.search_placeholder')}
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
                  <p>{t('sidebar.no_notes')}</p>
                  <button class="btn-secondary-sm" onClick={() => createNote()}>
                    {t('sidebar.create_note')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView.value === 'board' && (
          <div class="explorer-section">
            <div class="explorer-header">
              <span class="explorer-title">{t('sidebar.boards')}</span>
              <button
                class="header-icon-btn"
                title={t('sidebar.new_board')}
                onClick={() => createBoard()}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>

            <div class="explorer-tree-content">
              {activeBoards.length === 0 ? (
                <div class="explorer-empty">
                  <p>{t('sidebar.no_boards')}</p>
                  <button class="btn-secondary-sm" onClick={() => createBoard()}>
                    {t('sidebar.create_board')}
                  </button>
                </div>
              ) : (
                activeBoards.map((b) => {
                  const isSelected = selectedBoardId.value === b.id;
                  const isEditing = editingBoardId === b.id;
                  return (
                    <div
                      key={b.id}
                      class={`tree-board-item ${isSelected ? 'active' : ''}`}
                      onClick={() => openTab('board', b.id, b.title)}
                    >
                      <Icon name="layout" size={15} class="tree-board-icon" />
                      {isEditing ? (
                        <input
                          type="text"
                          class="tree-inline-input"
                          value={editingBoardTitle}
                          onInput={(e) => setEditingBoardTitle((e.target as HTMLInputElement).value)}
                          onBlur={() => {
                            if (editingBoardTitle.trim()) {
                              renameBoard(b.id, editingBoardTitle.trim());
                            }
                            setEditingBoardId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (editingBoardTitle.trim()) {
                                renameBoard(b.id, editingBoardTitle.trim());
                              }
                              setEditingBoardId(null);
                            }
                            if (e.key === 'Escape') setEditingBoardId(null);
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          class="tree-board-title"
                          onDblClick={(e) => {
                            e.stopPropagation();
                            setEditingBoardId(b.id);
                            setEditingBoardTitle(b.title);
                          }}
                          title="Двойной клик для переименования"
                        >
                          {b.title}
                        </span>
                      )}
                      <div class="tree-board-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          class="tree-action-btn"
                          title="Переименовать доску (F2)"
                          onClick={() => {
                            setEditingBoardId(b.id);
                            setEditingBoardTitle(b.title);
                          }}
                        >
                          <Icon name="edit" size={12} />
                        </button>
                        <button
                          class="tree-action-btn danger"
                          title={t('sidebar.delete_board')}
                          onClick={async () => {
                            const ok = await showConfirm({
                              title: 'Удаление доски',
                              message: `Переместить доску "${b.title}" в корзину?`,
                              confirmText: 'Удалить',
                              danger: true
                            });
                            if (ok) {
                              deleteBoard(b.id);
                            }
                          }}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
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
                {currentView.value === 'network' ? t('sidebar.network') : t('sidebar.history')}
              </span>
            </div>
            <div class="explorer-hint">
              {currentView.value === 'network'
                ? t('network.title')
                : t('history.title')}
            </div>
          </div>
        )}
      </div>

      {showFolderModal && (
        <div class="modal-backdrop" onClick={() => setShowFolderModal(false)}>
          <div class="modal-card" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3>{t('sidebar.modal_folder_title')}</h3>
              <button class="modal-close-btn" onClick={() => setShowFolderModal(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <input
              type="text"
              class="modal-input"
              placeholder={t('sidebar.modal_folder_placeholder')}
              value={newFolderName}
              onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              autoFocus
            />
            <div class="modal-buttons">
              <button class="btn-cancel" onClick={() => setShowFolderModal(false)}>
                {t('sidebar.cancel')}
              </button>
              <button class="btn-primary" onClick={handleCreateFolder}>
                {t('sidebar.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
