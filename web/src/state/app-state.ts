import { signal, computed } from '@preact/signals';
import type { NoteMeta, BoardMeta, FolderMeta } from '@doks/shared';
import { getIndexMaps, getNoteDocName, getBoardDocName, getBoardMaps } from '@doks/shared';
import { yjsClient } from './yjs-client.js';
import { NotesSearchIndex } from '../search/indexer.js';

export const searchIndex = new NotesSearchIndex();

export type ViewType = 'notes' | 'board' | 'network' | 'history' | 'search';

export interface TabItem {
  id: string;
  type: 'note' | 'board';
  title: string;
  pinned?: boolean;
}

// Persisted theme (B16)
const savedTheme = typeof localStorage !== 'undefined' ? (localStorage.getItem('doks_theme') as 'dark' | 'light') : null;
export const theme = signal<'dark' | 'light'>(savedTheme || 'dark');

export function setTheme(t: 'dark' | 'light'): void {
  theme.value = t;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('doks_theme', t);
  }
}

export const currentView = signal<ViewType>('notes');
export const selectedNoteId = signal<string | null>(null);
export const selectedBoardId = signal<string | null>(null);
export const searchQuery = signal<string>('');

export const notes = signal<NoteMeta[]>([]);
export const boards = signal<BoardMeta[]>([]);
export const folders = signal<FolderMeta[]>([]);

// Tabs & Split View
export const openTabs = signal<TabItem[]>([]);
export const activeTabId = signal<string | null>(null);
export const splitTabId = signal<string | null>(null);
export const isSplitView = signal<boolean>(false);

// Modals
export const isCommandPaletteOpen = signal<boolean>(false);
export const isQuickSwitcherOpen = signal<boolean>(false);
export const isImportWizardOpen = signal<boolean>(false);

// Initialize index observer
const indexDoc = yjsClient.getIndexDoc();
export const maps = getIndexMaps(indexDoc);

function syncIndexSignals() {
  const noteList: NoteMeta[] = [];
  maps.notes.forEach((val) => noteList.push(val));
  notes.value = noteList;

  const boardList: BoardMeta[] = [];
  maps.boards.forEach((val) => boardList.push(val));
  boards.value = boardList;

  const folderList: FolderMeta[] = [];
  maps.folders.forEach((val) => folderList.push(val));
  folders.value = folderList;

  // Sync tab titles if doc renamed
  const updatedTabs = openTabs.value.map((tab) => {
    if (tab.type === 'note') {
      const n = maps.notes.get(tab.id);
      if (n && n.title !== tab.title) return { ...tab, title: n.title };
    } else if (tab.type === 'board') {
      const b = maps.boards.get(tab.id);
      if (b && b.title !== tab.title) return { ...tab, title: b.title };
    }
    return tab;
  });
  openTabs.value = updatedTabs;

  // Incremental Search Indexing (F6)
  maps.notes.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      let text = '';
      try {
        const noteDoc = yjsClient.getOrCreateDoc(getNoteDocName(id));
        text = noteDoc.getText('text').toString();
      } catch {}
      const tags = text.match(/#[a-zA-Zа-яА-Я0-9_-]+/g) || [];
      searchIndex.updateDoc({
        id,
        type: 'note',
        title: val.title,
        folder: val.folder || undefined,
        text,
        tags
      });
    }
  });

  maps.boards.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      let boardText = '';
      try {
        const bDoc = yjsClient.getOrCreateDoc(getBoardDocName(id));
        const { nodes } = getBoardMaps(bDoc);
        const parts: string[] = [];
        nodes.forEach((nodeMap) => {
          const t = nodeMap.get('text');
          if (t) parts.push(typeof t === 'string' ? t : t.toString());
        });
        boardText = parts.join('\n');
      } catch {}
      searchIndex.updateDoc({
        id,
        type: 'board',
        title: val.title,
        folder: val.folder || undefined,
        text: boardText
      });
    }
  });
}

maps.notes.observe(() => syncIndexSignals());
maps.boards.observe(() => syncIndexSignals());
maps.folders.observe(() => syncIndexSignals());
syncIndexSignals();

export function openTab(type: 'note' | 'board', id: string, title?: string): void {
  const existing = openTabs.value.find((t) => t.id === id);
  if (!existing) {
    const docTitle =
      title ||
      (type === 'note'
        ? maps.notes.get(id)?.title || 'Без названия'
        : maps.boards.get(id)?.title || 'Безымянная доска');
    openTabs.value = [...openTabs.value, { id, type, title: docTitle }];
  }

  activeTabId.value = id;
  if (type === 'note') {
    selectedNoteId.value = id;
    currentView.value = 'notes';
  } else {
    selectedBoardId.value = id;
    currentView.value = 'board';
  }
}

export function closeTab(id: string): void {
  const tab = openTabs.value.find((t) => t.id === id);
  if (tab?.pinned) return; // Pinned tabs cannot be closed directly

  const remaining = openTabs.value.filter((t) => t.id !== id);
  openTabs.value = remaining;

  if (splitTabId.value === id) {
    splitTabId.value = null;
    isSplitView.value = false;
  }

  if (activeTabId.value === id) {
    if (remaining.length > 0) {
      const nextTab = remaining[remaining.length - 1];
      openTab(nextTab.type, nextTab.id, nextTab.title);
    } else {
      activeTabId.value = null;
      selectedNoteId.value = null;
      selectedBoardId.value = null;
    }
  }
}

