import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { SnapshotMeta } from '@doks/shared';
import { getScopedBoardDocName, getBoardMaps } from '@doks/shared';
import {
  allTrashNotes,
  allTrashBoards,
  restoreNote,
  restoreBoard,
  permanentlyDeleteBoard,
  permanentlyDeleteNote,
  openTab,
  emptyTrash,
  yjsClient,
  currentScope,
  selectedBoardId,
  activeTabId
} from '../../state/app-state.js';
import { api } from '../../api/client.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';
import { showConfirm } from '../../ui/dialogs.js';
import { showToast } from '../../ui/toast.js';

interface HistoryScreenProps {
  onClose?: () => void;
}

export function HistoryScreen({ onClose }: HistoryScreenProps = {}) {
  const [tab, setTab] = useState<'trash' | 'snapshots'>('trash');
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const deletedNotes = allTrashNotes.value;
  const deletedBoards = allTrashBoards.value;
  const activeBoardId = activeTabId.value || selectedBoardId.value || 'default';

  const [deletedCanvasNodes, setDeletedCanvasNodes] = useState<{ id: string; type: string; text: string }[]>([]);

  const refreshDeletedNodes = () => {
    try {
      const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeBoardId));
      const { nodes } = getBoardMaps(bDoc);
      const list: { id: string; type: string; text: string }[] = [];
      nodes.forEach((nodeMap: any, id: string) => {
        if (nodeMap && nodeMap.get && nodeMap.get('deleted') === true) {
          list.push({
            id,
            type: nodeMap.get('type') || 'sticky',
            text: (nodeMap.get('text') || nodeMap.get('fileName') || '').toString().slice(0, 50) || t('trash.deleted_node')
          });
        }
      });
      setDeletedCanvasNodes(list);
    } catch {
      setDeletedCanvasNodes([]);
    }
  };

  const handleRestoreNode = (nodeId: string) => {
    try {
      const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeBoardId));
      const { nodes } = getBoardMaps(bDoc);
      const nodeMap = nodes.get(nodeId);
      if (nodeMap) {
        bDoc.transact(() => {
          nodeMap.set('deleted', false);
        }, 'user');
        refreshDeletedNodes();
        showToast(t('trash.restore'), 'success');
      }
    } catch {}
  };

  const handleEmptyTrash = async () => {
    const ok = await showConfirm({
      title: t('trash.clear_all'),
      message: t('trash.clear_confirm'),
      confirmText: t('trash.clear_all'),
      danger: true
    });
    if (!ok) return;

    emptyTrash();
    // Also permanently remove deleted nodes from current board
    try {
      const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeBoardId));
      const { nodes } = getBoardMaps(bDoc);
      bDoc.transact(() => {
        deletedCanvasNodes.forEach((n) => nodes.delete(n.id));
      }, 'user');
      refreshDeletedNodes();
    } catch {}
    showToast(t('trash.cleared_toast'), 'success');
  };

  const fetchSnapshots = async () => {
    try {
      const res = await api.fetch('/api/snapshots');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchSnapshots();
    refreshDeletedNodes();
  }, [activeBoardId]);

  const handleCreateSnapshot = async () => {
    setLoading(true);
    try {
      const res = await api.fetch('/api/snapshots', { method: 'POST' });
      if (res.ok) {
        setMessage(t('history.snapshot_success'));
        fetchSnapshots();
      }
    } catch {
      setMessage(t('history.snapshot_error'));
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleRestoreSnapshot = async (id: string) => {
    const ok = await showConfirm({
      title: t('history.restore_title'),
      message: t('history.restore_confirm'),
      confirmText: t('history.restore_btn'),
      danger: true
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await api.fetch('/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: id })
      });
      if (res.ok) {
        setMessage(t('history.restore_success'));
      }
    } catch {
      setMessage(t('history.restore_error'));
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const totalTrashCount = deletedNotes.length + deletedBoards.length + deletedCanvasNodes.length;

  return (
    <div class="history-screen">
      <div class="screen-header">
        <div class="screen-title-group">
          <h2>{t('trash.modal_title')}</h2>
          <span class="screen-subtitle">{t('trash.modal_subtitle')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div class="history-tabs">
            <button
              class={`history-tab-btn ${tab === 'trash' ? 'active' : ''}`}
              onClick={() => setTab('trash')}
            >
              <Icon name="trash" size={14} />
              <span>{t('trash.tab_trash')} ({totalTrashCount})</span>
            </button>
            <button
              class={`history-tab-btn ${tab === 'snapshots' ? 'active' : ''}`}
              onClick={() => setTab('snapshots')}
            >
              <Icon name="history" size={14} />
              <span>{t('trash.tab_snapshots')} ({snapshots.length})</span>
            </button>
          </div>
          {onClose && (
            <button
              class="modal-close-btn"
              onClick={onClose}
              title={t('history.close')}
              aria-label={t('history.close')}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </div>

      {message && <div class="alert-banner">{message}</div>}

      {tab === 'snapshots' && (
        <div class="snapshots-section">
          <div class="snapshots-toolbar">
            <button
              class="btn-primary"
              onClick={handleCreateSnapshot}
              disabled={loading}
            >
              <Icon name="history" size={15} />
              <span>{t('trash.create_snapshot')}</span>
            </button>
            <span class="snapshots-info">
              {t('history.snapshots_info')}
            </span>
          </div>

          <div class="snapshots-list">
            {snapshots.length === 0 ? (
              <div class="empty-state">{t('history.no_snapshots')}</div>
            ) : (
              snapshots.map((snap) => (
                <div key={snap.id} class="snapshot-card">
                  <div class="snap-details">
                    <span class="snap-date">{snap.dateStr}</span>
                    <span class="snap-badge">{t('history.docs_count')}: {snap.docsCount}</span>
                    <span class="snap-size">
                      {(snap.sizeBytes / 1024).toFixed(1)} {t('history.kb')}
                    </span>
                  </div>
                  <button
                    class="btn-secondary"
                    onClick={() => handleRestoreSnapshot(snap.id)}
                    disabled={loading}
                  >
                    {t('trash.restore')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'trash' && (
        <div class="trash-section">
          <div class="trash-info-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span>
              {t('trash.info_retention')}
            </span>
            {totalTrashCount > 0 && (
              <button
                type="button"
                class="btn-secondary"
                style={{ color: '#fb7185', borderColor: 'rgba(251, 113, 133, 0.3)', padding: '4px 10px', fontSize: '12px' }}
                onClick={handleEmptyTrash}
              >
                <Icon name="trash" size={13} />
                <span>{t('trash.clear_all')}</span>
              </button>
            )}
          </div>

          <div class="trash-list">
            {totalTrashCount === 0 ? (
              <div class="empty-state">{t('trash.empty')}</div>
            ) : (
              <div>
                {/* Deleted Canvas Nodes */}
                {deletedCanvasNodes.map((node) => (
                  <div key={node.id} class="trash-card">
                    <div class="trash-card-info">
                      <Icon name="layout" size={16} class="trash-icon" />
                      <span class="trash-title">{node.text}</span>
                      <span
                        class="miro-scope-badge"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 4,
                          marginLeft: 6,
                          color: '#c084fc',
                          background: 'rgba(139, 92, 246, 0.15)',
                          border: '1px solid rgba(139, 92, 246, 0.3)'
                        }}
                      >
                        {t('trash.deleted_node')} ({node.type})
                      </span>
                    </div>
                    <button
                      class="btn-restore"
                      onClick={() => handleRestoreNode(node.id)}
                    >
                      {t('trash.restore')}
                    </button>
                  </div>
                ))}

                {/* Deleted Notes */}
                {deletedNotes.map((note) => (
                  <div key={note.id} class="trash-card">
                    <div class="trash-card-info">
                      <Icon name="file-text" size={16} class="trash-icon" />
                      <span class="trash-title">{note.title}</span>
                      <span
                        class={`miro-scope-badge ${note.scope || 'solo'}`}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 4,
                          marginLeft: 6,
                          color: note.scope === 'team' ? '#34d399' : '#c084fc',
                          background: note.scope === 'team' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                          border: `1px solid ${note.scope === 'team' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`
                        }}
                      >
                        {note.scope === 'team' ? t('topbar.team') : t('topbar.solo')}
                      </span>
                      <span class="trash-date">
                        {note.deletedAt ? new Date(note.deletedAt).toLocaleString('en-US') : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        class="btn-restore"
                        onClick={() => {
                          restoreNote(note.id, note.scope);
                          openTab('note', note.id, note.title);
                        }}
                      >
                        {t('trash.restore')}
                      </button>
                      <button
                        type="button"
                        class="btn-trash-delete"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#f87171',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          permanentlyDeleteNote(note.id, note.scope);
                          showToast(`Note "${note.title}" permanently deleted`, 'info');
                        }}
                        title="Delete permanently"
                      >
                        <Icon name="trash" size={13} />
                        <span>Delete Forever</span>
                      </button>
                    </div>
                  </div>
                ))}

                {/* Deleted Boards */}
                {deletedBoards.map((b) => (
                  <div key={b.id} class="trash-card">
                    <div class="trash-card-info">
                      <Icon name="layout" size={16} class="trash-icon" />
                      <span class="trash-title">{b.title}</span>
                      <span
                        class={`miro-scope-badge ${b.scope || 'solo'}`}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 4,
                          marginLeft: 6,
                          color: b.scope === 'team' ? '#34d399' : '#c084fc',
                          background: b.scope === 'team' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                          border: `1px solid ${b.scope === 'team' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`
                        }}
                      >
                        {b.scope === 'team' ? t('topbar.team') : t('topbar.solo')}
                      </span>
                      <span class="trash-date">
                        {b.deletedAt ? new Date(b.deletedAt).toLocaleString('en-US') : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        class="btn-restore"
                        onClick={() => {
                          restoreBoard(b.id, b.scope);
                          openTab('board', b.id, b.title);
                        }}
                      >
                        {t('trash.restore')}
                      </button>
                      <button
                        type="button"
                        class="btn-trash-delete"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#f87171',
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          permanentlyDeleteBoard(b.id, b.scope);
                          showToast(`Board "${b.title}" permanently deleted`, 'info');
                        }}
                        title="Delete permanently"
                      >
                        <Icon name="trash" size={13} />
                        <span>Delete Forever</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
