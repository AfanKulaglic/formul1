/**
 * AI System — Waypoint-following AI for opponent cars.
 * Natural driving with continuous corrections, look-ahead, and smooth lines.
 */

import { Car } from '../entities/Car';
import { Waypoint, Rect } from '../data/track0';
import { angleTo, angleDifference, isClockwise, distance, wrapAngle } from '../core/math';

const WAYPOINT_REACH_DIST = 300;
const LANE_OFFSET = 80;

/** Per-car AI personality */
interface AIPersonality {
  steerDeadZone: number;     // tiny dead-zone (nearly always correcting)
  hardTurnThreshold: number; // angle above which AI brakes
  aggression: number;        // 0–1
  wanderAmount: number;      // lane offset noise px
  wanderSpeed: number;       // oscillation speed
  wanderPhase2: number;      // secondary wander phase offset
  throttleLift: number;      // how much throttle cut on turns
  laneChangeChance: number;
  lookAheadWeight: number;   // how much to blend toward next waypoint
  cornerAnticipation: number; // how early to start turning for next WP
}

const personalities = new WeakMap<Car, AIPersonality>();

function getPersonality(car: Car): AIPersonality {
  let p = personalities.get(car);
  if (!p) {
    p = {
      steerDeadZone: 0.03 + Math.random() * 0.04,        // 1.7–4° (almost always steering)
      hardTurnThreshold: 0.5 + Math.random() * 0.3,       // 29–46°
      aggression: 0.3 + Math.random() * 0.7,
      wanderAmount: 20 + Math.random() * 40,               // 20–60 px (noticeable)
      wanderSpeed: 0.3 + Math.random() * 0.5,              // moderate oscillation
      wanderPhase2: Math.random() * Math.PI * 2,
      throttleLift: 0.10 + Math.random() * 0.20,
      laneChangeChance: 0.10 + Math.random() * 0.20,
      lookAheadWeight: 0.25 + Math.random() * 0.20,        // 25–45% blend to next WP
      cornerAnticipation: 400 + Math.random() * 300,        // start blending 400–700px before WP
    };
    personalities.set(car, p);
  }
  return p;
}

const steerAccum = new WeakMap<Car, { wander: number; smoothTarget: number }>();

function getSteerState(car: Car) {
  let s = steerAccum.get(car);
  if (!s) {
    s = { wander: Math.random() * Math.PI * 2, smoothTarget: 0 };
    steerAccum.set(car, s);
  }
  return s;
}

export class AISystem {
  private waypoints: Waypoint[];
  private brakeZones: Rect[];

  constructor(waypoints: Waypoint[], brakeZones: Rect[]) {
    this.waypoints = waypoints;
    this.brakeZones = brakeZones;
  }

  update(cars: Car[], dt: number): void {
    for (const car of cars) {
      if (car.isPlayer || car.state !== 'running') continue;
      this.updateCar(car, dt);
    }
  }

