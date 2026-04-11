/**
 * Car Physics Behavior — Exact replica of Construct 3's Car behavior P8() tick
 * Decompiled from c3main.js lines 44910–45020.
 * 
 * Two-angle drift model:
 *   - motionAngle: where steering points (controlled by left/right input)
 *   - facingAngle: where the car actually moves (lags behind motionAngle → drift)
 *   - The sprite visually rotates to motionAngle
 *   - Movement happens along facingAngle
 */

import {
  wrapAngle,
  toRadians,
  angleDifference,
  isClockwise,
  distance,
  lerp,
  TWO_PI,
} from './math';

export interface CarBehaviorParams {
  maxSpeed: number;       // pixels/second (default 1500, game override from upgrades)
  acceleration: number;   // pixels/second² (default 500)
  deceleration: number;   // pixels/second² (default 500)
  steerSpeed: number;     // radians/second (default toRadians(350))
  driftRecover: number;   // radians/second (default toRadians(350))
  friction: number;       // 0–1 coefficient (default 0.7)
  turnWhileStopped: boolean; // default false
  setAngle: boolean;      // default true (sprite rotates to motionAngle)
  enabled: boolean;       // default false (enabled at race start)
}

export const DEFAULT_CAR_PARAMS: CarBehaviorParams = {
  maxSpeed: 1500,
  acceleration: 500,
  deceleration: 500,
  steerSpeed: toRadians(350),
  driftRecover: toRadians(350),
  friction: 0.7,
  turnWhileStopped: false,
  setAngle: true,
  enabled: false,
};

export class CarBehavior {
  // Properties
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  steerSpeed: number;
  driftRecover: number;
  friction: number;
  turnWhileStopped: boolean;
  setAngle: boolean;
  enabled: boolean;

  // State
  speed: number = 0;
  motionAngle: number = 0;   // where steering points (radians)
  facingAngle: number = 0;   // where car actually moves (radians)

  // Position (managed externally, but tracked for collision rollback)
  x: number = 0;
  y: number = 0;
  prevX: number = 0;
  prevY: number = 0;

  // Simulated control inputs (reset each tick)
  private simLeft: boolean = false;
  private simRight: boolean = false;
  private simForward: boolean = false;
  private simBackward: boolean = false;

  // Visible steering direction: -1 = left, 0 = straight, 1 = right
  steerDirection: number = 0;

  constructor(params: Partial<CarBehaviorParams> = {}) {
    const p = { ...DEFAULT_CAR_PARAMS, ...params };
    this.maxSpeed = p.maxSpeed;
    this.acceleration = p.acceleration;
    this.deceleration = p.deceleration;
    this.steerSpeed = p.steerSpeed;
    this.driftRecover = p.driftRecover;
    this.friction = p.friction;
    this.turnWhileStopped = p.turnWhileStopped;
    this.setAngle = p.setAngle;
    this.enabled = p.enabled;
  }

  /** Set initial position and angle */
  init(x: number, y: number, angle: number): void {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.motionAngle = angle;
    this.facingAngle = angle;
    this.speed = 0;
  }

  /**
   * SimulateControl — press a control for one frame.
   * 0=left, 1=right, 2=forward, 3=backward
   */
  simulateControl(n: number): void {
    switch (n) {
      case 0: this.simLeft = true; break;
      case 1: this.simRight = true; break;
      case 2: this.simForward = true; break;
      case 3: this.simBackward = true; break;
    }
  }

