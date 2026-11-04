import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('v77 Purge Manual Document Creation: Natural Whiteboard Import Pipeline', () => {
  const canvasPath = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8');

  describe('1. Dock Tool & Flyout Purge', () => {
    it('should not contain data-tool="docs" in board-canvas.tsx dock', () => {
      expect(canvasSrc).not.toContain('data-tool="docs"');
      expect(canvasSrc).not.toContain('title="Documents & Sheets (D)"');
    });

    it('should not contain docs in activeFlyout union state', () => {
      expect(canvasSrc).toContain("const [activeFlyout, setActiveFlyout] = useState<'none' | 'sticky' | 'shape' | 'arrow' | 'draw' | 'widgets'>('none');");
      expect(canvasSrc).not.toContain("'docs'");
    });

    it('should not bind KeyD to toggle docs flyout', () => {
      expect(canvasSrc).not.toContain("if (e.code === 'KeyD')");
    });

    it('should not render artificial New Spreadsheet, New Document, or New Page buttons in dock', () => {
      expect(canvasSrc).not.toContain('<span>New Spreadsheet (Excel)</span>');
      expect(canvasSrc).not.toContain('<span>New Document (Word)</span>');
      expect(canvasSrc).not.toContain('<span>New Page (PDF A4)</span>');
    });
  });

  describe('2. Synthetic Creation Helpers Removal', () => {
    it('should not define createNewCanvasSpreadsheet, createNewCanvasDoc, or createNewCanvasPdfPage', () => {
      expect(canvasSrc).not.toContain('const createNewCanvasSpreadsheet =');
      expect(canvasSrc).not.toContain('const createNewCanvasDoc =');
      expect(canvasSrc).not.toContain('const createNewCanvasPdfPage =');
    });
  });

  describe('3. Natural File Import & Rendering Engine Preserved', () => {
    it('should maintain type file card and document rendering for imported files', () => {
      expect(canvasSrc).toContain("(node.type === 'file' || Boolean(node.fileHash)) ? (");
      expect(canvasSrc).toContain('class="node-file-wrapper miro-document-card"');
      expect(canvasSrc).toContain('class="excel-workbook-container"');
    });

    it('should retain column letter and row number headers for spreadsheets', () => {
      expect(canvasSrc).toContain('class="node-table-index-corner"');
      expect(canvasSrc).toContain('class="node-table-col-header"');
      expect(canvasSrc).toContain('class="node-table-row-header"');
    });
  });
});
