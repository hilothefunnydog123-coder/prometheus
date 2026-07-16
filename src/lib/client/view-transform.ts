import type { ExperimentFamily } from "@/lib/ai/contracts/experiment-spec";
import type { TrajectoryPoint } from "@/lib/simulation";

/**
 * Pure world-to-canvas math for the 2D experiment renderer. Kept free of DOM
 * types so it can be unit-tested in the node environment.
 */

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Fractional padding added around the tight bounds on every side. */
const PADDING = 0.1;
/** Minimum world extent per axis so degenerate scenes (a drop's x) scale sanely. */
const MIN_EXTENT = 1;

/**
 * Tight bounds over every trajectory, widened with the family's fixed
 * anchors (the ground for drop/projectile, the pivot for the pendulum) so
 * the scene's reference geometry is always in frame.
 */
export function boundsForTrajectories(
  family: ExperimentFamily,
  trajectories: readonly (readonly TrajectoryPoint[])[],
): WorldBounds {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const trajectory of trajectories) {
    for (const point of trajectory) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (family === "pendulum") {
    // Breathing room above the pivot so the crosshair is not clipped.
    maxY = Math.max(maxY, 0.15 * Math.max(MIN_EXTENT, maxY - minY));
  }

  const extentX = Math.max(maxX - minX, MIN_EXTENT);
  const extentY = Math.max(maxY - minY, MIN_EXTENT);
  return {
    minX: minX - extentX * PADDING,
    maxX: maxX + extentX * PADDING + (maxX - minX < MIN_EXTENT ? MIN_EXTENT / 2 : 0),
    minY: minY - extentY * PADDING,
    maxY: maxY + extentY * PADDING + (maxY - minY < MIN_EXTENT ? MIN_EXTENT / 2 : 0),
  };
}

export interface ViewTransform {
  /** World x → canvas px (origin top-left). */
  toPxX(x: number): number;
  /** World y → canvas px; flips y so world "up" renders upward. */
  toPxY(y: number): number;
  /** Pixels per world metre. */
  scale: number;
}

/**
 * Contain-fit: uniform scale that fits the bounds into the canvas with the
 * given margin, centered on both axes.
 */
export function fitBounds(
  bounds: WorldBounds,
  widthPx: number,
  heightPx: number,
  marginPx = 16,
): ViewTransform {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const usableW = Math.max(1, widthPx - 2 * marginPx);
  const usableH = Math.max(1, heightPx - 2 * marginPx);
  const scale = Math.min(usableW / worldW, usableH / worldH);
  const offsetX = (widthPx - worldW * scale) / 2;
  const offsetY = (heightPx - worldH * scale) / 2;
  return {
    scale,
    toPxX: (x) => offsetX + (x - bounds.minX) * scale,
    toPxY: (y) => heightPx - offsetY - (y - bounds.minY) * scale,
  };
}
