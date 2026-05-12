// Shared CTF arena-data — server + client laddar samma layout så walls + flag-
// positioner + spawns är 100% synkade.
//
// Arena är 4500×2800, symmetrisk på X-axeln. Röd vänster (x<2250), blå höger.
// Walls/cover är AABB-rektanglar med {x,y,w,h}. Bullets dör vid wall-hit (server).
// Spelar-rörelse blockeras vid wall-overlap (klient + server).
//
// Design-principer:
// 1. Symmetri: varje wall på röd sida har spegelbild på blå sida (X-flip kring 2250).
// 2. Tre lanes: top/mid/bot. Mid har center-pillar som bryter direkt flagga→flagga-sikt.
// 3. Bas-U: U-formad wall öppen mot mitten — defender har naturligt cover.
// 4. Spawn-säkerhet: 4 spawn-points per lag, alla bakom bas-wallarna.
// 5. Capture-zon: 50px radie runt egen flag-stand, där enemy-carrier scorar.
'use strict';

const CTF_ARENA = {
  worldW: 4500,
  worldH: 2800,
  name: 'BATTLEGROUND',

  // Flag-stands (placerade djupt i varje bas)
  flags: {
    red:  { baseX: 280,  baseY: 1400 },
    blue: { baseX: 4220, baseY: 1400 },
  },

  // Capture-radius: enemy carrier måste vara inom denna distans till sin egen
  // flag-stand för att score (egen flagga måste också vara hemma)
  captureRadius: 50,

  // Pickup-radius: spelare inom denna distans till flagga kan plocka upp
  pickupRadius: 28,

  // Spawn-points per lag (4 var). Spread runt flag-stand så respawn inte spawn-camps.
  spawns: {
    red:  [
      { x: 180,  y: 1180 },
      { x: 380,  y: 1180 },
      { x: 180,  y: 1620 },
      { x: 380,  y: 1620 },
    ],
    blue: [
      { x: 4120, y: 1180 },
      { x: 4320, y: 1180 },
      { x: 4120, y: 1620 },
      { x: 4320, y: 1620 },
    ],
  },

  // Walls = AABB-rektanglar. Bullets + spelare blockeras vid overlap.
  // Kinds: wall_red_base, wall_blue_base, wall_pillar, wall_divider, crate,
  // sandbag (låg gul), barrel (rund explosivt look, fortfarande AABB), debris
  // (random skrot), barricade (träbarrikad), pipe (rör-bit i mitten).
  walls: [
    // === RED BASE U-shape (öppen mot höger/mitten) ===
    { x: 100,  y: 1100, w: 360, h: 30, kind: 'wall_red_base' },
    { x: 100,  y: 1670, w: 360, h: 30, kind: 'wall_red_base' },
    { x: 100,  y: 1130, w: 30,  h: 540, kind: 'wall_red_base' },

    // === BLUE BASE U-shape (mirrored) ===
    { x: 4040, y: 1100, w: 360, h: 30, kind: 'wall_blue_base' },
    { x: 4040, y: 1670, w: 360, h: 30, kind: 'wall_blue_base' },
    { x: 4370, y: 1130, w: 30,  h: 540, kind: 'wall_blue_base' },

    // === CENTER PILLAR + extra mid-pillars (taktiska hörn-peek) ===
    { x: 2230, y: 1100, w: 40,  h: 600, kind: 'wall_pillar' },
    { x: 1850, y: 800,  w: 40,  h: 200, kind: 'wall_pillar' },
    { x: 2610, y: 800,  w: 40,  h: 200, kind: 'wall_pillar' },
    { x: 1850, y: 1800, w: 40,  h: 200, kind: 'wall_pillar' },
    { x: 2610, y: 1800, w: 40,  h: 200, kind: 'wall_pillar' },

    // === MID-LANE COVER (utbyggt) ===
    { x: 1700, y: 1350, w: 70,  h: 100, kind: 'crate' },
    { x: 2730, y: 1350, w: 70,  h: 100, kind: 'crate' },
    // Sandbag-stack mitt i (low cover, bra för crouch-feel)
    { x: 2100, y: 1400, w: 120, h: 30, kind: 'sandbag' },
    { x: 2280, y: 1400, w: 120, h: 30, kind: 'sandbag' },
    // Barrels (looks explosive — kan utökas senare till faktisk explode)
    { x: 2080, y: 1250, w: 28,  h: 28, kind: 'barrel' },
    { x: 2390, y: 1250, w: 28,  h: 28, kind: 'barrel' },
    { x: 2080, y: 1530, w: 28,  h: 28, kind: 'barrel' },
    { x: 2390, y: 1530, w: 28,  h: 28, kind: 'barrel' },
    // Pipe-bitar (rör som sträcker sig över marken)
    { x: 2000, y: 1100, w: 250, h: 16, kind: 'pipe' },
    { x: 2250, y: 1700, w: 250, h: 16, kind: 'pipe' },

    // === TOP LANE COVER (varierat) ===
    { x: 900,  y: 700,  w: 80,  h: 80, kind: 'crate' },
    { x: 1600, y: 600,  w: 80,  h: 80, kind: 'crate' },
    { x: 2210, y: 500,  w: 80,  h: 80, kind: 'crate' },
    { x: 2900, y: 600,  w: 80,  h: 80, kind: 'crate' },
    { x: 3520, y: 700,  w: 80,  h: 80, kind: 'crate' },
    // Sandbag-rader i toppen
    { x: 1200, y: 400,  w: 180, h: 25, kind: 'sandbag' },
    { x: 3000, y: 400,  w: 180, h: 25, kind: 'sandbag' },
    // Barricader (träbalkar)
    { x: 1450, y: 850,  w: 100, h: 20, kind: 'barricade' },
    { x: 2950, y: 850,  w: 100, h: 20, kind: 'barricade' },
    // Debris-skrot
    { x: 1100, y: 580,  w: 45,  h: 45, kind: 'debris' },
    { x: 3300, y: 580,  w: 45,  h: 45, kind: 'debris' },
    // Toppen-barrels
    { x: 1900, y: 350,  w: 28,  h: 28, kind: 'barrel' },
    { x: 2570, y: 350,  w: 28,  h: 28, kind: 'barrel' },

    // === BOTTOM LANE COVER (mirrored, varierat) ===
    { x: 900,  y: 2020, w: 80,  h: 80, kind: 'crate' },
    { x: 1600, y: 2120, w: 80,  h: 80, kind: 'crate' },
    { x: 2210, y: 2220, w: 80,  h: 80, kind: 'crate' },
    { x: 2900, y: 2120, w: 80,  h: 80, kind: 'crate' },
    { x: 3520, y: 2020, w: 80,  h: 80, kind: 'crate' },
    { x: 1200, y: 2380, w: 180, h: 25, kind: 'sandbag' },
    { x: 3000, y: 2380, w: 180, h: 25, kind: 'sandbag' },
    { x: 1450, y: 1930, w: 100, h: 20, kind: 'barricade' },
    { x: 2950, y: 1930, w: 100, h: 20, kind: 'barricade' },
    { x: 1100, y: 2180, w: 45,  h: 45, kind: 'debris' },
    { x: 3300, y: 2180, w: 45,  h: 45, kind: 'debris' },
    { x: 1900, y: 2430, w: 28,  h: 28, kind: 'barrel' },
    { x: 2570, y: 2430, w: 28,  h: 28, kind: 'barrel' },

    // === LANE-DIVIDERS (utökat) ===
    { x: 950,  y: 1000, w: 240, h: 22, kind: 'wall_divider' },
    { x: 3310, y: 1000, w: 240, h: 22, kind: 'wall_divider' },
    { x: 950,  y: 1780, w: 240, h: 22, kind: 'wall_divider' },
    { x: 3310, y: 1780, w: 240, h: 22, kind: 'wall_divider' },
    // Extra dividers längre ut mot baserna
    { x: 600,  y: 920,  w: 180, h: 18, kind: 'wall_divider' },
    { x: 3720, y: 920,  w: 180, h: 18, kind: 'wall_divider' },
    { x: 600,  y: 1860, w: 180, h: 18, kind: 'wall_divider' },
    { x: 3720, y: 1860, w: 180, h: 18, kind: 'wall_divider' },

    // === SIDE COVER nära baser (utökat) ===
    { x: 540,  y: 1300, w: 60,  h: 60, kind: 'crate' },
    { x: 540,  y: 1440, w: 60,  h: 60, kind: 'crate' },
    { x: 3900, y: 1300, w: 60,  h: 60, kind: 'crate' },
    { x: 3900, y: 1440, w: 60,  h: 60, kind: 'crate' },
    // Extra debris precis utanför baserna (kontrollerar 'corridors')
    { x: 700,  y: 1200, w: 36,  h: 36, kind: 'debris' },
    { x: 700,  y: 1580, w: 36,  h: 36, kind: 'debris' },
    { x: 3764, y: 1200, w: 36,  h: 36, kind: 'debris' },
    { x: 3764, y: 1580, w: 36,  h: 36, kind: 'debris' },
    // Sandbag-skydd bredvid turret-position (förrär dess flank)
    { x: 460,  y: 1240, w: 80,  h: 20, kind: 'sandbag' },
    { x: 460,  y: 1540, w: 80,  h: 20, kind: 'sandbag' },
    { x: 3960, y: 1240, w: 80,  h: 20, kind: 'sandbag' },
    { x: 3960, y: 1540, w: 80,  h: 20, kind: 'sandbag' },
  ],

  // === DECORATIONS — icke-blockerande visuella element (skyltar, klotter,
  // graffiti, lyktor, flaggor). Bara render, kollar inte collision. ===
  decorations: [
    // ====== RED BASE ======
    // RED HQ-skylt ovanför top-wall (y=1100-1130) så den syns helt
    { kind: 'sign', x: 280, y: 1040, w: 200, h: 36, text: '🚩 RED HQ', bg: '#5a1010', fg: '#ffd54a' },
    // Trash-talk på back-wall (uppe vid baksidan, inte över flagga)
    { kind: 'sign', x: 200, y: 1180, w: 140, h: 24, text: 'BLUE = NOOBS', bg: '#3a0808', fg: '#ff9090', rot: -0.06 },
    // Graffiti placerad OVANFÖR och NEDANFÖR flagga (280, 1400) — inte över den
    { kind: 'graffiti', x: 250, y: 1230, text: 'RED 4 LIFE', color: '#ff3030', size: 26, rot: -0.1 },
    { kind: 'graffiti', x: 260, y: 1580, text: 'VI ÄGER', color: '#ff5a3a', size: 24, rot: 0.08 },
    // Streetart utanför baseöppningen
    { kind: 'graffiti', x: 530, y: 1180, text: 'BLUE STINKS', color: '#ff4040', size: 18, rot: -0.05 },
    { kind: 'graffiti', x: 530, y: 1640, text: 'EZ CLAP', color: '#ff5a3a', size: 18, rot: 0.05 },
    // Team-flaggor på pinnarna i hörnen
    { kind: 'flag_decoration', x: 150, y: 1150, team: 'red' },
    { kind: 'flag_decoration', x: 150, y: 1650, team: 'red' },
    // Lyktor (flyttade utanför flag-area)
    { kind: 'lantern', x: 180, y: 1200, color: '#ff7a3a' },
    { kind: 'lantern', x: 180, y: 1600, color: '#ff7a3a' },
    // Wanted-poster (mot top, ej över flagga)
    { kind: 'sign', x: 380, y: 1160, w: 90, h: 60, text: 'WANTED:\nBLUE\nFLAGS', bg: '#2a0808', fg: '#ffd54a', size: 9, rot: -0.05 },

    // ====== BLUE BASE ======
    { kind: 'sign', x: 4220, y: 1040, w: 200, h: 36, text: '🚩 BLUE HQ', bg: '#102050', fg: '#88ccff' },
    { kind: 'sign', x: 4220, y: 1180, w: 140, h: 24, text: 'RED = SUS', bg: '#082040', fg: '#a0c8ff', rot: 0.06 },
    { kind: 'graffiti', x: 4190, y: 1230, text: 'BLÅ FOR LIFE', color: '#3060ff', size: 26, rot: 0.1 },
    { kind: 'graffiti', x: 4200, y: 1580, text: 'NO RED ZONE', color: '#3060ff', size: 24, rot: -0.08 },
    { kind: 'graffiti', x: 3930, y: 1180, text: 'GET REKT', color: '#4080ff', size: 18, rot: 0.05 },
    { kind: 'graffiti', x: 3930, y: 1640, text: 'L + RATIO', color: '#4080ff', size: 18, rot: -0.05 },
    { kind: 'flag_decoration', x: 4360, y: 1150, team: 'blue' },
    { kind: 'flag_decoration', x: 4360, y: 1650, team: 'blue' },
    { kind: 'lantern', x: 4320, y: 1200, color: '#3a7aff' },
    { kind: 'lantern', x: 4320, y: 1600, color: '#3a7aff' },
    { kind: 'sign', x: 4030, y: 1160, w: 90, h: 60, text: 'WANTED:\nRED\nFLAGS', bg: '#080828', fg: '#88ccff', size: 9, rot: 0.05 },

    // ====== MID-ARENA NEUTRAL ======
    { kind: 'sign', x: 2150, y: 200, w: 200, h: 32, text: 'BATTLEGROUND', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'sign', x: 1500, y: 1380, w: 80, h: 24, text: '⚠ DANGER', bg: '#3a1a08', fg: '#ffd54a', rot: -0.1 },
    { kind: 'sign', x: 2900, y: 1380, w: 80, h: 24, text: '⚠ HOT ZONE', bg: '#3a1a08', fg: '#ffd54a', rot: 0.1 },
    // Mid-graffiti
    { kind: 'graffiti', x: 2200, y: 350, text: 'WAR ZONE', color: '#ffaa30', size: 28, rot: 0 },
    { kind: 'graffiti', x: 2180, y: 2500, text: 'KILL OR DIE', color: '#dd5a3a', size: 24, rot: 0 },
    { kind: 'graffiti', x: 1700, y: 900, text: 'NO MERCY', color: '#ff5a3a', size: 22, rot: -0.1 },
    { kind: 'graffiti', x: 2800, y: 900, text: 'GIT GUD', color: '#ff5a3a', size: 22, rot: 0.1 },
    { kind: 'graffiti', x: 1700, y: 1950, text: 'RIP', color: '#5a5a5a', size: 30, rot: 0.15 },
    { kind: 'graffiti', x: 2800, y: 1950, text: '☠ HERE', color: '#5a5a5a', size: 22, rot: -0.15 },
    // Pilar-markings mot baserna
    { kind: 'sign', x: 700, y: 100, w: 100, h: 22, text: '← RED', bg: '#1a0a0a', fg: '#ff8080', size: 11 },
    { kind: 'sign', x: 3700, y: 100, w: 100, h: 22, text: 'BLUE →', bg: '#0a0a1a', fg: '#80a0ff', size: 11 },
  ],

  // === MACHINEGUN-TURRETS — ett per lag, just utanför basen ===
  // Tunga prickskytt-positioner. Spelare kan mounta för en kraftig MG men
  // turret hp = 1500 betyder den tål kanske ~75 rifle-shots / ~16 sniper-shots
  // innan den brinner. Kan inte enter igen efter destroyed.
  turrets: [
    { id: 'turret_red',  team: 'red',  x: 600,  y: 1400, maxHp: 1500, r: 22 },
    { id: 'turret_blue', team: 'blue', x: 3900, y: 1400, maxHp: 1500, r: 22 },
  ],
  turretEnterRadius: 50,
  // MG-stats när spelaren mounted: höga DPS, ingen reload
  turretWeapon: {
    id: 'turret_mg',
    name: 'Turret MG',
    dmg: 14,
    rate: 75,        // ms mellan skott (~13 shots/sec)
    speed: 1100,
    spread: 0.07,
    r: 5,
    color: '#ff5a3a',
    mag: 9999,
    reload: 0,
  },
};

