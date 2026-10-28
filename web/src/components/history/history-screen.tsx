import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { SnapshotMeta } from '@doks/shared';
import { getScopedBoardDocName, getBoardMaps } from '@doks/shared';
import {
  allTrashNotes,
  allTrashBoards,
  restoreNote,
  restoreBoard,
  openTab,
  emptyTrash,
  yjsClient,
  currentScope,
  selectedBoardId
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
  const activeBoardId = selectedBoardId.value;

  const [deletedCanvasNodes, setDeletedCanvasNodes] = useState<{ id: string; type: string; text: string }[]>([]);

  const refreshDeletedNodes = () => {
    if (!activeBoardId) {
      setDeletedCanvasNodes([]);
      return;
    }
    try {
      const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeBoardId));
      const { nodes } = getBoardMaps(bDoc);
      const list: { id: string; type: string; text: string }[] = [];
      nodes.forEach((nodeMap: any, id: string) => {
        if (nodeMap && nodeMap.get && nodeMap.get('deleted') === true) {
          list.push({
            id,
            type: nodeMap.get('type') || 'object',
            text: (nodeMap.get('text') || '').slice(0, 60) || nodeMap.get('type') || 'Объект'
          });
        }
      });
      setDeletedCanvasNodes(list);
    } catch {
      setDeletedCanvasNodes([]);
    }
  };

  const handleRestoreNode = (nodeId: string) => {
    if (!activeBoardId) return;
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
      message: 'Вы уверены, что хотите окончательно удалить все объекты из корзины? Это действие необратимо.',
      confirmText: t('trash.clear_all'),
      danger: true
    });
    if (!ok) return;

    emptyTrash();
    // Also permanently remove deleted nodes from current board
    if (activeBoardId) {
      try {
        const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeBoardId));
        const { nodes } = getBoardMaps(bDoc);
        bDoc.transact(() => {
          deletedCanvasNodes.forEach((n) => nodes.delete(n.id));
        }, 'user');
        refreshDeletedNodes();
      } catch {}
    }
    showToast('Корзина полностью очищена', 'success');
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
        setMessage('Снимок успешно создан');
        fetchSnapshots();
      }
    } catch {
      setMessage('Ошибка создания снимка');
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleRestoreSnapshot = async (id: string) => {
    const ok = await showConfirm({
      title: 'Восстановление снимка',
      message: 'Вы уверены, что хотите восстановить состояние из этого снимка? Текущие несохраненные правки будут перезаписаны.',
      confirmText: 'Восстановить',
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
        setMessage('Состояние успешно восстановлено');
      }
    } catch {
      setMessage('Ошибка восстановления снимка');
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
              title="Закрыть"
              aria-label="Закрыть"
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
              Снимки создаются автоматически каждые 10 минут при наличии правок. Хранятся последние 100 снимков.
            </span>
          </div>

          <div class="snapshots-list">
            {snapshots.length === 0 ? (
              <div class="empty-state">Нет сохраненных снимков</div>
            ) : (
              snapshots.map((snap) => (
                <div key={snap.id} class="snapshot-card">
                  <div class="snap-details">
                    <span class="snap-date">{snap.dateStr}</span>
                    <span class="snap-badge">Документов: {snap.docsCount}</span>
                    <span class="snap-size">
                      {(snap.sizeBytes / 1024).toFixed(1)} КБ
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
              Удаленные объекты хранятся в корзине 30 дней, после чего автоматически очищаются.
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
                        {note.deletedAt ? new Date(note.deletedAt).toLocaleString('ru-RU') : 'недавно'}
                      </span>
                    </div>
                    <button
                      class="btn-restore"
                      onClick={() => {
                        restoreNote(note.id, note.scope);
                        openTab('note', note.id, note.title);
                      }}
                    >
                      {t('trash.restore')}
                    </button>
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
                        {b.deletedAt ? new Date(b.deletedAt).toLocaleString('ru-RU') : 'недавно'}
                      </span>
                    </div>
                    <button
                      class="btn-restore"
                      onClick={() => {
                        restoreBoard(b.id, b.scope);
                        openTab('board', b.id, b.title);
                      }}
                    >
                      {t('trash.restore')}
                    </button>
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
