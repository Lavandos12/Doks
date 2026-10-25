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
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 ai-export-modal">
      <div class="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2">
            <Icon name="sparkles" size={20} class="text-[var(--accent)]" />
            <h2 class="text-base font-semibold text-[var(--text-primary)]">{t('ai.modal_title')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ai.close')}
            data-testid="close-ai-modal"
            class="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-md"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-[var(--text-secondary)] mb-1">Область</label>
              <select
                class="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                value={scope}
                onChange={(e) => setScope((e.target as HTMLSelectElement).value as any)}
              >
                <option value="all">Вся доска</option>
                {selectedNodeIds.length > 0 && (
                  <option value="selection">Выделенные ({selectedNodeIds.length})</option>
                )}
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-[var(--text-secondary)] mb-1">Связанные заметки</label>
              <select
                class="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                value={includeNotes}
                onChange={(e) => setIncludeNotes((e.target as HTMLSelectElement).value as any)}
              >
                <option value="none">Не включать</option>
                <option value="cards">Только карточки на доске</option>
                <option value="linked">Плюс по [[ссылкам]]</option>
              </select>
            </div>
          </div>

          <div class="flex items-center gap-6 pt-2">
            <label class="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={anonymize}
                onChange={(e) => setAnonymize((e.target as HTMLInputElement).checked)}
                class="rounded border-[var(--border-subtle)]"
              />
              Анонимизировать участников
            </label>

            <label class="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact((e.target as HTMLInputElement).checked)}
                class="rounded border-[var(--border-subtle)]"
              />
              Сжатый объём (обрезка длинных заметок)
            </label>
          </div>

          {/* Stats & Tokens */}
          <div class="bg-[var(--bg-secondary)] rounded-lg p-3 text-xs space-y-1 text-[var(--text-secondary)]">
            <div class="flex justify-between">
              <span>Символов: {result?.charCount || 0}</span>
              <span class="font-medium text-[var(--text-primary)]">
                Оценка токенов: ~{result?.estimatedTokens || 0}
              </span>
            </div>
            {result && result.estimatedTokens > 100000 && (
              <div class="text-amber-500 font-medium">
                ⚠️ Внимание: объём превышает 100 000 токенов. Рекомендуется включить сжатие или сузить область.
              </div>
            )}
          </div>

          {/* Preview snippet */}
          <div>
            <label class="block text-xs font-medium text-[var(--text-secondary)] mb-1">Предпросмотр</label>
            <textarea
              readOnly
              rows={8}
              value={loading ? 'Генерация контекста...' : result?.markdown || ''}
              class="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-3 text-xs font-mono text-[var(--text-primary)] focus:outline-none resize-none ai-export-preview"
            />
          </div>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div class="text-xs text-[var(--text-secondary)]">
            Готово для отправки в Claude, Gemini или ChatGPT
          </div>
          <div class="flex gap-2">
            <button
              onClick={handleCopy}
              disabled={loading || !result}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
            >
              <Icon name={copied ? 'check' : 'share'} size={14} />
              {copied ? t('ai.copied') : t('ai.copy')}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading || !result}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 shadow-sm"
            >
              <Icon name="download" size={14} />
              Скачать .md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