export function togglePinTab(id: string): void {
  openTabs.value = openTabs.value.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
}

export function toggleSplitView(): void {
  if (isSplitView.value) {
    isSplitView.value = false;
    splitTabId.value = null;
  } else {
    // Pick another open tab if available, else duplicate or note/board
    const other = openTabs.value.find((t) => t.id !== activeTabId.value);
    if (other) {
      splitTabId.value = other.id;
      isSplitView.value = true;
    } else {
      isSplitView.value = true;
      splitTabId.value = activeTabId.value;
    }
  }
}

export function createNote(title = 'Новая заметка', folder: string | null = null): string {
  const id = crypto.randomUUID();
  const meta: NoteMeta = {
    id,
    title,
    folder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  indexDoc.transact(() => {
    maps.notes.set(id, meta);
  });

  // Pre-seed note doc
  const noteDoc = yjsClient.getOrCreateDoc(getNoteDocName(id));
  const text = noteDoc.getText('text');
  if (text.length === 0) {
    text.insert(0, `# ${title}\n\n`);
  }

  openTab('note', id, title);
  return id;
}

export function createBoard(title = 'Новая доска', folder: string | null = null): string {
  const id = crypto.randomUUID();
  const meta: BoardMeta = {
    id,
    title,
    folder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  indexDoc.transact(() => {
    maps.boards.set(id, meta);
  });

  openTab('board', id, title);
  return id;
}

export function createFolder(name = 'Новая папка', parent: string | null = null): string {
  const id = crypto.randomUUID();
  const meta: FolderMeta = {
    id,
    name,
    parent,
    deleted: false
  };

  indexDoc.transact(() => {
    maps.folders.set(id, meta);
  });

  return id;
}

/**
 * Renames a note and automatically updates wikilinks [[Old Title]] -> [[New Title]] across all notes (B19).
 */
export function renameNote(id: string, newTitle: string): void {
  const existing = maps.notes.get(id);
  if (!existing || existing.title === newTitle) return;

  const oldTitle = existing.title;

  indexDoc.transact(() => {
    maps.notes.set(id, {
      ...existing,
      title: newTitle,
      updatedAt: Date.now()
    });
  });

  // B19: Refactor wikilinks across all active notes
  const escaped = oldTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'gi');

  maps.notes.forEach((meta, otherNoteId) => {
    if (meta.deleted) return;
    try {
      const otherDoc = yjsClient.getOrCreateDoc(getNoteDocName(otherNoteId));
      const text = otherDoc.getText('text');
      const content = text.toString();

      if (regex.test(content)) {
        const updated = content.replace(regex, (_, aliasPart) => {
          return aliasPart ? `[[${newTitle}${aliasPart}]]` : `[[${newTitle}]]`;
        });
        otherDoc.transact(() => {
          text.delete(0, text.length);
          text.insert(0, updated);
        });
      }
    } catch (err) {
      console.error(`[App] Error updating wikilinks in note ${otherNoteId}:`, err);
    }
  });
}

export function renameBoard(id: string, newTitle: string): void {
  const existing = maps.boards.get(id);
  if (existing) {
    maps.boards.set(id, {
      ...existing,
      title: newTitle
    });
  }
}

export function renameFolder(id: string, newName: string): void {
  const existing = maps.folders.get(id);
  if (existing) {
    maps.folders.set(id, {
      ...existing,
      name: newName
    });
  }
}

export function moveNote(id: string, newFolder: string | null): void {
  const existing = maps.notes.get(id);
  if (existing) {
    maps.notes.set(id, {
      ...existing,
      folder: newFolder,
      updatedAt: Date.now()
    });
  }
}

export function deleteNote(id: string): void {
  const existing = maps.notes.get(id);
  if (existing) {
    maps.notes.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function restoreNote(id: string): void {
  const existing = maps.notes.get(id);
  if (existing) {
    maps.notes.set(id, {
      ...existing,
      deleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    });
  }
}

export function deleteBoard(id: string): void {
  const existing = maps.boards.get(id);
  if (existing) {
    maps.boards.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function deleteFolder(id: string): void {
  const existing = maps.folders.get(id);
  if (existing) {
    maps.folders.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
  }
}

// Global hotkey listeners for desktop feel
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Ctrl+W: Close active tab
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeTabId.value) {
        closeTab(activeTabId.value);
      }
    }

    // Ctrl+Tab: Cycle through open tabs
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const tabs = openTabs.value;
      if (tabs.length > 1 && activeTabId.value) {
        const idx = tabs.findIndex((t) => t.id === activeTabId.value);
        const nextIdx = (idx + 1) % tabs.length;
        const nextTab = tabs[nextIdx];
        openTab(nextTab.type, nextTab.id, nextTab.title);
      }
    }

    // Ctrl+P: Command palette
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
      isQuickSwitcherOpen.value = false;
    }

    // Ctrl+O: Quick switcher
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      isQuickSwitcherOpen.value = !isQuickSwitcherOpen.value;
      isCommandPaletteOpen.value = false;
    }

    // Ctrl+Shift+F: Global Search (F6)
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      currentView.value = 'search';
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      if (isCommandPaletteOpen.value || isQuickSwitcherOpen.value) {
        isCommandPaletteOpen.value = false;
        isQuickSwitcherOpen.value = false;
      }
    }
  });
}
