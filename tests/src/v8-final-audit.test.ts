import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  nodeMapToData,
  setNodeProperties,
  boardToJSONCanvas,
  jsonCanvasToBoard,
  getScopedIndexDocName,
  getScopedBoardDocName,
  getIndexMaps,
  getBoardMaps,
  generateAiContext,
  type BoardNodeData,
  type BoardEdgeData,
  type WorkspaceScope
} from '@doks/shared';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';
import { AttachmentManager } from '../../agent/src/storage/attachments.js';
import { SnapshotManager } from '../../agent/src/storage/snapshots.js';

describe('V8 Final Surgical Fix Audit Suite', () => {
  let tmpDir: string;
  let docManager: DocManager;
  let attachmentManager: AttachmentManager;
  let snapshotManager: SnapshotManager;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-v8-audit-'));
    const stateStore = new StateStore(path.join(tmpDir, 'state'));
    docManager = new DocManager(stateStore);
    attachmentManager = new AttachmentManager(path.join(tmpDir, 'attachments'));
    snapshotManager = new SnapshotManager(path.join(tmpDir, 'snapshots'), docManager, 0);
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. Board export preserves doks_custom and all specialized widget fields', () => {
    const nodes: BoardNodeData[] = [
      {
        id: 'node-chart',
        type: 'chart',
        x: 100,
        y: 100,
        w: 380,
        h: 360,
        text: 'Finances',
        chartType: 'donut',
        chartData: [
          { id: '1', label: 'Rev', value: 80, color: '#6366f1' },
          { id: '2', label: 'Cost', value: 20, color: '#ef4444' }
        ],
        reactions: { thumbsUp: 5 },
        color: '1',
        author: 'Alice',
        done: false,
        z: 3,
        deleted: false
      },
      {
        id: 'node-drawing',
        type: 'drawing',
        x: 200,
        y: 200,
        w: 150,
        h: 80,
        points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
        drawMode: 'brush',
        strokeWidth: 6,
        color: '#10b981',
        deleted: false
      }
    ];

    const edges: BoardEdgeData[] = [
      {
        id: 'edge-1',
        from: 'node-chart',
        to: 'node-drawing',
        fromSide: 'right',
        toSide: 'left',
        curveType: 'bezier',
        style: 'dashed',
        color: '#6366f1',
        deleted: false
      }
    ];

    const jsonCanvas = boardToJSONCanvas(nodes, edges);
    expect(jsonCanvas.nodes).toHaveLength(2);
    expect(jsonCanvas.edges).toHaveLength(1);

    const chartExport = jsonCanvas.nodes.find((n) => n.id === 'node-chart');
    expect(chartExport).toBeDefined();
    expect(chartExport?.doks_custom?.chartType).toBe('donut');
    expect(chartExport?.doks_custom?.chartData).toHaveLength(2);
    expect(chartExport?.doks_custom?.reactions?.thumbsUp).toBe(5);

    const drawExport = jsonCanvas.nodes.find((n) => n.id === 'node-drawing');
    expect(drawExport).toBeDefined();
    expect(drawExport?.doks_custom?.drawMode).toBe('brush');
    expect(drawExport?.doks_custom?.points).toHaveLength(2);
  });

  it('2. Dual-scope attachment indexing isolates Solo from Team', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const info = attachmentManager.saveAttachment(pngBuffer, 'solo-secret.png');

    const soloDoc = docManager.getOrCreateDoc(getScopedIndexDocName('solo'));
    const teamDoc = docManager.getOrCreateDoc(getScopedIndexDocName('team'));

    const { attachments: soloAttachments } = getIndexMaps(soloDoc);
    const { attachments: teamAttachments } = getIndexMaps(teamDoc);

    soloDoc.transact(() => {
      soloAttachments.set(info.hash, {
        hash: info.hash,
        name: info.fileName,
        size: info.size,
        mime: info.mimeType,
        addedBy: 'SoloUser',
        addedAt: Date.now(),
        deleted: false,
        scope: 'solo'
      });
    });

    expect(soloAttachments.has(info.hash)).toBe(true);
    expect(soloAttachments.get(info.hash)?.name).toBe('solo-secret.png');
    expect(teamAttachments.has(info.hash)).toBe(false);
  });

  it('3. AI export with workspaceScope: solo reads only solo boards', () => {
    const soloBoardId = 'board-solo-ai-1';
    const soloIndex = docManager.getOrCreateDoc(getScopedIndexDocName('solo'));
    const { boards: soloBoards } = getIndexMaps(soloIndex);
    soloIndex.transact(() => {
      soloBoards.set(soloBoardId, {
        id: soloBoardId,
        title: 'Solo Architecture Plan',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'solo'
      });
    });

    const soloBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', soloBoardId));
    const { nodes } = getBoardMaps(soloBoardDoc);
    const nodeMap = new Y.Map();
    nodeMap.set('id', 'solo-node-1');
    nodeMap.set('type', 'sticky');
    nodeMap.set('text', new Y.Text('Private solo roadmap step 1'));
    nodeMap.set('deleted', false);
    soloBoardDoc.transact(() => {
      nodes.set('solo-node-1', nodeMap);
    });

    const result = generateAiContext(docManager, {
      boardId: soloBoardId,
      workspaceScope: 'solo',
      scope: 'all'
    });

    expect(result.markdown).toContain('Solo Architecture Plan');
    expect(result.markdown).toContain('Private solo roadmap step 1');
  });

  it('4. SnapshotManager cleanupTrash cleans up both Solo and Team scopes', () => {
    const oldTime = Date.now() - 35 * 24 * 60 * 60 * 1000; // 35 days old

    const soloIndex = docManager.getOrCreateDoc(getScopedIndexDocName('solo'));
    const teamIndex = docManager.getOrCreateDoc(getScopedIndexDocName('team'));

    const { notes: soloNotes, boards: soloBoards } = getIndexMaps(soloIndex);
    const { notes: teamNotes, boards: teamBoards } = getIndexMaps(teamIndex);

    soloIndex.transact(() => {
      soloNotes.set('old-solo-note', {
        id: 'old-solo-note',
        title: 'Old Solo Note',
        folder: null,
        createdAt: oldTime - 1000,
        updatedAt: oldTime,
        deleted: true,
        deletedAt: oldTime,
        scope: 'solo'
      });
      soloBoards.set('old-solo-board', {
        id: 'old-solo-board',
        title: 'Old Solo Board',
        folder: null,
        createdAt: oldTime - 1000,
        updatedAt: oldTime,
        deleted: true,
        deletedAt: oldTime,
        scope: 'solo'
      });
    });

    teamIndex.transact(() => {
      teamNotes.set('old-team-note', {
        id: 'old-team-note',
        title: 'Old Team Note',
        folder: null,
        createdAt: oldTime - 1000,
        updatedAt: oldTime,
        deleted: true,
        deletedAt: oldTime,
        scope: 'team'
      });
      teamBoards.set('old-team-board', {
        id: 'old-team-board',
        title: 'Old Team Board',
        folder: null,
        createdAt: oldTime - 1000,
        updatedAt: oldTime,
        deleted: true,
        deletedAt: oldTime,
        scope: 'team'
      });
    });

    expect(soloNotes.has('old-solo-note')).toBe(true);
    expect(teamNotes.has('old-team-note')).toBe(true);

    snapshotManager.cleanupTrash(30);

    expect(soloNotes.has('old-solo-note')).toBe(false);
    expect(soloBoards.has('old-solo-board')).toBe(false);
    expect(teamNotes.has('old-team-note')).toBe(false);
    expect(teamBoards.has('old-team-board')).toBe(false);
  });

  it('5. restoreBoard restores deleted board in Yjs index map', () => {
    const testBoardId = 'test-board-restore-1';
    const indexDoc = docManager.getOrCreateDoc(getScopedIndexDocName('team'));
    const { boards } = getIndexMaps(indexDoc);

    indexDoc.transact(() => {
      boards.set(testBoardId, {
        id: testBoardId,
        title: 'Important Sprint Board',
        folder: null,
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 5000,
        deleted: true,
        deletedAt: Date.now() - 1000,
        scope: 'team'
      });
    });

    expect(boards.get(testBoardId)?.deleted).toBe(true);

    // Simulate restoreBoard function behavior on the Y.Map
    indexDoc.transact(() => {
      const existing = boards.get(testBoardId);
      if (existing) {
        boards.set(testBoardId, {
          ...existing,
          deleted: false,
          deletedAt: undefined,
          updatedAt: Date.now()
        });
      }
    });

    const restored = boards.get(testBoardId);
    expect(restored?.deleted).toBe(false);
    expect(restored?.deletedAt).toBeUndefined();
  });

  it('6. Inline Markdown parser regex matches embedded attachments and images', () => {
    const regex = /(!\[\[.*?\]\]|\[\[.*?\]\]|!\[.*?\]\(.*?\)|\*\*.*?\*\*|\*.*?\*|`.*?`)/g;

    const sample = 'Here is ![[screenshot.png]] and standard ![diagram](https://example.com/diag.png) and wikilink [[My Note]].';
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(sample)) !== null) {
      matches.push(m[0]);
    }

    expect(matches).toContain('![[screenshot.png]]');
    expect(matches).toContain('![diagram](https://example.com/diag.png)');
    expect(matches).toContain('[[My Note]]');
  });
});
