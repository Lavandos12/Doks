import { h, VNode } from 'preact';
import {
  workspaceMode,
  setWorkspaceMode,
  agentStatus
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

interface TopRightBarProps {
  onToggleNotes: () => void;
  onOpenAiExport: () => void;
  onOpenNetwork: () => void;
  onOpenSettings: () => void;
  onOpenBridge?: () => void;
  isNotesOpen?: boolean;
  isSplitMode?: boolean;
}

export function TopRightBar({
  onToggleNotes,
  onOpenAiExport,
  onOpenNetwork,
  onOpenSettings,
  onOpenBridge,
  isNotesOpen = false,
  isSplitMode = false
}: TopRightBarProps): VNode {
  const status = agentStatus.value;
  const isRadminFound = Boolean(status?.radminFound || status?.radminIp);
  const effectiveIp = status?.effectiveIp || '127.0.0.1';

  return (
    <div
      class="miro-actions-bar liquid-glass-surface"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        right: isSplitMode ? 'calc(50% + 16px)' : '16px',
        transition: 'right 0.2s ease'
      }}
    >
      {/* [ Заметки ] Drawer Toggle Button */}
      <button
        class={`miro-action-pill ${isNotesOpen ? 'active' : ''}`}
        data-testid="notes-drawer-toggle-btn"
        onClick={onToggleNotes}
        title="Заметки (Шторка заметок поверх доски)"
      >
        <Icon name="file-text" size={14} />
        <span>Заметки</span>
      </button>

      {/* [ ИИ-Контекст ] */}
      <button
        class="miro-action-pill"
        data-testid="ai-export-btn"
        onClick={onOpenAiExport}
        title="Экспорт контекста доски для ИИ"
      >
        <Icon name="sparkles" size={14} />
        <span>ИИ-Контекст</span>
      </button>

      {/* [ ● Radmin / Локально ] */}
      <div
        class="miro-network-pill"
        onClick={onOpenNetwork}
        title="Сетевые подключения и Radmin VPN"
        style={{ cursor: 'pointer' }}
      >
        <span class={`status-dot ${isRadminFound ? 'green' : 'gray'}`} />
        <span>{isRadminFound ? `Radmin: ${status?.radminIp || effectiveIp}` : 'Локально'}</span>
      </div>

      {/* [ Мост (QR) ] */}
      {onOpenBridge && (
        <button
          class="miro-action-pill"
          data-testid="bridge-toggle-btn"
          onClick={onOpenBridge}
          title="Режим моста (QR-код для смартфона)"
        >
          <Icon name="smartphone" size={13} />
          <span>Мост</span>
        </button>
      )}

      {/* [ Settings / Настройки ] */}
      <button
        class="miro-action-pill settings-trigger-btn"
        onClick={onOpenSettings}
        title="Настройки холста, профиля и бэкапов"
        style={{ padding: '5px 8px' }}
      >
        <Icon name="settings" size={15} />
      </button>
    </div>
  );
}
