export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface BoxNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getPortCoordinates(node: BoxNode, side: PortSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
  }
}

/**
 * Finds the target node and optimal port when dropping a connection line at (worldX, worldY).
 * Includes a 24px/28px magnetic halo around every node so dropping near an edge snaps effortlessly.
 */
export function findMagneticTargetPort(
  nodes: BoxNode[],
  sourceNodeId: string,
  worldX: number,
  worldY: number,
  magneticHalo = 28
): { nodeId: string; side: PortSide; point: { x: number; y: number } } | null {
  // Check nodes in reverse order (top-most first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === sourceNodeId) continue;

    const insideWithHalo =
      worldX >= n.x - magneticHalo &&
      worldX <= n.x + n.width + magneticHalo &&
      worldY >= n.y - magneticHalo &&
      worldY <= n.y + n.height + magneticHalo;

    if (!insideWithHalo) continue;

    const sides: PortSide[] = ['top', 'right', 'bottom', 'left'];
    let bestSide: PortSide = 'left';
    let bestDist = Infinity;
    let bestPoint = { x: n.x, y: n.y };

    for (const side of sides) {
      const pt = getPortCoordinates(n, side);
      const dist = Math.hypot(worldX - pt.x, worldY - pt.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestSide = side;
        bestPoint = pt;
      }
    }

    return { nodeId: n.id, side: bestSide, point: bestPoint };
  }
  return null;
}

/**
 * Generates a smooth cubic Bezier SVG path between two ports.
 */
export function buildBezierEdgePath(
  x1: number,
  y1: number,
  side1: PortSide,
  x2: number,
  y2: number,
  side2: PortSide
): string {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const offset = Math.min(Math.max(dist * 0.4, 40), 180);

  const dirVector = (s: PortSide) => {
    if (s === 'top') return { dx: 0, dy: -1 };
    if (s === 'right') return { dx: 1, dy: 0 };
    if (s === 'bottom') return { dx: 0, dy: 1 };
    return { dx: -1, dy: 0 };
  };

  const d1 = dirVector(side1);
  const d2 = dirVector(side2);

  const cx1 = x1 + d1.dx * offset;
  const cy1 = y1 + d1.dy * offset;
  const cx2 = x2 + d2.dx * offset;
  const cy2 = y2 + d2.dy * offset;

  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Builds an SVG path based on the selected curve type:
 * - 'straight': direct line from port 1 to port 2
 * - 'orthogonal': 3-segment orthogonal right-angle routing
 * - 'bezier': smooth cubic bezier curve
 */
export function buildEdgeSvgPath(
  x1: number,
  y1: number,
  side1: PortSide,
  x2: number,
  y2: number,
  side2: PortSide,
  curveType: 'bezier' | 'orthogonal' | 'straight' = 'bezier'
): string {
  if (curveType === 'straight') {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  if (curveType === 'orthogonal') {
    if (side1 === 'right' || side1 === 'left') {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    } else {
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }
  }
  return buildBezierEdgePath(x1, y1, side1, x2, y2, side2);
}

/**
 * Computes the center/midpoint of an edge for positioning labels or floating inspectors.
 */
export function getEdgeMidpoint(
  x1: number,
  y1: number,
  side1: PortSide,
  x2: number,
  y2: number,
  side2: PortSide,
  curveType: 'bezier' | 'orthogonal' | 'straight' = 'bezier'
): { x: number; y: number } {
  if (curveType === 'straight') {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  if (curveType === 'orthogonal') {
    if (side1 === 'right' || side1 === 'left') {
      const midX = (x1 + x2) / 2;
      return { x: midX, y: (y1 + y2) / 2 };
    } else {
      const midY = (y1 + y2) / 2;
      return { x: (x1 + x2) / 2, y: midY };
    }
  }

  // Bezier curve evaluation at t = 0.5
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const offset = Math.min(Math.max(dist * 0.4, 40), 180);

  const dirVector = (s: PortSide) => {
    if (s === 'top') return { dx: 0, dy: -1 };
    if (s === 'right') return { dx: 1, dy: 0 };
    if (s === 'bottom') return { dx: 0, dy: 1 };
    return { dx: -1, dy: 0 };
  };

  const d1 = dirVector(side1);
  const d2 = dirVector(side2);

  const cx1 = x1 + d1.dx * offset;
  const cy1 = y1 + d1.dy * offset;
  const cx2 = x2 + d2.dx * offset;
  const cy2 = y2 + d2.dy * offset;

  // B(0.5) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3 with t=0.5:
  // 0.125 * P0 + 0.375 * P1 + 0.375 * P2 + 0.125 * P3
  return {
    x: 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2,
    y: 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2
  };
}

export function getPortAngle(side: PortSide): number {
  switch (side) {
    case 'left':
      return 0;
    case 'top':
      return Math.PI / 2;
    case 'right':
      return Math.PI;
    case 'bottom':
      return -Math.PI / 2;
  }
}

/**
 * Computes triangle polygon points for an arrowhead pointing towards (tipX, tipY) at given angle.
 */
export function computeArrowheadPolygon(
  tipX: number,
  tipY: number,
  angle: number,
  len = 12,
  width = 6
): string {
  const base1X = tipX - len * Math.cos(angle) + width * Math.sin(angle);
  const base1Y = tipY - len * Math.sin(angle) - width * Math.cos(angle);
  const base2X = tipX - len * Math.cos(angle) - width * Math.sin(angle);
  const base2Y = tipY - len * Math.sin(angle) + width * Math.cos(angle);
  return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${base1X.toFixed(1)},${base1Y.toFixed(1)} ${base2X.toFixed(1)},${base2Y.toFixed(1)}`;
}
