import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  notes,
  createNote,
  renameNote,
  deleteNote,
  currentScope,
  setScope,
  yjsClient,
  getScopedNoteDocName,
  isViewerMode
} from '../../state/app-state.js';
import { MarkdownPreview } from '../notes/markdown-preview.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { t } from '../../i18n/index.js';

interface NotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onDropNoteToCanvas?: (noteId: string, title: string, text: string) => void;
}

export function NotesDrawer({
  isOpen,
  onClose,
  onDropNoteToCanvas
}: NotesDrawerProps): VNode | null {
  if (!isOpen) return null;

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const isViewer = Boolean(isViewerMode.value);
  const [selectedId, setSelectedId] = useState<string>(() => {
    return activeNotes[0]?.id || '';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const effectivePreview = isViewer ? true : previewMode;

  // If selectedId changed or list changed, sync current note data
  useEffect(() => {
    if (!selectedId && activeNotes.length > 0) {
      setSelectedId(activeNotes[0].id);
      return;
    }

    if (selectedId) {
      const n = activeNotes.find((x) => x.id === selectedId);
      if (n) {
        setNoteTitle(n.title);
        try {
          const doc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, selectedId));
          const yText = doc.getText('text');
          setNoteText(yText.toString());
        } catch {
          setNoteText('');
        }
      }
    }
  }, [selectedId, activeNotes.length, currentScope.value]);

  const handleCreateNew = () => {
    const newId = createNote(t('notes.new_note'));
    setSelectedId(newId);
    setPreviewMode(false);
    showToast(t('notes.new_note'));
  };

  const handleDeleteNote = () => {
    if (!selectedId) return;
    if (confirm(`${t('notes.delete_confirm')}`.replace('{title}', noteTitle || t('notes.untitled')))) {
      deleteNote(selectedId);
      showToast(t('notes.delete_success'));
      const remaining = activeNotes.filter((n) => n.id !== selectedId);
      setSelectedId(remaining[0]?.id || '');
    }
  };

  const handleTextChange = (newVal: string) => {
    setNoteText(newVal);
    if (selectedId) {
      try {
        const doc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, selectedId));
        const yText = doc.getText('text');
        doc.transact(() => {
          yText.delete(0, yText.length);
          yText.insert(0, newVal);
        }, 'user');
      } catch (err) {
        console.error('Failed to sync note text:', err);
      }
    }
  };

  const handleDropToCanvas = () => {
    if (!selectedId) return;
    onDropNoteToCanvas?.(selectedId, noteTitle || t('notes.default_title'), noteText);
    showToast(t('notes.drop_canvas'));
  };

  const filtered = activeNotes.filter((n) =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      class="notes-slide-drawer miro-notes-drawer liquid-glass-surface"
      data-testid="notes-slide-drawer"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div class="notes-drawer-header">
        <div class="notes-drawer-title-row">
          <Icon name="file-text" size={17} class="text-accent" />
          <span>{t('topbar.notes')} ({currentScope.value === 'solo' ? t('topbar.solo') : t('topbar.team')})</span>
        </div>
        <div class="notes-drawer-actions">
          {selectedId && !isViewer && (
            <>
              <button
                class={`btn-ghost-xs ${previewMode ? 'active' : ''}`}
                onClick={() => setPreviewMode(!previewMode)}
                title={previewMode ? t('notes.edit') : t('notes.preview')}
              >
                <Icon name={previewMode ? 'edit' : 'eye'} size={14} />
              </button>
              <button
                class="btn-ghost-xs text-danger"
                onClick={handleDeleteNote}
                title={t("sidebar.delete_note")}
              >
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
          {!isViewer && (
            <button class="btn-primary-xs" onClick={handleCreateNew} title={t("notes.new_note")}>
              <Icon name="plus" size={13} />
              <span>{t("notes.new_note")}</span>
            </button>
          )}
          <button class="modal-close-btn" onClick={onClose} aria-label={t("ai.close")}>
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {/* 2-Segment Scope Switcher */}
      <div style={{ display: 'flex', padding: '3px', background: '#090a0f', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', margin: '4px 16px 12px' }}>
        <button
          type="button"
          onClick={() => setScope('solo')}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            ...(currentScope.value === 'solo'
              ? { background: '#7c3aed', color: '#ffffff', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)' }
              : { background: 'transparent', color: '#94a3b8' })
          }}
        >
          <Icon name="lock" size={12} />
          <span>Solo</span>
        </button>
        <button
          type="button"
          onClick={() => setScope('team')}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            ...(currentScope.value === 'team'
              ? { background: '#7c3aed', color: '#ffffff', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)' }
              : { background: 'transparent', color: '#94a3b8' })
          }}
        >
          <Icon name="users" size={12} />
          <span>Shared</span>
        </button>
      </div>

      {/* Body */}
      <div class="notes-drawer-body">
        {/* Search */}
        <div class="notes-drawer-search-bar">
          <Icon name="search" size={13} color="#94a3b8" />
          <input
            type="text"
            class="notes-drawer-search-input"
            placeholder={t("notes.search_placeholder")}
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Note list */}
        {filtered.length > 0 && (
          <div class="notes-drawer-list">
            {filtered.map((n) => (
              <div
                key={n.id}
                class={`notes-drawer-item ${n.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(n.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  <Icon name="file-text" size={12} />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {n.title || t('notes.untitled')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Editor Area */}
        {selectedId ? (
          <div class="notes-drawer-editor-area">
            <input
              type="text"
              class="notes-drawer-note-title"
              value={noteTitle}
              readOnly={isViewer}
              onInput={(e) => {
                if (isViewer) return;
                const newVal = (e.target as HTMLInputElement).value;
                setNoteTitle(newVal);
                renameNote(selectedId, newVal);
              }}
              placeholder={t("sidebar.new_note")}
            />
            {effectivePreview ? (
              <div class="notes-drawer-editor-body preview-scroll" style={{ overflowY: 'auto' }}>
                <MarkdownPreview content={noteText} />
              </div>
            ) : (
              <textarea
                class="notes-drawer-editor-body"
                value={noteText}
                onInput={(e) => handleTextChange((e.target as HTMLTextAreaElement).value)}
                placeholder={t('notes.editor_placeholder')}
              />
            )}
          </div>
        ) : (
          <div class="miro-empty-notes">
            <Icon name="file-text" size={32} />
            <p>{t("notes.no_notes")}</p>
            {!isViewer && (
              <button class="btn-primary-sm" onClick={handleCreateNew}>
                {t("sidebar.create_note")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedId && (
        <div class="notes-drawer-footer">
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            Markdown
          </span>
          {!isViewer && (
            <button class="btn-drop-to-canvas" onClick={handleDropToCanvas} title={t("notes.drop_canvas")}>
              <Icon name="plus" size={13} />
              <span>{t("notes.drop_canvas")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
