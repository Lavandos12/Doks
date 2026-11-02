import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  agentStatus,
  isViewerMode,
  allTrashNotes,
  allTrashBoards
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

interface TopRightBarProps {
  onToggleNotes: () => void;
  onOpenAiExport: () => void;
  onOpenNetwork: () => void;
  onOpenSettings: () => void;
  onOpenBridge?: () => void;
  onOpenTrash?: () => void;
  isNotesOpen?: boolean;
  isSplitMode?: boolean;
}

export function TopRightBar({
  onToggleNotes,
  onOpenAiExport,
  onOpenNetwork,
  onOpenSettings,
  onOpenBridge,
  onOpenTrash,
  isNotesOpen = false,
  isSplitMode = false
}: TopRightBarProps): VNode {
  const status = agentStatus.value;
  const isViewer = Boolean(isViewerMode.value || status?.viewerMode);
  const deletedCount = allTrashNotes.value.length + allTrashBoards.value.length;

  const [showQuickProfile, setShowQuickProfile] = useState(false);
  const [profileName, setProfileName] = useState(() =>
    localStorage.getItem('doks_display_name') || localStorage.getItem('doks_member_name') || 'You'
  );
  const [profileColor, setProfileColor] = useState(() =>
    localStorage.getItem('doks_cursor_color') || localStorage.getItem('doks_member_color') || '#8b5cf6'
  );

  useEffect(() => {
    const handleProfileUpdated = () => {
      const updatedName = localStorage.getItem('doks_display_name') || localStorage.getItem('doks_member_name') || 'You';
      const updatedColor = localStorage.getItem('doks_cursor_color') || localStorage.getItem('doks_member_color') || '#8b5cf6';
      setProfileName(updatedName);
      setProfileColor(updatedColor);
    };
    window.addEventListener('doks_profile_updated', handleProfileUpdated);
    return () => window.removeEventListener('doks_profile_updated', handleProfileUpdated);
  }, []);

  const handleSaveQuickProfile = (newName: string, newColor: string) => {
    const trimmed = newName.trim() || 'Collaborator';
    localStorage.setItem('doks_display_name', trimmed);
    localStorage.setItem('doks_member_name', trimmed);
    localStorage.setItem('doks_cursor_color', newColor);
    localStorage.setItem('doks_member_color', newColor);
    if (agentStatus.value) {
      agentStatus.value = {
        ...agentStatus.value,
        memberName: trimmed,
        memberColor: newColor
      };
    }
    setProfileName(trimmed);
    setProfileColor(newColor);
    setShowQuickProfile(false);
    window.dispatchEvent(new Event('doks_profile_updated'));

    // Audit 3.4: Send PATCH /api/profile so server and mesh peers sync updated profile
    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberName: trimmed, memberColor: newColor })
    }).catch(() => {});
  };

  return (
    <div
      class="miro-actions-bar liquid-glass-surface"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        right: isSplitMode ? 'calc(50% + 16px)' : '16px',
        transition: 'right 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}
    >
      {/* 1. [ Notes ] */}
      <button
        class={`miro-action-pill ${isNotesOpen ? 'active' : ''}`}
        data-testid="notes-drawer-toggle-btn"
        onClick={onToggleNotes}
        title={t('topBar.notes')}
        style={{
          borderColor: isNotesOpen ? '#8b5cf6' : undefined,
          color: isNotesOpen ? '#c084fc' : undefined
        }}
      >
        <Icon name="file-text" size={14} />
        <span>{t('topBar.notes')}</span>
      </button>

      {!isViewer && (
        <>
          {/* 2. [ AI Context ] */}
          <button
            class="miro-action-pill"
            data-testid="ai-export-btn"
            onClick={onOpenAiExport}
            title={t('topBar.aiContext')}
          >
            <Icon name="sparkles" size={14} />
            <span>{t('topBar.aiContext')}</span>
          </button>

          {/* 3. [ Phone Bridge ] */}
          {onOpenBridge && (
            <button
              class="miro-action-pill"
              data-testid="phone-bridge-btn"
              onClick={onOpenBridge}
              title={t('share.phoneBridge')}
            >
              <Icon name="smartphone" size={14} />
              <span>{t('share.phoneBridge')}</span>
            </button>
          )}

          {/* 4. [ Trash ] with counter badge */}
          {onOpenTrash && (
            <button
              class="miro-action-pill"
              data-testid="trash-toggle-btn"
              onClick={onOpenTrash}
              title={t('topBar.trash')}
              style={{ position: 'relative' }}
            >
              <Icon name="trash" size={14} />
              <span>{t('topBar.trash')}</span>
              {deletedCount > 0 && (
                <span
                  class="trash-count-pill"
                  style={{
                    backgroundColor: '#8b5cf6',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 700,
                    borderRadius: '10px',
                    padding: '1px 6px',
                    marginLeft: '3px',
                    lineHeight: '1.2'
                  }}
                >
                  {deletedCount}
                </span>
              )}
            </button>
          )}

          {/* 5. [ Quick Collaborator Profile Pill ] */}
          <div style={{ position: 'relative' }}>
            <button
              class="miro-action-pill"
              onClick={() => setShowQuickProfile(!showQuickProfile)}
              title="Customize Your Name & Color"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px' }}
            >
              <span style={{ width: '10px', height: '10px', minWidth: '10px', minHeight: '10px', flexShrink: 0, borderRadius: '50%', backgroundColor: profileColor, display: 'inline-block' }} />
              <span style={{ maxWidth: '85px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                {profileName}
              </span>
            </button>

            {showQuickProfile && (
              <div
                class="liquid-glass-surface"
                style={{
                  position: 'absolute',
                  top: '38px',
                  right: '0',
                  width: '210px',
                  padding: '12px',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  zIndex: 3100,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Your Signature
                </div>
                <input
                  type="text"
                  value={profileName}
                  onInput={(e) => setProfileName((e.target as HTMLInputElement).value)}
                  placeholder="Your Name"
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveQuickProfile(profileName, profileColor);
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                  {['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      class={`quick-profile-color-btn ${profileColor === c ? 'selected' : ''}`}
                      onClick={() => setProfileColor(c)}
                      style={{
                        width: '22px',
                        height: '22px',
                        minWidth: '22px',
                        minHeight: '22px',
                        maxWidth: '22px',
                        maxHeight: '22px',
                        padding: 0,
                        margin: 0,
                        flex: '0 0 22px',
                        flexShrink: 0,
                        aspectRatio: '1 / 1',
                        boxSizing: 'border-box',
                        borderRadius: '50%',
                        backgroundColor: c,
                        border: profileColor === c ? '2px solid #ffffff' : '2px solid transparent',
                        boxShadow: profileColor === c ? '0 0 0 2px rgba(139, 92, 246, 0.5)' : 'none',
                        cursor: 'pointer',
                        outline: 'none',
                        display: 'inline-block'
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  class="btn-primary"
                  style={{ padding: '6px', fontSize: '12px', borderRadius: '6px', fontWeight: 600 }}
                  onClick={() => handleSaveQuickProfile(profileName, profileColor)}
                >
                  Save
                </button>
              </div>
            )}
          </div>

          {/* 6. [ Settings ] */}
          <button
            class="miro-action-pill settings-trigger-btn"
            onClick={onOpenSettings}
            title={t('topBar.settings')}
            style={{ padding: '5px 8px' }}
          >
            <Icon name="settings" size={15} />
          </button>
        </>
      )}
    </div>
  );
}
