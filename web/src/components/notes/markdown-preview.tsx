import { h, VNode } from 'preact';
import { openTab, notes, attachments } from '../../state/app-state.js';
import { Icon, type IconName } from '../../ui/icons.js';

interface MarkdownPreviewProps {
  content: string;
  onToggleCheckbox?: (lineIndex: number, newChecked: boolean) => void;
  onNavigateWikilink?: (title: string) => void;
}

export interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

export function extractHeadings(markdown: string): HeadingItem[] {
  const lines = markdown.split('\n');
  const headings: HeadingItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = `heading-${i}-${text.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-')}`;
      headings.push({ level, text, id });
    }
  }

  return headings;
}

export function MarkdownPreview({ content, onToggleCheckbox, onNavigateWikilink }: MarkdownPreviewProps) {
  const lines = content.split('\n');
  const renderedElements: VNode[] = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  let inCallout = false;
  let calloutType = 'note';
  let calloutTitle = '';
  let calloutLines: string[] = [];

  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  const flushBlockquote = (key: string) => {
    if (blockquoteLines.length > 0) {
      renderedElements.push(
        <blockquote key={key} class="preview-blockquote">
          {blockquoteLines.map((ql, qidx) => (
            <p key={qidx}>{renderInlineMarkdown(ql, onNavigateWikilink)}</p>
          ))}
        </blockquote>
      );
    }
    inBlockquote = false;
    blockquoteLines = [];
  };

  const flushCodeBlock = (key: string) => {
    renderedElements.push(
      <div key={key} class="preview-code-block">
        {codeBlockLang && <div class="code-lang-badge">{codeBlockLang}</div>}
        <pre>
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      </div>
    );
    inCodeBlock = false;
    codeBlockLang = '';
    codeBlockLines = [];
  };

  const getCalloutIcon = (type: string): IconName => {
    switch (type.toLowerCase()) {
      case 'tip':
        return 'sparkles';
      case 'warning':
      case 'caution':
        return 'pin';
      case 'important':
        return 'check';
      default:
        return 'file-text';
    }
  };

  const flushCallout = (key: string) => {
    const iconName = getCalloutIcon(calloutType);
    renderedElements.push(
      <div key={key} class={`preview-callout callout-${calloutType.toLowerCase()}`}>
        <div class="callout-header">
          <Icon name={iconName} size={16} class="callout-icon" />
          <span class="callout-title">{calloutTitle || calloutType.toUpperCase()}</span>
        </div>
        <div class="callout-content">
          {calloutLines.map((cl, idx) => (
            <p key={idx}>{renderInlineMarkdown(cl, onNavigateWikilink)}</p>
          ))}
        </div>
      </div>
    );
    inCallout = false;
    calloutType = 'note';
    calloutTitle = '';
    calloutLines = [];
  };

  // Strip YAML frontmatter from visual body
  let startIndex = 0;
  if (lines[0]?.trim() === '---') {
    const endFm = lines.slice(1).findIndex((l) => l.trim() === '---');
    if (endFm !== -1) {
      startIndex = endFm + 2;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Code block toggle
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock(`code-${i}`);
      } else {
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // Callout detection: > [!note] Title
    const calloutMatch = trimmed.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/);
    if (calloutMatch) {
      if (inBlockquote) flushBlockquote(`quote-${i}`);
      if (inCallout) flushCallout(`callout-${i}`);
      inCallout = true;
      calloutType = calloutMatch[1];
      calloutTitle = calloutMatch[2].trim();
      continue;
    }

    if (inCallout) {
      if (trimmed.startsWith('>')) {
        calloutLines.push(trimmed.slice(1).trim());
        continue;
      } else if (trimmed === '') {
        calloutLines.push('');
        continue;
      } else {
        flushCallout(`callout-${i}`);
      }
    }

    // Standard Blockquote detection (> line that is not a callout)
    if (trimmed.startsWith('>')) {
      inBlockquote = true;
      blockquoteLines.push(trimmed.replace(/^>\s?/, ''));
      continue;
    } else if (inBlockquote) {
      flushBlockquote(`quote-${i}`);
    }

    // 3.6 Standard Markdown Table detection: header row with | and next row with delimiter | --- |
    if (!inCodeBlock && !inCallout && !inBlockquote && trimmed.includes('|') && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();
      const isDelimiter = /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(nextTrimmed);
      if (isDelimiter) {
        const parseRow = (rowStr: string): string[] => {
          let t = rowStr.trim();
          if (t.startsWith('|')) t = t.slice(1);
          if (t.endsWith('|')) t = t.slice(0, -1);
          return t.split('|').map((c) => c.trim());
        };

        const headers = parseRow(trimmed);
        const delimiters = parseRow(nextTrimmed);
        const alignments = delimiters.map((d) => {
          const leftColon = d.startsWith(':');
          const rightColon = d.endsWith(':');
          if (leftColon && rightColon) return 'center';
          if (rightColon) return 'right';
          return 'left';
        });

        const rows: string[][] = [];
        i += 2;
        while (i < lines.length) {
          const rowLine = lines[i].trim();
          if (!rowLine.includes('|') || rowLine === '') break;
          rows.push(parseRow(rowLine));
          i++;
        }
        i--; // decrement because for-loop will i++

        renderedElements.push(
          <div key={`table-${i}`} class="preview-table-container">
            <table class="preview-table">
              <thead>
                <tr>
                  {headers.map((h, ci) => (
                    <th key={ci} style={{ textAlign: alignments[ci] || 'left' }}>
                      {renderInlineMarkdown(h, onNavigateWikilink)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ textAlign: alignments[ci] || 'left' }}>
                        {renderInlineMarkdown(cell, onNavigateWikilink)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = `heading-${i}-${text.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-')}`;
      const inline = renderInlineMarkdown(text, onNavigateWikilink);

      if (level === 1) renderedElements.push(<h1 key={i} id={id} class="preview-h1">{inline}</h1>);
      else if (level === 2) renderedElements.push(<h2 key={i} id={id} class="preview-h2">{inline}</h2>);
      else if (level === 3) renderedElements.push(<h3 key={i} id={id} class="preview-h3">{inline}</h3>);
      else renderedElements.push(<h4 key={i} id={id} class="preview-h4">{inline}</h4>);
      continue;
    }

    // Checkboxes: - [ ] or - [x]
    const checkMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checkMatch) {
      const isChecked = checkMatch[1].toLowerCase() === 'x';
      const label = checkMatch[2];
      renderedElements.push(
        <div key={i} class="preview-checklist-item">
          <input
            type="checkbox"
            checked={isChecked}
            class="preview-checkbox"
            onChange={(e) => {
              if (onToggleCheckbox) {
                onToggleCheckbox(i, (e.target as HTMLInputElement).checked);
              }
            }}
          />
          <span class={`preview-check-label ${isChecked ? 'completed' : ''}`}>
            {renderInlineMarkdown(label, onNavigateWikilink)}
          </span>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      renderedElements.push(<hr key={i} class="preview-hr" />);
      continue;
    }

    // Empty lines
    if (trimmed === '') {
      renderedElements.push(<div key={i} class="preview-empty-line" />);
      continue;
    }

    // Normal paragraph
    renderedElements.push(
      <p key={i} class="preview-paragraph">
        {renderInlineMarkdown(rawLine, onNavigateWikilink)}
      </p>
    );
  }

  if (inCodeBlock) flushCodeBlock('code-end');
  if (inCallout) flushCallout('callout-end');
  if (inBlockquote) flushBlockquote('quote-end');

  return <div class="markdown-preview-root">{renderedElements}</div>;
}

export const isSafeUrl = (url: string): boolean => {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  // Strictly allow http, https, mailto, relative /api/ attachments, or anchors
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#')
  );
};

/**
 * Parses inline markdown: **bold**, *italic*, `code`, [[wikilinks|alias]], and [text](url)
 */
function renderInlineMarkdown(text: string, onNavigateWikilink?: (title: string) => void): (string | VNode)[] {
  const parts: (string | VNode)[] = [];
  const regex = /(!\[\[.*?\]\]|\[\[.*?\]\]|!\[.*?\]\(.*?\)|\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('![[') && token.endsWith(']]')) {
      const inner = token.slice(3, -2);
      const [targetName, alias] = inner.split('|').map((s) => s.trim());
      const att = attachments.value.find(
        (a) => !a.deleted && (a.name === targetName || a.hash === targetName || a.name.toLowerCase() === targetName.toLowerCase())
      );
      const src = att ? `/api/attachments/${att.hash}` : `/api/attachments/${encodeURIComponent(targetName)}`;
      const isImage = !att || (att.mime ? att.mime.startsWith('image/') : /\.(png|jpe?g|gif|webp|svg)$/i.test(targetName));
      const targetUrl = isSafeUrl(src) ? src : '#';

      if (isImage) {
        parts.push(
          <img
            key={match.index}
            src={src}
            alt={alias || targetName}
            class="preview-embedded-image"
            style={{ maxWidth: '100%', borderRadius: '8px', margin: '8px 0', display: 'block' }}
          />
        );
      } else {
        parts.push(
          <a
            key={match.index}
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="preview-attachment-chip"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.06)',
              textDecoration: 'none',
              color: 'inherit',
              margin: '2px 0'
            }}
          >
            <span class="preview-attachment-name">{alias || targetName}</span>
          </a>
        );
      }
    } else if (token.startsWith('![') && token.includes('](') && token.endsWith(')')) {
      const alt = token.slice(2, token.indexOf(']('));
      const url = token.slice(token.indexOf('](') + 2, -1);
      const targetUrl = isSafeUrl(url) ? url : '';
      if (targetUrl) {
        parts.push(
          <img
            key={match.index}
            src={targetUrl}
            alt={alt}
            class="preview-embedded-image"
            style={{ maxWidth: '100%', borderRadius: '8px', margin: '8px 0', display: 'block' }}
          />
        );
      }
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const label = token.slice(1, token.indexOf(']('));
      const rawUrl = token.slice(token.indexOf('](') + 2, -1);
      const targetUrl = isSafeUrl(rawUrl) ? rawUrl : '#';
      parts.push(
        <a
          key={match.index}
          href={targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="preview-link"
          style={{ color: '#8b5cf6', textDecoration: 'underline' }}
        >
          {label}
        </a>
      );
    } else if (token.startsWith('[[') && token.endsWith(']]')) {
      // Wikilink [[Title]] or [[Title|Alias]]
      const inner = token.slice(2, -2);
      const [targetTitle, alias] = inner.split('|').map((s) => s.trim());
      const displayText = alias || targetTitle;

      parts.push(
        <span
          key={match.index}
          class="preview-wikilink"
          onClick={() => {
            if (onNavigateWikilink) {
              onNavigateWikilink(targetTitle);
            } else {
              const matchedNote = notes.value.find((n) => !n.deleted && n.title.toLowerCase() === targetTitle.toLowerCase());
              if (matchedNote) {
                openTab('note', matchedNote.id, matchedNote.title);
              }
            }
          }}
          title={`Go to note: ${targetTitle}`}
        >
          {displayText}
        </span>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={match.index} class="preview-inline-code">{token.slice(1, -1)}</code>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
