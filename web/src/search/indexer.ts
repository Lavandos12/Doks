import MiniSearch from 'minisearch';

export interface SearchDoc {
  id: string;
  type?: 'note' | 'board';
  title: string;
  folder?: string;
  text: string;
  tags?: string[];
}

export interface SearchResult {
  id: string;
  type: 'note' | 'board';
  title: string;
  snippet: string;
  score: number;
}

export class NotesSearchIndex {
  private miniSearch: MiniSearch<SearchDoc>;
  private docTexts = new Map<string, { text: string; type: 'note' | 'board'; title: string }>();

  constructor() {
    this.miniSearch = new MiniSearch<SearchDoc>({
      fields: ['title', 'text', 'tags'],
      storeFields: ['id', 'type', 'title', 'text'],
      processTerm: (term) => term.toLowerCase().replace(/ё/g, 'е'),
      searchOptions: {
        processTerm: (term) => term.toLowerCase().replace(/ё/g, 'е'),
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 3, tags: 2 }
      }
    });
  }

  public updateDoc(doc: SearchDoc): void {
    if (this.miniSearch.has(doc.id)) {
      this.miniSearch.discard(doc.id);
    }
    this.miniSearch.add({ ...doc, type: doc.type || 'note' });
    this.docTexts.set(doc.id, { text: doc.text || '', type: doc.type || 'note', title: doc.title });
  }

  public removeDoc(id: string): void {
    if (this.miniSearch.has(id)) {
      this.miniSearch.discard(id);
    }
    this.docTexts.delete(id);
  }

  public search(query: string): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results = this.miniSearch.search(trimmed);
    const normalizedQuery = trimmed.toLowerCase().replace(/ё/g, 'е');
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return results.map((r) => {
      const stored = this.docTexts.get(r.id);
      const text = stored?.text || (r.text as string) || '';
      const snippet = this.createSnippet(text, terms);

      return {
        id: r.id,
        type: (stored?.type || r.type || 'note') as 'note' | 'board',
        title: (stored?.title || r.title || 'Документ') as string,
        snippet,
        score: r.score
      };
    });
  }

  private createSnippet(text: string, terms: string[]): string {
    if (!text.trim()) return '';

    const normalizedText = text.toLowerCase().replace(/ё/g, 'е');
    let bestIndex = -1;

    for (const term of terms) {
      const idx = normalizedText.indexOf(term);
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
        bestIndex = idx;
      }
    }

    if (bestIndex === -1) {
      // Return initial slice if match is in title
      return text.slice(0, 100) + (text.length > 100 ? '...' : '');
    }

    const start = Math.max(0, bestIndex - 40);
    const end = Math.min(text.length, bestIndex + 80);

    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';

    return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ')}${suffix}`;
  }
}
