import { h } from 'preact';
import {
  openTabs,
  activeTabId,
  splitTabId,
  isSplitView,
  openTab,
  closeTab,
  togglePinTab,
  toggleSplitView,
  createNote,
  isImportWizardOpen,
  currentScope,
  setScope,
  workspaceMode,
  setWorkspaceMode
} from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';
import { FileMenu } from './file-menu.js';

export function TabBar() {
  const tabs = openTabs.value;

  return (
    <div class="tabs-bar">
      <FileMenu onOpenImportWizard={() => (isImportWizardOpen.value = true)} />

      {/* Two-Tier Scope Switcher (Solo vs Team) */}
      <div class="scope-switcher-pill" role="tablist" aria-label="Пространство">
        <button
          class={`scope-pill-btn ${currentScope.value === 'solo' ? 'active solo' : ''}`}
          onClick={() => setScope('solo')}
          title="Личное пространство (только на этом ПК, Alt+1)"
        >
          <Icon name="lock" size={13} class="scope-icon-svg" />
          <span class="scope-label">Соло</span>
        </button>
        <button
          class={`scope-pill-btn ${currentScope.value === 'team' ? 'active team' : ''}`}
          onClick={() => setScope('team')}
          title="Командное пространство (P2P меш-синхронизация, Alt+2)"
        >
          <Icon name="globe-mesh" size={13} class="scope-icon-svg" />
          <span class="scope-label">Команда</span>
        </button>
      </div>

      <div class="tabs-scroll-area">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId.value;
          const isSplitActive = isSplitView.value && tab.id === splitTabId.value;

          return (
            <div
              key={tab.id}
              class={`tab-item ${isActive ? 'active' : ''} ${isSplitActive ? 'split-active' : ''}`}
              onClick={() => openTab(tab.type, tab.id, tab.title)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  // Middle click closes tab
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              title={tab.title}
            >
              <Icon
                name={tab.type === 'note' ? 'file-text' : 'layout'}
                size={14}
                class="tab-type-icon"
              />
              <span class="tab-title">{tab.title}</span>

              {tab.pinned && (
                <button
                  class="tab-pin-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinTab(tab.id);
                  }}
                  title="Открепить вкладку"
                >
                  <Icon name="pin" size={12} />
                </button>
              )}

              {!tab.pinned && (
                <button
                  class="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title="Закрыть вкладку (Ctrl+W)"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          );
        })}

        <button class="new-tab-btn" onClick={() => createNote()} title="Создать новую заметку">
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div class="tabs-actions">
        {/* Three Seamless Workspace Modes */}
        <div class="workspace-mode-segmented-pill" role="tablist" aria-label="Режим рабочей области">
          <button
            class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'canvas' ? 'active' : ''}`}
            data-mode="canvas"
            onClick={() => setWorkspaceMode('canvas')}
            title="Холст (Бесконечная доска)"
          >
            <Icon name="layout-canvas" size={14} />
            <span class="mode-label">Холст</span>
          </button>
          <button
            class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'split' ? 'active' : ''}`}
            data-mode="split"
            onClick={() => setWorkspaceMode('split')}
            title="Сплит (Холст + Заметка рядом, Ctrl+\)"
          >
            <Icon name="layout-split" size={14} />
            <span class="mode-label">Сплит</span>
          </button>
          <button
            class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'vault' ? 'active' : ''}`}
            data-mode="vault"
            onClick={() => setWorkspaceMode('vault')}
            title="Заметки (Редактор базы знаний)"
          >
            <Icon name="layout-doc" size={14} />
            <span class="mode-label">Заметки</span>
          </button>
        </div>
      </div>
    </div>
  );
}
