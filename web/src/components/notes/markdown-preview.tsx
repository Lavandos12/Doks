import { h, VNode } from 'preact';
import { openTab, notes } from '../../state/app-state.js';
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

  return <div class="markdown-preview-root">{renderedElements}</div>;
}

/**
 * Parses inline markdown: **bold**, *italic*, `code`, and [[wikilinks|alias]]
 */
function renderInlineMarkdown(text: string, onNavigateWikilink?: (title: string) => void): (string | VNode)[] {
  const parts: (string | VNode)[] = [];
  const regex = /(\[\[.*?\]\]|\*\*.*?\*\*|\*.*?\*|`.*?`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('[[') && token.endsWith(']]')) {
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
          title={`Перейти к заметке: ${targetTitle}`}
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
