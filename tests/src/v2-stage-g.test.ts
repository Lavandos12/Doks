import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as Y from 'yjs';
import {
  generateAiContext,
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteDocName,
  getBoardDocName,
  getNoteText
} from '@doks/shared';
import { Agent } from '@doks/agent';

describe('Stage G: Deterministic AI Context Export (doks-ai/1)', () => {
  let tempDir: string;
  let agent: Agent;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-stage-g-'));
    agent = new Agent({
      baseDir: tempDir,
      memberName: 'Никита',
      webPort: 3700 + Math.floor(Math.random() * 500),
      peerPort: 5300 + Math.floor(Math.random() * 500)
    });
    await agent.start();
    baseUrl = `http://127.0.0.1:${agent.config.webPort}`;
  });

  afterEach(async () => {
    await agent.stop();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates deterministic doks-ai/1 format matching the TZ example structure', () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards, notes } = getIndexMaps(indexDoc);

    const boardId = 'board-roadmap';
    boards.set(boardId, {
      id: boardId,
      title: 'Дорожная карта Eluma',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes, edges } = getBoardMaps(boardDoc);

    // Frame "Фаза 1. Старт" at x=0, y=0, w=600, h=400
    const frameId = 'frame-phase-1';
    const frameMap = new Y.Map();
    frameMap.set('id', frameId);
    frameMap.set('type', 'frame');
    frameMap.set('x', 0);
    frameMap.set('y', 0);
    frameMap.set('w', 600);
    frameMap.set('h', 400);
    frameMap.set('text', 'Фаза 1. Старт');
    frameMap.set('color', '6');
    frameMap.set('author', 'Никита');
    frameMap.set('done', false);
    frameMap.set('deleted', false);
    nodes.set(frameId, frameMap);

    // Sticky 1: inside frame, done
    const sticky1Id = 'sticky-domain';
    const sticky1 = new Y.Map();
    sticky1.set('id', sticky1Id);
    sticky1.set('type', 'sticky');
    sticky1.set('x', 50);
    sticky1.set('y', 50);
    sticky1.set('w', 200);
    sticky1.set('h', 120);
    sticky1.set('text', 'Купить домен и VPS');
    sticky1.set('color', '2'); // зелёный
    sticky1.set('author', 'Никита');
    sticky1.set('done', true);
    sticky1.set('deleted', false);
    nodes.set(sticky1Id, sticky1);

    // Sticky 2: inside frame, todo
    const sticky2Id = 'sticky-parser';
    const sticky2 = new Y.Map();
    sticky2.set('id', sticky2Id);
    sticky2.set('type', 'sticky');
    sticky2.set('x', 300);
    sticky2.set('y', 50);
    sticky2.set('w', 200);
    sticky2.set('h', 120);
    sticky2.set('text', 'Парсер заявок');
    sticky2.set('color', '1'); // жёлтый
    sticky2.set('author', 'Николай');
    sticky2.set('done', false);
    sticky2.set('deleted', false);
    nodes.set(sticky2Id, sticky2);

    // Sticky 3: outside frames
    const sticky3Id = 'sticky-other';
    const sticky3 = new Y.Map();
    sticky3.set('id', sticky3Id);
    sticky3.set('type', 'sticky');
    sticky3.set('x', 800);
    sticky3.set('y', 100);
    sticky3.set('w', 200);
    sticky3.set('h', 120);
    sticky3.set('text', 'Общая заметка вне рамки');
    sticky3.set('color', '3'); // синий
    sticky3.set('author', 'Анна');
    sticky3.set('done', false);
    sticky3.set('deleted', false);
    nodes.set(sticky3Id, sticky3);

    // Edge from sticky1 to sticky2: "после"
    edges.set('edge-1', {
      id: 'edge-1',
      from: sticky1Id,
      to: sticky2Id,
      label: 'после',
      deleted: false
    });

    const result = generateAiContext(agent.docManager, {
      boardId,
      timestamp: '2026-10-24 21:40'
    });

    const md = result.markdown;
    expect(md).toContain('# Контекст доски: Дорожная карта Eluma');
    expect(md).toContain('Формат: doks-ai/1. Экспорт: 2026-10-24 21:40.');
    expect(md).toContain('Объектов: 4 (стикеров 3, рамок 1).');
    expect(md).toContain('Выполнено: 1 из 3 стикеров.');
    expect(md).toContain('## Рамка «Фаза 1. Старт»');
    expect(md).toContain('Купить домен и VPS');
    expect(md).toContain('Парсер заявок');
    expect(md).toContain('## Объекты вне рамок');
    expect(md).toContain('Общая заметка вне рамки');
    expect(md).toContain('## Связи');
    expect(md).toContain('→');
    expect(md).toContain('(«после»)');
    expect(md).toContain('## Пространственная карта');
    expect(md).toContain('## Открытые задачи');
    expect(md).toContain('Парсер заявок');
    expect(md).toContain('## Подсказка для ИИ');
    expect(result.openTasksCount).toBe(2);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('guarantees identical output on repeated runs (Golden test determinism)', () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-deterministic';
    boards.set(boardId, {
      id: boardId,
      title: 'Стабильная доска',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    for (let i = 1; i <= 5; i++) {
      const nodeMap = new Y.Map();
      nodeMap.set('id', `item-${i}`);
      nodeMap.set('type', 'sticky');
      nodeMap.set('x', i * 100);
      nodeMap.set('y', i * 50);
      nodeMap.set('w', 200);
      nodeMap.set('h', 120);
      nodeMap.set('text', `Стикер номер ${i}`);
      nodeMap.set('color', '1');
      nodeMap.set('author', 'Тестер');
      nodeMap.set('done', i % 2 === 0);
      nodeMap.set('deleted', false);
      nodes.set(`item-${i}`, nodeMap);
    }

    const run1 = generateAiContext(agent.docManager, { boardId, timestamp: '2026-10-24 12:00' });
    const run2 = generateAiContext(agent.docManager, { boardId, timestamp: '2026-10-24 12:00' });

    expect(run1.markdown).toBe(run2.markdown);
    expect(run1.charCount).toBe(run2.charCount);
    expect(run1.estimatedTokens).toBe(run2.estimatedTokens);
  });

  it('filters out private items and excludes sensitive data', () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards, notes } = getIndexMaps(indexDoc);

    const boardId = 'board-privacy';
    boards.set(boardId, {
      id: boardId,
      title: 'Доска с секретами',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    // Public sticky
    const publicSticky = new Y.Map();
    publicSticky.set('id', 'pub-1');
    publicSticky.set('type', 'sticky');
    publicSticky.set('text', 'Публичная задача для релиза');
    publicSticky.set('color', '2');
    publicSticky.set('author', 'Никита');
    publicSticky.set('deleted', false);
    nodes.set('pub-1', publicSticky);

    // Private sticky with #private
    const privSticky = new Y.Map();
    privSticky.set('id', 'priv-1');
    privSticky.set('type', 'sticky');
    privSticky.set('text', 'Секретный пароль от базы #private');
    privSticky.set('color', '4');
    privSticky.set('author', 'Никита');
    privSticky.set('deleted', false);
    nodes.set('priv-1', privSticky);

    // Note card with [[Private Note]]
    const noteId = 'sec-note';
    notes.set(noteId, {
      id: noteId,
      title: 'Секретные ключи',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });
    const noteDoc = agent.docManager.getOrCreateDoc(getNoteDocName(noteId));
    getNoteText(noteDoc).insert(0, 'Токены API #private секретно');

    const card = new Y.Map();
    card.set('id', 'card-1');
    card.set('type', 'note');
    card.set('noteId', noteId);
    card.set('text', 'Карточка заметки');
    card.set('color', '3');
    card.set('author', 'Никита');
    card.set('deleted', false);
    nodes.set('card-1', card);

    const result = generateAiContext(agent.docManager, { boardId, includeNotes: 'cards' });
    expect(result.markdown).toContain('Публичная задача для релиза');
    expect(result.markdown).not.toContain('Секретный пароль');
    expect(result.markdown).not.toContain('Токены API');
    expect(result.markdown).not.toContain(agent.config.teamKey);
  });

  it('anonymizes member names when requested', () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-anon';
    boards.set(boardId, {
      id: boardId,
      title: 'Анонимная доска',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const s1 = new Y.Map();
    s1.set('id', 's-1');
    s1.set('type', 'sticky');
    s1.set('text', 'Дизайн логотипа');
    s1.set('color', '1');
    s1.set('author', 'Иван');
    s1.set('deleted', false);
    nodes.set('s-1', s1);

    const result = generateAiContext(agent.docManager, {
      boardId,
      anonymizeMembers: true
    });

    expect(result.markdown).not.toContain('Иван');
    expect(result.markdown).toContain('Участник 1');
  });

  it('benchmarks 1000 objects under 2 seconds (Section 5.6)', () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-perf-1000';
    boards.set(boardId, {
      id: boardId,
      title: 'Большая доска 1000 объектов',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    // Create 1000 stickies
    for (let i = 0; i < 1000; i++) {
      const nodeMap = new Y.Map();
      nodeMap.set('id', `perf-${i}`);
      nodeMap.set('type', 'sticky');
      nodeMap.set('x', (i % 20) * 220);
      nodeMap.set('y', Math.floor(i / 20) * 160);
      nodeMap.set('w', 200);
      nodeMap.set('h', 140);
      nodeMap.set('text', `Задача #${i}: реализация модуля компонента`);
      nodeMap.set('color', String((i % 6) + 1));
      nodeMap.set('author', `User-${i % 4}`);
      nodeMap.set('done', i % 3 === 0);
      nodeMap.set('deleted', false);
      nodes.set(`perf-${i}`, nodeMap);
    }

    const start = performance.now();
    const result = generateAiContext(agent.docManager, { boardId });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000); // Must be faster than 2000ms
    expect(result.charCount).toBeGreaterThan(10000);
    expect(result.markdown).toContain('Объектов: 1000');
  });

  it('exposes POST /api/export/ai endpoint and returns stats', async () => {
    const indexDoc = agent.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'board-api-ai';
    boards.set(boardId, {
      id: boardId,
      title: 'Доска для ИИ API',
      folder: null,
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false
    });

    const boardDoc = agent.docManager.getOrCreateDoc(getBoardDocName(boardId));
    const { nodes } = getBoardMaps(boardDoc);

    const node = new Y.Map();
    node.set('id', 'api-stick');
    node.set('type', 'sticky');
    node.set('text', 'API Проверка экспорта');
    node.set('color', '1');
    node.set('author', 'Тестер');
    node.set('done', false);
    node.set('deleted', false);
    nodes.set('api-stick', node);

    const res = await fetch(`${baseUrl}/api/export/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.markdown).toBeDefined();
    expect(data.markdown).toContain('API Проверка экспорта');
    expect(data.charCount).toBeGreaterThan(0);
    expect(data.estimatedTokens).toBeGreaterThan(0);
    expect(data.openTasksCount).toBe(1);
  });
});
