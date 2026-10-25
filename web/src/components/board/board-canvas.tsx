import { h, Fragment } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import * as Y from 'yjs';
import {
  getBoardDocName,
  getBoardMaps,
  nodeMapToData,
  setNodeProperties,
  applyTextDelta,
  getNoteDocName,
  type BoardNodeData,
  type BoardEdgeData,
  type BoardNodeType
} from '@doks/shared';
import { yjsClient, agentStatus } from '../../state/yjs-client.js';
import {
  openTab,
  notes,
  maps,
  restoreNote,
  createNote
} from '../../state/app-state.js';
import { seedDefaultBoard } from './board-seed.js';
import { Icon, type IconName } from '../../ui/icons.js';
import { AiExportModal } from './ai-export-modal.js';
import { NotePickerModal } from './note-picker-modal.js';

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#e06c75', // Red
  '2': '#d19a66', // Orange
  '3': '#e5c07b', // Yellow
  '4': '#98c379', // Green
  '5': '#56b6c2', // Cyan
  '6': '#c678dd', // Purple
  default: '#7c8cff'
};

export type CanvasTool = 'select' | 'hand' | 'sticky' | 'text' | 'note' | 'frame' | 'arrow' | 'shape';

interface BoardCanvasProps {
  boardId: string;
}

interface RemoteCursor {
  clientId: number;
  x: number;
  y: number;
  name: string;
  color: string;
}