  /**
   * P8() — The main physics tick. Exact replica of C3 Car behavior.
   * Must be called every frame with dt in seconds.
   */
  tick(dt: number): void {
    if (!this.enabled || dt === 0) return;

    // Read and reset simulated controls
    let left = this.simLeft;
    let right = this.simRight;
    const forward = this.simForward;
    const backward = this.simBackward;
    this.simLeft = false;
    this.simRight = false;
    this.simForward = false;
    this.simBackward = false;

    // Track steering direction for front wheel visual rotation
    this.steerDirection = left ? -1 : right ? 1 : 0;

    // === 1. SPEED UPDATE ===
    // Drag-based model: acceleration diminishes as speed increases.
    // dragCoeff is tuned so that engine force = drag at maxSpeed, giving
    // a natural asymptotic top speed that takes a long time on a straight.
    const dragCoeff = this.acceleration / (this.maxSpeed * this.maxSpeed);

    if (forward && !backward) {
      // Engine force minus aerodynamic drag (v²)
      const drag = dragCoeff * this.speed * this.speed;
      const netAccel = this.acceleration - drag;
      this.speed += netAccel * dt;
      // No hard cap — let drag naturally limit speed.
      // When speed > maxSpeed (e.g. after boost ends), drag > engine
      // and speed gradually decreases on its own.
    } else if (backward && !forward) {
      this.speed -= this.deceleration * dt;
      if (this.speed < -this.maxSpeed) this.speed = -this.maxSpeed;
    } else {
      // No throttle: drag + light engine braking slows the car
      if (this.speed > 0) {
        const drag = dragCoeff * this.speed * this.speed;
        this.speed -= (drag + this.deceleration * 0.1) * dt;
        if (this.speed < 0) this.speed = 0;
      } else if (this.speed < 0) {
        this.speed += this.deceleration * dt * 0.1;
        if (this.speed > 0) this.speed = 0;
      }
    }

    // === 2. REVERSE STEERING SWAP ===
    if (this.speed < 0 && !this.turnWhileStopped) {
      [left, right] = [right, left];
    }

    // === 3. STEERING (motion angle update) ===
    let steerFactor = 1;
    if (!this.turnWhileStopped) {
      steerFactor = Math.abs(this.speed) / this.maxSpeed;
      if (!Number.isFinite(steerFactor)) steerFactor = 0;
    }

    if (left && !right) {
      this.motionAngle = wrapAngle(this.motionAngle - this.steerSpeed * dt * steerFactor);
    }
    if (right && !left) {
      this.motionAngle = wrapAngle(this.motionAngle + this.steerSpeed * dt * steerFactor);
    }

    // === 4. DRIFT RECOVERY (facing angle catches up to motion angle) ===
    let driftRecoverAmount = this.driftRecover * dt;
    const angleDiff = angleDifference(this.motionAngle, this.facingAngle);

    // If drift angle exceeds 90°, increase recovery speed to prevent backwards spinning
    if (angleDiff > toRadians(90)) {
      driftRecoverAmount += angleDiff - toRadians(90);
    }

    if (angleDiff <= driftRecoverAmount) {
      // Close enough — snap to motion angle
      this.facingAngle = wrapAngle(this.motionAngle);
    } else if (isClockwise(this.motionAngle, this.facingAngle)) {
      this.facingAngle = wrapAngle(this.facingAngle + driftRecoverAmount);
    } else {
      this.facingAngle = wrapAngle(this.facingAngle - driftRecoverAmount);
    }

    // === 5. POSITION UPDATE ===
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.speed !== 0) {
      // Move along FACING angle (not motion angle!)
      this.x += Math.cos(this.facingAngle) * this.speed * dt;
      this.y += Math.sin(this.facingAngle) * this.speed * dt;
    }
  }

  /** Get the visual angle for the sprite (motionAngle if setAngle, else facingAngle) */
  get visualAngle(): number {
    return this.setAngle ? this.motionAngle : this.facingAngle;
  }

  /** Get the drift angle (gap between motion and facing) */
  get driftAngle(): number {
    return angleDifference(this.motionAngle, this.facingAngle);
  }

  /** Apply friction (used on collision with walls) */
  applyFriction(): void {
    this.speed *= (1 - this.friction);
  }

  /** Rollback to previous position (used on unresolvable collision) */
  rollback(): void {
    this.x = this.prevX;
    this.y = this.prevY;
  }
}
