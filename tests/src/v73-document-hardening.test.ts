import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromXlsx } from '../../agent/src/storage/office-extractor.js';

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(entries: { name: string; content: string }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.content, 'utf8');
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // method 0 (stored)
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localHeaders.push(lh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    cdHeaders.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }

  const cdStart = offset;
  const cdData = Buffer.concat(cdHeaders);
  const cdSize = cdData.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdData, eocd]);
}

describe('v73 Production Hardening: Document Shields, XLSX Stream Scanner, and Canvas Performance', () => {
  describe('1. Robust XLSX Stream Scanner & OpenXML Parsing', () => {
    it('should parse standard OpenXML with shared strings and row coordinates', async () => {
      const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>Item</t></si>
  <si><t>Status &amp; Progress</t></si>
  <si><t>Alpha &lt;v1&gt;</t></si>
</sst>`;

      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>100</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const result = await extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(result);
      const grid = Array.isArray(parsed) ? parsed : parsed.sheets[0].data;

      expect(grid).toEqual([
        ['Item', 'Status & Progress'],
        ['Alpha <v1>', '100']
      ]);
    });

    it('should parse OpenXML without row coordinate attributes and with inline strings', async () => {
      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row>
      <c t="inlineStr"><is><t>Sprint 1</t></is></c>
      <c><v>42</v></c>
    </row>
    <row>
      <c t="inlineStr"><is><t>Sprint 2</t></is></c>
      <c><v>84</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const result = await extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(result);
      const grid = Array.isArray(parsed) ? parsed : parsed.sheets[0].data;

      expect(grid).toEqual([
        ['Sprint 1', '42'],
        ['Sprint 2', '84']
      ]);
    });

    it('should normalize ragged rows to match the maximum column count', async () => {
      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>1</v></c>
      <c r="B1"><v>2</v></c>
      <c r="C1"><v>3</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>4</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const result = await extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(result);
      const grid = Array.isArray(parsed) ? parsed : parsed.sheets[0].data;

      expect(grid).toEqual([
        ['1', '2', '3'],
        ['4', '', '']
      ]);
    });

    it('should return empty string "" on invalid or empty ZIP buffer without throwing', async () => {
      const emptyZip = Buffer.from('Not a valid zip buffer at all');
      const result = await extractTextFromXlsx(emptyZip);
      expect(result).toBe('');
    });
  });

  describe('2. Document Card Selection Shields and Event Isolation', () => {
    const canvasFile = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
    const canvasSrc = fs.readFileSync(canvasFile, 'utf8');

    it('should render transparent selection shield on unselected document cards', () => {
      expect(canvasSrc).toContain('class="document-click-shield"');
      expect(canvasSrc).toContain("cursor: 'move'");
      expect(canvasSrc).toContain('setSelectedNodeIds(new Set([node.id]))');
    });

    it('should disable pointer events on PDF iframes during canvas manipulation', () => {
      expect(canvasSrc).toContain("pointerEvents: (!isSelected || dragState || resizeState || panState || isSpacePressed || activeTool === 'hand') ? 'none' : 'auto'");
    });

    it('should set resize handles layer z-index to 50 !important in style.css', () => {
      const cssFile = path.resolve(process.cwd(), 'web/src/style.css');
      const cssSrc = fs.readFileSync(cssFile, 'utf8');
      expect(cssSrc).toMatch(/\.node-resize-handles-layer\s*\{[^}]*z-index:\s*50\s*!important;/);
    });
  });

  describe('3. Canvas Viewport Kinematics & Listener Deduplication', () => {
    const canvasFile = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
    const canvasSrc = fs.readFileSync(canvasFile, 'utf8');
    const cssFile = path.resolve(process.cwd(), 'web/src/style.css');
    const cssSrc = fs.readFileSync(cssFile, 'utf8');

    it('should promote board transform layer with GPU composite isolation properties', () => {
      expect(cssSrc).toMatch(/\.board-transform-layer\s*\{[^}]*will-change:\s*transform;/);
      expect(cssSrc).toMatch(/\.board-transform-layer\s*\{[^}]*transform-style:\s*flat;/);
      expect(cssSrc).toMatch(/\.board-transform-layer\s*\{[^}]*backface-visibility:\s*hidden;/);
    });

    it('should register strictly pointermove and pointerup in global window listeners (no mousemove/mouseup)', () => {
      const pointerEffectMatch = canvasSrc.match(/window\.addEventListener\('pointermove'[\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?window\.removeEventListener\('pointerup'/);
      expect(pointerEffectMatch).not.toBeNull();

      // Ensure no window.addEventListener('mousemove' or 'mouseup') in board-canvas
      expect(canvasSrc).not.toContain("window.addEventListener('mousemove'");
      expect(canvasSrc).not.toContain("window.addEventListener('mouseup'");
    });

    it('should decouple global pointer event effect with empty dependency array', () => {
      expect(canvasSrc).toMatch(/window\.removeEventListener\('pointerup',\s*handleGlobalPointerUp\);[\s\S]*?\}, \[\]\);/);
    });

    it('should synchronize live state using refs for zero-thrash pointer event processing', () => {
      expect(canvasSrc).toContain('const viewportRef = useRef(viewport);');
      expect(canvasSrc).toContain('const panStateRef = useRef(panState);');
      expect(canvasSrc).toContain('const dragStateRef = useRef(dragState);');
      expect(canvasSrc).toContain('const resizeStateRef = useRef(resizeState);');
      expect(canvasSrc).toContain('const marqueeBoxRef = useRef(marqueeBox);');
      expect(canvasSrc).toContain('const nodesListRef = useRef(nodesList);');
      expect(canvasSrc).toContain('const visibleNodesRef = useRef');
      expect(canvasSrc).toContain('const selectedNodeIdsRef = useRef(selectedNodeIds);');
      expect(canvasSrc).toContain('const nodeLookupRef = useRef(nodeLookup);');
    });
  });

  describe('4. Spreadsheet Node Auto-Conversion on Canvas', () => {
    const canvasFile = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
    const canvasSrc = fs.readFileSync(canvasFile, 'utf8');

    it('should support spreadsheets in document polling regex', () => {
      expect(canvasSrc).toContain('/\\.(docx?|xlsx?|txt|md|csv|tsv|json|js|ts|py|html|css|pdf|rtf|odt|ods)$/i');
    });

    it('should auto-convert spreadsheet node to table widget on receiving JSON grid', () => {
      expect(canvasSrc).toContain("const isSpreadsheet = (node.fileName || '').match(/\\.(xlsx?|csv|tsv|ods)$/i);");
      expect(canvasSrc).toContain("map.set('type', 'table');");
      expect(canvasSrc).toContain("map.set('text', data.extractedText);");
    });
  });
});
