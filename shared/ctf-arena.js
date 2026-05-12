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
  // Naming: bs=base, top=top, mid=mid, bot=bot, pil=pillar, cr=crate
  walls: [
    // === RED BASE U-shape (öppen mot höger/mitten) ===
    // Top wall
    { x: 100,  y: 1100, w: 360, h: 30, kind: 'wall_red_base' },
    // Bottom wall
    { x: 100,  y: 1670, w: 360, h: 30, kind: 'wall_red_base' },
    // Back-left wall (deep behind flag)
    { x: 100,  y: 1130, w: 30,  h: 540, kind: 'wall_red_base' },

    // === BLUE BASE U-shape (mirrored) ===
    { x: 4040, y: 1100, w: 360, h: 30, kind: 'wall_blue_base' },
    { x: 4040, y: 1670, w: 360, h: 30, kind: 'wall_blue_base' },
    { x: 4370, y: 1130, w: 30,  h: 540, kind: 'wall_blue_base' },

    // === CENTER PILLAR (vertikalt — bryter direkt sikt) ===
    { x: 2230, y: 1100, w: 40,  h: 600, kind: 'wall_pillar' },

    // === MID-LANE COVER ===
    // Mitten av mid-zone, två crates på vardera sida av pillaren
    { x: 1700, y: 1350, w: 70,  h: 100, kind: 'crate' },
    { x: 2730, y: 1350, w: 70,  h: 100, kind: 'crate' },

    // === TOP LANE COVER (mirrored crates) ===
    { x: 900,  y: 700,  w: 80,  h: 80, kind: 'crate' },
    { x: 1600, y: 600,  w: 80,  h: 80, kind: 'crate' },
    { x: 2210, y: 500,  w: 80,  h: 80, kind: 'crate' },
    { x: 2900, y: 600,  w: 80,  h: 80, kind: 'crate' },
    { x: 3520, y: 700,  w: 80,  h: 80, kind: 'crate' },

    // === BOTTOM LANE COVER (mirrored crates) ===
    { x: 900,  y: 2020, w: 80,  h: 80, kind: 'crate' },
    { x: 1600, y: 2120, w: 80,  h: 80, kind: 'crate' },
    { x: 2210, y: 2220, w: 80,  h: 80, kind: 'crate' },
    { x: 2900, y: 2120, w: 80,  h: 80, kind: 'crate' },
    { x: 3520, y: 2020, w: 80,  h: 80, kind: 'crate' },

    // === LANE-DIVIDERS — låga väggar som skiljer top/mid/bot lanes ===
    // Top-mid divider (vänster + höger om center)
    { x: 950,  y: 1000, w: 240, h: 22, kind: 'wall_divider' },
    { x: 3310, y: 1000, w: 240, h: 22, kind: 'wall_divider' },
    // Mid-bot divider
    { x: 950,  y: 1780, w: 240, h: 22, kind: 'wall_divider' },
    { x: 3310, y: 1780, w: 240, h: 22, kind: 'wall_divider' },

    // === SIDE COVER nära baser (för base-defenders) ===
    // Crates strax framför bas-öppningen
    { x: 540,  y: 1300, w: 60,  h: 60, kind: 'crate' },
    { x: 540,  y: 1440, w: 60,  h: 60, kind: 'crate' },
    { x: 3900, y: 1300, w: 60,  h: 60, kind: 'crate' },
    { x: 3900, y: 1440, w: 60,  h: 60, kind: 'crate' },
  ],
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

// Bullet wall-hit: returnera true om bullet träffat någon wall (för att markera dead)
function bulletHitsWall(b, walls) {
  for (const w of walls) {
    if (b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h) {
      return true;
    }
  }
  return false;
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
