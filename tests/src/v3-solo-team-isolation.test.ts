import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteText,
  createNodeMap,
  getScopedDocName,
  getScopedIndexDocName,
  getScopedBoardDocName,
  getScopedNoteDocName,
  isSoloDoc,
  isTeamDoc,
  nodeMapToData
} from '@doks/shared';
import { StateStore } from '../../agent/src/storage/state-store.js';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { AgentHttpServer } from '../../agent/src/server/http-server.js';
import { AttachmentManager } from '../../agent/src/storage/attachments.js';
import { PeerService } from '../../agent/src/peer/peer-service.js';

describe('V3 Two-Tier Architecture: Solo vs Team Isolation & Cross-Scope Bridge', () => {
  let tmpDir: string;
  let stateStore: StateStore;
  let docManager: DocManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `doks-v3-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    stateStore = new StateStore(path.join(tmpDir, 'state'));
    docManager = new DocManager(stateStore);
  });

  afterEach(() => {
    docManager.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('strictly isolates solo and team containers in DocManager', () => {
    // Solo index vs Team index
    const soloIndex = docManager.getOrCreateDoc('solo:doks-index');
    const teamIndex = docManager.getOrCreateDoc('team:doks-index');

    const soloMaps = getIndexMaps(soloIndex);
    const teamMaps = getIndexMaps(teamIndex);

    soloMaps.notes.set('note-solo-1', {
      id: 'note-solo-1',
      title: 'Private Idea',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'solo'
    });

    teamMaps.notes.set('note-team-1', {
      id: 'note-team-1',
      title: 'Shared Roadmap',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team'
    });

    // Notes in solo must never be visible in team index, and vice versa
    expect(soloMaps.notes.has('note-solo-1')).toBe(true);
    expect(soloMaps.notes.has('note-team-1')).toBe(false);

    expect(teamMaps.notes.has('note-team-1')).toBe(true);
    expect(teamMaps.notes.has('note-solo-1')).toBe(false);

    // assertNotSoloForPeer throws on solo docs
    expect(() => docManager.assertNotSoloForPeer('solo:doks-index')).toThrow(/Hard network isolation/);
    expect(() => docManager.assertNotSoloForPeer('solo:doks-note-123')).toThrow(/Hard network isolation/);
    expect(() => docManager.assertNotSoloForPeer('team:doks-index')).not.toThrow();
    expect(() => docManager.assertNotSoloForPeer('doks-index')).not.toThrow();
  });

  it('promotes nodes and linked notes from Solo to Team with frame grouping', () => {
    const soloBoardId = 'board-solo-alpha';
    const teamBoardId = 'board-team-beta';

    // 1. Setup Solo Board and linked note
    const soloIndex = docManager.getOrCreateDoc('solo:doks-index');
    const { notes: soloNotes, boards: soloBoards } = getIndexMaps(soloIndex);

    soloBoards.set(soloBoardId, {
      id: soloBoardId,
      title: 'My Solo Scratchpad',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'solo'
    });

    const soloNoteId = 'note-solo-arch';
    soloNotes.set(soloNoteId, {
      id: soloNoteId,
      title: 'Architecture Spec',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'solo'
    });

    const soloNoteDoc = docManager.getOrCreateDoc(getScopedNoteDocName('solo', soloNoteId));
    getNoteText(soloNoteDoc).insert(0, '# Top Secret Local Architecture\n\n- Zero leaks to mesh\n- True P2P');

    // Add nodes to solo board: 1 sticky, 1 note card pointing to soloNoteId
    const soloBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', soloBoardId));
    const { nodes: soloBoardNodes } = getBoardMaps(soloBoardDoc);

    const stickyNodeId = 'sticky-1';
    soloBoardNodes.set(stickyNodeId, createNodeMap({
      id: stickyNodeId,
      type: 'sticky',
      x: 100,
      y: 100,
      w: 200,
      h: 150,
      text: 'Solo Concept Note',
      color: '1',
      author: 'Alice',
      z: 1,
      scope: 'solo',
      deleted: false
    }));

    const cardNodeId = 'card-1';
    soloBoardNodes.set(cardNodeId, createNodeMap({
      id: cardNodeId,
      type: 'note',
      noteId: soloNoteId,
      x: 350,
      y: 100,
      w: 220,
      h: 180,
      text: 'Architecture Spec',
      color: '2',
      author: 'Alice',
      z: 2,
      scope: 'solo',
      deleted: false
    }));

    // Setup Target Team Board
    const teamIndex = docManager.getOrCreateDoc('team:doks-index');
    const { boards: teamBoards, notes: teamNotes } = getIndexMaps(teamIndex);

    teamBoards.set(teamBoardId, {
      id: teamBoardId,
      title: 'Team Shared Board',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team'
    });

    // 2. Perform Cross-Scope Bridge Transfer: Promote to Team
    const transferResult = docManager.transferNodes({
      fromScope: 'solo',
      toScope: 'team',
      boardId: soloBoardId,
      targetBoardId: teamBoardId,
      nodeIds: [stickyNodeId, cardNodeId],
      includeLinkedNotes: true,
      mode: 'copy'
    });

    expect(transferResult.success).toBe(true);
    expect(transferResult.transferredNodeCount).toBe(2);
    expect(transferResult.transferredNoteCount).toBe(1);
    expect(transferResult.frameId).toBeDefined();

    // 3. Verify Team Board Contents
    const teamBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('team', teamBoardId));
    const { nodes: teamBoardNodes } = getBoardMaps(teamBoardDoc);

    // Frame node must exist
    const frameNodeMap = teamBoardNodes.get(transferResult.frameId!);
    expect(frameNodeMap).toBeDefined();
    expect(frameNodeMap?.get('type')).toBe('frame');
    expect(frameNodeMap?.get('text')?.toString()).toContain('Публикация из Соло');

    // Transferred nodes must exist with scope: 'team'
    let foundSticky = false;
    let foundCard = false;
    let newNoteId: string | undefined;

    teamBoardNodes.forEach((nodeMap, id) => {
      const data = nodeMapToData(id, nodeMap);
      if (data.type === 'sticky' && data.text === 'Solo Concept Note') {
        foundSticky = true;
        expect(data.scope).toBe('team');
        expect(data.originId).toBe(stickyNodeId);
      } else if (data.type === 'note' && data.text === 'Architecture Spec') {
        foundCard = true;
        expect(data.scope).toBe('team');
        expect(data.originId).toBe(cardNodeId);
        newNoteId = data.noteId;
      }
    });

    expect(foundSticky).toBe(true);
    expect(foundCard).toBe(true);
    expect(newNoteId).toBeDefined();

    // Linked note must exist in team index & note doc
    const promotedNoteMeta = teamNotes.get(newNoteId!);
    expect(promotedNoteMeta).toBeDefined();
    expect(promotedNoteMeta?.scope).toBe('team');
    expect(promotedNoteMeta?.originId).toBe(soloNoteId);
    expect(promotedNoteMeta?.promotedAt).toBeGreaterThan(0);

    const promotedNoteDoc = docManager.getOrCreateDoc(getScopedNoteDocName('team', newNoteId!));
    expect(getNoteText(promotedNoteDoc).toString()).toContain('# Top Secret Local Architecture');

    // Original solo items must remain intact in 'copy' mode
    expect(soloBoardNodes.get(stickyNodeId)?.get('deleted')).toBe(false);
    expect(soloBoardNodes.get(cardNodeId)?.get('deleted')).toBe(false);
  });

  it('forks nodes from Team to Solo with frame grouping', () => {
    const teamBoardId = 'board-team-main';
    const soloBoardId = 'board-solo-personal';

    // 1. Setup Team Board
    const teamIndex = docManager.getOrCreateDoc('team:doks-index');
    const { boards: teamBoards } = getIndexMaps(teamIndex);
    teamBoards.set(teamBoardId, {
      id: teamBoardId,
      title: 'Company Roadmap',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team'
    });

    const teamBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('team', teamBoardId));
    const { nodes: teamNodes } = getBoardMaps(teamBoardDoc);

    const teamStickyId = 'team-item-1';
    teamNodes.set(teamStickyId, createNodeMap({
      id: teamStickyId,
      type: 'sticky',
      x: 200,
      y: 200,
      w: 200,
      h: 150,
      text: 'Q4 Milestone Review',
      color: '3',
      author: 'Bob',
      z: 1,
      scope: 'team',
      deleted: false
    }));

    // Setup Solo Board
    const soloIndex = docManager.getOrCreateDoc('solo:doks-index');
    const { boards: soloBoards } = getIndexMaps(soloIndex);
    soloBoards.set(soloBoardId, {
      id: soloBoardId,
      title: 'Personal Board',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'solo'
    });

    // 2. Fork to Solo
    const forkResult = docManager.transferNodes({
      fromScope: 'team',
      toScope: 'solo',
      boardId: teamBoardId,
      targetBoardId: soloBoardId,
      nodeIds: [teamStickyId],
      mode: 'copy'
    });

    expect(forkResult.success).toBe(true);
    expect(forkResult.transferredNodeCount).toBe(1);

    // 3. Verify Solo Board
    const soloBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', soloBoardId));
    const { nodes: soloNodes } = getBoardMaps(soloBoardDoc);

    const frameNode = soloNodes.get(forkResult.frameId!);
    expect(frameNode?.get('text')?.toString()).toContain('Копия из Команды');

    let foundForked = false;
    soloNodes.forEach((nodeMap, id) => {
      const data = nodeMapToData(id, nodeMap);
      if (data.type === 'sticky' && data.text === 'Q4 Milestone Review') {
        foundForked = true;
        expect(data.scope).toBe('solo');
        expect(data.originId).toBe(teamStickyId);
      }
    });
    expect(foundForked).toBe(true);
  });

  it('PeerService never broadcasts solo updates over the network', () => {
    const config: any = {
      agentId: 'agent-1',
      memberName: 'Alice',
      memberColor: '#ff0000',
      teamKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      peerPort: 4799,
      webPort: 4899,
      peers: [],
      vaultPath: path.join(tmpDir, 'vault'),
      statePath: path.join(tmpDir, 'state')
    };

    const peerService = new PeerService(config, docManager);
    let broadcastCount = 0;
    const originalBroadcast = peerService.broadcastSync.bind(peerService);
    peerService.broadcastSync = (docName: string, update: Uint8Array) => {
      broadcastCount++;
      return originalBroadcast(docName, update);
    };

    // 1. Edit a solo document
    const soloDoc = docManager.getOrCreateDoc('solo:doks-note-secret');
    getNoteText(soloDoc).insert(0, 'Zero Network Activity');

    // broadcastCount MUST be 0
    expect(broadcastCount).toBe(0);

    // 2. Edit a team document
    const teamDoc = docManager.getOrCreateDoc('team:doks-note-public');
    getNoteText(teamDoc).insert(0, 'Mesh Network Activity');

    // broadcastCount MUST be > 0
    expect(broadcastCount).toBeGreaterThan(0);
  });

  it('HTTP server enforces session auth, attachment security headers, and bridge endpoint', async () => {
    const config: any = {
      agentId: 'agent-1',
      memberName: 'Alice',
      memberColor: '#ff0000',
      teamKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      peerPort: 4898,
      webPort: 4898,
      peers: [],
      vaultPath: path.join(tmpDir, 'vault'),
      statePath: path.join(tmpDir, 'state')
    };
    const blobsDir = path.join(tmpDir, 'blobs');
    const attachmentManager = new AttachmentManager(config.vaultPath, blobsDir);
    const peerService = new PeerService(config, docManager);
    const server = new AgentHttpServer({
      config,
      docManager,
      peerService,
      attachmentManager
    });

    const token = (server as any).sessionToken;

    // 1. Unauthorized request
    const unauthRes = await (server as any).fastify.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { host: '127.0.0.1:4898' }
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Authorized request with X-Doks-Token
    const authRes = await (server as any).fastify.inject({
      method: 'GET',
      url: '/api/boards',
      headers: {
        host: '127.0.0.1:4898',
        'x-doks-token': token
      }
    });
    expect(authRes.statusCode).toBe(200);

    // 3. Save SVG attachment and verify security headers (nosniff, CSP sandbox, forced download)
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const attInfo = attachmentManager.saveAttachment(svgContent, 'evil.svg');

    const attRes = await (server as any).fastify.inject({
      method: 'GET',
      url: `/api/attachments/${attInfo.hash}`,
      headers: {
        host: '127.0.0.1:4898',
        'x-doks-token': token
      }
    });
    expect(attRes.statusCode).toBe(200);
    expect(attRes.headers['x-content-type-options']).toBe('nosniff');
    expect(attRes.headers['content-security-policy']).toContain('sandbox');
    expect(attRes.headers['content-disposition']).toContain('attachment');
  });
});
