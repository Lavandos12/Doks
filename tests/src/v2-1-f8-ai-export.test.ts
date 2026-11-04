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
  createNodeMap,
  generateAiContext
} from '@doks/shared';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';

describe('F8: AI Context Export Refinements (Stable IDs, Color Names, Note Checkboxes)', () => {
  let tempDir: string;
  let stateStore: StateStore;
  let docManager: DocManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-f8-'));
    stateStore = new StateStore(path.join(tempDir, 'state.bin'));
    docManager = new DocManager(stateStore);
  });

  afterEach(() => {
    docManager.destroy();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. Generates stable short IDs that do not change when subsets are selected', () => {
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-stable-id';
    boards.set(boardId, {
      id: boardId,
      title: 'Стабильные ID',
      folder: null,
      createdAt: 1000,
      updatedAt: 1000,
      deleted: false
    });

    const boardDoc = docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const id1 = '87a2bf11-4567-4890-abcd-123456789abc';
    const id2 = 'c4d8651d-9999-4444-bbbb-000000000000';

    nodes.set(id1, createNodeMap({ id: id1, type: 'sticky', text: 'Первый', x: 0, y: 0, w: 100, h: 100, author: 'Alice' }));
    nodes.set(id2, createNodeMap({ id: id2, type: 'sticky', text: 'Второй', x: 100, y: 0, w: 100, h: 100, author: 'Bob' }));

    // Export both
    const exportAll = generateAiContext(docManager, { boardId, timestamp: '2026-10-25 12:00' });

    // Export only the second node
    const exportSecond = generateAiContext(docManager, {
      boardId,
      scope: 'selection',
      selectedNodeIds: [id2],
      timestamp: '2026-10-25 12:00'
    });

    // Extract short id of id2 from both exports
    // The short id for id2 must be identical in both!
    const shortIdInAll = exportAll.markdown.match(/([a-zA-Z0-9_]{4,8})\s*\|\s*sticky\s*\|.*Второй/)?.[1];
    const shortIdInSecond = exportSecond.markdown.match(/([a-zA-Z0-9_]{4,8})\s*\|\s*sticky\s*\|.*Второй/)?.[1];

    expect(shortIdInAll).toBeDefined();
    expect(shortIdInAll).toBe(shortIdInSecond);
  });

  it('2. Maps hex codes like #fef08a to palette color names (yellow, etc.)', () => {
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-color-names';
    boards.set(boardId, {
      id: boardId,
      title: 'Цвета',
      folder: null,
      createdAt: 1000,
      updatedAt: 1000,
      deleted: false
    });

    const boardDoc = docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const id1 = 'node-hex-yellow';
    nodes.set(id1, createNodeMap({
      id: id1,
      type: 'sticky',
      text: 'Стикер с hex кодом',
      color: '#fef08a',
      author: 'Alice'
    }));

    const result = generateAiContext(docManager, { boardId });
    expect(result.markdown).toContain('yellow');
    expect(result.markdown).not.toContain('#fef08a');
  });

  it('3. Extracts open checkboxes from connected note cards into Открытые задачи with note title prefix', () => {
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { boards, notes } = getIndexMaps(indexDoc);

    // Create note with open checkboxes
    const noteId = 'spec-note-tasks';
    notes.set(noteId, {
      id: noteId,
      title: 'Спецификация API',
      folder: null,
      createdAt: 1000,
      updatedAt: 1000,
      deleted: false
    });

    const noteDoc = docManager.getOrCreateDoc(getNoteDocName(noteId));
    getNoteText(noteDoc).insert(
      0,
      '# Спецификация\n\n- [ ] Настроить rate limiter\n- [x] Добавить cors\n- [ ] Протестировать Range 416'
    );

    // Create board with note card
    const boardId = 'board-with-note-card';
    boards.set(boardId, {
      id: boardId,
      title: 'Доска с задачами из заметки',
      folder: null,
      createdAt: 1000,
      updatedAt: 1000,
      deleted: false
    });

    const boardDoc = docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    nodes.set('card-spec', createNodeMap({
      id: 'card-spec',
      type: 'note',
      noteId,
      text: 'Ссылка на спецификацию'
    }));

    const result = generateAiContext(docManager, { boardId, includeNotes: 'cards' });

    expect(result.markdown).toContain('## Open Tasks');
    expect(result.markdown).toContain('[Спецификация API] Настроить rate limiter');
    expect(result.markdown).toContain('[Спецификация API] Протестировать Range 416');
    const openTasksSection = result.markdown.slice(result.markdown.indexOf('## Open Tasks'));
    expect(openTasksSection).not.toContain('Добавить cors'); // Completed task [x] should not be in open tasks
    expect(result.openTasksCount).toBe(2);
  });
});
