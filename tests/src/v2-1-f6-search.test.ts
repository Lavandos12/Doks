import { describe, it, expect, beforeEach } from 'vitest';
import { NotesSearchIndex } from '../../web/src/search/indexer.js';

describe('F6: MiniSearch with Russian Normalization, Boards & Snippets', () => {
  let searchIndex: NotesSearchIndex;

  beforeEach(() => {
    searchIndex = new NotesSearchIndex();
  });

  it('finds notes by a word in the middle of note content (Russian normalization ё -> е, case insensitive)', () => {
    searchIndex.updateDoc({
      id: 'note-deep',
      type: 'note',
      title: 'Планы разработки',
      text: 'В следующем квартале мы планируем подключить зелёный индикатор присутствия и оптимизировать базу данных.',
      tags: ['#планы', '#dev']
    });

    // Search by word in middle: "зеленый" (typed with 'е', stored with 'ё')
    const results = searchIndex.search('зеленый');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('note-deep');
    expect(results[0].snippet).toBeDefined();
    expect(results[0].snippet.toLowerCase()).toContain('зелёный');
  });

  it('indexes board stickies and cards and finds boards by sticker text', () => {
    searchIndex.updateDoc({
      id: 'board-kanban',
      type: 'board',
      title: 'Спринт 42',
      text: 'Купить VPS сервер для децентрализованного узла и настроить DNS записи.',
      tags: ['#инфраструктура']
    });

    const results = searchIndex.search('децентрализованного');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('board-kanban');
    expect(results[0].type).toBe('board');
  });

  it('supports fuzzy and prefix search', () => {
    searchIndex.updateDoc({
      id: 'doc-arch',
      type: 'note',
      title: 'Архитектура CRDT',
      text: 'Синхронизация через Yjs state vector exchange.'
    });

    // Prefix search: "синхрон"
    const prefixResults = searchIndex.search('синхрон');
    expect(prefixResults.some((r) => r.id === 'doc-arch')).toBe(true);
  });
});
