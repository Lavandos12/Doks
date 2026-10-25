import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import { activeTabId, openTabs } from '../../state/app-state.js';

interface FileMenuProps {
  onOpenImportWizard: () => void;
}

export function FileMenu({ onOpenImportWizard }: FileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeTab = openTabs.value.find((t) => t.id === activeTabId.value);
  const isNoteActive = activeTab?.type === 'note';
  const isBoardActive = activeTab?.type === 'board';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleExportNote = () => {
    if (activeTab && isNoteActive) {
      window.open(`/api/export/note/${activeTab.id}`, '_blank');
      setIsOpen(false);
    }
  };

  const handleExportBoard = () => {
    if (activeTab && isBoardActive) {
      window.open(`/api/export/board/${activeTab.id}`, '_blank');
      setIsOpen(false);
    }
  };

  const handleExportVault = () => {
    window.open('/api/export/vault', '_blank');
    setIsOpen(false);
  };

  const handleCreateBackup = async () => {
    try {
      setBackupNotice('Создание снимка...');
      const res = await fetch('/api/snapshots', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBackupNotice('Резервная копия создана!');
      } else {
        setBackupNotice('Ошибка создания копии');
      }
    } catch {
      setBackupNotice('Ошибка соединения');
    }
    setTimeout(() => {
      setBackupNotice(null);
      setIsOpen(false);
    }, 1800);
  };

  return (
    <div class="file-menu-container" ref={menuRef}>
      <button
        class={`file-menu-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Меню файла и экспорта"
      >
        <Icon name="menu" size={14} />
        <span>Файл</span>
      </button>

      {isOpen && (
        <div class="file-menu-dropdown">
          <div
            class="file-menu-item"
            onClick={() => {
              setIsOpen(false);
              onOpenImportWizard();
            }}
          >
            <Icon name="upload" size={14} />
            <span>Импорт файлов...</span>
          </div>

          <div class="file-menu-separator" />

          <div
            class={`file-menu-item ${!isNoteActive ? 'disabled' : ''}`}
            onClick={isNoteActive ? handleExportNote : undefined}
            title={isNoteActive ? 'Экспортировать текущую заметку в .md' : 'Откройте заметку для экспорта'}
          >
            <Icon name="file-text" size={14} />
            <span>Экспорт заметки (.md)</span>
          </div>

          <div
            class={`file-menu-item ${!isBoardActive ? 'disabled' : ''}`}
            onClick={isBoardActive ? handleExportBoard : undefined}
            title={isBoardActive ? 'Экспортировать текущую доску в .canvas' : 'Откройте доску для экспорта'}
          >
            <Icon name="layout" size={14} />
            <span>Экспорт доски (.canvas)</span>
          </div>

          <div class="file-menu-item" onClick={handleExportVault}>
            <Icon name="download" size={14} />
            <span>Экспорт хранилища (.zip)</span>
          </div>

          <div class="file-menu-separator" />

          <div class="file-menu-item" onClick={handleCreateBackup}>
            <Icon name="history" size={14} />
            <span>{backupNotice || 'Создать резервную копию'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
