import { h, Fragment, FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { PortSide, getPortCoordinates, getPortAngle, computeArrowheadPolygon, getEdgeEndpointAngles } from '../utils/connectorGeometry.js';
import { buildEdgeSvgPath, EdgeCurveType } from '../utils/edgePaths.js';

export interface CanvasEdgeModel {
  id: string;
  fromNode: string;
  fromSide?: PortSide;
  toNode: string;
  toSide?: PortSide;
  color?: string;
  curveType?: EdgeCurveType;
  style?: 'solid' | 'dashed' | 'dotted' | 'animated';
  thickness?: number;
  direction?: 'forward' | 'both' | 'none';
  label?: string;
}

export const EDGE_COLORS = [
  { id: 'slate', value: '#94a3b8', label: 'Slate' },
  { id: 'indigo', value: '#818cf8', label: 'Indigo' },
  { id: 'sky', value: '#38bdf8', label: 'Sky' },
  { id: 'emerald', value: '#34d399', label: 'Emerald' },
  { id: 'amber', value: '#facc15', label: 'Amber' },
  { id: 'rose', value: '#fb7185', label: 'Coral' },
  { id: 'violet', value: '#c084fc', label: 'Violet' },
  { id: 'white', value: '#f8fafc', label: 'White' },
];

interface Props {
  nodesMap: Map<string, { id: string; x: number; y: number; width: number; height: number }>;
  edges: CanvasEdgeModel[];
  selectedEdgeId: string | null;
  viewportZoom?: number;
  readOnly?: boolean;
  onSelectEdge: (edgeId: string | null) => void;
  onUpdateEdge: (edgeId: string, patch: Partial<CanvasEdgeModel>) => void;
  onDeleteEdge: (edgeId: string) => void;
  onStartReconnect?: (edgeId: string, which: 'from' | 'to', startPoint: { x: number; y: number }) => void;
}

export const CanvasEdgesLayer: FunctionComponent<Props> = ({
  nodesMap,
  edges,
  selectedEdgeId,
  viewportZoom,
  readOnly,
  onSelectEdge,
  onUpdateEdge,
  onDeleteEdge,
  onStartReconnect
}) => {
  const [editingLabelEdgeId, setEditingLabelEdgeId] = useState<string | null>(null);

  // Strict Miro invariant: reject self-loops (fromNode === toNode) and missing endpoint nodes
  const validEdges = edges.filter(
    (edge) =>
      edge &&
      edge.fromNode &&
      edge.toNode &&
      edge.fromNode !== edge.toNode &&
      nodesMap.has(edge.fromNode) &&
      nodesMap.has(edge.toNode)
  );

  return (
    <Fragment>
      <svg
        className="doks-edges-svg-layer canvas-svg-layer"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 12,
        }}
      >
        <defs>
          {validEdges.map((edge) => {
            const strokeColor = edge.color || '#818cf8';
            return (
              <Fragment key={`markers-${edge.id}`}>
                <marker
                  id={`arrow-end-${edge.id}`}
                  viewBox="0 0 12 12"
                  refX="10"
                  refY="6"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 6 L 0 11 z" fill={strokeColor} />
                </marker>
                <marker
                  id={`arrow-start-${edge.id}`}
                  viewBox="0 0 12 12"
                  refX="2"
                  refY="6"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto"
                >
                  <path d="M 10 1 L 0 6 L 10 11 z" fill={strokeColor} />
                </marker>
                {/* Legacy marker aliases */}
                <marker
                  id={`arrow-${edge.id}`}
                  viewBox="0 0 12 12"
                  refX="10"
                  refY="6"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 6 L 0 11 z" fill={strokeColor} />
                </marker>
              </Fragment>
            );
          })}
        </defs>

        {validEdges.map((edge) => {
          const fromNode = nodesMap.get(edge.fromNode);
          const toNode = nodesMap.get(edge.toNode);
          if (!fromNode || !toNode) return null;

          const side1: PortSide = edge.fromSide || 'right';
          const side2: PortSide = edge.toSide || 'left';
          const p1 = getPortCoordinates(fromNode, side1);
          const p2 = getPortCoordinates(toNode, side2);

          const curveType: EdgeCurveType = edge.curveType || 'bezier';
          const { path, labelX, labelY } = buildEdgeSvgPath(
            p1.x,
            p1.y,
            side1,
            p2.x,
            p2.y,
            side2,
            curveType
          );

          const isSelected = selectedEdgeId === edge.id;
          const strokeColor = edge.color || '#818cf8';
          const strokeWidth = edge.thickness || 2;
          const dashArray =
            edge.style === 'dashed'
              ? '8 6'
              : edge.style === 'dotted'
              ? '2 6'
              : undefined;

          const dir = edge.direction || 'forward';
          const { startAngle, endAngle } = getEdgeEndpointAngles(
            p1.x,
            p1.y,
            side1,
            p2.x,
            p2.y,
            side2,
            curveType as any
          );

          return (
            <g key={edge.id} className={isSelected ? 'doks-edge-group canvas-edge-group is-selected' : 'doks-edge-group canvas-edge-group'}>
              {/* 20px transparent hit-target so clicking the arrow is effortless */}
              <path
                d={path}
                fill="none"
                stroke="rgba(0,0,0,0.001)"
                strokeWidth={20}
                className="canvas-edge-hit-area"
                style={{ pointerEvents: readOnly ? 'none' : 'stroke', cursor: readOnly ? 'default' : 'pointer' }}
                onMouseDown={(e: MouseEvent) => {
                  if (readOnly) return;
                  e.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onClick={(e: MouseEvent) => {
                  if (readOnly) return;
                  e.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onDblClick={(e: MouseEvent) => {
                  if (readOnly) return;
                  e.stopPropagation();
                  onSelectEdge(edge.id);
                  setEditingLabelEdgeId(edge.id);
                }}
              />
              {/* Selection glow halo when selected */}
              {isSelected && (
                <path
                  d={path}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth + 6}
                  strokeOpacity={0.22}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {/* Visible styled edge path */}
              <path
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`canvas-edge-path ${isSelected ? 'selected' : ''} ${edge.style === 'animated' ? 'animated' : ''}`}
                style={{ pointerEvents: 'none', transition: 'stroke 120ms ease' }}
              />
              {/* Solid SVG triangle polygon arrowheads (guaranteed to render in all browsers) */}
              {(dir === 'forward' || dir === 'both') && (
                <polygon
                  points={computeArrowheadPolygon(p2.x, p2.y, endAngle)}
                  fill={strokeColor}
                  className="canvas-edge-arrowhead"
                  style={{ pointerEvents: 'none', transition: 'fill 120ms ease' }}
                />
              )}
              {dir === 'both' && (
                <polygon
                  points={computeArrowheadPolygon(p1.x, p1.y, startAngle)}
                  fill={strokeColor}
                  className="canvas-edge-arrowhead"
                  style={{ pointerEvents: 'none', transition: 'fill 120ms ease' }}
                />
              )}
              {/* Endpoint handles when selected */}
              {isSelected && !readOnly && (
                <Fragment>
                  <circle
                    cx={p1.x}
                    cy={p1.y}
                    r={6}
                    fill="#0b0c0e"
                    stroke={strokeColor}
                    strokeWidth={2}
                    className="edge-reconnect-handle"
                    style={{ pointerEvents: 'auto', cursor: 'grab' }}
                    title="Drag to change source"
                    onMouseDown={(e: MouseEvent) => {
                      e.stopPropagation();
                      onStartReconnect?.(edge.id, 'from', p1);
                    }}
                  />
                  <circle
                    cx={p2.x}
                    cy={p2.y}
                    r={6}
                    fill="#0b0c0e"
                    stroke={strokeColor}
                    strokeWidth={2}
                    className="edge-reconnect-handle"
                    style={{ pointerEvents: 'auto', cursor: 'grab' }}
                    title="Drag to change target"
                    onMouseDown={(e: MouseEvent) => {
                      e.stopPropagation();
                      onStartReconnect?.(edge.id, 'to', p2);
                    }}
                  />
                </Fragment>
              )}
              {/* Edge text label */}
              {(edge.label || (!readOnly && editingLabelEdgeId === edge.id)) && (
                <foreignObject
                  x={labelX - 90}
                  y={labelY - 16}
                  width={180}
                  height={32}
                  style={{ overflow: 'visible', pointerEvents: readOnly ? 'none' : 'auto' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {!readOnly && editingLabelEdgeId === edge.id ? (
                      <input
                        autoFocus
                        className="edge-label-input doks-edge-label-input"
                        value={edge.label || ''}
                        placeholder="Label..."
                        onClick={(e: MouseEvent) => e.stopPropagation()}
                        onMouseDown={(e: MouseEvent) => e.stopPropagation()}
                        onInput={(e: Event) => {
                          onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value });
                        }}
                        onKeyDown={(e: KeyboardEvent) => {
                          e.stopPropagation();
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value.trim() });
                            setEditingLabelEdgeId(null);
                          }
                        }}
                        onBlur={(e: FocusEvent) => {
                          onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value.trim() });
                          setEditingLabelEdgeId(null);
                        }}
                      />
                    ) : (
                      <span
                        className="edge-text-label doks-edge-label-pill"
                        style={{ borderColor: strokeColor, cursor: readOnly ? 'default' : 'pointer' }}
                        onMouseDown={(e: MouseEvent) => {
                          if (readOnly) return;
                          e.stopPropagation();
                          onSelectEdge(edge.id);
                        }}
                        onDblClick={(e: MouseEvent) => {
                          if (readOnly) return;
                          e.stopPropagation();
                          setEditingLabelEdgeId(edge.id);
                        }}
                      >
                        {edge.label}
                      </span>
                    )}
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating Inspector Bar for Selected Edge */}
      {selectedEdgeId && !readOnly && (() => {
        const edge = validEdges.find((e) => e.id === selectedEdgeId);
        if (!edge) return null;
        const fromNode = nodesMap.get(edge.fromNode);
        const toNode = nodesMap.get(edge.toNode);
        if (!fromNode || !toNode) return null;

        const p1 = getPortCoordinates(fromNode, edge.fromSide || 'right');
        const p2 = getPortCoordinates(toNode, edge.toSide || 'left');
        const { labelX, labelY } = buildEdgeSvgPath(
          p1.x,
          p1.y,
          edge.fromSide || 'right',
          p2.x,
          p2.y,
          edge.toSide || 'left',
          edge.curveType || 'bezier'
        );

        const inspectorScale = 1 / Math.max(0.25, Math.min(viewportZoom || 1, 2.5));

        return (
          <div
            className="floating-edge-pill doks-floating-inspector doks-edge-inspector liquid-glass-surface"
            style={{
              position: 'absolute',
              left: `${labelX}px`,
              top: `${labelY - 54}px`,
              transform: `translateX(-50%) scale(${inspectorScale})`,
              transformOrigin: 'bottom center',
              zIndex: 200,
              pointerEvents: 'auto',
            }}
            onMouseDown={(e: MouseEvent) => e.stopPropagation()}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            {/* Color Swatches */}
            <div className="edge-swatch-list doks-inspector-group">
              {EDGE_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  className={`edge-color-swatch doks-color-dot ${edge.color === c.value ? 'active is-active' : ''}`}
                  style={{ backgroundColor: c.value }}
                  onClick={() => onUpdateEdge(edge.id, { color: c.value })}
                />
              ))}
            </div>

            <div className="doks-inspector-divider" />

            {/* Curve Geometry Type: Bezier | Orthogonal | Straight */}
            <div className="doks-inspector-group">
              <button
                type="button"
                title="Bezier curve"
                className={`edge-pill-btn doks-icon-btn ${(!edge.curveType || edge.curveType === 'bezier') ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { curveType: 'bezier' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18c6 0 6-12 12-12h6" />
                </svg>
              </button>
              <button
                type="button"
                title="Orthogonal 90°"
                className={`edge-pill-btn doks-icon-btn ${edge.curveType === 'orthogonal' ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { curveType: 'orthogonal' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18h9V6h9" />
                </svg>
              </button>
              <button
                type="button"
                title="Straight line"
                className={`edge-pill-btn doks-icon-btn ${edge.curveType === 'straight' ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { curveType: 'straight' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="20" x2="20" y2="4" />
                </svg>
              </button>
            </div>

            <div className="doks-inspector-divider" />

            {/* Stroke Style: Solid | Dashed */}
            <div className="doks-inspector-group">
              <button
                type="button"
                title="Solid"
                className={`edge-pill-btn doks-icon-btn ${(!edge.style || edge.style === 'solid') ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { style: 'solid' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                title="Dashed"
                className={`edge-pill-btn doks-icon-btn ${edge.style === 'dashed' ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { style: 'dashed' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4">
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                title="Animated flow"
                className={`edge-pill-btn doks-icon-btn ${edge.style === 'animated' ? 'active is-active' : ''}`}
                onClick={() => onUpdateEdge(edge.id, { style: 'animated' })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M15 7l5 5-5 5" />
                </svg>
              </button>
            </div>

            <div className="doks-inspector-divider" />

            {/* Direction: Forward | Both | None */}
            <div className="doks-inspector-group">
              <button
                type="button"
                title={`Direction: ${edge.direction || 'forward'}`}
                className="edge-pill-btn doks-icon-btn"
                onClick={() => {
                  const nextDir = edge.direction === 'forward' ? 'both' : edge.direction === 'both' ? 'none' : 'forward';
                  onUpdateEdge(edge.id, { direction: nextDir });
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* Thickness Toggle */}
              <button
                type="button"
                title={`Thickness: ${edge.thickness || 2}px`}
                className="edge-pill-btn doks-icon-btn"
                onClick={() => {
                  const nextThick = (edge.thickness === 2 || !edge.thickness) ? 3 : edge.thickness === 3 ? 5 : 2;
                  onUpdateEdge(edge.id, { thickness: nextThick });
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 600 }}>{edge.thickness || 2}px</span>
              </button>
            </div>

            <div className="doks-inspector-divider" />

            {/* Label & Delete */}
            <input
              type="text"
              className="edge-label-input doks-edge-label-input"
              placeholder="Label..."
              value={edge.label || ''}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              onMouseDown={(e: MouseEvent) => e.stopPropagation()}
              onInput={(e: Event) => {
                onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value });
              }}
              onKeyDown={(e: KeyboardEvent) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value.trim() });
                }
              }}
              onBlur={(e: FocusEvent) => {
                onUpdateEdge(edge.id, { label: (e.target as HTMLInputElement).value.trim() });
              }}
            />
            <button
              type="button"
              title="Delete connection (Delete)"
              className="edge-pill-btn doks-icon-btn is-danger danger"
              onClick={() => onDeleteEdge(edge.id)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        );
      })()}
    </Fragment>
  );
};
