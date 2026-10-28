import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { HistoryScreen } from './components/history/history-screen.js';
import { Icon } from './ui/icons.js';
import {
  currentView,
  selectedBoardId,
  activeTabId,
  splitTabId,
  isSplitView,
  openTabs,
  boards,
  theme,
  isImportWizardOpen
} from './state/app-state.js';
import { TopRightBar } from './components/layout/top-right-bar.js';
import { NotesDrawer } from './components/layout/notes-drawer.js';
import { NetworkPopover } from './components/layout/network-popover.js';
import { SettingsModal } from './components/layout/settings-modal.js';
import { CommandPalette } from './components/layout/command-palette.js';
import { ImportWizardModal } from './components/board/import-wizard-modal.js';
import { AiExportModal } from './components/board/ai-export-modal.js';
import { DialogContainer } from './ui/dialogs.js';
import { ToastContainer } from './ui/toast.js';
import { NoteEditor } from './components/notes/editor.js';
import { BoardCanvas } from './components/board/board-canvas.js';
import { showToast } from './ui/toast.js';

export function App() {
  const [isAiExportOpen, setIsAiExportOpen] = useState(false);
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    const handleOpenHistory = () => setIsHistoryOpen(true);
    const handleOpenNetwork = () => setIsNetworkOpen(true);
    window.addEventListener('doks:open-history', handleOpenHistory);
    window.addEventListener('doks:open-network', handleOpenNetwork);
    return () => {
      window.removeEventListener('doks:open-history', handleOpenHistory);
      window.removeEventListener('doks:open-network', handleOpenNetwork);
    };
  }, []);
  const [gridType, setGridType] = useState<'dots' | 'lines' | 'none'>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('doks_grid_type') : null;
    return (saved === 'dots' || saved === 'lines' || saved === 'none') ? (saved as any) : 'lines';
  });
  const [snapToGrid, setSnapToGrid] = useState(false);

  const handleSetGridType = (nextType: 'dots' | 'lines' | 'none') => {
    setGridType(nextType);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('doks_grid_type', nextType);
    }
  };

  const activeTab = openTabs.value.find((t) => t.id === activeTabId.value);
  const splitTab = isSplitView.value ? openTabs.value.find((t) => t.id === splitTabId.value) : null;
  const isSplitMode = Boolean(isSplitView.value && splitTab);

  // Fallback board ID if no tab is currently selected
  const activeBoardId = activeTab?.type === 'board'
    ? activeTab.id
    : (boards.value.find((b) => !b.deleted)?.id || 'default');

  const handleDropNoteToCanvas = (noteId: string, title: string, text: string) => {
    // Notify user; BoardCanvas will capture or we can dispatch a custom event
    const event = new CustomEvent('doks:drop-note', {
      detail: { noteId, title, text }
    });
    window.dispatchEvent(event);
  };

  return (
    <div class={`app-layout theme-${theme.value} view-board-canvas`}>
      {/* Miro 100vw × 100vh Unified Workspace */}
      <main class="main-viewport" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        {isSplitMode ? (
          <div class="split-view-container app-split-container">
            <div class="split-pane primary">
              <BoardCanvas
                key={`board-${activeBoardId}`}
                boardId={activeBoardId}
                gridType={gridType}
                snapToGrid={snapToGrid}
              />
            </div>
            <div class="split-divider" />
            <div class="split-pane secondary">
              {splitTab && splitTab.type === 'note' ? (
                <NoteEditor key={`note-${splitTab.id}`} noteId={splitTab.id} />
              ) : (
                <BoardCanvas
                  key={`board-${splitTab?.id || activeBoardId}`}
                  boardId={splitTab?.id || activeBoardId}
                  gridType={gridType}
                  snapToGrid={snapToGrid}
                />
              )}
            </div>
          </div>
        ) : (
          <div class="single-view-container" style={{ width: '100%', height: '100%' }}>
            <BoardCanvas
              key={`board-${activeBoardId}`}
              boardId={activeBoardId}
              gridType={gridType}
              snapToGrid={snapToGrid}
            />
          </div>
        )}
      </main>

      {/* Global Top-Right Island */}
      <TopRightBar
        onToggleNotes={() => setIsNotesOpen(!isNotesOpen)}
        onOpenAiExport={() => setIsAiExportOpen(true)}
        onOpenNetwork={() => setIsNetworkOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isNotesOpen={isNotesOpen}
      />

      {/* Slide-Over Notes Drawer */}
      <NotesDrawer
        isOpen={isNotesOpen}
        onClose={() => setIsNotesOpen(false)}
        onDropNoteToCanvas={handleDropNoteToCanvas}
      />

      {/* AI Context Export Modal */}
      {isAiExportOpen && (
        <AiExportModal
          boardId={activeBoardId}
          onClose={() => setIsAiExportOpen(false)}
        />
      )}

      {/* Radmin VPN / LAN Modal */}
      {isNetworkOpen && (
        <NetworkPopover
          isOpen={isNetworkOpen}
          onClose={() => setIsNetworkOpen(false)}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          gridType={gridType}
          onSetGridType={handleSetGridType}
          snapToGrid={snapToGrid}
          onSetSnapToGrid={setSnapToGrid}
          onExportJson={() => {
            window.dispatchEvent(new CustomEvent('doks:export-json'));
            setIsSettingsOpen(false);
          }}
          onExportSvg={() => {
            window.dispatchEvent(new CustomEvent('doks:export-svg'));
            setIsSettingsOpen(false);
          }}
        />
      )}

      {/* History and Trash Modal Dialog */}
      {isHistoryOpen && (
        <div class="modal-backdrop doks-modal-backdrop" onClick={() => setIsHistoryOpen(false)}>
          <div
            class="history-modal-dialog liquid-glass-surface"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '90vw',
              maxWidth: '960px',
              height: '80vh',
              maxHeight: '720px',
              background: '#0e1117',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 20px',
                borderBottom: '1px solid #1e293b'
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>История снимков и Корзина</h2>
              <button
                class="btn-icon"
                onClick={() => setIsHistoryOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                title="Закрыть"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <HistoryScreen />
            </div>
          </div>
        </div>
      )}

      {/* Global Command Palette & Modals */}
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
