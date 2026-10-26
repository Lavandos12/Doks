import zlib from 'node:zlib';

/**
 * Extracts readable text and paragraphs from a .docx buffer using built-in Node.js zlib.
 * Zero external dependencies required.
 */
export function extractTextFromDocxBuffer(buf: Buffer): string {
  try {
    let offset = 0;
    while (offset + 30 <= buf.length) {
      const signature = buf.readUInt32LE(offset);
      if (signature !== 0x04034b50) break; // Local file header signature

      const compressionMethod = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLength = buf.readUInt16LE(offset + 26);
      const extraFieldLength = buf.readUInt16LE(offset + 28);

      const fileName = buf.toString('utf8', offset + 30, offset + 30 + fileNameLength);
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      if (fileName === 'word/document.xml' && dataEnd <= buf.length) {
        const rawSlice = buf.subarray(dataStart, dataEnd);
        const xmlBuffer =
          compressionMethod === 8
            ? zlib.inflateRawSync(rawSlice)
            : compressionMethod === 0
            ? rawSlice
            : null;

        if (!xmlBuffer) return '';
        const xml = xmlBuffer.toString('utf8');

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

      offset = dataEnd;
    }
  } catch {
    // Fallback if corrupted or encrypted docx
  }
  return '';
}
