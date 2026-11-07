import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { BoardNodeData } from '@doks/shared';
import { computeOptimalViewportForNodes } from '../../web/src/components/board/board-canvas.js';

const mockNode = (partial: Partial<BoardNodeData> & { id: string; type: any; x: number; y: number; w: number; h: number }): BoardNodeData => ({
  text: '',
  color: '1',
  author: 'test-user',
  z: 1,
  deleted: false,
  ...partial
});

describe('v90 Initial Camera Centering on Existing Objects', () => {
  const root = process.cwd();
  const canvasPath = path.join(root, 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');

  describe('1. Algorithmic Viewport Calculation (computeOptimalViewportForNodes)', () => {
    it('returns default { x: 80, y: 80, zoom: 1 } when board has zero nodes', () => {
      const vp = computeOptimalViewportForNodes([], 1920, 1080);
      expect(vp).toEqual({ x: 80, y: 80, zoom: 1 });
    });

    it('returns default { x: 80, y: 80, zoom: 1 } when all nodes are deleted', () => {
      const deletedNodes: BoardNodeData[] = [
        mockNode({ id: '1', type: 'sticky', x: 500, y: 400, w: 200, h: 130, deleted: true, text: 'old' }),
        mockNode({ id: '2', type: 'shape', x: 1200, y: 800, w: 300, h: 200, deleted: true, text: 'gone' })
      ];
      const vp = computeOptimalViewportForNodes(deletedNodes, 1920, 1080);
      expect(vp).toEqual({ x: 80, y: 80, zoom: 1 });
    });

    it('centers single sticky note on screen and clamps zoom to at most 1.0 (never over-zooms)', () => {
      // Single sticky note at (400, 300) with size 200x130
      const node: BoardNodeData = mockNode({
        id: 'node-1',
        type: 'sticky',
        x: 400,
        y: 300,
        w: 200,
        h: 130,
        deleted: false,
        text: 'Important Goal'
      });

      const screenW = 1920;
      const screenH = 1080;
      const vp = computeOptimalViewportForNodes([node], screenW, screenH);

      // Must never exceed 1.0 zoom (Miro reading standard)
      expect(vp.zoom).toBe(1.0);

      // Node center: x: 500, y: 365
      // Screen center: 1920 / 2 = 960, 1080 / 2 = 540
      // x = 960 - 500 * 1 = 460
      // y = 540 - 365 * 1 = 175
      expect(vp.x).toBe(460);
      expect(vp.y).toBe(175);

      // Projected node bounding center in screen space
      const screenNodeCenterX = (node.x + node.w / 2) * vp.zoom + vp.x;
      const screenNodeCenterY = (node.y + node.h / 2) * vp.zoom + vp.y;
      expect(screenNodeCenterX).toBe(960);
      expect(screenNodeCenterY).toBe(540);
    });

    it('centers clustered cards located far from origin', () => {
      // Cluster of objects at (1200, 1500)
      const nodes: BoardNodeData[] = [
        mockNode({ id: 'c1', type: 'checklist', x: 1200, y: 1500, w: 320, h: 240, deleted: false, text: 'Tasks' }),
        mockNode({ id: 'c2', type: 'sticky', x: 1600, y: 1500, w: 200, h: 140, deleted: false, text: 'Notes' }),
        mockNode({ id: 'c3', type: 'frame', x: 1150, y: 1450, w: 700, h: 350, deleted: false, text: 'Sprint Frame' })
      ];

      const screenW = 1920;
      const screenH = 1080;
      const vp = computeOptimalViewportForNodes(nodes, screenW, screenH);

      // Frame spans from 1150 to 1850 (width 700), y from 1450 to 1800 (height 350)
      // Center: X = 1500, Y = 1625
      expect(vp.zoom).toBeLessThanOrEqual(1.0);

      const projectedCenterX = 1500 * vp.zoom + vp.x;
      const projectedCenterY = 1625 * vp.zoom + vp.y;
      expect(Math.abs(projectedCenterX - 960)).toBeLessThanOrEqual(2);
      expect(Math.abs(projectedCenterY - 540)).toBeLessThanOrEqual(2);
    });

    it('scales down zoom proportionally (< 1.0) for giant diagrams to fit on screen', () => {
      // Massive board spanning 4000x3000
      const nodes: BoardNodeData[] = [
        mockNode({ id: 'top-left', type: 'shape', x: 0, y: 0, w: 300, h: 200, deleted: false, text: 'Start' }),
        mockNode({ id: 'bottom-right', type: 'shape', x: 3700, y: 2800, w: 300, h: 200, deleted: false, text: 'End' })
      ];

      const screenW = 1920;
      const screenH = 1080;
      const vp = computeOptimalViewportForNodes(nodes, screenW, screenH);

      expect(vp.zoom).toBeLessThan(0.5);
      expect(vp.zoom).toBeGreaterThanOrEqual(0.1);

      // Entire content fits within screen boundaries (with padding)
      const screenLeft = 0 * vp.zoom + vp.x;
      const screenRight = 4000 * vp.zoom + vp.x;
      const screenTop = 0 * vp.zoom + vp.y;
      const screenBottom = 3000 * vp.zoom + vp.y;

      expect(screenLeft).toBeGreaterThanOrEqual(0);
      expect(screenRight).toBeLessThanOrEqual(screenW);
      expect(screenTop).toBeGreaterThanOrEqual(0);
      expect(screenBottom).toBeLessThanOrEqual(screenH);
    });

    it('centers on drawings when board contains only drawing strokes', () => {
      const drawingNodes: BoardNodeData[] = [
        mockNode({
          id: 'draw-1',
          type: 'drawing',
          x: 600,
          y: 500,
          w: 400,
          h: 300,
          deleted: false,
          text: '',
          svgPath: 'M 0 0 L 400 300'
        })
      ];

      const vp = computeOptimalViewportForNodes(drawingNodes, 1600, 900);
      expect(vp.zoom).toBe(1.0);

      // Drawing center: 600 + 200 = 800, 500 + 150 = 650
      // Screen center: 1600 / 2 = 800, 900 / 2 = 450
      expect(vp.x).toBe(0);
      expect(vp.y).toBe(-200);
    });

    it('prioritizes structured cards and frames over drawings when both exist', () => {
      const nodes: BoardNodeData[] = [
        mockNode({ id: 'card-1', type: 'sticky', x: 100, y: 100, w: 200, h: 130, deleted: false, text: 'Card' }),
        // Stray ink stroke far off at (5000, 5000)
        mockNode({ id: 'ink-stray', type: 'drawing', x: 5000, y: 5000, w: 50, h: 50, deleted: false, text: '' })
      ];

      const vp = computeOptimalViewportForNodes(nodes, 1920, 1080);
      // Zoom should NOT be collapsed down to 0.1 because of stray ink mark
      expect(vp.zoom).toBe(1.0);
      // Focused on card at (100, 100)
      const screenCardX = 200 * vp.zoom + vp.x;
      expect(screenCardX).toBe(960);
    });
  });

  describe('2. Component Lifecycle & Integration Architecture', () => {
    it('exports computeOptimalViewportForNodes from board-canvas.tsx', () => {
      expect(canvasSrc).toContain('export function computeOptimalViewportForNodes(');
    });

    it('synchronously initializes viewport in useState directly from preloaded Y.Map nodes', () => {
      expect(canvasSrc).toMatch(/const\s+\[viewport,\s*setViewport\]\s*=\s*useState<ViewportCoord>\(\(\)\s*=>\s*\{/);
      expect(canvasSrc).toContain('computeOptimalViewportForNodes(initialActiveNodes');
      expect(canvasSrc).toContain('hasInitialCenteredRef.current = true;');
    });

    it('re-centers newly synced nodes from IndexedDB / peers in updateState when not yet centered', () => {
      expect(canvasSrc).toMatch(/if\s*\(!hasInitialCenteredRef\.current\s*&&\s*!hasUserNavigatedRef\.current\s*&&\s*activeNodes\.length\s*>\s*0\)/);
      expect(canvasSrc).toContain('animateToViewport(optimal, true);');
    });

    it('records user navigation in handleWheel, handleBackgroundPointerDown, and handleNodePointerDown', () => {
      expect(canvasSrc).toMatch(/handleWheel\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?hasUserNavigatedRef\.current\s*=\s*true;/);
      expect(canvasSrc).toMatch(/handleBackgroundPointerDown\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?hasUserNavigatedRef\.current\s*=\s*true;/);
      expect(canvasSrc).toMatch(/handleNodePointerDown\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?hasUserNavigatedRef\.current\s*=\s*true;/);
    });

    it('harmonizes fitToContent with computeOptimalViewportForNodes', () => {
      expect(canvasSrc).toMatch(/const\s+fitToContent\s*=\s*\(\)\s*=>\s*\{[\s\S]*?computeOptimalViewportForNodes\(nodesList/);
    });
  });
});
