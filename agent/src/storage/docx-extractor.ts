import zlib from 'node:zlib';

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
 * Extracts and formats runs within a paragraph into Markdown.
 * Preserves bold, italic, code, strikethrough, line breaks, and tabs.
 */
function parseRunsToMarkdown(pXml: string): string {
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<w:br[^>]*\/>|<w:tab[^>]*\/>/gi;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = runRegex.exec(pXml)) !== null) {
    const fullTag = match[0];
    if (fullTag.startsWith('<w:br')) {
      result += '\n';
      continue;
    }
    if (fullTag.startsWith('<w:tab')) {
      result += '    ';
      continue;
    }

    const rContent = match[1];
    const rPrMatch = rContent.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i);
    const rPr = rPrMatch ? rPrMatch[1] : '';

    const isBold =
      /<w:b(\s+[^>]*w:val="(?:true|1)"|\s*\/?>)/i.test(rPr) &&
      !/<w:b\s+[^>]*w:val="(?:false|0)"/i.test(rPr);
    const isItalic =
      /<w:i(\s+[^>]*w:val="(?:true|1)"|\s*\/?>)/i.test(rPr) &&
      !/<w:i\s+[^>]*w:val="(?:false|0)"/i.test(rPr);
    const isStrike =
      /<w:strike(\s+[^>]*w:val="(?:true|1)"|\s*\/?>)/i.test(rPr) &&
      !/<w:strike\s+[^>]*w:val="(?:false|0)"/i.test(rPr);
    const isCode = /<w:rStyle\s+[^>]*w:val="(?:Code|InlineCode|HTMLCode)"/i.test(rPr);

    const textPieces: string[] = [];
    const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(rContent)) !== null) {
      textPieces.push(unescapeXml(tMatch[1]));
    }
    const rawText = textPieces.join('');
    if (!rawText) continue;

    if (!isBold && !isItalic && !isStrike && !isCode) {
      result += rawText;
      continue;
    }

    // Preserve leading and trailing whitespace outside markdown delimiters
    const trimmed = rawText.trim();
    if (!trimmed) {
      result += rawText;
      continue;
    }

    const startIdx = rawText.indexOf(trimmed);
    const leading = rawText.slice(0, startIdx);
    const trailing = rawText.slice(startIdx + trimmed.length);

    let formatted = trimmed;
    if (isCode) formatted = '`' + formatted + '`';
    if (isBold && isItalic) formatted = '***' + formatted + '***';
    else if (isBold) formatted = '**' + formatted + '**';
    else if (isItalic) formatted = '*' + formatted + '*';
    if (isStrike) formatted = '~~' + formatted + '~~';

    result += leading + formatted + trailing;
  }

  return result;
}

/**
 * Converts OpenXML `<w:tbl>` into a clean Markdown table with headers and delimiter row.
 */
