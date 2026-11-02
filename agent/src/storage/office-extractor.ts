import zlib from 'node:zlib';

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
        const raw = method === 8 ? zlib.inflateRawSync(slice, { maxOutputLength: 20 * 1024 * 1024 }) : slice;
        results.push(raw.toString('utf8'));
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  } catch {}
  return results;
}

export function extractTextFromDocx(buf: Buffer): string {
  const xmls = readZipEntry(buf, (name) => name === 'word/document.xml');
  return xmls.length > 0 ? cleanXmlText(xmls[0]) : '';
}

export function extractTextFromOdf(buf: Buffer): string {
  const xmls = readZipEntry(buf, (name) => name === 'content.xml');
  return xmls.length > 0 ? cleanXmlText(xmls[0]) : '';
}

export function extractTextFromXlsx(buf: Buffer): string {
  // Extract shared strings dictionary and worksheet values
  const sharedXmls = readZipEntry(buf, (name) => name === 'xl/sharedStrings.xml');
  const sheetXmls = readZipEntry(buf, (name) => name.startsWith('xl/worksheets/sheet'));
  const combined = [...sharedXmls, ...sheetXmls].join('\n');
  return cleanXmlText(combined);
}

export function extractTextFromPptx(buf: Buffer): string {
  // Extract all slide XML files
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

export const extractTextFromDocxBuffer = extractTextFromDocx;
