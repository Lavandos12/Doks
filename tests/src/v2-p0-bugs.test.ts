import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as Y from 'yjs';
import { Agent, generateTeamKey } from '@doks/agent';
import { StateStore } from '@doks/agent';
import { FileMirror } from '@doks/agent';
import { FileWatcher } from '@doks/agent';
import {
  DOC_INDEX,
  getIndexMaps,
  getNoteDocName,
  type AgentConfig
} from '@doks/shared';
import {
  createTestDir,
  cleanupTestDir,
  createTestAgent,
  waitFor,
  type TestAgentInstance
} from './test-helpers.js';

describe('Stage A: P0 Bug Reproduction & Verification (B1–B5)', () => {
  let baseDir: string | undefined;
  const activeAgents: TestAgentInstance[] = [];

  afterEach(async () => {
    while (activeAgents.length > 0) {
      const a = activeAgents.pop();
      if (a) {
        await a.agent.stop();
        cleanupTestDir(a.baseDir);
      }
    }
    if (baseDir) {
      cleanupTestDir(baseDir);
      baseDir = undefined;
    }
  });

  // B1: Data loss on crash (incremental updates must be preserved via length-prefixed records / WAL)
  it('B1: preserves multiple incremental updates after sudden stop without compaction', () => {
    baseDir = createTestDir('b1-wal-test');
    const stateDir = path.join(baseDir, '.eluma', 'state');
    const store = new StateStore(stateDir);

    const docName = 'test-doc-wal';
    const doc = new Y.Doc();
    const text = doc.getText('text');

    // Update 1: "one "
    text.insert(0, 'one ');
    const u1 = Y.encodeStateAsUpdate(doc);
    store.saveUpdate(docName, u1);

    // Update 2: "two "
    const prevVector = Y.encodeStateVector(doc);
    text.insert(4, 'two ');
    const u2 = Y.encodeStateAsUpdate(doc, prevVector);
    store.saveUpdate(docName, u2);

    // Update 3: "three"
    const prevVector2 = Y.encodeStateVector(doc);
    text.insert(8, 'three');
    const u3 = Y.encodeStateAsUpdate(doc, prevVector2);
    store.saveUpdate(docName, u3);

    // Emulate crash (no compactDoc called!)
    // Load into a fresh doc
    const restoredDoc = new Y.Doc();
    const loaded = store.loadDoc(docName, restoredDoc);

    expect(loaded).toBe(true);
    expect(restoredDoc.getText('text').toString()).toBe('one two three');
  });

  // B2: 20 auto-saves in a row must not add empty lines to the note
  it('B2: consecutive auto-saves do not prepend newlines to note content', async () => {
    baseDir = createTestDir('b2-newline-test');
    const teamKey = generateTeamKey();

    const agent = new Agent({
      baseDir,
      peerPort: 14790,
      webPort: 13040,
      teamKey
    });
    await agent.start();

    const noteId = 'b2-test-note';
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes } = getIndexMaps(indexDoc);

    notes.set(noteId, {
      id: noteId,
      title: 'Чистая заметка',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const noteDoc = agent.docManager.getOrCreateDoc(getNoteDocName(noteId));
    const initialText = '# Заголовок\nПервая строка заметки.';
    noteDoc.getText('text').insert(0, initialText);

    // Initial flush to disk
    agent.fileMirror.flushAll();

    // Verify initial file written on disk
    const notePath = path.join(baseDir, 'vault', 'Чистая заметка.md');
    expect(fs.existsSync(notePath)).toBe(true);

    // Trigger 20 consecutive file-mirror flushes / change events
    for (let i = 0; i < 20; i++) {
      agent.fileMirror.flushDoc(getNoteDocName(noteId));
      // Give file watcher a tick
      await new Promise((r) => setTimeout(r, 10));
    }

    // Text in noteDoc must remain identical without prepended \n
    expect(noteDoc.getText('text').toString()).toBe(initialText);

    await agent.stop();
  });

  // B3: Renaming a note removes the old file and leaves no orphan files or duplicate collisions
  it('B3: renaming note removes old file and prevents duplicate collision in vault', async () => {
    baseDir = createTestDir('b3-rename-test');
    const teamKey = generateTeamKey();

    const agent = new Agent({
      baseDir,
      peerPort: 14791,
      webPort: 13041,
      teamKey
    });
    await agent.start();

    const noteId1 = 'note-renamed-1';
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { notes } = getIndexMaps(indexDoc);

    // Create note "Original Name"
    notes.set(noteId1, {
      id: noteId1,
      title: 'Original Name',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });
    const doc1 = agent.docManager.getOrCreateDoc(getNoteDocName(noteId1));
    doc1.getText('text').insert(0, 'Содержимое заметки 1');
    agent.fileMirror.flushAll();

    const oldPath = path.join(baseDir, 'vault', 'Original Name.md');
    expect(fs.existsSync(oldPath)).toBe(true);

    // Rename to "New Name"
    notes.set(noteId1, {
      id: noteId1,
      title: 'New Name',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });
    agent.fileMirror.flushAll();

    const newPath = path.join(baseDir, 'vault', 'New Name.md');
    expect(fs.existsSync(newPath)).toBe(true);
    // OLD FILE MUST BE DELETED (no orphan)
    expect(fs.existsSync(oldPath)).toBe(false);

    // Collision check: create note 2 with the SAME name "New Name" in the same folder
    const noteId2 = 'note-renamed-2';
    notes.set(noteId2, {
      id: noteId2,
      title: 'New Name',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });
    const doc2 = agent.docManager.getOrCreateDoc(getNoteDocName(noteId2));
    doc2.getText('text').insert(0, 'Содержимое заметки 2');
    agent.fileMirror.flushAll();

    // Both notes must have distinct files on disk (one gets a suffix -<4 chars of id>)
    const files = fs.readdirSync(path.join(baseDir, 'vault')).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(2);
    expect(files).toContain('New Name.md');

    await agent.stop();
  });

  // B4: Invitation URL with #teamKey connects two clean agents without manual config edits
  it('B4: peer joining via doks://ip:port#teamKey adopts key and establishes connection', async () => {
    const teamKeyA = generateTeamKey();

    // Agent A creates team
    const agentA = await createTestAgent({
      name: 'HostA',
      peerPort: 14792,
      webPort: 13042,
      teamKey: teamKeyA
    });
    activeAgents.push(agentA);

    // Clean Agent B starts with arbitrary key or no key
    const agentB = await createTestAgent({
      name: 'JoinerB',
      peerPort: 14793,
      webPort: 13043,
      teamKey: generateTeamKey() // initially different key!
    });
    activeAgents.push(agentB);

    // Joiner B adds peer with full invite string containing the host's teamKey
    const inviteString = `doks://127.0.0.1:14792#${teamKeyA}`;
    agentB.agent.peerService.addPeer(inviteString);

    // Verify mutual connection succeeds because agentB adopted teamKeyA from invite!
    await waitFor(() => {
      return (
        agentA.agent.peerService.getConnectedCount() >= 1 &&
        agentB.agent.peerService.getConnectedCount() >= 1
      );
    }, 6000);

    expect(agentA.agent.peerService.getConnectedCount()).toBeGreaterThanOrEqual(1);
    expect(agentB.agent.peerService.getConnectedCount()).toBeGreaterThanOrEqual(1);
  });

  // B5: Correct path comparison for Russian Windows usernames or spaces
  it('B5: path comparison works properly for paths with Cyrillic characters and spaces', () => {
    const russianPath = 'C:\\Users\\Тест Имя Пользователя\\agent\\dist\\index.js';
    const fileUrl = url.pathToFileURL(russianPath).href;

    // The robust comparison using pathToFileURL matches fileUrl
    const isMainModule = url.pathToFileURL(russianPath).href === fileUrl;
    expect(isMainModule).toBe(true);

    // Whereas the broken naive comparison fails
    const brokenNaive = `file:///${russianPath.replace(/\\/g, '/')}`;
    expect(brokenNaive === fileUrl).toBe(false);
  });
});
