import { signal, computed } from '@preact/signals';
import type { NoteMeta, BoardMeta, FolderMeta } from '@doks/shared';
import { getIndexMaps, getNoteDocName } from '@doks/shared';
import { yjsClient } from './yjs-client.js';

export type ViewType = 'notes' | 'board' | 'network' | 'history';

export const currentView = signal<ViewType>('notes');
export const selectedNoteId = signal<string | null>(null);
export const selectedBoardId = signal<string | null>(null);
export const theme = signal<'dark' | 'light'>('dark');
export const searchQuery = signal<string>('');

export const notes = signal<NoteMeta[]>([]);
export const boards = signal<BoardMeta[]>([]);
export const folders = signal<FolderMeta[]>([]);

// Initialize index observer
const indexDoc = yjsClient.getIndexDoc();
const maps = getIndexMaps(indexDoc);

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
}

maps.notes.observe(() => syncIndexSignals());
maps.boards.observe(() => syncIndexSignals());
maps.folders.observe(() => syncIndexSignals());
syncIndexSignals();

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

  selectedNoteId.value = id;
  currentView.value = 'notes';
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

  selectedBoardId.value = id;
  currentView.value = 'board';
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

export function renameNote(id: string, newTitle: string): void {
  const existing = maps.notes.get(id);
  if (existing) {
    maps.notes.set(id, {
      ...existing,
      title: newTitle,
      updatedAt: Date.now()
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
    if (selectedNoteId.value === id) {
      selectedNoteId.value = null;
    }
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
    if (selectedBoardId.value === id) {
      selectedBoardId.value = null;
    }
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
