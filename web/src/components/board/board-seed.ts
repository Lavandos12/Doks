import * as Y from 'yjs';
import { getBoardMaps, setNodeProperties } from '@doks/shared';

/**
 * Seeds a board with a neutral collaboration plan template if empty.
 */
export function seedDefaultBoard(boardDoc: Y.Doc, authorName = 'Alice'): void {
  seedRoadmap(boardDoc, authorName);
}

export function seedRoadmap(boardDoc: Y.Doc, authorName = 'Alice'): void {
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
      text: 'Phase 1: Architecture & Notes',
      color: '4',
      author: authorName,
      z: 0
    });

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
      text: 'Setup Yjs and P2P transport',
      color: '4',
      author: 'Alice',
      done: true,
      z: 1
    });

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
      text: 'Markdown editor and [[wikilinks]]',
      color: '4',
      author: 'Bob',
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
      text: 'Phase 2: Infinite Canvas',
      color: '5',
      author: authorName,
      z: 0
    });

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
      text: 'Canvas stickies & magnetic links',
      color: '5',
      author: 'Charlie',
      done: false,
      z: 1
    });

    // Connection
    edges.set('edge-1-2', {
      id: 'edge-1-2',
      from: s2Id,
      to: s3Id,
      label: 'depends on',
      color: '5',
      deleted: false
    });
  });
}

export function seedKanban(boardDoc: Y.Doc, authorName = 'Alice'): void {
  const { nodes } = getBoardMaps(boardDoc);
  if (nodes.size > 0) return;

  boardDoc.transact(() => {
    const columns = [
      { id: 'frame-todo', title: 'To Do', x: 60, color: '1' },
      { id: 'frame-progress', title: 'In Progress', x: 420, color: '3' },
      { id: 'frame-done', title: 'Done', x: 780, color: '4' }
    ];

    columns.forEach((col) => {
      const f = new Y.Map();
      nodes.set(col.id, f);
      setNodeProperties(f, {
        id: col.id,
        type: 'frame',
        x: col.x,
        y: 60,
        w: 320,
        h: 500,
        text: col.title,
        color: col.color,
        author: authorName,
        z: 0
      });
    });
  });
}

export function seedRetro(boardDoc: Y.Doc, authorName = 'Alice'): void {
  const { nodes } = getBoardMaps(boardDoc);
  if (nodes.size > 0) return;

  boardDoc.transact(() => {
    const columns = [
      { id: 'retro-good', title: 'Went Well', x: 60, color: '4' },
      { id: 'retro-improve', title: 'To Improve', x: 420, color: '1' },
      { id: 'retro-actions', title: 'Action Items', x: 780, color: '5' }
    ];

    columns.forEach((col) => {
      const f = new Y.Map();
      nodes.set(col.id, f);
      setNodeProperties(f, {
        id: col.id,
        type: 'frame',
        x: col.x,
        y: 60,
        w: 320,
        h: 500,
        text: col.title,
        color: col.color,
        author: authorName,
        z: 0
      });
    });
  });
}
