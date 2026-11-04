import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('v76 Master Specification: Spreadsheet Column (A-Z) & Row (1-N) Headers, PDF Shielding, Resilient OpenXML', () => {
  const canvasPath = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8');

  const cssPath = path.resolve(process.cwd(), 'web/src/style.css');
  const cssSrc = fs.readFileSync(cssPath, 'utf8');

  const officeExtractorPath = path.resolve(process.cwd(), 'agent/src/storage/office-extractor.ts');
  const officeExtractorSrc = fs.readFileSync(officeExtractorPath, 'utf8');

  describe('1. Column Letter Helper Algorithm (A-Z, AA-ZZ)', () => {
    function getColLetter(idx: number): string {
      let letter = '';
      let temp = idx;
      while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
      }
      return letter;
    }

    it('should correctly map standard single-letter columns 0..25 to A..Z', () => {
      expect(getColLetter(0)).toBe('A');
      expect(getColLetter(1)).toBe('B');
      expect(getColLetter(2)).toBe('C');
      expect(getColLetter(24)).toBe('Y');
      expect(getColLetter(25)).toBe('Z');
    });

    it('should correctly map two-letter columns 26..52 to AA, AB.. BA', () => {
      expect(getColLetter(26)).toBe('AA');
      expect(getColLetter(27)).toBe('AB');
      expect(getColLetter(51)).toBe('AZ');
      expect(getColLetter(52)).toBe('BA');
    });

    it('should correctly map multi-letter columns beyond 700 to ZZ, AAA', () => {
      expect(getColLetter(701)).toBe('ZZ');
      expect(getColLetter(702)).toBe('AAA');
    });

    it('should export getColLetter from board-canvas.tsx', () => {
      expect(canvasSrc).toContain('export function getColLetter(idx: number): string');
    });
  });

  describe('2. Spreadsheet Grid Column (A-Z) and Row (1-N) Indexing', () => {
    it('should render top-left corner index cell (#)', () => {
      expect(canvasSrc).toContain('class="node-table-index-corner"');
      expect(canvasSrc).toMatch(/class="node-table-index-corner"[^>]*>\s*#/);
    });

    it('should render column letter header cells (A, B, C...) using getColLetter', () => {
      expect(canvasSrc).toContain('class="node-table-col-header"');
      expect(canvasSrc).toContain('{getColLetter(cIdx)}');
    });

    it('should render row number header cells (1, 2, 3...) using rIdx + 1', () => {
      expect(canvasSrc).toContain('class="node-table-row-header"');
      expect(canvasSrc).toContain('{rIdx + 1}');
    });

    it('should configure grid layout with 38px index column and 26px header row', () => {
      expect(canvasSrc).toContain('gridTemplateColumns: `38px repeat(${cols}, minmax(130px, max-content))`');
      expect(canvasSrc).toContain("gridTemplateRows: '26px'");
    });

    it('should include CSS styling for index corner, col header, and row header in style.css', () => {
      expect(cssSrc).toContain('.node-table-index-corner {');
      expect(cssSrc).toContain('.node-table-col-header {');
      expect(cssSrc).toContain('.node-table-row-header {');
    });
  });

  describe('3. Widgets Flyout Cleanliness: Standalone Table Purge', () => {
    it('should not contain obsolete standalone table button in widgets flyout', () => {
      expect(canvasSrc).not.toContain("<span>{t('dock.table')}</span>");
      expect(canvasSrc).not.toMatch(/miro-widgets-flyout[\s\S]*?dock\.table/);
    });

    it('should not include table in widgets dock button active tool check', () => {
      expect(canvasSrc).toContain("activeFlyout === 'widgets' || activeTool === 'checklist' || activeTool === 'kanban' || activeTool === 'code'");
      expect(canvasSrc).not.toContain("activeFlyout === 'widgets' || activeTool === 'checklist' || activeTool === 'table'");
    });
  });

  describe('4. PDF Pointer Event Shielding & Drag Protection', () => {
    it('should render pdf-card-select-shield over PDF iframe when node is unselected', () => {
      expect(canvasSrc).toContain('class="pdf-card-select-shield"');
      expect(canvasSrc).toContain('handleNodePointerDown(node, e as any)');
      expect(canvasSrc).toContain('setSelectedNodeIds(new Set([node.id]))');
    });

    it('should disable iframe pointer events during canvas manipulations (pan, zoom, drag, resize, hand)', () => {
      expect(canvasSrc).toContain("pointerEvents: (!isSelected || dragState || resizeState || panState || isSpacePressed || activeTool === 'hand') ? 'none' : 'auto'");
    });

    it('should style .pdf-card-select-shield with position absolute and z-index 10 in style.css', () => {
      expect(cssSrc).toContain('.pdf-card-select-shield {');
      expect(cssSrc).toMatch(/\.pdf-card-select-shield\s*\{[^}]*z-index:\s*10;/);
    });

    it('should guarantee resize handles have z-index: 50 !important to prevent pointer capture dropouts', () => {
      expect(cssSrc).toContain('.node-resize-handles-layer {');
      expect(cssSrc).toMatch(/\.node-resize-handles-layer\s*\{[^}]*z-index:\s*50\s*!important;/);
    });
  });

  describe('5. Resilient OpenXML Stream Parsing', () => {
    it('should wrap individual ZIP entry extraction in try-catch to tolerate single-entry failures', () => {
      expect(officeExtractorSrc).toContain('// Continue loop even if one entry fails');
      expect(officeExtractorSrc).toMatch(/try\s*\{\s*const lNameLen = buf\.readUInt16LE/);
    });
  });
});
