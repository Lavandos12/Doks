import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../ui/icons.js';
import {
  generateDiagramFromText,
  DIAGRAM_PRESETS,
  type GeneratedDiagramNode,
  type GeneratedDiagramEdge
} from '../../utils/diagramGenerator.js';

interface AutoDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (data: { nodes: GeneratedDiagramNode[]; edges: GeneratedDiagramEdge[] }) => void;
  defaultOriginX?: number;
  defaultOriginY?: number;
}

export function AutoDiagramModal({
  isOpen,
  onClose,
  onGenerate,
  defaultOriginX = 200,
  defaultOriginY = 200
}: AutoDiagramModalProps) {
  if (!isOpen) return null;

  const [selectedPreset, setSelectedPreset] = useState<string>('mindmap_product');
  const [inputText, setInputText] = useState<string>(DIAGRAM_PRESETS.mindmap_product.content);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    if (DIAGRAM_PRESETS[presetKey]) {
      setInputText(DIAGRAM_PRESETS[presetKey].content);
    }
  };

  const handleGenerate = () => {
    if (!inputText.trim()) return;
    setIsSubmitting(true);
    try {
      const result = generateDiagramFromText(inputText, defaultOriginX, defaultOriginY);
      onGenerate(result);
      onClose();
    } catch (err) {
      console.error('[AutoDiagramModal] Failed to generate diagram:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="modal-overlay doks-modal-backdrop auto-diagram-modal-overlay" onClick={onClose} role="dialog">
      <div class="modal-card doks-modal-dialog auto-diagram-modal liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="modal-header">
          <div class="modal-title-group">
            <Icon name="sparkles" size={20} class="text-accent" />
            <h3 class="modal-title">Генератор автодиаграмм и Mindmap</h3>
          </div>
          <button onClick={onClose} aria-label="Закрыть" class="modal-close-btn">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div class="modal-body auto-diagram-body">
          <div class="diagram-field-group">
            <label class="diagram-label">Готовые шаблоны (Presets)</label>
            <select
              class="diagram-select"
              value={selectedPreset}
              onChange={(e) => handlePresetChange((e.target as HTMLSelectElement).value)}
            >
              <option value="mindmap_product">{DIAGRAM_PRESETS.mindmap_product.title}</option>
              <option value="flowchart_auth">{DIAGRAM_PRESETS.flowchart_auth.title}</option>
              <option value="kanban_board">{DIAGRAM_PRESETS.kanban_board.title}</option>
              <option value="swot_analysis">{DIAGRAM_PRESETS.swot_analysis.title}</option>
              <option value="roadmap">{DIAGRAM_PRESETS.roadmap.title}</option>
            </select>
          </div>

          <div class="diagram-field-group" style={{ marginTop: '14px' }}>
            <div class="diagram-label-group">
              <label class="diagram-label">Схема или структура текста</label>
              <span class="diagram-hint">Стрелки (A -&gt; B -&gt; C) или список с отступами</span>
            </div>
            <textarea
              class="diagram-textarea"
              rows={9}
              value={inputText}
              onInput={(e) => setInputText((e.target as HTMLTextAreaElement).value)}
              placeholder="Введите шаги через -&gt; или структуру списка..."
            />
          </div>
        </div>

        {/* Footer */}
        <div class="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={handleGenerate}
            disabled={!inputText.trim() || isSubmitting}
          >
            <Icon name="arrow" size={14} />
            <span>{isSubmitting ? 'Генерация...' : 'Сгенерировать на доске'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
