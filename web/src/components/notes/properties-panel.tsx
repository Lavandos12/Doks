import { h } from 'preact';
import { useState } from 'preact/hooks';
import * as Y from 'yjs';
import { Icon } from '../../ui/icons.js';

interface PropertiesPanelProps {
  yText: Y.Text;
  noteId: string;
}

export function PropertiesPanel({ yText, noteId }: PropertiesPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);

  const rawText = yText.toString();
  const fmMatch = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

  // Extract tags from frontmatter
  const tags: string[] = [];
  if (fmMatch) {
    const yaml = fmMatch[1];
    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);
    if (tagsMatch && tagsMatch[1]) {
      tagsMatch[1].split(',').forEach((t) => {
        const clean = t.trim().replace(/^['"]|['"]$/g, '');
        if (clean) tags.push(clean);
      });
    }
  }

  const updateFrontmatterTags = (updatedTags: string[]) => {
    const current = yText.toString();
    const match = current.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    const tagsFormatted = `tags: [${updatedTags.map((t) => `"${t}"`).join(', ')}]`;

    if (match) {
      let yamlBlock = match[1];
      const body = match[2];

      if (/tags:\s*\[.*?\]/.test(yamlBlock)) {
        yamlBlock = yamlBlock.replace(/tags:\s*\[.*?\]/, tagsFormatted);
      } else {
        yamlBlock = `${yamlBlock.trim()}\n${tagsFormatted}`;
      }

      const newContent = `---\n${yamlBlock.trim()}\n---\n${body}`;
      yText.doc?.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, newContent);
      });
    } else {
      // Prepend frontmatter
      const newContent = `---\nid: ${noteId}\n${tagsFormatted}\n---\n${current}`;
      yText.doc?.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, newContent);
      });
    }
  };

  const addTag = () => {
    const clean = newTagInput.trim().replace(/^#/, '');
    if (clean && !tags.includes(clean)) {
      updateFrontmatterTags([...tags, clean]);
      setNewTagInput('');
      setIsAddingTag(false);
    }
  };

  const removeTag = (tagToRemove: string) => {
    updateFrontmatterTags(tags.filter((t) => t !== tagToRemove));
  };

  return (
    <div class="note-properties-panel">
      <div class="properties-header" onClick={() => setIsOpen(!isOpen)}>
        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} class="properties-chevron" />
        <span class="properties-title">Свойства заметки</span>
        <span class="properties-badge">{tags.length} тегов</span>
      </div>

      {isOpen && (
        <div class="properties-content">
          <div class="property-row">
            <span class="prop-label">ID:</span>
            <code class="prop-id-value">{noteId.slice(0, 8)}</code>
          </div>

          <div class="property-row">
            <span class="prop-label">Теги:</span>
            <div class="tags-chips-list">
              {tags.map((t) => (
                <span key={t} class="tag-chip">
                  <span>#{t}</span>
                  <button class="tag-remove-btn" onClick={() => removeTag(t)}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}

              {isAddingTag ? (
                <div class="tag-input-wrapper">
                  <input
                    type="text"
                    class="tag-input"
                    placeholder="тег..."
                    value={newTagInput}
                    onInput={(e) => setNewTagInput((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag();
                      if (e.key === 'Escape') setIsAddingTag(false);
                    }}
                    autoFocus
                  />
                  <button class="tag-add-confirm-btn" onClick={addTag}>
                    <Icon name="check" size={12} />
                  </button>
                </div>
              ) : (
                <button class="tag-add-btn" onClick={() => setIsAddingTag(true)} title="Добавить тег">
                  <Icon name="plus" size={12} />
                  <span>Тег</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
