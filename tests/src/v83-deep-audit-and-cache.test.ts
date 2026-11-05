import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('v83: Deep Widget Audit, Flex Containment Armor & Anti-Stale HTTP Cache Headers', () => {
  const serverPath = path.resolve(__dirname, '../../agent/src/server/http-server.ts');
  const indexPath = path.resolve(__dirname, '../../web/index.html');
  const canvasPath = path.resolve(__dirname, '../../web/src/components/board/board-canvas.tsx');
  const stylePath = path.resolve(__dirname, '../../web/src/style.css');

  const serverSrc = fs.readFileSync(serverPath, 'utf8').replace(/\r\n/g, '\n');
  const indexSrc = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');
  const styleSrc = fs.readFileSync(stylePath, 'utf8').replace(/\r\n/g, '\n');

  it('1. Fastify HTTP server sets anti-caching headers for index.html and SPA routes', () => {
    // static handler
    expect(serverSrc).toContain("res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')");
    expect(serverSrc).toContain("res.setHeader('Pragma', 'no-cache')");
    expect(serverSrc).toContain("res.setHeader('Expires', '0')");
    // SPA share routes
    expect(serverSrc).toContain("reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')");
    // Vite content-hashed assets
    expect(serverSrc).toContain("res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')");
  });

  it('2. web/index.html contains anti-caching meta tags and English language root', () => {
    expect(indexSrc).toContain('<html lang="en">');
    expect(indexSrc).toContain('<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />');
    expect(indexSrc).toContain('<meta http-equiv="Pragma" content="no-cache" />');
    expect(indexSrc).toContain('<meta http-equiv="Expires" content="0" />');
  });

  it('3. Canvas implements getWidgetMinBounds to enforce minimum widget dimensions during resize', () => {
    expect(canvasSrc).toContain('const getWidgetMinBounds = (nodeType?: string)');
    expect(canvasSrc).toContain("case 'checklist':");
    expect(canvasSrc).toContain('return { minW: 220, minH: 150 };');
    expect(canvasSrc).toContain("case 'kanban':");
    expect(canvasSrc).toContain('return { minW: 240, minH: 180 };');
    expect(canvasSrc).toContain("case 'table':");
    expect(canvasSrc).toContain('return { minW: 240, minH: 130 };');
    expect(canvasSrc).toContain("case 'chart':");
    expect(canvasSrc).toContain('return { minW: 260, minH: 200 };');
    expect(canvasSrc).toContain("case 'code':");
    expect(canvasSrc).toContain('return { minW: 220, minH: 130 };');
  });

  it('4. Resize gesture applies minimum widget bounds across both proportional and freeform branches', () => {
    expect(canvasSrc).toContain('const { minW, minH } = getWidgetMinBounds(nodeType);');
    expect(canvasSrc).toContain('newW = Math.max(minW, startW + dx);');
    expect(canvasSrc).toContain('newH = Math.max(minH, startH + dy);');
  });

  it('5. Dynamic auto-expansion expands node dimensions on item/card/row additions', () => {
    // Checklist
    expect(canvasSrc).toContain('const minRequiredH = 120 + items.length * 36;');
    expect(canvasSrc).toContain('if (currentH < minRequiredH) {');
    // Kanban
    expect(canvasSrc).toContain('const minRequiredH = 110 + cards.length * 44;');
    // Table row
    expect(canvasSrc).toContain('const minRequiredH = 90 + table.length * 34;');
    // Table column
    expect(canvasSrc).toContain('const minRequiredW = Math.max(240, numCols * 85);');
  });

  it('6. Inline JSX styles enforce flex: 1 1 0, minHeight: 0, and maxHeight: 100% on widget cards', () => {
    expect(canvasSrc).toContain("class=\"node-checklist-card\"\n                      style={{\n                        width: '100%',\n                        height: '100%',\n                        flex: '1 1 0',\n                        minHeight: 0,\n                        maxHeight: '100%'");
    expect(canvasSrc).toContain("class=\"node-kanban-column\"\n                      style={{\n                        width: '100%',\n                        height: '100%',\n                        flex: '1 1 0',\n                        minHeight: 0,\n                        maxHeight: '100%'");
    expect(canvasSrc).toContain("class=\"node-table-wrapper\"\n                      style={{\n                        width: '100%',\n                        height: '100%',\n                        flex: '1 1 0',\n                        minHeight: 0,\n                        maxHeight: '100%'");
    expect(canvasSrc).toContain("class=\"node-code-block\"\n                      style={{\n                        width: '100%',\n                        height: '100%',\n                        flex: '1 1 0',\n                        minHeight: 0,\n                        maxHeight: '100%'");
    expect(canvasSrc).toContain("class=\"node-chart-card\"\n                      style={{\n                        width: '100%',\n                        height: '100%',\n                        flex: '1 1 0',\n                        minHeight: 0,\n                        maxHeight: '100%'");
  });

  it('7. Style sheet enforces strict flexbox containment armor and overflow clipping', () => {
    expect(styleSrc).toContain('.node-checklist-card {\n  width: 100% !important;\n  height: 100% !important;\n  flex: 1 1 0 !important;\n  min-height: 0 !important;\n  max-height: 100% !important;');
    expect(styleSrc).toContain('.node-kanban-column {\n  width: 100% !important;\n  height: 100% !important;\n  flex: 1 1 0 !important;\n  min-height: 0 !important;\n  max-height: 100% !important;');
    expect(styleSrc).toContain('.node-table-wrapper {\n  width: 100% !important;\n  height: 100% !important;\n  flex: 1 1 0 !important;\n  min-height: 0 !important;\n  max-height: 100% !important;');
    expect(styleSrc).toContain('.node-code-block {\n  width: 100% !important;\n  height: 100% !important;\n  flex: 1 1 0 !important;\n  min-height: 0 !important;\n  max-height: 100% !important;');
    expect(styleSrc).toContain('.node-chart-card {\n  width: 100% !important;\n  height: 100% !important;\n  flex: 1 1 0 !important;\n  min-height: 0 !important;\n  max-height: 100% !important;');
  });

  it('8. Obsolete widget-scale-surface is completely purged from style sheet', () => {
    expect(styleSrc).not.toContain('.widget-scale-surface');
  });
});
