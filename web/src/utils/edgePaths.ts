import { PortSide, getPortCoordinates, buildEdgeSvgPath as baseBuildPath, getEdgeMidpoint } from './connectorGeometry.js';

export type EdgeCurveType = 'bezier' | 'orthogonal' | 'straight';

export function buildEdgeSvgPath(
  x1: number,
  y1: number,
  side1: PortSide,
  x2: number,
  y2: number,
  side2: PortSide,
  curveType: EdgeCurveType = 'bezier'
): { path: string; labelX: number; labelY: number } {
  const path = baseBuildPath(x1, y1, side1, x2, y2, side2, curveType);
  const mid = getEdgeMidpoint(x1, y1, side1, x2, y2, side2, curveType);
  return {
    path,
    labelX: mid.x,
    labelY: mid.y
  };
}

export { type PortSide, getPortCoordinates };
