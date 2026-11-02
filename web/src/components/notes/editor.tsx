import { h, Fragment } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { t } from '../../i18n/index.js';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import { getScopedNoteDocName, getScopedBoardDocName } from '@doks/shared';
import { yjsClient } from '../../state/yjs-client.js';
import { api } from '../../api/client.js';
import {
  notes,
  openTab,
  renameNote,
  theme,
  selectedBoardId,
  currentScope,
  ensureSplitTabs,
  isSplitView,
  splitTabId
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
import { showToast } from '../../ui/toast.js';

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

  const linkedBoardCards = useMemo(() => {
    const found: Array<{ nodeId: string; boardTitle: string }> = [];
    try {
      if (selectedBoardId.value) {
        const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, selectedBoardId.value));
        if (bDoc) {
          const yNodes = bDoc.getMap('nodes');
          yNodes.forEach((nodeMap: any, id: string) => {
            if (nodeMap?.get && nodeMap.get('noteId') === noteId && !nodeMap.get('deleted')) {
              found.push({ nodeId: id, boardTitle: 'Active Board' });
            }
          });
        }
      }
    } catch {}
    return found;
  }, [noteId, currentScope.value, selectedBoardId.value]);

  const currentNote = notes.value.find((n) => n.id === noteId);
  const title = currentNote?.title || t('notes.untitled');

  const docName = getScopedNoteDocName(currentScope.value, noteId);
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
  }, [noteId, currentScope.value, yText]);

  // CodeMirror initialization when in 'source' mode
  useEffect(() => {
    if (editorMode !== 'source' || !editorContainerRef.current) return;

    // Event handlers for CodeMirror (link clicks & pasting screenshots)
    const domHandlers = EditorView.domEventHandlers({
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
      },
      paste: (event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              const file = items[i].getAsFile();
              if (file) {
                event.preventDefault();
                handleUploadFileToNote(file);
                return true;
              }
            }
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
      domHandlers,
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
          const doc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, n.id));
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

  // Toggle checkbox in preview non-destructively (Audit 2.4)
  const handleToggleCheckbox = (lineIndex: number, newChecked: boolean) => {
    const fullText = yText.toString();
    const lines = fullText.split('\n');
    if (lineIndex >= lines.length) return;

    let lineStart = 0;
    for (let i = 0; i < lineIndex; i++) {
      lineStart += lines[i].length + 1; // +1 for newline '\n'
    }

    const targetLine = lines[lineIndex];
    const match = targetLine.match(/^([-*]\s*\[)([ xX])(\])/);
    if (match) {
      const checkCharPos = lineStart + match[1].length;
      yDoc.transact(() => {
        yText.delete(checkCharPos, 1);
        yText.insert(checkCharPos, newChecked ? 'x' : ' ');
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadFileToNote = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const fileName = file.name || 'screenshot.png';
      const fileType = file.type || 'image/png';
      const res = await api.fetch(`/api/attachments?scope=${encodeURIComponent(currentScope.value)}`, {
        method: 'POST',
        headers: {
          'Content-Type': fileType,
          'x-file-name': encodeURIComponent(fileName)
        },
        body: buffer
      });
      if (!res.ok) return;
      const data = await res.json();
      const isImg = (data.mimeType || fileType || '').startsWith('image/') && !((data.mimeType || '').includes('svg'));
      const snippet = isImg ? `![[${data.fileName || fileName}]]` : `[[${data.fileName || fileName}]]`;
      insertSnippet(snippet);
      showToast('Image inserted');
    } catch (err) {
      console.error('Failed to upload file to note:', err);
    }
  };

  return (
    <div
      class="note-editor-wrapper"
      onDragOver={(e) => {
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={async (e) => {
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            await handleUploadFileToNote(e.dataTransfer.files[i]);
          }
        }
      }}
      onPaste={async (e) => {
        const items = e.clipboardData?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              const file = items[i].getAsFile();
              if (file) {
                e.preventDefault();
                await handleUploadFileToNote(file);
                return;
              }
            }
          }
        }
      }}
    >
      {/* Note Header */}
      <div class="note-header">
        <div class="note-header-top">
          <input
            class="note-title-input"
            value={title}
            placeholder={t('notes.search_placeholder')}
            onInput={(e) => renameNote(noteId, (e.target as HTMLInputElement).value)}
          />

          <div class="note-toolbar-actions">
            {/* Close Split Button when in Split View */}
            {isSplitView.value && (
              <button
                class="note-action-btn close-split-btn"
                onClick={() => {
                  isSplitView.value = false;
                  splitTabId.value = null;
                }}
                title={t('notes.split_canvas')}
              >
                <Icon name="x" size={14} />
                <span>{t('notes.close')}</span>
              </button>
            )}

            {/* Live Preview Toggle (Ctrl+E) */}
            <button
              class={`note-action-btn ${editorMode === 'preview' ? 'active' : ''}`}
              onClick={() => setEditorMode(editorMode === 'preview' ? 'source' : 'preview')}
              title={`Mode: ${editorMode === 'preview' ? 'Live Preview' : 'Source'} (Ctrl+E)`}
            >
              <Icon name={editorMode === 'preview' ? 'eye' : 'edit'} size={15} />
              <span>{editorMode === 'preview' ? t('notes.preview_short') : t('notes.edit_short')}</span>
            </button>

            {/* Quick Insert Snippets */}
            <div class="quick-insert-group">
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('## Heading')}
                title={t('notes.heading2')}
              >
                H2
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('- [ ] Task')}
                title={t('notes.checklist')}
              >
                <Icon name="check" size={13} />
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('> [!note] Note\n> Note content')}
                title={t('notes.callout')}
              >
                <Icon name="sparkles" size={13} />
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => insertSnippet('[[Note]]')}
                title={t('notes.wikilink')}
              >
                <Icon name="link" size={13} />
              </button>
              <button
                class="quick-insert-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file or image"
              >
                <Icon name="paperclip" size={13} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={async (e) => {
                  const input = e.target as HTMLInputElement;
                  if (input.files && input.files.length > 0) {
                    for (let i = 0; i < input.files.length; i++) {
                      await handleUploadFileToNote(input.files[i]);
                    }
                    input.value = '';
                  }
                }}
              />
            </div>

            {/* Toggle Right Panel (Outline / Backlinks) */}
            <button
              class={`note-action-btn ${isRightPanelOpen ? 'active' : ''}`}
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
              title={t('notes.outline')}
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
                <span>{t('notes.outline')}</span>
              </button>
              <button
                class={`rp-tab-btn ${rightPanelTab === 'backlinks' ? 'active' : ''}`}
                onClick={() => setRightPanelTab('backlinks')}
              >
                <Icon name="link" size={13} />
                <span>{t('notes.backlinks')} ({backlinks.length})</span>
              </button>
            </div>

            <div class="right-panel-body">
              {rightPanelTab === 'outline' && (
                <OutlinePanel headings={headings} onSelectHeading={handleSelectHeading} />
              )}

              {rightPanelTab === 'backlinks' && (
                <div class="backlinks-list">
                  {linkedBoardCards.length > 0 && (
                    <div class="note-backlinks-panel" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: '14px' }}>
                      <div class="note-backlinks-title">
                        <Icon name="layout-canvas" size={13} />
                        <span>{t('notes.linked_cards')} ({linkedBoardCards.length})</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        {linkedBoardCards.map((c) => (
                          <button
                            key={c.nodeId}
                            class="note-backlink-chip"
                            title={t('notes.goto_note')}
                            onClick={() => {
                              ensureSplitTabs();
                              window.dispatchEvent(new CustomEvent('doks-focus-node', { detail: { nodeId: c.nodeId } }));
                            }}
                          >
                            <Icon name="sparkles" size={12} />
                            <span>{t('board.note_card')}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {backlinks.length === 0 ? (
                    <div class="backlinks-empty">{t('notes.no_backlinks')}</div>
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
