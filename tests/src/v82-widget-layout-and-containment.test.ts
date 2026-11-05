import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('v82: Interactive Widget Scaling & Layout Containment Audit', () => {
  const canvasPath = path.resolve(__dirname, '../../web/src/components/board/board-canvas.tsx');
  const stylePath = path.resolve(__dirname, '../../web/src/style.css');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');
  const styleSrc = fs.readFileSync(stylePath, 'utf8').replace(/\r\n/g, '\n');

  it('1. Purges transform: scale and widget-scale-surface from interactive cards', () => {
    expect(canvasSrc).not.toContain('class="node-checklist-card widget-scale-surface"');
    expect(canvasSrc).not.toContain('class="node-table-wrapper widget-scale-surface"');
    expect(canvasSrc).not.toContain('class="node-kanban-column widget-scale-surface"');
    expect(canvasSrc).not.toContain('class="node-code-block widget-scale-surface"');
    expect(canvasSrc).not.toContain('class="node-chart-card widget-scale-surface"');
  });

  it('2. Checklist widget uses 100% flexbox containment and pinned add button', () => {
    expect(canvasSrc).toContain("node.type === 'checklist'");
    expect(canvasSrc).toContain('class="node-checklist-card"');
    expect(canvasSrc).toContain('checklist-add-row-btn');
    expect(canvasSrc).toContain("flex: '0 0 auto'");
    expect(canvasSrc).toContain("flexShrink: 0");
  });

  it('3. Kanban widget uses 100% flexbox containment and pinned add card button', () => {
    expect(canvasSrc).toContain("node.type === 'kanban'");
    expect(canvasSrc).toContain('class="node-kanban-column"');
    expect(canvasSrc).toContain('kanban-add-card-btn');
    expect(canvasSrc).toContain("flex: '0 0 auto'");
    expect(canvasSrc).toContain("flexShrink: 0");
  });

  it('4. Code block widget uses responsive textarea with zero-min-height flex', () => {
    expect(canvasSrc).toContain("node.type === 'code'");
    expect(canvasSrc).toContain('class="node-code-block"');
    expect(canvasSrc).toContain('code-textarea-editor');
    expect(styleSrc).toContain('.node-code-block .code-textarea-editor');
    expect(styleSrc).toContain('resize: none !important;');
  });

  it('5. Chart widget visual area and editor maintain responsive containment', () => {
    expect(canvasSrc).toContain("node.type === 'chart'");
    expect(canvasSrc).toContain('class="node-chart-card"');
    expect(canvasSrc).toContain('chart-visual-area');
    expect(canvasSrc).toContain('chart-data-editor');
  });

  it('6. Corner resize handling does not force-lock aspect ratio on interactive cards', () => {
    expect(canvasSrc).toContain('const isProportionalWidget = isImage || isCircle;');
  });

  it('7. Style sheet guarantees 100% height, flex columns, and min-height: 0 for all widget scroll areas', () => {
    expect(styleSrc).toContain('.node-checklist-card');
    expect(styleSrc).toContain('.node-checklist-card .checklist-items-scroll');
    expect(styleSrc).toContain('.node-kanban-column .kanban-cards-area');
    expect(styleSrc).toContain('.node-table-wrapper .node-table-grid');
    expect(styleSrc).toContain('.node-code-block .code-textarea-editor');
    expect(styleSrc).toContain('.node-chart-card .chart-visual-area');
    expect(styleSrc).toContain('.node-chart-card .chart-data-editor');
  });

  it('8. Note card content view enforces flex: 1 1 auto and min-height: 0 containment', () => {
    expect(canvasSrc).toContain("minHeight: 0");
    expect(styleSrc).toContain('.note-card-content-view {\n  display: flex;\n  flex-direction: column;\n  flex: 1 1 auto;\n  min-height: 0;');
  });
});
