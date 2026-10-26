import { h } from 'preact';
import {
  currentView,
  selectedNoteId,
  selectedBoardId,
  activeTabId,
  splitTabId,
  isSplitView,
  openTabs,
  createNote,
  createBoard,
  theme,
  isImportWizardOpen,
  isSidebarCollapsed
} from './state/app-state.js';
import { Sidebar } from './components/layout/sidebar.js';
import { TabBar } from './components/layout/tab-bar.js';
import { StatusBar } from './components/layout/status-bar.js';
import { CommandPalette } from './components/layout/command-palette.js';
import { ImportWizardModal } from './components/board/import-wizard-modal.js';
import { DialogContainer } from './ui/dialogs.js';
import { ToastContainer } from './ui/toast.js';
import { NoteEditor } from './components/notes/editor.js';
import { BoardCanvas } from './components/board/board-canvas.js';
import { NetworkScreen } from './components/network/network-screen.js';
import { HistoryScreen } from './components/history/history-screen.js';
import { SearchScreen } from './components/search/search-screen.js';
import { Icon } from './ui/icons.js';

export function App() {
  const activeTab = openTabs.value.find((t) => t.id === activeTabId.value);
  const splitTab = isSplitView.value ? openTabs.value.find((t) => t.id === splitTabId.value) : null;
  const isCanvasMode = currentView.value === 'board' && (!isSplitView.value || !splitTab) && (activeTab?.type === 'board' || !activeTab);

  const renderDocContent = (tab: { id: string; type: 'note' | 'board' } | undefined) => {
    if (!tab) {
      return (
        <div class="empty-view-placeholder">
          <div class="placeholder-icon-circle">
            <Icon name="sparkles" size={32} class="placeholder-icon" />
          </div>
          <h2>Рабочее пространство Doks</h2>
          <p>Локальные markdown-заметки со связями [[так]] и бесконечные доски для команды.</p>
          <div class="placeholder-actions">
            <button class="btn-primary" onClick={() => createNote()}>
              <Icon name="file-text" size={16} />
              <span>Создать заметку</span>
            </button>
            <button class="btn-secondary" onClick={() => createBoard()}>
              <Icon name="layout" size={16} />
              <span>Создать доску</span>
            </button>
          </div>
        </div>
      );
    }

    if (tab.type === 'note') {
      return <NoteEditor key={`note-${tab.id}`} noteId={tab.id} />;
    } else {
      return <BoardCanvas key={`board-${tab.id}`} boardId={tab.id} />;
    }
  };

  return (
    <div class={`app-layout theme-${theme.value} ${isSidebarCollapsed.value ? 'sidebar-collapsed' : ''} ${isCanvasMode ? 'view-board-canvas' : ''}`}>
      <Sidebar />

      <div class="main-area">
        {!isCanvasMode && <TabBar />}

        <main class="main-viewport">
          {currentView.value === 'network' && <NetworkScreen />}
          {currentView.value === 'history' && <HistoryScreen />}
          {currentView.value === 'search' && <SearchScreen />}

          {(currentView.value === 'notes' || currentView.value === 'board') && (
            isSplitView.value && splitTab ? (
              <div class="split-view-container app-split-container">
                <div class="split-pane primary">
                  {renderDocContent(activeTab)}
                </div>
                <div class="split-divider"></div>
                <div class="split-pane secondary">
                  {renderDocContent(splitTab)}
                </div>
              </div>
            ) : (
              <div class="single-view-container">
                {renderDocContent(activeTab)}
              </div>
            )
          )}
        </main>

        <StatusBar />
      </div>

      <CommandPalette />
      <ImportWizardModal
        isOpen={isImportWizardOpen.value}
        onClose={() => (isImportWizardOpen.value = false)}
      />
      <DialogContainer />
      <ToastContainer />
    </div>
  );
}
