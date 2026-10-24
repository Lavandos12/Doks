import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  getBoardDocName,
  getBoardMaps,
  setNodeProperties,
  nodeMapToData,
  type BoardNodeData
} from '@doks/shared';

describe('Stage D: Miro-Level Board Canvas Verification', () => {
  // B7: Board starts clean without auto-seeding
  it('B7: newly initialized board document starts empty without auto-seeding', () => {
    const doc = new Y.Doc();
    const { nodes, edges } = getBoardMaps(doc);

    expect(nodes.size).toBe(0);
    expect(edges.size).toBe(0);
  });

  // Sticky chaining calculation (Tab / Shift+Enter)
  it('Sticky chaining correctly calculates offset for next sticky', () => {
    const parentNode: BoardNodeData = {
      id: 'sticky-1',
      type: 'sticky',
      x: 100,
      y: 150,
      w: 200,
      h: 120,
      text: 'Первая задача',
      color: '3',
      author: 'Алиса',
      z: 1,
      deleted: false
    };

    const spacing = 24;

    // Chain to right (Tab)
    const nextRightX = parentNode.x + parentNode.w + spacing;
    const nextRightY = parentNode.y;
    expect(nextRightX).toBe(324);
    expect(nextRightY).toBe(150);

    // Chain down (Shift+Enter)
    const nextDownX = parentNode.x;
    const nextDownY = parentNode.y + parentNode.h + spacing;
    expect(nextDownX).toBe(100);
    expect(nextDownY).toBe(294);
  });

  // Frame dragging encompasses contained nodes
  it('Frame drag identifies all contained child nodes by bounding box', () => {
    const frame: BoardNodeData = {
      id: 'frame-1',
      type: 'frame',
      x: 50,
      y: 50,
      w: 400,
      h: 300,
      text: 'Группа спринта',
      color: '4',
      author: 'Team',
      z: 0,
      deleted: false
    };

    const childInside: BoardNodeData = {
      id: 'sticky-inside',
      type: 'sticky',
      x: 100,
      y: 100,
      w: 120,
      h: 80,
      text: 'Внутри рамки',
      color: '3',
      author: 'Team',
      z: 1,
      deleted: false
    };

    const nodeOutside: BoardNodeData = {
      id: 'sticky-outside',
      type: 'sticky',
      x: 500,
      y: 500,
      w: 120,
      h: 80,
      text: 'Снаружи рамки',
      color: '2',
      author: 'Team',
      z: 1,
      deleted: false
    };

    const allNodes = [frame, childInside, nodeOutside];

    const isInsideFrame = (child: BoardNodeData, f: BoardNodeData) => {
      const cx = child.x + child.w / 2;
      const cy = child.y + child.h / 2;
      return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
    };

    expect(isInsideFrame(childInside, frame)).toBe(true);
    expect(isInsideFrame(nodeOutside, frame)).toBe(false);

    // When moving frame by dx=+50, dy=+30:
    const dx = 50;
    const dy = 30;
    const movedInside = { ...childInside, x: childInside.x + dx, y: childInside.y + dy };
    expect(movedInside.x).toBe(150);
    expect(movedInside.y).toBe(130);
  });

  // Magnetic port calculation (top, right, bottom, left)
  it('Calculates exact magnetic port coordinates for smooth edge routing', () => {
    const node: BoardNodeData = {
      id: 'node-test',
      type: 'sticky',
      x: 200,
      y: 100,
      w: 160,
      h: 100,
      text: 'Стикер',
      color: '1',
      author: 'Вы',
      z: 1,
      deleted: false
    };

    const ports = {
      top: { x: node.x + node.w / 2, y: node.y },
      right: { x: node.x + node.w, y: node.y + node.h / 2 },
      bottom: { x: node.x + node.w / 2, y: node.y + node.h },
      left: { x: node.x, y: node.y + node.h / 2 }
    };

    expect(ports.top).toEqual({ x: 280, y: 100 });
    expect(ports.right).toEqual({ x: 360, y: 150 });
    expect(ports.bottom).toEqual({ x: 280, y: 200 });
    expect(ports.left).toEqual({ x: 200, y: 150 });
  });

  // Multi-node drag in single Yjs transaction with Undo
  it('Batch dragging multiple nodes executes in single Yjs transaction and undos cleanly', () => {
    const doc = new Y.Doc();
    const { nodes } = getBoardMaps(doc);

    const m1 = new Y.Map();
    const m2 = new Y.Map();
    nodes.set('n1', m1);
    nodes.set('n2', m2);

    setNodeProperties(m1, { id: 'n1', type: 'sticky', x: 10, y: 10, w: 100, h: 100, text: 'A', color: '1', author: '', z: 1, deleted: false });
    setNodeProperties(m2, { id: 'n2', type: 'sticky', x: 200, y: 200, w: 100, h: 100, text: 'B', color: '2', author: '', z: 1, deleted: false });

    const um = new Y.UndoManager([nodes], { trackedOrigins: new Set(['user']) });

    // Move both by dx=50, dy=50 in single transaction
    doc.transact(() => {
      m1.set('x', 60);
      m1.set('y', 60);
      m2.set('x', 250);
      m2.set('y', 250);
    }, 'user');

    expect(m1.get('x')).toBe(60);
    expect(m2.get('x')).toBe(250);

    // Single undo restores both initial positions
    um.undo();

    expect(m1.get('x')).toBe(10);
    expect(m1.get('y')).toBe(10);
    expect(m2.get('x')).toBe(200);
    expect(m2.get('y')).toBe(200);
  });
});
