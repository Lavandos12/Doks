import { signal, computed } from '@preact/signals';
import type {
  NoteMeta,
  BoardMeta,
  FolderMeta,
  WorkspaceScope,
  BridgeTransferRequest,
  BridgeTransferResponse
} from '@doks/shared';
import {
  getIndexMaps,
  getNoteDocName,
  getBoardDocName,
  getScopedIndexDocName,
  getScopedNoteDocName,
  getScopedBoardDocName,
  getBoardMaps,
  DOC_INDEX
} from '@doks/shared';
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

// Two-Tier Workspace Scope
const savedScope = typeof localStorage !== 'undefined' ? (localStorage.getItem('doks_scope') as WorkspaceScope) : null;
export const currentScope = signal<WorkspaceScope>(savedScope || 'team');

export const isSidebarCollapsed = signal<boolean>(false);
export function toggleSidebar(): void {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

export function setScope(newScope: WorkspaceScope): void {
  if (currentScope.value === newScope) return;
  currentScope.value = newScope;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('doks_scope', newScope);
  }
  yjsClient.switchScope(newScope);
  syncIndexSignals();
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

export type WorkspaceMode = 'canvas' | 'split' | 'vault';
export const workspaceMode = signal<WorkspaceMode>('canvas');

export function setWorkspaceMode(mode: WorkspaceMode): void {
  workspaceMode.value = mode;
  if (mode === 'split') {
    isSplitView.value = true;
    ensureSplitTabs();
  } else if (mode === 'canvas') {
    isSplitView.value = false;
    currentView.value = 'board';
    const activeBoard = boards.value.find((b) => !b.deleted);
    if (activeBoard && (!activeTabId.value || openTabs.value.find((t) => t.id === activeTabId.value)?.type !== 'board')) {
      openTab('board', activeBoard.id, activeBoard.title);
    }
  } else if (mode === 'vault') {
    isSplitView.value = false;
    currentView.value = 'notes';
    const activeNote = notes.value.find((n) => !n.deleted);
    if (activeNote && (!activeTabId.value || openTabs.value.find((t) => t.id === activeTabId.value)?.type !== 'note')) {
      openTab('note', activeNote.id, activeNote.title);
    }
  }
}

export function ensureSplitTabs(): void {
  let boardTab = openTabs.value.find((t) => t.type === 'board');
  let noteTab = openTabs.value.find((t) => t.type === 'note');

  if (!boardTab) {
    const b = boards.value.find((x) => !x.deleted);
    if (b) {
      openTab('board', b.id, b.title);
      boardTab = openTabs.value.find((t) => t.id === b.id);
    } else {
      const newId = createBoard('Главный план');
      boardTab = openTabs.value.find((t) => t.id === newId);
    }
  }

  if (!noteTab) {
    const n = notes.value.find((x) => !x.deleted);
    if (n) {
      openTab('note', n.id, n.title);
      noteTab = openTabs.value.find((t) => t.id === n.id);
    } else {
      const newId = createNote('Заметка');
      noteTab = openTabs.value.find((t) => t.id === newId);
    }
  }

  if (boardTab && noteTab) {
    activeTabId.value = boardTab.id;
    splitTabId.value = noteTab.id;
    isSplitView.value = true;
  }
}

// Modals
export const isCommandPaletteOpen = signal<boolean>(false);
export const isQuickSwitcherOpen = signal<boolean>(false);
export const isImportWizardOpen = signal<boolean>(false);

// Initialize dual-scope index observers
const soloIndexDoc = yjsClient.getOrCreateDoc(getScopedIndexDocName('solo'));
const teamIndexDoc = yjsClient.getOrCreateDoc(getScopedIndexDocName('team'));

export const soloMaps = getIndexMaps(soloIndexDoc);
export const teamMaps = getIndexMaps(teamIndexDoc);

export function getActiveIndexDoc() {
  return currentScope.value === 'solo' ? soloIndexDoc : teamIndexDoc;
}

export function getActiveMaps() {
  return currentScope.value === 'solo' ? soloMaps : teamMaps;
}

// Proxied maps property for backward compatibility with components expecting active scope maps
export const maps = new Proxy({} as ReturnType<typeof getIndexMaps>, {
  get(_target, prop) {
    return (getActiveMaps() as any)[prop];
  }
});

function syncIndexSignals() {
  const activeMaps = getActiveMaps();

  const noteList: NoteMeta[] = [];
  activeMaps.notes.forEach((val) => {
    noteList.push({ ...val, scope: currentScope.value });
  });
  notes.value = noteList;

  const boardList: BoardMeta[] = [];
  activeMaps.boards.forEach((val) => {
    boardList.push({ ...val, scope: currentScope.value });
  });
  boards.value = boardList;

  const folderList: FolderMeta[] = [];
  activeMaps.folders.forEach((val) => {
    folderList.push({ ...val, scope: currentScope.value });
  });
  folders.value = folderList;

  // Sync tab titles if doc renamed
  const updatedTabs = openTabs.value.map((tab) => {
    if (tab.type === 'note') {
      const n = activeMaps.notes.get(tab.id);
      if (n && n.title !== tab.title) return { ...tab, title: n.title };
    } else if (tab.type === 'board') {
      const b = activeMaps.boards.get(tab.id);
      if (b && b.title !== tab.title) return { ...tab, title: b.title };
    }
    return tab;
  });
  openTabs.value = updatedTabs;

  // Incremental Search Indexing (F6)
  activeMaps.notes.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      let text = '';
      try {
        const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, id));
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

  activeMaps.boards.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      let boardText = '';
      try {
        const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, id));
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

