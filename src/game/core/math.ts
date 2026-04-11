/**
 * Math utility functions — Exact replicas from Construct 3 runtime (c3main.js Ah namespace)
 * These must match the C3 engine exactly for 1:1 physics reproduction.
 */

export const TWO_PI = 2 * Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/** Wrap angle to [0, 2π) range */
export function wrapAngle(a: number): number {
  a %= TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

/** Degrees to radians */
export function toRadians(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Radians to degrees */
export function toDegrees(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Euclidean distance between two points */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/** Angle from point 1 to point 2 in radians */
export function angleTo(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Shortest angular distance between two angles (always positive, radians).
 * Exact C3 implementation using dot product of unit vectors.
 */
export function angleDifference(a: number, b: number): number {
  if (a === b) return 0;
  const sinA = Math.sin(a);
  const cosA = Math.cos(a);
  const dot = sinA * Math.sin(b) + cosA * Math.cos(b);
  if (dot >= 1) return 0;
  if (dot <= -1) return Math.PI;
  return Math.acos(dot);
}

/**
 * Should we ADD to angle 'b' (rotate in the positive direction) to approach angle 'a'?
 * Uses 2D cross product of unit vectors: sin(a - b) > 0.
 */
export function isClockwise(a: number, b: number): boolean {
  return Math.cos(b) * Math.sin(a) - Math.sin(b) * Math.cos(a) > 0;
}

/**
 * Rotate angle 'current' toward angle 'target' by at most 'maxStep' radians.
 * Exact C3 angleApproach implementation.
 */
export function angleApproach(current: number, target: number, maxStep: number): number {
  const diff = angleDifference(current, target);
  if (diff <= maxStep) {
    return wrapAngle(target);
  }
  // Determine rotation direction
  if (isClockwise(target, current)) {
    return wrapAngle(current + maxStep);
  } else {
    return wrapAngle(current - maxStep);
  }
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
