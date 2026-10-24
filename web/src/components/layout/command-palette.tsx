import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  isCommandPaletteOpen,
  isQuickSwitcherOpen,
  notes,
  boards,
  openTab,
  createNote,
  createBoard,
  toggleSplitView,
  theme,
  setTheme,
  currentView
} from '../../state/app-state.js';
import { Icon, type IconName } from '../../ui/icons.js';

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
  const activeBoards = boards.value.filter((b) => !b.deleted);

  let items: PaletteItem[] = [];

  if (isQuickSwitch) {
    // Quick switcher: search notes and boards
    const noteItems: PaletteItem[] = activeNotes.map((n) => ({
      id: `note-${n.id}`,
      title: n.title,
      subtitle: 'Заметка',
      icon: 'file-text',
      action: () => {
        openTab('note', n.id, n.title);
        close();
      }
    }));
    const boardItems: PaletteItem[] = activeBoards.map((b) => ({
      id: `board-${b.id}`,
      title: b.title,
      subtitle: 'Доска',
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
        id: 'cmd-new-note',
        title: 'Создать новую заметку',
        subtitle: 'Markdown документ',
        icon: 'file-text',
        action: () => {
          createNote();
          close();
        }
      },
      {
        id: 'cmd-new-board',
        title: 'Создать новую доску',
        subtitle: 'Бесконечный холст JSON Canvas',
        icon: 'layout',
        action: () => {
          createBoard();
          close();
        }
      },
      {
        id: 'cmd-split-view',
        title: 'Разделить / объединить экран',
        subtitle: 'Split View рядом',
        icon: 'columns',
        action: () => {
          toggleSplitView();
          close();
        }
      },
      {
        id: 'cmd-toggle-theme',
        title: `Переключить тему на ${theme.value === 'dark' ? 'светлую' : 'тёмную'}`,
        subtitle: 'Дизайн системы',
        icon: theme.value === 'dark' ? 'sun' : 'moon',
        action: () => {
          setTheme(theme.value === 'dark' ? 'light' : 'dark');
          close();
        }
      },
      {
        id: 'cmd-network',
        title: 'Участники и сеть Radmin',
        subtitle: 'Список пиров и подключений',
        icon: 'wifi',
        action: () => {
          currentView.value = 'network';
          close();
        }
      },
      {
        id: 'cmd-history',
        title: 'Снимки и история',
        subtitle: 'Резервные копии документов',
        icon: 'history',
        action: () => {
          currentView.value = 'history';
          close();
        }
      },
      ...activeNotes.map((n) => ({
        id: `note-${n.id}`,
        title: n.title,
        subtitle: 'Заметка',
        icon: 'file-text' as IconName,
        action: () => {
          openTab('note', n.id, n.title);
          close();
        }
      })),
      ...activeBoards.map((b) => ({
        id: `board-${b.id}`,
        title: b.title,
        subtitle: 'Доска',
        icon: 'layout' as IconName,
        action: () => {
          openTab('board', b.id, b.title);
          close();
        }
      }))
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
            placeholder={isQuickSwitch ? 'Быстрый переход к заметке или доске...' : 'Введите команду или название...'}
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
            <div class="palette-empty">Ничего не найдено</div>
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
