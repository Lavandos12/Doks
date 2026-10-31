import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { agentStatus } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { api } from '../../api/client.js';
import { t } from '../../i18n/index.js';
import { generateQrMatrix, renderQrSvgPath } from '../../utils/qr-svg.js';

interface LanShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardTitle: string;
}

export function LanShareModal({ isOpen, onClose, boardId, boardTitle }: LanShareModalProps): VNode | null {
  if (!isOpen) return null;

  const [isLanOpen, setIsLanOpen] = useState(true);
  const [targetIp, setTargetIp] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [netInfo, setNetInfo] = useState<any>(null);
  const [showQr, setShowQr] = useState(false);

  const status = agentStatus.value;
  const radminIp = netInfo?.detectedRadminIp || status?.radminIp;
  const effectiveIp = radminIp || netInfo?.lanIp || status?.effectiveIp || '127.0.0.1';
  const port = status?.webPort || 4780;
  const shareUrl = `http://${effectiveIp}:${port}/?board=${boardId}`;

  useEffect(() => {
    api.fetch('/api/network').then(r => r.ok ? r.json() : null).then(setNetInfo).catch(() => {});
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    showToast(t('lan.copied'));
  };

  const handleDirectConnect = async () => {
    if (!targetIp.trim()) return;
    setConnecting(true);
    try {
      const cleanTarget = targetIp.trim().replace(/^http:\/\//, '');
      const res = await api.fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: cleanTarget })
      });
      if (res.ok) {
        showToast(t('lan.connected_success'));
        onClose();
      } else {
        showToast(t('lan.connect_failed'), 'error');
      }
    } catch {
      showToast(t('lan.connect_failed'), 'error');
    } finally {
      setConnecting(false);
    }
  };

  let qrSvg: { size: number; path: string } | null = null;
  if (showQr) {
    try {
      qrSvg = renderQrSvgPath(generateQrMatrix(shareUrl), 4);
    } catch {}
  }

  const discoveredRooms = netInfo?.discoveredLanRooms || [];

  return (
    <div class="modal-backdrop doks-modal-backdrop" onClick={onClose} style={{ zIndex: 3000 }}>
      <div
        class="modal-card doks-modal-dialog liquid-glass-surface"
        style={{ maxWidth: '540px', width: '92vw', borderRadius: '16px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="modal-header">
          <div class="modal-title-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="globe-mesh" size={20} class="text-accent" />
            <h3 class="modal-title">{t('lan.title')}</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label={t('ai.close')}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div class="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 20px' }}>
          {/* Section 1: Open to LAN */}
          <div class="settings-section-card" style={{ background: 'rgba(109, 40, 217, 0.08)', borderColor: 'rgba(139, 92, 246, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6' }}>
                  {isLanOpen ? t('lan.status_open') : t('lan.status_closed')}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {boardTitle} · Direct Connect & Cloud Sync
                </div>
              </div>
              <button
                type="button"
                class={isLanOpen ? 'btn-primary-sm' : 'btn-secondary-sm'}
                onClick={() => setIsLanOpen(!isLanOpen)}
              >
                {isLanOpen ? t('lan.btn_stop') : t('lan.btn_start')}
              </button>
            </div>

            {isLanOpen && (
              <div style={{ width: '100%', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: '#c084fc', fontWeight: 600 }}>{t('lan.share_address_label')}</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    style={{ flex: 1, padding: '8px 12px', background: '#0b0a14', color: '#c084fc', fontFamily: 'monospace', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.3)' }}
                  />
                  <button type="button" class="btn-primary-sm" onClick={handleCopy} style={{ padding: '8px 14px' }}>
                    <Icon name="copy" size={13} />
                    <span>{t('lan.copy_link')}</span>
                  </button>
                  <button type="button" class="btn-secondary-sm" onClick={() => setShowQr(!showQr)} title="QR">
                    <Icon name="smartphone" size={14} />
                  </button>
                </div>

                {showQr && qrSvg && (
                  <div style={{ alignSelf: 'center', background: '#ffffff', padding: '12px', borderRadius: '12px', marginTop: '8px' }}>
                    <svg viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`} width="160" height="160" style={{ display: 'block' }}>
                      <rect width={qrSvg.size} height={qrSvg.size} fill="#ffffff" />
                      <path d={qrSvg.path} fill="#000000" />
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Direct Connect */}
          <div class="settings-section-card">
            <label class="settings-card-label">{t('lan.direct_connect_title')}</label>
            <div style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 8px 0' }}>
              {t('lan.direct_connect_desc')}
            </div>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input
                type="text"
                placeholder="26.153.49.50:4780"
                value={targetIp}
                onInput={(e) => setTargetIp((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDirectConnect(); }}
                style={{ flex: 1, padding: '8px 12px' }}
              />
              <button
                type="button"
                class="btn-primary"
                disabled={!targetIp.trim() || connecting}
                onClick={handleDirectConnect}
              >
                {connecting ? t('status.connecting') : t('lan.join')}
              </button>
            </div>
          </div>

          {/* Section 3: Discovered LAN rooms */}
          {discoveredRooms.length > 0 && (
            <div class="settings-section-card">
              <label class="settings-card-label">{t('lan.discovered_title')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                {discoveredRooms.map((r: any) => (
                  <div key={r.peerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>{r.displayName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{r.host}:{r.webPort || 4780}</div>
                    </div>
                    <button
                      type="button"
                      class="btn-primary-xs"
                      onClick={() => {
                        window.open(`http://${r.host}:${r.webPort || 4780}`, '_self');
                      }}
                    >
                      {t('lan.join')}
                    </button>
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
