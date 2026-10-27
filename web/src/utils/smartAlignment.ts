/**
 * Smart Alignment Guides & Magnetic Snapping Engine (Miro / Figma Architecture)
 */

export interface BoxRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  pos: number;       // X for vertical guide, Y for horizontal guide (world coordinate)
  start: number;     // min Y (for vertical) or min X (for horizontal) in world coordinates
  end: number;       // max Y (for vertical) or max X (for horizontal) in world coordinates
  snapPoints: Array<{ x: number; y: number }>; // intersection points for cross markers
  distanceLabel?: { x: number; y: number; text: string };
}

export interface SnapResult {
  snappedX: number;
  snappedY: number;
  guides: AlignmentGuide[];
}

/**
 * Computes shortest distance from point p to line segment (v, w)
 */
export function distToSegment(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Calculates 6-axis magnetic snapping against candidate boxes with zero stickiness
 */
export function computeSmartAlignment(
  rawBox: BoxRect,
  candidates: BoxRect[],
  snapThreshold: number
): SnapResult {
  if (candidates.length === 0 || snapThreshold <= 0) {
    return { snappedX: rawBox.x, snappedY: rawBox.y, guides: [] };
  }

  const { x: rawX, y: rawY, w, h } = rawBox;

  // Active box anchors
  const activeXAnchors = [
    { key: 'left', val: rawX, offset: 0 },
    { key: 'centerX', val: rawX + w / 2, offset: w / 2 },
    { key: 'right', val: rawX + w, offset: w }
  ];

  const activeYAnchors = [
    { key: 'top', val: rawY, offset: 0 },
    { key: 'centerY', val: rawY + h / 2, offset: h / 2 },
    { key: 'bottom', val: rawY + h, offset: h }
  ];

  // 1. Horizontal Search (Vertical Guide lines)
  let bestDiffX: number | null = null;
  let bestXTargetVal: number | null = null;
  let bestXAnchorOffset = 0;

  for (const c of candidates) {
    const cXAnchors = [c.x, c.x + c.w / 2, c.x + c.w];
    for (const aX of activeXAnchors) {
      for (const targetX of cXAnchors) {
        const diff = targetX - aX.val;
        if (Math.abs(diff) <= snapThreshold) {
          if (bestDiffX === null || Math.abs(diff) < Math.abs(bestDiffX)) {
            bestDiffX = diff;
            bestXTargetVal = targetX;
            bestXAnchorOffset = aX.offset;
          }
        }
      }
    }
  }

  // 2. Vertical Search (Horizontal Guide lines)
  let bestDiffY: number | null = null;
  let bestYTargetVal: number | null = null;
  let bestYAnchorOffset = 0;

  for (const c of candidates) {
    const cYAnchors = [c.y, c.y + c.h / 2, c.y + c.h];
    for (const aY of activeYAnchors) {
      for (const targetY of cYAnchors) {
        const diff = targetY - aY.val;
        if (Math.abs(diff) <= snapThreshold) {
          if (bestDiffY === null || Math.abs(diff) < Math.abs(bestDiffY)) {
            bestDiffY = diff;
            bestYTargetVal = targetY;
            bestYAnchorOffset = aY.offset;
          }
        }
      }
    }
  }

  let snappedX = bestDiffX !== null ? rawX + bestDiffX : rawX;
  let snappedY = bestDiffY !== null ? rawY + bestDiffY : rawY;

  const guides: AlignmentGuide[] = [];

  // Build finite vertical guide line segment
  if (bestXTargetVal !== null) {
    const alignedCandidates = candidates.filter((c) => {
      const cAnchors = [c.x, c.x + c.w / 2, c.x + c.w];
      return cAnchors.some((val) => Math.abs(val - bestXTargetVal!) < 0.5);
    });

    let minY = Math.min(snappedY, ...alignedCandidates.map((c) => c.y));
    let maxY = Math.max(snappedY + h, ...alignedCandidates.map((c) => c.y + c.h));

    const snapPoints: Array<{ x: number; y: number }> = [
      { x: bestXTargetVal, y: snappedY + bestXAnchorOffset }
    ];

    for (const c of alignedCandidates) {
      snapPoints.push({ x: bestXTargetVal, y: c.y });
      snapPoints.push({ x: bestXTargetVal, y: c.y + c.h / 2 });
      snapPoints.push({ x: bestXTargetVal, y: c.y + c.h });
    }

    guides.push({
      type: 'vertical',
      pos: bestXTargetVal,
      start: minY - 14,
      end: maxY + 14,
      snapPoints
    });
  }

  // Build finite horizontal guide line segment
  if (bestYTargetVal !== null) {
    const alignedCandidates = candidates.filter((c) => {
      const cAnchors = [c.y, c.y + c.h / 2, c.y + c.h];
      return cAnchors.some((val) => Math.abs(val - bestYTargetVal!) < 0.5);
    });

    let minX = Math.min(snappedX, ...alignedCandidates.map((c) => c.x));
    let maxX = Math.max(snappedX + w, ...alignedCandidates.map((c) => c.x + c.w));

    const snapPoints: Array<{ x: number; y: number }> = [
      { x: snappedX + bestYAnchorOffset, y: bestYTargetVal }
    ];

    for (const c of alignedCandidates) {
      snapPoints.push({ x: c.x, y: bestYTargetVal });
      snapPoints.push({ x: c.x + c.w / 2, y: bestYTargetVal });
      snapPoints.push({ x: c.x + c.w, y: bestYTargetVal });
    }

    guides.push({
      type: 'horizontal',
      pos: bestYTargetVal,
      start: minX - 14,
      end: maxX + 14,
      snapPoints
    });
  }

  // 3. Equal Spacing Snapping Check (e.g. 3 nodes in a row or column)
  if (candidates.length >= 2) {
    // Check horizontal equal gap
    const sortedH = [...candidates, { ...rawBox, x: snappedX, y: snappedY }].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sortedH.length - 1; i++) {
      for (let j = i + 1; j < sortedH.length; j++) {
        // Find 3 consecutive boxes in sortedH
        if (j === i + 1 && j + 1 < sortedH.length) {
          const b1 = sortedH[i];
          const b2 = sortedH[j];
          const b3 = sortedH[j + 1];

          const gap1 = b2.x - (b1.x + b1.w);
          const gap2 = b3.x - (b2.x + b2.w);

          if (gap1 > 0 || gap2 > 0) {
            // b3 is moving (dragged to the right)
            if (b3.id === rawBox.id && gap1 > 0) {
              const diff = gap2 - gap1;
              if (Math.abs(diff) <= snapThreshold * 1.5) {
                snappedX = b2.x + b2.w + gap1;
                guides.push({
                  type: 'vertical',
                  pos: snappedX + rawBox.w / 2,
                  start: Math.min(b1.y, b2.y, b3.y) - 8,
                  end: Math.max(b1.y + b1.h, b2.y + b2.h, b3.y + b3.h) + 8,
                  snapPoints: [{ x: snappedX + rawBox.w / 2, y: b3.y + b3.h / 2 }],
                  distanceLabel: {
                    x: snappedX + rawBox.w / 2,
                    y: b3.y - 18,
                    text: `${Math.round(gap1)} px`
                  }
                });
                break;
              }
            }
            // b2 is moving (dragged between b1 and b3)
            else if (b2.id === rawBox.id && gap1 > 0 && gap2 > 0) {
              if (Math.abs(gap1 - gap2) <= snapThreshold * 1.5) {
                const avgGap = (gap1 + gap2) / 2;
                snappedX = b1.x + b1.w + avgGap;
                guides.push({
                  type: 'vertical',
                  pos: snappedX + rawBox.w / 2,
                  start: Math.min(b1.y, b2.y, b3.y) - 8,
                  end: Math.max(b1.y + b1.h, b2.y + b2.h, b3.y + b3.h) + 8,
                  snapPoints: [{ x: snappedX + rawBox.w / 2, y: b2.y + b2.h / 2 }],
                  distanceLabel: {
                    x: snappedX + rawBox.w / 2,
                    y: b2.y - 18,
                    text: `${Math.round(avgGap)} px`
                  }
                });
                break;
              }
            }
            // b1 is moving (dragged to the left)
            else if (b1.id === rawBox.id && gap2 > 0) {
              const diff = gap1 - gap2;
              if (Math.abs(diff) <= snapThreshold * 1.5) {
                snappedX = b2.x - rawBox.w - gap2;
                guides.push({
                  type: 'vertical',
                  pos: snappedX + rawBox.w / 2,
                  start: Math.min(b1.y, b2.y, b3.y) - 8,
                  end: Math.max(b1.y + b1.h, b2.y + b2.h, b3.y + b3.h) + 8,
                  snapPoints: [{ x: snappedX + rawBox.w / 2, y: b1.y + b1.h / 2 }],
                  distanceLabel: {
                    x: snappedX + rawBox.w / 2,
                    y: b1.y - 18,
                    text: `${Math.round(gap2)} px`
                  }
                });
                break;
              }
            }
          }
        }
      }
    }
    // Check vertical equal gap
    const sortedV = [...candidates, { ...rawBox, x: snappedX, y: snappedY }].sort((a, b) => a.y - b.y);
    for (let i = 0; i < sortedV.length - 1; i++) {
      for (let j = i + 1; j < sortedV.length; j++) {
        if (j === i + 1 && j + 1 < sortedV.length) {
          const b1 = sortedV[i];
          const b2 = sortedV[j];
          const b3 = sortedV[j + 1];

          const gap1 = b2.y - (b1.y + b1.h);
          const gap2 = b3.y - (b2.y + b2.h);

          if (gap1 > 0 || gap2 > 0) {
            if (b3.id === rawBox.id && gap1 > 0) {
              const diff = gap2 - gap1;
              if (Math.abs(diff) <= snapThreshold * 1.5) {
                snappedY = b2.y + b2.h + gap1;
                guides.push({
                  type: 'horizontal',
                  pos: snappedY + rawBox.h / 2,
                  start: Math.min(b1.x, b2.x, b3.x) - 8,
                  end: Math.max(b1.x + b1.w, b2.x + b2.w, b3.x + b3.w) + 8,
                  snapPoints: [{ x: b3.x + b3.w / 2, y: snappedY + rawBox.h / 2 }],
                  distanceLabel: {
                    x: b3.x - 18,
                    y: snappedY + rawBox.h / 2,
                    text: `${Math.round(gap1)} px`
                  }
                });
                break;
              }
            } else if (b2.id === rawBox.id && gap1 > 0 && gap2 > 0) {
              if (Math.abs(gap1 - gap2) <= snapThreshold * 1.5) {
                const avgGap = (gap1 + gap2) / 2;
                snappedY = b1.y + b1.h + avgGap;
                guides.push({
                  type: 'horizontal',
                  pos: snappedY + rawBox.h / 2,
                  start: Math.min(b1.x, b2.x, b3.x) - 8,
                  end: Math.max(b1.x + b1.w, b2.x + b2.w, b3.x + b3.w) + 8,
                  snapPoints: [{ x: b2.x + b2.w / 2, y: snappedY + rawBox.h / 2 }],
                  distanceLabel: {
                    x: b2.x - 18,
                    y: snappedY + rawBox.h / 2,
                    text: `${Math.round(avgGap)} px`
                  }
                });
                break;
              }
            } else if (b1.id === rawBox.id && gap2 > 0) {
              const diff = gap1 - gap2;
              if (Math.abs(diff) <= snapThreshold * 1.5) {
                snappedY = b2.y - rawBox.h - gap2;
                guides.push({
                  type: 'horizontal',
                  pos: snappedY + rawBox.h / 2,
                  start: Math.min(b1.x, b2.x, b3.x) - 8,
                  end: Math.max(b1.x + b1.w, b2.x + b2.w, b3.x + b3.w) + 8,
                  snapPoints: [{ x: b1.x + b1.w / 2, y: snappedY + rawBox.h / 2 }],
                  distanceLabel: {
                    x: b1.x - 18,
                    y: snappedY + rawBox.h / 2,
                    text: `${Math.round(gap2)} px`
                  }
                });
                break;
              }
            }
          }
        }
      }
    }
  }

  return { snappedX, snappedY, guides };
}

