import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { generateQrMatrix, renderQrSvgPath } from '../../utils/qr-svg.js';
import { api } from '../../api/client.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

interface BridgeStatusData {
  enabled: boolean;
  allowSolo: boolean;
  useCloudflare: boolean;
  tunnelStatus: 'off' | 'starting' | 'active' | 'error';
  localUrl: string | null;
  publicUrl: string | null;
  primaryUrl: string | null;
  tunnelError: string | null;
  expiresAt: number | null;
}

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BridgeModal({ isOpen, onClose }: BridgeModalProps): VNode | null {
  if (!isOpen) return null;

  const [status, setStatus] = useState<BridgeStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [allowSolo, setAllowSolo] = useState(true);
  const [useCloudflare, setUseCloudflare] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await api.fetch('/api/bridge/status');
      if (res.ok) {
        const data: BridgeStatusData = await res.json();
        setStatus(data);
        setAllowSolo(data.allowSolo);
        setUseCloudflare(data.useCloudflare);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh status if tunnel is starting
    const interval = setInterval(() => {
      if (status?.tunnelStatus === 'starting') {
        fetchStatus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status?.tunnelStatus]);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const res = await api.fetch('/api/bridge/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowSolo, useCloudflare })
      });
      if (res.ok) {
        const data: BridgeStatusData = await res.json();
        setStatus(data);
        showToast('Режим моста активирован', 'success');
      } else {
        showToast('Ошибка при активации моста', 'error');
      }
    } catch {
      showToast('Сетевая ошибка при активации моста', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      const res = await api.fetch('/api/bridge/disable', { method: 'POST' });
      if (res.ok) {
        const data: BridgeStatusData = await res.json();
        setStatus(data);
        showToast('Режим моста отключен', 'info');
      }
    } catch {
      showToast('Ошибка при отключении моста', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    showToast('Ссылка скопирована в буфер', 'success');
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const primaryUrl = status?.primaryUrl;
  let qrSvg: { size: number; path: string } | null = null;
  if (primaryUrl) {
    try {
      const matrix = generateQrMatrix(primaryUrl);
      qrSvg = renderQrSvgPath(matrix, 4);
    } catch {}
  }

  return (
    <div
      class="modal-backdrop doks-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 2100 }}
    >
      <div
        class="modal-card doks-modal-dialog liquid-glass-surface"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="share" size={20} class="modal-header-icon" />
            <div>
              <h3 class="modal-title">Режим моста (QR для телефона)</h3>
              <p class="modal-subtitle">
                Мгновенное подключение смартфона или планшета в режиме чтения
              </p>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {status?.enabled ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {/* QR Code Container */}
              {qrSvg && (
                <div
                  style={{
                    background: '#ffffff',
                    padding: 12,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                  }}
                >
                  <svg
                    viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`}
                    width="210"
                    height="210"
                    style={{ shapeRendering: 'crispEdges', display: 'block' }}
                  >
                    <rect width={qrSvg.size} height={qrSvg.size} fill="#ffffff" />
                    <path d={qrSvg.path} fill="#000000" />
                  </svg>
                </div>
              )}

              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Наведите камеру смартфона на QR-код для мгновенного входа.
                <br />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Защищенный режим чтения: телефон получает обновления в реальном времени, но не может изменить данные.
                </span>
              </div>

              {/* Links section */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {status.localUrl && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Локальная ссылка (Wi-Fi / Radmin VPN):
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        readOnly
                        value={status.localUrl}
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          borderRadius: 6,
                          background: 'rgba(0, 0, 0, 0.25)',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: 'var(--text-primary)',
                          fontSize: 12,
                          fontFamily: 'monospace'
                        }}
                      />
                      <button
                        type="button"
                        class="btn-secondary"
                        onClick={() => handleCopy(status.localUrl!)}
                        style={{ padding: '7px 12px', fontSize: 12 }}
                      >
                        {copiedUrl === status.localUrl ? 'Скопировано' : 'Копировать'}
                      </button>
                    </div>
                  </div>
                )}

                {status.publicUrl && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#34d399' }}>
                      Интернет-ссылка (Cloudflare Tunnel):
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        readOnly
                        value={status.publicUrl}
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          borderRadius: 6,
                          background: 'rgba(0, 0, 0, 0.25)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          color: '#34d399',
                          fontSize: 12,
                          fontFamily: 'monospace'
                        }}
                      />
                      <button
                        type="button"
                        class="btn-secondary"
                        onClick={() => handleCopy(status.publicUrl!)}
                        style={{ padding: '7px 12px', fontSize: 12 }}
                      >
                        {copiedUrl === status.publicUrl ? 'Скопировано' : 'Копировать'}
                      </button>
                    </div>
                  </div>
                )}

                {status.tunnelStatus === 'starting' && (
                  <div style={{ fontSize: 12, color: '#fbbf24', textAlign: 'center' }}>
                    Запуск интернет-туннеля Cloudflare...
                  </div>
                )}

                {status.tunnelError && (
                  <div style={{ fontSize: 11, color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: 6 }}>
                    {status.tunnelError}
                  </div>
                )}
              </div>

              <button
                type="button"
                class="btn-secondary"
                onClick={handleDisable}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Отключить Режим моста
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Включите Режим моста, чтобы открыть доску на телефоне или планшете без авторизации.
                Подключение полностью защищено: клиент получает данные только для чтения.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={allowSolo}
                    onChange={(e) => setAllowSolo((e.target as HTMLInputElement).checked)}
                  />
                  <span>Разрешить просмотр личных досок (Черновик / Solo)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={useCloudflare}
                    onChange={(e) => setUseCloudflare((e.target as HTMLInputElement).checked)}
                  />
                  <span>Включить защищенный интернет-туннель (Cloudflare)</span>
                </label>
              </div>

              <button
                type="button"
                class="btn-primary"
                onClick={handleEnable}
                disabled={loading}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                {loading ? 'Активация...' : 'Включить Режим моста'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
