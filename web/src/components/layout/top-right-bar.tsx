import { h, VNode } from 'preact';
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
          {/* 2. [ Phone ] Restored between Notes and Trash */}
          {onOpenBridge && (
            <button
              class="miro-action-pill"
              data-testid="phone-bridge-btn"
              onClick={onOpenBridge}
              title={t('topBar.phone')}
            >
              <Icon name="smartphone" size={14} />
              <span>{t('topBar.phone')}</span>
            </button>
          )}

          {/* 3. [ Trash ] Upgraded with clear violet styling & count badge */}
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

          {/* 4. [ AI Context ] */}
          <button
            class="miro-action-pill"
            data-testid="ai-export-btn"
            onClick={onOpenAiExport}
            title={t('topBar.aiContext')}
          >
            <Icon name="sparkles" size={14} />
            <span>{t('topBar.aiContext')}</span>
          </button>



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
