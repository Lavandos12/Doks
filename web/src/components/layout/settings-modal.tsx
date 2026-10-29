import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { theme, agentStatus, currentScope } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';
import { api } from '../../api/client.js';
import { t, currentLanguage, setLanguage, type Language } from '../../i18n/index.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportJson?: () => void;
  onExportSvg?: () => void;
  onDownloadZip?: () => void;
  gridType?: 'dots' | 'lines' | 'none';
  onSetGridType?: (type: 'dots' | 'lines' | 'none') => void;
  snapToGrid?: boolean;
  onSetSnapToGrid?: (snap: boolean) => void;
}

const AUTHOR_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#8b5cf6',
  '#6366f1',
  '#ec4899'
];

export function SettingsModal({
  isOpen,
  onClose,
  onExportJson,
  onExportSvg,
  onDownloadZip,
  gridType = 'dots',
  onSetGridType,
  snapToGrid = false,
  onSetSnapToGrid
}: SettingsModalProps): VNode | null {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'profile' | 'canvas' | 'backup'>('profile');
  const [name, setName] = useState<string>(() => {
    return localStorage.getItem('doks_member_name') || agentStatus.value?.memberName || t('settings.user_default');
  });
  const [color, setColor] = useState<string>(() => {
    return localStorage.getItem('doks_member_color') || agentStatus.value?.memberColor || '#8b5cf6';
  });

  const handleSaveProfile = () => {
    const trimmed = name.trim() || t('settings.user_default');
    localStorage.setItem('doks_member_name', trimmed);
    localStorage.setItem('doks_member_color', color);
    if (agentStatus.value) {
      agentStatus.value = {
        ...agentStatus.value,
        memberName: trimmed,
        memberColor: color
      };
    }
    showToast(t('settings.save_profile'));
  };

  const handleExportZip = async () => {
    try {
      const res = await api.fetch(`/api/export/vault?scope=${currentScope.value}`);
      if (!res.ok) throw new Error(t('settings.export_error'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doks-backup-${currentScope.value}-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('settings.full_backup'));
    } catch {
      showToast(t('lan.connect_failed'), 'error');
    }
  };

  return (
    <div class="settings-modal-backdrop" onClick={onClose}>
      <div class="settings-modal-card liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="modal-header">
          <div class="modal-header-icon-title">
            <Icon name="settings" size={20} class="text-accent" />
            <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>{t('settings.title')}</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label={t('ai.close')}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Tab navigation */}
        <div class="settings-tabs-row">
          <button
            class={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <Icon name="users" size={14} />
            <span>{t('settings.tab_profile')}</span>
          </button>
          <button
            class={`settings-tab-btn ${activeTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setActiveTab('canvas')}
          >
            <Icon name="layout-canvas" size={14} />
            <span>{t('settings.tab_canvas')}</span>
          </button>
          <button
            class={`settings-tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
            onClick={() => setActiveTab('backup')}
          >
            <Icon name="download" size={14} />
            <span>{t('settings.tab_backup')}</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {activeTab === 'profile' && (
            <div>
              <div class="form-group">
                <label>{t('settings.display_name')}</label>
                <input
                  type="text"
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder={t('settings.name_placeholder')}
                />
              </div>

              <div class="form-group">
                <label>{t('settings.cursor_color')}</label>
                <div class="settings-color-palette">
                  {AUTHOR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      class={`settings-color-btn ${color === c ? 'selected' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button class="btn-primary" onClick={handleSaveProfile}>
                  {t('settings.save_profile')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'canvas' && (
            <div>
              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.grid_bg')}</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['dots', 'lines', 'none'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      class={`table-tool-btn ${gridType === g ? 'active' : ''}`}
                      style={{
                        padding: '8px 14px',
                        background: gridType === g ? '#7c3aed' : 'rgba(255,255,255,0.06)',
                        color: '#ffffff'
                      }}
                      onClick={() => onSetGridType?.(g)}
                    >
                      {g === 'dots' ? t('settings.grid_dots') : g === 'lines' ? t('settings.grid_lines') : t('settings.grid_none')}
                    </button>
                  ))}
                </div>
              </div>

              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.snap_grid')}</label>
                <button
                  type="button"
                  class="btn-secondary"
                  style={{
                    padding: '8px 14px',
                    background: snapToGrid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)',
                    borderColor: snapToGrid ? '#10b981' : 'rgba(255,255,255,0.14)',
                    color: snapToGrid ? '#34d399' : '#cbd5e1'
                  }}
                  onClick={() => onSetSnapToGrid?.(!snapToGrid)}
                >
                  {snapToGrid ? t('settings.enabled') : t('settings.disabled')}
                </button>
              </div>

              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.theme')}</label>
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}
                >
                  {theme.value === 'dark' ? t('settings.theme_dark') : t('settings.theme_light')}
                </button>
              </div>

              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.language')}</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {([
                    { code: 'ru', label: 'Русский (RU)' },
                    { code: 'en', label: 'English (EN)' },
                    { code: 'es', label: 'Español (ES)' }
                  ] as const).map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      class={currentLanguage.value === item.code ? 'btn-primary-sm' : 'btn-secondary-sm'}
                      style={currentLanguage.value === item.code ? { background: '#7c3aed', color: '#fff', borderColor: '#8b5cf6' } : {}}
                      onClick={() => setLanguage(item.code)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div>
              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.board_export')}</label>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' }}>
                  {t('settings.board_export_desc')}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button class="table-tool-btn" style={{ padding: '8px 12px' }} onClick={onExportJson}>
                    JSON (.canvas)
                  </button>
                  <button class="table-tool-btn" style={{ padding: '8px 12px' }} onClick={onExportSvg}>
                    SVG (.svg)
                  </button>
                </div>
              </div>

              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.full_backup')}</label>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' }}>
                  {t('settings.full_backup_desc')}
                </p>
                <button class="btn-primary" onClick={handleExportZip}>
                  <Icon name="download" size={14} />
                  <span>{t('settings.download_zip')}</span>
                </button>
              </div>

              <div class="settings-section-card">
                <label class="settings-card-label">{t('settings.trash_and_history')}</label>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' }}>
                  {t('trash.modal_subtitle')}
                </p>
                <button
                  class="btn-secondary"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('doks:open-history', { detail: { tab: 'trash' } }));
                    onClose();
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 14px' }}
                >
                  <Icon name="trash" size={14} />
                  <span>{t('settings.open_trash')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
