/**
 * Main Game class — Orchestrates all game systems.
 * Creates cars, runs the game loop, handles collision, and renders.
 */

import { Camera } from './core/Camera';
import { InputManager } from './core/InputManager';
import { Car, CarConfig } from './entities/Car';
import { TRACK0_DATA, TrackData } from './data/track0';
import { TEAM_COLORS, UPGRADE_DEFAULTS, GEARS, BOOSTER } from './data/gameConfig';
import { AISystem } from './systems/AISystem';
import { RaceManager, RaceState } from './systems/RaceManager';
import { checkFenceCollision, checkCarCollision } from './systems/CollisionSystem';
import { Renderer } from './rendering/Renderer';
import { lerp, toRadians, angleTo, angleDifference, isClockwise, wrapAngle, distance } from './core/math';

const NUM_CARS = 12;
const PLAYER_SLOT = 0; // Player is the first car (pole position)

export class Game {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private input: InputManager;
  private renderer: Renderer;
  private raceManager: RaceManager;
  private aiSystem: AISystem;
  private cars: Car[] = [];
  private track: TrackData;
  private running: boolean = false;
  private lastTime: number = 0;
  private animFrameId: number = 0;

  // Steering help factor (from game: steerHelp = 0.5)
  private readonly steerHelpFactor = 0.5;

