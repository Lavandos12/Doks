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
  type BoardNodeType,
  type WorkspaceScope,
  boardToJSONCanvas
} from '@doks/shared';
import { yjsClient, agentStatus, connectionState } from '../../state/yjs-client.js';
import {
  openTab,
  notes,
  boards,
  selectedBoardId,
  createBoard,
  deleteBoard,
  renameBoard,
  setScope,
  convertBoardScope,
  maps,
  restoreNote,
  createNote,
  currentScope,
  ensureSplitTabs,
  isSplitView,
  workspaceMode,
  setWorkspaceMode,
  isCommandPaletteOpen,
  allBoards,
  allTrashNotes,
  allTrashBoards,
  isViewerMode,
  selectBoardWithScope,
  globalBoardClipboard,
  quickPushNodesToOppositeScope
} from '../../state/app-state.js';
import { CreateBoardModal } from './create-board-modal.js';
import { BoardSettingsModal } from './board-settings-modal.js';
import { NoteEditor } from '../notes/editor.js';
import { MarkdownPreview } from '../notes/markdown-preview.js';
import { api } from '../../api/client.js';
import { CanvasEdgesLayer, type CanvasEdgeModel } from '../CanvasEdgesLayer.js';
import { useCanvasDropZone } from '../../hooks/useCanvasDropZone.js';
import { seedDefaultBoard } from './board-seed.js';
import { Icon, type IconName } from '../Icons.js';
import { AiExportModal } from './ai-export-modal.js';
import { NotePickerModal } from './note-picker-modal.js';
import { BoardMinimap } from './board-minimap.js';
import { TransferModal } from './transfer-modal.js';
import { AutoDiagramModal } from './auto-diagram-modal.js';
import { ShareModal } from '../layout/share-modal.js';
import {
  pointsToSmoothSvgPath,
  buildCalligraphicBrushPath,
  computeBoundingBox,
  type Point
} from '../../utils/strokeSmoother.js';
import { computeAutoLayout, type GeneratedDiagramNode, type GeneratedDiagramEdge } from '../../utils/diagramGenerator.js';
import {
  computeContinuousGrid,
  computeContinuousWheelTarget,
  stepDampedKinematics,
  type ViewportCoord
} from '../../utils/canvasGrid.js';
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
import {
  distToSegment,
  computeSmartAlignment,
  computeResizeAlignment,
  type AlignmentGuide,
  type BoxRect
} from '../../utils/smartAlignment.js';

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#d97706', // Warm Amber
  '2': '#3b82f6', // Slate Blue
  '3': '#10b981', // Mint Emerald
  '4': '#f43f5e', // Rose Coral
  '5': '#8b5cf6', // Violet
  '6': '#4b5563', // Graphite
  default: '#d97706'
};

export type CanvasTool = 'select' | 'hand' | 'sticky' | 'text' | 'note' | 'frame' | 'arrow' | 'line' | 'shape' | 'draw' | 'eraser' | 'checklist' | 'table' | 'kanban' | 'code' | 'image' | 'widgets' | 'chart';

const HANDLE_ANCHORS: Record<ResizeHandle, string> = {
  nw: 'top left',
  ne: 'top right',
  se: 'bottom right',
  sw: 'bottom left',
  n: 'center top',
  s: 'center bottom',
  e: 'right center',
  w: 'left center'
};
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface BoardCanvasProps {
  boardId: string;
  gridType?: 'dots' | 'lines' | 'none';
  snapToGrid?: boolean;
  scopeOverride?: WorkspaceScope;
}

interface RemoteCursor {
  clientId: number;
  x: number;
  y: number;
  name: string;
  color: string;
}

const getLocalCollaborator = () => {
  if (typeof window === 'undefined') return { name: 'User', color: '#8b5cf6' };
  let name = localStorage.getItem('doks_display_name') || localStorage.getItem('doks_member_name');
  if (!name || name === 'You') {
    let guestId = sessionStorage.getItem('doks_guest_id');
    if (!guestId) {
      guestId = Math.floor(100 + Math.random() * 900).toString();
      sessionStorage.setItem('doks_guest_id', guestId);
    }
    name = `Collaborator #${guestId}`;
  }
  let color = localStorage.getItem('doks_cursor_color') || localStorage.getItem('doks_member_color');
  if (!color) {
    const PALETTE = ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#f97316'];
    let savedColor = sessionStorage.getItem('doks_guest_color');
    if (!savedColor) {
      savedColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      sessionStorage.setItem('doks_guest_color', savedColor);
    }
    color = savedColor;
  }
  return { name, color };
};

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

function renderShapeSvg(node: BoardNodeData, colorHex: string) {
  const w = node.w;
  const h = node.h;
  const variant = ((node as any).shapeVariant || 'rectangle') as string;
  const strokeColor = (node as any).borderColor || colorHex || '#818cf8';
  const fillColor = (node as any).fillColor || (colorHex ? `${colorHex}22` : 'rgba(30, 41, 59, 0.45)');
  const strokeWidth = node.strokeWidth || 2;

  let pathElement = null;
  switch (variant) {
    case 'circle':
      pathElement = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(2, w / 2 - strokeWidth)}
          ry={Math.max(2, h / 2 - strokeWidth)}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    case 'line': {
      pathElement = (
        <line
          x1={0}
          y1={h / 2}
          x2={w}
          y2={h / 2}
          stroke={strokeColor}
          strokeWidth={Math.max(2, strokeWidth || 3)}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    }
    case 'rounded':
      pathElement = (
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={Math.max(4, w - strokeWidth)}
          height={Math.max(4, h - strokeWidth)}
          rx="20"
          ry="20"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    case 'rectangle':
    default:
      pathElement = (
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={Math.max(4, w - strokeWidth)}
          height={Math.max(4, h - strokeWidth)}
          rx="4"
          ry="4"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
  }

  return (
    <svg
      class="shape-vector-svg"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible'
      }}
    >
      {pathElement}
    </svg>
  );
}

/**
 * Dynamically computes an ideal font size based on bounding box dimensions and text length.
 * Clamps safely between 12px and 140px using word-wrap aware iterative binary search.
 */
export function calculateAutoFontSize(text: string, w: number, h: number, type?: string): number {
  const padW = Math.max(20, w - 24);
  const padH = Math.max(20, h - 24);
  const clean = (text || '').trim();

  // Empty or minimal text scales proportionally with card height
  if (!clean) {
    return Math.min(Math.max(14, Math.round(h * 0.14)), 72);
  }

  // Iterative binary search for font size between 12px and 140px
  let low = 12;
  let high = Math.min(Math.round(h * 0.5), 140);
  let best = low;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const charWidth = mid * 0.54;
    const charsPerLine = Math.max(1, Math.floor(padW / charWidth));

    // Break on explicit newlines, then wrap each segment
    const rawParagraphs = clean.split('\n');
    let totalLines = 0;
    for (const para of rawParagraphs) {
      totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
    }

    const totalHeight = totalLines * (mid * 1.35);
    if (totalHeight <= padH) {
      best = mid;
      low = mid + 1; // Try larger font
    } else {
      high = mid - 1; // Too big, reduce font
    }
  }
  return best;
}

const getSafeAttachmentUrl = (url?: string, hash?: string): string | undefined => {
  if (url) {
    if (url.startsWith('blob:') || url.startsWith('/api/attachments/')) return url;
    if (url.startsWith('data:image/') || url.startsWith('data:application/pdf')) return url;
    return undefined;
  }
  if (hash) {
    const HASH_REGEX = /^[a-f0-9]{64}$/;
    if (HASH_REGEX.test(hash)) return `/api/attachments/${hash}`;
  }
  return undefined;
};

