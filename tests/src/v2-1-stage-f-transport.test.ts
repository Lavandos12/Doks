import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DirectWsTransport } from '../../agent/src/transport/direct-ws-transport.js';
import type { TransportPeerMessage as PeerMessage } from '@doks/shared';

describe('Stage F: Pluggable Transport Architecture & DirectWsTransport', () => {
  let serverTransport: DirectWsTransport | null = null;
  let clientTransport: DirectWsTransport | null = null;

  afterEach(async () => {
    if (clientTransport) {
      await clientTransport.stop();
      clientTransport = null;
    }
    if (serverTransport) {
      await serverTransport.stop();
      serverTransport = null;
    }
  });

  it('verifies docs/transport-spike.md exists and covers Hyperswarm and WebRTC', () => {
    const spikePath = path.resolve(__dirname, '../../docs/transport-spike.md');
    expect(fs.existsSync(spikePath)).toBe(true);
    const content = fs.readFileSync(spikePath, 'utf-8');
    expect(content).toContain('Hyperswarm');
    expect(content).toContain('WebRTC');
    expect(content).toContain('NAT');
    expect(content).toContain('v3');
  });

  it('establishes connection and exchanges PeerMessage using DirectWsTransport', async () => {
    const port = 49910;
    serverTransport = new DirectWsTransport('server-node', 'test-team-key');
    clientTransport = new DirectWsTransport('client-node', 'test-team-key');

    const receivedOnServer: PeerMessage[] = [];
    const receivedOnClient: PeerMessage[] = [];

    let serverConnPromise = new Promise<void>((resolve) => {
      serverTransport!.onConnection((conn) => {
        conn.onMessage((msg) => {
          receivedOnServer.push(msg);
          // echo back to client
          conn.send({
            type: 'sync',
            docName: 'echo-reply',
            payload: new Uint8Array([99, 100])
          });
        });
        resolve();
      });
    });

    await serverTransport.start({ bindAddress: '127.0.0.1', port });

    const clientConn = await clientTransport.connect(`ws://127.0.0.1:${port}`);
    clientConn.onMessage((msg) => {
      receivedOnClient.push(msg);
    });

    await serverConnPromise;

    // Send from client to server
    const testMsg: PeerMessage = {
      type: 'sync',
      docName: 'test-doc',
      payload: new Uint8Array([1, 2, 3, 4])
    };
    await clientConn.send(testMsg);

    // Wait for round-trip message
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(receivedOnServer.length).toBe(1);
    expect(receivedOnServer[0].type).toBe('sync');
    expect(receivedOnServer[0].docName).toBe('test-doc');
    expect(Array.from(receivedOnServer[0].payload)).toEqual([1, 2, 3, 4]);

    expect(receivedOnClient.length).toBe(1);
    expect(receivedOnClient[0].type).toBe('sync');
    expect(receivedOnClient[0].docName).toBe('echo-reply');
    expect(Array.from(receivedOnClient[0].payload)).toEqual([99, 100]);

    await clientConn.close();
  });
});
