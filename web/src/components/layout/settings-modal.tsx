import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { theme, agentStatus, currentScope } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { showToast } from '../../ui/toast.js';

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
  '#3b82f6',
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
    return localStorage.getItem('doks_member_name') || agentStatus.value?.memberName || 'Пользователь';
  });
  const [color, setColor] = useState<string>(() => {
    return localStorage.getItem('doks_member_color') || agentStatus.value?.memberColor || '#3b82f6';
  });

  const handleSaveProfile = () => {
    const trimmed = name.trim() || 'Пользователь';
    localStorage.setItem('doks_member_name', trimmed);
    localStorage.setItem('doks_member_color', color);
    if (agentStatus.value) {
      agentStatus.value = {
        ...agentStatus.value,
        memberName: trimmed,
        memberColor: color
      };
    }
    showToast('Профиль сохранён');
  };

  const handleExportZip = async () => {
    try {
      const res = await fetch(`/api/export/vault?scope=${currentScope.value}`);
      if (!res.ok) throw new Error('Ошибка экспорта архива');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doks-backup-${currentScope.value}-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Резервная копия скачана');
    } catch {
      showToast('Не удалось скачать архив');
    }
  };

  return (
    <div class="settings-modal-backdrop" onClick={onClose}>
      <div class="settings-modal-card liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="modal-header">
          <div class="modal-header-icon-title">
            <Icon name="settings" size={20} class="text-accent" />
            <h3 class="modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Настройки</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label="Закрыть">
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
            <span>Профиль соавтора</span>
          </button>
          <button
            class={`settings-tab-btn ${activeTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setActiveTab('canvas')}
          >
            <Icon name="layout-canvas" size={14} />
            <span>Холст и сетка</span>
          </button>
          <button
            class={`settings-tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
            onClick={() => setActiveTab('backup')}
          >
            <Icon name="download" size={14} />
            <span>Экспорт и бэкапы</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {activeTab === 'profile' && (
            <div>
              <div class="form-group">
                <label>Ваше отображаемое имя</label>
                <input
                  type="text"
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder="Имя или позывной"
                />
              </div>

              <div class="form-group">
                <label>Цвет курсора и маркера</label>
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
                  Сохранить профиль
                </button>
              </div>
            </div>
          )}

          {activeTab === 'canvas' && (
            <div>
              <div class="settings-section-card">
                <label style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '8px' }}>Фон холста</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['dots', 'lines', 'none'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      class={`table-tool-btn ${gridType === t ? 'active' : ''}`}
                      style={{
                        padding: '8px 14px',
                        background: gridType === t ? '#4f46e5' : 'rgba(255,255,255,0.06)',
                        color: '#ffffff'
                      }}
                      onClick={() => onSetGridType?.(t)}
                    >
                      {t === 'dots' ? 'Точки' : t === 'lines' ? 'Линии' : 'Без сетки'}
                    </button>
                  ))}
                </div>
              </div>

              <div class="settings-section-card">
                <label style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '8px' }}>Привязка к сетке (Snap-to-Grid 16px)</label>
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
                  {snapToGrid ? 'Включено (привязка 16px)' : 'Выключено'}
                </button>
              </div>

              <div class="settings-section-card">
                <label style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '8px' }}>Тема интерфейса</label>
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}
                >
                  {theme.value === 'dark' ? 'Тёмная тема (Dark)' : 'Светлая тема (Light)'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div>
              <div class="settings-section-card">
                <label style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>Экспорт доски</label>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' }}>
                  Сохраните текущую доску как векторный SVG или файл структуры JSON.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button class="table-tool-btn" style={{ padding: '8px 12px' }} onClick={onExportJson}>
                    Экспорт в JSON
                  </button>
                  <button class="table-tool-btn" style={{ padding: '8px 12px' }} onClick={onExportSvg}>
                    Экспорт в SVG
                  </button>
                </div>
              </div>

              <div class="settings-section-card">
                <label style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>Полный бэкап рабочей области</label>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' }}>
                  Скачайте полный архив .ZIP со всеми досками, заметками и связями.
                </p>
                <button class="btn-primary" onClick={handleExportZip}>
                  <Icon name="download" size={14} />
                  <span>Скачать полный ZIP-бэкап</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
