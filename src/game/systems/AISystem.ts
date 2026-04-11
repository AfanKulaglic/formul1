/**
 * AI System — Waypoint-following AI for opponent cars.
 * Replicates the Construct 3 AI event group behavior.
 * 
 * AI Logic:
 *   1. Always accelerate (SimulateControl(2))
 *   2. Calculate target angle toward current waypoint (with lane offset)
 *   3. If angle difference > threshold → steer left or right
 *   4. Brake in brakeAI zones or when angle difference is very large
 *   5. Progress to next waypoint when close enough
 */

import { Car } from '../entities/Car';
import { Waypoint, Rect } from '../data/track0';
import { angleTo, angleDifference, isClockwise, distance, wrapAngle } from '../core/math';

const WAYPOINT_REACH_DIST = 300;     // Distance to consider waypoint "reached"
const STEER_THRESHOLD = 0.175;        // ~10° — below this, AI drives straight
const HARD_TURN_THRESHOLD = 0.785;    // ~45° — AI brakes on sharp turns
const LANE_OFFSET = 80;               // Pixels offset for lane variation

export class AISystem {
  private waypoints: Waypoint[];
  private brakeZones: Rect[];

  constructor(waypoints: Waypoint[], brakeZones: Rect[]) {
    this.waypoints = waypoints;
    this.brakeZones = brakeZones;
  }

  /** Update all AI cars for one frame */
  update(cars: Car[], dt: number): void {
    for (const car of cars) {
      if (car.isPlayer || car.state !== 'running') continue;
      this.updateCar(car, dt);
    }
  }

  private updateCar(car: Car, dt: number): void {
    const wp = this.waypoints[car.wayPoint];
    if (!wp) return;

    // === 1. Calculate target position (waypoint + lane offset) ===
    // Lane offset perpendicular to the direction of travel
    const nextWpIdx = (car.wayPoint + 1) % this.waypoints.length;
    const nextWp = this.waypoints[nextWpIdx];
    const wpAngle = angleTo(wp.x, wp.y, nextWp.x, nextWp.y);
    const perpAngle = wpAngle + Math.PI / 2;
    const targetX = wp.x + Math.cos(perpAngle) * car.targetLane * LANE_OFFSET;
    const targetY = wp.y + Math.sin(perpAngle) * car.targetLane * LANE_OFFSET;

    // === 2. Calculate angle to target ===
    const angleToTarget = angleTo(car.x, car.y, targetX, targetY);
    car.targetAngle = angleToTarget;

    // === 3. Determine steering ===
    const angleDiff = angleDifference(car.angle, angleToTarget);

    if (angleDiff > STEER_THRESHOLD) {
      if (isClockwise(angleToTarget, car.angle)) {
        car.behavior.simulateControl(1); // right
      } else {
        car.behavior.simulateControl(0); // left
      }
    }

    // === 4. Always accelerate ===
    car.behavior.simulateControl(2); // forward

    // === 5. Brake check ===
    let shouldBrake = false;

    // Brake on sharp turns
    if (angleDiff > HARD_TURN_THRESHOLD && car.behavior.speed > car.maxSpeed * 0.3) {
      shouldBrake = true;
    }

    // Brake in designated brake zones
    if (this.isInBrakeZone(car.x, car.y)) {
      shouldBrake = true;
    }

    if (shouldBrake) {
      car.behavior.simulateControl(3); // brake
      car.braking = true;
    } else {
      car.braking = false;
    }

    // === 6. Check waypoint progression ===
    const distToWP = distance(car.x, car.y, wp.x, wp.y);
    if (distToWP < WAYPOINT_REACH_DIST) {
      car.wayPoint = (car.wayPoint + 1) % this.waypoints.length;

      // Random lane change occasionally
      if (Math.random() < 0.15) {
        car.targetLane = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  private isInBrakeZone(carX: number, carY: number): boolean {
    for (const zone of this.brakeZones) {
      // Simple distance check to brake zone center
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
