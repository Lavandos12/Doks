import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as Y from 'yjs';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';
import {
  SOLO_MAIN_BOARD_ID,
  TEAM_MAIN_BOARD_ID,
  globalBoardClipboard
} from '../../web/src/state/app-state.js';
import {
  createNodeMap,
  getBoardMaps,
  nodeMapToData,
  getScopedBoardDocName,
  getScopedIndexDocName,
  getIndexMaps
} from '@doks/shared';

describe('Doks V9: Personal Sketchpad + Shared Board Architecture & 1-Click Push', () => {
  let tmpDir: string;
  let stateStore: StateStore;
  let docManager: DocManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-v9-test-'));
    const teamStore = new StateStore(path.join(tmpDir, 'state_team'));
    const soloStore = new StateStore(path.join(tmpDir, 'state_solo'));
    docManager = new DocManager(teamStore, { soloStateStore: soloStore });
  });

  afterEach(() => {
    docManager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defines canonical board identifiers for solo and team', () => {
    expect(SOLO_MAIN_BOARD_ID).toBe('solo-main');
    expect(TEAM_MAIN_BOARD_ID).toBe('team-main');
  });

  it('stores copied objects in persistent globalBoardClipboard across boards', () => {
    // Simulate copying from personal sketchpad
    const testNodes = [
      { id: 'node-1', type: 'sticky' as const, x: 100, y: 120, w: 200, h: 180, text: 'Private sketch note', color: '3', z: 1, scope: 'solo' as const, deleted: false },
      { id: 'node-2', type: 'image' as const, x: 350, y: 120, w: 300, h: 200, text: 'Screenshot', fileDataUrl: 'data:image/png;base64,AAA', color: '1', z: 2, scope: 'solo' as const, deleted: false }
    ];

    globalBoardClipboard.nodes = testNodes;
    globalBoardClipboard.edges = [];
    globalBoardClipboard.copiedAt = Date.now();
    globalBoardClipboard.sourceScope = 'solo';

    expect(globalBoardClipboard.nodes.length).toBe(2);
    expect(globalBoardClipboard.sourceScope).toBe('solo');
    expect(globalBoardClipboard.nodes[0].text).toBe('Private sketch note');
    expect(globalBoardClipboard.nodes[1].type).toBe('image');
  });

  it('transfers nodes from Solo to Team in 1 click without creating an extra wrapper frame', () => {
    const soloBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', 'solo-push-test'));
    const teamBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('team', 'team-push-test'));

    const { nodes: soloNodes } = getBoardMaps(soloBoardDoc);

    const stickyId = 'sketch-sticky-1';
    soloBoardDoc.transact(() => {
      soloNodes.set(
        stickyId,
        createNodeMap({
          id: stickyId,
          type: 'sticky',
          x: 200,
          y: 200,
          w: 200,
          h: 180,
          text: 'Idea from my private sketchpad',
          color: '3',
          z: 1,
          scope: 'solo',
          deleted: false
        })
      );
    });

    const result = docManager.transferNodes({
      fromScope: 'solo',
      toScope: 'team',
      boardId: 'solo-push-test',
      targetBoardId: 'team-push-test',
      nodeIds: [stickyId],
      includeLinkedNotes: false,
      mode: 'copy'
    });

    expect(result.success).toBe(true);
    expect(result.transferredNodeCount).toBe(1);
    // Explicit V9 requirement: do not wrap in an extra frame!
    expect(result.frameId).toBeUndefined();

    const { nodes: teamNodes } = getBoardMaps(teamBoardDoc);
    expect(teamNodes.size).toBe(1);

    let transferredNode: any = null;
    teamNodes.forEach((nodeMap, id) => {
      transferredNode = nodeMapToData(id, nodeMap);
    });

    expect(transferredNode).not.toBeNull();
    expect(transferredNode.text).toBe('Idea from my private sketchpad');
    expect(transferredNode.scope).toBe('team');
    expect(transferredNode.originId).toBe(stickyId);
    expect(transferredNode.parentId).toBeUndefined();
  });

  it('transfers nodes from Team to Solo in 1 click without creating an extra wrapper frame', () => {
    const teamBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('team', 'team-fork-test'));
    const soloBoardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', 'solo-fork-test'));

    const { nodes: teamNodes } = getBoardMaps(teamBoardDoc);

    const teamCardId = 'team-card-1';
    teamBoardDoc.transact(() => {
      teamNodes.set(
        teamCardId,
        createNodeMap({
          id: teamCardId,
          type: 'note',
          x: 400,
          y: 300,
          w: 240,
          h: 160,
          text: 'Shared Team Specification',
          color: '2',
          z: 1,
          scope: 'team',
          deleted: false
        })
      );
    });

    const result = docManager.transferNodes({
      fromScope: 'team',
      toScope: 'solo',
      boardId: 'team-fork-test',
      targetBoardId: 'solo-fork-test',
      nodeIds: [teamCardId],
      includeLinkedNotes: false,
      mode: 'copy'
    });

    expect(result.success).toBe(true);
    expect(result.transferredNodeCount).toBe(1);
    expect(result.frameId).toBeUndefined();

    const { nodes: soloNodes } = getBoardMaps(soloBoardDoc);
    expect(soloNodes.size).toBe(1);

    let forkedNode: any = null;
    soloNodes.forEach((nodeMap, id) => {
      forkedNode = nodeMapToData(id, nodeMap);
    });

    expect(forkedNode).not.toBeNull();
    expect(forkedNode.text).toBe('Shared Team Specification');
    expect(forkedNode.scope).toBe('solo');
    expect(forkedNode.originId).toBe(teamCardId);
  });
});
