import { signal, computed } from '@preact/signals';
import * as Y from 'yjs';
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
  DOC_INDEX,
  isLegacyDummyNote
} from '@doks/shared';
export { getScopedNoteDocName } from '@doks/shared';
import { yjsClient, agentStatus, connectionState } from './yjs-client.js';
export { yjsClient, agentStatus, connectionState } from './yjs-client.js';
import { api } from '../api/client.js';
import { NotesSearchIndex } from '../search/indexer.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/index.js';
import { getMyAccount, getMyAccountId, getMyAccountName, getMyAccountColor, updateMyAccount, sanitizeContaminatedStorage } from './account-state.js';
export { getMyAccount, getMyAccountId, getMyAccountName, getMyAccountColor, updateMyAccount } from './account-state.js';

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
const isCloudHost = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const savedScope = typeof localStorage !== 'undefined' ? (localStorage.getItem('doks_scope') as WorkspaceScope) : null;
export const currentScope = signal<WorkspaceScope>(savedScope || (isCloudHost ? 'team' : 'solo'));

export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';
  // Restrict mobile detection strictly to mobile phone user agents (Audit 3.2: do not lock touchscreen laptops)
  return /Android.*Mobile|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

const hasViewerParam = typeof window !== 'undefined' && (
  window.location.search.includes('b=') ||
  window.location.search.includes('bridge=') ||
  window.location.search.includes('viewer=')
);

const initialViewer = isMobilePhoneDevice() || hasViewerParam;
export const isViewerMode = signal<boolean>(initialViewer);
export const isViewerAllowSolo = signal<boolean>(false);

export const appState = computed(() => ({
  viewerMode: isViewerMode.value,
  viewerAllowSolo: isViewerAllowSolo.value || Boolean(agentStatus.value?.allowSolo)
}));

let userDismissedViewer = false;

export function setViewerMode(enabled: boolean, allowSolo = false): void {
  // 3.2: Allow users on mobile devices to manually toggle viewer mode off
  isViewerMode.value = enabled;
  isViewerAllowSolo.value = allowSolo;
  if (!enabled) {
    userDismissedViewer = true;
    if (agentStatus.value?.viewerMode) {
      agentStatus.value = { ...agentStatus.value, viewerMode: false };
    }
  }
  if (enabled && allowSolo) {
    yjsClient.subscribeDoc(getScopedIndexDocName('solo'));
    yjsClient.subscribeDoc(getScopedIndexDocName('team'));
  }
}

export function initAppState(): void {
  const isHost = agentStatus.value?.isHost ?? (
    typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  );
  if (currentScope.value === 'solo' && !isHost && !agentStatus.value?.allowSolo) {
    currentScope.value = 'team';
  }
  yjsClient.subscribeDoc(getScopedIndexDocName(currentScope.value));
  if (isHost || (appState.value.viewerMode && appState.value.viewerAllowSolo)) {
    subscribeSoloIfHost();
  }
}

if (typeof window !== 'undefined') {
  agentStatus.subscribe((st) => {
    if (st?.agentId) sanitizeContaminatedStorage(st.agentId);
    if (userDismissedViewer) return;
    if (st?.viewerMode || initialViewer) {
      const allowSolo = Boolean(st?.allowSolo);
      setViewerMode(true, allowSolo);
    }
  });
  initAppState();
}

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
  searchIndex.removeAll();
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

// System theme: permanently locked to dark mode
export const theme = signal<'dark'>('dark');

