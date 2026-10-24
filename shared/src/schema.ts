import * as Y from 'yjs';
import type { NoteMeta, BoardMeta, FolderMeta, AttachmentMeta, BoardNodeData, BoardEdgeData } from './types.js';

export const DOC_INDEX = 'eluma-index';
export const DOC_NOTE_PREFIX = 'eluma-note-';
export const DOC_BOARD_PREFIX = 'eluma-board-';

export function getNoteDocName(id: string): string {
  return `${DOC_NOTE_PREFIX}${id}`;
}

export function getBoardDocName(id: string): string {
  return `${DOC_BOARD_PREFIX}${id}`;
}

export function isNoteDoc(name: string): boolean {
  return name.startsWith(DOC_NOTE_PREFIX);
}

export function isBoardDoc(name: string): boolean {
  return name.startsWith(DOC_BOARD_PREFIX);
}

export function getEntityIdFromDocName(name: string): string {
  if (name.startsWith(DOC_NOTE_PREFIX)) {
    return name.slice(DOC_NOTE_PREFIX.length);
  }
  if (name.startsWith(DOC_BOARD_PREFIX)) {
    return name.slice(DOC_BOARD_PREFIX.length);
  }
  return name;
}

export interface IndexDocStructure {
  notes: Y.Map<NoteMeta>;
  boards: Y.Map<BoardMeta>;
  folders: Y.Map<FolderMeta>;
  attachments: Y.Map<AttachmentMeta>;
}

export function getIndexMaps(doc: Y.Doc): IndexDocStructure {
  return {
    notes: doc.getMap<NoteMeta>('notes'),
    boards: doc.getMap<BoardMeta>('boards'),
    folders: doc.getMap<FolderMeta>('folders'),
    attachments: doc.getMap<AttachmentMeta>('attachments')
  };
}

export function getNoteText(doc: Y.Doc): Y.Text {
  return doc.getText('text');
}

export interface BoardDocStructure {
  nodes: Y.Map<Y.Map<any>>;
  edges: Y.Map<BoardEdgeData>;
}

export function getBoardMaps(doc: Y.Doc): BoardDocStructure {
  return {
    nodes: doc.getMap<Y.Map<any>>('nodes'),
    edges: doc.getMap<BoardEdgeData>('edges')
  };
}

/**
 * Converts a child Y.Map node to a standard BoardNodeData object.
 */
export function nodeMapToData(id: string, map: Y.Map<any>): BoardNodeData {
  const textVal = map.get('text');
  const textStr = typeof textVal === 'string' ? textVal : (textVal instanceof Y.Text ? textVal.toString() : '');
  return {
    id,
    type: map.get('type') || 'sticky',
    x: map.get('x') ?? 0,
    y: map.get('y') ?? 0,
    w: map.get('w') ?? 200,
    h: map.get('h') ?? 120,
    text: textStr,
    color: map.get('color') || '1',
    author: map.get('author') || '',
    done: map.get('done') || false,
    noteId: map.get('noteId') || undefined,
    fileHash: map.get('fileHash') || undefined,
    fileName: map.get('fileName') || undefined,
    url: map.get('url') || undefined,
    z: map.get('z') ?? 1,
    deleted: map.get('deleted') || false,
    deletedAt: map.get('deletedAt') || undefined
  };
}

/**
 * Gets or migrates the Y.Text instance for a node's text property.
 */
export function getNodeYText(nodeMap: Y.Map<any>): Y.Text {
  let yText = nodeMap.get('text');
  if (!(yText instanceof Y.Text)) {
    const initial = typeof yText === 'string' ? yText : '';
    yText = new Y.Text(initial);
    nodeMap.set('text', yText);
  }
  return yText as Y.Text;
}

/**
 * Sets properties on a node's Y.Map, ensuring each property is an individual key
 * so concurrent edits to different properties don't conflict.
 */
export function setNodeProperties(nodeMap: Y.Map<any>, data: Partial<BoardNodeData>): void {
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) {
      nodeMap.delete(key);
    } else if (key === 'text') {
      const yText = getNodeYText(nodeMap);
      const strVal = String(val ?? '');
      if (yText.toString() !== strVal) {
        yText.delete(0, yText.length);
        yText.insert(0, strVal);
      }
    } else {
      nodeMap.set(key, val);
    }
  }
}
