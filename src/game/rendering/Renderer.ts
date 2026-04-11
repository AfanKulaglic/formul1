/**
 * Game Renderer — Canvas 2D rendering for the racing game.
 * Renders track, cars, and HUD in the correct layer order.
 * 
 * Layer order (matching Construct 3):
 *   0: track (with camera transform)
 *   1: cars  (with camera transform)  
 *   2: gui   (screen-fixed HUD)
 *   3-6: overlays (screen-fixed)
 */

import { Camera } from '../core/Camera';
import { InputManager } from '../core/InputManager';
import { Car } from '../entities/Car';
import { TrackData, Rect } from '../data/track0';
import { RaceState } from '../systems/RaceManager';
import { TEAMS } from '../data/gameConfig';

const COLORS = {
  grass: '#2b8a3e',
  grassDark: '#237032',
  road: '#3c3c3c',
  roadEdge: '#2d2d2d',
  roadLine: 'rgba(255,255,255,0.7)',
  blueCurb: '#2266cc',
  curbRed: '#cc2222',
  curbWhite: '#eeeeee',
  startGrid: '#484848',
  fenceRed: '#cc1111',
  fenceWhite: '#eeeeee',
  booster: '#00cccc',
  boosterGlow: 'rgba(0,204,204,0.25)',
  bridge: '#667788',
  bridgeDark: '#445566',
  grandstandBase: '#556677',
  building: '#667788',
  buildingDark: '#4a5a6a',
  treeDark: '#1a6b2e',
  treeLight: '#2d9544',
  palmLeaf: '#1f7a2e',
  pitRoad: '#484848',
  carShadow: 'rgba(0,0,0,0.35)',
  hudBg: 'rgba(0,0,0,0.75)',
  hudText: '#ffffff',
  hudAccent: '#ffcc00',
};

