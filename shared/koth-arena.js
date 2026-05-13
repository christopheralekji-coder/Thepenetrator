// KING OF THE HILL — central capture-zone, FFA, first to X points.
// Använder gungame-storleken (3500×2000) men med fast central zon istället
// för fri-roam. Zone-position roterar var 60s mellan 4 hot-spots så spelare
// inte sätter sig i hörn.
'use strict';

const KOTH_ARENA = {
  worldW: 3500,
  worldH: 2000,
  name: 'KING OF THE HILL',

  // Spawn-punkter (samma som gungame — symmetriskt utspridda)
  spawns: [
    { x: 300,  y: 300 },
    { x: 3200, y: 300 },
    { x: 300,  y: 1700 },
    { x: 3200, y: 1700 },
    { x: 1750, y: 200 },
    { x: 1750, y: 1800 },
    { x: 200,  y: 1000 },
    { x: 3300, y: 1000 },
  ],

  // Capture-zoner. Servern roterar mellan dessa var 60s.
  // En zon är aktiv åt gången — visas tydligt på minimap + arena.
  zones: [
    { x: 1750, y: 1000, r: 180, name: 'MID' },       // central
    { x: 700,  y: 700,  r: 150, name: 'NW' },        // top-left quad
    { x: 2800, y: 1300, r: 150, name: 'SE' },        // bottom-right quad
    { x: 2800, y: 700,  r: 150, name: 'NE' },        // top-right quad
  ],

  // Walls — samma cover-design som gungame
  walls: [
    { x: 1700, y: 950, w: 100, h: 30, kind: 'sandbag' },
    { x: 1700, y: 1020, w: 100, h: 30, kind: 'sandbag' },
    { x: 1665, y: 920, w: 30, h: 160, kind: 'sandbag' },
    { x: 1805, y: 920, w: 30, h: 160, kind: 'sandbag' },
    { x: 1200, y: 700, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 1200, y: 1100, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 2260, y: 700, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 2260, y: 1100, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 250, y: 450, w: 80, h: 30, kind: 'sandbag' },
    { x: 3220, y: 450, w: 80, h: 30, kind: 'sandbag' },
    { x: 250, y: 1520, w: 80, h: 30, kind: 'sandbag' },
    { x: 3220, y: 1520, w: 80, h: 30, kind: 'sandbag' },
    { x: 600, y: 950, w: 80, h: 80, kind: 'crate' },
    { x: 2820, y: 950, w: 80, h: 80, kind: 'crate' },
    { x: 880, y: 750, w: 50, h: 50, kind: 'debris' },
    { x: 880, y: 1200, w: 50, h: 50, kind: 'debris' },
    { x: 2570, y: 750, w: 50, h: 50, kind: 'debris' },
    { x: 2570, y: 1200, w: 50, h: 50, kind: 'debris' },
  ],

  decorations: [
    { kind: 'sign', x: 1650, y: 150, w: 200, h: 32, text: '👑 KOTH 👑', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'graffiti', x: 1750, y: 600, text: 'HOLD THE HILL', color: '#ffd54a', size: 22, rot: -0.08 },
    { kind: 'graffiti', x: 500, y: 1000, text: 'KING', color: '#ffd54a', size: 28, rot: -0.1 },
    { kind: 'graffiti', x: 3000, y: 1000, text: 'CROWN', color: '#ffd54a', size: 28, rot: 0.1 },
    { kind: 'lantern', x: 200, y: 200, color: '#ffd54a' },
    { kind: 'lantern', x: 3300, y: 200, color: '#ffd54a' },
    { kind: 'lantern', x: 200, y: 1800, color: '#ffd54a' },
    { kind: 'lantern', x: 3300, y: 1800, color: '#ffd54a' },
  ],

  // Match-config
  targetPoints: 100,         // First to 100 vinner
  zoneRotateSec: 45,         // Sek innan zone-byter
  pointsPerSecond: 1,        // +1 pt/sek per spelare i zon (oavsett count)
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KOTH_ARENA };
}
if (typeof window !== 'undefined') {
  window.KOTH_ARENA = KOTH_ARENA;
}
