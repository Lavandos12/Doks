import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from '../../i18n/index.js';
import { selectedBoardId, allBoards, agentStatus } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { generateQrMatrix, renderQrSvgPath } from '../../utils/qr-svg.js';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'share' | 'phone';
}

export function ShareModal({ isOpen, onClose, initialTab = 'share' }: ShareModalProps): VNode | null {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'share' | 'phone'>(initialTab);
  const currentBoardId = selectedBoardId.value;
  const currentBoardMeta = allBoards.value.find((b) => b.id === currentBoardId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  if (!isOpen) return null;

  const effectiveBoardId = currentBoardId || 'default';
  const isLocalHost = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const lanHost = isLocalHost ? (agentStatus.value?.lanIp || agentStatus.value?.effectiveIp) : undefined;
  const portPart = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
  const lanBase = lanHost ? `${window.location.protocol}//${lanHost}${portPart}` : (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4780');

  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/b/${effectiveBoardId}`
    : `http://127.0.0.1:4780/b/${effectiveBoardId}`;
  const lanShareLink = `${lanBase}/b/${effectiveBoardId}`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    showToast(t('lan.copied') || 'Copied', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  // Audit 3.1: Supply valid bridge URL or LAN-aware QR link so phones on Wi-Fi connect seamlessly
  const bridgeUrl = agentStatus.value?.bridge?.primaryUrl;
  const bridgeToken = (agentStatus.value?.bridge as any)?.bridgeToken;
  const baseLinkForPhone = bridgeUrl ? bridgeUrl : lanShareLink;
  const phoneShareLink = bridgeUrl || (
    bridgeToken
      ? `${baseLinkForPhone}${baseLinkForPhone.includes('?') ? '&' : '?'}b=${bridgeToken}`
      : `${baseLinkForPhone}${baseLinkForPhone.includes('?') ? '&' : '?'}bridge=1`
  );

  // Generate vector SVG QR code path for instant rendering
  let qrSvg: { size: number; path: string } | null = null;
  try {
    const targetLink = activeTab === 'phone' ? phoneShareLink : shareLink;
    qrSvg = renderQrSvgPath(generateQrMatrix(targetLink), 4);
  } catch {}

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
          maxWidth: '520px',
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
                    Live Collaboration
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    {currentBoardMeta?.title || 'Collaborative Board'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', color: '#34d399', fontWeight: 600 }}>
                    Online
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
                    <span>{copied ? 'Copied' : 'Copy Link'}</span>
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
                <span>Anyone with this link can view and edit this board simultaneously in real time.</span>
              </div>
            </div>
          )}

          {/* TAB 2: Phone QR */}
          {activeTab === 'phone' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '14px', padding: '8px 0' }}>
              <div
                style={{
                  padding: '14px',
                  background: '#ffffff',
                  borderRadius: '14px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                  display: 'inline-flex'
                }}
              >
                {qrSvg && (
                  <svg viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`} style={{ width: '180px', height: '180px' }}>
                    <path d={qrSvg.path} fill="#000000" />
                  </svg>
                )}
              </div>

              <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#a78bfa', wordBreak: 'break-all', maxWidth: '420px' }}>
                {phoneShareLink}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#34d399', fontWeight: 500 }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
                <span>Instant Connect · Real-Time Collaboration</span>
              </div>

              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', maxWidth: '380px', lineHeight: '1.5' }}>
                Scan with your phone or tablet camera to open and edit this board instantly.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
