import MiniSearch from 'minisearch';

export interface SearchDoc {
  id: string;
  title: string;
  folder?: string;
  text: string;
}

export class NotesSearchIndex {
  private miniSearch: MiniSearch<SearchDoc>;

  constructor() {
    this.miniSearch = new MiniSearch<SearchDoc>({
      fields: ['title', 'text'],
      storeFields: ['id', 'title'],
      processTerm: (term) => term.toLowerCase().replace(/ё/g, 'е'),
      searchOptions: {
        processTerm: (term) => term.toLowerCase().replace(/ё/g, 'е'),
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 2 }
      }
    });
  }

  public updateDoc(doc: SearchDoc): void {
    if (this.miniSearch.has(doc.id)) {
      this.miniSearch.discard(doc.id);
    }
    this.miniSearch.add(doc);
  }

  public removeDoc(id: string): void {
    if (this.miniSearch.has(id)) {
      this.miniSearch.discard(id);
    }
  }

  public search(query: string): Array<{ id: string; title: string; score: number }> {
    if (!query.trim()) return [];
    const results = this.miniSearch.search(query);
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score
    }));
  }
}
