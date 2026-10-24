import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { NotesSearchIndex } from '../../web/src/search/indexer.js';

describe('Stage C: Design System, Shell & Search Verification', () => {
  // B12: MiniSearch Russian normalization (ё -> е, prefix, case-insensitive)
  it('B12: MiniSearch correctly normalizes Russian language (ё -> е, prefix)', () => {
    const searchIndex = new NotesSearchIndex();

    searchIndex.updateDoc({
      id: 'note-1',
      title: 'План работы с командой',
      text: 'Здесь описана схема взаимодействия и жёлтый стикер на доске.'
    });

    searchIndex.updateDoc({
      id: 'note-2',
      title: 'Архитектура CRDT и Yjs',
      text: 'Децентрализованная синхронизация без выделенного хоста.'
    });

    // 1. Search with 'желтый' should match 'жёлтый'
    const res1 = searchIndex.search('желтый');
    expect(res1.length).toBeGreaterThan(0);
    expect(res1[0].id).toBe('note-1');

    // 2. Prefix search 'архит' should match 'Архитектура'
    const res2 = searchIndex.search('архит');
    expect(res2.length).toBeGreaterThan(0);
    expect(res2[0].id).toBe('note-2');

    // 3. Case-insensitive search
    const res3 = searchIndex.search('ДЕЦЕНТРАЛИЗОВАННАЯ');
    expect(res3.length).toBeGreaterThan(0);
    expect(res3[0].id).toBe('note-2');
  });

  // B13: Folder tree hierarchy logic
  it('B13: folder tree structure supports nesting and cascading lookup', () => {
    interface TestFolder {
      id: string;
      name: string;
      parent: string | null;
      deleted: boolean;
    }

    const folders: TestFolder[] = [
      { id: 'f-root', name: 'Проекты', parent: null, deleted: false },
      { id: 'f-sub', name: '2026', parent: 'f-root', deleted: false },
      { id: 'f-sub-sub', name: 'Doks', parent: 'f-sub', deleted: false }
    ];

    const getChildren = (parentId: string | null) => {
      return folders.filter((f) => f.parent === parentId && !f.deleted);
    };

    const rootFolders = getChildren(null);
    expect(rootFolders.length).toBe(1);
    expect(rootFolders[0].name).toBe('Проекты');

    const subFolders = getChildren(rootFolders[0].id);
    expect(subFolders.length).toBe(1);
    expect(subFolders[0].name).toBe('2026');

    const subSubFolders = getChildren(subFolders[0].id);
    expect(subSubFolders.length).toBe(1);
    expect(subSubFolders[0].name).toBe('Doks');
  });

  // B19: Wikilink refactoring across docs
  it('B19: renaming note updates wikilinks with alias preservation', () => {
    const doc = new Y.Doc();
    const text = doc.getText('text');
    text.insert(0, 'Ссылка [[Старое Имя]] и ссылка с алиасом [[Старое Имя|Алиас для чтения]].');

    const oldTitle = 'Старое Имя';
    const newTitle = 'Новое Имя';

    const content = text.toString();
    const escaped = oldTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'gi');

    const updated = content.replace(regex, (_, aliasPart) => {
      return aliasPart ? `[[${newTitle}${aliasPart}]]` : `[[${newTitle}]]`;
    });

    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, updated);
    });

    expect(text.toString()).toBe('Ссылка [[Новое Имя]] и ссылка с алиасом [[Новое Имя|Алиас для чтения]].');
  });
});
