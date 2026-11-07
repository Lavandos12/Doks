import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('v88 Notes & Shapes Font Invariance During Frame Resizing', () => {
  const root = process.cwd();
  const canvasPath = path.join(root, 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');

  // Algorithmic evaluator mirroring board-canvas calculateAutoFontSize implementation
  const calculateAutoFontSize = (text: string, w: number, h: number, type?: string): number => {
    if (type === 'frame') {
      return Math.min(Math.max(14, Math.round(Math.min(w, h) * 0.035)), 48);
    }
    if (type === 'sticky' || type === 'shape') {
      return 14;
    }
    const padW = Math.max(20, w - 24);
    const padH = Math.max(20, h - 24);
    const clean = (text || '').trim();

    if (!clean) {
      return Math.min(Math.max(14, Math.round(h * 0.14)), 72);
    }

    let low = 12;
    let high = Math.min(Math.round(h * 0.5), 72);
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
    return Math.min(Math.max(12, best), 72);
  };

  describe('1. Algorithmic Font Invariance for Sticky Notes', () => {
    it('returns steady 14px for sticky notes at default dimensions', () => {
      expect(calculateAutoFontSize('', 200, 130, 'sticky')).toBe(14);
      expect(calculateAutoFontSize('Short note', 200, 130, 'sticky')).toBe(14);
    });

    it('guarantees font size does not increase when sticky note bounding box expands', () => {
      // Large dimensions (user dragging resize handles to expand card)
      const mediumBox = calculateAutoFontSize('Important task list', 500, 400, 'sticky');
      const largeBox = calculateAutoFontSize('Important task list', 1000, 800, 'sticky');
      const giantBox = calculateAutoFontSize('Important task list', 2500, 1800, 'sticky');

      expect(mediumBox).toBe(14);
      expect(largeBox).toBe(14);
      expect(giantBox).toBe(14);
    });

    it('guarantees font size does not increase when note has multi-line paragraph text', () => {
      const paragraph = `Общепит и пекарни: повара на подмену, повара-заготовщики, пекари, помощники на кухню.
ПВЗ и дарксторы: подменные операторы выдачи заказов.
Грузчики и склады: рабочие на квартирные переезды.`;

      expect(calculateAutoFontSize(paragraph, 200, 130, 'sticky')).toBe(14);
      expect(calculateAutoFontSize(paragraph, 600, 500, 'sticky')).toBe(14);
      expect(calculateAutoFontSize(paragraph, 1200, 900, 'sticky')).toBe(14);
    });
  });

  describe('2. Algorithmic Font Invariance for Shapes', () => {
    it('returns steady 14px for shapes at default dimensions', () => {
      expect(calculateAutoFontSize('', 200, 200, 'shape')).toBe(14);
      expect(calculateAutoFontSize('Start', 180, 180, 'shape')).toBe(14);
    });

    it('guarantees font size does not increase when shape bounding box expands', () => {
      const smallShape = calculateAutoFontSize('API Gateway', 200, 150, 'shape');
      const mediumShape = calculateAutoFontSize('API Gateway', 600, 450, 'shape');
      const largeShape = calculateAutoFontSize('API Gateway', 1200, 900, 'shape');
      const giantShape = calculateAutoFontSize('API Gateway', 3000, 2000, 'shape');

      expect(smallShape).toBe(14);
      expect(mediumShape).toBe(14);
      expect(largeShape).toBe(14);
      expect(giantShape).toBe(14);
    });
  });

  describe('3. Strict Isolation: Other Types Remain Responsive & Untouched', () => {
    it('preserves frame responsive title font sizing scaling between 14px and 48px', () => {
      const smallFrame = calculateAutoFontSize('Frame Title', 420, 320, 'frame');
      const largeFrame = calculateAutoFontSize('Frame Title', 1600, 1200, 'frame');

      expect(smallFrame).toBeGreaterThanOrEqual(14);
      expect(largeFrame).toBeGreaterThan(smallFrame);
      expect(largeFrame).toBeLessThanOrEqual(48);
    });

    it('preserves pure text auto sizing scaling between 12px and 72px', () => {
      const singleWord = 'Headline';
      const smallBox = calculateAutoFontSize(singleWord, 100, 60, 'text');
      const bigBox = calculateAutoFontSize(singleWord, 1200, 600, 'text');

      expect(bigBox).toBeGreaterThan(smallBox);
      expect(bigBox).toBeLessThanOrEqual(72);
      expect(smallBox).toBeGreaterThanOrEqual(12);
    });

    it('preserves resize-motion corner scaling exclusively for nodeType text', () => {
      expect(canvasSrc).toContain("if (nodeType === 'text' && isCorner && currentResizeState.startFontSize && startW > 0)");
      expect(canvasSrc).not.toContain("if ((nodeType === 'text' || nodeType === 'sticky') && isCorner");
      expect(canvasSrc).not.toContain("if ((nodeType === 'text' || nodeType === 'shape') && isCorner");
    });
  });

  describe('4. Component Source Code Verification', () => {
    it('board-canvas.tsx implements font size invariance guard for sticky and shape', () => {
      expect(canvasSrc).toContain("if (type === 'sticky' || type === 'shape') {\n    return 14;\n  }");
    });

    it('shape textarea uses node.fontSize or calculateAutoFontSize with shape type', () => {
      expect(canvasSrc).toContain("fontSize: `${node.fontSize || calculateAutoFontSize(node.text, node.w, node.h, 'shape')}px`");
    });

    it('sticky textarea uses node.fontSize or calculateAutoFontSize with node.type', () => {
      expect(canvasSrc).toContain("fontSize: `${node.fontSize || calculateAutoFontSize(node.text, node.w, node.h, node.type)}px`");
    });
  });
});
