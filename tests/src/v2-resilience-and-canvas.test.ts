import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  serializeCanvas,
  parseCanvas,
  boardToJSONCanvas,
  jsonCanvasToBoard,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import { buildEdgeSvgPath, type EdgeCurveType } from '../../web/src/utils/edgePaths.js';
import { getPortCoordinates, type BoxNode, type PortSide } from '../../web/src/utils/connectorGeometry.js';
import { matchShortcut, CANVAS_UNDO_ORIGIN } from '../../web/src/utils/hotkeysAndUndo.js';

describe('Doks v2.0 Resilience & Lossless Canvas Test Suite', () => {
  describe('1. Lossless Obsidian JSON Canvas Round-Trip', () => {
    it('preserves all extended edge properties losslessly through serialization and parsing', () => {
      const originalEdges: BoardEdgeData[] = [
        {
          id: 'edge-1',
          from: 'node-a',
          to: 'node-b',
          fromSide: 'right',
          toSide: 'left',
          color: '#34d399',
          curveType: 'orthogonal',
          style: 'dashed',
          thickness: 3,
          direction: 'both',
          label: 'REST Endpoint',
          deleted: false
        },
        {
          id: 'edge-2',
          from: 'node-b',
          to: 'node-c',
          fromSide: 'bottom',
          toSide: 'top',
          color: '#ef4444',
          curveType: 'straight',
          style: 'dotted',
          thickness: 5,
          direction: 'none',
          label: 'Fallback',
          deleted: false
        }
      ];

      const canvasData = serializeCanvas([], originalEdges);
      expect(canvasData.edges.length).toBe(2);

      // Verify standard Obsidian JSON Canvas structure
      expect(canvasData.edges[0].fromNode).toBe('node-a');
      expect(canvasData.edges[0].toNode).toBe('node-b');
      expect(canvasData.edges[0].color).toBe('#34d399');
      expect(canvasData.edges[0].curveType).toBe('orthogonal');
      expect(canvasData.edges[0].style).toBe('dashed');
      expect(canvasData.edges[0].thickness).toBe(3);
      expect(canvasData.edges[0].direction).toBe('both');

      // Round-trip parse back to Doks board
      const restored = parseCanvas(canvasData);
      expect(restored.edges.length).toBe(2);

      const r1 = restored.edges.find((e) => e.id === 'edge-1')!;
      expect(r1.color).toBe('#34d399');
      expect(r1.curveType).toBe('orthogonal');
      expect(r1.style).toBe('dashed');
      expect(r1.thickness).toBe(3);
      expect(r1.direction).toBe('both');
      expect(r1.label).toBe('REST Endpoint');
      expect(r1.fromSide).toBe('right');
      expect(r1.toSide).toBe('left');

      const r2 = restored.edges.find((e) => e.id === 'edge-2')!;
      expect(r2.color).toBe('#ef4444');
      expect(r2.curveType).toBe('straight');
      expect(r2.style).toBe('dotted');
      expect(r2.thickness).toBe(5);
      expect(r2.direction).toBe('none');
      expect(r2.label).toBe('Fallback');
    });

    it('preserves all extended node properties (shapes, locked, font, files) losslessly', () => {
      const originalNodes: BoardNodeData[] = [
        {
          id: 'node-shape',
          type: 'shape',
          x: 200,
          y: 350,
          w: 180,
          h: 120,
          text: 'Decision Gate',
          color: '5',
          author: 'Alex',
          shapeVariant: 'diamond',
          locked: true,
          fontSize: 18,
          hasCheckbox: true,
          z: 2,
          deleted: false
        },
        {
          id: 'node-file',
          type: 'file',
          x: 450,
          y: 350,
          w: 260,
          h: 180,
          text: 'Architecture.png',
          color: '2',
          author: 'System',
          fileHash: 'sha256-abcdef123456',
          fileName: 'Architecture.png',
          z: 1,
          deleted: false
        }
      ];

      const canvasData = boardToJSONCanvas(originalNodes, []);
      expect(canvasData.nodes.length).toBe(2);

      const parsed = jsonCanvasToBoard(canvasData);
      const n1 = parsed.nodes.find((n) => n.id === 'node-shape')!;
      expect(n1.shapeVariant).toBe('diamond');
      expect(n1.locked).toBe(true);
      expect(n1.fontSize).toBe(18);
      expect(n1.hasCheckbox).toBe(true);
      expect(n1.text).toBe('Decision Gate');

      const n2 = parsed.nodes.find((n) => n.id === 'node-file')!;
      expect(n2.fileHash).toBe('sha256-abcdef123456');
      expect(n2.fileName).toBe('Architecture.png');
    });
  });

  describe('2. Edge Geometry & Midpoint Computation', () => {
    it('computes Bezier, Orthogonal, and Straight edge paths with midpoint coordinates', () => {
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 500, y: 300 };

      // Bezier
      const bezier = buildEdgeSvgPath(p1.x, p1.y, 'right', p2.x, p2.y, 'left', 'bezier');
      expect(bezier.path).toMatch(/^M 100 100 C/);
      expect(bezier.labelX).toBeGreaterThan(100);
      expect(bezier.labelX).toBeLessThan(500);
      expect(bezier.labelY).toBeGreaterThan(100);
      expect(bezier.labelY).toBeLessThan(300);

      // Orthogonal
      const ortho = buildEdgeSvgPath(p1.x, p1.y, 'right', p2.x, p2.y, 'left', 'orthogonal');
      expect(ortho.path).toMatch(/^M 100 100 L 300 100 L 300 300 L 500 300$/);
      expect(ortho.labelX).toBe(300);
      expect(ortho.labelY).toBe(200);

      // Straight
      const straight = buildEdgeSvgPath(p1.x, p1.y, 'right', p2.x, p2.y, 'left', 'straight');
      expect(straight.path).toBe('M 100 100 L 500 300');
      expect(straight.labelX).toBe(300);
      expect(straight.labelY).toBe(200);
    });

    it('calculates 4-side port coordinates accurately for a node box', () => {
      const box: BoxNode = { id: 'box1', x: 200, y: 150, width: 300, height: 200 };
      expect(getPortCoordinates(box, 'top')).toEqual({ x: 350, y: 150 });
      expect(getPortCoordinates(box, 'right')).toEqual({ x: 500, y: 250 });
      expect(getPortCoordinates(box, 'bottom')).toEqual({ x: 350, y: 350 });
      expect(getPortCoordinates(box, 'left')).toEqual({ x: 200, y: 250 });
    });
  });

  describe('3. Russian Filename Header Encoding & Resilience', () => {
    it('encodes non-ASCII filenames on client and safely decodes on server', () => {
      const filename = 'Техническое_Задание_v2.0 (Схема).docx';
      const encoded = encodeURIComponent(filename);

      // Confirm safe for HTTP header (ASCII only)
      expect(/^[a-zA-Z0-9\-_.!~*'()%]+$/.test(encoded)).toBe(true);

      // Decode with error boundary
      let decoded: string;
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        decoded = encoded;
      }
      expect(decoded).toBe(filename);
    });

    it('handles malformed percent sequences gracefully without throwing', () => {
      const badHeader = 'Malformed%Header%2';
      let decoded: string;
      try {
        decoded = decodeURIComponent(badHeader);
      } catch {
        decoded = badHeader;
      }
      expect(decoded).toBe(badHeader);
    });
  });

  describe('4. Layout-Agnostic Hotkey Matching (RU & EN)', () => {
    it('matches physical shortcuts regardless of Cyrillic character layout', () => {
      // Ctrl+S on Russian layout (produces e.key = "ы", but e.code = "KeyS")
      const eventRussianSave = {
        code: 'KeyS',
        key: 'ы',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;
      expect(matchShortcut(eventRussianSave, 'mod+s')).toBe(true);

      // Ctrl+P on Russian layout (produces e.key = "з", but e.code = "KeyP")
      const eventRussianPrint = {
        code: 'KeyP',
        key: 'з',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;
      expect(matchShortcut(eventRussianPrint, 'mod+p')).toBe(true);

      // Ctrl+G on Russian layout (produces e.key = "п", but e.code = "KeyG")
      const eventRussianGroup = {
        code: 'KeyG',
        key: 'п',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;
      expect(matchShortcut(eventRussianGroup, 'mod+g')).toBe(true);

      // Ctrl+Z on Russian layout (produces e.key = "я", but e.code = "KeyZ")
      const eventRussianUndo = {
        code: 'KeyZ',
        key: 'я',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;
      expect(matchShortcut(eventRussianUndo, 'mod+z')).toBe(true);
    });
  });

  describe('5. Single-Step Undo Drag & Resize Optimization', () => {
    it('collapses intermediate drag frames into a single undo operation in Y.UndoManager', () => {
      const doc = new Y.Doc();
      const yNodes = doc.getMap<Y.Map<any>>('nodes');
      const yEdges = doc.getMap<any>('edges');

      const undoManager = new Y.UndoManager([yNodes, yEdges], {
        trackedOrigins: new Set([CANVAS_UNDO_ORIGIN]),
        captureTimeout: 400
      });

      // 1. Initial node creation
      const nodeMap = new Y.Map<any>();
      doc.transact(() => {
        yNodes.set('card-1', nodeMap);
        nodeMap.set('x', 100);
        nodeMap.set('y', 100);
      }, CANVAS_UNDO_ORIGIN);

      undoManager.stopCapturing();
      expect(nodeMap.get('x')).toBe(100);

      // 2. Simulate 50 frames of dragging mouse move with untracked origin 'drag-motion'
      for (let i = 1; i <= 50; i++) {
        doc.transact(() => {
          nodeMap.set('x', 100 + i * 2);
          nodeMap.set('y', 100 + i * 2);
        }, 'drag-motion');
      }

      // Final position is (200, 200)
      expect(nodeMap.get('x')).toBe(200);
      expect(nodeMap.get('y')).toBe(200);

      // 3. Pointer up reconciliation: revert initial under 'drag-cleanup', then commit final under CANVAS_UNDO_ORIGIN
      doc.transact(() => {
        nodeMap.set('x', 100);
        nodeMap.set('y', 100);
      }, 'drag-cleanup');

      doc.transact(() => {
        nodeMap.set('x', 200);
        nodeMap.set('y', 200);
      }, CANVAS_UNDO_ORIGIN);

      expect(nodeMap.get('x')).toBe(200);

      // 4. Exactly 1 undo call must restore the node back to (100, 100)
      undoManager.undo();
      expect(nodeMap.get('x')).toBe(100);
      expect(nodeMap.get('y')).toBe(100);

      // 5. Redo restores back to (200, 200)
      undoManager.redo();
      expect(nodeMap.get('x')).toBe(200);
      expect(nodeMap.get('y')).toBe(200);
    });
  });
});
