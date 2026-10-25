import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Agent, generateTeamKey } from '@doks/agent';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteDocName,
  getBoardDocName,
  setNodeProperties
} from '@doks/shared';
import { createTestDir, cleanupTestDir } from './test-helpers.js';

describe('Stage 3: Disk Mirroring (.md, .canvas), State Persistence & Agent Restart', () => {
  let baseDir: string | undefined;

  afterEach(() => {
    if (baseDir) {
      cleanupTestDir(baseDir);
      baseDir = undefined;
    }
  });

  it('persists notes and boards to disk and restores completely on agent restart', async () => {
    baseDir = createTestDir('stage3');
    const teamKey = generateTeamKey();

    // 1. Start initial agent
    let agent = new Agent({
      baseDir,
      peerPort: 14755,
      webPort: 13005,
      teamKey,
      memberName: 'PersistTester'
    });
    await agent.start();

    const docManager = agent.docManager;
    const indexDoc = docManager.getOrCreateDoc(DOC_INDEX);
    const { notes, boards, folders } = getIndexMaps(indexDoc);

    // Create a folder
    const folderId = 'folder-arch';
    folders.set(folderId, {
      id: folderId,
      name: 'Архитектура',
      parent: null,
      deleted: false
    });

    // Create a note in that folder
    const noteId = 'note-server';
    notes.set(noteId, {
      id: noteId,
      title: 'Серверная часть',
      folder: folderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const noteDoc = docManager.getOrCreateDoc(getNoteDocName(noteId));
    noteDoc.getText('text').insert(0, '# Fastify и Yjs\n\nСервер синхронизации.');

    // Create a board
    const boardId = 'board-main';
    boards.set(boardId, {
      id: boardId,
      title: 'Основная схема',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const boardDoc = docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes: bNodes, edges: bEdges } = getBoardMaps(boardDoc);

    const s1 = new Y.Map();
    bNodes.set('s1', s1);
    setNodeProperties(s1, {
      id: 's1',
      type: 'sticky',
      x: 120,
      y: 140,
      w: 180,
      h: 100,
      text: 'Модуль хранилища',
      color: '4',
      author: 'Алиса',
      done: true,
      deleted: false
    });

    bEdges.set('e1', {
      id: 'e1',
      from: 's1',
      to: 's2',
      label: 'поток данных',
      deleted: false
    });

    // Flush all files to disk
    agent.fileMirror.flushAll();

    // 2. Verify files created on disk
    const noteFile = path.join(baseDir, 'vault', 'Архитектура', 'Серверная часть.md');
    expect(fs.existsSync(noteFile)).toBe(true);

    const noteContent = fs.readFileSync(noteFile, 'utf8');
    expect(noteContent).toContain('---');
    expect(noteContent).toContain(`id: ${noteId}`);
    expect(noteContent).toContain('title: "Серверная часть"');
    expect(noteContent).toContain('# Fastify и Yjs');

    const canvasFile = path.join(baseDir, 'vault', 'boards', 'Основная схема.canvas');
    expect(fs.existsSync(canvasFile)).toBe(true);

    const canvasJson = JSON.parse(fs.readFileSync(canvasFile, 'utf8'));
    expect(canvasJson.nodes).toBeDefined();
    expect(canvasJson.nodes.length).toBe(1);
    expect(canvasJson.nodes[0].text).toBe('Модуль хранилища');
    expect(canvasJson.nodes[0].doks_custom.done).toBe(true);
    expect(canvasJson.edges.length).toBe(1);
    expect(canvasJson.edges[0].label).toBe('поток данных');

    // Verify .doks/state/ files exist
    const stateDir = path.join(baseDir, '.doks', 'state');
    expect(fs.existsSync(path.join(stateDir, `${DOC_INDEX}.bin`))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, `doks-note-${noteId}.bin`))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, `doks-board-${boardId}.bin`))).toBe(true);

    // 3. Stop agent completely
    await agent.stop();

    // 4. Start fresh agent on the same baseDir
    const restoredAgent = new Agent({
      baseDir,
      peerPort: 14756,
      webPort: 13006
    });
    await restoredAgent.start();

    // 5. Check that data is restored from .doks/state
    const restoredIndex = restoredAgent.docManager.getOrCreateDoc(DOC_INDEX);
    const restoredMaps = getIndexMaps(restoredIndex);

    const restoredNoteMeta = restoredMaps.notes.get(noteId);
    expect(restoredNoteMeta).toBeDefined();
    expect(restoredNoteMeta?.title).toBe('Серверная часть');

    const restoredNoteDoc = restoredAgent.docManager.getOrCreateDoc(getNoteDocName(noteId));
    expect(restoredNoteDoc.getText('text').toString()).toBe('# Fastify и Yjs\n\nСервер синхронизации.');

    const restoredBoardDoc = restoredAgent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes: restoredNodes, edges: restoredEdges } = getBoardMaps(restoredBoardDoc);
    expect(restoredNodes.get('s1')).toBeDefined();
    expect(restoredEdges.get('e1')).toBeDefined();
    expect(restoredEdges.get('e1')?.label).toBe('поток данных');

    await restoredAgent.stop();
  });
});
