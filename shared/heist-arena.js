// HEIST — Storbanken
//
// 3-fas PvE coop (1-8 spelare): STEALTH → ALARM → EXTRACT.
// Solo viable + upp till 8 spelare (skalning via guard/civilian/polis-count).
//
// MAP-LAYOUT (4000×4000):
//
//   y=0      ─────────────────────────────────────────────
//   y=400          [back alley + dumpsters + back-van]
//   y=700    ═════════════════════════════════════════════
//   y=1000   │ SERVER │  V A U L T  R O O M  │ MANAGER  │
//   y=1300   │ ROOM   │  [drill] [cash stacks]│ OFFICE  │
//   y=1600   │[terms] │  [gold stacks]        │ [safe]  │
//   y=1900   │        │  ═══[VAULT DOOR]═══   │ [desk]  │
//   y=2000   └────────┴──────────────────────┴─────────┘
//   y=2200          HALLWAY  (connects vault → lobby)
//   y=2400          ┌──────────────────────────┐
//   y=2500          │ CASHIER COUNTER ROW      │
//   y=2700          └──────────────────────────┘
//   y=2800
//   y=3100              MAIN LOBBY (ATMs, plants, pillars)
//   y=3300
//   y=3400   ═════════════[FRONT DOOR]═════════════════════
//   y=3700        STREET + GETAWAY VAN + civilians
//   y=4000   ─────────────────────────────────────────────
//
// PHASE-FLOW:
//   STEALTH (start, max 4 min) — Infiltrera, undvik kameror + vakter, hacka
//   terminaler för att slå ut kameror, lockpicka bakdörren för stealth-extract.
//   Trigger ALARM: civilian skriker, vakt spottar dig, camera-detect, eller timeout.
//
//   ALARM (efter trigger) — Drilla valvet (2 min), grabba säckar, försvara mot
//   polis-vågor. Loot-säckar saktar dig 40%. Du måste få in dem i van.
//
//   EXTRACT (när drill klar + lots looted) — Få ut säckarna till getaway-van inom
//   60s. Polisen blir mer aggressiv. Lyckas = WIN. Misslyckas = LOSE.
//
'use strict';

