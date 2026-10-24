import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as Y from 'yjs';
import {
  getBoardDocName,
  getBoardMaps,
  nodeMapToData,
  setNodeProperties,
  type BoardNodeData,
  type BoardEdgeData,
  type BoardNodeType
} from '@doks/shared';
import { yjsClient } from '../../state/yjs-client.js';
import {
  selectedBoardId,
  selectedNoteId,
  currentView,
  notes,
  boards
} from '../../state/app-state.js';
import { seedDefaultBoard } from './board-seed.js';

export const CANVAS_COLORS: Record<string, string> = {
  '1': '#ef4444', // Red
  '2': '#f97316', // Orange
  '3': '#eab308', // Yellow
  '4': '#22c55e', // Green
  '5': '#06b6d4', // Cyan
  '6': '#a855f7', // Purple
  default: '#3b82f6'
};

interface BoardCanvasProps {
  boardId: string;
}

export function BoardCanvas({ boardId }: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport transformation: pan and zoom
  const [viewport, setViewport] = useState({ x: 100, y: 100, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Data states from Yjs
  const [nodesList, setNodesList] = useState<BoardNodeData[]>([]);
  const [edgesList, setEdgesList] = useState<BoardEdgeData[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Dragging / Resizing
  const [dragNode, setDragNode] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const [resizeNode, setResizeNode] = useState<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Arrow connection
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);

  // Undo manager
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const boardDoc = yjsClient.getOrCreateDoc(getBoardDocName(boardId));
  const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

  useEffect(() => {
    // Seed default board if empty
    seedDefaultBoard(boardDoc);

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

    return () => {
      yNodes.unobserveDeep(updateState);
      yEdges.unobserve(updateState);
      um.destroy();
      undoManagerRef.current = null;
    };
  }, [boardId]);

  // Screen to Canvas coordinate translation
  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - viewport.x) / viewport.zoom;
    const y = (clientY - rect.top - viewport.y) / viewport.zoom;
    return { x, y };
  };

  // Pan and Zoom wheel handler
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.2), 3);
      setViewport((prev) => ({ ...prev, zoom: newZoom }));
    } else {
      // Pan
      setViewport((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY
      }));
    }
  };

  // Add new object with collision avoidance offset
  const handleAddNode = (type: BoardNodeType) => {
    const id = crypto.randomUUID();
    // Center of screen with small random jitter (+-20px) to prevent exact overlap
    const jitterX = Math.floor(Math.random() * 40) - 20;
    const jitterY = Math.floor(Math.random() * 40) - 20;
    const center = screenToCanvas(window.innerWidth / 2 + jitterX, window.innerHeight / 2 + jitterY);

    const nodeMap = new Y.Map();
    const isFrame = type === 'frame';
    const isNote = type === 'note';

    boardDoc.transact(() => {
      yNodes.set(id, nodeMap);
      setNodeProperties(nodeMap, {
        id,
        type,
        x: Math.round(center.x),
        y: Math.round(center.y),
        w: isFrame ? 400 : 200,
        h: isFrame ? 300 : 120,
        text: isFrame ? 'Группа' : isNote ? 'Заметка' : 'Текст стикера',
        color: type === 'sticky' ? '3' : '5',
        author: 'Вы',
        done: false,
        z: isFrame ? 0 : 1,
        deleted: false
      });
    }, 'user');

    setSelectedNodeId(id);
  };

  // Delete selected node
  const handleDeleteSelected = () => {
    if (!selectedNodeId) return;
    const nodeMap = yNodes.get(selectedNodeId);
    if (nodeMap) {
      boardDoc.transact(() => {
        nodeMap.set('deleted', true);
        nodeMap.set('deletedAt', Date.now());
      }, 'user');
      setSelectedNodeId(null);
    }
  };

  // Start connecting arrow
  const handleStartConnect = (nodeId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (connectingFrom && connectingFrom !== nodeId) {
      // Complete connection
      const edgeId = crypto.randomUUID();
      boardDoc.transact(() => {
        yEdges.set(edgeId, {
          id: edgeId,
          from: connectingFrom,
          to: nodeId,
          label: '',
          color: 'default',
          deleted: false
        });
      }, 'user');
      setConnectingFrom(null);
    } else {
      setConnectingFrom(nodeId);
    }
  };

  // Pointer down on background: start pan
  const handleBackgroundMouseDown = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 1) { // Left or middle click
      setSelectedNodeId(null);
      setConnectingFrom(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isPanning) {
      setViewport((prev) => ({
        ...prev,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      }));
    } else if (dragNode) {
      const dx = (e.clientX - dragNode.startX) / viewport.zoom;
      const dy = (e.clientY - dragNode.startY) / viewport.zoom;
      const nodeMap = yNodes.get(dragNode.id);
      if (nodeMap) {
        nodeMap.set('x', Math.round(dragNode.nodeX + dx));
        nodeMap.set('y', Math.round(dragNode.nodeY + dy));
      }
    } else if (resizeNode) {
      const dx = (e.clientX - resizeNode.startX) / viewport.zoom;
      const dy = (e.clientY - resizeNode.startY) / viewport.zoom;
      const nodeMap = yNodes.get(resizeNode.id);
      if (nodeMap) {
        nodeMap.set('w', Math.max(100, Math.round(resizeNode.startW + dx)));
        nodeMap.set('h', Math.max(60, Math.round(resizeNode.startH + dy)));
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDragNode(null);
    setResizeNode(null);
  };

  return (
    <div
      class="board-container"
      ref={containerRef}
      onWheel={(e) => handleWheel(e as any)}
      onMouseDown={(e) => handleBackgroundMouseDown(e as any)}
      onMouseMove={(e) => handleMouseMove(e as any)}
      onMouseUp={handleMouseUp}
    >
      {/* Canvas Toolbar */}
      <div class="canvas-toolbar" onClick={(e) => e.stopPropagation()}>
        <button class="tool-btn" onClick={() => handleAddNode('sticky')} title="Стикер">
          🟡 Стикер
        </button>
        <button class="tool-btn" onClick={() => handleAddNode('text')} title="Текст">
          📝 Текст
        </button>
        <button class="tool-btn" onClick={() => handleAddNode('frame')} title="Рамка">
          🔲 Рамка
        </button>
        <button class="tool-btn" onClick={() => handleAddNode('note')} title="Заметка">
          📄 Карточка
        </button>

        <div class="toolbar-divider" />

        {/* Color Palette */}
        {selectedNodeId && (
          <div class="color-palette">
            {Object.entries(CANVAS_COLORS).map(([num, hex]) => (
              <button
                key={num}
                class="color-circle"
                style={{ backgroundColor: hex }}
                title={`Цвет ${num}`}
                onClick={() => {
                  const map = yNodes.get(selectedNodeId);
                  if (map) map.set('color', num);
                }}
              />
            ))}
            <button
              class="tool-btn icon-only"
              title="Удалить"
              onClick={handleDeleteSelected}
            >
              🗑️
            </button>
          </div>
        )}

        <div class="toolbar-divider" />

        <button
          class="tool-btn icon-only"
          title="Отменить"
          onClick={() => undoManagerRef.current?.undo()}
        >
          ↩️
        </button>
        <button
          class="tool-btn icon-only"
          title="Повторить"
          onClick={() => undoManagerRef.current?.redo()}
        >
          ↪️
        </button>

        <div class="toolbar-divider" />

        <button
          class="tool-btn icon-only"
          onClick={() => setViewport((p) => ({ ...p, zoom: Math.min(p.zoom * 1.2, 3) }))}
        >
          ➕
        </button>
        <span class="zoom-level">{Math.round(viewport.zoom * 100)}%</span>
        <button
          class="tool-btn icon-only"
          onClick={() => setViewport((p) => ({ ...p, zoom: Math.max(p.zoom * 0.8, 0.2) }))}
        >
          ➖
        </button>
        <button
          class="tool-btn"
          onClick={() => setViewport({ x: 100, y: 100, zoom: 1 })}
        >
          100%
        </button>
      </div>

      {/* SVG Canvas for Edges */}
      <svg
        class="canvas-svg"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0'
        }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {edgesList.map((edge) => {
          const fromNode = nodesList.find((n) => n.id === edge.from);
          const toNode = nodesList.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const x1 = fromNode.x + fromNode.w / 2;
          const y1 = fromNode.y + fromNode.h / 2;
          const x2 = toNode.x + toNode.w / 2;
          const y2 = toNode.y + toNode.h / 2;

          const dx = (x2 - x1) * 0.5;
          const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

          return (
            <g key={edge.id} class="edge-group">
              <path
                d={pathD}
                class="edge-line"
                marker-end="url(#arrow)"
                stroke={CANVAS_COLORS[edge.color || 'default'] || '#94a3b8'}
              />
              {edge.label && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 8}
                  class="edge-label"
                  text-anchor="middle"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Canvas Elements (Nodes) */}
      <div
        class="canvas-nodes-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {nodesList.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const nodeColor = CANVAS_COLORS[node.color] || CANVAS_COLORS.default;

          return (
            <div
              key={node.id}
              class={`board-node node-${node.type} ${isSelected ? 'selected' : ''}`}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.w}px`,
                height: `${node.h}px`,
                borderColor: nodeColor,
                zIndex: node.z
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                setDragNode({
                  id: node.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  nodeX: node.x,
                  nodeY: node.y
                });
              }}
              onDblClick={() => {
                if (node.type === 'note' && node.noteId) {
                  selectedNoteId.value = node.noteId;
                  currentView.value = 'notes';
                }
              }}
            >
              {/* Header / Meta */}
              <div class="node-meta-bar">
                {node.type === 'sticky' && (
                  <input
                    type="checkbox"
                    class="node-checkbox"
                    checked={node.done || false}
                    onChange={(e) => {
                      const map = yNodes.get(node.id);
                      if (map) map.set('done', (e.target as HTMLInputElement).checked);
                    }}
                  />
                )}
                <span class="node-author-badge" style={{ color: nodeColor }}>
                  {node.author || (node.type === 'frame' ? 'Рамка' : 'Стикер')}
                </span>
                {/* Arrow connector port */}
                <button
                  class="connect-port-btn"
                  title="Протянуть стрелку"
                  onClick={(e) => handleStartConnect(node.id, e as any)}
                >
                  ➔
                </button>
              </div>

              {/* Node Content */}
              {node.type === 'frame' ? (
                <div class="frame-content">
                  <span class="frame-title">{node.text}</span>
                </div>
              ) : (
                <textarea
                  class="node-textarea"
                  value={node.text}
                  placeholder="Текст..."
                  onInput={(e) => {
                    const map = yNodes.get(node.id);
                    if (map) {
                      setNodeProperties(map, { text: (e.target as HTMLTextAreaElement).value });
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              )}

              {/* Resize Handle */}
              {isSelected && (
                <div
                  class="resize-handle"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setResizeNode({
                      id: node.id,
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
      </div>
    </div>
  );
}
