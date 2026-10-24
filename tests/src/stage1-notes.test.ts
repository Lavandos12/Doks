import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { generateTeamKey } from '@doks/agent';
import { getIndexMaps, getNoteDocName } from '@doks/shared';
import { createTestAgent, cleanupTestDir, waitFor, type TestAgentInstance } from './test-helpers.js';
import { NotesSearchIndex } from '../../web/src/search/indexer.js';
import { findBacklinks } from '../../web/src/components/notes/wikilinks-extension.js';

describe('Stage 1: Notes, Folders, [[Links]], Search', () => {
  let agent: TestAgentInstance | undefined;

  afterEach(async () => {
    if (agent) {
      await agent.agent.stop();
      cleanupTestDir(agent.baseDir);
      agent = undefined;
    }
  });

  it('two clients edit the same note concurrently and sync via agent', async () => {
    const teamKey = generateTeamKey();
    agent = await createTestAgent({
      name: 'AgentNotes',
      peerPort: 14750,
      webPort: 13002,
      teamKey
    });

    const docManager = agent.agent.docManager;

    // Simulate Tab 1 and Tab 2 as two client docs syncing with local docManager
    const tab1Doc = new Y.Doc();
    const tab2Doc = new Y.Doc();

    const noteId = 'note-concurrent-1';
    const noteDocName = getNoteDocName(noteId);
    const agentNoteDoc = docManager.getOrCreateDoc(noteDocName);

    // Initial sync
    Y.applyUpdate(tab1Doc, Y.encodeStateAsUpdate(agentNoteDoc));
    Y.applyUpdate(tab2Doc, Y.encodeStateAsUpdate(agentNoteDoc));

    // Wire simulated bidirectional sync between Tab 1 <-> Agent <-> Tab 2
    tab1Doc.on('update', (u) => {
      docManager.applyUpdate(noteDocName, u, 'tab1');
      Y.applyUpdate(tab2Doc, u, 'from-agent');
    });

    tab2Doc.on('update', (u) => {
      docManager.applyUpdate(noteDocName, u, 'tab2');
      Y.applyUpdate(tab1Doc, u, 'from-agent');
    });

    // Tab 1 types at the beginning
    const text1 = tab1Doc.getText('text');
    text1.insert(0, '# Заголовок заметки\n\nВведение в тему.');

    // Tab 2 simultaneously appends at the end
    const text2 = tab2Doc.getText('text');
    text2.insert(text2.length, '\n\nСсылка на [[Архитектура]] проекта.');

    expect(text1.toString()).toBe(text2.toString());
    expect(text1.toString()).toContain('Введение в тему.');
    expect(text1.toString()).toContain('Ссылка на [[Архитектура]] проекта.');
  });

  it('backlinks detection correctly identifies referencing notes', () => {
    const allNotes = [
      { id: '1', title: 'Главная', text: 'Смотри [[Архитектура]] и [[Планы]].' },
      { id: '2', title: 'Планы', text: 'Тут ничего нет.' },
      { id: '3', title: 'Архитектура', text: 'Описание системы.' }
    ];

    const backlinks = findBacklinks('Архитектура', allNotes);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].title).toBe('Главная');
  });

  it('MiniSearch indexes notes and retrieves matching results', () => {
    const indexer = new NotesSearchIndex();
    indexer.updateDoc({
      id: 'note-1',
      title: 'Инструкция по развертыванию',
      text: 'Для запуска используйте node dist/index.js на Windows.'
    });

    indexer.updateDoc({
      id: 'note-2',
      title: 'Планы на релиз',
      text: 'Сделать бесконечную доску и стикеры Miro.'
    });

    const resultsDeploy = indexer.search('развертыванию');
    expect(resultsDeploy.length).toBeGreaterThan(0);
    expect(resultsDeploy[0].id).toBe('note-1');

    const resultsMiro = indexer.search('Miro');
    expect(resultsMiro.length).toBeGreaterThan(0);
    expect(resultsMiro[0].id).toBe('note-2');
  });

  it('folder operations: create, move note to folder, and soft-delete', () => {
    const indexDoc = new Y.Doc();
    const maps = getIndexMaps(indexDoc);

    const folderId = 'folder-123';
    maps.folders.set(folderId, {
      id: folderId,
      name: 'Спецификации',
      parent: null,
      deleted: false
    });

    const noteId = 'note-abc';
    maps.notes.set(noteId, {
      id: noteId,
      title: 'ТЗ проекта',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    // Move note to folder
    const note = maps.notes.get(noteId)!;
    maps.notes.set(noteId, { ...note, folder: folderId });
    expect(maps.notes.get(noteId)?.folder).toBe(folderId);

    // Soft delete
    maps.notes.set(noteId, { ...note, folder: folderId, deleted: true, deletedAt: Date.now() });
    expect(maps.notes.get(noteId)?.deleted).toBe(true);
  });
});
