import { h } from 'preact';
import type { HeadingItem } from './markdown-preview.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

interface OutlinePanelProps {
  headings: HeadingItem[];
  onSelectHeading: (id: string, text: string) => void;
}

export function OutlinePanel({ headings, onSelectHeading }: OutlinePanelProps) {
  return (
    <div class="outline-panel-root">
      <div class="outline-header">
        <Icon name="file-text" size={14} />
        <span>{t('notes.outline')} ({headings.length})</span>
      </div>

      <div class="outline-list">
        {headings.length === 0 ? (
          <div class="outline-empty">{t('notes.outline_empty')}</div>
        ) : (
          headings.map((hItem) => (
            <div
              key={hItem.id}
              class={`outline-item level-${hItem.level}`}
              style={{ paddingLeft: `${(hItem.level - 1) * 12 + 8}px` }}
              onClick={() => onSelectHeading(hItem.id, hItem.text)}
              title={hItem.text}
            >
              <span class="outline-bullet">•</span>
              <span class="outline-text">{hItem.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
