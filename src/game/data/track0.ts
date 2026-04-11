/**
 * Track 0 data — Extracted directly from Construct 3 data.json
 * Layout: "track0", Size: 13000 × 13000 pixels
 * 
 * All positions are in world pixels. Angles in radians.
 */

export interface Waypoint {
  id: number;
  x: number;
  y: number;
}

export interface StartCell {
  index: number;
  lane: number;
  x: number;
  y: number;
  angle: number; // radians
}

export interface Checkpoint {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export interface TrackData {
  name: string;
  width: number;
  height: number;
  laps: number;
  waypoints: Waypoint[];
  startCells: StartCell[];
  checkpoints: Checkpoint[];
  finishLine: Rect;
  boosters: Rect[];
  fences: Rect[];         // All fence collision barriers combined
  roadPieces: Rect[];     // trackPlain pieces
  trackTurns: (Rect & { lane: number })[];
  trackStripes: Rect[];
  trackStart: Rect;
  grassBounds: Rect;
  brakeAIZones: Rect[];
  // Decoration data
  bridges: Rect[];        // decoArch — overpass structures
  grandstands: Rect[];    // decoStands — spectator stands
  buildings: Rect[];      // decoBuildings — trackside structures
  trees: Rect[];          // decoTrees — dense tree areas
  palms: Rect[];          // decoPalms — palm tree clusters
  pitLane: Rect | null;   // trackPit — pit road surface
  pitMarks: Rect[];       // pitMarks — pit lane markings
  pitStop: {              // Detailed pit stop area
    garageBuilding: Rect; // Main garage building
    pitBoxes: Rect[];     // Individual team pit boxes
    pitEntry: { x1: number; y1: number; x2: number; y2: number }; // Entry road from track
    pitExit: { x1: number; y1: number; x2: number; y2: number };  // Exit road to track
  } | null;
}

export const TRACK0_DATA: TrackData = {
  name: 'track0',
  width: 13000,
  height: 13000,
  laps: 2,

  waypoints: [
    { id: 0, x: 1452, y: 4344 },
    { id: 1, x: 1474, y: 3652 },
    { id: 2, x: 1595, y: 3223 },
    { id: 3, x: 1706, y: 2584 },
    { id: 4, x: 1725, y: 1956 },
    { id: 5, x: 1923, y: 1541 },
    { id: 6, x: 2346, y: 1303 },
    { id: 7, x: 3082, y: 1284 },
    { id: 8, x: 3766, y: 1284 },
    { id: 9, x: 4568, y: 1291 },
    { id: 10, x: 4970, y: 1494 },
    { id: 11, x: 5196, y: 1921 },
    { id: 12, x: 5254, y: 2442 },
    { id: 13, x: 5559, y: 2924 },
    { id: 14, x: 6060, y: 3256 },
    { id: 15, x: 6610, y: 3319 },
    { id: 16, x: 7187, y: 3305 },
    { id: 17, x: 7601, y: 3071 },
    { id: 18, x: 8124, y: 2533 },
    { id: 19, x: 8727, y: 1916 },
    { id: 20, x: 9171, y: 1650 },
    { id: 21, x: 9669, y: 1613 },
    { id: 22, x: 10246, y: 1814 },
    { id: 23, x: 10652, y: 2207 },
    { id: 24, x: 10834, y: 2713 },
    { id: 25, x: 10802, y: 3232 },
    { id: 26, x: 10573, y: 3663 },
    { id: 27, x: 10221, y: 4065 },
    { id: 28, x: 9685, y: 4571 },
    { id: 29, x: 9062, y: 5185 },
    { id: 30, x: 8467, y: 5780 },
    { id: 31, x: 7884, y: 6406 },
    { id: 32, x: 7614, y: 6794 },
    { id: 33, x: 7624, y: 7316 },
    { id: 34, x: 7799, y: 7715 },
    { id: 35, x: 8167, y: 8070 },
    { id: 36, x: 8605, y: 8247 },
    { id: 37, x: 9100, y: 8304 },
    { id: 38, x: 9575, y: 8508 },
    { id: 39, x: 9915, y: 8836 },
    { id: 40, x: 10090, y: 9248 },
    { id: 41, x: 10119, y: 9688 },
    { id: 42, x: 9991, y: 10131 },
    { id: 43, x: 9700, y: 10502 },
    { id: 44, x: 9310, y: 10757 },
    { id: 45, x: 8786, y: 10841 },
    { id: 46, x: 7603, y: 10843 },
    { id: 47, x: 6276, y: 10846 },
    { id: 48, x: 5040, y: 10839 },
    { id: 49, x: 3761, y: 10840 },
    { id: 50, x: 2471, y: 10827 },
    { id: 51, x: 1902, y: 10588 },
    { id: 52, x: 1709, y: 10070 },
    { id: 53, x: 1716, y: 9129 },
    { id: 54, x: 1708, y: 8281 },
    { id: 55, x: 1615, y: 7730 },
    { id: 56, x: 1462, y: 7260 },
    { id: 57, x: 1462, y: 6255 },
    { id: 58, x: 1462, y: 5178 },
  ],

  startCells: [
    { index: 0, lane: 1, x: 1345, y: 6705, angle: 4.7124 },
    { index: 1, lane: 2, x: 1556, y: 6506, angle: 4.7124 },
    { index: 2, lane: 1, x: 1345, y: 6320, angle: 4.7124 },
    { index: 3, lane: 2, x: 1557, y: 6121, angle: 4.7124 },
    { index: 4, lane: 1, x: 1347, y: 5938, angle: 4.7124 },
    { index: 5, lane: 2, x: 1557, y: 5738, angle: 4.7124 },
    { index: 6, lane: 1, x: 1344, y: 5553, angle: 4.7124 },
    { index: 7, lane: 2, x: 1557, y: 5351, angle: 4.7124 },
    { index: 8, lane: 1, x: 1344, y: 5166, angle: 4.7124 },
    { index: 9, lane: 2, x: 1557, y: 4961, angle: 4.7124 },
    { index: 10, lane: 1, x: 1344, y: 4776, angle: 4.7124 },
    { index: 11, lane: 2, x: 1557, y: 4571, angle: 4.7124 },
  ],

  checkpoints: [
    { id: 0, x: 1415, y: 3960, w: 638, h: 15, angle: 0.0 },
    { id: 1, x: 4080, y: 1285, w: 845, h: 16, angle: 1.5708 },
    { id: 2, x: 6771, y: 3283, w: 882, h: 15, angle: 1.5708 },
    { id: 3, x: 10507, y: 1964, w: 1137, h: 15, angle: 2.3562 },
    { id: 4, x: 9351, y: 4926, w: 854, h: 15, angle: 3.9270 },
    { id: 5, x: 7956, y: 7930, w: 1200, h: 15, angle: 2.3562 },
    { id: 6, x: 10112, y: 9466, w: 980, h: 15, angle: 3.0543 },
    { id: 7, x: 7321, y: 10850, w: 886, h: 15, angle: 1.5708 },
    { id: 8, x: 2841, y: 10842, w: 857, h: 15, angle: 1.5708 },
    { id: 9, x: 1413, y: 6945, w: 646, h: 15, angle: 0.0 },
  ],

  finishLine: { x: 1451, y: 4344, w: 520, h: 57, angle: 0.0 },

  boosters: [
    { x: 1952, y: 10386, w: 125, h: 156, angle: 5.6928 },
    { x: 2899, y: 1442, w: 125, h: 156, angle: 1.5708 },
    { x: 10408, y: 4100, w: 125, h: 156, angle: 3.9270 },
    { x: 8218, y: 10855, w: 125, h: 156, angle: 4.7124 },
    { x: 6515, y: 3170, w: 125, h: 156, angle: 1.5708 },
    { x: 7838, y: 7466, w: 125, h: 156, angle: 2.7053 },
  ],

  // All fence barriers (fenceLong + fenceBlock + fenceCorner — used for collision)
  fences: [
    // fenceLong (39 pieces)
    { x: 2171, y: 2446, w: 692, h: 74, angle: 1.5708 },
    { x: 3450, y: 1756, w: 1865, h: 74, angle: 3.1416 },
    { x: 2429, y: 7104, w: 1165, h: 74, angle: 1.5708 },
    { x: 2304, y: 3004, w: 215, h: 74, angle: 0.7854 },
    { x: 2429, y: 3832, w: 1271, h: 74, angle: 1.5708 },
    { x: 2179, y: 8845, w: 1527, h: 74, angle: 1.5708 },
    { x: 1781, y: 5442, w: 3669, h: 74, angle: 1.5708 },
    { x: 2303, y: 1887, w: 218, h: 74, angle: 2.3562 },
    { x: 2308, y: 7874, w: 204, h: 74, angle: 2.3562 },
    { x: 4726, y: 2443, w: 692, h: 74, angle: 4.7124 },
    { x: 5199, y: 3319, w: 1189, h: 74, angle: 3.9141 },
    { x: 1048, y: 5918, w: 9317, h: 74, angle: 4.7124 },
    { x: 3250, y: 815, w: 3510, h: 74, angle: 0.0 },
    { x: 5748, y: 1834, w: 549, h: 74, angle: 1.5708 },
    { x: 6052, y: 2485, w: 698, h: 74, angle: 0.7854 },
    { x: 6784, y: 2782, w: 698, h: 74, angle: 0.0 },
    { x: 6604, y: 3785, w: 1735, h: 74, angle: 3.1416 },
    { x: 8385, y: 2940, w: 2255, h: 74, angle: 2.3562 },
    { x: 8227, y: 1767, w: 2713, h: 74, angle: 5.4978 },
    { x: 10960, y: 1519, w: 2011, h: 74, angle: 0.7854 },
    { x: 9949, y: 5001, w: 4870, h: 74, angle: 2.3562 },
    { x: 8609, y: 4991, w: 4893, h: 74, angle: 5.4978 },
    { x: 9494, y: 2087, w: 355, h: 74, angle: 3.1416 },
    { x: 5851, y: 11321, w: 8118, h: 74, angle: 3.1416 },
    { x: 5966, y: 10377, w: 6037, h: 74, angle: 0.0 },
    { x: 6836, y: 7255, w: 842, h: 74, angle: 4.7124 },
    { x: 7406, y: 8351, w: 1529, h: 74, angle: 3.9655 },
    { x: 8528, y: 8959, w: 976, h: 74, angle: 3.1416 },
    { x: 9340, y: 9203, w: 531, h: 74, angle: 3.9270 },
    { x: 9586, y: 9650, w: 250, h: 74, angle: 4.7124 },
    { x: 9325, y: 10116, w: 583, h: 74, angle: 5.4978 },
    { x: 10395, y: 2965, w: 321, h: 74, angle: 4.7124 },
    { x: 10069, y: 2408, w: 747, h: 74, angle: 3.9270 },
    { x: 8174, y: 6972, w: 227, h: 74, angle: 1.5708 },
    { x: 8462, y: 7455, w: 660, h: 74, angle: 0.7854 },
    { x: 9370, y: 7744, w: 1080, h: 74, angle: 0.0 },
    { x: 10654, y: 9532, w: 2090, h: 74, angle: 1.5708 },
    { x: 2524, y: 10030, w: 819, h: 74, angle: 0.7854 },
    { x: 4595, y: 1887, w: 215, h: 74, angle: 3.9270 },
    // fenceCorner (7 pieces)
    { x: 1238, y: 1004, w: 672, h: 137, angle: 5.4978 },
    { x: 5411, y: 1154, w: 1095, h: 136, angle: 0.7854 },
    { x: 9718, y: 760, w: 1105, h: 136, angle: 0.0 },
    { x: 11718, y: 2754, w: 1095, h: 136, angle: 1.5708 },
    { x: 10316, y: 8082, w: 1095, h: 136, angle: 0.7854 },
    { x: 10316, y: 10983, w: 1095, h: 136, angle: 2.3562 },
    { x: 1386, y: 10983, w: 1095, h: 136, angle: 3.9270 },
  ],

  roadPieces: [
    { x: 2988, y: 1284, w: 950, h: 520, angle: 0.0 },
    { x: 7552, y: 3108, w: 1068, h: 520, angle: 5.4978 },
    { x: 7805, y: 6475, w: 3271, h: 520, angle: 5.4978 },
    { x: 8349, y: 10855, w: 5364, h: 520, angle: 3.1416 },
    { x: 1708, y: 8572, w: 1451, h: 520, angle: 1.5708 },
  ],

  trackTurns: [
    { lane: 1, x: 6498, y: 3640, w: 1588, h: 1588, angle: 4.7124 },
    { lane: 2, x: 8452, y: 1774, w: 1588, h: 1588, angle: 0.7854 },
    { lane: 0, x: 1144, y: 3822, w: 1128, h: -1258, angle: 0.0 },
    { lane: 1, x: 7770, y: 2880, w: -760, h: 760, angle: 1.5708 },
    { lane: 2, x: 2476, y: 2052, w: 1076, h: 1076, angle: 0.0 },
    { lane: 2, x: 2474, y: 10087, w: 1076, h: 1076, angle: 4.7124 },
    { lane: 2, x: 4450, y: 2052, w: 1076, h: 1076, angle: 1.5708 },
    { lane: 0, x: 1144, y: 7078, w: 1128, h: 1258, angle: 0.0 },
    { lane: 2, x: 10697, y: 1773, w: 1588, h: 1588, angle: 2.3562 },
    { lane: 1, x: 8032, y: 6258, w: 760, h: 760, angle: 0.0 },
    { lane: 1, x: 8860, y: 8603, w: 1588, h: 1588, angle: 4.7124 },
    { lane: 2, x: 8860, y: 7987, w: 1588, h: 1588, angle: 1.5708 },
    { lane: 2, x: 10448, y: 9575, w: 1588, h: 1588, angle: 3.1416 },
  ],

  trackStripes: [
    { x: 2476, y: 1284, w: 512, h: 552, angle: 0.0 },
    { x: 1708, y: 2052, w: 512, h: 552, angle: 1.5708 },
    { x: 1708, y: 8336, w: 236, h: 552, angle: 1.5708 },
    { x: 3938, y: 1284, w: 513, h: 552, angle: 0.0 },
    { x: 6498, y: 3332, w: 512, h: 552, angle: 0.0 },
    { x: 8307, y: 2353, w: 512, h: 552, angle: 5.4978 },
    { x: 10118, y: 4162, w: 512, h: 552, angle: 5.4978 },
    { x: 8349, y: 10855, w: 512, h: 552, angle: 0.0 },
    { x: 2473, y: 10855, w: 512, h: 552, angle: 0.0 },
    { x: 1706, y: 10087, w: 491, h: 552, angle: 4.7124 },
  ],

  trackStart: { x: 1450, y: 5600, w: 3000, h: 520, angle: 1.5708 },

  grassBounds: { x: 0, y: 0, w: 13000, h: 13000, angle: 0 },

  brakeAIZones: [
    { x: 1673, y: 2437, w: 886, h: 16, angle: 3.1416 },
    { x: 3936, y: 1288, w: 886, h: 16, angle: 4.7124 },
    { x: 8377, y: 2299, w: 886, h: 16, angle: 3.9270 },
    { x: 8226, y: 6057, w: 886, h: 16, angle: 3.9270 },
    { x: 3248, y: 10844, w: 886, h: 16, angle: 4.7124 },
    { x: 9767, y: 8647, w: 886, h: 16, angle: 5.4978 },
  ],

  // === DECORATION DATA ===

  bridges: [
    { x: 1625, y: 8430, w: 1356, h: 98, angle: 0.0 },
    { x: 3280, y: 1283, w: 1134, h: 98, angle: 1.5708 },
    { x: 6892, y: 3272, w: 1134, h: 98, angle: 1.5708 },
    { x: 9537, y: 4726, w: 1134, h: 98, angle: 0.7854 },
    { x: 5449, y: 10847, w: 1134, h: 98, angle: 4.7124 },
  ],

  grandstands: [
    { x: 3282, y: 651, w: 2385, h: 336, angle: 0.0 },
    { x: 2596, y: 7060, w: 1200, h: 336, angle: 1.5708 },
    { x: 882, y: 5362, w: 7148, h: 336, angle: 4.7124 },
    { x: 6611, y: 4053, w: 2385, h: 336, angle: 3.1416 },
    { x: 8359, y: 4618, w: 3590, h: 336, angle: 5.4978 },
    { x: 5579, y: 11496, w: 5967, h: 336, angle: 3.1416 },
    { x: 11114, y: 1242, w: 2385, h: 336, angle: 0.7854 },
    { x: 7226, y: 8587, w: 1169, h: 336, angle: 3.9714 },
    { x: 2500, y: 9100, w: 2000, h: 336, angle: 1.5708 },
  ],

  buildings: [
    { x: 2561, y: 8245, w: 888, h: 345, angle: 1.5708 },
    { x: 8413, y: 1011, w: 810, h: 410, angle: 5.4978 },
    { x: 2517, y: 2436, w: 810, h: 410, angle: 1.5708 },
    { x: 8589, y: 10049, w: 888, h: 345, angle: 0.0 },
    { x: 9713, y: 2727, w: 810, h: 410, angle: 3.9048 },
    { x: 6315, y: 2212, w: 888, h: 345, angle: 0.7854 },
    { x: 8733, y: 7191, w: 888, h: 345, angle: 0.7854 },
    { x: 2763, y: 9825, w: 810, h: 410, angle: 0.7854 },
    { x: 4146, y: 10053, w: 888, h: 345, angle: 0.0 },
    { x: 3982, y: 2069, w: 888, h: 345, angle: 3.1416 },
    { x: 5865, y: 723, w: 888, h: 355, angle: 2.3562 },
    { x: 8473, y: 9279, w: 888, h: 355, angle: 3.1416 },
    { x: 10514, y: 7541, w: 888, h: 355, angle: 2.3562 },
    { x: 10887, y: 7906, w: 888, h: 355, angle: 2.3562 },
    { x: 1207, y: 11488, w: 888, h: 355, angle: 5.4978 },
    { x: 879, y: 11140, w: 888, h: 355, angle: 5.4978 },
  ],

  trees: [
    { x: 4664, y: 9443, w: 3372, h: 841, angle: 0.0 },
    { x: 6, y: 17, w: 9488, h: 284, angle: 0.0 },
    { x: 519, y: 586, w: 8378, h: 511, angle: 1.5708 },
    { x: 7806, y: 4410, w: 553, h: 2370, angle: 1.5708 },
    { x: 6776, y: 236, w: 1973, h: 1398, angle: 0.7854 },
    { x: 534, y: 515, w: 1131, h: 562, angle: 5.9016 },
    { x: 4617, y: 2974, w: 1131, h: 1629, angle: 0.7854 },
    { x: 6887, y: 5766, w: 564, h: 1114, angle: 0.7854 },
    { x: 5901, y: 6976, w: 849, h: 1407, angle: 0.0 },
    { x: 2291, y: 8754, w: 1412, h: 563, angle: 0.0 },
    { x: 104, y: 10700, w: 1681, h: 835, angle: 4.7124 },
  ],

  palms: [
    { x: 2805, y: 1860, w: 566, h: 561, angle: 0.0 },
    { x: 3460, y: 2307, w: 1083, h: 561, angle: 0.0 },
    { x: 8543, y: 6623, w: 4763, h: 559, angle: 5.4978 },
    { x: 7705, y: 3903, w: 1948, h: 822, angle: 5.4978 },
    { x: 8806, y: 388, w: 1406, h: 267, angle: 0.0 },
    { x: 11856, y: 3312, w: 1107, h: 841, angle: 4.7124 },
    { x: 10799, y: 10793, w: 2532, h: 843, angle: 4.7124 },
    { x: 10310, y: 11981, w: 571, h: 1124, angle: 3.9270 },
    { x: 10186, y: 12414, w: 8957, h: 560, angle: 3.1416 },
  ],

  pitLane: { x: 1950, y: 5325, w: 4200, h: 700, angle: 1.5708 },

  pitMarks: [],

  pitStop: {
    // Main garage building — long building behind pit boxes
    garageBuilding: { x: 2500, y: 5250, w: 3000, h: 350, angle: 1.5708 },
    // 10 team pit boxes along the pit lane (each ~280 units apart, flush with lane)
    pitBoxes: [
      { x: 2250, y: 3950, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 4230, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 4510, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 4790, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 5070, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 5350, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 5630, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 5910, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 6190, w: 250, h: 200, angle: 0 },
      { x: 2250, y: 6470, w: 250, h: 200, angle: 0 },
    ],
    // Pit entry: curves from main road to pit lane (at bottom)
    pitEntry: { x1: 1700, y1: 13500, x2: 2150, y2: 6700 },
    // Pit exit: curves from pit lane back to main road (at top)
    pitExit: { x1: 2150, y1: 3950, x2: 1700, y2: -1500 },
  },
};
