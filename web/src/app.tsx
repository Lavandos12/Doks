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
  allBoards,
  theme,
  isImportWizardOpen,
  agentStatus,
  isViewerMode,
  selectBoardWithScope
} from './state/app-state.js';
import { TopRightBar } from './components/layout/top-right-bar.js';
import { NotesDrawer } from './components/layout/notes-drawer.js';
import { SettingsModal } from './components/layout/settings-modal.js';
import { ShareModal } from './components/layout/share-modal.js';
import { CommandPalette } from './components/layout/command-palette.js';
import { ImportWizardModal } from './components/board/import-wizard-modal.js';
import { AiExportModal } from './components/board/ai-export-modal.js';
import { DialogContainer } from './ui/dialogs.js';
import { ToastContainer } from './ui/toast.js';
import { NoteEditor } from './components/notes/editor.js';
import { BoardCanvas } from './components/board/board-canvas.js';
import { showToast } from './ui/toast.js';
import { t } from './i18n/index.js';

export function App() {
  const [isAiExportOpen, setIsAiExportOpen] = useState(false);
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    const handleOpenHistory = () => setIsHistoryOpen(true);
    const handleOpenNetwork = () => setIsNetworkOpen(true);
    const handleOpenBridge = () => setIsBridgeOpen(true);
    window.addEventListener('doks:open-history', handleOpenHistory);
    window.addEventListener('doks:open-network', handleOpenNetwork);
    window.addEventListener('doks:open-bridge', handleOpenBridge);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openBridge') === '1') {
      setIsBridgeOpen(true);
    }

    return () => {
      window.removeEventListener('doks:open-history', handleOpenHistory);
      window.removeEventListener('doks:open-network', handleOpenNetwork);
      window.removeEventListener('doks:open-bridge', handleOpenBridge);
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
    : (allBoards.value.find((b) => !b.deleted)?.id || boards.value.find((b) => !b.deleted)?.id || 'default');

  const currentBoard = allBoards.value.find((b) => b.id === activeBoardId) || boards.value.find((b) => b.id === activeBoardId);
  const openBoardTitle = (currentBoard?.title || (activeTab?.type === 'board' ? activeTab.title : '') || '').trim();

  // Universal Board URL routing (/b/:boardId or ?board=:id)
  useEffect(() => {
    const pathMatch = window.location.pathname.match(/\/b\/([a-zA-Z0-9_-]+)/);
    const queryMatch = new URLSearchParams(window.location.search).get('board');
    const requestedBoardId = pathMatch ? pathMatch[1] : (queryMatch || null);

    if (requestedBoardId) {
      selectBoardWithScope(requestedBoardId, 'team', 'Shared Board');
    }
  }, []);

  useEffect(() => {
    if (activeBoardId && activeBoardId !== 'default') {
      const newPath = `/b/${activeBoardId}`;
      if (window.location.pathname !== newPath) {
        window.history.replaceState(null, '', newPath);
      }
    }
  }, [activeBoardId]);

  // Dynamically update document title to show Doks and open board title
  useEffect(() => {
    if (openBoardTitle) {
      document.title = `Doks — ${openBoardTitle}`;
    } else {
      document.title = 'Doks';
    }
  }, [openBoardTitle]);

  const handleDropNoteToCanvas = (noteId: string, title: string, text: string) => {
    // Notify user; BoardCanvas will capture or we can dispatch a custom event
    const event = new CustomEvent('doks:drop-note', {
      detail: { noteId, title, text }
    });
    window.dispatchEvent(event);
  };

  const isViewer = Boolean(isViewerMode.value || agentStatus.value?.viewerMode);

  return (
    <div class={`app-layout theme-${theme.value} view-board-canvas ${isViewer ? 'is-viewer-mode' : ''}`}>
      {/* Read-Only Viewer Banner for Phone/Bridge sessions */}
      {isViewer && (
        <div
          class="bridge-viewer-banner"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'rgba(99, 102, 241, 0.95)',
            color: '#ffffff',
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)'
          }}
        >
          <Icon name="lock" size={14} />
          <span>{t('topbar.viewer_banner')}</span>
        </div>
      )}

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
        onOpenBridge={() => setIsBridgeOpen(true)}
        onOpenTrash={() => setIsHistoryOpen(true)}
        isNotesOpen={isNotesOpen}
        isSplitMode={isSplitMode}
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

      {/* Direct Connect & Cloud Sync Modal */}
      {isNetworkOpen && (
        <ShareModal
          isOpen={isNetworkOpen}
          onClose={() => setIsNetworkOpen(false)}
          initialTab="share"
        />
      )}

      {/* Bridge (Phone QR) Modal */}
      {isBridgeOpen && (
        <ShareModal
          isOpen={isBridgeOpen}
          onClose={() => setIsBridgeOpen(false)}
          initialTab="phone"
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
            <div style={{ flex: 1, overflow: 'auto' }}>
              <HistoryScreen onClose={() => setIsHistoryOpen(false)} />
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
