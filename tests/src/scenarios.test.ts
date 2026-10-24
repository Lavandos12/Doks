import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Agent, generateTeamKey } from '@doks/agent';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteDocName,
  getBoardDocName,
  nodeMapToData,
  setNodeProperties
} from '@doks/shared';
import {
  createTestDir,
  cleanupTestDir,
  createTestAgent,
  waitFor,
  type TestAgentInstance
} from './test-helpers.js';

describe('Mandatory Integration Scenarios (ТЗ раздел 13)', () => {
  const activeAgents: TestAgentInstance[] = [];

  afterEach(async () => {
    while (activeAgents.length > 0) {
      const a = activeAgents.pop();
      if (a) {
        await a.agent.stop();
        cleanupTestDir(a.baseDir);
      }
    }
  });

  // Сценарий 1: Двое одновременно создают объект в одной точке: оба сохранились
  it('Scenario 1: Concurrent object creation at the same spot preserves both objects', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { nodes: nodesA } = getBoardMaps(docA);
    const { nodes: nodesB } = getBoardMaps(docB);

    // Initial sync
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Client A creates sticky-1 at (200, 200)
    const s1 = new Y.Map();
    nodesA.set('sticky-1', s1);
    setNodeProperties(s1, {
      id: 'sticky-1',
      type: 'sticky',
      x: 200,
      y: 200,
      w: 160,
      h: 100,
      text: 'Стикер пользователя A',
      deleted: false
    });

    // Client B concurrently creates sticky-2 at (200, 200)
    const s2 = new Y.Map();
    nodesB.set('sticky-2', s2);
    setNodeProperties(s2, {
      id: 'sticky-2',
      type: 'sticky',
      x: 200,
      y: 200,
      w: 160,
      h: 100,
      text: 'Стикер пользователя B',
      deleted: false
    });

    // Bidirectional merge
    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(docA, updateB);

    // Both objects must exist in both documents
    expect(nodesA.has('sticky-1')).toBe(true);
    expect(nodesA.has('sticky-2')).toBe(true);
    expect(nodesB.has('sticky-1')).toBe(true);
    expect(nodesB.has('sticky-2')).toBe(true);
  });

  // Сценарий 2: Один удаляет стикер, другой одновременно меняет его текст: стикер в корзине, текст не потерян, восстановление работает
  it('Scenario 2: Concurrent delete vs text edit: delete wins, text preserved, restore works', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { nodes: nodesA } = getBoardMaps(docA);
    const { nodes: nodesB } = getBoardMaps(docB);

    // Initial sticky
    const sMap = new Y.Map();
    nodesA.set('sticky-concurrent', sMap);
    setNodeProperties(sMap, {
      id: 'sticky-concurrent',
      type: 'sticky',
      x: 100,
      y: 100,
      w: 180,
      h: 120,
      text: 'Исходный текст',
      deleted: false
    });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // User A deletes sticky
    const mapA = nodesA.get('sticky-concurrent')!;
    mapA.set('deleted', true);
    mapA.set('deletedAt', Date.now());

    // User B simultaneously modifies text
    const mapB = nodesB.get('sticky-concurrent')!;
    setNodeProperties(mapB, { text: 'Текст, отредактированный в момент удаления' });

    // Exchange updates
    const uA = Y.encodeStateAsUpdate(docA);
    const uB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, uA);
    Y.applyUpdate(docA, uB);

    // Deletion wins: deleted is true on both sides
    const resA = nodeMapToData('sticky-concurrent', nodesA.get('sticky-concurrent')!);
    const resB = nodeMapToData('sticky-concurrent', nodesB.get('sticky-concurrent')!);

    expect(resA.deleted).toBe(true);
    expect(resB.deleted).toBe(true);

    // Restore sticky from trash
    nodesA.get('sticky-concurrent')!.set('deleted', false);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Text was NOT lost
    const restoredDataA = nodeMapToData('sticky-concurrent', nodesA.get('sticky-concurrent')!);
    const restoredDataB = nodeMapToData('sticky-concurrent', nodesB.get('sticky-concurrent')!);

    expect(restoredDataA.deleted).toBe(false);
    expect(restoredDataA.text).toBe('Текст, отредактированный в момент удаления');
    expect(restoredDataB.text).toBe('Текст, отредактированный в момент удаления');
  });

  // Сценарий 3: Один офлайн правит заметку, остальные тоже, после подключения все копии одинаковы
  it('Scenario 3: Offline edits converge to identical copies after reconnect', async () => {
    const teamKey = generateTeamKey();

    // 1. Initial shared state
    const agent1 = await createTestAgent({
      name: 'Agent1_Offline',
      peerPort: 14780,
      webPort: 13030,
      teamKey
    });
    activeAgents.push(agent1);

    const docName = getNoteDocName('note-offline-merge');
    const doc1 = agent1.agent.docManager.getOrCreateDoc(docName);
    doc1.getText('text').insert(0, 'Базовый текст заметки\n');

    const agent2 = await createTestAgent({
      name: 'Agent2_Offline',
      peerPort: 14781,
      webPort: 13031,
      teamKey,
      peers: ['127.0.0.1:14780']
    });
    activeAgents.push(agent2);

    // Wait for initial sync
    const doc2 = agent2.agent.docManager.getOrCreateDoc(docName);
    await waitFor(() => doc2.getText('text').toString().includes('Базовый текст заметки'));

    // 2. Disconnect: disconnect Agent 2
    await agent2.agent.peerService.stop();

    // 3. Edit concurrently in offline mode
    doc1.getText('text').insert(doc1.getText('text').length, 'Правка онлайн от Агента 1\n');
    doc2.getText('text').insert(doc2.getText('text').length, 'Правка офлайн от Агента 2\n');

    expect(doc1.getText('text').toString()).not.toBe(doc2.getText('text').toString());

    // 4. Reconnect Agent 2 to Agent 1
    await agent2.agent.peerService.start();

    // 5. Anti-entropy full sync will converge both
    await waitFor(() => {
      const t1 = doc1.getText('text').toString();
      const t2 = doc2.getText('text').toString();
      return (
        t1 === t2 &&
        t1.includes('Правка онлайн от Агента 1') &&
        t1.includes('Правка офлайн от Агента 2')
      );
    }, 8000);

    expect(doc1.getText('text').toString()).toBe(doc2.getText('text').toString());
  });

  // Сценарий 4: Три агента: A и C соединены только через B; правка A доходит до C
  it('Scenario 4: Mesh Relay - 3 agents: edit from A reaches C through B', async () => {
    const teamKey = generateTeamKey();

    const aA = await createTestAgent({
      name: 'MeshA',
      peerPort: 14782,
      webPort: 13032,
      teamKey
    });
    activeAgents.push(aA);

    const aB = await createTestAgent({
      name: 'MeshB',
      peerPort: 14783,
      webPort: 13033,
      teamKey,
      peers: ['127.0.0.1:14782']
    });
    activeAgents.push(aB);

    const aC = await createTestAgent({
      name: 'MeshC',
      peerPort: 14784,
      webPort: 13034,
      teamKey,
      peers: ['127.0.0.1:14783']
    });
    activeAgents.push(aC);

    await waitFor(() => {
      return (
        aA.agent.peerService.getConnectedCount() >= 1 &&
        aB.agent.peerService.getConnectedCount() >= 2 &&
        aC.agent.peerService.getConnectedCount() >= 1
      );
    });

    const docName = getNoteDocName('note-mesh-relay');
    const docC = aC.agent.docManager.getOrCreateDoc(docName);
    const docA = aA.agent.docManager.getOrCreateDoc(docName);

    docA.getText('text').insert(0, 'Правка из A доставлена в C через B');

    await waitFor(() => {
      return docC.getText('text').toString().includes('через B');
    }, 6000);

    expect(docC.getText('text').toString()).toBe('Правка из A доставлена в C через B');
  });

  // Сценарий 5: Рукопожатие с неверным ключом отклоняется
  it('Scenario 5: Handshake with invalid key is rejected and connection terminates', async () => {
    const validKey = generateTeamKey();
    const invalidKey = generateTeamKey();

    const validAgent = await createTestAgent({
      name: 'ValidAgent',
      peerPort: 14785,
      webPort: 13035,
      teamKey: validKey
    });
    activeAgents.push(validAgent);

    const invalidAgent = await createTestAgent({
      name: 'InvalidAgent',
      peerPort: 14786,
      webPort: 13036,
      teamKey: invalidKey,
      peers: ['127.0.0.1:14785']
    });
    activeAgents.push(invalidAgent);

    await new Promise((r) => setTimeout(r, 600));

    expect(validAgent.agent.peerService.getConnectedCount()).toBe(0);
    expect(invalidAgent.agent.peerService.getConnectedCount()).toBe(0);
  });

  // Сценарий 6: kill -9 посреди записи не портит файл состояния
  it('Scenario 6: Interrupted write leaves valid state file uncorrupted', () => {
    const testDir = createTestDir('scen6-kill');
    try {
      const stateStore = new Agent({ baseDir: testDir, peerPort: 14787, webPort: 13037 }).stateStore;
      const docName = 'corrupt-test-doc';

      const originalDoc = new Y.Doc();
      originalDoc.getText('text').insert(0, 'Важные надежные данные');
      stateStore.compactDoc(docName, originalDoc);

      const realFilePath = path.join(testDir, '.eluma', 'state', `${docName}.bin`);
      expect(fs.existsSync(realFilePath)).toBe(true);

      // Simulate a crashed write that left a dangling .tmp file
      const tempPath = `${realFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, 'CORRUPTED INCOMPLETE CHUNK OF BYTES');

      // Now create a fresh doc and load from StateStore
      const freshDoc = new Y.Doc();
      const loaded = stateStore.loadDoc(docName, freshDoc);

      expect(loaded).toBe(true);
      expect(freshDoc.getText('text').toString()).toBe('Важные надежные данные');
    } finally {
      cleanupTestDir(testDir);
    }
  });

  // Сценарий 7: Агент на 26.x.x.x недоступен с интерфейса, отличного от Radmin
  it('Scenario 7: Binding check: Agent on 26.x.x.x is not accessible on 127.0.0.1', async () => {
    // If local Radmin IP 26.153.49.48 is available
    const radminIp = '26.153.49.48';
    const testPort = 14788;

    const baseDir = createTestDir('scen7-binding');
    let agentBoundToRadmin: Agent | undefined;

    try {
      agentBoundToRadmin = new Agent({
        baseDir,
        bindAddress: radminIp,
        peerPort: testPort,
        webPort: 13038
      });
      await agentBoundToRadmin.start();

      // Attempt to connect to 127.0.0.1:testPort (which it is NOT listening on)
      const connectPromise = new Promise<'connected' | 'refused'>((resolve) => {
        const client = net.createConnection({ host: '127.0.0.1', port: testPort, timeout: 500 }, () => {
          client.end();
          resolve('connected');
        });
        client.on('error', () => resolve('refused'));
        client.on('timeout', () => {
          client.destroy();
          resolve('refused');
        });
      });

      const result = await connectPromise;
      expect(result).toBe('refused');
    } finally {
      if (agentBoundToRadmin) await agentBoundToRadmin.stop();
      cleanupTestDir(baseDir);
    }
  });
});
