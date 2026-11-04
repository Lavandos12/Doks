import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('v75 Miro-Grade Tooling & Cleanup: Align Toolbar Purge, Inline Cell Editing, Documents Dock', () => {
  const canvasPath = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8');

  const cssPath = path.resolve(process.cwd(), 'web/src/style.css');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');

  const iconsPath = path.resolve(process.cwd(), 'web/src/components/Icons.tsx');
  const iconsSrc = fs.readFileSync(iconsPath, 'utf8');

  describe('1. Multi-Select Alignment Bar Purge', () => {
    it('should completely remove .align-toolbar from board-canvas.tsx JSX', () => {
      expect(canvasSrc).not.toContain('class="align-toolbar');
      expect(canvasSrc).not.toContain('className="align-toolbar');
      expect(canvasSrc).not.toContain('align-toolbar-btn');
    });

    it('should completely purge .align-toolbar rules from web/src/style.css', () => {
      expect(cssSrc).not.toMatch(/\.align-toolbar\s*\{/);
      expect(cssSrc).not.toMatch(/\.align-toolbar-btn\s*\{/);
      expect(cssSrc).not.toMatch(/\.align-toolbar-divider\s*\{/);
    });

    it('should have normalized context inspector top clearance to 88px', () => {
      expect(canvasSrc).toContain('const minTopClearance = 88;');
      expect(canvasSrc).not.toContain('const minTopClearance = selectedNodeIds.size > 1 ? 132 : 88;');
    });
  });

  describe('2. Redundant "Table Widget" Button Removal', () => {
    it('should remove "Table Widget" button from file card headers', () => {
      expect(canvasSrc).not.toContain('<span>Table Widget</span>');
      expect(canvasSrc).not.toContain('convertToTableWidget');
    });
  });

  describe('3. In-Place Excel Table Cell Editing', () => {
    it('should track in-place grid editing and active cell editing states', () => {
      expect(canvasSrc).toContain('const [isEditingGrid, setIsEditingGrid] = useState<Record<string, boolean>>({});');
      expect(canvasSrc).toContain('const [activeCellEdit, setActiveCellEdit] = useState<{ nodeId: string; sheetIdx: number; rowIdx: number; colIdx: number } | null>(null);');
    });

    it('should toggle in-place editing for spreadsheet cards rather than split-screen raw JSON note', () => {
      expect(canvasSrc).toContain('isSpreadsheetCard ? (');
      expect(canvasSrc).toContain("setIsEditingGrid((prev) => ({ ...prev, [node.id]: !prev[node.id] }));");
      expect(canvasSrc).toContain("isEditingGrid[node.id] ? 'Done' : t('notes.edit')");
    });

    it('should render input.excel-cell-input when cell is active or card is in edit mode', () => {
      expect(canvasSrc).toContain('class="excel-cell-input"');
      expect(canvasSrc).toContain('handleWorkbookCellChange(node.id, activeIdx, rIdx, cIdx,');
      expect(canvasSrc).toContain('setActiveCellEdit({ nodeId: node.id, sheetIdx: activeIdx, rowIdx: rIdx, colIdx: cIdx });');
    });

    it('should include handleWorkbookCellChange to persist cell changes to Y.Map without side effects', () => {
      expect(canvasSrc).toContain('const handleWorkbookCellChange = (nodeId: string, sheetIdx: number, rowIdx: number, colIdx: number, newVal: string) => {');
      expect(canvasSrc).toContain("map.set('extractedText', JSON.stringify(parsed));");
    });

    it('should include .excel-cell-input styling in style.css', () => {
      expect(cssSrc).toMatch(/\.excel-cell-input\s*\{[^}]*background:\s*rgba\(56,\s*189,\s*248/);
      expect(cssSrc).toMatch(/\.excel-cell-input:focus\s*\{/);
    });

    it('should provide active sheet CSV export action button', () => {
      expect(canvasSrc).toContain('title="Export active sheet as CSV"');
      expect(canvasSrc).toContain("link.download = `${sheet?.name || 'Sheet'}.csv`;");
    });
  });

  describe('4. Documents & Sheets Handling (Natural Import Pipeline)', () => {
    it('should include file-plus icon in Icons.tsx for asset representation', () => {
      expect(iconsSrc).toContain("'file-plus'");
      expect(iconsSrc).toContain("case 'file-plus':");
    });

    it('should support multi-sheet and document previews via native file import', () => {
      expect(canvasSrc).toContain('node.type === \'file\'');
      expect(canvasSrc).toContain('class="excel-workbook-container"');
      expect(canvasSrc).toContain('class="excel-sheet-tabs-bar"');
    });
  });
});