function parseTableToMarkdown(tblXml: string): string {
  const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
  const rows: string[][] = [];
  let rMatch: RegExpExecArray | null;

  while ((rMatch = rowRegex.exec(tblXml)) !== null) {
    const trContent = rMatch[1];
    const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
    const cells: string[] = [];
    let cMatch: RegExpExecArray | null;

    while ((cMatch = cellRegex.exec(trContent)) !== null) {
      const tcContent = cMatch[1];
      const pMatches = tcContent.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi) || [];
      const cellTextParts: string[] = [];
      for (const pXml of pMatches) {
        const text = parseRunsToMarkdown(pXml).trim();
        if (text) cellTextParts.push(text);
      }
      const cellText = cellTextParts
        .join(' ')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ')
        .trim();
      cells.push(cellText);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return '';

  const numCols = Math.max(...rows.map((r) => r.length), 1);
  const normalizedRows = rows.map((r) => {
    const copy = [...r];
    while (copy.length < numCols) copy.push('');
    return copy;
  });

  const lines: string[] = [];
  // Header row
  lines.push('| ' + normalizedRows[0].join(' | ') + ' |');
  // Header delimiter
  lines.push('| ' + new Array(numCols).fill('---').join(' | ') + ' |');
  // Data rows
  for (let i = 1; i < normalizedRows.length; i++) {
    lines.push('| ' + normalizedRows[i].join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * Converts OpenXML `<w:p>` into a Markdown paragraph, heading, or bullet item.
 */
function parseParagraphToMarkdown(pXml: string): string {
  const pPrMatch = pXml.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/i);
  const pPr = pPrMatch ? pPrMatch[1] : '';

  let prefix = '';
  const styleMatch = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
  if (styleMatch) {
    const styleVal = styleMatch[1].toLowerCase();
    if (styleVal.includes('heading1') || styleVal === 'heading 1' || styleVal === 'title') {
      prefix = '# ';
    } else if (styleVal.includes('heading2') || styleVal === 'heading 2' || styleVal === 'subtitle') {
      prefix = '## ';
    } else if (styleVal.includes('heading3') || styleVal === 'heading 3') {
      prefix = '### ';
    } else if (styleVal.includes('heading4') || styleVal === 'heading 4') {
      prefix = '#### ';
    } else if (styleVal.includes('heading5') || styleVal === 'heading 5') {
      prefix = '##### ';
    } else if (styleVal.includes('heading6') || styleVal === 'heading 6') {
      prefix = '###### ';
    }
  }

  if (!prefix && /<w:numPr\b[^>]*>/i.test(pPr)) {
    prefix = '- ';
  }

  const runsText = parseRunsToMarkdown(pXml);
  const cleanText = runsText.trim();
  if (!cleanText) return '';

  return prefix ? `${prefix}${cleanText}` : cleanText;
}

/**
 * Universal OpenXML Word document parser converting document.xml into clean Markdown.
 */
export function cleanWordXmlToMarkdown(xml: string): string {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  const content = bodyMatch ? bodyMatch[1] : xml;

  const blockRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    const blockXml = match[0];
    if (blockXml.startsWith('<w:tbl')) {
      const tblMd = parseTableToMarkdown(blockXml);
      if (tblMd) blocks.push(tblMd);
    } else {
      const pMd = parseParagraphToMarkdown(blockXml);
      if (pMd) blocks.push(pMd);
    }
  }

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fallback scanner for legacy binary Word 97-2003 OLE2 (.doc) files.
 * Extracts UTF-16LE and ASCII text streams without external dependencies.
 */
export function extractTextFromLegacyDocBuffer(buf: Buffer): string {
  const chunks: string[] = [];

  // 1. Scan for UTF-16LE text runs (high byte === 0x00 for ASCII or 0x04 for Cyrillic)
  let utf16Current = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const code = b0 | (b1 << 8);

    const isAsciiPrintable =
      b1 === 0x00 &&
      ((b0 >= 0x20 && b0 <= 0x7e) || b0 === 0x0a || b0 === 0x0d || b0 === 0x09);
    const isCyrillic =
      b1 === 0x04 &&
      ((b0 >= 0x00 && b0 <= 0x5f) || b0 === 0x90 || b0 === 0x91);
    const isCommonLatin = b1 === 0x00 && b0 >= 0xa0 && b0 <= 0xff;

    if (isAsciiPrintable || isCyrillic || isCommonLatin) {
      if (code === 0x0d || code === 0x0a) {
        if (utf16Current.trim().length >= 3) {
          chunks.push(utf16Current.trim());
        }
        utf16Current = '';
      } else {
        utf16Current += String.fromCharCode(code);
      }
    } else {
      if (utf16Current.trim().length >= 4) {
        chunks.push(utf16Current.trim());
      }
      utf16Current = '';
    }
  }
  if (utf16Current.trim().length >= 4) {
    chunks.push(utf16Current.trim());
  }

  // 2. Scan for 8-bit ASCII printable runs if UTF-16 found very little
  if (chunks.length < 2) {
    let asciiCurrent = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if ((b >= 0x20 && b <= 0x7e) || b === 0x09) {
        asciiCurrent += String.fromCharCode(b);
      } else if (b === 0x0a || b === 0x0d) {
        if (asciiCurrent.trim().length >= 4) {
          chunks.push(asciiCurrent.trim());
        }
        asciiCurrent = '';
      } else {
        if (asciiCurrent.trim().length >= 5) {
          chunks.push(asciiCurrent.trim());
        }
        asciiCurrent = '';
      }
    }
    if (asciiCurrent.trim().length >= 5) {
      chunks.push(asciiCurrent.trim());
    }
  }

  const IGNORE_WORDS = new Set([
    'worddocument',
    'root entry',
    '1table',
    '0table',
    'data',
    'summaryinformation',
    'documentsummaryinformation',
    'compobj',
    'times new roman',
    'calibri',
    'arial',
    'symbol',
    'normal',
    'default paragraph font'
  ]);

  const filtered = chunks.filter((c) => {
    const lower = c.toLowerCase();
    if (IGNORE_WORDS.has(lower)) return false;
    if (lower.startsWith('microsoft word')) return false;
    const alphaCount = (c.match(/[a-zA-Zа-яА-Я0-9]/g) || []).length;
    return alphaCount >= 3 && alphaCount / c.length >= 0.5;
  });

  return filtered.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Universal .docx XML text extractor that handles both standard ZIP headers
 * AND Microsoft Word's Bit-3 Data Descriptor streaming ZIP headers.
 * Extracts structural Markdown and falls back to legacy binary .doc scanner.
 */
export function extractTextFromDocxBuffer(buf: Buffer): string {
  // Check for OLE2 binary Word document header (Word 97-2003)
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return extractTextFromLegacyDocBuffer(buf);
  }

  try {
    // 1. Parse Central Directory at the end of the ZIP
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
          const xmlBuf =
            method === 8 ? zlib.inflateRawSync(slice, { maxOutputLength: 20 * 1024 * 1024 }) : slice;
          return cleanWordXmlToMarkdown(xmlBuf.toString('utf8'));
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
      const xmlBuf =
        method === 8 ? zlib.inflateRawSync(rawSlice, { maxOutputLength: 20 * 1024 * 1024 }) : rawSlice;
      return cleanWordXmlToMarkdown(xmlBuf.toString('utf8'));
    }
  } catch {}

  // Fallback to legacy binary scanner if OpenXML inflation failed
  return extractTextFromLegacyDocBuffer(buf);
}
