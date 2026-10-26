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
  isNotesOpen?: boolean;
}

export function TopRightBar({
  onToggleNotes,
  onOpenAiExport,
  onOpenNetwork,
  onOpenSettings,
  isNotesOpen = false
}: TopRightBarProps): VNode {
  const status = agentStatus.value;
  const isRadminFound = Boolean(status?.radminFound || status?.radminIp);
  const effectiveIp = status?.effectiveIp || '127.0.0.1';

  return (
    <div
      class="miro-actions-bar liquid-glass-surface"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Workspace Mode Segmented Pill */}
      <div class="workspace-mode-segmented-pill" role="tablist" aria-label="Режим рабочей области">
        <button
          class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'canvas' ? 'active' : ''}`}
          data-mode="canvas"
          onClick={() => setWorkspaceMode('canvas')}
          title="Холст (Бесконечная доска)"
        >
          <Icon name="layout-canvas" size={13} />
          <span class="mode-label">Холст</span>
        </button>
        <button
          class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'split' ? 'active' : ''}`}
          data-mode="split"
          onClick={() => setWorkspaceMode('split')}
          title="Сплит (Холст + Заметка рядом, Ctrl+\)"
        >
          <Icon name="layout-split" size={13} />
          <span class="mode-label">Сплит</span>
        </button>
        <button
          class={`mode-pill-btn workspace-mode-btn ${isNotesOpen || workspaceMode.value === 'vault' ? 'active' : ''}`}
          data-mode="vault"
          onClick={() => {
            setWorkspaceMode('vault');
            onToggleNotes();
          }}
          title="Заметки (Шторка заметок поверх доски)"
        >
          <Icon name="file-text" size={13} />
          <span class="mode-label">Заметки</span>
        </button>
      </div>

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
