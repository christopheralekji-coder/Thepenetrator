// CASTLE DEFENSE — co-op tower defense mode
//
// Spelare försvarar tillsammans ett centralt castle (8 wall-segment + central core)
// mot endless vågor av fiender som spawnar på 360° runt utkanten. Bygg + reparera
// mellan attacker. Boss var 5:e våg.
//
// Karta: 4000×4000 px (mindre än BR — vi vill ha tight försvar)
// Castle: 600×600 inner area, centrerad på (2000, 2000)
// Layout: 8 wall-segment formar en square med 4 gates (en på varje sida, 80px gap)
//
'use strict';

const CASTLEDEFENSE_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'CASTLE KEEP',
  groundColor: '#2a3520',

  // Castle-center
  centerX: 2000,
  centerY: 2000,

  // === CORE (centrum) ===
  // Om HP når 0 → game over. Synlig som en sten-pillar/crystal i mitten.
  core: {
    x: 2000,
    y: 2000,
    r: 50,
    hp: 3000,
    maxHp: 3000,
    color: '#d4a04a',
    glowColor: '#ffe080',
  },

  // === WALLS ===
  // 8 wall-segment: 2 per sida (north/south/east/west). Gates i mitten på varje sida (80px gap).
  // Wall är 260px lång, 30px tjock. Varje segment har egen HP (kan repareras).
  // Player kollision via resolveCtfWall (samma format som CTF/BR), så fält {x,y,w,h} krävs.
  // Bullets stoppas via bulletHitsWall.
  // Layout: N/S walls inset 30px från hörn så W/E walls äger hörn-rutorna.
  // Förhindrar overlap-jitter när bossar med stor radie pushas i hörnen.
  walls: [
    // NORTH (y:1700) — wall_north_left + wall_north_right, gate vid x:1960-2040
    { id: 'wall_n_l', x: 1730, y: 1700, w: 230, h: 30, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'north' },
    { id: 'wall_n_r', x: 2040, y: 1700, w: 230, h: 30, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'north' },
    // SOUTH (y:2270) — gate vid x:1960-2040
    { id: 'wall_s_l', x: 1730, y: 2270, w: 230, h: 30, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'south' },
    { id: 'wall_s_r', x: 2040, y: 2270, w: 230, h: 30, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'south' },
    // WEST (x:1700) — gate vid y:1960-2040 — äger hörn-cell
    { id: 'wall_w_t', x: 1700, y: 1700, w: 30, h: 260, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'west' },
    { id: 'wall_w_b', x: 1700, y: 2040, w: 30, h: 260, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'west' },
    // EAST (x:2270) — gate vid y:1960-2040 — äger hörn-cell
    { id: 'wall_e_t', x: 2270, y: 1700, w: 30, h: 260, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'east' },
    { id: 'wall_e_b', x: 2270, y: 2040, w: 30, h: 260, kind: 'castle_wall', hp: 800, maxHp: 800, side: 'east' },
  ],

  // === PLAYER SPAWN-POINTS ===
  // 4 punkter inne i castle, runt core. Distribueras till spelare via pickSpreadSpawns.
  playerSpawns: [
    { x: 1900, y: 1900 },
    { x: 2100, y: 1900 },
    { x: 1900, y: 2100 },
    { x: 2100, y: 2100 },
  ],

  // === ENEMY SPAWN-RING ===
  // 16 punkter runt map-edges (360° spridning). Wave-spawnern picks random från denna lista.
  enemySpawns: [
    // North edge
    { x: 600,  y: 200 }, { x: 1400, y: 200 }, { x: 2000, y: 200 }, { x: 2600, y: 200 }, { x: 3400, y: 200 },
    // East edge
    { x: 3800, y: 600 }, { x: 3800, y: 1400 }, { x: 3800, y: 2600 }, { x: 3800, y: 3400 },
    // South edge
    { x: 3400, y: 3800 }, { x: 2600, y: 3800 }, { x: 2000, y: 3800 }, { x: 1400, y: 3800 }, { x: 600, y: 3800 },
    // West edge
    { x: 200, y: 3400 }, { x: 200, y: 2600 }, { x: 200, y: 1400 }, { x: 200, y: 600 },
  ],

  // === PLAYER START-STATE ===
  startHp: 100,
  maxHp: 100,
  startShield: 0,
  maxShield: 0,
  startWeapon: 'rifle',

  // === DOWN-STATE (fas 6) ===
  downBleedoutSec: 25,        // 30→25 från playtest (kortare död-väntan)
  downReviveSec: 4,           // 5→4 (snabbare revive i kaotiska vågor)
  downCrawlSpeedMul: 0.5,     // 0.35→0.5 (downade kan nå lagkamrater)
  downReviveRadius: 60,       // 40→60 (lättare att lyckas)

  // === WAVE-SCALING (fas 2) ===
  waveBaseCount: 6,           // wave 1 = 6 enemies
  waveScalePerWave: 2,        // +2 per wave
  waveBetweenSec: 8,          // 8 sek paus mellan vågor
  bossEveryWave: 5,           // boss-våg var 5:e

  // === BUILD-SYSTEM (fas 3-4) — justerad efter balance-review ===
  buildGridSize: 30,
  startGold: 400,             // 200→400 från playtest — räcker till 1 turret + wall + spike
  waveBonusBase: 150,         // 100→150
  waveBonusPerWave: 30,       // 25→30
  buildables: {
    wall:        { cost: 50,  hp: 400,  w: 30, h: 30 },
    auto_turret: { cost: 400, hp: 140,  w: 30, h: 30, range: 280, dps: 25, fireRate: 2.5 },  // +cost, -hp så det inte dominerar
    man_turret:  { cost: 500, hp: 350,  w: 30, h: 30, range: 400, dpsMul: 2.5 },             // dpsMul 1.5→2.5 (annars dominated)
    spike_trap:  { cost: 100, hp: 150,  w: 30, h: 30, dmgOnPass: 22 },                       // 30→22 (one-shottar inte längre grunt)
    slow_trap:   { cost: 150, hp: 120,  w: 30, h: 30, slowMul: 0.4, slowDurSec: 2 },
    repair_stn:  { cost: 180, hp: 200,  w: 30, h: 30, healPerSec: 14, radius: 100 },         // -cost, +heal
    health_stn:  { cost: 250, hp: 150,  w: 30, h: 30, playerHealPerSec: 12, radius: 140 },   // buff
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CASTLEDEFENSE_ARENA };
}
if (typeof window !== 'undefined') {
  window.CASTLEDEFENSE_ARENA = CASTLEDEFENSE_ARENA;
}
