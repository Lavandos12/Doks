import type { BoardNodeData, BoardEdgeData } from './types.js';

export interface JSONCanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  doks_custom?: {
    doksType?: string;
    author?: string;
    done?: boolean;
    noteId?: string;
    z?: number;
  };
}

export interface JSONCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
}

export interface JSONCanvasData {
  nodes: JSONCanvasNode[];
  edges: JSONCanvasEdge[];
}

/**
 * Converts internal board nodes and edges into Obsidian JSON Canvas format.
 */
export function boardToJSONCanvas(
  nodes: BoardNodeData[],
  edges: BoardEdgeData[],
  noteIdToFilePath?: (noteId: string) => string | undefined
): JSONCanvasData {
  const canvasNodes: JSONCanvasNode[] = [];

  for (const n of nodes) {
    if (n.deleted) continue;

    let canvasType: 'text' | 'file' | 'group' = 'text';
    let fileVal: string | undefined;
    let labelVal: string | undefined;

    if (n.type === 'frame') {
      canvasType = 'group';
      labelVal = n.text;
    } else if (n.type === 'note' && n.noteId) {
      canvasType = 'file';
      const resolvedPath = noteIdToFilePath ? noteIdToFilePath(n.noteId) : undefined;
      fileVal = resolvedPath || `${n.text || n.noteId}.md`;
    } else {
      canvasType = 'text';
    }

    const node: JSONCanvasNode = {
      id: n.id,
      type: canvasType,
      x: n.x,
      y: n.y,
      width: n.w,
      height: n.h,
      color: n.color,
      doks_custom: {
        doksType: n.type,
        author: n.author,
        done: n.done,
        noteId: n.noteId,
        z: n.z
      }
    };

    if (canvasType === 'text') {
      node.text = n.text;
    } else if (canvasType === 'file') {
      node.file = fileVal;
    } else if (canvasType === 'group') {
      node.label = labelVal;
    }

    canvasNodes.push(node);
  }

  const canvasEdges: JSONCanvasEdge[] = [];
  for (const e of edges) {
    if (e.deleted) continue;
    canvasEdges.push({
      id: e.id,
      fromNode: e.from,
      toNode: e.to,
      fromSide: e.fromSide,
      toSide: e.toSide,
      label: e.label,
      color: e.color
    });
  }

  return {
    nodes: canvasNodes,
    edges: canvasEdges
  };
}

/**
 * Converts Obsidian JSON Canvas format into internal board nodes and edges.
 */
export function jsonCanvasToBoard(data: JSONCanvasData): {
  nodes: BoardNodeData[];
  edges: BoardEdgeData[];
} {
  const nodes: BoardNodeData[] = [];
  for (const n of data.nodes || []) {
    const custom = n.doks_custom || {};
    let type = custom.doksType as any;
    if (!type) {
      if (n.type === 'group') type = 'frame';
      else if (n.type === 'file') type = 'note';
      else type = 'sticky';
    }

    nodes.push({
      id: n.id,
      type,
      x: n.x,
      y: n.y,
      w: n.width,
      h: n.height,
      text: n.text || n.label || '',
      color: n.color || '1',
      author: custom.author || '',
      done: custom.done || false,
      noteId: custom.noteId,
      z: custom.z ?? 1,
      deleted: false
    });
  }

  const edges: BoardEdgeData[] = [];
  for (const e of data.edges || []) {
    edges.push({
      id: e.id,
      from: e.fromNode,
      to: e.toNode,
      fromSide: e.fromSide as any,
      toSide: e.toSide as any,
      label: e.label,
      color: e.color,
      deleted: false
    });
  }

  return { nodes, edges };
}