export function BoardCanvas({ boardId, gridType = 'lines', snapToGrid = false, scopeOverride }: BoardCanvasProps) {
  const effectiveScope: WorkspaceScope = scopeOverride || currentScope.value;
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

  // Editing node state (Miro standard: single click or double click edits, drag moves)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const startEditingNode = useCallback((id: string, selectAll = false) => {
    setEditingNodeId(id);
    setSelectedNodeIds(new Set([id]));
    requestAnimationFrame(() => {
      const el = document.getElementById(`node-textarea-${id}`) as HTMLTextAreaElement | HTMLInputElement | null;
      if (el) {
        el.focus({ preventScroll: true });
        if (selectAll) {
          el.select();
        } else {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    });
  }, []);

  // Freehand drawing state
  const [drawMode, setDrawMode] = useState<'pen' | 'brush' | 'highlighter'>('pen');
  const [drawWidth, setDrawWidth] = useState<number>(4);
  const [drawColor, setDrawColor] = useState<string>('#818cf8');
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const currentStrokeRef = useRef<Point[] | null>(null);
  currentStrokeRef.current = currentStroke;

  // Segment-based hit-testing for eraser tool
  const isPointHittingDrawing = useCallback((pos: { x: number; y: number }, n: BoardNodeData, erasePad: number): boolean => {
    if (n.deleted || n.type !== 'drawing') return false;
    if (
      pos.x < n.x - erasePad ||
      pos.x > n.x + n.w + erasePad ||
      pos.y < n.y - erasePad ||
      pos.y > n.y + n.h + erasePad
    ) {
      return false;
    }
    const pts = (n as any).points as Point[] | undefined;
    if (pts && pts.length > 0) {
      const threshold = Math.max(14, (n.strokeWidth || 4) / 2 + erasePad);
      if (pts.length === 1) {
        return Math.hypot(n.x + pts[0].x - pos.x, n.y + pts[0].y - pos.y) <= threshold;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const v = { x: n.x + pts[i].x, y: n.y + pts[i].y };
        const w = { x: n.x + pts[i + 1].x, y: n.y + pts[i + 1].y };
        if (distToSegment(pos, v, w) <= threshold) {
          return true;
        }
      }
      return false;
    }
    return true;
  }, []);

  // Pure vector ink stroke renderer (calligraphic tapered polygon brush, chisel highlighter, technical pen)
  const renderInkStroke = (
    key: string,
    d: string,
    color: string,
    baseWidth: number,
    mode: 'pen' | 'brush' | 'highlighter',
    points?: Point[]
  ) => {
    if (mode === 'brush') {
      const brushD = points && points.length > 1 ? buildCalligraphicBrushPath(points, baseWidth) : null;
      if (brushD) {
        return (
          <g key={key}>
            {/* Subtle soft outer glow */}
            <path
              d={d}
              fill="none"
              style={{
                stroke: color,
                strokeWidth: `${Math.round(baseWidth * 0.6)}px`,
                opacity: 0.22,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            />
            {/* Dynamic calligraphic tapered polygon */}
            <path
              d={brushD}
              fill={color}
              stroke="none"
              style={{
                opacity: 0.95
              }}
            />
          </g>
        );
      }
      const haloWidth = Math.round(baseWidth * 2.4);
      const coreWidth = Math.max(2, Math.round(baseWidth * 1.45));
      return (
        <g key={key}>
          <path
            d={d}
            fill="none"
            style={{
              stroke: color,
              strokeWidth: `${haloWidth}px`,
              opacity: 0.22,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            }}
          />
          <path
            d={d}
            fill="none"
            style={{
              stroke: color,
              strokeWidth: `${coreWidth}px`,
              opacity: 0.95,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            }}
          />
        </g>
      );
    }
    if (mode === 'highlighter') {
      const sw = Math.round(baseWidth * 3.0);
      return (
        <path
          key={key}
          d={d}
          fill="none"
          style={{
            stroke: color,
            strokeWidth: `${sw}px`,
            opacity: 0.35,
            strokeLinecap: 'butt',
            strokeLinejoin: 'round',
            mixBlendMode: 'screen'
          }}
        />
      );
    }
    const sw = Math.max(1, baseWidth);
    return (
      <path
        key={key}
        d={d}
        fill="none"
        style={{
          stroke: color,
          strokeWidth: `${sw}px`,
          opacity: 1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        }}
      />
    );
  };

  // Immediate refs to prevent stale closures during drawing and tool manipulation
  const activeToolRef = useRef<CanvasTool>(activeTool);
  activeToolRef.current = activeTool;
  const activeColorRef = useRef<string>(activeColor);
  activeColorRef.current = activeColor;
  const drawColorRef = useRef<string>(drawColor);
  drawColorRef.current = drawColor;
  const drawWidthRef = useRef<number>(drawWidth);
  drawWidthRef.current = drawWidth;
  const drawModeRef = useRef<'pen' | 'brush' | 'highlighter'>(drawMode);
  drawModeRef.current = drawMode;

  const selectActiveColor = useCallback((color: string) => {
    activeColorRef.current = color;
    setActiveColor(color);
    const hex = CANVAS_COLORS[color] || color;
    drawColorRef.current = hex;
    setDrawColor(hex);
  }, []);

  const [cursorScreenPos, setCursorScreenPos] = useState<{ x: number; y: number } | null>(null);

  // Miro Floating Dock & Islands state
  const [activeFlyout, setActiveFlyout] = useState<'none' | 'sticky' | 'shape' | 'arrow' | 'draw' | 'widgets' | 'docs'>('none');
  const [isBoardsPopoverOpen, setIsBoardsPopoverOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  // network popover centralized in App
  const [selectedShapeVariant, setSelectedShapeVariant] = useState<'rectangle' | 'rounded' | 'circle'>('rectangle');
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
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  const dragDeltaRef = useRef<{ dx: number; dy: number } | null>(null);
  const [isErasing, setIsErasing] = useState(false);

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
    startFontSize?: number;
  } | null>(null);

  // Smart Alignment Guides
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  useEffect(() => {
    setAlignmentGuides([]);
  }, [activeTool]);

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

  // Track active sheet index per workbook node
  const [workbookSheetMap, setWorkbookSheetMap] = useState<Record<string, number>>({});

  // In-place grid editing states
  const [isEditingGrid, setIsEditingGrid] = useState<Record<string, boolean>>({});
  const [activeCellEdit, setActiveCellEdit] = useState<{ nodeId: string; sheetIdx: number; rowIdx: number; colIdx: number } | null>(null);

  // Internal clipboard for copy/paste (nodes + connecting edges)


  // Real-time ghost preview card for drag-and-drop
  const [ghostDropPreview, setGhostDropPreview] = useState<{ x: number; y: number; title: string } | null>(null);

  // Exact cursor canvas coordinates for paste
  const lastMouseCanvasPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastCursorBroadcastRef = useRef<number>(0);
  const lastPasteTimeRef = useRef<number>(0);
  const lastInternalCopyTimeRef = useRef<number>(0);
  const pendingConnectFromRef = useRef<{ fromNodeId: string; fromSide?: PortSide } | null>(null);

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
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false);
  const [isBoardSettingsOpen, setIsBoardSettingsOpen] = useState(false);
  const [settingsTargetBoard, setSettingsTargetBoard] = useState<{ id: string; scope: WorkspaceScope; title: string } | null>(null);
  const [isLanShareOpen, setIsLanShareOpen] = useState(false);
  const [shareModalTab, setShareModalTab] = useState<'share' | 'phone'>('share');
  const [confirmConvertModal, setConfirmConvertModal] = useState<{ isOpen: boolean; targetScope: WorkspaceScope }>({ isOpen: false, targetScope: 'team' });

  // Detect if the board is locked in read-only mode
  const isBoardLockedReadOnly = Boolean(isViewerMode.value);
  const isHostDisconnected = Boolean(!isViewerMode.value && connectionState.value === 'disconnected' && nodesList.length > 0);

  // 2. Clone snapshot into local private vault if host is gone
  const handleSaveAsSolo = () => {
    const currentTitle = currentBoardMeta?.title || 'Shared Board Snapshot';
    const newSoloId = createBoard(`${currentTitle} (Saved)`, null, 'solo', false);

    // Copy all active nodes and edges into the new solo board Y.Doc
    try {
      const targetDocName = getScopedBoardDocName('solo', newSoloId);
      const targetDoc = yjsClient.getOrCreateDoc(targetDocName);
      const { nodes: targetNodes, edges: targetEdges } = getBoardMaps(targetDoc);

      targetDoc.transact(() => {
        // Copy nodes
        yNodes.forEach((nodeMap, nodeId) => {
          if (!nodeMap.get('deleted')) {
            const newNodeMap = new Y.Map();
            nodeMap.forEach((val, key) => {
              newNodeMap.set(key, val);
            });
            targetNodes.set(nodeId, newNodeMap);
          }
        });
        // Copy edges
        yEdges.forEach((edge, edgeId) => {
          if (!edge.deleted) {
            targetEdges.set(edgeId, { ...edge });
          }
        });
      });
    } catch (err) {
      console.error('Failed to clone snapshot nodes:', err);
    }

    showToast('Board saved to your local Solo workspace', 'success');
    setScope('solo');
    selectedBoardId.value = newSoloId;
    selectBoardWithScope(newSoloId, 'solo', currentTitle + ' (Saved)');
  };

  const handleOpenTransferModal = (ids?: string[]) => {
    let targetIds = ids && ids.length > 0 ? ids : Array.from(selectedNodeIds);
    if (targetIds.length === 0) {
      targetIds = nodesList.filter((n) => !n.deleted).map((n) => n.id);
    }
    setTransferNodeIds(targetIds);
    setIsTransferModalOpen(true);
  };

  const handleExportJsonCanvas = () => {
    setIsExportMenuOpen(false);
    const nodes = nodesList.filter((n) => !n.deleted);
    const edges = edgesList.filter((e) => !e.deleted);
    const jsonCanvas = boardToJSONCanvas(nodes, edges);
    const blob = new Blob([JSON.stringify(jsonCanvas, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentBoardMeta?.title || 'board'}.canvas`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t('toast.canvas_downloaded'));
  };

  const handleExportSvg = () => {
    setIsExportMenuOpen(false);
    const allValid = nodesList.filter((n) => !n.deleted);
    const validEdges = edgesList.filter((e) => !e.deleted);
    if (allValid.length === 0 && validEdges.length === 0) {
      showToast(t('toast.empty_board'));
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of allValid) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
    const pad = 40;
    const w = Math.max(200, maxX - minX + pad * 2);
    const h = Math.max(200, maxY - minY + pad * 2);

    const edgesSvg = validEdges.map((e) => {
      const fn = nodeLookup.get(e.from);
      const tn = nodeLookup.get(e.to);
      if (!fn || !tn) return '';
      const p1 = getPortCoord(fn, e.fromSide || 'right');
      const p2 = getPortCoord(tn, e.toSide || 'left');
      const edgeColor = e.color || '#818cf8';
      return `<path d="M ${p1.x} ${p1.y} C ${p1.x + 50} ${p1.y}, ${p2.x - 50} ${p2.y}, ${p2.x} ${p2.y}" fill="none" stroke="${edgeColor}" stroke-width="2" />`;
    }).filter(Boolean).join('\n');

    const nodesSvg = allValid.map((n) => {
      if (n.type === 'drawing') {
        const pathData = n.svgPath || '';
        if (!pathData) return '';
        const color = n.color || '#818cf8';
        return `<g transform="translate(${n.x}, ${n.y})"><path d="${pathData}" fill="none" stroke="${color}" stroke-width="${n.strokeWidth || 4}" stroke-linecap="round" stroke-linejoin="round" /></g>`;
      }
      const color = CANVAS_COLORS[n.color || ''] || '#6366f1';
      const safeText = (n.text || '').replace(/[<>&]/g, '');
      return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="#181b24" stroke="${color}" stroke-width="2" /><text x="${n.x + 12}" y="${n.y + 24}" fill="#f1f5f9" font-size="14">${safeText}</text></g>`;
    }).join('\n');

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${w} ${h}" width="${w}" height="${h}" style="background:#090a0f;">
      <style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style>
      ${edgesSvg}
      ${nodesSvg}
    </svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentBoardMeta?.title || 'board'}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t('toast.svg_exported'));
  };

  // Hidden attachment file input
  const fileAttachmentInputRef = useRef<HTMLInputElement>(null);

  const currentBoardMeta = useMemo(() => {
    return allBoards.value.find((b) => b.id === boardId) || boards.value.find((b) => b.id === boardId);
  }, [allBoards.value, boards.value, boardId]);

  // Dynamically synchronize document title with open board title
  useEffect(() => {
    const title = currentBoardMeta?.title?.trim();
    if (title) {
      document.title = `Doks — ${title}`;
    }
  }, [currentBoardMeta?.title]);

  // Undo manager
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const docName = getScopedBoardDocName(effectiveScope, boardId);
  const boardDoc = yjsClient.getOrCreateDoc(docName);
  const awareness = yjsClient.getOrCreateAwareness(docName);
  const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

  // Map of nodes for quick coordinate lookup (with real-time drag positions)
  const nodeLookup = useMemo(() => {
    const map = new Map<string, BoardNodeData>();
    for (const n of nodesList) {
      if (dragState && dragDelta && dragState.initialPositions.has(n.id)) {
        const init = dragState.initialPositions.get(n.id)!;
        map.set(n.id, { ...n, x: Math.round(init.x + dragDelta.dx), y: Math.round(init.y + dragDelta.dy) });
      } else {
        map.set(n.id, n);
      }
    }
    return map;
  }, [nodesList, dragState, dragDelta]);
  const nodeLookupRef = useRef(nodeLookup);
  nodeLookupRef.current = nodeLookup;

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

  // Kinematic smooth viewport animation state (Miro-Grade Critically Damped RAF)
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const targetViewportRef = useRef(viewport);
  const panStateRef = useRef(panState);
  panStateRef.current = panState;
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const resizeStateRef = useRef(resizeState);
  resizeStateRef.current = resizeState;
  const marqueeBoxRef = useRef(marqueeBox);
  marqueeBoxRef.current = marqueeBox;
  const nodesListRef = useRef(nodesList);
  nodesListRef.current = nodesList;
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const rafIdRef = useRef<number | null>(null);
  const rmbDragDistRef = useRef<number>(0);

  const animateToViewport = useCallback(
    (target: Partial<ViewportCoord>, immediate = false) => {
      const curTarget = targetViewportRef.current;
      const validX = target.x !== undefined && Number.isFinite(target.x) ? target.x : curTarget.x;
      const validY = target.y !== undefined && Number.isFinite(target.y) ? target.y : curTarget.y;
      const validZoom = target.zoom !== undefined && Number.isFinite(target.zoom)
        ? Math.min(Math.max(target.zoom, 0.01), 4.0)
        : curTarget.zoom;

      const nextTarget: ViewportCoord = {
        x: validX,
        y: validY,
        zoom: validZoom
      };
      targetViewportRef.current = nextTarget;

      if (immediate) {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        viewportRef.current = nextTarget;
        setViewport(nextTarget);
        return;
      }

      if (rafIdRef.current !== null) {
        return; // RAF loop is active and will converge on the newly updated targetViewportRef
      }

      const step = () => {
        const cur = viewportRef.current;
        const tgt = targetViewportRef.current;
        const { next, arrived } = stepDampedKinematics(cur, tgt);

        viewportRef.current = next;
        setViewport(next);

        if (arrived) {
          rafIdRef.current = null;
          return;
        }

        rafIdRef.current = requestAnimationFrame(step);
      };

      rafIdRef.current = requestAnimationFrame(step);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const handleZoomByFactor = useCallback((factor: number) => {
    const availW = containerSize.width || window.innerWidth;
    const availH = containerSize.height || window.innerHeight;
    const centerX = availW / 2;
    const centerY = availH / 2;
    const curZoom = targetViewportRef.current.zoom;
    const newZoom = Math.min(Math.max(curZoom * factor, 0.01), 4.0);
    const newX = centerX - (centerX - targetViewportRef.current.x) * (newZoom / curZoom);
    const newY = centerY - (centerY - targetViewportRef.current.y) * (newZoom / curZoom);
    animateToViewport({ x: newX, y: newY, zoom: newZoom }, false);
  }, [containerSize, animateToViewport]);

  const handleResetZoom = useCallback(() => {
    const availW = containerSize.width || window.innerWidth;
    const availH = containerSize.height || window.innerHeight;
    const centerX = availW / 2;
    const centerY = availH / 2;
    const curZoom = targetViewportRef.current.zoom;
    const newZoom = 1.0;
    const newX = centerX - (centerX - targetViewportRef.current.x) * (newZoom / curZoom);
    const newY = centerY - (centerY - targetViewportRef.current.y) * (newZoom / curZoom);
    animateToViewport({ x: newX, y: newY, zoom: newZoom }, false);
  }, [containerSize, animateToViewport]);

  // Viewport virtualization
  
  // Bounded Board Workspace Representation
  const boardBounds = useMemo(() => {
    const activeNodes = nodesList.filter((n) => !n.deleted);
    let minX = -1000;
    let minY = -800;
    let maxX = 3000;
    let maxY = 2200;

    if (activeNodes.length > 0) {
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      for (const n of activeNodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      }
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const haloW = Math.max(4000, contentW + 1200);
    const haloH = Math.max(3000, contentH + 1000);

    return {
      x: Math.round(centerX - haloW / 2),
      y: Math.round(centerY - haloH / 2),
      w: Math.round(haloW),
      h: Math.round(haloH)
    };
  }, [nodesList]);

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
  const visibleNodesRef = useRef<BoardNodeData[]>(visibleNodes);
  visibleNodesRef.current = visibleNodes;

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
      captureTimeout: 300
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
            name: state.cursor.name && state.cursor.name !== 'You' ? state.cursor.name : `Collaborator #${clientId % 1000}`,
            color: state.cursor.color || '#7c8cff'
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
    };
  }, [docName]);

  // Auto-fetch extracted text for document cards missing text
  useEffect(() => {
    for (const node of nodesList) {
      if (
        node.fileHash &&
        !node.extractedText &&
        (node.fileName || '').match(/\.(docx?|xlsx?|txt|md|csv|tsv|json|js|ts|py|html|css|pdf|rtf|odt|ods)$/i)
      ) {
        api.fetch(`/api/attachments/${node.fileHash}/content`)
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
                  if (data.extractedText.includes('"sheets"')) {
                    try {
                      const parsed = JSON.parse(data.extractedText);
                      if (parsed?.sheets?.[0]?.data) {
                        const firstSheet = parsed.sheets[0].data;
                        const cols = firstSheet[0]?.length || 4;
                        const rows = firstSheet.length || 6;
                        const targetW = Math.max(node.w || 360, Math.min(840, Math.max(540, cols * 140)));
                        const targetH = Math.max(node.h || 280, Math.min(600, Math.max(380, 90 + rows * 34)));
                        map.set('w', targetW);
                        map.set('h', targetH);
                      }
                    } catch {}
                  }
                  const isSpreadsheet = (node.fileName || '').match(/\.(xlsx?|csv|tsv|ods)$/i);
                  if (isSpreadsheet && data.extractedText.trim().startsWith('[[')) {
                    try {
                      const parsed = JSON.parse(data.extractedText);
                      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
                        const cols = parsed[0].length || 3;
                        const rows = parsed.length || 3;
                        map.set('type', 'table');
                        map.set('text', data.extractedText);
                        map.set('w', Math.max(node.w, cols * 130));
                        map.set('h', Math.max(node.h, 50 + rows * 38));
                      }
                    } catch {}
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
    const vp = viewportRef.current;
    const x = (clientX - rect.left - vp.x) / vp.zoom;
    const y = (clientY - rect.top - vp.y) / vp.zoom;
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
      const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(effectiveScope, noteId));
      const yText = noteDoc.getText('text');
      if (yText.length === 0 && markdown) {
        yText.insert(0, markdown);
      }
      createNoteCardAt(noteId, x, y);
      showToast(`${t('toast.note_created')}: "${title}"`);
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

  // Zoom to mouse cursor (allowing natural scrolling inside docx/notes/textareas)
  const handleWheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      !e.ctrlKey &&
      !e.metaKey &&
      target.closest('.scrollable-card-content, .node-file-reader-body, .node-inline-textarea, .node-card-content-view')
    ) {
      return;
    }

    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    // Standard Miro / Figma Navigation:
    // 1. Pinch gesture or Ctrl/Cmd + Wheel = Zoom anchored at cursor
    // 2. Shift + Wheel = Horizontal Pan
    // 3. Regular Wheel or 2-finger touchpad swipe = Natural 2D Pan without random zoom jumps
    if (e.ctrlKey || e.metaKey) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const wheelTarget = computeContinuousWheelTarget(
        targetViewportRef.current,
        e.deltaY,
        mouseX,
        mouseY
      );
      animateToViewport(wheelTarget, false);
    } else if (e.shiftKey) {
      animateToViewport({
        x: targetViewportRef.current.x - (e.deltaY || e.deltaX),
        y: targetViewportRef.current.y
      }, false);
    } else {
      animateToViewport({
        x: targetViewportRef.current.x - e.deltaX,
        y: targetViewportRef.current.y - e.deltaY
      }, false);
    }
  };

  // Mobile / Touch gestures (1-finger pan, 2-finger pinch-zoom via Math.hypot)
  const touchStateRef = useRef<{
    initialDist: number | null;
    initialZoom: number;
    lastX: number;
    lastY: number;
    isPinching: boolean;
  }>({
    initialDist: null,
    initialZoom: 1,
    lastX: 0,
    lastY: 0,
    isPinching: false
  });

  const handleTouchStart = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length === 1) {
      touchStateRef.current = {
        initialDist: null,
        initialZoom: targetViewportRef.current.zoom,
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        isPinching: false
      };
    } else if (e.touches.length === 2) {
      const p1 = e.touches[0];
      const p2 = e.touches[1];
      const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      touchStateRef.current = {
        initialDist: dist,
        initialZoom: targetViewportRef.current.zoom,
        lastX: (p1.clientX + p2.clientX) / 2,
        lastY: (p1.clientY + p2.clientY) / 2,
        isPinching: true
      };
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length === 1 && !touchStateRef.current.isPinching) {
      const touch = e.touches[0];
      const dx = touch.clientX - touchStateRef.current.lastX;
      const dy = touch.clientY - touchStateRef.current.lastY;
      touchStateRef.current.lastX = touch.clientX;
      touchStateRef.current.lastY = touch.clientY;

      animateToViewport({
        x: targetViewportRef.current.x + dx,
        y: targetViewportRef.current.y + dy
      }, true);
    } else if (e.touches.length === 2 && touchStateRef.current.initialDist) {
      if (e.cancelable) e.preventDefault();
      const p1 = e.touches[0];
      const p2 = e.touches[1];
      const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      if (dist > 10) {
        const scale = dist / touchStateRef.current.initialDist;
        const newZoom = Math.min(Math.max(touchStateRef.current.initialZoom * scale, 0.01), 4.0);

        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const curZoom = targetViewportRef.current.zoom;
        const newX = midX - (midX - targetViewportRef.current.x) * (newZoom / curZoom);
        const newY = midY - (midY - targetViewportRef.current.y) * (newZoom / curZoom);

        animateToViewport({ x: newX, y: newY, zoom: newZoom }, true);
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      touchStateRef.current.initialDist = null;
      touchStateRef.current.isPinching = false;
    } else if (e.touches.length === 1) {
      touchStateRef.current.initialDist = null;
      touchStateRef.current.isPinching = false;
      touchStateRef.current.lastX = e.touches[0].clientX;
      touchStateRef.current.lastY = e.touches[0].clientY;
    }
  };

  // Native non-passive window wheel listener to prevent native browser page zoom hijacking (Ctrl + Wheel)
  useEffect(() => {
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', preventBrowserZoom, { passive: false });
    return () => window.removeEventListener('wheel', preventBrowserZoom);
  }, []);

  // Attach canvas container wheel listener with { passive: false } for reliable e.preventDefault()
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => handleWheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keyboard shortcuts (Physical keycode layout-independent)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift + 1: True "Fit to Screen" (Miro / FigJam standard)
      if (e.shiftKey && (e.code === 'Digit1' || e.key === '1' || e.key === '!')) {
        if (!isEditableElementFocused()) {
          e.preventDefault();
          fitToContent();
          return;
        }
      }

      // Browser Zoom Key interception: Ctrl/Cmd + Plus, Minus, Zero
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') {
          e.preventDefault();
          handleZoomByFactor(1.25);
          return;
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') {
          e.preventDefault();
          handleZoomByFactor(0.8);
          return;
        }
        if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') {
          e.preventDefault();
          handleResetZoom();
          return;
        }
      }

      // In read-only viewer mode: ignore mutations, tool hotkeys and copy/paste
      if (isViewerMode.value) {
        if (
          e.code === 'Delete' ||
          e.code === 'Backspace' ||
          e.code === 'KeyS' ||
          e.code === 'KeyT' ||
          e.code === 'KeyR' ||
          e.code === 'KeyP' ||
          e.code === 'KeyE' ||
          e.code === 'KeyF' ||
          e.code === 'KeyM' ||
          e.code === 'KeyC' ||
          e.code === 'KeyL' ||
          e.code === 'KeyV' ||
          ((e.ctrlKey || e.metaKey) && ['KeyV', 'KeyD', 'KeyG', 'KeyZ', 'KeyY'].includes(e.code))
        ) {
          e.preventDefault();
          return;
        }
      }

      // Global Undo / Redo: Executed EVEN IF focus is inside an input/textarea of a card
      if (matchShortcut(e, 'mod+z')) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && isEditableElementFocused()) {
          document.activeElement.blur();
        }
        undoManagerRef.current?.undo();
        return;
      }
      if (matchShortcut(e, 'mod+shift+z') || matchShortcut(e, 'mod+y')) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && isEditableElementFocused()) {
          document.activeElement.blur();
        }
        undoManagerRef.current?.redo();
        return;
      }

      // Multi-element delete hotkey: always executes when multiple items are selected
      if ((matchShortcut(e, 'delete') || matchShortcut(e, 'backspace')) && (selectedNodeIds.size > 1 || selectedEdgeId)) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        deleteSelected();
        return;
      }

      // For all subsequent single-key hotkeys, ignore if user is typing inside an editable field
      if (isEditableElementFocused()) return;

      // Spacebar for Pan
      if (e.code === 'Space' && !isSpacePressed) {
        setIsSpacePressed(true);
      }

      // Save (Ctrl+S) - prevent browser Save Page dialog
      if (matchShortcut(e, 'mod+s')) {
        e.preventDefault();
        showToast(currentScope.value === 'solo' ? t('toast.synced_local') : t('toast.synced_p2p'), 'success');
        return;
      }

      // Command palette (Ctrl+P / Ctrl+K) - prevent browser Print dialog
      if (matchShortcut(e, 'mod+p') || matchShortcut(e, 'mod+k')) {
        e.preventDefault();
        isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
        return;
      }

      // Select All (Ctrl+A)
      if (matchShortcut(e, 'mod+a')) {
        e.preventDefault();
        const nonDeletedIds = nodesList.filter((n) => !n.deleted && n.type !== 'drawing').map((n) => n.id);
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

      // Paste (Ctrl+V): let native 'paste' ClipboardEvent fire so handleWindowPaste receives screenshot binary
      if (matchShortcut(e, 'mod+v')) {
        const targetPos = lastMouseCanvasPosRef.current;
        setTimeout(() => {
          if (Date.now() - lastPasteTimeRef.current > 140) {
            pasteClipboard(targetPos.x, targetPos.y);
          }
        }, 120);
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
        if (e.code === 'KeyV') setActiveTool('select');
        if (e.code === 'KeyS') setActiveTool('sticky');
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
        if (e.code === 'KeyC') setActiveTool('arrow');
        if (e.code === 'KeyR') setActiveTool('shape');
        if (e.code === 'KeyK') setActiveTool('checklist');
        if (e.code === 'KeyG') setActiveTool('table');
        if (e.code === 'KeyB') setActiveTool('kanban');
        if (e.code === 'KeyD') setActiveFlyout((prev) => (prev === 'docs' ? 'none' : 'docs'));
        if (e.code === 'KeyL') setActiveTool('line');
        if (e.code === 'KeyM') setIsAutoDiagramModalOpen(true);
        if (e.code === 'KeyI' || e.code === 'KeyU') fileAttachmentInputRef.current?.click();

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
    const idsToDelete = new Set(selectedNodeIds);
    const edgeToDelete = selectedEdgeId;
    if (idsToDelete.size === 0 && !edgeToDelete) return;

    // Filter out locked nodes from deletion
    const nonLockedIds = new Set<string>();
    for (const id of idsToDelete) {
      const node = nodeLookup.get(id);
      if (!node?.locked) {
        nonLockedIds.add(id);
      }
    }

    if (nonLockedIds.size === 0 && !edgeToDelete) return;

    // 1. Optimistic Instant UI Deletion (0ms latency, zero flicker)
    setNodesList((prev) => prev.filter((n) => !nonLockedIds.has(n.id)));
    setEdgesList((prev) =>
      prev.filter(
        (e) =>
          e.id !== edgeToDelete &&
          !nonLockedIds.has(e.from) &&
          !nonLockedIds.has(e.to) &&
          !nonLockedIds.has((e as any).fromNode) &&
          !nonLockedIds.has((e as any).toNode)
      )
    );

    setSelectedNodeIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (!nonLockedIds.has(id)) next.add(id);
      }
      return next;
    });
    if (edgeToDelete) setSelectedEdgeId(null);

    // 2. Commit transaction to Yjs shared doc
    boardDoc.transact(() => {
      for (const id of nonLockedIds) {
        const nodeMap = yNodes.get(id);
        if (nodeMap && !nodeMap.get('locked')) {
          nodeMap.set('deleted', true);
          nodeMap.set('deletedAt', Date.now());
        }
      }
      if (edgeToDelete) {
        const edge = yEdges.get(edgeToDelete);
        if (edge) yEdges.set(edgeToDelete, { ...edge, deleted: true, deletedAt: Date.now() });
      }
      // Also mark incident edges as deleted
      yEdges.forEach((edge, edgeId) => {
        if (
          edge &&
          !edge.deleted &&
          (nonLockedIds.has(edge.from) ||
            nonLockedIds.has(edge.to) ||
            nonLockedIds.has((edge as any).fromNode) ||
            nonLockedIds.has((edge as any).toNode))
        ) {
          yEdges.set(edgeId, { ...edge, deleted: true, deletedAt: Date.now() });
        }
      });
    }, CANVAS_UNDO_ORIGIN);
  };

  // Delete a single node by id along with its incident edges
  const deleteSingleNode = (id: string) => {
    // 1. Optimistic Instant UI Deletion (0ms latency, zero flicker)
    setNodesList((prev) => prev.filter((n) => n.id !== id));
    setEdgesList((prev) => prev.filter((e) => e.from !== id && e.to !== id && (e as any).fromNode !== id && (e as any).toNode !== id));
    setSelectedNodeIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    // 2. Commit transaction to Yjs shared doc
    boardDoc.transact(() => {
      const nodeMap = yNodes.get(id);
      if (nodeMap && !nodeMap.get('locked')) {
        nodeMap.set('deleted', true);
        nodeMap.set('deletedAt', Date.now());
      }
      yEdges.forEach((edge, edgeId) => {
        if (edge && !edge.deleted && (edge.from === id || edge.to === id || (edge as any).fromNode === id || (edge as any).toNode === id)) {
          yEdges.set(edgeId, { ...edge, deleted: true, deletedAt: Date.now() });
        }
      });
    }, CANVAS_UNDO_ORIGIN);
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
    globalBoardClipboard.nodes = selectedNodes;
    globalBoardClipboard.edges = connectedEdges;
    globalBoardClipboard.copiedAt = Date.now();
    globalBoardClipboard.sourceScope = effectiveScope;
    lastInternalCopyTimeRef.current = Date.now();
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText('__DOKS_INTERNAL_NODES__').catch(() => {});
    }
    showToast(`${t('toast.copied')}: ${selectedNodes.length}`);
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
  const pasteClipboard = async (targetWorldX?: number, targetWorldY?: number) => {
    const targetPos = (targetWorldX !== undefined && targetWorldY !== undefined && targetWorldX !== 0 && targetWorldY !== 0)
      ? { x: targetWorldX, y: targetWorldY }
      : (lastMouseCanvasPosRef.current && lastMouseCanvasPosRef.current.x !== 0)
        ? lastMouseCanvasPosRef.current
        : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);

    // If internal Doks clipboard has items and was copied recently, prioritize it over stale OS images!
    const { nodes: clipNodes, edges: clipEdges } = globalBoardClipboard;
    const isRecentInternalCopy = clipNodes.length > 0 && (Date.now() - globalBoardClipboard.copiedAt < 300000);

    if (!isRecentInternalCopy) {
      // 1. Check if system clipboard has an image (async Clipboard API)
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imgType = item.types.find((t) => t.startsWith('image/'));
            if (imgType) {
              const blob = await item.getType(imgType);
              const file = new File([blob], 'screenshot.png', { type: imgType });
              await handleUploadFileToBoard(file, targetPos.x, targetPos.y);
              return;
            }
          }
        } catch {
          // Proceed to internal clipboard if permission denied or unavailable
        }
      }
    }

    // 2. Check internal Doks clipboard (nodes + edges)
    if (clipNodes.length > 0) {
      lastInternalCopyTimeRef.current = Date.now();
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
      return;
    }

    // 3. Fallback: check text from clipboard to create a sticky note
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().length > 0) {
          createNodeAt('sticky', targetPos.x - 100, targetPos.y - 65, activeColor, text.trim());
        }
      } catch {}
    }
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
        text: t('canvas.frame_default_title'),
        color: 'default',
        author: agentStatus.value?.memberName || 'User',
        z: 0,
        deleted: false,
        locked: false
      });
    }, CANVAS_UNDO_ORIGIN);

    setSelectedNodeIds(new Set([frameId]));
    showToast(t('toast.frame_grouped'));
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
  const createNodeAt = (
    type: BoardNodeType,
    x: number,
    y: number,
    color = activeColor,
    initialText = '',
    fileHash?: string
  ) => {
    const id = crypto.randomUUID();
    const nodeMap = new Y.Map();
    const isFrame = type === 'frame';
    const isNote = type === 'note';
    const isChecklist = type === 'checklist';
    const isTable = type === 'table';
    const isKanban = type === 'kanban';
    const isCode = type === 'code';
    const isImage = type === 'image';
    const isChart = type === 'chart';

    let defaultText = initialText;
    if (!defaultText) {
      if (isFrame) defaultText = t('canvas.frame');
      else if (isNote) defaultText = t('canvas.note');
      else if (isChecklist) defaultText = `- [ ] ${t('widget.task')} 1\n- [ ] ${t('widget.task')} 2\n- [ ] ${t('widget.task')} 3`;
      else if (isTable) defaultText = JSON.stringify([[t('widget.col_header') + ' 1', t('widget.col_header') + ' 2', t('widget.col_header') + ' 3'], ['', '', ''], ['', '', '']]);
      else if (isKanban) defaultText = t('widget.todo');
      else if (isCode) defaultText = `// ${t('widget.code_placeholder')}\nfunction main() {\n  return 42;\n}`;
      else if (isChart) defaultText = t('widget.chart');
      else defaultText = type === 'text' ? t('canvas.text') : '';
    }

    let defaultW = 200;
    let defaultH = 130;
    if (isFrame) { defaultW = 420; defaultH = 320; }
    else if (type === 'text') { defaultW = 220; defaultH = 80; }
    else if (isChecklist) { defaultW = 280; defaultH = 220; }
    else if (isTable) { defaultW = 340; defaultH = 180; }
    else if (isKanban) { defaultW = 280; defaultH = 420; }
    else if (isCode) { defaultW = 360; defaultH = 220; }
    else if (isImage) { defaultW = 320; defaultH = 240; }
    else if (isChart) { defaultW = 380; defaultH = 360; }

    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type,
        x: Math.round(x),
        y: Math.round(y),
        w: defaultW,
        h: defaultH,
        text: defaultText,
        color: (type === 'sticky' || isKanban || type === 'shape') ? color : 'default',
        author: agentStatus.value?.memberName || 'User',
        done: false,
        z: isFrame ? 0 : 1,
        deleted: false,
        locked: false,
        fileHash: fileHash || undefined,
        codeLanguage: isCode ? 'typescript' : undefined,
        shapeVariant: type === 'shape' ? selectedShapeVariant : undefined,
        chartType: isChart ? 'pie' : undefined,
        chartData: isChart
          ? [
              { id: '1', label: `${t('widget.category')} A`, value: 75, color: '#6366f1' },
              { id: '2', label: `${t('widget.category')} B`, value: 25, color: '#10b981' }
            ]
          : undefined
      });
    }, 'user');

    // Auto-return to Select tool and focus new node for instant text editing
    setActiveTool('select');
    setActiveFlyout('none');
    startEditingNode(id, true);
    return id;
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
        author: agentStatus.value?.memberName || 'User',
        done: false,
        z: 1,
        deleted: false,
        locked: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
    return id;
  };

  // In-place Excel Cell Change handler
  const handleWorkbookCellChange = (nodeId: string, sheetIdx: number, rowIdx: number, colIdx: number, newVal: string) => {
    const map = yNodes.get(nodeId);
    if (!map) return;
    const rawText = map.get('extractedText');
    if (!rawText) return;
    try {
      if (rawText.includes('"sheets"')) {
        const parsed = JSON.parse(rawText);
        if (parsed?.sheets?.[sheetIdx]?.data) {
          if (!parsed.sheets[sheetIdx].data[rowIdx]) {
            parsed.sheets[sheetIdx].data[rowIdx] = [];
          }
          parsed.sheets[sheetIdx].data[rowIdx][colIdx] = newVal;
          boardDoc.transact(() => {
            map.set('extractedText', JSON.stringify(parsed));
          }, 'cell-edit');
        }
      } else if (rawText.trim().startsWith('[[')) {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed) && parsed[rowIdx]) {
          parsed[rowIdx][colIdx] = newVal;
          boardDoc.transact(() => {
            map.set('extractedText', JSON.stringify(parsed));
          }, 'cell-edit');
        }
      }
    } catch (err) {
      console.error('Workbook cell edit failed:', err);
    }
  };

  // Creation helpers for Documents & Sheets
  const createNewCanvasSpreadsheet = () => {
    const id = crypto.randomUUID();
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
    const w = 580;
    const h = 340;

    const initialWorkbook = {
      type: 'workbook',
      sheets: [
        {
          name: 'Sheet 1',
          data: [
            ['Item', 'Description', 'Quantity', 'Price', 'Status'],
            ['Project Alpha', 'Design system tokens', '1', '$1,200', 'Active'],
            ['Project Beta', 'Infinite canvas engine', '2', '$3,400', 'In Review'],
            ['Project Gamma', 'CRDT sync pipelines', '1', '$2,800', 'Done'],
            ['', '', '', '', '']
          ]
        },
        {
          name: 'Sheet 2',
          data: [
            ['Metric', 'Target', 'Actual', 'Variance'],
            ['FPS', '120', '120', '0'],
            ['Sync Latency', '< 15ms', '8ms', '-7ms']
          ]
        }
      ]
    };

    const nodeMap = new Y.Map();
    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type: 'file',
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        w,
        h,
        text: 'Spreadsheet.xlsx',
        fileName: 'Spreadsheet.xlsx',
        extractedText: JSON.stringify(initialWorkbook),
        showPreview: true,
        author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
        done: false,
        z: 2,
        deleted: false,
        locked: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
    showToast('Created New Spreadsheet (Excel)', 'success');
  };

  const createNewCanvasDoc = () => {
    const id = crypto.randomUUID();
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
    const w = 440;
    const h = 560;

    const initialDoc = `# Project Specification

## 1. Overview
High-performance local-first infinite canvas for collaborative product architecture.

## 2. Key Objectives
- **Zero-Latency CRDTs:** Peer-to-peer state replication powered by Yjs.
- **Vector Surface Scaling:** Responsive typography and layout primitives.
- **Embedded Documents:** Native multi-sheet spreadsheets and vector PDF sheets.

## 3. Action Items
- [ ] Review sprint deliverables
- [ ] Verify 120 FPS canvas kinematics
- [ ] Validate OpenXML multi-sheet stream parser
`;

    const nodeMap = new Y.Map();
    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type: 'file',
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        w,
        h,
        text: 'Document.docx',
        fileName: 'Document.docx',
        extractedText: initialDoc,
        showPreview: true,
        author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
        done: false,
        z: 2,
        deleted: false,
        locked: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
    showToast('Created New Document (Word)', 'success');
  };

  const createNewCanvasPdfPage = () => {
    const id = crypto.randomUUID();
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
    const w = 480;
    const h = 680;

    const initialPdf = `# Executive Summary (A4 Document)

---

### Project Architecture & Status

**Document ID:** DOC-${Math.floor(1000 + Math.random() * 9000)}  
**Classification:** Confidential / Team Internal  
**Scope:** Architecture Review

---

#### Key Metrics
| Milestone | Status | Target Date |
| :--- | :---: | :--- |
| Core Canvas Engine | Complete | Q1 |
| Yjs P2P Sync | Complete | Q2 |
| Multi-Sheet Excel Parser | Active | Q3 |
| Production Hardening | In Progress | Q4 |

> Note: All canvas nodes and vector paths are synchronised via local-first CRDTs with cryptographic peer handshakes.
`;

    const nodeMap = new Y.Map();
    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type: 'file',
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        w,
        h,
        text: 'Page.pdf',
        fileName: 'Page.pdf',
        extractedText: initialPdf,
        showPreview: true,
        author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
        done: false,
        z: 2,
        deleted: false,
        locked: false
      });
    }, 'user');

    setSelectedNodeIds(new Set([id]));
    setActiveTool('select');
    showToast('Created New Page (PDF A4)', 'success');
  };

  // Checklist helpers
  const parseChecklistItems = (text: string) => {
    return text.split('\n').filter(l => l.trim().length > 0).map((line, idx) => ({
      id: `item-${idx}`,
      text: line.replace(/^-\s*\[[ xX]\]\s*/, '').trim(),
      done: line.trim().startsWith('- [x]') || line.trim().startsWith('- [X]')
    }));
  };

  const serializeChecklistItems = (items: { text: string; done: boolean }[]) => {
    return items.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n');
  };

  const handleToggleChecklistItem = (node: BoardNodeData, idx: number) => {
    const items = parseChecklistItems(node.text);
    if (items[idx]) {
      items[idx].done = !items[idx].done;
      const newText = serializeChecklistItems(items);
      const map = yNodes.get(node.id);
      if (map) setNodeProperties(map, { text: newText });
    }
  };

  const handleUpdateChecklistText = (node: BoardNodeData, idx: number, val: string) => {
    const items = parseChecklistItems(node.text);
    if (items[idx]) {
      items[idx].text = val;
      const newText = serializeChecklistItems(items);
      const map = yNodes.get(node.id);
      if (map) setNodeProperties(map, { text: newText });
    }
  };

  const handleDeleteChecklistItem = (node: BoardNodeData, idx: number) => {
    const items = parseChecklistItems(node.text);
    items.splice(idx, 1);
    const newText = serializeChecklistItems(items);
    const map = yNodes.get(node.id);
    if (map) setNodeProperties(map, { text: newText });
  };

  const handleAddChecklistItem = (node: BoardNodeData) => {
    const items = parseChecklistItems(node.text);
    items.push({ id: `item-${items.length}`, text: t('widget.new_task'), done: false });
    const newText = serializeChecklistItems(items);
    const map = yNodes.get(node.id);
    if (map) setNodeProperties(map, { text: newText });
  };

  // Table helpers
  const parseTableData = (rawText: any): string[][] => {
    try {
      const text = typeof rawText === 'string' ? rawText : (rawText && typeof rawText.toString === 'function' ? rawText.toString() : '');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
        return parsed;
      }
    } catch {}
    return [[t('widget.col_header') + ' 1', t('widget.col_header') + ' 2', t('widget.col_header') + ' 3'], ['', '', ''], ['', '', '']];
  };

  const tableDebounceTimers = useRef<Map<string, any>>(new Map());
  const kanbanDebounceTimers = useRef<Map<string, any>>(new Map());

  // Synchronously update table cell and persist to CRDT
  const handleUpdateTableCell = (node: BoardNodeData, rIdx: number, cIdx: number, val: string) => {
    const map = yNodes.get(node.id);
    if (!map) return;
    const textVal = map.get('text');
    const currentText = typeof textVal === 'string' ? textVal : (textVal?.toString ? textVal.toString() : (node.text || ''));
    const table = parseTableData(currentText);
    if (table[rIdx] && table[rIdx][cIdx] !== undefined) {
      table[rIdx][cIdx] = val;
      setNodeProperties(map, { text: JSON.stringify(table) });
    }
  };

  const handleAddTableRow = (node: BoardNodeData) => {
    const map = yNodes.get(node.id);
    const currentText = map ? (map.get('text')?.toString ? map.get('text').toString() : map.get('text')) : node.text;
    const table = parseTableData(currentText);
    const cols = table[0]?.length || 3;
    table.push(Array(cols).fill(''));
    if (map) setNodeProperties(map, { text: JSON.stringify(table) });
  };

  const handleAddTableCol = (node: BoardNodeData) => {
    const map = yNodes.get(node.id);
    const currentText = map ? (map.get('text')?.toString ? map.get('text').toString() : map.get('text')) : node.text;
    const table = parseTableData(currentText);
    for (const row of table) row.push('');
    if (map) setNodeProperties(map, { text: JSON.stringify(table) });
  };

  const handleDelTableRow = (node: BoardNodeData) => {
    const map = yNodes.get(node.id);
    const currentText = map ? (map.get('text')?.toString ? map.get('text').toString() : map.get('text')) : node.text;
    const table = parseTableData(currentText);
    if (table.length > 1) {
      table.pop();
      if (map) setNodeProperties(map, { text: JSON.stringify(table) });
    }
  };

  const handleDelTableCol = (node: BoardNodeData) => {
    const map = yNodes.get(node.id);
    const currentText = map ? (map.get('text')?.toString ? map.get('text').toString() : map.get('text')) : node.text;
    const table = parseTableData(currentText);
    if (table[0]?.length > 1) {
      for (const row of table) row.pop();
      if (map) setNodeProperties(map, { text: JSON.stringify(table) });
    }
  };

  // Kanban helpers
  const parseKanbanCards = (text: string | undefined): string[] => {
    if (text === undefined) return [t('widget.new_task'), t('widget.in_progress')];
    if (!text) return [];
    return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  };

  const handleAddKanbanCard = (node: BoardNodeData) => {
    const cards = parseKanbanCards(node.description);
    cards.push(t('widget.new_card'));
    const map = yNodes.get(node.id);
    if (map) {
      setNodeProperties(map, {
        description: cards.join('\n')
      });
    }
  };

  // Audit 2.5: Debounced kanban card update to prevent concurrent editing overwrites
  const handleUpdateKanbanCard = (node: BoardNodeData, idx: number, val: string) => {
    const timerKey = `${node.id}:${idx}`;
    const existing = kanbanDebounceTimers.current.get(timerKey);
    if (existing) clearTimeout(existing);

    kanbanDebounceTimers.current.set(
      timerKey,
      setTimeout(() => {
        kanbanDebounceTimers.current.delete(timerKey);
        const map = yNodes.get(node.id);
        if (!map) return;
        const currentDesc = (map.get('description') as string) || '';
        const cards = parseKanbanCards(currentDesc);
        if (cards[idx] !== undefined) {
          cards[idx] = val;
          setNodeProperties(map, { description: cards.join('\n') });
        }
      }, 200)
    );
  };

  const handleDeleteKanbanCard = (node: BoardNodeData, idx: number) => {
    const cards = parseKanbanCards(node.description);
    cards.splice(idx, 1);
    const map = yNodes.get(node.id);
    if (map) setNodeProperties(map, { description: cards.join('\n') });
  };

  // Upload attachment file and place block or image on board
  const handleUploadFileToBoard = async (file: File, x: number, y: number) => {
    try {
      const buffer = await file.arrayBuffer();
      const fileName = file.name || 'document.bin';
      const fileType = file.type || '';
      const res = await api.fetch(`/api/attachments?scope=${encodeURIComponent(effectiveScope)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(fileName)
        },
        body: buffer
      });
      if (!res.ok) {
        showToast(`Failed to upload "${fileName}" (${res.status})`, 'error');
        return;
      }
      const data = await res.json();
      const id = crypto.randomUUID();
      const nodeMap = new Y.Map();
      const isImage = (data.mimeType || fileType || '').startsWith('image/') && !((data.mimeType || '').includes('svg'));
      const isPdf = (data.mimeType || '').includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
      const hasTextPreview = Boolean(data.extractedText);

      let fileDataUrl: string | undefined;
      if (file.size <= 8 * 1024 * 1024) {
        try {
          fileDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        } catch {}
      }

      // If file is an Excel spreadsheet or CSV with tabular data, create a native interactive Table widget!
      const isSpreadsheet = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls') || fileName.toLowerCase().endsWith('.csv');
      if (isSpreadsheet && data.extractedText && (data.extractedText.includes('"sheets"') || data.extractedText.trim().startsWith('[['))) {
        try {
          const parsed = JSON.parse(data.extractedText);
          if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
            const cols = parsed[0].length || 3;
            const rows = parsed.length || 3;
            const tableW = Math.max(340, cols * 130);
            const tableH = Math.max(180, 50 + rows * 38);
            boardDoc.transact(() => {
              yNodes.set(id, nodeMap);
              setNodeProperties(nodeMap, {
                id,
                type: 'table',
                x: Math.round(x - tableW / 2),
                y: Math.round(y - tableH / 2),
                w: tableW,
                h: tableH,
                text: data.extractedText,
                fileName,
                fileHash: data.hash,
                author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
                done: false,
                z: 2,
                deleted: false,
                locked: false
              });
            }, 'user');
            setSelectedNodeIds(new Set([id]));
            setActiveTool('select');
            showToast(`Spreadsheet imported as Table: "${fileName}"`, 'success');
            return;
          }
        } catch {}
      }

      // Calculate proper image and document dimensions
      const isWord = /\.(docx?|rtf|odt)$/i.test(fileName);
      let w = 280;
      let h = 200;
      if (isImage) {
        try {
          const img = new Image();
          const objUrl = fileDataUrl || URL.createObjectURL(file);
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = objUrl;
          });
          if (img.naturalWidth && img.naturalHeight) {
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            const maxW = 540;
            const maxH = 400;
            const ratio = Math.min(maxW / nw, maxH / nh, 1);
            w = Math.max(100, Math.round(nw * ratio));
            h = Math.max(60, Math.round(nh * ratio));
          }
          if (!fileDataUrl) URL.revokeObjectURL(objUrl);
        } catch {}
      } else if (isPdf || isWord) {
        w = 420;
        h = 540;
      } else if (/\.(xlsx?|xls|ods)$/i.test(fileName)) {
        w = 640;
        h = 480;
      } else if (hasTextPreview) {
        w = 360;
        h = 280;
      } else {
        w = 240;
        h = 130;
      }

      boardDoc.transact(() => {
        yNodes.set(id, nodeMap);
        setNodeProperties(nodeMap, {
          id,
          type: isImage ? 'image' : 'file',
          x: Math.round(x - w / 2),
          y: Math.round(y - h / 2),
          w,
          h,
          text: fileName,
          fileHash: data.hash,
          fileName,
          extractedText: data.extractedText,
          fileDataUrl,
          imageUrl: fileDataUrl || `/api/attachments/${data.hash}`,
          uploaderOrigin: window.location.origin,
          showPreview: hasTextPreview || isPdf,
          author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
          done: false,
          z: 2,
          deleted: false,
          locked: false
        });
      }, 'user');

      setSelectedNodeIds(new Set([id]));
      setActiveTool('select');
      showToast(isImage ? t('toast.screenshot_pasted') : `${t('toast.file_uploaded')}: "${fileName}"`);
    } catch (err) {
      console.error('Failed to upload file to board:', err);
    }
  };

  // Listen for dropping note from Notes Drawer or pasting image files from clipboard
  useEffect(() => {
    const handleDropNoteEvent = (e: any) => {
      const detail = e.detail;
      if (!detail || !detail.noteId) return;
      const pos = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      createNoteCardAt(detail.noteId, pos.x - 120, pos.y - 80);
      showToast(`${t('canvas.note')} "${detail.title || t('canvas.note')}" ${t('canvas.added_to_board') || ''}`);
    };

    const handleWindowPaste = async (e: ClipboardEvent) => {
      lastPasteTimeRef.current = Date.now();

      // 1. Prioritize explicit image paste from OS (screenshots, image files)
      const items = e.clipboardData?.items;
      let hasImage = false;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            hasImage = true;
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              e.stopPropagation();
              const targetPos = (lastMouseCanvasPosRef.current && lastMouseCanvasPosRef.current.x !== 0)
                ? lastMouseCanvasPosRef.current
                : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
              await handleUploadFileToBoard(file, targetPos.x, targetPos.y);
              return;
            }
          }
        }
      }

      // 2. Check if internal Doks nodes were copied
      const textPlain = e.clipboardData?.getData('text/plain');
      const isInternalExplicit = textPlain === '__DOKS_INTERNAL_NODES__' || (!hasImage && globalBoardClipboard.nodes.length > 0 && Date.now() - globalBoardClipboard.copiedAt < 60000);

      if (isInternalExplicit && globalBoardClipboard.nodes.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const targetPos = (lastMouseCanvasPosRef.current && lastMouseCanvasPosRef.current.x !== 0)
          ? lastMouseCanvasPosRef.current
          : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        pasteClipboard(targetPos.x, targetPos.y);
        return;
      }

      // If an input/textarea is focused and it's not an image, allow standard native text paste
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      // 2. If no image, check internal Doks clipboard (copied nodes/edges)
      const { nodes: clipNodes } = globalBoardClipboard;
      if (clipNodes.length > 0) {
        e.preventDefault();
        const targetPos = (lastMouseCanvasPosRef.current && lastMouseCanvasPosRef.current.x !== 0)
          ? lastMouseCanvasPosRef.current
          : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        pasteClipboard(targetPos.x, targetPos.y);
        return;
      }

      // 3. Fallback: if plain text in clipboardData, paste as a sticky note on the canvas
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim().length > 0) {
        e.preventDefault();
        const targetPos = (lastMouseCanvasPosRef.current && lastMouseCanvasPosRef.current.x !== 0)
          ? lastMouseCanvasPosRef.current
          : screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        createNodeAt('sticky', targetPos.x - 100, targetPos.y - 65, activeColor, text.trim());
      }
    };

    const handleFocusNode = (e: any) => {
      const nodeId = e.detail?.nodeId;
      if (!nodeId) return;
      const target = nodeLookup.get(nodeId);
      if (target) {
        setSelectedNodeIds(new Set([nodeId]));
        const availW = containerSize.width || window.innerWidth;
        const availH = containerSize.height || window.innerHeight;
        const cx = target.x + target.w / 2;
        const cy = target.y + target.h / 2;
        animateToViewport({
          x: availW / 2 - cx * viewport.zoom,
          y: availH / 2 - cy * viewport.zoom,
          zoom: Math.max(0.8, viewport.zoom)
        }, false);
      }
    };

    const handleExportJsonEvent = () => handleExportJsonCanvas();
    const handleExportSvgEvent = () => handleExportSvg();
    const handleOpenCreateBoardEvent = () => setIsCreateBoardOpen(true);

    window.addEventListener('doks:drop-note', handleDropNoteEvent);
    window.addEventListener('doks-focus-node', handleFocusNode);
    window.addEventListener('doks:export-json', handleExportJsonEvent);
    window.addEventListener('doks:export-svg', handleExportSvgEvent);
    window.addEventListener('doks:open-create-board', handleOpenCreateBoardEvent);
    window.addEventListener('paste', handleWindowPaste);
    return () => {
      window.removeEventListener('doks:drop-note', handleDropNoteEvent);
      window.removeEventListener('doks-focus-node', handleFocusNode);
      window.removeEventListener('doks:export-json', handleExportJsonEvent);
      window.removeEventListener('doks:export-svg', handleExportSvgEvent);
      window.removeEventListener('doks:open-create-board', handleOpenCreateBoardEvent);
      window.removeEventListener('paste', handleWindowPaste);
    };
  }, [boardDoc, yNodes, viewport, nodeLookup, containerSize]);

  // Sticky / Node Chaining: create next node on Tab or Shift+Enter
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
        type: sourceNode.type === 'shape' ? 'shape' : 'sticky',
        shapeVariant: sourceNode.shapeVariant,
        x: Math.round(newX),
        y: Math.round(newY),
        w: sourceNode.w,
        h: sourceNode.h,
        text: '',
        color: sourceNode.color || activeColor,
        author: agentStatus.value?.memberName || 'User',
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
    startEditingNode(newId, true);
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

    showToast(t('toast.graph_aligned'));
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
          author: effectiveScope === 'team' ? (agentStatus.value?.memberName || '') : '',
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
      animateToViewport({
        x: Math.round(window.innerWidth / 2 - genNodes[0].x - 100),
        y: Math.round(window.innerHeight / 2 - genNodes[0].y - 50),
        zoom: 1
      }, false);
      setSelectedNodeIds(new Set(genNodes.map((n) => n.id)));
    }
    showToast(`${t('toast.created')}: ${genNodes.length} / ${genEdges.length}`);
  };

  // Global Pointer Events
  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (activeToolRef.current === 'draw' || activeToolRef.current === 'line') {
        setCursorScreenPos({ x: e.clientX, y: e.clientY });
      } else {
        setCursorScreenPos(null);
      }
      const pos = screenToCanvas(e.clientX, e.clientY);
      lastMouseCanvasPosRef.current = pos;
      const now = performance.now();
      if (now - lastCursorBroadcastRef.current > 32) {
        lastCursorBroadcastRef.current = now;
        const collaborator = getLocalCollaborator();
        awareness.setLocalStateField('cursor', {
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          name: collaborator.name,
          color: collaborator.color
        });
      }

      // Panning (immediate 1:1 direct pointer tracking)
      const currentPanState = panStateRef.current;
      if (currentPanState) {
        const dx = e.clientX - currentPanState.startX;
        const dy = e.clientY - currentPanState.startY;
        if ((currentPanState as any).isRmb) {
          rmbDragDistRef.current = Math.hypot(dx, dy);
        }
        animateToViewport({
          x: currentPanState.originX + dx,
          y: currentPanState.originY + dy
        }, true);
      }

      // Drawing in-progress (Freehand or Straight Marker Line)
      if (currentStrokeRef.current) {
        const currentTool = activeToolRef.current;
        if (currentTool === 'line') {
          const start = currentStrokeRef.current[0];
          let end = pos;
          if (e.shiftKey) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const angle = Math.atan2(dy, dx);
            const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            const dist = Math.hypot(dx, dy);
            end = {
              x: start.x + dist * Math.cos(snappedAngle),
              y: start.y + dist * Math.sin(snappedAngle)
            };
          }
          const next = [start, end];
          currentStrokeRef.current = next;
          setCurrentStroke(next);
        } else {
          const next = [...currentStrokeRef.current, pos];
          currentStrokeRef.current = next;
          setCurrentStroke(next);
        }
      }

      // Eraser dragging over drawing nodes
      if (activeTool === 'eraser' && (e.buttons === 1 || e.buttons === 2 || isErasing)) {
        const ERASE_PAD = 18 / viewport.zoom;
        const hitDrawing = nodesList.find((n) => isPointHittingDrawing(pos, n, ERASE_PAD));
        if (hitDrawing) {
          deleteSingleNode(hitDrawing.id);
        }
      }

      // Live edge reconnection handle drag
      if (reconnectEdgeStateRef.current) {
        const edge = yEdges.get(reconnectEdgeStateRef.current.edgeId);
        const oppositeNodeId = reconnectEdgeStateRef.current.which === 'from' ? (edge?.to || '') : (edge?.from || '');
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const snapped = findMagneticTargetPort(boxNodes, oppositeNodeId, pos.x, pos.y, 28);
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
      const currentDragState = dragStateRef.current;
      const currentVp = viewportRef.current;
      if (currentDragState) {
        let dx = (e.clientX - currentDragState.startX) / currentVp.zoom;
        let dy = (e.clientY - currentDragState.startY) / currentVp.zoom;
        const GRID_SIZE = 16;
        let guides: AlignmentGuide[] = [];

        // Check alignment against other visible nodes (if single node dragged and not holding Alt)
        const currentSelIds = selectedNodeIdsRef.current;
        const currentLookup = nodeLookupRef.current;
        const currentVisNodes = visibleNodesRef.current;
        if (currentSelIds.size === 1 && !e.altKey) {
          const activeId = Array.from(currentSelIds)[0];
          const activeInitial = currentDragState.initialPositions.get(activeId);
          const activeNode = currentLookup.get(activeId);

          if (activeInitial && activeNode) {
            const rawBox: BoxRect = {
              id: activeId,
              x: activeInitial.x + dx,
              y: activeInitial.y + dy,
              w: activeNode.w,
              h: activeNode.h
            };
            const snapThreshold = 6 / currentVp.zoom;
            const candidates: BoxRect[] = currentVisNodes
              .filter((n) => {
                if (n.id === activeId || n.deleted || n.type === 'drawing') return false;
                if (currentSelIds.has(n.id)) return false;
                if (Math.abs(n.x - rawBox.x) > 3000 || Math.abs(n.y - rawBox.y) > 3000) return false;
                return true;
              })
              .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));

            const snapRes = computeSmartAlignment(rawBox, candidates, snapThreshold);
            dx = snapRes.snappedX - activeInitial.x;
            dy = snapRes.snappedY - activeInitial.y;
            guides = snapRes.guides;
          }
        }
        setAlignmentGuides(guides);

        if (snapToGrid && guides.length === 0 && !e.altKey) {
          dx = Math.round(dx / GRID_SIZE) * GRID_SIZE;
          dy = Math.round(dy / GRID_SIZE) * GRID_SIZE;
        } else {
          dx = Math.round(dx);
          dy = Math.round(dy);
        }
        dragDeltaRef.current = { dx, dy };
        setDragDelta({ dx, dy });
      }

      // 8-Point Resizing with Smart Alignment Guides
      const currentResizeState = resizeStateRef.current;
      if (currentResizeState) {
        const dx = (e.clientX - currentResizeState.startX) / currentVp.zoom;
        const dy = (e.clientY - currentResizeState.startY) / currentVp.zoom;
        const nodeMap = yNodes.get(currentResizeState.nodeId);

        if (nodeMap) {
          const { handle, startW, startH, startXPos, startYPos } = currentResizeState;
          let newW = startW;
          let newH = startH;
          let newX = startXPos;
          let newY = startYPos;

          const nodeType = (nodeMap.get('type') as string) || 'sticky';
          const isImage =
            nodeType === 'image' ||
            ((nodeMap.get('fileName') as string || '').match(/\.(png|jpe?g|gif|webp)$/i) && !nodeMap.get('extractedText'));
          const isCircle = nodeType === 'shape' && (nodeMap.get('shapeVariant') as string) === 'circle';

          // Proportional aspect-ratio resizing for images, circles, and charts on corner handles (Shift toggles freeform)
          const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
          const isProportionalWidget = isImage || isCircle || nodeType === 'chart' || nodeType === 'checklist' || nodeType === 'table' || nodeType === 'kanban' || nodeType === 'code' || nodeType === 'text';
          const keepProportional = (isProportionalWidget || e.shiftKey) && !(isProportionalWidget && e.shiftKey);

          if (keepProportional && isCorner) {
            const ratio = (startW > 0 && startH > 0) ? (startW / startH) : 1;
            if (handle === 'se') {
              if (Math.abs(dx) >= Math.abs(dy * ratio)) {
                newW = Math.max(60, startW + dx);
                newH = Math.max(40, Math.round(newW / ratio));
              } else {
                newH = Math.max(40, startH + dy);
                newW = Math.max(60, Math.round(newH * ratio));
              }
            } else if (handle === 'sw') {
              if (Math.abs(-dx) >= Math.abs(dy * ratio)) {
                newW = Math.max(60, startW - dx);
                newH = Math.max(40, Math.round(newW / ratio));
              } else {
                newH = Math.max(40, startH + dy);
                newW = Math.max(60, Math.round(newH * ratio));
              }
              newX = startXPos + (startW - newW);
            } else if (handle === 'ne') {
              if (Math.abs(dx) >= Math.abs(-dy * ratio)) {
                newW = Math.max(60, startW + dx);
                newH = Math.max(40, Math.round(newW / ratio));
              } else {
                newH = Math.max(40, startH - dy);
                newW = Math.max(60, Math.round(newH * ratio));
              }
              newY = startYPos + (startH - newH);
            } else if (handle === 'nw') {
              if (Math.abs(-dx) >= Math.abs(-dy * ratio)) {
                newW = Math.max(60, startW - dx);
                newH = Math.max(40, Math.round(newW / ratio));
              } else {
                newH = Math.max(40, startH - dy);
                newW = Math.max(60, Math.round(newH * ratio));
              }
              newX = startXPos + (startW - newW);
              newY = startYPos + (startH - newH);
            }
          } else {
            if (handle.includes('e')) {
              newW = Math.max(80, startW + dx);
            }
            if (handle.includes('w')) {
              newW = Math.max(80, startW - dx);
              newX = startXPos + (startW - newW);
            }
            if (handle.includes('s')) {
              newH = Math.max(nodeType === 'table' ? 140 : 48, startH + dy);
            }
            if (handle.includes('n')) {
              newH = Math.max(nodeType === 'table' ? 140 : 48, startH - dy);
              newY = startYPos + (startH - newH);
            }
          }

          let guides: AlignmentGuide[] = [];
          if (!e.altKey) {
            const snapThreshold = Math.min(4, 3 / currentVp.zoom);
            const candidates: BoxRect[] = (visibleNodesRef.current || [])
              .filter((n) => {
                if (n.id === currentResizeState.nodeId || n.deleted || n.type === 'drawing') return false;
                if (Math.abs(n.x - newX) > 3000 || Math.abs(n.y - newY) > 3000) return false;
                return true;
              })
              .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));

            const snapRes = computeResizeAlignment(
              { id: currentResizeState.nodeId, x: newX, y: newY, w: newW, h: newH },
              handle,
              candidates,
              snapThreshold
            );
            newX = snapRes.x;
            newY = snapRes.y;
            newW = snapRes.w;
            newH = snapRes.h;
            guides = snapRes.guides;
          }
          setAlignmentGuides(guides);

          boardDoc.transact(() => {
            nodeMap.set('x', Math.round(newX));
            nodeMap.set('y', Math.round(newY));
            nodeMap.set('w', Math.round(newW));
            nodeMap.set('h', Math.round(newH));
            if (nodeType === 'text' && isCorner && currentResizeState.startFontSize && startW > 0) {
              const scaledFontSize = Math.min(Math.max(12, Math.round(currentResizeState.startFontSize * (newW / startW))), 140);
              nodeMap.set('fontSize', scaledFontSize);
            }
          }, 'resize-motion');
        }
      }

      // Marquee selection
      const currentMarquee = marqueeBoxRef.current;
      if (currentMarquee) {
        setMarqueeBox((prev) => (prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null));

        const minX = Math.min(currentMarquee.startX, pos.x);
        const maxX = Math.max(currentMarquee.startX, pos.x);
        const minY = Math.min(currentMarquee.startY, pos.y);
        const maxY = Math.max(currentMarquee.startY, pos.y);

        const newSelected = new Set<string>();
        for (const n of nodesListRef.current) {
          if (!n.deleted && n.type !== 'drawing' && n.x + n.w >= minX && n.x <= maxX && n.y + n.h >= minY && n.y <= maxY) {
            newSelected.add(n.id);
          }
        }
        setSelectedNodeIds(newSelected);
      }

      // Drag arrow connector with magnetic geometric snapping
      const currentConnecting = connectingStateRef.current;
      if (currentConnecting) {
        const boxNodes: BoxNode[] = visibleNodesRef.current
          .filter((n) => !n.deleted && n.type !== 'drawing')
          .map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            width: n.w,
            height: n.h
          }));
        const snapped = findMagneticTargetPort(boxNodes, currentConnecting.fromNodeId, pos.x, pos.y, 28);
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

      if (isErasing) {
        setIsErasing(false);
      }

      // Reconcile dragging for single-step undo
      const upDragState = dragStateRef.current;
      if (upDragState) {
        const delta = dragDeltaRef.current || dragDelta;
        const totalDist = delta ? Math.hypot(delta.dx, delta.dy) : 0;
        if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
          boardDoc.transact(() => {
            upDragState.initialPositions.forEach((initPos, id) => {
              const nodeMap = yNodes.get(id);
              if (nodeMap && !nodeMap.get('locked')) {
                nodeMap.set('x', Math.round(initPos.x + delta.dx));
                nodeMap.set('y', Math.round(initPos.y + delta.dy));
              }
            });
          }, CANVAS_UNDO_ORIGIN);
        } else if (totalDist < 4 && upDragState.initialPositions.size === 1) {
          // Click without drag: enter instant text editing
          const clickedId = Array.from(upDragState.initialPositions.keys())[0];
          const clickedNode = nodeLookupRef.current.get(clickedId);
          if (clickedNode && (clickedNode.type === 'text' || clickedNode.type === 'sticky' || clickedNode.type === 'shape')) {
            startEditingNode(clickedId, false);
          }
        }
        dragDeltaRef.current = null;
        setDragState(null);
        setDragDelta(null);
      }

      // Reconcile resizing for single-step undo
      const upResizeState = resizeStateRef.current;
      if (upResizeState) {
        const nodeMap = yNodes.get(upResizeState.nodeId);
        if (nodeMap) {
          const finalW = nodeMap.get('w');
          const finalH = nodeMap.get('h');
          const finalX = nodeMap.get('x');
          const finalY = nodeMap.get('y');
          if (
            finalW !== upResizeState.startW ||
            finalH !== upResizeState.startH ||
            finalX !== upResizeState.startXPos ||
            finalY !== upResizeState.startYPos
          ) {
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

      // Drawing commit (Freehand or Straight Marker Line)
      const stroke = currentStrokeRef.current;
      if (stroke) {
        currentStrokeRef.current = null;
        setCurrentStroke(null);
        const currentTool = activeToolRef.current;
        let finalStroke = stroke;
        if (currentTool === 'line') {
          const dist = Math.hypot(stroke[stroke.length - 1].x - stroke[0].x, stroke[stroke.length - 1].y - stroke[0].y);
          if (dist < 8) {
            // Quick click: spawn a 180px straight horizontal line
            finalStroke = [
              { x: stroke[0].x - 90, y: stroke[0].y },
              { x: stroke[0].x + 90, y: stroke[0].y }
            ];
          } else {
            finalStroke = [stroke[0], stroke[stroke.length - 1]];
          }
        }
        if (finalStroke.length >= 2) {
          const bbox = computeBoundingBox(finalStroke, 8);
          const minX = bbox.x;
          const minY = bbox.y;
          const localPoints: Point[] = finalStroke.map((p) => ({
            x: p.x - minX,
            y: p.y - minY
          }));
          const pathD = pointsToSmoothSvgPath(localPoints);
          const newId = crypto.randomUUID();
          const nodeMap = new Y.Map();
          boardDoc.transact(() => {
            yNodes.set(newId, nodeMap);
            setNodeProperties(nodeMap, {
              id: newId,
              type: 'drawing',
              x: minX,
              y: minY,
              w: Math.max(bbox.width, 20),
              h: Math.max(bbox.height, 20),
              svgPath: pathD,
              points: localPoints,
              color: drawColorRef.current,
              strokeWidth: drawWidthRef.current,
              drawMode: drawModeRef.current,
              opacity: drawModeRef.current === 'highlighter' ? 0.35 : (drawModeRef.current === 'brush' ? 0.9 : 1),
              z: 25,
              deleted: false,
              locked: false
            });
          }, CANVAS_UNDO_ORIGIN);
          undoManagerRef.current?.stopCapturing();
        }
      }

      // Handle edge reconnection completion
      const recState = reconnectEdgeStateRef.current;
      if (recState) {
        reconnectEdgeStateRef.current = null;
        setReconnectEdgeState(null);
        const pos = screenToCanvas(e.clientX, e.clientY);
        const existing = yEdges.get(recState.edgeId);
        const oppositeNodeId = recState.which === 'from' ? (existing?.to || '') : (existing?.from || '');
        const boxNodes: BoxNode[] = visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.w,
          height: n.h
        }));
        const target = recState.snappedTarget || findMagneticTargetPort(boxNodes, oppositeNodeId, pos.x, pos.y, 28);
        if (target) {
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
        const dragDist = Math.hypot(pos.x - state.startX, pos.y - state.startY);
        const fromNode = nodeLookup.get(state.fromNodeId);

        // 1. Quick-Create on Port Click (dragDist < 15px)
        if (dragDist < 15 && fromNode) {
          const newId = crypto.randomUUID();
          const nodeMap = new Y.Map();
          let newX = fromNode.x + fromNode.w + 120;
          let newY = fromNode.y;
          let targetSide: PortSide = 'left';

          if (state.fromSide === 'right') {
            newX = fromNode.x + fromNode.w + 120;
            newY = fromNode.y;
            targetSide = 'left';
          } else if (state.fromSide === 'bottom') {
            newX = fromNode.x;
            newY = fromNode.y + fromNode.h + 100;
            targetSide = 'top';
          } else if (state.fromSide === 'left') {
            newX = fromNode.x - 220;
            newY = fromNode.y;
            targetSide = 'right';
          } else if (state.fromSide === 'top') {
            newX = fromNode.x;
            newY = fromNode.y - 180;
            targetSide = 'bottom';
          }

          boardDoc.transact(() => {
            yNodes.set(newId, nodeMap);
            setNodeProperties(nodeMap, {
              id: newId,
              type: fromNode.type === 'shape' ? 'shape' : 'sticky',
              shapeVariant: fromNode.shapeVariant,
              x: Math.round(newX),
              y: Math.round(newY),
              w: fromNode.type === 'shape' ? (fromNode.w || 200) : 200,
              h: fromNode.type === 'shape' ? (fromNode.h || 130) : 130,
              text: '',
              color: fromNode.color || activeColor,
              z: 10,
              deleted: false,
              locked: false
            });

            const edgeId = crypto.randomUUID();
            yEdges.set(edgeId, {
              id: edgeId,
              from: state.fromNodeId,
              to: newId,
              fromSide: state.fromSide,
              toSide: targetSide,
              direction: activeTool === 'line' ? 'none' : 'forward',
              style: defaultLineStyle.style,
              curveType: activeTool === 'line' ? 'straight' : defaultLineStyle.curveType,
              color: defaultLineStyle.color,
              deleted: false
            });
          }, 'user');

          setSelectedNodeIds(new Set([newId]));
          setActiveTool('select');
          startEditingNode(newId, true);
          return;
        }

        const boxNodes: BoxNode[] = nodesList
          .filter((n) => !n.deleted && n.type !== 'drawing')
          .map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            width: n.w,
            height: n.h
          }));
        let target = state.snappedTarget || findMagneticTargetPort(boxNodes, state.fromNodeId, pos.x, pos.y, 28);
        if (!target) {
          const insideCard = nodesList.find(
            (n) =>
              !n.deleted &&
              n.type !== 'drawing' &&
              n.id !== state.fromNodeId &&
              pos.x >= n.x &&
              pos.x <= n.x + n.w &&
              pos.y >= n.y &&
              pos.y <= n.y + n.h
          );
          if (insideCard) {
            const box: BoxNode = { id: insideCard.id, x: insideCard.x, y: insideCard.y, width: insideCard.w, height: insideCard.h };
            const sides: PortSide[] = ['top', 'right', 'bottom', 'left'];
            let bestDist = Infinity;
            let bestSide: PortSide = 'left';
            let bestPt = { x: insideCard.x, y: insideCard.y + insideCard.h / 2 };
            for (const s of sides) {
              const pt = getPortCoordinates(box, s);
              const d = Math.hypot(state.startX - pt.x, state.startY - pt.y);
              if (d < bestDist) {
                bestDist = d;
                bestSide = s;
                bestPt = pt;
              }
            }
            target = { nodeId: insideCard.id, side: bestSide, point: bestPt };
          }
        }

        // Strict rejection: NEVER allow self-loops (fromNodeId === target.nodeId)
        if (target) {
          if (target.nodeId !== state.fromNodeId) {
            const edgeId = crypto.randomUUID();
            boardDoc.transact(() => {
              yEdges.set(edgeId, {
                id: edgeId,
                from: state.fromNodeId,
                to: target.nodeId,
                fromSide: state.fromSide,
                toSide: target.side,
                direction: activeTool === 'line' ? 'none' : 'forward',
                style: defaultLineStyle.style,
                curveType: activeTool === 'line' ? 'straight' : defaultLineStyle.curveType,
                color: defaultLineStyle.color,
                deleted: false
              });
            }, 'user');
            setActiveTool('select');
          }
        } else if (dragDist >= 30) {
          // If dropped on empty canvas after a real drag, open quick connect drop menu
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

    const handleBlur = () => {
      setAlignmentGuides([]);
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Pointer down on canvas background
  const handleBackgroundPointerDown = (e: MouseEvent) => {
    // Reset active inertia RAF loop on pointer down to eliminate race conditions
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    targetViewportRef.current = viewportRef.current;

    setContextMenu(null);
    setQuickConnect(null);
    setIsBoardsPopoverOpen(false);
    setIsExportMenuOpen(false);
    setActiveFlyout('none');

    // Pan via Space + Left click, Middle click, Right click, Hand tool, or Read-Only Viewer mode
    if (isBoardLockedReadOnly || isSpacePressed || e.button === 1 || e.button === 2 || activeTool === 'hand') {
      if (e.button === 2) {
        rmbDragDistRef.current = 0;
        setPanState({
          startX: e.clientX,
          startY: e.clientY,
          originX: viewportRef.current.x,
          originY: viewportRef.current.y,
          isRmb: true
        } as any);
        return;
      }
      setPanState({
        startX: e.clientX,
        startY: e.clientY,
        originX: viewportRef.current.x,
        originY: viewportRef.current.y
      });
      return;
    }

    if (e.button === 0) {
      const pos = screenToCanvas(e.clientX, e.clientY);

      // Tool actions
      if (activeToolRef.current === 'draw') {
        const p = screenToCanvas(e.clientX, e.clientY);
        currentStrokeRef.current = [p];
        setCurrentStroke([p]);
        return;
      }
      if (activeToolRef.current === 'line') {
        const p = screenToCanvas(e.clientX, e.clientY);
        currentStrokeRef.current = [p, p];
        setCurrentStroke([p, p]);
        return;
      }
      if (activeTool === 'eraser') {
        const p = screenToCanvas(e.clientX, e.clientY);
        const ERASE_PAD = 18 / viewport.zoom;
        const hitDrawing = nodesList.find((n) => isPointHittingDrawing(p, n, ERASE_PAD));
        if (hitDrawing) {
          deleteSingleNode(hitDrawing.id);
        }
        setIsErasing(true);
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
      if (activeTool === 'checklist') {
        createNodeAt('checklist', pos.x - 140, pos.y - 110);
        return;
      }
      if (activeTool === 'table') {
        createNodeAt('table', pos.x - 170, pos.y - 90);
        return;
      }
      if (activeTool === 'kanban') {
        createNodeAt('kanban', pos.x - 140, pos.y - 210);
        return;
      }
      if (activeTool === 'code') {
        createNodeAt('code', pos.x - 180, pos.y - 110);
        return;
      }
      if (activeTool === 'chart') {
        createNodeAt('chart', pos.x - 140, pos.y - 140);
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
    // Reset active inertia RAF loop on pointer down to eliminate race conditions
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    targetViewportRef.current = viewportRef.current;

    if (e.button !== 0) return;
    if (dragState) return;

    if (isViewerMode.value) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.node-open-note-btn, .file-download-link, a, button')) {
        return;
      }
      return;
    }

    // If Hand tool (H) is active, do NOT intercept click - let it pan the canvas!
    if (activeTool === 'hand') {
      return;
    }

    // If drawing with pen or straight line tool, do NOT intercept click - let it draw right over frames/shapes!
    if (activeToolRef.current === 'draw' || activeToolRef.current === 'line') {
      const p = screenToCanvas(e.clientX, e.clientY);
      currentStrokeRef.current = activeToolRef.current === 'line' ? [p, p] : [p];
      setCurrentStroke(currentStrokeRef.current);
      return;
    }

    e.stopPropagation();
    setContextMenu(null);
    setQuickConnect(null);
    setActiveFlyout('none');

    if (activeTool === 'eraser') {
      setIsErasing(true);
      const pos = screenToCanvas(e.clientX, e.clientY);
      const ERASE_PAD = 18 / viewport.zoom;
      const hitDrawing = nodesList.find((n) => isPointHittingDrawing(pos, n, ERASE_PAD));
      if (hitDrawing) {
        deleteSingleNode(hitDrawing.id);
      } else if (!node.locked) {
        deleteSingleNode(node.id);
      }
      return;
    }

    // If any creation tool is active, spawn node inside frame or auto-switch to select on existing node
    if (
      activeTool === 'sticky' ||
      activeTool === 'shape' ||
      activeTool === 'text' ||
      activeTool === 'checklist' ||
      activeTool === 'table' ||
      activeTool === 'kanban' ||
      activeTool === 'code' ||
      activeTool === 'chart' ||
      activeTool === 'frame'
    ) {
      if (node.type === 'frame') {
        const pos = screenToCanvas(e.clientX, e.clientY);
        if (activeTool === 'sticky') createNodeAt('sticky', pos.x - 100, pos.y - 65, activeColor);
        else if (activeTool === 'shape') createNodeAt('shape', pos.x - 90, pos.y - 90);
        else if (activeTool === 'text') createNodeAt('text', pos.x - 110, pos.y - 40);
        else if (activeTool === 'checklist') createNodeAt('checklist', pos.x - 140, pos.y - 100);
        else if (activeTool === 'table') createNodeAt('table', pos.x - 170, pos.y - 90);
        else if (activeTool === 'kanban') createNodeAt('kanban', pos.x - 140, pos.y - 200);
        else if (activeTool === 'code') createNodeAt('code', pos.x - 180, pos.y - 110);
        else if (activeTool === 'chart') createNodeAt('chart', pos.x - 140, pos.y - 140);
        else if (activeTool === 'frame') createNodeAt('frame', pos.x - 210, pos.y - 160);
        return;
      }
      // Clicking an existing card automatically switches to 'select' to drag it
      setActiveTool('select');
    }

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

    if (activeTool !== 'select') return;

    let newSelected: Set<string>;
    const isMultiModifier = e.shiftKey || e.ctrlKey || e.metaKey;
    if (isMultiModifier) {
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
    dragDeltaRef.current = { dx: 0, dy: 0 };
    setDragDelta({ dx: 0, dy: 0 });
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
    if (rmbDragDistRef.current > 5) {
      rmbDragDistRef.current = 0;
      return;
    }
    rmbDragDistRef.current = 0;
    const pos = screenToCanvas(e.clientX, e.clientY);
    const target = (e.target as HTMLElement).closest('.board-node-box') as HTMLElement;
    const nodeId = target ? target.getAttribute('data-node-id') || undefined : undefined;

    // Automatically select the right-clicked element
    if (nodeId && !selectedNodeIds.has(nodeId)) {
      setSelectedNodeIds(new Set([nodeId]));
    }

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
    if (isViewerMode.value) return;
    const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(effectiveScope, noteId));
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
    const targetNodes = nodesList.filter((n) => !n.deleted && n.type !== 'drawing');
    const nodesForFit = targetNodes.length > 0 ? targetNodes : nodesList.filter((n) => !n.deleted);
    if (nodesForFit.length === 0) {
      animateToViewport({ x: 80, y: 80, zoom: 1 }, false);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodesForFit) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const availW = containerSize.width || window.innerWidth;
    const availH = containerSize.height || window.innerHeight;

    const paddingX = Math.max(96, availW * 0.15);
    const paddingY = Math.max(96, availH * 0.15);

    const scaleX = (availW - paddingX * 2) / Math.max(contentW, 100);
    const scaleY = (availH - paddingY * 2) / Math.max(contentH, 100);
    const targetZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.01), 2.5);

    const x = availW / 2 - centerX * targetZoom;
    const y = availH / 2 - centerY * targetZoom;

    animateToViewport({ x, y, zoom: targetZoom }, false);
  };

  return (
    <div
      class={`board-container ${activeTool === 'hand' || isSpacePressed ? 'cursor-grab' : ''} ${activeTool === 'arrow' ? 'tool-arrow' : ''} ${gridType === 'lines' ? 'grid-lines' : gridType === 'none' ? 'grid-none' : ''}`}
      ref={containerRef}
      onScroll={(e) => {
        if (e.currentTarget.scrollTop !== 0) e.currentTarget.scrollTop = 0;
        if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0;
      }}
      onPointerLeave={() => { setCursorScreenPos(null); awareness.setLocalStateField('cursor', null); }}
      onMouseLeave={() => { setCursorScreenPos(null); awareness.setLocalStateField('cursor', null); }}
      onMouseDown={handleBackgroundPointerDown}
      onDblClick={(e) => {
        if (isViewerMode.value) return;
        const target = e.target as HTMLElement | null;
        if (target && (target.classList.contains('board-container') || target.classList.contains('board-transform-layer') || target.classList.contains('canvas-grid-svg-layer'))) {
          const pos = screenToCanvas(e.clientX, e.clientY);
          createNodeAt('sticky', pos.x - 100, pos.y - 65, activeColor);
        }
      }}
      onContextMenu={isBoardLockedReadOnly ? (e) => e.preventDefault() : handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
                      author: agentStatus.value?.memberName || 'User',
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
              showToast(`${t('toast.imported_canvas')}: "${file.name}"`);
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
        <div class="miro-brand-logo" style={{ display: 'inline-flex', alignItems: 'center', marginRight: '2px' }} title="Doks">
          <Icon name="doks-cat" size={26} />
        </div>

        {/* Workspace Scope Status Badge */}
        {currentScope.value === 'solo' ? (
          <div
            class="miro-scope-status-pill solo"
            title="Solo workspace — private to this computer"
          >
            <Icon name="lock" size={11} />
            <span>Solo</span>
          </div>
        ) : (
          <div
            class="miro-scope-status-pill team"
            title="Shared workspace — live sync active"
          >
            <span class="miro-scope-dot live" />
            <span>Shared</span>
          </div>
        )}

        {/* Board Title Dropdown Button */}
        <button
          class="miro-board-selector-btn"
          onClick={() => {
            setIsBoardsPopoverOpen(!isBoardsPopoverOpen);
            setIsExportMenuOpen(false);
          }}
          title={t("topbar.boards")}
        >
          <Icon name="layout" size={16} />
          <span class="miro-board-title">{currentBoardMeta?.title || t('boards.default_title')}</span>
          <Icon name="chevron-down" size={12} />
        </button>

        {/* Actions according to active scope */}
        {currentScope.value === 'solo' ? (
          !isViewerMode.value && (
            <button
              class="miro-scope-action-btn"
              onClick={() => setConfirmConvertModal({ isOpen: true, targetScope: 'team' })}
              title="Convert this board to collaborative mode"
            >
              <Icon name="users" size={12} />
              <span>{t('workspace.moveToShared')}</span>
            </button>
          )
        ) : (
          <>
            {/* Copy Invite Link */}
            <button
              class="miro-scope-action-btn"
              onClick={() => {
                const url = `${window.location.origin}/b/${boardId}`;
                navigator.clipboard.writeText(url);
                showToast(t('common.copied'), 'success');
              }}
              title="Copy collaborative board link"
            >
              <Icon name="link" size={12} />
              <span>{t('share.copyLink')}</span>
            </button>

            {/* Make Private */}
            {!isViewerMode.value && (
              <button
                class="miro-scope-action-btn"
                onClick={() => setConfirmConvertModal({ isOpen: true, targetScope: 'solo' })}
                title="Move back to private solo workspace"
              >
                <Icon name="lock" size={12} />
                <span>{t('workspace.makePrivate')}</span>
              </button>
            )}
          </>
        )}

        {/* 3. Export Dropdown Button */}
        <button
          class={`miro-board-switcher-btn miro-export-toggle-btn ${isExportMenuOpen ? 'active' : ''}`}
          onClick={() => {
            setIsExportMenuOpen(!isExportMenuOpen);
            setIsBoardsPopoverOpen(false);
          }}
          title="Export (.canvas, .svg, .zip, AI)"
        >
          <Icon name="download" size={14} />
          <span>{t('topbar.export')}</span>
        </button>

        {/* Host-Offline Snapshot Lock Banner */}
      {isHostDisconnected && (
        <div
          class="liquid-glass-surface"
          style={{
            position: 'fixed',
            top: '56px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2500,
            padding: '10px 18px',
            background: 'rgba(17, 19, 28, 0.95)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '12px',
            backdropFilter: 'blur(12px)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fcd34d', fontWeight: 600 }}>
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                backgroundColor: '#f59e0b',
                display: 'inline-block',
                boxShadow: '0 0 8px #f59e0b'
              }}
            />
            <span>Connection lost • Reconnecting...</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => yjsClient.reconnect()}
              class="btn-secondary-xs"
              style={{
                padding: '4px 10px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#e2e8f0',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 500
              }}
              title="Reconnect to server"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleSaveAsSolo}
              class="btn-primary-xs"
              style={{
                padding: '4px 12px',
                background: '#7c3aed',
                borderColor: '#8b5cf6',
                color: '#ffffff',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 10px rgba(124, 58, 237, 0.4)'
              }}
              title="Save a full copy to your local Solo workspace"
            >
              <Icon name="copy" size={13} />
              <span>Save as My Solo Board</span>
            </button>
          </div>
        </div>
      )}

      {/* Boards & Templates Dropdown Popover */}
        {isBoardsPopoverOpen && (
          <div class="miro-boards-popover liquid-glass-surface">
            <div class="miro-popover-header">
              <span class="miro-popover-title">{t('topbar.my_boards')} ({allBoards.value.filter((b) => (b.scope || 'solo') === currentScope.value).length})</span>
              {!isViewerMode.value && (
                <button
                  class="btn-primary-xs"
                  title={t('topbar.create_board')}
                  onClick={() => {
                    setIsBoardsPopoverOpen(false);
                    setIsCreateBoardOpen(true);
                  }}
                >
                  <Icon name="plus" size={12} />
                  <span>{t('topbar.create_board')}</span>
                </button>
              )}
            </div>

            {/* 2-Segment Scope Switcher */}
            <div style={{ display: 'flex', padding: '3px', background: '#090a0f', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', margin: '4px 8px 10px' }}>
              <button
                type="button"
                onClick={() => setScope('solo')}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  ...(currentScope.value === 'solo'
                    ? { background: '#7c3aed', color: '#ffffff', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)' }
                    : { background: 'transparent', color: '#94a3b8' })
                }}
              >
                <Icon name="lock" size={12} />
                <span>Solo</span>
              </button>
              <button
                type="button"
                onClick={() => setScope('team')}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  ...(currentScope.value === 'team'
                    ? { background: '#7c3aed', color: '#ffffff', boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)' }
                    : { background: 'transparent', color: '#94a3b8' })
                }}
              >
                <Icon name="users" size={12} />
                <span>Shared</span>
              </button>
            </div>
            <div class="miro-boards-list">
              {allBoards.value.filter((b) => (b.scope || 'solo') === currentScope.value).map((b) => (
                <div
                  key={b.id}
                  class={`miro-board-item tree-board-item ${b.id === boardId ? 'active' : ''}`}
                  onClick={() => {
                    selectBoardWithScope(b.id, b.scope || 'solo', b.title);
                    setIsBoardsPopoverOpen(false);
                  }}
                >
                  <Icon
                    name={b.scope === 'team' ? 'globe-mesh' : 'lock'}
                    size={14}
                    class={b.scope === 'team' ? 'text-team' : 'text-solo'}
                  />
                  <span class="miro-board-name">{b.title}</span>
                  <span class={`miro-scope-tag ${b.scope || 'solo'}`}>
                    {b.scope === 'team' ? t('boards.team') : t('boards.solo')}
                  </span>
                  {!isViewerMode.value && (
                    <button
                      type="button"
                      class="miro-board-item-settings-btn"
                      title={t('boards.settings_title')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettingsTargetBoard({
                          id: b.id,
                          scope: b.scope || 'solo',
                          title: b.title
                        });
                        setIsBoardSettingsOpen(true);
                        setIsBoardsPopoverOpen(false);
                      }}
                    >
                      <Icon name="settings" size={12} />
                    </button>
                  )}
                  {b.id === boardId && <span class="miro-active-dot" />}
                </div>
              ))}
            </div>
            {!isViewerMode.value && (
              <>
                <div class="miro-popover-divider" style={{ margin: '8px 0 6px' }} />
                <button
                  type="button"
                  class="miro-menu-item"
                  style={{ width: '100%', justifyContent: 'space-between', color: '#c084fc' }}
                  onClick={() => {
                    setIsBoardsPopoverOpen(false);
                    window.dispatchEvent(new CustomEvent('doks:open-history', { detail: { tab: 'trash' } }));
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="trash" size={14} />
                    <span>{t('topbar.trash')}</span>
                  </span>
                  {(allTrashNotes.value.length + allTrashBoards.value.length) > 0 && (
                    <span class="trash-count-pill">{allTrashNotes.value.length + allTrashBoards.value.length}</span>
                  )}
                </button>
              </>
            )}
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
              <span>{t('topbar.export_ai')}</span>
            </button>
            <div class="miro-popover-divider" />
            <button
              class="miro-menu-item"
              onClick={handleExportJsonCanvas}
            >
              <Icon name="download" size={14} />
              <span>{t('topbar.export_canvas')}</span>
            </button>
            <button
              class="miro-menu-item"
              onClick={handleExportSvg}
            >
              <Icon name="image" size={14} />
              <span>{t('topbar.export_svg')}</span>
            </button>
            <a
              class="miro-menu-item"
              href={`/api/export/vault?scope=${encodeURIComponent(currentScope.value)}`}
              download={`doks-${currentScope.value}-vault.zip`}
              onClick={() => setIsExportMenuOpen(false)}
            >
              <Icon name="archive" size={14} />
              <span>{t('topbar.export_zip')}</span>
            </a>
          </div>
        )}
      </div>

      {/* =========================================================================
          ISLAND 2: LEFT-CENTER VERTICAL MIRO CREATION DOCK
          ========================================================================= */}
      {!isViewerMode.value && (
        <div
          class="miro-creation-dock-container"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: isBoardsPopoverOpen ? 0 : 1,
          pointerEvents: isBoardsPopoverOpen ? 'none' : 'auto',
          transform: isBoardsPopoverOpen ? 'translateY(-50%) translateX(-14px)' : 'translateY(-50%) translateX(0)',
          transition: 'all 0.16s ease'
        }}
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
            title={t('dock.select')}
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
            title={t('dock.hand')}
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
                if (activeTool === 'sticky') {
                  setActiveFlyout(activeFlyout === 'sticky' ? 'none' : 'sticky');
                } else {
                  setActiveTool('sticky');
                  setActiveFlyout('none');
                }
              }}
              title={t('dock.sticky')}
            >
              <Icon name="sticky" size={20} />
            </button>
            {activeFlyout === 'sticky' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">{t('dock.sticky_color')}</div>
                <div class="miro-sticky-swatch-grid">
                  {Object.entries(CANVAS_COLORS).filter(([k]) => k !== 'default').map(([key, hex]) => (
                    <button
                      key={key}
                      type="button"
                      class={`miro-sticky-swatch ${activeColor === key ? 'active' : ''}`}
                      style={{ backgroundColor: hex }}
                      onClick={() => {
                        selectActiveColor(key);
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
                if (activeTool === 'shape') {
                  setActiveFlyout(activeFlyout === 'shape' ? 'none' : 'shape');
                } else {
                  setActiveTool('shape');
                  setActiveFlyout('none');
                }
              }}
              title={t('dock.shapes')}
            >
              <Icon name="shape" size={20} />
            </button>
            {activeFlyout === 'shape' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">{t('dock.shape_type')}</div>
                <div class="miro-shape-grid">
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'rectangle' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('rectangle'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title={t("shapes.rectangle")}
                  >
                    <div class="shape-preview rect-preview" />
                    <span>{t("shapes.rectangle")}</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'rounded' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('rounded'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title={t("shapes.rounded")}
                  >
                    <div class="shape-preview rounded-preview" />
                    <span>{t("shapes.rounded")}</span>
                  </button>
                  <button
                    class={`miro-shape-pick-btn ${selectedShapeVariant === 'circle' ? 'active' : ''}`}
                    onClick={() => { setSelectedShapeVariant('circle'); setActiveTool('shape'); setActiveFlyout('none'); }}
                    title={t("shapes.circle")}
                  >
                    <div class="shape-preview circle-preview" />
                    <span>{t("shapes.circle")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Connection / Arrow (C) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'arrow' ? 'active' : ''}`}
              data-tool="arrow"
              onClick={() => {
                setActiveTool('arrow');
                setActiveFlyout(activeFlyout === 'arrow' ? 'none' : 'arrow');
              }}
              title="Arrow Connector (C)"
            >
              <Icon name="arrow" size={20} />
            </button>
            {activeFlyout === 'arrow' && (
              <div class="miro-flyout-menu liquid-glass-surface">
                <div class="miro-flyout-title">{t('dock.line_type')}</div>
                <div class="miro-line-types">
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'bezier' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'bezier' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M 2 14 C 10 14, 14 2, 22 2" />
                    </svg>
                    <span>{t("lines.bezier")}</span>
                  </button>
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'orthogonal' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'orthogonal' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M 2 14 L 12 14 L 12 2 L 22 2" />
                    </svg>
                    <span>{t("lines.step")}</span>
                  </button>
                  <button
                    class={`miro-line-btn ${defaultLineStyle.curveType === 'straight' ? 'active' : ''}`}
                    onClick={() => setDefaultLineStyle((prev) => ({ ...prev, curveType: 'straight' }))}
                  >
                    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="2" y1="14" x2="22" y2="2" />
                    </svg>
                    <span>{t("lines.straight")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5b. Straight Line (L) */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'line' ? 'active' : ''}`}
              data-tool="line"
              onClick={() => {
                activeToolRef.current = 'line';
                setActiveTool('line');
                setActiveFlyout('none');
              }}
              title="Straight Line (L)"
            >
              <Icon name="line" size={20} />
            </button>
          </div>

          {/* 6. Pen / Brush / Highlighter / Eraser (P / E) + Flyout */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeTool === 'draw' || activeTool === 'eraser' ? 'active' : ''}`}
              data-tool="draw"
              style={{ position: 'relative' }}
              onClick={() => {
                activeToolRef.current = 'draw';
                setActiveTool('draw');
                setActiveFlyout(activeFlyout === 'draw' ? 'none' : 'draw');
              }}
              title={t('dock.pen')}
            >
              <Icon name={activeTool === 'eraser' ? 'eraser' : 'pen'} size={20} />
              {activeTool !== 'eraser' && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '4px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: drawColor,
                    border: '1px solid rgba(0,0,0,0.5)'
                  }}
                />
              )}
            </button>
            {activeFlyout === 'draw' && (
              <div class="miro-flyout-menu liquid-glass-surface" style={{ width: '220px' }}>
                <div class="miro-flyout-title">{t('dock.draw')}</div>
                <div class="miro-draw-modes">
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'pen' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('pen'); }}
                  >
                    <Icon name="pen" size={14} />
                    <span>{t('dock.pen')}</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'brush' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('brush'); }}
                  >
                    <Icon name="brush" size={14} />
                    <span>{t('dock.brush')}</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'draw' && drawMode === 'highlighter' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('draw'); setDrawMode('highlighter'); }}
                  >
                    <Icon name="brush" size={14} />
                    <span>{t('dock.highlighter')}</span>
                  </button>
                  <button
                    class={`miro-draw-mode-btn ${activeTool === 'eraser' ? 'active' : ''}`}
                    onClick={() => { setActiveTool('eraser'); }}
                  >
                    <Icon name="eraser" size={14} />
                    <span>{t('dock.eraser')}</span>
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
                      onClick={() => selectActiveColor(col)}
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
            title={t('dock.text')}
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
            title={t('dock.frame')}
          >
            <Icon name="frame" size={20} />
          </button>

          <div class="miro-dock-divider" />

          {/* 9. Widgets (+) Menu */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeFlyout === 'widgets' || activeTool === 'checklist' || activeTool === 'table' || activeTool === 'kanban' || activeTool === 'code' ? 'active' : ''}`}
              data-tool="widgets"
              onClick={() => {
                setActiveFlyout(activeFlyout === 'widgets' ? 'none' : 'widgets');
              }}
              title={t('dock.widgets')}
            >
              <Icon name="plus" size={20} />
            </button>

            {activeFlyout === 'widgets' && (
              <div class="miro-flyout-panel miro-widgets-flyout liquid-glass-surface" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px', padding: '6px' }}>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                    createNodeAt('checklist', cx - 140, cy - 110);
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="checklist" size={16} />
                  <span>{t('dock.checklist')}</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                    createNodeAt('table', cx - 170, cy - 90);
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="table" size={16} />
                  <span>{t('dock.table')}</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                    createNodeAt('kanban', cx - 140, cy - 210);
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="kanban" size={16} />
                  <span>{t('dock.kanban')}</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                    createNodeAt('code', cx - 180, cy - 110);
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="code" size={16} />
                  <span>{t('dock.code')}</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
                    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
                    createNodeAt('chart', cx - 190, cy - 180);
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="chart" size={16} />
                  <span>{t('dock.chart')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Documents & Sheets Tool (D) */}
          <div class="miro-dock-tool-wrapper">
            <button
              class={`miro-dock-btn ${activeFlyout === 'docs' ? 'active' : ''}`}
              data-tool="docs"
              onClick={() => {
                setActiveFlyout(activeFlyout === 'docs' ? 'none' : 'docs');
              }}
              title="Documents & Sheets (D)"
            >
              <Icon name="file-plus" size={20} />
            </button>

            {activeFlyout === 'docs' && (
              <div class="miro-flyout-panel liquid-glass-surface" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px', padding: '6px' }}>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    createNewCanvasSpreadsheet();
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="table" size={16} />
                  <span>New Spreadsheet (Excel)</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    createNewCanvasDoc();
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="file-text" size={16} />
                  <span>New Document (Word)</span>
                </button>
                <button
                  type="button"
                  class="miro-flyout-item-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: '13px', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                  onClick={() => {
                    createNewCanvasPdfPage();
                    setActiveFlyout('none');
                  }}
                >
                  <Icon name="layout-canvas" size={16} />
                  <span>New Page (PDF A4)</span>
                </button>
              </div>
            )}
          </div>

          <div class="miro-dock-divider" />

          {/* 10. Mindmap & Auto-Diagrams (M) */}
          <button
            class="miro-dock-btn"
            onClick={() => setIsAutoDiagramModalOpen(true)}
            title={t('dock.mindmap')}
          >
            <Icon name="sparkles" size={20} />
          </button>

          {/* 10. Upload Document / Media (U / I) */}
          <button
            class="miro-dock-btn"
            onClick={() => fileAttachmentInputRef.current?.click()}
            title={t('dock.upload')}
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
            title={t('dock.undo')}
          >
            <Icon name="undo" size={16} />
          </button>
          <div class="miro-dock-divider-v" />
          <button
            class="miro-undo-btn hud-btn"
            onClick={() => undoManagerRef.current?.redo()}
            title={t('dock.redo')}
          >
            <Icon name="redo" size={16} />
          </button>
        </div>
      </div>
      )}

      {/* Freehand Drawing Sub-Bar */}
      {!isViewerMode.value && activeTool === 'draw' && (
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
            }}
          >
            {t('canvas.pen')}
          </button>
          <button
            type="button"
            class={`draw-mode-btn ${drawMode === 'brush' ? 'active' : ''}`}
            onClick={() => {
              setDrawMode('brush');
            }}
          >
            {t('canvas.brush')}
          </button>
          <button
            type="button"
            class={`draw-mode-btn ${drawMode === 'highlighter' ? 'active' : ''}`}
            onClick={() => {
              setDrawMode('highlighter');
            }}
          >
            {t('canvas.marker')}
          </button>

          <div class="toolbox-divider" />

          {/* Stroke Width Selector */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[2, 4, 8, 16, 24].map((w) => (
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
                onClick={() => selectActiveColor(c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Multi-select align toolbar purged */}

      {/* 2. Floating Context Inspector Bar */}
      {!isViewerMode.value && selectionBounds && selectedNodeIds.size > 0 && (() => {
        const selectedNodes = Array.from(selectedNodeIds).map((id) => nodeLookup.get(id)).filter(Boolean);
        const hasOnlyDrawings = selectedNodes.length > 0 && selectedNodes.every((n) => n?.type === 'drawing');
        if (hasOnlyDrawings) return null;

        const minTopClearance = 88;
        const isToolbarFlipped = selectionBounds.y - 54 < minTopClearance;
        return (
          <div
            class="floating-inspector-bar liquid-glass-surface"
            style={{
              left: `${selectionBounds.x + selectionBounds.width / 2}px`,
              top: isToolbarFlipped
                ? `${selectionBounds.y + selectionBounds.height + 14}px`
                : `${selectionBounds.y - 14}px`,
              transform: isToolbarFlipped ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
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
                  selectActiveColor(key);
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

          {/* Typography Controls: Stepper (A-), Preset Dropdown (12-96px), Stepper (A+) */}
          {(() => {
            const FONT_PRESETS = [12, 14, 16, 18, 20, 24, 32, 40, 48, 64, 80, 96];
            const firstId = Array.from(selectedNodeIds)[0];
            const activeNode = nodeLookup.get(firstId);
            const currentFontSize = activeNode?.fontSize;

            const applyFontSize = (size?: number) => {
              boardDoc.transact(() => {
                for (const id of selectedNodeIds) {
                  const map = yNodes.get(id);
                  if (map) {
                    if (size) {
                      map.set('fontSize', size);
                    } else {
                      map.delete('fontSize');
                    }
                  }
                }
              }, 'user');
            };

            const stepFontSize = (delta: -1 | 1) => {
              const cur = currentFontSize || calculateAutoFontSize(activeNode?.text || '', activeNode?.w || 200, activeNode?.h || 130, activeNode?.type);
              let nextIdx = FONT_PRESETS.findIndex((s) => s >= cur);
              if (nextIdx === -1) nextIdx = FONT_PRESETS.length - 1;
              const targetIdx = Math.max(0, Math.min(FONT_PRESETS.length - 1, nextIdx + delta));
              applyFontSize(FONT_PRESETS[targetIdx]);
            };

            return (
              <div class="inspector-font-sizes" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <button
                  type="button"
                  class="inspector-size-btn"
                  title="Decrease text size (A-)"
                  onClick={() => stepFontSize(-1)}
                  style={{ width: '22px', height: '22px', padding: 0 }}
                >
                  <Icon name="minus" size={12} />
                </button>

                <select
                  class="inspector-font-select"
                  value={currentFontSize ? String(currentFontSize) : 'auto'}
                  onChange={(e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    applyFontSize(val === 'auto' ? undefined : Number(val));
                  }}
                  title="Text Size Range"
                  style={{
                    background: 'rgba(0, 0, 0, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    color: '#f1f5f9',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 5px',
                    height: '24px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="auto">Auto (Responsive)</option>
                  <option value="12">12 px</option>
                  <option value="14">14 px</option>
                  <option value="16">16 px</option>
                  <option value="18">18 px</option>
                  <option value="20">20 px</option>
                  <option value="24">24 px</option>
                  <option value="32">32 px</option>
                  <option value="40">40 px</option>
                  <option value="48">48 px</option>
                  <option value="64">64 px</option>
                  <option value="80">80 px</option>
                  <option value="96">96 px</option>
                </select>

                <button
                  type="button"
                  class="inspector-size-btn"
                  title="Increase text size (A+)"
                  onClick={() => stepFontSize(1)}
                  style={{ width: '22px', height: '22px', padding: 0 }}
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>
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
                  title={`${t('canvas.open_split')} (Ctrl+\)`}
                  onClick={() => {
                    ensureSplitTabs();
                    openTab('note', node.noteId!, node.text || t('canvas.note'));
                  }}
                >
                  <Icon name="layout-split" size={15} />
                  <span>{t('canvas.open_split')}</span>
                </button>
              );
            }
            return null;
          })()}

          {/* 6 Essential Core Shapes (Clean & Uncluttered) */}
          {(() => {
            const firstId = Array.from(selectedNodeIds)[0];
            const node = nodeLookup.get(firstId);
            if (node?.type !== 'shape') return null;
            const curVariant = (node as any).shapeVariant || 'rectangle';

            const setVariant = (v: string) => {
              boardDoc.transact(() => {
                for (const id of selectedNodeIds) {
                  const map = yNodes.get(id);
                  if (map) map.set('shapeVariant', v);
                }
              }, CANVAS_UNDO_ORIGIN);
            };

            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <div class="inspector-divider" />
                <button
                  class={`inspector-btn ${curVariant === 'rectangle' ? 'active' : ''}`}
                  title="Rectangle"
                  onClick={() => setVariant('rectangle')}
                >
                  <Icon name="square" size={14} />
                </button>
                <button
                  class={`inspector-btn ${curVariant === 'rounded' ? 'active' : ''}`}
                  title="Rounded"
                  onClick={() => setVariant('rounded')}
                >
                  <Icon name="shape" size={14} />
                </button>
                <button
                  class={`inspector-btn ${curVariant === 'circle' ? 'active' : ''}`}
                  title="Circle"
                  onClick={() => setVariant('circle')}
                >
                  <Icon name="circle" size={14} />
                </button>
              </div>
            );
          })()}

          {/* Lock / Unlock */}
          <button
            class="inspector-btn"
            title={`${t('canvas.lock_unlock')} (Ctrl+L)`}
            onClick={toggleLockSelected}
          >
            <Icon name="lock" size={15} />
          </button>



          {/* Duplicate */}
          <button
            class="inspector-btn"
            title={`${t('context.duplicate')} (Ctrl+D)`}
            onClick={duplicateSelected}
          >
            <Icon name="copy" size={15} />
          </button>

          {/* Scope Transfer: Open modal to pick target board */}
          <button
            class="inspector-btn"
            data-testid="scope-transfer-btn"
            title={effectiveScope === 'solo' ? t('canvas.move_to_team') : t('canvas.move_to_solo')}
            onClick={() => {
              handleOpenTransferModal(Array.from(selectedNodeIds));
            }}
          >
            <Icon name={effectiveScope === 'solo' ? 'promote' : 'fork'} size={15} />
            <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 500 }}>
              {effectiveScope === 'solo' ? t('canvas.to_team') : t('canvas.to_solo')}
            </span>
          </button>

          {/* Delete */}
          <button
            class="inspector-btn danger"
            title={`${t('context.delete')} (Delete)`}
            onClick={deleteSelected}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
        );
      })()}

      {/* Dynamic Infinite Adaptive LOD Canvas Grid Layer (Miro-Grade Smooth Two-Octave Cross-Fade) */}
      {gridType !== 'none' && (() => {
        const cleanBoardId = (boardId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
        const grid = computeContinuousGrid(viewport.zoom, viewport.x, viewport.y);
        const baseStroke = '255, 255, 255';

        return (
          <svg
            class="canvas-grid-svg-layer"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 0
            }}
            aria-hidden="true"
          >
            <defs>
              {/* Primary Coarse Grid (Screen-Space Constant 1px Stroke, Always Active) */}
              <pattern
                id={`grid-coarse-${cleanBoardId}`}
                x={grid.coarseOffsetX}
                y={grid.coarseOffsetY}
                width={grid.coarseStep}
                height={grid.coarseStep}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${grid.coarseStep} 0 H 0 V ${grid.coarseStep}`}
                  fill="none"
                  stroke={`rgba(${baseStroke}, 0.08)`}
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
              </pattern>

              {/* Secondary Fine Sub-Grid (Screen-Space Constant 1px Stroke, Smoothly Cross-Faded) */}
              <pattern
                id={`grid-fine-${cleanBoardId}`}
                x={grid.fineOffsetX}
                y={grid.fineOffsetY}
                width={grid.fineStep}
                height={grid.fineStep}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${grid.fineStep} 0 H 0 V ${grid.fineStep}`}
                  fill="none"
                  stroke={`rgba(${baseStroke}, ${(0.08 * grid.alphaFine).toFixed(4)})`}
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
              </pattern>

              {/* Major Checkered Grid (Screen-Space Constant 1.2px Stroke, every 4 coarse cells) */}
              <pattern
                id={`grid-major-${cleanBoardId}`}
                x={grid.majorOffsetX}
                y={grid.majorOffsetY}
                width={grid.majorStep}
                height={grid.majorStep}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${grid.majorStep} 0 H 0 V ${grid.majorStep}`}
                  fill="none"
                  stroke={`rgba(${baseStroke}, 0.12)`}
                  strokeWidth="1.2"
                  shapeRendering="crispEdges"
                />
              </pattern>

              {/* Dots Grid: Coarse and Fine Dots */}
              <pattern
                id={`grid-dots-coarse-${cleanBoardId}`}
                x={grid.coarseOffsetX}
                y={grid.coarseOffsetY}
                width={grid.coarseStep}
                height={grid.coarseStep}
                patternUnits="userSpaceOnUse"
              >
                <circle
                  cx={grid.coarseStep}
                  cy={grid.coarseStep}
                  r="1.5"
                  fill={`rgba(${baseStroke}, 0.22)`}
                />
              </pattern>

              <pattern
                id={`grid-dots-fine-${cleanBoardId}`}
                x={grid.fineOffsetX}
                y={grid.fineOffsetY}
                width={grid.fineStep}
                height={grid.fineStep}
                patternUnits="userSpaceOnUse"
              >
                <circle
                  cx={grid.fineStep}
                  cy={grid.fineStep}
                  r="1.2"
                  fill={`rgba(${baseStroke}, ${(0.22 * grid.alphaFine).toFixed(4)})`}
                />
              </pattern>
            </defs>

            {gridType === 'lines' && (
              <>
                <rect width="100%" height="100%" fill={`url(#grid-coarse-${cleanBoardId})`} />
                {grid.alphaFine > 0.005 && (
                  <rect width="100%" height="100%" fill={`url(#grid-fine-${cleanBoardId})`} />
                )}
                <rect width="100%" height="100%" fill={`url(#grid-major-${cleanBoardId})`} />
              </>
            )}

            {gridType === 'dots' && (
              <>
                <rect width="100%" height="100%" fill={`url(#grid-dots-coarse-${cleanBoardId})`} />
                {grid.alphaFine > 0.005 && (
                  <rect width="100%" height="100%" fill={`url(#grid-dots-fine-${cleanBoardId})`} />
                )}
              </>
            )}
          </svg>
        );
      })()}

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
          selectedEdgeId={isBoardLockedReadOnly ? null : selectedEdgeId}
          viewportZoom={viewport.zoom}
          readOnly={isBoardLockedReadOnly}
          onSelectEdge={(id) => {
            if (isViewerMode.value) return;
            setSelectedEdgeId(id);
            if (id) setSelectedNodeIds(new Set());
          }}
          onUpdateEdge={handleUpdateEdge}
          onDeleteEdge={handleDeleteEdge}
          onStartReconnect={(edgeId, which, startPoint) => {
            if (isViewerMode.value) return;
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

          {/* Smart Alignment Snap Lines & Markers */}
          {alignmentGuides.map((g, i) => {
            const isVert = g.type === 'vertical';
            return (
              <g key={`guide-${i}`} class="smart-guide-group">
                {/* Finite dashed line segment */}
                <line
                  class="smart-guide-line"
                  x1={isVert ? g.pos : g.start}
                  y1={isVert ? g.start : g.pos}
                  x2={isVert ? g.pos : g.end}
                  y2={isVert ? g.end : g.pos}
                />
                {/* Cross / tick markers at snap intersections */}
                {g.snapPoints.map((pt, pi) => (
                  <g key={`pt-${pi}`} class="smart-guide-marker">
                    <line x1={pt.x - 4} y1={pt.y} x2={pt.x + 4} y2={pt.y} />
                    <line x1={pt.x} y1={pt.y - 4} x2={pt.x} y2={pt.y + 4} />
                  </g>
                ))}
                {/* Distance pill badge when spacing matches */}
                {g.distanceLabel && (
                  <g class="smart-guide-badge" transform={`translate(${g.distanceLabel.x}, ${g.distanceLabel.y})`}>
                    <rect
                      class="smart-guide-pill"
                      x="-20"
                      y="-10"
                      width="40"
                      height="20"
                    />
                    <text class="smart-guide-text">
                      {g.distanceLabel.text}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Live edge reconnection dragging line with accurate curveType */}
          {reconnectEdgeState && (
            <g class="connecting-preview-group pointer-events-none">
              <path
                d={(() => {
                  const edge = yEdges.get(reconnectEdgeState.edgeId);
                  const curve = (edge?.curveType as any) || defaultLineStyle.curveType;
                  const dx = reconnectEdgeState.currentX - reconnectEdgeState.startPoint.x;
                  const dy = reconnectEdgeState.currentY - reconnectEdgeState.startPoint.y;
                  const defaultTargetSide = Math.abs(dx) > Math.abs(dy)
                    ? (dx > 0 ? 'left' : 'right')
                    : (dy > 0 ? 'top' : 'bottom');
                  const targetSide = reconnectEdgeState.snappedTarget
                    ? reconnectEdgeState.snappedTarget.side
                    : defaultTargetSide;
                  const targetX = reconnectEdgeState.snappedTarget ? reconnectEdgeState.snappedTarget.point.x : reconnectEdgeState.currentX;
                  const targetY = reconnectEdgeState.snappedTarget ? reconnectEdgeState.snappedTarget.point.y : reconnectEdgeState.currentY;

                  const sourceSide = reconnectEdgeState.which === 'from'
                    ? (edge?.toSide || 'left')
                    : (edge?.fromSide || 'right');

                  const res = buildEdgeSvgPath(
                    reconnectEdgeState.startPoint.x,
                    reconnectEdgeState.startPoint.y,
                    sourceSide,
                    targetX,
                    targetY,
                    targetSide,
                    curve
                  );
                  return typeof res === 'string' ? res : (res as any).path;
                })()}
                class="connecting-preview-line"
                stroke="#8b5cf6"
                strokeWidth="2.5"
                strokeDasharray="5 5"
                fill="none"
                markerEnd="url(#arrow-marker)"
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

          {/* Temporary arrow during drag with live magnetic snap & correct curveType */}
          {connectingState && (
            <g class="connecting-preview-group pointer-events-none">
              <path
                d={(() => {
                  const curve = defaultLineStyle.curveType;
                  if (connectingState.snappedTarget) {
                    const res = buildEdgeSvgPath(
                      connectingState.startX,
                      connectingState.startY,
                      connectingState.fromSide,
                      connectingState.snappedTarget.point.x,
                      connectingState.snappedTarget.point.y,
                      connectingState.snappedTarget.side,
                      curve
                    );
                    return typeof res === 'string' ? res : (res as any).path;
                  }
                  // When dragging in free space, dynamically select port direction relative to cursor
                  const dx = connectingState.currentX - connectingState.startX;
                  const dy = connectingState.currentY - connectingState.startY;
                  const targetSide = Math.abs(dx) > Math.abs(dy)
                    ? (dx > 0 ? 'left' : 'right')
                    : (dy > 0 ? 'top' : 'bottom');

                  const res = buildEdgeSvgPath(
                    connectingState.startX,
                    connectingState.startY,
                    connectingState.fromSide,
                    connectingState.currentX,
                    connectingState.currentY,
                    targetSide,
                    curve
                  );
                  return typeof res === 'string' ? res : (res as any).path;
                })()}
                class="connecting-preview-line"
                stroke="#8b5cf6"
                strokeWidth="2.5"
                strokeDasharray="5 5"
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

        {/* Nodes Layer (Drawings rendered in dedicated pure ink layer) */}
        {visibleNodes.filter((n) => n.type !== 'drawing').map((rawNode) => {
          const node = nodeLookup.get(rawNode.id) || rawNode;
          const isSelected = selectedNodeIds.has(node.id);
          const rawColor = node.color || '';
          const nodeColorHex = CANVAS_COLORS[rawColor] || (rawColor.startsWith('#') ? rawColor : CANVAS_COLORS.default);
          const isFrame = node.type === 'frame';
          const isNote = node.type === 'note';
          const isSticky = node.type === 'sticky';
          const isImage = node.type === 'image' || ((node.fileName || '').match(/\.(png|jpe?g|gif|webp)$/i) && !node.extractedText);
          const isWidget = node.type === 'table' || node.type === 'kanban' || node.type === 'chart' || node.type === 'checklist';
          const shapeClass = node.type === 'shape' && node.shapeVariant ? `shape-variant-${node.shapeVariant}` : '';
          const frameFontSize = Math.min(Math.max(14, Math.round(Math.min(node.w, node.h) * 0.035)), 48);

          const stickyBg = isSticky && nodeColorHex !== CANVAS_COLORS.default ? `${nodeColorHex}26` : undefined;
          const borderColor = isFrame
            ? 'rgba(255, 255, 255, 0.18)'
            : node.type === 'text' || isImage
            ? 'transparent'
            : isWidget && nodeColorHex !== CANVAS_COLORS.default
            ? `${nodeColorHex}66`
            : isSticky && nodeColorHex !== CANVAS_COLORS.default
            ? `${nodeColorHex}80`
            : nodeColorHex;

          const widgetGlow = isWidget && nodeColorHex !== CANVAS_COLORS.default
            ? `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px ${nodeColorHex}18`
            : undefined;

          const widgetHeaderStyle = isWidget && nodeColorHex !== CANVAS_COLORS.default ? {
            background: `linear-gradient(90deg, ${nodeColorHex}33 0%, rgba(255, 255, 255, 0.03) 100%)`,
            borderBottom: `1px solid ${nodeColorHex}44`
          } : undefined;

          return (
            <div
              key={node.id}
              data-node-id={node.id}
              class={`board-node-box type-${node.type} ${shapeClass} ${isSelected ? 'selected' : ''} ${editingNodeId === node.id ? 'editing' : ''} ${node.locked ? 'locked' : ''}`}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.w}px`,
                height: `${node.h}px`,
                backgroundColor: stickyBg || undefined,
                boxShadow: widgetGlow,
                borderColor,
                zIndex: node.z ?? (isFrame ? 1 : 10)
              }}
              onMouseDown={(e) => handleNodePointerDown(node, e as any)}
              onDblClick={() => {
                if (!isViewerMode.value) startEditingNode(node.id, false);
              }}
            >
              {/* 4 Magnetic Connector Ports */}
              {!isViewerMode.value && (() => {
                const invZoom = 1 / Math.max(0.005, viewport.zoom);
                const portTransform = (side: PortSide) => `${side === 'top' || side === 'bottom' ? 'translateX(-50%)' : 'translateY(-50%)'} scale(${invZoom})`;
                return (
                  <>
                    <div
                      class="magnetic-port port-top"
                      style={{ transform: portTransform('top'), transformOrigin: 'center bottom' }}
                      onMouseDown={(e) => handlePortPointerDown(node.id, 'top', e as any)}
                    />
                    <div
                      class="magnetic-port port-right"
                      style={{ transform: portTransform('right'), transformOrigin: 'left center' }}
                      onMouseDown={(e) => handlePortPointerDown(node.id, 'right', e as any)}
                    />
                    <div
                      class="magnetic-port port-bottom"
                      style={{ transform: portTransform('bottom'), transformOrigin: 'center top' }}
                      onMouseDown={(e) => handlePortPointerDown(node.id, 'bottom', e as any)}
                    />
                    <div
                      class="magnetic-port port-left"
                      style={{ transform: portTransform('left'), transformOrigin: 'right center' }}
                      onMouseDown={(e) => handlePortPointerDown(node.id, 'left', e as any)}
                    />
                  </>
                );
              })()}

              {/* Top drag bar for sticky notes */}
              {node.type === 'sticky' && (
                <div class="node-drag-bar" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                  {((node as any).hasCheckbox || node.done) && (
                    <input
                      type="checkbox"
                      class="sticky-checkbox"
                      checked={node.done || false}
                      disabled={isViewerMode.value}
                      onChange={(e) => {
                        const map = yNodes.get(node.id);
                        if (map) map.set('done', (e.target as HTMLInputElement).checked);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  )}
                  {node.locked && (
                    <span class="node-lock-badge" title={t('canvas.locked')}>
                      <Icon name="lock" size={11} />
                    </span>
                  )}
                </div>
              )}

              {/* Note Header */}
              {isNote && (
                <div class="node-meta-stripe">
                  <span class="node-author-chip" style={{ color: nodeColorHex }}>
                    {t('canvas.note')}
                  </span>
                  <button
                    class="node-open-note-btn"
                    title={t('notes.preview')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.noteId) {
                        const meta = maps.notes.get(node.noteId);
                        openTab('note', node.noteId, meta?.title || node.text);
                      }
                    }}
                  >
                    <Icon name="file-text" size={12} />
                    <span>{t('notes.preview')}</span>
                  </button>
                </div>
              )}

              {/* Node Content */}
              {isNote ? (
                (() => {
                  const noteMeta = node.noteId ? maps.notes.get(node.noteId) : null;
                  const isDeleted = !noteMeta || noteMeta.deleted;

                  if (isDeleted) {
                    return (
                      <div class="note-card-deleted-view" onMouseDown={(e) => e.stopPropagation()}>
                        <span class="deleted-label">{t('canvas.note_deleted')}</span>
                        {node.noteId && (
                          <button
                            class="btn-secondary-sm"
                            style={{ marginTop: '8px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              restoreNote(node.noteId!);
                            }}
                          >
                            {t('trash.restore')}
                          </button>
                        )}
                      </div>
                    );
                  }

                  const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(effectiveScope, node.noteId!));
                  const noteYText = noteDoc.getText('text');
                  const noteContent = noteYText.toString();

                  // Render live interactive markdown preview with clickable checkboxes
                  return (
                    <div
                      class="note-card-content-view scrollable-card-content"
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <div class="note-card-header-title">
                        {noteMeta?.title || t('notes.untitled')}
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
                                  disabled={isViewerMode.value}
                                  onChange={() => {
                                    if (isViewerMode.value) return;
                                    toggleNoteCheckbox(node.noteId!, lineIdx);
                                  }}
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
              ) : isImage ? (
                <div class="node-image-container" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                  <img
                    src={node.fileDataUrl || node.imageUrl || (node.fileHash ? `/api/attachments/${node.fileHash}` : '')}
                    alt={node.fileName || node.text || t('canvas.screenshot')}
                    class="node-rendered-img"
                    style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
                  />
                </div>
              ) : node.fileHash ? (
                (() => {
                  const isAud = (node.fileName || '').match(/\.(mp3|ogg|wav)$/i);
                  const isVid = (node.fileName || '').match(/\.(mp4|webm)$/i);
                  if (isAud) {
                    return (
                      <div class="node-media-container" onMouseDown={(e) => e.stopPropagation()}>
                        <audio controls src={node.fileDataUrl || `/api/attachments/${node.fileHash}`} style={{ width: '100%' }} />
                      </div>
                    );
                  }
                  if (isVid) {
                    return (
                      <div class="node-media-container" onMouseDown={(e) => e.stopPropagation()}>
                        <video controls src={node.fileDataUrl || `/api/attachments/${node.fileHash}`} style={{ width: '100%', maxHeight: '100%' }} />
                      </div>
                    );
                  }
                  const isPdf = (node.fileName || '').toLowerCase().endsWith('.pdf');
                  const DOC_BASE_WIDTH = 620;
                  const scale = Math.max(0.2, node.w / DOC_BASE_WIDTH);

                  const convertToNote = (e: MouseEvent) => {
                    e.stopPropagation();
                    const noteTitle = (node.fileName || node.text || t('canvas.document')).replace(/\.[^/.]+$/, '');
                    const noteContent = node.extractedText || `# ${noteTitle}\n\n`;
                    const noteId = createNote(noteTitle, null);
                    const noteDoc = yjsClient.getOrCreateDoc(getScopedNoteDocName(effectiveScope, noteId));
                    noteDoc.getText('text').insert(0, noteContent);
                    openTab('note', noteId, noteTitle);
                    ensureSplitTabs();
                    setWorkspaceMode('split');
                    showToast(`${t('toast.note_created')}: "${noteTitle}"`);
                  };

                  

                  const isSpreadsheetCard = Boolean(
                    (node.fileName || '').match(/\.(xlsx?|xls|csv|tsv|ods)$/i) ||
                    (node.extractedText && (node.extractedText.includes('"sheets"') || node.extractedText.trim().startsWith('[[')))
                  );

                  return (
                    <div
                      class="node-file-wrapper miro-document-card"
                      style={{ position: 'relative' }}
                      onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                    >
                      {!isSelected && (
                        <div
                          class="document-click-shield"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 10,
                            cursor: 'move',
                            background: 'transparent'
                          }}
                          onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNodeIds(new Set([node.id]));
                          }}
                        />
                      )}
                      <div class="node-file-header" onMouseDown={(e) => handleNodePointerDown(node, e as any)}>
                        <div class="node-file-title-group">
                          <Icon name="file-text" size={16} />
                          <span class="node-file-name" title={node.fileName || node.text}>
                            {node.fileName || node.text}
                          </span>
                        </div>
                        <div class="node-file-actions" onMouseDown={(e) => e.stopPropagation()}>
                          {/* In-place edit toggle for spreadsheet cards without split-screen JSON dump */}
                          {isSpreadsheetCard ? (
                            <button
                              type="button"
                              class={`node-file-btn ${isEditingGrid[node.id] ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsEditingGrid((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
                              }}
                              title={isEditingGrid[node.id] ? 'Finish cell editing' : 'Edit cells in-place'}
                              style={isEditingGrid[node.id] ? { color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.5)', background: 'rgba(56, 189, 248, 0.15)' } : undefined}
                            >
                              <Icon name={isEditingGrid[node.id] ? 'check' : 'edit'} size={12} />
                              <span>{isEditingGrid[node.id] ? 'Done' : t('notes.edit')}</span>
                            </button>
                          ) : (
                            node.extractedText && (
                              <button
                                type="button"
                                class="node-file-btn"
                                onClick={convertToNote}
                                title={t('notes.edit')}
                              >
                                <Icon name="note-card" size={12} />
                                <span>{t('notes.edit')}</span>
                              </button>
                            )
                          )}
                          {isSpreadsheetCard && (
                            <button
                              type="button"
                              class="node-file-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                try {
                                  const parsed = JSON.parse(node.extractedText || '{}');
                                  const sIdx = workbookSheetMap[node.id] || 0;
                                  const sheet = parsed?.sheets?.[sIdx] || parsed?.sheets?.[0];
                                  const matrixData = sheet?.data || (Array.isArray(parsed) ? parsed : []);
                                  if (matrixData.length > 0) {
                                    const csvContent = matrixData.map((row: string[]) => row.map((c: string) => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
                                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `${sheet?.name || 'Sheet'}.csv`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                    showToast(`Exported "${sheet?.name || 'Sheet'}.csv"`, 'success');
                                  }
                                } catch (err) {
                                  console.error('Export error:', err);
                                }
                              }}
                              title="Export active sheet as CSV"
                            >
                              <Icon name="download" size={12} />
                              <span>Export</span>
                            </button>
                          )}
                          <a
                            href={node.fileDataUrl || `/api/attachments/${node.fileHash}`}
                            download={node.fileName || 'file'}
                            class="node-file-btn"
                            target="_blank"
                            rel="noopener"
                            title={t('common.download')}
                          >
                            <Icon name="download" size={12} />
                            <span>{t('common.download')}</span>
                          </a>
                        </div>
                      </div>

                      {isPdf ? (
                        getSafeAttachmentUrl(node.fileDataUrl, node.fileHash) ? (
                          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                            {!isSelected && (
                              <div
                                class="pdf-card-select-shield"
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: 10,
                                  cursor: 'move',
                                  background: 'transparent'
                                }}
                                onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedNodeIds(new Set([node.id]));
                                }}
                              />
                            )}
                            <iframe
                              src={getSafeAttachmentUrl(node.fileDataUrl, node.fileHash)}
                              class="node-file-pdf-iframe"
                              title={node.fileName || 'PDF'}
                              style={{
                                width: '100%',
                                height: '100%',
                                border: 'none',
                                background: '#ffffff',
                                pointerEvents: (!isSelected || dragState || resizeState || panState || isSpacePressed || activeTool === 'hand') ? 'none' : 'auto'
                              }}
                            />
                          </div>
                        ) : (
                          <div
                            class="node-doc-page-container scrollable-card-content"
                            onWheel={(e) => {
                              if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div
                              class="node-doc-sheet"
                              style={{
                                width: `${DOC_BASE_WIDTH}px`,
                                transform: `scale(${scale})`,
                                transformOrigin: 'top left'
                              }}
                            >
                              {node.extractedText || t('canvas.extracting_pdf')}
                            </div>
                          </div>
                        )
                      ) : (
                        (() => {
                          let parsedWorkbook: { sheets: { name: string; data: string[][] }[] } | null = null;
                          if (node.extractedText && node.extractedText.includes('"sheets"')) {
                            try {
                              const parsed = JSON.parse(node.extractedText);
                              if (parsed && Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
                                parsedWorkbook = parsed;
                              }
                            } catch {}
                          }

                          if (parsedWorkbook) {
                            const activeIdx = workbookSheetMap[node.id] || 0;
                            const currentSheet = parsedWorkbook.sheets[activeIdx] || parsedWorkbook.sheets[0];
                            const matrix = currentSheet.data;

                            return (
                              <div
                                class="excel-workbook-container"
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  width: '100%',
                                  height: '100%',
                                  overflow: 'hidden',
                                  background: '#141620',
                                  borderRadius: '0 0 8px 8px'
                                }}
                              >
                                {/* Spreadsheet Grid */}
                                <div
                                  class="excel-grid-scroll-area"
                                  style={{ flex: 1, overflow: 'auto', padding: '6px' }}
                                  onWheel={(e) => {
                                    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                                  }}
                                >
                                  <div
                                    class="node-table-grid"
                                    style={{
                                      gridTemplateColumns: `repeat(${matrix[0]?.length || 3}, minmax(130px, max-content))`,
                                      gridAutoRows: '34px',
                                      alignContent: 'start',
                                      width: 'max-content',
                                      minWidth: '100%'
                                    }}
                                  >
                                    {matrix.map((row, rIdx) =>
                                      row.map((cell, cIdx) => {
                                        const isCellEditing =
                                          Boolean(isEditingGrid[node.id]) ||
                                          (activeCellEdit?.nodeId === node.id &&
                                            activeCellEdit?.sheetIdx === activeIdx &&
                                            activeCellEdit?.rowIdx === rIdx &&
                                            activeCellEdit?.colIdx === cIdx);

                                        return (
                                          <div
                                            key={`${rIdx}-${cIdx}`}
                                            class="node-table-cell"
                                            style={{
                                              background: rIdx === 0 ? 'rgba(56, 189, 248, 0.14)' : (rIdx % 2 === 1 ? '#181b26' : '#141722'),
                                              fontWeight: rIdx === 0 ? 600 : 400,
                                              color: rIdx === 0 ? '#38bdf8' : '#e2e8f0',
                                              padding: isCellEditing ? '0' : '6px 10px',
                                              fontSize: '12.5px',
                                              whiteSpace: 'nowrap',
                                              borderRight: '1px solid rgba(255, 255, 255, 0.06)',
                                              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                                              cursor: isCellEditing ? 'text' : 'pointer',
                                              position: 'relative'
                                            }}
                                            title={cell}
                                            onDblClick={(e) => {
                                              e.stopPropagation();
                                              setActiveCellEdit({ nodeId: node.id, sheetIdx: activeIdx, rowIdx: rIdx, colIdx: cIdx });
                                            }}
                                          >
                                            {isCellEditing ? (
                                              <input
                                                type="text"
                                                class="excel-cell-input"
                                                defaultValue={cell}
                                                autoFocus={activeCellEdit?.rowIdx === rIdx && activeCellEdit?.colIdx === cIdx}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => {
                                                  e.stopPropagation();
                                                  if (e.key === 'Enter' || e.key === 'Escape') {
                                                    handleWorkbookCellChange(node.id, activeIdx, rIdx, cIdx, (e.target as HTMLInputElement).value);
                                                    setActiveCellEdit(null);
                                                    (e.target as HTMLInputElement).blur();
                                                  }
                                                }}
                                                onBlur={(e) => {
                                                  handleWorkbookCellChange(node.id, activeIdx, rIdx, cIdx, (e.target as HTMLInputElement).value);
                                                  if (activeCellEdit?.rowIdx === rIdx && activeCellEdit?.colIdx === cIdx) {
                                                    setActiveCellEdit(null);
                                                  }
                                                }}
                                              />
                                            ) : (
                                              cell || '\u00A0'
                                            )}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>

                                {/* Sheet Switcher Tabs Bar */}
                                <div
                                  class="excel-sheet-tabs-bar"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    background: '#0c0e14',
                                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                                    overflowX: 'auto',
                                    flexShrink: 0
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  {parsedWorkbook.sheets.map((sheet, sIdx) => (
                                    <button
                                      key={sheet.name || sIdx}
                                      type="button"
                                      class={`excel-sheet-tab-btn ${activeIdx === sIdx ? 'active' : ''}`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 500,
                                        color: activeIdx === sIdx ? '#38bdf8' : '#94a3b8',
                                        background: activeIdx === sIdx ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                                        border: `1px solid ${activeIdx === sIdx ? 'rgba(56, 189, 248, 0.35)' : 'transparent'}`,
                                        cursor: 'pointer'
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setWorkbookSheetMap((prev) => ({ ...prev, [node.id]: sIdx }));
                                      }}
                                    >
                                      <Icon name="table" size={12} />
                                      <span>{sheet.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          }

                          if (node.extractedText && node.extractedText.trim().startsWith('[[')) {
                            try {
                              const matrix: string[][] = JSON.parse(node.extractedText);
                              if (Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0])) {
                                return (
                                  <div class="node-table-wrapper" style={{ width: '100%', height: '100%', overflow: 'auto', background: '#161822', borderRadius: '0 0 8px 8px', padding: '6px' }}>
                                    <div
                                      class="node-table-grid"
                                      style={{
                                        gridTemplateColumns: `repeat(${matrix[0].length}, minmax(110px, 1fr))`,
                                        gridAutoRows: '32px',
                                        alignContent: 'start',
                                        flex: 1
                                      }}
                                    >
                                      {matrix.map((row, rIdx) =>
                                        row.map((cell, cIdx) => (
                                          <div
                                            key={`${rIdx}-${cIdx}`}
                                            class="node-table-cell"
                                            style={{
                                              background: rIdx === 0 ? 'rgba(255, 255, 255, 0.08)' : '#181b26',
                                              fontWeight: rIdx === 0 ? 600 : 400,
                                              color: rIdx === 0 ? '#f1f5f9' : '#cbd5e1',
                                              padding: '4px 8px',
                                              fontSize: '12px',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap'
                                            }}
                                            title={cell}
                                          >
                                            {cell || '\u00A0'}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                            } catch {}
                          }
                          return (
                            <div
                              class="node-doc-page-container scrollable-card-content"
                              onWheel={(e) => {
                                if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <div
                                class="node-doc-sheet"
                                style={{
                                  width: `${DOC_BASE_WIDTH}px`,
                                  transform: `scale(${scale})`,
                                  transformOrigin: 'top left'
                                }}
                              >
                                <MarkdownPreview content={node.extractedText || t('canvas.extracting_doc')} />
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  );
                })()
              ) : isFrame ? (
                <div class="frame-label-area" onDblClick={(e) => { e.stopPropagation(); startEditingNode(node.id, false); }}>
                  {editingNodeId === node.id ? (
                    <input
                      type="text"
                      class="frame-label-input"
                      style={{ fontSize: `${frameFontSize}px` }}
                      value={node.text}
                      autoFocus
                      placeholder={t('dock.frame')}
                      onBlur={() => setEditingNodeId(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          e.preventDefault();
                          setEditingNodeId(null);
                        }
                      }}
                      onInput={(e) => {
                        const map = yNodes.get(node.id);
                        if (map) {
                          setNodeProperties(map, { text: (e.target as HTMLInputElement).value });
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span class="frame-label-text" style={{ fontSize: `${frameFontSize}px` }}>{node.text || t('canvas.frame')}</span>
                  )}
                </div>
              ) : node.type === 'shape' ? (
                <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {renderShapeSvg(node, nodeColorHex)}
                  <div
                    class="shape-text-flex-container"
                    style={{
                      position: 'absolute',
                      inset: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: editingNodeId === node.id ? 'auto' : 'none',
                      overflow: 'hidden'
                    }}
                  >
                    <textarea
                      id={`node-textarea-${node.id}`}
                      class="node-inline-textarea shape-inline-textarea"
                      style={{
                        fontSize: `${node.fontSize || calculateAutoFontSize(node.text, node.w, node.h, 'shape')}px`,
                        pointerEvents: editingNodeId === node.id ? 'auto' : 'none',
                        textAlign: 'center',
                        width: '100%',
                        height: 'auto',
                        maxHeight: '100%',
                        resize: 'none',
                        lineHeight: 1.35
                      }}
                      rows={Math.min(8, Math.max(1, (node.text || '').split('\n').length))}
                      value={node.text}
                      placeholder={t('canvas.enter_text')}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                      onBlur={() => setEditingNodeId(null)}
                      onMouseDown={(e) => {
                        if (editingNodeId === node.id) e.stopPropagation();
                      }}
                      onPointerDown={(e) => {
                        if (editingNodeId === node.id) e.stopPropagation();
                      }}
                      onClick={(e) => {
                        if (editingNodeId === node.id) e.stopPropagation();
                      }}
                      onDblClick={(e) => {
                        if (editingNodeId === node.id) e.stopPropagation();
                      }}
                      onFocus={() => setSelectedNodeIds((prev) => (prev.size > 1 && prev.has(node.id) ? prev : new Set([node.id])))}
                      onInput={(e) => {
                        const map = yNodes.get(node.id);
                        if (map) {
                          const target = e.target as HTMLTextAreaElement;
                          setNodeProperties(map, { text: target.value });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab' && !e.shiftKey) {
                          e.preventDefault();
                          chainNextSticky(node, 'right');
                        }
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          chainNextSticky(node, 'down');
                        }
                      }}
                    />
                  </div>
                </div>
              ) : node.type === 'checklist' ? (
                (() => {
                  const items = parseChecklistItems(node.text);
                  const doneCount = items.filter((it) => it.done).length;
                  const progressPct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;
                  const baseW = 280;
                  const baseH = Math.max(180, 85 + items.length * 36);
                  const targetW = Math.max(60, node.w - 4);
                  const targetH = Math.max(40, node.h - 4);
                  const scale = Math.max(0.2, Math.min(targetW / baseW, targetH / baseH));
                  const innerW = Math.round(targetW / scale);
                  const innerH = Math.round(targetH / scale);
                  return (
                    <div
                      class="node-checklist-card widget-scale-surface"
                      style={{
                        width: `${innerW}px`,
                        height: `${innerH}px`,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        flex: 'none'
                      }}
                      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) return; if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(new Set([node.id])); }}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                    >
                      <div
                        class="card-top-drag-header checklist-title-row"
                        style={widgetHeaderStyle}
                        onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                      >
                        <div class="card-drag-grip" title={t('widget.checklist')}>
                          <Icon name="grip-vertical" size={14} />
                        </div>
                        <input
                          type="text"
                          class="checklist-title-input"
                          value={node.fileName ?? ''}
                          placeholder={t('widget.checklist_title')}
                          readOnly={isViewerMode.value}
                          onMouseDown={(e) => e.stopPropagation()}
                          onInput={(e) => {
                            if (isViewerMode.value) return;
                            const map = yNodes.get(node.id);
                            if (map) setNodeProperties(map, { fileName: (e.target as HTMLInputElement).value });
                          }}
                        />
                        <span class="checklist-progress-text">{doneCount}/{items.length} — {progressPct}%</span>
                      </div>
                      <div class="checklist-progress-container">
                        <div class="checklist-progress-bar">
                          <div class="checklist-progress-fill" style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>
                      <div class="checklist-items-scroll scrollable-card-content" onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}>
                        {items.map((item, idx) => (
                          <div key={item.id} class={`checklist-item-row ${item.done ? 'done' : ''}`}>
                            <button
                              type="button"
                              class={`checklist-checkbox-btn ${item.done ? 'checked' : ''}`}
                              disabled={isViewerMode.value}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isViewerMode.value) handleToggleChecklistItem(node, idx);
                              }}
                            >
                              {item.done && <Icon name="check" size={11} color="#ffffff" />}
                            </button>
                            <input
                              type="text"
                              class={`checklist-item-input ${item.done ? 'done' : ''}`}
                              value={item.text}
                              readOnly={isViewerMode.value}
                              onMouseDown={(e) => e.stopPropagation()}
                              onInput={(e) => {
                                if (!isViewerMode.value) handleUpdateChecklistText(node, idx, (e.target as HTMLInputElement).value);
                              }}
                            />
                            {!isViewerMode.value && (
                              <button
                                type="button"
                                class="checklist-item-del-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteChecklistItem(node, idx);
                                }}
                                title={t("widget.delete_item")}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {!isViewerMode.value && (
                        <button
                          type="button"
                          class="checklist-add-row-btn"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => handleAddChecklistItem(node)}
                        >
                          <Icon name="plus" size={13} />
                          <span>{t("widget.add_item")}</span>
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : node.type === 'table' ? (
                (() => {
                  const table = parseTableData(node.text);
                  const cols = table[0]?.length || 3;
                  const baseW = Math.max(280, cols * 115);
                  const baseH = Math.max(140, 50 + table.length * 38);
                  const targetW = Math.max(60, node.w - 4);
                  const targetH = Math.max(40, node.h - 4);
                  const scale = Math.max(0.2, Math.min(targetW / baseW, targetH / baseH));
                  const innerW = Math.round(targetW / scale);
                  const innerH = Math.round(targetH / scale);
                  return (
                    <div
                      class="node-table-wrapper widget-scale-surface"
                      style={{
                        width: `${innerW}px`,
                        height: `${innerH}px`,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        flex: 'none'
                      }}
                      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) return; if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(new Set([node.id])); }}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                    >
                      <div
                        class="card-top-drag-header node-table-toolbar"
                        style={widgetHeaderStyle}
                        onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                      >
                        <div class="card-drag-grip" title={t('widget.table')}>
                          <Icon name="grip-vertical" size={14} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginRight: 'auto' }}>{t('widget.table')}</span>
                        {!isViewerMode.value && (
                          <div class="card-header-actions" onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '4px' }}>
                            <button type="button" class="table-tool-btn" onClick={() => handleAddTableRow(node)}>{t('widget.add_row')}</button>
                            <button type="button" class="table-tool-btn" onClick={() => handleDelTableRow(node)}>{t('widget.del_row')}</button>
                            <button type="button" class="table-tool-btn" onClick={() => handleAddTableCol(node)}>{t('widget.add_col')}</button>
                            <button type="button" class="table-tool-btn" onClick={() => handleDelTableCol(node)}>{t('widget.del_col')}</button>
                          </div>
                        )}
                      </div>
                      <div
                        class="node-table-grid scrollable-card-content"
                        style={{
                          gridTemplateColumns: `repeat(${table[0]?.length || 3}, minmax(140px, 1fr))`,
                          gridAutoRows: '38px',
                          alignContent: 'start',
                          flex: 1
                        }}
                        onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
                      >
                        {table.map((row, rIdx) =>
                          row.map((cell, cIdx) => {
                            const isHeaderRow = rIdx === 0;
                            const cellStyle = isHeaderRow && nodeColorHex !== CANVAS_COLORS.default ? {
                              background: `linear-gradient(180deg, ${nodeColorHex}22 0%, #181b26 100%)`
                            } : undefined;
                            return (
                              <div key={`${rIdx}-${cIdx}`} class="node-table-cell" style={cellStyle}>
                              <input
                                type="text"
                                value={cell}
                                readOnly={isViewerMode.value}
                                placeholder={rIdx === 0 ? `${t('widget.column')} ${cIdx + 1}` : ''}
                                onMouseDown={(e) => e.stopPropagation()}
                                onInput={(e) => {
                                  if (!isViewerMode.value) handleUpdateTableCell(node, rIdx, cIdx, (e.target as HTMLInputElement).value);
                                }}
                              />
                            </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : node.type === 'kanban' ? (
                (() => {
                  const cards = parseKanbanCards(node.description);
                  const baseW = 280;
                  const baseH = Math.max(260, 95 + cards.length * 48);
                  const targetW = Math.max(60, node.w - 4);
                  const targetH = Math.max(40, node.h - 4);
                  const scale = Math.max(0.2, Math.min(targetW / baseW, targetH / baseH));
                  const innerW = Math.round(targetW / scale);
                  const innerH = Math.round(targetH / scale);
                  return (
                    <div
                      class="node-kanban-column widget-scale-surface"
                      style={{
                        width: `${innerW}px`,
                        height: `${innerH}px`,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        flex: 'none'
                      }}
                      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) return; if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(new Set([node.id])); }}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                    >
                      <div
                        class="card-top-drag-header kanban-header-bar"
                        style={widgetHeaderStyle}
                        onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                      >
                        <div class="card-drag-grip" title={t('widget.kanban')}>
                          <Icon name="grip-vertical" size={14} />
                        </div>
                        <div class="kanban-title-group" style={{ flex: 1, minWidth: 0 }}>
                          <span class="kanban-dot" style={{ backgroundColor: nodeColorHex }} />
                          <input
                            type="text"
                            class="kanban-title"
                            style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%' }}
                            value={node.text ?? ''}
                            placeholder={t('widget.todo')}
                            readOnly={isViewerMode.value}
                            onMouseDown={(e) => e.stopPropagation()}
                            onInput={(e) => {
                              if (isViewerMode.value) return;
                              const map = yNodes.get(node.id);
                              if (map) setNodeProperties(map, { text: (e.target as HTMLInputElement).value });
                            }}
                          />
                        </div>
                        <span class="kanban-count-badge">{cards.length}</span>
                      </div>
                      <div class="kanban-cards-area scrollable-card-content" onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}>
                        {cards.map((card, idx) => (
                          <div key={`${node.id}_kcard_${idx}`} class="checklist-item-row" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '6px' }}>
                            <input
                              type="text"
                              class="checklist-item-input"
                              value={card}
                              readOnly={isViewerMode.value}
                              onMouseDown={(e) => e.stopPropagation()}
                              onInput={(e) => {
                                if (!isViewerMode.value) handleUpdateKanbanCard(node, idx, (e.target as HTMLInputElement).value);
                              }}
                            />
                            {!isViewerMode.value && (
                              <button
                                type="button"
                                class="checklist-item-del-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteKanbanCard(node, idx);
                                }}
                                title={t("widget.delete_item")}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {!isViewerMode.value && (
                        <button
                          type="button"
                          class="kanban-add-card-btn"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => handleAddKanbanCard(node)}
                        >
                          <Icon name="plus" size={13} />
                          <span>{t("widget.add_card")}</span>
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : node.type === 'code' ? (
                (() => {
                  const lang = node.codeLanguage || 'typescript';
                  const baseW = 360;
                  const baseH = 220;
                  const targetW = Math.max(60, node.w - 4);
                  const targetH = Math.max(40, node.h - 4);
                  const scale = Math.max(0.2, Math.min(targetW / baseW, targetH / baseH));
                  const innerW = Math.round(targetW / scale);
                  const innerH = Math.round(targetH / scale);
                  return (
                    <div
                      class="node-code-block widget-scale-surface"
                      style={{
                        width: `${innerW}px`,
                        height: `${innerH}px`,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        flex: 'none'
                      }}
                      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) return; if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(new Set([node.id])); }}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                    >
                      <div
                        class="card-top-drag-header code-header-bar"
                        onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                      >
                        <div class="card-drag-grip" title={t('widget.code')}>
                          <Icon name="grip-vertical" size={14} />
                        </div>
                        <div class="card-header-actions" onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                          <select
                            class="code-lang-selector"
                            value={lang}
                            disabled={isViewerMode.value}
                            onChange={(e) => {
                              if (isViewerMode.value) return;
                              const map = yNodes.get(node.id);
                              if (map) map.set('codeLanguage', (e.target as HTMLSelectElement).value);
                            }}
                          >
                            <option value="typescript">TypeScript</option>
                            <option value="javascript">JavaScript</option>
                            <option value="python">Python</option>
                            <option value="sql">SQL</option>
                            <option value="json">JSON</option>
                            <option value="html">HTML</option>
                            <option value="css">CSS</option>
                            <option value="bash">Bash</option>
                          </select>
                          <button
                            type="button"
                            class="code-copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(node.text || '');
                              showToast(t('widget.code_copied'));
                            }}
                            title={t("widget.copy_code")}
                          >
                            <Icon name="copy" size={12} />
                            <span>{t("widget.copy_code")}</span>
                          </button>
                        </div>
                      </div>
                      <textarea
                        class="code-textarea-editor"
                        value={node.text}
                        readOnly={isViewerMode.value}
                        placeholder={`// ${t('widget.code_placeholder')}`}
                        spellcheck={false}
                        onWheel={(e) => {
                          if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                        }}
                        onInput={(e) => {
                          if (isViewerMode.value) return;
                          const map = yNodes.get(node.id);
                          if (map) setNodeProperties(map, { text: (e.target as HTMLTextAreaElement).value });
                        }}
                        onKeyDown={(e) => {
                          if (isViewerMode.value) return;
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const ta = e.currentTarget;
                            const start = ta.selectionStart;
                            const end = ta.selectionEnd;
                            const val = ta.value;
                            const updated = val.substring(0, start) + '  ' + val.substring(end);
                            ta.value = updated;
                            ta.selectionStart = ta.selectionEnd = start + 2;
                            const map = yNodes.get(node.id);
                            if (map) setNodeProperties(map, { text: updated });
                          }
                        }}
                      />
                    </div>
                  );
                })()
              ) : node.type === 'chart' ? (
                (() => {
                  const chartType = node.chartType || 'pie';
                  const data = (node.chartData && node.chartData.length > 0)
                    ? node.chartData
                    : [
                        { id: '1', label: `${t('widget.category')} A`, value: 75, color: '#6366f1' },
                        { id: '2', label: `${t('widget.category')} B`, value: 25, color: '#10b981' }
                      ];
                  const THEME_PALETTES: Record<string, string[]> = {
                    '1': ['#d97706', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'],
                    '2': ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'],
                    '3': ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#d97706'],
                    '4': ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'],
                    '5': ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#06b6d4'],
                    '6': ['#64748b', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
                  };
                  const activePalette = THEME_PALETTES[rawColor] || ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];
                  const chartPrimaryColor = activePalette[0];
                  const themedData = data.map((seg, idx) => {
                    const fallbackColor = activePalette[idx % activePalette.length];
                    let segColor = seg.color || fallbackColor;
                    if (idx === 0) segColor = chartPrimaryColor;
                    else if (segColor === chartPrimaryColor) segColor = fallbackColor;
                    return { ...seg, color: segColor };
                  });
                  const total = themedData.reduce((sum, d) => sum + (Math.max(0, Number(d.value)) || 0), 0) || 1;
                  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];

                  const updateData = (newData: typeof data) => {
                    const map = yNodes.get(node.id);
                    if (map) setNodeProperties(map, { chartData: newData });
                  };

                  const setChartMode = (mode: 'pie' | 'donut' | 'square' | 'bar' | 'line' | 'funnel') => {
                    const map = yNodes.get(node.id);
                    if (map) setNodeProperties(map, { chartType: mode });
                  };

                  const baseW = 380;
                  const baseH = 360;
                  const targetW = Math.max(60, node.w - 4);
                  const targetH = Math.max(40, node.h - 4);
                  const scale = Math.max(0.2, Math.min(targetW / baseW, targetH / baseH));
                  const innerW = Math.round(targetW / scale);
                  const innerH = Math.round(targetH / scale);

                  return (
                    <div
                      class="node-chart-card widget-scale-surface"
                      style={{
                        width: `${innerW}px`,
                        height: `${innerH}px`,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        flex: 'none'
                      }}
                      onClick={() => setSelectedNodeIds(new Set([node.id]))}
                      onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                      }}
                    >
                      <div
                        class="card-top-drag-header chart-header"
                        style={widgetHeaderStyle}
                        onMouseDown={(e) => handleNodePointerDown(node, e as any)}
                      >
                        <div class="card-drag-grip" title={t('widget.chart')}>
                          <Icon name="grip-vertical" size={14} />
                        </div>
                        <input
                          class="chart-title-input"
                          value={node.text ?? ''}
                          placeholder={t('widget.chart')}
                          readOnly={isViewerMode.value}
                          onMouseDown={(e) => e.stopPropagation()}
                          onInput={(e) => {
                            if (isViewerMode.value) return;
                            const map = yNodes.get(node.id);
                            if (map) setNodeProperties(map, { text: (e.target as HTMLInputElement).value });
                          }}
                          onChange={() => {
                            if (isViewerMode.value) return;
                          }}
                        />
                        {!isViewerMode.value && (
                          <div class="chart-mode-pill-group" onMouseDown={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'pie' ? 'active' : ''}`}
                              onClick={() => setChartMode('pie')}
                              title={t('widget.chart_pie')}
                            >
                              {t('widget.chart_pie')}
                            </button>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'donut' ? 'active' : ''}`}
                              onClick={() => setChartMode('donut')}
                              title={t('widget.chart_donut')}
                            >
                              {t('widget.chart_donut')}
                            </button>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'square' ? 'active' : ''}`}
                              onClick={() => setChartMode('square')}
                              title={t('widget.chart_bar')}
                            >
                              {t('widget.chart_bar')}
                            </button>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'bar' ? 'active' : ''}`}
                              onClick={() => setChartMode('bar')}
                              title={t('widget.chart_columns')}
                            >
                              {t('widget.chart_columns')}
                            </button>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'line' ? 'active' : ''}`}
                              onClick={() => setChartMode('line')}
                              title="Line Chart"
                            >
                              Line
                            </button>
                            <button
                              type="button"
                              class={`chart-mode-btn ${chartType === 'funnel' ? 'active' : ''}`}
                              onClick={() => setChartMode('funnel')}
                              title="Funnel Chart"
                            >
                              Funnel
                            </button>
                          </div>
                        )}
                      </div>

                      <div class="chart-visual-area">
                        {chartType === 'pie' || chartType === 'donut' ? (
                          <svg viewBox="0 0 250 250" class="chart-svg-render" style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', flex: 1 }}>
                            {(() => {
                              const cx = 125;
                              const cy = 125;
                              const r = 70;
                              const rIn = chartType === 'donut' ? 44 : 0;
                              let smallSliceCounter = 0;
                              let startAngle = -Math.PI / 2;

                              const validSegments = themedData.filter((d) => (Number(d.value) || 0) > 0);
                              if (validSegments.length <= 1) {
                                const onlyItem = validSegments[0] || themedData[0];
                                return (
                                  <>
                                    {chartType === 'pie' ? (
                                      <circle cx={cx} cy={cy} r={r} fill={onlyItem?.color || '#6366f1'} />
                                    ) : (
                                      <circle
                                        cx={cx}
                                        cy={cy}
                                        r={(r + rIn) / 2}
                                        stroke={onlyItem?.color || '#6366f1'}
                                        strokeWidth={r - rIn}
                                        fill="none"
                                      />
                                    )}
                                    <text
                                      x={cx}
                                      y={cy}
                                      fill="#ffffff"
                                      fontSize="14"
                                      fontWeight="700"
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}
                                    >
                                      100%
                                    </text>
                                  </>
                                );
                              }

                              const slicePaths: any[] = [];
                              const sliceLabels: any[] = [];

                              themedData.forEach((seg) => {
                                const val = Math.max(0, Number(seg.value) || 0);
                                if (val <= 0) return;
                                const fraction = val / total;
                                const angle = fraction * 2 * Math.PI;
                                const endAngle = startAngle + angle;
                                const largeArc = angle > Math.PI ? 1 : 0;

                                const x0 = cx + r * Math.cos(startAngle);
                                const y0 = cy + r * Math.sin(startAngle);
                                const x1 = cx + r * Math.cos(endAngle);
                                const y1 = cy + r * Math.sin(endAngle);

                                let dPath = '';
                                if (chartType === 'pie') {
                                  dPath = `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
                                } else {
                                  const x0In = cx + rIn * Math.cos(startAngle);
                                  const y0In = cy + rIn * Math.sin(startAngle);
                                  const x1In = cx + rIn * Math.cos(endAngle);
                                  const y1In = cy + rIn * Math.sin(endAngle);
                                  dPath = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x1In.toFixed(2)} ${y1In.toFixed(2)} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x0In.toFixed(2)} ${y0In.toFixed(2)} Z`;
                                }

                                slicePaths.push(<path key={`p-${seg.id}`} d={dPath} fill={seg.color} />);

                                const pct = Math.round(fraction * 100);
                                const midAngle = (startAngle + endAngle) / 2;
                                const cosA = Math.cos(midAngle);
                                const sinA = Math.sin(midAngle);
                                if (pct >= 12) {
                                  const labelR = chartType === 'donut' ? (r + rIn) / 2 : r * 0.65;
                                  const lx = cx + labelR * cosA;
                                  const ly = cy + labelR * sinA;
                                  sliceLabels.push(
                                    <text
                                      key={`l-${seg.id}`}
                                      x={lx.toFixed(1)}
                                      y={ly.toFixed(1)}
                                      fill="#ffffff"
                                      fontSize="12"
                                      fontWeight="700"
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}
                                    >
                                      {pct}%
                                    </text>
                                  );
                                } else if (pct > 0) {
                                  const isStaggered = smallSliceCounter % 2 === 1;
                                  smallSliceCounter++;
                                  const calloutR = isStaggered ? (r + 26) : (r + 14);
                                  const textR = isStaggered ? (r + 34) : (r + 21);
                                  const edgeX = cx + (r - 2) * cosA;
                                  const edgeY = cy + (r - 2) * sinA;
                                  const outX = cx + calloutR * cosA;
                                  const outY = cy + calloutR * sinA;
                                  sliceLabels.push(
                                    <g key={`l-${seg.id}`} style={{ pointerEvents: 'none' }}>
                                      <line
                                        x1={edgeX.toFixed(1)}
                                        y1={edgeY.toFixed(1)}
                                        x2={outX.toFixed(1)}
                                        y2={outY.toFixed(1)}
                                        stroke="rgba(255, 255, 255, 0.55)"
                                        strokeWidth="1"
                                      />
                                      <circle cx={edgeX.toFixed(1)} cy={edgeY.toFixed(1)} r="1.5" fill="#ffffff" />
                                      <text
                                        x={(cx + textR * cosA).toFixed(1)}
                                        y={(cy + textR * sinA).toFixed(1)}
                                        fill="#ffffff"
                                        fontSize="10"
                                        fontWeight="700"
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}
                                      >
                                        {pct}%
                                      </text>
                                    </g>
                                  );
                                }

                                startAngle = endAngle;
                              });

                              return (
                                <>
                                  {slicePaths}
                                  {sliceLabels}
                                  {chartType === 'donut' && (
                                    <g style={{ pointerEvents: 'none' }}>
                                      <text x={cx} y={cy - 4} fill="#ffffff" fontSize="14" fontWeight="700" textAnchor="middle">
                                        {total}
                                      </text>
                                      <text x={cx} y={cy + 12} fill="#94a3b8" fontSize="9" fontWeight="600" textAnchor="middle">
                                        TOTAL
                                      </text>
                                    </g>
                                  )}
                                </>
                              );
                            })()}
                          </svg>
                        ) : chartType === 'square' ? (
                          <div style={{ width: '100%', padding: '0 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ width: '100%', height: '32px', display: 'flex', borderRadius: '6px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)' }}>
                              {data.map((seg) => {
                                const val = Math.max(0, Number(seg.value) || 0);
                                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                                return (
                                  <div
                                    key={seg.id}
                                    style={{
                                      flex: val || 1,
                                      background: seg.color,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#fff',
                                      fontSize: '11px',
                                      fontWeight: 'bold',
                                      minWidth: '4px'
                                    }}
                                    title={`${seg.label}: ${pct}%`}
                                  >
                                    {pct >= 10 ? `${pct}%` : ''}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : chartType === 'line' ? (
                          <div style={{ width: '100%', height: '100%', minHeight: '130px', flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column' }}>
                            {(() => {
                              const maxVal = Math.max(1, ...themedData.map((d) => Number(d.value) || 0));
                              const pts = themedData.map((d, i) => {
                                const x = data.length > 1 ? 16 + (i / (data.length - 1)) * 268 : 150;
                                const val = Number(d.value) || 0;
                                const y = 110 - (val / maxVal) * 80;
                                return { x, y, color: d.color, label: d.label, val };
                              });
                              const pathD = pts.length > 0 ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}` : '';
                              return (
                                <svg viewBox="0 0 300 130" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                                  <line x1="16" y1="110" x2="284" y2="110" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                                  {pathD && <path d={pathD} fill="none" stroke={chartPrimaryColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                                  {pts.map((p, idx) => (
                                    <g key={idx}>
                                      <circle cx={p.x} cy={p.y} r="4" fill={p.color} stroke="#ffffff" strokeWidth="1.5" />
                                      <text x={p.x} y="124" fill="#94a3b8" fontSize="9" textAnchor="middle">{p.label}</text>
                                    </g>
                                  ))}
                                </svg>
                              );
                            })()}
                          </div>
                        ) : chartType === 'funnel' ? (
                          <div style={{ width: '100%', height: '100%', minHeight: '130px', flex: 1, padding: '6px 14px', display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
                            {themedData.map((seg, idx) => {
                              const val = Math.max(0, Number(seg.value) || 0);
                              const widthPct = Math.max(28, 100 - idx * (70 / Math.max(1, data.length)));
                              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                              return (
                                <div key={seg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                                  <div
                                    style={{
                                      width: `${widthPct}%`,
                                      height: '24px',
                                      background: seg.color,
                                      borderRadius: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '0 8px',
                                      color: '#ffffff',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                                    }}
                                  >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{seg.label}</span>
                                    <span>{pct}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ width: '100%', height: '100%', minHeight: '110px', flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '14px', padding: '0 12px 6px' }}>
                            {themedData.map((seg) => {
                              const val = Math.max(0, Number(seg.value) || 0);
                              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                              return (
                                <div key={seg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: '64px', height: '100%', justifyContent: 'flex-end', gap: '4px' }}>
                                  <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>{pct}%</span>
                                  <div style={{ width: '100%', height: `${Math.max(6, pct)}%`, minHeight: '6px', background: seg.color, borderRadius: '4px 4px 0 0' }} />
                                  <span style={{ fontSize: '10px', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={seg.label}>{seg.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div class="chart-data-editor" onMouseDown={(e) => e.stopPropagation()}>
                        {data.map((seg) => {
                          const val = Math.max(0, Number(seg.value) || 0);
                          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                          return (
                            <div key={seg.id} class="chart-data-row">
                              <div
                                class="chart-color-dot"
                                style={{ background: seg.color }}
                                title={t("dock.sticky_color")}
                                onClick={() => {
                                  if (isViewerMode.value) return;
                                  const colorIdx = palette.indexOf(seg.color);
                                  const nextColor = palette[(colorIdx + 1) % palette.length];
                                  const updated = data.map((d) => (d.id === seg.id ? { ...d, color: nextColor } : d));
                                  updateData(updated);
                                }}
                              />
                              <input
                                class="chart-row-input label"
                                value={seg.label}
                                placeholder={t("widget.sector_label")}
                                readOnly={isViewerMode.value}
                                onInput={(e) => {
                                  if (isViewerMode.value) return;
                                  const newLabel = (e.target as HTMLInputElement).value;
                                  const updated = data.map((d) => (d.id === seg.id ? { ...d, label: newLabel } : d));
                                  updateData(updated);
                                }}
                                onChange={() => {
                                  if (isViewerMode.value) return;
                                }}
                              />
                              <input
                                class="chart-row-input val"
                                type="number"
                                min="0"
                                value={seg.value}
                                readOnly={isViewerMode.value}
                                onInput={(e) => {
                                  if (isViewerMode.value) return;
                                  const newVal = Number((e.target as HTMLInputElement).value) || 0;
                                  const updated = data.map((d) => (d.id === seg.id ? { ...d, value: newVal } : d));
                                  updateData(updated);
                                }}
                                onChange={() => {
                                  if (isViewerMode.value) return;
                                }}
                              />
                              <span class="chart-pct-badge">{pct}%</span>
                              {!isViewerMode.value && (
                                <button
                                  type="button"
                                  class="chart-del-btn"
                                  title={t('widget.delete_item')}
                                  disabled={data.length <= 1}
                                  style={{ opacity: data.length <= 1 ? 0.3 : 1 }}
                                  onClick={() => {
                                    if (data.length <= 1) return;
                                    const updated = data.filter((d) => d.id !== seg.id);
                                    updateData(updated);
                                  }}
                                >
                                  &times;
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {!isViewerMode.value && (
                          <button
                            type="button"
                            class="chart-add-row-btn"
                            onClick={() => {
                              const newId = String(Date.now());
                              const nextColor = palette[data.length % palette.length];
                              const updated = [...data, { id: newId, label: `${t('widget.sector')} ${data.length + 1}`, value: 10, color: nextColor }];
                              updateData(updated);
                              const map = yNodes.get(node.id);
                              if (map) {
                                const minRequiredH = 260 + updated.length * 36;
                                if (node.h < minRequiredH) {
                                  map.set('h', minRequiredH);
                                }
                              }
                            }}
                          >
                            <Icon name="plus" size={12} />
                            <span>{t("widget.add_sector")}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <textarea
                  id={`node-textarea-${node.id}`}
                  class="node-inline-textarea"
                  style={{
                    fontSize: `${node.fontSize || calculateAutoFontSize(node.text, node.w, node.h, node.type)}px`,
                    pointerEvents: editingNodeId === node.id ? 'auto' : 'none'
                  }}
                  value={node.text}
                  placeholder={t('canvas.enter_text')}
                  onWheel={(e) => {
                    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                  }}
                  onBlur={() => setEditingNodeId(null)}
                  onMouseDown={(e) => {
                    if (editingNodeId === node.id) e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    if (editingNodeId === node.id) e.stopPropagation();
                  }}
                  onClick={(e) => {
                    if (editingNodeId === node.id) e.stopPropagation();
                  }}
                  onDblClick={(e) => {
                    if (editingNodeId === node.id) e.stopPropagation();
                  }}
                  onFocus={() => setSelectedNodeIds((prev) => (prev.size > 1 && prev.has(node.id) ? prev : new Set([node.id])))}
                  onInput={(e) => {
                    const map = yNodes.get(node.id);
                    if (map) {
                      const target = e.target as HTMLTextAreaElement;
                      setNodeProperties(map, { text: target.value });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      chainNextSticky(node, 'right');
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      chainNextSticky(node, 'down');
                    }
                  }}
                />
              )}

              {/* Author micro-badge in Team Scope (never show debug 'Tester') */}
              {node.type === 'sticky' && effectiveScope === 'team' && node.author && node.author !== 'Tester' && (
                <span class="node-author-microbadge" title={`${t('canvas.author')}: ${node.author}`}>
                  {node.author}
                </span>
              )}

              {/* 8-Point Resize Handles (nw, n, ne, e, se, s, sw, w) */}
              {isSelected && !node.locked && !isViewerMode.value && (
                <div class="node-resize-handles-layer">
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]).map((handle) => (
                    <div
                      key={handle}
                      class={`resize-handle handle-${handle}`}
                      style={{
                        transform: `scale(${1 / Math.max(0.005, viewport.zoom)})`,
                        transformOrigin: HANDLE_ANCHORS[handle] || 'center'
                      }}
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
                          startYPos: node.y,
                          startFontSize: node.fontSize || calculateAutoFontSize(node.text, node.w, node.h, node.type)
                        });
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Node Reaction Badge */}
              {Boolean(node.reactions && (node.reactions.thumbsUp || 0) > 0) && (
                <div
                  class="node-reaction-badge"
                  style={{
                    position: 'absolute',
                    bottom: '-10px',
                    right: '8px',
                    background: 'rgba(30, 41, 59, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '12px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#fbbf24',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: 15,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    userSelect: 'none'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isViewerMode.value) return;
                    const map = yNodes.get(node.id);
                    if (map) {
                      map.set('reactions', { thumbsUp: (node.reactions?.thumbsUp || 0) + 1 });
                    }
                  }}
                  title={`${t('canvas.add_reaction')} (+1)`}
                >
                  <Icon name="sparkles" size={12} />
                  <span>{node.reactions?.thumbsUp}</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Dedicated Pure Vector Ink Layer (Drawings never have selection boxes or resize handles) */}
        <svg
          class="miro-ink-layer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 25
          }}
        >
          {nodesList
            .filter((n) => !n.deleted && n.type === 'drawing')
            .map((drawNode) => {
              const mode =
                (drawNode as any).drawMode ||
                (drawNode.opacity && drawNode.opacity < 0.5 ? 'highlighter' : 'pen');
              const baseWidth = drawNode.strokeWidth || 4;
              const color = drawNode.color || '#818cf8';

              return (
                <g
                  key={drawNode.id}
                  transform={`translate(${drawNode.x}, ${drawNode.y})`}
                  style={{ pointerEvents: 'none' }}
                >
                  {renderInkStroke(
                    drawNode.id,
                    drawNode.svgPath || '',
                    color,
                    baseWidth,
                    mode,
                    (drawNode as any).points
                  )}
                </g>
              );
            })}

          {/* Live freehand drawing stroke preview */}
          {currentStroke && currentStroke.length > 1 && (
            <g style={{ pointerEvents: 'none' }}>
              {renderInkStroke(
                'live-preview-stroke',
                pointsToSmoothSvgPath(currentStroke),
                drawColor,
                drawWidth,
                drawMode,
                currentStroke
              )}
            </g>
          )}
        </svg>

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
              transform: `translate3d(${c.x}px, ${c.y}px, 0)`
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={c.color} stroke="#ffffff" stroke-width="1.5">
              <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36z" />
            </svg>
            <span class="remote-cursor-badge" style={{ backgroundColor: c.color }}>
              {c.name && c.name !== 'You' ? c.name : `Collaborator #${c.clientId % 1000}`}
            </span>
          </div>
        ))}
      </div>

      {/* Quick Connect Drop Mini-Menu on Empty Space */}
      {!isViewerMode.value && quickConnect && (
        <div
          class="quick-connect-menu liquid-glass-surface"
          style={{ left: `${quickConnect.x}px`, top: `${quickConnect.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="quick-connect-header">{t('canvas.create_and_connect')}</div>
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
                  author: agentStatus.value?.memberName || 'User',
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
            <span>{t('toolbar.sticky')}</span>
          </button>
          <button
            class="quick-connect-btn"
            onClick={() => {
              pendingConnectFromRef.current = {
                fromNodeId: quickConnect.fromNodeId,
                fromSide: quickConnect.fromSide
              };
              setPickerPos({ x: quickConnect.canvasX, y: quickConnect.canvasY });
              setIsNotePickerOpen(true);
              setQuickConnect(null);
            }}
          >
            <Icon name="note-card" size={14} />
            <span>{t('canvas.note')}</span>
          </button>
          <button
            class="quick-connect-btn"
            onClick={() => {
              createNodeAt('text', quickConnect.canvasX, quickConnect.canvasY);
              setQuickConnect(null);
            }}
          >
            <Icon name="text" size={14} />
            <span>{t('canvas.text')}</span>
          </button>
        </div>
      )}

      {/* Custom Right-Click Context Menu */}
      {!isViewerMode.value && contextMenu && (
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
            <span>{t("context.sticky_here")}</span>
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
            <span>{t("context.create_note")}</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              pasteClipboard(contextMenu.canvasX, contextMenu.canvasY);
              setContextMenu(null);
            }}
          >
            <Icon name="copy" size={14} />
            <span>{t("context.paste")}</span>
          </div>
          <div class="context-menu-divider" />
          <div
            class="context-menu-item"
            onClick={() => {
              const allIds = new Set(nodesList.filter((n) => !n.deleted && n.type !== 'drawing').map((n) => n.id));
              setSelectedNodeIds(allIds);
              setContextMenu(null);
            }}
          >
            <Icon name="select" size={14} />
            <span>{t("context.select_all")}</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              setShowAiModal(true);
              setContextMenu(null);
            }}
          >
            <Icon name="cpu" size={14} />
            <span>{t("context.ai_export")}</span>
          </div>
          <div
            class="context-menu-item"
            onClick={() => {
              const ids = Array.from(selectedNodeIds).length > 0 ? Array.from(selectedNodeIds) : nodesList.filter((n) => !n.deleted).map((n) => n.id);
              handleOpenTransferModal(ids);
              setContextMenu(null);
            }}
          >
            <Icon name={effectiveScope === 'solo' ? 'promote' : 'fork'} size={14} />
            <span>{effectiveScope === 'solo' ? t('canvas.move_to_team') : t('canvas.move_to_solo')}</span>
          </div>
          {(contextMenu.nodeId || selectedNodeIds.size > 0) && (
            <>
              <div class="context-menu-divider" />
              <div
                class="context-menu-item danger"
                onClick={() => {
                  if (selectedNodeIds.size > 0 && (!contextMenu.nodeId || selectedNodeIds.has(contextMenu.nodeId))) {
                    deleteSelected();
                  } else if (contextMenu.nodeId) {
                    deleteSingleNode(contextMenu.nodeId);
                  } else {
                    deleteSelected();
                  }
                  setContextMenu(null);
                }}
              >
                <Icon name="trash" size={14} />
                <span>{selectedNodeIds.size > 1 ? `${t("context.delete")} (${selectedNodeIds.size})` : t("context.delete")}</span>
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
        onClose={() => {
          setIsNotePickerOpen(false);
          pendingConnectFromRef.current = null;
        }}
        onSelectNote={(noteId) => {
          const pos = pickerPos || {
            x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
            y: (window.innerHeight / 2 - viewport.y) / viewport.zoom
          };
          const newNodeId = createNoteCardAt(noteId, pos.x, pos.y);
          if (pendingConnectFromRef.current && newNodeId) {
            const edgeId = crypto.randomUUID();
            yEdges.set(edgeId, {
              id: edgeId,
              from: pendingConnectFromRef.current.fromNodeId,
              to: newNodeId,
              fromSide: pendingConnectFromRef.current.fromSide || 'right',
              toSide: 'left',
              direction: 'forward',
              style: defaultLineStyle.style,
              curveType: defaultLineStyle.curveType,
              color: defaultLineStyle.color,
              deleted: false
            });
            pendingConnectFromRef.current = null;
          }
          setIsNotePickerOpen(false);
        }}
      />

      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        fromScope={effectiveScope}
        boardId={boardId}
        nodeIds={transferNodeIds}
      />

      <CreateBoardModal
        isOpen={isCreateBoardOpen}
        onClose={() => setIsCreateBoardOpen(false)}
      />

      {/* Confirmation Modal for Workspace Conversion */}
      {confirmConvertModal.isOpen && (
        <div
          class="modal-backdrop doks-modal-backdrop"
          onClick={() => setConfirmConvertModal({ isOpen: false, targetScope: 'team' })}
          role="dialog"
          aria-modal="true"
          style={{ zIndex: 2200 }}
        >
          <div
            class="modal-card doks-modal-dialog liquid-glass-surface"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px', padding: '24px', borderRadius: '16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(124, 58, 237, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c084fc'
              }}>
                <Icon name={confirmConvertModal.targetScope === 'team' ? 'users' : 'lock'} size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                {t('workspace.convertTitle')}
              </h3>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: '13px', lineHeight: '1.5', color: '#cbd5e1' }}>
              {confirmConvertModal.targetScope === 'team'
                ? t('workspace.confirmToShared')
                : t('workspace.confirmToSolo')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                class="btn-secondary-sm"
                onClick={() => setConfirmConvertModal({ isOpen: false, targetScope: 'team' })}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="btn-primary-sm"
                style={{ background: '#7c3aed', borderColor: '#8b5cf6', color: '#ffffff' }}
                onClick={async () => {
                  const target = confirmConvertModal.targetScope;
                  setConfirmConvertModal({ isOpen: false, targetScope: 'team' });
                  if (boardId) {
                    await convertBoardScope(boardId, effectiveScope, target);
                  }
                }}
              >
                {confirmConvertModal.targetScope === 'team'
                  ? t('workspace.moveToShared')
                  : t('workspace.makePrivate')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ShareModal
        isOpen={isLanShareOpen}
        onClose={() => setIsLanShareOpen(false)}
        initialTab={shareModalTab}
      />

      <BoardSettingsModal
        isOpen={isBoardSettingsOpen}
        onClose={() => {
          setIsBoardSettingsOpen(false);
          setSettingsTargetBoard(null);
        }}
        boardId={settingsTargetBoard?.id || boardId}
        scope={settingsTargetBoard?.scope || (currentBoardMeta?.scope || effectiveScope)}
        boardTitle={settingsTargetBoard?.title || currentBoardMeta?.title || t('boards.default_title')}
        onClearBoard={() => {
          const targetId = settingsTargetBoard?.id || boardId;
          const targetScope = settingsTargetBoard?.scope || (currentBoardMeta?.scope || effectiveScope);
          const targetDoc = (targetId === boardId && targetScope === effectiveScope)
            ? boardDoc
            : yjsClient.getOrCreateDoc(getScopedBoardDocName(targetScope, targetId));
          const targetNodes = targetDoc.getMap<Y.Map<any>>('nodes');
          let count = 0;
          targetDoc.transact(() => {
            targetNodes.forEach((nodeMap: any) => {
              if (!nodeMap.get('locked') && !nodeMap.get('deleted')) {
                nodeMap.set('deleted', true);
                nodeMap.set('deletedAt', Date.now());
                count++;
              }
            });
          }, 'clear-board');
          if (count > 0) {
            showToast(`${t('toast.board_cleared')} (${count})`, 'info');
          } else {
            showToast(t('toast.board_already_empty'), 'info');
          }
        }}
        onSeedTemplate={() => {
          const targetId = settingsTargetBoard?.id || boardId;
          const targetScope = settingsTargetBoard?.scope || (currentBoardMeta?.scope || effectiveScope);
          const targetDoc = (targetId === boardId && targetScope === effectiveScope)
            ? boardDoc
            : yjsClient.getOrCreateDoc(getScopedBoardDocName(targetScope, targetId));
          seedDefaultBoard(targetDoc, agentStatus.value?.memberName || t('canvas.you'));
          showToast(t('toast.template_loaded'), 'success');
        }}
      />

      <AutoDiagramModal
        isOpen={isAutoDiagramModalOpen}
        onClose={() => setIsAutoDiagramModalOpen(false)}
        onGenerate={handleGenerateAutoDiagram}
        defaultOriginX={Math.round((window.innerWidth / 2 - viewport.x) / viewport.zoom)}
        defaultOriginY={Math.round((window.innerHeight / 2 - viewport.y) / viewport.zoom)}
      />



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
                animateToViewport({ x: newX, y: newY }, false);
              }}
            />
          </div>
        )}

        <div class="zoom-hud-pill liquid-glass-surface">
          <button
            class="hud-btn"
            onClick={() => handleZoomByFactor(0.8)}
            title={t("board.zoom_out")}
          >
            <Icon name="zoom-out" size={14} />
          </button>
          <button
            class="hud-btn zoom-value-btn"
            onClick={handleResetZoom}
            title={t("board.reset_zoom")}
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
          <button
            class="hud-btn"
            onClick={() => handleZoomByFactor(1.25)}
            title={t("board.zoom_in")}
          >
            <Icon name="zoom-in" size={14} />
          </button>
          <div class="hud-divider" />
          <button
            class="hud-btn"
            onClick={fitToContent}
            title={`${t("board.fit_to_screen")} (Shift+1)`}
          >
            <Icon name="layout-canvas" size={14} />
            <span class="hud-btn-text">Fit</span>
          </button>
          <button
            class={`hud-btn ${showMinimap ? 'active' : ''}`}
            onClick={() => setShowMinimap(!showMinimap)}
            title={t("board.minimap")}
          >
            <Icon name="frame" size={14} />
          </button>
        </div>
      </div>

      {/* Freehand Brush Preview Cursor */}
      {(activeTool === 'draw' || activeTool === 'line') && cursorScreenPos && cursorScreenPos.x > 0 && cursorScreenPos.y > 0 && (
        <div
          class="draw-cursor-follower"
          style={{
            position: 'fixed',
            left: `${cursorScreenPos.x}px`,
            top: `${cursorScreenPos.y}px`,
            width: `${Math.max(6, drawWidth * viewport.zoom)}px`,
            height: `${Math.max(6, drawWidth * viewport.zoom)}px`,
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.9)',
            backgroundColor: drawColor,
            boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 9999
          }}
        />
      )}
    </div>
  );
}

export default BoardCanvas;