const STAND_COLORS = ['#cc3333','#3366cc','#33aa55','#cc9933','#8833cc','#cc3366','#33aacc','#669933','#cc6633'];

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private input: InputManager | null = null;
  private sponsorImages: HTMLImageElement[] = [];
  private sponsorImagesLoaded = false;
  private sponsorOnFormulaImg: HTMLImageElement | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = camera;
    this.loadSponsorImages();
  }

  private loadSponsorImages(): void {
    const paths = [
      '/sponsors/BANNERfORMULA.jpg',
      '/sponsors/BANNERfORMULA1.jpg',
      '/sponsors/BANNERfORMULA2.jpg',
      '/sponsors/BANNERfORMULA3.jpg',
    ];
    let loaded = 0;
    for (const src of paths) {
      const img = new Image();
      img.src = src;
      img.onload = () => { loaded++; if (loaded === paths.length) this.sponsorImagesLoaded = true; };
      this.sponsorImages.push(img);
    }
    // Load sponsor image for formula cars
    const formulaSponsor = new Image();
    formulaSponsor.src = '/sponsors/sponsorOnFormula.png';
    formulaSponsor.onload = () => { this.sponsorOnFormulaImg = formulaSponsor; };
  }

  /** Set the input manager so the renderer can draw mobile controls */
  setInputManager(input: InputManager): void {
    this.input = input;
  }

  /** Main render call — draws everything for one frame */
  render(track: TrackData, cars: Car[], raceState: RaceState): void {
    const { ctx } = this;
    const { canvasWidth: cw, canvasHeight: ch } = this.camera;

    // Update tread animation phase
    const now = performance.now();
    if (this.lastTreadTime > 0) {
      const dt = (now - this.lastTreadTime) / 1000;
      // Find the fastest car speed to drive animation (each wheel uses its own car's ratio)
      // Phase accumulates globally — the per-wheel speedRatio scales the visual
      this.treadPhase += dt * 400; // base scroll speed in world units/s
    }
    this.lastTreadTime = now;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, cw, ch);

    // === WORLD SPACE (camera transform) ===
    ctx.save();
    this.camera.applyTransform(ctx);

    const bounds = this.camera.getVisibleBounds();
    this.renderTrack(track, bounds);
    this.renderCars(cars);
    this.renderBridges(track);

    ctx.restore();

    // === SCREEN SPACE (HUD) ===
    this.renderHUD(raceState, cars, cw, ch, track);

    // Mobile touch controls
    if (this.input?.isMobile) {
      this.renderMobileControls(cw, ch, cars);
    }

    // Countdown overlay
    if (raceState.phase === 'countdown') {
      this.renderCountdown(raceState, cw, ch);
    }

    // Finish overlay
    if (raceState.playerFinished) {
      this.renderFinishScreen(raceState, cw, ch);
    }
  }

  // ==================== TRACK RENDERING ====================

  private renderTrack(track: TrackData, bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const { ctx } = this;

    // --- Grass background ---
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, track.width, track.height);

    // Subtle grass checker pattern
    ctx.fillStyle = COLORS.grassDark;
    ctx.globalAlpha = 0.12;
    const step = 400;
    const gx0 = Math.max(0, Math.floor(bounds.minX / step) * step);
    const gy0 = Math.max(0, Math.floor(bounds.minY / step) * step);
    for (let gx = gx0; gx < Math.min(bounds.maxX, track.width); gx += step) {
      for (let gy = gy0; gy < Math.min(bounds.maxY, track.height); gy += step) {
        if ((Math.floor(gx / step) + Math.floor(gy / step)) % 2 === 0) {
          ctx.fillRect(gx, gy, step, step);
        }
      }
    }
    ctx.globalAlpha = 1;

    // --- Vegetation ---
    for (const tree of track.trees) this.drawTreeArea(tree);
    for (const palm of track.palms) this.drawPalmArea(palm);

    // --- Trackside structures ---
    for (let i = 0; i < track.grandstands.length; i++) this.drawGrandstand(track.grandstands[i], i);
    for (const bld of track.buildings) this.drawBuilding(bld);

    // --- Pit lane --- (not rendered — invisible separator, collision only)
    // if (track.pitLane) this.drawRotatedRect(track.pitLane, COLORS.pitRoad);
    // for (const pm of track.pitMarks) this.drawRotatedRect(pm, '#dddd22');

    // --- Pit stop complex ---
    if (track.pitStop) this.drawPitStop(track);

    // --- Road surface as continuous waypoint path ---
    this.drawRoadSurface(track);

    // --- Starting grid (grid lines only, no gray fill) ---
    // this.drawRotatedRect(track.trackStart, COLORS.startGrid);
    this.drawStartGridLines(track);

    // --- Boosters ---
    for (const booster of track.boosters) this.drawBooster(booster);

    // --- Finish line ---
    this.drawFinishLine(track.finishLine);

    // --- Fences (barriers) ---
    for (let i = 0; i < track.fences.length; i++) this.drawFence(track.fences[i], i);

    // --- FORMULA banners ---
    this.drawFormulaBanners();
  }

  /** Draw the road as a thick continuous path along all waypoints */
  private drawRoadSurface(track: TrackData): void {
    const { ctx } = this;
    const wps = track.waypoints;
    if (wps.length < 2) return;

    const roadWidth = 520;

    // Build the waypoint path as a smooth closed loop using Catmull-Rom splines
    const buildPath = () => {
      ctx.beginPath();
      const n = wps.length;
      // Generate smooth points via Catmull-Rom
      const subs = 6;
      let first = true;
      for (let i = 0; i < n; i++) {
        const p0 = wps[(i - 1 + n) % n];
        const p1 = wps[i];
        const p2 = wps[(i + 1) % n];
        const p3 = wps[(i + 2) % n];
        for (let s = 0; s < subs; s++) {
          const t = s / subs;
          const t2 = t * t, t3 = t2 * t;
          const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
          const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.closePath();
    };

    // --- Gravel runoff strip ---
    ctx.save();
    ctx.lineWidth = roadWidth + 80;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#8a7d5a';
    ctx.globalAlpha = 0.18;
    buildPath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // --- Solid white edge line (outer) ---
    ctx.save();
    ctx.lineWidth = roadWidth + 16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#dddddd';
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- Blue edge trim ---
    ctx.save();
    ctx.lineWidth = roadWidth + 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.blueCurb;
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- Dark road edge ---
    ctx.save();
    ctx.lineWidth = roadWidth + 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.roadEdge;
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- Main road surface ---
    ctx.save();
    ctx.lineWidth = roadWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.road;
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- White edge lines (thin inner) ---
    ctx.save();
    ctx.lineWidth = roadWidth - 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    buildPath();
    ctx.stroke();
    ctx.lineWidth = roadWidth - 14;
    ctx.strokeStyle = COLORS.road;
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- Subtle road texture (darker inner strip for 2-lane feel) ---
    ctx.save();
    ctx.lineWidth = roadWidth * 0.48;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    buildPath();
    ctx.stroke();
    ctx.restore();

    // --- Helper: build a smoothly offset path from waypoints ---
    const buildOffsetPoints = (offset: number): { x: number; y: number }[] => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < wps.length; i++) {
        const prev = wps[(i - 1 + wps.length) % wps.length];
        const next = wps[(i + 1) % wps.length];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        pts.push({ x: wps[i].x + nx * offset, y: wps[i].y + ny * offset });
      }
      return pts;
    };

    // Interpolate points between waypoint-based points for smoother curves
    const interpolatePoints = (pts: { x: number; y: number }[], subdivisions: number): { x: number; y: number }[] => {
      const result: { x: number; y: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[(i - 1 + pts.length) % pts.length];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p3 = pts[(i + 2) % pts.length];
        for (let s = 0; s < subdivisions; s++) {
          const t = s / subdivisions;
          // Catmull-Rom spline
          const t2 = t * t;
          const t3 = t2 * t;
          const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
          const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
          result.push({ x, y });
        }
      }
      return result;
    };

    const buildSmoothOffsetPath = (pts: { x: number; y: number }[]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
    };

    // --- Lane dashed markings (skip the start/finish straight) ---
    const laneOffsets = [-90, 90];

    // Define start grid zone to skip lane lines
    const gridMinY = 4350;
    const gridMaxY = 5650;
    const gridMinX = 1100;
    const gridMaxX = 1800;

    const isInStartZone = (p: { x: number; y: number }) =>
      p.x >= gridMinX && p.x <= gridMaxX && p.y >= gridMinY && p.y <= gridMaxY;

    for (const offset of laneOffsets) {
      const rawPts = buildOffsetPoints(offset);
      const smoothPts = interpolatePoints(rawPts, 10);

      // Break path into segments that skip the start zone
      ctx.save();
      ctx.lineWidth = 5;
      ctx.strokeStyle = COLORS.roadLine;
      ctx.setLineDash([140, 100]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let inSegment = false;
      ctx.beginPath();
      for (let i = 0; i < smoothPts.length; i++) {
        const p = smoothPts[i];
        if (isInStartZone(p)) {
          // End current segment, start fresh after the gap
          if (inSegment) {
            ctx.stroke();
            ctx.beginPath();
            inSegment = false;
          }
        } else {
          if (!inSegment) {
            ctx.moveTo(p.x, p.y);
            inSegment = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
      }
      if (inSegment) ctx.stroke();

      ctx.setLineDash([]);
      ctx.restore();
    }

    // --- Braking zone markers at AI brake zones ---
    this.drawBrakingZones(track);

    // --- Red-white kerb strips on curves ---
    this.drawCurveKerbs(track, buildOffsetPoints, interpolatePoints);
  }

  /** Draw red-white alternating kerb strips on curve sections using smooth offset paths */
  private drawCurveKerbs(
    track: TrackData,
    buildOffsetPoints: (offset: number) => { x: number; y: number }[],
    interpolatePoints: (pts: { x: number; y: number }[], sub: number) => { x: number; y: number }[]
  ): void {
    const { ctx } = this;
    const wps = track.waypoints;
    if (wps.length < 3) return;

    const roadHalf = 260;
    const kerbW = 24;

    // Compute curvature at each waypoint
    const curvatures: number[] = [];
    for (let i = 0; i < wps.length; i++) {
      const prev = wps[(i - 1 + wps.length) % wps.length];
      const curr = wps[i];
      const next = wps[(i + 1) % wps.length];
      const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
      const a1 = Math.atan2(dy1, dx1);
      const a2 = Math.atan2(dy2, dx2);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      curvatures.push(diff);
    }

    // Only big curves — threshold raised significantly
    const threshold = 0.12;

    // Find contiguous curve regions (groups of consecutive curve waypoints)
    const curveRegions: { start: number; end: number }[] = [];
    let inCurve = false;
    let regionStart = 0;
    for (let i = 0; i < wps.length; i++) {
      if (Math.abs(curvatures[i]) >= threshold) {
        if (!inCurve) {
          regionStart = Math.max(0, i - 1); // extend 1 waypoint before
          inCurve = true;
        }
      } else {
        if (inCurve) {
          curveRegions.push({ start: regionStart, end: Math.min(wps.length - 1, i + 1) });
          inCurve = false;
        }
      }
    }
    if (inCurve) {
      curveRegions.push({ start: regionStart, end: wps.length - 1 });
    }

    if (curveRegions.length === 0) return;

    // For each curve region, draw kerbs on both sides
    for (const region of curveRegions) {
      for (const side of [-1, 1]) {
        const edgeDist = (roadHalf + kerbW / 2 + 2) * side;

        // Build smooth offset points just for this region
        const regionPts: { x: number; y: number }[] = [];
        for (let i = region.start; i <= region.end; i++) {
          const prev = wps[(i - 1 + wps.length) % wps.length];
          const next = wps[(i + 1) % wps.length];
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          regionPts.push({
            x: wps[i].x + nx * edgeDist,
            y: wps[i].y + ny * edgeDist,
          });
        }

        if (regionPts.length < 2) continue;

        // Interpolate for smoothness using Catmull-Rom
        const smooth: { x: number; y: number }[] = [];
        const subs = 8;
        for (let i = 0; i < regionPts.length - 1; i++) {
          const p0 = regionPts[Math.max(0, i - 1)];
          const p1 = regionPts[i];
          const p2 = regionPts[Math.min(regionPts.length - 1, i + 1)];
          const p3 = regionPts[Math.min(regionPts.length - 1, i + 2)];
          for (let s = 0; s < subs; s++) {
            const t = s / subs;
            const t2 = t * t, t3 = t2 * t;
            smooth.push({
              x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
              y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            });
          }
        }
        smooth.push(regionPts[regionPts.length - 1]);

        if (smooth.length < 2) continue;

        // Draw as two overlapping stroked paths: red base, then white dashed on top
        const buildKerbPath = () => {
          ctx.beginPath();
          ctx.moveTo(smooth[0].x, smooth[0].y);
          for (let i = 1; i < smooth.length; i++) {
            ctx.lineTo(smooth[i].x, smooth[i].y);
          }
        };

        // Red base layer
        ctx.save();
        ctx.lineWidth = kerbW;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = COLORS.curbRed;
        buildKerbPath();
        ctx.stroke();
        ctx.restore();

        // White dashed layer on top
        ctx.save();
        ctx.lineWidth = kerbW;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = COLORS.curbWhite;
        ctx.setLineDash([30, 30]);
        buildKerbPath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Thin dark border lines for definition
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        // Outer edge
        const outerPts: { x: number; y: number }[] = [];
        const innerPts: { x: number; y: number }[] = [];
        for (let i = 0; i < smooth.length; i++) {
          const prev = smooth[Math.max(0, i - 1)];
          const next = smooth[Math.min(smooth.length - 1, i + 1)];
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len * (kerbW / 2);
          const ny = dx / len * (kerbW / 2);
          outerPts.push({ x: smooth[i].x + nx, y: smooth[i].y + ny });
          innerPts.push({ x: smooth[i].x - nx, y: smooth[i].y - ny });
        }
        ctx.beginPath();
        ctx.moveTo(outerPts[0].x, outerPts[0].y);
        for (let i = 1; i < outerPts.length; i++) ctx.lineTo(outerPts[i].x, outerPts[i].y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(innerPts[0].x, innerPts[0].y);
        for (let i = 1; i < innerPts.length; i++) ctx.lineTo(innerPts[i].x, innerPts[i].y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** Draw hatched braking zone markers before corners */
  private drawBrakingZones(track: TrackData): void {
    const { ctx } = this;
    if (!track.brakeAIZones) return;

    for (const zone of track.brakeAIZones) {
      ctx.save();
      ctx.translate(zone.x, zone.y);
      ctx.rotate(zone.angle);
      const zoneW = Math.abs(zone.w);
      // Draw a series of horizontal white dashes (100m board style)
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      const dashCount = 4;
      const dashH = 8;
      const gap = 50;
      for (let d = 0; d < dashCount; d++) {
        const dx = -zoneW / 2 + d * (zoneW / dashCount);
        ctx.fillRect(dx, -dashH, zoneW / dashCount - 10, dashH * 2);
      }
      ctx.restore();
    }
  }

  private drawRotatedRect(rect: Rect, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    ctx.fillStyle = color;
    ctx.fillRect(-Math.abs(rect.w) / 2, -Math.abs(rect.h) / 2, Math.abs(rect.w), Math.abs(rect.h));
    ctx.restore();
  }

  private drawCurbStripe(stripe: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(stripe.x, stripe.y);
    ctx.rotate(stripe.angle);
    const w = Math.abs(stripe.w);
    const h = Math.abs(stripe.h);

    // Red-white alternating kerb blocks
    const blockSize = Math.max(h, 25);
    const numBlocks = Math.max(2, Math.ceil(w / blockSize));
    const bw = w / numBlocks;
    for (let i = 0; i < numBlocks; i++) {
      ctx.fillStyle = i % 2 === 0 ? COLORS.curbRed : COLORS.curbWhite;
      ctx.fillRect(-w / 2 + i * bw, -h / 2, bw, h);
    }
    ctx.restore();
  }

  private drawStartGridLines(track: TrackData): void {
    const { ctx } = this;
    const bw = 70;   // box half-width
    const bh = 45;   // box half-height

    for (const cell of track.startCells) {
      ctx.save();
      ctx.translate(cell.x, cell.y);
      ctx.rotate(cell.angle);

      // U-shaped bracket: two side walls + back wall, open at front (top)
      // Side walls
      ctx.strokeStyle = '#c0c0c0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Left wall: from front-left down to back-left
      ctx.moveTo(-bw, -bh);
      ctx.lineTo(-bw, bh);
      // Back wall: across the bottom
      ctx.lineTo(bw, bh);
      // Right wall: from back-right up to front-right
      ctx.lineTo(bw, -bh);
      ctx.stroke();

      // Orange/yellow bar at the back of the box
      ctx.fillStyle = '#e8a820';
      ctx.fillRect(-bw + 4, bh - 8, (bw - 4) * 2, 8);

      // Subtle shadow inside the bracket
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(-bw + 3, -bh, (bw - 3) * 2, bh * 2);

      ctx.restore();
    }
  }

  // 4 sponsor ad fallback colors (used while images load)
  private static readonly FENCE_AD_COLORS: string[] = ['#1a6b34','#ffffff','#ffffff','#ffffff'];

  private drawFence(fence: Rect, index: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(fence.x, fence.y);
    ctx.rotate(fence.angle);
    const w = Math.abs(fence.w);
    const h = Math.abs(fence.h);

    // Split height: top half = gray Armco barrier, bottom half = ad panels
    const barrierH = h * 0.5;
    const adH = h * 0.5;
    const barrierY = -h / 2;
    const adY = -h / 2 + barrierH;

    // ===== GRAY ARMCO BARRIER (track side) =====
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(-w / 2, barrierY, w, barrierH);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(-w / 2, barrierY, w, barrierH * 0.2);

    // Horizontal rails
    ctx.strokeStyle = '#8a8e96';
    ctx.lineWidth = 1.5;
    for (let r = 1; r < 3; r++) {
      const ry = barrierY + (barrierH / 3) * r;
      ctx.beginPath(); ctx.moveTo(-w / 2, ry); ctx.lineTo(w / 2, ry); ctx.stroke();
    }

    // Vertical posts
    const postSpacing = Math.max(40, Math.min(60, w / Math.max(4, Math.floor(w / 50))));
    ctx.fillStyle = '#9a9ea8';
    ctx.strokeStyle = '#7a7e86';
    ctx.lineWidth = 1;
    for (let px = -w / 2 + postSpacing; px < w / 2; px += postSpacing) {
      ctx.fillRect(px - 2.5, barrierY + 1, 5, barrierH - 2);
      ctx.strokeRect(px - 2.5, barrierY + 1, 5, barrierH - 2);
    }

    // Barrier edges
    ctx.fillStyle = '#6a6e76';
    ctx.fillRect(-w / 2, barrierY, w, 1.5);
    ctx.fillRect(-w / 2, barrierY + barrierH - 1.5, w, 1.5);

    // ===== SPONSOR IMAGE PANELS =====
    const imgIdx = index % 4;
    const img = this.sponsorImages[imgIdx];
    const imgReady = this.sponsorImagesLoaded && img && img.complete && img.naturalWidth > 0;

    // Background fill
    ctx.fillStyle = Renderer.FENCE_AD_COLORS[imgIdx];
    ctx.fillRect(-w / 2, adY, w, adH);

    // Tile the sponsor image across the ad strip
    // Each tile keeps the image aspect ratio, fitting to adH height
    if (imgReady) {
      const tileH = adH;
      const tileW = (img.naturalWidth / img.naturalHeight) * tileH;
      for (let tx = -w / 2; tx < w / 2; tx += tileW) {
        const drawW = Math.min(tileW, w / 2 - tx);
        ctx.drawImage(img, 0, 0, (drawW / tileW) * img.naturalWidth, img.naturalHeight, tx, adY, drawW, tileH);
      }
    }

    // Segment dividers for visual separation
    const segW = Math.max(60, Math.min(120, w / Math.max(3, Math.floor(w / 90))));
    const numSegs = Math.max(2, Math.ceil(w / segW));
    const actualSegW = w / numSegs;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let s = 1; s < numSegs; s++) {
      ctx.fillRect(-w / 2 + s * actualSegW - 0.5, adY, 1, adH);
    }

    // Ad panel edges
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-w / 2, adY, w, 1);
    ctx.fillRect(-w / 2, adY + adH - 1, w, 1);

    ctx.restore();
  }

  private drawBooster(booster: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(booster.x, booster.y);
    ctx.rotate(booster.angle);

    // Glow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = COLORS.boosterGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 65, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Cyan double chevrons
    ctx.strokeStyle = COLORS.booster;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Front chevron
    ctx.beginPath();
    ctx.moveTo(-22, 12);
    ctx.lineTo(0, -18);
    ctx.lineTo(22, 12);
    ctx.stroke();

    // Rear chevron
    ctx.beginPath();
    ctx.moveTo(-22, 32);
    ctx.lineTo(0, 2);
    ctx.lineTo(22, 32);
    ctx.stroke();

    ctx.restore();
  }

  private drawFinishLine(fl: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(fl.x, fl.y);
    ctx.rotate(fl.angle);
    const w = Math.abs(fl.w);
    const h = Math.abs(fl.h);

    // Dark background strip behind the checkers
    ctx.fillStyle = '#222';
    ctx.fillRect(-w / 2, -h / 2 - 4, w, h + 8);

    // Checkerboard pattern — 3 rows for finer detail
    const rows = 3;
    const cellH = h / rows;
    const cellW = cellH;  // square cells
    const numCols = Math.ceil(w / cellW);
    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < rows; row++) {
        ctx.fillStyle = (col + row) % 2 === 0 ? '#ffffff' : '#111111';
        const cx = -w / 2 + col * cellW;
        const cw = Math.min(cellW, w / 2 - col * cellW + w / 2);
        ctx.fillRect(cx, -h / 2 + row * cellH, cw, cellH);
      }
    }

    // Inner border for crispness
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // Orange accent lines at top and bottom edges (matching grid box bars)
    ctx.fillStyle = '#e8a820';
    ctx.fillRect(-w / 2, -h / 2 - 4, w, 4);
    ctx.fillRect(-w / 2, h / 2, w, 4);

    ctx.restore();
  }

  // === DECORATION METHODS ===

  private renderBridges(track: TrackData): void {
    for (const bridge of track.bridges) this.drawBridge(bridge);
  }

  private drawBridge(rect: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16);

    // Bridge deck
    ctx.fillStyle = COLORS.bridge;
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // Side rails
    const railH = Math.max(h * 0.22, 10);
    ctx.fillStyle = COLORS.bridgeDark;
    ctx.fillRect(-w / 2, -h / 2, w, railH);
    ctx.fillRect(-w / 2, h / 2 - railH, w, railH);

    // Cross-bracing
    ctx.strokeStyle = '#8899aa';
    ctx.lineWidth = 2;
    const segs = Math.max(4, Math.floor(w / 100));
    const segW = w / segs;
    for (let i = 0; i < segs; i++) {
      const sx = -w / 2 + i * segW;
      ctx.beginPath();
      ctx.moveTo(sx, -h / 2);
      ctx.lineTo(sx + segW, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + segW, -h / 2);
      ctx.lineTo(sx, h / 2);
      ctx.stroke();
    }

    // Vertical posts
    ctx.fillStyle = COLORS.bridgeDark;
    for (let i = 0; i <= segs; i++) {
      const px = -w / 2 + i * segW;
      ctx.fillRect(px - 3, -h / 2, 6, h);
    }

    // Rivets
    ctx.fillStyle = '#99aabb';
    for (let i = 0; i <= segs; i++) {
      const px = -w / 2 + i * segW;
      ctx.beginPath();
      ctx.arc(px, -h / 2 + railH / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, h / 2 - railH / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Draw the complete pit stop complex with garages, pit lane road, pit wall, and entry/exit roads */
  private drawPitStop(track: TrackData): void {
    const { ctx } = this;
    const pit = track.pitStop!;
    const gb = pit.garageBuilding;
    const entry = pit.pitEntry;
    const exit = pit.pitExit;

    // === 1. PIT ENTRY ROAD — curves from main track to pit lane ===
    // Draw road surface connecting main track to pit lane entry
    const entryRoadWidth = 280;
    ctx.save();
    // Gravel edge
    ctx.lineWidth = entryRoadWidth + 40;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#8a7d5a';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(entry.x1, entry.y1);
    ctx.quadraticCurveTo(entry.x1, entry.y2, entry.x2, entry.y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // White edge
    ctx.lineWidth = entryRoadWidth + 16;
    ctx.strokeStyle = '#dddddd';
    ctx.beginPath();
    ctx.moveTo(entry.x1, entry.y1);
    ctx.quadraticCurveTo(entry.x1, entry.y2, entry.x2, entry.y2);
    ctx.stroke();
    // Blue trim
    ctx.lineWidth = entryRoadWidth + 10;
    ctx.strokeStyle = COLORS.blueCurb;
    ctx.beginPath();
    ctx.moveTo(entry.x1, entry.y1);
    ctx.quadraticCurveTo(entry.x1, entry.y2, entry.x2, entry.y2);
    ctx.stroke();
    // Dark edge
    ctx.lineWidth = entryRoadWidth + 4;
    ctx.strokeStyle = COLORS.roadEdge;
    ctx.beginPath();
    ctx.moveTo(entry.x1, entry.y1);
    ctx.quadraticCurveTo(entry.x1, entry.y2, entry.x2, entry.y2);
    ctx.stroke();
    // Road surface
    ctx.lineWidth = entryRoadWidth;
    ctx.strokeStyle = COLORS.road;
    ctx.beginPath();
    ctx.moveTo(entry.x1, entry.y1);
    ctx.quadraticCurveTo(entry.x1, entry.y2, entry.x2, entry.y2);
    ctx.stroke();
    ctx.restore();

    // === 2. PIT EXIT ROAD — curves from pit lane back to main track ===
    ctx.save();
    ctx.lineWidth = entryRoadWidth + 40;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#8a7d5a';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(exit.x2, exit.y2);
    ctx.quadraticCurveTo(exit.x2, exit.y1, exit.x1, exit.y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = entryRoadWidth + 16;
    ctx.strokeStyle = '#dddddd';
    ctx.beginPath();
    ctx.moveTo(exit.x2, exit.y2);
    ctx.quadraticCurveTo(exit.x2, exit.y1, exit.x1, exit.y1);
    ctx.stroke();
    ctx.lineWidth = entryRoadWidth + 10;
    ctx.strokeStyle = COLORS.blueCurb;
    ctx.beginPath();
    ctx.moveTo(exit.x2, exit.y2);
    ctx.quadraticCurveTo(exit.x2, exit.y1, exit.x1, exit.y1);
    ctx.stroke();
    ctx.lineWidth = entryRoadWidth + 4;
    ctx.strokeStyle = COLORS.roadEdge;
    ctx.beginPath();
    ctx.moveTo(exit.x2, exit.y2);
    ctx.quadraticCurveTo(exit.x2, exit.y1, exit.x1, exit.y1);
    ctx.stroke();
    ctx.lineWidth = entryRoadWidth;
    ctx.strokeStyle = COLORS.road;
    ctx.beginPath();
    ctx.moveTo(exit.x2, exit.y2);
    ctx.quadraticCurveTo(exit.x2, exit.y1, exit.x1, exit.y1);
    ctx.stroke();
    ctx.restore();

    // === 3. PIT LANE ROAD SURFACE — same styling as main road ===
    const pitLane = track.pitLane!;
    ctx.save();
    ctx.translate(pitLane.x, pitLane.y);
    ctx.rotate(pitLane.angle);
    const plW = Math.abs(pitLane.w);
    const plH = Math.abs(pitLane.h);
    const pitR = 30; // corner radius for smooth edges
    // Gravel runoff
    ctx.fillStyle = '#8a7d5a';
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.roundRect(-plW / 2 - 20, -plH / 2 - 20, plW + 40, plH + 40, pitR + 10); ctx.fill();
    ctx.globalAlpha = 1;
    // White edge
    ctx.fillStyle = '#dddddd';
    ctx.beginPath(); ctx.roundRect(-plW / 2 - 8, -plH / 2 - 8, plW + 16, plH + 16, pitR + 4); ctx.fill();
    // Blue trim
    ctx.fillStyle = COLORS.blueCurb;
    ctx.beginPath(); ctx.roundRect(-plW / 2 - 5, -plH / 2 - 5, plW + 10, plH + 10, pitR + 2); ctx.fill();
    // Dark edge
    ctx.fillStyle = COLORS.roadEdge;
    ctx.beginPath(); ctx.roundRect(-plW / 2 - 2, -plH / 2 - 2, plW + 4, plH + 4, pitR); ctx.fill();
    // Road surface
    ctx.fillStyle = COLORS.road;
    ctx.beginPath(); ctx.roundRect(-plW / 2, -plH / 2, plW, plH, pitR); ctx.fill();

    // Pit speed limit line white dashes down center
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([40, 40]);
    ctx.beginPath();
    ctx.moveTo(-plW / 2, 0);
    ctx.lineTo(plW / 2, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // === 4. PIT WALL — concrete barrier separating pit lane from track ===
    // Wall runs along the left (track) side of the pit lane
    const wallX = pitLane.x - 190; // Left side of pit lane (between pit and track)
    const wallTop = Math.min(entry.y2, exit.y1);  // Top of wall
    const wallBot = Math.max(entry.y2, exit.y1);  // Bottom of wall
    const wallW = 22;
    ctx.save();
    // Concrete base
    ctx.fillStyle = '#8a8a8a';
    ctx.beginPath(); ctx.roundRect(wallX - wallW / 2, wallTop, wallW, wallBot - wallTop, 8); ctx.fill();
    // Top surface (lighter)
    ctx.fillStyle = '#aaaaaa';
    ctx.beginPath(); ctx.roundRect(wallX - wallW / 2, wallTop, wallW, wallBot - wallTop, 8); ctx.fill();
    // Vertical line detail
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    const segH = 60;
    for (let wy = wallTop; wy < wallBot; wy += segH) {
      ctx.beginPath();
      ctx.moveTo(wallX - wallW / 2, wy);
      ctx.lineTo(wallX + wallW / 2, wy);
      ctx.stroke();
    }
    // Dark edge lines
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wallX - wallW / 2, wallTop);
    ctx.lineTo(wallX - wallW / 2, wallBot);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wallX + wallW / 2, wallTop);
    ctx.lineTo(wallX + wallW / 2, wallBot);
    ctx.stroke();
    ctx.restore();

    // === 5. GARAGE BUILDING — large building behind pit boxes ===
    ctx.save();
    ctx.translate(gb.x, gb.y);
    ctx.rotate(gb.angle);
    const gbW = Math.abs(gb.w);
    const gbH = Math.abs(gb.h);

    // Building shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.roundRect(-gbW / 2 + 8, -gbH / 2 + 8, gbW, gbH, 12); ctx.fill();

    // Main structure — dark concrete
    ctx.fillStyle = '#505560';
    ctx.beginPath(); ctx.roundRect(-gbW / 2, -gbH / 2, gbW, gbH, 12); ctx.fill();

    // Roof overhang on pit side (right edge)
    ctx.fillStyle = '#3d4048';
    ctx.beginPath(); ctx.roundRect(-gbW / 2, -gbH / 2, gbW, gbH * 0.08, [12, 12, 0, 0]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-gbW / 2, gbH / 2 - gbH * 0.05, gbW, gbH * 0.05, [0, 0, 12, 12]); ctx.fill();

    // Building border
    ctx.strokeStyle = '#3a3e45';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-gbW / 2, -gbH / 2, gbW, gbH, 12); ctx.stroke();
    ctx.restore();

    // === 6. INDIVIDUAL PIT BOXES — team garages with roll-up doors ===
    const teamColors = ['#cc3333', '#3366cc', '#33aa55', '#cc9933', '#8833cc',
                         '#cc3366', '#33aacc', '#669933', '#cc6633', '#ff6600'];

    for (let i = 0; i < pit.pitBoxes.length; i++) {
      const box = pit.pitBoxes[i];
      const bx = box.x;
      const by = box.y;
      const bw = box.w;
      const bh = box.h;
      const color = teamColors[i % teamColors.length];

      ctx.save();

      // Garage floor — lighter concrete
      ctx.fillStyle = '#5a5e68';
      ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 8); ctx.fill();

      // Roll-up door opening (darker inside)
      ctx.fillStyle = '#2a2d32';
      ctx.beginPath(); ctx.roundRect(bx - bw / 2 + 8, by - bh / 2 + 5, bw - 16, bh * 0.45, 6); ctx.fill();

      // Team color stripe above door
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - bh / 2, bw, 12, [8, 8, 0, 0]); ctx.fill();

      // Team number
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, bx, by + bh * 0.15);

      // Pit box border lines between boxes
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 8); ctx.stroke();

      // Pit box markings on the pit lane — white painted rectangle
      const markX = bx - bw / 2 - 120;
      const markW = 120;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(markX, by - bh / 2 + 15, markW, bh - 30, 6); ctx.stroke();

      // Small colored dot for the team's position marker
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(markX + markW / 2, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }

    // === 7. PIT LANE MARKINGS — speed limit lines and text ===
    // "PIT IN" painted at entry
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(entry.x2, entry.y2 + 40);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('PIT IN', 0, 0);
    ctx.restore();

    // "PIT OUT" painted at exit
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(exit.x1, exit.y1 - 40);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('PIT OUT', 0, 0);
    ctx.restore();

    // Pit lane speed limit dashes along sides
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 30]);
    // Right side marking (away from track)
    ctx.beginPath();
    ctx.moveTo(pitLane.x + 120, wallTop + 80);
    ctx.lineTo(pitLane.x + 120, wallBot - 80);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // === 8. TRAFFIC LIGHTS — at pit exit ===
    const tlX = exit.x1 - 30;
    const tlY = exit.y1 - 20;
    ctx.save();
    // Light post
    ctx.fillStyle = '#333';
    ctx.fillRect(tlX - 4, tlY - 80, 8, 80);
    // Light housing
    ctx.fillStyle = '#222';
    ctx.fillRect(tlX - 16, tlY - 90, 32, 55);
    // Red light
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    ctx.arc(tlX, tlY - 75, 8, 0, Math.PI * 2);
    ctx.fill();
    // Green light
    ctx.fillStyle = '#00cc00';
    ctx.beginPath();
    ctx.arc(tlX, tlY - 55, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // === 9. EQUIPMENT DETAILS — tire stacks, air lines ===
    for (let i = 0; i < pit.pitBoxes.length; i++) {
      const box = pit.pitBoxes[i];
      const bx = box.x;
      const by = box.y;
      const bw = box.w;

      // Tire stacks (right side of each box — away from track)
      ctx.fillStyle = '#1a1a1a';
      for (let t = 0; t < 2; t++) {
        const tx = bx + bw / 2 - 18 - t * 22;
        const ty = by + 45;
        ctx.beginPath();
        ctx.arc(tx, ty, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Air line hose (thin dark line from garage to pit box mark)
      ctx.strokeStyle = 'rgba(80,80,80,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + bw / 2 - 30, by - 30);
      ctx.lineTo(bx - bw / 2 - 60, by - 20);
      ctx.stroke();
    }
  }

  private drawTreeArea(rect: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);

    // Dark base
    ctx.fillStyle = COLORS.treeDark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1;

    // Tree crowns
    const spacing = 55;
    const cols = Math.max(1, Math.floor(w / spacing));
    const rows = Math.max(1, Math.floor(h / spacing));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const tx = -w / 2 + spacing / 2 + c * (w / cols);
        const ty = -h / 2 + spacing / 2 + r * (h / rows);
        const radius = 18 + ((c * 7 + r * 13) % 13);
        ctx.fillStyle = (c + r) % 3 === 0 ? COLORS.treeDark : COLORS.treeLight;
        ctx.beginPath();
        ctx.arc(tx, ty, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPalmArea(rect: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);

    const spacing = 75;
    const cols = Math.max(1, Math.floor(w / spacing));
    const rows = Math.max(1, Math.floor(h / spacing));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const tx = -w / 2 + spacing / 2 + c * (w / cols);
        const ty = -h / 2 + spacing / 2 + r * (h / rows);
        // Trunk
        ctx.fillStyle = '#8B7355';
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fill();
        // Leaves
        ctx.fillStyle = COLORS.palmLeaf;
        const leafR = 22 + ((c * 5 + r * 11) % 10);
        ctx.beginPath();
        ctx.arc(tx, ty - 3, leafR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawGrandstand(rect: Rect, index: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);

    // Layout: "top" of rect (-h/2) = back of stand (roof side)
    //         "bottom" (+h/2) = front / track side
    const rowH = 38;                       // depth per seating row
    const rowCount = Math.max(3, Math.floor(h / rowH));
    const actualRowH = h / rowCount;
    const personBodyR = 12;                // body/shirt circle radius
    const personHeadR = 6.5;               // head circle radius
    const seatSpacing = 28;                // lateral spacing between people
    const roofFraction = 0.42;             // roof covers back 42% of stand depth

    // Bright shirt colors matching the reference image
    const shirtColors = [
      '#e83060', '#00bbcc', '#88cc00', '#ff8800', '#cc44cc',
      '#3388dd', '#ffcc00', '#ffffff', '#bbbbbb', '#ff4488',
      '#44bb66', '#6644cc', '#ff5533', '#00aaff', '#dd6699',
    ];

    // ===== 1. DROP SHADOW =====
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-w / 2 + 10, -h / 2 + 10, w, h);

    // ===== 2. CONCRETE TIERED BASE =====
    // Overall base slab
    ctx.fillStyle = '#8a8e94';
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // Alternating tier strips (lighter/darker gray rows)
    for (let r = 0; r < rowCount; r++) {
      const ry = -h / 2 + r * actualRowH;
      ctx.fillStyle = r % 2 === 0 ? '#9a9ea6' : '#8a8e94';
      ctx.fillRect(-w / 2, ry, w, actualRowH);
      // Step edge line between tiers
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w / 2, ry + actualRowH);
      ctx.lineTo(w / 2, ry + actualRowH);
      ctx.stroke();
    }

    // ===== 3. SPECTATORS — large vivid people =====
    for (let r = 0; r < rowCount; r++) {
      const cy = -h / 2 + r * actualRowH + actualRowH * 0.55;
      // Under-roof shadow: back rows are darker
      const underRoof = (r / rowCount) < roofFraction;
      const shadowAlpha = underRoof ? 0.78 : 1.0;

      for (let px = -w / 2 + seatSpacing * 0.5; px < w / 2 - seatSpacing * 0.2; px += seatSpacing) {
        // Skip ~5-10% of seats randomly for realism
        const hash = Math.sin(px * 0.41 + r * 5.7 + index * 11.3);
        if (hash < -0.82) continue;

        // Slight random jitter for natural crowd look
        const jx = Math.sin(px * 0.67 + r * 3.1 + index * 7.9) * 3.5;
        const jy = Math.sin(px * 0.83 + r * 4.7 + index * 5.3) * 2.5;
        const x = px + jx;
        const y = cy + jy;

        // --- Body / shirt (large colored circle) ---
        const shirtIdx = Math.abs(Math.floor(px * 0.09 + r * 2.7 + index * 4.3)) % shirtColors.length;
        ctx.fillStyle = shirtColors[shirtIdx];
        ctx.globalAlpha = shadowAlpha * 0.85;
        ctx.beginPath();
        ctx.arc(x, y + 2, personBodyR, 0, Math.PI * 2);
        ctx.fill();

        // Body highlight (3D roundness)
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(x - 3, y - 1, personBodyR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // --- Head (smaller dark circle, offset toward top) ---
        const headShade = Math.sin(px * 0.19 + r * 6.1 + index * 3) > 0.0 ? '#3a2518' : '#1a1008';
        ctx.fillStyle = headShade;
        ctx.globalAlpha = shadowAlpha * 0.9;
        ctx.beginPath();
        ctx.arc(x, y - personBodyR * 0.5, personHeadR, 0, Math.PI * 2);
        ctx.fill();

        // Head highlight
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(x - 1.5, y - personBodyR * 0.5 - 2, personHeadR * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // ===== 4. ROOF / CANOPY (covers back portion) =====
    const roofH = h * roofFraction;
    const roofOverhang = 18;
    // Main roof surface — blue-gray steel
    ctx.fillStyle = '#4e6080';
    ctx.fillRect(-w / 2 - roofOverhang, -h / 2 - 6, w + roofOverhang * 2, roofH + 6);
    // Horizontal slat/panel lines on roof
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    const slatSpacing = 12;
    for (let sy = -h / 2 - 4; sy < -h / 2 + roofH; sy += slatSpacing) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 - roofOverhang, sy);
      ctx.lineTo(w / 2 + roofOverhang, sy);
      ctx.stroke();
    }
    // Lighter slat highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let sy = -h / 2 - 4 + slatSpacing / 2; sy < -h / 2 + roofH; sy += slatSpacing) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 - roofOverhang, sy);
      ctx.lineTo(w / 2 + roofOverhang, sy);
      ctx.stroke();
    }
    // Roof front edge (shadow line where roof ends)
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-w / 2 - roofOverhang, -h / 2 + roofH - 2, w + roofOverhang * 2, 5);

    // ===== 5. THIN BORDER =====
    ctx.strokeStyle = '#3a3e44';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    ctx.restore();
  }

  private drawBuilding(rect: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);

    // Body
    ctx.fillStyle = COLORS.building;
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // Roof
    ctx.fillStyle = COLORS.buildingDark;
    ctx.fillRect(-w / 2, -h / 2, w, h * 0.12);

    // Windows
    ctx.fillStyle = '#9ab';
    const winSize = 16;
    const gapX = 38;
    const gapY = 38;
    const winCols = Math.max(1, Math.floor((w - 16) / gapX));
    const winRows = Math.max(1, Math.floor((h * 0.8 - 10) / gapY));
    for (let c = 0; c < winCols; c++) {
      for (let r = 0; r < winRows; r++) {
        const wx = -w / 2 + 12 + c * gapX;
        const wy = -h / 2 + h * 0.18 + r * gapY;
        ctx.fillRect(wx, wy, winSize, winSize);
      }
    }

    // Border
    ctx.strokeStyle = '#445';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private drawFormulaBanners(): void {
    const { ctx } = this;
    const positions = [
      { x: 800, y: 6500, angle: 4.7124 },
      { x: 2000, y: 7600, angle: 0 },
      { x: 6000, y: 11300, angle: 3.1416 },
      { x: 4000, y: 550, angle: 0 },
      { x: 7600, y: 4500, angle: 3.1416 },
    ];
    ctx.save();
    ctx.font = 'bold 120px sans-serif';
    ctx.fillStyle = '#cc4411';
    ctx.globalAlpha = 0.4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of positions) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillText('FORMULA', 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ==================== CAR RENDERING ====================

  private renderCars(cars: Car[]): void {
    const { ctx } = this;

    // Sort by Y position for proper layering (further cars drawn first)
    const sorted = [...cars].sort((a, b) => a.y - b.y);

    for (const car of sorted) {
      this.drawCar(car);
    }
  }

  private drawCar(car: Car): void {
    const { ctx } = this;
    const w = car.width;   // 142
    const h = car.height;  // 76

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    const sx = w / 142;
    const sy = h / 76;
    const teamName = (TEAMS[car.teamIndex] || TEAMS[0]).name.toUpperCase();
    const dark = this.darkenColor(car.color, 0.4);
    const mid = this.darkenColor(car.color, 0.65);

    // ===== SHADOW =====
    ctx.save();
    ctx.translate(5 * sx, 7 * sy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.drawF1Silhouette(sx, sy);
    ctx.restore();

    // ===== TIRE TREAD ANIMATION =====
    // speedRatio drives tread scroll speed (0 = stopped, 1 = max speed)
    const speedRatio = car.maxSpeed > 0 ? Math.abs(car.speed) / car.maxSpeed : 0;

    // ===== SUSPENSION SWAY OFFSET =====
    // When rapid left/right tapping occurs, wheels shift laterally
    const sway = car.suspensionSway;  // -1 to 1
    const swayPx = sway * 8 * sy;   // max ±8px lateral shift

    // ===== REAR WHEELS (bigger/wider than front) =====
    this.drawWheel(ctx, -52 * sx, -46 * sy + swayPx, 30 * sx, 18 * sy, sx, sy, true, speedRatio);
    this.drawWheel(ctx, -52 * sx,  28 * sy + swayPx, 30 * sx, 18 * sy, sx, sy, true, speedRatio);

    // ===== FRONT WHEELS (narrower, rotate with steering) =====
    const steerAngle = car.smoothSteer * 0.35; // ~20 degrees max, smoothed for AI visibility
    // Front-left wheel
    {
      const cx = 54 * sx, cy = -37 * sy + swayPx; // wheel center
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(steerAngle);
      this.drawWheel(ctx, -12 * sx, -9 * sy, 24 * sx, 18 * sy, sx, sy, false, speedRatio);
      ctx.restore();
    }
    // Front-right wheel
    {
      const cx = 54 * sx, cy = 37 * sy + swayPx;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(steerAngle);
      this.drawWheel(ctx, -12 * sx, -9 * sy, 24 * sx, 18 * sy, sx, sy, false, speedRatio);
      ctx.restore();
    }

    // ===== SUSPENSION ARMS =====
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3.5 * sx;
    // Front — V-wishbones from body to wheels (wheels shift with sway)
    ctx.beginPath(); ctx.moveTo(52 * sx, -6 * sy); ctx.lineTo(54 * sx, -30 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(60 * sx, -5 * sy); ctx.lineTo(54 * sx, -30 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52 * sx,  6 * sy); ctx.lineTo(54 * sx,  30 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(60 * sx,  5 * sy); ctx.lineTo(54 * sx,  30 * sy + swayPx); ctx.stroke();
    // Rear — V-wishbones from body to wheels (wheels shift with sway)
    ctx.beginPath(); ctx.moveTo(-24 * sx, -20 * sy); ctx.lineTo(-37 * sx, -28 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-38 * sx, -18 * sy); ctx.lineTo(-37 * sx, -28 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-24 * sx,  20 * sy); ctx.lineTo(-37 * sx,  28 * sy + swayPx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-38 * sx,  18 * sy); ctx.lineTo(-37 * sx,  28 * sy + swayPx); ctx.stroke();

    // ===== BODY — wide chunky shape =====
    // Entire body filled with team color (no visible dark base)
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(-44 * sx, -20 * sy);
    ctx.lineTo(-30 * sx, -24 * sy);
    ctx.lineTo(-5 * sx, -28 * sy);
    ctx.lineTo(15 * sx, -24 * sy);
    ctx.lineTo(32 * sx, -16 * sy);
    ctx.lineTo(46 * sx, -7 * sy);
    ctx.lineTo(56 * sx, 0);
    ctx.lineTo(46 * sx, 7 * sy);
    ctx.lineTo(32 * sx, 16 * sy);
    ctx.lineTo(15 * sx, 24 * sy);
    ctx.lineTo(-5 * sx, 28 * sy);
    ctx.lineTo(-30 * sx, 24 * sy);
    ctx.lineTo(-44 * sx, 20 * sy);
    ctx.closePath();
    ctx.fill();
    // Bold body outline
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3 * sx;
    ctx.stroke();

    // Dark team-color accent stripe down center (darker shade of team color, NOT black)
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(-42 * sx, -4 * sy);
    ctx.lineTo(20 * sx, -3 * sy);
    ctx.lineTo(48 * sx, -1.5 * sy);
    ctx.lineTo(48 * sx, 1.5 * sy);
    ctx.lineTo(20 * sx, 3 * sy);
    ctx.lineTo(-42 * sx, 4 * sy);
    ctx.closePath();
    ctx.fill();

    // ===== SIDEPODS (wide, prominent, 3D shading) =====
    // Left sidepod — slightly darker shade for depth
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(-18 * sx, -28 * sy);
    ctx.lineTo(24 * sx, -32 * sy);
    ctx.lineTo(30 * sx, -26 * sy);
    ctx.lineTo(30 * sx, -20 * sy);
    ctx.lineTo(-18 * sx, -20 * sy);
    ctx.closePath();
    ctx.fill();
    // Sidepod top surface (team color)
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(-16 * sx, -27 * sy);
    ctx.lineTo(22 * sx, -31 * sy);
    ctx.lineTo(28 * sx, -26 * sy);
    ctx.lineTo(-14 * sx, -21 * sy);
    ctx.closePath();
    ctx.fill();
    // Air inlet
    ctx.fillStyle = dark;
    ctx.fillRect(24 * sx, -31 * sy, 6 * sx, 8 * sy);

    // Right sidepod
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(-18 * sx, 28 * sy);
    ctx.lineTo(24 * sx, 32 * sy);
    ctx.lineTo(30 * sx, 26 * sy);
    ctx.lineTo(30 * sx, 20 * sy);
    ctx.lineTo(-18 * sx, 20 * sy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(-16 * sx, 27 * sy);
    ctx.lineTo(22 * sx, 31 * sy);
    ctx.lineTo(28 * sx, 26 * sy);
    ctx.lineTo(-14 * sx, 21 * sy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(24 * sx, 22 * sy, 6 * sx, 8 * sy);

    // Sponsor image on sidepods (horizontal)
    if (this.sponsorOnFormulaImg) {
      const imgW = 20 * sx;
      const imgH = 8 * sy;
      // Left sidepod
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.sponsorOnFormulaImg, 4 * sx - imgW / 2, -24 * sy - imgH / 2, imgW, imgH);
      ctx.restore();
      // Right sidepod
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.sponsorOnFormulaImg, 4 * sx - imgW / 2, 24 * sy - imgH / 2, imgW, imgH);
      ctx.restore();
    }

    // ===== AERO VANES / BARGEBOARDS (3 filled fins per side) =====
    ctx.fillStyle = car.color;
    for (let v = 0; v < 3; v++) {
      const vx = 30 * sx + v * 5 * sx;
      // Left fin
      ctx.beginPath();
      ctx.moveTo(vx + 2 * sx, -18 * sy);
      ctx.lineTo(vx, -18 * sy);
      ctx.quadraticCurveTo(vx - 4 * sx, -22 * sy, vx - 5 * sx, -28 * sy);
      ctx.lineTo(vx - 3 * sx, -28 * sy);
      ctx.quadraticCurveTo(vx - 2 * sx, -22 * sy, vx + 2 * sx, -18 * sy);
      ctx.closePath();
      ctx.fill();
      // Right fin
      ctx.beginPath();
      ctx.moveTo(vx + 2 * sx, 18 * sy);
      ctx.lineTo(vx, 18 * sy);
      ctx.quadraticCurveTo(vx - 4 * sx, 22 * sy, vx - 5 * sx, 28 * sy);
      ctx.lineTo(vx - 3 * sx, 28 * sy);
      ctx.quadraticCurveTo(vx - 2 * sx, 22 * sy, vx + 2 * sx, 18 * sy);
      ctx.closePath();
      ctx.fill();
    }

    // ===== COCKPIT (small tight opening) =====
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(5 * sx, 0, 7 * sx, 5.5 * sy, 0, 0, Math.PI * 2);
    ctx.fill();

    // ===== HALO (prominent titanium structure) =====
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 5 * sx;
    ctx.beginPath();
    ctx.moveTo(14 * sx, -7 * sy);
    ctx.quadraticCurveTo(22 * sx, 0, 14 * sx, 7 * sy);
    ctx.stroke();
    // Halo arms
    ctx.lineWidth = 3.5 * sx;
    ctx.beginPath(); ctx.moveTo(14 * sx, -7 * sy); ctx.lineTo(-4 * sx, -6 * sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14 * sx,  7 * sy); ctx.lineTo(-4 * sx,  6 * sy); ctx.stroke();

    // ===== HELMET (white, like in the original image) =====
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5 * sx, 0, 5.5 * sy, 0, Math.PI * 2);
    ctx.fill();
    // Team color stripe
    ctx.fillStyle = car.color;
    ctx.fillRect(3 * sx, -1.2 * sy, 5 * sx, 2.4 * sy);
    // Visor
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(7 * sx, 0, 3.2 * sy, -0.6, 0.6);
    ctx.lineTo(5 * sx, 0);
    ctx.closePath();
    ctx.fill();

    // ===== AIRBOX (small intake above driver) =====
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(12 * sx, -3 * sy);
    ctx.lineTo(16 * sx, -2.5 * sy);
    ctx.lineTo(16 * sx,  2.5 * sy);
    ctx.lineTo(12 * sx,  3 * sy);
    ctx.lineTo(10 * sx,  1.5 * sy);
    ctx.lineTo(10 * sx, -1.5 * sy);
    ctx.closePath();
    ctx.fill();
    // T-cam
    ctx.fillStyle = car.isPlayer ? '#ffcc00' : dark;
    ctx.fillRect(15 * sx, -1.5 * sy, 3 * sx, 3 * sy);

    // ===== MIRRORS =====
    ctx.fillStyle = car.color;
    ctx.beginPath(); ctx.ellipse(22 * sx, -27 * sy, 3 * sx, 1.5 * sy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(22 * sx,  27 * sy, 3 * sx, 1.5 * sy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * sx;
    ctx.beginPath(); ctx.ellipse(22 * sx, -27 * sy, 3 * sx, 1.5 * sy, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(22 * sx,  27 * sy, 3 * sx, 1.5 * sy, 0, 0, Math.PI * 2); ctx.stroke();

    // ===== FRONT WING (wide, multi-element — positioned AHEAD of front wheels) =====
    // Main plane
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(72 * sx, -40 * sy);
    ctx.lineTo(80 * sx, -40 * sy);
    ctx.lineTo(84 * sx, -6 * sy);
    ctx.lineTo(84 * sx,  6 * sy);
    ctx.lineTo(80 * sx,  40 * sy);
    ctx.lineTo(72 * sx,  40 * sy);
    ctx.lineTo(68 * sx,  6 * sy);
    ctx.lineTo(68 * sx, -6 * sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2 * sx;
    ctx.stroke();
    // Flap (darker second element)
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(67 * sx, -38 * sy);
    ctx.lineTo(71 * sx, -38 * sy);
    ctx.lineTo(67 * sx, -6 * sy);
    ctx.lineTo(67 * sx,  6 * sy);
    ctx.lineTo(71 * sx,  38 * sy);
    ctx.lineTo(67 * sx,  38 * sy);
    ctx.closePath();
    ctx.fill();
    // Endplates
    ctx.fillStyle = car.color;
    ctx.fillRect(66 * sx, -44 * sy, 18 * sx, 5 * sy);
    ctx.fillRect(66 * sx,  39 * sy, 18 * sx, 5 * sy);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5 * sx;
    ctx.strokeRect(66 * sx, -44 * sy, 18 * sx, 5 * sy);
    ctx.strokeRect(66 * sx,  39 * sy, 18 * sx, 5 * sy);
    // White accent stripe on endplates
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(68 * sx, -43.5 * sy, 14 * sx, 1.2 * sy);
    ctx.fillRect(68 * sx,  42.5 * sy, 14 * sx, 1.2 * sy);
    ctx.globalAlpha = 1;
    // Nose cone
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(84 * sx, -5 * sy);
    ctx.quadraticCurveTo(92 * sx, 0, 84 * sx, 5 * sy);
    ctx.closePath();
    ctx.fill();
    // Nose column connecting body to front wing
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.moveTo(52 * sx, -7 * sy);
    ctx.lineTo(84 * sx, -5 * sy);
    ctx.lineTo(84 * sx, 5 * sy);
    ctx.lineTo(52 * sx, 7 * sy);
    ctx.closePath();
    ctx.fill();
    // Nose camera dot
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(88 * sx, 0, 1.5 * sy, 0, Math.PI * 2);
    ctx.fill();

    // ===== REAR WING (tall, prominent, team-colored) =====
    // Main plane — darker team color
    ctx.fillStyle = mid;
    ctx.fillRect(-62 * sx, -34 * sy, 16 * sx, 68 * sy);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2 * sx;
    ctx.strokeRect(-62 * sx, -34 * sy, 16 * sx, 68 * sy);
    // DRS flap — same dark team shade
    ctx.fillStyle = dark;
    ctx.fillRect(-66 * sx, -32 * sy, 5 * sx, 64 * sy);
    // Endplates — team color
    ctx.fillStyle = car.color;
    ctx.fillRect(-68 * sx, -38 * sy, 24 * sx, 5 * sy);
    ctx.fillRect(-68 * sx,  33 * sy, 24 * sx, 5 * sy);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5 * sx;
    ctx.strokeRect(-68 * sx, -38 * sy, 24 * sx, 5 * sy);
    ctx.strokeRect(-68 * sx,  33 * sy, 24 * sx, 5 * sy);
    // Sponsor image on rear wing (vertical, fills main plane)
    if (this.sponsorOnFormulaImg) {
      const rImgW = 72 * sy;
      const rImgH = 18 * sx;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(-54 * sx, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(this.sponsorOnFormulaImg, -rImgW / 2, -rImgH / 2, rImgW, rImgH);
      ctx.restore();
    }

    // ===== REAR LIGHT =====
    ctx.fillStyle = '#cc0000';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(-65 * sx, -5 * sy, 3 * sx, 10 * sy, 1.5 * sx);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ===== DIFFUSER =====
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(-48 * sx, -18 * sy);
    ctx.lineTo(-42 * sx, -16 * sy);
    ctx.lineTo(-42 * sx,  16 * sy);
    ctx.lineTo(-48 * sx,  18 * sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mid;
    ctx.lineWidth = 0.7 * sx;
    for (let d = -4; d <= 4; d++) {
      ctx.beginPath();
      ctx.moveTo(-48 * sx, d * 4 * sy);
      ctx.lineTo(-42 * sx, d * 3.5 * sy);
      ctx.stroke();
    }

    // ===== EXHAUST =====
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(-44 * sx, -4 * sy, 2.5 * sy, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-44 * sx,  4 * sy, 2.5 * sy, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cc5500';
    ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(-44 * sx, -4 * sy, 1.2 * sy, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-44 * sx,  4 * sy, 1.2 * sy, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // ===== NUMBER ON NOSE =====
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${12 * sx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${car.id + 1}`, 42 * sx, 0);

    // ===== SUBTLE BODY LINES =====
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1.2 * sx;
    ctx.beginPath(); ctx.moveTo(-35 * sx, -17 * sy); ctx.lineTo(30 * sx, -12 * sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-35 * sx,  17 * sy); ctx.lineTo(30 * sx,  12 * sy); ctx.stroke();
    ctx.globalAlpha = 1;

    // ===== BODY SHINE =====
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.moveTo(-30 * sx, -16 * sy);
    ctx.lineTo(34 * sx, -8 * sy);
    ctx.lineTo(34 * sx, -4 * sy);
    ctx.lineTo(-30 * sx, -10 * sy);
    ctx.closePath();
    ctx.fill();

    // ===== PLAYER INDICATOR =====
    if (car.isPlayer) {
      ctx.fillStyle = '#ffcc00';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(100 * sx, 0);
      ctx.lineTo(92 * sx, -6 * sy);
      ctx.lineTo(92 * sx,  6 * sy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ===== GRASS SPRAY =====
    if (car.onGrass && Math.abs(car.behavior.speed) > 50) {
      const t = Date.now();
      ctx.fillStyle = '#3a9a3a';
      for (let p = 0; p < 8; p++) {
        const px = -35 * sx + Math.sin(t / 60 + p * 1.7) * 30 * sx;
        const py = Math.cos(t / 80 + p * 2.3) * 35 * sy;
        const r = 2 + (p % 3);
        ctx.globalAlpha = 0.25 + Math.sin(t / 40 + p) * 0.12;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ===== BOOSTER FLAME =====
    if (car.booster) {
      ctx.fillStyle = '#00cccc';
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 50) * 0.3;
      ctx.beginPath();
      ctx.moveTo(-62 * sx, -10 * sy);
      ctx.lineTo(-88 * sx, 0);
      ctx.lineTo(-62 * sx,  10 * sy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#88ffff';
      ctx.beginPath();
      ctx.moveTo(-62 * sx, -5 * sy);
      ctx.lineTo(-78 * sx, 0);
      ctx.lineTo(-62 * sx,  5 * sy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // Persistent tread phase accumulator (animates across frames)
  private treadPhase = 0;
  private lastTreadTime = 0;

  /** Draw a single wheel — top-down view with animated scrolling tread */
  private drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sx: number, sy: number, isRear: boolean, speedRatio: number): void {
    const r = 3 * sx; // corner radius

    // Tire rubber base
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Clip tread drawing to the tire shape
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.clip();

    // Animated tread block pattern — bold diagonal blocks that scroll with speed
    const blockW = isRear ? (w / 4.5) : (w / 3.5);  // wider blocks
    const phase = this.treadPhase * speedRatio;
    const offset = phase % blockW;

    // Alternating dark/light tread blocks for strong contrast
    const totalBlocks = Math.ceil(w / blockW) + 3;
    const slant = h * 0.4; // diagonal slant amount

    for (let g = -2; g < totalBlocks; g++) {
      const bx = x + g * blockW + offset;

      // Every other block is a lighter rubber shade — creates visible tread pattern
      if (g % 2 === 0) {
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath();
        ctx.moveTo(bx, y);
        ctx.lineTo(bx + slant, y + h);
        ctx.lineTo(bx + blockW * 0.5 + slant, y + h);
        ctx.lineTo(bx + blockW * 0.5, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Bold groove lines between blocks
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2 * sx;
    for (let g = -2; g < totalBlocks; g++) {
      const bx = x + g * blockW + offset;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.lineTo(bx + slant, y + h);
      ctx.stroke();
    }

    // Center longitudinal groove — always visible
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();

    // At high speed, add motion blur overlay
    if (speedRatio > 0.5) {
      const blurAlpha = (speedRatio - 0.5) * 0.4; // 0 to ~0.2
      ctx.fillStyle = `rgba(40,40,40,${blurAlpha})`;
      ctx.fillRect(x, y, w, h);
    }

    ctx.restore(); // un-clip

    // Sidewall edge highlights
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  /** Utility to darken a hex color */
  private darkenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }

  /** F1 car full silhouette for shadow */
  private drawF1Silhouette(sx: number, sy: number): void {
    const { ctx } = this;
    // Body shadow
    ctx.beginPath();
    ctx.moveTo(-46 * sx, -20 * sy);
    ctx.lineTo(-32 * sx, -24 * sy);
    ctx.lineTo(-5 * sx, -28 * sy);
    ctx.lineTo(18 * sx, -24 * sy);
    ctx.lineTo(38 * sx, -10 * sy);
    ctx.lineTo(54 * sx, -4 * sy);
    ctx.lineTo(88 * sx, 0);
    ctx.lineTo(54 * sx, 4 * sy);
    ctx.lineTo(38 * sx, 10 * sy);
    ctx.lineTo(18 * sx, 24 * sy);
    ctx.lineTo(-5 * sx, 28 * sy);
    ctx.lineTo(-32 * sx, 24 * sy);
    ctx.lineTo(-46 * sx, 20 * sy);
    ctx.closePath();
    ctx.fill();
    // Wing shadows
    ctx.fillRect(66 * sx, -44 * sy, 18 * sx, 88 * sy);
    ctx.fillRect(-68 * sx, -38 * sy, 24 * sx, 76 * sy);
    // Wheel shadows
    ctx.fillRect(42 * sx, -44 * sy, 24 * sx, 14 * sy);
    ctx.fillRect(42 * sx, 30 * sy, 24 * sx, 14 * sy);
    ctx.fillRect(-52 * sx, -46 * sy, 30 * sx, 18 * sy);
    ctx.fillRect(-52 * sx, 28 * sy, 30 * sx, 18 * sy);
  }

  // ==================== HUD RENDERING ====================

  private renderHUD(state: RaceState, cars: Car[], cw: number, ch: number, track: TrackData): void {
    const { ctx } = this;
    const player = cars.find(c => c.isPlayer);
    if (!player) return;

    const scale = cw / 1080; // Scale HUD to fit canvas width

    // --- Speed display (bottom-left) — hidden on mobile (shown in mobile controls) ---
    const speed = Math.round(Math.abs(player.behavior.speed));
    if (!this.input?.isMobile) {
    ctx.save();
    ctx.font = `bold ${64 * scale}px monospace`;
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Speed background
    ctx.fillStyle = COLORS.hudBg;
    this.drawRoundRect(20 * scale, ch - 130 * scale, 280 * scale, 110 * scale, 12 * scale);

    ctx.fillStyle = COLORS.hudText;
    ctx.font = `bold ${56 * scale}px monospace`;
    ctx.fillText(`${speed}`, 35 * scale, ch - 55 * scale);
    ctx.font = `${22 * scale}px monospace`;
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('KMH', 35 * scale + ctx.measureText(`${speed}`).width + 8 * scale, ch - 60 * scale);

    // Gear
    const gearText = player.gear === 0 ? 'N' : `${player.gear}`;
    ctx.font = `bold ${40 * scale}px monospace`;
    ctx.fillStyle = COLORS.hudAccent;
    ctx.fillText(gearText, 220 * scale, ch - 55 * scale);
    ctx.restore();

    // --- Gear bar (speed ratio visual) ---
    const barWidth = 260 * scale;
    const barHeight = 8 * scale;
    const barX = 30 * scale;
    const barY = ch - 135 * scale;
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const ratio = Math.abs(player.behavior.speed) / player.maxSpeed;
    ctx.fillStyle = ratio > 0.9 ? '#ff4444' : ratio > 0.7 ? COLORS.hudAccent : '#44cc44';
    ctx.fillRect(barX, barY, barWidth * Math.min(ratio, 1), barHeight);
    }

    // --- Top HUD bar (glassmorphic, consistent with bottom controls) ---
    const topBarH = 64 * scale;
    const topBarY = 14 * scale;
    const topBarR = 16 * scale;
    const topPad = 14 * scale;

    // Helper: draw a glassmorphic panel
    const drawGlassPanel = (px: number, py: number, pw: number, ph: number, pr: number) => {
      const grad = ctx.createLinearGradient(px, py, px, py + ph);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.40)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, pr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, pr);
      ctx.stroke();
    };

    // --- Position display (top-left) ---
    const posW = 120 * scale;
    ctx.save();
    drawGlassPanel(topPad, topBarY, posW, topBarH, topBarR);

    // Position number
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${34 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const posCenterX = topPad + posW / 2;
    const posCenterY = topBarY + topBarH / 2;
    const posText = `${state.playerPosition}`;
    const posNumW = ctx.measureText(posText).width;
    ctx.fillText(posText, posCenterX - 10 * scale, posCenterY);

    // "/total" suffix
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `${18 * scale}px sans-serif`;
    ctx.fillText(`/${this.getCarCount(cars)}`, posCenterX + posNumW / 2 + 4 * scale, posCenterY + 2 * scale);
    ctx.restore();

    // --- Race time (top-center) ---
    const timeW = 140 * scale;
    const timeX = cw / 2 - timeW / 2;
    ctx.save();
    drawGlassPanel(timeX, topBarY, timeW, topBarH, topBarR);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${24 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.formatTime(state.raceTime), cw / 2, topBarY + topBarH / 2);
    ctx.restore();

    // --- Lap display (left of minimap) ---
    const lapW = 90 * scale;
    const minimapSize = 150 * scale;
    const minimapX = cw - topPad - minimapSize;
    const lapX = minimapX - lapW - 8 * scale;
    ctx.save();
    drawGlassPanel(lapX, topBarY, lapW, topBarH, topBarR);

    // "LAP" label
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `${14 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('LAP', lapX + lapW / 2, topBarY + 8 * scale);

    // Lap count
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${26 * scale}px monospace`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${state.playerLap}/${state.totalLaps}`, lapX + lapW / 2, topBarY + topBarH - 6 * scale);
    ctx.restore();

    // --- Minimap (top-right, glassmorphic) ---
    const mmX = minimapX;
    const mmY = topBarY;
    const mmW = minimapSize;
    const mmH = minimapSize;
    const mmR = topBarR;

    ctx.save();
    drawGlassPanel(mmX, mmY, mmW, mmH, mmR);

    // Clip to minimap panel
    ctx.beginPath();
    ctx.roundRect(mmX + 2, mmY + 2, mmW - 4, mmH - 4, mmR - 1);
    ctx.clip();

    // Map waypoints to minimap coordinates
    const wps = track.waypoints;
    const mapW = track.width;
    const mapH = track.height;
    const mmPad = 12 * scale;
    const drawW = mmW - mmPad * 2;
    const drawH = mmH - mmPad * 2;
    const mapScale = Math.min(drawW / mapW, drawH / mapH);
    const offsetX = mmX + mmPad + (drawW - mapW * mapScale) / 2;
    const offsetY = mmY + mmPad + (drawH - mapH * mapScale) / 2;

    // Draw track outline from waypoints
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < wps.length; i++) {
      const sx = offsetX + wps[i].x * mapScale;
      const sy = offsetY + wps[i].y * mapScale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw AI cars as small dots
    for (const car of cars) {
      if (car.isPlayer) continue;
      const cx = offsetX + car.x * mapScale;
      const cy = offsetY + car.y * mapScale;
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw player car as larger bright dot with glow
    if (player) {
      const px = offsetX + player.x * mapScale;
      const py = offsetY + player.y * mapScale;

      // Glow
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur = 8 * scale;
      ctx.fillStyle = '#00ccff';
      ctx.beginPath();
      ctx.arc(px, py, 4.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // White center
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // --- Drift indicator ---
    if (player.driftAngle > 0.2) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 170, 0, 0.5)';
      ctx.font = `bold ${28 * scale}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('DRIFT!', cw / 2, ch - 180 * scale);
      ctx.restore();
    }

    // --- Booster indicator ---
    if (player.booster) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 204, 204, ${0.6 + Math.sin(Date.now() / 100) * 0.3})`;
      ctx.font = `bold ${32 * scale}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('⚡ BOOST ⚡', cw / 2, ch - 220 * scale);
      ctx.restore();
    }
  }

  // ==================== MOBILE CONTROLS ====================

  private renderMobileControls(cw: number, ch: number, cars: Car[]): void {
    if (!this.input) return;
    const { ctx } = this;
    const rect = this.canvas.getBoundingClientRect();
    const lb = this.input.leftButtonRect;
    const rb = this.input.rightButtonRect;
    const bb = this.input.brakeButtonRect;
    const player = cars.find(c => c.isPlayer);

    // Convert CSS-pixel button rects to canvas render coordinates
    const scaleX = cw / rect.width;
    const scaleY = ch / rect.height;

    // --- Draw vertical steering slider ---
    const drawSteerSlider = (
      bx: number, by: number, bw: number, bh: number,
      direction: 'left' | 'right', pressed: boolean
    ) => {
      ctx.save();
      const x = bx; const y = by; const w = bw; const h = bh;
      const r = 24 * scaleX;

      // Outer glass panel
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (pressed) {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
      } else {
        grad.addColorStop(0, 'rgba(0, 0, 0, 0.40)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();

      // Border glow
      ctx.strokeStyle = pressed ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2 * scaleX;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.stroke();

      // Inner track groove
      const trackW = 6 * scaleX;
      const trackH = h * 0.55;
      const trackX = x + (w - trackW) / 2;
      const trackY = y + (h - trackH) / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.roundRect(trackX, trackY, trackW, trackH, trackW / 2);
      ctx.fill();

      // Slider knob (moves slightly when pressed)
      const knobR = 14 * scaleX;
      const knobCx = x + w / 2;
      const knobCy = y + h / 2 + (pressed ? -12 * scaleY : 0);
      const knobGrad = ctx.createRadialGradient(knobCx, knobCy - 3 * scaleY, 0, knobCx, knobCy, knobR);
      knobGrad.addColorStop(0, pressed ? '#ffffff' : 'rgba(255,255,255,0.9)');
      knobGrad.addColorStop(1, pressed ? 'rgba(200,200,200,0.8)' : 'rgba(180,180,180,0.5)');
      ctx.fillStyle = knobGrad;
      ctx.beginPath();
      ctx.arc(knobCx, knobCy, knobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5 * scaleX;
      ctx.stroke();

      // Arrow chevron on the knob
      const arrowSz = 7 * scaleX;
      ctx.strokeStyle = pressed ? '#333' : 'rgba(60,60,60,0.8)';
      ctx.lineWidth = 2.5 * scaleX;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (direction === 'left') {
        ctx.moveTo(knobCx + arrowSz * 0.3, knobCy - arrowSz * 0.5);
        ctx.lineTo(knobCx - arrowSz * 0.4, knobCy);
        ctx.lineTo(knobCx + arrowSz * 0.3, knobCy + arrowSz * 0.5);
      } else {
        ctx.moveTo(knobCx - arrowSz * 0.3, knobCy - arrowSz * 0.5);
        ctx.lineTo(knobCx + arrowSz * 0.4, knobCy);
        ctx.lineTo(knobCx - arrowSz * 0.3, knobCy + arrowSz * 0.5);
      }
      ctx.stroke();

      // Direction label
      ctx.fillStyle = pressed ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.font = `bold ${11 * scaleX}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(direction === 'left' ? 'L' : 'R', x + w / 2, y + h - 10 * scaleY);

      ctx.restore();
    };

    // --- Draw brake button ---
    const drawBrakeButton = (
      bx: number, by: number, bw: number, bh: number,
      pressed: boolean
    ) => {
      ctx.save();
      const x = bx; const y = by; const w = bw; const h = bh;
      const r = 16 * scaleX;

      // Glass background with red tint
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (pressed) {
        grad.addColorStop(0, 'rgba(255, 60, 60, 0.55)');
        grad.addColorStop(1, 'rgba(200, 30, 30, 0.65)');
      } else {
        grad.addColorStop(0, 'rgba(140, 20, 20, 0.45)');
        grad.addColorStop(1, 'rgba(80, 10, 10, 0.55)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();

      // Border
      ctx.strokeStyle = pressed ? 'rgba(255, 100, 100, 0.7)' : 'rgba(255, 80, 80, 0.25)';
      ctx.lineWidth = 2 * scaleX;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.stroke();

      // "BRAKE" text
      ctx.fillStyle = pressed ? '#ffffff' : 'rgba(255, 200, 200, 0.8)';
      ctx.font = `bold ${16 * scaleX}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BRAKE', x + w / 2, y + h / 2);

      ctx.restore();
    };

    // Draw left slider
    drawSteerSlider(
      lb.x * scaleX, lb.y * scaleY, lb.w * scaleX, lb.h * scaleY,
      'left', this.input.leftPressed
    );
    // Draw right slider
    drawSteerSlider(
      rb.x * scaleX, rb.y * scaleY, rb.w * scaleX, rb.h * scaleY,
      'right', this.input.rightPressed
    );
    // Draw brake button
    drawBrakeButton(
      bb.x * scaleX, bb.y * scaleY, bb.w * scaleX, bb.h * scaleY,
      this.input.brakePressed
    );

    // --- Speed display integrated into mobile controls ---
    if (player) {
      const speed = Math.round(Math.abs(player.behavior.speed));
      const ratio = Math.abs(player.behavior.speed) / player.maxSpeed;
      const gearText = player.gear === 0 ? 'N' : `${player.gear}`;

      // Panel positioned above brake, centered
      const panelW = bb.w * scaleX * 1.4;
      const panelH = 80 * scaleY;
      const panelX = (cw - panelW) / 2;
      const panelY = bb.y * scaleY - panelH - 12 * scaleY;
      const panelR = 16 * scaleX;

      // Glass background
      const sGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
      sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.40)');
      sGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = sGrad;
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5 * scaleX;
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
      ctx.stroke();

      // Speed number
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${36 * scaleX}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${speed}`, panelX + panelW * 0.42, panelY + panelH * 0.38);

      // KMH label
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${13 * scaleX}px sans-serif`;
      ctx.fillText('KMH', panelX + panelW * 0.42, panelY + panelH * 0.68);

      // Gear indicator (right side)
      ctx.fillStyle = ratio > 0.9 ? '#ff4444' : ratio > 0.7 ? '#ff8800' : '#44cc44';
      ctx.font = `bold ${30 * scaleX}px monospace`;
      ctx.fillText(gearText, panelX + panelW * 0.82, panelY + panelH * 0.45);
      ctx.restore();

      // Speed bar at bottom of panel
      const sBarH = 4 * scaleY;
      const sBarX = panelX + 10 * scaleX;
      const sBarW = panelW - 20 * scaleX;
      const sBarY = panelY + panelH - sBarH - 6 * scaleY;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.roundRect(sBarX, sBarY, sBarW, sBarH, sBarH / 2);
      ctx.fill();
      const fillColor = ratio > 0.9 ? '#ff4444' : ratio > 0.7 ? '#ff8800' : '#44cc44';
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(sBarX, sBarY, sBarW * Math.min(ratio, 1), sBarH, sBarH / 2);
      ctx.fill();
    }
  }

  // ==================== OVERLAYS ====================

  private renderCountdown(state: RaceState, cw: number, ch: number): void {
    const { ctx } = this;
    const scale = cw / 1080;

    // Dim overlay
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, cw, ch);

    // Traffic light housing
    const lx = cw / 2;
    const ly = ch * 0.28;
    const lr = 28 * scale;
    const gap = 76 * scale;
    const hW = 90 * scale;
    const hH = gap * 3 + 30 * scale;

    ctx.fillStyle = '#1a1a1a';
    this.drawRoundRect(lx - hW / 2, ly - 12 * scale, hW, hH, 10 * scale);
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(lx - hW / 2, ly - 12 * scale, hW, hH);

    const circleY = [ly + gap * 0.5, ly + gap * 1.5, ly + gap * 2.5];
    const isGo = state.countdownValue === 0;

    for (let i = 0; i < 3; i++) {
      // Dark circle background
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.arc(lx, circleY[i], lr, 0, Math.PI * 2);
      ctx.fill();

      const lit = isGo || i < (4 - state.countdownValue);
      ctx.fillStyle = isGo ? (lit ? '#44ff44' : '#0a220a') : (lit ? '#ff2222' : '#220a0a');
      ctx.save();
      if (lit) {
        ctx.shadowColor = isGo ? '#44ff44' : '#ff2222';
        ctx.shadowBlur = 18 * scale;
      }
      ctx.beginPath();
      ctx.arc(lx, circleY[i], lr * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (isGo) {
      ctx.fillStyle = '#44ff44';
      ctx.font = `bold ${90 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GO!', cw / 2, ly + hH + 50 * scale);
    }
    ctx.restore();
  }

  private renderFinishScreen(state: RaceState, cw: number, ch: number): void {
    const { ctx } = this;
    const scale = cw / 1080;

    // Semi-transparent overlay
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, cw, ch);

    // Panel
    const panelW = 700 * scale;
    const panelH = 600 * scale;
    const panelX = (cw - panelW) / 2;
    const panelY = (ch - panelH) / 2 - 50 * scale;
    ctx.fillStyle = '#1a1a2e';
    this.drawRoundRect(panelX, panelY, panelW, panelH, 20 * scale);
    ctx.strokeStyle = '#333366';
    ctx.lineWidth = 3 * scale;
    ctx.stroke();

    // Position
    const posText = `${state.playerPosition}`;
    const suffix = this.getOrdinalSuffix(state.playerPosition);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${100 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(posText, cw / 2 - 30 * scale, panelY + 100 * scale);
    ctx.font = `${40 * scale}px monospace`;
    ctx.fillText(suffix, cw / 2 + 50 * scale, panelY + 80 * scale);

    // Congratulation message
    const msgs = ['TRACK BOSS!', 'GREAT DRIVE!', 'NICE RACE!', 'KEEP TRYING!'];
    const msgIdx = Math.min(state.playerPosition - 1, 3);
    ctx.fillStyle = state.playerStars === 3 ? COLORS.hudAccent : '#aaaaaa';
    ctx.font = `bold ${36 * scale}px monospace`;
    ctx.fillText(msgs[msgIdx], cw / 2, panelY + 170 * scale);

    // Time
    ctx.fillStyle = '#cccccc';
    ctx.font = `${32 * scale}px monospace`;
    ctx.fillText(this.formatTime(state.playerFinishTime), cw / 2, panelY + 230 * scale);

    // Stars
    const starY = panelY + 310 * scale;
    for (let i = 0; i < 3; i++) {
      const starX = cw / 2 + (i - 1) * 80 * scale;
      ctx.font = `${60 * scale}px monospace`;
      ctx.fillStyle = i < state.playerStars ? COLORS.hudAccent : '#333333';
      ctx.fillText('★', starX, starY);
    }

    // Reward
    ctx.fillStyle = '#aaaaaa';
    ctx.font = `${24 * scale}px monospace`;
    ctx.fillText('REWARD', cw / 2, panelY + 400 * scale);
    ctx.fillStyle = COLORS.hudAccent;
    ctx.font = `bold ${48 * scale}px monospace`;
    ctx.fillText(`~${state.playerReward}`, cw / 2, panelY + 460 * scale);

    // Restart hint
    ctx.fillStyle = '#888888';
    ctx.font = `${22 * scale}px monospace`;
    ctx.fillText('Press SPACE or tap to restart', cw / 2, panelY + panelH + 50 * scale);

    ctx.restore();
  }

  // ==================== UTILITIES ====================

  private drawRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
    return `${secs}.${tenths}s`;
  }

  private getOrdinalSuffix(n: number): string {
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
  }

  private getCarCount(cars: Car[]): number {
    return cars.length;
  }
}
