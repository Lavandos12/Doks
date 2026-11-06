import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { getIndexMaps, type BoardMeta, type WorkspaceScope } from '@doks/shared';

describe('Doks v86: Super-User Governance Mode & Canonical Main Board Deletion', () => {
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
  function testEmptyTrash(sMaps: typeof soloMaps, tMaps: typeof teamMaps, superUserMode = true) {
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
      deletedBoardKeys.forEach((k) => maps.boards.delete(k));
    });
  }

  // Pure logic replica of permanentlyDeleteBoard in app-state.ts
  function testPermanentlyDeleteBoard(id: string, sMaps: typeof soloMaps, tMaps: typeof teamMaps, superUserMode = true) {
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
  }

  // Pure logic replica of isBoardAdmin in app-state.ts
  function testIsBoardAdmin(
    meta: BoardMeta | null | undefined,
    currentAccountId: string,
    superUserMode: boolean
  ): boolean {
    if (!meta) return false;
    // Super-user bypass allows deleting any board, including team-main
    if (superUserMode) return true;
    // Ordinary users can never delete canonical team-main
    if (meta.id === TEAM_MAIN_BOARD_ID) return false;
    if (meta.scope === 'solo') return true;
    if (meta.creatorId) return meta.creatorId === currentAccountId;
    return false;
  }

  // Pure logic replica of ensureInitialBoard in app-state.ts
  function testEnsureInitialBoard(tMaps: typeof teamMaps) {
    if (tMaps.boards.size === 0) {
      tMaps.boards.set(TEAM_MAIN_BOARD_ID, {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        deleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team',
        creatorId: 'system',
        creatorName: 'Team'
      });
    }
  }

  describe('1. Canonical team-main Super-User Deletion & Empty Trash', () => {
    it('allows super-user to permanently purge Shared Team Canvas (team-main) from trash', () => {
      // Put team-main in trash
      teamMaps.boards.set(TEAM_MAIN_BOARD_ID, {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        deleted: true,
        deletedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team',
        creatorId: 'system',
        creatorName: 'Admin'
      });

      // Add another board so workspace is not completely empty
      teamMaps.boards.set('b-active', {
        id: 'b-active',
        title: 'Active Project',
        folder: null,
        deleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });

      expect(teamMaps.boards.size).toBe(2);

      // Run emptyTrash with superUserMode = true
      testEmptyTrash(soloMaps, teamMaps, true);

      // team-main must be permanently removed from the map!
      expect(teamMaps.boards.has(TEAM_MAIN_BOARD_ID)).toBe(false);
      expect(teamMaps.boards.has('b-active')).toBe(true);
      expect(teamMaps.boards.size).toBe(1);

      // ensureInitialBoard must NOT revive team-main because active board exists
      testEnsureInitialBoard(teamMaps);
      expect(teamMaps.boards.has(TEAM_MAIN_BOARD_ID)).toBe(false);
    });

    it('protects and resurrects team-main when SUPER_USER_MODE is false (normal mode)', () => {
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

      // Run emptyTrash in normal mode
      testEmptyTrash(soloMaps, teamMaps, false);

      // team-main must be resurrected and NOT deleted
      const teamMain = teamMaps.boards.get(TEAM_MAIN_BOARD_ID);
      expect(teamMain).toBeDefined();
      expect(teamMain?.deleted).toBe(false);
    });
  });

  describe('2. Individual "Delete Forever" on Canonical team-main', () => {
    it('permanently deletes team-main when superUserMode is true', () => {
      teamMaps.boards.set(TEAM_MAIN_BOARD_ID, {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        deleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });

      testPermanentlyDeleteBoard(TEAM_MAIN_BOARD_ID, soloMaps, teamMaps, true);
      expect(teamMaps.boards.has(TEAM_MAIN_BOARD_ID)).toBe(false);
    });

    it('blocks permanent deletion and un-deletes team-main when superUserMode is false', () => {
      teamMaps.boards.set(TEAM_MAIN_BOARD_ID, {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        deleted: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scope: 'team'
      });

      testPermanentlyDeleteBoard(TEAM_MAIN_BOARD_ID, soloMaps, teamMaps, false);
      expect(teamMaps.boards.has(TEAM_MAIN_BOARD_ID)).toBe(true);
      expect(teamMaps.boards.get(TEAM_MAIN_BOARD_ID)?.deleted).toBe(false);
    });
  });

  describe('3. Super-User Mode Governance & Permissions', () => {
    const myAccountId = 'usr_current_user_123';
    const otherAccountId = 'usr_original_creator_999';

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

    it('grants admin deletion rights over Shared Team Canvas (team-main) when SUPER_USER_MODE is true', () => {
      const canDeleteTeamMain = testIsBoardAdmin(teamMainBoard, myAccountId, true);
      expect(canDeleteTeamMain).toBe(true);

      const canDeleteOther = testIsBoardAdmin(sharedBoard, myAccountId, true);
      expect(canDeleteOther).toBe(true);
    });

    it('blocks deleting Shared Team Canvas when rolled back to SUPER_USER_MODE = false', () => {
      const canDeleteTeamMain = testIsBoardAdmin(teamMainBoard, myAccountId, false);
      expect(canDeleteTeamMain).toBe(false);

      const canDeleteOther = testIsBoardAdmin(sharedBoard, myAccountId, false);
      expect(canDeleteOther).toBe(false);

      // Genuine creator can still delete their own board
      const canCreatorDelete = testIsBoardAdmin(sharedBoard, otherAccountId, false);
      expect(canCreatorDelete).toBe(true);
    });
  });

  describe('4. Backend HTTP Endpoint with Super-User Deletion', () => {
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
          return { status: 403, body: { error: 'Forbidden' } };
        }
      }

      return { status: 200, body: { success: true } };
    }

    it('allows deleting team-main when isSuperUser is true', () => {
      const teamMainMeta: BoardMeta = {
        id: 'team-main',
        title: 'Shared Team Canvas',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'system',
        creatorName: 'Admin'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'team-main',
        scope: 'team',
        isSuperUser: true,
        reqAccountId: 'usr_my_id',
        existingBoard: teamMainMeta
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('forbids deleting team-main when isSuperUser is false', () => {
      const teamMainMeta: BoardMeta = {
        id: 'team-main',
        title: 'Shared Team Canvas',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'system',
        creatorName: 'Admin'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'team-main',
        scope: 'team',
        isSuperUser: false,
        reqAccountId: 'usr_my_id',
        existingBoard: teamMainMeta
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cannot delete canonical main board');
    });
  });
});
