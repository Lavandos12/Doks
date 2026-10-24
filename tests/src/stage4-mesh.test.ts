import { describe, it, expect, afterEach } from 'vitest';
import { generateTeamKey } from '@doks/agent';
import { getNoteDocName } from '@doks/shared';
import { createTestAgent, cleanupTestDir, waitFor, type TestAgentInstance } from './test-helpers.js';

describe('Stage 4: Mesh Relay, Handshake Security & Offline Recovery', () => {
  let agentA: TestAgentInstance | undefined;
  let agentB: TestAgentInstance | undefined;
  let agentC: TestAgentInstance | undefined;
  let intruderAgent: TestAgentInstance | undefined;

  afterEach(async () => {
    if (agentA) {
      await agentA.agent.stop();
      cleanupTestDir(agentA.baseDir);
      agentA = undefined;
    }
    if (agentB) {
      await agentB.agent.stop();
      cleanupTestDir(agentB.baseDir);
      agentB = undefined;
    }
    if (agentC) {
      await agentC.agent.stop();
      cleanupTestDir(agentC.baseDir);
      agentC = undefined;
    }
    if (intruderAgent) {
      await intruderAgent.agent.stop();
      cleanupTestDir(intruderAgent.baseDir);
      intruderAgent = undefined;
    }
  });

  it('rejects connection when teamKey does not match (Handshake Security)', async () => {
    const validTeamKey = generateTeamKey();
    const wrongTeamKey = generateTeamKey();

    agentA = await createTestAgent({
      name: 'AgentA',
      peerPort: 14760,
      webPort: 13010,
      teamKey: validTeamKey
    });

    intruderAgent = await createTestAgent({
      name: 'Intruder',
      peerPort: 14761,
      webPort: 13011,
      teamKey: wrongTeamKey,
      peers: ['127.0.0.1:14760']
    });

    // Give time for handshake attempt
    await new Promise((r) => setTimeout(r, 600));

    // Neither agent should be authenticated with the other
    expect(agentA.agent.peerService.getConnectedCount()).toBe(0);
    expect(intruderAgent.agent.peerService.getConnectedCount()).toBe(0);
  });

  it('relays edits through middle agent: A <-> B <-> C without direct A-C link', async () => {
    const teamKey = generateTeamKey();

    // 1. Agent A
    agentA = await createTestAgent({
      name: 'AgentA',
      peerPort: 14762,
      webPort: 13012,
      teamKey
    });

    // 2. Agent B connects to A
    agentB = await createTestAgent({
      name: 'AgentB',
      peerPort: 14763,
      webPort: 13013,
      teamKey,
      peers: ['127.0.0.1:14762']
    });

    // 3. Agent C connects to B only (A is unknown to C)
    agentC = await createTestAgent({
      name: 'AgentC',
      peerPort: 14764,
      webPort: 13014,
      teamKey,
      peers: ['127.0.0.1:14763']
    });

    // Wait for mesh topology to establish
    await waitFor(() => {
      return (
        agentA!.agent.peerService.getConnectedCount() >= 1 &&
        agentB!.agent.peerService.getConnectedCount() >= 2 &&
        agentC!.agent.peerService.getConnectedCount() >= 1
      );
    });

    const docName = getNoteDocName('note-relay-test');

    // Agent C opens the doc
    const docC = agentC.agent.docManager.getOrCreateDoc(docName);
    const textC = docC.getText('text');

    // Agent A writes to the doc
    const docA = agentA.agent.docManager.getOrCreateDoc(docName);
    const textA = docA.getText('text');
    textA.insert(0, 'Сообщение из Агента A через Агента B к Агенту C');

    // Verify Agent C receives the update via B
    await waitFor(() => {
      return textC.toString().includes('через Агента B к Агенту C');
    }, 6000);

    expect(textC.toString()).toBe('Сообщение из Агента A через Агента B к Агенту C');

    // Verify Agent C can write back to Agent A through B
    textC.insert(textC.length, ' -> Ответ получен!');

    await waitFor(() => {
      return textA.toString().includes('Ответ получен!');
    }, 6000);

    expect(textA.toString()).toBe('Сообщение из Агента A через Агента B к Агенту C -> Ответ получен!');
  });
});
