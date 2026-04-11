/**
 * Game configuration data — from pc.json, trk.json, tmc.json
 */

// === UPGRADES (from pc.json) ===
// Each upgrade: [baseValue, currentLevel, costPerLevel]
// 6 categories: engine, gearbox, steering, brakes, grip, unused
export const UPGRADE_DEFAULTS = {
  engine:   { base: 850, level: 1, cost: 2500 },
  gearbox:  { base: 15,   level: 1, cost: 2500 },
  steering: { base: 150,  level: 1, cost: 2500 },
  brakes:   { base: 400,  level: 1, cost: 2500 },
  grip:     { base: 110,  level: 1, cost: 2500 },
};

// Multipliers per upgrade level
export const UPGRADE_MULTIPLIERS = {
  engine:   1.02,  // maxSpeed
  gearbox:  1.21,  // steerSpeed (gearbox = steer ratio)
  steering: 1.02,  // steerSpeed additional
  brakes:   1.045, // deceleration
  grip:     1.05,  // grip threshold
};

// === TRACKS (from trk.json) ===
// Laps per track (tracks 0-9)
export const TRACK_LAPS = [2, 3, 4, 3, 3, 4, 4, 4, 4, 5];

// === TEAMS (from tmc.json) ===
export const TEAMS = [
  { name: 'Bluestone', price: 0 },      // Free (default)
  { name: 'Panda',     price: 2000 },
  { name: 'Hamilton',  price: 3000 },
  { name: 'Stallion',  price: 5000 },
  { name: 'Crimson',   price: 6000 },
  { name: 'Aqua',      price: 7000 },
  { name: 'Accelero',  price: 8000 },
  { name: 'Cognitive',  price: 9000 },
  { name: 'Petrogas',  price: 9500 },
  { name: 'Marlins',   price: 10000 },
  { name: 'Nova One',  price: 10000 },
  { name: 'Eclipse',   price: 11000 },
  { name: 'Thunder',   price: 12000 },
  { name: 'Tempest',   price: 13000 },
  { name: 'Hero Racing', price: 14000 },
  { name: 'Hornets',   price: 14000 },
  { name: 'Sharks',    price: 15000 },
  { name: 'Tornado',   price: 17000 },
];

// === TEAM COLORS (mapped from livery frames) ===
export const TEAM_COLORS: string[] = [
  '#2255CC', // Bluestone - Blue
  '#111111', // Panda - Black/White
  '#CC2222', // Hamilton - Red
  '#CC8800', // Stallion - Orange
  '#880022', // Crimson - Crimson
  '#00AAAA', // Aqua - Cyan
  '#CCCC00', // Accelero - Yellow
  '#6644AA', // Cognitive - Purple
  '#228822', // Petrogas - Green
  '#0066CC', // Marlins - Navy
  '#FF4400', // Nova One - Orange-Red
  '#333333', // Eclipse - Dark Gray
  '#FFCC00', // Thunder - Gold
  '#00CCCC', // Tempest - Teal
  '#CC0044', // Hero Racing - Magenta
  '#88AA00', // Hornets - Yellow-Green
  '#4488CC', // Sharks - Steel Blue
  '#CC4400', // Tornado - Deep Orange
];

// === GEAR SYSTEM ===
export const GEARS = [
  { gear: 0, name: 'N', decel: 500, speedThreshold: 0 },
  { gear: 1, name: '1', decel: 600, speedThreshold: 0 },
  { gear: 2, name: '2', decel: 500, speedThreshold: 0.15 },
  { gear: 3, name: '3', decel: 400, speedThreshold: 0.30 },
  { gear: 4, name: '4', decel: 300, speedThreshold: 0.50 },
  { gear: 5, name: '5', decel: 220, speedThreshold: 0.70 },
  { gear: 6, name: '6', decel: 200, speedThreshold: 0.85 },
];

// === BOOSTER ===
export const BOOSTER = {
  speedMultiplier: 1.35,  // maxSpeed × 1.35 during boost
  decelOverride: 6.1,     // Very low deceleration during boost
  duration: 1000,         // milliseconds
};