export function setTheme(_t?: 'dark'): void {
  theme.value = 'dark';
}
if (typeof localStorage !== 'undefined' && localStorage.getItem('doks_theme')) {
  localStorage.removeItem('doks_theme');
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
      const newId = createBoard(t('sidebar.new_board'));
      boardTab = openTabs.value.find((t) => t.id === newId);
    }
  }

  if (!noteTab) {
    const n = notes.value.find((x) => !x.deleted);
    if (n) {
      openTab('note', n.id, n.title);
      noteTab = openTabs.value.find((t) => t.id === n.id);
    } else {
      const newId = createNote(t('notes.default_title'));
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
const soloIndexDoc = new Y.Doc();
const teamIndexDoc = yjsClient.getOrCreateDoc(getScopedIndexDocName('team'));

export const soloMaps = getIndexMaps(soloIndexDoc);
export const teamMaps = getIndexMaps(teamIndexDoc);

let soloSubscribed = false;
export function subscribeSoloIfHost(): void {
  if (soloSubscribed) return;
  const isHost = agentStatus.value?.isHost ?? (
    typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  );
  if (isHost || agentStatus.value?.allowSolo) {
    soloSubscribed = true;
    yjsClient.registerDoc(getScopedIndexDocName('solo'), soloIndexDoc);
    yjsClient.subscribeDoc(getScopedIndexDocName('solo'));
  }
}

export function ensureInitialBoard(): void {
  // 1. Ensure private personal board in solo scope (saved locally)
  if (!soloMaps.boards.has(SOLO_MAIN_BOARD_ID)) {
    soloMaps.boards.set(SOLO_MAIN_BOARD_ID, {
      id: SOLO_MAIN_BOARD_ID,
      title: 'Personal Canvas',
      folder: null,
      deleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: 'solo'
    });
  }

  // 2. Ensure canonical shared team board in team scope only if no boards exist at all
  if (teamMaps.boards.size === 0) {
    teamMaps.boards.set(TEAM_MAIN_BOARD_ID, {
      id: TEAM_MAIN_BOARD_ID,
      title: 'Shared Team Canvas',
      folder: null,
      deleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scope: 'team',
      creatorId: 'system',
      creatorName: 'Team'
    });
  }
}

export const ensureDefaultBoard = ensureInitialBoard;

// Backward compatibility alias
export function ensureCanonicalBoards(): void {
  ensureInitialBoard();
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
export const allTrashNotes = signal<NoteMeta[]>([]);
export const allTrashBoards = signal<BoardMeta[]>([]);

// Proxied maps property for backward compatibility with components expecting active scope maps
export const maps = new Proxy({} as ReturnType<typeof getIndexMaps>, {
  get(_target, prop) {
    return (getActiveMaps() as any)[prop];
  }
});

function syncIndexSignals() {
  ensureInitialBoard();

  // Auto-purge legacy dummy preset notes from synchronized Y.Maps
  const purgeLegacyNotes = (map: Y.Map<any>) => {
    const toDelete: string[] = [];
    map.forEach((val, id) => {
      if (val && isLegacyDummyNote(val)) {
        toDelete.push(id);
      }
    });
    if (toDelete.length > 0) {
      toDelete.forEach((id) => {
        map.delete(id);
      });
    }
  };
  purgeLegacyNotes(soloMaps.notes);
  purgeLegacyNotes(teamMaps.notes);
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

  // Unified trash lists across both scopes
  const deletedNotesList: NoteMeta[] = [];
  soloMaps.notes.forEach((val) => {
    if (val.deleted) deletedNotesList.push({ ...val, scope: 'solo' });
  });
  teamMaps.notes.forEach((val) => {
    if (val.deleted) deletedNotesList.push({ ...val, scope: 'team' });
  });
  deletedNotesList.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  allTrashNotes.value = deletedNotesList;

  const deletedBoardsList: BoardMeta[] = [];
  soloMaps.boards.forEach((val) => {
    if (val.deleted) deletedBoardsList.push({ ...val, scope: 'solo' });
  });
  teamMaps.boards.forEach((val) => {
    if (val.deleted) deletedBoardsList.push({ ...val, scope: 'team' });
  });
  deletedBoardsList.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  allTrashBoards.value = deletedBoardsList;

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
    const activeBoards = allBoards.value.filter((b) => !b.deleted);
    const preferredBoard =
      activeBoards.find((b) => (b.scope || 'solo') === (isCloudHost ? 'team' : 'solo')) || activeBoards[0];
    if (preferredBoard) {
      selectBoardWithScope(preferredBoard.id, preferredBoard.scope || (isCloudHost ? 'team' : 'solo'), preferredBoard.title);
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

  // Incremental Search Indexing with body text / preview (2.3: full-text search indexing)
  activeMaps.notes.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      const docName = getScopedNoteDocName(currentScope.value, id);
      const loadedDoc = yjsClient.getDoc(docName);
      const bodyText = loadedDoc ? loadedDoc.getText('text').toString() : ((val as any).preview || (val as any).snippet || '');
      searchIndex.updateDoc({
        id,
        type: 'note',
        title: val.title,
        folder: val.folder || undefined,
        text: bodyText ? `${val.title}\n${bodyText}` : val.title,
        tags: []
      });
    }
  });

  activeMaps.boards.forEach((val, id) => {
    if (val.deleted) {
      searchIndex.removeDoc(id);
    } else {
      searchIndex.updateDoc({
        id,
        type: 'board',
        title: val.title,
        folder: val.folder || undefined,
        text: val.title
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
        ? activeMaps.notes.get(id)?.title || t('notes.untitled')
        : activeMaps.boards.get(id)?.title || t('sidebar.new_board'));
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

export function createNote(title = t('sidebar.new_note'), folder: string | null = null): string {
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

export function getMyMemberId(): string {
  return getMyAccountId();
}

export function getMyMemberName(): string {
  return getMyAccountName();
}

// Universal superuser mode per user request: enables deleting all shared/legacy boards
export const SUPER_USER_MODE = false;

export function isBoardAdmin(meta?: BoardMeta | null, scopeHint?: WorkspaceScope): boolean {
  if (!meta) return false;

  // Universal Super-User bypass: allows full deletion & cleanup of any board including main canvas
  if (SUPER_USER_MODE) return true;

  // Canonical shared team canvas can NEVER be deleted, cleared, or converted by ordinary users
  if (meta.id === TEAM_MAIN_BOARD_ID) return false;

  const isTeam = scopeHint === 'team' || meta.scope === 'team' || teamMaps.boards.has(meta.id);
  // Solo boards are always owned locally if genuinely in soloMaps
  if (!isTeam && (meta.scope === 'solo' || soloMaps.boards.has(meta.id))) return true;

  const myId = getMyAccountId();

  // 1. Strict creatorId match against sovereign client account ID
  if (meta.creatorId) {
    return meta.creatorId === myId;
  }

  // 2. Legacy / unassigned team boards: protected against unauthorized participant deletion.
  return false;
}

export function createBoard(
  title = t('sidebar.new_board'),
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
    scope,
    creatorId: getMyMemberId(),
    creatorName: getMyMemberName()
  };

  targetDoc.transact(() => {
    targetMaps.boards.set(id, meta);
  });

  if (shouldOpenTab && scope === currentScope.value) {
    openTab('board', id, title);
  }
  return id;
}

export function createFolder(name = t('sidebar.new_folder'), parent: string | null = null): string {
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

  // B19 & 2.2: Refactor wikilinks across active notes non-destructively
  const escaped = oldTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'gi');

  activeMaps.notes.forEach((meta, otherNoteId) => {
    if (meta.deleted) return;
    try {
      const otherDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, otherNoteId));
      const text = otherDoc.getText('text');
      const content = text.toString();

      const matches: Array<{ index: number; length: number; replacement: string }> = [];
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(content)) !== null) {
        const aliasPart = match[1];
        const replacement = aliasPart ? `[[${newTitle}${aliasPart}]]` : `[[${newTitle}]]`;
        matches.push({ index: match.index, length: match[0].length, replacement });
      }

      if (matches.length > 0) {
        otherDoc.transact(() => {
          // Replace from right to left so earlier indices remain valid
          for (let i = matches.length - 1; i >= 0; i--) {
            text.delete(matches[i].index, matches[i].length);
            text.insert(matches[i].index, matches[i].replacement);
          }
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
  for (const m of [soloMaps, teamMaps]) {
    const existing = m.notes.get(id);
    if (existing) {
      m.notes.set(id, {
        ...existing,
        deleted: true,
        deletedAt: Date.now()
      });
      closeTab(id);
      break;
    }
  }
}

export function restoreNote(id: string, scopeHint?: WorkspaceScope): void {
  const scopesToTry: WorkspaceScope[] = scopeHint
    ? [scopeHint, scopeHint === 'solo' ? 'team' : 'solo']
    : [currentScope.value, currentScope.value === 'solo' ? 'team' : 'solo'];
  for (const s of scopesToTry) {
    const sMaps = s === 'solo' ? soloMaps : teamMaps;
    const existing = sMaps.notes.get(id);
    if (existing) {
      sMaps.notes.set(id, {
        ...existing,
        deleted: false,
        deletedAt: undefined,
        updatedAt: Date.now()
      });
      break;
    }
  }
}

export function restoreBoard(id: string, scopeHint?: WorkspaceScope): void {
  const scopesToTry: WorkspaceScope[] = scopeHint
    ? [scopeHint, scopeHint === 'solo' ? 'team' : 'solo']
    : [currentScope.value, currentScope.value === 'solo' ? 'team' : 'solo'];
  for (const s of scopesToTry) {
    const sMaps = s === 'solo' ? soloMaps : teamMaps;
    const existing = sMaps.boards.get(id);
    if (existing) {
      sMaps.boards.set(id, {
        ...existing,
        deleted: false,
        deletedAt: undefined,
        updatedAt: Date.now()
      });
      break;
    }
  }
}

export function deleteBoard(id: string, scope?: WorkspaceScope): void {
  // Unless super-user mode is active, block deleting canonical main boards
  if (!SUPER_USER_MODE && (id === TEAM_MAIN_BOARD_ID || id === SOLO_MAIN_BOARD_ID)) {
    showToast('Cannot delete the main canvas board.', 'error');
    return;
  }

  // If the board exists in teamMaps, it is strictly a team board regardless of scope parameter
  const isTeam = teamMaps.boards.has(id) || scope === 'team';
  const effectiveScope: WorkspaceScope = isTeam ? 'team' : (scope || 'solo');
  const targetMap = effectiveScope === 'team' ? teamMaps.boards : soloMaps.boards;
  const existing = targetMap.get(id) || allBoards.value.find((b) => b.id === id);

  if (existing) {
    if (effectiveScope === 'team' && !isBoardAdmin(existing, 'team')) {
      const creator = existing.creatorName || 'the creator';
      showToast(`Permission denied: Only the board creator (@${creator}) can delete this board.`, 'error');
      return;
    }
    targetMap.set(id, {
      ...existing,
      deleted: true,
      deletedAt: Date.now()
    });
    closeTab(id);
  }
}

export function emptyTrash(): void {
  [soloMaps, teamMaps].forEach((maps) => {
    const deletedNoteKeys: string[] = [];
    maps.notes.forEach((val, key) => {
      if (val.deleted) deletedNoteKeys.push(key);
    });
    deletedNoteKeys.forEach((k) => maps.notes.delete(k));

    const deletedBoardKeys: string[] = [];
    maps.boards.forEach((val, key) => {
      if (val.deleted) {
        // Unless super-user mode is active, keep main board safe
        if (!SUPER_USER_MODE && (key === TEAM_MAIN_BOARD_ID || key === SOLO_MAIN_BOARD_ID)) {
          maps.boards.set(key, {
            ...val,
            deleted: false,
            deletedAt: undefined,
            updatedAt: Date.now()
          });
        } else {
          deletedBoardKeys.push(key);
        }
      }
    });
    deletedBoardKeys.forEach((k) => {
      maps.boards.delete(k);
      try {
        const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(maps === teamMaps ? 'team' : 'solo', k));
        const { nodes, edges } = getBoardMaps(bDoc);
        bDoc.transact(() => {
          nodes.clear();
          edges.clear();
        });
      } catch {}
    });
  });
  syncIndexSignals();
}

export function permanentlyDeleteBoard(id: string, scope?: WorkspaceScope): void {
  if (!SUPER_USER_MODE && (id === TEAM_MAIN_BOARD_ID || id === SOLO_MAIN_BOARD_ID)) {
    const targetMap = id === TEAM_MAIN_BOARD_ID ? teamMaps.boards : soloMaps.boards;
    const existing = targetMap.get(id);
    if (existing) {
      targetMap.set(id, { ...existing, deleted: false, deletedAt: undefined, updatedAt: Date.now() });
    }
    syncIndexSignals();
    return;
  }
  const isTeam = teamMaps.boards.has(id) || scope === 'team';
  const targetMap = isTeam ? teamMaps.boards : soloMaps.boards;
  targetMap.delete(id);
  try {
    const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(isTeam ? 'team' : 'solo', id));
    const { nodes, edges } = getBoardMaps(bDoc);
    bDoc.transact(() => {
      nodes.clear();
      edges.clear();
    });
  } catch {}
  closeTab(id);
  syncIndexSignals();
}

export function permanentlyDeleteNote(id: string, scope?: WorkspaceScope): void {
  const isTeam = teamMaps.notes.has(id) || scope === 'team';
  const targetMap = isTeam ? teamMaps.notes : soloMaps.notes;
  targetMap.delete(id);
  closeTab(id);
  syncIndexSignals();
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
  openTab('board', boardId, title || t('sidebar.boards'));
}

export async function duplicateBoardToSolo(boardId: string): Promise<string> {
  const sourceMap = teamMaps.boards;
  const meta = sourceMap.get(boardId);
  const title = `${meta?.title || 'Shared Board'} (Copy)`;

  // 1. Create a new independent board in Solo scope
  const newBoardId = createBoard(title, null, 'solo', false);

  // 2. Deep-copy all nodes from team board in 'copy' mode (original untouched)
  try {
    const srcDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName('team', boardId));
    const { nodes } = getBoardMaps(srcDoc);
    const nodeIds: string[] = [];
    nodes.forEach((nMap, nId) => {
      if (!nMap.get('deleted')) nodeIds.push(nId);
    });

    if (nodeIds.length > 0) {
      await api.transferNodes({
        fromScope: 'team',
        toScope: 'solo',
        boardId,
        targetBoardId: newBoardId,
        nodeIds,
        includeLinkedNotes: true,
        mode: 'copy'
      });
    }
  } catch (err) {
    console.error('Failed to duplicate board:', err);
  }

  // 3. Switch collaborator to their new private Solo copy
  selectBoardWithScope(newBoardId, 'solo', title);
  showToast(`Board copied to your private Solo workspace`, 'success');
  return newBoardId;
}

export async function convertBoardScope(
  boardId: string,
  fromScope: WorkspaceScope,
  toScope: WorkspaceScope
): Promise<string> {
  if (fromScope === toScope) return boardId;

  // Guard: Only board creator / admin can make a shared board private
  if (fromScope === 'team' && toScope === 'solo') {
    const meta = teamMaps.boards.get(boardId);
    if (!isBoardAdmin(meta)) {
      showToast('Permission denied: Only the board creator can make this board private.', 'error');
      return boardId;
    }
  }

  const sourceMap = fromScope === 'solo' ? soloMaps.boards : teamMaps.boards;
  const meta = sourceMap.get(boardId);
  const title = meta?.title || t('sidebar.boards');

  // 1. Create target board in toScope with the same title
  const newBoardId = createBoard(title, meta?.folder || null, toScope, false);

  // When promoting to team, stamp creator and promotion properties
  if (toScope === 'team') {
    const newMeta = teamMaps.boards.get(newBoardId);
    if (newMeta) {
      teamMaps.boards.set(newBoardId, {
        ...newMeta,
        creatorId: getMyMemberId(),
        creatorName: agentStatus.value?.memberName || 'User',
        promotedAt: Date.now(),
        promotedBy: agentStatus.value?.memberName || 'User'
      });
    }
  }

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
      ? `Board "${title}" is now Collaborative`
      : `Board "${title}" is now Solo`,
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
 * 1-Click Instant Push to Opposite Scope
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
        title: targetScope === 'team' ? 'Team Board' : 'Solo Board',
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
        ? 'Pushed to Team board!'
        : 'Pushed to Solo board!',
      'success'
    );
    if (switchAfter) {
      setScope(targetScope);
      openTab('board', targetBoardId);
    }
  } else {
    showToast(res.error || 'Transfer error', 'error');
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
        showToast(t('status.synced'), 'success');
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
