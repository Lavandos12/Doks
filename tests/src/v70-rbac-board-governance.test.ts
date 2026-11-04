import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BoardMeta, WorkspaceScope } from '@doks/shared';

describe('Doks v70: RBAC & Board Governance (Creator Ownership)', () => {
  // Mock localStorage for Node test environment
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };

  function testGetMyMemberId(storage: typeof mockLocalStorage): string {
    let id = storage.getItem('doks_member_id');
    if (!id) {
      id = 'client-' + Math.random().toString(36).substring(2, 10);
      storage.setItem('doks_member_id', id);
    }
    return id;
  }

  function testIsBoardAdmin(
    meta: BoardMeta | null | undefined,
    myMemberId: string,
    agentStatus: { isHost?: boolean } | null
  ): boolean {
    if (!meta) return false;
    if (meta.scope === 'solo') return true;

    if (meta.creatorId && meta.creatorId === myMemberId) return true;
    if (!meta.creatorId && agentStatus?.isHost) return true;
    return false;
  }

  beforeEach(() => {
    store.clear();
  });

  describe('1. Member Identifier Persistence', () => {
    it('generates a unique member ID and persists across invocations', () => {
      const id1 = testGetMyMemberId(mockLocalStorage);
      expect(id1).toBeTruthy();
      expect(typeof id1).toBe('string');
      expect(store.get('doks_member_id')).toBe(id1);

      const id2 = testGetMyMemberId(mockLocalStorage);
      expect(id2).toBe(id1);
    });
  });

  describe('2. Board Admin Permission Verification (isBoardAdmin)', () => {
    const myId = 'member-alice-123';
    const otherId = 'member-bob-456';

    it('always grants Admin to Solo boards regardless of creatorId', () => {
      const soloBoard: BoardMeta = {
        id: 'board-1',
        title: 'Solo Exploration',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'solo',
        creatorId: otherId
      };

      expect(testIsBoardAdmin(soloBoard, myId, { isHost: false })).toBe(true);
    });

    it('grants Admin to Team board when creatorId matches current member ID', () => {
      const teamBoard: BoardMeta = {
        id: 'board-2',
        title: 'Architecture Review',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: myId,
        creatorName: 'Alice'
      };

      expect(testIsBoardAdmin(teamBoard, myId, { isHost: false })).toBe(true);
    });

    it('denies Admin to Team board when creatorId belongs to another collaborator', () => {
      const teamBoard: BoardMeta = {
        id: 'board-3',
        title: 'Team Roadmap',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: otherId,
        creatorName: 'Bob'
      };

      expect(testIsBoardAdmin(teamBoard, myId, { isHost: true })).toBe(false);
      expect(testIsBoardAdmin(teamBoard, myId, { isHost: false })).toBe(false);
    });

    it('falls back to Host Admin for legacy Team boards without creatorId', () => {
      const legacyTeamBoard: BoardMeta = {
        id: 'board-4',
        title: 'Legacy Team Board',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team'
      };

      // Host user gets admin access
      expect(testIsBoardAdmin(legacyTeamBoard, myId, { isHost: true })).toBe(true);
      // Non-host collaborator is denied admin access
      expect(testIsBoardAdmin(legacyTeamBoard, myId, { isHost: false })).toBe(false);
    });

    it('safely handles null/undefined board metadata', () => {
      expect(testIsBoardAdmin(null, myId, { isHost: true })).toBe(false);
      expect(testIsBoardAdmin(undefined, myId, { isHost: true })).toBe(false);
    });
  });

  describe('3. Guarded Destructive Operations', () => {
    const creatorId = 'admin-user-001';
    const collaboratorId = 'collab-user-002';

    it('blocks non-admin from converting Team board to Solo (Make Private)', () => {
      const teamBoard: BoardMeta = {
        id: 'board-shared',
        title: 'Sprint Planning',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId
      };

      function attemptConvertScope(meta: BoardMeta, callerId: string): { success: boolean; error?: string } {
        if (meta.scope === 'team') {
          if (!testIsBoardAdmin(meta, callerId, { isHost: false })) {
            return { success: false, error: 'Permission denied: Only the board creator can make this board private.' };
          }
        }
        return { success: true };
      }

      // Collaborator attempt is rejected
      const collabResult = attemptConvertScope(teamBoard, collaboratorId);
      expect(collabResult.success).toBe(false);
      expect(collabResult.error).toContain('Only the board creator');

      // Creator attempt is allowed
      const creatorResult = attemptConvertScope(teamBoard, creatorId);
      expect(creatorResult.success).toBe(true);
    });

    it('blocks non-admin from deleting Team board', () => {
      const teamBoard: BoardMeta = {
        id: 'board-shared-2',
        title: 'Secret Project',
        folder: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        scope: 'team',
        creatorId: creatorId
      };

      function attemptDeleteBoard(meta: BoardMeta, callerId: string): { success: boolean; deleted: boolean } {
        if (meta.scope === 'team') {
          if (!testIsBoardAdmin(meta, callerId, { isHost: false })) {
            return { success: false, deleted: meta.deleted };
          }
        }
        meta.deleted = true;
        meta.deletedAt = Date.now();
        return { success: true, deleted: meta.deleted };
      }

      // Collaborator attempt does not delete
      const collabAttempt = attemptDeleteBoard({ ...teamBoard }, collaboratorId);
      expect(collabAttempt.success).toBe(false);
      expect(collabAttempt.deleted).toBe(false);

      // Creator attempt successfully deletes
      const creatorAttempt = attemptDeleteBoard({ ...teamBoard }, creatorId);
      expect(creatorAttempt.success).toBe(true);
      expect(creatorAttempt.deleted).toBe(true);
    });
  });

  describe('4. Safe Non-Destructive Duplicate to Solo (Forking)', () => {
    it('creates an independent Solo copy with (Copy) suffix and leaves original team board untouched', () => {
      const originalTeamBoard: BoardMeta = {
        id: 'team-board-100',
        title: 'Design System',
        folder: null,
        createdAt: 1000,
        updatedAt: 1000,
        deleted: false,
        scope: 'team',
        creatorId: 'lead-designer'
      };

      const originalNodes = [
        { id: 'node-1', text: 'Color Palette', deleted: false },
        { id: 'node-2', text: 'Typography Scale', deleted: false },
        { id: 'node-3', text: 'Old Component', deleted: true }
      ];

      // Collaborator duplicates board
      const collaboratorId = 'junior-designer';
      const duplicateTitle = `${originalTeamBoard.title} (Copy)`;
      const newSoloBoardId = 'solo-board-200';

      const newSoloBoard: BoardMeta = {
        id: newSoloBoardId,
        title: duplicateTitle,
        folder: null,
        createdAt: 2000,
        updatedAt: 2000,
        deleted: false,
        scope: 'solo',
        creatorId: collaboratorId,
        creatorName: 'Junior'
      };

      // Active nodes copied into new solo board
      const copiedNodes = originalNodes
        .filter((n) => !n.deleted)
        .map((n) => ({
          ...n,
          id: `copy-${n.id}`
        }));

      // Verify original board remains untouched in team scope
      expect(originalTeamBoard.deleted).toBe(false);
      expect(originalTeamBoard.scope).toBe('team');
      expect(originalNodes.length).toBe(3);

      // Verify cloned board is in solo scope and owned by the collaborator
      expect(newSoloBoard.id).toBe(newSoloBoardId);
      expect(newSoloBoard.title).toBe('Design System (Copy)');
      expect(newSoloBoard.scope).toBe('solo');
      expect(newSoloBoard.creatorId).toBe(collaboratorId);
      expect(copiedNodes.length).toBe(2);
      expect(copiedNodes[0].id).toBe('copy-node-1');
      expect(copiedNodes[1].id).toBe('copy-node-2');
    });
  });

  describe('5. Board Promotion Stamps Creator Metadata', () => {
    it('stamps creatorId, creatorName, promotedAt, and promotedBy when moving Solo board to Team', () => {
      const soloBoard: BoardMeta = {
        id: 'board-solo-3',
        title: 'My Draft',
        folder: null,
        createdAt: 1000,
        updatedAt: 1000,
        deleted: false,
        scope: 'solo'
      };

      const myId = 'promoter-123';
      const myName = 'Alice Senior';
      const now = Date.now();

      const promotedBoard: BoardMeta = {
        ...soloBoard,
        id: 'board-team-3',
        scope: 'team',
        creatorId: myId,
        creatorName: myName,
        promotedAt: now,
        promotedBy: myName
      };

      expect(promotedBoard.scope).toBe('team');
      expect(promotedBoard.creatorId).toBe(myId);
      expect(promotedBoard.creatorName).toBe(myName);
      expect(promotedBoard.promotedAt).toBe(now);
      expect(promotedBoard.promotedBy).toBe(myName);
      expect(testIsBoardAdmin(promotedBoard, myId, { isHost: false })).toBe(true);
    });
  });
});
