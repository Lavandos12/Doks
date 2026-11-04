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
 * Converts Excel column letters (e.g. "A", "B", "Z", "AA") to zero-based index.
 */
function colLetterToIndex(colStr: string): number {
  let index = 0;
  for (let i = 0; i < colStr.length; i++) {
    index = index * 26 + (colStr.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Extracts a 2D matrix (string[][]) from Excel .xlsx files and serializes as JSON.
 * Parses shared strings dictionary and worksheet cell values.
 */
export function extractTextFromXlsx(buf: Buffer): string {
  try {
    // 1. Scan for sharedStrings.xml
    const sharedStrings: string[] = [];
    const sstMatches = readZipEntry(buf, (name) => name.includes('sharedStrings.xml'));
    if (sstMatches.length > 0) {
      const sstXml = sstMatches[0];
      const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      let siMatch: RegExpExecArray | null;
      while ((siMatch = siRegex.exec(sstXml)) !== null) {
        const tMatches = siMatch[1].match(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
        const val = tMatches ? tMatches.map((t) => unescapeXml(t.replace(/<[^>]+>/g, ''))).join('') : '';
        sharedStrings.push(val);
      }
    }

    // 2. Scan sheet1.xml
    const sheetMatches = readZipEntry(
      buf,
      (name) => name.includes('sheet1.xml') || name.includes('worksheets/sheet')
    );
    if (sheetMatches.length > 0) {
      const sheetXml = sheetMatches[0];
      const rowRegex = /<row\b(?:[^>]*r="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch: RegExpExecArray | null;
      const rows: string[][] = [];

      while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowContent = rowMatch[2];
        const cellRegex = /<c\b(?:[^>]*r="([A-Z]+)\d+")?(?:[^>]*t="([a-z]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g;
        let cellMatch: RegExpExecArray | null;
        const rowCells: string[] = [];

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const type = cellMatch[2];
          let val = cellMatch[3] !== undefined ? cellMatch[3] : cellMatch[4] || '';
          if (type === 's') {
            const idx = parseInt(val, 10);
            val = !isNaN(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : val;
          } else if (type === 'b') {
            val = val === '1' ? 'TRUE' : 'FALSE';
          }
          rowCells.push(unescapeXml(val).trim());
        }
        if (rowCells.length > 0 && rowCells.some((c) => c.length > 0)) {
          rows.push(rowCells);
        }
      }

      if (rows.length > 0) {
        const maxCols = Math.max(...rows.map((r) => r.length), 1);
        const normalized = rows.map((r) => {
          const copy = [...r];
          while (copy.length < maxCols) copy.push('');
          return copy;
        });
        return JSON.stringify(normalized);
      }
    }
  } catch (err) {
    console.error('[OfficeExtractor] XLSX extraction error:', err);
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
