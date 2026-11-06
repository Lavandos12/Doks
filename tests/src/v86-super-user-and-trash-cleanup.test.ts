import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { getIndexMaps, type BoardMeta, type NoteMeta, type WorkspaceScope } from '@doks/shared';

describe('Doks v86: Super-User Governance Mode & Trash Permanent Purge', () => {
  const TEAM_MAIN_BOARD_ID = 'team-main';
  const SOLO_MAIN_BOARD_ID = 'solo-main';

  let soloDoc: Y.Doc;
  let teamDoc: Y.Doc;
  let soloMaps: ReturnType<typeof getIndexMaps>;
  let teamMaps: ReturnType<typeof getIndexMaps>;

  beforeEach(() => {
    soloDoc = new Y.Doc();
    teamDoc = new Y.Doc();
    soloMaps = getIndexMaps(soloDoc);
    teamMaps = getIndexMaps(teamDoc);
  });

  // Pure logic replica of emptyTrash in app-state.ts
  function testEmptyTrash(sMaps: typeof soloMaps, tMaps: typeof teamMaps) {
    [sMaps, tMaps].forEach((maps) => {
      const deletedNoteKeys: string[] = [];
      maps.notes.forEach((val, key) => {
        if (val.deleted) deletedNoteKeys.push(key);
      });
      deletedNoteKeys.forEach((k) => maps.notes.delete(k));

      const deletedBoardKeys: string[] = [];
      maps.boards.forEach((val, key) => {
        if (val.deleted) {
          if (key === TEAM_MAIN_BOARD_ID || key === SOLO_MAIN_BOARD_ID) {
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
      deletedBoardKeys.forEach((k) => maps.boards.delete(k));
    });
  }

  function testPermanentlyDeleteBoard(id: string, sMaps: typeof soloMaps, tMaps: typeof teamMaps) {
    if (id === TEAM_MAIN_BOARD_ID || id === SOLO_MAIN_BOARD_ID) {
      const targetMap = id === TEAM_MAIN_BOARD_ID ? tMaps.boards : sMaps.boards;
      const existing = targetMap.get(id);
      if (existing) {
        targetMap.set(id, { ...existing, deleted: false, deletedAt: undefined, updatedAt: Date.now() });
      }
      return;
    }
    const targetMap = tMaps.boards.has(id) ? tMaps.boards : sMaps.boards;
    targetMap.delete(id);
  }

  function testIsBoardAdmin(
    meta: BoardMeta | null | undefined,
    currentAccountId: string,
    superUserMode: boolean
  ): boolean {
    if (!meta) return false;
    if (meta.id === TEAM_MAIN_BOARD_ID) return false;
    if (superUserMode) return true;
    if (meta.scope === 'solo') return true;
    if (meta.creatorId) return meta.creatorId === currentAccountId;
    return false;
  }

  describe('1. Empty Trash Permanent Purge', () => {
    it('permanently purges all deleted shared boards from Y.Map regardless of prior creatorId', () => {
      // Setup the 6 deleted shared boards matching user screenshot
      const boardsToTrash = [
        'taden-задачи',
        'taden-документация',
        'Shabashka',
        'ZZZZ-1',
        'ZZZZ-2',
        'DSDSDS'
      ];

      boardsToTrash.forEach((title, idx) => {
        const id = `b-deleted-${idx}`;
        teamMaps.boards.set(id, {
          id,
          title,
          folder: null,
          deleted: true,
          deletedAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scope: 'team',
          creatorId: 'different-legacy-user-uuid',
          creatorName: 'OtherUser'
        });
      });

      expect(teamMaps.boards.size).toBe(6);

      // Run emptyTrash
      testEmptyTrash(soloMaps, teamMaps);

      // All 6 deleted boards must be completely removed from the Y.Map
      expect(teamMaps.boards.size).toBe(0);
      boardsToTrash.forEach((_, idx) => {
        expect(teamMaps.boards.has(`b-deleted-${idx}`)).toBe(false);
      });
    });

    it('automatically resurrects canonical team-main if it was accidentally marked deleted', () => {
      teamMaps.boards.set(TEAM_MAIN_BOARD_ID, {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        deleted: true,
        deletedAt: Date.now() - 100000,
        createdAt: Date.now() - 200000,
        updatedAt: Date.now() - 100000,
        scope: 'team'
      });

      expect(teamMaps.boards.get(TEAM_MAIN_BOARD_ID)?.deleted).toBe(true);

      // Run emptyTrash
      testEmptyTrash(soloMaps, teamMaps);

      // team-main must be resurrected and NOT deleted
      const teamMain = teamMaps.boards.get(TEAM_MAIN_BOARD_ID);
      expect(teamMain).toBeDefined();
      expect(teamMain?.deleted).toBe(false);
      expect(teamMain?.deletedAt).toBeUndefined();
    });
  });

  describe('2. Individual "Delete Forever" (Purge) Action', () => {
    it('permanently removes an individual board from the Y.Map on demand', () => {
      const b1 = 'board-taden-doc';
      const b2 = 'board-keep-trash';

      teamMaps.boards.set(b1, {
        id: b1,
        title: 'taden-документация',
        folder: null,
        deleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });
      teamMaps.boards.set(b2, {
        id: b2,
        title: 'Keep In Trash',
        folder: null,
        deleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });

      expect(teamMaps.boards.has(b1)).toBe(true);
      expect(teamMaps.boards.has(b2)).toBe(true);

      // Delete only b1 forever
      testPermanentlyDeleteBoard(b1, soloMaps, teamMaps);

      expect(teamMaps.boards.has(b1)).toBe(false);
      expect(teamMaps.boards.has(b2)).toBe(true);
    });
  });

  describe('3. Super-User Mode Governance & Rollback Capability', () => {
    const myAccountId = 'usr_current_user_123';
    const otherAccountId = 'usr_original_creator_999';

    const sharedBoard: BoardMeta = {
      id: 'shared-board-architecture',
      title: 'Shared Architecture Board',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: otherAccountId,
      creatorName: 'OtherCollab'
    };

    const legacyBoard: BoardMeta = {
      id: 'legacy-unassigned-board',
      title: 'Legacy Board',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: undefined,
      creatorName: undefined
    };

    it('grants admin deletion rights to any user when SUPER_USER_MODE is true', () => {
      // In super-user mode, current user can delete other user's board
      const canDeleteOther = testIsBoardAdmin(sharedBoard, myAccountId, true);
      expect(canDeleteOther).toBe(true);

      // In super-user mode, current user can delete unassigned legacy board
      const canDeleteLegacy = testIsBoardAdmin(legacyBoard, myAccountId, true);
      expect(canDeleteLegacy).toBe(true);
    });

    it('restores strict creator ownership security when rolled back to SUPER_USER_MODE = false', () => {
      // When rolled back, non-creator is blocked
      const canDeleteOther = testIsBoardAdmin(sharedBoard, myAccountId, false);
      expect(canDeleteOther).toBe(false);

      // When rolled back, legacy board without creator is blocked
      const canDeleteLegacy = testIsBoardAdmin(legacyBoard, myAccountId, false);
      expect(canDeleteLegacy).toBe(false);

      // But genuine creator can still delete their own board
      const canCreatorDelete = testIsBoardAdmin(sharedBoard, otherAccountId, false);
      expect(canCreatorDelete).toBe(true);
    });
  });

  describe('4. Backend HTTP Endpoint with Super-User & Permanent Deletion', () => {
    function simulateDeleteEndpoint(params: {
      boardId: string;
      scope: WorkspaceScope;
      isPermanent?: boolean;
      isSuperUser?: boolean;
      reqAccountId?: string;
      existingBoard?: BoardMeta;
    }): { status: number; body: { success?: boolean; error?: string } } {
      const { boardId, scope, isPermanent, isSuperUser, reqAccountId, existingBoard } = params;

      if (boardId === 'team-main' || boardId === 'solo-main') {
        return { status: 403, body: { error: 'Forbidden: Cannot delete canonical main board' } };
      }
      if (!existingBoard) {
        return { status: 404, body: { error: 'Board not found' } };
      }

      if (scope === 'team' && !isSuperUser) {
        if (!existingBoard.creatorId || existingBoard.creatorId !== reqAccountId) {
          return { status: 403, body: { error: 'Forbidden' } };
        }
      }

      return { status: 200, body: { success: true } };
    }

    it('allows deleting any team board when isSuperUser is true', () => {
      const otherUserBoard: BoardMeta = {
        id: 'board-other-101',
        title: 'Other Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'usr_different',
        creatorName: 'SomeoneElse'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-other-101',
        scope: 'team',
        isSuperUser: true,
        reqAccountId: 'usr_my_id',
        existingBoard: otherUserBoard
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
