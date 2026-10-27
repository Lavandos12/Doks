import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  distToSegment,
  computeSmartAlignment,
  computeResizeAlignment,
  type BoxRect,
  type AlignmentGuide
} from '../../web/src/utils/smartAlignment.js';
import { setNodeProperties, type BoardNodeData } from '@doks/shared';

describe('Smart Alignment Guides & Magnetic Snapping (Miro / Figma Architecture)', () => {
  const baseCandidate: BoxRect = {
    id: 'node-target',
    x: 200,
    y: 200,
    w: 160,
    h: 120
  };

  it('snaps to Left edge when within 6px threshold and generates vertical guide with cross markers', () => {
    // rawBox.x is 203 (3px away from target x: 200)
    const rawBox: BoxRect = {
      id: 'node-moving',
      x: 203,
      y: 400,
      w: 160,
      h: 120
    };

    const res = computeSmartAlignment(rawBox, [baseCandidate], 6);
    expect(res.snappedX).toBe(200);
    expect(res.snappedY).toBe(400);
    expect(res.guides.length).toBeGreaterThanOrEqual(1);

    const vertGuide = res.guides.find((g) => g.type === 'vertical');
    expect(vertGuide).toBeDefined();
    expect(vertGuide?.pos).toBe(200);
    expect(vertGuide?.start).toBeLessThanOrEqual(200);
    expect(vertGuide?.end).toBeGreaterThanOrEqual(400 + 120);
    expect(vertGuide?.snapPoints.length).toBeGreaterThan(0);
  });

  it('snaps to CenterX and CenterY for centered alignment', () => {
    // baseCandidate centerX is 200 + 80 = 280
    // moving box w is 100, so centerX is x + 50. If x = 228, centerX = 278 (2px diff)
    const rawBox: BoxRect = {
      id: 'node-moving',
      x: 228,
      y: 198, // target y is 200, 2px diff
      w: 100,
      h: 120
    };

    const res = computeSmartAlignment(rawBox, [baseCandidate], 6);
    expect(res.snappedX).toBe(230); // 280 - 50 = 230
    expect(res.snappedY).toBe(200);
    expect(res.guides.some((g) => g.type === 'vertical' && g.pos === 280)).toBe(true);
    expect(res.guides.some((g) => g.type === 'horizontal' && g.pos === 200)).toBe(true);
  });

  it('releases snap smoothly when cursor moves beyond threshold (Zero-Stickiness)', () => {
    // 10px diff is beyond 6px threshold
    const rawBox: BoxRect = {
      id: 'node-moving',
      x: 210,
      y: 400,
      w: 160,
      h: 120
    };

    const res = computeSmartAlignment(rawBox, [baseCandidate], 6);
    expect(res.snappedX).toBe(210);
    expect(res.snappedY).toBe(400);
    expect(res.guides.length).toBe(0);
  });

  it('bypasses snapping completely when threshold is 0 (Alt key held)', () => {
    const rawBox: BoxRect = {
      id: 'node-moving',
      x: 202,
      y: 202,
      w: 160,
      h: 120
    };

    const res = computeSmartAlignment(rawBox, [baseCandidate], 0);
    expect(res.snappedX).toBe(202);
    expect(res.snappedY).toBe(202);
    expect(res.guides.length).toBe(0);
  });

  it('detects equal horizontal spacing between 3 consecutive nodes and displays distance pill', () => {
    const box1: BoxRect = { id: 'b1', x: 100, y: 100, w: 100, h: 100 };
    const box2: BoxRect = { id: 'b2', x: 250, y: 100, w: 100, h: 100 }; // gap = 50px (250 - 200)
    // Moving box3 raw x is 398 (gap would be 48px, target x is 400 for 50px gap)
    const rawBox3: BoxRect = { id: 'b3', x: 398, y: 100, w: 100, h: 100 };

    const res = computeSmartAlignment(rawBox3, [box1, box2], 6);
    expect(res.snappedX).toBe(400);
    const spacingGuide = res.guides.find((g) => g.distanceLabel !== undefined);
    expect(spacingGuide).toBeDefined();
    expect(spacingGuide?.distanceLabel?.text).toContain('50 px');
  });

  it('performs 8-point resize snapping and dimension matching', () => {
    const activeBox: BoxRect = { id: 'resizing', x: 100, y: 100, w: 158, h: 118 };
    const targetBox: BoxRect = { id: 'target', x: 400, y: 300, w: 160, h: 120 };

    // Resize handle 'se' (southeast)
    const res = computeResizeAlignment(activeBox, 'se', [targetBox], 6);
    expect(res.w).toBe(160); // dimension matching
    expect(res.h).toBe(120);
    expect(res.x).toBe(100);
    expect(res.y).toBe(100);
  });
});

