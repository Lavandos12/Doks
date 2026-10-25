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
