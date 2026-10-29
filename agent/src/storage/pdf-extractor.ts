import zlib from 'node:zlib';

export interface ExtractedPdfContent {
  text: string;
  pageCount: number;
}

/**
 * Clean and decode PDF string literals such as \(, \), \\, and octal \ddd escapes
 */
function decodePdfLiteral(raw: string): string {
  return raw
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\\r?\n/g, '');
}

/**
 * Extracts plain readable text and page count from a raw PDF buffer without external dependencies.
 */
export function extractTextFromPdfBuffer(buf: Buffer): string {
  try {
    const rawStr = buf.toString('binary');

    // 1. Estimate page count from PDF catalog
    const pageMatches = rawStr.match(/\/Type\s*\/Page\b/g);
    const pagesMatches = rawStr.match(/\/Type\s*\/Pages\b/g);
    const estimatedPages = Math.max(1, (pageMatches?.length || 0) - (pagesMatches?.length || 0));

    // 2. Locate all stream ... endstream blocks
    const textPieces: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(rawStr)) !== null) {
      const streamBinary = Buffer.from(match[1], 'binary');
      let decompressed = '';

      // Try zlib inflate
      try {
        decompressed = zlib.inflateSync(streamBinary, { maxOutputLength: 15 * 1024 * 1024 }).toString('utf8');
      } catch {
        try {
          decompressed = zlib.inflateRawSync(streamBinary, { maxOutputLength: 15 * 1024 * 1024 }).toString('utf8');
        } catch {
          // If not compressed, use as raw utf8/latin1
          decompressed = streamBinary.toString('utf8');
        }
      }

      if (!decompressed || (!decompressed.includes('Tj') && !decompressed.includes('TJ'))) {
        continue;
      }

      // 3. Extract text from Tj and TJ operators
      // Single string: (Hello World) Tj
      const tjRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(decompressed)) !== null) {
        const decoded = decodePdfLiteral(tjMatch[1]).trim();
        if (decoded) textPieces.push(decoded);
      }

      // Array of strings: [(Hello) 12 (World)] TJ
      const tjArrayRegex = /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g;
      let tjArrMatch: RegExpExecArray | null;
      while ((tjArrMatch = tjArrayRegex.exec(decompressed)) !== null) {
        const inner = tjArrMatch[1];
        const innerStrings = inner.match(/\(((?:[^()\\]|\\.)*)\)/g);
        if (innerStrings) {
          const combined = innerStrings
            .map((s) => decodePdfLiteral(s.slice(1, -1)))
            .join('')
            .trim();
          if (combined) textPieces.push(combined);
        }
      }
    }

    // 4. Fallback if no streams contained Tj/TJ: scan for printable UTF-8/ASCII strings in buffer
    if (textPieces.length === 0) {
      const asciiMatches = rawStr.match(/[A-Za-zА-Яа-я0-9\s.,!?:;()\-–—]{6,}/g);
      if (asciiMatches && asciiMatches.length > 0) {
        return asciiMatches
          .map((s) => s.trim())
          .filter((s) => !s.startsWith('/') && !s.includes('endobj') && s.length > 5)
          .slice(0, 100)
          .join('\n');
      }
      return `PDF Document / Документ PDF (${estimatedPages} pages)`;
    }

    const fullText = textPieces.join(' ').replace(/\s{2,}/g, ' ').trim();
    return fullText.length > 0 ? fullText : `PDF Document / Документ PDF (${estimatedPages} pages)`;
  } catch (err) {
    return 'PDF Document / Документ PDF';
  }
}
