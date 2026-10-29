import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';
import { openTab, currentScope } from '../../state/app-state.js';
import { api } from '../../api/client.js';

interface ImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StagedFile {
  file: File;
  name: string;
  size: number;
  ext: string;
  targetType: 'note' | 'board';
}

export function ImportWizardModal({ isOpen, onClose }: ImportWizardModalProps) {
  if (!isOpen) return null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<{
    total: number;
    notesCount: number;
    boardsCount: number;
    errors: string[];
  } | null>(null);

  const handleFilesSelected = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const filesArray = Array.from(input.files);
    const staged: StagedFile[] = filesArray.map((file) => {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const targetType: 'note' | 'board' = ext === '.canvas' ? 'board' : 'note';
      return {
        file,
        name: file.name,
        size: file.size,
        ext,
        targetType
      };
    });

    setStagedFiles(staged);
    setImportReport(null);
  };

  const executeImport = async () => {
    if (stagedFiles.length === 0) return;
    setIsImporting(true);

    let notesCount = 0;
    let boardsCount = 0;
    const errors: string[] = [];

    for (const item of stagedFiles) {
      try {
        const buffer = await item.file.arrayBuffer();
        const res = await api.fetch(`/api/import/file?scope=${encodeURIComponent(currentScope.value)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(item.name),
            'x-as-board': item.targetType === 'board' ? 'true' : 'false'
          },
          body: buffer
        });

        if (!res.ok) {
          errors.push(`Import error ${item.name}: ${res.statusText}`);
          continue;
        }

        const data = await res.json();
        if (data.type === 'board') {
          boardsCount++;
          if (stagedFiles.length === 1) {
            openTab('board', data.id, item.name.replace(/\.[^/.]+$/, ''));
          }
        } else {
          notesCount++;
          if (stagedFiles.length === 1) {
            openTab('note', data.id, item.name.replace(/\.[^/.]+$/, ''));
          }
        }
      } catch (err: any) {
        errors.push(`Read failure ${item.name}: ${err.message}`);
      }
    }

    setIsImporting(false);
    setImportReport({
      total: stagedFiles.length,
      notesCount,
      boardsCount,
      errors
    });
    setStagedFiles([]);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal-dialog import-wizard-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="modal-title-row">
            <Icon name="upload" size={18} />
            <h3>{t('importWizard.title')}</h3>
          </div>
          <button class="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body">
          {importReport ? (
            <div class="import-report-box">
              <div class="report-header">
                <Icon name="check" size={24} class="report-success-icon" />
                <h4>{t('importWizard.success')}</h4>
              </div>
              <div class="report-stats">
                <div class="report-stat-row">
                  <span>{t('importWizard.processed')}</span>
                  <strong>{importReport.total}</strong>
                </div>
                <div class="report-stat-row">
                  <span>{t('importWizard.notesCreated')}</span>
                  <strong>{importReport.notesCount}</strong>
                </div>
                <div class="report-stat-row">
                  <span>{t('importWizard.boardsCreated')}</span>
                  <strong>{importReport.boardsCount}</strong>
                </div>
              </div>

              {importReport.errors.length > 0 && (
                <div class="report-errors">
                  <h5>{t('importWizard.notices')}</h5>
                  <ul>
                    {importReport.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div class="modal-actions-row" style={{ marginTop: '20px' }}>
                <button class="btn btn-primary" onClick={onClose}>
                  {t('importWizard.done')}
                </button>
              </div>
            </div>
          ) : stagedFiles.length === 0 ? (
            <div
              class="import-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer?.files) {
                  const input = fileInputRef.current;
                  if (input) {
                    input.files = e.dataTransfer.files;
                    handleFilesSelected({ target: input } as any);
                  }
                }
              }}
            >
              <Icon name="upload" size={36} class="dropzone-icon" />
              <h4>{t('importWizard.dropzoneTitle')}</h4>
              <p>{t('importWizard.dropzoneDesc')}</p>
              <button class="btn btn-secondary" style={{ marginTop: '12px' }}>
                {t('importWizard.browse')}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                accept=".md,.canvas,.csv,.html,.docx,.zip,.txt"
                onChange={handleFilesSelected}
              />
            </div>
          ) : (
            <div>
              <div class="staged-files-header">
                <span>{t('importWizard.selectedFiles', { count: stagedFiles.length })}</span>
                <button
                  class="btn btn-link btn-sm"
                  onClick={() => setStagedFiles([])}
                  disabled={isImporting}
                >
                  {t('importWizard.clear')}
                </button>
              </div>

              <div class="staged-files-list">
                {stagedFiles.map((sf, idx) => (
                  <div key={idx} class="staged-file-row">
                    <Icon name={sf.targetType === 'board' ? 'layout' : 'file-text'} size={16} />
                    <span class="staged-file-name" title={sf.name}>
                      {sf.name}
                    </span>
                    <span class="staged-file-size">{formatBytes(sf.size)}</span>
                    <select
                      class="staged-file-type-select"
                      value={sf.targetType}
                      onChange={(e) => {
                        const val = (e.target as HTMLSelectElement).value as 'note' | 'board';
                        setStagedFiles((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, targetType: val } : item))
                        );
                      }}
                      disabled={isImporting}
                    >
                      <option value="note">{t('topBar.notes')}</option>
                      <option value="board">{t('sidebar.boards')}</option>
                    </select>
                  </div>
                ))}
              </div>

              <div class="modal-actions-row" style={{ marginTop: '16px' }}>
                <button
                  class="btn btn-secondary"
                  onClick={() => setStagedFiles([])}
                  disabled={isImporting}
                >
                  {t('common.cancel')}
                </button>
                <button class="btn btn-primary" onClick={executeImport} disabled={isImporting}>
                  {isImporting ? t('importWizard.importing') : t('importWizard.importAction', { count: stagedFiles.length })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