// AABB-collision: returnera true om punkt (x, y, r) overlap med wall
function pointInWall(x, y, r, wall) {
  return x + r >= wall.x &&
         x - r <= wall.x + wall.w &&
         y + r >= wall.y &&
         y - r <= wall.y + wall.h;
}

// Lös wall-collision för entity (player/companion). Push ut ur närmsta wall-kant.
function resolveCtfWall(entity, walls) {
  for (const w of walls) {
    if (!pointInWall(entity.x, entity.y, entity.r || 14, w)) continue;
    // Räkna ut overlap per axel; push ut åt minsta riktning
    const dxLeft = (entity.x + (entity.r || 14)) - w.x;
    const dxRight = (w.x + w.w) - (entity.x - (entity.r || 14));
    const dyTop = (entity.y + (entity.r || 14)) - w.y;
    const dyBot = (w.y + w.h) - (entity.y - (entity.r || 14));
    const minPush = Math.min(dxLeft, dxRight, dyTop, dyBot);
    if (minPush === dxLeft) entity.x -= dxLeft;
    else if (minPush === dxRight) entity.x += dxRight;
    else if (minPush === dyTop) entity.y -= dyTop;
    else entity.y += dyBot;
  }
}

// Bullet wall-hit: swept-segment kollision från förra positionen till nuvarande.
// Krävs för snabba bullets (sniper @ 1500 px/s = 33 px/frame, tunnlade tidigare
// genom 22px-tjocka dividers). Använd b._prevX/b._prevY om de finns (updateBullets
// sätter dem). Fallback: point-in-rect + radie så åtminstone träffar registreras.
function bulletHitsWall(b, walls) {
  const r = (b.r || 4);
  // Snabb-väg: om bullet redan står i en wall (eller dess radie överlappar)
  for (const w of walls) {
    if (b.x + r >= w.x && b.x - r <= w.x + w.w &&
        b.y + r >= w.y && b.y - r <= w.y + w.h) {
      return true;
    }
  }
  // Swept-test: linje från förra pos till nuvarande pos
  if (typeof b._prevX === 'number' && typeof b._prevY === 'number') {
    const x0 = b._prevX, y0 = b._prevY, x1 = b.x, y1 = b.y;
    for (const w of walls) {
      if (segmentIntersectsAABB(x0, y0, x1, y1, w.x - r, w.y - r, w.x + w.w + r, w.y + w.h + r)) {
        return true;
      }
    }
  }
  return false;
}
// Liang-Barsky line-vs-AABB clip — returnerar true om segmentet träffar boxen.
function segmentIntersectsAABB(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  const dx = x1 - x0, dy = y1 - y0;
  let tMin = 0, tMax = 1;
  const checks = [
    { p: -dx, q: x0 - minX },
    { p:  dx, q: maxX - x0 },
    { p: -dy, q: y0 - minY },
    { p:  dy, q: maxY - y0 },
  ];
  for (const c of checks) {
    if (c.p === 0) {
      if (c.q < 0) return false;
    } else {
      const t = c.q / c.p;
      if (c.p < 0) { if (t > tMax) return false; if (t > tMin) tMin = t; }
      else         { if (t < tMin) return false; if (t < tMax) tMax = t; }
    }
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CTF_ARENA, pointInWall, resolveCtfWall, bulletHitsWall };
}
if (typeof window !== 'undefined') {
  window.CTF_ARENA = CTF_ARENA;
  window.pointInWall = pointInWall;
  window.resolveCtfWall = resolveCtfWall;
  window.bulletHitsWall = bulletHitsWall;
}
