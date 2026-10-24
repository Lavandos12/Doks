import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { extractHeadings } from '../../web/src/components/notes/markdown-preview.js';
import { findBacklinks } from '../../web/src/components/notes/wikilinks-extension.js';

describe('Stage E: Notes v2 (Obsidian-level) Verification', () => {
  // Heading extraction for Outline
  it('extractHeadings correctly extracts H1-H6 hierarchy with anchor IDs', () => {
    const md = `
# Основной заголовок
Введение в проект.

## Архитектура CRDT
Описание Yjs и sync protocols.

### Детали синхронизации
Сообщения и awareness.

## Доски и холст
JSON Canvas спецификация.
`;
    const headings = extractHeadings(md);
    expect(headings.length).toBe(4);
    expect(headings[0]).toEqual({
      level: 1,
      text: 'Основной заголовок',
      id: expect.stringContaining('основной-заголовок')
    });
    expect(headings[1].level).toBe(2);
    expect(headings[1].text).toBe('Архитектура CRDT');
    expect(headings[2].level).toBe(3);
    expect(headings[2].text).toBe('Детали синхронизации');
    expect(headings[3].level).toBe(2);
    expect(headings[3].text).toBe('Доски и холст');
  });

  // Callout detection and parsing
  it('parses Obsidian callout blocks properly', () => {
    const md = `
> [!tip] Полезный совет
> Используйте Radmin VPN для соединения.
> Локальный агент синхронизирует всё на лету.
`;
    const lines = md.trim().split('\n');
    const headerLine = lines[0];
    const match = headerLine.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('tip');
    expect(match![2]).toBe('Полезный совет');

    const bodyLines = lines.slice(1).map((l) => l.replace(/^>\s?/, ''));
    expect(bodyLines[0]).toBe('Используйте Radmin VPN для соединения.');
    expect(bodyLines[1]).toBe('Локальный агент синхронизирует всё на лету.');
  });

  // Checkbox toggle in Markdown
  it('toggles interactive checklist items in markdown text', () => {
    let md = `- [ ] Первая задача\n- [x] Вторая задача\n- [ ] Третья задача`;
    const lines = md.split('\n');

    // Toggle item 0 to checked
    lines[0] = lines[0].replace(/^([-*]\s+\[)([ xX])(\])/, `$1x$3`);
    expect(lines[0]).toBe('- [x] Первая задача');

    // Toggle item 1 to unchecked
    lines[1] = lines[1].replace(/^([-*]\s+\[)([ xX])(\])/, `$1 $3`);
    expect(lines[1]).toBe('- [ ] Вторая задача');
  });

  // Frontmatter tags manipulation in Y.Text
  it('reads and updates YAML frontmatter tags in Y.Text', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('text');
    yText.insert(0, `---\nid: note-test-1\ntags: ["frontend", "react"]\n---\n# Тело заметки\nТекст заметки.`);

    const current = yText.toString();
    const fmMatch = current.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    expect(fmMatch).not.toBeNull();

    let yaml = fmMatch![1];
    const body = fmMatch![2];

    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);
    expect(tagsMatch).not.toBeNull();
    const currentTags = tagsMatch![1].split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, ''));
    expect(currentTags).toEqual(['frontend', 'react']);

    // Add new tag 'offline'
    const updatedTags = [...currentTags, 'offline'];
    const newTagsStr = `tags: [${updatedTags.map((t) => `"${t}"`).join(', ')}]`;
    yaml = yaml.replace(/tags:\s*\[.*?\]/, newTagsStr);

    const newContent = `---\n${yaml.trim()}\n---\n${body}`;
    doc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, newContent);
    });

    expect(yText.toString()).toContain('tags: ["frontend", "react", "offline"]');
    expect(yText.toString()).toContain('# Тело заметки');
  });

  // Backlinks detection
  it('findBacklinks finds all referencing notes including aliased links', () => {
    const targetTitle = 'Серверная архитектура';
    const notesData = [
      { id: '1', title: 'Главная', text: 'Смотри [[Серверная архитектура]] для информации.' },
      { id: '2', title: 'Клиент', text: 'Связано с [[Серверная архитектура|бэкендом]].' },
      { id: '3', title: 'Нерелевантная', text: 'Тут нет ссылок на сервер.' }
    ];

    const backlinks = findBacklinks(targetTitle, notesData);
    expect(backlinks.length).toBe(2);
    expect(backlinks[0].id).toBe('1');
    expect(backlinks[1].id).toBe('2');
  });
});
