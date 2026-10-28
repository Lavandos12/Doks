import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import { activeTabId, openTabs } from '../../state/app-state.js';
import { t } from '../../i18n/index.js';
import { api } from '../../api/client.js';

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
      setBackupNotice(t('menu.snapshot_creating'));
      const res = await api.fetch('/api/snapshots', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBackupNotice(t('menu.snapshot_done'));
      } else {
        setBackupNotice(t('menu.snapshot_error'));
      }
    } catch {
      setBackupNotice(t('menu.snapshot_error'));
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
        title={t('menu.file')}
      >
        <Icon name="menu" size={14} />
        <span>{t('menu.file')}</span>
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
            <span>{t('menu.import')}</span>
          </div>

          <div class="file-menu-separator" />

          <div
            class={`file-menu-item ${!isNoteActive ? 'disabled' : ''}`}
            onClick={isNoteActive ? handleExportNote : undefined}
            title={isNoteActive ? t('menu.export_note') : ''}
          >
            <Icon name="file-text" size={14} />
            <span>{t('menu.export_note')}</span>
          </div>

          <div
            class={`file-menu-item ${!isBoardActive ? 'disabled' : ''}`}
            onClick={isBoardActive ? handleExportBoard : undefined}
            title={isBoardActive ? t('menu.export_board') : ''}
          >
            <Icon name="layout" size={14} />
            <span>{t('menu.export_board')}</span>
          </div>

          <div class="file-menu-item" onClick={handleExportVault}>
            <Icon name="download" size={14} />
            <span>{t('menu.export_vault')}</span>
          </div>

          <div class="file-menu-separator" />

          <div class="file-menu-item" onClick={handleCreateBackup}>
            <Icon name="history" size={14} />
            <span>{backupNotice || t('menu.create_snapshot')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
