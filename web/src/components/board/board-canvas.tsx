import { h, Fragment, VNode } from 'preact';
import { useEffect, useRef, useState, useMemo, useCallback } from 'preact/hooks';
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
  boards,
  createBoard,
  deleteBoard,
  renameBoard,
  setScope,
  maps,
  restoreNote,
  createNote,
  currentScope,
  ensureSplitTabs,
  isSplitView,
  workspaceMode,
  setWorkspaceMode,
  isCommandPaletteOpen
} from '../../state/app-state.js';
import { NoteEditor } from '../notes/editor.js';
import { NetworkPopover } from '../layout/network-popover.js';
import { CanvasEdgesLayer, type CanvasEdgeModel } from '../CanvasEdgesLayer.js';
import { useCanvasDropZone } from '../../hooks/useCanvasDropZone.js';
import { seedDefaultBoard } from './board-seed.js';
import { Icon, type IconName } from '../Icons.js';
import { AiExportModal } from './ai-export-modal.js';
import { NotePickerModal } from './note-picker-modal.js';
import { BoardMinimap } from './board-minimap.js';
import { TransferModal } from './transfer-modal.js';
import { AutoDiagramModal } from './auto-diagram-modal.js';
import { pointsToSmoothSvgPath, computeBoundingBox, type Point } from '../../utils/strokeSmoother.js';
import { computeAutoLayout, type GeneratedDiagramNode, type GeneratedDiagramEdge } from '../../utils/diagramGenerator.js';
import { t } from '../../i18n/index.js';
import { showConfirm } from '../../ui/dialogs.js';
import { showToast } from '../../ui/toast.js';
import {
  findMagneticTargetPort,
  buildBezierEdgePath,
  buildEdgeSvgPath,
  getEdgeMidpoint,
  getPortCoordinates,
  type PortSide,
  type BoxNode
} from '../../utils/connectorGeometry.js';
import {
  matchShortcut,
  isEditableElementFocused,
  CANVAS_UNDO_ORIGIN
} from '../../utils/hotkeysAndUndo.js';

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#d97706', // Warm Amber
  '2': '#3b82f6', // Slate Blue
  '3': '#10b981', // Mint Emerald
  '4': '#f43f5e', // Rose Coral
  '5': '#8b5cf6', // Violet
  '6': '#4b5563', // Graphite
  default: '#d97706'
};

