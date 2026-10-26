import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { agentStatus } from '../../state/yjs-client.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface NetworkPopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NetworkApiInfo {
  p2pEnabled: boolean;
  detectedRadminIp: string | null;
  lanIp: string | null;
  effectiveIp: string;
  port: number;
  peerId: string;
  inviteUri: string;
  peers?: Array<{ peerId: string; address?: string; state?: string; memberName?: string }>;
}

export function NetworkPopover({ isOpen, onClose }: NetworkPopoverProps): VNode | null {
  if (!isOpen) return null;

  const [netInfo, setNetInfo] = useState<NetworkApiInfo | null>(null);
  const [p2pEnabled, setP2pEnabled] = useState(true);
  const [manualPeer, setManualPeer] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Fetch full network status from /api/network
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch('/api/network');
        if (res.ok) {
          const data = await res.json();
          setNetInfo(data);
          setP2pEnabled(Boolean(data.p2pEnabled));
        }
      } catch (err) {
        console.error('Failed to load /api/network:', err);
      }
    };
    fetchInfo();
  }, [isOpen]);

  const handleToggleP2P = async () => {
    const nextVal = !p2pEnabled;
    setP2pEnabled(nextVal);
    try {
      const res = await fetch('/api/network/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextVal })
      });
      if (res.ok) {
        showToast(nextVal ? 'P2P синхронизация включена' : 'P2P синхронизация выключена');
      }
    } catch {
      showToast('Ошибка при переключении режима P2P');
    }
  };

  const handleConnectPeer = async () => {
    if (!manualPeer.trim()) return;
    setIsConnecting(true);
    try {
      const res = await fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: manualPeer.trim() })
      });
      if (res.ok) {
        showToast(`Запрос на подключение к ${manualPeer.trim()} отправлен`);
        setManualPeer('');
      } else {
        showToast('Не удалось подключиться к пиру');
      }
    } catch {
      showToast('Ошибка сети при подключении к пиру');
    } finally {
      setIsConnecting(false);
    }
  };

  const effectiveIp = netInfo?.detectedRadminIp || netInfo?.lanIp || agentStatus.value?.effectiveIp || '127.0.0.1';
  const effectivePort = netInfo?.port || agentStatus.value?.peerPort || 4747;
  const inviteLink = netInfo?.inviteUri || (agentStatus.value as any)?.inviteLink || `doks://${effectiveIp}:${effectivePort}#common-key`;

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    showToast('Ссылка приглашения скопирована в буфер обмена');
  };

  return (
    <div class="network-popover-backdrop" onClick={onClose}>
      <div class="modal-card doks-modal-dialog liquid-glass-surface" style={{ maxWidth: '520px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="modal-header">
          <div class="modal-header-icon-title">
            <Icon name="globe-mesh" size={20} class="text-accent" />
            <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
              Подключение Radmin VPN / Сеть
            </h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Master Switch */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '13.5px' }}>
                P2P Синхронизация (Radmin VPN / LAN)
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                Позволяет участникам находить и синхронизировать доску в реальном времени
              </div>
            </div>
            <button
              type="button"
              class={`network-switch-btn ${p2pEnabled ? 'active' : ''}`}
              onClick={handleToggleP2P}
            >
              {p2pEnabled ? 'Вкл' : 'Выкл'}
            </button>
          </div>

          {/* Status Section */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12.5px', color: '#94a3b8', fontWeight: 500 }}>
              Сетевой адрес в Radmin VPN / Локальной сети
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: '#0d0f17',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.12)'
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#38bdf8' }}>
                {effectiveIp}:{effectivePort}
              </span>
              <span class="network-kind-badge" style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: netInfo?.detectedRadminIp ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: netInfo?.detectedRadminIp ? '#34d399' : '#cbd5e1'
              }}>
                {netInfo?.detectedRadminIp ? 'Radmin VPN' : 'LAN / Local'}
              </span>
            </div>
          </div>

          {/* Invite Link */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12.5px', color: '#94a3b8', fontWeight: 500 }}>
              Ссылка для приглашения соавторов
            </label>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input
                type="text"
                readonly
                value={inviteLink}
                style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px' }}
              />
              <button
                type="button"
                class="btn-primary"
                style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}
                onClick={copyInviteLink}
              >
                <Icon name="copy" size={13} />
                <span>Копировать</span>
              </button>
            </div>
          </div>

          {/* Manual Connect to Friend */}
          <div class="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12.5px', color: '#94a3b8', fontWeight: 500 }}>
              Подключиться к другу или комнате
            </label>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input
                type="text"
                placeholder="Вставьте doks://26.x.x.x:4747#key или IP:порт"
                value={manualPeer}
                onInput={(e) => setManualPeer((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnectPeer();
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                class="btn-primary"
                disabled={!manualPeer.trim() || isConnecting}
                onClick={handleConnectPeer}
                style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
              >
                {isConnecting ? 'Связь...' : 'Подключить'}
              </button>
            </div>
          </div>

          {/* Active Peers */}
          {netInfo?.peers && netInfo.peers.length > 0 && (
            <div class="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12.5px', color: '#94a3b8', fontWeight: 500 }}>
                Подключённые соавторы ({netInfo.peers.length})
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {netInfo.peers.map((p, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span class="status-dot green" />
                      <span style={{ fontSize: '13px', color: '#f1f5f9' }}>{p.memberName || p.peerId.slice(0, 8)}</span>
                      {p.address && <span style={{ fontSize: '11px', color: '#94a3b8' }}>({p.address})</span>}
                    </div>
                    <span style={{ fontSize: '11px', color: '#10b981' }}>Активен</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
