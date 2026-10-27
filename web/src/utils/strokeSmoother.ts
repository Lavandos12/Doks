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

/**
 * Converts a sequence of pointer points into a closed, variable-width calligraphic brush polygon.
 * Features:
 * - Smooth tapered tips at start and end (down to 15% baseWidth)
 * - Dynamic thickness (0.75x to 1.85x) based on segment velocity and curvature
 * - 35-degree calligraphic nib angle simulation
 * - Outputs a closed SVG polygon path (M ... Q ... Z) ready for filled rendering
 */
export function buildCalligraphicBrushPath(points: Point[], baseWidth: number): string {
  if (points.length === 0) return '';
  const rBase = Math.max(1, baseWidth * 0.5);

  if (points.length === 1) {
    const p = points[0];
    return `M ${(p.x - rBase).toFixed(1)} ${p.y.toFixed(1)} A ${rBase.toFixed(1)} ${rBase.toFixed(1)} 0 1 0 ${(p.x + rBase).toFixed(1)} ${p.y.toFixed(1)} A ${rBase.toFixed(1)} ${rBase.toFixed(1)} 0 1 0 ${(p.x - rBase).toFixed(1)} ${p.y.toFixed(1)} Z`;
  }

  const N = points.length;
  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const nibAngle = (35 * Math.PI) / 180;

  for (let i = 0; i < N; i++) {
    let tx: number;
    let ty: number;
    if (i === 0) {
      tx = points[1].x - points[0].x;
      ty = points[1].y - points[0].y;
    } else if (i === N - 1) {
      tx = points[N - 1].x - points[N - 2].x;
      ty = points[N - 1].y - points[N - 2].y;
    } else {
      tx = points[i + 1].x - points[i - 1].x;
      ty = points[i + 1].y - points[i - 1].y;
    }

    const segLen = Math.hypot(tx, ty) || 1e-4;
    const nx = -ty / segLen;
    const ny = tx / segLen;

    // 1. Taper factor: start & end 15% smoothly taper down to 0.15
    let taper = 1.0;
    const taperThreshold = Math.max(2, Math.floor(N * 0.15));
    if (i < taperThreshold) {
      const t = i / taperThreshold;
      taper = 0.15 + 0.85 * Math.sin((t * Math.PI) / 2);
    } else if (i >= N - taperThreshold) {
      const t = (N - 1 - i) / taperThreshold;
      taper = 0.15 + 0.85 * Math.sin((t * Math.PI) / 2);
    }

    // 2. Velocity scaling: faster movement (longer segments) thins down to ~0.75x, slower/curving thickens up to ~1.4x
    const speedFactor = Math.max(0.75, Math.min(1.4, 1.25 - segLen / 45));

    // 3. 35-degree calligraphic nib angle simulation
    const tangentAngle = Math.atan2(ty, tx);
    const angleBias = 0.82 + 0.45 * Math.abs(Math.sin(tangentAngle - nibAngle));

    // Final radius at point
    const r = Math.max(0.6, rBase * taper * speedFactor * angleBias);

    leftPts.push({
      x: points[i].x + nx * r,
      y: points[i].y + ny * r
    });
    rightPts.push({
      x: points[i].x - nx * r,
      y: points[i].y - ny * r
    });
  }

  // Construct closed smooth path: Forward along left side, backward along right side
  let d = `M ${leftPts[0].x.toFixed(1)} ${leftPts[0].y.toFixed(1)}`;
  for (let i = 1; i < leftPts.length - 1; i++) {
    const midX = (leftPts[i].x + leftPts[i + 1].x) / 2;
    const midY = (leftPts[i].y + leftPts[i + 1].y) / 2;
    d += ` Q ${leftPts[i].x.toFixed(1)} ${leftPts[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  const lastL = leftPts[leftPts.length - 1];
  const lastR = rightPts[rightPts.length - 1];
  d += ` Q ${lastL.x.toFixed(1)} ${lastL.y.toFixed(1)} ${lastR.x.toFixed(1)} ${lastR.y.toFixed(1)}`;

  for (let i = rightPts.length - 2; i > 0; i--) {
    const midX = (rightPts[i].x + rightPts[i - 1].x) / 2;
    const midY = (rightPts[i].y + rightPts[i - 1].y) / 2;
    d += ` Q ${rightPts[i].x.toFixed(1)} ${rightPts[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  const firstR = rightPts[0];
  const firstL = leftPts[0];
  d += ` Q ${firstR.x.toFixed(1)} ${firstR.y.toFixed(1)} ${firstL.x.toFixed(1)} ${firstL.y.toFixed(1)} Z`;

  return d;
}
