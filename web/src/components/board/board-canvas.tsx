import { h, Fragment, VNode } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import * as Y from 'yjs';
import {
  getBoardDocName,
  getScopedBoardDocName,
  getBoardMaps,
  nodeMapToData,
  setNodeProperties,
  applyTextDelta,
  getNoteDocName,
  getScopedNoteDocName,
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
  createNote,
  currentScope,
  ensureSplitTabs,
  setWorkspaceMode
} from '../../state/app-state.js';
import { seedDefaultBoard } from './board-seed.js';
import { Icon, type IconName } from '../Icons.js';
import { AiExportModal } from './ai-export-modal.js';
import { NotePickerModal } from './note-picker-modal.js';
import { BoardMinimap } from './board-minimap.js';
import { TransferModal } from './transfer-modal.js';
import { t } from '../../i18n/index.js';
import { showConfirm } from '../../ui/dialogs.js';
import { showToast } from '../../ui/toast.js';

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#f87171', // Crimson / Coral
  '2': '#fb923c', // Orange
  '3': '#fbbf24', // Warm Amber (Solo accent)
  '4': '#34d399', // Emerald
  '5': '#38bdf8', // Slate Cyan (Team accent)
  '6': '#c084fc', // Purple
  '7': '#818cf8', // Indigo
  '8': '#94a3b8', // Neutral Graphite
  default: '#38bdf8'
};

export type CanvasTool = 'select' | 'hand' | 'sticky' | 'text' | 'note' | 'frame' | 'arrow' | 'shape';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

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

interface AlignmentGuide {
  type: 'x' | 'y';
  pos: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId?: string;
}

interface QuickConnectState {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  fromNodeId: string;
  fromSide: 'top' | 'right' | 'bottom' | 'left';
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

  // Selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [activeColor, setActiveColor] = useState<string>('3');

  // Dragging multiple nodes
  const [dragState, setDragState] = useState<{
    startX: number;
    startY: number;
    initialPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  // 8-Point Resizing state
  const [resizeState, setResizeState] = useState<{
    nodeId: string;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startXPos: number;
    startYPos: number;
  } | null>(null);

  // Smart Alignment Guides
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);

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

  // Quick connect drop menu on empty canvas
  const [quickConnect, setQuickConnect] = useState<QuickConnectState | null>(null);

  // Custom Context Menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Remote cursors awareness
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  // Internal clipboard for copy/paste
  const clipboardRef = useRef<BoardNodeData[]>([]);

  // Note picker modal for note cards
  const [isNotePickerOpen, setIsNotePickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferNodeIds, setTransferNodeIds] = useState<string[]>([]);

  const handleOpenTransferModal = (ids?: string[]) => {
    const targetIds = ids && ids.length > 0 ? ids : Array.from(selectedNodeIds);
    setTransferNodeIds(targetIds);
    setIsTransferModalOpen(true);
  };

  // Hidden attachment file input
  const fileAttachmentInputRef = useRef<HTMLInputElement>(null);

  // Undo manager
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const docName = getScopedBoardDocName(currentScope.value, boardId);
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

