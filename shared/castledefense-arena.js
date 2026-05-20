// CASTLE DEFENSE — co-op tower defense mode (v1.397 redesign)
//
// Spelare försvarar tillsammans en central BAS (ancient obelisk) mot endless vågor
// av fiender som spawnar 360° runt utkanten. Ingen pre-built mur — spelare bygger
// ALLA defenses från scratch. Fienden targetar bara basen.
//
// Karta: 4000×4000 px. Visuellt: gräs-fält + central stenplaza + spridda dekorationer
// (träd, stenar, facklor). Stenvägar leder från varje spawn-punkt mot center.
//
'use strict';

const CASTLEDEFENSE_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'OBELISK KEEP',
  groundColor: '#2e3e22',           // mörk-grön gräs-bas
  plazaColor: '#5a5450',            // sten-plaza runt basen
  pathColor: '#6a5a48',             // sten-vägar från spawnar mot center

  // Castle-center (basen)
  centerX: 2000,
  centerY: 2000,
  plazaRadius: 220,                 // visuell stenplaza-radie

  // === CORE / BAS ===
  // Stor stone-obelisk med glowing runes. HP-pool för game-over.
  // Större och tydligare än v1.395 så det känns som ett mål värt att försvara.
  core: {
    x: 2000,
    y: 2000,
    r: 80,                          // 50→80 (större och mer prominent)
    hp: 5000,                       // 3000→5000 (mer rum för 8s wave-pauser med skadat skal)
    maxHp: 5000,
    color: '#d4a04a',
    glowColor: '#ffe080',
    runeColor: '#5acaff',
  },

  // === PRE-BUILT WALLS ===
  // INGA — fas-redesign v1.397: spelare bygger ALLT från scratch.
  walls: [],

  // === PLAYER SPAWN-POINTS ===
  // 4 punkter strax utanför core (35px) så de inte spawnar inne i obelisken.
  playerSpawns: [
    { x: 1880, y: 1880 },
    { x: 2120, y: 1880 },
    { x: 1880, y: 2120 },
    { x: 2120, y: 2120 },
  ],

  // === ENEMY SPAWN-RING ===
  // 16 punkter runt map-edges (360° spridning).
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

  // === DECORATIONS (visual only — ingen collision) ===
  // Stenvägar, träd, klippblock, facklor, banderoller. Server skickar inte dessa —
  // klienten läser direkt från denna konstant så ingen bandbredd-cost.
  decorations: [
    // === FACKLOR runt core (4 st kardinalriktningar, brinner med flamma) ===
    { kind: 'torch', x: 2000, y: 1820 },   // N
    { kind: 'torch', x: 2180, y: 2000 },   // E
    { kind: 'torch', x: 2000, y: 2180 },   // S
    { kind: 'torch', x: 1820, y: 2000 },   // W
    // === BANDEROLLER vid 4 diagonaler ===
    { kind: 'banner', x: 1880, y: 1820, color: '#aa3030' },
    { kind: 'banner', x: 2120, y: 1820, color: '#3a3aaa' },
    { kind: 'banner', x: 1880, y: 2180, color: '#3aaa3a' },
    { kind: 'banner', x: 2120, y: 2180, color: '#aa8a30' },
    // === TRÄD (utanför plaza men på map) ===
    { kind: 'tree', x:  500, y:  900, r: 28 }, { kind: 'tree', x:  800, y:  600, r: 24 },
    { kind: 'tree', x: 1100, y:  450, r: 26 }, { kind: 'tree', x: 1600, y:  600, r: 22 },
    { kind: 'tree', x: 2400, y:  500, r: 25 }, { kind: 'tree', x: 2900, y:  650, r: 28 },
    { kind: 'tree', x: 3200, y:  450, r: 23 }, { kind: 'tree', x: 3500, y:  900, r: 27 },
    { kind: 'tree', x: 3600, y: 1500, r: 24 }, { kind: 'tree', x: 3550, y: 2400, r: 26 },
    { kind: 'tree', x: 3450, y: 2900, r: 23 }, { kind: 'tree', x: 3200, y: 3400, r: 28 },
    { kind: 'tree', x: 2700, y: 3550, r: 25 }, { kind: 'tree', x: 2100, y: 3450, r: 26 },
    { kind: 'tree', x: 1400, y: 3500, r: 24 }, { kind: 'tree', x:  900, y: 3300, r: 27 },
    { kind: 'tree', x:  500, y: 2900, r: 25 }, { kind: 'tree', x:  450, y: 2300, r: 23 },
    { kind: 'tree', x:  550, y: 1600, r: 26 }, { kind: 'tree', x:  650, y: 1200, r: 22 },
    // Klippblock (visual rocks)
    { kind: 'rock', x: 1200, y:  900, r: 22 }, { kind: 'rock', x: 2900, y:  800, r: 18 },
    { kind: 'rock', x: 3300, y: 1800, r: 24 }, { kind: 'rock', x: 3100, y: 3100, r: 20 },
    { kind: 'rock', x: 1700, y: 3300, r: 22 }, { kind: 'rock', x:  800, y: 2600, r: 24 },
    { kind: 'rock', x:  700, y: 1800, r: 20 }, { kind: 'rock', x: 1500, y: 1200, r: 18 },
    { kind: 'rock', x: 2500, y: 1300, r: 20 }, { kind: 'rock', x: 2700, y: 2900, r: 22 },
    { kind: 'rock', x: 1300, y: 2700, r: 19 }, { kind: 'rock', x: 3050, y: 2200, r: 21 },
    // Gräs-tofsar / blommor — micro-detalj
    { kind: 'grass_tuft', x: 1100, y: 1500 }, { kind: 'grass_tuft', x: 1300, y: 1800 },
    { kind: 'grass_tuft', x: 2700, y: 1500 }, { kind: 'grass_tuft', x: 2500, y: 2200 },
    { kind: 'grass_tuft', x: 1500, y: 2500 }, { kind: 'grass_tuft', x: 2800, y: 2600 },
    { kind: 'grass_tuft', x: 1100, y: 2400 }, { kind: 'grass_tuft', x: 2900, y: 1900 },
  ],

  // === STENVÄGAR ===
  // Linjer från enemy-spawnar mot center (visual cues för player vart fienden kommer från).
  // Beräknas dynamiskt på klient från enemySpawns + centerX/Y.

  // === PLAYER START-STATE ===
  startHp: 100,
  maxHp: 100,
  startShield: 0,
  maxShield: 0,
  startWeapon: 'rifle',

  // === DOWN-STATE (fas 6) ===
  downBleedoutSec: 25,
  downReviveSec: 4,
  downCrawlSpeedMul: 0.5,
  downReviveRadius: 60,

  // === WAVE-SCALING ===
  waveBaseCount: 6,
  waveScalePerWave: 2,
  waveBetweenSec: 10,                // 8→10 (mer tid att bygga utan pre-built walls)
  bossEveryWave: 5,

  // === BUILD-SYSTEM ===
  buildGridSize: 30,
  startGold: 600,                    // 400→600 (mer gold när inget är pre-built)
  waveBonusBase: 180,                // 150→180
  waveBonusPerWave: 35,              // 30→35
  buildables: {
    wall:        { cost: 50,  hp: 400,  w: 30, h: 30 },
    auto_turret: { cost: 400, hp: 140,  w: 30, h: 30, range: 280, dps: 25, fireRate: 2.5 },
    man_turret:  { cost: 500, hp: 350,  w: 30, h: 30, range: 400, dpsMul: 2.5 },
    spike_trap:  { cost: 100, hp: 150,  w: 30, h: 30, dmgOnPass: 22 },
    slow_trap:   { cost: 150, hp: 120,  w: 30, h: 30, slowMul: 0.4, slowDurSec: 2 },
    repair_stn:  { cost: 180, hp: 200,  w: 30, h: 30, healPerSec: 14, radius: 100 },
    health_stn:  { cost: 250, hp: 150,  w: 30, h: 30, playerHealPerSec: 12, radius: 140 },
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CASTLEDEFENSE_ARENA };
}
if (typeof window !== 'undefined') {
  window.CASTLEDEFENSE_ARENA = CASTLEDEFENSE_ARENA;
}
