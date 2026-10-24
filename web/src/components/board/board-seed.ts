import * as Y from 'yjs';
import { getBoardMaps, setNodeProperties } from '@doks/shared';

/**
 * Seeds a board with the initial Eluma collaboration plan if the board is empty.
 */
export function seedDefaultBoard(boardDoc: Y.Doc, authorName = 'Eluma'): void {
  const { nodes, edges } = getBoardMaps(boardDoc);
  if (nodes.size > 0) return;

  boardDoc.transact(() => {
    // Frame 1
    const frame1Id = 'frame-phase-1';
    const f1 = new Y.Map();
    nodes.set(frame1Id, f1);
    setNodeProperties(f1, {
      id: frame1Id,
      type: 'frame',
      x: 60,
      y: 60,
      w: 420,
      h: 360,
      text: 'Фаза 1: Каркас и Заметки',
      color: '4', // green
      author: authorName,
      z: 0
    });

    // Sticky 1.1
    const s1Id = 'sticky-1-1';
    const s1 = new Y.Map();
    nodes.set(s1Id, s1);
    setNodeProperties(s1, {
      id: s1Id,
      type: 'sticky',
      x: 90,
      y: 120,
      w: 160,
      h: 100,
      text: 'Настроить Yjs и WebSocket сервер',
      color: '4',
      author: 'Алиса',
      done: true,
      z: 1
    });

    // Sticky 1.2
    const s2Id = 'sticky-1-2';
    const s2 = new Y.Map();
    nodes.set(s2Id, s2);
    setNodeProperties(s2, {
      id: s2Id,
      type: 'sticky',
      x: 280,
      y: 120,
      w: 160,
      h: 100,
      text: 'Markdown-редактор и [[ссылки]]',
      color: '4',
      author: 'Боб',
      done: true,
      z: 1
    });

    // Frame 2
    const frame2Id = 'frame-phase-2';
    const f2 = new Y.Map();
    nodes.set(frame2Id, f2);
    setNodeProperties(f2, {
      id: frame2Id,
      type: 'frame',
      x: 540,
      y: 60,
      w: 420,
      h: 360,
      text: 'Фаза 2: Доска и Присутствие',
      color: '5', // cyan
      author: authorName,
      z: 0
    });

    // Sticky 2.1
    const s3Id = 'sticky-2-1';
    const s3 = new Y.Map();
    nodes.set(s3Id, s3);
    setNodeProperties(s3, {
      id: s3Id,
      type: 'sticky',
      x: 570,
      y: 120,
      w: 160,
      h: 100,
      text: 'Бесконечный холст и стикеры Miro',
      color: '5',
      author: 'Чарли',
      done: false,
      z: 1
    });

    // Sticky 2.2
    const s4Id = 'sticky-2-2';
    const s4 = new Y.Map();
    nodes.set(s4Id, s4);
    setNodeProperties(s4, {
      id: s4Id,
      type: 'sticky',
      x: 760,
      y: 120,
      w: 160,
      h: 100,
      text: 'Курсоры в реальном времени',
      color: '5',
      author: 'Дейв',
      done: false,
      z: 1
    });

    // Frame 3
    const frame3Id = 'frame-phase-3';
    const f3 = new Y.Map();
    nodes.set(frame3Id, f3);
    setNodeProperties(f3, {
      id: frame3Id,
      type: 'frame',
      x: 1020,
      y: 60,
      w: 420,
      h: 360,
      text: 'Фаза 3: Диск и Сеть',
      color: '6', // purple
      author: authorName,
      z: 0
    });

    // Sticky 3.1
    const s5Id = 'sticky-3-1';
    const s5 = new Y.Map();
    nodes.set(s5Id, s5);
    setNodeProperties(s5, {
      id: s5Id,
      type: 'sticky',
      x: 1050,
      y: 120,
      w: 160,
      h: 100,
      text: 'Зеркало .md и .canvas для Obsidian',
      color: '6',
      author: 'Алиса',
      done: false,
      z: 1
    });

    // Edges connecting phases
    edges.set('edge-1-2', {
      id: 'edge-1-2',
      from: s2Id,
      to: s3Id,
      label: 'готовность',
      color: '5',
      deleted: false
    });

    edges.set('edge-2-3', {
      id: 'edge-2-3',
      from: s4Id,
      to: s5Id,
      label: 'интеграция',
      color: '6',
      deleted: false
    });
  });
}
