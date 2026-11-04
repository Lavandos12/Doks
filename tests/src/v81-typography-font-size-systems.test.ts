import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('v81 Typography & Frame Font Size Systems', () => {
  const root = process.cwd();
  const canvasPath = path.join(root, 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');

  const cssPath = path.join(root, 'web/src/style.css');
  const cssSrc = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');

  describe('1. Frame Font Size Propagation', () => {
    it('should respect explicit node.fontSize for frame labels up to 96px', () => {
      expect(canvasSrc).toContain('const frameFontSize = node.fontSize || Math.min(Math.max(14, Math.round(Math.min(node.w, node.h) * 0.035)), 96);');
    });

    it('should apply frameFontSize to both frame label span and input elements', () => {
      expect(canvasSrc).toContain('class="frame-label-input"');
      expect(canvasSrc).toContain('style={{ fontSize: `${frameFontSize}px`, lineHeight: 1.2 }}');
      expect(canvasSrc).toContain('class="frame-label-text"');
      expect(canvasSrc).toContain("style={{ fontSize: `${frameFontSize}px`, lineHeight: 1.2, display: 'inline-block' }}");
    });

    it('should calculate auto responsive font size when type is frame', () => {
      expect(canvasSrc).toContain("if (type === 'frame') {\n    return Math.min(Math.max(14, Math.round(Math.min(w, h) * 0.035)), 48);\n  }");
    });
  });

  describe('2. Universal Typography Propagation', () => {
    it('should pass fontSize prop to NoteCardContent', () => {
      expect(canvasSrc).toContain('interface NoteCardContentProps {\n  noteId: string;\n  scope: WorkspaceScope;\n  fallbackTitle: string;\n  fontSize?: number;\n}');
      expect(canvasSrc).toContain('fontSize: fontSize ? `${fontSize}px` : undefined');
      expect(canvasSrc).toContain('fontSize={node.fontSize}');
    });

    it('should apply node.fontSize to code block editor textarea', () => {
      expect(canvasSrc).toContain('style={node.fontSize ? { fontSize: `${node.fontSize}px` } : undefined}');
    });
  });

  describe('3. CSS Styling for Scaled Typography', () => {
    it('should eliminate rigid 1rem override on .frame-label-text and .frame-label-input', () => {
      expect(cssSrc).not.toMatch(/\.frame-label-text\s*\{[^}]*font-size:\s*1rem/);
      expect(cssSrc).not.toMatch(/\.frame-label-input\s*\{[^}]*font-size:\s*1rem/);
    });

    it('should provide overflow ellipsis for frame labels', () => {
      expect(cssSrc).toContain('.frame-label-text {');
      expect(cssSrc).toContain('text-overflow: ellipsis;');
      expect(cssSrc).toContain('white-space: nowrap;');
    });
  });
});
