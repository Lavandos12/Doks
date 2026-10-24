/**
 * Converters for importing external documents into clean Markdown.
 */

/**
 * Converts CSV content (comma or semicolon separated) into a Markdown table.
 */
export function csvToMarkdown(csvContent: string): string {
  if (!csvContent.trim()) return '';

  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '';

  // Detect delimiter: comma vs semicolon vs tab
  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes(';') && (firstLine.split(';').length > firstLine.split(',').length)) {
    delimiter = ';';
  } else if (firstLine.includes('\t')) {
    delimiter = '\t';
  }

  const parseRow = (line: string): string[] => {
    const row: string[] = [];
    let insideQuotes = false;
    let currentCell = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === delimiter && !insideQuotes) {
        row.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    row.push(currentCell.trim());
    return row;
  };

  const parsedRows = lines.map(parseRow);
  if (parsedRows.length === 0) return '';

  const colCount = Math.max(...parsedRows.map((r) => r.length));
  if (colCount === 0) return '';

  const padRow = (r: string[]) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push('');
    return padded.map((c) => c.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  };

  const header = padRow(parsedRows[0]);
  const separator = new Array(colCount).fill('---');
  const dataRows = parsedRows.slice(1).map(padRow);

  const out: string[] = [];
  out.push(`| ${header.join(' | ')} |`);
  out.push(`| ${separator.join(' | ')} |`);
  for (const r of dataRows) {
    out.push(`| ${r.join(' | ')} |`);
  }

  return out.join('\n');
}

/**
 * Converts basic HTML content to Markdown.
 */
export function htmlToMarkdown(htmlContent: string): string {
  if (!htmlContent.trim()) return '';

  let text = htmlContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');

  // Headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n');

  // Formatting
  text = text.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**');
  text = text.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n');

  // Paragraphs & breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Tables
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableInner) => {
    const trMatches = tableInner.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!trMatches) return '';
    const tableRows: string[][] = [];

    for (const tr of trMatches) {
      const cellMatches = tr.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi);
      if (cellMatches) {
        const cells = cellMatches.map((c: string) => c.replace(/<[^>]+>/g, '').trim());
        tableRows.push(cells);
      }
    }

    if (tableRows.length === 0) return '';
    const maxCols = Math.max(...tableRows.map((r) => r.length));
    const pad = (r: string[]) => {
      const p = [...r];
      while (p.length < maxCols) p.push('');
      return p;
    };

    const header = pad(tableRows[0]);
    const sep = new Array(maxCols).fill('---');
    const rows = tableRows.slice(1).map(pad);

    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...rows.map((r) => `| ${r.join(' | ')} |`)
    ];
    return `\n\n${lines.join('\n')}\n\n`;
  });

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse excessive empty lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * Converts DOCX word/document.xml content into structured Markdown.
 */
export function docxXmlToMarkdown(xmlContent: string): string {
  if (!xmlContent.trim()) return '';

  const paragraphs = xmlContent.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi) || [];
  const mdLines: string[] = [];

  for (const p of paragraphs) {
    // Check heading style
    let headingPrefix = '';
    const pStyleMatch = p.match(/<w:pStyle\s+w:val=["']([^"']+)["']/i);
    if (pStyleMatch) {
      const val = pStyleMatch[1].toLowerCase();
      if (val.includes('heading1') || val === '1' || val === 'title') headingPrefix = '# ';
      else if (val.includes('heading2') || val === '2') headingPrefix = '## ';
      else if (val.includes('heading3') || val === '3') headingPrefix = '### ';
    }

    // Extract text runs <w:r>
    const runs = p.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/gi) || [];
    let paragraphText = '';

    for (const r of runs) {
      const isBold = /<w:b\b/i.test(r);
      const isItalic = /<w:i\b/i.test(r);

      // Extract text content from <w:t>
      const textMatches = r.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
      let runText = textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');

      if (runText) {
        if (isBold && isItalic) runText = `***${runText}***`;
        else if (isBold) runText = `**${runText}**`;
        else if (isItalic) runText = `*${runText}*`;
        paragraphText += runText;
      }
    }

    const trimmed = paragraphText.trim();
    if (trimmed) {
      mdLines.push(headingPrefix ? `${headingPrefix}${trimmed}` : trimmed);
    }
  }

  return mdLines.join('\n\n');
}
