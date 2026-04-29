/**
 * Collision System — Fence/barrier collision detection for cars.
 * 
 * Fences in Construct 3 use the Solid behavior. The Car behavior checks
 * for Solid overlaps after each position update and responds with:
 *   1. Speed becomes absolute value
 *   2. Bounce angle calculated from collision normal
 *   3. Friction applied (speed *= 1 - friction → 70% speed loss)
 *   4. Push away from collision surface
 */

import { Rect } from '../data/track0';

interface OBB {
  cx: number;   // center x
  cy: number;   // center y
  hw: number;   // half-width
  hh: number;   // half-height
  cos: number;  // cos(angle)
  sin: number;  // sin(angle)
}

/** Convert a Rect (position = center, w, h, angle) to an OBB */
function rectToOBB(r: Rect): OBB {
  return {
    cx: r.x,
    cy: r.y,
    hw: Math.abs(r.w) / 2,
    hh: Math.abs(r.h) / 2,
    cos: Math.cos(r.angle),
    sin: Math.sin(r.angle),
  };
}

/** Create an OBB for a car at given position and angle */
export function carOBB(x: number, y: number, angle: number, halfW: number = 71, halfH: number = 38): OBB {
  return {
    cx: x,
    cy: y,
    hw: halfW,
    hh: halfH,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
  };
}

/**
 * SAT (Separating Axis Theorem) collision test between two OBBs.
 * Returns the minimum penetration depth and normal, or null if no collision.
 */
function satTest(a: OBB, b: OBB): { depth: number; nx: number; ny: number } | null {
  // Get the 4 axes to test (2 from each OBB)
  const axes = [
    { x: a.cos, y: a.sin },
    { x: -a.sin, y: a.cos },
    { x: b.cos, y: b.sin },
    { x: -b.sin, y: b.cos },
  ];

  let minDepth = Infinity;
  let minNx = 0;
  let minNy = 0;

  for (const axis of axes) {
    // Project both OBBs onto this axis
    const projA = projectOBB(a, axis.x, axis.y);
    const projB = projectOBB(b, axis.x, axis.y);

    // Check overlap
    const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
    if (overlap <= 0) return null; // Separating axis found → no collision

    if (overlap < minDepth) {
      minDepth = overlap;
      minNx = axis.x;
      minNy = axis.y;
    }
  }

  // Ensure normal points from B to A
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  if (dx * minNx + dy * minNy < 0) {
    minNx = -minNx;
    minNy = -minNy;
  }

  return { depth: minDepth, nx: minNx, ny: minNy };
}

/** Project an OBB onto an axis and return min/max */
function projectOBB(obb: OBB, axisX: number, axisY: number): { min: number; max: number } {
  // Center projection
  const center = obb.cx * axisX + obb.cy * axisY;

  // Half-extents projected onto axis
  const r = Math.abs((obb.cos * obb.hw) * axisX + (obb.sin * obb.hw) * axisY) +
            Math.abs((-obb.sin * obb.hh) * axisX + (obb.cos * obb.hh) * axisY);

  return { min: center - r, max: center + r };
}

export interface CollisionResult {
  depth: number;
  nx: number;     // push normal x
  ny: number;     // push normal y
  fenceIndex: number;
}

/**
 * Check if a car collides with any fence.
 * Returns the collision with deepest penetration, or null.
 */
export function checkFenceCollision(
  carX: number,
  carY: number,
  carAngle: number,
  fences: Rect[],
  carHalfW: number = 71,
  carHalfH: number = 38,
): CollisionResult | null {
  const car = carOBB(carX, carY, carAngle, carHalfW, carHalfH);
  let best: CollisionResult | null = null;

  for (let i = 0; i < fences.length; i++) {
    const fence = rectToOBB(fences[i]);
    const result = satTest(car, fence);
    if (result && (!best || result.depth > best.depth)) {
      best = { ...result, fenceIndex: i };
    }
  }

  return best;
}

/**
 * Check if a point (or small circle) overlaps a rotated rectangle.
 * Used for checkpoint/finish line/booster detection.
 */
export function pointInRotatedRect(
  px: number, py: number,
  rect: Rect,
  margin: number = 40,
): boolean {
  // Transform point to rectangle's local space
  const dx = px - rect.x;
  const dy = py - rect.y;
  const cos = Math.cos(-rect.angle);
  const sin = Math.sin(-rect.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const hw = Math.abs(rect.w) / 2 + margin;
  const hh = Math.abs(rect.h) / 2 + margin;

  return Math.abs(localX) <= hw && Math.abs(localY) <= hh;
}

/**
 * Check car-to-car collision (simplified circle check + SAT for accuracy)
 */
export function checkCarCollision(
  ax: number, ay: number, aAngle: number,
  bx: number, by: number, bAngle: number,
  halfW: number = 71, halfH: number = 38,
): { depth: number; nx: number; ny: number } | null {
  // Quick distance check first
  const dx = ax - bx;
  const dy = ay - by;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > halfW * 3) return null; // Too far, definitely no collision

  const a = carOBB(ax, ay, aAngle, halfW, halfH);
  const b = carOBB(bx, by, bAngle, halfW, halfH);
  return satTest(a, b);
}
