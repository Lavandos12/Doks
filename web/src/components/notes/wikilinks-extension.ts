import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { notes, selectedNoteId, createNote } from '../../state/app-state.js';

/**
 * Autocompletion source for [[wikilinks]] based on existing notes.
 */
export function wikilinksCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const openBracketIndex = textBefore.lastIndexOf('[[');
  if (openBracketIndex === -1) return null;

  const closeBracketIndex = textBefore.lastIndexOf(']]');
  if (closeBracketIndex > openBracketIndex) return null;

  const query = textBefore.slice(openBracketIndex + 2);
  const availableNotes = notes.value.filter((n) => !n.deleted);

  const options = availableNotes
    .filter((n) => n.title.toLowerCase().includes(query.toLowerCase()))
    .map((n) => ({
      label: n.title,
      apply: `${n.title}]]`,
      detail: 'Заметка'
    }));

  return {
    from: line.from + openBracketIndex + 2,
    options
  };
}

/**
 * Helper to find all notes that link to a specific note title.
 */
export function findBacklinks(targetTitle: string, allNotes: Array<{ id: string; title: string; text?: string }>): Array<{ id: string; title: string }> {
  if (!targetTitle) return [];
  const escaped = targetTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\[\\[\\s*${escaped}(\\s*\\|[^\\]]*)?\\]\\]`, 'i');

  return allNotes.filter((n) => {
    if (n.title.toLowerCase() === targetTitle.toLowerCase()) return false;
    return n.text ? regex.test(n.text) : false;
  }).map((n) => ({ id: n.id, title: n.title }));
}

/**
 * Opens or creates a note when a [[Title]] link is activated.
 */
export function navigateToWikilink(rawTitle: string): void {
  const [cleanTitle] = rawTitle.split('|').map((s) => s.trim());
  const match = notes.value.find(
    (n) => !n.deleted && n.title.toLowerCase() === cleanTitle.toLowerCase()
  );
  if (match) {
    selectedNoteId.value = match.id;
  } else {
    // If not found, create note automatically
    const newId = createNote(cleanTitle);
    selectedNoteId.value = newId;
  }
}
