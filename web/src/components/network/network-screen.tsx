import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { PeerStatus } from '@doks/shared';

export function NetworkScreen() {
  const [status, setStatus] = useState<any>(null);
  const [newPeerAddr, setNewPeerAddr] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

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

  const inviteString = status
    ? `doks://${status.bindAddress || '26.x.x.x'}:${status.peerPort || 4747}#${status.teamKey}`
    : '';

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
        <h2>Участники и Сеть (Radmin VPN)</h2>
      </div>

      <div class="network-cards-grid">
        {/* Profile Card */}
        <div class="network-card">
          <h3>Ваш узел</h3>
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
                Radmin IP: <strong>{status?.bindAddress || '26.x.x.x'}</strong> (Порт: {status?.peerPort || 4747})
              </span>
              <span class="profile-id">ID: {status?.agentId}</span>
            </div>
          </div>
        </div>

        {/* Invite Card */}
        <div class="network-card">
          <h3>Приглашение для команды</h3>
          <p class="card-desc">
            Передайте эту строку другим участникам вашей комнаты в Radmin VPN:
          </p>
          <div class="invite-box">
            <input
              type="text"
              readonly
              class="invite-input"
              value={inviteString}
            />
            <button class="btn-primary" onClick={copyInvite}>
              {copyFeedback ? 'Скопировано!' : 'Копировать'}
            </button>
          </div>
        </div>
      </div>

      {/* Peers Section */}
      <div class="peers-section">
        <div class="section-title-bar">
          <h3>Подключенные пиры ({status?.connectedCount || 0})</h3>
        </div>

        {/* Add Peer Bar */}
        <div class="add-peer-bar">
          <input
            type="text"
            class="peer-input"
            placeholder="Введите IP:порт или строку doks://26.x.x.x:4747#key"
            value={newPeerAddr}
            onInput={(e) => setNewPeerAddr((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPeer()}
          />
          <button class="btn-primary" onClick={handleAddPeer} disabled={loading}>
            Добавить пир
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
                    Нет добавленных пиров. Добавьте адрес участника сети.
                  </td>
                </tr>
              ) : (
                status.peers.map((p: PeerStatus) => (
                  <tr key={p.address}>
                    <td>
                      <span class={`status-pill ${p.connected ? 'online' : 'offline'}`}>
                        {p.connected ? 'Онлайн' : 'Офлайн'}
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
                      >
                        Удалить
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
