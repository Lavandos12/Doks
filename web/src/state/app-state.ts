import { signal, computed } from '@preact/signals';
import type {
  NoteMeta,
  BoardMeta,
  FolderMeta,
  AttachmentMeta,
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
export { getScopedNoteDocName } from '@doks/shared';
import { yjsClient, agentStatus, connectionState } from './yjs-client.js';
export { yjsClient, agentStatus, connectionState } from './yjs-client.js';
import { api } from '../api/client.js';
import { NotesSearchIndex } from '../search/indexer.js';
import { showToast } from '../ui/toast.js';

export const searchIndex = new NotesSearchIndex();

export type ViewType = 'notes' | 'board' | 'network' | 'history' | 'search';

export interface TabItem {
  id: string;
  type: 'note' | 'board';
  title: string;
  pinned?: boolean;
}

// Canonical Board IDs & Scope Management (backward compatibility)
export const SOLO_MAIN_BOARD_ID = 'solo-main';
export const TEAM_MAIN_BOARD_ID = 'team-main';

// Global persistent clipboard across boards and split panes
export const globalBoardClipboard: {
  nodes: any[];
  edges: any[];
  copiedAt: number;
  sourceScope?: WorkspaceScope;
} = { nodes: [], edges: [], copiedAt: 0 };

// Two-Tier Workspace Scope
const savedScope = typeof localStorage !== 'undefined' ? (localStorage.getItem('doks_scope') as WorkspaceScope) : null;
export const currentScope = signal<WorkspaceScope>(savedScope || 'solo');

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
  // Find first active board in new scope
  const targetBoardsMap = newScope === 'solo' ? soloMaps.boards : teamMaps.boards;
  let targetBoard: BoardMeta | undefined;
  targetBoardsMap.forEach((b) => {
    if (!b.deleted && !targetBoard) targetBoard = b;
  });
  if (targetBoard) {
    selectedBoardId.value = targetBoard.id;
    openTab('board', targetBoard.id, targetBoard.title);
  }
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
export const attachments = signal<AttachmentMeta[]>([]);

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

export function ensureDefaultBoard(): void {
  let hasAnyBoard = false;
  soloMaps.boards.forEach((b) => {
    if (!b.deleted) hasAnyBoard = true;
  });
  teamMaps.boards.forEach((b) => {
    if (!b.deleted) hasAnyBoard = true;
  });

  if (!hasAnyBoard) {
    const id = SOLO_MAIN_BOARD_ID;
    soloMaps.boards.set(id, {
      id,
      title: 'Моя первая доска',
      folder: null,
      deleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: 'solo'
    });
  }
}

// Backward compatibility alias
export function ensureCanonicalBoards(): void {
  ensureDefaultBoard();
}

// Initial ensure of default board
ensureDefaultBoard();

export function getActiveIndexDoc() {
  return currentScope.value === 'solo' ? soloIndexDoc : teamIndexDoc;
}

export function getActiveMaps() {
  return currentScope.value === 'solo' ? soloMaps : teamMaps;
}

// Unified signal merging boards from BOTH scopes
export const allBoards = signal<BoardMeta[]>([]);

// Proxied maps property for backward compatibility with components expecting active scope maps
export const maps = new Proxy({} as ReturnType<typeof getIndexMaps>, {
  get(_target, prop) {
    return (getActiveMaps() as any)[prop];
  }
});

function syncIndexSignals() {
  ensureDefaultBoard();
  const activeMaps = getActiveMaps();

  // Unified allBoards across both scopes, sorted by updatedAt desc
  const mergedBoards: BoardMeta[] = [];
  soloMaps.boards.forEach((val) => {
    if (!val.deleted) {
      mergedBoards.push({ ...val, scope: 'solo' });
    }
  });
  teamMaps.boards.forEach((val) => {
    if (!val.deleted) {
      mergedBoards.push({ ...val, scope: 'team' });
    }
  });
  mergedBoards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  allBoards.value = mergedBoards;

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

  // Auto-open first board if no tabs open and boards exist
  if (openTabs.value.length === 0 && !activeTabId.value) {
    const firstBoard = allBoards.value[0] || boardList.find((b) => !b.deleted);
    if (firstBoard) {
      selectBoardWithScope(firstBoard.id, firstBoard.scope || 'solo', firstBoard.title);
    }
  }

  const folderList: FolderMeta[] = [];
  activeMaps.folders.forEach((val) => {
    folderList.push({ ...val, scope: currentScope.value });
  });
  folders.value = folderList;

  const attList: AttachmentMeta[] = [];
  if (activeMaps.attachments) {
    activeMaps.attachments.forEach((val) => {
      attList.push(val);
    });
  }
  attachments.value = attList;

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
soloMaps.attachments.observe(() => syncIndexSignals());

teamMaps.notes.observe(() => syncIndexSignals());
teamMaps.boards.observe(() => syncIndexSignals());
teamMaps.folders.observe(() => syncIndexSignals());
teamMaps.attachments.observe(() => syncIndexSignals());

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

export function createBoard(
  title = 'Новая доска',
  folder: string | null = null,
  scope: WorkspaceScope = currentScope.value,
  shouldOpenTab = true
): string {
  const targetDoc = scope === 'solo' ? soloIndexDoc : teamIndexDoc;
  const targetMaps = scope === 'solo' ? soloMaps : teamMaps;
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

  targetDoc.transact(() => {
    targetMaps.boards.set(id, meta);
  });

  if (shouldOpenTab && scope === currentScope.value) {
    openTab('board', id, title);
  }
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

export function renameBoard(id: string, newTitle: string, scope?: WorkspaceScope): void {
  const targetMap = scope
    ? (scope === 'solo' ? soloMaps.boards : teamMaps.boards)
    : (soloMaps.boards.has(id) ? soloMaps.boards : teamMaps.boards);
  const existing = targetMap.get(id);
  if (existing) {
    targetMap.set(id, {
      ...existing,
      title: newTitle,
      updatedAt: Date.now()
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

export function restoreBoard(id: string): void {
  const activeMaps = getActiveMaps();
  const existing = activeMaps.boards.get(id);
  if (existing) {
    activeMaps.boards.set(id, {
      ...existing,
      deleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    });
  }
}

export function deleteBoard(id: string, scope?: WorkspaceScope): void {
  const targetMap = scope
    ? (scope === 'solo' ? soloMaps.boards : teamMaps.boards)
    : (soloMaps.boards.has(id) ? soloMaps.boards : teamMaps.boards);
  const existing = targetMap.get(id);
  if (existing) {
    targetMap.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function selectBoardWithScope(boardId: string, scope: WorkspaceScope, title?: string): void {
  if (currentScope.value !== scope) {
    currentScope.value = scope;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('doks_scope', scope);
    }
    yjsClient.switchScope(scope);
    syncIndexSignals();
  }
  selectedBoardId.value = boardId;
  openTab('board', boardId, title || 'Доска');
}

export async function convertBoardScope(
  boardId: string,
  fromScope: WorkspaceScope,
  toScope: WorkspaceScope
): Promise<string> {
  if (fromScope === toScope) return boardId;

  const sourceMap = fromScope === 'solo' ? soloMaps.boards : teamMaps.boards;
  const meta = sourceMap.get(boardId);
  const title = meta?.title || 'Доска';

  // 1. Create target board in toScope with the same title
  const newBoardId = createBoard(title, meta?.folder || null, toScope, false);

  // 2. Fetch all nodes from source board doc
  try {
    const srcDocName = getScopedBoardDocName(fromScope, boardId);
    const srcDoc = yjsClient.getOrCreateDoc(srcDocName);
    const { nodes } = getBoardMaps(srcDoc);
    const nodeIds: string[] = [];
    nodes.forEach((nMap, nId) => {
      if (!nMap.get('deleted')) {
        nodeIds.push(nId);
      }
    });

    if (nodeIds.length > 0) {
      await api.transferNodes({
        fromScope,
        toScope,
        boardId,
        targetBoardId: newBoardId,
        nodeIds,
        includeLinkedNotes: true,
        mode: 'move'
      });
    }
  } catch (err) {
    console.error('Failed to transfer nodes during board scope conversion:', err);
  }

  // 3. Soft-delete the old board in fromScope
  deleteBoard(boardId, fromScope);

  // 4. Switch to new board
  selectBoardWithScope(newBoardId, toScope, title);
  showToast(
    toScope === 'team'
      ? `Доска "${title}" теперь Общая (доступна в сети)`
      : `Доска "${title}" теперь Личная (скрыта из сети)`,
    'success'
  );
  return newBoardId;
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
  const data = await api.transferNodes(req);
  if (data.success && req.toScope) {
    setScope(req.toScope);
    openTab('board', req.targetBoardId);
  }
  return data;
}

/**
 * 1-Click Instant Push to Opposite Scope ("На общую доску ->" / "<- В черновик")
 */
export async function quickPushNodesToOppositeScope(
  fromScope: WorkspaceScope,
  sourceBoardId: string,
  nodeIds: string[],
  switchAfter = false
): Promise<BridgeTransferResponse> {
  const targetScope: WorkspaceScope = fromScope === 'solo' ? 'team' : 'solo';
  const targetBoardId = targetScope === 'team' ? TEAM_MAIN_BOARD_ID : SOLO_MAIN_BOARD_ID;

  const targetDoc = targetScope === 'solo' ? soloIndexDoc : teamIndexDoc;
  const targetMaps = targetScope === 'solo' ? soloMaps : teamMaps;
  if (!targetMaps.boards.has(targetBoardId)) {
    targetDoc.transact(() => {
      targetMaps.boards.set(targetBoardId, {
        id: targetBoardId,
        title: targetScope === 'team' ? 'Общая доска' : 'Моя доска',
        folder: null,
        deleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: targetScope
      });
    });
    syncIndexSignals();
  }

  const res = await api.transferNodes({
    fromScope,
    toScope: targetScope,
    boardId: sourceBoardId,
    targetBoardId,
    nodeIds,
    includeLinkedNotes: true,
    mode: 'copy'
  });

  if (res.success) {
    showToast(
      fromScope === 'solo'
        ? 'Отправлено на Общую доску!'
        : 'Скопировано в ваш личный Черновик!',
      'success'
    );
    if (switchAfter) {
      setScope(targetScope);
      openTab('board', targetBoardId);
    }
  } else {
    showToast(res.error || 'Ошибка переноса объектов', 'error');
  }

  return res;
}

// Global hotkey listeners for desktop feel with capture phase
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      // Alt+1: Solo Scope
      if (e.altKey && (e.code === 'Digit1' || e.key === '1')) {
        e.preventDefault();
        setScope('solo');
        return;
      }

      // Alt+2: Team Scope
      if (e.altKey && (e.code === 'Digit2' || e.key === '2')) {
        e.preventDefault();
        setScope('team');
        return;
      }

      // Ctrl+S: Prevent browser "Save page as" and show save toast
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's' || e.key === 'ы')) {
        e.preventDefault();
        showToast(currentScope.value === 'solo' ? 'Все изменения сохранены локально' : 'Синхронизировано в P2P-сети', 'success');
        return;
      }

      // Ctrl+W: Close active tab
      if (e.ctrlKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w' || e.key === 'ц')) {
        e.preventDefault();
        if (activeTabId.value) {
          closeTab(activeTabId.value);
        }
        return;
      }

      // Ctrl+Tab: Cycle through open tabs
      if (e.ctrlKey && (e.code === 'Tab' || e.key === 'Tab')) {
        e.preventDefault();
        const tabs = openTabs.value;
        if (tabs.length > 1 && activeTabId.value) {
          const idx = tabs.findIndex((t) => t.id === activeTabId.value);
          const nextIdx = (idx + 1) % tabs.length;
          const nextTab = tabs[nextIdx];
          openTab(nextTab.type, nextTab.id, nextTab.title);
        }
        return;
      }

      // Ctrl+P or Ctrl+K: Command palette (prevent browser Print dialog)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.code === 'KeyP' || e.code === 'KeyK' || e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k' || e.key === 'з' || e.key === 'л')
      ) {
        e.preventDefault();
        isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
        isQuickSwitcherOpen.value = false;
        return;
      }

      // Ctrl+B: Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyB' || e.key.toLowerCase() === 'b' || e.key === 'и')) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Ctrl+\: Toggle Split View
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Backslash' || e.key === '\\')) {
        e.preventDefault();
        setWorkspaceMode(workspaceMode.value === 'split' ? 'canvas' : 'split');
        return;
      }

      // Ctrl+O: Quick switcher
      if (e.ctrlKey && !e.shiftKey && (e.code === 'KeyO' || e.key.toLowerCase() === 'o' || e.key === 'щ')) {
        e.preventDefault();
        isQuickSwitcherOpen.value = !isQuickSwitcherOpen.value;
        isCommandPaletteOpen.value = false;
        return;
      }

      // Ctrl+Shift+F: Global Search (F6)
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f' || e.key === 'а')) {
        e.preventDefault();
        currentView.value = 'search';
        return;
      }

      // Escape closes modals
      if (e.code === 'Escape' || e.key === 'Escape') {
        if (isCommandPaletteOpen.value || isQuickSwitcherOpen.value) {
          isCommandPaletteOpen.value = false;
          isQuickSwitcherOpen.value = false;
        }
      }
    },
    { capture: true }
  );
}
