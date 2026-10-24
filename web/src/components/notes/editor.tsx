import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import { getNoteDocName } from '@doks/shared';
import { yjsClient } from '../../state/yjs-client.js';
import {
  notes,
  selectedNoteId,
  renameNote,
  theme
} from '../../state/app-state.js';
import {
  wikilinksCompletionSource,
  findBacklinks,
  navigateToWikilink
} from './wikilinks-extension.js';

interface NoteEditorProps {
  noteId: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [backlinks, setBacklinks] = useState<Array<{ id: string; title: string }>>([]);

  const currentNote = notes.value.find((n) => n.id === noteId);
  const title = currentNote?.title || 'Без названия';

  useEffect(() => {
    if (!editorContainerRef.current) return;

    const docName = getNoteDocName(noteId);
    const yDoc = yjsClient.getOrCreateDoc(docName);
    const yText = yDoc.getText('text');

    // Click handler to navigate [[links]]
    const domClickHandler = EditorView.domEventHandlers({
      click: (event, view) => {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        const line = view.state.doc.lineAt(pos);
        const text = line.text;
        const col = pos - line.from;

        const linkRegex = /\[\[(.*?)\]\]/g;
        let match;
        while ((match = linkRegex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (col >= start && col <= end) {
            const targetTitle = match[1];
            navigateToWikilink(targetTitle);
            return true;
          }
        }
        return false;
      }
    });

    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      autocompletion({ override: [wikilinksCompletionSource] }),
      yCollab(yText, null),
      domClickHandler,
      EditorView.lineWrapping
    ];

    if (theme.value === 'dark') {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: yText.toString(),
      extensions
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current
    });
    viewRef.current = view;

    // Refresh backlinks
    const updateBacklinks = () => {
      const allNotesWithText = notes.value
        .filter((n) => !n.deleted)
        .map((n) => {
          const doc = yjsClient.getOrCreateDoc(getNoteDocName(n.id));
          return { id: n.id, title: n.title, text: doc.getText('text').toString() };
        });
      setBacklinks(findBacklinks(title, allNotesWithText));
    };

    updateBacklinks();
    const interval = setInterval(updateBacklinks, 2000);

    return () => {
      clearInterval(interval);
      view.destroy();
      viewRef.current = null;
    };
  }, [noteId, theme.value]);

  return (
    <div class="note-editor-wrapper">
      <div class="note-header">
        <input
          class="note-title-input"
          value={title}
          placeholder="Название заметки"
          onInput={(e) => renameNote(noteId, (e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="note-content-area">
        <div ref={editorContainerRef} class="codemirror-editor" />

        {/* Backlinks Panel */}
        <div class="backlinks-panel">
          <div class="backlinks-header">
            <span>Обратные ссылки ({backlinks.length})</span>
          </div>
          {backlinks.length === 0 ? (
            <div class="backlinks-empty">На эту заметку пока никто не ссылается</div>
          ) : (
            <div class="backlinks-list">
              {backlinks.map((bl) => (
                <div
                  key={bl.id}
                  class="backlink-item"
                  onClick={() => (selectedNoteId.value = bl.id)}
                >
                  <span class="backlink-icon">📄</span>
                  <span class="backlink-title">{bl.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