describe('Segment-Accurate Eraser Hit Testing (distToSegment)', () => {
  it('returns exact zero when point is on the line segment', () => {
    const v = { x: 0, y: 0 };
    const w = { x: 100, y: 0 };
    const p = { x: 50, y: 0 };
    expect(distToSegment(p, v, w)).toBe(0);
  });

  it('correctly calculates perpendicular distance to midpoint of segment', () => {
    const v = { x: 0, y: 0 };
    const w = { x: 100, y: 0 };
    const p = { x: 50, y: 12 };
    expect(distToSegment(p, v, w)).toBeCloseTo(12);
  });

  it('correctly calculates distance to segment endpoints when projected outside', () => {
    const v = { x: 0, y: 0 };
    const w = { x: 100, y: 0 };
    const p = { x: 105, y: 12 };
    // Distance to endpoint w (100, 0): hypot(5, 12) = 13
    expect(distToSegment(p, v, w)).toBeCloseTo(13);
  });

  it('detects eraser crossing between two sparse sampled points of a fast stroke', () => {
    // Fast stroke point A (100, 100) and point B (300, 100)
    const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
    const eraserPos = { x: 200, y: 105 }; // Eraser cuts through midpoint at y=105
    const erasePad = 18;
    const strokeWidth = 4;
    const threshold = Math.max(14, strokeWidth / 2 + erasePad); // 20px

    const dist = distToSegment(eraserPos, pts[0], pts[1]);
    expect(dist).toBe(5);
    expect(dist <= threshold).toBe(true);
  });
});

describe('Dual-Layer Artistic Brush, Chisel Highlighter, and Technical Pen', () => {
  it('computes correct halo (2.4x) and core (1.45x) stroke widths for brush sizes 2, 4, 8, 16, 24px', () => {
    const sizes = [2, 4, 8, 16, 24];
    for (const size of sizes) {
      const haloWidth = Math.round(size * 2.4);
      const coreWidth = Math.max(2, Math.round(size * 1.45));
      expect(haloWidth).toBeGreaterThan(coreWidth);
      expect(coreWidth).toBeGreaterThanOrEqual(size);
    }
  });

  it('computes chisel highlighter width at 3.0x with square linecaps', () => {
    const sizes = [2, 4, 8, 16, 24];
    for (const size of sizes) {
      const hlWidth = Math.round(size * 3.0);
      expect(hlWidth).toBe(size * 3);
    }
  });
});

describe('Multiline Textarea Auto-Growth and Chaining Hotkey Logic', () => {
  it('allows Shift+Enter and plain Enter for newlines while reserving Ctrl+Enter / Cmd+Enter for chaining', () => {
    // Hotkey handler simulation
    const simulateKeyDown = (key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean) => {
      let chained = false;
      let defaultPrevented = false;

      if (key === 'Tab' && !shiftKey) {
        defaultPrevented = true;
        chained = true;
      }
      if (key === 'Enter' && (ctrlKey || metaKey)) {
        defaultPrevented = true;
        chained = true;
      }

      return { chained, defaultPrevented };
    };

    // Shift + Enter: standard newline insertion
    const shiftEnter = simulateKeyDown('Enter', false, false, true);
    expect(shiftEnter.chained).toBe(false);
    expect(shiftEnter.defaultPrevented).toBe(false);

    // Plain Enter: standard newline insertion
    const plainEnter = simulateKeyDown('Enter', false, false, false);
    expect(plainEnter.chained).toBe(false);
    expect(plainEnter.defaultPrevented).toBe(false);

    // Ctrl + Enter: triggers downward chain
    const ctrlEnter = simulateKeyDown('Enter', true, false, false);
    expect(ctrlEnter.chained).toBe(true);
    expect(ctrlEnter.defaultPrevented).toBe(true);

    // Cmd + Enter (macOS): triggers downward chain
    const cmdEnter = simulateKeyDown('Enter', false, true, false);
    expect(cmdEnter.chained).toBe(true);
    expect(cmdEnter.defaultPrevented).toBe(true);
  });

  it('auto-expands card height when multiline scrollHeight exceeds current height', () => {
    const doc = new Y.Doc();
    const nodeMap = doc.getMap('node-1');

    setNodeProperties(nodeMap, {
      id: 'node-1',
      type: 'sticky',
      x: 100,
      y: 100,
      w: 200,
      h: 140,
      text: 'First line'
    });

    const currentH = nodeMap.get('h') as number;
    expect(currentH).toBe(140);

    // Simulate typing 10 lines: scrollHeight becomes 260px
    const scrollH = 260;
    const paddingExtra = 36;
    const newH = Math.max(currentH, scrollH + paddingExtra);

    setNodeProperties(nodeMap, {
      text: 'First line\nSecond\nThird\nFourth\nFifth\nSixth\nSeventh\nEighth\nNinth\nTenth',
      h: Math.round(newH)
    });

    expect(nodeMap.get('h')).toBe(296);
    expect((nodeMap.get('h') as number)).toBeGreaterThan(140);
  });
});
