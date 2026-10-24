import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Agent, generateTeamKey } from '@doks/agent';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteDocName,
  getBoardDocName,
  nodeMapToData,
  setNodeProperties
} from '@doks/shared';
import { createTestDir, cleanupTestDir } from './test-helpers.js';

describe('Stage 5: Snapshots, Trash & Recovery', () => {
  let baseDir: string | undefined;
  let agent: Agent | undefined;

  afterEach(async () => {
    if (agent) {
      await agent.stop();
      agent = undefined;
    }
    if (baseDir) {
      cleanupTestDir(baseDir);
      baseDir = undefined;
    }
  });

  it('rolls back note content from a saved snapshot', async () => {
    baseDir = createTestDir('stage5-snap');
    const teamKey = generateTeamKey();

    agent = new Agent({
      baseDir,
      peerPort: 14770,
      webPort: 13020,
      teamKey
    });
    await agent.start();

    const noteId = 'note-rollback';
    const noteDocName = getNoteDocName(noteId);
    const noteDoc = agent.docManager.getOrCreateDoc(noteDocName);
    const text = noteDoc.getText('text');
    text.insert(0, 'Версия 1: Исходный правильный текст');

    // Create snapshot
    const snapMeta = agent.snapshotManager.createSnapshot();
    expect(snapMeta.docsCount).toBeGreaterThan(0);

    // Now corrupt/modify the note
    text.delete(0, text.length);
    text.insert(0, 'Версия 2: Случайно удаленный и испорченный текст');
    expect(text.toString()).toBe('Версия 2: Случайно удаленный и испорченный текст');

    // Restore from snapshot
    const ok = agent.snapshotManager.restoreSnapshot(snapMeta.id, noteDocName);
    expect(ok).toBe(true);

    // Verify content is recovered
    expect(text.toString()).toContain('Версия 1: Исходный правильный текст');
  });

  it('restores soft-deleted sticky from trash without losing text or properties', async () => {
    baseDir = createTestDir('stage5-trash');
    const teamKey = generateTeamKey();

    agent = new Agent({
      baseDir,
      peerPort: 14771,
      webPort: 13021,
      teamKey
    });
    await agent.start();

    const boardId = 'board-trash-test';
    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const stickyId = 'sticky-trash-item';
    const sMap = new Y.Map();
    nodes.set(stickyId, sMap);
    setNodeProperties(sMap, {
      id: stickyId,
      type: 'sticky',
      x: 200,
      y: 200,
      w: 180,
      h: 120,
      text: 'Очень важный стикер с идеей',
      color: '3',
      author: 'Алиса',
      deleted: false
    });

    // Soft delete: marks deleted = true
    sMap.set('deleted', true);
    sMap.set('deletedAt', Date.now());

    let data = nodeMapToData(stickyId, sMap);
    expect(data.deleted).toBe(true);

    // Restore from trash
    sMap.set('deleted', false);
    sMap.delete('deletedAt');

    data = nodeMapToData(stickyId, sMap);
    expect(data.deleted).toBe(false);
    expect(data.text).toBe('Очень важный стикер с идеей');
    expect(data.color).toBe('3');
  });

  it('prunes trash older than 30 days while preserving recent deleted items', async () => {
    baseDir = createTestDir('stage5-prune');
    const teamKey = generateTeamKey();

    agent = new Agent({
      baseDir,
      peerPort: 14772,
      webPort: 13022,
      teamKey
    });
    await agent.start();

    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes } = getIndexMaps(indexDoc);

    const oldNoteId = 'note-old-trash';
    const recentNoteId = 'note-recent-trash';

    const thirtyFiveDaysAgo = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

    notes.set(oldNoteId, {
      id: oldNoteId,
      title: 'Старая заметка',
      folder: null,
      createdAt: thirtyFiveDaysAgo,
      updatedAt: thirtyFiveDaysAgo,
      deleted: true,
      deletedAt: thirtyFiveDaysAgo
    });

    notes.set(recentNoteId, {
      id: recentNoteId,
      title: 'Свежая заметка в корзине',
      folder: null,
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
      deleted: true,
      deletedAt: twoDaysAgo
    });

    // Run trash cleanup
    agent.snapshotManager.cleanupTrash(30);

    // 35-day-old note must be permanently pruned
    expect(notes.has(oldNoteId)).toBe(false);

    // 2-day-old note must still exist in trash
    expect(notes.has(recentNoteId)).toBe(true);
    expect(notes.get(recentNoteId)?.deleted).toBe(true);
  });
});
