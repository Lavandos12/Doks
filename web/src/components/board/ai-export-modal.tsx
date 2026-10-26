import { h, VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import type { AiExportResult } from '@doks/shared';
import { t } from '../../i18n/index.js';

interface AiExportModalProps {
  boardId: string;
  selectedNodeIds?: string[];
  onClose: () => void;
}

export function AiExportModal({ boardId, selectedNodeIds = [], onClose }: AiExportModalProps): VNode {
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [includeNotes, setIncludeNotes] = useState<'none' | 'cards' | 'linked'>('cards');
  const [anonymize, setAnonymize] = useState(false);
  const [compact, setCompact] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiExportResult | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchExport = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/export/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId,
          scope,
          selectedNodeIds: scope === 'selection' ? selectedNodeIds : undefined,
          includeNotes,
          anonymizeMembers: anonymize,
          compactNotes: compact
        })
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch (err) {
      console.error('Failed to export AI context:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExport();
  }, [scope, includeNotes, anonymize, compact]);

  const handleCopy = () => {
    if (!result?.markdown) return;
    navigator.clipboard.writeText(result.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result?.markdown) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `board-ai-context-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="doks-modal-backdrop ai-export-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div class="doks-modal-dialog ai-export-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="sparkles" size={20} class="text-accent" />
            <h3 class="modal-title">{t('ai.modal_title')}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ai.close')}
            data-testid="close-ai-modal"
            class="modal-close-btn"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div class="modal-body ai-export-body">
          <div class="ai-export-grid">
            <div class="ai-export-field">
              <label class="ai-export-label">Область</label>
              <select
                class="ai-export-select"
                value={scope}
                onChange={(e) => setScope((e.target as HTMLSelectElement).value as any)}
              >
                <option value="all">Вся доска</option>
                {selectedNodeIds.length > 0 && (
                  <option value="selection">Выделенные ({selectedNodeIds.length})</option>
                )}
              </select>
            </div>

            <div class="ai-export-field">
              <label class="ai-export-label">Связанные заметки</label>
              <select
                class="ai-export-select"
                value={includeNotes}
                onChange={(e) => setIncludeNotes((e.target as HTMLSelectElement).value as any)}
              >
                <option value="none">Не включать</option>
                <option value="cards">Только карточки на доске</option>
                <option value="linked">Плюс по [[ссылкам]]</option>
              </select>
            </div>
          </div>

          <div class="ai-export-options-row">
            <label class="ai-export-checkbox-label">
              <input
                type="checkbox"
                checked={anonymize}
                onChange={(e) => setAnonymize((e.target as HTMLInputElement).checked)}
              />
              <span>Анонимизировать участников</span>
            </label>

            <label class="ai-export-checkbox-label">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact((e.target as HTMLInputElement).checked)}
              />
              <span>Сжатый объём (обрезка длинных заметок)</span>
            </label>
          </div>

          {/* Stats & Tokens */}
          <div class="ai-export-stats-card">
            <div class="ai-export-stat-line">
              <span>Символов: {result?.charCount || 0}</span>
              <span class="ai-export-token-pill">
                Оценка токенов: ~{result?.estimatedTokens || 0}
              </span>
            </div>
            {result && result.estimatedTokens > 100000 && (
              <div class="ai-export-warning">
                <Icon name="alert-triangle" size={14} />
                <span>Внимание: объём превышает 100 000 токенов. Рекомендуется включить сжатие или сузить область.</span>
              </div>
            )}
          </div>

          {/* Preview snippet */}
          <div class="ai-export-preview-container">
            <label class="ai-export-label">Предпросмотр контекста для ИИ</label>
            <textarea
              readOnly
              rows={8}
              value={loading ? 'Генерация контекста...' : result?.markdown || ''}
              class="ai-export-textarea ai-export-preview"
            />
          </div>
        </div>

        {/* Footer */}
        <div class="modal-footer ai-export-footer">
          <div class="ai-export-hint">
            Готово для отправки в Claude, Gemini или ChatGPT
          </div>
          <div class="modal-buttons">
            <button
              onClick={handleCopy}
              disabled={loading || !result}
              class="btn-secondary"
            >
              <Icon name={copied ? 'check' : 'share'} size={14} />
              <span>{copied ? t('ai.copied') : t('ai.copy')}</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={loading || !result}
              class="btn-primary"
            >
              <Icon name="download" size={14} />
              <span>Скачать .md</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
