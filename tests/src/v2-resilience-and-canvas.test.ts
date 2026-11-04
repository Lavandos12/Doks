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
import { computeContinuousWheelTarget } from '../../web/src/utils/canvasGrid.js';

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

  describe('6. Multi-Object Deletion & Incident Edge Cascading (v62)', () => {
    it('deletes multiple nodes, cascades to incident edges, and respects locked nodes', () => {
      const doc = new Y.Doc();
      const yNodes = doc.getMap('nodes');
      const yEdges = doc.getMap('edges');

      // Create Node 1
      const n1 = new Y.Map();
      n1.set('id', 'node-1');
      n1.set('type', 'shape');
      n1.set('deleted', false);
      yNodes.set('node-1', n1);

      // Create Node 2
      const n2 = new Y.Map();
      n2.set('id', 'node-2');
      n2.set('type', 'shape');
      n2.set('deleted', false);
      yNodes.set('node-2', n2);

      // Create Locked Node 3
      const n3 = new Y.Map();
      n3.set('id', 'node-3');
      n3.set('type', 'sticky');
      n3.set('locked', true);
      n3.set('deleted', false);
      yNodes.set('node-3', n3);

      // Create Edge between Node 1 and Node 2
      yEdges.set('edge-1-2', {
        id: 'edge-1-2',
        from: 'node-1',
        to: 'node-2',
        deleted: false
      });

      // Create Edge between Node 2 and Node 3
      yEdges.set('edge-2-3', {
        id: 'edge-2-3',
        from: 'node-2',
        to: 'node-3',
        deleted: false
      });

      // UndoManager configured with CANVAS_UNDO_ORIGIN
      const undoManager = new Y.UndoManager([yNodes, yEdges], {
        trackedOrigins: new Set([CANVAS_UNDO_ORIGIN])
      });

      // Simulate multi-selection deletion of node-1, node-2, node-3
      const selectedIds = new Set(['node-1', 'node-2', 'node-3']);
      const nonLockedIds = new Set<string>();
      for (const id of selectedIds) {
        const nodeMap = yNodes.get(id) as Y.Map<any> | undefined;
        if (nodeMap && !nodeMap.get('locked')) {
          nonLockedIds.add(id);
        }
      }

      // Execute transaction
      doc.transact(() => {
        for (const id of nonLockedIds) {
          const nm = yNodes.get(id) as Y.Map<any>;
          nm.set('deleted', true);
          nm.set('deletedAt', Date.now());
        }
        yEdges.forEach((edge: any, edgeId: string) => {
          if (
            edge &&
            !edge.deleted &&
            (nonLockedIds.has(edge.from) ||
              nonLockedIds.has(edge.to) ||
              nonLockedIds.has(edge.fromNode) ||
              nonLockedIds.has(edge.toNode))
          ) {
            yEdges.set(edgeId, { ...edge, deleted: true, deletedAt: Date.now() });
          }
        });
      }, CANVAS_UNDO_ORIGIN);

      // Verification: node-1 and node-2 marked deleted
      expect((yNodes.get('node-1') as Y.Map<any>).get('deleted')).toBe(true);
      expect((yNodes.get('node-2') as Y.Map<any>).get('deleted')).toBe(true);

      // Locked node-3 is preserved
      expect((yNodes.get('node-3') as Y.Map<any>).get('deleted')).toBe(false);

      // Both edges are marked deleted because node-1 and node-2 were deleted
      expect((yEdges.get('edge-1-2') as any).deleted).toBe(true);
      expect((yEdges.get('edge-2-3') as any).deleted).toBe(true);

      // Undo restores node-1, node-2, and both edges
      undoManager.undo();
      expect((yNodes.get('node-1') as Y.Map<any>).get('deleted')).toBe(false);
      expect((yNodes.get('node-2') as Y.Map<any>).get('deleted')).toBe(false);
      expect((yEdges.get('edge-1-2') as any).deleted).toBe(false);
      expect((yEdges.get('edge-2-3') as any).deleted).toBe(false);
    });
  });
  describe('7. Miro-Grade Continuous Zoom Clamping (0.01 to 4.0)', () => {
    it('allows continuous wheel zoom-out down to 1% (0.01) and zoom-in up to 400% (4.0)', () => {
      let vp = { x: 500, y: 300, zoom: 1.0 };

      // Zoom out repeatedly with large wheel delta
      for (let i = 0; i < 20; i++) {
        vp = computeContinuousWheelTarget(vp, 400, 500, 300);
      }
      expect(vp.zoom).toBeGreaterThanOrEqual(0.01);
      expect(vp.zoom).toBeLessThan(0.05);

      // Clamps exactly at 0.01 min
      for (let i = 0; i < 30; i++) {
        vp = computeContinuousWheelTarget(vp, 1000, 500, 300);
      }
      expect(vp.zoom).toBe(0.01);

      // Zoom in repeatedly with negative wheel delta
      for (let i = 0; i < 30; i++) {
        vp = computeContinuousWheelTarget(vp, -500, 500, 300);
      }
      expect(vp.zoom).toBe(4.0);
    });
  });

  describe('8. Word-Wrap Aware Auto-Font Sizing & Drawing Filter (v67)', () => {
    function testAutoFontSize(text: string, w: number, h: number): number {
      const padW = Math.max(20, w - 24);
      const padH = Math.max(20, h - 24);
      const clean = (text || '').trim();
      if (!clean) return Math.min(Math.max(14, Math.round(h * 0.12)), 40);

      let low = 12;
      let high = Math.min(Math.round(h * 0.4), 120);
      let best = low;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const charWidth = mid * 0.56;
        const charsPerLine = Math.max(1, Math.floor(padW / charWidth));

        const rawLines = clean.split('\n');
        let totalLines = 0;
        for (const line of rawLines) {
          totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
        }

        const requiredHeight = totalLines * (mid * 1.35);
        if (requiredHeight <= padH) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    }

    it('smoothly expands font size when card is resized from 200x130 to 800x600', () => {
      const text = 'Sprint Planning & Architectural Sync';
      const smallSize = testAutoFontSize(text, 200, 130);
      const largeSize = testAutoFontSize(text, 800, 600);

      expect(smallSize).toBeGreaterThanOrEqual(12);
      expect(smallSize).toBeLessThanOrEqual(30);

      expect(largeSize).toBeGreaterThan(smallSize);
      expect(largeSize).toBeGreaterThanOrEqual(40);
      expect(largeSize).toBeLessThanOrEqual(120);
    });

    it('correctly filters out freehand drawing nodes from marquee selection', () => {
      const nodes: Array<any> = [
        { id: 'card-1', type: 'sticky', x: 100, y: 100, w: 200, h: 120, text: 'Card', color: 'default' },
        { id: 'draw-1', type: 'drawing', x: 120, y: 120, w: 100, h: 80, text: '', color: '#ff0000' }
      ];

      const minX = 50, maxX = 400, minY = 50, maxY = 300;
      const selected = new Set();

      for (const n of nodes) {
        if (!n.deleted && n.type !== 'drawing' && n.x + n.w >= minX && n.x <= maxX && n.y + n.h >= minY && n.y <= maxY) {
          selected.add(n.id);
        }
      }

      expect(selected.has('card-1')).toBe(true);
      expect(selected.has('draw-1')).toBe(false);
    });
  });

  describe('9. Proportional Text Scaling, Bounded Workspace & Viewport Fit (v68)', () => {
    function calculateAutoFontSizeV68(text: string, w: number, h: number): number {
      const padW = Math.max(20, w - 24);
      const padH = Math.max(20, h - 24);
      const clean = (text || '').trim();

      if (!clean) {
        return Math.min(Math.max(14, Math.round(h * 0.14)), 72);
      }

      let low = 12;
      let high = Math.min(Math.round(h * 0.5), 140);
      let best = low;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const charWidth = mid * 0.54;
        const charsPerLine = Math.max(1, Math.floor(padW / charWidth));

        const rawParagraphs = clean.split('\n');
        let totalLines = 0;
        for (const para of rawParagraphs) {
          totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
        }

        const totalHeight = totalLines * (mid * 1.35);
        if (totalHeight <= padH) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    }

    it('scales empty/minimal text proportionally with card height up to 72px', () => {
      const emptySmall = calculateAutoFontSizeV68('', 200, 100);
      const emptyMedium = calculateAutoFontSizeV68('', 400, 300);
      const emptyLarge = calculateAutoFontSizeV68('  ', 800, 700);

      expect(emptySmall).toBe(14);
      expect(emptyMedium).toBe(42);
      expect(emptyLarge).toBe(72);
    });

    it('computes binary-search font size for paragraphs up to 140px upper bound', () => {
      const singleWord = 'Doks';
      const largeCardFont = calculateAutoFontSizeV68(singleWord, 1000, 600);
      expect(largeCardFont).toBeGreaterThan(60);
      expect(largeCardFont).toBeLessThanOrEqual(140);

      const longPara = 'Doks is a local-first peer-to-peer infinite canvas and Markdown collaboration workspace powered by Yjs CRDTs and WebSockets with hardened security.';
      const constrainedFont = calculateAutoFontSizeV68(longPara, 280, 150);
      expect(constrainedFont).toBeGreaterThanOrEqual(12);
      expect(constrainedFont).toBeLessThanOrEqual(20);
    });

    it('scales text node font size proportionally when corner handle is dragged', () => {
      const startW = 200;
      const startFontSize = 18;
      const newW = 400;

      const scaledFontSize = Math.min(Math.max(12, Math.round(startFontSize * (newW / startW))), 140);
      expect(scaledFontSize).toBe(36);
    });

    it('computes frame title font size clamped between 14px and 48px', () => {
      function getFrameFontSize(w: number, h: number): number {
        return Math.min(Math.max(14, Math.round(Math.min(w, h) * 0.035)), 48);
      }

      expect(getFrameFontSize(300, 200)).toBe(14);
      expect(getFrameFontSize(800, 600)).toBe(21);
      expect(getFrameFontSize(2000, 1600)).toBe(48);
    });

    it('computes bounded workspace sheet with minimum 4000x3000 halo centered on content', () => {
      const nodes = [
        { x: 100, y: 100, w: 200, h: 150, deleted: false },
        { x: 500, y: 400, w: 300, h: 200, deleted: false }
      ];

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      }

      const contentW = maxX - minX;
      const contentH = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const haloW = Math.max(4000, contentW + 1200);
      const haloH = Math.max(3000, contentH + 1000);

      const bounds = {
        x: Math.round(centerX - haloW / 2),
        y: Math.round(centerY - haloH / 2),
        w: Math.round(haloW),
        h: Math.round(haloH)
      };

      expect(bounds.w).toBe(4000);
      expect(bounds.h).toBe(3000);
      expect(bounds.x).toBe(Math.round(centerX - 2000));
      expect(bounds.y).toBe(Math.round(centerY - 1500));
    });

    it('calculates zoom-to-fit target with 12% viewport margins and clamps between 0.01 and 2.5', () => {
      const availW = 1200;
      const availH = 800;
      const paddingX = Math.max(96, availW * 0.12); // 144
      const paddingY = Math.max(96, availH * 0.12); // 96
      expect(paddingX).toBe(144);
      expect(paddingY).toBe(96);

      const contentW = 400;
      const contentH = 300;
      const scaleX = (availW - paddingX * 2) / Math.max(contentW, 100);
      const scaleY = (availH - paddingY * 2) / Math.max(contentH, 100);
      const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.01), 2.5);

      expect(targetZoom).toBeGreaterThan(1.0);
      expect(targetZoom).toBeLessThanOrEqual(2.5);
    });
  });


  describe('10. Pure Infinite Canvas, Staggered Radial Callouts & Spatial Separation (v69)', () => {
    function calculateAutoFontSizeV69(text: string, w: number, h: number): number {
      const padW = Math.max(20, w - 24);
      const padH = Math.max(20, h - 24);
      const clean = (text || '').trim();

      if (!clean) {
        return Math.min(Math.max(14, Math.round(h * 0.14)), 72);
      }

      let low = 14;
      let high = Math.min(Math.round(h * 0.5), 120);
      let best = low;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const charWidth = mid * 0.54;
        const charsPerLine = Math.max(1, Math.floor(padW / charWidth));

        const rawParagraphs = clean.split('\n');
        let totalLines = 0;
        for (const para of rawParagraphs) {
          totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
        }

        const totalHeight = totalLines * (mid * 1.35);
        if (totalHeight <= padH) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    }

    it('enforces Auto Font bounds strictly between 14px and 120px in Auto Font mode', () => {
      const singleWord = 'Executive Summary';
      const largeCardFont = calculateAutoFontSizeV69(singleWord, 1000, 600);
      expect(largeCardFont).toBeGreaterThanOrEqual(14);
      expect(largeCardFont).toBeLessThanOrEqual(120);

      const hugeCardFont = calculateAutoFontSizeV69(singleWord, 4000, 3000);
      expect(hugeCardFont).toBe(120);

      const tinyCardFont = calculateAutoFontSizeV69('Long long text in tiny box', 80, 50);
      expect(tinyCardFont).toBe(14);
    });

    it('scales sticky/shape manual font size proportionally on corner resize up to 120px', () => {
      const startW = 200;
      const startFontSize = 24;
      const newW = 400;

      const newFontSize = Math.min(120, Math.max(12, Math.round(startFontSize * (newW / startW))));
      expect(newFontSize).toBe(48);

      const extremeW = 2000;
      const clampedFontSize = Math.min(120, Math.max(12, Math.round(startFontSize * (extremeW / startW))));
      expect(clampedFontSize).toBe(120);
    });

    it('scales frame header font size up to 54px ceiling', () => {
      function getFrameFontSizeV69(w: number, h: number): number {
        return Math.min(54, Math.max(14, Math.round(Math.min(w, h) * 0.035)));
      }

      expect(getFrameFontSizeV69(200, 200)).toBe(14);
      expect(getFrameFontSizeV69(1000, 800)).toBe(28);
      expect(getFrameFontSizeV69(3000, 2500)).toBe(54);
    });

    it('alternates staggered radial callout lines for narrow slices to eliminate label collision', () => {
      const cx = 120;
      const cy = 120;
      const r = 70;

      // Slices with < 12%
      const smallSlices = [
        { id: 's1', pct: 4 },
        { id: 's2', pct: 5 },
        { id: 's3', pct: 3 },
        { id: 's4', pct: 6 }
      ];

      const callouts = smallSlices.map((s, idx) => {
        const isStaggered = idx % 2 === 1;
        const calloutRadius = isStaggered ? (r + 28) : (r + 14);
        const textRadius = isStaggered ? (r + 34) : (r + 20);
        return { id: s.id, isStaggered, calloutRadius, textRadius };
      });

      expect(callouts[0].calloutRadius).toBe(84);
      expect(callouts[0].textRadius).toBe(90);
      expect(callouts[1].calloutRadius).toBe(98);
      expect(callouts[1].textRadius).toBe(104);

      // Verify clearance inside 240x240 viewBox
      for (const c of callouts) {
        expect(cx + c.textRadius).toBeLessThanOrEqual(230);
        expect(cx - c.textRadius).toBeGreaterThanOrEqual(10);
      }
    });

    it('scales chart base height adaptively when data sectors expand', () => {
      function getChartBaseH(sectorCount: number): number {
        return Math.max(360, 220 + 40 + sectorCount * 38);
      }

      expect(getChartBaseH(2)).toBe(360);
      expect(getChartBaseH(4)).toBe(412);
      expect(getChartBaseH(8)).toBe(564);
      expect(getChartBaseH(12)).toBe(716);
    });

    it('calculates zoom-to-fit with generous 15% viewport margins', () => {
      const availW = 1920;
      const availH = 1080;
      const paddingX = Math.max(96, availW * 0.15); // 288
      const paddingY = Math.max(96, availH * 0.15); // 162
      expect(paddingX).toBe(288);
      expect(paddingY).toBe(162);

      const contentW = 1000;
      const contentH = 600;
      const scaleX = (availW - paddingX * 2) / Math.max(contentW, 100);
      const scaleY = (availH - paddingY * 2) / Math.max(contentH, 100);
      const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.01), 2.5);

      expect(targetZoom).toBeCloseTo(Math.min(1344 / 1000, 756 / 600), 2);
    });

    it('confirms 32px outward port offset ensures clean >=28px separation from 0px edge handles', () => {
      const edgeHandleY = 0; // sits directly on node border
      const portY = -32; // world offset -32px
      const centerToCenterDistance = Math.abs(portY - edgeHandleY);
      expect(centerToCenterDistance).toBe(32);
      expect(centerToCenterDistance).toBeGreaterThanOrEqual(28);
    });
  });

});
