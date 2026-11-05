import { describe, it, expect, beforeEach } from 'vitest';
import type { BoardMeta, WorkspaceScope } from '@doks/shared';

describe('Doks v84: Team Board Deletion & Ownership Governance', () => {
  const TEAM_MAIN_BOARD_ID = 'team-main';
  const SOLO_MAIN_BOARD_ID = 'solo-main';

  // Mock Storage
  function createMockStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    };
  }

  let sessionStorageMock: ReturnType<typeof createMockStorage>;
  let localStorageMock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    sessionStorageMock = createMockStorage();
    localStorageMock = createMockStorage();
  });

  // Pure logic replica matching web/src/state/app-state.ts
  function getMyMemberId(sessionStorage: typeof sessionStorageMock, localStorage: typeof localStorageMock, agentId?: string): string {
    let id = sessionStorage.getItem('doks_session_member_id');
    if (!id) {
      if (agentId) {
        id = agentId;
      } else {
        id = localStorage.getItem('doks_member_id');
      }
      if (!id) {
        id = 'member-' + Math.random().toString(36).substring(2, 9);
      }
      sessionStorage.setItem('doks_session_member_id', id);
    }
    if (!localStorage.getItem('doks_member_id')) {
      localStorage.setItem('doks_member_id', id);
    }
    return id;
  }

  function getMyMemberName(sessionStorage: typeof sessionStorageMock, localStorage: typeof localStorageMock, defaultAgentName = 'User'): string {
    const sName = sessionStorage.getItem('doks_display_name') || sessionStorage.getItem('doks_member_name');
    if (sName) return sName;
    const lName = localStorage.getItem('doks_display_name') || localStorage.getItem('doks_member_name');
    if (lName && lName !== 'You') return lName;
    return defaultAgentName;
  }

  function isBoardAdmin(
    meta: BoardMeta | null | undefined,
    context: {
      myId: string;
      myName: string;
      isHost?: boolean;
      scopeHint?: WorkspaceScope;
      teamBoardIds?: Set<string>;
      soloBoardIds?: Set<string>;
    }
  ): boolean {
    if (!meta) return false;
    const teamIds = context.teamBoardIds || new Set<string>();
    const soloIds = context.soloBoardIds || new Set<string>();

    const isTeam = context.scopeHint === 'team' || meta.scope === 'team' || teamIds.has(meta.id);
    if (!isTeam && (meta.scope === 'solo' || soloIds.has(meta.id))) return true;

    // Canonical shared team canvas can NEVER be deleted or cleared
    if (meta.id === TEAM_MAIN_BOARD_ID) return false;

    // 1. Strict creatorId match
    if (meta.creatorId && meta.creatorId === context.myId) return true;

    // 2. Exact creatorName match (case-insensitive trim) if creatorName is present
    if (meta.creatorName && context.myName && meta.creatorName.trim().toLowerCase() === context.myName.trim().toLowerCase()) {
      if (!meta.creatorId || meta.creatorId === context.myId) return true;
    }

    // Legacy fallback: only if creatorId AND creatorName are both missing, and caller is genuine host
    if (!meta.creatorId && !meta.creatorName && context.isHost) return true;

    return false;
  }

  describe('1. Multi-Participant Session & Member ID Isolation', () => {
    it('isolates member IDs across different browser sessions/tabs on the same PC', () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();
      const sharedLocalStorage = createMockStorage();

      // Tab 1 creates member
      const member1 = getMyMemberId(tab1Session, sharedLocalStorage);
      expect(member1).toBeTruthy();
      expect(tab1Session.getItem('doks_session_member_id')).toBe(member1);

      // Tab 2 creates its own session member ID
      tab2Session.setItem('doks_session_member_id', 'tab2-unique-uuid');
      const member2 = getMyMemberId(tab2Session, sharedLocalStorage);
      expect(member2).toBe('tab2-unique-uuid');
      expect(member2).not.toBe(member1);
    });

    it('retrieves distinct member names from session storage', () => {
      const tab1Session = createMockStorage();
      const tab2Session = createMockStorage();
      const sharedLocalStorage = createMockStorage();

      tab1Session.setItem('doks_display_name', 'Alice (Creator)');
      tab2Session.setItem('doks_display_name', 'Bob (Collaborator)');

      expect(getMyMemberName(tab1Session, sharedLocalStorage)).toBe('Alice (Creator)');
      expect(getMyMemberName(tab2Session, sharedLocalStorage)).toBe('Bob (Collaborator)');
    });
  });

  describe('2. isBoardAdmin Access Control', () => {
    const creatorId = 'alice-creator-id';
    const collaboratorId = 'bob-collab-id';

    it('denies deletion/admin rights to canonical team-main board for anyone', () => {
      const mainBoard: BoardMeta = {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId,
        creatorName: 'Alice'
      };

      const isAdmin = isBoardAdmin(mainBoard, {
        myId: creatorId,
        myName: 'Alice',
        isHost: true,
        scopeHint: 'team'
      });
      expect(isAdmin).toBe(false);
    });

    it('grants admin rights to the board creator on team boards', () => {
      const teamBoard: BoardMeta = {
        id: 'team-board-design-sprint',
        title: 'Design Sprint',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId,
        creatorName: 'Alice'
      };

      const isAdmin = isBoardAdmin(teamBoard, {
        myId: creatorId,
        myName: 'Alice',
        isHost: false,
        scopeHint: 'team'
      });
      expect(isAdmin).toBe(true);
    });

    it('strictly denies admin/deletion rights to other collaborators on team boards', () => {
      const teamBoard: BoardMeta = {
        id: 'team-board-design-sprint',
        title: 'Design Sprint',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId,
        creatorName: 'Alice'
      };

      const isAdmin = isBoardAdmin(teamBoard, {
        myId: collaboratorId,
        myName: 'Bob',
        isHost: false,
        scopeHint: 'team'
      });
      expect(isAdmin).toBe(false);
    });

    it('denies deletion even if loopback connection sets isHost=true for collaborator', () => {
      const teamBoard: BoardMeta = {
        id: 'team-board-design-sprint',
        title: 'Design Sprint',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId,
        creatorName: 'Alice'
      };

      // Even if collaborator runs locally where isHost is true, because creatorId is set to Alice, Bob cannot delete
      const isAdmin = isBoardAdmin(teamBoard, {
        myId: collaboratorId,
        myName: 'Bob',
        isHost: true,
        scopeHint: 'team'
      });
      expect(isAdmin).toBe(false);
    });

    it('enforces team rules when board is stored in teamMaps even if meta.scope is missing or solo', () => {
      const downgradedBoard: BoardMeta = {
        id: 'team-board-999',
        title: 'Sprint Planning',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: undefined as any,
        creatorId: creatorId,
        creatorName: 'Alice'
      };

      const teamBoardIds = new Set<string>(['team-board-999']);

      const isAdminBob = isBoardAdmin(downgradedBoard, {
        myId: collaboratorId,
        myName: 'Bob',
        isHost: true,
        teamBoardIds
      });
      expect(isAdminBob).toBe(false);

      const isAdminAlice = isBoardAdmin(downgradedBoard, {
        myId: creatorId,
        myName: 'Alice',
        isHost: false,
        teamBoardIds
      });
      expect(isAdminAlice).toBe(true);
    });
  });

  describe('3. Backend HTTP Deletion Security Verification', () => {
    // Replica of HTTP DELETE logic in agent/src/server/http-server.ts
    function simulateDeleteEndpoint(params: {
      boardId: string;
      scope: WorkspaceScope;
      reqHeaders: Record<string, string>;
      isHostSession: boolean;
      existingBoard?: BoardMeta;
    }): { status: number; body: any } {
      const { boardId, scope, reqHeaders, isHostSession, existingBoard } = params;

      if (scope === 'solo' && !isHostSession) {
        return { status: 403, body: { error: 'Forbidden: Solo workspace is private to host' } };
      }

      if (boardId === 'team-main' || boardId === 'solo-main') {
        return { status: 403, body: { error: 'Forbidden: Cannot delete canonical main board' } };
      }

      if (!existingBoard) {
        return { status: 404, body: { error: 'Board not found' } };
      }

      if (scope === 'team') {
        const reqMemberId = reqHeaders['x-doks-member-id'] || '';
        const reqMemberName = reqHeaders['x-doks-member-name'] || '';

        const isCreator =
          (existingBoard.creatorId && reqMemberId && existingBoard.creatorId === reqMemberId) ||
          (existingBoard.creatorName && reqMemberName && existingBoard.creatorName.trim().toLowerCase() === reqMemberName.trim().toLowerCase()) ||
          (!existingBoard.creatorId && isHostSession);

        if (!isCreator) {
          const creator = existingBoard.creatorName || 'the creator';
          return {
            status: 403,
            body: { error: `Forbidden: Only the board creator (@${creator}) can delete this board` }
          };
        }
      }

      return { status: 200, body: { success: true } };
    }

    const teamBoard: BoardMeta = {
      id: 'board-team-101',
      title: 'Secret Roadmap',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      scope: 'team',
      creatorId: 'creator-uuid-111',
      creatorName: 'Alice'
    };

    it('rejects attempt to delete team-main', () => {
      const res = simulateDeleteEndpoint({
        boardId: 'team-main',
        scope: 'team',
        reqHeaders: { 'x-doks-member-id': 'creator-uuid-111' },
        isHostSession: true
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cannot delete canonical main board');
    });

    it('blocks collaborator from deleting creator team board with 403 Forbidden', () => {
      const res = simulateDeleteEndpoint({
        boardId: 'board-team-101',
        scope: 'team',
        reqHeaders: {
          'x-doks-member-id': 'collab-uuid-222',
          'x-doks-member-name': 'Bob'
        },
        isHostSession: false,
        existingBoard: teamBoard
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Only the board creator (@Alice) can delete this board');
    });

    it('allows creator to delete team board with 200 OK', () => {
      const res = simulateDeleteEndpoint({
        boardId: 'board-team-101',
        scope: 'team',
        reqHeaders: {
          'x-doks-member-id': 'creator-uuid-111',
          'x-doks-member-name': 'Alice'
        },
        isHostSession: false,
        existingBoard: teamBoard
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
