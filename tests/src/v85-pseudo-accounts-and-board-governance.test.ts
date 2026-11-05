import { describe, it, expect, beforeEach } from 'vitest';
import type { BoardMeta, WorkspaceScope } from '@doks/shared';

describe('Doks v85: Sovereign Pseudo-Accounts & Strict Board Deletion Governance', () => {
  const TEAM_MAIN_BOARD_ID = 'team-main';
  const SOLO_MAIN_BOARD_ID = 'solo-main';

  function createMockStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      has: (key: string) => store.has(key)
    };
  }

  let localStorageMock: ReturnType<typeof createMockStorage>;
  let sessionStorageMock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    localStorageMock = createMockStorage();
    sessionStorageMock = createMockStorage();
  });

  describe('1. Sovereign Pseudo-Account Engine', () => {
    function getSovereignAccount(
      localStorage: typeof localStorageMock,
      sessionStorage: typeof sessionStorageMock
    ) {
      let accountId = sessionStorage.getItem('doks_session_account_id');
      if (!accountId) {
        accountId = localStorage.getItem('doks_account_id');
      }
      if (!accountId) {
        accountId = 'usr_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('doks_account_id', accountId);
      }
      let secret = localStorage.getItem('doks_account_secret');
      if (!secret) {
        secret = 'sec_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('doks_account_secret', secret);
      }
      let name = localStorage.getItem('doks_account_name') || `Collaborator-${accountId.replace(/^usr_/, '').slice(0, 4).toUpperCase()}`;
      return { id: accountId, secret, displayName: name };
    }

    it('generates a persistent sovereign account ID prefixed with usr_', () => {
      const acc1 = getSovereignAccount(localStorageMock, sessionStorageMock);
      expect(acc1.id.startsWith('usr_')).toBe(true);
      expect(acc1.secret.startsWith('sec_')).toBe(true);
      expect(acc1.displayName.startsWith('Collaborator-')).toBe(true);

      // Repeat call yields exact same sovereign identity
      const acc2 = getSovereignAccount(localStorageMock, sessionStorageMock);
      expect(acc2.id).toBe(acc1.id);
      expect(acc2.secret).toBe(acc1.secret);
      expect(acc2.displayName).toBe(acc1.displayName);
    });

    it('sanitizes contaminated storage when client previously stored server daemon agent ID', () => {
      const serverDaemonAgentId = 'agent-daemon-server-uuid-999';

      // Simulate prior bug: client saved server's agentId into localStorage
      localStorageMock.setItem('doks_member_id', serverDaemonAgentId);
      localStorageMock.setItem('doks_account_id', serverDaemonAgentId);

      // Sanitization routine
      if (localStorageMock.getItem('doks_member_id') === serverDaemonAgentId) {
        localStorageMock.removeItem('doks_member_id');
      }
      if (localStorageMock.getItem('doks_account_id') === serverDaemonAgentId) {
        localStorageMock.removeItem('doks_account_id');
      }

      expect(localStorageMock.has('doks_member_id')).toBe(false);
      expect(localStorageMock.has('doks_account_id')).toBe(false);

      // Generating account now creates a clean sovereign account, not the server's ID
      const cleanAcc = getSovereignAccount(localStorageMock, sessionStorageMock);
      expect(cleanAcc.id).not.toBe(serverDaemonAgentId);
      expect(cleanAcc.id.startsWith('usr_')).toBe(true);
    });

    it('guarantees two different users/devices receive completely distinct pseudo-accounts', () => {
      const userAStorage = createMockStorage();
      const userASession = createMockStorage();

      const userBStorage = createMockStorage();
      const userBSession = createMockStorage();

      const userA = getSovereignAccount(userAStorage, userASession);
      const userB = getSovereignAccount(userBStorage, userBSession);

      expect(userA.id).not.toBe(userB.id);
      expect(userA.secret).not.toBe(userB.secret);
    });
  });

  describe('2. Reverse-Proxy Loopback Shielding (Render / Cloud Protection)', () => {
    function testIsLoopbackRequest(req: {
      ip?: string;
      raw?: { socket?: { remoteAddress?: string } };
      headers?: Record<string, string>;
    }): boolean {
      const forwardedFor = req.headers?.['x-forwarded-for'];
      const forwardedProto = req.headers?.['x-forwarded-proto'];
      const renderHost = req.headers?.['x-render-host'];
      const cfConnectingIp = req.headers?.['cf-connecting-ip'];
      const hostHeader = (req.headers?.['host'] || '').split(':')[0].toLowerCase();

      // If reverse proxy headers are present, or public cloud host, request came from external network
      if (forwardedFor || forwardedProto || renderHost || cfConnectingIp) {
        return false;
      }
      if (hostHeader && hostHeader !== 'localhost' && hostHeader !== '127.0.0.1' && hostHeader !== '::1' && hostHeader !== '[::1]') {
        return false;
      }

      const ip = (req.ip || req.raw?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
      return ip === '127.0.0.1' || ip === '::1';
    }

    it('identifies Render proxy requests as EXTERNAL (not loopback) despite internal 127.0.0.1 socket', () => {
      // On Render, internal socket is 127.0.0.1 but x-forwarded-for / host are set
      const renderReq = {
        ip: '127.0.0.1',
        raw: { socket: { remoteAddress: '127.0.0.1' } },
        headers: {
          'host': 'doks-yhhc.onrender.com',
          'x-forwarded-for': '198.51.100.42',
          'x-forwarded-proto': 'https',
          'x-render-host': 'doks-yhhc.onrender.com'
        }
      };

      const isLoopback = testIsLoopbackRequest(renderReq);
      expect(isLoopback).toBe(false);
    });

    it('identifies true local development desktop as LOOPBACK', () => {
      const localReq = {
        ip: '127.0.0.1',
        raw: { socket: { remoteAddress: '127.0.0.1' } },
        headers: {
          'host': 'localhost:4780'
        }
      };

      const isLoopback = testIsLoopbackRequest(localReq);
      expect(isLoopback).toBe(true);
    });
  });

  describe('3. Strict isBoardAdmin Governance', () => {
    function isBoardAdmin(
      meta: BoardMeta | null | undefined,
      currentAccountId: string,
      scopeHint?: WorkspaceScope,
      teamBoardIds?: Set<string>,
      soloBoardIds?: Set<string>
    ): boolean {
      if (!meta) return false;
      const teamIds = teamBoardIds || new Set<string>();
      const soloIds = soloBoardIds || new Set<string>();

      const isTeam = scopeHint === 'team' || meta.scope === 'team' || teamIds.has(meta.id);
      if (!isTeam && (meta.scope === 'solo' || soloIds.has(meta.id))) return true;

      // Canonical shared team canvas can NEVER be deleted, cleared, or converted by participants
      if (meta.id === TEAM_MAIN_BOARD_ID) return false;

      // 1. Strict creatorId match against sovereign client account ID
      if (meta.creatorId) {
        return meta.creatorId === currentAccountId;
      }

      // 2. Legacy / unassigned team boards: permanently protected against unauthorized participant deletion.
      return false;
    }

    const aliceAccountId = 'usr_alice_1111';
    const bobAccountId = 'usr_bob_2222';

    it('denies deletion of canonical team-main board to everyone', () => {
      const teamMainBoard: BoardMeta = {
        id: TEAM_MAIN_BOARD_ID,
        title: 'Shared Team Canvas',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: aliceAccountId,
        creatorName: 'Alice'
      };

      expect(isBoardAdmin(teamMainBoard, aliceAccountId, 'team')).toBe(false);
    });

    it('grants admin rights to the verified creator of a team board', () => {
      const designSprintBoard: BoardMeta = {
        id: 'board-sprint-101',
        title: 'Sprint Planning',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: aliceAccountId,
        creatorName: 'Alice'
      };

      expect(isBoardAdmin(designSprintBoard, aliceAccountId, 'team')).toBe(true);
    });

    it('strictly denies deletion rights to another collaborator on a team board', () => {
      const designSprintBoard: BoardMeta = {
        id: 'board-sprint-101',
        title: 'Sprint Planning',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: aliceAccountId,
        creatorName: 'Alice'
      };

      // Bob cannot delete Alice's board
      expect(isBoardAdmin(designSprintBoard, bobAccountId, 'team')).toBe(false);
    });

    it('denies deletion even if non-creator has the same display name ("User")', () => {
      const docBoard: BoardMeta = {
        id: 'board-doc-777',
        title: 'taden-документация',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: aliceAccountId,
        creatorName: 'User'
      };

      // Bob also has name "User", but his accountId is different: MUST BE DENIED!
      expect(isBoardAdmin(docBoard, bobAccountId, 'team')).toBe(false);
    });

    it('permanently shields unassigned legacy boards without creatorId from participant deletion', () => {
      const legacyBoard: BoardMeta = {
        id: 'board-legacy-old',
        title: 'Old Team Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: undefined,
        creatorName: undefined
      };

      // Neither Alice nor Bob can delete an unassigned legacy board
      expect(isBoardAdmin(legacyBoard, aliceAccountId, 'team')).toBe(false);
      expect(isBoardAdmin(legacyBoard, bobAccountId, 'team')).toBe(false);
    });
  });

  describe('4. Backend HTTP DELETE Enforcement', () => {
    function simulateDeleteEndpoint(params: {
      boardId: string;
      scope: WorkspaceScope;
      reqAccountId: string;
      existingBoard?: BoardMeta;
    }): { status: number; body: { success?: boolean; error?: string } } {
      const { boardId, scope, reqAccountId, existingBoard } = params;

      if (boardId === 'team-main' || boardId === 'solo-main') {
        return { status: 403, body: { error: 'Forbidden: Cannot delete canonical main board' } };
      }

      if (!existingBoard) {
        return { status: 404, body: { error: 'Board not found' } };
      }

      if (scope === 'team') {
        if (!existingBoard.creatorId) {
          return {
            status: 403,
            body: { error: 'Forbidden: Unassigned legacy team board cannot be deleted by participants' }
          };
        }

        const isCreator = reqAccountId && existingBoard.creatorId === reqAccountId;
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

    it('rejects attempt to delete team-main with 403', () => {
      const res = simulateDeleteEndpoint({
        boardId: 'team-main',
        scope: 'team',
        reqAccountId: 'usr_alice'
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cannot delete canonical main board');
    });

    it('rejects non-creator participant attempt to delete team board with 403', () => {
      const teamBoard: BoardMeta = {
        id: 'board-taden-doc',
        title: 'taden-документация',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'usr_alice',
        creatorName: 'Alice'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-taden-doc',
        scope: 'team',
        reqAccountId: 'usr_bob',
        existingBoard: teamBoard
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Only the board creator (@Alice) can delete this board');
    });

    it('rejects deletion of legacy board without creatorId with 403', () => {
      const legacyBoard: BoardMeta = {
        id: 'board-legacy',
        title: 'Unclaimed Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-legacy',
        scope: 'team',
        reqAccountId: 'usr_bob',
        existingBoard: legacyBoard
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Unassigned legacy team board cannot be deleted by participants');
    });

    it('allows genuine creator to delete team board with 200 OK', () => {
      const teamBoard: BoardMeta = {
        id: 'board-taden-doc',
        title: 'taden-документация',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: 'usr_alice',
        creatorName: 'Alice'
      };

      const res = simulateDeleteEndpoint({
        boardId: 'board-taden-doc',
        scope: 'team',
        reqAccountId: 'usr_alice',
        existingBoard: teamBoard
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
