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
import type { MenuState } from '../Game';

/** A grass/dirt particle kicked up by a car on grass */
interface GrassParticle {
  x: number;      // world x
  y: number;      // world y
  vx: number;     // velocity x
  vy: number;     // velocity y
  life: number;   // remaining life (0-1)
  size: number;   // radius
  color: string;  // grass green or dirt brown
  rotation: number;
  rotSpeed: number;
}

/** A tire skid trail — a series of connected points from one wheel */
interface TireTrail {
  points: { x: number; y: number }[];  // sequential wheel positions
  alpha: number;    // base opacity (fades over time)
  width: number;    // line width
}

const COLORS = {
  grass: '#2b8a3e',
  grassDark: '#237032',
  road: '#505050',
  roadEdge: '#404040',
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

// ===== SUN / SHADOW DIRECTION =====
// Sun is positioned upper-right. Shadows project to bottom-left.
// sunAngle: direction the shadow falls (radians). 0 = right, π/2 = down.
// sunDist: base shadow offset (pixels, scaled per object height).
const SUN_ANGLE = Math.PI * 0.72;        //  ~130° — sun from upper-right
const SUN_COS = Math.cos(SUN_ANGLE);     // x component of shadow direction
const SUN_SIN = Math.sin(SUN_ANGLE);     // y component of shadow direction
const SHADOW_LENGTH = 1.0;               // multiplier for shadow stretch

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private input: InputManager | null = null;
  private sponsorImages: HTMLImageElement[] = [];
  private sponsorImagesLoaded = false;
  private sponsorOnFormulaImg: HTMLImageElement | null = null;
  private carlsbergImg: HTMLImageElement | null = null;
  private grassParticles: Map<number, GrassParticle[]> = new Map();
  private tireTrails: TireTrail[] = [];
  private activeTrails: Map<string, TireTrail> = new Map(); // key: "carId_left" or "carId_right"

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
    // Load Carlsberg logo for leaderboard header
    const carlsberg = new Image();
    carlsberg.src = '/sponsors/carlsberg.png';
    carlsberg.onload = () => { this.carlsbergImg = carlsberg; };
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

    // Clear — subtle gradient backdrop (visible where track doesn't cover)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, ch);
    skyGrad.addColorStop(0, '#4a9060');   // lighter at top (distance)
    skyGrad.addColorStop(0.35, '#3a7a4e');
    skyGrad.addColorStop(0.65, '#2b8a3e'); // grass green
    skyGrad.addColorStop(1, '#227a35');   // slightly darker at bottom (near)
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, cw, ch);

    // === WORLD SPACE (camera transform) ===
    ctx.save();
    this.camera.applyTransform(ctx);

    const bounds = this.camera.getVisibleBounds();
    this.renderTrack(track, bounds);
    this.renderTireTrails(bounds);
    this.updateAndRenderGrassParticles(cars);
    this.renderCars(cars);
    this.renderBridges(track);

    ctx.restore();

    // === ATMOSPHERIC DEPTH EFFECTS (screen-space) ===

    // 1) Distance fog at top of screen ("ahead" = far away)
    const fogGrad = ctx.createLinearGradient(0, 0, 0, ch * 0.5);
    fogGrad.addColorStop(0, 'rgba(140, 190, 140, 0.22)');
    fogGrad.addColorStop(0.4, 'rgba(160, 200, 160, 0.08)');
    fogGrad.addColorStop(1, 'rgba(160, 200, 160, 0)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, cw, ch * 0.5);

    // 2) Vignette — cinematic darkening at all edges
    // Top edge (strongest — simulates distance horizon)
    const vigTop = ctx.createLinearGradient(0, 0, 0, ch * 0.35);
    vigTop.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    vigTop.addColorStop(0.5, 'rgba(0, 0, 0, 0.10)');
    vigTop.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = vigTop;
    ctx.fillRect(0, 0, cw, ch * 0.35);

    // Bottom edge (subtle)
    const vigBot = ctx.createLinearGradient(0, ch, 0, ch * 0.75);
    vigBot.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
    vigBot.addColorStop(0.5, 'rgba(0, 0, 0, 0.05)');
    vigBot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = vigBot;
    ctx.fillRect(0, ch * 0.75, cw, ch * 0.25);

    // Left edge
    const vigLeft = ctx.createLinearGradient(0, 0, cw * 0.15, 0);
    vigLeft.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    vigLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = vigLeft;
    ctx.fillRect(0, 0, cw * 0.15, ch);

    // Right edge
    const vigRight = ctx.createLinearGradient(cw, 0, cw * 0.85, 0);
    vigRight.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    vigRight.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = vigRight;
    ctx.fillRect(cw * 0.85, 0, cw * 0.15, ch);

    // 3) Radial vignette center highlight (brightens center for depth of field feel)
    const radGrad = ctx.createRadialGradient(cw / 2, ch * 0.45, 0, cw / 2, ch * 0.45, cw * 0.6);
    radGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    radGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, cw, ch);

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

    // --- Carlsberg logos painted beside the road ---
    this.drawCarlsbergGrassLogo(track);

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

    // Overlap edges so adjacent segments connect without gaps
    const ext = 8;
    const ew = w + ext * 2;
    const exL = -w / 2 - ext;

    // Layout: wall (upper ~55%) + ad panels (lower ~45%)
    const wallH = h * 0.55;
    const adH = h * 0.45;
    const wallY = -h / 2;
    const adY = wallY + wallH;

    // ===== GROUND SHADOW (sun-directional) =====
    // Project a shadow from the fence onto the ground based on sun angle
    // Un-rotate sun direction into fence local space
    const fenceRelAngle = SUN_ANGLE - fence.angle;
    const fshX = Math.cos(fenceRelAngle) * 14 * SHADOW_LENGTH;
    const fshY = Math.sin(fenceRelAngle) * 14 * SHADOW_LENGTH;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    // Shadow is a parallelogram: bottom edge of fence + projected offset
    ctx.moveTo(exL, h / 2);
    ctx.lineTo(exL + ew, h / 2);
    ctx.lineTo(exL + ew + fshX, h / 2 + fshY);
    ctx.lineTo(exL + fshX, h / 2 + fshY);
    ctx.closePath();
    ctx.fill();
    // Also cast shadow from top cap
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    const capShX = Math.cos(fenceRelAngle) * 22 * SHADOW_LENGTH;
    const capShY = Math.sin(fenceRelAngle) * 22 * SHADOW_LENGTH;
    ctx.moveTo(exL, -h / 2 - 5);
    ctx.lineTo(exL + ew, -h / 2 - 5);
    ctx.lineTo(exL + ew + capShX, -h / 2 - 5 + capShY);
    ctx.lineTo(exL + capShX, -h / 2 - 5 + capShY);
    ctx.closePath();
    ctx.fill();

    // ===== MAIN CONCRETE WALL =====
    // Smooth gradient wall face
    const wallGrad = ctx.createLinearGradient(0, wallY, 0, wallY + wallH);
    wallGrad.addColorStop(0, '#e0e1e6');
    wallGrad.addColorStop(0.05, '#d6d7dc');
    wallGrad.addColorStop(0.5, '#cdced3');
    wallGrad.addColorStop(0.95, '#c2c3c8');
    wallGrad.addColorStop(1, '#b5b6bb');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(exL, wallY, ew, wallH);

    // Vertical posts — integrated concrete pillars with soft inset look
    const postSpacing = Math.max(55, Math.min(75, w / Math.max(3, Math.floor(w / 65))));
    const postW = 7;
    for (let px = exL + postSpacing / 2; px < exL + ew; px += postSpacing) {
      // Subtle inset shadow left
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(px - postW / 2 - 1, wallY + 2, 1, wallH - 4);
      // Post face — slightly lighter than wall
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(px - postW / 2, wallY + 2, postW, wallH - 4);
      // Subtle inset shadow right
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(px + postW / 2, wallY + 2, 1, wallH - 4);
    }

    // Horizontal grooves — subtle recessed lines
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    const grooveCount = 3;
    for (let r = 1; r <= grooveCount; r++) {
      const ry = wallY + (wallH / (grooveCount + 1)) * r;
      ctx.beginPath();
      ctx.moveTo(exL, ry);
      ctx.lineTo(exL + ew, ry);
      ctx.stroke();
      // Light line below groove for embossed look
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(exL, ry + 1);
      ctx.lineTo(exL + ew, ry + 1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    }

    // === TOP CAP — flat continuous rail ===
    const capH = 5;
    const capY = wallY - capH;
    // Cap gradient
    const capGrad = ctx.createLinearGradient(0, capY, 0, capY + capH);
    capGrad.addColorStop(0, '#eeeff2');
    capGrad.addColorStop(0.4, '#e4e5e9');
    capGrad.addColorStop(1, '#d2d3d8');
    ctx.fillStyle = capGrad;
    ctx.fillRect(exL, capY, ew, capH);
    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(exL, capY, ew, 1);
    // Bottom shadow of cap
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(exL, capY + capH, ew, 1);

    // === BOTTOM EDGE of wall ===
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(exL, wallY + wallH - 1.5, ew, 1.5);

    // ===== SPONSOR IMAGE PANELS (lower half) =====
    const imgIdx = index % 4;

    // Panel background (plain color, no sponsor artwork so fences stay unbranded)
    ctx.fillStyle = Renderer.FENCE_AD_COLORS[imgIdx];
    ctx.fillRect(exL, adY, ew, adH);

    // Segment dividers on ad panel
    const segW = Math.max(60, Math.min(120, w / Math.max(3, Math.floor(w / 90))));
    const numSegs = Math.max(2, Math.ceil(w / segW));
    const actualSegW = w / numSegs;
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let s = 1; s < numSegs; s++) {
      ctx.fillRect(-w / 2 + s * actualSegW - 0.5, adY, 1, adH);
    }

    // Ad panel top edge
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(exL, adY, ew, 1);
    // Ad panel bottom edge + subtle shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(exL, adY + adH - 1, ew, 1);

    // Sun directional lighting on the whole fence face
    // Compute how much the sun faces this fence (dot product of sun dir and fence normal)
    const faceNormalAngle = fence.angle - Math.PI / 2; // normal pointing "out" from fence face
    const sunFaceDot = Math.cos(SUN_ANGLE - faceNormalAngle); // 1 = fully lit, -1 = fully shadowed
    if (sunFaceDot < 0) {
      // Face is away from sun — darken it
      ctx.fillStyle = `rgba(0,0,0,${Math.min(-sunFaceDot * 0.22, 0.22)})`;
      ctx.fillRect(exL, -h / 2 - 5, ew, h + 10);
    } else {
      // Face is toward sun — brighten it slightly
      ctx.fillStyle = `rgba(255,255,255,${Math.min(sunFaceDot * 0.10, 0.10)})`;
      ctx.fillRect(exL, -h / 2 - 5, ew, h + 10);
    }

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

    // Sun-directional shadow from the finish gantry
    const flRelAngle = SUN_ANGLE - fl.angle;
    const flShX = Math.cos(flRelAngle) * 10 * SHADOW_LENGTH;
    const flShY = Math.sin(flRelAngle) * 10 * SHADOW_LENGTH;
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 - 4);
    ctx.lineTo(w / 2, -h / 2 - 4);
    ctx.lineTo(w / 2 + flShX, -h / 2 - 4 + flShY);
    ctx.lineTo(w / 2 + flShX, h / 2 + 4 + flShY);
    ctx.lineTo(-w / 2 + flShX, h / 2 + 4 + flShY);
    ctx.lineTo(-w / 2, h / 2 + 4);
    ctx.closePath();
    ctx.fill();

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

    // Sun-directional shadow
    const brRelAngle = SUN_ANGLE - rect.angle;
    const brShDist = 18 * SHADOW_LENGTH;
    const brShX = Math.cos(brRelAngle) * brShDist;
    const brShY = Math.sin(brRelAngle) * brShDist;
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 + brShX, -h / 2 + brShY);
    ctx.lineTo(w / 2 + brShX, h / 2 + brShY);
    ctx.lineTo(-w / 2 + brShX, h / 2 + brShY);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();

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

    // Sun lighting on bridge side rails
    const brFaceNormal = rect.angle - Math.PI / 2;
    const brSunDot = Math.cos(SUN_ANGLE - brFaceNormal);
    // Top rail: lit or shadowed
    if (brSunDot < 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(-brSunDot * 0.15, 0.15)})`;
    } else {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(brSunDot * 0.08, 0.08)})`;
    }
    ctx.fillRect(-w / 2, -h / 2, w, railH);
    // Bottom rail: opposite lighting
    if (brSunDot > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(brSunDot * 0.15, 0.15)})`;
    } else {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(-brSunDot * 0.08, 0.08)})`;
    }
    ctx.fillRect(-w / 2, h / 2 - railH, w, railH);

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
    // Pit wall sun shadow
    const pwShX = SUN_COS * 8 * SHADOW_LENGTH;
    const pwShY = SUN_SIN * 8 * SHADOW_LENGTH;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(wallX - wallW / 2, wallTop);
    ctx.lineTo(wallX + wallW / 2, wallTop);
    ctx.lineTo(wallX + wallW / 2 + pwShX, wallTop + pwShY);
    ctx.lineTo(wallX + wallW / 2 + pwShX, wallBot + pwShY);
    ctx.lineTo(wallX - wallW / 2 + pwShX, wallBot + pwShY);
    ctx.lineTo(wallX - wallW / 2, wallBot);
    ctx.closePath();
    ctx.fill();
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
    // Sun lighting on pit wall faces
    // Left face (toward track): check if sun hits it
    const pitWallSunDot = SUN_COS; // wall is vertical, left face normal is -X
    if (pitWallSunDot < 0) {
      // Left face lit
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(wallX - wallW / 2, wallTop, wallW / 2, wallBot - wallTop);
    } else {
      // Left face in shadow
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(wallX - wallW / 2, wallTop, wallW / 2, wallBot - wallTop);
    }
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

    // Building shadow (sun-directional)
    const gbRelAngle = SUN_ANGLE - gb.angle;
    const gbShDist = 18 * SHADOW_LENGTH;
    const gbShX = Math.cos(gbRelAngle) * gbShDist;
    const gbShY = Math.sin(gbRelAngle) * gbShDist;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.moveTo(-gbW / 2, -gbH / 2);
    ctx.lineTo(gbW / 2, -gbH / 2);
    ctx.lineTo(gbW / 2 + gbShX, -gbH / 2 + gbShY);
    ctx.lineTo(gbW / 2 + gbShX, gbH / 2 + gbShY);
    ctx.lineTo(-gbW / 2 + gbShX, gbH / 2 + gbShY);
    ctx.lineTo(-gbW / 2, gbH / 2);
    ctx.closePath();
    ctx.fill();

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
    // Traffic light sun shadow (tall thin post)
    const tlShX = SUN_COS * 12 * SHADOW_LENGTH;
    const tlShY = SUN_SIN * 12 * SHADOW_LENGTH;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(tlX - 4, tlY);
    ctx.lineTo(tlX + 4, tlY);
    ctx.lineTo(tlX + 4 + tlShX, tlY + tlShY);
    ctx.lineTo(tlX - 16 + tlShX, tlY - 90 + tlShY);
    ctx.lineTo(tlX + 16 + tlShX, tlY - 90 + tlShY);
    ctx.lineTo(tlX - 4 + tlShX, tlY + tlShY);
    ctx.closePath();
    ctx.fill();
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

    // Sun shadow offset for individual trees (local space)
    const treeRelAngle = SUN_ANGLE - rect.angle;
    const treeShadowX = Math.cos(treeRelAngle) * 10 * SHADOW_LENGTH;
    const treeShadowY = Math.sin(treeRelAngle) * 10 * SHADOW_LENGTH;

    // Tree crowns
    const spacing = 55;
    const cols = Math.max(1, Math.floor(w / spacing));
    const rows = Math.max(1, Math.floor(h / spacing));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const tx = -w / 2 + spacing / 2 + c * (w / cols);
        const ty = -h / 2 + spacing / 2 + r * (h / rows);
        const radius = 18 + ((c * 7 + r * 13) % 13);

        // Ground shadow under each tree crown
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(tx + treeShadowX, ty + treeShadowY, radius * 1.1, radius * 0.7, treeRelAngle, 0, Math.PI * 2);
        ctx.fill();

        // Tree crown
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

    // Sun shadow offset for palms (local space)
    const palmRelAngle = SUN_ANGLE - rect.angle;
    const palmShadowX = Math.cos(palmRelAngle) * 14 * SHADOW_LENGTH;
    const palmShadowY = Math.sin(palmRelAngle) * 14 * SHADOW_LENGTH;

    const spacing = 75;
    const cols = Math.max(1, Math.floor(w / spacing));
    const rows = Math.max(1, Math.floor(h / spacing));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const tx = -w / 2 + spacing / 2 + c * (w / cols);
        const ty = -h / 2 + spacing / 2 + r * (h / rows);
        const leafR = 22 + ((c * 5 + r * 11) % 10);

        // Ground shadow — elongated ellipse
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        ctx.beginPath();
        ctx.ellipse(tx + palmShadowX, ty + palmShadowY, leafR * 1.2, leafR * 0.6, palmRelAngle, 0, Math.PI * 2);
        ctx.fill();

        // Trunk
        ctx.fillStyle = '#8B7355';
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fill();
        // Leaves
        ctx.fillStyle = COLORS.palmLeaf;
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

    // ===== 1. DROP SHADOW (sun-directional) =====
    const gsRelAngle = SUN_ANGLE - rect.angle;
    const gsShadowDist = 20 * SHADOW_LENGTH;
    const gsShX = Math.cos(gsRelAngle) * gsShadowDist;
    const gsShY = Math.sin(gsRelAngle) * gsShadowDist;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 + gsShX, -h / 2 + gsShY);
    ctx.lineTo(w / 2 + gsShX, h / 2 + gsShY);
    ctx.lineTo(-w / 2 + gsShX, h / 2 + gsShY);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();

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

    // Sun-cast shadow from roof overhang onto seating below
    const roofShRelAngle = SUN_ANGLE - rect.angle;
    const roofShadowX = Math.cos(roofShRelAngle) * 14 * SHADOW_LENGTH;
    const roofShadowY = Math.sin(roofShRelAngle) * 14 * SHADOW_LENGTH;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(-w / 2 - roofOverhang, -h / 2 + roofH);
    ctx.lineTo(w / 2 + roofOverhang, -h / 2 + roofH);
    ctx.lineTo(w / 2 + roofOverhang + roofShadowX, -h / 2 + roofH + roofShadowY);
    ctx.lineTo(-w / 2 - roofOverhang + roofShadowX, -h / 2 + roofH + roofShadowY);
    ctx.closePath();
    ctx.fill();

    // Sun lighting on roof surface
    const roofNormalAngle = rect.angle; // roof faces up (normal = -Y in local)
    const roofSunDot = -Math.sin(SUN_ANGLE - roofNormalAngle); // how much sun hits roof top
    if (roofSunDot > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(roofSunDot * 0.12, 0.12)})`;
      ctx.fillRect(-w / 2 - roofOverhang, -h / 2 - 6, w + roofOverhang * 2, roofH + 6);
    }

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

    // Sun-directional shadow
    const bldRelAngle = SUN_ANGLE - rect.angle;
    const bldShDist = 16 * SHADOW_LENGTH;
    const bldShX = Math.cos(bldRelAngle) * bldShDist;
    const bldShY = Math.sin(bldRelAngle) * bldShDist;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 + bldShX, -h / 2 + bldShY);
    ctx.lineTo(w / 2 + bldShX, h / 2 + bldShY);
    ctx.lineTo(-w / 2 + bldShX, h / 2 + bldShY);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();

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

    // Sun lighting on building faces
    const bldFaceNormal = rect.angle - Math.PI / 2;
    const bldSunDot = Math.cos(SUN_ANGLE - bldFaceNormal);
    if (bldSunDot < 0) {
      // Face away from sun — darken
      ctx.fillStyle = `rgba(0,0,0,${Math.min(-bldSunDot * 0.18, 0.18)})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    } else {
      // Face toward sun — brighten
      ctx.fillStyle = `rgba(255,255,255,${Math.min(bldSunDot * 0.08, 0.08)})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }

    ctx.restore();
  }

  /** Procedurally paint Carlsberg logos on the grass beside the road.
   *
   *  Walks along the track waypoints sampling every ~INTERVAL world units of
   *  arc length. At each sample, computes the road tangent from the two
   *  nearest waypoints, then tries to place a logo offset perpendicular on
   *  each side of the road. Each candidate spot is:
   *    - rotated to the tangent direction so text runs along the road,
   *    - rejected if it overlaps any grandstand / building / tree / palm /
   *      bridge / pit-lane / fence / other logo (so it never gets hidden).
   */
  private drawCarlsbergGrassLogo(track: TrackData): void {
    if (!this.carlsbergImg) return;
    const { ctx } = this;
    const img = this.carlsbergImg;
    const aspect = img.naturalWidth / img.naturalHeight;

    const ROAD_HALF = 260;            // road is 520 wide
    const LOGO_H = 130;
    const LOGO_W = LOGO_H * aspect;
    // Push the logo just past the fence (fences sit right outside the road edge)
    const SIDE_OFFSET = ROAD_HALF + 110;
    const INTERVAL = 700;             // arc-length spacing between samples
    const MIN_SEP = 550;              // minimum distance between two logos
    const STRAIGHT_RAD = 0.18;        // ~10° — only real straights, skip bends

    // Half size used for obstacle/edge checks
    const HALF = Math.max(LOGO_W, LOGO_H) / 2;

    // Helper: is (x,y) inside a possibly-rotated rect?
    const insideRect = (
      x: number, y: number,
      r: { x: number; y: number; w: number; h: number; angle: number },
      inflate = 0,
    ): boolean => {
      const dx = x - r.x;
      const dy = y - r.y;
      const c = Math.cos(-r.angle);
      const s = Math.sin(-r.angle);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      return Math.abs(lx) <= r.w / 2 + inflate && Math.abs(ly) <= r.h / 2 + inflate;
    };

    // Obstacles we must never overlap. Fences are excluded — they line the
    // entire road, so logos go on the grass just past them.
    const obstacles: { x: number; y: number; w: number; h: number; angle: number }[] = [
      ...track.grandstands,
      ...track.buildings,
      ...track.trees,
      ...track.palms,
      ...track.bridges,
    ];
    if (track.pitLane) obstacles.push(track.pitLane);
    if (track.pitStop) {
      obstacles.push(track.pitStop.garageBuilding);
      obstacles.push(...track.pitStop.pitBoxes);
    }

    const placed: { x: number; y: number }[] = [];

    // Returns true if (cx,cy) is a legal logo position (clear of obstacles,
    // in bounds, and not too close to an already placed logo).
    const isFree = (cx: number, cy: number): boolean => {
      if (cx < HALF || cy < HALF || cx > track.width - HALF || cy > track.height - HALF) return false;
      for (const p of placed) {
        if (Math.hypot(p.x - cx, p.y - cy) < MIN_SEP) return false;
      }
      for (const o of obstacles) {
        if (insideRect(cx, cy, o, 30)) return false;
      }
      return true;
    };

    const drawLogo = (cx: number, cy: number, angle: number): void => {
      placed.push({ x: cx, y: cy });
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(img, -LOGO_W / 2, -LOGO_H / 2, LOGO_W, LOGO_H);
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    // Walk waypoints, keep an arc-length accumulator, drop a sample every INTERVAL.
    const wps = track.waypoints;
    if (wps.length < 2) return;

    let acc = 0;
    let nextDrop = INTERVAL / 2;

    for (let i = 0; i < wps.length; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % wps.length];
      const segDx = b.x - a.x;
      const segDy = b.y - a.y;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 0.001) continue;

      // Tangent angle of this segment (direction cars travel)
      const tangent = Math.atan2(segDy, segDx);
      // Unit perpendicular (to the "left" of travel direction)
      const nx = -Math.sin(tangent);
      const ny =  Math.cos(tangent);

      // While we still have drops to place within this segment
      while (acc + segLen >= nextDrop) {
        const t = (nextDrop - acc) / segLen;
        const px = a.x + segDx * t;
        const py = a.y + segDy * t;

        // Only drop on "straight enough" parts — check the turn at BOTH
        // ends of this segment (previous->current, current->next). If either
        // end bends too much, this sample is near a corner and we skip it.
        const prev = wps[(i - 1 + wps.length) % wps.length];
        const c = wps[(i + 2) % wps.length];
        const prevTangent = Math.atan2(a.y - prev.y, a.x - prev.x);
        const nextTangent = Math.atan2(c.y - b.y, c.x - b.x);
        let dPrev = tangent - prevTangent;
        let dNext = nextTangent - tangent;
        while (dPrev >  Math.PI) dPrev -= Math.PI * 2;
        while (dPrev < -Math.PI) dPrev += Math.PI * 2;
        while (dNext >  Math.PI) dNext -= Math.PI * 2;
        while (dNext < -Math.PI) dNext += Math.PI * 2;

        if (Math.abs(dPrev) < STRAIGHT_RAD && Math.abs(dNext) < STRAIGHT_RAD) {
          // Symmetric placement: only draw if BOTH sides are clear, so a
          // logo on the right always has a matching one on the left.
          const lx = px + nx * SIDE_OFFSET;
          const ly = py + ny * SIDE_OFFSET;
          const rx = px - nx * SIDE_OFFSET;
          const ry = py - ny * SIDE_OFFSET;
          if (isFree(lx, ly) && isFree(rx, ry)) {
            // Left side needs a 180° flip so its text reads right-way-up;
            // right side keeps the natural tangent rotation.
            drawLogo(lx, ly, tangent + Math.PI);
            drawLogo(rx, ry, tangent);
          }
        }

        nextDrop += INTERVAL;
      }

      acc += segLen;
    }
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of positions) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      // Sun-directional text shadow
      const bannerRelAngle = SUN_ANGLE - p.angle;
      const bShX = Math.cos(bannerRelAngle) * 8 * SHADOW_LENGTH;
      const bShY = Math.sin(bannerRelAngle) * 8 * SHADOW_LENGTH;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.globalAlpha = 0.35;
      ctx.fillText('FORMULA', bShX, bShY);
      // Actual text
      ctx.fillStyle = '#cc4411';
      ctx.globalAlpha = 0.4;
      ctx.fillText('FORMULA', 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ==================== TIRE MARKS ====================

  /** Spawn tire trail points from a car when drifting or turning hard */
  private spawnTireMarks(car: Car): void {
    // Skip cars not on road or not moving
    if (car.onGrass || car.state !== 'running') {
      // End any active trails for this car
      this.endTrail(`${car.id}_left`);
      this.endTrail(`${car.id}_right`);
      return;
    }
    const speed = Math.abs(car.behavior.speed);
    if (speed < 80) {
      this.endTrail(`${car.id}_left`);
      this.endTrail(`${car.id}_right`);
      return;
    }

    // Trigger conditions
    const driftThreshold = 0.12;
    const angVelThreshold = 1.2;
    const isDrifting = car.driftAngle > driftThreshold;
    const isHardTurn = Math.abs(car.angularVelocity) > angVelThreshold;

    if (!isDrifting && !isHardTurn) {
      this.endTrail(`${car.id}_left`);
      this.endTrail(`${car.id}_right`);
      return;
    }

    // Intensity for mark opacity
    const driftIntensity = Math.min(car.driftAngle / 0.5, 1);
    const turnIntensity = Math.min(Math.abs(car.angularVelocity) / 3, 1);
    const intensity = Math.max(driftIntensity, turnIntensity);

    const cosA = Math.cos(car.angle);
    const sinA = Math.sin(car.angle);
    const sx = car.width / 142;
    const sy = car.height / 76;

    // Rear wheel offsets
    const rearOffsetX = -52 * sx;
    const leftWheelY = -37 * sy;
    const rightWheelY = 37 * sy;

    // World positions of rear wheels
    const leftX = car.x + cosA * rearOffsetX - sinA * leftWheelY;
    const leftY = car.y + sinA * rearOffsetX + cosA * leftWheelY;
    const rightX = car.x + cosA * rearOffsetX - sinA * rightWheelY;
    const rightY = car.y + sinA * rearOffsetX + cosA * rightWheelY;

    const markAlpha = 0.15 + intensity * 0.25;
    const markWidth = 7 * sx;

    // Add to left trail
    this.addTrailPoint(`${car.id}_left`, leftX, leftY, markAlpha, markWidth);
    // Add to right trail
    this.addTrailPoint(`${car.id}_right`, rightX, rightY, markAlpha, markWidth);

    // Cap total trails
    if (this.tireTrails.length > 200) {
      this.tireTrails.splice(0, this.tireTrails.length - 150);
    }
  }

  /** Add a point to an active trail, or start a new one */
  private addTrailPoint(key: string, x: number, y: number, alpha: number, width: number): void {
    let trail = this.activeTrails.get(key);
    if (!trail) {
      trail = { points: [], alpha, width };
      this.activeTrails.set(key, trail);
      this.tireTrails.push(trail);
    }
    trail.points.push({ x, y });
    // Update alpha to current intensity (keeps the whole trail at peak intensity)
    trail.alpha = Math.max(trail.alpha, alpha);

    // Limit points per trail segment
    if (trail.points.length > 120) {
      // Split: finish this trail and start a new one continuing from last few points
      const carry = trail.points.slice(-3);
      this.activeTrails.delete(key);
      const newTrail: TireTrail = { points: carry, alpha, width };
      this.activeTrails.set(key, newTrail);
      this.tireTrails.push(newTrail);
    }
  }

  /** End an active trail (car stopped skidding) */
  private endTrail(key: string): void {
    this.activeTrails.delete(key);
  }

  /** Render all tire trails on the track surface */
  private renderTireTrails(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const { ctx } = this;
    if (this.tireTrails.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = this.tireTrails.length - 1; i >= 0; i--) {
      const trail = this.tireTrails[i];

      // Fade trails over time
      if (!this.activeTrails.has(this.getTrailKey(trail))) {
        trail.alpha -= 0.0004;
      }
      if (trail.alpha <= 0 || trail.points.length < 2) {
        this.tireTrails.splice(i, 1);
        continue;
      }

      // Quick bounds check — use first and last point
      const first = trail.points[0];
      const last = trail.points[trail.points.length - 1];
      const margin = 200;
      const minPx = Math.min(first.x, last.x);
      const maxPx = Math.max(first.x, last.x);
      const minPy = Math.min(first.y, last.y);
      const maxPy = Math.max(first.y, last.y);
      if (maxPx < bounds.minX - margin || minPx > bounds.maxX + margin ||
          maxPy < bounds.minY - margin || minPy > bounds.maxY + margin) {
        continue;
      }

      // Draw as a smooth curved path
      ctx.globalAlpha = trail.alpha;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = trail.width;
      ctx.beginPath();
      ctx.moveTo(trail.points[0].x, trail.points[0].y);

      if (trail.points.length === 2) {
        ctx.lineTo(trail.points[1].x, trail.points[1].y);
      } else {
        // Use quadratic curves through midpoints for smooth path
        for (let j = 1; j < trail.points.length - 1; j++) {
          const curr = trail.points[j];
          const next = trail.points[j + 1];
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
        }
        // Final point
        const last = trail.points[trail.points.length - 1];
        ctx.lineTo(last.x, last.y);
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  /** Find the key of an active trail (for fade checking) */
  private getTrailKey(trail: TireTrail): string {
    for (const [key, t] of this.activeTrails) {
      if (t === trail) return key;
    }
    return '';
  }

  // ==================== GRASS PARTICLES ====================

  private updateAndRenderGrassParticles(cars: Car[]): void {
    const { ctx } = this;
    const now = performance.now();
    const dt = Math.min((now - (this._lastGrassTime || now)) / 1000, 0.05);
    this._lastGrassTime = now;

    if (dt === 0) return;

    for (const car of cars) {
      const particles = this.grassParticles.get(car.id);
      if (!particles || particles.length === 0) continue;

      // Update and render particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Physics update
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96; // air drag
        p.vy *= 0.96;
        p.life -= dt * 1.8; // fade over ~0.55s
        p.rotation += p.rotSpeed * dt;

        // Remove dead particles
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        // Render
        const alpha = p.life * 0.7;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;

        // Draw as irregular chunk (not a perfect circle)
        ctx.beginPath();
        const s = p.size;
        ctx.moveTo(-s, -s * 0.6);
        ctx.lineTo(s * 0.7, -s);
        ctx.lineTo(s, s * 0.5);
        ctx.lineTo(-s * 0.4, s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Cap max particles per car
      if (particles.length > 80) {
        particles.splice(0, particles.length - 80);
      }
    }
  }
  private _lastGrassTime: number = 0;

  // ==================== CAR RENDERING ====================

  private renderCars(cars: Car[]): void {
    const { ctx } = this;

    // Spawn tire marks before drawing (runs every frame)
    for (const car of cars) {
      this.spawnTireMarks(car);
    }

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

    // ===== SHADOW (sun-directional) =====
    // Shadow offset is computed in local car space from global sun direction
    // We need to un-rotate the global sun direction into the car's local frame
    const shadowDist = 12 * SHADOW_LENGTH;
    const relAngle = SUN_ANGLE - car.angle; // sun direction relative to car orientation
    const shX = Math.cos(relAngle) * shadowDist * sx;
    const shY = Math.sin(relAngle) * shadowDist * sy;
    const shadowSteer = car.smoothSteer * 0.18;
    ctx.save();
    ctx.translate(shX, shY);
    // Slight stretch along shadow direction for more convincing ground shadow
    ctx.scale(1.04, 1.04);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    this.drawF1Silhouette(sx, sy, shadowSteer);
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
    const steerAngle = car.smoothSteer * 0.18; // ~10 degrees max, subtle realistic steering
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

    // ===== GRASS SPRAY (spawn particles) =====
    if (car.onGrass && Math.abs(car.behavior.speed) > 50) {
      const speedRatio = Math.min(Math.abs(car.behavior.speed) / 800, 1);
      const spawnCount = Math.floor(2 + speedRatio * 4); // 2-6 particles per frame
      const cosA = Math.cos(car.angle);
      const sinA = Math.sin(car.angle);
      // Rear wheel positions in world space
      const rearX = car.x - cosA * 40 * sx;
      const rearY = car.y - sinA * 40 * sx;

      let particles = this.grassParticles.get(car.id);
      if (!particles) {
        particles = [];
        this.grassParticles.set(car.id, particles);
      }

      for (let i = 0; i < spawnCount; i++) {
        // Spawn from left or right rear wheel area
        const side = (i % 2 === 0) ? -1 : 1;
        const spawnX = rearX + (-sinA * side * 22 * sy);
        const spawnY = rearY + (cosA * side * 22 * sy);

        // Particles fly backward and outward from the car
        const backSpeed = 80 + Math.random() * 200 * speedRatio;
        const sideSpeed = (Math.random() - 0.5) * 180 * speedRatio;
        const vx = -cosA * backSpeed + (-sinA) * sideSpeed;
        const vy = -sinA * backSpeed + cosA * sideSpeed;

        // Mix of grass chunks and dirt
        const isDirt = Math.random() < 0.4;
        const greens = ['#3a9a3a', '#2d7a2d', '#4aaa4a', '#5cb85c'];
        const browns = ['#8B6914', '#6B4E12', '#A0782C', '#7A5B1E'];
        const palette = isDirt ? browns : greens;

        particles.push({
          x: spawnX + (Math.random() - 0.5) * 10,
          y: spawnY + (Math.random() - 0.5) * 10,
          vx,
          vy,
          life: 1.0,
          size: isDirt ? (1.5 + Math.random() * 3) : (2 + Math.random() * 4.5),
          color: palette[Math.floor(Math.random() * palette.length)],
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 12,
        });
      }
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

  /** F1 car full silhouette for shadow — steerAngle rotates front wheels */
  private drawF1Silhouette(sx: number, sy: number, steerAngle: number = 0): void {
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
    // Rear wheel shadows (fixed orientation)
    ctx.fillRect(-52 * sx, -46 * sy, 30 * sx, 18 * sy);
    ctx.fillRect(-52 * sx, 28 * sy, 30 * sx, 18 * sy);
    // Front wheel shadows (rotate with steering)
    const fwW = 24 * sx;
    const fwH = 14 * sy;
    // Front-left
    ctx.save();
    ctx.translate(54 * sx, -37 * sy);
    ctx.rotate(steerAngle);
    ctx.fillRect(-fwW / 2, -fwH / 2, fwW, fwH);
    ctx.restore();
    // Front-right
    ctx.save();
    ctx.translate(54 * sx, 37 * sy);
    ctx.rotate(steerAngle);
    ctx.fillRect(-fwW / 2, -fwH / 2, fwW, fwH);
    ctx.restore();
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
    if (this.input?.isMobile) {
      // F1-style leaderboard tower on mobile
      this.renderF1Leaderboard(state, cars, scale, topBarY, topPad, topBarR);
    } else {
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
    }

    // --- Race time (top-center) ---
    // (moved below minimap — rendered after minimap)

    // --- Minimap (top-right, glassmorphic) ---
    const isMobile = !!this.input?.isMobile;
    const minimapSize = isMobile ? 210 * scale : 150 * scale;
    const mmX = cw - topPad - minimapSize;
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

    // --- Race time (below minimap, same width) ---
    const timeW = mmW;
    const timeH = topBarH;
    const timeX = mmX;
    const timeY = mmY + mmH + 6 * scale;
    ctx.save();
    drawGlassPanel(timeX, timeY, timeW, timeH, topBarR);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${24 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.formatTime(state.raceTime), timeX + timeW / 2, timeY + timeH / 2);
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

    // --- Draw steering button (racing style) ---
    const drawSteerButton = (
      bx: number, by: number, bw: number, bh: number,
      direction: 'left' | 'right', pressed: boolean
    ) => {
      ctx.save();
      const x = bx; const y = by; const w = bw; const h = bh;
      const r = 18 * scaleX;

      // Rounded glass panel
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (pressed) {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
      } else {
        grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.50)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();

      // Border
      ctx.strokeStyle = pressed ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1.5 * scaleX;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.stroke();

      // Large arrow chevron centered
      const cx = x + w / 2;
      const cy = y + h / 2;
      const arrowW = 16 * scaleX;
      const arrowH = 22 * scaleX;

      ctx.strokeStyle = pressed ? '#ffffff' : 'rgba(255,255,255,0.50)';
      ctx.lineWidth = 4 * scaleX;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (direction === 'left') {
        ctx.moveTo(cx + arrowW * 0.4, cy - arrowH * 0.5);
        ctx.lineTo(cx - arrowW * 0.4, cy);
        ctx.lineTo(cx + arrowW * 0.4, cy + arrowH * 0.5);
      } else {
        ctx.moveTo(cx - arrowW * 0.4, cy - arrowH * 0.5);
        ctx.lineTo(cx + arrowW * 0.4, cy);
        ctx.lineTo(cx - arrowW * 0.4, cy + arrowH * 0.5);
      }
      ctx.stroke();

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

    // Draw left button
    drawSteerButton(
      lb.x * scaleX, lb.y * scaleY, lb.w * scaleX, lb.h * scaleY,
      'left', this.input.leftPressed
    );
    // Draw right button
    drawSteerButton(
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

    // Subtle dim overlay — not too dark
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(0, 0, cw, ch);

    // --- F1-style glassmorphic semaphore panel ---
    const lightR = 36 * scale;       // light radius
    const lightGap = 20 * scale;     // gap between lights
    const lightDiameter = lightR * 2;
    const numLights = 5;             // F1 uses 5 lights
    const panelPadX = 30 * scale;
    const panelPadY = 28 * scale;
    const panelW = numLights * lightDiameter + (numLights - 1) * lightGap + panelPadX * 2;
    const panelH = lightDiameter + panelPadY * 2;
    const panelX = (cw - panelW) / 2;
    const panelY = ch * 0.22;
    const cornerR = 20 * scale;

    // Glass background
    const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    grad.addColorStop(0, 'rgba(10, 10, 20, 0.75)');
    grad.addColorStop(1, 'rgba(5, 5, 15, 0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, cornerR);
    ctx.fill();

    // Border glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, cornerR);
    ctx.stroke();

    // Inner subtle highlight at top
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(panelX + 3 * scale, panelY + 3 * scale, panelW - 6 * scale, panelH - 6 * scale, cornerR - 2 * scale);
    ctx.stroke();

    // --- F1 horizontal lights (5 lights: 4→1red, 3→2red, 2→3red, 1→4red, 0→all green) ---
    const isGo = state.countdownValue === 0;
    const litCount = isGo ? 0 : (5 - state.countdownValue); // 4→1, 3→2, 2→3, 1→4 reds

    for (let i = 0; i < numLights; i++) {
      const cx = panelX + panelPadX + lightR + i * (lightDiameter + lightGap);
      const cy = panelY + panelPadY + lightR;

      // Dark socket ring
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, lightR + 3 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Socket inner
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.arc(cx, cy, lightR, 0, Math.PI * 2);
      ctx.fill();

      // Light state
      let lit: boolean;
      if (isGo) {
        lit = true; // all green
      } else {
        // F1 style: lights come on progressively
        // countdownValue 3 = 1 red, 2 = 2 red, 1 = 3 red, 0 = all green
        lit = i < litCount;
      }

      const litColor = isGo ? '#00e800' : '#e81000';
      const dimColor = isGo ? '#002800' : '#1a0500';

      // Light bulb
      ctx.fillStyle = lit ? litColor : dimColor;
      ctx.save();
      if (lit) {
        ctx.shadowColor = isGo ? '#00ff00' : '#ff2200';
        ctx.shadowBlur = 25 * scale;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, lightR * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Glossy highlight on lit bulbs
      if (lit) {
        const hlGrad = ctx.createRadialGradient(
          cx - lightR * 0.2, cy - lightR * 0.25, 0,
          cx, cy, lightR * 0.78
        );
        hlGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
        hlGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hlGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, lightR * 0.78, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- "GO!" text below panel ---
    if (isGo) {
      ctx.save();
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 30 * scale;
      ctx.fillStyle = '#00e800';
      ctx.font = `bold ${80 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GO!', cw / 2, panelY + panelH + 60 * scale);
      ctx.restore();
    } else if (state.countdownValue <= 4 && state.countdownValue >= 1) {
      // Show countdown number subtly
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.font = `bold ${50 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${state.countdownValue}`, cw / 2, panelY + panelH + 50 * scale);
    }

    ctx.restore();
  }

  private renderFinishScreen(state: RaceState, cw: number, ch: number): void {
    const { ctx } = this;
    const isMobile = !!this.input?.isMobile;
    const scale = isMobile ? cw / 500 : cw / 1080;

    // === Full-screen background matching menu style ===
    ctx.save();

    // Green gradient background (same as menu)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
    bgGrad.addColorStop(0, '#1a4a2a');
    bgGrad.addColorStop(0.5, '#1e5630');
    bgGrad.addColorStop(1, '#153d22');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle grid pattern (same as menu)
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gridStep = 60 * scale;
    for (let gx = 0; gx < cw; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
    }
    for (let gy = 0; gy < ch; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }

    // Red accent line at top (same as menu)
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 0, cw, 4 * scale);

    // === Results panel (glassmorphic, like rankings panel) ===
    const panelW = 500 * scale;
    const panelH = 520 * scale;
    const panelX = (cw - panelW) / 2;
    const panelY = ch * 0.08;
    const panelR = 16 * scale;

    // Glass panel background
    const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    panelGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    panelGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = panelGrad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.stroke();

    // === Header — "RACE RESULTS" ===
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${28 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RACE RESULTS', cw / 2, panelY + 40 * scale);

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 20 * scale, panelY + 65 * scale);
    ctx.lineTo(panelX + panelW - 20 * scale, panelY + 65 * scale);
    ctx.stroke();

    // === Position ===
    const posText = `${state.playerPosition}`;
    const suffix = this.getOrdinalSuffix(state.playerPosition);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${90 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const posMetrics = ctx.measureText(posText);
    const posX = cw / 2 - 15 * scale;
    ctx.fillText(posText, posX, panelY + 135 * scale);
    ctx.font = `bold ${36 * scale}px sans-serif`;
    ctx.fillText(suffix, posX + posMetrics.width / 2 + 8 * scale, panelY + 110 * scale);

    // === Congratulation message ===
    const msgs = ['TRACK BOSS!', 'GREAT DRIVE!', 'NICE RACE!', 'KEEP TRYING!'];
    const msgIdx = Math.min(state.playerPosition - 1, 3);
    ctx.fillStyle = state.playerStars === 3 ? '#ffd700' : 'rgba(255,255,255,0.5)';
    ctx.font = `bold ${26 * scale}px sans-serif`;
    ctx.fillText(msgs[msgIdx], cw / 2, panelY + 200 * scale);

    // === Time ===
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${24 * scale}px sans-serif`;
    ctx.fillText(this.formatTime(state.playerFinishTime), cw / 2, panelY + 250 * scale);

    // === Stars ===
    const starY = panelY + 320 * scale;
    for (let i = 0; i < 3; i++) {
      const starX = cw / 2 + (i - 1) * 70 * scale;
      ctx.font = `${52 * scale}px sans-serif`;
      ctx.fillStyle = i < state.playerStars ? '#ffd700' : 'rgba(255,255,255,0.12)';
      ctx.fillText('★', starX, starY);
    }

    // === Reward ===
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${20 * scale}px sans-serif`;
    ctx.fillText('REWARD', cw / 2, panelY + 390 * scale);
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${42 * scale}px sans-serif`;
    ctx.fillText(`~${state.playerReward}`, cw / 2, panelY + 440 * scale);

    // === Buttons (menu-style glassmorphic) ===
    const finishBtns = this.getFinishButtons(cw, ch);
    for (const btn of finishBtns) {
      const label = btn.id === 'finish_restart' ? 'RESTART RACE' : 'BACK TO MENU';
      const accent = btn.id === 'finish_restart' ? '#e10600' : 'rgba(255,255,255,0.2)';
      this.renderMenuButton(btn.x, btn.y, btn.w, btn.h, label, scale, accent);
    }

    ctx.restore();
  }

  // ==================== F1 LEADERBOARD (MOBILE) ====================

  private static readonly TEAM_ABBR = [
    'BLU','PAN','HAM','STL','CRI','AQU','ACC','COG','PET','MAR',
    'NOV','ECL','THU','TEM','HER','HOR','SHA','TOR',
  ];

  private renderF1Leaderboard(
    state: RaceState, cars: Car[], scale: number,
    topBarY: number, topPad: number, topBarR: number
  ): void {
    const { ctx } = this;

    const rowH = 46 * scale;
    const headerH = 56 * scale;
    const panelW = 320 * scale;
    const totalRows = cars.length;
    const panelH = headerH + rowH * totalRows + 6 * scale;
    const panelX = topPad;
    const panelY = topBarY;

    // --- Glass panel background ---
    ctx.save();
    const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.70)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, topBarR);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, topBarR);
    ctx.stroke();

    // --- Header ---
    // Red accent bar (F1 style)
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.roundRect(panelX + 10 * scale, panelY + 9 * scale, 4 * scale, headerH - 18 * scale, 2 * scale);
    ctx.fill();

    // Carlsberg logo + "RACE" title
    let raceTextX = panelX + 24 * scale;
    if (this.carlsbergImg) {
      const logoH = headerH * 0.85;
      const logoW = logoH * (this.carlsbergImg.naturalWidth / this.carlsbergImg.naturalHeight);
      const logoX = panelX + 12 * scale;
      const logoY = panelY + (headerH - logoH) / 2;
      ctx.drawImage(this.carlsbergImg, logoX, logoY, logoW, logoH);
      raceTextX = logoX + logoW - 10 * scale;
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${26 * scale}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Race', raceTextX, panelY + headerH / 2);

    // "LAP X/Y" on the right
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.font = `${18 * scale}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`LAP ${state.playerLap}/${state.totalLaps}`, panelX + panelW - 10 * scale, panelY + headerH / 2);

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 6 * scale, panelY + headerH);
    ctx.lineTo(panelX + panelW - 6 * scale, panelY + headerH);
    ctx.stroke();

    // --- Rows — sorted by position ---
    const sortedCars = state.positions
      .map(id => cars.find(c => c.id === id)!)
      .filter(Boolean);
    const leaderProgress = sortedCars.length > 0 ? sortedCars[0].progress : 0;

    for (let i = 0; i < sortedCars.length; i++) {
      const car = sortedCars[i];
      const pos = i + 1;
      const ry = panelY + headerH + i * rowH;
      const rowCenterY = ry + rowH / 2;

      // Highlight player row
      if (car.isPlayer) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.beginPath();
        ctx.roundRect(panelX + 4 * scale, ry + 1, panelW - 8 * scale, rowH - 2, 4 * scale);
        ctx.fill();
      }

      // Position number — podium colors
      if (pos === 1) ctx.fillStyle = '#ffd700';
      else if (pos === 2) ctx.fillStyle = '#c0c0c0';
      else if (pos === 3) ctx.fillStyle = '#cd7f32';
      else ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `bold ${22 * scale}px monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pos}`, panelX + 38 * scale, rowCenterY);

      // Team color stripe
      ctx.fillStyle = car.color;
      ctx.fillRect(panelX + 46 * scale, ry + 9 * scale, 5 * scale, rowH - 18 * scale);

      // Team abbreviation
      const abbr = Renderer.TEAM_ABBR[car.teamIndex] || 'UNK';
      ctx.fillStyle = car.isPlayer ? '#ffffff' : 'rgba(255,255,255,0.70)';
      ctx.font = `bold ${22 * scale}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(abbr, panelX + 58 * scale, rowCenterY);

      // Gap text
      ctx.font = `${17 * scale}px sans-serif`;
      ctx.textAlign = 'right';
      if (pos === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText('Leader', panelX + panelW - 10 * scale, rowCenterY);
      } else {
        const progressGap = leaderProgress - car.progress;
        // Scale the progress gap to approximate seconds
        const approxGap = state.raceTime > 0
          ? (progressGap / leaderProgress) * state.raceTime
          : 0;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        if (approxGap < 100) {
          ctx.fillText(`+${approxGap.toFixed(1)}`, panelX + panelW - 10 * scale, rowCenterY);
        } else {
          ctx.fillText('+LAP', panelX + panelW - 10 * scale, rowCenterY);
        }
      }
    }

    ctx.restore();
  }

  // ==================== MENU RENDERING ====================

  /** Returns clickable button regions for the current menu screen */
  getFinishButtons(cw: number, ch: number): { id: string; x: number; y: number; w: number; h: number }[] {
    const isMobile = !!this.input?.isMobile;
    const scale = isMobile ? cw / 500 : cw / 1080;
    const btnW = 420 * scale;
    const btnH = 72 * scale;
    const btnX = (cw - btnW) / 2;
    const gap = 20 * scale;

    const panelH = 520 * scale;
    const panelY = ch * 0.08;
    const startY = panelY + panelH + 30 * scale;

    return [
      { id: 'finish_restart', x: btnX, y: startY, w: btnW, h: btnH },
      { id: 'finish_menu', x: btnX, y: startY + btnH + gap, w: btnW, h: btnH },
    ];
  }

  getMenuButtons(menuState: MenuState, cw: number, ch: number): { id: string; x: number; y: number; w: number; h: number }[] {
    const isMobile = !!this.input?.isMobile;
    const scale = isMobile ? cw / 500 : cw / 1080;
    const btnW = 420 * scale;
    const btnH = 72 * scale;
    const btnX = (cw - btnW) / 2;
    const centerY = ch * 0.42;
    const gap = 20 * scale;

    if (menuState.screen === 'main') {
      return [
        { id: 'play', x: btnX, y: centerY, w: btnW, h: btnH },
        { id: 'rankings', x: btnX, y: centerY + btnH + gap, w: btnW, h: btnH },
        { id: 'settings', x: btnX, y: centerY + (btnH + gap) * 2, w: btnW, h: btnH },
      ];
    } else if (menuState.screen === 'play') {
      return [
        { id: 'play_bots', x: btnX, y: centerY, w: btnW, h: btnH },
        { id: 'play_solo', x: btnX, y: centerY + btnH + gap, w: btnW, h: btnH },
        { id: 'back', x: btnX, y: centerY + (btnH + gap) * 2, w: btnW, h: btnH },
      ];
    } else if (menuState.screen === 'rankings' || menuState.screen === 'settings') {
      // Back button at bottom
      const backY = ch * 0.82;
      return [
        { id: 'back', x: btnX, y: backY, w: btnW, h: btnH },
      ];
    }
    return [];
  }

  /** Render the full menu screen */
  renderMenu(menuState: MenuState): void {
    const { ctx } = this;
    const cw = this.camera.canvasWidth;
    const ch = this.camera.canvasHeight;
    const isMobile = !!this.input?.isMobile;
    const scale = isMobile ? cw / 500 : cw / 1080;

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
    bgGrad.addColorStop(0, '#1a4a2a');
    bgGrad.addColorStop(0.5, '#1e5630');
    bgGrad.addColorStop(1, '#153d22');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gridStep = 60 * scale;
    for (let gx = 0; gx < cw; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ch);
      ctx.stroke();
    }
    for (let gy = 0; gy < ch; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cw, gy);
      ctx.stroke();
    }

    // Red accent line at top
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 0, cw, 4 * scale);

    // Title area
    const titleY = ch * 0.12;
    const titleScale = isMobile ? cw / 700 : scale;
    
    // Carlsberg logo in title if available
    if (this.carlsbergImg) {
      const logoH = 70 * titleScale;
      const logoW = logoH * (this.carlsbergImg.naturalWidth / this.carlsbergImg.naturalHeight);
      ctx.drawImage(this.carlsbergImg, (cw - logoW) / 2, titleY - 15 * titleScale, logoW, logoH);
    }

    // Game title
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${56 * titleScale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FORMULA RACERS', cw / 2, titleY + 80 * titleScale);

    // Subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${20 * titleScale}px sans-serif`;
    ctx.fillText('RACING CHAMPIONSHIP', cw / 2, titleY + 120 * titleScale);

    // Render current screen
    switch (menuState.screen) {
      case 'main':
        this.renderMainMenu(menuState, cw, ch, scale);
        break;
      case 'play':
        this.renderPlayMenu(menuState, cw, ch, scale);
        break;
      case 'rankings':
        this.renderRankingsScreen(menuState, cw, ch, scale);
        break;
      case 'settings':
        this.renderSettingsScreen(menuState, cw, ch, scale);
        break;
    }
  }

  private renderMenuButton(
    x: number, y: number, w: number, h: number,
    label: string, scale: number,
    accent?: string
  ): void {
    const { ctx } = this;
    const r = 16 * scale;

    // Glass background
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Left accent bar
    if (accent) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(x + 8 * scale, y + 12 * scale, 4 * scale, h - 24 * scale, 2 * scale);
      ctx.fill();
    }

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${26 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  private renderMainMenu(_menuState: MenuState, cw: number, ch: number, scale: number): void {
    const buttons = this.getMenuButtons({ screen: 'main', gamePhase: 'menu', bestTimes: [], soloMode: false }, cw, ch);
    const labels = ['PLAY', 'RANKINGS', 'SETTINGS'];
    const accents = ['#e10600', '#ffd700', '#4488cc'];

    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      this.renderMenuButton(b.x, b.y, b.w, b.h, labels[i], scale, accents[i]);
    }

    // Footer
    this.ctx.fillStyle = 'rgba(255,255,255,0.15)';
    this.ctx.font = `${14 * scale}px sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText('v1.0 — Tap to select', cw / 2, ch - 20 * scale);
  }

  private renderPlayMenu(_menuState: MenuState, cw: number, ch: number, scale: number): void {
    // Subtitle
    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
    this.ctx.font = `${22 * scale}px sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('Choose Race Mode', cw / 2, ch * 0.35);

    const buttons = this.getMenuButtons({ screen: 'play', gamePhase: 'menu', bestTimes: [], soloMode: false }, cw, ch);
    const labels = ['RACE WITH BOTS', 'SOLO TIME TRIAL', '← BACK'];
    const accents = ['#e10600', '#00cc66', 'rgba(255,255,255,0.2)'];

    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      this.renderMenuButton(b.x, b.y, b.w, b.h, labels[i], scale, accents[i]);
    }
  }

  private renderRankingsScreen(menuState: MenuState, cw: number, _ch: number, scale: number): void {
    const { ctx } = this;
    const ch = _ch;

    // Rankings panel
    const panelW = 500 * scale;
    const panelH = 420 * scale;
    const panelX = (cw - panelW) / 2;
    const panelY = ch * 0.28;
    const panelR = 16 * scale;

    // Glass panel
    const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.stroke();

    // Header
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${28 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BEST TIMES', cw / 2, panelY + 35 * scale);

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 20 * scale, panelY + 60 * scale);
    ctx.lineTo(panelX + panelW - 20 * scale, panelY + 60 * scale);
    ctx.stroke();

    // Entries
    const times = menuState.bestTimes;
    if (times.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.font = `${20 * scale}px sans-serif`;
      ctx.fillText('No races completed yet', cw / 2, panelY + panelH / 2);
    } else {
      const rowH = 36 * scale;
      const startY = panelY + 80 * scale;
      for (let i = 0; i < Math.min(times.length, 8); i++) {
        const ry = startY + i * rowH;
        const entry = times[i];

        // Rank
        ctx.fillStyle = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.5)';
        ctx.font = `bold ${22 * scale}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}.`, panelX + 30 * scale, ry);

        // Position achieved
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${18 * scale}px sans-serif`;
        ctx.fillText(`P${entry.position}`, panelX + 70 * scale, ry);

        // Time
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${22 * scale}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(this.formatTime(entry.time), panelX + panelW - 30 * scale, ry);
      }
    }

    // Back button
    const buttons = this.getMenuButtons(menuState, cw, ch);
    for (const b of buttons) {
      this.renderMenuButton(b.x, b.y, b.w, b.h, '← BACK', scale, 'rgba(255,255,255,0.2)');
    }
  }

  private renderSettingsScreen(_menuState: MenuState, cw: number, ch: number, scale: number): void {
    const { ctx } = this;

    // Settings panel
    const panelW = 500 * scale;
    const panelH = 300 * scale;
    const panelX = (cw - panelW) / 2;
    const panelY = ch * 0.32;
    const panelR = 16 * scale;

    // Glass panel
    const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR);
    ctx.stroke();

    // Header
    ctx.fillStyle = '#4488cc';
    ctx.font = `bold ${28 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SETTINGS', cw / 2, panelY + 35 * scale);

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 20 * scale, panelY + 60 * scale);
    ctx.lineTo(panelX + panelW - 20 * scale, panelY + 60 * scale);
    ctx.stroke();

    // Placeholder content
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${20 * scale}px sans-serif`;
    ctx.fillText('Coming soon...', cw / 2, panelY + panelH / 2);

    // Back button
    const buttons = this.getMenuButtons(_menuState, cw, ch);
    for (const b of buttons) {
      this.renderMenuButton(b.x, b.y, b.w, b.h, '← BACK', scale, 'rgba(255,255,255,0.2)');
    }
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