  // Container dimensions
  const [containerSize, setContainerSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth || window.innerWidth,
          height: containerRef.current.clientHeight || window.innerHeight
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Viewport virtualization
  const visibleNodes = useMemo(() => {
    if (nodesList.length < 40) return nodesList;
    const marginX = (containerSize.width / viewport.zoom) * 0.25;
    const marginY = (containerSize.height / viewport.zoom) * 0.25;
    const left = -viewport.x / viewport.zoom - marginX;
    const top = -viewport.y / viewport.zoom - marginY;
    const right = left + (containerSize.width / viewport.zoom) + 2 * marginX;
    const bottom = top + (containerSize.height / viewport.zoom) + 2 * marginY;

    return nodesList.filter((n) => {
      if (selectedNodeIds.has(n.id)) return true;
      return n.x + n.w >= left && n.x <= right && n.y + n.h >= top && n.y <= bottom;
    });
  }, [nodesList, viewport, containerSize, selectedNodeIds]);

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

    const um = new Y.UndoManager([yNodes, yEdges], {
      trackedOrigins: new Set([null, undefined, 'user'])
    });
    undoManagerRef.current = um;

    const updateAwareness = () => {
      const states = awareness.getStates();
      const cursors: RemoteCursor[] = [];
      states.forEach((state: any, clientId: number) => {
        if (clientId !== boardDoc.clientID && state?.cursor) {
          cursors.push({
            clientId,
            x: state.cursor.x,
            y: state.cursor.y,
            name: state.cursor.name || 'Соавтор',
            color: state.cursor.color || '#7c8cff'
          });
        }
      });
      setRemoteCursors(cursors);
    };

    awareness.on('change', updateAwareness);

    // Global listener to focus specific node from search / command palette
    const handleFocusNode = (e: CustomEvent<{ nodeId: string }>) => {
      const target = nodeLookup.get(e.detail.nodeId);
      if (target && containerRef.current) {
        setSelectedNodeIds(new Set([target.id]));
        const rect = containerRef.current.getBoundingClientRect();
        const targetZoom = 1.0;
        const newX = rect.width / 2 - (target.x + target.w / 2) * targetZoom;
        const newY = rect.height / 2 - (target.y + target.h / 2) * targetZoom;
        setViewport({ x: newX, y: newY, zoom: targetZoom });
      }
    };
    window.addEventListener('doks-focus-node' as any, handleFocusNode);

    return () => {
      yNodes.unobserveDeep(updateState);
      yEdges.unobserve(updateState);
      awareness.off('change', updateAwareness);
      window.removeEventListener('doks-focus-node' as any, handleFocusNode);
    };
  }, [docName]);

  // Coordinate transformation helpers
  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - viewport.x) / viewport.zoom;
    const y = (clientY - rect.top - viewport.y) / viewport.zoom;
    return { x, y };
  };

  const getPortCoord = (node: BoardNodeData, side?: 'top' | 'right' | 'bottom' | 'left') => {
    switch (side) {
      case 'top':
        return { x: node.x + node.w / 2, y: node.y };
      case 'right':
        return { x: node.x + node.w, y: node.y + node.h / 2 };
      case 'bottom':
        return { x: node.x + node.w / 2, y: node.y + node.h };
      case 'left':
        return { x: node.x, y: node.y + node.h / 2 };
      default:
        return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
    }
  };

  // Zoom to mouse cursor
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.1), 4.0);

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newX = mouseX - (mouseX - viewport.x) * (newZoom / viewport.zoom);
      const newY = mouseY - (mouseY - viewport.y) * (newZoom / viewport.zoom);

      setViewport({ x: newX, y: newY, zoom: newZoom });
    } else {
      setViewport((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY
      }));
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
          const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
          setPickerPos({ x: centerX - 140, y: centerY - 110 });
          setIsNotePickerOpen(true);
        }
        if (e.key.toLowerCase() === 'f') setActiveTool('frame');
        if (e.key.toLowerCase() === 'c') setActiveTool('arrow');
        if (e.key.toLowerCase() === 'r') setActiveTool('shape');
        if (e.key.toLowerCase() === 'i') fileAttachmentInputRef.current?.click();
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

      // Lock toggle (Ctrl+L)
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleLockSelected();
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
        if (toCopy.length > 0) clipboardRef.current = toCopy;
      }

      // Paste (Ctrl+V)
      if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboard();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedNodeIds, nodesList, isSpacePressed, viewport]);

  // Delete all currently selected nodes and edges
  const deleteSelected = () => {
    boardDoc.transact(() => {
      for (const id of selectedNodeIds) {
        const nodeMap = yNodes.get(id);
        if (nodeMap && !nodeMap.get('locked')) {
          nodeMap.set('deleted', true);
          nodeMap.set('deletedAt', Date.now());
        }
      }
      if (selectedEdgeId) {
        const edge = yEdges.get(selectedEdgeId);
        if (edge) yEdges.set(selectedEdgeId, { ...edge, deleted: true });
      }
    }, 'user');

    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
  };

  // Toggle lock state on selected nodes
  const toggleLockSelected = () => {
    boardDoc.transact(() => {
      for (const id of selectedNodeIds) {
        const nodeMap = yNodes.get(id);
        if (nodeMap) {
          const current = Boolean(nodeMap.get('locked'));
          nodeMap.set('locked', !current);
        }
      }
    }, 'user');
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
            x: src.x + 32,
            y: src.y + 32,
            text: src.text,
            locked: false
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
          y: src.y + 40,
          locked: false
        });
        newSelected.add(newId);
      }
    }, 'user');
    setSelectedNodeIds(newSelected);
  };

  // Create node and AUTO-RETURN to select tool
  const createNodeAt = (type: BoardNodeType, x: number, y: number, color = activeColor, initialText = '') => {
    const id = crypto.randomUUID();
    const nodeMap = new Y.Map();
    const isFrame = type === 'frame';
    const isNote = type === 'note';

    let defaultText = initialText;
    if (!defaultText) {
      if (isFrame) defaultText = 'Фрейм';
      else if (isNote) defaultText = 'Карточка заметки';
      else defaultText = type === 'text' ? 'Текст' : '';
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
        deleted: false,
        locked: false
      });
    }, 'user');

    // Auto-return to Select tool and focus new node
    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');

    setTimeout(() => {
      const el = document.getElementById(`node-textarea-${id}`) as HTMLTextAreaElement;
      el?.focus();
    }, 50);
  };

  // Create a note card linked to an existing note
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
        deleted: false,
        locked: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
  };

  // Upload attachment file and place block or image on board
  const handleUploadFileToBoard = async (file: File, x: number, y: number) => {
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/attachments?scope=${encodeURIComponent(currentScope.value)}`, {
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
          deleted: false,
          locked: false
        });
      }, 'user');

      setSelectedNodeIds(new Set([id]));
      setActiveTool('select');
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
        deleted: false,
        locked: false
      });

      // Auto-connect with arrow
      const edgeId = crypto.randomUUID();
      yEdges.set(edgeId, {
        id: edgeId,
        from: sourceNode.id,
        to: newId,
        fromSide: direction === 'right' ? 'right' : 'bottom',
        toSide: direction === 'right' ? 'left' : 'top',
        deleted: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([newId]));
    setActiveTool('select');

    setTimeout(() => {
      const el = document.getElementById(`node-textarea-${newId}`) as HTMLTextAreaElement;
      el?.focus();
    }, 50);
  };

  // Global Pointer Events
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      const pos = screenToCanvas(e.clientX, e.clientY);
      awareness.setLocalStateField('cursor', {
        x: pos.x,
        y: pos.y,
        name: agentStatus.value?.memberName || 'Соавтор',
        color: agentStatus.value?.memberColor || '#7c8cff'
      });

      // Panning
      if (panState) {
        setViewport((prev) => ({
          ...prev,
          x: panState.originX + (e.clientX - panState.startX),
          y: panState.originY + (e.clientY - panState.startY)
        }));
      }

      // Dragging nodes with Smart Alignment Guides & Grid snap
      if (dragState) {
        let dx = (e.clientX - dragState.startX) / viewport.zoom;
        let dy = (e.clientY - dragState.startY) / viewport.zoom;
        const GRID_SIZE = 16;
        const guides: AlignmentGuide[] = [];

        // Check alignment against other visible nodes (if single node dragged and not holding Alt)
        if (selectedNodeIds.size === 1 && !e.altKey) {
          const activeId = Array.from(selectedNodeIds)[0];
          const activeInitial = dragState.initialPositions.get(activeId);
          const activeNode = nodeLookup.get(activeId);

          if (activeInitial && activeNode) {
            let candidateX = activeInitial.x + dx;
            let candidateY = activeInitial.y + dy;
            const w = activeNode.w;
            const h = activeNode.h;

            for (const other of visibleNodes) {
              if (other.id === activeId || other.deleted) continue;

              // Check X alignments (left, center, right)
              const checkX = [
                { my: candidateX, other: other.x, snap: other.x },
                { my: candidateX + w / 2, other: other.x + other.w / 2, snap: other.x + other.w / 2 - w / 2 },
                { my: candidateX + w, other: other.x + other.w, snap: other.x + other.w - w }
              ];
              for (const c of checkX) {
                if (Math.abs(c.my - c.other) < 6) {
                  candidateX = c.snap;
                  dx = candidateX - activeInitial.x;
                  guides.push({ type: 'x', pos: c.other });
                  break;
                }
              }

              // Check Y alignments (top, center, bottom)
              const checkY = [
                { my: candidateY, other: other.y, snap: other.y },
                { my: candidateY + h / 2, other: other.y + other.h / 2, snap: other.y + other.h / 2 - h / 2 },
                { my: candidateY + h, other: other.y + other.h, snap: other.y + other.h - h }
              ];
              for (const c of checkY) {
                if (Math.abs(c.my - c.other) < 6) {
                  candidateY = c.snap;
                  dy = candidateY - activeInitial.y;
                  guides.push({ type: 'y', pos: c.other });
                  break;
                }
              }
            }
          }
        }
        setAlignmentGuides(guides);

        boardDoc.transact(() => {
          dragState.initialPositions.forEach((initialPos, id) => {
            const nodeMap = yNodes.get(id);
            if (nodeMap && !nodeMap.get('locked')) {
              let targetX = initialPos.x + dx;
              let targetY = initialPos.y + dy;

              if (guides.length === 0 && !e.altKey) {
                targetX = Math.round(targetX / GRID_SIZE) * GRID_SIZE;
                targetY = Math.round(targetY / GRID_SIZE) * GRID_SIZE;
              } else {
                targetX = Math.round(targetX);
                targetY = Math.round(targetY);
              }

              nodeMap.set('x', targetX);
              nodeMap.set('y', targetY);
            }
          });
        }, 'user');
      }

      // 8-Point Resizing
      if (resizeState) {
        const dx = (e.clientX - resizeState.startX) / viewport.zoom;
        const dy = (e.clientY - resizeState.startY) / viewport.zoom;
        const nodeMap = yNodes.get(resizeState.nodeId);

        if (nodeMap) {
          const { handle, startW, startH, startXPos, startYPos } = resizeState;
          let newW = startW;
          let newH = startH;
          let newX = startXPos;
          let newY = startYPos;

          if (handle.includes('e')) {
            newW = Math.max(80, Math.round(startW + dx));
          }
          if (handle.includes('w')) {
            newW = Math.max(80, Math.round(startW - dx));
            newX = startXPos + (startW - newW);
          }
          if (handle.includes('s')) {
            newH = Math.max(48, Math.round(startH + dy));
          }
          if (handle.includes('n')) {
            newH = Math.max(48, Math.round(startH - dy));
            newY = startYPos + (startH - newH);
          }

          nodeMap.set('x', Math.round(newX));
          nodeMap.set('y', Math.round(newY));
          nodeMap.set('w', Math.round(newW));
          nodeMap.set('h', Math.round(newH));
        }
      }

      // Marquee selection
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

      // Drag arrow connector
      if (connectingState) {
        setConnectingState((prev) => (prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null));
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      setPanState(null);
      setDragState(null);
      setResizeState(null);
      setAlignmentGuides([]);
      setMarqueeBox(null);

      if (connectingState) {
        // If dropped on empty canvas, open quick connect drop menu
        const pos = screenToCanvas(e.clientX, e.clientY);
        setQuickConnect({
          x: e.clientX,
          y: e.clientY,
          canvasX: pos.x,
          canvasY: pos.y,
          fromNodeId: connectingState.fromNodeId,
          fromSide: connectingState.fromSide || 'right'
        });
        setConnectingState(null);
      }
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('mousemove', handleGlobalPointerMove as any);
    window.addEventListener('mouseup', handleGlobalPointerUp as any);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('mousemove', handleGlobalPointerMove as any);
      window.removeEventListener('mouseup', handleGlobalPointerUp as any);
    };
  }, [panState, dragState, resizeState, marqueeBox, connectingState, viewport, nodesList, visibleNodes]);

  // Pointer down on canvas background
  const handleBackgroundPointerDown = (e: MouseEvent) => {
    setContextMenu(null);
    setQuickConnect(null);

    // Pan via Space + Left click, Middle click, Right click, or Hand tool
    if (isSpacePressed || e.button === 1 || e.button === 2 || activeTool === 'hand') {
      if (e.button !== 2) {
        setPanState({
          startX: e.clientX,
          startY: e.clientY,
          originX: viewport.x,
          originY: viewport.y
        });
        return;
      }
    }

    if (e.button === 0) {
      const pos = screenToCanvas(e.clientX, e.clientY);

      // Tool actions
      if (activeTool === 'sticky') {
        createNodeAt('sticky', pos.x - 100, pos.y - 65, activeColor);
        return;
      }
      if (activeTool === 'text') {
        createNodeAt('text', pos.x - 110, pos.y - 40);
        return;
      }
      if (activeTool === 'shape') {
        createNodeAt('shape', pos.x - 90, pos.y - 90);
        return;
      }
      if (activeTool === 'frame') {
        createNodeAt('frame', pos.x - 210, pos.y - 160);
        return;
      }

      // Marquee selection in select mode
      if (activeTool === 'select') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        setMarqueeBox({
          startX: pos.x,
          startY: pos.y,
          currentX: pos.x,
          currentY: pos.y
        });
      }
    }
  };

  // Pointer down on node: selection & Frame parenting
  const handleNodePointerDown = (node: BoardNodeData, e: MouseEvent | PointerEvent) => {
    if (e.button !== 0) return;
    if (dragState) return;
    e.stopPropagation();
    setContextMenu(null);
    setQuickConnect(null);

    if (activeTool === 'arrow') {
      const pos = screenToCanvas(e.clientX, e.clientY);
      setConnectingState({
        fromNodeId: node.id,
        fromSide: 'right',
        currentX: pos.x,
        currentY: pos.y
      });
      return;
    }

    // Placing node inside a frame container
    if (node.type === 'frame' && (activeTool === 'sticky' || activeTool === 'text' || activeTool === 'shape')) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      if (activeTool === 'sticky') createNodeAt('sticky', pos.x - 100, pos.y - 65, activeColor);
      else if (activeTool === 'text') createNodeAt('text', pos.x - 110, pos.y - 40);
      else if (activeTool === 'shape') createNodeAt('shape', pos.x - 90, pos.y - 90);
      return;
    }

    if (activeTool !== 'select') return;

    let newSelected: Set<string>;
    if (e.shiftKey) {
      newSelected = new Set(selectedNodeIds);
      if (newSelected.has(node.id)) newSelected.delete(node.id);
      else newSelected.add(node.id);
    } else {
      if (!selectedNodeIds.has(node.id)) {
        newSelected = new Set([node.id]);
      } else {
        newSelected = new Set(selectedNodeIds);
      }
    }
    setSelectedNodeIds(newSelected);
    setSelectedEdgeId(null);

    // If node is locked, do not initialize drag
    if (node.locked) return;

    // Initialize drag positions for all selected nodes + Frame parenting
    const initialPositions = new Map<string, { x: number; y: number }>();
    for (const id of newSelected) {
      const n = nodeLookup.get(id);
      if (n && !n.locked) {
        initialPositions.set(n.id, { x: n.x, y: n.y });

        // Frame Container Parenting: find all unlocked children inside frame bounds
        if (n.type === 'frame') {
          for (const child of nodesList) {
            if (child.id === n.id || child.locked) continue;
            const cx = child.x + child.w / 2;
            const cy = child.y + child.h / 2;
            if (cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) {
              initialPositions.set(child.id, { x: child.x, y: child.y });
            }
          }
        }
      }
    }

    setDragState({
      startX: e.clientX,
      startY: e.clientY,
      initialPositions
    });
  };

  // Magnetic port pointer handlers
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

  const handlePortPointerUp = (toNodeId: string, toSide: 'top' | 'right' | 'bottom' | 'left', e: MouseEvent) => {
    e.stopPropagation();
    if (connectingState && connectingState.fromNodeId !== toNodeId) {
      const edgeId = crypto.randomUUID();
      boardDoc.transact(() => {
        yEdges.set(edgeId, {
          id: edgeId,
          from: connectingState.fromNodeId,
          to: toNodeId,
          fromSide: connectingState.fromSide || 'right',
          toSide,
          deleted: false
        });
      }, 'user');
      setConnectingState(null);
    }
  };

  // Custom Context Menu handler
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const pos = screenToCanvas(e.clientX, e.clientY);
    const target = (e.target as HTMLElement).closest('.board-node-box') as HTMLElement;
    const nodeId = target ? target.getAttribute('data-node-id') || undefined : undefined;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
      nodeId
    });
  };

  // Toggle checkbox inside note card
  const toggleNoteCheckbox = (noteId: string, lineIndex: number) => {
    const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, noteId));
    const yText = noteDoc.getText('text');
    const content = yText.toString();
    const lines = content.split('\n');

    if (lines[lineIndex]) {
      const current = lines[lineIndex];
      if (current.includes('- [ ]')) {
        lines[lineIndex] = current.replace('- [ ]', '- [x]');
      } else if (current.includes('- [x]')) {
        lines[lineIndex] = current.replace('- [x]', '- [ ]');
      }
      applyTextDelta(yText, lines.join('\n'));
    }
  };

  // Compute selection bounding box for floating inspector pill
  const selectionBounds = useMemo(() => {
    if (selectedNodeIds.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const id of selectedNodeIds) {
      const n = nodeLookup.get(id);
      if (n) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      }
    }

    if (minX === Infinity) return null;
    return {
      x: minX * viewport.zoom + viewport.x,
      y: minY * viewport.zoom + viewport.y,
      width: (maxX - minX) * viewport.zoom,
      height: (maxY - minY) * viewport.zoom
    };
  }, [selectedNodeIds, nodeLookup, viewport]);

  return (
    <div
      class={`board-container ${activeTool === 'hand' || isSpacePressed ? 'cursor-grab' : ''}`}
      ref={containerRef}
      onWheel={(e) => handleWheel(e as any)}
      onMouseDown={handleBackgroundPointerDown}
      onContextMenu={handleContextMenu}
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
        const pos = screenToCanvas(e.clientX, e.clientY);
        const noteId = e.dataTransfer?.getData('application/doks-note-id');
        if (noteId) {
          createNoteCardAt(noteId, pos.x, pos.y);
          return;
        }

        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            await handleUploadFileToBoard(e.dataTransfer.files[i], pos.x + i * 20, pos.y + i * 20);
          }
        }
      }}
    >
      {/* 1. Miro-level Floating Toolbox */}
      <div class="board-toolbox liquid-glass-surface" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div class="toolbox-group">
          <button
            class={`tb-btn ${activeTool === 'select' ? 'active' : ''}`}
            data-tool="select"
            onClick={() => setActiveTool('select')}
            title="Выбор и перемещение (V)"
          >
            <Icon name="select" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'hand' ? 'active' : ''}`}
            data-tool="hand"
            onClick={() => setActiveTool('hand')}
            title="Панорамирование (H / Space)"
          >
            <Icon name="hand" size={17} />
          </button>
        </div>

        <div class="toolbox-divider" />

        <div class="toolbox-group">
          <button
            class={`tb-btn ${activeTool === 'sticky' ? 'active' : ''}`}
            data-tool="sticky"
            onClick={() => setActiveTool('sticky')}
            title="Стикер (S)"
          >
            <Icon name="sticky" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'text' ? 'active' : ''}`}
            data-tool="text"
            onClick={() => setActiveTool('text')}
            title="Текст (T)"
          >
            <Icon name="text" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'note' ? 'active' : ''}`}
            data-tool="note"
            onClick={() => {
              const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
              const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
              setPickerPos({ x: centerX - 150, y: centerY - 120 });
              setIsNotePickerOpen(true);
            }}
            title="Карточка заметки (N)"
          >
            <Icon name="note-card" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'frame' ? 'active' : ''}`}
            data-tool="frame"
            onClick={() => setActiveTool('frame')}
            title="Фрейм / Контейнер (F)"
          >
            <Icon name="frame" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'arrow' ? 'active' : ''}`}
            data-tool="arrow"
            onClick={() => setActiveTool('arrow')}
            title="Связующая стрелка (C)"
          >
            <Icon name="arrow" size={17} />
          </button>
          <button
            class={`tb-btn ${activeTool === 'shape' ? 'active' : ''}`}
            data-tool="shape"
            onClick={() => setActiveTool('shape')}
            title="Фигура (R)"
          >
            <Icon name="shape" size={17} />
          </button>
          <button
            class="tb-btn"
            onClick={() => fileAttachmentInputRef.current?.click()}
            title="Прикрепить файл (I)"
          >
            <Icon name="attachment" size={17} />
          </button>
          <input
            type="file"
            ref={fileAttachmentInputRef}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                handleUploadFileToBoard(file, centerX - 100, centerY - 80);
              }
            }}
          />
        </div>

        <div class="toolbox-divider" />

        {/* Cross-scope promotion bridge & AI Export */}
        <div class="toolbox-group">
          <button
            class="tb-btn promote-btn"
            data-testid="scope-transfer-btn"
            onClick={() => handleOpenTransferModal()}
            title={
              currentScope.value === 'solo'
                ? 'Опубликовать выбранное в Команду (P2P меш)'
                : 'Склонировать выбранное в Соло (Личное)'
            }
          >
            <Icon name={currentScope.value === 'solo' ? 'promote' : 'fork'} size={17} />
          </button>
          <button
            class="tb-btn"
            data-testid="ai-export-btn"
            onClick={() => setShowAiModal(true)}
            title="Экспорт для ИИ (AI Context)"
          >
            <Icon name="sparkles" size={17} />
          </button>
        </div>
      </div>

      {/* 2. Floating Context Inspector Bar */}
      {selectionBounds && selectedNodeIds.size > 0 && (
        <div
          class="floating-inspector-bar liquid-glass-surface"
          style={{
            left: `${selectionBounds.x + selectionBounds.width / 2}px`,
            top: `${selectionBounds.y - 12}px`,
            transform: 'translate(-50%, -100%)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Color Palette (8 colors) */}
          <div class="inspector-palette">
            {Object.entries(CANVAS_COLORS).filter(([k]) => k !== 'default').map(([key, hex]) => (
              <button
                key={key}
                class={`palette-swatch ${activeColor === key ? 'active' : ''}`}
                style={{ backgroundColor: hex }}
                onClick={() => {
                  setActiveColor(key);
                  boardDoc.transact(() => {
                    for (const id of selectedNodeIds) {
                      const map = yNodes.get(id);
                      if (map) map.set('color', key);
                    }
                  }, 'user');
                }}
              />
            ))}
          </div>

          <div class="inspector-divider" />

          {/* Note Card: Open in Split View */}
          {(() => {
            const firstId = Array.from(selectedNodeIds)[0];
            const node = nodeLookup.get(firstId);
            if (node?.type === 'note' && node.noteId) {
              return (
                <button
                  class="inspector-btn"
                  title="Открыть в режиме сплит-экрана рядом (Ctrl+\)"
                  onClick={() => {
                    ensureSplitTabs();
                    openTab('note', node.noteId!, node.text || 'Заметка');
                  }}
                >
                  <Icon name="layout-split" size={15} />
                  <span>Открыть рядом</span>
                </button>
              );
            }
            return null;
          })()}

          {/* Lock / Unlock */}
          <button
            class="inspector-btn"
            title="Заблокировать / разблокировать (Ctrl+L)"
            onClick={toggleLockSelected}
          >
            <Icon name="lock" size={15} />
          </button>

          {/* Duplicate */}
          <button
            class="inspector-btn"
            title="Дублировать (Ctrl+D)"
            onClick={duplicateSelected}
          >
            <Icon name="copy" size={15} />
          </button>

          {/* Promote / Fork bridge */}
          <button
            class="inspector-btn"
            title={currentScope.value === 'solo' ? 'Опубликовать в Команду' : 'Склонировать в Соло'}
            onClick={() => handleOpenTransferModal()}
          >
            <Icon name={currentScope.value === 'solo' ? 'promote' : 'fork'} size={15} />
          </button>

          {/* Delete */}
          <button
            class="inspector-btn danger"
            title="Удалить (Delete)"
            onClick={deleteSelected}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}

      {/* 3. Edge Inspector Pill */}
      {selectedEdgeId && (
        (() => {
          const edge = edgesList.find((e) => e.id === selectedEdgeId);
          if (!edge) return null;
          const fromNode = nodeLookup.get(edge.from);
          const toNode = nodeLookup.get(edge.to);
          if (!fromNode || !toNode) return null;

          const p1 = getPortCoord(fromNode, edge.fromSide);
          const p2 = getPortCoord(toNode, edge.toSide);
          const midX = ((p1.x + p2.x) / 2) * viewport.zoom + viewport.x;
          const midY = ((p1.y + p2.y) / 2) * viewport.zoom + viewport.y;

          return (
            <div
              class="floating-edge-pill liquid-glass-surface"
              style={{
                left: `${midX}px`,
                top: `${midY - 24}px`,
                transform: 'translate(-50%, -100%)'
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                class="edge-label-input"
                placeholder="Подпись стрелки..."
                value={edge.label || ''}
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  const edgeMap = yEdges.get(edge.id);
                  if (edgeMap) yEdges.set(edge.id, { ...edgeMap, label: val });
                }}
              />
              <button
                class="inspector-btn danger"
                title="Удалить стрелку (Delete)"
                onClick={() => {
                  const edgeMap = yEdges.get(edge.id);
                  if (edgeMap) yEdges.set(edge.id, { ...edgeMap, deleted: true });
                  setSelectedEdgeId(null);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          );
        })()
      )}

      {/* 4. Canvas Viewport Controls */}
      <div class="canvas-viewport-controls liquid-glass-surface" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button
          class="zoom-btn"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(v.zoom * 1.2, 4.0) }))}
          title="Приблизить"
        >
          <Icon name="zoom-in" size={15} />
        </button>
        <button
          class="zoom-btn"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(v.zoom * 0.8, 0.1) }))}
          title="Отдалить"
        >
          <Icon name="zoom-out" size={15} />
        </button>
        <button
          class="zoom-btn"
          onClick={() => setViewport({ x: 80, y: 80, zoom: 1 })}
          title="Сбросить масштаб (100%)"
        >
          1:1
        </button>
        {nodesList.length === 0 && (
          <button
            class="template-seed-btn"
            onClick={() => seedDefaultBoard(boardDoc, agentStatus.value?.memberName || 'Вы')}
            title="Заполнить шаблоном задач"
          >
            <Icon name="plus" size={14} />
            <span>Шаблон</span>
          </button>
        )}
      </div>

      {/* 5. Infinite Scaled Layer */}
      <div
        class="board-transform-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {/* SVG Connections, Arrows & Snap Lines */}
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent, #38bdf8)" />
            </marker>
          </defs>

          {/* Alignment snap lines */}
          {alignmentGuides.map((g, i) => (
            g.type === 'x' ? (
              <line
                key={`gx-${i}`}
                x1={g.pos}
                y1={-10000}
                x2={g.pos}
                y2={10000}
                stroke="#38bdf8"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            ) : (
              <line
                key={`gy-${i}`}
                x1={-10000}
                y1={g.pos}
                x2={10000}
                y2={g.pos}
                stroke="#38bdf8"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            )
          ))}

          {/* Render established edges */}
          {edgesList.map((edge) => {
            const fromNode = nodeLookup.get(edge.from);
            const toNode = nodeLookup.get(edge.to);
            if (!fromNode || !toNode) return null;

            const p1 = getPortCoord(fromNode, edge.fromSide);
            const p2 = getPortCoord(toNode, edge.toSide);

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
                  stroke={isSelected ? 'var(--accent, #38bdf8)' : 'rgba(255, 255, 255, 0.4)'}
                  stroke-width={isSelected ? 3 : 2}
                  fill="none"
                  marker-end="url(#arrow-marker)"
                />
                {edge.label && (
                  <text x={midX} y={midY - 8} class="edge-text-label" text-anchor="middle">
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
                  stroke="var(--accent, #38bdf8)"
                  stroke-width="2.5"
                  stroke-dasharray="4 4"
                  marker-end="url(#arrow-marker)"
                />
              );
            })()
          )}
        </svg>

        {/* Nodes Layer */}
        {visibleNodes.map((node) => {
          const isSelected = selectedNodeIds.has(node.id);
          const nodeColorHex = CANVAS_COLORS[node.color || ''] || CANVAS_COLORS.default;
          const isFrame = node.type === 'frame';
          const isNote = node.type === 'note';

          return (
            <div
              key={node.id}
              data-node-id={node.id}
              class={`board-node-box type-${node.type} ${isSelected ? 'selected' : ''} ${node.locked ? 'locked' : ''}`}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.w}px`,
                height: `${node.h}px`,
                borderColor: isFrame ? 'rgba(255, 255, 255, 0.15)' : nodeColorHex,
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
                  {node.author || (isFrame ? 'Фрейм' : 'Стикер')}
                </span>
                {node.locked && (
                  <span class="node-lock-badge" title="Заблокировано">
                    <Icon name="lock" size={11} />
                  </span>
                )}
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
                    <Icon name="file-text" size={12} />
                    <span>Открыть</span>
                  </button>
                )}
              </div>

              {/* Node Content */}
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
                            class="btn-secondary-sm"
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

                  const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, node.noteId!));
                  const noteYText = noteDoc.getText('text');
                  const noteContent = noteYText.toString();

                  // Render live interactive markdown preview with clickable checkboxes
                  return (
                    <div
                      class="note-card-content-view scrollable-card-content"
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <div class="note-card-header-title">
                        {noteMeta?.title || 'Без названия'}
                      </div>
                      <div class="note-card-body-preview">
                        {noteContent.split('\n').map((line, lineIdx) => {
                          const isCheckbox = line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]');
                          if (isCheckbox) {
                            const isChecked = line.trim().startsWith('- [x]');
                            const labelText = line.replace(/^-\s*\[( |x)\]\s*/, '');
                            return (
                              <div key={lineIdx} class="note-checkbox-line">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleNoteCheckbox(node.noteId!, lineIdx)}
                                />
                                <span>{labelText}</span>
                              </div>
                            );
                          }
                          return <div key={lineIdx} class="note-preview-line">{line || '\u00A0'}</div>;
                        })}
                      </div>
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
                      <Icon name="attachment" size={24} />
                      <span class="node-file-label" title={node.fileName || node.text}>
                        {node.fileName || node.text}
                      </span>
                      <a
                        href={`/api/attachments/${node.fileHash}`}
                        download={node.fileName || 'file'}
                        class="btn-secondary-sm"
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
                  onWheel={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedNodeIds(new Set([node.id]));
                  }}
                  onFocus={() => setSelectedNodeIds(new Set([node.id]))}
                  onInput={(e) => {
                    const map = yNodes.get(node.id);
                    if (map) {
                      setNodeProperties(map, { text: (e.target as HTMLTextAreaElement).value });
                    }
                  }}
                  onKeyDown={(e) => {
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

              {/* 8-Point Resize Handles (nw, n, ne, e, se, s, sw, w) */}
              {isSelected && !node.locked && (
                <div class="node-resize-handles-layer">
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]).map((handle) => (
                    <div
                      key={handle}
                      class={`resize-handle handle-${handle}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setResizeState({
                          nodeId: node.id,
                          handle,
                          startX: e.clientX,
                          startY: e.clientY,
                          startW: node.w,
                          startH: node.h,
                          startXPos: node.x,
                          startYPos: node.y
                        });
                      }}
                    />
                  ))}
                </div>
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

      {/* Quick Connect Drop Mini-Menu on Empty Space */}
      {quickConnect && (
        <div
          class="quick-connect-menu liquid-glass-surface"
          style={{ left: `${quickConnect.x}px`, top: `${quickConnect.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="quick-connect-header">Создать и соединить:</div>
          <button
            class="quick-connect-btn"
            onClick={() => {
              const newId = crypto.randomUUID();
              const nodeMap = new Y.Map();
              boardDoc.transact(() => {
                yNodes.set(newId, nodeMap);
                setNodeProperties(nodeMap, {
                  id: newId,
                  type: 'sticky',
                  x: Math.round(quickConnect.canvasX),
                  y: Math.round(quickConnect.canvasY),
                  w: 200,
                  h: 130,
                  text: '',
                  color: activeColor,
                  author: agentStatus.value?.memberName || 'Вы',
                  done: false,
                  z: 1,
                  deleted: false,
                  locked: false
                });
                const edgeId = crypto.randomUUID();
                yEdges.set(edgeId, {
                  id: edgeId,
                  from: quickConnect.fromNodeId,
                  to: newId,
                  fromSide: quickConnect.fromSide,
                  toSide: 'left',
                  deleted: false
                });
              }, 'user');
              setSelectedNodeIds(new Set([newId]));
              setActiveTool('select');
              setQuickConnect(null);
            }}
          >
            <Icon name="sticky" size={14} />
            <span>Стикер</span>
          </button>
          <button
            class="quick-connect-btn"
            onClick={() => {
              setPickerPos({ x: quickConnect.canvasX, y: quickConnect.canvasY });
              setIsNotePickerOpen(true);
              setQuickConnect(null);
            }}
          >
            <Icon name="note-card" size={14} />
            <span>Заметка</span>
          </button>
          <button
            class="quick-connect-btn"
            onClick={() => {
              createNodeAt('text', quickConnect.canvasX, quickConnect.canvasY);
              setQuickConnect(null);
            }}
          >
            <Icon name="text" size={14} />
            <span>Текст</span>
          </button>
        </div>
      )}

      {/* Custom Right-Click Context Menu */}
      {contextMenu && (
        <div
          class="canvas-context-menu liquid-glass-surface"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            class="context-menu-item"
            onClick={() => {
              createNodeAt('sticky', contextMenu.canvasX, contextMenu.canvasY);
              setContextMenu(null);
            }}
          >
            <Icon name="sticky" size={14} />
            <span>Создать стикер здесь</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              setPickerPos({ x: contextMenu.canvasX, y: contextMenu.canvasY });
              setIsNotePickerOpen(true);
              setContextMenu(null);
            }}
          >
            <Icon name="note-card" size={14} />
            <span>Создать заметку</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              pasteClipboard();
              setContextMenu(null);
            }}
          >
            <Icon name="copy" size={14} />
            <span>Вставить из буфера</span>
          </div>
          <div class="context-menu-divider" />
          <div
            class="context-menu-item"
            onClick={() => {
              const allIds = new Set(nodesList.filter((n) => !n.deleted).map((n) => n.id));
              setSelectedNodeIds(allIds);
              setContextMenu(null);
            }}
          >
            <Icon name="select" size={14} />
            <span>Выделить всё</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              setShowAiModal(true);
              setContextMenu(null);
            }}
          >
            <Icon name="cpu" size={14} />
            <span>Экспортировать для ИИ</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              handleOpenTransferModal();
              setContextMenu(null);
            }}
          >
            <Icon name={currentScope.value === 'solo' ? 'promote' : 'fork'} size={14} />
            <span>{currentScope.value === 'solo' ? 'Опубликовать в Команду' : 'Склонировать в Соло'}</span>
          </div>
          {contextMenu.nodeId && (
            <>
              <div class="context-menu-divider" />
              <div
                class="context-menu-item danger"
                onClick={() => {
                  deleteSelected();
                  setContextMenu(null);
                }}
              >
                <Icon name="trash" size={14} />
                <span>Удалить</span>
              </div>
            </>
          )}
        </div>
      )}

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

      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        fromScope={currentScope.value}
        boardId={boardId}
        nodeIds={transferNodeIds}
      />

      {/* Minimap */}
      <BoardMinimap
        nodes={nodesList}
        viewport={viewport}
        containerWidth={containerSize.width}
        containerHeight={containerSize.height}
        onNavigate={(newX, newY) => {
          setViewport((prev) => ({ ...prev, x: newX, y: newY }));
        }}
      />
    </div>
  );
}

export default BoardCanvas;