soloMaps.notes.observe(() => syncIndexSignals());
soloMaps.boards.observe(() => syncIndexSignals());
soloMaps.folders.observe(() => syncIndexSignals());

teamMaps.notes.observe(() => syncIndexSignals());
teamMaps.boards.observe(() => syncIndexSignals());
teamMaps.folders.observe(() => syncIndexSignals());

syncIndexSignals();

export function openTab(type: 'note' | 'board', id: string, title?: string): void {
  const activeMaps = getActiveMaps();
  const existing = openTabs.value.find((t) => t.id === id);
  if (!existing) {
    const docTitle =
      title ||
      (type === 'note'
        ? activeMaps.notes.get(id)?.title || 'Без названия'
        : activeMaps.boards.get(id)?.title || 'Безымянная доска');
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
  const scope = currentScope.value;
  const activeDoc = getActiveIndexDoc();
  const activeMaps = getActiveMaps();
  const id = crypto.randomUUID();
  const meta: NoteMeta = {
    id,
    title,
    folder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    scope
  };

  activeDoc.transact(() => {
    activeMaps.notes.set(id, meta);
  });

  // Pre-seed note doc
  const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(scope, id));
  const text = noteDoc.getText('text');
  if (text.length === 0) {
    text.insert(0, `# ${title}\n\n`);
  }

  openTab('note', id, title);
  return id;
}

export function createBoard(title = 'Новая доска', folder: string | null = null): string {
  const scope = currentScope.value;
  const activeDoc = getActiveIndexDoc();
  const activeMaps = getActiveMaps();
  const id = crypto.randomUUID();
  const meta: BoardMeta = {
    id,
    title,
    folder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    scope
  };

  activeDoc.transact(() => {
    activeMaps.boards.set(id, meta);
  });

  openTab('board', id, title);
  return id;
}

export function createFolder(name = 'Новая папка', parent: string | null = null): string {
  const scope = currentScope.value;
  const activeDoc = getActiveIndexDoc();
  const activeMaps = getActiveMaps();
  const id = crypto.randomUUID();
  const meta: FolderMeta = {
    id,
    name,
    parent,
    deleted: false,
    scope
  };

  activeDoc.transact(() => {
    activeMaps.folders.set(id, meta);
  });

  return id;
}

/**
 * Renames a note and automatically updates wikilinks [[Old Title]] -> [[New Title]] across all notes (B19).
 */
export function renameNote(id: string, newTitle: string): void {
  const activeDoc = getActiveIndexDoc();
  const activeMaps = getActiveMaps();
  const existing = activeMaps.notes.get(id);
  if (!existing || existing.title === newTitle) return;

  const oldTitle = existing.title;

  activeDoc.transact(() => {
    activeMaps.notes.set(id, {
      ...existing,
      title: newTitle,
      updatedAt: Date.now()
    });
  });

  // B19: Refactor wikilinks across active notes
  const escaped = oldTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'gi');

  activeMaps.notes.forEach((meta, otherNoteId) => {
    if (meta.deleted) return;
    try {
      const otherDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, otherNoteId));
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
  const activeMaps = getActiveMaps();
  const existing = activeMaps.boards.get(id);
  if (existing) {
    activeMaps.boards.set(id, {
      ...existing,
      title: newTitle
    });
  }
}

export function renameFolder(id: string, newName: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.folders.get(id);
  if (existing) {
    activeMaps.folders.set(id, {
      ...existing,
      name: newName
    });
  }
}

export function moveNote(id: string, newFolder: string | null): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.notes.get(id);
  if (existing) {
    activeMaps.notes.set(id, {
      ...existing,
      folder: newFolder,
      updatedAt: Date.now()
    });
  }
}

export function deleteNote(id: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.notes.get(id);
  if (existing) {
    activeMaps.notes.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function restoreNote(id: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.notes.get(id);
  if (existing) {
    activeMaps.notes.set(id, {
      ...existing,
      deleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    });
  }
}

export function deleteBoard(id: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.boards.get(id);
  if (existing) {
    activeMaps.boards.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function deleteFolder(id: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.folders.get(id);
  if (existing) {
    activeMaps.folders.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
  }
}

/**
 * Cross-Scope Bridge: Transfer nodes and linked notes between Solo and Team
 */
export async function transferNodesAcrossScopes(req: BridgeTransferRequest): Promise<BridgeTransferResponse> {
  const res = await fetch('/api/bridge/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  const data: BridgeTransferResponse = await res.json();
  if (data.success && req.toScope) {
    setScope(req.toScope);
    openTab('board', req.targetBoardId);
  }
  return data;
}

// Global hotkey listeners for desktop feel
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Alt+1: Solo Scope
    if (e.altKey && e.key === '1') {
      e.preventDefault();
      setScope('solo');
    }

    // Alt+2: Team Scope
    if (e.altKey && e.key === '2') {
      e.preventDefault();
      setScope('team');
    }

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

    // Ctrl+P or Ctrl+K: Command palette
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
      isQuickSwitcherOpen.value = false;
    }

    // Ctrl+B: Toggle Sidebar
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }

    // Ctrl+\: Toggle Split View
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      setWorkspaceMode(workspaceMode.value === 'split' ? 'canvas' : 'split');
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
