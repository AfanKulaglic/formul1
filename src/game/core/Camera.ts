/**
 * Camera System — Replicates the Construct 3 Camera3D follow behavior.
 * 
 * Key behaviors from the original:
 *   - Camera smoothly follows the player car (lerp factor ~0.15)
 *   - Camera rotates to match car heading (lerp factor ~0.15)  
 *   - Camera height (zoom) varies with car speed
 *   - Camera3D FOV = 45° creates perspective projection
 *   - Track and cars layers use parallax3d=true (3D perspective)
 *   - GUI layers use parallax(0,0) (screen-fixed)
 */

import { lerp, wrapAngle, angleDifference, isClockwise } from './math';

export class Camera {
  // Camera world position
  x: number = 0;
  y: number = 0;
  angle: number = 0; // rotation angle (follows car heading)
  zoom: number = 1;  // 1 = default zoom

  // Viewport dimensions (design space)
  readonly designWidth: number = 1080;
  readonly designHeight: number = 1920;

  // Actual canvas dimensions
  canvasWidth: number = 1080;
  canvasHeight: number = 1920;

  // Camera smoothing
  private readonly posLerp: number = 6;   // Higher = faster follow (per second)
  private readonly angleLerpSpeed: number = 6;

  // FOV settings for perspective
  readonly fov: number = Math.PI / 4; // 45 degrees
  private baseHeight: number = 2300;  // Approximate Camera3D Z height

  // Speed-based zoom
  private readonly minZoom: number = 0.42;  // At max speed: pulled out far — speed sensation
  private readonly maxZoom: number = 0.65;  // At zero speed: closer view
  // Mobile gets higher zoom (closer view) so the car fills more screen
  private readonly mobileMinZoom: number = 0.85;
  private readonly mobileMaxZoom: number = 1.40;

  /** Whether to use mobile zoom levels */
  isMobile: boolean = false;

  /** Update camera to follow a target */
  update(targetX: number, targetY: number, targetAngle: number, speed: number, maxSpeed: number, dt: number): void {
    // Offset camera ahead of the car so the player sees more road in front
    // Higher multiplier = camera looks further ahead at speed → stronger speed feel
    const lookAhead = Math.abs(speed) * 0.55;
    const aheadX = targetX + Math.cos(targetAngle) * lookAhead;
    const aheadY = targetY + Math.sin(targetAngle) * lookAhead;

    // Frame-rate independent exponential smoothing: factor = 1 - e^(-speed * dt)
    const posFactor = 1 - Math.exp(-this.posLerp * dt);
    this.x = lerp(this.x, aheadX, posFactor);
    this.y = lerp(this.y, aheadY, posFactor);

    // Smooth angle follow — handle wrapping correctly
    const angleFactor = 1 - Math.exp(-this.angleLerpSpeed * dt);
    const aDiff = angleDifference(this.angle, targetAngle);
    if (aDiff > 0.001) {
      const step = aDiff * angleFactor;
      if (isClockwise(targetAngle, this.angle)) {
        this.angle = wrapAngle(this.angle + step);
      } else {
        this.angle = wrapAngle(this.angle - step);
      }
    }

    // Speed-based zoom: faster = zoomed out more
    // Mobile uses higher zoom values so the car appears bigger on small screens
    const speedRatio = Math.abs(speed) / (maxSpeed || 1);
    const zoomMax = this.isMobile ? this.mobileMaxZoom : this.maxZoom;
    const zoomMin = this.isMobile ? this.mobileMinZoom : this.minZoom;
    const targetZoom = lerp(zoomMax, zoomMin, speedRatio);
    const zoomFactor = 1 - Math.exp(-5 * dt);
    this.zoom = lerp(this.zoom, targetZoom, zoomFactor);
  }

  /** Snap camera to position immediately (used at race start) */
  snapTo(x: number, y: number, angle: number): void {
    this.x = x;
    this.y = y;
    this.angle = angle;
  }

  /** Whether 3D perspective is active (during gameplay) */
  perspective3D: boolean = false;
  private readonly perspectiveStrength: number = 0.00025; // subtle vanishing point

  /**
   * Apply camera transform to a canvas context for world-space rendering.
   * Objects drawn after this are in world coordinates.
   * When perspective3D is true, applies a vertical perspective skew
   * so the road ahead appears to narrow into the distance.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const cx = this.canvasWidth / 2;
    const cy = this.canvasHeight / 2;

    if (this.perspective3D) {
      // Perspective projection using a 2D affine + projective trick:
      // We shift the vertical pivot point up so the top of view is compressed.
      // This creates a trapezoid that mimics a 3D road.
      const rot = -this.angle - Math.PI / 2;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);

      // Standard transform: translate to center, scale, rotate, translate to world
      // We add a Y-scale gradient: scaleY is larger at bottom (near car), smaller at top (far)
      // Implemented as a pre-transform vertical squish offset from center

      // First move to center
      ctx.translate(cx, cy);

      // Apply perspective as a subtle Y-axis scale increase at bottom of canvas
      // This compresses the top (distance) and expands the bottom (near)
      const perspY = 1 + this.perspectiveStrength * cy;
      ctx.transform(1, 0, 0, 1, 0, cy * 0.08);  // shift view slightly down (camera elevation)
      ctx.scale(this.zoom, this.zoom * perspY);

      // Rotate
      ctx.rotate(rot);

      // Translate to world position
      ctx.translate(-this.x, -this.y);
    } else {
      // Standard 2D transform (for menu rendering)
      ctx.translate(cx, cy);
      ctx.scale(this.zoom, this.zoom);
      ctx.rotate(-this.angle - Math.PI / 2);
      ctx.translate(-this.x, -this.y);
    }
  }

  /**
   * Convert world coordinates to screen coordinates.
   */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const cx = this.canvasWidth / 2;
    const cy = this.canvasHeight / 2;
    const rot = -this.angle - Math.PI / 2;
    const dx = wx - this.x;
    const dy = wy - this.y;
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    return {
      x: cx + rx * this.zoom,
      y: cy + ry * this.zoom,
    };
  }

  /**
   * Get the visible world bounds (approximate AABB for culling).
   */
  getVisibleBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    // The visible area is a rotated rectangle. For culling, compute a conservative AABB.
    const halfW = (this.canvasWidth / 2) / this.zoom;
    const halfH = (this.canvasHeight / 2) / this.zoom;
    // When rotated, the AABB expands by the diagonal
    const diag = Math.sqrt(halfW * halfW + halfH * halfH);
    return {
      minX: this.x - diag,
      minY: this.y - diag,
      maxX: this.x + diag,
      maxY: this.y + diag,
    };
  }
}
