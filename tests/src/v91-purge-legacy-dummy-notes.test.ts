import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isLegacyDummyNote, DOC_INDEX } from '@doks/shared';
import { DocManager } from '../../agent/src/storage/doc-manager.js';
import { StateStore } from '../../agent/src/storage/state-store.js';

describe('v91 - Purge Legacy Dummy Notes & In-Modal Note Deletion', () => {
  let tmpDir: string;
  let teamStore: StateStore;
  let soloStore: StateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-v91-test-'));
    const teamDir = path.join(tmpDir, 'state_team');
    const soloDir = path.join(tmpDir, 'state_solo');
    fs.mkdirSync(teamDir, { recursive: true });
    fs.mkdirSync(soloDir, { recursive: true });
    teamStore = new StateStore(teamDir);
    soloStore = new StateStore(soloDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly classifies legacy dummy preset notes from early development', () => {
    // 6 exact dummy items from the screenshot
    expect(isLegacyDummyNote({ title: 'training_program', createdAt: 1730700000000 })).toBe(true);
    expect(isLegacyDummyNote({ title: 'programma_trenirovok', createdAt: 1730700000000 })).toBe(true);
    expect(isLegacyDummyNote({ title: 'Обновленная дорожная карта Eluma', createdAt: 1730700000000 })).toBe(true);
    expect(isLegacyDummyNote({
      title: 'TIME__Вот финальный точечный патч, который полностью убирает всю «вырвиглазную',
      createdAt: 1730700000000
    })).toBe(true);
    expect(isLegacyDummyNote({ title: 'Page', createdAt: 1730700000000 })).toBe(true);
    expect(isLegacyDummyNote({ title: 'Page' })).toBe(true);

    // Case-insensitivity & whitespace trimming
    expect(isLegacyDummyNote({ title: '  Training_Program  ' })).toBe(true);
    expect(isLegacyDummyNote({ title: 'Programma_Trenirovok' })).toBe(true);
  });

  it('strictly preserves genuine user-created notes', () => {
    // Fresh notes created today or in the future
    const now = Date.now(); // > 1794100000000
    expect(isLegacyDummyNote({ title: 'Page', createdAt: now })).toBe(false);
    expect(isLegacyDummyNote({ title: 'My Work Notes', createdAt: now })).toBe(false);
    expect(isLegacyDummyNote({ title: 'Daily Agenda', createdAt: now })).toBe(false);
    expect(isLegacyDummyNote({ title: 'Shopping List', createdAt: 1730700000000 })).toBe(false);
    expect(isLegacyDummyNote({ title: 'Eluma Competitor Research 2027', createdAt: now })).toBe(true); // contains eluma
    expect(isLegacyDummyNote({ title: 'Personal Fitness Plan', createdAt: now })).toBe(false);
  });

  it('purges legacy dummy notes from DocManager and persists the purge', () => {
    // Seed index with dummy notes and user notes
    const testDoc = new Y.Doc();
    const notesMap = testDoc.getMap<any>('notes');
    notesMap.set('dummy-1', {
      id: 'dummy-1',
      title: 'training_program',
      createdAt: 1730700000000,
      deleted: false
    });
    notesMap.set('dummy-2', {
      id: 'dummy-2',
      title: 'Page',
      createdAt: 1730700000000,
      deleted: false
    });
    notesMap.set('user-note-1', {
      id: 'user-note-1',
      title: 'Valid User Project Note',
      createdAt: Date.now(),
      deleted: false
    });
    notesMap.set('user-note-page', {
      id: 'user-note-page',
      title: 'Page',
      createdAt: Date.now(), // freshly created Page note
      deleted: false
    });

    teamStore.compactDoc(DOC_INDEX, testDoc);

    // Instantiate DocManager with this store
    const docManager = new DocManager(teamStore, { soloStateStore: soloStore });

    const teamIndex = docManager.getDoc('team:doks-index');
    expect(teamIndex).toBeDefined();
    const loadedNotes = teamIndex!.getMap<any>('notes');

    // Dummies should be gone
    expect(loadedNotes.has('dummy-1')).toBe(false);
    expect(loadedNotes.has('dummy-2')).toBe(false);

    // Legitimate user notes must stay intact
    expect(loadedNotes.has('user-note-1')).toBe(true);
    expect(loadedNotes.has('user-note-page')).toBe(true);
  });
});
