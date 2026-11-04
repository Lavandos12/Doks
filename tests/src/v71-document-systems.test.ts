import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanWordXmlToMarkdown,
  extractTextFromLegacyDocBuffer,
  extractTextFromDocxBuffer
} from '../../agent/src/storage/docx-extractor.js';
import {
  extractTextFromXlsx,
  parseCsvToGrid,
  extractMatrixFromCsv
} from '../../agent/src/storage/office-extractor.js';
import { en } from '../../web/src/i18n/en.js';

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

describe('v71 Document Systems: Word, Excel, CSV Extraction, PDF CSP & Canvas Hardening', () => {
  describe('1. Word OpenXML Semantic Markdown Parser', () => {
    it('correctly maps OpenXML headings (Heading1, Heading2, Heading3)', () => {
      const xml = `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
              <w:r><w:t>Main Architecture Overview</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
              <w:r><w:t>Component Breakdown</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr><w:pStyle w:val="Heading3"/></w:pPr>
              <w:r><w:t>Storage Engine</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>
      `;

      const md = cleanWordXmlToMarkdown(xml);
      expect(md).toContain('# Main Architecture Overview');
      expect(md).toContain('## Component Breakdown');
      expect(md).toContain('### Storage Engine');
    });

    it('correctly formats bold, italic, strikethrough, and bullet list items', () => {
      const xml = `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:r><w:t>This is a </w:t></w:r>
              <w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>
              <w:r><w:t> and </w:t></w:r>
              <w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
              <w:r><w:t> test.</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
              <w:r><w:t>Item A</w:t></w:r>
            </w:p>
            <w:p>
              <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
              <w:r><w:t>Item B</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>
      `;

      const md = cleanWordXmlToMarkdown(xml);
      expect(md).toContain('This is a **bold** and *italic* test.');
      expect(md).toContain('- Item A');
      expect(md).toContain('- Item B');
    });

    it('extracts OpenXML tables into clean Markdown tables with header separators', () => {
      const xml = `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:tbl>
              <w:tr>
                <w:tc><w:p><w:r><w:t>Module</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc>
              </w:tr>
              <w:tr>
                <w:tc><w:p><w:r><w:t>CRDT Engine</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>Ready</w:t></w:r></w:p></w:tc>
              </w:tr>
              <w:tr>
                <w:tc><w:p><w:r><w:t>PDF Viewer</w:t></w:r></w:p></w:tc>
                <w:tc><w:p><w:r><w:t>Verified</w:t></w:r></w:p></w:tc>
              </w:tr>
            </w:tbl>
          </w:body>
        </w:document>
      `;

      const md = cleanWordXmlToMarkdown(xml);
      expect(md).toContain('| Module | Status |');
      expect(md).toContain('| --- | --- |');
      expect(md).toContain('| CRDT Engine | Ready |');
      expect(md).toContain('| PDF Viewer | Verified |');
    });

    it('extracts real in-memory .docx zip package into clean Markdown', () => {
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p>
              <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
              <w:r><w:t>Document Header</w:t></w:r>
            </w:p>
            <w:p>
              <w:r><w:rPr><w:b/></w:rPr><w:t>First paragraph</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>
      `;

      const zipBuf = createZipBuffer([
        { name: 'word/document.xml', content: documentXml }
      ]);

      const md = extractTextFromDocxBuffer(zipBuf);
      expect(md).toContain('# Document Header');
      expect(md).toContain('**First paragraph**');
    });
  });

  describe('2. Legacy Word 97-2003 OLE2 (.doc) Scanner', () => {
    it('extracts text from legacy binary Word 97-2003 OLE2 (.doc) buffer', () => {
      const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const text = 'Project specifications and release checklist for Doks production.';
      const utf16Buf = Buffer.from(text, 'utf16le');
      const docBuffer = Buffer.concat([ole2Header, Buffer.alloc(512), utf16Buf, Buffer.alloc(256)]);

      const extracted = extractTextFromDocxBuffer(docBuffer);
      expect(extracted).toContain('Project specifications and release checklist');
    });
  });

  describe('3. Excel (.xlsx) & CSV Matrix Extraction', () => {
    it('extracts Excel .xlsx sharedStrings and worksheet into a 2D JSON grid', () => {
      const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
          <si><t>Item Name</t></si>
          <si><t>Price</t></si>
          <si><t>Widget Alpha</t></si>
          <si><t>Widget Beta</t></si>
        </sst>
      `;

      const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1">
              <c r="A1" t="s"><v>0</v></c>
              <c r="B1" t="s"><v>1</v></c>
            </row>
            <row r="2">
              <c r="A2" t="s"><v>2</v></c>
              <c r="B2"><v>19.99</v></c>
            </row>
            <row r="3">
              <c r="A3" t="s"><v>3</v></c>
              <c r="B3"><v>49.50</v></c>
            </row>
          </sheetData>
        </worksheet>
      `;

      const zipBuf = createZipBuffer([
        { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const json = extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(json);
      const grid = Array.isArray(parsed) ? parsed : parsed.sheets[0].data;
      expect(Array.isArray(grid)).toBe(true);
      expect(grid.length).toBe(3);
      expect(grid[0]).toEqual(['Item Name', 'Price']);
      expect(grid[1]).toEqual(['Widget Alpha', '19.99']);
      expect(grid[2]).toEqual(['Widget Beta', '49.50']);
    });

    it('parses CSV with commas, semicolons, and quoted values into normalized grid', () => {
      const csvComma = `Name,Role,Status\nAlice,"Lead Engineer",Active\nBob,Architect,"In Review"`;
      const gridComma = parseCsvToGrid(csvComma);
      expect(gridComma.length).toBe(3);
      expect(gridComma[0]).toEqual(['Name', 'Role', 'Status']);
      expect(gridComma[1]).toEqual(['Alice', 'Lead Engineer', 'Active']);
      expect(gridComma[2]).toEqual(['Bob', 'Architect', 'In Review']);

      const csvSemi = `Product;Category;Count\nLaptop;Hardware;15\nMonitor;Displays;30`;
      const gridSemi = parseCsvToGrid(csvSemi);
      expect(gridSemi[0]).toEqual(['Product', 'Category', 'Count']);
      expect(gridSemi[1]).toEqual(['Laptop', 'Hardware', '15']);

      const matrixJson = extractMatrixFromCsv(Buffer.from(csvComma, 'utf8'));
      const parsed = JSON.parse(matrixJson);
      expect(parsed[0]).toEqual(['Name', 'Role', 'Status']);
    });
  });

  describe('4. Server Content Security Policy & Client UI Specifications', () => {
    it('verifies server CSP configuration includes frame-src and object-src for PDF embedding', () => {
      const serverCode = fs.readFileSync(path.resolve('agent/src/server/http-server.ts'), 'utf8');
      
      // Global onSend hook must allow frame-src and object-src
      expect(serverCode).toContain("frame-src 'self' blob: data:;");
      expect(serverCode).toContain("object-src 'self' blob: data:;");

      // /api/attachments/:hash route must permit PDF iframe embedding
      expect(serverCode).toContain("att.mimeType === 'application/pdf'");
      expect(serverCode).toContain("default-src 'self' blob: data:; frame-src 'self' blob: data:; object-src 'self' blob: data:; style-src 'self' 'unsafe-inline';");
    });

    it('verifies localization key common.download exists and equals Download', () => {
      expect((en as any)['common.download']).toBe('Download');
    });

    it('verifies canvas upload handler converts spreadsheet to Table widget with proper dimensions', () => {
      const canvasCode = fs.readFileSync(path.resolve('web/src/components/board/board-canvas.tsx'), 'utf8');
      
      // Must detect spreadsheets and instantiate type: 'table'
      expect(canvasCode).toContain("type: 'table'");
      expect(canvasCode).toContain("w: tableW");
      expect(canvasCode).toContain("h: tableH");
      expect(canvasCode).toContain("Math.max(340, cols * 130)");
      expect(canvasCode).toContain("Math.max(180, 50 + rows * 38)");

      // Word and PDF initial dimensions must be 420x540
      expect(canvasCode).toContain("w = 420;");
      expect(canvasCode).toContain("h = 540;");

      // PDF iframe must not have sandbox attribute and should have full dimension style
      expect(canvasCode).not.toContain('sandbox="allow-scripts allow-same-origin"');
      expect(canvasCode).toContain("class=\"node-file-pdf-iframe\"");
      expect(canvasCode).toContain("width: '100%'");
      expect(canvasCode).toContain("height: '100%'");
      expect(canvasCode).toContain("background: '#ffffff'");
    });

    it('verifies nested board-boundary is completely purged and fitToContent applies 15% margins', () => {
      const canvasCode = fs.readFileSync(path.resolve('web/src/components/board/board-canvas.tsx'), 'utf8');
      
      // board-boundary element must not exist in transform layer
      expect(canvasCode).not.toContain('class="board-boundary"');
      expect(canvasCode).not.toContain("className=\"board-boundary\"");

      // fitToContent must use 15% viewport padding
      expect(canvasCode).toContain("paddingX = Math.max(96, availW * 0.15)");
      expect(canvasCode).toContain("paddingY = Math.max(96, availH * 0.15)");
    });

    it('verifies pie chart renders collision-free staggered callout lines for narrow slices', () => {
      const canvasCode = fs.readFileSync(path.resolve('web/src/components/board/board-canvas.tsx'), 'utf8');
      
      // SVG viewBox must be 250x250 with cx=125, cy=125, r=70
      expect(canvasCode).toContain('viewBox="0 0 250 250"');
      expect(canvasCode).toContain('const cx = 125;');
      expect(canvasCode).toContain('const cy = 125;');
      expect(canvasCode).toContain('const r = 70;');

      // Staggered counter alternating radius
      expect(canvasCode).toContain('const isStaggered = smallSliceCounter % 2 === 1;');
      expect(canvasCode).toContain('const calloutR = isStaggered ? (r + 26) : (r + 14);');
      expect(canvasCode).toContain('const textR = isStaggered ? (r + 34) : (r + 21);');
      expect(canvasCode).toContain('<circle cx={edgeX.toFixed(1)} cy={edgeY.toFixed(1)} r="1.5" fill="#ffffff" />');
    });
  });
});