export type CanvasTool = 'select' | 'hand' | 'sticky' | 'text' | 'note' | 'frame' | 'arrow' | 'shape' | 'draw' | 'eraser';
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
  const [isAutoDiagramModalOpen, setIsAutoDiagramModalOpen] = useState(false);
  const [activeColor, setActiveColor] = useState<string>('3');

  // Freehand drawing state
  const [drawMode, setDrawMode] = useState<'pen' | 'brush' | 'highlighter'>('pen');
  const [drawWidth, setDrawWidth] = useState<number>(3);
  const [drawColor, setDrawColor] = useState<string>('#818cf8');
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const currentStrokeRef = useRef<Point[] | null>(null);
  currentStrokeRef.current = currentStroke;

  // Document inline reader expanded state per node
  const [previewDocIds, setPreviewDocIds] = useState<Set<string>>(new Set());

  // Miro Floating Dock & Islands state
  const [activeFlyout, setActiveFlyout] = useState<'none' | 'sticky' | 'shape' | 'arrow' | 'draw'>('none');
  const [isBoardsPopoverOpen, setIsBoardsPopoverOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isNotesDrawerOpen, setIsNotesDrawerOpen] = useState(false);
  const [selectedDrawerNoteId, setSelectedDrawerNoteId] = useState<string | null>(null);
  const [isNetworkPopoverOpen, setIsNetworkPopoverOpen] = useState(false);
  const [selectedShapeVariant, setSelectedShapeVariant] = useState<'rectangle' | 'rounded' | 'circle' | 'diamond' | 'parallelogram' | 'cylinder'>('rectangle');
  const [defaultLineStyle, setDefaultLineStyle] = useState<{ curveType: 'bezier' | 'orthogonal' | 'straight'; style: 'solid' | 'dashed'; color: string }>({
    curveType: 'bezier',
    style: 'solid',
    color: '#818cf8'
  });

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
    fromSide: PortSide;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    snappedTarget: { nodeId: string; side: PortSide; point: { x: number; y: number } } | null;
  } | null>(null);

  const connectingStateRef = useRef(connectingState);
  connectingStateRef.current = connectingState;

  // Bottom-right minimap toggle
  const [showMinimap, setShowMinimap] = useState(false);

  // Quick connect drop menu on empty canvas
  const [quickConnect, setQuickConnect] = useState<QuickConnectState | null>(null);

  // Custom Context Menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Remote cursors awareness
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  // Internal clipboard for copy/paste (nodes + connecting edges)
  const clipboardRef = useRef<{ nodes: BoardNodeData[]; edges: BoardEdgeData[] }>({ nodes: [], edges: [] });

  // Real-time ghost preview card for drag-and-drop
  const [ghostDropPreview, setGhostDropPreview] = useState<{ x: number; y: number; title: string } | null>(null);

  // Exact cursor canvas coordinates for paste
  const lastMouseCanvasPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dynamic edge reconnection dragging state
  const [reconnectEdgeState, setReconnectEdgeState] = useState<{
    edgeId: string;
    which: 'from' | 'to';
    startPoint: { x: number; y: number };
    currentX: number;
    currentY: number;
    snappedTarget: { nodeId: string; side: PortSide; point: { x: number; y: number } } | null;
  } | null>(null);
  const reconnectEdgeStateRef = useRef(reconnectEdgeState);
  reconnectEdgeStateRef.current = reconnectEdgeState;

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

  const currentBoardMeta = useMemo(() => {
    return boards.value.find((b) => b.id === boardId);
  }, [boards.value, boardId]);

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
      trackedOrigins: new Set([null, undefined, 'user', CANVAS_UNDO_ORIGIN]),
      captureTimeout: 400
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

  // Auto-fetch extracted text for document cards missing text
  useEffect(() => {
    for (const node of nodesList) {
      if (
        node.fileHash &&
        !node.extractedText &&
        (node.fileName || '').match(/\.(docx|txt|md|csv|json|js|ts|py|html|css)$/i)
      ) {
        fetch(`/api/attachments/${node.fileHash}/content`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.extractedText) {
              const map = yNodes.get(node.id);
              if (map && !map.get('extractedText')) {
                boardDoc.transact(() => {
                  map.set('extractedText', data.extractedText);
                  if (map.get('showPreview') === undefined) {
                    map.set('showPreview', true);
                  }
                }, CANVAS_UNDO_ORIGIN);
              }
            }
          })
          .catch(() => {});
      }
    }
  }, [nodesList, yNodes, boardDoc]);

  // Coordinate transformation helpers
  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - viewport.x) / viewport.zoom;
    const y = (clientY - rect.top - viewport.y) / viewport.zoom;
    return { x, y };
  };

  const getPortCoord = (node: BoardNodeData, side?: PortSide) => {
    return getPortCoordinates({ id: node.id, x: node.x, y: node.y, width: node.w, height: node.h }, side || 'right');
  };

  const nodesBoxMap = useMemo(() => {
    const map = new Map<string, { id: string; x: number; y: number; width: number; height: number }>();
    for (const n of visibleNodes) {
      map.set(n.id, { id: n.id, x: n.x, y: n.y, width: n.w, height: n.h });
    }
    return map;
  }, [visibleNodes]);

  const canvasEdges: CanvasEdgeModel[] = useMemo(() => {
    return edgesList.map((e) => ({
      id: e.id,
      fromNode: e.from,
      fromSide: e.fromSide,
      toNode: e.to,
      toSide: e.toSide,
      color: e.color,
      curveType: e.curveType,
      style: e.style,
      thickness: e.thickness,
      direction: e.direction,
      label: e.label
    }));
  }, [edgesList]);

  const handleUpdateEdge = useCallback((edgeId: string, patch: Partial<CanvasEdgeModel>) => {
    const existing = yEdges.get(edgeId);
    if (existing) {
      boardDoc.transact(() => {
        yEdges.set(edgeId, {
          ...existing,
          ...patch,
          from: patch.fromNode || existing.from,
          to: patch.toNode || existing.to
        });
      }, CANVAS_UNDO_ORIGIN);
    }
  }, [yEdges, boardDoc]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    const existing = yEdges.get(edgeId);
    if (existing) {
      boardDoc.transact(() => {
        yEdges.set(edgeId, { ...existing, deleted: true, deletedAt: Date.now() });
      }, CANVAS_UNDO_ORIGIN);
      setSelectedEdgeId(null);
    }
  }, [yEdges, boardDoc]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      return screenToCanvas(clientX, clientY);
    },
    [viewport]
  );

  const onCreateNoteAndCard = useCallback(
    async (title: string, markdown: string, x: number, y: number) => {
      const noteId = createNote(title, null);
      const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, noteId));
      const yText = noteDoc.getText('text');
      if (yText.length === 0 && markdown) {
        yText.insert(0, markdown);
      }
      createNoteCardAt(noteId, x, y);
      showToast(`Создана заметка "${title}"`);
    },
    [currentScope.value, viewport]
  );

  const onLinkExistingNoteToCanvas = useCallback(
    (noteId: string, x: number, y: number) => {
      createNoteCardAt(noteId, x, y);
    },
    [viewport]
  );

  const onUploadAndCreateMediaCard = useCallback(
    async (file: File, x: number, y: number, previewUrl?: string) => {
      await handleUploadFileToBoard(file, x, y);
    },
    [viewport]
  );

  const { dropGhost, handleDragOver, handleDragLeave, handleDrop } = useCanvasDropZone({
    screenToWorld,
    onCreateNoteAndCard,
    onLinkExistingNoteToCanvas,
    onUploadAndCreateMediaCard
  });

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

  // Keyboard shortcuts (Physical keycode layout-independent)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableElementFocused()) return;

      // Spacebar for Pan
      if (e.code === 'Space' && !isSpacePressed) {
        setIsSpacePressed(true);
      }

      // Save (Ctrl+S) - prevent browser Save Page dialog
      if (matchShortcut(e, 'mod+s')) {
        e.preventDefault();
        showToast(currentScope.value === 'solo' ? 'Все изменения сохранены локально' : 'Синхронизировано в P2P-сети', 'success');
        return;
      }

      // Command palette (Ctrl+P / Ctrl+K) - prevent browser Print dialog
      if (matchShortcut(e, 'mod+p') || matchShortcut(e, 'mod+k')) {
        e.preventDefault();
        isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
        return;
      }

      // Undo / Redo
      if (matchShortcut(e, 'mod+z')) {
        e.preventDefault();
        undoManagerRef.current?.undo();
        return;
      }
      if (matchShortcut(e, 'mod+shift+z') || matchShortcut(e, 'mod+y')) {
        e.preventDefault();
        undoManagerRef.current?.redo();
        return;
      }

      // Select All (Ctrl+A)
      if (matchShortcut(e, 'mod+a')) {
        e.preventDefault();
        const nonDeletedIds = nodesList.filter((n) => !n.deleted).map((n) => n.id);
        setSelectedNodeIds(new Set(nonDeletedIds));
        setSelectedEdgeId(null);
        return;
      }

      // Copy (Ctrl+C)
      if (matchShortcut(e, 'mod+c')) {
        e.preventDefault();
        copySelected();
        return;
      }

      // Paste (Ctrl+V)
      if (matchShortcut(e, 'mod+v')) {
        e.preventDefault();
        const targetPos = lastMouseCanvasPosRef.current;
        pasteClipboard(targetPos.x, targetPos.y);
        return;
      }

      // Duplicate (Ctrl+D)
      if (matchShortcut(e, 'mod+d')) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      // Wrap in Frame (Ctrl+G)
      if (matchShortcut(e, 'mod+g')) {
        e.preventDefault();
        wrapSelectedInFrame();
        return;
      }

      // Lock toggle (Ctrl+L)
      if (matchShortcut(e, 'mod+l')) {
        e.preventDefault();
        toggleLockSelected();
        return;
      }

      // AI Context Export (Ctrl+Shift+E)
      if (matchShortcut(e, 'mod+shift+e')) {
        e.preventDefault();
        setShowAiModal(true);
        return;
      }

      // Delete selected
      if (matchShortcut(e, 'delete') || matchShortcut(e, 'backspace')) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Tool switches using physical hardware e.code
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.code === 'KeyV' || e.code === 'KeyS') setActiveTool('select');
        if (e.code === 'KeyH') setActiveTool('hand');
        if (e.code === 'KeyT') setActiveTool('text');
        if (e.code === 'KeyP') setActiveTool('draw');
        if (e.code === 'KeyE') setActiveTool('eraser');
        if (e.code === 'KeyN') {
          const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
          const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
          setPickerPos({ x: centerX - 140, y: centerY - 110 });
          setIsNotePickerOpen(true);
        }
        if (e.code === 'KeyF') setActiveTool('frame');
        if (e.code === 'KeyC' || e.code === 'KeyL') setActiveTool('arrow');
        if (e.code === 'KeyR') setActiveTool('shape');
        if (e.code === 'KeyI') fileAttachmentInputRef.current?.click();

        // Mindmap Quick-Branching (Tab on selected node)
        if (e.code === 'Tab' && selectedNodeIds.size === 1) {
          const activeTag = (document.activeElement?.tagName || '').toLowerCase();
          if (activeTag !== 'textarea' && activeTag !== 'input') {
            e.preventDefault();
            const selectedId = Array.from(selectedNodeIds)[0];
            const srcNode = nodeLookup.get(selectedId);
            if (srcNode) {
              chainNextSticky(srcNode, 'right');
            }
            return;
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
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

  // Copy selected nodes and connected edges
  const copySelected = () => {
    const selectedNodes = nodesList.filter((n) => selectedNodeIds.has(n.id) && !n.deleted);
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const connectedEdges = edgesList.filter(
      (e) => !e.deleted && selectedIds.has(e.from) && selectedIds.has(e.to)
    );
    clipboardRef.current = {
      nodes: selectedNodes,
      edges: connectedEdges
    };
    showToast(`Скопировано: ${selectedNodes.length} эл.`);
  };

  // Duplicate selected nodes with offset and duplicate connecting edges
  const duplicateSelected = () => {
    if (selectedNodeIds.size === 0) return;
    const toDup = nodesList.filter((n) => selectedNodeIds.has(n.id) && !n.deleted);
    const selectedIds = new Set(toDup.map((n) => n.id));
    const connectedEdges = edgesList.filter(
      (e) => !e.deleted && selectedIds.has(e.from) && selectedIds.has(e.to)
    );

    const idMap = new Map<string, string>();
    const newSelected = new Set<string>();

    boardDoc.transact(() => {
      for (const src of toDup) {
        const newId = crypto.randomUUID();
        idMap.set(src.id, newId);
        const newMap = new Y.Map();
        yNodes.set(newId, newMap);
        setNodeProperties(newMap, {
          ...src,
          id: newId,
          x: src.x + 28,
          y: src.y + 28,
          locked: false
        });
        newSelected.add(newId);
      }

      for (const edge of connectedEdges) {
        const fromId = idMap.get(edge.from);
        const toId = idMap.get(edge.to);
        if (fromId && toId) {
          const newEdgeId = crypto.randomUUID();
          yEdges.set(newEdgeId, {
            ...edge,
            id: newEdgeId,
            from: fromId,
            to: toId
          });
        }
      }
    }, CANVAS_UNDO_ORIGIN);

    setSelectedNodeIds(newSelected);
  };

  // Paste clipboard items with cursor coordinates or default offset
  const pasteClipboard = (targetWorldX?: number, targetWorldY?: number) => {
    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current;
    if (clipNodes.length === 0) return;

    let offsetX = 28;
    let offsetY = 28;

    if (targetWorldX !== undefined && targetWorldY !== undefined && targetWorldX !== 0 && targetWorldY !== 0) {
      const minX = Math.min(...clipNodes.map((n) => n.x));
      const minY = Math.min(...clipNodes.map((n) => n.y));
      offsetX = targetWorldX - minX;
      offsetY = targetWorldY - minY;
    }

    const idMap = new Map<string, string>();
    const newSelected = new Set<string>();

    boardDoc.transact(() => {
      for (const src of clipNodes) {
        const newId = crypto.randomUUID();
        idMap.set(src.id, newId);
        const newMap = new Y.Map();
        yNodes.set(newId, newMap);
        setNodeProperties(newMap, {
          ...src,
          id: newId,
          x: Math.round(src.x + offsetX),
          y: Math.round(src.y + offsetY),
          locked: false
        });
        newSelected.add(newId);
      }

      for (const edge of clipEdges) {
        const fromId = idMap.get(edge.from);
        const toId = idMap.get(edge.to);
        if (fromId && toId) {
          const newEdgeId = crypto.randomUUID();
          yEdges.set(newEdgeId, {
            ...edge,
            id: newEdgeId,
            from: fromId,
            to: toId
          });
        }
      }
    }, CANVAS_UNDO_ORIGIN);

    setSelectedNodeIds(newSelected);
    setSelectedEdgeId(null);
  };

  // Wrap selected nodes into a new Frame container (Ctrl+G)
  const wrapSelectedInFrame = () => {
    const selectedNodes = nodesList.filter((n) => selectedNodeIds.has(n.id) && !n.deleted);
    if (selectedNodes.length === 0) return;

    const minX = Math.min(...selectedNodes.map((n) => n.x)) - 32;
    const minY = Math.min(...selectedNodes.map((n) => n.y)) - 48;
    const maxX = Math.max(...selectedNodes.map((n) => n.x + n.w)) + 32;
    const maxY = Math.max(...selectedNodes.map((n) => n.y + n.h)) + 32;

    const frameId = crypto.randomUUID();
    const frameMap = new Y.Map();

    boardDoc.transact(() => {
      yNodes.set(frameId, frameMap);
      setNodeProperties(frameMap, {
        id: frameId,
        type: 'frame',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
        text: 'Группа / Фрейм',
        color: 'default',
        author: agentStatus.value?.memberName || 'Вы',
        z: 0,
        deleted: false,
        locked: false
      });
    }, CANVAS_UNDO_ORIGIN);

    setSelectedNodeIds(new Set([frameId]));
    showToast('Выделенные элементы объединены во фрейм');
  };

  // Miro-grade Multi-select Alignment
  const alignSelectedNodes = (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v') => {
    const selectedNodes = nodesList.filter((n) => selectedNodeIds.has(n.id) && !n.deleted && !n.locked);
    if (selectedNodes.length <= 1) return;

    boardDoc.transact(() => {
      if (type === 'left') {
        const minX = Math.min(...selectedNodes.map((n) => n.x));
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('x', minX);
        });
      } else if (type === 'center') {
        const avgCenterX = selectedNodes.reduce((acc, n) => acc + (n.x + n.w / 2), 0) / selectedNodes.length;
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('x', Math.round(avgCenterX - n.w / 2));
        });
      } else if (type === 'right') {
        const maxRight = Math.max(...selectedNodes.map((n) => n.x + n.w));
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('x', maxRight - n.w);
        });
      } else if (type === 'top') {
        const minY = Math.min(...selectedNodes.map((n) => n.y));
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('y', minY);
        });
      } else if (type === 'middle') {
        const avgCenterY = selectedNodes.reduce((acc, n) => acc + (n.y + n.h / 2), 0) / selectedNodes.length;
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('y', Math.round(avgCenterY - n.h / 2));
        });
      } else if (type === 'bottom') {
        const maxBottom = Math.max(...selectedNodes.map((n) => n.y + n.h));
        selectedNodes.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('y', maxBottom - n.h);
        });
      } else if (type === 'distribute-h') {
        const sorted = [...selectedNodes].sort((a, b) => a.x - b.x);
        const minX = sorted[0].x;
        const totalW = sorted.reduce((acc, n) => acc + n.w, 0);
        const maxRight = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
        const gap = (maxRight - minX - totalW) / (sorted.length - 1);
        let curX = minX;
        sorted.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('x', Math.round(curX));
          curX += n.w + gap;
        });
      } else if (type === 'distribute-v') {
        const sorted = [...selectedNodes].sort((a, b) => a.y - b.y);
        const minY = sorted[0].y;
        const totalH = sorted.reduce((acc, n) => acc + n.h, 0);
        const maxBottom = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
        const gap = (maxBottom - minY - totalH) / (sorted.length - 1);
        let curY = minY;
        sorted.forEach((n) => {
          const map = yNodes.get(n.id);
          if (map) map.set('y', Math.round(curY));
          curY += n.h + gap;
        });
      }
    }, CANVAS_UNDO_ORIGIN);
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
      const isPdf = (data.mimeType || '').includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
      const hasTextPreview = Boolean(data.extractedText);

      boardDoc.transact(() => {
        yNodes.set(id, nodeMap);
        setNodeProperties(nodeMap, {
          id,
          type: isImage ? 'sticky' : 'file',
          x: Math.round(x),
          y: Math.round(y),
          w: isImage ? 280 : hasTextPreview || isPdf ? 360 : 240,
          h: isImage ? 200 : hasTextPreview || isPdf ? 280 : 130,
          text: file.name,
          fileHash: data.hash,
          fileName: data.fileName,
          extractedText: data.extractedText,
          showPreview: hasTextPreview || isPdf,
          author: currentScope.value === 'team' ? (agentStatus.value?.memberName || '') : '',
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

  // Topological 1-Click Auto-Layout
  const handleTriggerAutoLayout = () => {
    const activeNodes = nodesList.filter((n) => !n.deleted && n.type !== 'frame');
    const activeEdges = edgesList.filter((e) => !e.deleted);
    if (activeNodes.length === 0) return;

    const targetNodes = selectedNodeIds.size > 1
      ? activeNodes.filter((n) => selectedNodeIds.has(n.id))
      : activeNodes;

    const nodeBoxes = targetNodes.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.w, height: n.h }));
    const edgePairs = activeEdges.map((e) => ({ from: e.from, to: e.to }));

    const minX = Math.min(...targetNodes.map((n) => n.x));
    const minY = Math.min(...targetNodes.map((n) => n.y));

    const newPositions = computeAutoLayout(nodeBoxes, edgePairs, Math.max(80, minX), Math.max(80, minY));

    boardDoc.transact(() => {
      for (const [nodeId, pos] of newPositions.entries()) {
        const map = yNodes.get(nodeId);
        if (map) {
          map.set('x', pos.x);
          map.set('y', pos.y);
        }
      }
    }, CANVAS_UNDO_ORIGIN);

    showToast('Граф аккуратно выровнен');
  };

  // Generate Auto-Diagram from Text / Presets
  const handleGenerateAutoDiagram = ({
    nodes: genNodes,
    edges: genEdges
  }: {
    nodes: GeneratedDiagramNode[];
    edges: GeneratedDiagramEdge[];
  }) => {
    boardDoc.transact(() => {
      for (const gn of genNodes) {
        const nodeMap = new Y.Map();
        yNodes.set(gn.id, nodeMap);
        setNodeProperties(nodeMap, {
          id: gn.id,
          type: 'sticky',
          shapeVariant: gn.shapeType,
          x: gn.x,
          y: gn.y,
          w: gn.width,
          h: gn.height,
          text: gn.text,
          color: 'default',
          author: currentScope.value === 'team' ? (agentStatus.value?.memberName || '') : '',
          done: false,
          z: 1,
          deleted: false,
          locked: false
        });
      }

      for (const ge of genEdges) {
        yEdges.set(ge.id, {
          id: ge.id,
          from: ge.fromNode,
          to: ge.toNode,
          fromSide: ge.fromSide,
          toSide: ge.toSide,
          color: ge.color,
          direction: 'forward',
          style: 'solid',
          curveType: 'bezier',
          deleted: false
        });
      }
    }, CANVAS_UNDO_ORIGIN);

    if (genNodes.length > 0) {
      setViewport({
        x: Math.round(window.innerWidth / 2 - genNodes[0].x - 100),
        y: Math.round(window.innerHeight / 2 - genNodes[0].y - 50),
        zoom: 1
      });
      setSelectedNodeIds(new Set(genNodes.map((n) => n.id)));
    }
    showToast(`Создано: ${genNodes.length} узлов и ${genEdges.length} связей`);
  };

  // Global Pointer Events
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      const pos = screenToCanvas(e.clientX, e.clientY);
      lastMouseCanvasPosRef.current = pos;
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

      // Freehand drawing in-progress
      if (currentStrokeRef.current) {
        const next = [...currentStrokeRef.current, pos];
        currentStrokeRef.current = next;
        setCurrentStroke(next);
      }

      // Eraser dragging over drawing nodes
      if (activeTool === 'eraser' && (e.buttons === 1 || e.buttons === 2)) {
        const hitDrawing = nodesList.find(
          (n) => !n.deleted && n.type === 'drawing' && pos.x >= n.x && pos.x <= n.x + n.w && pos.y >= n.y && pos.y <= n.y + n.h
        );
        if (hitDrawing) {
          const map = yNodes.get(hitDrawing.id);
          if (map) {
            boardDoc.transact(() => {
              map.set('deleted', true);
              map.set('deletedAt', Date.now());
            }, CANVAS_UNDO_ORIGIN);
          }
        }
      }

      // Live edge reconnection handle drag
      if (reconnectEdgeStateRef.current) {
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const snapped = findMagneticTargetPort(boxNodes, '', pos.x, pos.y, 28);
        setReconnectEdgeState((prev) =>
          prev
            ? {
                ...prev,
                currentX: snapped ? snapped.point.x : pos.x,
                currentY: snapped ? snapped.point.y : pos.y,
                snappedTarget: snapped
              }
            : null
        );
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
        }, 'drag-motion');
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

          boardDoc.transact(() => {
            nodeMap.set('x', Math.round(newX));
            nodeMap.set('y', Math.round(newY));
            nodeMap.set('w', Math.round(newW));
            nodeMap.set('h', Math.round(newH));
          }, 'resize-motion');
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

      // Drag arrow connector with magnetic geometric snapping
      if (connectingState) {
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const snapped = findMagneticTargetPort(boxNodes, connectingState.fromNodeId, pos.x, pos.y, 28);
        setConnectingState((prev) =>
          prev
            ? {
                ...prev,
                currentX: snapped ? snapped.point.x : pos.x,
                currentY: snapped ? snapped.point.y : pos.y,
                snappedTarget: snapped
              }
            : null
        );
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      setPanState(null);

      // Reconcile dragging for single-step undo
      if (dragState) {
        const finalPositions = new Map<string, { x: number; y: number }>();
        let moved = false;
        dragState.initialPositions.forEach((initPos, id) => {
          const nodeMap = yNodes.get(id);
          if (nodeMap) {
            const currX = nodeMap.get('x');
            const currY = nodeMap.get('y');
            if (currX !== initPos.x || currY !== initPos.y) {
              moved = true;
            }
            finalPositions.set(id, { x: currX, y: currY });
          }
        });

        if (moved) {
          boardDoc.transact(() => {
            dragState.initialPositions.forEach((initPos, id) => {
              const nodeMap = yNodes.get(id);
              if (nodeMap) {
                nodeMap.set('x', initPos.x);
                nodeMap.set('y', initPos.y);
              }
            });
          }, 'drag-cleanup');

          boardDoc.transact(() => {
            finalPositions.forEach((finalPos, id) => {
              const nodeMap = yNodes.get(id);
              if (nodeMap) {
                nodeMap.set('x', finalPos.x);
                nodeMap.set('y', finalPos.y);
              }
            });
          }, CANVAS_UNDO_ORIGIN);
        }
        setDragState(null);
      }

      // Reconcile resizing for single-step undo
      if (resizeState) {
        const nodeMap = yNodes.get(resizeState.nodeId);
        if (nodeMap) {
          const finalW = nodeMap.get('w');
          const finalH = nodeMap.get('h');
          const finalX = nodeMap.get('x');
          const finalY = nodeMap.get('y');
          if (
            finalW !== resizeState.startW ||
            finalH !== resizeState.startH ||
            finalX !== resizeState.startXPos ||
            finalY !== resizeState.startYPos
          ) {
            boardDoc.transact(() => {
              nodeMap.set('x', resizeState.startXPos);
              nodeMap.set('y', resizeState.startYPos);
              nodeMap.set('w', resizeState.startW);
              nodeMap.set('h', resizeState.startH);
            }, 'resize-cleanup');

            boardDoc.transact(() => {
              nodeMap.set('x', finalX);
              nodeMap.set('y', finalY);
              nodeMap.set('w', finalW);
              nodeMap.set('h', finalH);
            }, CANVAS_UNDO_ORIGIN);
          }
        }
        setResizeState(null);
      }

      setAlignmentGuides([]);
      setMarqueeBox(null);
      undoManagerRef.current?.stopCapturing();

      // Freehand drawing commit
      const stroke = currentStrokeRef.current;
      if (stroke) {
        currentStrokeRef.current = null;
        setCurrentStroke(null);
        if (stroke.length >= 2) {
          const pathD = pointsToSmoothSvgPath(stroke);
          const bbox = computeBoundingBox(stroke, 8);
          const newId = crypto.randomUUID();
          const nodeMap = new Y.Map();
          boardDoc.transact(() => {
            yNodes.set(newId, nodeMap);
            setNodeProperties(nodeMap, {
              id: newId,
              type: 'drawing',
              x: bbox.x,
              y: bbox.y,
              w: bbox.width,
              h: bbox.height,
              svgPath: pathD,
              color: drawColor,
              strokeWidth: drawWidth,
              opacity: drawMode === 'highlighter' ? 0.35 : 1,
              z: 2,
              deleted: false,
              locked: false
            });
          }, CANVAS_UNDO_ORIGIN);
        }
      }

      // Handle edge reconnection completion
      const recState = reconnectEdgeStateRef.current;
      if (recState) {
        reconnectEdgeStateRef.current = null;
        setReconnectEdgeState(null);
        const pos = screenToCanvas(e.clientX, e.clientY);
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const target = recState.snappedTarget || findMagneticTargetPort(boxNodes, '', pos.x, pos.y, 28);
        if (target) {
          const existing = yEdges.get(recState.edgeId);
          if (existing) {
            boardDoc.transact(() => {
              if (recState.which === 'from') {
                yEdges.set(recState.edgeId, {
                  ...existing,
                  from: target.nodeId,
                  fromSide: target.side
                });
              } else {
                yEdges.set(recState.edgeId, {
                  ...existing,
                  to: target.nodeId,
                  toSide: target.side
                });
              }
            }, CANVAS_UNDO_ORIGIN);
          }
        }
      }

      const state = connectingStateRef.current;
      if (state) {
        connectingStateRef.current = null;
        setConnectingState(null);

        const pos = screenToCanvas(e.clientX, e.clientY);
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const target = state.snappedTarget || findMagneticTargetPort(boxNodes, state.fromNodeId, pos.x, pos.y, 28);

        if (target && target.nodeId !== state.fromNodeId) {
          const edgeId = crypto.randomUUID();
          boardDoc.transact(() => {
            yEdges.set(edgeId, {
              id: edgeId,
              from: state.fromNodeId,
              to: target.nodeId,
              fromSide: state.fromSide,
              toSide: target.side,
              direction: 'forward',
              style: 'solid',
              deleted: false
            });
          }, 'user');
          setActiveTool('select');
        } else {
          // If dropped on empty canvas, open quick connect drop menu
          setQuickConnect({
            x: e.clientX,
            y: e.clientY,
            canvasX: pos.x,
            canvasY: pos.y,
            fromNodeId: state.fromNodeId,
            fromSide: state.fromSide
          });
        }
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
      if (activeTool === 'draw') {
        const p = screenToCanvas(e.clientX, e.clientY);
        currentStrokeRef.current = [p];
        setCurrentStroke([p]);
        return;
      }
      if (activeTool === 'eraser') {
        const p = screenToCanvas(e.clientX, e.clientY);
        const hitDrawing = nodesList.find(
          (n) => !n.deleted && n.type === 'drawing' && p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h
        );
        if (hitDrawing) {
          const map = yNodes.get(hitDrawing.id);
          if (map) {
            boardDoc.transact(() => {
              map.set('deleted', true);
              map.set('deletedAt', Date.now());
            }, CANVAS_UNDO_ORIGIN);
          }
        }
        return;
      }
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
      const box: BoxNode = { id: node.id, x: node.x, y: node.y, width: node.w, height: node.h };
      const sides: PortSide[] = ['top', 'right', 'bottom', 'left'];
      let bestSide: PortSide = 'right';
      let bestDist = Infinity;
      for (const s of sides) {
        const pt = getPortCoordinates(box, s);
        const dist = Math.hypot(pos.x - pt.x, pos.y - pt.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestSide = s;
        }
      }
      const startPt = getPortCoordinates(box, bestSide);
      setConnectingState({
        fromNodeId: node.id,
        fromSide: bestSide,
        startX: startPt.x,
        startY: startPt.y,
        currentX: pos.x,
        currentY: pos.y,
        snappedTarget: null
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
  const handlePortPointerDown = (nodeId: string, side: PortSide, e: MouseEvent) => {
    e.stopPropagation();
    const pos = screenToCanvas(e.clientX, e.clientY);
    const node = nodeLookup.get(nodeId);
    const startPt = node
      ? getPortCoordinates({ id: node.id, x: node.x, y: node.y, width: node.w, height: node.h }, side)
      : pos;
    setConnectingState({
      fromNodeId: nodeId,
      fromSide: side,
      startX: startPt.x,
      startY: startPt.y,
      currentX: pos.x,
      currentY: pos.y,
      snappedTarget: null
    });
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

  const fitToContent = () => {
    if (visibleNodes.length === 0) {
      setViewport({ x: 80, y: 80, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of visibleNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 80;
    const availW = containerSize.width || window.innerWidth;
    const availH = containerSize.height || window.innerHeight;

    const scaleX = (availW - padding * 2) / Math.max(contentW, 100);
    const scaleY = (availH - padding * 2) / Math.max(contentH, 100);
    const zoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 2.0);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const x = availW / 2 - centerX * zoom;
    const y = availH / 2 - centerY * zoom;

    setViewport({ x, y, zoom });
  };

  return (
    <div
      class={`board-container ${activeTool === 'hand' || isSpacePressed ? 'cursor-grab' : ''}`}
      ref={containerRef}
      onWheel={(e) => handleWheel(e as any)}
      onMouseDown={handleBackgroundPointerDown}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => {
        handleDragOver(e);
      }}
      onDragLeave={(e) => {
        handleDragLeave(e);
      }}
      onDrop={async (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        const canvasFiles = files.filter(f => f.name.toLowerCase().endsWith('.canvas'));
        if (canvasFiles.length > 0) {
          e.preventDefault();
          const pos = screenToCanvas(e.clientX, e.clientY);
          for (let i = 0; i < canvasFiles.length; i++) {
            const file = canvasFiles[i];
            try {
              const text = await file.text();
              const json = JSON.parse(text);
              const idMap = new Map<string, string>();
              boardDoc.transact(() => {
                if (Array.isArray(json.nodes)) {
                  for (const cn of json.nodes) {
                    const newId = crypto.randomUUID();
                    idMap.set(cn.id, newId);
                    const nodeMap = new Y.Map();
                    yNodes.set(newId, nodeMap);
                    setNodeProperties(nodeMap, {
                      id: newId,
                      type: cn.type === 'file' ? 'note' : cn.type === 'text' ? 'text' : 'sticky',
                      x: Math.round(pos.x + (cn.x || 0)),
                      y: Math.round(pos.y + (cn.y || 0)),
                      w: cn.width || 250,
                      h: cn.height || 140,
                      text: cn.text || cn.file || '',
                      color: String(cn.color || '3'),
                      author: agentStatus.value?.memberName || 'Вы',
                      deleted: false,
                      z: 1
                    });
                  }
                }
                if (Array.isArray(json.edges)) {
                  for (const ce of json.edges) {
                    const fromId = idMap.get(ce.fromNode);
                    const toId = idMap.get(ce.toNode);
                    if (fromId && toId) {
                      const edgeId = crypto.randomUUID();
                      yEdges.set(edgeId, {
                        id: edgeId,
                        from: fromId,
                        to: toId,
                        fromSide: ce.fromSide || 'right',
                        toSide: ce.toSide || 'left',
                        label: ce.label || '',
                        color: ce.color ? String(ce.color) : undefined,
                        deleted: false
                      });
                    }
                  }
                }
              }, CANVAS_UNDO_ORIGIN);
              showToast(`Импортирован холст "${file.name}"`);
            } catch (err) {
              console.error('Failed to parse .canvas file:', err);
            }
          }
        } else {
          await handleDrop(e);
        }
      }}
    >
      {/* =========================================================================
          ISLAND 1: TOP-LEFT FLOATING MIRO BOARD BAR
          ========================================================================= */}
      <div
        class="miro-board-bar liquid-glass-surface"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Boards Popover Trigger */}
        <button
          class="miro-board-selector-btn"
          onClick={() => {
            setIsBoardsPopoverOpen(!isBoardsPopoverOpen);
            setIsExportMenuOpen(false);
          }}
          title="Список досок и шаблоны"
        >
          <Icon name="layout" size={16} />
          <span class="miro-board-title">{currentBoardMeta?.title || 'Новая доска'}</span>
          <Icon name="chevron-down" size={12} />
        </button>

        <div class="miro-divider" />

        {/* Scope Switcher Pill: [ Соло | Команда ] */}
        <div class="miro-scope-pill" role="tablist">
          <button
            class={`scope-pill-btn miro-scope-btn ${currentScope.value === 'solo' ? 'active solo' : ''}`}
            onClick={() => setScope('solo')}
            title="Личное пространство (Alt+1)"
          >
            <Icon name="lock" size={12} />
            <span>Соло</span>
          </button>
          <button
            class={`scope-pill-btn miro-scope-btn ${currentScope.value === 'team' ? 'active team' : ''}`}
            onClick={() => setScope('team')}
            title="Командное пространство (Alt+2)"
          >
            <Icon name="globe-mesh" size={12} />
            <span>Команда</span>
          </button>
        </div>

        {!isSplitView.value && (
          <>
            <div class="miro-divider" />
            {/* Workspace Mode Switcher: [ Холст | Сплит | Заметки ] */}
            <div class="workspace-mode-segmented-pill" role="tablist" aria-label="Режим рабочей области">
              <button
                class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'canvas' ? 'active' : ''}`}
                data-mode="canvas"
                onClick={() => setWorkspaceMode('canvas')}
                title="Холст (Бесконечная доска)"
              >
                <Icon name="layout-canvas" size={13} />
                <span class="mode-label">Холст</span>
              </button>
              <button
                class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'split' ? 'active' : ''}`}
                data-mode="split"
                onClick={() => setWorkspaceMode('split')}
                title="Сплит (Холст + Заметка рядом, Ctrl+\)"
              >
                <Icon name="layout-split" size={13} />
                <span class="mode-label">Сплит</span>
              </button>
              <button
                class={`mode-pill-btn workspace-mode-btn ${workspaceMode.value === 'vault' ? 'active' : ''}`}
                data-mode="vault"
                onClick={() => setWorkspaceMode('vault')}
                title="Заметки (Редактор базы знаний)"
              >
                <Icon name="layout-doc" size={13} />
                <span class="mode-label">Заметки</span>
              </button>
            </div>
          </>
        )}

        <div class="miro-divider" />

        {/* Export / File Dropdown */}
        <button
          class="miro-action-btn"
          onClick={() => {
            setIsExportMenuOpen(!isExportMenuOpen);
            setIsBoardsPopoverOpen(false);
          }}
          title="Файл, экспорт и резервное копирование"
        >
          <Icon name="download" size={14} />
          <span>Экспорт</span>
        </button>

        {/* Cross-scope promotion bridge */}
        <button
          class="miro-action-btn"
          data-testid="scope-transfer-btn"
          onClick={() => handleOpenTransferModal()}
          title={currentScope.value === 'solo' ? 'Опубликовать доску в Команду' : 'Склонировать доску в Соло'}
        >
          <Icon name={currentScope.value === 'solo' ? 'promote' : 'fork'} size={14} />
          <span>{currentScope.value === 'solo' ? 'В Команду' : 'В Соло'}</span>
        </button>

        {/* Boards & Templates Dropdown Popover */}
        {isBoardsPopoverOpen && (
          <div class="miro-boards-popover liquid-glass-surface">
            <div class="miro-popover-header">
              <span class="miro-popover-title">Доски</span>
              <button
                class="btn-primary-xs"
                onClick={() => {
                  const newId = createBoard('Новая доска');
                  openTab('board', newId, 'Новая доска');
                  setIsBoardsPopoverOpen(false);
                }}
              >
                <Icon name="plus" size={12} />
                <span>Новая</span>
              </button>
            </div>
            <div class="miro-boards-list">
              {boards.value.filter((b) => !b.deleted).map((b) => (
                <div
                  key={b.id}
                  class={`miro-board-item ${b.id === boardId ? 'active' : ''}`}
                  onClick={() => {
                    openTab('board', b.id, b.title);
                    setIsBoardsPopoverOpen(false);
                  }}
                >
                  <Icon name="layout" size={14} />
                  <span class="miro-board-name">{b.title}</span>
                  {b.id === boardId && <span class="miro-active-dot" />}
                </div>
              ))}
            </div>
            <div class="miro-popover-divider" />
            <button
              class="miro-template-btn"
              onClick={() => {
                seedDefaultBoard(boardDoc, agentStatus.value?.memberName || 'Вы');
                setIsBoardsPopoverOpen(false);
              }}
            >
              <Icon name="sparkles" size={13} />
              <span>Заполнить шаблоном задач</span>
            </button>
          </div>
        )}

        {/* Export Menu Dropdown */}
        {isExportMenuOpen && (
          <div class="miro-export-popover liquid-glass-surface">
            <button
              class="miro-menu-item"
              onClick={() => {
                setShowAiModal(true);
                setIsExportMenuOpen(false);
              }}
            >
              <Icon name="sparkles" size={14} />
              <span>Экспорт для ИИ...</span>
            </button>
            <div class="miro-popover-divider" />
            <a
              class="miro-menu-item"
              href={`/api/export/board/${boardId}`}
              download={`${currentBoardMeta?.title || 'board'}.canvas`}
              onClick={() => setIsExportMenuOpen(false)}
            >
              <Icon name="download" size={14} />
              <span>Скачать .canvas (Obsidian)</span>
            </a>
            <a
              class="miro-menu-item"
              href="/api/export/vault"
              download="doks-vault.zip"
              onClick={() => setIsExportMenuOpen(false)}
            >
              <Icon name="archive" size={14} />
              <span>Резервная копия хранилища (.zip)</span>
            </a>
          </div>
        )}
      </div>

      {/* =========================================================================
          ISLAND 2: LEFT-CENTER VERTICAL MIRO CREATION DOCK
          ========================================================================= */}
      <div
        class="miro-creation-dock-container"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="miro-creation-dock liquid-glass-surface">
          {/* 1. Select (V) */}
          <button
            class={`miro-dock-btn ${activeTool === 'select' ? 'active' : ''}`}
            data-tool="select"
            onClick={() => {
              setActiveTool('select');
              setActiveFlyout('none');
            }}
            title="Выбор и перемещение (V)"
          >
            <Icon name="select" size={20} />
          </button>

          {/* 2. Hand (H) */}
          <button
            class={`miro-dock-btn ${activeTool === 'hand' ? 'active' : ''}`}
            data-tool="hand"
            onClick={() => {
              setActiveTool('hand');
              setActiveFlyout('none');
            }}
            title="Панорамирование (H / Space)"
          >
            <Icon name="hand" size={20} />
          </button>

          <div class="miro-dock-divider" />

          {/* 3. Sticky Note (S) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'sticky' ? 'active' : ''}`}
              data-tool="sticky"
              onClick={() => {
                setActiveTool('sticky');
                setActiveFlyout(activeFlyout === 'sticky' ? 'none' : 'sticky');
              }}
              title="Стикеры Miro (S)"
            >
              <Icon name="sticky" size={20} />
            </button>
            {activeFlyout === 'sticky' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">Цвет стикера</div>
                <div class="miro-sticky-swatch-grid">
                  {Object.entries(CANVAS_COLORS).filter(([k]) => k !== 'default').map(([key, hex]) => (
                    <button
                      key={key}
                      type="button"
                      class={`miro-sticky-swatch ${activeColor === key ? 'active' : ''}`}
                      style={{ backgroundColor: hex }}
                      onClick={() => {
                        setActiveColor(key);
                        setActiveTool('sticky');
                        setActiveFlyout('none');
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 4. Shapes (R) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'shape' ? 'active' : ''}`}
              data-tool="shape"
              onClick={() => {
                setActiveTool('shape');
                setActiveFlyout(activeFlyout === 'shape' ? 'none' : 'shape');
              }}
              title="Геометрические фигуры (R)"
            >
              <Icon name="shape" size={20} />
            </button>
            {activeFlyout === 'shape' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">Форма фигуры</div>
                <div class="miro-shape-grid">
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'rectangle' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('rectangle'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="Прямоугольник"
                  >
                    <div class="shape-preview rect-preview" />
                    <span>Прямоугольник</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'rounded' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('rounded'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="Скруглённый блок"
                  >
                    <div class="shape-preview rounded-preview" />
                    <span>Скруглённый</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'circle' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('circle'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="Круг / Эллипс"
                  >
                    <div class="shape-preview circle-preview" />
                    <span>Круг</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'diamond' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('diamond'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="Ромб (Условие)"
                  >
                    <div class="shape-preview diamond-preview" />
                    <span>Ромб</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'parallelogram' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('parallelogram'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="Параллелограмм"
                  >
                    <div class="shape-preview para-preview" />
                    <span>Параллелограмм</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'cylinder' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('cylinder'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title="База данных (Цилиндр)"
                  >
                    <div class="shape-preview cylinder-preview" />
                    <span>База данных</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Connection / Arrow (L / C) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'arrow' ? 'active' : ''}`}
              data-tool="arrow"
              onClick={() => {
                setActiveTool('arrow');
                setActiveFlyout(activeFlyout === 'arrow' ? 'none' : 'arrow');
              }}
              title="Связующая стрелка (L / C)"
            >
              <Icon name="arrow" size={20} />
            </button>
            {activeFlyout === 'arrow' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">Тип линии</div>
                <div class="miro-line-types">
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'bezier' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'bezier' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M 2 14 C 10 14, 14 2, 22 2" />
                    </svg>
                    <span>Плавная Безье</span>
                  </button>
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'orthogonal' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'orthogonal' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M 2 14 L 12 14 L 12 2 L 22 2" />
                    </svg>
                    <span>Ломаная 90°</span>
                  </button>
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'straight' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'straight' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="2" y1="14" x2="22" y2="2" />
                    </svg>
                    <span>Прямая</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 6. Pen / Brush / Highlighter / Eraser (P / E) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'draw' || activeTool === 'eraser' ? 'active' : ''}`}
              data-tool="draw"
              onClick={() => {
                setActiveTool('draw');
                setActiveFlyout(activeFlyout === 'draw' ? 'none' : 'draw');
              }}
              title="Свободное рисование (P / E)"
            >
              <Icon name={activeTool === 'eraser' ? 'eraser' : 'pen'} size={20} />
            </button>
            {activeFlyout === 'draw' && (
              <div class="miro-flyout-menu liquid-glass-surface" style={{ width: '220px' }}>
                <div class="miro-flyout-title">Инструменты рисования</div>
                <div class="miro-draw-modes">
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'pen' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('pen'); setDrawWidth(3); }}
                  >
                    <Icon name="pen" size={14} />
                    <span>Ручка (3px)</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'brush' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('brush'); setDrawWidth(8); }}
                  >
                    <Icon name="brush" size={14} />
                    <span>Кисть (8px)</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'highlighter' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('highlighter'); setDrawWidth(22); }}
                  >
                    <Icon name="brush" size={14} />
                    <span>Маркер (22px)</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'eraser' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('eraser'); }}
                  >
                    <Icon name="eraser" size={14} />
                    <span>Ластик (E)</span>
                  </button>
                </div>
                <div class="miro-popover-divider" />
                <div class="miro-color-swatches-row">
                  {['#818cf8', '#38bdf8', '#34d399', '#facc15', '#fb7185', '#c084fc', '#f8fafc', '#475569'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      class={`drawing-color-swatch ${drawColor === col ? 'active' : ''}`}
                      style={{ backgroundColor: col }}
                      onClick={() => setDrawColor(col)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 7. Text (T) */}
          <button
            class={`miro-dock-btn ${activeTool === 'text' ? 'active' : ''}`}
            data-tool="text"
            onClick={() => {
              setActiveTool('text');
              setActiveFlyout('none');
            }}
            title="Текст (T)"
          >
            <Icon name="text" size={20} />
          </button>

          {/* 8. Frame (F) */}
          <button
            class={`miro-dock-btn ${activeTool === 'frame' ? 'active' : ''}`}
            data-tool="frame"
            onClick={() => {
              setActiveTool('frame');
              setActiveFlyout('none');
            }}
            title="Фрейм / Контейнер (F)"
          >
            <Icon name="frame" size={20} />
          </button>

          <div class="miro-dock-divider" />

          {/* 9. Mindmap & Auto-Diagrams (M) */}
          <button
            class="miro-dock-btn"
            onClick={() => setIsAutoDiagramModalOpen(true)}
            title="Mindmap и автодиаграммы (M)"
          >
            <Icon name="sparkles" size={20} />
          </button>

          {/* 10. Upload Document / Media (U / I) */}
          <button
            class="miro-dock-btn"
            onClick={() => fileAttachmentInputRef.current?.click()}
            title="Загрузить документ (.docx, .pdf, .md, картинки)"
          >
            <Icon name="upload" size={20} />
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

        {/* Compact Undo / Redo Pill below the Creation Dock */}
        <div class="miro-undo-redo-pill liquid-glass-surface">
          <button
            class="miro-undo-btn hud-btn"
            onClick={() => undoManagerRef.current?.undo()}
            title="Отменить действие (Ctrl+Z)"
          >
            <Icon name="undo" size={16} />
          </button>
          <div class="miro-dock-divider-v" />
          <button
            class="miro-undo-btn hud-btn"
            onClick={() => undoManagerRef.current?.redo()}
            title="Повторить действие (Ctrl+Y)"
          >
            <Icon name="redo" size={16} />
          </button>
        </div>
      </div>

      {/* =========================================================================
          ISLAND 3: TOP-RIGHT FLOATING NOTES & COLLABORATION BAR
          ========================================================================= */}
      {!isSplitView.value && (
        <div
          class="miro-actions-bar liquid-glass-surface"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* [ Заметки ] Drawer Toggle */}
          <button
            class={`miro-action-pill ${isNotesDrawerOpen ? 'active' : ''}`}
            onClick={() => setIsNotesDrawerOpen(!isNotesDrawerOpen)}
            title="Открыть базу знаний заметок (Markdown)"
          >
            <Icon name="file-text" size={15} />
            <span>Заметки</span>
          </button>

          {/* [ ИИ-Контекст ] Button */}
          <button
            class="miro-action-pill"
            data-testid="ai-export-btn"
            onClick={() => setShowAiModal(true)}
            title="Экспорт контекста доски для ИИ"
          >
            <Icon name="sparkles" size={15} />
            <span>ИИ-Контекст</span>
          </button>

          {/* Network Status Pill */}
          <div
            class="miro-network-pill"
            onClick={() => setIsNetworkPopoverOpen(true)}
            title="Сетевые подключения и P2P"
          >
            <span class="status-dot green" />
            <span>Локально</span>
          </div>
        </div>
      )}

      {/* =========================================================================
          RIGHT SLIDE-OVER NOTES DRAWER
          ========================================================================= */}
      {isNotesDrawerOpen && (
        <div
          class="miro-notes-drawer liquid-glass-surface"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="miro-notes-drawer-header">
            <div class="miro-drawer-title-group">
              <Icon name="file-text" size={16} />
              <span class="miro-drawer-title">Заметки базы знаний</span>
            </div>
            <div class="miro-drawer-actions">
              <button
                class="btn-primary-xs"
                onClick={() => {
                  const newId = createNote('Новая заметка', null);
                  setSelectedDrawerNoteId(newId);
                }}
                title="Создать новую заметку"
              >
                <Icon name="plus" size={13} />
                <span>Новая</span>
              </button>
              <button
                class="miro-close-btn"
                onClick={() => setIsNotesDrawerOpen(false)}
                title="Закрыть шторку"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>
          <div class="miro-drawer-note-select">
            <select
              value={selectedDrawerNoteId || (notes.value.find((n) => !n.deleted)?.id || '')}
              onChange={(e) => setSelectedDrawerNoteId((e.target as HTMLSelectElement).value)}
            >
              {notes.value.filter((n) => !n.deleted).map((n) => (
                <option key={n.id} value={n.id}>{n.title || 'Без названия'}</option>
              ))}
            </select>
          </div>
          <div class="miro-drawer-content">
            {(selectedDrawerNoteId || notes.value.find((n) => !n.deleted)?.id) ? (
              <NoteEditor
                key={selectedDrawerNoteId || notes.value.find((n) => !n.deleted)!.id}
                noteId={selectedDrawerNoteId || notes.value.find((n) => !n.deleted)!.id}
              />
            ) : (
              <div class="miro-empty-notes">
                <p>В хранилище пока нет заметок</p>
                <button class="btn-primary-sm" onClick={() => createNote('Первая заметка', null)}>
                  Создать первую заметку
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Freehand Drawing Sub-Bar */}
      {activeTool === 'draw' && (
        <div
          class="floating-draw-subbar liquid-glass-surface"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            class={`draw-mode-btn ${drawMode === 'pen' ? 'active' : ''}`}
            onClick={() => {
              setDrawMode('pen');
              setDrawWidth(3);
            }}
          >
            Ручка
          </button>
          <button
            type="button"
            class={`draw-mode-btn ${drawMode === 'brush' ? 'active' : ''}`}
            onClick={() => {
              setDrawMode('brush');
              setDrawWidth(6);
            }}
          >
            Кисть
          </button>
          <button
            type="button"
            class={`draw-mode-btn ${drawMode === 'highlighter' ? 'active' : ''}`}
            onClick={() => {
              setDrawMode('highlighter');
              setDrawWidth(20);
            }}
          >
            Маркер
          </button>

          <div class="toolbox-divider" />

          {/* Stroke Width Selector */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[2, 4, 8, 16].map((w) => (
              <button
                key={w}
                type="button"
                class={`draw-width-btn ${drawWidth === w ? 'active' : ''}`}
                onClick={() => setDrawWidth(w)}
              >
                {w}px
              </button>
            ))}
          </div>

          <div class="toolbox-divider" />

          {/* Color swatches */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {['#818cf8', '#38bdf8', '#34d399', '#facc15', '#fb7185', '#c084fc', '#f8fafc', '#1e293b'].map((c) => (
              <button
                key={c}
                type="button"
                class={`color-dot palette-swatch ${drawColor === c ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setDrawColor(c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Miro Multi-Select Alignment Bar */}
      {selectedNodeIds.size > 1 && (
        <div class="align-toolbar liquid-glass-surface" onClick={(e) => e.stopPropagation()}>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('left')} title="Выровнять по левому краю">
            <span>Слева</span>
          </button>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('center')} title="Выровнять по центру">
            <span>Центр</span>
          </button>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('right')} title="Выровнять по правому краю">
            <span>Справа</span>
          </button>
          <div class="align-toolbar-divider" />
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('top')} title="Выровнять по верху">
            <span>Сверху</span>
          </button>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('middle')} title="Выровнять по середине">
            <span>Середина</span>
          </button>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('bottom')} title="Выровнять по низу">
            <span>Снизу</span>
          </button>
          <div class="align-toolbar-divider" />
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('distribute-h')} title="Распределить по горизонтали">
            <span>По гориз.</span>
          </button>
          <button class="align-toolbar-btn" onClick={() => alignSelectedNodes('distribute-v')} title="Распределить по вертикали">
            <span>По верт.</span>
          </button>
          <div class="align-toolbar-divider" />
          <button class="align-toolbar-btn" onClick={wrapSelectedInFrame} title="Объединить во фрейм (Ctrl+G)">
            <Icon name="frame" size={14} />
            <span>В фрейм</span>
          </button>
        </div>
      )}

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
          {/* Color Palette (6 muted colors) */}
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

          {/* Font size buttons S / M / L */}
          <div class="inspector-font-sizes">
            <button
              class="inspector-size-btn"
              title="Размер текста: Маленький (13px)"
              onClick={() => {
                boardDoc.transact(() => {
                  for (const id of selectedNodeIds) {
                    const map = yNodes.get(id);
                    if (map) map.set('fontSize', 13);
                  }
                }, 'user');
              }}
            >
              S
            </button>
            <button
              class="inspector-size-btn"
              title="Размер текста: Средний (15px)"
              onClick={() => {
                boardDoc.transact(() => {
                  for (const id of selectedNodeIds) {
                    const map = yNodes.get(id);
                    if (map) map.set('fontSize', 15);
                  }
                }, 'user');
              }}
            >
              M
            </button>
            <button
              class="inspector-size-btn"
              title="Размер текста: Большой (18px)"
              onClick={() => {
                boardDoc.transact(() => {
                  for (const id of selectedNodeIds) {
                    const map = yNodes.get(id);
                    if (map) map.set('fontSize', 18);
                  }
                }, 'user');
              }}
            >
              L
            </button>
          </div>

          {/* Checkbox toggle for stickies */}
          {(() => {
            const hasSticky = Array.from(selectedNodeIds).some((id) => nodeLookup.get(id)?.type === 'sticky');
            if (!hasSticky) return null;
            return (
              <button
                class="inspector-btn"
                title="Добавить / убрать чекбокс задачи"
                onClick={() => {
                  boardDoc.transact(() => {
                    for (const id of selectedNodeIds) {
                      const node = nodeLookup.get(id);
                      if (node?.type === 'sticky') {
                        const map = yNodes.get(id);
                        if (map) {
                          const currentVal = map.get('hasCheckbox');
                          map.set('hasCheckbox', !currentVal);
                        }
                      }
                    }
                  }, 'user');
                }}
              >
                <Icon name="check-square" size={15} />
              </button>
            );
          })()}

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

          {/* Flowchart Shape Variant Switcher */}
          {(() => {
            const hasShape = Array.from(selectedNodeIds).some((id) => nodeLookup.get(id)?.type === 'shape');
            if (!hasShape) return null;
            return (
              <>
                <div class="inspector-divider" />
                <button
                  class="inspector-btn"
                  title="Форма: Прямоугольник"
                  onClick={() => {
                    boardDoc.transact(() => {
                      for (const id of selectedNodeIds) {
                        const map = yNodes.get(id);
                        if (map) map.set('shapeVariant', 'rectangle');
                      }
                    }, CANVAS_UNDO_ORIGIN);
                  }}
                >
                  <Icon name="square" size={14} />
                </button>
                <button
                  class="inspector-btn"
                  title="Форма: Скруглённый прямоугольник"
                  onClick={() => {
                    boardDoc.transact(() => {
                      for (const id of selectedNodeIds) {
                        const map = yNodes.get(id);
                        if (map) map.set('shapeVariant', 'rounded');
                      }
                    }, CANVAS_UNDO_ORIGIN);
                  }}
                >
                  <Icon name="shape" size={14} />
                </button>
                <button
                  class="inspector-btn"
                  title="Форма: Ромб"
                  onClick={() => {
                    boardDoc.transact(() => {
                      for (const id of selectedNodeIds) {
                        const map = yNodes.get(id);
                        if (map) map.set('shapeVariant', 'diamond');
                      }
                    }, CANVAS_UNDO_ORIGIN);
                  }}
                >
                  <Icon name="diamond" size={14} />
                </button>
                <button
                  class="inspector-btn"
                  title="Форма: Круг"
                  onClick={() => {
                    boardDoc.transact(() => {
                      for (const id of selectedNodeIds) {
                        const map = yNodes.get(id);
                        if (map) map.set('shapeVariant', 'circle');
                      }
                    }, CANVAS_UNDO_ORIGIN);
                  }}
                >
                  <Icon name="circle" size={14} />
                </button>
              </>
            );
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

      {/* Infinite Scaled Layer */}
      <div
        class="board-transform-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {/* Drop Ghost Card Preview */}
        {dropGhost && (
          <div
            className="doks-drop-ghost-card"
            style={{
              left: `${dropGhost.worldX}px`,
              top: `${dropGhost.worldY}px`,
            }}
          >
            <Icon name="file" size={24} />
            <span>{dropGhost.label}</span>
          </div>
        )}

        {/* Canvas Edges Layer: 18px hitboxes, dynamic arrowheads, labels & Edge Inspector */}
        <CanvasEdgesLayer
          nodesMap={nodesBoxMap}
          edges={canvasEdges}
          selectedEdgeId={selectedEdgeId}
          onSelectEdge={(id) => {
            setSelectedEdgeId(id);
            if (id) setSelectedNodeIds(new Set());
          }}
          onUpdateEdge={handleUpdateEdge}
          onDeleteEdge={handleDeleteEdge}
          onStartReconnect={(edgeId, which, startPoint) => {
            setReconnectEdgeState({
              edgeId,
              which,
              startPoint,
              currentX: startPoint.x,
              currentY: startPoint.y,
              snappedTarget: null
            });
          }}
        />

        {/* SVG Snap Lines & Interactive Drag Lines */}
        <svg
          class="canvas-svg-layer"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 13
          }}
        >
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent, #7c8cff)" />
            </marker>
            <marker
              id="arrow-marker-start"
              viewBox="0 0 10 10"
              refX="2"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 10 1 L 0 5 L 10 9 z" fill="var(--accent, #7c8cff)" />
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
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            ) : (
              <line
                key={`gy-${i}`}
                x1={-10000}
                y1={g.pos}
                x2={10000}
                y2={g.pos}
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )
          ))}

          {/* Live edge reconnection dragging line */}
          {reconnectEdgeState && (
            <g class="connecting-preview-group">
              <line
                x1={reconnectEdgeState.startPoint.x}
                y1={reconnectEdgeState.startPoint.y}
                x2={reconnectEdgeState.currentX}
                y2={reconnectEdgeState.currentY}
                stroke="#7c8cff"
                strokeWidth="2.5"
                strokeDasharray="4 4"
              />
              {reconnectEdgeState.snappedTarget && (
                <circle
                  cx={reconnectEdgeState.snappedTarget.point.x}
                  cy={reconnectEdgeState.snappedTarget.point.y}
                  r="7"
                  class="magnetic-snap-ring"
                />
              )}
            </g>
          )}

          {/* Temporary arrow during drag with magnetic live snap */}
          {connectingState && (
            <g class="connecting-preview-group">
              <path
                d={
                  connectingState.snappedTarget
                    ? buildBezierEdgePath(
                        connectingState.startX,
                        connectingState.startY,
                        connectingState.fromSide,
                        connectingState.snappedTarget.point.x,
                        connectingState.snappedTarget.point.y,
                        connectingState.snappedTarget.side
                      )
                    : buildBezierEdgePath(
                        connectingState.startX,
                        connectingState.startY,
                        connectingState.fromSide,
                        connectingState.currentX,
                        connectingState.currentY,
                        'left'
                      )
                }
                class="connecting-preview-line"
                stroke="var(--accent, #38bdf8)"
                strokeWidth="2.5"
                strokeDasharray="4 4"
                fill="none"
                markerEnd="url(#arrow-marker)"
              />
              {connectingState.snappedTarget && (
                <circle
                  cx={connectingState.snappedTarget.point.x}
                  cy={connectingState.snappedTarget.point.y}
                  r="7"
                  class="magnetic-snap-ring"
                />
              )}
            </g>
          )}

          {/* Live freehand drawing stroke preview */}
          {currentStroke && currentStroke.length > 1 && (
            <path
              d={pointsToSmoothSvgPath(currentStroke)}
              stroke={drawColor}
              strokeWidth={drawWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={drawMode === 'highlighter' ? 0.35 : 1}
            />
          )}
        </svg>

        {/* Real-time Ghost Drop Preview Card */}
        {ghostDropPreview && (
          <div
            class="ghost-drop-preview"
            style={{
              left: `${ghostDropPreview.x}px`,
              top: `${ghostDropPreview.y}px`,
              width: '240px',
              height: '140px'
            }}
          >
            <Icon name="upload" size={24} />
            <span>{ghostDropPreview.title}</span>
          </div>
        )}

        {/* Nodes Layer */}
        {visibleNodes.map((node) => {
          const isSelected = selectedNodeIds.has(node.id);
          const nodeColorHex = CANVAS_COLORS[node.color || ''] || CANVAS_COLORS.default;
          const isFrame = node.type === 'frame';
          const isNote = node.type === 'note';
          const shapeClass = node.type === 'shape' && node.shapeVariant ? `shape-variant-${node.shapeVariant}` : '';

          return (
            <div
              key={node.id}
              data-node-id={node.id}
              class={`board-node-box type-${node.type} ${shapeClass} ${isSelected ? 'selected' : ''} ${node.locked ? 'locked' : ''}`}
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
              />
              <div
                class="magnetic-port port-right"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'right', e as any)}
              />
              <div
                class="magnetic-port port-bottom"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'bottom', e as any)}
              />
              <div
                class="magnetic-port port-left"
                onMouseDown={(e) => handlePortPointerDown(node.id, 'left', e as any)}
              />

              {/* Top drag bar for sticky notes */}
              {node.type === 'sticky' && (
                <div class="node-drag-bar" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                  {((node as any).hasCheckbox || node.done) && (
                    <input
                      type="checkbox"
                      class="sticky-checkbox"
                      checked={node.done || false}
                      onChange={(e) => {
                        const map = yNodes.get(node.id);
                        if (map) map.set('done', (e.target as HTMLInputElement).checked);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  )}
                  {node.locked && (
                    <span class="node-lock-badge" title="Заблокировано">
                      <Icon name="lock" size={11} />
                    </span>
                  )}
                </div>
              )}

              {/* Note Header */}
              {isNote && (
                <div class="node-meta-stripe">
                  <span class="node-author-chip" style={{ color: nodeColorHex }}>
                    Заметка
                  </span>
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
                </div>
              )}

              {/* Node Content */}
              {node.type === 'drawing' ? (
                <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
                  <svg
                    style={{
                      width: '100%',
                      height: '100%',
                      overflow: 'visible',
                      pointerEvents: 'none'
                    }}
                  >
                    <path
                      d={node.svgPath}
                      stroke={node.color || '#818cf8'}
                      strokeWidth={node.strokeWidth || 3}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={node.opacity ?? 1}
                    />
                  </svg>
                </div>
              ) : isNote ? (
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
                  const isPdf = (node.fileName || '').toLowerCase().endsWith('.pdf');
                  const isExpanded = node.showPreview ?? previewDocIds.has(node.id);
                  const togglePreview = (e: MouseEvent) => {
                    e.stopPropagation();
                    const next = !isExpanded;
                    setPreviewDocIds((prev) => {
                      const s = new Set(prev);
                      if (next) s.add(node.id);
                      else s.delete(node.id);
                      return s;
                    });
                    const map = yNodes.get(node.id);
                    if (map) {
                      map.set('showPreview', next);
                      if (next && node.h < 260) {
                        map.set('h', 280);
                        map.set('w', Math.max(node.w, 340));
                      }
                    }
                  };

                  const convertToNote = (e: MouseEvent) => {
                    e.stopPropagation();
                    const noteTitle = (node.fileName || node.text || 'Документ').replace(/\.[^/.]+$/, '');
                    const noteContent = node.extractedText || `# ${noteTitle}\n\n`;
                    const noteId = createNote(noteTitle, null);
                    const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(currentScope.value, noteId));
                    noteDoc.getText('text').insert(0, noteContent);
                    openTab('note', noteId, noteTitle);
                    ensureSplitTabs();
                    setWorkspaceMode('split');
                    showToast(`Создана заметка "${noteTitle}" в Split-View`);
                  };

                  return (
                    <div class="node-file-wrapper" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                      <div class="node-file-header" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                        <div class="node-file-title-group">
                          <Icon name="file-text" size={16} />
                          <span class="node-file-name" title={node.fileName || node.text}>
                            {node.fileName || node.text}
                          </span>
                        </div>
                        <div class="node-file-actions" onMouseDown={(e) => e.stopPropagation()}>
                          {(node.extractedText || isPdf) && (
                            <button
                              type="button"
                              class={`node-file-btn ${isExpanded ? 'active' : ''}`}
                              onClick={togglePreview}
                              title={isExpanded ? 'Скрыть содержимое' : 'Читать на доске'}
                            >
                              <Icon name="eye" size={12} />
                              <span>{isExpanded ? 'Скрыть' : 'Читать'}</span>
                            </button>
                          )}
                          {node.extractedText && (
                            <button
                              type="button"
                              class="node-file-btn"
                              onClick={convertToNote}
                              title="Преобразовать в заметку в Split-View"
                            >
                              <Icon name="note-card" size={12} />
                              <span>В заметку</span>
                            </button>
                          )}
                          <a
                            href={`/api/attachments/${node.fileHash}`}
                            download={node.fileName || 'file'}
                            class="node-file-btn"
                            target="_blank"
                            rel="noopener"
                            title="Скачать файл"
                          >
                            <Icon name="download" size={12} />
                            <span>Скачать</span>
                          </a>
                        </div>
                      </div>

                      {isExpanded && (
                        isPdf ? (
                          <iframe
                            src={`/api/attachments/${node.fileHash}`}
                            class="node-file-pdf-iframe"
                            title={node.fileName || 'PDF'}
                          />
                        ) : (
                          <div
                            class="node-file-reader-body scrollable-card-content"
                            onWheel={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {node.extractedText || 'Текст документа извлекается или пуст...'}
                          </div>
                        )
                      )}
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
                  style={{ fontSize: node.fontSize ? `${node.fontSize}px` : undefined }}
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

              {/* Author micro-badge in Team Scope (never show debug 'Tester') */}
              {node.type === 'sticky' && currentScope.value === 'team' && node.author && node.author !== 'Tester' && (
                <span class="node-author-microbadge" title={`Автор: ${node.author}`}>
                  {node.author}
                </span>
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

      <AutoDiagramModal
        isOpen={isAutoDiagramModalOpen}
        onClose={() => setIsAutoDiagramModalOpen(false)}
        onGenerate={handleGenerateAutoDiagram}
        defaultOriginX={Math.round((window.innerWidth / 2 - viewport.x) / viewport.zoom)}
        defaultOriginY={Math.round((window.innerHeight / 2 - viewport.y) / viewport.zoom)}
      />

      <NetworkPopover
        isOpen={isNetworkPopoverOpen}
        onClose={() => setIsNetworkPopoverOpen(false)}
      />

      {/* Empty State Seed Card */}
      {visibleNodes.length === 0 && (
        <div
          class="canvas-empty-state liquid-glass-surface"
          onMouseDown={(e) => {
            if (activeTool === 'select' || activeTool === 'hand') {
              e.stopPropagation();
            }
          }}
        >
          <div class="empty-state-title">Доска пуста</div>
          <div class="empty-state-desc">Создайте стикер (S) или заполните шаблоном задач</div>
          <button
            class="btn-primary-sm empty-state-btn"
            onClick={() => seedDefaultBoard(boardDoc, agentStatus.value?.memberName || 'Вы')}
          >
            <Icon name="plus" size={14} />
            <span>Заполнить шаблоном</span>
          </button>
        </div>
      )}

      {/* Sleek Bottom-Right Canvas HUD (Zoom, Fit, Minimap) */}
      <div
        class="canvas-bottom-right-hud"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {showMinimap && (
          <div class="minimap-popup liquid-glass-surface">
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
        )}

        <div class="zoom-hud-pill liquid-glass-surface">
          <button
            class="hud-btn"
            onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(v.zoom * 0.8, 0.15) }))}
            title="Отдалить (-)"
          >
            <Icon name="zoom-out" size={14} />
          </button>
          <button
            class="hud-btn zoom-value-btn"
            onClick={() => setViewport((v) => ({ ...v, zoom: 1 }))}
            title="Сбросить масштаб (100%)"
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
          <button
            class="hud-btn"
            onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(v.zoom * 1.25, 3.5) }))}
            title="Приблизить (+)"
          >
            <Icon name="zoom-in" size={14} />
          </button>
          <div class="hud-divider" />
          <button
            class="hud-btn"
            onClick={fitToContent}
            title="Вписать всё содержимое (Fit)"
          >
            <Icon name="layout-canvas" size={14} />
            <span class="hud-btn-text">Fit</span>
          </button>
          <button
            class={`hud-btn ${showMinimap ? 'active' : ''}`}
            onClick={() => setShowMinimap(!showMinimap)}
            title="Миникарта"
          >
            <Icon name="frame" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default BoardCanvas;
