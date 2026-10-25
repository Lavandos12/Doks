import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { PeerStatus } from '@doks/shared';
import { Icon } from '../../ui/icons.js';

const AUTHOR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
];

import { showConfirm, showPrompt } from '../../ui/dialogs.js';
import { showToast } from '../../ui/toast.js';

export function NetworkScreen() {
  const [status, setStatus] = useState<any>(null);
  const [newPeerAddr, setNewPeerAddr] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [loading, setLoading] = useState(false);

  // Profile editing (B10)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (!isEditingProfile) {
          setEditName(data.memberName || '');
          setEditColor(data.memberColor || '#3b82f6');
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveProfile = async () => {
    if (!editName.trim()) return;
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberName: editName.trim(),
          memberColor: editColor
        })
      });
      if (res.ok) {
        setIsEditingProfile(false);
        fetchStatus();
      }
    } catch {}
  };

  const handleAddPeer = async () => {
    if (!newPeerAddr.trim()) return;
    setLoading(true);
    try {
      await fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newPeerAddr.trim() })
      });
      setNewPeerAddr('');
      fetchStatus();
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePeer = async (address: string) => {
    try {
      await fetch('/api/peers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      fetchStatus();
    } catch {}
  };

  const inviteString = status?.inviteLink || (status?.effectiveIp ? `doks://${status.effectiveIp}:${status.peerPort}` : '');

  const copyInvite = () => {
    if (inviteString) {
      navigator.clipboard.writeText(inviteString);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  return (
    <div class="network-screen">
      <div class="screen-header">
        <div class="screen-title-group">
          <h2>Участники и Сеть (Radmin VPN)</h2>
          <span class="screen-subtitle">Mesh-синхронизация без выделенного сервера</span>
        </div>

        {status?.radminFound ? (
          <div class="radmin-screen-badge ok">
            <Icon name="wifi" size={16} />
            <span>Radmin активен: {status.effectiveIp}</span>
          </div>
        ) : (
          <div class="radmin-screen-badge warn">
            <Icon name="wifi-off" size={16} />
            <span>Radmin не обнаружен (проверьте включение VPN)</span>
          </div>
        )}
      </div>

      <div class="network-cards-grid">
        {/* Profile Card (B10) */}
        <div class="network-card">
          <div class="card-header-bar">
            <h3>Ваш профиль соавтора</h3>
            {!isEditingProfile && (
              <button class="card-action-link" onClick={() => setIsEditingProfile(true)}>
                <Icon name="edit" size={13} />
                <span>Изменить</span>
              </button>
            )}
          </div>

          {isEditingProfile ? (
            <div class="profile-edit-form">
              <label class="form-label">Имя или позывной</label>
              <input
                type="text"
                class="form-input"
                value={editName}
                onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                maxLength={32}
              />

              <label class="form-label">Цвет курсора и стикеров</label>
              <div class="color-palette-picker">
                {AUTHOR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    class={`color-circle-btn ${editColor === c ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditColor(c)}
                  />
                ))}
              </div>

              <div class="form-buttons">
                <button class="btn-cancel" onClick={() => setIsEditingProfile(false)}>
                  Отмена
                </button>
                <button class="btn-primary" onClick={handleSaveProfile}>
                  Сохранить
                </button>
              </div>
            </div>
          ) : (
            <div class="node-profile">
              <div
                class="avatar-circle"
                style={{ backgroundColor: status?.memberColor || '#3b82f6' }}
              >
                {(status?.memberName || 'U')[0].toUpperCase()}
              </div>
              <div class="profile-details">
                <span class="profile-name">{status?.memberName || 'Пользователь'}</span>
                <span class="profile-ip">
                  Сетевой адрес: <strong>{status?.effectiveIp || '26.x.x.x'}</strong> (Порт: {status?.peerPort || 4747})
                </span>
                <span class="profile-id">ID узла: {status?.agentId}</span>
              </div>
            </div>
          )}
        </div>

        {/* Invite Card */}
        <div class="network-card">
          <div class="card-header-bar">
            <h3>Приглашение и ключ команды</h3>
            {status?.keyFingerprint && (
              <span class="fingerprint-badge" title="Отпечаток ключа команды для сверки">
                Отпечаток: <strong>{status.keyFingerprint}</strong>
              </span>
            )}
          </div>
          <p class="card-desc">
            Передайте эту защищённую ссылку участнику вашей комнаты Radmin VPN для автоматического подключения:
          </p>
          <div class="invite-box">
            <input
              type="text"
              readonly
              class="invite-input"
              value={inviteString}
              placeholder="Генерация ссылки приглашения..."
            />
            <button class="btn-primary" onClick={copyInvite}>
              <Icon name={copyFeedback ? 'check' : 'share'} size={15} />
              <span>{copyFeedback ? 'Скопировано!' : 'Копировать'}</span>
            </button>
          </div>

          <div class="key-management-bar" style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              class="card-action-link danger"
              onClick={async () => {
                const confirmed = await showConfirm({
                  title: 'Смена ключа команды',
                  message: 'Вы собираетесь сменить ключ команды. Внимание: Вы переходите в другую команду. Данные текущей команды останутся на диске (будет автоматически создана резервная копия), но синхронизироваться со старой командой перестанут.\n\nПродолжить?',
                  confirmText: 'Продолжить',
                  danger: true
                });
                if (confirmed) {
                  const newKey = await showPrompt({
                    title: 'Новый ключ команды',
                    message: 'Введите 64-символьный ключ команды (или оставьте пустым для генерации нового случайного ключа):',
                    placeholder: '64 hex-символа...'
                  });
                  if (newKey !== null) {
                    const generatedKey = newKey.trim() || Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
                    if (generatedKey.length === 64) {
                      await fetch('/api/team-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ teamKey: generatedKey })
                      });
                      showToast('Ключ команды успешно изменен', 'success');
                      fetchStatus();
                    } else {
                      showToast('Ключ должен быть ровно 64 hex-символа', 'error');
                    }
                  }
                }
              }}
            >
              <Icon name="settings" size={13} />
              <span>Сменить ключ команды</span>
            </button>
          </div>
        </div>
      </div>

      {/* Peers Section */}
      <div class="peers-section">
        <div class="section-title-bar">
          <h3>Участники в сети ({status?.connectedCount || 0} подключено)</h3>
        </div>

        {/* Add Peer Bar */}
        <div class="add-peer-bar">
          <input
            type="text"
            class="peer-input"
            placeholder="Введите IP:порт или строку doks://26.x.x.x:4747#teamKey"
            value={newPeerAddr}
            onInput={(e) => setNewPeerAddr((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPeer()}
          />
          <button class="btn-primary" onClick={handleAddPeer} disabled={loading}>
            <Icon name="plus" size={15} />
            <span>Добавить пир</span>
          </button>
        </div>

        {/* Peers List */}
        <div class="peers-table-wrapper">
          <table class="peers-table">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Имя / Адрес</th>
                <th>Peer ID</th>
                <th>Тип</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {!status?.peers || status.peers.length === 0 ? (
                <tr>
                  <td colspan={5} class="table-empty">
                    Нет добавленных пиров. Вставьте строку приглашения или IP другого компьютера.
                  </td>
                </tr>
              ) : (
                status.peers.map((p: PeerStatus) => (
                  <tr key={p.address}>
                    <td>
                      <span class={`status-pill ${p.connected ? 'online' : 'offline'}`}>
                        <span class="status-dot"></span>
                        {p.connected ? 'В сети' : 'Офлайн'}
                      </span>
                    </td>
                    <td>
                      <strong>{p.name || p.address}</strong>
                      {p.name && <div class="sub-address">{p.address}</div>}
                    </td>
                    <td>
                      <code>{p.peerId ? p.peerId.slice(0, 8) + '...' : '—'}</code>
                    </td>
                    <td>{p.isOutbound ? 'Исходящий' : 'Входящий'}</td>
                    <td>
                      <button
                        class="btn-delete-peer"
                        onClick={() => handleRemovePeer(p.address)}
                        title="Удалить соединение"
                      >
                        <Icon name="trash" size={13} />
                        <span>Удалить</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
