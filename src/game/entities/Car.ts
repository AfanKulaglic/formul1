/**
 * Car Entity — Wraps CarBehavior with game-specific state.
 * Corresponds to Construct 3's carBase object with its 28 instance variables.
 */

import { CarBehavior, CarBehaviorParams } from '../core/CarBehavior';
import { toRadians, lerp, distance, angleTo, angleDifference, isClockwise, wrapAngle } from '../core/math';

export type CarState = 'idle' | 'running' | 'finish' | 'stopCar';

export interface CarConfig {
  id: number;
  isPlayer: boolean;
  x: number;
  y: number;
  angle: number;
  maxSpeed: number;
  steerSpeed: number;  // degrees/s (will be converted to radians)
  acceleration: number;
  deceleration: number;
  gripThreshold: number;
  teamIndex: number;
  color: string;
}

export class Car {
  // Identity
  readonly id: number;
  readonly isPlayer: boolean;
  readonly teamIndex: number;
  readonly color: string;

  // Physics behavior (exact C3 replica)
  readonly behavior: CarBehavior;

  // Game state (from carBase instance variables)
  state: CarState = 'idle';
  speed: number = 0;
  maxSpeed: number = 0;
  minSpeed: number = 0;
  wayPoint: number = 0;
  targetAngle: number = 0;
  targetLane: number = 0;
  changedLane: boolean = false;
  braking: boolean = false;
  curLap: number = 0;
  cpDist: number = 0;
  endPos: number = 12;
  curCP: number = 0;
  totalCP: number = 0;
  progress: number = 0;
  gear: number = 0;
  driftAngle: number = 0;
  gripThreshold: number = 110;
  scrollTo: boolean = false;
  booster: boolean = false;
  boosterTimer: number = 0;
  private boostFading: boolean = false;
  private boostFadeSpeed: number = 0;  // maxSpeed units/s during fade
  pushAngle: number = 0;
  rotate: number = 0;
  bang: number = 0;
  finishTime: number = 0;
  onGrass: boolean = false;   // True when off-road (on grass)

  // Suspension sway from rapid steering inputs (-1 to 1, negative=left, positive=right)
  suspensionSway: number = 0;

  // Visual
  width: number = 142;
  height: number = 76;

  constructor(config: CarConfig) {
    this.id = config.id;
    this.isPlayer = config.isPlayer;
    this.teamIndex = config.teamIndex;
    this.color = config.color;
    this.maxSpeed = config.maxSpeed;
    this.gripThreshold = config.gripThreshold;

    this.behavior = new CarBehavior({
      maxSpeed: config.maxSpeed,
      acceleration: config.acceleration,
      deceleration: config.deceleration,
      steerSpeed: toRadians(config.steerSpeed),
      driftRecover: toRadians(350),
      friction: 0.7,
      turnWhileStopped: false,
      setAngle: true,
      enabled: false,
    });

    this.behavior.init(config.x, config.y, config.angle);

    if (config.isPlayer) {
      this.scrollTo = true;
      this.targetLane = 0;
    } else {
      this.targetLane = Math.random() < 0.5 ? -1 : 1;
    }
  }

  get x(): number { return this.behavior.x; }
  get y(): number { return this.behavior.y; }
  set x(v: number) { this.behavior.x = v; }
  set y(v: number) { this.behavior.y = v; }
  get angle(): number { return this.behavior.visualAngle; }
  get facingAngle(): number { return this.behavior.facingAngle; }
  get currentSpeed(): number { return this.behavior.speed; }
  get steerDirection(): number { return this.behavior.steerDirection; }

  /** Enable the car (called when countdown finishes) */
  enable(): void {
    this.behavior.enabled = true;
    this.state = 'running';
  }

  /** Update car physics and game state for one frame */
  update(dt: number): void {
    // Handle booster timer
    if (this.booster && this.boosterTimer > 0) {
      this.boosterTimer -= dt * 1000;
      if (this.boosterTimer <= 0) {
        this.startBoostFade();
      }
    }

    // Handle gradual boost fade-out
    if (this.boostFading) {
      this.behavior.maxSpeed -= this.boostFadeSpeed * dt;
      if (this.behavior.maxSpeed <= this.maxSpeed) {
        this.behavior.maxSpeed = this.maxSpeed;
        this.boostFading = false;
        this.behavior.deceleration = 500;
      }
    }

    // Handle stopCar state — decelerate to stop
    if (this.state === 'stopCar') {
      if (this.behavior.speed > 10) {
        this.behavior.simulateControl(3); // brake
      } else {
        this.behavior.speed = 0;
        this.behavior.enabled = false;
      }
    }

    this.behavior.tick(dt);
    this.speed = this.behavior.speed;
    this.driftAngle = this.behavior.driftAngle;
  }

  /** Activate speed booster */
  activateBooster(durationMs: number, speedMultiplier: number, decelOverride: number): void {
    this.booster = true;
    this.boosterTimer = durationMs;
    this.behavior.maxSpeed = this.maxSpeed * speedMultiplier;
    this.behavior.deceleration = decelOverride;
  }

  /** Start gradual boost fade — maxSpeed returns to normal over ~1.5s */
  private startBoostFade(): void {
    this.booster = false;
    this.boosterTimer = 0;
    this.boostFading = true;
    // Fade from current boosted maxSpeed down to base over 1.5 seconds
    const excess = this.behavior.maxSpeed - this.maxSpeed;
    this.boostFadeSpeed = excess / 1.5;
  }

  /** Deactivate booster immediately (used for external reset) */
  deactivateBooster(): void {
    this.booster = false;
    this.boosterTimer = 0;
    this.boostFading = false;
    this.behavior.maxSpeed = this.maxSpeed;
    this.behavior.deceleration = 500; // Default
  }

  /** Set gear and adjust deceleration */
  setGear(gear: number, decelValue: number): void {
    this.gear = gear;
    if (!this.booster) {
      this.behavior.deceleration = decelValue;
    }
  }
}
