import { describe, it, expect, afterEach } from 'vitest';
import { generateTeamKey } from '@doks/agent';
import { createTestAgent, cleanupTestDir, waitFor, type TestAgentInstance } from './test-helpers.js';

describe('Stage 0: Skeleton Synchronization', () => {
  let agent1: TestAgentInstance | undefined;
  let agent2: TestAgentInstance | undefined;

  afterEach(async () => {
    if (agent1) {
      await agent1.agent.stop();
      cleanupTestDir(agent1.baseDir);
      agent1 = undefined;
    }
    if (agent2) {
      await agent2.agent.stop();
      cleanupTestDir(agent2.baseDir);
      agent2 = undefined;
    }
  });

  it('synchronizes a Y.Text between two agents on different ports over WebSocket', async () => {
    const teamKey = generateTeamKey();

    // 1. Start Agent 1
    agent1 = await createTestAgent({
      name: 'Agent1',
      peerPort: 14747,
      webPort: 13000,
      teamKey,
      peers: []
    });

    // 2. Start Agent 2 with Agent 1 in peers list
    agent2 = await createTestAgent({
      name: 'Agent2',
      peerPort: 14748,
      webPort: 13001,
      teamKey,
      peers: ['127.0.0.1:14747']
    });

    // Wait for mutual connection
    await waitFor(() => {
      return (
        agent1!.agent.peerService.getConnectedCount() >= 1 &&
        agent2!.agent.peerService.getConnectedCount() >= 1
      );
    });

    // 3. Edit text in Agent 1
    const docName = 'doks-note-test-stage0';
    const doc1 = agent1.agent.docManager.getOrCreateDoc(docName);
    const text1 = doc1.getText('text');
    text1.insert(0, 'Текст из Агента 1');

    // 4. Verify text appears in Agent 2
    const doc2 = agent2.agent.docManager.getOrCreateDoc(docName);
    const text2 = doc2.getText('text');

    await waitFor(() => {
      return text2.toString() === 'Текст из Агента 1';
    });

    expect(text2.toString()).toBe('Текст из Агента 1');

    // 5. Edit from Agent 2 and verify Agent 1 receives it
    text2.insert(text2.length, ' + дополнение от Агента 2');

    await waitFor(() => {
      return text1.toString() === 'Текст из Агента 1 + дополнение от Агента 2';
    });

    expect(text1.toString()).toBe('Текст из Агента 1 + дополнение от Агента 2');
  });
});
