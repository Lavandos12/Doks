import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  isCommandPaletteOpen,
  isQuickSwitcherOpen,
  isImportWizardOpen,
  activeTabId,
  openTabs,
  notes,
  boards,
  allBoards,
  openTab,
  createNote,
  createBoard,
  toggleSplitView,
  currentView,
  setScope,
  currentScope,
  setWorkspaceMode,
  workspaceMode,
  yjsClient
} from '../../state/app-state.js';
import { getScopedBoardDocName, getBoardMaps, nodeMapToData } from '@doks/shared';
import { Icon, type IconName } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';
import { api } from '../../api/client.js';

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  action: () => void;
}

export function CommandPalette() {
  const isOpen = isCommandPaletteOpen.value || isQuickSwitcherOpen.value;
  const isQuickSwitch = isQuickSwitcherOpen.value;
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => {
    isCommandPaletteOpen.value = false;
    isQuickSwitcherOpen.value = false;
  };

  const activeNotes = notes.value.filter((n) => !n.deleted);
  const activeBoards = allBoards.value.filter((b) => !b.deleted);

  let items: PaletteItem[] = [];

  if (isQuickSwitch) {
    // Quick switcher: search notes and boards
    const noteItems: PaletteItem[] = activeNotes.map((n) => ({
      id: `note-${n.id}`,
      title: n.title,
      subtitle: t('topBar.notes'),
      icon: 'file-text',
      action: () => {
        openTab('note', n.id, n.title);
        close();
      }
    }));
    const boardItems: PaletteItem[] = activeBoards.map((b) => ({
      id: `board-${b.id}`,
      title: b.title,
      subtitle: t('sidebar.boards'),
      icon: 'layout',
      action: () => {
        openTab('board', b.id, b.title);
        close();
      }
    }));
    items = [...noteItems, ...boardItems];
  } else {
    // Command palette: system actions + documents
    items = [
      {
        id: 'cmd-scope-solo',
        title: `${t('topbar.solo')} (Solo)`,
        subtitle: 'Local storage on this PC (Alt+1)',
        icon: 'lock',
        action: () => {
          setScope('solo');
          close();
        }
      },
      {
        id: 'cmd-scope-team',
        title: `${t('topbar.team')} (Live Sync)`,
        subtitle: 'Sync with co-authors (Alt+2)',
        icon: 'globe-mesh',
        action: () => {
          setScope('team');
          close();
        }
      },
      {
        id: 'cmd-mode-canvas',
        title: 'Mode: Canvas',
        subtitle: 'Infinite board canvas',
        icon: 'layout-canvas',
        action: () => {
          setWorkspaceMode('canvas');
          close();
        }
      },
      {
        id: 'cmd-mode-split',
        title: 'Mode: Split',
        subtitle: 'Canvas & editor side-by-side (Ctrl+\\)',
        icon: 'layout-split',
        action: () => {
          setWorkspaceMode('split');
          close();
        }
      },
      {
        id: 'cmd-mode-vault',
        title: 'Mode: Notes',
        subtitle: 'Full-screen knowledge base',
        icon: 'layout-doc',
        action: () => {
          setWorkspaceMode('vault');
          close();
        }
      },
      {
        id: 'cmd-new-note',
        title: t('sidebar.new_note'),
        subtitle: 'Markdown document',
        icon: 'file-text',
        action: () => {
          createNote();
          close();
        }
      },
      {
        id: 'cmd-new-board',
        title: t('sidebar.new_board'),
        subtitle: 'JSON Canvas infinite board',
        icon: 'layout',
        action: () => {
          window.dispatchEvent(new CustomEvent('doks:open-create-board'));
          close();
        }
      },
      {
        id: 'cmd-split-view',
        title: 'Toggle Split View',
        subtitle: 'Split View side-by-side',
        icon: 'columns',
        action: () => {
          toggleSplitView();
          close();
        }
      },
      {
        id: 'cmd-network',
        title: t('share.tabShare'),
        subtitle: 'Network status & sharing',
        icon: 'wifi',
        action: () => {
          window.dispatchEvent(new CustomEvent('doks:open-network'));
          close();
        }
      },
      {
        id: 'cmd-history',
        title: t('sidebar.history'),
        subtitle: 'Document snapshots & versions',
        icon: 'history',
        action: () => {
          currentView.value = 'history';
          close();
        }
      },
      {
        id: 'cmd-import-wizard',
        title: t('menu.import'),
        subtitle: 'Import Markdown, Canvas, CSV, DOCX, ZIP',
        icon: 'upload',
        action: () => {
          isImportWizardOpen.value = true;
          close();
        }
      },
      {
        id: 'cmd-export-vault',
        title: t('menu.export_vault'),
        subtitle: 'Complete notes & boards archive',
        icon: 'download',
        action: () => {
          window.open('/api/export/vault', '_blank');
          close();
        }
      },
      {
        id: 'cmd-history-trash',
        title: `${t('sidebar.history')} & ${t('topbar.trash')}`,
        subtitle: 'Version restore & trash',
        icon: 'history',
        action: () => {
          window.dispatchEvent(new CustomEvent('doks:open-history'));
          close();
        }
      },
      {
        id: 'cmd-create-snapshot',
        title: t('menu.create_snapshot'),
        subtitle: 'Instant snapshot of all documents',
        icon: 'history',
        action: async () => {
          try {
            await api.fetch('/api/snapshots', { method: 'POST' });
          } catch {}
          close();
        }
      },
      ...(() => {
        const activeTab = openTabs.value.find((t) => t.id === activeTabId.value);
        const dynamicItems: PaletteItem[] = [];
        if (activeTab?.type === 'note') {
          dynamicItems.push({
            id: 'cmd-export-active-note',
            title: `Export note "${activeTab.title}" (.md)`,
            subtitle: 'Download markdown file',
            icon: 'file-text',
            action: () => {
              window.open(`/api/export/note/${activeTab.id}`, '_blank');
              close();
            }
          });
        }
        if (activeTab?.type === 'board') {
          dynamicItems.push({
            id: 'cmd-export-active-board',
            title: `Export board "${activeTab.title}" (.canvas)`,
            subtitle: 'Download JSON Canvas',
            icon: 'layout',
            action: () => {
              window.open(`/api/export/board/${activeTab.id}`, '_blank');
              close();
            }
          });
        }
        return dynamicItems;
      })(),
      ...activeNotes.map((n) => ({
        id: `note-${n.id}`,
        title: n.title,
        subtitle: t('topBar.notes'),
        icon: 'file-text' as IconName,
        action: () => {
          openTab('note', n.id, n.title);
          close();
        }
      })),
      ...activeBoards.map((b) => ({
        id: `board-${b.id}`,
        title: b.title,
        subtitle: t('sidebar.boards'),
        icon: 'layout' as IconName,
        action: () => {
          openTab('board', b.id, b.title);
          close();
        }
      })),
      ...(() => {
        const activeTab = openTabs.value.find((t) => t.id === activeTabId.value);
        if (activeTab?.type !== 'board') return [];
        const cardItems: PaletteItem[] = [];
        try {
          const bDoc = yjsClient.getOrCreateDoc(getScopedBoardDocName(currentScope.value, activeTab.id));
          const { nodes: yNodes } = getBoardMaps(bDoc);
          yNodes.forEach((nodeMap, nId) => {
            const data = nodeMapToData(nId, nodeMap);
            if (!data.deleted && data.text && data.text.trim()) {
              const preview = data.text.replace(/\r?\n/g, ' ').trim();
              cardItems.push({
                id: `card-${data.id}`,
                title: preview.length > 50 ? preview.slice(0, 50) + '...' : preview,
                subtitle: `Board card (${data.type})`,
                icon: 'file-text' as IconName,
                action: () => {
                  window.dispatchEvent(new CustomEvent('doks-focus-node', { detail: { nodeId: data.id } }));
                  close();
                }
              });
            }
          });
        } catch {}
        return cardItems;
      })()
    ];
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.subtitle && i.subtitle.toLowerCase().includes(q))
      )
    : items;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div class="palette-overlay" onClick={close}>
      <div class="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div class="palette-search-wrapper">
          <Icon name="search" size={18} class="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            class="palette-input"
            placeholder={isQuickSwitch ? t('palette.switch_placeholder') : t('palette.search_placeholder')}
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd class="palette-shortcut-badge">ESC</kbd>
        </div>

        <div class="palette-list">
          {filtered.length === 0 ? (
            <div class="palette-empty">{t('palette.empty')}</div>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                class={`palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => item.action()}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <Icon name={item.icon} size={18} class="palette-item-icon" />
                <div class="palette-item-info">
                  <span class="palette-item-title">{item.title}</span>
                  {item.subtitle && <span class="palette-item-subtitle">{item.subtitle}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
