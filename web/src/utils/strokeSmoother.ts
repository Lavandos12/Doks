export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts a list of raw pointer coordinates into a smooth quadratic Bezier SVG path.
 * e.g. "M x0 y0 Q x1 y1 mx my ..."
 */
export function pointsToSmoothSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${(p.x + 0.2).toFixed(1)} ${(p.y + 0.2).toFixed(1)}`;
  }
  if (points.length === 2) {
    const p0 = points[0];
    const p1 = points[1];
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;

  return d;
}

/**
 * Computes axis-aligned bounding box for a series of points with padding.
 */
export function computeBoundingBox(points: Point[], padding = 10): BoundingBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const w = Math.max(20, Math.round(maxX - minX + padding * 2));
  const h = Math.max(20, Math.round(maxY - minY + padding * 2));

  return {
    x: Math.round(minX - padding),
    y: Math.round(minY - padding),
    width: w,
    height: h
  };
}
