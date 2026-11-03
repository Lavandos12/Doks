/**
 * Copyright 2026 Doks Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface ContinuousGridConfig {
  baseCellSize?: number; // Base world cell in px (default 32)
}

export interface ContinuousGridState {
  octaveIndex: number; // Integer power of 2 (K)
  fractionalOctave: number; // Fractional progress t in [0, 1)
  alphaFine: number; // Cubic smoothstep opacity in [0, 1]
  coarseStep: number; // Screen-space coarse step (32px .. 64px)
  fineStep: number; // Screen-space fine step (16px .. 32px)
  majorStep: number; // Screen-space major step (coarse * 4)
  coarseOffsetX: number;
  coarseOffsetY: number;
  fineOffsetX: number;
  fineOffsetY: number;
  majorOffsetX: number;
  majorOffsetY: number;
}

/**
 * Computes Miro-grade two-octave cross-fade grid parameters.
 * Eliminates discrete popping by cross-fading the fine sub-grid
 * into the coarse grid with cubic smoothstep continuity.
 */
export function computeContinuousGrid(
  zoom: number,
  viewportX: number,
  viewportY: number,
  config: ContinuousGridConfig = {}
): ContinuousGridState {
  const baseCellSize = config.baseCellSize || 32;
  const clampedZoom = Math.max(0.005, zoom);

  // K = floor(log2(zoom)), t = log2(zoom) - K
  const logZoom = Math.log2(clampedZoom);
  const octaveIndex = Math.floor(logZoom);
  const fractionalOctave = logZoom - octaveIndex; // in [0, 1)

  // Cubic smoothstep cross-fade opacity for fine sub-grid:
  // Starts fading in at t = 0.15, fully opaque by t = 0.85
  const s = Math.max(0, Math.min(1, (fractionalOctave - 0.15) / 0.70));
  const alphaFine = s * s * (3 - 2 * s);

  // Screen-space steps
  const coarseStep = (baseCellSize / Math.pow(2, octaveIndex)) * clampedZoom;
  const fineStep = coarseStep / 2;
  const majorStep = coarseStep * 4;

  // Modulo pattern offsets anchored to viewport coordinates
  const coarseOffsetX = ((viewportX % coarseStep) + coarseStep) % coarseStep;
  const coarseOffsetY = ((viewportY % coarseStep) + coarseStep) % coarseStep;

  const fineOffsetX = ((viewportX % fineStep) + fineStep) % fineStep;
  const fineOffsetY = ((viewportY % fineStep) + fineStep) % fineStep;

  const majorOffsetX = ((viewportX % majorStep) + majorStep) % majorStep;
  const majorOffsetY = ((viewportY % majorStep) + majorStep) % majorStep;

  return {
    octaveIndex,
    fractionalOctave,
    alphaFine,
    coarseStep,
    fineStep,
    majorStep,
    coarseOffsetX,
    coarseOffsetY,
    fineOffsetX,
    fineOffsetY,
    majorOffsetX,
    majorOffsetY
  };
}

export interface ViewportCoord {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Computes continuous exponential wheel zoom target anchored at a specific screen coordinate (cursor).
 */
export function computeContinuousWheelTarget(
  current: ViewportCoord,
  deltaY: number,
  screenAnchorX: number,
  screenAnchorY: number,
  minZoom = 0.1,
  maxZoom = 4.0
): ViewportCoord {
  // Continuous exponential scaling factor
  const rawDelta = deltaY;
  const zoomFactor = Math.min(Math.max(Math.exp(-rawDelta * 0.0018), 0.65), 1.6);
  const newZoom = Math.min(Math.max(current.zoom * zoomFactor, minZoom), maxZoom);

  // Anchor transformation with finite guards
  const newX = screenAnchorX - (screenAnchorX - current.x) * (newZoom / current.zoom);
  const newY = screenAnchorY - (screenAnchorY - current.y) * (newZoom / current.zoom);

  if (!Number.isFinite(newX) || !Number.isFinite(newY) || !Number.isFinite(newZoom)) {
    return current;
  }

  return {
    x: newX,
    y: newY,
    zoom: newZoom
  };
}

/**
 * Performs one step of critically damped spring interpolation towards the target viewport.
 */
export function stepDampedKinematics(
  current: ViewportCoord,
  target: ViewportCoord,
  lambda = 0.24,
  threshold = { pos: 0.25, zoom: 0.0008 }
): { next: ViewportCoord; arrived: boolean } {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.zoom)) {
    return { next: current, arrived: true };
  }
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.zoom - current.zoom;

  if (Math.abs(dx) < threshold.pos && Math.abs(dy) < threshold.pos && Math.abs(dz) < threshold.zoom) {
    return {
      next: { ...target },
      arrived: true
    };
  }

  return {
    next: {
      x: current.x + dx * lambda,
      y: current.y + dy * lambda,
      zoom: current.zoom + dz * lambda
    },
    arrived: false
  };
}
