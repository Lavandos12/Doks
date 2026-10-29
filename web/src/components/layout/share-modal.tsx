import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from '../../i18n/index.js';
import { selectedBoardId, allBoards, agentStatus } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { api } from '../../api/client.js';
import { generateQrMatrix, renderQrSvgPath } from '../../utils/qr-svg.js';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'share' | 'direct' | 'phone';
}

export function ShareModal({ isOpen, onClose, initialTab = 'share' }: ShareModalProps): VNode | null {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'share' | 'direct' | 'phone'>(initialTab);
  const currentBoardId = selectedBoardId.value;
  const currentBoardMeta = allBoards.value.find((b) => b.id === currentBoardId);

  const status = agentStatus.value;
  const [lanStatus, setLanStatus] = useState<{
    running: boolean;
    ip: string;
    port: number;
    radminIp?: string;
    discoveredLanRooms?: Array<{ name: string; address: string; port: number; boardTitle?: string }>;
  }>({
    running: true,
    ip: (status as any)?.lanIp || status?.effectiveIp || '127.0.0.1',
    port: status?.webPort || 4780,
    radminIp: status?.radminIp ?? undefined
  });

  const [directAddress, setDirectAddress] = useState('');
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!isOpen) return;

    // Fetch network info and bridge status from local agent
    api.fetch('/api/network-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setLanStatus({
            running: true,
            ip: data.lanIp || data.ip || '127.0.0.1',
            port: data.port || data.webPort || 4780,
            radminIp: data.radminIp || data.detectedRadminIp,
            discoveredLanRooms: data.discoveredLanRooms || []
          });
        }
      })
      .catch(() => {});

    api.fetch('/api/bridge/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setBridgeRunning(Boolean(data.enabled || data.active));
          setBridgeUrl(data.primaryUrl || data.url || data.localUrl || '');
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const currentIp = lanStatus.radminIp || lanStatus.ip || '127.0.0.1';
  const effectiveBoardId = currentBoardId || 'default';
  const shareLink = `http://${currentIp}:${lanStatus.port}/?board=${effectiveBoardId}`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    showToast(t('lan.copied') || 'Copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDirectConnect = async (e: Event) => {
    e.preventDefault();
    if (!directAddress.trim() || connecting) return;
    setConnecting(true);

    try {
      let target = directAddress.trim();
      const cleanPeer = target.replace(/^https?:\/\//, '');

      // Send join request to peer service if port is provided
      await api.fetch('/api/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: cleanPeer })
      }).catch(() => {});

      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = `http://${target}`;
      }
      if (!target.includes('?board=')) {
        target += (target.includes('?') ? '&' : '?') + 'board=remote';
      }
      window.location.href = target;
    } catch (err) {
      showToast(t('lan.connect_failed'), 'error');
      setConnecting(false);
    }
  };

  const handleJoinDiscoveredRoom = (room: { address: string; port: number; boardTitle?: string }) => {
    const targetUrl = `http://${room.address}:${room.port}/?board=remote`;
    window.location.href = targetUrl;
  };

  const startPhoneBridge = async () => {
    try {
      const res = await api.fetch('/api/bridge/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useCloudflare: true })
      });
      if (res.ok) {
        const data = await res.json();
        setBridgeRunning(true);
        setBridgeUrl(data.primaryUrl || data.url || `http://${lanStatus.ip}:${lanStatus.port}/?b=${data.token}`);
        showToast(t('share.onlineBadge'), 'success');
      } else {
        showToast(t('lan.connect_failed'), 'error');
      }
    } catch (e) {
      showToast(t('lan.connect_failed'), 'error');
    }
  };

  const stopPhoneBridge = async () => {
    try {
      await api.fetch('/api/bridge/stop', { method: 'POST' });
      setBridgeRunning(false);
      setBridgeUrl('');
      showToast(t('share.stopBridge'), 'info');
    } catch (e) {
      console.error('Failed to stop bridge', e);
    }
  };

  // Generate vector SVG QR code path for instant rendering
  let qrSvg: { size: number; path: string } | null = null;
  if (bridgeUrl) {
    try {
      qrSvg = renderQrSvgPath(generateQrMatrix(bridgeUrl), 4);
    } catch {}
  }

  const discoveredRooms = lanStatus.discoveredLanRooms || [];

  return (
    <div
      class="modal-backdrop doks-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)'
      }}
    >
      <div
        class="modal-card doks-modal-dialog liquid-glass-surface"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92vw',
          maxWidth: '560px',
          borderRadius: '16px',
          border: '1px solid rgba(139, 92, 246, 0.28)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div class="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="globe-mesh" size={20} class="text-accent" />
            <h3 class="modal-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>
              {t('share.modalTitle')}
            </h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label={t('history.close')}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', padding: '0 16px', gap: '8px', background: 'rgba(0, 0, 0, 0.2)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('share')}
            style={{
              padding: '12px 14px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderBottom: activeTab === 'share' ? '2px solid #8b5cf6' : '2px solid transparent',
              color: activeTab === 'share' ? '#c084fc' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Icon name="globe-mesh" size={14} />
            <span>{t('share.tabShare')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            style={{
              padding: '12px 14px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderBottom: activeTab === 'direct' ? '2px solid #8b5cf6' : '2px solid transparent',
              color: activeTab === 'direct' ? '#c084fc' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Icon name="link" size={14} />
            <span>{t('share.tabDirectConnect')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('phone')}
            style={{
              padding: '12px 14px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderBottom: activeTab === 'phone' ? '2px solid #8b5cf6' : '2px solid transparent',
              color: activeTab === 'phone' ? '#c084fc' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Icon name="smartphone" size={14} />
            <span>{t('share.tabPhone')}</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div class="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* TAB 1: Share Board */}
          {activeTab === 'share' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'rgba(109, 40, 217, 0.08)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  borderRadius: '12px'
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                    {t('share.lanBroadcast')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    {t('share.lanBroadcastDesc')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#34d399', fontWeight: 600 }}>
                    {lanStatus.port}
                  </span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  {t('share.inviteLink')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={shareLink}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: '#e2e8f0',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={copyShareLink}
                    class="btn-primary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '10px'
                    }}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                    <span>{copied ? t('lan.copied') : t('lan.copy_link')}</span>
                  </button>
                </div>
              </div>

              <div
                style={{
                  fontSize: '12px',
                  color: '#94a3b8',
                  background: 'rgba(139, 92, 246, 0.06)',
                  border: '1px solid rgba(139, 92, 246, 0.18)',
                  borderRadius: '12px',
                  padding: '12px',
                  lineHeight: '1.5'
                }}
              >
                {lanStatus.radminIp ? (
                  <span>{t('share.radminTip')}</span>
                ) : (
                  <span>{t('share.lanTip')}</span>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Direct Connect */}
          {activeTab === 'direct' && (
            <form onSubmit={handleDirectConnect} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  {t('share.directInputLabel')}
                </label>
                <input
                  type="text"
                  placeholder="26.153.49.50:4780, 192.168.1.120:4780"
                  value={directAddress}
                  onInput={(e: any) => setDirectAddress(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    color: '#f8fafc',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={!directAddress.trim() || connecting}
                class="btn-primary"
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Icon name="link" size={15} />
                <span>{connecting ? '...' : t('share.connectButton')}</span>
              </button>

              {/* Discovered LAN rooms */}
              {discoveredRooms.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                    {t('lan.discovered_title')} ({discoveredRooms.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {discoveredRooms.map((room, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{room.name || room.boardTitle || 'Doks Host'}</div>
                          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8' }}>{room.address}:{room.port}</div>
                        </div>
                        <button
                          type="button"
                          class="btn-secondary-sm"
                          onClick={() => handleJoinDiscoveredRoom(room)}
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                        >
                          {t('lan.join')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'center', lineHeight: '1.4' }}>
                {t('share.directTip')}
              </div>
            </form>
          )}

          {/* TAB 3: Phone Bridge */}
          {activeTab === 'phone' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '14px', padding: '8px 0' }}>
              {!bridgeRunning ? (
                <>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '14px',
                      background: 'rgba(109, 40, 217, 0.15)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#c084fc'
                    }}
                  >
                    <Icon name="smartphone" size={24} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: '#f3f4f6' }}>
                      {t('share.phoneBridgeTitle')}
                    </h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', maxWidth: '380px', lineHeight: '1.5' }}>
                      {t('share.phoneBridgeDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startPhoneBridge}
                    class="btn-primary"
                    style={{
                      padding: '10px 20px',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '4px'
                    }}
                  >
                    <Icon name="smartphone" size={16} />
                    <span>{t('share.startBridge')}</span>
                  </button>
                </>
              ) : (
                <>
                  {/* High contrast QR code */}
                  <div
                    style={{
                      padding: '14px',
                      background: '#ffffff',
                      borderRadius: '14px',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                      display: 'inline-flex'
                    }}
                  >
                    {qrSvg ? (
                      <svg viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`} style={{ width: '180px', height: '180px' }}>
                        <path d={qrSvg.path} fill="#000000" />
                      </svg>
                    ) : (
                      <img
                        src={`/api/bridge/qr?url=${encodeURIComponent(bridgeUrl)}`}
                        alt="QR Code"
                        style={{ width: '180px', height: '180px' }}
                      />
                    )}
                  </div>

                  <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#a78bfa', wordBreak: 'break-all', maxWidth: '420px' }}>
                    {bridgeUrl}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#34d399', fontWeight: 500 }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
                    <span>{t('share.onlineBadge')} · Read-Only</span>
                  </div>

                  <button
                    type="button"
                    onClick={stopPhoneBridge}
                    class="btn-secondary"
                    style={{
                      padding: '6px 14px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      color: '#f87171'
                    }}
                  >
                    {t('share.stopBridge')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
