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

const NUM_CARS = 6;
const PLAYER_SLOT = 0; // Player is the first car (pole position)
const GRASS_RESPAWN_TIME = 5; // Respawn after 5 seconds on grass

export type MenuScreen = 'main' | 'play' | 'rankings' | 'settings';
export type GamePhase = 'menu' | 'playing';

export interface MenuState {
  screen: MenuScreen;
  gamePhase: GamePhase;
  bestTimes: { position: number; time: number }[];
  soloMode: boolean;
}

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

  // Menu state
  private menuState: MenuState = {
    screen: 'main',
    gamePhase: 'menu',
    bestTimes: [],
    soloMode: false,
  };
  private menuClickHandler: ((e: MouseEvent) => void) | null = null;
  private menuTouchHandler: ((e: TouchEvent) => void) | null = null;
  private finishClickHandler: ((e: MouseEvent) => void) | null = null;
  private finishTouchHandler: ((e: TouchEvent) => void) | null = null;

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

    // Restart on space (keyboard)
    window.addEventListener('keydown', this.handleRestart);
    this.input.onTap = this.handleRestartTap;

    // Finish screen button handlers (persistent during gameplay)
    this.finishClickHandler = (e: MouseEvent) => this.handleFinishClick(e.clientX, e.clientY);
    this.finishTouchHandler = (e: TouchEvent) => {
      if (e.touches.length > 0 && this.raceManager.getState().playerFinished) {
        e.preventDefault();
        this.handleFinishClick(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.canvas.addEventListener('click', this.finishClickHandler);
    this.canvas.addEventListener('touchstart', this.finishTouchHandler, { passive: false });

    // Load best times from localStorage
    this.loadBestTimes();

    // Start in menu phase
    this.menuState.gamePhase = 'menu';
    this.menuState.screen = 'main';
    this.attachMenuHandlers();

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
    this.detachMenuHandlers();
    this.detachFinishHandlers();
    window.removeEventListener('resize', this.resizeCanvas);
    window.removeEventListener('keydown', this.handleRestart);
  }

  /** Restart — restart the same race without going to menu */
  restart(): void {
    // Save finish time if completed
    const raceState = this.raceManager.getState();
    if (raceState.playerFinished && raceState.playerFinishTime > 0) {
      this.saveBestTime(raceState.playerPosition, raceState.playerFinishTime);
    }
    const wasSolo = this.menuState.soloMode;
    this.cars = [];
    this.raceManager = new RaceManager(this.track);
    this.aiSystem = new AISystem(this.track.waypoints, this.track.brakeAIZones);
    this.startRace(wasSolo);
  }

  /** Start the actual race (called from menu) */
  private startRace(solo: boolean): void {
    this.menuState.gamePhase = 'playing';
    this.menuState.soloMode = solo;
    this.detachMenuHandlers();

    this.createCars();
    this.raceManager.init(this.cars);

    const player = this.cars.find(c => c.isPlayer)!;
    this.camera.snapTo(player.x, player.y, player.angle);
  }

  private handleRestart = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.raceManager.getState().playerFinished) {
      e.preventDefault();
      this.restart();
    }
    // Manual respawn: press R while racing
    if (e.code === 'KeyR' && this.menuState.gamePhase === 'playing') {
      const player = this.cars.find(c => c.isPlayer);
      if (player && player.state === 'running') {
        this.respawnCarToRoad(player);
      }
    }
  };

  /** Handle clicks on the finish screen buttons */
  private handleFinishClick(clientX: number, clientY: number): void {
    if (!this.raceManager.getState().playerFinished) return;

    const rect = this.canvas.getBoundingClientRect();
    const cw = this.camera.canvasWidth;
    const ch = this.camera.canvasHeight;
    const scaleX = cw / rect.width;
    const scaleY = ch / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const buttons = this.renderer.getFinishButtons(cw, ch);
    for (const btn of buttons) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.id === 'finish_restart') {
          this.restart();
        } else if (btn.id === 'finish_menu') {
          this.backToMenu();
        }
        return;
      }
    }
  }

  private handleRestartTap = (): void => {
    // Tap-to-restart disabled — use finish screen buttons instead
  };

  /** Go back to the main menu from the finish screen */
  private backToMenu(): void {
    const raceState = this.raceManager.getState();
    if (raceState.playerFinished && raceState.playerFinishTime > 0) {
      this.saveBestTime(raceState.playerPosition, raceState.playerFinishTime);
    }
    this.cars = [];
    this.raceManager = new RaceManager(this.track);
    this.aiSystem = new AISystem(this.track.waypoints, this.track.brakeAIZones);
    this.menuState.gamePhase = 'menu';
    this.menuState.screen = 'main';
    this.attachMenuHandlers();
  };

  // ==================== CAR CREATION ====================

  /**
   * Create all cars based on startCells — matches createCars function from eGame.
   * Player car uses upgrade values, AI cars get proportional speeds.
   */
  private createCars(): void {
    this.cars = [];
    const numCars = this.menuState.soloMode ? 1 : NUM_CARS;
    const cells = this.track.startCells.slice(0, numCars);

    // Player upgrade values (level 1 defaults)
    // maxSpeed from engine, steerSpeed uses Car behavior default (350°/s)
    // acceleration and deceleration from brakes upgrade
    const playerMaxSpeed = UPGRADE_DEFAULTS.engine.base;   // 850 px/s
    const playerSteer = 35;       // degrees/s (minimal sensitivity)
    const playerAccel = 380;      // px/s² — F1-like punch, drag curve keeps same top speed
    const playerDecel = 500;      // px/s² (default)
    const playerGrip = UPGRADE_DEFAULTS.grip.base;         // 110

    // Build pool of AI-eligible colors: exclude player color (index 0) and black/dark colors
    const playerColor = TEAM_COLORS[0];
    const darkThreshold = 60; // RGB sum threshold — below this is "too dark"
    const aiColorPool: { color: string; teamIndex: number }[] = [];
    for (let ci = 0; ci < TEAM_COLORS.length; ci++) {
      if (ci === 0) continue; // skip player color
      const hex = TEAM_COLORS[ci];
      // Parse hex to check brightness
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (r + g + b < darkThreshold * 3) continue; // skip black/very dark colors
      aiColorPool.push({ color: hex, teamIndex: ci });
    }
    // Shuffle AI color pool
    for (let i = aiColorPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [aiColorPool[i], aiColorPool[j]] = [aiColorPool[j], aiColorPool[i]];
    }

    let aiColorIdx = 0;
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
        const aiMaxSpeed = lerp(1.20 * playerMaxSpeed, 1.20 * playerMaxSpeed, t);
        const aiSteer = lerp(45, 65, t);  // closer to player's 35°/s for fluid visible turns

        const aiTeam = aiColorPool[aiColorIdx % aiColorPool.length];
        aiColorIdx++;

        const config: CarConfig = {
          id: i,
          isPlayer: false,
          x: cell.x,
          y: cell.y,
          angle: cell.angle,
          maxSpeed: aiMaxSpeed,
          steerSpeed: aiSteer,
          acceleration: 380,
          deceleration: 500,
          gripThreshold: lerp(80, 130, t),
          teamIndex: aiTeam.teamIndex,
          color: aiTeam.color,
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

    if (this.menuState.gamePhase === 'menu') {
      this.renderMenu();
    } else {
      this.update(dt);
      this.render();
    }

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

    // --- Cornering visuals for ALL cars (body lean + wheel turn from angular velocity) ---
    for (const car of this.cars) {
      // Compute angular velocity from actual angle change (works for both player & AI)
      const angleDelta = car.angle - car.prevAngle;
      // Normalize to -PI..PI
      let normDelta = angleDelta;
      if (normDelta > Math.PI) normDelta -= Math.PI * 2;
      if (normDelta < -Math.PI) normDelta += Math.PI * 2;
      car.prevAngle = car.angle;

      if (dt > 0) {
        const rawAngVel = normDelta / dt; // radians/second
        // Smooth angular velocity — faster tracking for fluid response
        car.angularVelocity += (rawAngVel - car.angularVelocity) * Math.min(1, 12 * dt);
      }

      // Derive smoothSteer from angular velocity — maps turning rate to -1..1
      // With lower steerSpeed (120-160°/s ≈ 2-2.8 rad/s), 1.5 maps well to full lock
      const steerFromTurn = Math.max(-1, Math.min(1, car.angularVelocity / 1.5));

      // Both player and AI use steerDirection (set by simulateControl calls)
      // so front wheels visually turn identically for everyone
      const rawSteer = car.steerDirection;
      // Slower smoothing so brief steer inputs produce visible wheel turns
      const smoothRate = car.isPlayer ? 12 : 6;
      car.smoothSteer += (rawSteer - car.smoothSteer) * Math.min(1, smoothRate * dt);
      if (Math.abs(car.smoothSteer) < 0.005) car.smoothSteer = 0;

      // Suspension sway (body lean) from cornering — for AI cars
      if (!car.isPlayer && car.state === 'running') {
        const targetSway = steerFromTurn * 1.0; // full lean
        car.suspensionSway += (targetSway - car.suspensionSway) * Math.min(1, 6 * dt);
        if (Math.abs(car.suspensionSway) < 0.005) car.suspensionSway = 0;
      }
    }

    // --- Fence collision ---
    for (const car of this.cars) {
      this.handleFenceCollision(car);
    }

    // --- Grass slowdown + off-road respawn ---
    for (const car of this.cars) {
      this.applyGrassSlowdown(car, dt);
    }
    for (const car of this.cars) {
      if (car.state !== 'running') continue;
      if (car.onGrass) {
        car.grassTimer += dt;
        if (car.grassTimer >= GRASS_RESPAWN_TIME) {
          this.respawnCarToRoad(car);
        }
      } else {
        car.grassTimer = 0;
      }
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
    // No steering assist on grass — player has full control off-road
    if (car.onGrass) return;
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
    const grassMaxSpeed = 650; // slightly limited on grass

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
      // Flat deceleration on grass — no multiplicative drag (avoids "magnet" feel)
      if (Math.abs(car.behavior.speed) > grassMaxSpeed) {
        // Gradually slow down toward the grass cap
        const excess = Math.abs(car.behavior.speed) - grassMaxSpeed;
        const reduction = Math.min(excess, 200 * dt); // lose up to 200 px/s²
        car.behavior.speed -= Math.sign(car.behavior.speed) * reduction;
      }
    } else {
      car.onGrass = false;
    }
  }

  /**
   * Respawn a car to the nearest point on the road.
   * Finds the closest point on any waypoint segment and places the car there,
   * facing toward the next waypoint.
   */
  private respawnCarToRoad(car: Car): void {
    const wps = this.track.waypoints;
    let bestDist = Infinity;
    let bestX = car.x;
    let bestY = car.y;
    let bestSegIdx = 0;

    for (let i = 0; i < wps.length; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % wps.length];
      const proj = this.closestPointOnSegment(car.x, car.y, a.x, a.y, b.x, b.y);
      const d = distance(car.x, car.y, proj.x, proj.y);
      if (d < bestDist) {
        bestDist = d;
        bestX = proj.x;
        bestY = proj.y;
        bestSegIdx = i;
      }
    }

    // Place car on road, facing toward the next waypoint
    const nextWpIdx = (bestSegIdx + 1) % wps.length;
    const nextWp = wps[nextWpIdx];
    const faceAngle = angleTo(bestX, bestY, nextWp.x, nextWp.y);

    car.x = bestX;
    car.y = bestY;
    car.behavior.speed = 0;
    car.behavior.motionAngle = faceAngle;
    car.behavior.facingAngle = faceAngle;
    car.onGrass = false;
    car.grassTimer = 0;
    car.wayPoint = nextWpIdx;
    car.deactivateBooster();
  }

  /** Return the closest point on segment (ax,ay)-(bx,by) to point (px,py) */
  private closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: ax, y: ay };
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + t * dx, y: ay + t * dy };
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
      // Real F1 wall hit: car stops dead, driver must reverse out manually
      // Only kill speed if car is moving forward (into the wall).
      // If already reversing (negative speed), let the car escape.
      if (car.behavior.speed > 0) {
        car.behavior.speed = 0;
      }

      // Push car out of the wall so it doesn't clip
      const pushDist = collision.depth + 4;
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
          // 1. Separate cars (push apart so they don't overlap)
          const pushDist = collision.depth / 2 + 2;
          a.x += collision.nx * pushDist;
          a.y += collision.ny * pushDist;
          b.x -= collision.nx * pushDist;
          b.y -= collision.ny * pushDist;

          // 2. Gentle speed reduction — only lose 5% per collision, minimum 60 px/s
          const minSpeed = 60;
          a.behavior.speed = Math.max(Math.abs(a.behavior.speed) * 0.95, minSpeed);
          b.behavior.speed = Math.max(Math.abs(b.behavior.speed) * 0.95, minSpeed);

          // 3. Slight deflection — nudge motion angles away from each other
          const deflect = 0.08; // ~4.5 degrees
          a.behavior.motionAngle += collision.nx > 0 ? deflect : -deflect;
          b.behavior.motionAngle += collision.nx > 0 ? -deflect : deflect;
        }
      }
    }
  }

  // ==================== RENDERING ====================

  private render(): void {
    this.renderer.render(this.track, this.cars, this.raceManager.getState());
  }

  private renderMenu(): void {
    this.renderer.renderMenu(this.menuState);
  }

  // ==================== MENU SYSTEM ====================

  private attachMenuHandlers(): void {
    this.menuClickHandler = (e: MouseEvent) => this.handleMenuClick(e.clientX, e.clientY);
    this.menuTouchHandler = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        this.handleMenuClick(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.canvas.addEventListener('click', this.menuClickHandler);
    this.canvas.addEventListener('touchstart', this.menuTouchHandler, { passive: false });
  }

  private detachMenuHandlers(): void {
    if (this.menuClickHandler) {
      this.canvas.removeEventListener('click', this.menuClickHandler);
      this.menuClickHandler = null;
    }
    if (this.menuTouchHandler) {
      this.canvas.removeEventListener('touchstart', this.menuTouchHandler);
      this.menuTouchHandler = null;
    }
  }

  private detachFinishHandlers(): void {
    if (this.finishClickHandler) {
      this.canvas.removeEventListener('click', this.finishClickHandler);
      this.finishClickHandler = null;
    }
    if (this.finishTouchHandler) {
      this.canvas.removeEventListener('touchstart', this.finishTouchHandler);
      this.finishTouchHandler = null;
    }
  }

  private handleMenuClick(clientX: number, clientY: number): void {
    if (this.menuState.gamePhase !== 'menu') return;

    const rect = this.canvas.getBoundingClientRect();
    const cw = this.camera.canvasWidth;
    const ch = this.camera.canvasHeight;
    const scaleX = cw / rect.width;
    const scaleY = ch / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const buttons = this.renderer.getMenuButtons(this.menuState, cw, ch);
    for (const btn of buttons) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        this.onMenuButton(btn.id);
        return;
      }
    }
  }

  private onMenuButton(id: string): void {
    switch (id) {
      case 'play':
        this.menuState.screen = 'play';
        break;
      case 'rankings':
        this.menuState.screen = 'rankings';
        break;
      case 'settings':
        this.menuState.screen = 'settings';
        break;
      case 'back':
        this.menuState.screen = 'main';
        break;
      case 'play_bots':
        this.startRace(false);
        break;
      case 'play_solo':
        this.startRace(true);
        break;
    }
  }

  private loadBestTimes(): void {
    try {
      const data = localStorage.getItem('formula-racers-best-times');
      if (data) {
        this.menuState.bestTimes = JSON.parse(data);
      }
    } catch {
      this.menuState.bestTimes = [];
    }
  }

  private saveBestTime(position: number, time: number): void {
    this.menuState.bestTimes.push({ position, time });
    // Keep only the best 10 by time
    this.menuState.bestTimes.sort((a, b) => a.time - b.time);
    this.menuState.bestTimes = this.menuState.bestTimes.slice(0, 10);
    try {
      localStorage.setItem('formula-racers-best-times', JSON.stringify(this.menuState.bestTimes));
    } catch {
      // localStorage not available
    }
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
