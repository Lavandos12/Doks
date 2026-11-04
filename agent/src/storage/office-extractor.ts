import zlib from 'node:zlib';
import {
  cleanWordXmlToMarkdown,
  extractTextFromDocxBuffer,
  extractTextFromLegacyDocBuffer
} from './docx-extractor.js';

export { cleanWordXmlToMarkdown, extractTextFromDocxBuffer, extractTextFromLegacyDocBuffer };

/**
 * Unescapes standard XML entities.
 */
function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

/**
 * Universal zero-dependency ZIP reader for OpenXML (.docx, .xlsx, .pptx)
 * and OpenDocument (.odt, .ods, .odp) containers.
 */
function readZipEntry(buf: Buffer, matcher: (filename: string) => boolean): string[] {
  const results: string[] = [];
  try {
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return results;

    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const cdEntries = buf.readUInt16LE(eocdOffset + 10);
    let ptr = cdOffset;

    for (let e = 0; e < cdEntries && ptr + 46 <= buf.length; e++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);
      const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

      if (matcher(name) && localHeaderOffset + 30 <= buf.length) {
        const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
        const slice = buf.subarray(dataStart, dataStart + compSize);
        const raw =
          method === 8
            ? zlib.inflateRawSync(slice, { maxOutputLength: 20 * 1024 * 1024 })
            : slice;
        results.push(raw.toString('utf8'));
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  } catch {}
  return results;
}

export function extractTextFromDocx(buf: Buffer): string {
  return extractTextFromDocxBuffer(buf);
}

export function extractTextFromOdf(buf: Buffer): string {
  const xmls = readZipEntry(buf, (name) => name === 'content.xml');
  return xmls.length > 0 ? cleanXmlText(xmls[0]) : '';
}

/**
 * Zero-dependency ZIP directory parser mapping filenames to inflated XML strings.
 */
function readZipEntriesMap(buf: Buffer, matcher: (filename: string) => boolean): Map<string, string> {
  const map = new Map<string, string>();
  try {
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return map;

    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const cdEntries = buf.readUInt16LE(eocdOffset + 10);
    let ptr = cdOffset;

    for (let e = 0; e < cdEntries && ptr + 46 <= buf.length; e++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);
      const rawName = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
      const name = rawName.replace(/\\/g, '/');

      if (matcher(name) && localHeaderOffset + 30 <= buf.length) {
        try {
          const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
          const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
          const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
          const slice = buf.subarray(dataStart, dataStart + compSize);
          const raw =
            method === 8
              ? zlib.inflateRawSync(slice, { maxOutputLength: 20 * 1024 * 1024 })
              : slice;
          map.set(name, raw.toString('utf8'));
        } catch {
          // Continue loop even if one entry fails
        }
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  } catch (err) {
    console.error('[OfficeExtractor] ZIP read error:', err);
  }
  return map;
}

/**
 * Converts Excel column letters (e.g. "A", "B", "Z", "AA") to zero-based index.
 */
function colLetterToIndex(colStr: string): number {
  let idx = 0;
  const upper = (colStr || 'A').toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    idx = idx * 26 + (upper.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Extracts all worksheets with their exact human-readable names and column-aligned
 * cells from Excel .xlsx files and serializes as a multi-sheet workbook JSON payload.
 */
export function extractTextFromXlsx(buf: Buffer): string {
  try {
    const entries = readZipEntriesMap(buf, (name) =>
      name.includes('workbook.xml') ||
      name.includes('sharedStrings.xml') ||
      name.includes('worksheets/sheet')
    );

    // 1. Parse sharedStrings dictionary
    const sharedStrings: string[] = [];
    let sstXml: string | undefined;
    for (const [key, val] of entries) {
      if (key.includes('sharedStrings.xml')) {
        sstXml = val;
        break;
      }
    }
    if (sstXml) {
      const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      let siMatch: RegExpExecArray | null;
      while ((siMatch = siRegex.exec(sstXml)) !== null) {
        const tMatches = siMatch[1].match(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
        const val = tMatches ? tMatches.map((t) => unescapeXml(t.replace(/<[^>]+>/g, ''))).join('') : '';
        sharedStrings.push(val);
      }
    }

    // 2. Parse workbook relationships (rId -> sheet path)
    const relMap: Record<string, string> = {};
    let relsXml: string | undefined;
    for (const [key, val] of entries) {
      if (key.includes('workbook.xml.rels')) {
        relsXml = val;
        break;
      }
    }
    if (relsXml) {
      const relRegex = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = relRegex.exec(relsXml)) !== null) {
        relMap[rMatch[1]] = rMatch[2].replace(/\\/g, '/');
      }
    }

    // 3. Parse sheets list from workbook.xml
    let workbookXml: string | undefined;
    for (const [key, val] of entries) {
      if (key.endsWith('workbook.xml') && !key.includes('.rels')) {
        workbookXml = val;
        break;
      }
    }
    const sheetsMeta: { name: string; target: string }[] = [];
    if (workbookXml) {
      const sheetRegex = /<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"[^>]*(?:r:id="([^"]+)")?/g;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = sheetRegex.exec(workbookXml)) !== null) {
        const name = unescapeXml(sMatch[1]);
        const sheetId = sMatch[2];
        const rId = sMatch[3];
        let target = rId && relMap[rId] ? relMap[rId] : `worksheets/sheet${sheetId}.xml`;
        if (target.startsWith('/')) target = target.slice(1);
        if (!target.startsWith('xl/')) target = `xl/${target}`;
        sheetsMeta.push({ name, target });
      }
    }

    // Fallback: if workbook.xml is absent, scan all sheet entries directly
    if (sheetsMeta.length === 0) {
      for (const key of entries.keys()) {
        if (key.includes('worksheets/sheet')) {
          const matchNum = key.match(/sheet(\d+)\.xml/);
          const baseName = matchNum ? `Sheet ${matchNum[1]}` : 'Sheet 1';
          sheetsMeta.push({ name: baseName, target: key });
        }
      }
    }

    // 4. Parse each worksheet into row/col matrix
    const workbookResult: { name: string; data: string[][] }[] = [];

    for (const meta of sheetsMeta) {
      let sheetXml = entries.get(meta.target);
      if (!sheetXml) {
        for (const [key, val] of entries) {
          if (key === meta.target || key.endsWith(meta.target.replace(/^xl\//, ''))) {
            sheetXml = val;
            break;
          }
        }
      }
      if (!sheetXml) continue;

      const rows: string[][] = [];
      const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch: RegExpExecArray | null;

      while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowContent = rowMatch[1];
        const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch: RegExpExecArray | null;
        const cellMap: Record<number, string> = {};
        let maxCol = 0;
        let seqCol = 0;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const attrs = cellMatch[1];
          const inner = cellMatch[2];

          const rMatch = attrs.match(/\br="([A-Za-z]+)\d+"/);
          const tMatch = attrs.match(/\bt="([a-z]+)"/i);
          const type = tMatch ? tMatch[1].toLowerCase() : '';

          const cIdx = rMatch ? colLetterToIndex(rMatch[1]) : seqCol++;
          maxCol = Math.max(maxCol, cIdx + 1);

          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);

          let textVal = vMatch ? vMatch[1] : (isMatch ? isMatch[1] : '');
          if (type === 's') {
            const sIdx = parseInt(textVal, 10);
            textVal = (!isNaN(sIdx) && sharedStrings[sIdx] !== undefined) ? sharedStrings[sIdx] : textVal;
          } else if (type === 'b') {
            textVal = textVal === '1' ? 'TRUE' : 'FALSE';
          }
          cellMap[cIdx] = unescapeXml(textVal).trim();
        }

        const alignedRow: string[] = [];
        for (let c = 0; c < maxCol; c++) {
          alignedRow.push(cellMap[c] || '');
        }
        if (alignedRow.some((val) => val.length > 0)) {
          rows.push(alignedRow);
        }
      }

      // Pad rows to match column width
      if (rows.length > 0) {
        const maxWidth = Math.max(...rows.map((r) => r.length));
        for (const r of rows) {
          while (r.length < maxWidth) r.push('');
        }
        workbookResult.push({ name: meta.name, data: rows });
      }
    }

    if (workbookResult.length > 0) {
      return JSON.stringify({ type: 'workbook', sheets: workbookResult });
    }
  } catch (err) {
    console.error('[OfficeExtractor] XLSX workbook extraction failed:', err);
  }
  return '';
}

/**
 * Universal CSV parser supporting comma, semicolon, and tab delimiters,
 * quoted fields, and escaped quotes ("").
 */
export function parseCsvToGrid(csvText: string): string[][] {
  const lines: string[][] = [];
  const clean = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.trim()) return [];

  const firstLine = clean.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  let delimiter = ',';
  if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(current.trim());
        current = '';
      } else if (char === '\n') {
        row.push(current.trim());
        if (row.some((c) => c.length > 0)) {
          lines.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }
    i++;
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.some((c) => c.length > 0)) {
      lines.push(row);
    }
  }

  if (lines.length === 0) return [];

  const maxRows = Math.min(lines.length, 100);
  const trimmed = lines.slice(0, maxRows);
  const maxCols = Math.min(Math.max(...trimmed.map((r) => r.length), 1), 50);

  return trimmed.map((r) => {
    const res = [...r.slice(0, maxCols)];
    while (res.length < maxCols) res.push('');
    return res;
  });
}

export function extractMatrixFromCsv(buf: Buffer): string {
  const grid = parseCsvToGrid(buf.toString('utf8'));
  if (grid.length === 0) {
    return JSON.stringify([['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']]);
  }
  return JSON.stringify(grid);
}

export function extractTextFromPptx(buf: Buffer): string {
  const slideXmls = readZipEntry(buf, (name) => name.startsWith('ppt/slides/slide'));
  return slideXmls.map((xml, idx) => `[Slide ${idx + 1}]\n${cleanXmlText(xml)}`).join('\n\n');
}

export function extractTextFromRtf(buf: Buffer): string {
  const str = buf.toString('utf8');
  return str
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\[a-z0-9\-]+\b/gi, '')
    .replace(/[{}]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function cleanXmlText(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/text:p>|<\/a:p>/g, '\n\n')
    .replace(/<w:br[^>]*\/>|<text:line-break\/>/g, '\n')
    .replace(/<w:tab[^>]*\/>|<text:tab\/>/g, '\t')
    .replace(/<\/w:tc>|<\/table:table-cell>/g, ' | ')
    .replace(/<\/w:tr>|<\/table:table-row>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
