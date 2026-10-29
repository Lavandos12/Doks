import { h } from 'preact';
import { useRef, useMemo } from 'preact/hooks';
import type { BoardNodeData } from '@doks/shared';
import { CANVAS_COLORS } from './board-canvas.js';
import { t } from '../../i18n/index.js';

interface BoardMinimapProps {
  nodes: BoardNodeData[];
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  containerHeight: number;
  onNavigate: (newX: number, newY: number) => void;
}

export function BoardMinimap({
  nodes,
  viewport,
  containerWidth,
  containerHeight,
  onNavigate
}: BoardMinimapProps) {
  const mapRef = useRef<HTMLDivElement>(null);

  const MAP_W = 180;
  const MAP_H = 120;
  const PADDING = 200;

  // Compute bounding box of all nodes + current viewport
  const bounds = useMemo(() => {
    let minX = -viewport.x / viewport.zoom;
    let minY = -viewport.y / viewport.zoom;
    let maxX = minX + containerWidth / viewport.zoom;
    let maxY = minY + containerHeight / viewport.zoom;

    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    }

    minX -= PADDING;
    minY -= PADDING;
    maxX += PADDING;
    maxY += PADDING;

    const spanX = Math.max(maxX - minX, 1000);
    const spanY = Math.max(maxY - minY, 700);

    const scale = Math.min(MAP_W / spanX, MAP_H / spanY);

    return { minX, minY, spanX, spanY, scale };
  }, [nodes, viewport, containerWidth, containerHeight]);

  // Viewport rect on minimap
  const viewLeft = -viewport.x / viewport.zoom;
  const viewTop = -viewport.y / viewport.zoom;
  const viewW = containerWidth / viewport.zoom;
  const viewH = containerHeight / viewport.zoom;

  const vpRect = {
    x: (viewLeft - bounds.minX) * bounds.scale,
    y: (viewTop - bounds.minY) * bounds.scale,
    w: Math.max(viewW * bounds.scale, 8),
    h: Math.max(viewH * bounds.scale, 6)
  };

  const handlePointer = (e: MouseEvent) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert minimap coords back to canvas coords
    const targetCanvasX = bounds.minX + clickX / bounds.scale;
    const targetCanvasY = bounds.minY + clickY / bounds.scale;

    // Center viewport at targetCanvasX, targetCanvasY
    const newX = -(targetCanvasX * viewport.zoom - containerWidth / 2);
    const newY = -(targetCanvasY * viewport.zoom - containerHeight / 2);

    onNavigate(newX, newY);
  };

  const handleMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
    handlePointer(e);

    const onMove = (moveEvt: MouseEvent) => {
      handlePointer(moveEvt);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={mapRef}
      class="board-minimap-container"
      title={t('minimap.title')}
      onMouseDown={handleMouseDown}
      style={{
        width: `${MAP_W}px`,
        height: `${MAP_H}px`
      }}
    >
      <svg width={MAP_W} height={MAP_H} class="board-minimap-svg">
        {/* Render simplified nodes */}
        {nodes.map((n) => {
          const nx = (n.x - bounds.minX) * bounds.scale;
          const ny = (n.y - bounds.minY) * bounds.scale;
          const nw = Math.max(n.w * bounds.scale, 2);
          const nh = Math.max(n.h * bounds.scale, 2);
          const color = CANVAS_COLORS[n.color] || CANVAS_COLORS.default;

          if (n.type === 'frame') {
            return (
              <rect
                key={n.id}
                x={nx}
                y={ny}
                width={nw}
                height={nh}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                stroke-dasharray="2,2"
              />
            );
          }

          return (
            <rect
              key={n.id}
              x={nx}
              y={ny}
              width={nw}
              height={nh}
              fill={color}
              rx={1}
              opacity={0.7}
            />
          );
        })}

        {/* Viewport Box */}
        <rect
          x={vpRect.x}
          y={vpRect.y}
          width={vpRect.w}
          height={vpRect.h}
          class="board-minimap-viewport"
        />
      </svg>
    </div>
  );
}
