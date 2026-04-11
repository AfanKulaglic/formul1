/**
 * Race Manager — Handles race state machine, checkpoint tracking, position
 * calculation, lap counting, gear system, booster system, and finish scoring.
 * 
 * Replicates the Construct 3 eGame event groups:
 *   - Start, Position, Finish, Cars > Player > Gear, Booster
 */

import { Car } from '../entities/Car';
import { TrackData, Checkpoint, Rect } from '../data/track0';
import { GEARS, BOOSTER } from '../data/gameConfig';
import { pointInRotatedRect } from './CollisionSystem';
import { distance } from '../core/math';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceState {
  phase: RacePhase;
  countdownValue: number;     // 3, 2, 1, 0 (GO!)
  countdownTimer: number;     // seconds remaining in current countdown step
  raceTime: number;           // elapsed race time in seconds
  positions: number[];        // car IDs sorted by position (first = leader)
  playerPosition: number;     // 1-based position
  playerLap: number;
  totalLaps: number;
  playerFinished: boolean;
  playerStars: number;
  playerReward: number;
  playerFinishTime: number;
}

export class RaceManager {
  private track: TrackData;
  private cars: Car[] = [];
  private state: RaceState;
  private numCars: number;

  constructor(track: TrackData) {
    this.track = track;
    this.numCars = 0;
    this.state = {
      phase: 'countdown',
      countdownValue: 3,
      countdownTimer: 1.0,
      raceTime: 0,
      positions: [],
      playerPosition: 1,
      playerLap: 1,
      totalLaps: track.laps,
      playerFinished: false,
      playerStars: 0,
      playerReward: 0,
      playerFinishTime: 0,
    };
  }

  init(cars: Car[]): void {
    this.cars = cars;
    this.numCars = cars.length;
    this.state.positions = cars.map(c => c.id);
  }

  getState(): RaceState {
    return this.state;
  }

  /** Main update — call every frame */
  update(dt: number): void {
    switch (this.state.phase) {
      case 'countdown':
        this.updateCountdown(dt);
        break;
      case 'racing':
        this.updateRacing(dt);
        break;
      case 'finished':
        // Continue running physics for other cars
        this.updatePositions();
        break;
    }
  }

  private updateCountdown(dt: number): void {
    this.state.countdownTimer -= dt;
    if (this.state.countdownTimer <= 0) {
      this.state.countdownValue--;
      if (this.state.countdownValue < 0) {
        // GO! Start the race
        this.state.phase = 'racing';
        this.state.raceTime = 0;
        for (const car of this.cars) {
          car.enable();
        }
      } else {
        this.state.countdownTimer = 1.0;
      }
    }
  }

  private updateRacing(dt: number): void {
    this.state.raceTime += dt;

    for (const car of this.cars) {
      if (car.state !== 'running' && car.state !== 'stopCar') continue;

      // Check checkpoint overlaps
      this.checkCheckpoints(car);

      // Check finish line
      this.checkFinishLine(car);

      // Check boosters
      this.checkBoosters(car);

      // Update gear (player only, but also for display)
      if (car.isPlayer) {
        this.updateGear(car);
      }
    }

    // Update positions
    this.updatePositions();

    // Update state for HUD
    const player = this.cars.find(c => c.isPlayer);
    if (player) {
      this.state.playerPosition = this.getCarPosition(player.id);
      this.state.playerLap = Math.min(player.curLap + 1, this.track.laps);
    }
  }

  private checkCheckpoints(car: Car): void {
    const nextCP = car.curCP;
    if (nextCP >= this.track.checkpoints.length) return;

    const cp = this.track.checkpoints[nextCP];
    if (pointInRotatedRect(car.x, car.y, cp, 60)) {
      car.curCP = (nextCP + 1) % this.track.checkpoints.length;
      car.totalCP++;
    }
  }