export function BoardCanvas({ boardId }: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport state
  const [viewport, setViewport] = useState({ x: 80, y: 80, zoom: 1 });
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Data from Yjs
  const [nodesList, setNodesList] = useState<BoardNodeData[]>([]);
  const [edgesList, setEdgesList] = useState<BoardEdgeData[]>([]);

  // Selection state (multi-selection)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  // Current selected color for new stickies or changing node color
  const [activeColor, setActiveColor] = useState<string>('3');

  // Dragging multiple nodes
  const [dragState, setDragState] = useState<{
    startX: number;
    startY: number;
    initialPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  // Resizing a single node
  const [resizeState, setResizeState] = useState<{
    nodeId: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Pan state
  const [panState, setPanState] = useState<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // Marquee selection rectangle
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Arrow connection in progress
  const [connectingState, setConnectingState] = useState<{
    fromNodeId: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    currentX: number;
    currentY: number;
  } | null>(null);

  // Remote cursors awareness
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  // Internal clipboard for copy/paste
  const clipboardRef = useRef<BoardNodeData[]>([]);

  // Note picker modal for note cards (F3)
  const [isNotePickerOpen, setIsNotePickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);

  // Hidden attachment file input (F4)
  const fileAttachmentInputRef = useRef<HTMLInputElement>(null);

  // Undo manager
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const docName = getBoardDocName(boardId);
  const boardDoc = yjsClient.getOrCreateDoc(docName);
  const awareness = yjsClient.getOrCreateAwareness(docName);
  const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

  // Map of nodes for quick coordinate lookup
  const nodeLookup = useMemo(() => {
    const map = new Map<string, BoardNodeData>();
    for (const n of nodesList) {
      map.set(n.id, n);
    }
    return map;
  }, [nodesList]);

  // Sync Yjs docs and setup Awareness
  useEffect(() => {
    const updateState = () => {
      const activeNodes: BoardNodeData[] = [];
      yNodes.forEach((nodeMap, id) => {
        const data = nodeMapToData(id, nodeMap);
        if (!data.deleted) activeNodes.push(data);
      });
      setNodesList(activeNodes);

      const activeEdges: BoardEdgeData[] = [];
      yEdges.forEach((edge) => {
        if (!edge.deleted) activeEdges.push(edge);
      });
      setEdgesList(activeEdges);
    };

    updateState();

    yNodes.observeDeep(updateState);
    yEdges.observe(updateState);

    // Initialize UndoManager
    const um = new Y.UndoManager([yNodes, yEdges], {
      trackedOrigins: new Set([null, undefined, 'user'])
    });
    undoManagerRef.current = um;

    // Listen to Awareness remote cursor changes
    const updateAwareness = () => {
      const states = awareness.getStates();
      const cursors: RemoteCursor[] = [];
      const myClientId = awareness.clientID;

      states.forEach((state: any, clientID: number) => {
        if (clientID !== myClientId && state.cursor) {
          cursors.push({
            clientId: clientID,
            x: state.cursor.x,
            y: state.cursor.y,
            name: state.cursor.name || 'Соавтор',
            color: state.cursor.color || '#3b82f6'
          });
        }
      });
      setRemoteCursors(cursors);
    };

    awareness.on('change', updateAwareness);

    return () => {
      yNodes.unobserveDeep(updateState);
      yEdges.unobserve(updateState);
      awareness.off('change', updateAwareness);
      um.destroy();
      undoManagerRef.current = null;
    };
  }, [boardId]);

  // Screen to canvas coordinate conversion
  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - viewport.x) / viewport.zoom;
    const y = (clientY - rect.top - viewport.y) / viewport.zoom;
    return { x, y };
  };

  // Zoom to mouse cursor math
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (e.ctrlKey || e.metaKey) {
      // Zoom centered at cursor
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.15), 3.0);

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newX = mouseX - (mouseX - viewport.x) * (newZoom / viewport.zoom);
      const newY = mouseY - (mouseY - viewport.y) * (newZoom / viewport.zoom);

      setViewport({ x: newX, y: newY, zoom: newZoom });
    } else {
      // Pan
      setViewport((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY
      }));
    }
  };

  // Keyboard shortcuts (V, H, S, T, N, F, C, R, Space, Ctrl+Z, Ctrl+C, Ctrl+V, Delete, Ctrl+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Spacebar for Pan
      if (e.code === 'Space' && !isSpacePressed) {
        setIsSpacePressed(true);
      }

      // Tool switches
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'v') setActiveTool('select');
        if (e.key.toLowerCase() === 'h') setActiveTool('hand');
        if (e.key.toLowerCase() === 's') setActiveTool('sticky');
        if (e.key.toLowerCase() === 't') setActiveTool('text');
        if (e.key.toLowerCase() === 'n') {
          // Open Note Picker Modal (F3)
          const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
          const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
          setPickerPos({ x: centerX - 140, y: centerY - 110 });
          setIsNotePickerOpen(true);
        }
        if (e.key.toLowerCase() === 'f') setActiveTool('frame');
        if (e.key.toLowerCase() === 'c') setActiveTool('arrow');
        if (e.key.toLowerCase() === 'r') setActiveTool('shape');
      }

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }

      // Undo / Redo
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoManagerRef.current?.undo();
      }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        undoManagerRef.current?.redo();
      }

      // AI Context Export (Ctrl+Shift+E)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowAiModal(true);
      }

      // Duplicate (Ctrl+D)
      if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      }

      // Copy (Ctrl+C)
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        const toCopy = nodesList.filter((n) => selectedNodeIds.has(n.id));
        if (toCopy.length > 0) {
          clipboardRef.current = toCopy;
        }
      }

      // Paste (Ctrl+V)
      if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboard();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedNodeIds, nodesList, isSpacePressed]);

  // Delete all currently selected nodes and edges
  const deleteSelected = () => {
    boardDoc.transact(() => {
      for (const id of selectedNodeIds) {
        const nodeMap = yNodes.get(id);
        if (nodeMap) {
          nodeMap.set('deleted', true);
          nodeMap.set('deletedAt', Date.now());
        }
      }
      if (selectedEdgeId) {
        const edge = yEdges.get(selectedEdgeId);
        if (edge) {
          yEdges.set(selectedEdgeId, { ...edge, deleted: true });
        }
      }
    }, 'user');

    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
  };

  // Duplicate selected nodes with offset
  const duplicateSelected = () => {
    const newSelected = new Set<string>();
    boardDoc.transact(() => {
      for (const id of selectedNodeIds) {
        const src = nodeLookup.get(id);
        if (src) {
          const newId = crypto.randomUUID();
          const newMap = new Y.Map();
          yNodes.set(newId, newMap);
          setNodeProperties(newMap, {
            ...src,
            id: newId,
            x: src.x + 30,
            y: src.y + 30,
            text: src.text
          });
          newSelected.add(newId);
        }
      }
    }, 'user');
    setSelectedNodeIds(newSelected);
  };

  // Paste clipboard items
  const pasteClipboard = () => {
    if (clipboardRef.current.length === 0) return;
    const newSelected = new Set<string>();
    boardDoc.transact(() => {
      for (const src of clipboardRef.current) {
        const newId = crypto.randomUUID();
        const newMap = new Y.Map();
        yNodes.set(newId, newMap);
        setNodeProperties(newMap, {
          ...src,
          id: newId,
          x: src.x + 40,
          y: src.y + 40
        });
        newSelected.add(newId);
      }
    }, 'user');
    setSelectedNodeIds(newSelected);
  };

  // Add node at canvas coordinates
  const createNodeAt = (type: BoardNodeType, x: number, y: number, color = activeColor, initialText = '') => {
    const id = crypto.randomUUID();
    const nodeMap = new Y.Map();
    const isFrame = type === 'frame';
    const isNote = type === 'note';

    let defaultText = initialText;
    if (!defaultText) {
      if (isFrame) defaultText = 'Группа';
      else if (isNote) defaultText = 'Карточка заметки';
      else defaultText = type === 'text' ? 'Текстовый блок' : '';
    }

    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type,
        x: Math.round(x),
        y: Math.round(y),
        w: isFrame ? 420 : type === 'text' ? 220 : 200,
        h: isFrame ? 320 : type === 'text' ? 80 : 130,
        text: defaultText,
        color: type === 'sticky' ? color : 'default',
        author: agentStatus.value?.memberName || 'Вы',
        done: false,
        z: isFrame ? 0 : 1,
        deleted: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
  };

  // Create a note card linked to an existing note (F3)
  const createNoteCardAt = (noteId: string, x: number, y: number) => {
    const id = crypto.randomUUID();
    const nodeMap = new Y.Map();
    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type: 'note',
        x: Math.round(x),
        y: Math.round(y),
        w: 300,
        h: 240,
        noteId,
        text: '',
        color: 'default',
        author: agentStatus.value?.memberName || 'Вы',
        done: false,
        z: 1,
        deleted: false
      });
    }, 'user');
    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
  };

  // Upload attachment file and place block or image on board (F4)
  const handleUploadFileToBoard = async (file: File, x: number, y: number) => {
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/attachments', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name)
        },
        body: buffer
      });
      if (!res.ok) return;
      const data = await res.json();
      const id = crypto.randomUUID();
      const nodeMap = new Y.Map();
      const isImage = (data.mimeType || '').startsWith('image/') && !data.mimeType.includes('svg');

      boardDoc.transact(() => {
        yNodes.set(id, nodeMap);
        setNodeProperties(nodeMap, {
          id,
          type: isImage ? 'sticky' : 'file',
          x: Math.round(x),
          y: Math.round(y),
          w: isImage ? 280 : 220,
          h: isImage ? 200 : 110,
          text: file.name,
          fileHash: data.hash,
          fileName: data.fileName,
          author: agentStatus.value?.memberName || 'Вы',
          done: false,
          z: 1,
          deleted: false
        });
      }, 'user');
      setSelectedNodeIds(new Set([id]));
    } catch (err) {
      console.error('Failed to upload file to board:', err);
    }
  };

  // Sticky Chaining: create next sticky on Tab or Shift+Enter
  const chainNextSticky = (sourceNode: BoardNodeData, direction: 'right' | 'down') => {
    const spacing = 24;
    const newX = direction === 'right' ? sourceNode.x + sourceNode.w + spacing : sourceNode.x;
    const newY = direction === 'down' ? sourceNode.y + sourceNode.h + spacing : sourceNode.y;

    const newId = crypto.randomUUID();
    const nodeMap = new Y.Map();

    boardDoc.transact(() => {
      yNodes.set(newId, nodeMap);
      setNodeProperties(nodeMap, {
        id: newId,
        type: 'sticky',
        x: Math.round(newX),
        y: Math.round(newY),
        w: sourceNode.w,
        h: sourceNode.h,
        text: '',
        color: sourceNode.color || activeColor,
        author: agentStatus.value?.memberName || 'Вы',
        done: false,
        z: 1,
        deleted: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([newId]));
    setTimeout(() => {
      const el = document.getElementById(`node-textarea-${newId}`) as HTMLTextAreaElement;
      el?.focus();
    }, 50);
  };

  // Global Pointer Events (No-Sticking guaranteed)
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      // 1. Update awareness cursor
      const pos = screenToCanvas(e.clientX, e.clientY);
      awareness.setLocalStateField('cursor', {
        x: pos.x,
        y: pos.y,
        name: agentStatus.value?.memberName || 'Соавтор',
        color: agentStatus.value?.memberColor || '#7c8cff'
      });

      // 2. Pan canvas
      if (panState) {
        setViewport((prev) => ({
          ...prev,
          x: panState.originX + (e.clientX - panState.startX),
          y: panState.originY + (e.clientY - panState.startY)
        }));
      }

      // 3. Drag multiple nodes
      if (dragState) {
        const dx = (e.clientX - dragState.startX) / viewport.zoom;
        const dy = (e.clientY - dragState.startY) / viewport.zoom;

        dragState.initialPositions.forEach((pos, id) => {
          const nodeMap = yNodes.get(id);
          if (nodeMap) {
            nodeMap.set('x', Math.round(pos.x + dx));
            nodeMap.set('y', Math.round(pos.y + dy));
          }
        });
      }

      // 4. Resize node
      if (resizeState) {
        const dx = (e.clientX - resizeState.startX) / viewport.zoom;
        const dy = (e.clientY - resizeState.startY) / viewport.zoom;
        const nodeMap = yNodes.get(resizeState.nodeId);
        if (nodeMap) {
          nodeMap.set('w', Math.max(80, Math.round(resizeState.startW + dx)));
          nodeMap.set('h', Math.max(50, Math.round(resizeState.startH + dy)));
        }
      }

      // 5. Marquee selection
      if (marqueeBox) {
        setMarqueeBox((prev) => (prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null));

        const minX = Math.min(marqueeBox.startX, pos.x);
        const maxX = Math.max(marqueeBox.startX, pos.x);
        const minY = Math.min(marqueeBox.startY, pos.y);
        const maxY = Math.max(marqueeBox.startY, pos.y);

        const newSelected = new Set<string>();
        for (const n of nodesList) {
          if (n.x + n.w >= minX && n.x <= maxX && n.y + n.h >= minY && n.y <= maxY) {
            newSelected.add(n.id);
          }
        }
        setSelectedNodeIds(newSelected);
      }

      // 6. Connecting arrow
      if (connectingState) {
        setConnectingState((prev) => (prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null));
      }
    };

    const handleGlobalPointerUp = () => {
      setPanState(null);
      setDragState(null);
      setResizeState(null);
      setMarqueeBox(null);
      setConnectingState(null);
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [panState, dragState, resizeState, marqueeBox, connectingState, viewport, nodesList]);

  // Canvas background pointer down
  const handleBackgroundPointerDown = (e: MouseEvent) => {
    const isHandMode = activeTool === 'hand' || isSpacePressed || e.button === 1;

    if (isHandMode) {
      setPanState({
        startX: e.clientX,
        startY: e.clientY,
        originX: viewport.x,
        originY: viewport.y
      });
      return;
    }

    const pos = screenToCanvas(e.clientX, e.clientY);

    // If active tool is placeable
    if (activeTool === 'sticky') {
      createNodeAt('sticky', pos.x - 100, pos.y - 65, activeColor);
      return;
    }
    if (activeTool === 'text') {
      createNodeAt('text', pos.x - 110, pos.y - 40);
      return;
    }
    if (activeTool === 'frame') {
      createNodeAt('frame', pos.x - 210, pos.y - 160);
      return;
    }
    if (activeTool === 'shape') {
      createNodeAt('shape', pos.x - 100, pos.y - 65, activeColor);
      return;
    }
    if (activeTool === 'note') {
      setPickerPos({ x: pos.x - 150, y: pos.y - 120 });
      setIsNotePickerOpen(true);
      setActiveTool('select');
      return;
    }

    // Default select tool on empty space: start Marquee selection
    if (e.button === 0) {
      if (!e.shiftKey) {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
      }
      setMarqueeBox({
        startX: pos.x,
        startY: pos.y,
        currentX: pos.x,
        currentY: pos.y
      });
    }
  };

  // Node pointer down: start dragging single or multiple
  const handleNodePointerDown = (node: BoardNodeData, e: MouseEvent) => {
    e.stopPropagation();

    // If space is held down or hand tool, allow panning instead
    if (isSpacePressed || activeTool === 'hand') {
      setPanState({
        startX: e.clientX,
        startY: e.clientY,
        originX: viewport.x,
        originY: viewport.y
      });
      return;
    }

    let currentSelected = new Set(selectedNodeIds);
    if (e.shiftKey) {
      if (currentSelected.has(node.id)) currentSelected.delete(node.id);
      else currentSelected.add(node.id);
    } else {
      if (!currentSelected.has(node.id)) {
        currentSelected = new Set([node.id]);
      }
    }
    setSelectedNodeIds(currentSelected);

    // Frame drag: include contained nodes!
    if (node.type === 'frame') {
      for (const other of nodesList) {
        if (other.id !== node.id && other.type !== 'frame') {
          const cx = other.x + other.w / 2;
          const cy = other.y + other.h / 2;
          if (cx >= node.x && cx <= node.x + node.w && cy >= node.y && cy <= node.y + node.h) {
            currentSelected.add(other.id);
          }
        }
      }
      setSelectedNodeIds(new Set(currentSelected));
    }

    // Capture initial positions for batch drag
    const initialPositions = new Map<string, { x: number; y: number }>();
    currentSelected.forEach((id) => {
      const n = nodeLookup.get(id);
      if (n) initialPositions.set(id, { x: n.x, y: n.y });
    });

    setDragState({
      startX: e.clientX,
      startY: e.clientY,
      initialPositions
    });
  };

  // Magnetic port click/drag
  const handlePortPointerDown = (nodeId: string, side: 'top' | 'right' | 'bottom' | 'left', e: MouseEvent) => {
    e.stopPropagation();
    const pos = screenToCanvas(e.clientX, e.clientY);
    setConnectingState({
      fromNodeId: nodeId,
      fromSide: side,
      currentX: pos.x,
      currentY: pos.y
    });
  };

  const handlePortPointerUp = (targetNodeId: string, toSide: 'top' | 'right' | 'bottom' | 'left', e: MouseEvent) => {
    e.stopPropagation();
    if (connectingState && connectingState.fromNodeId !== targetNodeId) {
      const edgeId = crypto.randomUUID();
      boardDoc.transact(() => {
        yEdges.set(edgeId, {
          id: edgeId,
          from: connectingState.fromNodeId,
          to: targetNodeId,
          fromSide: connectingState.fromSide,
          toSide,
          label: '',
          color: 'default',
          deleted: false
        });
      }, 'user');
    }
    setConnectingState(null);
  };

  // Calculate magnetic port coordinates
  const getPortCoord = (node: BoardNodeData, side?: 'top' | 'right' | 'bottom' | 'left') => {
    switch (side) {
      case 'top':
        return { x: node.x + node.w / 2, y: node.y };
      case 'bottom':
        return { x: node.x + node.w / 2, y: node.y + node.h };
      case 'left':
        return { x: node.x, y: node.y + node.h / 2 };
      case 'right':
      default:
        return { x: node.x + node.w, y: node.y + node.h / 2 };
    }
  };

  // Change color of selected nodes
  const changeSelectedColor = (colorKey: string) => {
    setActiveColor(colorKey);
    if (selectedNodeIds.size > 0) {
      boardDoc.transact(() => {
        for (const id of selectedNodeIds) {
          const map = yNodes.get(id);
          if (map) map.set('color', colorKey);
        }
      }, 'user');
    }
  };

  return (
    <div
      class={`board-container ${activeTool === 'hand' || isSpacePressed ? 'cursor-grab' : ''}`}
      ref={containerRef}
      onWheel={(e) => handleWheel(e as any)}
      onMouseDown={handleBackgroundPointerDown}
      onDragOver={(e) => {
        if (
          e.dataTransfer?.types.includes('application/doks-note-id') ||
          (e.dataTransfer?.files && e.dataTransfer.files.length > 0)
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={async (e) => {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const canvasX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
        const canvasY = (e.clientY - rect.top - viewport.y) / viewport.zoom;

        const noteId = e.dataTransfer?.getData('application/doks-note-id');
        if (noteId) {
          createNoteCardAt(noteId, canvasX, canvasY);
          return;
        }

        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            await handleUploadFileToBoard(e.dataTransfer.files[i], canvasX + i * 20, canvasY + i * 20);
          }
        }
      }}
    >
      {/* 1. Miro-level Floating Toolbox */}
      <div class="board-toolbox" onClick={(e) => e.stopPropagation()}>
        <div class="toolbox-group">
          <button
            class={`tb-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title="Выбор (V)"
          >
            <Icon name="move" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'hand' ? 'active' : ''}`}
            onClick={() => setActiveTool('hand')}
            title="Рука (H / Пробел)"
          >
            <Icon name="hand" size={17} />
          </button>
        </div>

        <div class="toolbox-divider" />

        <div class="toolbox-group">
          <button
            class={`tb-btn ${activeTool === 'sticky' ? 'active' : ''}`}
            onClick={() => setActiveTool('sticky')}
            title="Стикер (S)"
          >
            <Icon name="sticky-note" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
            title="Текст (T)"
          >
            <Icon name="type" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'note' ? 'active' : ''}`}
            onClick={() => {
              const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
              const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
              setPickerPos({ x: centerX - 150, y: centerY - 120 });
              setIsNotePickerOpen(true);
            }}
            title="Карточка заметки (N)"
          >
            <Icon name="file-text" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'frame' ? 'active' : ''}`}
            onClick={() => setActiveTool('frame')}
            title="Рамка / Группа (F)"
          >
            <Icon name="frame" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="Связь со стрелкой (C)"
          >
            <Icon name="arrow-right" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'shape' ? 'active' : ''}`}
            onClick={() => setActiveTool('shape')}
            title="Фигура (R)"
          >
            <Icon name="square" size={17} />
          </button>
          <button
            class="tb-btn"
            onClick={() => fileAttachmentInputRef.current?.click()}
            title="Прикрепить файл или изображение"
          >
            <Icon name="paperclip" size={17} />
          </button>
          <input
            type="file"
            ref={fileAttachmentInputRef}
            style={{ display: 'none' }}
            multiple
            onChange={async (e) => {
              const input = e.target as HTMLInputElement;
              if (input.files && input.files.length > 0) {
                const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                for (let i = 0; i < input.files.length; i++) {
                  await handleUploadFileToBoard(input.files[i], centerX + i * 25, centerY + i * 25);
                }
                input.value = '';
              }
            }}
          />
        </div>

        <div class="toolbox-divider" />

        {/* Color Palette (1-6) */}
        <div class="toolbox-colors">
          {Object.entries(CANVAS_COLORS).filter(([k]) => k !== 'default').map(([key, hex]) => (
            <button
              key={key}
              class={`tb-color-dot ${activeColor === key ? 'active' : ''}`}
              style={{ backgroundColor: hex }}
              onClick={() => changeSelectedColor(key)}
              title={`Цвет ${key}`}
            />
          ))}
        </div>

        <div class="toolbox-divider" />

        {/* Delete button if item selected */}
        {(selectedNodeIds.size > 0 || selectedEdgeId) && (
          <button class="tb-btn danger" onClick={deleteSelected} title="Удалить выбранное (Delete)">
            <Icon name="trash" size={16} />
          </button>
        )}

        <div class="toolbox-divider" />

        {/* AI Context Export */}
        <button
          class="tb-btn text-[var(--accent)]"
          onClick={() => setShowAiModal(true)}
          title="Экспорт для ИИ (Ctrl+Shift+E)"
        >
          <Icon name="sparkles" size={17} />
        </button>
      </div>

      {/* 2. Zoom & Template Controls (Bottom-Right) */}
      <div class="board-zoom-controls" onClick={(e) => e.stopPropagation()}>
        <button
          class="zoom-btn"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(v.zoom * 1.2, 3) }))}
          title="Приблизить"
        >
          <Icon name="zoom-in" size={15} />
        </button>
        <span class="zoom-level">{Math.round(viewport.zoom * 100)}%</span>
        <button
          class="zoom-btn"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(v.zoom * 0.8, 0.15) }))}
          title="Отдалить"
        >
          <Icon name="zoom-out" size={15} />
        </button>
        <button
          class="zoom-btn"
          onClick={() => setViewport({ x: 80, y: 80, zoom: 1 })}
          title="Сброс масштаба 100%"
        >
          1:1
        </button>
        {nodesList.length === 0 && (
          <button
            class="template-seed-btn"
            onClick={() => seedDefaultBoard(boardDoc, agentStatus.value?.memberName || 'Вы')}
            title="Заполнить готовым шаблоном задач"
          >
            <Icon name="sparkles" size={14} />
            <span>Шаблон</span>
          </button>
        )}
      </div>

      {/* 3. Infinite Scaled Layer */}
      <div
        class="board-transform-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {/* SVG Connections & Arrows */}
        <svg class="canvas-svg-layer">
          <defs>
            <marker
              id="arrow-marker"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Render established edges */}
          {edgesList.map((edge) => {
            const fromNode = nodeLookup.get(edge.from);
            const toNode = nodeLookup.get(edge.to);
            if (!fromNode || !toNode) return null;

            const p1 = getPortCoord(fromNode, edge.fromSide);
            const p2 = getPortCoord(toNode, edge.toSide);

            // Bezier control offset
            const dx = Math.abs(p2.x - p1.x) * 0.5;
            const pathD = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const isSelected = selectedEdgeId === edge.id;

            return (
              <g key={edge.id} onClick={(e) => { e.stopPropagation(); setSelectedEdgeId(edge.id); }}>
                <path
                  d={pathD}
                  class={`board-edge-line ${isSelected ? 'selected' : ''}`}
                  stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'}
                  stroke-width={isSelected ? 3 : 2}
                  fill="none"
                  marker-end="url(#arrow-marker)"
                />
                {edge.label && (
                  <text x={midX} y={midY - 6} class="edge-text-label" text-anchor="middle">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Temporary arrow during drag */}
          {connectingState && (
            (() => {
              const fromNode = nodeLookup.get(connectingState.fromNodeId);
              if (!fromNode) return null;
              const p1 = getPortCoord(fromNode, connectingState.fromSide);
              return (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={connectingState.currentX}
                  y2={connectingState.currentY}
                  stroke="var(--accent)"
                  stroke-width="2.5"
                  stroke-dasharray="4 4"
                  marker-end="url(#arrow-marker)"
                />
              );
            })()
          )}
        </svg>

        {/* Nodes Layer */}
        {nodesList.map((node) => {
          const isSelected = selectedNodeIds.has(node.id);
          const nodeColorHex = CANVAS_COLORS[node.color || ''] || CANVAS_COLORS.default;
          const isFrame = node.type === 'frame';
          const isNote = node.type === 'note';

          return (
            <div
              key={node.id}
              class={`board-node-box type-${node.type} ${isSelected ? 'selected' : ''}`}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.w}px`,
                height: `${node.h}px`,
                borderColor: isFrame ? 'var(--border-color)' : nodeColorHex,
                zIndex: node.z ?? (isFrame ? 0 : 2)
              }}
              onMouseDown={(e) => handleNodePointerDown(node, e as any)}
            >
              {/* 4 Magnetic Connector Ports */}
              <div
                class="magnetic-port port-top"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'top', e as any)}
                onMouseUp={(e) => handlePortPointerUp(node.id, 'top', e as any)}
              />
              <div
                class="magnetic-port port-right"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'right', e as any)}
                onMouseUp={(e) => handlePortPointerUp(node.id, 'right', e as any)}
              />
              <div
                class="magnetic-port port-bottom"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'bottom', e as any)}
                onMouseUp={(e) => handlePortPointerUp(node.id, 'bottom', e as any)}
              />
              <div
                class="magnetic-port port-left"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'left', e as any)}
                onMouseUp={(e) => handlePortPointerUp(node.id, 'left', e as any)}
              />

              {/* Node Header / Meta */}
              <div class="node-meta-stripe">
                {node.type === 'sticky' && (
                  <input
                    type="checkbox"
                    class="sticky-checkbox"
                    checked={node.done || false}
                    onChange={(e) => {
                      const map = yNodes.get(node.id);
                      if (map) map.set('done', (e.target as HTMLInputElement).checked);
                    }}
                  />
                )}
                <span class="node-author-chip" style={{ color: nodeColorHex }}>
                  {node.author || (isFrame ? 'Группа' : 'Стикер')}
                </span>
                {isNote && (
                  <button
                    class="node-open-note-btn"
                    title="Открыть заметку во вкладке"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.noteId) {
                        const meta = maps.notes.get(node.noteId);
                        openTab('note', node.noteId, meta?.title || node.text);
                      }
                    }}
                  >
                    <Icon name="external-link" size={12} />
                    <span>Открыть</span>
                  </button>
                )}
              </div>

              {/* Node Content (Inline text editing or note card or attachment) */}
              {isNote ? (
                (() => {
                  const noteMeta = node.noteId ? maps.notes.get(node.noteId) : null;
                  const isDeleted = !noteMeta || noteMeta.deleted;

                  if (isDeleted) {
                    return (
                      <div class="note-card-deleted-view" onMouseDown={(e) => e.stopPropagation()}>
                        <span class="deleted-label">Заметка удалена</span>
                        {node.noteId && (
                          <button
                            class="btn btn-secondary btn-sm"
                            style={{ marginTop: '8px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              restoreNote(node.noteId!);
                            }}
                          >
                            Восстановить
                          </button>
                        )}
                      </div>
                    );
                  }

                  const noteDoc = yjsClient.getOrCreateDoc(getNoteDocName(node.noteId!));
                  const noteYText = noteDoc.getText('text');
                  const noteContent = noteYText.toString();

                  return (
                    <div class="note-card-content-view">
                      <textarea
                        id={`node-textarea-${node.id}`}
                        class="node-inline-textarea note-card-textarea"
                        value={noteContent}
                        placeholder="Текст заметки..."
                        onMouseDown={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          const val = (e.target as HTMLTextAreaElement).value;
                          applyTextDelta(noteYText, val);
                        }}
                      />
                    </div>
                  );
                })()
              ) : node.fileHash ? (
                (() => {
                  const isImg = (node.fileName || '').match(/\.(png|jpe?g|gif|webp)$/i);
                  const isAud = (node.fileName || '').match(/\.(mp3|ogg|wav)$/i);
                  const isVid = (node.fileName || '').match(/\.(mp4|webm)$/i);

                  if (isImg) {
                    return (
                      <div class="node-image-container" onMouseDown={(e) => e.stopPropagation()}>
                        <img
                          src={`/api/attachments/${node.fileHash}`}
                          alt={node.fileName || node.text}
                          class="node-rendered-img"
                        />
                      </div>
                    );
                  }
                  if (isAud) {
                    return (
                      <div class="node-media-container" onMouseDown={(e) => e.stopPropagation()}>
                        <audio controls src={`/api/attachments/${node.fileHash}`} style={{ width: '100%' }} />
                      </div>
                    );
                  }
                  if (isVid) {
                    return (
                      <div class="node-media-container" onMouseDown={(e) => e.stopPropagation()}>
                        <video controls src={`/api/attachments/${node.fileHash}`} style={{ width: '100%', maxHeight: '100%' }} />
                      </div>
                    );
                  }
                  return (
                    <div class="node-file-container" onMouseDown={(e) => e.stopPropagation()}>
                      <Icon name="paperclip" size={24} />
                      <span class="node-file-label" title={node.fileName || node.text}>
                        {node.fileName || node.text}
                      </span>
                      <a
                        href={`/api/attachments/${node.fileHash}`}
                        download={node.fileName || 'file'}
                        class="btn btn-secondary btn-sm"
                        target="_blank"
                        rel="noopener"
                      >
                        Скачать
                      </a>
                    </div>
                  );
                })()
              ) : isFrame ? (
                <div class="frame-label-area">
                  <span class="frame-label-text">{node.text}</span>
                </div>
              ) : (
                <textarea
                  id={`node-textarea-${node.id}`}
                  class="node-inline-textarea"
                  value={node.text}
                  placeholder="Введите текст..."
                  onMouseDown={(e) => e.stopPropagation()}
                  onInput={(e) => {
                    const map = yNodes.get(node.id);
                    if (map) {
                      setNodeProperties(map, { text: (e.target as HTMLTextAreaElement).value });
                    }
                  }}
                  onKeyDown={(e) => {
                    // Miro Tab sticky chaining!
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      chainNextSticky(node, 'right');
                    }
                    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
                      e.preventDefault();
                      chainNextSticky(node, 'down');
                    }
                  }}
                />
              )}

              {/* Resize Handle */}
              {isSelected && (
                <div
                  class="node-resize-handle"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setResizeState({
                      nodeId: node.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      startW: node.w,
                      startH: node.h
                    });
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Marquee Selection Box */}
        {marqueeBox && (
          <div
            class="marquee-selection-box"
            style={{
              left: `${Math.min(marqueeBox.startX, marqueeBox.currentX)}px`,
              top: `${Math.min(marqueeBox.startY, marqueeBox.currentY)}px`,
              width: `${Math.abs(marqueeBox.currentX - marqueeBox.startX)}px`,
              height: `${Math.abs(marqueeBox.currentY - marqueeBox.startY)}px`
            }}
          />
        )}

        {/* Remote Realtime Awareness Cursors */}
        {remoteCursors.map((c) => (
          <div
            key={c.clientId}
            class="remote-cursor-pointer"
            style={{
              left: `${c.x}px`,
              top: `${c.y}px`
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={c.color} stroke="#ffffff" stroke-width="1.5">
              <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36z" />
            </svg>
            <span class="remote-cursor-badge" style={{ backgroundColor: c.color }}>
              {c.name}
            </span>
          </div>
        ))}
      </div>

      {showAiModal && (
        <AiExportModal
          boardId={boardId}
          selectedNodeIds={Array.from(selectedNodeIds)}
          onClose={() => setShowAiModal(false)}
        />
      )}

      <NotePickerModal
        isOpen={isNotePickerOpen}
        onClose={() => setIsNotePickerOpen(false)}
        onSelectNote={(noteId) => {
          const pos = pickerPos || {
            x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
            y: (window.innerHeight / 2 - viewport.y) / viewport.zoom
          };
          createNoteCardAt(noteId, pos.x, pos.y);
          setIsNotePickerOpen(false);
        }}
      />
    </div>
  );
}
