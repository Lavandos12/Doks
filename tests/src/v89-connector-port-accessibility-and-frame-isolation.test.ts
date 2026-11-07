import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getPortCoordinates, findMagneticTargetPort, BoxNode } from '../../web/src/utils/connectorGeometry.js';

describe('v89 Magnetic Connector Port Accessibility & Frame Containment Isolation', () => {
  const root = process.cwd();
  const cssPath = path.join(root, 'web/src/style.css');
  const canvasPath = path.join(root, 'web/src/components/board/board-canvas.tsx');

  const cssSrc = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');

  describe('1. CSS Stacking Hierarchy & Selected State Interactivity', () => {
    it('guarantees magnetic ports are permanently visible and interactive when a node is selected', () => {
      expect(cssSrc).toContain('.board-node-box.selected .magnetic-port');
      // Must enforce opacity: 1 !important and pointer-events: auto !important
      const selectedPortRuleMatch = cssSrc.match(/\.board-node-box\.selected \.magnetic-port\s*\{([^}]+)\}/);
      expect(selectedPortRuleMatch).toBeTruthy();
      const body = selectedPortRuleMatch![1];
      expect(body).toContain('opacity: 1 !important');
      expect(body).toContain('pointer-events: auto !important');
    });

    it('elevates magnetic ports z-index above resize handles (z-index: 60 vs 50)', () => {
      // .magnetic-port must have z-index: 60 !important
      expect(cssSrc).toMatch(/\.magnetic-port\s*\{[^}]*z-index:\s*60\s*!important/);

      // .node-resize-handles-layer must stay at z-index: 50
      expect(cssSrc).toMatch(/\.node-resize-handles-layer\s*\{[^}]*z-index:\s*50\s*!important/);

      // .magnetic-port:hover elevates to z-index: 70 !important
      expect(cssSrc).toMatch(/\.magnetic-port:hover\s*\{[^}]*z-index:\s*70\s*!important/);
    });

    it('provides seamless directional hit-bridge across the 32px gap for unselected hover', () => {
      expect(cssSrc).toContain('.board-node-box:not(.selected) .port-top::before');
      expect(cssSrc).toContain('.board-node-box:not(.selected) .port-right::before');
      expect(cssSrc).toContain('.board-node-box:not(.selected) .port-bottom::before');
      expect(cssSrc).toContain('.board-node-box:not(.selected) .port-left::before');

      // Verify the right-side bridge extends leftward across the gap to the node border
      expect(cssSrc).toMatch(/\.board-node-box:not\(\.selected\)\s+\.port-right::before\s*\{[^}]*left:\s*-34px/);
    });

    it('safely suppresses magnetic ports during active canvas resizing or dragging', () => {
      expect(cssSrc).toMatch(/\.board-container\.is-resizing \.magnetic-port,\s*\.board-container\.is-dragging \.magnetic-port\s*\{[^}]*opacity:\s*0\s*!important/);
      expect(cssSrc).toMatch(/\.board-container\.is-resizing \.magnetic-port,\s*\.board-container\.is-dragging \.magnetic-port\s*\{[^}]*pointer-events:\s*none\s*!important/);
    });
  });

  describe('2. Canvas Pointer Event Isolation & Synchronous State Propagation', () => {
    it('binds both onMouseDown and onPointerDown to all 4 magnetic connector ports', () => {
      expect(canvasSrc).toContain('class="magnetic-port port-top"');
      expect(canvasSrc).toContain('class="magnetic-port port-right"');
      expect(canvasSrc).toContain('class="magnetic-port port-bottom"');
      expect(canvasSrc).toContain('class="magnetic-port port-left"');

      // Verify onPointerDown is bound on each port
      const topPortSnippet = canvasSrc.match(/class="magnetic-port port-top"[\s\S]*?\/>/)?.[0];
      const rightPortSnippet = canvasSrc.match(/class="magnetic-port port-right"[\s\S]*?\/>/)?.[0];
      const bottomPortSnippet = canvasSrc.match(/class="magnetic-port port-bottom"[\s\S]*?\/>/)?.[0];
      const leftPortSnippet = canvasSrc.match(/class="magnetic-port port-left"[\s\S]*?\/>/)?.[0];

      expect(topPortSnippet).toContain('onMouseDown');
      expect(topPortSnippet).toContain('onPointerDown');

      expect(rightPortSnippet).toContain('onMouseDown');
      expect(rightPortSnippet).toContain('onPointerDown');

      expect(bottomPortSnippet).toContain('onMouseDown');
      expect(bottomPortSnippet).toContain('onPointerDown');

      expect(leftPortSnippet).toContain('onMouseDown');
      expect(leftPortSnippet).toContain('onPointerDown');
    });

    it('synchronously sets connectingStateRef.current in handlePortPointerDown with stopPropagation', () => {
      expect(canvasSrc).toMatch(/handlePortPointerDown\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?e\.stopPropagation\(\);/);
      expect(canvasSrc).toMatch(/connectingStateRef\.current\s*=\s*nextState;/);
      expect(canvasSrc).toMatch(/setConnectingState\(nextState\);/);
    });

    it('dynamically toggles is-resizing and is-dragging classes on the root board container', () => {
      expect(canvasSrc).toContain('${resizeState ? \'is-resizing\' : \'\'}');
      expect(canvasSrc).toContain('${dragState ? \'is-dragging\' : \'\'}');
    });
  });

  describe('3. Geometric Port Calculation & Snapping Inside Nested Frames', () => {
    const frame: BoxNode = { id: 'frame-1', x: 100, y: 100, width: 800, height: 600 };
    const checklist: BoxNode = { id: 'card-checklist', x: 200, y: 250, width: 340, height: 260 };
    const targetCard: BoxNode = { id: 'card-target', x: 620, y: 250, width: 200, height: 140 };

    it('calculates exact mid-edge coordinates for all 4 ports of a card inside a frame', () => {
      const topPt = getPortCoordinates(checklist, 'top');
      const rightPt = getPortCoordinates(checklist, 'right');
      const bottomPt = getPortCoordinates(checklist, 'bottom');
      const leftPt = getPortCoordinates(checklist, 'left');

      expect(topPt).toEqual({ x: 370, y: 250 });
      expect(rightPt).toEqual({ x: 540, y: 380 });
      expect(bottomPt).toEqual({ x: 370, y: 510 });
      expect(leftPt).toEqual({ x: 200, y: 380 });
    });

    it('snaps connector line effortlessly to target card inside the frame halo boundary', () => {
      const nodes = [frame, checklist, targetCard];
      // Dragging near targetCard's left port (x: 620, y: 320)
      const dropX = 610;
      const dropY = 320;

      const snapped = findMagneticTargetPort(nodes, checklist.id, dropX, dropY, 28);
      expect(snapped).not.toBeNull();
      expect(snapped?.nodeId).toBe('card-target');
      expect(snapped?.side).toBe('left');
      expect(snapped?.point).toEqual({ x: 620, y: 320 });
    });

    it('rejects snapping to the parent frame container when aiming at a child node', () => {
      const nodes = [frame, checklist, targetCard];
      // Drop point close to targetCard edge
      const snapped = findMagneticTargetPort(nodes, checklist.id, 625, 320, 28);
      expect(snapped?.nodeId).toBe('card-target');
      expect(snapped?.nodeId).not.toBe('frame-1');
    });
  });
});
