import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getBoardDocName,
  getNoteDocName,
  getNoteText,
  createNodeMap
} from '@doks/shared';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';

describe('F3: Note Card on Board', () => {
  let tempDir: string;
  let stateStore: StateStore;
  let docManager: DocManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-f3-'));
    stateStore = new StateStore(path.join(tempDir, 'state.bin'));
    docManager = new DocManager(stateStore);
  });

  afterEach(() => {
    docManager.destroy();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('binds noteId to a board note card and syncs content with referenced note', () => {
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards } = getIndexMaps(indexDoc);

    // 1. Create a note in index
    const noteId = 'test-note-1';
    notes.set(noteId, {
      id: noteId,
      title: 'Инструкция по деплою',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const noteDoc = docManager.getOrCreateDoc(getNoteDocName(noteId));
    getNoteText(noteDoc).insert(0, '# Деплой\nВыполнить `npm run check`.');

    // 2. Create a board with a note card pointing to noteId
    const boardId = 'board-with-note';
    boards.set(boardId, {
      id: boardId,
      title: 'Схема релизов',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const boardDoc = docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const cardMap = createNodeMap({
      id: 'card-1',
      type: 'note',
      x: 100,
      y: 100,
      w: 320,
      h: 240,
      noteId: noteId,
      text: '', // note cards derive their text from the note or can edit it
      author: 'Tester'
    });
    nodes.set('card-1', cardMap);

    // Verify node properties
    expect(cardMap.get('noteId')).toBe(noteId);
    expect(cardMap.get('type')).toBe('note');

    // Content from note doc matches
    const referencedNoteContent = getNoteText(docManager.getOrCreateDoc(getNoteDocName(cardMap.get('noteId')))).toString();
    expect(referencedNoteContent).toContain('# Деплой');
  });

  it('detects when referenced note is soft-deleted and can restore it', () => {
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { notes } = getIndexMaps(indexDoc);

    const noteId = 'deleted-note-1';
    notes.set(noteId, {
      id: noteId,
      title: 'Удаляемая заметка',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    // Soft delete note
    const meta = notes.get(noteId)!;
    notes.set(noteId, {
      ...meta,
      deleted: true,
      deletedAt: Date.now()
    });

    // Check status
    const updatedMeta = notes.get(noteId);
    expect(updatedMeta?.deleted).toBe(true);

    // Restore note
    notes.set(noteId, {
      ...updatedMeta!,
      deleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    });

    expect(notes.get(noteId)?.deleted).toBe(false);
  });
});
