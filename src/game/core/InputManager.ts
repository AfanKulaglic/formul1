/**
 * Input Manager — Handles keyboard and touch input for the game.
 * Maps to the Construct 3 control scheme:
 *   - Touch: dedicated left/right arrow buttons at the bottom of the screen
 *   - Keyboard: Arrow keys or WASD
 */

export interface InputState {
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;
}

/** Rectangle in CSS client coordinates for a touch button */
export interface TouchButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class InputManager {
  private keys: Set<string> = new Set();
  private touchZones: { left: boolean; right: boolean; brake: boolean } = {
    left: false,
    right: false,
    brake: false,
  };
  private activeTouches: Map<number, { x: number; y: number }> = new Map();
  private canvas: HTMLCanvasElement | null = null;

  /** Callback fired on a clean tap (touchstart + touchend without drag) */
  onTap: (() => void) | null = null;
  private tapStartTime: number = 0;
  private tapMoved: boolean = false;

  /** Whether we're on a mobile device (touch-primary) */
  isMobile: boolean = false;

  /** Current button rects in canvas-relative CSS pixels (set by updateButtonRects) */
  leftButtonRect: TouchButtonRect = { x: 0, y: 0, w: 0, h: 0 };
  rightButtonRect: TouchButtonRect = { x: 0, y: 0, w: 0, h: 0 };

  /** Whether each button is currently pressed (for rendering highlight) */
  leftPressed: boolean = false;
  rightPressed: boolean = false;

  constructor() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.onTouchEnd);
    this.updateButtonRects();
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.canvas) {
      this.canvas.removeEventListener('touchstart', this.onTouchStart);
      this.canvas.removeEventListener('touchmove', this.onTouchMove);
      this.canvas.removeEventListener('touchend', this.onTouchEnd);
      this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
    }
    this.canvas = null;
    this.onTap = null;
  }

  /** Recalculate button positions based on canvas CSS size. Call after resize. */
  updateButtonRects(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const btnW = Math.min(rect.width * 0.28, 140);
    const btnH = Math.min(rect.height * 0.10, 80);
    const margin = 24;
    const bottomY = rect.height - btnH - margin;

    this.leftButtonRect = { x: margin, y: bottomY, w: btnW, h: btnH };
    this.rightButtonRect = { x: rect.width - btnW - margin, y: bottomY, w: btnW, h: btnH };
  }

  setViewport(width: number, height: number): void {
    // No longer needed — we use getBoundingClientRect() for zones
  }

  /** Get current input state (combines keyboard + touch) */
  getState(): InputState {
    const kbLeft = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const kbRight = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const kbForward = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const kbBackward = this.keys.has('ArrowDown') || this.keys.has('KeyS');

    return {
      left: kbLeft || this.touchZones.left,
      right: kbRight || this.touchZones.right,
      forward: kbForward,
      backward: kbBackward || this.touchZones.brake,
    };
  }

  /** Whether any touch is currently active (for driving-mode detection) */
  get hasTouches(): boolean {
    return this.activeTouches.size > 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      this.activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    this.tapStartTime = performance.now();
    this.tapMoved = false;
    this.updateTouchZones();
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      this.activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    this.tapMoved = true;
    this.updateTouchZones();
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      this.activeTouches.delete(e.changedTouches[i].identifier);
    }
    this.updateTouchZones();

    // Fire tap callback for short clean taps
    if (!this.tapMoved && (performance.now() - this.tapStartTime < 300) && this.activeTouches.size === 0) {
      this.onTap?.();
    }
  }

  private updateTouchZones(): void {
    this.touchZones.left = false;
    this.touchZones.right = false;
    this.touchZones.brake = false;

    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const lb = this.leftButtonRect;
    const rb = this.rightButtonRect;

    for (const [, pos] of this.activeTouches) {
      const relX = pos.x - rect.left;
      const relY = pos.y - rect.top;

      // Check if touching the left arrow button
      if (relX >= lb.x && relX <= lb.x + lb.w && relY >= lb.y && relY <= lb.y + lb.h) {
        this.touchZones.left = true;
        continue;
      }

      // Check if touching the right arrow button
      if (relX >= rb.x && relX <= rb.x + rb.w && relY >= rb.y && relY <= rb.y + rb.h) {
        this.touchZones.right = true;
        continue;
      }

      // Anything else in the bottom 15% is brake
      if (relY > rect.height * 0.85) {
        this.touchZones.brake = true;
      } else {
        // Fallback: left half steers left, right half steers right
        if (relX < rect.width / 2) {
          this.touchZones.left = true;
        } else {
          this.touchZones.right = true;
        }
      }
    }

    this.leftPressed = this.touchZones.left;
    this.rightPressed = this.touchZones.right;
  }
}
