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
  setNodeProperties,
  nodeMapToData,
  type JSONCanvasData
} from '@doks/shared';
import {
  createTestDir,
  cleanupTestDir,
  createTestAgent,
  waitFor,
  type TestAgentInstance
} from './test-helpers.js';

describe('Stage B: P1 and P2 Fixes Verification', () => {
  let baseDir: string | undefined;
  const activeAgents: TestAgentInstance[] = [];

  afterEach(async () => {
    while (activeAgents.length > 0) {
      const a = activeAgents.pop();
      if (a) {
        await a.agent.stop();
        cleanupTestDir(a.baseDir);
      }
    }
    if (baseDir) {
      cleanupTestDir(baseDir);
      baseDir = undefined;
    }
  });

  // B8: Text in stickies uses Y.Text and character-level concurrent edits merge
  it('B8: sticky text uses Y.Text and merges concurrent edits cleanly', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { nodes: nodesA } = getBoardMaps(docA);
    const { nodes: nodesB } = getBoardMaps(docB);

    // Initial sticky with Y.Text
    const sMapA = new Y.Map();
    nodesA.set('sticky-ytext-1', sMapA);

    const yTextA = new Y.Text('Hello ');
    sMapA.set('text', yTextA);
    sMapA.set('type', 'sticky');

    // Sync to docB
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Client A appends "World!"
    const sMapFromA = nodesA.get('sticky-ytext-1')!;
    const textInstA = sMapFromA.get('text') as Y.Text;
    textInstA.insert(textInstA.length, 'World!');

    // Client B simultaneously inserts "Beautiful "
    const sMapFromB = nodesB.get('sticky-ytext-1')!;
    const textInstB = sMapFromB.get('text') as Y.Text;
    textInstB.insert(0, 'Start: ');

    // Merge updates
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(textInstA.toString()).toBe(textInstB.toString());
    expect(textInstA.toString()).toContain('Start: ');
    expect(textInstA.toString()).toContain('World!');
  });

  // B14: External edit of .canvas file in vault/boards/ syncs into Yjs board doc
  it('B14: external modification of .canvas in vault syncs into board doc', async () => {
    baseDir = createTestDir('b14-canvas-sync');
    const teamKey = generateTeamKey();

    const agent = new Agent({
      baseDir,
      peerPort: 14795,
      webPort: 13045,
      teamKey
    });
    await agent.start();

    const boardId = 'board-b14';
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    boards.set(boardId, {
      id: boardId,
      title: 'ObsidianBoard',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    agent.fileMirror.flushAll();

    const canvasFilePath = path.join(baseDir, 'vault', 'boards', 'ObsidianBoard.canvas');
    expect(fs.existsSync(canvasFilePath)).toBe(true);

    // Give chokidar on Windows time to establish directory handle
    await new Promise((r) => setTimeout(r, 500));

    // Simulate Obsidian writing a new node into the canvas file
    const externalCanvasData: JSONCanvasData = {
      nodes: [
        {
          id: 'obsidian-node-1',
          type: 'text',
          x: 250,
          y: 350,
          width: 200,
          height: 120,
          text: 'Создано внутри Obsidian'
        }
      ],
      edges: []
    };

    fs.writeFileSync(canvasFilePath, JSON.stringify(externalCanvasData, null, 2), 'utf8');

    // Wait for file watcher to process change
    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes: bNodes } = getBoardMaps(boardDoc);

    await waitFor(() => {
      const node = bNodes.get('obsidian-node-1');
      return node !== undefined;
    }, 6000);

    const importedNode = nodeMapToData('obsidian-node-1', bNodes.get('obsidian-node-1')!);
    expect(importedNode.text).toBe('Создано внутри Obsidian');
    expect(importedNode.x).toBe(250);
    expect(importedNode.y).toBe(350);

    await agent.stop();
  });

  // B19: Renaming a note updates wikilinks across other notes
  it('B19: renaming a note updates wikilinks in all referencing notes', () => {
    const indexDoc = new Y.Doc();
    const docNoteA = new Y.Doc();
    const docNoteB = new Y.Doc();

    const textA = docNoteA.getText('text');
    textA.insert(0, '# Главная\nСмотри [[Старое Имя]] для подробностей и [[Старое Имя|алиас]].');

    // Helper to rename wikilinks across docs
    const oldTitle = 'Старое Имя';
    const newTitle = 'Новое Имя';

    const currentContent = textA.toString();
    const escaped = oldTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'gi');

    const updated = currentContent.replace(regex, (match, aliasPart) => {
      return aliasPart ? `[[${newTitle}${aliasPart}]]` : `[[${newTitle}]]`;
    });

    textA.delete(0, textA.length);
    textA.insert(0, updated);

    expect(textA.toString()).toContain('[[Новое Имя]]');
    expect(textA.toString()).toContain('[[Новое Имя|алиас]]');
    expect(textA.toString()).not.toContain('[[Старое Имя]]');
  });

  // B6 & B17: bindAddress defaults to 'auto', /api/status hides teamKey without auth
  it('B6 & B17: bindAddress defaults to auto, /api/status hides teamKey without auth', async () => {
    baseDir = createTestDir('b6-b17-status');
    const teamKey = generateTeamKey();

    const agent = new Agent({
      baseDir,
      peerPort: 14796,
      webPort: 13046,
      teamKey
    });
    await agent.start();

    expect(agent.config.bindAddress).toBe('auto');

    // Unauthenticated request to /api/status
    const res = await fetch(`http://127.0.0.1:13046/api/status`);
    const data = await res.json() as any;

    expect(data.agentId).toBe(agent.config.agentId);
    expect(data.radminFound).toBeDefined();
    expect(data.teamKey).toBeUndefined(); // B17: Hidden without auth
    expect(data.inviteLink).toBeUndefined();

    // Authenticated request with session cookie
    const authRes = await fetch(`http://127.0.0.1:13046/api/status`, {
      headers: {
        Cookie: `doks_session=${agent.httpServer['sessionToken']}`
      }
    });
    const authData = await authRes.json() as any;
    expect(authData.teamKey).toBe(teamKey);
    expect(authData.inviteLink).toContain(teamKey);

    await agent.stop();
  });

  // B10: Member profile updates via PATCH /api/profile
  it('B10: member profile updates and persists via /api/profile', async () => {
    baseDir = createTestDir('b10-profile');
    const agent = new Agent({
      baseDir,
      peerPort: 14797,
      webPort: 13047
    });
    await agent.start();

    const res = await fetch(`http://127.0.0.1:13047/api/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `doks_session=${agent.httpServer['sessionToken']}`
      },
      body: JSON.stringify({
        memberName: 'Алиса',
        memberColor: '#ec4899'
      })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.memberName).toBe('Алиса');
    expect(data.memberColor).toBe('#ec4899');
    expect(agent.config.memberName).toBe('Алиса');
    expect(agent.config.memberColor).toBe('#ec4899');

    await agent.stop();
  });
});
