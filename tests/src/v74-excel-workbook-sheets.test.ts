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

describe('v74 Multi-Sheet Excel Workbook Parsing & Interactive Tab Switcher', () => {
  describe('1. Multi-Sheet Extraction & Sheet Name Mapping', () => {
    it('should parse 4 sheets with exact names (Обзор, День А, День B, День C)', () => {
      const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

      const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Обзор" sheetId="1" r:id="rId1"/>
    <sheet name="День А" sheetId="2" r:id="rId2"/>
    <sheet name="День B" sheetId="3" r:id="rId3"/>
    <sheet name="День C" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>`;

      const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10">
  <si><t>Программа тренировок</t></si>
  <si><t>Неделя 1-4</t></si>
  <si><t>№</t></si>
  <si><t>Упражнение</t></si>
  <si><t>Хват и детали</t></si>
  <si><t>Подходы</t></si>
  <si><t>Повторы</t></si>
  <si><t>Подтягивания на перекладине</t></si>
  <si><r><t>Средний хват &amp; </t></r><r><t>полная амплитуда</t></r></si>
  <si><t>Жим штанги лежа</t></si>
</sst>`;

      const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  </sheetData>
</worksheet>`;

      const sheet2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>9</v></c></row>
  </sheetData>
</worksheet>`;

      const sheet3Xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>3</v></c></row>
  </sheetData>
</worksheet>`;

      const sheet4Xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>2</v></c>
      <c r="B1" t="s"><v>3</v></c>
      <c r="C1" t="s"><v>4</v></c>
      <c r="D1" t="s"><v>5</v></c>
      <c r="E1" t="s"><v>6</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>1</v></c>
      <c r="B2" t="s"><v>7</v></c>
      <c r="C2" t="s"><v>8</v></c>
      <c r="D2"><v>4</v></c>
      <c r="E2"><v>10</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/_rels/workbook.xml.rels', content: relsXml },
        { name: 'xl/workbook.xml', content: workbookXml },
        { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
        { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml },
        { name: 'xl/worksheets/sheet3.xml', content: sheet3Xml },
        { name: 'xl/worksheets/sheet4.xml', content: sheet4Xml }
      ]);

      const jsonStr = extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.type).toBe('workbook');
      expect(parsed.sheets.length).toBe(4);
      expect(parsed.sheets.map((s: any) => s.name)).toEqual(['Обзор', 'День А', 'День B', 'День C']);

      // Verify День C (sheet 4) contains full training table columns
      const dayC = parsed.sheets[3];
      expect(dayC.name).toBe('День C');
      expect(dayC.data[0]).toEqual(['№', 'Упражнение', 'Хват и детали', 'Подходы', 'Повторы']);
      expect(dayC.data[1]).toEqual([
        '1',
        'Подтягивания на перекладине',
        'Средний хват & полная амплитуда',
        '4',
        '10'
      ]);
    });
  });

  describe('2. Column Alignment & Preventing Horizontal Shifts', () => {
    it('should align cells to exact column letter indices even when intermediate cells are missing', () => {
      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>100</v></c>
      <c r="C1"><v>300</v></c>
      <c r="E1"><v>500</v></c>
    </row>
    <row r="2">
      <c r="B2"><v>200</v></c>
      <c r="D2"><v>400</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const jsonStr = extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(jsonStr);
      const grid = parsed.sheets[0].data;

      // Row 1: A=100, B='', C=300, D='', E=500
      expect(grid[0]).toEqual(['100', '', '300', '', '500']);

      // Row 2: A='', B=200, C='', D=400, E=''
      expect(grid[1]).toEqual(['', '200', '', '400', '']);
    });
  });

  describe('3. Multi-Run Shared Strings and Unescaping', () => {
    it('should unescape XML entities and concatenate multiple <r><t> runs', () => {
      const sstXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si>
    <r><t>Подтягивания </t></r>
    <r><rPr><b/></rPr><t>средним хватом &amp; угол &lt;90&gt;</t></r>
  </si>
</sst>`;

      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
  </sheetData>
</worksheet>`;

      const zipBuf = createZipBuffer([
        { name: 'xl/sharedStrings.xml', content: sstXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
      ]);

      const jsonStr = extractTextFromXlsx(zipBuf);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.sheets[0].data[0][0]).toBe('Подтягивания средним хватом & угол <90>');
    });
  });

  describe('4. Interactive Sheet Switcher UI in Canvas', () => {
    const canvasFile = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
    const canvasSrc = fs.readFileSync(canvasFile, 'utf8');

    it('should track active sheet index in workbookSheetMap state', () => {
      expect(canvasSrc).toContain('const [workbookSheetMap, setWorkbookSheetMap] = useState<Record<string, number>>({});');
    });

    it('should render excel-workbook-container with excel-grid-scroll-area and tabs bar', () => {
      expect(canvasSrc).toContain('class="excel-workbook-container"');
      expect(canvasSrc).toContain('class="excel-grid-scroll-area"');
      expect(canvasSrc).toContain('class="excel-sheet-tabs-bar"');
      expect(canvasSrc).toContain('class={`excel-sheet-tab-btn ${activeIdx === sIdx ? \'active\' : \'\'}`}');
    });

    it('should render non-truncated cell grid with minmax(130px, max-content) and nowrap', () => {
      expect(canvasSrc).toContain('minmax(130px, max-content)');
      expect(canvasSrc).toContain("whiteSpace: 'nowrap'");
      expect(canvasSrc).toContain('setWorkbookSheetMap((prev) => ({ ...prev, [node.id]: sIdx }))');
    });

    it('should set initial Excel card dimensions to 640x480 for multi-column visibility', () => {
      expect(canvasSrc).toMatch(/else if \(\/\\.\(xlsx\?\|xls\|ods\)\$\/i\.test\(fileName\)\) \{\s*w = 640;\s*h = 480;/);
    });
  });
});
