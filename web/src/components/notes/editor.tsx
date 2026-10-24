import { h, Fragment } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
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
  openTab,
  renameNote,
  theme
} from '../../state/app-state.js';
import {
  wikilinksCompletionSource,
  findBacklinks,
  navigateToWikilink
} from './wikilinks-extension.js';
import { MarkdownPreview, extractHeadings, type HeadingItem } from './markdown-preview.js';
import { PropertiesPanel } from './properties-panel.js';
import { OutlinePanel } from './outline-panel.js';
import { Icon } from '../../ui/icons.js';

interface NoteEditorProps {
  noteId: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Editor mode: 'preview' (Live Preview) or 'source' (Markdown CodeMirror)
  const [editorMode, setEditorMode] = useState<'preview' | 'source'>('preview');

  // Right sidebar tab: 'outline' or 'backlinks'
  const [rightPanelTab, setRightPanelTab] = useState<'outline' | 'backlinks'>('outline');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Live content string for preview and outline
  const [contentString, setContentString] = useState<string>('');
  const [backlinks, setBacklinks] = useState<Array<{ id: string; title: string }>>([]);

  const currentNote = notes.value.find((n) => n.id === noteId);
  const title = currentNote?.title || 'Без названия';

  const docName = getNoteDocName(noteId);
  const yDoc = yjsClient.getOrCreateDoc(docName);
  const yText = yDoc.getText('text');

  // Sync Y.Text to local contentString
  useEffect(() => {
    const update = () => {
      setContentString(yText.toString());
    };
    update();
    yText.observe(update);
    return () => {
      yText.unobserve(update);
    };
  }, [noteId]);

  // CodeMirror initialization when in 'source' mode
  useEffect(() => {
    if (editorMode !== 'source' || !editorContainerRef.current) return;

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

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [noteId, editorMode, theme.value]);

  // Ctrl+E hotkey to toggle Live Preview / Source
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setEditorMode((prev) => (prev === 'preview' ? 'source' : 'preview'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update Backlinks list
  useEffect(() => {
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
    const interval = setInterval(updateBacklinks, 2500);
    return () => clearInterval(interval);
  }, [noteId, title]);

  // Extract headings for Outline
  const headings: HeadingItem[] = useMemo(() => {
    return extractHeadings(contentString);
  }, [contentString]);

  // Toggle checkbox in preview
  const handleToggleCheckbox = (lineIndex: number, newChecked: boolean) => {
    const lines = contentString.split('\n');
    if (lineIndex < lines.length) {
      const targetLine = lines[lineIndex];
      const updatedLine = targetLine.replace(/^([-*]\s+\[)([ xX])(\])/, `$1${newChecked ? 'x' : ' '}$3`);
      lines[lineIndex] = updatedLine;
      const newDocText = lines.join('\n');

      yDoc.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, newDocText);
      });
    }
  };