/**
 * Magnetic snapping for node resizing
 */
export function computeResizeAlignment(
  activeBox: BoxRect,
  handle: string,
  candidates: BoxRect[],
  snapThreshold: number
): { w: number; h: number; x: number; y: number; guides: AlignmentGuide[] } {
  let { x, y, w, h } = activeBox;
  const guides: AlignmentGuide[] = [];

  // Check dimension matching (Equal width / height)
  for (const c of candidates) {
    if (Math.abs(w - c.w) <= snapThreshold && (handle.includes('e') || handle.includes('w'))) {
      w = c.w;
    }
    if (Math.abs(h - c.h) <= snapThreshold && (handle.includes('s') || handle.includes('n'))) {
      h = c.h;
    }
  }

  // Check edge alignment
  if (handle.includes('e')) {
    const right = x + w;
    for (const c of candidates) {
      for (const targetX of [c.x, c.x + c.w]) {
        if (Math.abs(right - targetX) <= snapThreshold) {
          w = targetX - x;
          guides.push({
            type: 'vertical',
            pos: targetX,
            start: Math.min(y, c.y) - 12,
            end: Math.max(y + h, c.y + c.h) + 12,
            snapPoints: [{ x: targetX, y: y + h / 2 }, { x: targetX, y: c.y + c.h / 2 }]
          });
          break;
        }
      }
    }
  }

  if (handle.includes('s')) {
    const bottom = y + h;
    for (const c of candidates) {
      for (const targetY of [c.y, c.y + c.h]) {
        if (Math.abs(bottom - targetY) <= snapThreshold) {
          h = targetY - y;
          guides.push({
            type: 'horizontal',
            pos: targetY,
            start: Math.min(x, c.x) - 12,
            end: Math.max(x + w, c.x + c.w) + 12,
            snapPoints: [{ x: x + w / 2, y: targetY }, { x: c.x + c.w / 2, y: targetY }]
          });
          break;
        }
      }
    }
  }

  return { x, y, w: Math.max(20, w), h: Math.max(20, h), guides };
}
