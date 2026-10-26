import * as Y from 'yjs';
import type {
  NoteMeta,
  BoardMeta,
  FolderMeta,
  AttachmentMeta,
  BoardNodeData,
  BoardEdgeData,
  WorkspaceScope
} from './types.js';

export const DOC_INDEX = 'doks-index';
export const DOC_NOTE_PREFIX = 'doks-note-';
export const DOC_BOARD_PREFIX = 'doks-board-';

export function getNoteDocName(id: string): string {
  return `${DOC_NOTE_PREFIX}${id}`;
}

export function getBoardDocName(id: string): string {
  return `${DOC_BOARD_PREFIX}${id}`;
}

export function isNoteDoc(name: string): boolean {
  const { entityName } = parseScopedDocName(name);
  return entityName.startsWith(DOC_NOTE_PREFIX) || entityName.startsWith('eluma-note-');
}

export function isBoardDoc(name: string): boolean {
  const { entityName } = parseScopedDocName(name);
  return entityName.startsWith(DOC_BOARD_PREFIX) || entityName.startsWith('eluma-board-');
}

export function getEntityIdFromDocName(name: string): string {
  const { entityName } = parseScopedDocName(name);
  if (entityName.startsWith(DOC_NOTE_PREFIX)) {
    return entityName.slice(DOC_NOTE_PREFIX.length);
  }
  if (entityName.startsWith('eluma-note-')) {
    return entityName.slice('eluma-note-'.length);
  }
  if (entityName.startsWith(DOC_BOARD_PREFIX)) {
    return entityName.slice(DOC_BOARD_PREFIX.length);
  }
  if (entityName.startsWith('eluma-board-')) {
    return entityName.slice('eluma-board-'.length);
  }
  return entityName;
}

export function parseScopedDocName(docName: string): { scope: WorkspaceScope; entityName: string } {
  if (docName.startsWith('solo:')) {
    return { scope: 'solo', entityName: docName.slice(5) };
  }
  if (docName.startsWith('team:')) {
    return { scope: 'team', entityName: docName.slice(5) };
  }
  return { scope: 'team', entityName: docName };
}

export function getScopedDocName(scope: WorkspaceScope, name: string): string {
  const parsed = parseScopedDocName(name);
  return `${scope}:${parsed.entityName}`;
}

export function isSoloDoc(docName: string): boolean {
  return docName.startsWith('solo:');
}

export function isTeamDoc(docName: string): boolean {
  return !isSoloDoc(docName);
}

export function getScopedIndexDocName(scope: WorkspaceScope): string {
  return `${scope}:${DOC_INDEX}`;
}

export function getScopedNoteDocName(scope: WorkspaceScope, id: string): string {
  return `${scope}:${DOC_NOTE_PREFIX}${id}`;
}

export function getScopedBoardDocName(scope: WorkspaceScope, id: string): string {
  return `${scope}:${DOC_BOARD_PREFIX}${id}`;
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
    locked: map.get('locked') || false,
    fontSize: map.get('fontSize') || undefined,
    hasCheckbox: map.get('hasCheckbox') || undefined,
    shapeVariant: map.get('shapeVariant') || undefined,
    svgPath: map.get('svgPath') || undefined,
    strokeWidth: map.get('strokeWidth') || undefined,
    opacity: map.get('opacity') || undefined,
    extractedText: map.get('extractedText') || undefined,
    showPreview: map.get('showPreview') || undefined,
    deleted: map.get('deleted') || false,
    deletedAt: map.get('deletedAt') || undefined,
    scope: map.get('scope') || undefined,
    originId: map.get('originId') || undefined,
    promotedAt: map.get('promotedAt') || undefined,
    promotedBy: map.get('promotedBy') || undefined
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
 * Applies a granular diff (longest common prefix & suffix) to a Y.Text
 * wrapped in an atomic transaction to prevent wiping the entire text and causing
 * duplication or character loss during concurrent edits.
 */
export function applyStringDiffToYText(yText: Y.Text, newStr: string): void {
  const oldStr = yText.toString();
  if (oldStr === newStr) return;

  let start = 0;
  const oldLen = oldStr.length;
  const newLen = newStr.length;

  // Longest common prefix
  while (start < oldLen && start < newLen && oldStr[start] === newStr[start]) {
    start++;
  }

  // Longest common suffix
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const deleteCount = oldEnd - start;
  const insertText = newStr.slice(start, newEnd);

  const performDiff = () => {
    if (deleteCount > 0) {
      yText.delete(start, deleteCount);
    }
    if (insertText.length > 0) {
      yText.insert(start, insertText);
    }
  };

  if (yText.doc) {
    yText.doc.transact(performDiff, 'apply-diff');
  } else {
    performDiff();
  }
}

export const applyTextDelta = applyStringDiffToYText;

/**
 * Creates a new Y.Map populated with BoardNodeData.
 */
export function createNodeMap(data: Partial<BoardNodeData>): Y.Map<any> {
  const nodeMap = new Y.Map<any>();
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      if (key === 'text') {
        nodeMap.set('text', new Y.Text(String(val ?? '')));
      } else {
        nodeMap.set(key, val);
      }
    }
  }
  return nodeMap;
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
      applyStringDiffToYText(yText, strVal);
    } else {
      nodeMap.set(key, val);
    }
  }
}