  private checkFinishLine(car: Car): void {
    if (car.state !== 'running') return;
    if (!pointInRotatedRect(car.x, car.y, this.track.finishLine, 60)) return;

    // Must have passed all checkpoints for this lap
    const cpPerLap = this.track.checkpoints.length;
    const expectedCP = (car.curLap + 1) * cpPerLap;
    if (car.totalCP < expectedCP - 1) return; // Haven't completed the lap

    car.curLap++;
    car.curCP = 0;

    if (car.curLap >= this.track.laps) {
      // Car has finished the race!
      car.state = 'finish';
      car.finishTime = this.state.raceTime;
      car.endPos = this.getFinishPosition();

      if (car.isPlayer) {
        this.onPlayerFinish(car);
      }

      // Transition to stopCar after a brief moment
      setTimeout(() => {
        if (car.state === 'finish') {
          car.state = 'stopCar';
        }
      }, 500);
    }
  }

  private checkBoosters(car: Car): void {
    if (car.booster) return; // Already boosted

    for (const booster of this.track.boosters) {
      if (pointInRotatedRect(car.x, car.y, booster, 30)) {
        car.activateBooster(BOOSTER.duration, BOOSTER.speedMultiplier, BOOSTER.decelOverride);
        break;
      }
    }
  }

  /**
   * Gear system — matches the Construct 3 gear groups exactly.
   * Changes deceleration based on current speed ratio.
   */
  private updateGear(car: Car): void {
    if (car.booster) return; // Don't change gear during boost

    const speedRatio = car.behavior.speed / car.maxSpeed;
    let newGear = 0;

    for (let i = GEARS.length - 1; i >= 1; i--) {
      if (speedRatio >= GEARS[i].speedThreshold) {
        newGear = i;
        break;
      }
    }

    if (newGear !== car.gear) {
      car.setGear(newGear, GEARS[newGear].decel);
    }
  }

  /**
   * Position calculation — from the Position event group.
   * Position = 80% checkpoint distance + 5% lap progress (approximate).
   */
  private updatePositions(): void {
    // Calculate progress for each car
    for (const car of this.cars) {
      const lapProg = car.curLap / this.track.laps;
      const cpProg = car.totalCP / (this.track.checkpoints.length * this.track.laps);

      // Distance to next checkpoint for fine-grained ordering
      let cpDist = 0;
      if (car.curCP < this.track.checkpoints.length) {
        const cp = this.track.checkpoints[car.curCP];
        cpDist = 1 - (distance(car.x, car.y, cp.x, cp.y) / 5000); // Normalize
        cpDist = Math.max(0, Math.min(1, cpDist));
      }

      car.progress = lapProg * 0.05 + cpProg * 0.80 + cpDist * 0.15;

      // Finished cars always ranked by finish time
      if (car.state === 'finish' || car.state === 'stopCar') {
        car.progress = 10 + (1 / (car.finishTime || 999));
      }
    }

    // Sort by progress (highest first)
    this.state.positions = [...this.cars]
      .sort((a, b) => b.progress - a.progress)
      .map(c => c.id);
  }

  private getCarPosition(carId: number): number {
    const idx = this.state.positions.indexOf(carId);
    return idx >= 0 ? idx + 1 : this.numCars;
  }

  private getFinishPosition(): number {
    let finished = 0;
    for (const car of this.cars) {
      if (car.state === 'finish' || car.state === 'stopCar') {
        finished++;
      }
    }
    return finished; // 1-based
  }

  private onPlayerFinish(car: Car): void {
    this.state.playerFinished = true;
    this.state.playerFinishTime = car.finishTime;
    this.state.phase = 'finished';

    // Calculate stars (from GAME_MECHANICS_EXACT.md section 14)
    const pos = car.endPos;
    if (pos === 1) this.state.playerStars = 3;
    else if (pos === 2) this.state.playerStars = 2;
    else if (pos === 3) this.state.playerStars = 1;
    else this.state.playerStars = 0;

    // Calculate reward
    const baseReward = [10000, 6000, 4000, 1000];
    const rewardIndex = Math.min(pos - 1, 3);
    const trackMultiplier = 1 + (0 * 0.1); // Track 0 multiplier
    let reward = baseReward[rewardIndex] * trackMultiplier;
    reward = Math.round(reward / 500) * 500; // Round to nearest 500
    this.state.playerReward = reward;
  }
}