const HEIST_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'STORBANKEN',

  // Visual region-färger
  streetColor:     '#2a2a30',  // asfalt
  sidewalkColor:   '#7a7568',  // betong
  bankFloorColor:  '#a8906a',  // marmor-golv
  vaultFloorColor: '#3a2a1a',  // mörkt valv-stål
  carpetColor:     '#4a2a30',  // röd matta (manager + lobby-mitten)
  serverFloorColor:'#1a2a3a',  // svalt blå (server-rum)

  // === MATCH-CONFIG ===
  matchDurationSec:    720,    // 12 min total
  stealthPhaseMaxSec:  180,    // v1.625: 3 min (var 4) — för få mandatory actions
  alarmPhaseMaxSec:    480,    // v1.625: 8 min cap — förhindrar match-lock
  drillDurationSec:    120,    // 2 min valv-drill
  extractDurationSec:  60,     // 1 min extract-fönster

  // === PLAYER SPAWNS (street utanför front-door, 8 platser) ===
  maxPlayers: 8,
  playerSpawns: [
    { x: 1800, y: 3800 },
    { x: 1900, y: 3800 },
    { x: 2000, y: 3800 },
    { x: 2100, y: 3800 },
    { x: 2200, y: 3800 },
    { x: 1850, y: 3900 },
    { x: 2050, y: 3900 },
    { x: 2150, y: 3900 },
  ],

  // === SCALING (multipliers baserat på antal spelare) ===
  // v1.624: höjt policeMulPerPlayer 0.25 → 0.55 så 8p inte är trivialt.
  // 1p = 1.0×, 4p = 2.65×, 8p = 4.85× (mer linjär)
  // Guard/loot/civilian scaling oimplementerat (data dead, lämnat för framtida iter).
  scaling: {
    policeMulPerPlayer: 0.55,     // 1p=1.0, 4p=2.65, 8p=4.85
    guardMulPerPlayer:  0.10,     // UNUSED iter 4
    lootMulPerPlayer:   0.15,     // UNUSED iter 4
    civilianMulPerPlayer: 0.05,   // UNUSED iter 4
  },

  // Player start-state
  startHp: 100, maxHp: 100,
  startShield: 0, maxShield: 100,
  // v1.624: start med 'fists' så civilians inte instant-panikar (stealth-möjligt).
  // Player byter till pistol via vapen-menyn när alarm triggas (eller manuellt).
  startWeapon: 'fists',
  startGrenades: 0,            // ingen granat i stealth-fas

  // === EXTRACTION ZONES ===
  // Front van är primary extraction (alltid open). Back-alley låst tills lockpickad.
  extractZones: {
    front: { x: 2000, y: 3700, w: 200, h: 100, kind: 'van_front', locked: false },
    back:  { x: 1950, y: 400,  w: 100, h: 100, kind: 'van_back',  locked: true  },
  },

  // === WALLS (AABB collision för player + bullets) ===
  // top-left coords + width/height. kind styr rendering.
  walls: [
    // === OUTER BANK WALLS (south & north har gaps för dörrar) ===
    // North wall (med back-alley gap x=1900-2000)
    { x: 600,  y: 700,  w: 1300, h: 30, kind: 'wall' },
    { x: 2000, y: 700,  w: 1400, h: 30, kind: 'wall' },
    // South wall (med front-door gap x=1900-2100)
    { x: 600,  y: 3400, w: 1300, h: 30, kind: 'wall' },
    { x: 2100, y: 3400, w: 1300, h: 30, kind: 'wall' },
    // West outer
    { x: 600,  y: 730,  w: 30, h: 2700, kind: 'wall' },
    // East outer
    { x: 3370, y: 730,  w: 30, h: 2700, kind: 'wall' },

    // === VAULT ROOM (north center: x=1300-2700, y=730-1900) ===
    // Vault west wall
    { x: 1300, y: 730,  w: 30, h: 1170, kind: 'wall_vault' },
    // Vault east wall
    { x: 2670, y: 730,  w: 30, h: 1170, kind: 'wall_vault' },
    // Vault south wall — split för VAULT DOOR (gap x=1900-2100)
    { x: 1330, y: 1870, w: 570, h: 30, kind: 'wall_vault' },
    { x: 2100, y: 1870, w: 570, h: 30, kind: 'wall_vault' },

    // === SERVER ROOM (northwest: x=630-1300, y=730-2000) ===
    // Server east wall (separerar mot vault)
    // (vault west wall vid 1300 är redan utlagd ovan)
    // Server south wall — split för server-door (gap x=820-900)
    { x: 630,  y: 1970, w: 190, h: 30, kind: 'wall' },
    { x: 900,  y: 1970, w: 400, h: 30, kind: 'wall' },

    // === MANAGER OFFICE (northeast: x=2700-3370, y=730-2000) ===
    // Manager west wall (separerar mot vault) — vault east-wall vid 2670 finns
    // Manager south wall — split för office-door (gap x=3100-3180)
    { x: 2700, y: 1970, w: 400, h: 30, kind: 'wall' },
    { x: 3180, y: 1970, w: 190, h: 30, kind: 'wall' },

    // === CASHIER COUNTER ROW (mitt-bank, y=2400) ===
    // Counter-segments — playern kan inte gå igenom, men kan SKJUTA över
    { x: 1300, y: 2400, w: 230, h: 50, kind: 'counter' },
    { x: 1570, y: 2400, w: 230, h: 50, kind: 'counter' },
    { x: 1840, y: 2400, w: 230, h: 50, kind: 'counter' },
    { x: 2110, y: 2400, w: 230, h: 50, kind: 'counter' },
    { x: 2380, y: 2400, w: 230, h: 50, kind: 'counter' },
    // Counter har gap vid 2400-2440 + 2620-2670 (cashier-entries)

    // === LOBBY PILLARS (cover + estetik) ===
    { x: 1080, y: 2750, w: 50, h: 50, kind: 'pillar' },
    { x: 2870, y: 2750, w: 50, h: 50, kind: 'pillar' },
    { x: 1080, y: 3150, w: 50, h: 50, kind: 'pillar' },
    { x: 2870, y: 3150, w: 50, h: 50, kind: 'pillar' },
    { x: 1900, y: 2750, w: 50, h: 50, kind: 'pillar' },
    { x: 2050, y: 2750, w: 50, h: 50, kind: 'pillar' },

    // === STREET COVER (cars, dumpsters, för police-shootout) ===
    { x: 700,  y: 3650, w: 90, h: 50, kind: 'parked_car' },
    { x: 3210, y: 3650, w: 90, h: 50, kind: 'parked_car' },
    { x: 850,  y: 3800, w: 90, h: 50, kind: 'parked_car' },
    { x: 3060, y: 3800, w: 90, h: 50, kind: 'parked_car' },
  ],

  // === DOORS (interaktiva — locked/lockpickable/drillable) ===
  // Renderas separat från walls. Innehåller phase-specifik logik.
  doors: [
    // Front entrance (lobby) — alltid open
    { id: 'front',  x: 1900, y: 3400, w: 200, h: 30, kind: 'main_door',  locked: false },
    // Vault door — låst tills drilled
    { id: 'vault',  x: 1900, y: 1870, w: 200, h: 30, kind: 'vault_door', locked: true,  drillable: true },
    // Back alley door — låst tills lockpicked (stealth-extract option)
    { id: 'back',   x: 1900, y: 700,  w: 100, h: 30, kind: 'back_door',  locked: true,  lockpickable: true },
    // Server room access door (söder, från lobby)
    { id: 'server', x: 820,  y: 1970, w: 80,  h: 30, kind: 'side_door',  locked: false },
    // Manager office door
    { id: 'office', x: 3100, y: 1970, w: 80,  h: 30, kind: 'side_door',  locked: false },
  ],

  // === DECORATIONS (visuella, ingen collision) ===
  decorations: [
    // ATMs (lobby väggar)
    { kind: 'atm', x: 720,  y: 2700 },
    { kind: 'atm', x: 720,  y: 2900 },
    { kind: 'atm', x: 720,  y: 3100 },
    { kind: 'atm', x: 3280, y: 2700 },
    { kind: 'atm', x: 3280, y: 2900 },
    { kind: 'atm', x: 3280, y: 3100 },
    // Plants (lobby mitt + entré)
    { kind: 'plant', x: 1250, y: 3200 },
    { kind: 'plant', x: 2750, y: 3200 },
    { kind: 'plant', x: 850,  y: 3300 },
    { kind: 'plant', x: 3150, y: 3300 },
    { kind: 'plant', x: 1500, y: 2700 },
    { kind: 'plant', x: 2500, y: 2700 },
    // Vault gold + cash-stacks
    { kind: 'cash_stack', x: 1500, y: 1100 },
    { kind: 'cash_stack', x: 2000, y: 1100 },
    { kind: 'cash_stack', x: 2500, y: 1100 },
    { kind: 'gold_stack', x: 1750, y: 1500 },
    { kind: 'gold_stack', x: 2250, y: 1500 },
    { kind: 'gold_stack', x: 1500, y: 1700 },
    { kind: 'gold_stack', x: 2500, y: 1700 },
    // Manager office: safe + desk + chair
    { kind: 'safe',  x: 3200, y: 1050 },
    { kind: 'desk',  x: 3100, y: 1500 },
    { kind: 'chair', x: 3100, y: 1650 },
    // Server room: 3 server-racks
    { kind: 'server_rack', x: 800, y: 900 },
    { kind: 'server_rack', x: 800, y: 1200 },
    { kind: 'server_rack', x: 800, y: 1500 },
    // Cashier-counter: cash drawers visible behind counter
    { kind: 'cash_drawer', x: 1410, y: 2330 },
    { kind: 'cash_drawer', x: 1680, y: 2330 },
    { kind: 'cash_drawer', x: 1950, y: 2330 },
    { kind: 'cash_drawer', x: 2220, y: 2330 },
    { kind: 'cash_drawer', x: 2490, y: 2330 },
    // Drill-marker (visible drill spot framför valvet)
    { kind: 'drill_marker', x: 2000, y: 1920 },
    // Street: lampor, bänkar, soptunnor
    { kind: 'streetlight', x: 800,  y: 3700 },
    { kind: 'streetlight', x: 3200, y: 3700 },
    { kind: 'bench',       x: 1200, y: 3550 },
    { kind: 'bench',       x: 2800, y: 3550 },
    { kind: 'trash',       x: 700,  y: 3500 },
    { kind: 'trash',       x: 3300, y: 3500 },
    // Back alley: dumpsters + skyltar
    { kind: 'dumpster',    x: 1200, y: 400 },
    { kind: 'dumpster',    x: 2700, y: 400 },
    { kind: 'trash',       x: 1450, y: 450 },
    { kind: 'trash',       x: 2550, y: 450 },
    // Getaway-van (primary extract — visuellt markerad)
    { kind: 'getaway_van', x: 2000, y: 3700 },
    // Back-alley van (stealth extract)
    { kind: 'getaway_van', x: 1950, y: 400 },
  ],

  // === LOOT-SPOTS (säckar att bagga under ALARM-fasen) ===
  // value = $-värde, bagTime = sek att bagga, weight = movement-penalty 0..1
  lootSpots: [
    { id: 'vc1', x: 1500, y: 1100, kind: 'cash_stack',   value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vc2', x: 2000, y: 1100, kind: 'cash_stack',   value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vc3', x: 2500, y: 1100, kind: 'cash_stack',   value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vg1', x: 1750, y: 1500, kind: 'gold_stack',   value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg2', x: 2250, y: 1500, kind: 'gold_stack',   value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg3', x: 1500, y: 1700, kind: 'gold_stack',   value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg4', x: 2500, y: 1700, kind: 'gold_stack',   value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'msa', x: 3200, y: 1050, kind: 'manager_safe', value: 3000, bagTime: 4, weight: 0.20 },
    { id: 'cd1', x: 1410, y: 2330, kind: 'cash_drawer',  value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd2', x: 1680, y: 2330, kind: 'cash_drawer',  value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd3', x: 1950, y: 2330, kind: 'cash_drawer',  value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd4', x: 2220, y: 2330, kind: 'cash_drawer',  value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd5', x: 2490, y: 2330, kind: 'cash_drawer',  value: 500,  bagTime: 1, weight: 0.05 },
  ],

  // === CAMERAS (vision-cone — om player i cone >2s = ALARM) ===
  // dir = riktning (radians), cone = halv-vinkel, range = px sikt
  cameras: [
    { id: 'cam_entrance', x: 2000, y: 3380, dir: -Math.PI/2, cone: 0.7, range: 280, kind: 'entrance' },
    { id: 'cam_lobby_l',  x: 1100, y: 2700, dir: 0,           cone: 0.7, range: 280, kind: 'lobby' },
    { id: 'cam_lobby_r',  x: 2900, y: 2700, dir: Math.PI,     cone: 0.7, range: 280, kind: 'lobby' },
    { id: 'cam_hallway',  x: 2000, y: 2150, dir: -Math.PI/2,  cone: 0.7, range: 250, kind: 'hallway' },
    { id: 'cam_vault',    x: 2000, y: 1950, dir: -Math.PI/2,  cone: 0.7, range: 200, kind: 'vault' },
    { id: 'cam_office',   x: 3120, y: 2000, dir: Math.PI,     cone: 0.7, range: 200, kind: 'office' },
  ],

  // === HACK-TERMINALS (server room — varje slår ut 2 kameror) ===
  hackTerminals: [
    { id: 'term1', x: 850, y: 920,  disables: ['cam_entrance', 'cam_lobby_l'],  hackTime: 4 },
    { id: 'term2', x: 850, y: 1220, disables: ['cam_lobby_r', 'cam_hallway'],   hackTime: 4 },
    { id: 'term3', x: 850, y: 1520, disables: ['cam_vault', 'cam_office'],      hackTime: 4 },
  ],

  // === CIVILIANS (NPC:s — kan panika och trigga alarm) ===
  // I iter 2 får de wander/panic AI. Iter 1 = bara visuella.
  civilianSpawns: [
    { id: 'civ_c1', x: 1500, y: 2900, kind: 'customer' },
    { id: 'civ_c2', x: 2000, y: 2950, kind: 'customer' },
    { id: 'civ_c3', x: 2500, y: 2900, kind: 'customer' },
    { id: 'civ_c4', x: 1800, y: 3150, kind: 'customer' },
    { id: 'civ_c5', x: 2200, y: 3150, kind: 'customer' },
    { id: 'civ_c6', x: 1300, y: 3050, kind: 'customer' },
    { id: 'civ_ca1', x: 1500, y: 2350, kind: 'cashier' },
    { id: 'civ_ca2', x: 2100, y: 2350, kind: 'cashier' },
    { id: 'civ_ca3', x: 2700, y: 2350, kind: 'cashier' },
    { id: 'civ_mg',  x: 3150, y: 1300, kind: 'manager' },
  ],

  // === GUARDS (väpnade NPC:s med vision-cone + patrol-path) ===
  // Iter 2: patrol/vision/engage AI. Iter 1 = visuella + spawn-data.
  guardSpawns: [
    { id: 'g_lobby',   x: 2000, y: 2700, kind: 'lobby_guard',
      patrol: [[1400, 2700], [2600, 2700]], facing: 0 },
    { id: 'g_hallway', x: 2000, y: 2000, kind: 'hallway_guard',
      patrol: [[1500, 2000], [2500, 2000]], facing: 0 },
    { id: 'g_server',  x: 800,  y: 1500, kind: 'server_guard',
      patrol: [[800, 1000], [800, 1900]], facing: -Math.PI/2 },
    { id: 'g_office',  x: 3100, y: 1500, kind: 'office_guard',
      patrol: [[3100, 1100], [3100, 1900]], facing: -Math.PI/2 },
  ],

  // === DRILL-SPOT (vault) ===
  drillSpot: { x: 2000, y: 1920, r: 40, durationSec: 120 },

  // === POLICE-SPAWN-POINTS (alarm-fasen) ===
  policeSpawns: [
    { x: 2000, y: 3950, kind: 'street_front' },
    { x: 700,  y: 3950, kind: 'street_left' },
    { x: 3300, y: 3950, kind: 'street_right' },
    { x: 2000, y: 200,  kind: 'alley_back' },
    { x: 100,  y: 2000, kind: 'side_west' },
    { x: 3900, y: 2000, kind: 'side_east' },
  ],

  // === ROLES (iter 3 — för nu bara data) ===
  roles: [
    { id: 'hacker', name: 'HACKER',  perk: '−50% hack-tid + ser kameror genom väggar' },
    { id: 'tank',   name: 'TANK',    perk: '+50% maxHP, −20% rörelse' },
    { id: 'medic',  name: 'MEDIC',   perk: '+100% revive-hastighet, +2 HP/s passiv' },
    { id: 'rogue',  name: 'ROGUE',   perk: 'Lockpicks 2x snabbare, ljudlös melee' },
  ],

  // === DOWN-STATE (samma som CD/Survivors) ===
  downBleedoutSec: 30,
  downReviveSec: 4,
  downCrawlSpeedMul: 0.5,
  downReviveRadius: 60,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HEIST_ARENA };
}
if (typeof window !== 'undefined') {
  window.HEIST_ARENA = HEIST_ARENA;
}
