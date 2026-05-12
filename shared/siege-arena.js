// Shared SIEGE THE BASE arena. Symmetrisk 5000×3000 med 6 capture-bases,
// 2 destructible cores (15000 HP, extremt svår att förstöra), turrets per
// lag, mängder med cover. Vinst: 100 poäng ELLER destroy enemy core.
'use strict';

const SIEGE_ARENA = {
  worldW: 5000,
  worldH: 3000,
  name: 'SIEGE GROUNDS',

  // Spawn-points: 4 per lag, nära sin egna sida + sin home-base
  spawns: {
    red:  [
      { x: 200, y: 1300 },
      { x: 200, y: 1700 },
      { x: 400, y: 1200 },
      { x: 400, y: 1800 },
    ],
    blue: [
      { x: 4800, y: 1300 },
      { x: 4800, y: 1700 },
      { x: 4600, y: 1200 },
      { x: 4600, y: 1800 },
    ],
  },

  // === CORES — 250×250 byggnader, EXTREMT tanky (15000 HP). Att förstöra
  // dem är en backup-win-villkor — primärt vinner man på 100 poäng. ===
  cores: [
    { id: 'core_red',  team: 'red',  x: 425, y: 1375, w: 250, h: 250, maxHp: 15000 },
    { id: 'core_blue', team: 'blue', x: 4325, y: 1375, w: 250, h: 250, maxHp: 15000 },
  ],

  // === 6 CAPTURE-BASES — alla startar NEUTRALA (grå). Stå 10s uncontested
  // för att capturera. Om enemy äger: stå 5s för att NEUTRALISERA, sedan 10s
  // för att capturera (totalt 15s). Båda lag på basen = paus. ===
  bases: [
    { id: 'base_red_home',  x: 850,  y: 1500, r: 80, startOwner: null },
    { id: 'base_blue_home', x: 4150, y: 1500, r: 80, startOwner: null },
    { id: 'base_tl', x: 1800, y: 800,  r: 80, startOwner: null },
    { id: 'base_tr', x: 3200, y: 800,  r: 80, startOwner: null },
    { id: 'base_bl', x: 1800, y: 2200, r: 80, startOwner: null },
    { id: 'base_br', x: 3200, y: 2200, r: 80, startOwner: null },
  ],
  captureTimeSec: 10.0,      // 10s från neutral → capture
  neutralizeTimeSec: 5.0,    // 5s för att neutralisera enemy-base

  // === TURRETS — 2 per lag. Varje lag har 1 MACHINEGUN + 1 ROCKET LAUNCHER ===
  turrets: [
    { id: 'siege_turret_red_mg',     team: 'red',  x: 700,  y: 1300, maxHp: 1500, r: 22, weaponId: 'turret_mg',     turretType: 'mg' },
    { id: 'siege_turret_red_rocket', team: 'red',  x: 700,  y: 1700, maxHp: 1500, r: 22, weaponId: 'turret_rocket', turretType: 'rocket' },
    { id: 'siege_turret_blue_mg',     team: 'blue', x: 4300, y: 1300, maxHp: 1500, r: 22, weaponId: 'turret_mg',     turretType: 'mg' },
    { id: 'siege_turret_blue_rocket', team: 'blue', x: 4300, y: 1700, maxHp: 1500, r: 22, weaponId: 'turret_rocket', turretType: 'rocket' },
  ],
  turretEnterRadius: 50,

  // === WALLS — core-byggnader (som AABB), defensive walls, mid-cover ===
  walls: [
    // === RED CORE-byggnad (4 väggar runt 250×250-block, lämnar inre tom så
    // det kan visuellt "förstöras" senare) ===
    { x: 425,  y: 1375, w: 250, h: 30,  kind: 'wall_red_base', coreId: 'core_red' },
    { x: 425,  y: 1595, w: 250, h: 30,  kind: 'wall_red_base', coreId: 'core_red' },
    { x: 425,  y: 1405, w: 30,  h: 190, kind: 'wall_red_base', coreId: 'core_red' },
    { x: 645,  y: 1405, w: 30,  h: 190, kind: 'wall_red_base', coreId: 'core_red' },

    // === BLUE CORE-byggnad ===
    { x: 4325, y: 1375, w: 250, h: 30,  kind: 'wall_blue_base', coreId: 'core_blue' },
    { x: 4325, y: 1595, w: 250, h: 30,  kind: 'wall_blue_base', coreId: 'core_blue' },
    { x: 4325, y: 1405, w: 30,  h: 190, kind: 'wall_blue_base', coreId: 'core_blue' },
    { x: 4545, y: 1405, w: 30,  h: 190, kind: 'wall_blue_base', coreId: 'core_blue' },

    // === Mid-arena pillars (taktiska break-LoS-pelare) ===
    { x: 2480, y: 800,  w: 40, h: 200, kind: 'wall_pillar' },
    { x: 2480, y: 2000, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 1280, y: 1400, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 3680, y: 1400, w: 40, h: 200, kind: 'wall_pillar' },

    // === Mid-zon cover (sandbags + crates) ===
    { x: 2400, y: 1450, w: 100, h: 30, kind: 'sandbag' },
    { x: 2500, y: 1450, w: 100, h: 30, kind: 'sandbag' },
    { x: 2350, y: 1500, w: 30,  h: 100, kind: 'sandbag' },
    { x: 2620, y: 1500, w: 30,  h: 100, kind: 'sandbag' },
    { x: 2360, y: 1350, w: 50,  h: 50, kind: 'crate' },
    { x: 2590, y: 1350, w: 50,  h: 50, kind: 'crate' },
    { x: 2360, y: 1600, w: 50,  h: 50, kind: 'crate' },
    { x: 2590, y: 1600, w: 50,  h: 50, kind: 'crate' },

    // === TOP-base 1 cover (kring base_tl 1800,800) ===
    { x: 1650, y: 700,  w: 60, h: 60, kind: 'crate' },
    { x: 1880, y: 700,  w: 60, h: 60, kind: 'crate' },
    { x: 1700, y: 880,  w: 100, h: 25, kind: 'sandbag' },
    { x: 1880, y: 880,  w: 100, h: 25, kind: 'sandbag' },
    { x: 1600, y: 600,  w: 32, h: 32, kind: 'barrel' },
    { x: 2000, y: 600,  w: 32, h: 32, kind: 'barrel' },

    // === TOP-base 2 cover (kring base_tr 3200,800) ===
    { x: 3050, y: 700,  w: 60, h: 60, kind: 'crate' },
    { x: 3280, y: 700,  w: 60, h: 60, kind: 'crate' },
    { x: 3100, y: 880,  w: 100, h: 25, kind: 'sandbag' },
    { x: 3280, y: 880,  w: 100, h: 25, kind: 'sandbag' },
    { x: 3000, y: 600,  w: 32, h: 32, kind: 'barrel' },
    { x: 3400, y: 600,  w: 32, h: 32, kind: 'barrel' },

    // === BOT-bases mirror ===
    { x: 1650, y: 2240, w: 60, h: 60, kind: 'crate' },
    { x: 1880, y: 2240, w: 60, h: 60, kind: 'crate' },
    { x: 1700, y: 2095, w: 100, h: 25, kind: 'sandbag' },
    { x: 1880, y: 2095, w: 100, h: 25, kind: 'sandbag' },
    { x: 1600, y: 2360, w: 32, h: 32, kind: 'barrel' },
    { x: 2000, y: 2360, w: 32, h: 32, kind: 'barrel' },

    { x: 3050, y: 2240, w: 60, h: 60, kind: 'crate' },
    { x: 3280, y: 2240, w: 60, h: 60, kind: 'crate' },
    { x: 3100, y: 2095, w: 100, h: 25, kind: 'sandbag' },
    { x: 3280, y: 2095, w: 100, h: 25, kind: 'sandbag' },
    { x: 3000, y: 2360, w: 32, h: 32, kind: 'barrel' },
    { x: 3400, y: 2360, w: 32, h: 32, kind: 'barrel' },

    // === Lane-cover längs vägen mot mid ===
    { x: 1100, y: 1100, w: 80, h: 80, kind: 'crate' },
    { x: 1100, y: 1820, w: 80, h: 80, kind: 'crate' },
    { x: 3820, y: 1100, w: 80, h: 80, kind: 'crate' },
    { x: 3820, y: 1820, w: 80, h: 80, kind: 'crate' },
    { x: 1500, y: 1200, w: 50, h: 50, kind: 'debris' },
    { x: 1500, y: 1750, w: 50, h: 50, kind: 'debris' },
    { x: 3450, y: 1200, w: 50, h: 50, kind: 'debris' },
    { x: 3450, y: 1750, w: 50, h: 50, kind: 'debris' },

    // === Pipes på marken (atmosfär + cover) ===
    { x: 2200, y: 1100, w: 200, h: 18, kind: 'pipe' },
    { x: 2600, y: 1100, w: 200, h: 18, kind: 'pipe' },
    { x: 2200, y: 1880, w: 200, h: 18, kind: 'pipe' },
    { x: 2600, y: 1880, w: 200, h: 18, kind: 'pipe' },

    // === Barricader längs sidor ===
    { x: 900,  y: 1100, w: 120, h: 22, kind: 'barricade' },
    { x: 900,  y: 1880, w: 120, h: 22, kind: 'barricade' },
    { x: 3980, y: 1100, w: 120, h: 22, kind: 'barricade' },
    { x: 3980, y: 1880, w: 120, h: 22, kind: 'barricade' },

    // === Dividers som markerar lanes ===
    { x: 1300, y: 1000, w: 200, h: 22, kind: 'wall_divider' },
    { x: 3500, y: 1000, w: 200, h: 22, kind: 'wall_divider' },
    { x: 1300, y: 1980, w: 200, h: 22, kind: 'wall_divider' },
    { x: 3500, y: 1980, w: 200, h: 22, kind: 'wall_divider' },
  ],

  // === DECORATIONS — atmosphere ===
  decorations: [
    // Core-skyltar
    { kind: 'sign', x: 425, y: 1320, w: 250, h: 32, text: '🛡 RED CORE', bg: '#5a1010', fg: '#ffd54a' },
    { kind: 'sign', x: 4325, y: 1320, w: 250, h: 32, text: '🛡 BLUE CORE', bg: '#102050', fg: '#88ccff' },
    // Skyltar vid bases
    { kind: 'sign', x: 770,  y: 1430, w: 160, h: 22, text: 'HOME', bg: '#3a0808', fg: '#ff9090', size: 11 },
    { kind: 'sign', x: 4070, y: 1430, w: 160, h: 22, text: 'HOME', bg: '#082040', fg: '#a0c8ff', size: 11 },
    // Mid-zone skyltar
    { kind: 'sign', x: 2400, y: 350, w: 200, h: 32, text: '⚔ SIEGE GROUNDS', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'sign', x: 2350, y: 1250, w: 100, h: 24, text: '⚠ HOT ZONE', bg: '#3a1a08', fg: '#ffd54a', rot: -0.1 },
    { kind: 'sign', x: 2550, y: 1670, w: 100, h: 24, text: '⚠ NO MAN\'S LAND', bg: '#3a1a08', fg: '#ffd54a', rot: 0.1 },
    // Graffiti
    { kind: 'graffiti', x: 1900, y: 950, text: 'HOLD THE LINE', color: '#ffaa30', size: 22, rot: -0.08 },
    { kind: 'graffiti', x: 3000, y: 950, text: 'PUSH IT', color: '#ff5a3a', size: 22, rot: 0.08 },
    { kind: 'graffiti', x: 1900, y: 2400, text: 'DEFEND', color: '#5a5a5a', size: 22, rot: 0.08 },
    { kind: 'graffiti', x: 3000, y: 2400, text: 'ASSAULT', color: '#ff5a3a', size: 22, rot: -0.08 },
    { kind: 'graffiti', x: 2400, y: 250, text: 'WAR ZONE', color: '#ddd', size: 20, rot: 0 },
    // Direction-pilar
    { kind: 'sign', x: 800,  y: 100, w: 100, h: 22, text: '← RED', bg: '#1a0a0a', fg: '#ff8080', size: 11 },
    { kind: 'sign', x: 4100, y: 100, w: 100, h: 22, text: 'BLUE →', bg: '#0a0a1a', fg: '#80a0ff', size: 11 },
    // Lyktor vid baser
    { kind: 'lantern', x: 730,  y: 1400, color: '#ff7a3a' },
    { kind: 'lantern', x: 730,  y: 1600, color: '#ff7a3a' },
    { kind: 'lantern', x: 4270, y: 1400, color: '#3a7aff' },
    { kind: 'lantern', x: 4270, y: 1600, color: '#3a7aff' },
    // Team-flaggor i hörn
    { kind: 'flag_decoration', x: 250, y: 1200, team: 'red' },
    { kind: 'flag_decoration', x: 250, y: 1800, team: 'red' },
    { kind: 'flag_decoration', x: 4750, y: 1200, team: 'blue' },
    { kind: 'flag_decoration', x: 4750, y: 1800, team: 'blue' },
  ],
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIEGE_ARENA };
}
if (typeof window !== 'undefined') {
  window.SIEGE_ARENA = SIEGE_ARENA;
}
