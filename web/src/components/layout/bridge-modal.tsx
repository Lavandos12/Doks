import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { generateQrMatrix, renderQrSvgPath } from '../../utils/qr-svg.js';
import { api } from '../../api/client.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { t } from '../../i18n/index.js';

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
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

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
      } else {
        showToast('Ошибка при отключении моста', 'error');
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

  const activeUrl = status?.primaryUrl || status?.publicUrl || status?.localUrl;
  let qrSvg: { size: number; path: string } | null = null;
  if (status?.enabled && activeUrl) {
    try {
      const matrix = generateQrMatrix(activeUrl);
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
        style={{ maxWidth: 540 }}
      >
        {/* Modal Header */}
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="smartphone" size={20} class="modal-header-icon" />
            <div>
              <h3 class="modal-title">{t('topbar.bridge')}</h3>
              <p class="modal-subtitle">
                Ваш Doks на любом устройстве. Только для просмотра — обработка и данные остаются на этом компьютере.
              </p>
            </div>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Main Card */}
          <div
            style={{
              padding: 18,
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
          >
            {/* Card Header & Status Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>
                Подключить другое устройство
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: status?.enabled ? 'rgba(52, 211, 153, 0.15)' : 'rgba(148, 163, 184, 0.12)',
                  color: status?.enabled ? '#34d399' : '#94a3b8',
                  border: `1px solid ${status?.enabled ? 'rgba(52, 211, 153, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
                }}
              >
                {status?.enabled ? 'Активен • Только чтение' : 'Выключено'}
              </span>
            </div>

            {/* PC to Phone Graphic */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '6px 0' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Icon name="monitor" size={18} color="#818cf8" />
                <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>Компьютер</span>
              </div>
              <div style={{ borderTop: '2px dashed rgba(255, 255, 255, 0.2)', width: 48 }} />
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Icon name="smartphone" size={18} color="#34d399" />
                <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>Смартфон</span>
              </div>
            </div>

            {/* Description */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                Возьмите Doks с собой
              </span>
              <span style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>
                Отсканируйте QR-код телефоном или откройте приватную ссылку на другом компьютере. Режим только для просмотра защищает доску от случайных нажатий.
              </span>
            </div>

            {/* Options Checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
              <label class="checkbox-row-label">
                <input
                  type="checkbox"
                  checked={allowSolo}
                  onChange={(e) => setAllowSolo((e.target as HTMLInputElement).checked)}
                />
                <span>Разрешить просмотр личных досок (Solo)</span>
              </label>

              <label class="checkbox-row-label">
                <input
                  type="checkbox"
                  checked={useCloudflare}
                  onChange={(e) => setUseCloudflare((e.target as HTMLInputElement).checked)}
                />
                <span>Использовать HTTPS-ретранслятор Cloudflare (для доступа вне домашнего Wi-Fi)</span>
              </label>
            </div>

            {/* Active QR & Link Section */}
            {status?.enabled && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 14,
                  padding: 14,
                  borderRadius: 10,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
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
                      width="190"
                      height="190"
                      style={{ shapeRendering: 'crispEdges', display: 'block' }}
                    >
                      <rect width={qrSvg.size} height={qrSvg.size} fill="#ffffff" />
                      <path d={qrSvg.path} fill="#000000" />
                    </svg>
                  </div>
                )}

                {/* Primary Link Input */}
                {activeUrl && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      type="text"
                      readOnly
                      value={activeUrl}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(129, 140, 248, 0.3)',
                        color: '#a5b4fc',
                        fontSize: 12,
                        fontFamily: 'monospace'
                      }}
                    />
                  </div>
                )}

                {/* Tunnel status notifications */}
                {status.tunnelStatus === 'starting' && (
                  <div style={{ fontSize: 12, color: '#fbbf24', textAlign: 'center' }}>
                    Запуск интернет-туннеля Cloudflare...
                  </div>
                )}

                {status.tunnelError && (
                  <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: 6, width: '100%' }}>
                    {status.tunnelError}
                  </div>
                )}

                {/* Buttons Row */}
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  {activeUrl && (
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => handleCopy(activeUrl)}
                      style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                    >
                      <Icon name="copy" size={13} />
                      <span>{copiedUrl === activeUrl ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    class="btn-secondary"
                    onClick={handleEnable}
                    disabled={loading}
                    style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                  >
                    <Icon name="refresh" size={13} />
                    <span>Обновить ссылку</span>
                  </button>
                  <button
                    type="button"
                    class="btn-danger"
                    onClick={handleDisable}
                    disabled={loading}
                    style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                  >
                    <span>Закрыть доступ</span>
                  </button>
                </div>
              </div>
            )}

            {/* Action button when disabled */}
            {!status?.enabled && (
              <button
                type="button"
                class="btn-primary"
                onClick={handleEnable}
                disabled={loading}
                style={{ width: '100%', padding: '10px 16px', fontSize: 13.5 }}
              >
                <Icon name="share" size={15} />
                <span>{loading ? 'Активация...' : 'Открыть доступ'}</span>
              </button>
            )}
          </div>

          {/* Info Badges Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 11.5,
              color: '#94a3b8',
              textAlign: 'center',
              padding: '0 4px',
              lineHeight: 1.4
            }}
          >
            <span>Не переводите этот компьютер в спящий режим</span>
            <span>·</span>
            <span>Сеансы на 8 часов</span>
            <span>·</span>
            <span>Режим 100% только для чтения</span>
          </div>

          {/* Collapsible Privacy Details */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              overflow: 'hidden'
            }}
          >
            <div
              onClick={() => setIsPrivacyOpen(!isPrivacyOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 12.5,
                fontWeight: 500,
                color: '#cbd5e1'
              }}
            >
              <span>Конфиденциальность и сведения о подключении</span>
              <Icon name={isPrivacyOpen ? 'chevron-down' : 'chevron-right'} size={14} color="#94a3b8" />
            </div>

            {isPrivacyOpen && (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: 12,
                  color: '#94a3b8',
                  lineHeight: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div>- Ваши файлы и база данных хранятся исключительно на этом компьютере.</div>
                <div>- Зритель получает временный криптографический токен с жестким запретом на запись (HTTP 403 при любых POST/PUT/DELETE запросах).</div>
                <div>- Входящие мутации через WebSocket полностью игнорируются сервером.</div>
                <div>- При использовании Cloudflare туннель передает шифрованный трафик напрямую без сохранения промежуточных данных.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
