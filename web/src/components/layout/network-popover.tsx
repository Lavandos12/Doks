import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { agentStatus } from '../../state/yjs-client.js';
import { currentScope, setScope } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface NetworkPopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DiscoveredLanRoom {
  peerId: string;
  displayName: string;
  host: string;
  wsPort: number;
  webPort: number;
  inviteUri: string;
  lastSeen: number;
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
  discoveredLanRooms?: DiscoveredLanRoom[];
}

export function NetworkPopover({ isOpen, onClose }: NetworkPopoverProps): VNode | null {
  if (!isOpen) return null;

  const [netInfo, setNetInfo] = useState<NetworkApiInfo | null>(null);
  const [p2pEnabled, setP2pEnabled] = useState(true);
  const [manualPeer, setManualPeer] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Poll /api/network every 3s while modal is open (UDP LAN discovery)
  useEffect(() => {
    let timer: any = null;
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
    timer = setInterval(fetchInfo, 3000);
    return () => clearInterval(timer);
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

  const connectToAddress = async (target: string) => {
    if (!target.trim()) return;
    setIsConnecting(true);
    try {
      const res = await fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: target.trim() })
      });
      if (res.ok) {
        showToast(`Подключение к ${target.trim()} установлено`);
        setManualPeer('');
        // Switch to team board scope so both users immediately see the shared workspace
        setScope('team');
      } else {
        showToast('Не удалось подключиться к пиру');
      }
    } catch {
      showToast('Ошибка сети при подключении к пиру');
    } finally {
      setIsConnecting(false);
    }
  };

  const status = agentStatus.value;
  const radminIp = netInfo?.detectedRadminIp || status?.radminIp;
  const effectiveIp = radminIp || netInfo?.lanIp || status?.effectiveIp || '127.0.0.1';
  const webPort = (netInfo as any)?.webPort || status?.webPort || 3000;
  const effectivePort = netInfo?.port || status?.peerPort || 4747;
  const browserDirectUrl = `http://${effectiveIp}:${webPort}`;
  const inviteLink = netInfo?.inviteUri || (status as any)?.inviteLink || `doks://${effectiveIp}:${effectivePort}#common-key`;

  const copyBrowserUrl = () => {
    navigator.clipboard.writeText(browserDirectUrl);
    showToast('Ссылка для браузера скопирована: ' + browserDirectUrl);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    showToast('Ссылка doks:// скопирована в буфер обмена');
  };

  const discoveredRooms = netInfo?.discoveredLanRooms || [];

  return (
    <div class="network-popover-backdrop" onClick={onClose}>
      <div
        class="modal-card doks-modal-dialog liquid-glass-surface"
        style={{ maxWidth: '580px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="modal-header">
          <div class="modal-header-icon-title">
            <Icon name="globe-mesh" size={20} class="text-accent" />
            <div>
              <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                Сеть Radmin VPN
              </h3>
              <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                Ваш IP в сети: <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{effectiveIp}</span> ({radminIp ? 'Radmin VPN активен' : 'Локальная сеть'})
              </div>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Master Switch */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '13px' }}>
                P2P-Служба & LAN Обнаружение
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                Рассылает UDP-маячки по сети Radmin VPN (26.255.255.255)
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

          {/* Способ 1: Вход через браузер (1 клик) */}
          <div style={{
            padding: '14px',
            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(129, 140, 248, 0.04) 100%)',
            borderRadius: '10px',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>
                Способ 1 — Мгновенный вход через браузер
              </span>
              <span style={{ fontSize: '10.5px', background: 'rgba(56, 189, 248, 0.2)', color: '#7dd3fc', padding: '2px 6px', borderRadius: '4px' }}>
                Без установки Doks!
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.4' }}>
              Отправьте эту ссылку другу из вашей сети Radmin VPN — он откроет её в обычном браузере (Chrome, Yandex, Edge) и сразу окажется на вашей доске в реальном времени с курсорами:
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
              <input
                type="text"
                readonly
                value={browserDirectUrl}
                style={{ flex: 1, fontFamily: 'monospace', fontSize: '12.5px', background: '#0b0f19', color: '#38bdf8' }}
              />
              <button
                type="button"
                class="btn-primary"
                style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}
                onClick={copyBrowserUrl}
              >
                <Icon name="copy" size={13} />
                <span>Скопировать ссылку</span>
              </button>
            </div>
          </div>

          {/* Способ 2: Автопоиск комнат в Radmin VPN */}
          <div style={{
            padding: '14px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                Способ 2 — Доступные комнаты в сети Radmin VPN
              </span>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                Автопоиск комнат
              </span>
            </div>

            {discoveredRooms.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {discoveredRooms.map((room) => (
                  <div
                    key={room.peerId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                        {room.displayName}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#94a3b8', fontFamily: 'monospace' }}>
                        {room.host}:{room.wsPort}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn-primary-xs"
                      style={{ padding: '6px 12px' }}
                      onClick={() => connectToAddress(room.inviteUri || `${room.host}:${room.wsPort}`)}
                    >
                      <span>Подключиться к доске</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '12px',
                textAlign: 'center',
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '8px',
                color: '#94a3b8',
                fontSize: '12px'
              }}>
                Поиск комнат в вашей сети Radmin VPN... (убедитесь, что у друга тоже запущен Doks)
              </div>
            )}
          </div>

          {/* Способ 3: Подключение по IP или коду комнаты */}
          <div style={{
            padding: '14px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
              Способ 3 — Подключение по IP или ссылке doks://
            </span>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input
                type="text"
                placeholder="26.x.x.x или doks://26.x.x.x:4747#key"
                value={manualPeer}
                onInput={(e) => setManualPeer((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') connectToAddress(manualPeer);
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                class="btn-primary"
                disabled={!manualPeer.trim() || isConnecting}
                onClick={() => connectToAddress(manualPeer)}
                style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
              >
                {isConnecting ? 'Связь...' : 'Подключиться'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
              <button
                type="button"
                class="btn-link"
                style={{ fontSize: '11px', color: '#94a3b8', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={copyInviteLink}
              >
                Скопировать код doks:// для десктопа
              </button>
            </div>
          </div>

          {/* Список подключённых соавторов */}
          {netInfo?.peers && netInfo.peers.length > 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '12px 14px',
              background: 'rgba(16, 185, 129, 0.05)',
              borderRadius: '10px',
              border: '1px solid rgba(16, 185, 129, 0.2)'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#34d399' }}>
                Подключённые соавторы ({netInfo.peers.length})
              </div>
              {netInfo.peers.map((p, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span class="status-dot green" />
                    <span style={{ color: '#f1f5f9' }}>{p.memberName || p.peerId.slice(0, 8)}</span>
                    {p.address && <span style={{ color: '#94a3b8' }}>({p.address})</span>}
                  </div>
                  <span style={{ color: '#10b981', fontSize: '11px' }}>На доске</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
