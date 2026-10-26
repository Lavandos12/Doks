import zlib from 'node:zlib';

/**
 * Universal .docx XML text extractor that handles both standard ZIP headers
 * AND Microsoft Word's Bit-3 Data Descriptor streaming ZIP headers (where compressedSize === 0 in local header).
 * Zero external dependencies required.
 */
export function extractTextFromDocxBuffer(buf: Buffer): string {
  try {
    // 1. Parse Central Directory at the end of the ZIP to get exact sizes & offsets
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset !== -1) {
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

        if (name === 'word/document.xml' && localHeaderOffset + 30 <= buf.length) {
          const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
          const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
          const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
          const slice = buf.subarray(dataStart, dataStart + compSize);
          const xmlBuf = method === 8 ? zlib.inflateRawSync(slice) : slice;
          return cleanWordXmlToText(xmlBuf.toString('utf8'));
        }

        ptr += 46 + nameLen + extraLen + commentLen;
      }
    }

    // 2. Fallback: scan directly for local header "word/document.xml" and inflate stream
    const marker = Buffer.from('word/document.xml', 'utf8');
    const idx = buf.indexOf(marker);
    if (idx >= 30) {
      const headerOffset = idx - 30;
      const method = buf.readUInt16LE(headerOffset + 8);
      const nameLen = buf.readUInt16LE(headerOffset + 26);
      const extraLen = buf.readUInt16LE(headerOffset + 28);
      const dataStart = headerOffset + 30 + nameLen + extraLen;
      const rawSlice = buf.subarray(dataStart);
      const xmlBuf = method === 8 ? zlib.inflateRawSync(rawSlice) : rawSlice;
      return cleanWordXmlToText(xmlBuf.toString('utf8'));
    }
  } catch {
    // Ignore decompression errors on malformed files
  }
  return '';
}

function cleanWordXmlToText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, '\n\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
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
