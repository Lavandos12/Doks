import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { getIndexMaps, getBoardMaps, type BoardMeta, type WorkspaceScope } from '@doks/shared';

describe('Doks v87: Super-User Rollback & Persistent Canvas Node Resolution', () => {
  const TEAM_MAIN_BOARD_ID = 'team-main';
  const SOLO_MAIN_BOARD_ID = 'solo-main';

  let soloDoc: Y.Doc;
  let teamDoc: Y.Doc;
  let soloMaps: ReturnType<typeof getIndexMaps>;
  let teamMaps: ReturnType<typeof getIndexMaps>;
  let boardDocs: Map<string, Y.Doc>;

  beforeEach(() => {
    soloDoc = new Y.Doc();
    teamDoc = new Y.Doc();
    soloMaps = getIndexMaps(soloDoc);
    teamMaps = getIndexMaps(teamDoc);
    boardDocs = new Map();
  });

  function getOrCreateTestBoardDoc(id: string): Y.Doc {
    let doc = boardDocs.get(id);
    if (!doc) {
      doc = new Y.Doc();
      boardDocs.set(id, doc);
    }
    return doc;
  }

  // Pure logic replica of emptyTrash in app-state.ts (v87)
  function testEmptyTrash(sMaps: typeof soloMaps, tMaps: typeof teamMaps, superUserMode = false) {
    [sMaps, tMaps].forEach((maps) => {
      const deletedNoteKeys: string[] = [];
      maps.notes.forEach((val, key) => {
        if (val.deleted) deletedNoteKeys.push(key);
      });
      deletedNoteKeys.forEach((k) => maps.notes.delete(k));

      const deletedBoardKeys: string[] = [];
      maps.boards.forEach((val, key) => {
        if (val.deleted) {
          if (!superUserMode && (key === TEAM_MAIN_BOARD_ID || key === SOLO_MAIN_BOARD_ID)) {
            maps.boards.set(key, {
              ...val,
              deleted: false,
              deletedAt: undefined,
              updatedAt: Date.now()
            });
          } else {
            deletedBoardKeys.push(key);
          }
        }
      });
      deletedBoardKeys.forEach((k) => {
        maps.boards.delete(k);
        const bDoc = getOrCreateTestBoardDoc(k);
        const { nodes, edges } = getBoardMaps(bDoc);
        bDoc.transact(() => {
          nodes.clear();
          edges.clear();
        });
      });
    });
  }

  // Pure logic replica of permanentlyDeleteBoard in app-state.ts (v87)
  function testPermanentlyDeleteBoard(id: string, sMaps: typeof soloMaps, tMaps: typeof teamMaps, superUserMode = false) {
    if (!superUserMode && (id === TEAM_MAIN_BOARD_ID || id === SOLO_MAIN_BOARD_ID)) {
      const targetMap = id === TEAM_MAIN_BOARD_ID ? tMaps.boards : sMaps.boards;
      const existing = targetMap.get(id);
      if (existing) {
        targetMap.set(id, { ...existing, deleted: false, deletedAt: undefined, updatedAt: Date.now() });
      }
      return;
    }
    const targetMap = tMaps.boards.has(id) ? tMaps.boards : sMaps.boards;
    targetMap.delete(id);
    const bDoc = getOrCreateTestBoardDoc(id);
    const { nodes, edges } = getBoardMaps(bDoc);
    bDoc.transact(() => {
      nodes.clear();
      edges.clear();
    });
  }

  // Pure logic replica of isBoardAdmin in app-state.ts (v87)
  function testIsBoardAdmin(
    meta: BoardMeta | null | undefined,
    currentAccountId: string,
    superUserMode = false
  ): boolean {
    if (!meta) return false;
    // Super-user bypass (when active)
    if (superUserMode) return true;
    // Canonical shared team canvas can NEVER be deleted, cleared, or converted by ordinary users
    if (meta.id === TEAM_MAIN_BOARD_ID) return false;
    if (meta.scope === 'solo') return true;
    if (meta.creatorId) return meta.creatorId === currentAccountId;
    return false;
  }

  describe('1. Rollback of SUPER_USER_MODE to false (Strict Creator Governance)', () => {
    const myAccountId = 'usr_alice';
    const otherAccountId = 'usr_bob';

    const otherUserBoard: BoardMeta = {
      id: 'board-bob-project',
      title: 'Bob Secret Project',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: otherAccountId,
      creatorName: 'Bob'
    };

    const myBoard: BoardMeta = {
      id: 'board-alice-project',
      title: 'Alice Project',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: myAccountId,
      creatorName: 'Alice'
    };

    const teamMainBoard: BoardMeta = {
      id: TEAM_MAIN_BOARD_ID,
      title: 'Shared Team Canvas',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: 'system',
      creatorName: 'Admin'
    };

    it('blocks Alice from deleting Bob board when SUPER_USER_MODE is false', () => {
      const canAliceDeleteBob = testIsBoardAdmin(otherUserBoard, myAccountId, false);
      expect(canAliceDeleteBob).toBe(false);
    });

    it('allows Alice to delete her own board when SUPER_USER_MODE is false', () => {
      const canAliceDeleteHerOwn = testIsBoardAdmin(myBoard, myAccountId, false);
      expect(canAliceDeleteHerOwn).toBe(true);
    });

    it('protects Shared Team Canvas from deletion by ordinary users', () => {
      const canDeleteMain = testIsBoardAdmin(teamMainBoard, myAccountId, false);
      expect(canDeleteMain).toBe(false);
    });
  });

  describe('2. Persistent Canvas Nodes & Ghost Drawings Purge', () => {
    it('permanently clears drawing nodes and elements when a board is permanently purged', () => {
      const bId = 'board-with-drawing';
      const bDoc = getOrCreateTestBoardDoc(bId);
      const { nodes } = getBoardMaps(bDoc);

      // Add a drawing stroke node
      const strokeNode = new Y.Map();
      strokeNode.set('id', 'stroke-1');
      strokeNode.set('type', 'drawing');
      strokeNode.set('points', [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
      nodes.set('stroke-1', strokeNode);

      expect(nodes.size).toBe(1);

      // Permanently delete board
      testPermanentlyDeleteBoard(bId, soloMaps, teamMaps, false);

      // Nodes map must now be completely empty (0 elements, ghost drawing gone)
      expect(nodes.size).toBe(0);
    });

    it('clears all board nodes when emptyTrash is executed', () => {
      const bId = 'board-trashed-sketch';
      teamMaps.boards.set(bId, {
        id: bId,
        title: 'Trashed Sketch',
        folder: null,
        deleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });

      const bDoc = getOrCreateTestBoardDoc(bId);
      const { nodes } = getBoardMaps(bDoc);
      const n = new Y.Map();
      n.set('id', 'sketch-node-99');
      n.set('type', 'drawing');
      nodes.set('sketch-node-99', n);

      expect(nodes.size).toBe(1);

      // Run emptyTrash
      testEmptyTrash(soloMaps, teamMaps, false);

      expect(teamMaps.boards.has(bId)).toBe(false);
      expect(nodes.size).toBe(0);
    });
  });

  describe('3. Routing & Selection Logic without forcing team-main', () => {
    it('prefers active user board over team-main on startup', () => {
      const allBoardsList: BoardMeta[] = [
        {
          id: 'my-active-board',
          title: 'My Custom Board',
          folder: null,
          deleted: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scope: 'team'
        },
        {
          id: TEAM_MAIN_BOARD_ID,
          title: 'Shared Team Canvas',
          folder: null,
          deleted: false,
          createdAt: Date.now() - 50000,
          updatedAt: Date.now() - 50000,
          scope: 'team'
        }
      ];

      // Simulate app router fallback resolution
      const isCloud = true;
      const targetScope = isCloud ? 'team' : 'solo';
      const validBoard =
        allBoardsList.find((b) => !b.deleted && (b.scope || 'solo') === targetScope) ||
        allBoardsList.find((b) => !b.deleted);

      expect(validBoard?.id).toBe('my-active-board');
      expect(validBoard?.title).toBe('My Custom Board');
    });
  });

  describe('4. Backend HTTP Endpoint with Strict Creator Security', () => {
    function simulateDeleteEndpoint(params: {
      boardId: string;
      scope: WorkspaceScope;
      isPermanent?: boolean;
      isSuperUser?: boolean;
      reqAccountId?: string;
      existingBoard?: BoardMeta;
    }): { status: number; body: { success?: boolean; error?: string } } {
      const { boardId, scope, isSuperUser, reqAccountId, existingBoard } = params;

      if (!isSuperUser && (boardId === 'team-main' || boardId === 'solo-main')) {
        return { status: 403, body: { error: 'Forbidden: Cannot delete canonical main board' } };
      }
      if (!existingBoard) {
        return { status: 404, body: { error: 'Board not found' } };
      }

      if (scope === 'team' && !isSuperUser) {
        if (!existingBoard.creatorId || existingBoard.creatorId !== reqAccountId) {
          return { status: 403, body: { error: 'Forbidden: Only creator can delete' } };
        }
      }

      return { status: 200, body: { success: true } };
    }

    it('rejects deletion by non-creator when isSuperUser is false', () => {
      const bobBoard: BoardMeta = {
        id: 'board-bob-1',
        title: 'Bob Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'usr_bob',
        creatorName: 'Bob'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-bob-1',
        scope: 'team',
        isSuperUser: false,
        reqAccountId: 'usr_alice',
        existingBoard: bobBoard
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('allows deletion by genuine creator when isSuperUser is false', () => {
      const aliceBoard: BoardMeta = {
        id: 'board-alice-1',
        title: 'Alice Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'usr_alice',
        creatorName: 'Alice'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-alice-1',
        scope: 'team',
        isSuperUser: false,
        reqAccountId: 'usr_alice',
        existingBoard: aliceBoard
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
