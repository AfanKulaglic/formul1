/**
 * AI System — Waypoint-following AI for opponent cars.
 * Natural driving with continuous corrections, look-ahead, and smooth lines.
 */

import { Car } from '../entities/Car';
import { Waypoint, Rect } from '../data/track0';
import { angleTo, angleDifference, isClockwise, distance, wrapAngle } from '../core/math';

const WAYPOINT_REACH_DIST = 300;
const LANE_OFFSET = 80;

/** Wall-stuck recovery state for AI cars */
interface RecoveryState {
  phase: 'none' | 'reverse' | 'align';
  timer: number;       // time spent in current phase
  stuckTimer: number;  // how long speed has been near zero
  reverseSteerDir: number; // -1 left, +1 right during reverse
}

const recoveryStates = new WeakMap<Car, RecoveryState>();

function getRecovery(car: Car): RecoveryState {
  let r = recoveryStates.get(car);
  if (!r) {
    r = { phase: 'none', timer: 0, stuckTimer: 0, reverseSteerDir: 0 };
    recoveryStates.set(car, r);
  }
  return r;
}

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
      wanderAmount: 8 + Math.random() * 17,                // 8–25 px (subtle)
      wanderSpeed: 0.2 + Math.random() * 0.3,              // gentle oscillation
      wanderPhase2: Math.random() * Math.PI * 2,
      throttleLift: 0.10 + Math.random() * 0.20,
      laneChangeChance: 0.10 + Math.random() * 0.20,
      lookAheadWeight: 0.35 + Math.random() * 0.20,        // 35–55% blend to next WP
      cornerAnticipation: 600 + Math.random() * 400,        // start blending 600–1000px before WP
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
      this.updateCar(car, cars, dt);
    }
  }

  private updateCar(car: Car, allCars: Car[], dt: number): void {
    const wp = this.waypoints[car.wayPoint];
    if (!wp) return;

    // === WALL-STUCK RECOVERY ===
    const recovery = getRecovery(car);
    const speed = Math.abs(car.behavior.speed);

    // Only track stuck state when NOT already recovering
    if (recovery.phase === 'none') {
      if (speed < 15) {
        recovery.stuckTimer += dt;
      } else {
        recovery.stuckTimer = 0;
      }
    }

    // Trigger recovery after being stuck for 0.3s
    if (recovery.stuckTimer > 0.3 && recovery.phase === 'none') {
      recovery.phase = 'reverse';
      recovery.timer = 0;
      // Choose reverse steer direction: steer toward the next waypoint
      const angleToWP = angleTo(car.x, car.y, wp.x, wp.y);
      // When reversing, steer opposite to align front toward WP
      recovery.reverseSteerDir = isClockwise(angleToWP, car.angle) ? -1 : 1;
    }

    // Execute recovery phases
    if (recovery.phase === 'reverse') {
      recovery.timer += dt;
      // Reverse with steering to pull away from the wall
      car.behavior.simulateControl(3); // backward/reverse
      if (recovery.reverseSteerDir < 0) {
        car.behavior.simulateControl(0); // left
      } else {
        car.behavior.simulateControl(1); // right
      }
      // Reverse for 1.0s then switch to align
      if (recovery.timer > 1.0) {
        recovery.phase = 'align';
        recovery.timer = 0;
      }
      return; // Skip normal AI logic during reverse
    }

    if (recovery.phase === 'align') {
      recovery.timer += dt;
      // Accelerate forward and steer toward waypoint
      car.behavior.simulateControl(2); // forward
      const angleToWP = angleTo(car.x, car.y, wp.x, wp.y);
      const diff = angleDifference(car.angle, angleToWP);
      if (diff > 0.05) {
        if (isClockwise(angleToWP, car.angle)) {
          car.behavior.simulateControl(1);
        } else {
          car.behavior.simulateControl(0);
        }
      }
      // Exit align phase after 0.8s or when mostly aligned and moving
      if (recovery.timer > 0.8 || (diff < 0.1 && speed > 30)) {
        recovery.phase = 'none';
        recovery.timer = 0;
        recovery.stuckTimer = 0;
      }
      return; // Skip normal AI logic during align
    }

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

    // Smoothly track the target angle — slow enough that AI arcs through corners
    let angleDeltaTarget = rawAngleToTarget - steerState.smoothTarget;
    if (angleDeltaTarget > Math.PI) angleDeltaTarget -= Math.PI * 2;
    if (angleDeltaTarget < -Math.PI) angleDeltaTarget += Math.PI * 2;
    steerState.smoothTarget += angleDeltaTarget * Math.min(1, 4.0 * dt);
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

    // === 8. Track boundary awareness — pull car back toward center line ===
    // Measure how far perpendicular from the waypoint center line the car is
    const nextWpIdxBound = (car.wayPoint + 1) % wpCount;
    const wpA = this.waypoints[car.wayPoint];
    const wpB = this.waypoints[nextWpIdxBound];
    const segDx = wpB.x - wpA.x;
    const segDy = wpB.y - wpA.y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    // Perpendicular distance from car to the segment line (signed: + is right of travel)
    let perpDist = 0;
    if (segLen > 1) {
      perpDist = ((car.x - wpA.x) * (-segDy / segLen) + (car.y - wpA.y) * (segDx / segLen));
    }
    const TRACK_HALF_WIDTH = 220; // safe zone — road is 260px half-width, keep margin
    const absPerpDist = Math.abs(perpDist);
    // How much the car is exceeding the safe zone (0 = inside, 1 = at road edge)
    const edgeOvershoot = Math.max(0, (absPerpDist - TRACK_HALF_WIDTH * 0.6) / (TRACK_HALF_WIDTH * 0.4));

    // === 9. Car avoidance — proactive steering to avoid ALL nearby cars ===
    const avoidAheadDist = 400;
    const avoidSideDist = 150;
    const cosAngle = Math.cos(car.angle);
    const sinAngle = Math.sin(car.angle);

    let avoidSteer = 0;
    let shouldBrakeForCar = false;
    let closestAheadDist = Infinity;

    for (const other of allCars) {
      if (other === car || other.state === 'idle') continue;

      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > avoidAheadDist + 100 || dist < 1) continue;

      const localForward = dx * cosAngle + dy * sinAngle;
      const localRight = -dx * sinAngle + dy * cosAngle;

      // --- Cars ahead: steer around them ---
      if (localForward > -30 && localForward < avoidAheadDist) {
        const closeness = 1 - Math.max(0, dist - 50) / avoidAheadDist;
        const lateralCloseness = 1 - Math.min(Math.abs(localRight) / 120, 1);

        if (Math.abs(localRight) < 80 && localForward > 0 && localForward < 250) {
          if (closeness > 0.3) {
            shouldBrakeForCar = true;
            closestAheadDist = Math.min(closestAheadDist, localForward);
          }
        }

        if (localForward > 0 && dist < avoidAheadDist) {
          const urgency = closeness * lateralCloseness;
          const steerDir = localRight > 0 ? -1 : 1;
          avoidSteer += steerDir * urgency * 0.8;
        }
      }

      // --- Cars alongside: maintain lateral clearance ---
      if (Math.abs(localForward) < 100 && Math.abs(localRight) < avoidSideDist) {
        const sideUrgency = 1 - Math.abs(localRight) / avoidSideDist;
        const steerDir = localRight > 0 ? -1 : 1;
        avoidSteer += steerDir * sideUrgency * 0.5;
      }
    }

    // Clamp avoidance steering so it doesn't fling cars off track
    avoidSteer = Math.max(-1.2, Math.min(1.2, avoidSteer));

    // Suppress avoidance that would push car further toward the track edge
    if (edgeOvershoot > 0.3) {
      // If avoidance pushes TOWARD the edge, dampen it
      const pushingOutward = (perpDist > 0 && avoidSteer > 0) || (perpDist < 0 && avoidSteer < 0);
      if (pushingOutward) {
        avoidSteer *= Math.max(0, 1 - edgeOvershoot);
      }
    }

    // Apply avoidance steering
    if (Math.abs(avoidSteer) > 0.1) {
      if (avoidSteer < 0) {
        car.behavior.simulateControl(0);
      } else {
        car.behavior.simulateControl(1);
      }
    }

    // Brake if car directly ahead is too close
    if (shouldBrakeForCar && car.behavior.speed > car.maxSpeed * 0.25) {
      if (closestAheadDist < 150) {
        car.behavior.simulateControl(3);
        car.braking = true;
      } else if (car.behavior.speed > car.maxSpeed * 0.4) {
        car.behavior.simulateControl(3);
        car.braking = true;
      }
    }

    // === 10. Track edge correction — steer back if drifting toward grass ===
    if (edgeOvershoot > 0.2) {
      // Steer back toward center: if perpDist > 0 car is right of center → steer left
      if (perpDist > 0) {
        car.behavior.simulateControl(0); // steer left
      } else {
        car.behavior.simulateControl(1); // steer right
      }
      // Strong correction near edge — override double steer
      if (edgeOvershoot > 0.7) {
        if (perpDist > 0) {
          car.behavior.simulateControl(0);
        } else {
          car.behavior.simulateControl(1);
        }
        // Slow down near edge to regain control
        if (car.behavior.speed > car.maxSpeed * 0.5) {
          car.behavior.simulateControl(3);
          car.braking = true;
        }
      }
    }

    // === 11. Defensive driving — block the player from overtaking ===
    // Only defend when car is safely on track
    if (edgeOvershoot < 0.3) {
      const player = allCars.find(c => c.isPlayer);
      if (player && player.state === 'running') {
        const pdx = player.x - car.x;
        const pdy = player.y - car.y;
        const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);

        if (playerDist < 400 && playerDist > 30) {
          const playerLocalFwd = pdx * cosAngle + pdy * sinAngle;
          const playerLocalRight = -pdx * sinAngle + pdy * cosAngle;

          if (playerLocalFwd < 80 && playerLocalFwd > -300) {
            const playerSide = playerLocalRight;
            const blockUrgency = (1 - playerDist / 400) * personality.aggression * 0.4;

            // Only block if it won't push us off-track
            if (Math.abs(playerSide) > 30 && Math.abs(playerSide) < 200) {
              // Check that blocking direction is toward center, not edge
              const blockDir = playerSide > 0 ? 1 : -1; // +1 = steer right, -1 = steer left
              const wouldPushToEdge = (perpDist > 0 && blockDir > 0) || (perpDist < 0 && blockDir < 0);
              if (!wouldPushToEdge || absPerpDist < TRACK_HALF_WIDTH * 0.4) {
                if (playerSide > 0) {
                  car.behavior.simulateControl(1);
                } else {
                  car.behavior.simulateControl(0);
                }
              }
            }

            if (Math.abs(playerSide) < 80 && playerLocalFwd < 0 && playerLocalFwd > -200) {
              if (speed < car.maxSpeed * 0.95) {
                car.behavior.simulateControl(2);
              }
            }
          }
        }
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