  private updateCar(car: Car, dt: number): void {
    const wp = this.waypoints[car.wayPoint];
    if (!wp) return;

    const personality = getPersonality(car);
    const steerState = getSteerState(car);
    const wpCount = this.waypoints.length;

    // === 1. Look-ahead target — blend current WP with next WP for smooth cornering ===
    const nextWpIdx = (car.wayPoint + 1) % wpCount;
    const nextWp = this.waypoints[nextWpIdx];
    const afterNextIdx = (car.wayPoint + 2) % wpCount;
    const afterNextWp = this.waypoints[afterNextIdx];

    // Blend toward next waypoint based on distance to current (anticipate corners)
    const distToWP = distance(car.x, car.y, wp.x, wp.y);
    const blendT = Math.max(0, Math.min(1,
      1 - (distToWP - 100) / personality.cornerAnticipation
    ));
    const lookAhead = personality.lookAheadWeight * blendT;

    // Blended target position (current WP → next WP)
    const baseTargetX = wp.x + (nextWp.x - wp.x) * lookAhead;
    const baseTargetY = wp.y + (nextWp.y - wp.y) * lookAhead;

    // === 2. Natural wander — dual-frequency for organic feel ===
    steerState.wander += personality.wanderSpeed * dt;
    const wander1 = Math.sin(steerState.wander) * personality.wanderAmount;
    const wander2 = Math.sin(steerState.wander * 0.37 + personality.wanderPhase2) * personality.wanderAmount * 0.4;
    const wanderOffset = wander1 + wander2;

    // Lane offset perpendicular to track direction
    const trackAngle = angleTo(wp.x, wp.y, nextWp.x, nextWp.y);
    const perpAngle = trackAngle + Math.PI / 2;
    const totalLaneOffset = car.targetLane * LANE_OFFSET + wanderOffset;
    const targetX = baseTargetX + Math.cos(perpAngle) * totalLaneOffset;
    const targetY = baseTargetY + Math.sin(perpAngle) * totalLaneOffset;

    // === 3. Smooth target angle (avoids instant snapping) ===
    const rawAngleToTarget = angleTo(car.x, car.y, targetX, targetY);
    car.targetAngle = rawAngleToTarget;

    // Smoothly track the target angle to avoid jitter
    let angleDeltaTarget = rawAngleToTarget - steerState.smoothTarget;
    if (angleDeltaTarget > Math.PI) angleDeltaTarget -= Math.PI * 2;
    if (angleDeltaTarget < -Math.PI) angleDeltaTarget += Math.PI * 2;
    steerState.smoothTarget += angleDeltaTarget * Math.min(1, 6 * dt);
    steerState.smoothTarget = wrapAngle(steerState.smoothTarget);

    const angleDiff = angleDifference(car.angle, steerState.smoothTarget);

    // === 4. Near-continuous steering — always correcting above tiny dead-zone ===
    if (angleDiff > personality.steerDeadZone) {
      if (isClockwise(steerState.smoothTarget, car.angle)) {
        car.behavior.simulateControl(1); // right
      } else {
        car.behavior.simulateControl(0); // left
      }
    }

    // === 5. Throttle — lift on medium turns, cut on hard turns ===
    const mediumTurn = angleDiff > 0.15 && angleDiff < personality.hardTurnThreshold;
    if (mediumTurn) {
      // Probabilistic throttle lift — not always, to avoid jerky acceleration
      if (Math.random() > personality.throttleLift * 0.5) {
        car.behavior.simulateControl(2); // forward
      }
    } else if (angleDiff >= personality.hardTurnThreshold) {
      // Hard turn — very light throttle
      if (Math.random() > 0.6) {
        car.behavior.simulateControl(2);
      }
    } else {
      car.behavior.simulateControl(2); // forward — full throttle on straights
    }

    // === 6. Brake check ===
    let shouldBrake = false;

    if (angleDiff > personality.hardTurnThreshold &&
        car.behavior.speed > car.maxSpeed * (0.25 + personality.aggression * 0.15)) {
      shouldBrake = true;
    }

    if (this.isInBrakeZone(car.x, car.y)) {
      if (car.behavior.speed > car.maxSpeed * (0.4 + personality.aggression * 0.3)) {
        shouldBrake = true;
      }
    }

    // Also anticipate upcoming sharp corners
    const nextAngleDiff = angleDifference(
      angleTo(wp.x, wp.y, nextWp.x, nextWp.y),
      angleTo(nextWp.x, nextWp.y, afterNextWp.x, afterNextWp.y)
    );
    if (nextAngleDiff > 0.8 && distToWP < 500 &&
        car.behavior.speed > car.maxSpeed * 0.5) {
      shouldBrake = true;
    }

    if (shouldBrake) {
      car.behavior.simulateControl(3);
      car.braking = true;
    } else {
      car.braking = false;
    }

    // === 7. Waypoint progression ===
    if (distToWP < WAYPOINT_REACH_DIST) {
      car.wayPoint = (car.wayPoint + 1) % wpCount;

      if (Math.random() < personality.laneChangeChance) {
        car.targetLane = car.targetLane === 0
          ? (Math.random() < 0.5 ? -1 : 1)
          : (Math.random() < 0.3 ? 0 : -car.targetLane);
      }
    }
  }

  private isInBrakeZone(carX: number, carY: number): boolean {
    for (const zone of this.brakeZones) {
      const dx = carX - zone.x;
      const dy = carY - zone.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < zone.w / 2 + 200) {
        return true;
      }
    }
    return false;
  }
}
