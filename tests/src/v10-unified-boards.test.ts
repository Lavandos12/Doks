import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';
import {
  allBoards,
  ensureDefaultBoard,
  selectBoardWithScope,
  convertBoardScope,
  createBoard,
  renameBoard,
  deleteBoard,
  soloMaps,
  teamMaps,
  currentScope,
  selectedBoardId
} from '../../web/src/state/app-state.js';
import {
  getScopedBoardDocName,
  getBoardMaps,
  createNodeMap
} from '@doks/shared';

describe('Doks V10: Unified Board System & Scope Management', () => {
  let tmpDir: string;
  let stateStore: StateStore;
  let docManager: DocManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-v10-test-'));
    const teamStore = new StateStore(path.join(tmpDir, 'state_team'));
    const soloStore = new StateStore(path.join(tmpDir, 'state_solo'));
    docManager = new DocManager(teamStore, { soloStateStore: soloStore });
  });

  afterEach(() => {
    docManager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aggregates boards from both solo and team in allBoards signal', () => {
    const soloId = createBoard('Личный черновик проекта', null, 'solo', false);
    const teamId = createBoard('Общая архитектурная доска', null, 'team', false);

    const soloEntry = allBoards.value.find((b) => b.id === soloId);
    const teamEntry = allBoards.value.find((b) => b.id === teamId);

    expect(soloEntry).toBeDefined();
    expect(soloEntry?.scope).toBe('solo');
    expect(soloEntry?.title).toBe('Личный черновик проекта');

    expect(teamEntry).toBeDefined();
    expect(teamEntry?.scope).toBe('team');
    expect(teamEntry?.title).toBe('Общая архитектурная доска');
  });

  it('selectBoardWithScope switches currentScope and selectedBoardId', () => {
    const bId = createBoard('Командная доска для переключения', null, 'team', false);
    selectBoardWithScope(bId, 'team', 'Командная доска для переключения');

    expect(currentScope.value).toBe('team');
    expect(selectedBoardId.value).toBe(bId);

    const sId = createBoard('Личная доска для переключения', null, 'solo', false);
    selectBoardWithScope(sId, 'solo', 'Личная доска для переключения');

    expect(currentScope.value).toBe('solo');
    expect(selectedBoardId.value).toBe(sId);
  });

  it('renameBoard and deleteBoard support explicit scope', () => {
    const bId = createBoard('Старое имя доски', null, 'team', false);
    expect(teamMaps.boards.get(bId)?.title).toBe('Старое имя доски');

    renameBoard(bId, 'Новое имя доски', 'team');
    expect(teamMaps.boards.get(bId)?.title).toBe('Новое имя доски');

    deleteBoard(bId, 'team');
    expect(teamMaps.boards.get(bId)?.deleted).toBe(true);
  });

  it('convertBoardScope transfers nodes and switches scope cleanly', async () => {
    const soloBoardId = createBoard('Скетч перед миграцией', null, 'solo', false);
    expect(soloMaps.boards.get(soloBoardId)?.deleted).toBe(false);

    // Call convertBoardScope to migrate solo to team
    const newTeamBoardId = await convertBoardScope(soloBoardId, 'solo', 'team');

    expect(newTeamBoardId).toBeDefined();
    expect(currentScope.value).toBe('team');
    expect(selectedBoardId.value).toBe(newTeamBoardId);

    // Check old solo board is marked deleted
    expect(soloMaps.boards.get(soloBoardId)?.deleted).toBe(true);

    // Check new team board exists with identical title
    const targetMeta = teamMaps.boards.get(newTeamBoardId);
    expect(targetMeta).toBeDefined();
    expect(targetMeta?.title).toBe('Скетч перед миграцией');
    expect(targetMeta?.deleted).toBe(false);
  });
});
