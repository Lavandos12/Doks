import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { getBoardMaps, nodeMapToData, setNodeProperties } from '@doks/shared';

describe('Stage 2: Infinite Board, Concurrent Stickies, Arrows & Awareness', () => {
  it('two users move different stickies concurrently and merge without conflict', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { nodes: nodesA, edges: edgesA } = getBoardMaps(docA);
    const { nodes: nodesB, edges: edgesB } = getBoardMaps(docB);

    // Initial setup: create two stickies on docA
    const s1A = new Y.Map();
    nodesA.set('sticky-1', s1A);
    setNodeProperties(s1A, {
      id: 'sticky-1',
      type: 'sticky',
      x: 100,
      y: 100,
      w: 200,
      h: 120,
      text: 'Стикер 1',
      color: '3',
      author: 'Алиса',
      deleted: false
    });

    const s2A = new Y.Map();
    nodesA.set('sticky-2', s2A);
    setNodeProperties(s2A, {
      id: 'sticky-2',
      type: 'sticky',
      x: 400,
      y: 100,
      w: 200,
      h: 120,
      text: 'Стикер 2',
      color: '4',
      author: 'Боб',
      deleted: false
    });

    // Sync state to docB
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Simulated network pipe between docA and docB
    const pendingUpdatesAtoB: Uint8Array[] = [];
    const pendingUpdatesBtoA: Uint8Array[] = [];

    docA.on('update', (u) => pendingUpdatesAtoB.push(u));
    docB.on('update', (u) => pendingUpdatesBtoA.push(u));

    // User A moves sticky 1 to (150, 120)
    const s1DocA = nodesA.get('sticky-1')!;
    s1DocA.set('x', 150);
    s1DocA.set('y', 120);

    // User B moves sticky 2 to (420, 250) AND changes sticky 1's color to '5'
    const s2DocB = nodesB.get('sticky-2')!;
    s2DocB.set('x', 420);
    s2DocB.set('y', 250);

    const s1DocB = nodesB.get('sticky-1')!;
    s1DocB.set('color', '5');

    // Deliver all updates
    for (const u of pendingUpdatesAtoB) Y.applyUpdate(docB, u);
    for (const u of pendingUpdatesBtoA) Y.applyUpdate(docA, u);

    // Verify Sticky 1 has new coordinates AND new color on both sides
    const resA1 = nodeMapToData('sticky-1', nodesA.get('sticky-1')!);
    const resB1 = nodeMapToData('sticky-1', nodesB.get('sticky-1')!);

    expect(resA1.x).toBe(150);
    expect(resA1.y).toBe(120);
    expect(resA1.color).toBe('5');

    expect(resB1.x).toBe(150);
    expect(resB1.y).toBe(120);
    expect(resB1.color).toBe('5');

    // Verify Sticky 2 has new coordinates on both sides
    const resA2 = nodeMapToData('sticky-2', nodesA.get('sticky-2')!);
    const resB2 = nodeMapToData('sticky-2', nodesB.get('sticky-2')!);

    expect(resA2.x).toBe(420);
    expect(resA2.y).toBe(250);
    expect(resB2.x).toBe(420);
    expect(resB2.y).toBe(250);
  });

  it('connects stickies with arrows (edges) and syncs', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { edges: edgesA } = getBoardMaps(docA);
    const { edges: edgesB } = getBoardMaps(docB);

    docA.on('update', (u) => Y.applyUpdate(docB, u));

    edgesA.set('edge-test', {
      id: 'edge-test',
      from: 'sticky-1',
      to: 'sticky-2',
      label: 'зависимость',
      color: '4',
      deleted: false
    });

    const receivedEdge = edgesB.get('edge-test');
    expect(receivedEdge).toBeDefined();
    expect(receivedEdge?.from).toBe('sticky-1');
    expect(receivedEdge?.to).toBe('sticky-2');
    expect(receivedEdge?.label).toBe('зависимость');
  });

  it('awareness protocol shares cursors between peers', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const awarenessA = new awarenessProtocol.Awareness(docA);
    const awarenessB = new awarenessProtocol.Awareness(docB);

    awarenessA.on('update', ({ added, updated, removed }: any) => {
      const u = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [
        ...added,
        ...updated,
        ...removed
      ]);
      awarenessProtocol.applyAwarenessUpdate(awarenessB, u, 'peer');
    });

    awarenessA.setLocalStateField('user', {
      name: 'Алиса',
      color: '#3b82f6',
      cursor: { x: 300, y: 450 }
    });

    const statesB = awarenessB.getStates();
    let foundCursor = false;
    statesB.forEach((state) => {
      if (state.user && state.user.name === 'Алиса') {
        expect(state.user.cursor.x).toBe(300);
        expect(state.user.cursor.y).toBe(450);
        foundCursor = true;
      }
    });

    expect(foundCursor).toBe(true);
  });
});