  // Scroll or navigate to heading
  const handleSelectHeading = (headingId: string, headingText: string) => {
    if (editorMode === 'preview') {
      const el = document.getElementById(headingId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (viewRef.current) {
      // Find position of heading in CodeMirror and move cursor
      const docStr = viewRef.current.state.doc.toString();
      const idx = docStr.indexOf(headingText);
      if (idx !== -1) {
        viewRef.current.dispatch({
          selection: { anchor: idx, head: idx },
          scrollIntoView: true
        });
        viewRef.current.focus();
      }
    }
  };

  // Slash commands quick insert
  const insertSnippet = (snippet: string) => {
    if (editorMode === 'source' && viewRef.current) {
      const { from } = viewRef.current.state.selection.main;
      viewRef.current.dispatch({
        changes: { from, insert: snippet }
      });
      viewRef.current.focus();
    } else {
      yDoc.transact(() => {
        yText.insert(yText.length, `\n\n${snippet}`);
      });
    }
  };

  return (
    <div class="note-editor-wrapper">
      {/* Note Header */}
      <div class="note-header">
        <div class="note-header-top">
          <input
            class="note-title-input"
            value={title}
            placeholder="Название заметки..."
            onInput={(e) => renameNote(noteId, (e.target as HTMLInputElement).value)}
          />

          <div class="note-toolbar-actions">
            {/* Live Preview Toggle (Ctrl+E) */}
            <button
              class={`note-action-btn ${editorMode === 'preview' ? 'active' : ''}`}
              onClick={() => setEditorMode(editorMode === 'preview' ? 'source' : 'preview')}
              title={`Режим: ${editorMode === 'preview' ? 'Live Preview' : 'Исходный Markdown'} (Ctrl+E)`}
            >
              <Icon name={editorMode === 'preview' ? 'eye' : 'edit'} size={15} />
              <span>{editorMode === 'preview' ? 'Просмотр' : 'Исходник'}</span>
            </button>

            {/* Quick Insert Snippets */}
            <div class="quick-insert-group">
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('## Заголовок')}
                title="Вставить заголовок H2"
              >
                H2
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('- [ ] Новая задача')}
                title="Вставить чекбокс"
              >
                <Icon name="check" size={13} />
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('> [!note] Заметка\n> Важная мысль или контекст')}
                title="Вставить коллаут"
              >
                <Icon name="sparkles" size={13} />
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('[[Название заметки]]')}
                title="Вставить связь [[...]]"
              >
                <Icon name="link" size={13} />
              </button>
            </div>

            {/* Toggle Right Panel (Outline / Backlinks) */}
            <button
              class={`note-action-btn ${isRightPanelOpen ? 'active' : ''}`}
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
              title="Панель оглавления и связей"
            >
              <Icon name="columns" size={15} />
            </button>
          </div>
        </div>

        {/* Collapsible Properties Panel (Frontmatter Tags & Meta) */}
        <PropertiesPanel yText={yText} noteId={noteId} />
      </div>

      {/* Main Content Area */}
      <div class="note-content-area">
        <div class="note-main-pane">
          {editorMode === 'source' ? (
            <div ref={editorContainerRef} class="codemirror-editor" />
          ) : (
            <div class="preview-scroll-wrapper" onDblClick={() => setEditorMode('source')}>
              <MarkdownPreview
                content={contentString}
                onToggleCheckbox={handleToggleCheckbox}
                onNavigateWikilink={(targetTitle) => {
                  const matched = notes.value.find((n) => !n.deleted && n.title.toLowerCase() === targetTitle.toLowerCase());
                  if (matched) {
                    openTab('note', matched.id, matched.title);
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Right Tabbed Panel (Outline & Backlinks) */}
        {isRightPanelOpen && (
          <div class="note-right-panel">
            <div class="right-panel-tabs">
              <button
                class={`rp-tab-btn ${rightPanelTab === 'outline' ? 'active' : ''}`}
                onClick={() => setRightPanelTab('outline')}
              >
                <Icon name="file-text" size={13} />
                <span>Оглавление</span>
              </button>
              <button
                class={`rp-tab-btn ${rightPanelTab === 'backlinks' ? 'active' : ''}`}
                onClick={() => setRightPanelTab('backlinks')}
              >
                <Icon name="link" size={13} />
                <span>Связи ({backlinks.length})</span>
              </button>
            </div>

            <div class="right-panel-body">
              {rightPanelTab === 'outline' && (
                <OutlinePanel headings={headings} onSelectHeading={handleSelectHeading} />
              )}

              {rightPanelTab === 'backlinks' && (
                <div class="backlinks-list">
                  {backlinks.length === 0 ? (
                    <div class="backlinks-empty">На эту заметку пока никто не ссылается</div>
                  ) : (
                    backlinks.map((bl) => (
                      <div
                        key={bl.id}
                        class="backlink-item"
                        onClick={() => openTab('note', bl.id, bl.title)}
                      >
                        <Icon name="file-text" size={14} class="backlink-icon" />
                        <span class="backlink-title">{bl.title}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
