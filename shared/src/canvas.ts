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
  shapeVariant?: 'rectangle' | 'rounded' | 'diamond' | 'pill' | 'circle' | 'triangle' | 'parallelogram' | 'cylinder' | 'hexagon' | string;
  shapeType?: 'rectangle' | 'rounded' | 'diamond' | 'pill' | 'circle' | 'triangle' | 'parallelogram' | 'cylinder' | 'hexagon' | string;
  locked?: boolean;
  fontSize?: number;
  hasCheckbox?: boolean;
  noteId?: string;
  attachmentId?: string;
  fileHash?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  doks_custom?: {
    doksType?: string;
    author?: string;
    done?: boolean;
    noteId?: string;
    fileHash?: string;
    fileName?: string;
    url?: string;
    z?: number;
    locked?: boolean;
    fontSize?: number;
    hasCheckbox?: boolean;
    shapeVariant?: 'rectangle' | 'rounded' | 'diamond' | 'pill' | 'circle' | 'triangle' | 'parallelogram' | 'cylinder' | 'hexagon' | string;
    deleted?: boolean;
    deletedAt?: number;
    scope?: string;
    originId?: string;
    promotedAt?: number;
    promotedBy?: string;
    svgPath?: string;
    points?: Array<{ x: number; y: number }>;
    strokeWidth?: number;
    drawMode?: 'pen' | 'brush' | 'highlighter';
    opacity?: number;
    chartType?: 'pie' | 'donut' | 'square' | 'bar' | 'line' | 'funnel';
    chartData?: Array<{ id: string; label: string; value: number; color: string }>;
    description?: string;
    codeLanguage?: string;
    extractedText?: string;
    showPreview?: boolean;
    imageUrl?: string;
    fileDataUrl?: string;
    uploaderOrigin?: string;
    reactions?: { thumbsUp?: number };
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
  curveType?: 'bezier' | 'orthogonal' | 'straight';
  style?: 'solid' | 'dashed' | 'dotted' | 'animated';
  thickness?: number;
  direction?: 'forward' | 'both' | 'none';
  doks_custom?: {
    curveType?: 'bezier' | 'orthogonal' | 'straight';
    style?: 'solid' | 'dashed' | 'dotted' | 'animated';
    thickness?: number;
    direction?: 'forward' | 'both' | 'none';
    label?: string;
    color?: string;
    deleted?: boolean;
    deletedAt?: number;
    scope?: string;
  };
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
      shapeVariant: n.shapeVariant,
      shapeType: n.shapeVariant,
      locked: n.locked,
      fontSize: n.fontSize,
      hasCheckbox: n.hasCheckbox,
      noteId: n.noteId,
      fileHash: n.fileHash,
      fileName: n.fileName,
      originalName: n.fileName,
      attachmentId: n.fileHash,
      doks_custom: {
        doksType: n.type,
        author: n.author,
        done: n.done,
        noteId: n.noteId,
        fileHash: n.fileHash,
        fileName: n.fileName,
        url: n.url,
        z: n.z,
        locked: n.locked,
        fontSize: n.fontSize,
        hasCheckbox: n.hasCheckbox,
        shapeVariant: n.shapeVariant,
        deleted: n.deleted,
        deletedAt: n.deletedAt,
        scope: n.scope,
        originId: n.originId,
        promotedAt: n.promotedAt,
        promotedBy: n.promotedBy,
        svgPath: n.svgPath,
        points: n.points,
        strokeWidth: n.strokeWidth,
        drawMode: n.drawMode,
        opacity: n.opacity,
        chartType: n.chartType,
        chartData: n.chartData,
        description: n.description,
        codeLanguage: n.codeLanguage,
        extractedText: n.extractedText,
        showPreview: n.showPreview,
        imageUrl: n.imageUrl,
        fileDataUrl: n.fileDataUrl,
        uploaderOrigin: n.uploaderOrigin,
        reactions: n.reactions
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
      color: e.color,
      curveType: e.curveType,
      style: e.style,
      thickness: e.thickness,
      direction: e.direction,
      doks_custom: {
        curveType: e.curveType,
        style: e.style,
        thickness: e.thickness,
        direction: e.direction,
        label: e.label,
        color: e.color,
        deleted: e.deleted,
        deletedAt: e.deletedAt,
        scope: e.scope
      }
    });
  }

  return {
    nodes: canvasNodes,
    edges: canvasEdges
  };
}

export const serializeCanvas = boardToJSONCanvas;

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

    const shapeVariant = (n.shapeVariant || n.shapeType || custom.shapeVariant) as any;
    const locked = n.locked ?? custom.locked ?? false;
    const fontSize = n.fontSize ?? custom.fontSize;
    const hasCheckbox = n.hasCheckbox ?? custom.hasCheckbox;
    const noteId = n.noteId || custom.noteId;
    const fileHash = n.fileHash || n.attachmentId || custom.fileHash;
    const fileName = n.fileName || n.originalName || custom.fileName;

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
      noteId,
      fileHash,
      fileName,
      url: n.url || custom.url,
      z: custom.z ?? 1,
      locked,
      fontSize,
      hasCheckbox,
      shapeVariant,
      deleted: custom.deleted ?? false,
      deletedAt: custom.deletedAt,
      scope: custom.scope as any,
      originId: custom.originId,
      promotedAt: custom.promotedAt,
      promotedBy: custom.promotedBy,
      svgPath: custom.svgPath,
      points: custom.points,
      strokeWidth: custom.strokeWidth,
      drawMode: custom.drawMode,
      opacity: custom.opacity,
      chartType: custom.chartType,
      chartData: custom.chartData,
      description: custom.description,
      codeLanguage: custom.codeLanguage,
      extractedText: custom.extractedText,
      showPreview: custom.showPreview,
      imageUrl: custom.imageUrl,
      fileDataUrl: custom.fileDataUrl,
      uploaderOrigin: custom.uploaderOrigin,
      reactions: custom.reactions
    });
  }

  const edges: BoardEdgeData[] = [];
  for (const e of data.edges || []) {
    const custom = e.doks_custom || {};
    const color = e.color || custom.color;
    const curveType = e.curveType || custom.curveType;
    const style = e.style || custom.style;
    const thickness = e.thickness || custom.thickness;
    const direction = e.direction || custom.direction;
    const label = e.label || custom.label;

    edges.push({
      id: e.id,
      from: e.fromNode,
      to: e.toNode,
      fromSide: e.fromSide as any,
      toSide: e.toSide as any,
      label,
      color,
      curveType,
      style,
      thickness,
      direction,
      deleted: custom.deleted ?? false,
      deletedAt: custom.deletedAt,
      scope: custom.scope as any
    });
  }

  return { nodes, edges };
}

export const parseCanvas = jsonCanvasToBoard;
