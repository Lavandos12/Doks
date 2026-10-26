import { h } from 'preact';
import { useState } from 'preact/hooks';
import { agentStatus } from '../../state/yjs-client.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface NetworkPopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NetworkPopover({ isOpen, onClose }: NetworkPopoverProps) {
  if (!isOpen) return null;

  const status = agentStatus.value;
  const [p2pEnabled, setP2pEnabled] = useState(true);
  const [manualPeer, setManualPeer] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

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

  const interfaces = status?.interfaces || [];

  return (
    <div class="network-popover-backdrop" onClick={onClose}>
      <div class="network-popover-card liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
        <div class="network-popover-header">
          <div class="network-popover-title-row">
            <Icon name="wifi" size={16} />
            <h4>Настройки P2P сети и интерфейсов</h4>
          </div>
          <button class="network-popover-close-btn" onClick={onClose} title="Закрыть">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div class="network-popover-body">
          {/* P2P Master Toggle */}
          <div class="network-toggle-row">
            <div class="network-toggle-info">
              <span class="network-toggle-label">P2P синхронизация (LAN / VPN)</span>
              <span class="network-toggle-desc">Позволяет участникам находить и подключаться к вашей доске</span>
            </div>
            <button
              type="button"
              class={`network-switch-btn ${p2pEnabled ? 'active' : ''}`}
              onClick={() => {
                setP2pEnabled(!p2pEnabled);
                showToast(p2pEnabled ? 'P2P синхронизация приостановлена' : 'P2P синхронизация включена');
              }}
            >
              {p2pEnabled ? 'Вкл' : 'Выкл'}
            </button>
          </div>

          <div class="network-section-divider" />

          {/* Current Active Interface */}
          <div class="network-field-group">
            <label class="network-field-label">Текущий сетевой адрес</label>
            <div class="network-active-ip-chip">
              <span class="network-ip-text">{status?.effectiveIp || '127.0.0.1'}:{status?.peerPort || 4747}</span>
              <span class="network-kind-badge">{status?.meshInterfaceKind || 'local'}</span>
            </div>
          </div>

          {/* Detected Interfaces List */}
          <div class="network-field-group">
            <label class="network-field-label">Обнаруженные сетевые адаптеры ({interfaces.length})</label>
            <div class="network-interfaces-list">
              {interfaces.length === 0 ? (
                <div class="network-iface-empty">Сетевые адаптеры не обнаружены (работаем локально)</div>
              ) : (
                interfaces.map((iface, idx) => (
                  <div key={idx} class="network-iface-item">
                    <div class="network-iface-name-col">
                      <span class="network-iface-kind">{iface.kind.toUpperCase()}</span>
                      <span class="network-iface-name" title={iface.name}>{iface.name}</span>
                    </div>
                    <span class="network-iface-addr">{iface.address}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div class="network-section-divider" />

          {/* Manual Peer Connect */}
          <div class="network-field-group">
            <label class="network-field-label">Подключиться к пиру вручную</label>
            <div class="network-manual-connect-row">
              <input
                type="text"
                class="network-input"
                placeholder="IP:порт (напр. 26.x.x.x:4747)"
                value={manualPeer}
                onInput={(e) => setManualPeer((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnectPeer();
                }}
              />
              <button
                type="button"
                class="btn-primary-sm network-connect-btn"
                disabled={!manualPeer.trim() || isConnecting}
                onClick={handleConnectPeer}
              >
                {isConnecting ? 'Соединение...' : 'Связать'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