  // Rapid tap detection for suspension sway
  private lastSteerDir: number = 0;        // -1, 0, 1
  private steerChangeTimestamps: number[] = [];  // recent direction-change times
  private swayTarget: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.track = TRACK0_DATA;
    this.camera = new Camera();
    this.input = new InputManager();
    this.renderer = new Renderer(canvas, this.camera);
    this.renderer.setInputManager(this.input);
    this.raceManager = new RaceManager(this.track);
    this.aiSystem = new AISystem(this.track.waypoints, this.track.brakeAIZones);
  }

  /** Initialize and start the game */
  start(): void {
    this.resizeCanvas();
    this.input.attach(this.canvas);
    window.addEventListener('resize', this.resizeCanvas);

    // Restart on space (keyboard) or tap (touch)
    window.addEventListener('keydown', this.handleRestart);
    this.input.onTap = this.handleRestartTap;

    this.createCars();
    this.raceManager.init(this.cars);

    // Snap camera to player starting position
    const player = this.cars.find(c => c.isPlayer)!;
    this.camera.snapTo(player.x, player.y, player.angle);

    this.running = true;
    this.lastTime = performance.now();
    this.gameLoop(this.lastTime);
  }

  /** Stop the game and clean up */
  stop(): void {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    this.input.detach();
    window.removeEventListener('resize', this.resizeCanvas);
    window.removeEventListener('keydown', this.handleRestart);
  }

  /** Restart the race */
  restart(): void {
    this.stop();
    this.cars = [];
    this.raceManager = new RaceManager(this.track);
    this.aiSystem = new AISystem(this.track.waypoints, this.track.brakeAIZones);
    this.start();
  }

  private handleRestart = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.raceManager.getState().playerFinished) {
      e.preventDefault();
      this.restart();
    }
  };

  private handleRestartTap = (): void => {
    if (this.raceManager.getState().playerFinished) {
      this.restart();
    }
  };

  // ==================== CAR CREATION ====================

  /**
   * Create all cars based on startCells — matches createCars function from eGame.
   * Player car uses upgrade values, AI cars get proportional speeds.
   */
  private createCars(): void {
    this.cars = [];
    const cells = this.track.startCells.slice(0, NUM_CARS);

    // Player upgrade values (level 1 defaults)
    // maxSpeed from engine, steerSpeed uses Car behavior default (350°/s)
    // acceleration and deceleration from brakes upgrade
    const playerMaxSpeed = UPGRADE_DEFAULTS.engine.base;   // 850 px/s
    const playerSteer = 220;      // degrees/s (reduced from 350 for less twitchy steering)
    const playerAccel = 220;      // px/s² — low base so drag curve makes 850 take a long time
    const playerDecel = 500;      // px/s² (default)
    const playerGrip = UPGRADE_DEFAULTS.grip.base;         // 110

    // Shuffle team colors for AI
    const shuffledColors = [...TEAM_COLORS];
    for (let i = shuffledColors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledColors[i], shuffledColors[j]] = [shuffledColors[j], shuffledColors[i]];
    }

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const isPlayer = i === PLAYER_SLOT;

      if (isPlayer) {
        const config: CarConfig = {
          id: i,
          isPlayer: true,
          x: cell.x,
          y: cell.y,
          angle: cell.angle,
          maxSpeed: playerMaxSpeed,
          steerSpeed: playerSteer,
          acceleration: playerAccel,
          deceleration: playerDecel,
          gripThreshold: playerGrip,
          teamIndex: 0,
          color: TEAM_COLORS[0],
        };
        this.cars.push(new Car(config));
      } else {
        // AI speed distribution: slightly boosted from original for competitive racing
        const t = (cells.length > 1) ? i / (cells.length - 1) : 0.5;
        const aiMaxSpeed = lerp(0.93 * playerMaxSpeed, 0.98 * playerMaxSpeed, t);
        const aiSteer = lerp(400, 600, t);

        const config: CarConfig = {
          id: i,
          isPlayer: false,
          x: cell.x,
          y: cell.y,
          angle: cell.angle,
          maxSpeed: aiMaxSpeed,
          steerSpeed: aiSteer,
          acceleration: 220,
          deceleration: 500,
          gripThreshold: lerp(80, 130, t),
          teamIndex: i % TEAM_COLORS.length,
          color: shuffledColors[i % shuffledColors.length],
        };
        this.cars.push(new Car(config));
      }
    }
  }

  // ==================== GAME LOOP ====================

  private gameLoop = (time: number): void => {
    if (!this.running) return;

    const dt = Math.min((time - this.lastTime) / 1000, 0.05); // Cap at 50ms
    this.lastTime = time;

    this.update(dt);
    this.render();

    this.animFrameId = requestAnimationFrame(this.gameLoop);
  };

  private update(dt: number): void {
    if (dt === 0) return;

    const raceState = this.raceManager.getState();

    // --- Player input ---
    if (raceState.phase === 'racing') {
      const player = this.cars.find(c => c.isPlayer);
      if (player && player.state === 'running') {
        const input = this.input.getState();

        // Auto-accelerate only when not braking (matches original)
        if (!input.backward) {
          player.behavior.simulateControl(2); // forward
        } else {
          player.behavior.simulateControl(3); // brake
        }

        if (input.left) player.behavior.simulateControl(0);
        if (input.right) player.behavior.simulateControl(1);

        // --- Rapid tap detection for suspension sway ---
        const curDir = input.left ? -1 : input.right ? 1 : 0;
        if (curDir !== 0 && curDir !== this.lastSteerDir && this.lastSteerDir !== 0) {
          // Direction changed (left→right or right→left)
          const now = performance.now();
          this.steerChangeTimestamps.push(now);
          // Keep only changes in the last 800ms
          this.steerChangeTimestamps = this.steerChangeTimestamps.filter(t => now - t < 800);
          // 3+ rapid direction changes triggers sway
          if (this.steerChangeTimestamps.length >= 3) {
            this.swayTarget = curDir;
          }
        }
        if (curDir !== 0) this.lastSteerDir = curDir;

        // Smoothly animate sway toward target, then decay
        if (this.swayTarget !== 0) {
          player.suspensionSway += (this.swayTarget - player.suspensionSway) * 6 * dt;
          // Decay target back to 0
          this.swayTarget *= Math.max(0, 1 - 2.5 * dt);
          if (Math.abs(this.swayTarget) < 0.05) this.swayTarget = 0;
        } else {
          // Return sway to center
          player.suspensionSway *= Math.max(0, 1 - 5 * dt);
          if (Math.abs(player.suspensionSway) < 0.01) player.suspensionSway = 0;
        }

        // Steering help — subtle assist toward next waypoint
        this.applySteerHelp(player, dt);
      }
    }

    // --- AI ---
    this.aiSystem.update(this.cars, dt);

    // --- Physics tick for all cars ---
    for (const car of this.cars) {
      car.update(dt);
    }

    // --- Fence collision ---
    for (const car of this.cars) {
      this.handleFenceCollision(car);
    }

    // --- Grass slowdown ---
    for (const car of this.cars) {
      this.applyGrassSlowdown(car, dt);
    }

    // --- Car-to-car collision ---
    this.handleCarCollisions();

    // --- Race state (checkpoints, laps, finish) ---
    this.raceManager.update(dt);

    // --- Camera ---
    const player = this.cars.find(c => c.isPlayer);
    if (player) {
      this.camera.update(
        player.x, player.y,
        player.angle,
        player.behavior.speed,
        player.maxSpeed,
        dt,
      );
    }
  }

  /**
   * Steering Help — Gently nudges the car toward the next waypoint.
   * From GAME_MECHANICS_EXACT.md section 17: factor = 0.5
   */
  private applySteerHelp(car: Car, dt: number): void {
    if (car.wayPoint >= this.track.waypoints.length) return;
    const wp = this.track.waypoints[car.wayPoint];
    const targetAngle = angleTo(car.x, car.y, wp.x, wp.y);
    const diff = angleDifference(car.angle, targetAngle);

    if (diff > toRadians(5)) {
      // Gently adjust motion angle toward waypoint
      const helpAmount = diff * this.steerHelpFactor * dt;
      if (isClockwise(targetAngle, car.behavior.motionAngle)) {
        car.behavior.motionAngle = wrapAngle(car.behavior.motionAngle + helpAmount);
      } else {
        car.behavior.motionAngle = wrapAngle(car.behavior.motionAngle - helpAmount);
      }
    }

    // Also update player waypoint progression
    const distToWP = distance(car.x, car.y, wp.x, wp.y);
    if (distToWP < 300) {
      car.wayPoint = (car.wayPoint + 1) % this.track.waypoints.length;
    }
  }

  /**
   * Grass slowdown — off-road penalty.
   * Checks the car's distance to the nearest segment of the waypoint loop.
   * If far from road center (> half road width), cap speed and apply drag.
   */
  private applyGrassSlowdown(car: Car, dt: number): void {
    if (car.state !== 'running') return;
    const roadHalf = 280; // ~half road width (520/2 + tolerance)
    const grassMaxSpeed = 350; // severely limited on grass

    // Find minimum distance from car to any waypoint segment
    const wps = this.track.waypoints;
    let minDist = Infinity;
    for (let i = 0; i < wps.length; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % wps.length];
      const d = this.distToSegment(car.x, car.y, a.x, a.y, b.x, b.y);
      if (d < minDist) minDist = d;
    }

    if (minDist > roadHalf) {
      car.onGrass = true;
      // Drag — slow down exponentially
      const drag = 1 - 2.5 * dt; // lose ~2.5x per second multiplied
      car.behavior.speed *= Math.max(drag, 0.5);
      // Hard cap
      if (Math.abs(car.behavior.speed) > grassMaxSpeed) {
        car.behavior.speed = Math.sign(car.behavior.speed) * grassMaxSpeed;
      }
    } else {
      car.onGrass = false;
    }
  }

  /** Distance from point (px,py) to line segment (ax,ay)-(bx,by) */
  private distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return distance(px, py, ax, ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return distance(px, py, ax + t * dx, ay + t * dy);
  }

  /**
   * Fence collision — Exact recreation of CarBehavior collision response.
   * On collision: speed = abs(speed), bounce, friction (70% speed loss), push out.
   */
  private handleFenceCollision(car: Car): void {
    const collision = checkFenceCollision(
      car.x, car.y, car.angle,
      this.track.fences,
      car.width / 2, car.height / 2,
    );

    if (collision) {
      // 1. Take absolute speed
      car.behavior.speed = Math.abs(car.behavior.speed);

      // 2. Apply friction (70% speed loss!)
      car.behavior.applyFriction();

      // 3. Adjust facing angle to bounce off
      const bounceAngle = Math.atan2(collision.ny, collision.nx);
      car.behavior.facingAngle = wrapAngle(bounceAngle);
      car.behavior.motionAngle = wrapAngle(bounceAngle);

      // 4. Push car away from fence
      const pushDist = collision.depth + 2;
      car.x += collision.nx * pushDist;
      car.y += collision.ny * pushDist;

      car.bang = collision.depth;
    }
  }

  /**
   * Car-to-car collision — pushCar function from GAME_MECHANICS_EXACT.md section 18.
   */
  private handleCarCollisions(): void {
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (a.state === 'idle' || b.state === 'idle') continue;

        const collision = checkCarCollision(
          a.x, a.y, a.angle,
          b.x, b.y, b.angle,
          a.width / 2, a.height / 2,
        );

        if (collision) {
          const pushDist = collision.depth / 2 + 1;
          a.x += collision.nx * pushDist;
          a.y += collision.ny * pushDist;
          b.x -= collision.nx * pushDist;
          b.y -= collision.ny * pushDist;

          // Speed exchange (simplified)
          const avgSpeed = (Math.abs(a.behavior.speed) + Math.abs(b.behavior.speed)) / 2;
          a.behavior.speed = avgSpeed * 0.85;
          b.behavior.speed = avgSpeed * 0.85;
        }
      }
    }
  }

  // ==================== RENDERING ====================

  private render(): void {
    this.renderer.render(this.track, this.cars, this.raceManager.getState());
  }

  // ==================== CANVAS MANAGEMENT ====================

  private resizeCanvas = (): void => {
    const container = this.canvas.parentElement;
    if (!container) return;

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // Maintain 9:16 aspect ratio (portrait) with letterboxing
    // On mobile, fill the screen fully
    const isMobile = containerW < 768;
    const targetRatio = 9 / 16;
    let displayW: number;
    let displayH: number;

    if (isMobile) {
      // Fill entire screen on mobile
      displayW = containerW;
      displayH = containerH;
      this.camera.isMobile = true;
    } else if (containerW / containerH > targetRatio) {
      displayH = containerH;
      displayW = displayH * targetRatio;
    } else {
      displayW = containerW;
      displayH = displayW / targetRatio;
    }

    // Set CSS display size
    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;

    // Set render resolution (cap for performance)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderW = Math.round(Math.min(displayW * dpr, 1080));
    const renderH = Math.round(Math.min(displayH * dpr, 1920));

    this.canvas.width = renderW;
    this.canvas.height = renderH;

    this.camera.canvasWidth = renderW;
    this.camera.canvasHeight = renderH;

    this.input.updateButtonRects();
  };
}
