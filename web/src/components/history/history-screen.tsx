import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { SnapshotMeta } from '@doks/shared';
import {
  notes,
  boards,
  restoreNote,
  openTab
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

export function HistoryScreen() {
  const [tab, setTab] = useState<'snapshots' | 'trash'>('snapshots');
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const deletedNotes = notes.value.filter((n) => n.deleted);
  const deletedBoards = boards.value.filter((b) => b.deleted);

  const fetchSnapshots = async () => {
    try {
      const res = await fetch('/api/snapshots');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchSnapshots();
  }, []);

  const handleCreateSnapshot = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/snapshots', { method: 'POST' });
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
    if (!confirm('Вы уверены, что хотите восстановить состояние из этого снимка?')) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/snapshots/restore', {
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

  return (
    <div class="history-screen">
      <div class="screen-header">
        <div class="screen-title-group">
          <h2>История и Корзина</h2>
          <span class="screen-subtitle">Резервные копии и мягкое удаление объектов</span>
        </div>
        <div class="history-tabs">
          <button
            class={`history-tab-btn ${tab === 'snapshots' ? 'active' : ''}`}
            onClick={() => setTab('snapshots')}
          >
            <Icon name="history" size={14} />
            <span>Снимки ({snapshots.length})</span>
          </button>
          <button
            class={`history-tab-btn ${tab === 'trash' ? 'active' : ''}`}
            onClick={() => setTab('trash')}
          >
            <Icon name="trash" size={14} />
            <span>Корзина ({deletedNotes.length + deletedBoards.length})</span>
          </button>
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
              <span>Создать снимок сейчас</span>
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
                    Восстановить
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'trash' && (
        <div class="trash-section">
          <div class="trash-info-bar">
            <span>
              Удаленные объекты хранятся в корзине 30 дней, после чего автоматически очищаются.
            </span>
          </div>

          <div class="trash-list">
            {deletedNotes.length === 0 && deletedBoards.length === 0 ? (
              <div class="empty-state">Корзина пуста</div>
            ) : (
              <div>
                {deletedNotes.map((note) => (
                  <div key={note.id} class="trash-card">
                    <div class="trash-card-info">
                      <Icon name="file-text" size={16} class="trash-icon" />
                      <span class="trash-title">{note.title}</span>
                      <span class="trash-date">
                        Удалено: {note.deletedAt ? new Date(note.deletedAt).toLocaleString('ru-RU') : 'недавно'}
                      </span>
                    </div>
                    <button
                      class="btn-restore"
                      onClick={() => {
                        restoreNote(note.id);
                        openTab('note', note.id, note.title);
                      }}
                    >
                      Восстановить
                    </button>
                  </div>
                ))}

                {deletedBoards.map((b) => (
                  <div key={b.id} class="trash-card">
                    <div class="trash-card-info">
                      <Icon name="layout" size={16} class="trash-icon" />
                      <span class="trash-title">{b.title}</span>
                      <span class="trash-date">
                        Удалено: {b.deletedAt ? new Date(b.deletedAt).toLocaleString('ru-RU') : 'недавно'}
                      </span>
                    </div>
                    <button
                      class="btn-restore"
                      onClick={() => {
                        b.deleted = false;
                        openTab('board', b.id, b.title);
                      }}
                    >
                      Восстановить
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
