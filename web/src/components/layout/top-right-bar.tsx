import { h, VNode } from 'preact';
import {
  workspaceMode,
  setWorkspaceMode,
  agentStatus,
  isViewerMode,
  allTrashNotes,
  allTrashBoards
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { t, currentLanguage, cycleLanguage } from '../../i18n/index.js';

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
        title={t('topbar.notes')}
      >
        <Icon name="file-text" size={14} />
        <span>{t('topbar.notes')}</span>
      </button>

      {!isViewer && (
        <>
          {/* [ ИИ-Контекст ] */}
          <button
            class="miro-action-pill"
            data-testid="ai-export-btn"
            onClick={onOpenAiExport}
            title={t('topbar.ai_context')}
          >
            <Icon name="sparkles" size={14} />
            <span>{t('topbar.ai_context')}</span>
          </button>

          {/* [ ● Radmin / Локально ] */}
          <div
            class="miro-network-pill"
            onClick={onOpenNetwork}
            title="Radmin VPN / P2P"
            style={{ cursor: 'pointer' }}
          >
            <span class={`status-dot ${isRadminFound ? 'green' : 'gray'}`} />
            <span>{isRadminFound ? `Radmin: ${status?.radminIp || effectiveIp}` : t('topbar.local')}</span>
          </div>

          {/* [ Мост (QR) ] */}
          {onOpenBridge && (
            <button
              class="miro-action-pill"
              data-testid="bridge-toggle-btn"
              onClick={onOpenBridge}
              title={t('topbar.bridge')}
            >
              <Icon name="smartphone" size={13} />
              <span>{t('topbar.bridge')}</span>
            </button>
          )}

          {/* [ Trash / Корзина ] */}
          {onOpenTrash && (
            <button
              class="miro-action-pill"
              data-testid="trash-toggle-btn"
              onClick={onOpenTrash}
              title={t('topbar.trash')}
            >
              <Icon name="trash" size={14} />
              <span>{t('topbar.trash')}</span>
              {(allTrashNotes.value.length + allTrashBoards.value.length) > 0 && (
                <span class="trash-count-pill">
                  {allTrashNotes.value.length + allTrashBoards.value.length}
                </span>
              )}
            </button>
          )}

          {/* [ Language Switcher: RU / EN / ES ] */}
          <button
            type="button"
            class="miro-action-pill lang-switch-pill"
            onClick={cycleLanguage}
            title={t('settings.language')}
            style={{ padding: '5px 8px', fontWeight: 700, color: '#c084fc' }}
          >
            <span>{currentLanguage.value.toUpperCase()}</span>
          </button>

          {/* [ Settings / Настройки ] */}
          <button
            class="miro-action-pill settings-trigger-btn"
            onClick={onOpenSettings}
            title={t('topbar.settings')}
            style={{ padding: '5px 8px' }}
          >
            <Icon name="settings" size={15} />
          </button>
        </>
      )}
    </div>
  );
}
