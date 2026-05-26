// HEIST — Storbanken Grand (v1.627 — REDESIGN)
//
// 17 rum, 15 kameror, 5 hack-terminaler + master-terminal, 6 vakter,
// 15 civilians, 25 loot-spots, 65+ decoration-typer.
//
// Layout (4000×4000):
//
//   y=0-700    NORTH ALLEY: loading-dock van, back service-entry, back van
//   y=720-1100 ROW 1: Storage | VAULT INNER (gold mega-stacks) | Locker Room
//   y=1100-1500 ROW 2 (north): Network Closet (hidden) | VAULT OUTER | Security Room
//   y=1500-1700 ROW 2 (south): -- | VAULT OUTER cont. | -- (security cont.)
//   y=1700-2000 ROW 3: Server Room | HALLWAY (drill access) | Manager Reception
//   y=2000-2200 ROW 4 (north): Break Room | Conference | Toilet Men | Manager Office
//   y=2200-2400 ROW 4 (south): Break Room cont. | Conference cont. | Toilet Women | Manager Office cont.
//   y=2400-2450 CASHIER COUNTER (5 segment + gaps)
//   y=2450-2700 BEHIND-COUNTER (cashier work area)
//   y=2700-3100 MAIN LOBBY: 6 ATMs + 4 pillars + sitting area + bank-logo
//   y=3100-3300 RECEPTION FOYER: reception desk + revolving-door area
//   y=3300-3400 (south outer wall + front-entry-gap)
//   y=3400-4000 STREET: parking-lot, getaway van, parked cars, sidewalk
//
// PHASE-FLOW (oförändrat):
//   STEALTH → ALARM → EXTRACT
//   Med MYCKET fler stealth-options nu:
//   - 5 vanliga + 1 master hack-terminal
//   - 6 vakter att smyga förbi
//   - 3 entré-routes (front, back-alley van, loading-dock van, side-entry)
//   - 2 valv-dörrar att drilla (outer + inner = double-tier loot)
//
'use strict';

const HEIST_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'STORBANKEN GRAND',

  // Visual region-färger
  streetColor:     '#2a2a30',
  sidewalkColor:   '#7a7568',
  bankFloorColor:  '#a8906a',     // marmor lobby
  vaultFloorColor: '#3a2a1a',     // mörkt stål
  vaultInnerColor: '#1a0f06',     // ännu mörkare — final vault
  carpetColor:     '#4a2a30',     // röd matta manager
  serverFloorColor:'#1a2a3a',
  breakFloorColor: '#5a4a3a',     // lite mer hemtrevligt
  conferenceColor: '#3a3a4a',
  toiletColor:     '#6a7080',     // klinker
  securityColor:   '#2a1a1a',
  storageColor:    '#3a3028',
  lockerColor:     '#3a3a3a',
  receptionColor:  '#5a4a3a',

  // === MATCH-CONFIG ===
  matchDurationSec:    720,
  stealthPhaseMaxSec:  180,
  alarmPhaseMaxSec:    480,
  drillDurationSec:    120,
  innerVaultDrillSec:  90,        // andra drill för inner-vault
  extractDurationSec:  60,

  maxPlayers: 8,

  // === PLAYER SPAWNS — v1.637: längre ut på gatan (var y=3800, för nära banken)
  // Bank south wall är vid y=3400. Spawn vid y=3950 = 550px söder om banken.
  // Clearly OUTSIDE — player ser hela bank-fasaden framför sig.
  playerSpawns: [
    { x: 1750, y: 3950 },
    { x: 1850, y: 3950 },
    { x: 1950, y: 3950 },
    { x: 2050, y: 3950 },
    { x: 2150, y: 3950 },
    { x: 2250, y: 3950 },
    { x: 1850, y: 3870 },
    { x: 2150, y: 3870 },
  ],

  scaling: {
    policeMulPerPlayer: 0.55,
    guardMulPerPlayer: 0.10,
    lootMulPerPlayer: 0.15,
    civilianMulPerPlayer: 0.05,
  },

  startHp: 100, maxHp: 100,
  startShield: 0, maxShield: 100,
  startWeapon: 'fists',
  startGrenades: 0,

  // === EXTRACTION ZONE — endast BACK-ALLEY (v1.634, user-feedback) ===
  // Bara EN flyktbil bakom banken. Players spawnar utanför (street/front),
  // måste ta sig genom banken till alley för extract.
  extractZones: {
    back:   { x: 1900, y: 400, w: 200, h: 120, kind: 'van_back', locked: false },
  },

  // === WALLS — v1.630 KOMPLETT OMSKRIVNING ===
  // Konvention: Alla rum delar väggar via abutment (back-to-back, ingen gap).
  // 9 rum i ett 3×3-grid (Storage/Network/Server | Vault-Inner/Outer/Hallway | Locker/Security/Manager).
  // Plus Row 4-suite (Break/Conf/Corridor/Toilet/MgrBot) som "service floor".
  // Wall thickness 25.
  walls: [
    // ============ YTTRE BANK-VÄGGAR ============
    // NORTH outer (gaps: loading-dock 900-1050, back-alley 1900-2000)
    { x: 600,  y: 700,  w: 300,  h: 25, kind: 'wall' },     // 600-900
    { x: 1050, y: 700,  w: 850,  h: 25, kind: 'wall' },     // 1050-1900
    { x: 2000, y: 700,  w: 1400, h: 25, kind: 'wall' },     // 2000-3400
    // SOUTH outer (gaps: front 1900-2100, side-entry 3050-3200)
    { x: 600,  y: 3400, w: 1300, h: 25, kind: 'wall' },
    { x: 2100, y: 3400, w: 950,  h: 25, kind: 'wall' },
    { x: 3200, y: 3400, w: 200,  h: 25, kind: 'wall' },
    // WEST outer + EAST outer
    { x: 600,  y: 725,  w: 25,   h: 2700, kind: 'wall' },
    { x: 3375, y: 725,  w: 25,   h: 2700, kind: 'wall' },

    // ============ ROW 1 (y=725-1075) STORAGE | VAULT INNER | LOCKER ============
    // STORAGE (x=625-1275) — east wall touches vault-inner-west via abutment
    //   East wall (x=1275-1300, y=725-1075)
    { x: 1275, y: 725, w: 25, h: 350, kind: 'wall' },
    //   South wall (y=1075-1100, x=625-1275) door 820-920 → storage→network
    { x: 625,  y: 1075, w: 195, h: 25, kind: 'wall' },     // 625-820
    { x: 920,  y: 1075, w: 355, h: 25, kind: 'wall' },     // 920-1275

    // VAULT INNER (x=1300-2675) — center, biggest room
    //   West wall (x=1300-1325, y=725-1075)
    { x: 1300, y: 725, w: 25, h: 350, kind: 'wall_vault' },
    //   East wall (x=2675-2700, y=725-1075)
    { x: 2675, y: 725, w: 25, h: 350, kind: 'wall_vault' },
    //   South wall (y=1075-1100) door 1900-2100 (INNER-VAULT-DRILL)
    { x: 1325, y: 1075, w: 575, h: 25, kind: 'wall_vault' },
    { x: 2100, y: 1075, w: 575, h: 25, kind: 'wall_vault' },

    // LOCKER (x=2700-3375)
    //   West wall (x=2700-2725, y=725-1075) touches vault-inner-east
    { x: 2700, y: 725, w: 25, h: 350, kind: 'wall' },
    //   South wall (y=1075-1100, x=2700-3375) door 3050-3150 → locker→security
    { x: 2725, y: 1075, w: 325, h: 25, kind: 'wall' },     // 2725-3050
    { x: 3150, y: 1075, w: 225, h: 25, kind: 'wall' },     // 3150-3375

    // ============ ROW 2 (y=1100-1675) NETWORK | VAULT OUTER | SECURITY ============
    // NETWORK CLOSET (x=625-1275) — full width like storage above
    //   East wall (x=1275-1300, y=1100-1675)
    { x: 1275, y: 1100, w: 25, h: 575, kind: 'wall' },
    //   South wall (y=1675-1700, x=625-1275) door 820-920 → network→server
    { x: 625,  y: 1675, w: 195, h: 25, kind: 'wall' },
    { x: 920,  y: 1675, w: 355, h: 25, kind: 'wall' },

    // VAULT OUTER (x=1300-2675)
    //   West (x=1300-1325, y=1100-1675)
    { x: 1300, y: 1100, w: 25, h: 575, kind: 'wall_vault' },
    //   East (x=2675-2700, y=1100-1675)
    { x: 2675, y: 1100, w: 25, h: 575, kind: 'wall_vault' },
    //   South (y=1675-1700) door 1900-2100 (OUTER-VAULT-DRILL)
    { x: 1325, y: 1675, w: 575, h: 25, kind: 'wall_vault' },
    { x: 2100, y: 1675, w: 575, h: 25, kind: 'wall_vault' },

    // SECURITY (x=2700-3375) — matches locker above
    //   West (x=2700-2725, y=1100-1675)
    { x: 2700, y: 1100, w: 25, h: 575, kind: 'wall' },
    //   North (y=1100-1125, x=2700-3375) — gap 3050-3150 matches locker-door above
    { x: 2725, y: 1100, w: 325, h: 25, kind: 'wall' },     // 2725-3050 (left of locker-door)
    { x: 3150, y: 1100, w: 225, h: 25, kind: 'wall' },     // 3150-3375 (right of locker-door)
    //   South (y=1675-1700, x=2700-3375) door 2900-3000 (lockpickable)
    { x: 2725, y: 1675, w: 175, h: 25, kind: 'wall' },     // 2725-2900
    { x: 3000, y: 1675, w: 375, h: 25, kind: 'wall' },     // 3000-3375

    // ============ ROW 3 (y=1700-1975) SERVER | HALLWAY | MANAGER TOP ============
    // SERVER (x=625-1275)
    //   East (x=1275-1300, y=1700-1975) door 1800-1880 → server↔hallway
    { x: 1275, y: 1700, w: 25, h: 100, kind: 'wall' },     // 1700-1800
    { x: 1275, y: 1880, w: 25, h: 95,  kind: 'wall' },     // 1880-1975
    //   South (y=1975-2000, x=625-1275) door 820-920 → server↔break
    { x: 625,  y: 1975, w: 195, h: 25, kind: 'wall' },     // 625-820
    { x: 920,  y: 1975, w: 355, h: 25, kind: 'wall' },     // 920-1275

    // HALLWAY (x=1300-2675)
    //   West (x=1300-1325, y=1700-1975)
    { x: 1300, y: 1700, w: 25, h: 275, kind: 'wall' },
    //   East (x=2675-2700, y=1700-1975)
    { x: 2675, y: 1700, w: 25, h: 275, kind: 'wall' },
    //   South (y=1975-2000) central gap x=1700-2100
    { x: 1325, y: 1975, w: 375, h: 25, kind: 'wall' },     // 1325-1700
    { x: 2100, y: 1975, w: 575, h: 25, kind: 'wall' },     // 2100-2675

    // MANAGER TOP (x=2700-3375, y=1700-2400) — extends down through Row 4
    //   West (x=2700-2725, y=1700-2400) door 2200-2280
    { x: 2700, y: 1700, w: 25, h: 500, kind: 'wall' },     // 1700-2200
    { x: 2700, y: 2280, w: 25, h: 120, kind: 'wall' },     // 2280-2400

    // ============ ROW 4 (y=2000-2400) BREAK | CONF | CORRIDOR | TOILET | MGR BOT ============
    // BREAK (x=625-1275, full width)
    //   North (y=2000-2025, x=625-1275)
    { x: 625, y: 2000, w: 650, h: 25, kind: 'wall' },
    //   East (x=1275-1300, y=2000-2400) door 2150-2230
    { x: 1275, y: 2000, w: 25, h: 150, kind: 'wall' },     // 2000-2150
    { x: 1275, y: 2230, w: 25, h: 170, kind: 'wall' },     // 2230-2400
    //   South (y=2400-2425, x=625-1275)
    { x: 625, y: 2400, w: 650, h: 25, kind: 'wall' },

    // CONFERENCE (x=1300-1675)
    //   West (x=1300-1325, y=2000-2400) door 2150-2230 (matches break-east door)
    { x: 1300, y: 2000, w: 25, h: 150, kind: 'wall' },     // 2000-2150
    { x: 1300, y: 2230, w: 25, h: 170, kind: 'wall' },     // 2230-2400
    //   East (x=1675-1700, y=2000-2400) door 2150-2230 → conf↔central
    { x: 1675, y: 2000, w: 25, h: 150, kind: 'wall' },
    { x: 1675, y: 2230, w: 25, h: 170, kind: 'wall' },
    //   North (y=2000-2025, x=1325-1675)
    { x: 1325, y: 2000, w: 350, h: 25, kind: 'wall' },
    //   South (y=2400-2425, x=1325-1675)
    { x: 1325, y: 2400, w: 350, h: 25, kind: 'wall' },

    // CENTRAL CORRIDOR (x=1700-2100, y=2000-2400) — OPEN through-path. No walls.

    // TOILET (x=2125-2675)
    //   West (x=2100-2125, y=2000-2400) door 2150-2230 → central↔toilet
    { x: 2100, y: 2000, w: 25, h: 150, kind: 'wall' },
    { x: 2100, y: 2230, w: 25, h: 170, kind: 'wall' },
    //   East (x=2675-2700, y=2000-2400)
    { x: 2675, y: 2000, w: 25, h: 400, kind: 'wall' },
    //   North (y=2000-2025, x=2125-2675)
    { x: 2125, y: 2000, w: 550, h: 25, kind: 'wall' },
    //   South (y=2400-2425, x=2125-2675)
    { x: 2125, y: 2400, w: 550, h: 25, kind: 'wall' },
    //   Internal mid (y=2200-2225, x=2125-2675) men/women
    { x: 2125, y: 2200, w: 550, h: 25, kind: 'wall' },

    // MANAGER BOT (x=2700-3375, y=2000-2400) — continues from Top
    //   South (y=2400-2425, x=2700-3375) door 3050-3150
    { x: 2725, y: 2400, w: 325, h: 25, kind: 'wall' },     // 2725-3050
    { x: 3150, y: 2400, w: 225, h: 25, kind: 'wall' },     // 3150-3375

    // ============ ROW 5 (y=2400-2450) CASHIER COUNTER ============
    // 6 segments, central gap 1900-2100
    { x: 1325, y: 2400, w: 175, h: 50, kind: 'counter' },  // 1325-1500
    { x: 1550, y: 2400, w: 150, h: 50, kind: 'counter' },  // 1550-1700
    { x: 1750, y: 2400, w: 150, h: 50, kind: 'counter' },  // 1750-1900
    // GAP 1900-2100 (central corridor through)
    { x: 2100, y: 2400, w: 150, h: 50, kind: 'counter' },  // 2100-2250
    { x: 2300, y: 2400, w: 150, h: 50, kind: 'counter' },  // 2300-2450
    { x: 2500, y: 2400, w: 175, h: 50, kind: 'counter' },  // 2500-2675

    // BEHIND-COUNTER side walls (x=1300, x=2675, y=2425-2700)
    { x: 1300, y: 2425, w: 25, h: 275, kind: 'wall' },
    { x: 2675, y: 2425, w: 25, h: 275, kind: 'wall' },

    // ============ ROW 6 (y=2700-3100) MAIN LOBBY (open) — pillars only ============
    { x: 1080, y: 2750, w: 50, h: 50, kind: 'pillar' },
    { x: 2870, y: 2750, w: 50, h: 50, kind: 'pillar' },
    { x: 1080, y: 3000, w: 50, h: 50, kind: 'pillar' },
    { x: 2870, y: 3000, w: 50, h: 50, kind: 'pillar' },
    { x: 1900, y: 2780, w: 50, h: 50, kind: 'pillar' },
    { x: 2050, y: 2780, w: 50, h: 50, kind: 'pillar' },

    // ============ ROW 7 (y=3100-3300) RECEPTION ============
    { x: 1750, y: 3150, w: 500, h: 40, kind: 'counter' },

    // ============ STREET COVER ============
    { x: 700,  y: 3650, w: 90, h: 50, kind: 'parked_car' },
    { x: 3210, y: 3650, w: 90, h: 50, kind: 'parked_car' },
    { x: 850,  y: 3800, w: 90, h: 50, kind: 'parked_car' },
    { x: 3060, y: 3800, w: 90, h: 50, kind: 'parked_car' },
    { x: 700,  y: 3500, w: 50, h: 80, kind: 'fire_hydrant' },
  ],

  // === DOORS (15 st) ===
  doors: [
    { id: 'front',         x: 1900, y: 3400, w: 200, h: 25, kind: 'main_door',    locked: false },
    { id: 'side',          x: 3050, y: 3400, w: 150, h: 25, kind: 'main_door',    locked: false },
    { id: 'back',          x: 1900, y: 700,  w: 100, h: 25, kind: 'back_door',    locked: true,  lockpickable: true },
    { id: 'loading',       x: 900,  y: 700,  w: 150, h: 25, kind: 'back_door',    locked: true,  lockpickable: true },
    { id: 'storage',       x: 820,  y: 1075, w: 100, h: 25, kind: 'side_door',    locked: true,  lockpickable: true },
    { id: 'vault_inner',   x: 1900, y: 1075, w: 200, h: 25, kind: 'vault_door',   locked: true,  drillable: true, isInner: true },
    { id: 'locker',        x: 3050, y: 1075, w: 100, h: 25, kind: 'side_door',    locked: true,  lockpickable: true },
    { id: 'network',       x: 820,  y: 1675, w: 100, h: 25, kind: 'side_door',    locked: false },
    { id: 'vault',         x: 1900, y: 1675, w: 200, h: 25, kind: 'vault_door',   locked: true,  drillable: true },
    { id: 'security',      x: 2900, y: 1675, w: 100, h: 25, kind: 'side_door',    locked: true,  lockpickable: true, kind2: 'rfid' },
    { id: 'server',        x: 820,  y: 1975, w: 100, h: 25, kind: 'side_door',    locked: false },
    { id: 'behindcounter', x: 1700, y: 1975, w: 400, h: 25, kind: 'side_door',    locked: false },
    { id: 'manager',       x: 3050, y: 2400, w: 100, h: 25, kind: 'side_door',    locked: false },
    { id: 'break',         x: 1275, y: 2150, w: 50,  h: 80, kind: 'side_door',    locked: false },
    { id: 'conf_corridor', x: 1675, y: 2150, w: 50,  h: 80, kind: 'side_door',    locked: false },
    { id: 'toilet',        x: 2100, y: 2150, w: 50,  h: 80, kind: 'side_door',    locked: false },
    { id: 'manager_priv',  x: 2700, y: 2200, w: 50,  h: 80, kind: 'side_door',    locked: false },
  ],

  // === DECORATIONS (v1.636 PROPER REWRITE — inga floor-skräp, allt har syfte) ===
  decorations: [
    // ===== STORAGE ROOM (x=625-1275, y=725-1075) — boxes/pallets LÄNGS VÄGGAR =====
    // Norra väggen — staplade boxes
    { kind: 'cardboard_box', x: 680,  y: 760 },
    { kind: 'cardboard_box', x: 730,  y: 760 },
    { kind: 'cardboard_box', x: 800,  y: 760 },
    { kind: 'cardboard_box', x: 1000, y: 760 },
    { kind: 'cardboard_box', x: 1060, y: 760 },
    { kind: 'cardboard_box', x: 1130, y: 760 },
    { kind: 'cardboard_box', x: 1200, y: 760 },
    // Södra väggen — pallets
    { kind: 'pallet',        x: 700,  y: 1040 },
    { kind: 'pallet',        x: 880,  y: 1040 },
    { kind: 'pallet',        x: 1060, y: 1040 },
    { kind: 'pallet',        x: 1220, y: 1040 },
    // Hörnen — fire extinguisher + shopping carts (för leverans)
    { kind: 'fire_extinguisher', x: 660, y: 820 },
    { kind: 'fire_extinguisher', x: 1245, y: 820 },
    { kind: 'shopping_cart', x: 660, y: 980 },
    { kind: 'shopping_cart', x: 1245, y: 980 },

    // ===== VAULT INNER (x=1300-2675, y=725-1075) — final-tier gold =====
    { kind: 'gold_mega_stack', x: 1700, y: 820 },
    { kind: 'gold_mega_stack', x: 1900, y: 820 },
    { kind: 'gold_mega_stack', x: 2100, y: 820 },
    { kind: 'gold_mega_stack', x: 2300, y: 820 },
    { kind: 'cash_stack',      x: 1400, y: 800 },
    { kind: 'cash_stack',      x: 1500, y: 820 },
    { kind: 'cash_stack',      x: 2500, y: 820 },
    { kind: 'cash_stack',      x: 2600, y: 800 },
    { kind: 'safe_open',       x: 1380, y: 950 },
    { kind: 'safe_open',       x: 2600, y: 950 },
    { kind: 'gold_bar_box',    x: 1600, y: 980 },
    { kind: 'gold_bar_box',    x: 2400, y: 980 },
    { kind: 'diamond_display', x: 1800, y: 950 },
    { kind: 'diamond_display', x: 2000, y: 950 },
    { kind: 'diamond_display', x: 2200, y: 950 },
    { kind: 'security_camera_floor', x: 1700, y: 900 },
    { kind: 'security_camera_floor', x: 1900, y: 900 },
    { kind: 'security_camera_floor', x: 2100, y: 900 },
    { kind: 'security_camera_floor', x: 2300, y: 900 },
    { kind: 'motion_sensor',   x: 1380, y: 1020 },
    { kind: 'motion_sensor',   x: 2620, y: 1020 },

    // ===== LOCKER ROOM (x=2700-3375, y=725-1075) — lockers LÄNGS norr+söder =====
    // Norra väggen — full rad
    { kind: 'locker',      x: 2730, y: 750 },
    { kind: 'locker',      x: 2785, y: 750 },
    { kind: 'locker',      x: 2840, y: 750 },
    { kind: 'locker',      x: 2895, y: 750 },
    { kind: 'locker',      x: 2950, y: 750 },
    { kind: 'locker',      x: 3005, y: 750 },
    { kind: 'locker',      x: 3060, y: 750 },
    { kind: 'locker',      x: 3115, y: 750 },
    { kind: 'locker',      x: 3170, y: 750 },
    { kind: 'locker',      x: 3225, y: 750 },
    { kind: 'locker',      x: 3280, y: 750 },
    { kind: 'locker',      x: 3335, y: 750 },
    // Södra väggen — open lockers (visar innehåll)
    { kind: 'locker_open', x: 2730, y: 1040 },
    { kind: 'locker_open', x: 2830, y: 1040 },
    { kind: 'locker_open', x: 2930, y: 1040 },
    { kind: 'locker_open', x: 3030, y: 1040 },
    { kind: 'locker_open', x: 3220, y: 1040 },
    { kind: 'locker_open', x: 3335, y: 1040 },
    // Mitt-bänkar (för byte)
    { kind: 'bench',       x: 2900, y: 900 },
    { kind: 'bench',       x: 3200, y: 900 },

    // ===== NETWORK CLOSET (x=625-1275, y=1100-1675) — racks längs norr/söder =====
    // Norra raden — server racks
    { kind: 'server_rack',   x: 680,  y: 1140 },
    { kind: 'server_rack',   x: 770,  y: 1140 },
    { kind: 'server_rack',   x: 860,  y: 1140 },
    { kind: 'server_rack',   x: 950,  y: 1140 },
    { kind: 'server_rack',   x: 1040, y: 1140 },
    { kind: 'server_rack',   x: 1130, y: 1140 },
    { kind: 'server_rack',   x: 1220, y: 1140 },
    // Söder — switches + cable-trays mot väggen
    { kind: 'master_switch', x: 700,  y: 1640 },
    { kind: 'master_switch', x: 1200, y: 1640 },
    { kind: 'cable_tray',    x: 900,  y: 1640 },
    // Cooling-units i hörnen
    { kind: 'cooling_unit',  x: 680,  y: 1400 },
    { kind: 'cooling_unit',  x: 1240, y: 1400 },

    // ===== VAULT OUTER (x=1300-2675, y=1100-1675) =====
    { kind: 'cash_stack',  x: 1400, y: 1180 },
    { kind: 'cash_stack',  x: 1550, y: 1180 },
    { kind: 'cash_stack',  x: 1700, y: 1180 },
    { kind: 'cash_stack',  x: 1850, y: 1180 },
    { kind: 'cash_stack',  x: 2150, y: 1180 },
    { kind: 'cash_stack',  x: 2300, y: 1180 },
    { kind: 'cash_stack',  x: 2450, y: 1180 },
    { kind: 'cash_stack',  x: 2600, y: 1180 },
    { kind: 'gold_stack',  x: 1500, y: 1400 },
    { kind: 'gold_stack',  x: 1700, y: 1400 },
    { kind: 'gold_stack',  x: 1900, y: 1400 },
    { kind: 'gold_stack',  x: 2100, y: 1400 },
    { kind: 'gold_stack',  x: 2300, y: 1400 },
    { kind: 'gold_stack',  x: 2500, y: 1400 },
    { kind: 'gold_bar_box',x: 1400, y: 1550 },
    { kind: 'gold_bar_box',x: 1700, y: 1550 },
    { kind: 'gold_bar_box',x: 2300, y: 1550 },
    { kind: 'gold_bar_box',x: 2600, y: 1550 },
    { kind: 'drill_marker',x: 2000, y: 1720 },
    { kind: 'motion_sensor', x: 1380, y: 1380 },
    { kind: 'motion_sensor', x: 2620, y: 1380 },
    { kind: 'motion_sensor', x: 1380, y: 1620 },
    { kind: 'motion_sensor', x: 2620, y: 1620 },
    { kind: 'safety_box',  x: 1850, y: 1620 },
    { kind: 'safety_box',  x: 2150, y: 1620 },

    // ===== SECURITY ROOM (x=2700-3375, y=1100-1675) — monitor wall + workstations =====
    // Monitor-wall mot norra väggen (täcker hela bredden)
    { kind: 'monitor_wall',    x: 2800, y: 1130 },
    { kind: 'monitor_wall',    x: 3000, y: 1130 },
    { kind: 'monitor_wall',    x: 3200, y: 1130 },
    // Workstations som security-vakter sitter vid (facing monitors)
    { kind: 'workstation',     x: 2800, y: 1300 },
    { kind: 'office_chair',    x: 2800, y: 1350 },
    { kind: 'workstation',     x: 3000, y: 1300 },
    { kind: 'office_chair',    x: 3000, y: 1350 },
    { kind: 'workstation',     x: 3200, y: 1300 },
    { kind: 'office_chair',    x: 3200, y: 1350 },
    // Master terminal (hackable) i hörnet
    { kind: 'master_terminal', x: 3320, y: 1550 },
    // Service-bord mot södra väggen
    { kind: 'filing_cabinet',  x: 2730, y: 1640 },
    { kind: 'filing_cabinet',  x: 2820, y: 1640 },
    { kind: 'printer',         x: 2950, y: 1640 },
    { kind: 'water_cooler',    x: 3080, y: 1640 },
    { kind: 'coffee_machine',  x: 3200, y: 1640 },
    { kind: 'plant',           x: 2730, y: 1640 },
    { kind: 'plant',           x: 3340, y: 1640 },

    // ===== SERVER ROOM (x=625-1275, y=1700-1975) — 2 rader racks =====
    // Norra raden (mot y=1700)
    { kind: 'server_rack', x: 680,  y: 1730 },
    { kind: 'server_rack', x: 770,  y: 1730 },
    { kind: 'server_rack', x: 860,  y: 1730 },
    { kind: 'server_rack', x: 950,  y: 1730 },
    { kind: 'server_rack', x: 1040, y: 1730 },
    { kind: 'server_rack', x: 1130, y: 1730 },
    { kind: 'server_rack', x: 1220, y: 1730 },
    // Södra raden (mot y=1975)
    { kind: 'server_rack', x: 680,  y: 1940 },
    { kind: 'server_rack', x: 770,  y: 1940 },
    { kind: 'server_rack', x: 860,  y: 1940 },
    { kind: 'server_rack', x: 950,  y: 1940 },
    { kind: 'server_rack', x: 1130, y: 1940 },
    { kind: 'server_rack', x: 1220, y: 1940 },
    // Cooling-units i mitten av rummet (typiskt server-room layout)
    { kind: 'cooling_unit',x: 1040, y: 1940 },

    // ===== HALLWAY (x=1300-2675, y=1700-1975) — corridor med plants i hörnen =====
    // Hörn-plants (4 st)
    { kind: 'plant',          x: 1340, y: 1730 },
    { kind: 'plant',          x: 2630, y: 1730 },
    { kind: 'plant',          x: 1340, y: 1940 },
    { kind: 'plant',          x: 2630, y: 1940 },
    // Tavlor på norra väggen
    { kind: 'framed_picture', x: 1500, y: 1715 },
    { kind: 'framed_picture', x: 1800, y: 1715 },
    { kind: 'framed_picture', x: 2200, y: 1715 },
    { kind: 'framed_picture', x: 2500, y: 1715 },
    // Bänkar längs södra väggen
    { kind: 'bench',          x: 1500, y: 1940 },
    { kind: 'bench',          x: 2500, y: 1940 },
    // Bank-logo på golvet (mitt-corridor)
    { kind: 'bank_logo_floor',x: 2000, y: 1830 },
    // Exit-skyltar vid båda ändar
    { kind: 'exit_sign',      x: 1320, y: 1730 },
    { kind: 'exit_sign',      x: 2650, y: 1730 },

    // ===== MANAGER TOP (reception zone, x=2700-3375, y=1700-2000) =====
    // Reception-desk där assistent sitter
    { kind: 'reception_desk', x: 2850, y: 1780 },
    { kind: 'office_chair',   x: 2850, y: 1870 },
    { kind: 'workstation',    x: 2850, y: 1780 },
    // Vänteområde — soffa + tidskriftshylla
    { kind: 'office_couch',   x: 3100, y: 1830 },
    { kind: 'coffee_table',   x: 3100, y: 1900 },
    { kind: 'magazine_rack',  x: 3300, y: 1830 },
    // Plants i hörnen
    { kind: 'plant',          x: 2740, y: 1730 },
    { kind: 'plant',          x: 3340, y: 1730 },

    // ===== MANAGER OFFICE BOT (x=2700-3375, y=2000-2400) — chef-kontor =====
    // Chefen sitter vid en stor workstation (mot östra väggen)
    { kind: 'workstation',    x: 3150, y: 2100 },
    { kind: 'office_chair',   x: 3150, y: 2150 },
    // Säkerhetsskåp + safe längs östra väggen
    { kind: 'safe',           x: 3340, y: 2060 },
    { kind: 'safety_box',     x: 3340, y: 2160 },
    // Bookshelves längs västra väggen
    { kind: 'bookshelf',      x: 2730, y: 2060 },
    { kind: 'bookshelf',      x: 2730, y: 2160 },
    { kind: 'bookshelf',      x: 2730, y: 2260 },
    // Filing cabinets
    { kind: 'filing_cabinet', x: 2730, y: 2360 },
    { kind: 'filing_cabinet', x: 2830, y: 2360 },
    // Vänteområde — soffa + bord
    { kind: 'office_couch',   x: 3000, y: 2350 },
    { kind: 'coffee_table',   x: 3100, y: 2350 },
    // Plants i hörnen
    { kind: 'plant',          x: 2740, y: 2370 },
    { kind: 'plant',          x: 3340, y: 2370 },
    // Tavlor på väggar
    { kind: 'framed_picture', x: 3000, y: 2020 },
    { kind: 'framed_picture', x: 3200, y: 2020 },
    { kind: 'whiteboard',     x: 2850, y: 2020 },

    // ===== BREAK ROOM (x=625-1275, y=2000-2400) — kök + 2 sittgrupper =====
    // Norra väggen — full kitchen row
    { kind: 'fridge',         x: 680,  y: 2060 },
    { kind: 'sink_counter',   x: 760,  y: 2060 },
    { kind: 'coffee_machine', x: 840,  y: 2060 },
    { kind: 'microwave',      x: 920,  y: 2060 },
    { kind: 'vending_machine',x: 1000, y: 2060 },
    { kind: 'water_cooler',   x: 1080, y: 2060 },
    { kind: 'tv_wall',        x: 1180, y: 2060 },
    // Sittgrupp 1 (vänster) — runt bord + 4 stolar
    { kind: 'round_table',    x: 780,  y: 2250 },
    { kind: 'office_chair',   x: 730,  y: 2210 },
    { kind: 'office_chair',   x: 830,  y: 2210 },
    { kind: 'office_chair',   x: 730,  y: 2290 },
    { kind: 'office_chair',   x: 830,  y: 2290 },
    { kind: 'tip_jar',        x: 780,  y: 2250 },
    // Sittgrupp 2 (höger) — runt bord + 4 stolar
    { kind: 'round_table',    x: 1060, y: 2250 },
    { kind: 'office_chair',   x: 1010, y: 2210 },
    { kind: 'office_chair',   x: 1110, y: 2210 },
    { kind: 'office_chair',   x: 1010, y: 2290 },
    { kind: 'office_chair',   x: 1110, y: 2290 },
    // Soffa + tidning + plant i hörnen
    { kind: 'office_couch',   x: 1200, y: 2350 },
    { kind: 'magazine_rack',  x: 660,  y: 2350 },
    { kind: 'plant',          x: 1245, y: 2380 },

    // ===== CONFERENCE ROOM (x=1300-1675, y=2000-2400) — proper möteslokal =====
    // Stort konferensbord i mitten
    { kind: 'conference_table', x: 1490, y: 2200 },
    // 4 stolar längs norra sidan av bordet
    { kind: 'office_chair',   x: 1380, y: 2130 },
    { kind: 'office_chair',   x: 1450, y: 2130 },
    { kind: 'office_chair',   x: 1530, y: 2130 },
    { kind: 'office_chair',   x: 1600, y: 2130 },
    // 4 stolar längs södra sidan
    { kind: 'office_chair',   x: 1380, y: 2270 },
    { kind: 'office_chair',   x: 1450, y: 2270 },
    { kind: 'office_chair',   x: 1530, y: 2270 },
    { kind: 'office_chair',   x: 1600, y: 2270 },
    // Laptops på bordet
    { kind: 'laptop',         x: 1420, y: 2200 },
    { kind: 'laptop',         x: 1490, y: 2200 },
    { kind: 'laptop',         x: 1560, y: 2200 },
    // Whiteboard + projektor på norra väggen
    { kind: 'whiteboard',     x: 1490, y: 2020 },
    { kind: 'projector',      x: 1490, y: 2050 },
    // Plants i två hörn
    { kind: 'plant',          x: 1340, y: 2380 },
    { kind: 'plant',          x: 1640, y: 2380 },
    // Vatten för möten
    { kind: 'water_cooler',   x: 1340, y: 2050 },

    // ===== CENTRAL CORRIDOR (x=1700-2100, y=2000-2400) — RYM passage, minimalt =====
    { kind: 'bank_logo_floor',x: 1900, y: 2200 },
    // Plants i 4 hörnen
    { kind: 'plant',          x: 1720, y: 2050 },
    { kind: 'plant',          x: 2080, y: 2050 },
    { kind: 'plant',          x: 1720, y: 2380 },
    { kind: 'plant',          x: 2080, y: 2380 },

    // ===== TOILETS (x=2125-2675, y=2000-2400) — utökade =====
    { kind: 'toilet_stall',   x: 2180, y: 2080 },
    { kind: 'toilet_stall',   x: 2280, y: 2080 },
    { kind: 'toilet_stall',   x: 2380, y: 2080 },
    { kind: 'toilet_stall',   x: 2480, y: 2080 },
    { kind: 'toilet_stall',   x: 2580, y: 2080 },
    { kind: 'sink',           x: 2180, y: 2170 },
    { kind: 'sink',           x: 2280, y: 2170 },
    { kind: 'sink',           x: 2380, y: 2170 },
    { kind: 'sink',           x: 2480, y: 2170 },
    { kind: 'mirror',         x: 2580, y: 2170 },
    { kind: 'toilet_stall',   x: 2180, y: 2280 },
    { kind: 'toilet_stall',   x: 2280, y: 2280 },
    { kind: 'toilet_stall',   x: 2380, y: 2280 },
    { kind: 'toilet_stall',   x: 2480, y: 2280 },
    { kind: 'toilet_stall',   x: 2580, y: 2280 },
    { kind: 'sink',           x: 2180, y: 2370 },
    { kind: 'sink',           x: 2280, y: 2370 },
    { kind: 'sink',           x: 2380, y: 2370 },
    { kind: 'sink',           x: 2480, y: 2370 },
    { kind: 'mirror',         x: 2580, y: 2370 },

    // ===== BEHIND-COUNTER WORK AREA (x=1300-2675, y=2450-2700) — 6 kassör-workstations =====
    // 6 workstations precis bakom counter-segmenten
    { kind: 'workstation',  x: 1400, y: 2520 },
    { kind: 'office_chair', x: 1400, y: 2580 },
    { kind: 'workstation',  x: 1625, y: 2520 },
    { kind: 'office_chair', x: 1625, y: 2580 },
    { kind: 'workstation',  x: 1825, y: 2520 },
    { kind: 'office_chair', x: 1825, y: 2580 },
    { kind: 'workstation',  x: 2200, y: 2520 },
    { kind: 'office_chair', x: 2200, y: 2580 },
    { kind: 'workstation',  x: 2375, y: 2520 },
    { kind: 'office_chair', x: 2375, y: 2580 },
    { kind: 'workstation',  x: 2575, y: 2520 },
    { kind: 'office_chair', x: 2575, y: 2580 },
    // Kontorsutrustning mot södra delen
    { kind: 'photocopier',  x: 1340, y: 2660 },
    { kind: 'photocopier',  x: 2620, y: 2660 },
    { kind: 'printer',      x: 1500, y: 2660 },
    { kind: 'printer',      x: 2500, y: 2660 },
    { kind: 'filing_cabinet', x: 1700, y: 2660 },
    { kind: 'filing_cabinet', x: 2300, y: 2660 },

    // ===== MAIN LOBBY (x=625-3375, y=2700-3100) — ATM mot väggar, plants i hörnen =====
    // 3 ATMs mot västra väggen (x=625, ATM pressed flush)
    { kind: 'wall_atm_w', x: 640, y: 2780 },
    { kind: 'wall_atm_w', x: 640, y: 2900 },
    { kind: 'wall_atm_w', x: 640, y: 3020 },
    // 3 ATMs mot östra väggen
    { kind: 'wall_atm_e', x: 3360, y: 2780 },
    { kind: 'wall_atm_e', x: 3360, y: 2900 },
    { kind: 'wall_atm_e', x: 3360, y: 3020 },
    // Plants i HÖRN endast (4 st)
    { kind: 'plant',       x: 700,  y: 2720 },
    { kind: 'plant',       x: 3300, y: 2720 },
    { kind: 'plant',       x: 700,  y: 3070 },
    { kind: 'plant',       x: 3300, y: 3070 },
    // Bänkar längs västra/östra ATM-väggar (sitter och väntar på ATM)
    { kind: 'bench',       x: 740, y: 2840 },
    { kind: 'bench',       x: 740, y: 2960 },
    { kind: 'bench',       x: 3260, y: 2840 },
    { kind: 'bench',       x: 3260, y: 2960 },
    // Floor mats vid entrén + centrum
    { kind: 'floor_mat',   x: 2000, y: 2750 },
    { kind: 'floor_mat',   x: 2000, y: 3080 },
    { kind: 'bank_logo_floor', x: 2000, y: 2900 },
    // Info-kiosks + directory signs (placerade meningsfullt)
    { kind: 'info_kiosk',  x: 1500, y: 2760 },
    { kind: 'info_kiosk',  x: 2500, y: 2760 },
    { kind: 'directory_sign', x: 1700, y: 2760 },
    { kind: 'directory_sign', x: 2300, y: 2760 },
    // Promo banners (på pelare visuellt)
    { kind: 'promo_banner',x: 1080, y: 2740 },
    { kind: 'promo_banner',x: 2920, y: 2740 },
    // Umbrella stands vid entrén
    { kind: 'umbrella_stand', x: 1100, y: 2850 },
    { kind: 'umbrella_stand', x: 2900, y: 2850 },
    // Soffor i mitten av lobby (vänteområde)
    { kind: 'office_couch',   x: 1400, y: 2950 },
    { kind: 'office_couch',   x: 2600, y: 2950 },
    { kind: 'coffee_table',   x: 1400, y: 3020 },
    { kind: 'coffee_table',   x: 2600, y: 3020 },

    // ===== RECEPTION FOYER (x=625-3375, y=3100-3300) — receptionist + sittplatser =====
    // Reception-desk i mitten
    { kind: 'reception_desk', x: 2000, y: 3170 },
    { kind: 'workstation',    x: 2000, y: 3170 },
    { kind: 'office_chair',   x: 2000, y: 3230 },
    // Vänteområde — bänkar längs väggar
    { kind: 'bench',          x: 1100, y: 3140 },
    { kind: 'bench',          x: 1400, y: 3140 },
    { kind: 'bench',          x: 2600, y: 3140 },
    { kind: 'bench',          x: 2900, y: 3140 },
    // Tidskriftshyllor
    { kind: 'magazine_rack',  x: 1250, y: 3140 },
    { kind: 'magazine_rack',  x: 2750, y: 3140 },
    // Plants i hörnen
    { kind: 'plant',          x: 700,  y: 3140 },
    { kind: 'plant',          x: 3300, y: 3140 },
    { kind: 'plant',          x: 700,  y: 3270 },
    { kind: 'plant',          x: 3300, y: 3270 },
    // Tavlor på väggar
    { kind: 'framed_picture', x: 1700, y: 3110 },
    { kind: 'framed_picture', x: 2300, y: 3110 },
    // Floor mat + exit-skylt
    { kind: 'floor_mat',      x: 2000, y: 3360 },
    { kind: 'exit_sign',      x: 1900, y: 3380 },
    { kind: 'exit_sign',      x: 2100, y: 3380 },
    // Directory signs (vänster + höger)
    { kind: 'directory_sign', x: 1500, y: 3200 },
    { kind: 'directory_sign', x: 2500, y: 3200 },

    // ===== STREET / OUTDOOR (y=3400-4000) =====
    { kind: 'streetlight', x: 700,  y: 3500 },
    { kind: 'streetlight', x: 1500, y: 3500 },
    { kind: 'streetlight', x: 2500, y: 3500 },
    { kind: 'streetlight', x: 3300, y: 3500 },
    { kind: 'streetlight', x: 700,  y: 3850 },
    { kind: 'streetlight', x: 1500, y: 3950 },
    { kind: 'streetlight', x: 2500, y: 3950 },
    { kind: 'streetlight', x: 3300, y: 3850 },
    { kind: 'tree',        x: 800,  y: 3470 },
    { kind: 'tree',        x: 1000, y: 3470 },
    { kind: 'tree',        x: 1300, y: 3470 },
    { kind: 'tree',        x: 2700, y: 3470 },
    { kind: 'tree',        x: 3000, y: 3470 },
    { kind: 'tree',        x: 3200, y: 3470 },
    { kind: 'bench',       x: 1200, y: 3550 },
    { kind: 'bench',       x: 2800, y: 3550 },
    { kind: 'bench',       x: 1700, y: 3550 },
    { kind: 'bench',       x: 2300, y: 3550 },
    { kind: 'bus_stop',    x: 1400, y: 3550 },
    { kind: 'bus_stop',    x: 2600, y: 3550 },
    { kind: 'newsstand',   x: 900,  y: 3550 },
    { kind: 'newsstand',   x: 3100, y: 3550 },
    { kind: 'mailbox',     x: 1100, y: 3550 },
    { kind: 'mailbox',     x: 2900, y: 3550 },
    { kind: 'trash',       x: 750,  y: 3550 },
    { kind: 'trash',       x: 3250, y: 3550 },
    { kind: 'trash',       x: 1900, y: 3450 },
    { kind: 'trash',       x: 2100, y: 3450 },
    { kind: 'parking_meter', x: 850,  y: 3700 },
    { kind: 'parking_meter', x: 1000, y: 3700 },
    { kind: 'parking_meter', x: 1300, y: 3800 },
    { kind: 'parking_meter', x: 2700, y: 3800 },
    { kind: 'parking_meter', x: 3000, y: 3700 },
    { kind: 'parking_meter', x: 3150, y: 3700 },
    { kind: 'manhole',     x: 1500, y: 3600 },
    { kind: 'manhole',     x: 2500, y: 3600 },
    { kind: 'manhole',     x: 2000, y: 3850 },
    { kind: 'puddle',      x: 1700, y: 3700 },
    { kind: 'puddle',      x: 2300, y: 3700 },
    { kind: 'puddle',      x: 2000, y: 3950 },
    { kind: 'police_barrier', x: 1850, y: 3450 },
    { kind: 'police_barrier', x: 2150, y: 3450 },
    { kind: 'crowd_barrier',  x: 1700, y: 3470 },
    { kind: 'crowd_barrier',  x: 2300, y: 3470 },
    { kind: 'fire_hydrant',   x: 1100, y: 3500 },  // (also as wall but visual ok)
    { kind: 'newspaper',      x: 1200, y: 3650 },
    { kind: 'newspaper',      x: 2800, y: 3650 },
    { kind: 'bank_sign',      x: 2000, y: 3450 },  // huvudskylt utanför banken (på trottoaren)
    // GETAWAY-VAN FRONT BORTTAGEN (v1.634) — endast back-van är extract
    // SIDEWALK details — left side (x=0-600)
    { kind: 'tree',           x: 300,  y: 900 },
    { kind: 'tree',           x: 300,  y: 1500 },
    { kind: 'tree',           x: 300,  y: 2100 },
    { kind: 'tree',           x: 300,  y: 2700 },
    { kind: 'streetlight',    x: 400,  y: 1200 },
    { kind: 'streetlight',    x: 400,  y: 1800 },
    { kind: 'streetlight',    x: 400,  y: 2400 },
    { kind: 'streetlight',    x: 400,  y: 3000 },
    { kind: 'trash',          x: 200,  y: 1100 },
    { kind: 'trash',          x: 200,  y: 2200 },
    { kind: 'mailbox',        x: 350,  y: 1700 },
    { kind: 'mailbox',        x: 350,  y: 2600 },
    { kind: 'newspaper',      x: 250,  y: 1900 },
    { kind: 'bench',          x: 300,  y: 1300 },
    { kind: 'bench',          x: 300,  y: 2500 },
    // SIDEWALK details — right side (x=3400-4000)
    { kind: 'tree',           x: 3700, y: 900 },
    { kind: 'tree',           x: 3700, y: 1500 },
    { kind: 'tree',           x: 3700, y: 2100 },
    { kind: 'tree',           x: 3700, y: 2700 },
    { kind: 'streetlight',    x: 3600, y: 1200 },
    { kind: 'streetlight',    x: 3600, y: 1800 },
    { kind: 'streetlight',    x: 3600, y: 2400 },
    { kind: 'streetlight',    x: 3600, y: 3000 },
    { kind: 'trash',          x: 3800, y: 1100 },
    { kind: 'trash',          x: 3800, y: 2200 },
    { kind: 'mailbox',        x: 3650, y: 1700 },
    { kind: 'mailbox',        x: 3650, y: 2600 },
    { kind: 'newspaper',      x: 3750, y: 1900 },
    { kind: 'bench',          x: 3700, y: 1300 },
    { kind: 'bench',          x: 3700, y: 2500 },

    // ===== BACK ALLEY (y=0-700) =====
    { kind: 'dumpster',    x: 800,  y: 400 },
    { kind: 'dumpster',    x: 1200, y: 400 },
    { kind: 'dumpster',    x: 1500, y: 400 },
    { kind: 'dumpster',    x: 2500, y: 400 },
    { kind: 'dumpster',    x: 2800, y: 400 },
    { kind: 'dumpster',    x: 3200, y: 400 },
    { kind: 'trash',       x: 700,  y: 450 },
    { kind: 'trash',       x: 1100, y: 480 },
    { kind: 'trash',       x: 1450, y: 450 },
    { kind: 'trash',       x: 1700, y: 480 },
    { kind: 'trash',       x: 2300, y: 480 },
    { kind: 'trash',       x: 2550, y: 450 },
    { kind: 'trash',       x: 2900, y: 480 },
    { kind: 'trash',       x: 3300, y: 450 },
    { kind: 'trash_pile',  x: 900,  y: 500 },
    { kind: 'trash_pile',  x: 1800, y: 500 },
    { kind: 'trash_pile',  x: 2200, y: 500 },
    { kind: 'trash_pile',  x: 3100, y: 500 },
    { kind: 'cardboard_box', x: 1350, y: 500 },
    { kind: 'cardboard_box', x: 1400, y: 530 },
    { kind: 'cardboard_box', x: 2600, y: 530 },
    { kind: 'cardboard_box', x: 2650, y: 500 },
    { kind: 'pallet',      x: 800,  y: 580 },
    { kind: 'pallet',      x: 900,  y: 600 },
    { kind: 'pallet',      x: 3100, y: 580 },
    { kind: 'pallet',      x: 3200, y: 600 },
    { kind: 'graffiti',    x: 1800, y: 620 },
    { kind: 'graffiti',    x: 2200, y: 620 },
    { kind: 'graffiti',    x: 1100, y: 620 },
    { kind: 'graffiti',    x: 2900, y: 620 },
    { kind: 'air_conditioner', x: 700,  y: 350 },
    { kind: 'air_conditioner', x: 1300, y: 350 },
    { kind: 'air_conditioner', x: 2700, y: 350 },
    { kind: 'air_conditioner', x: 3300, y: 350 },
    { kind: 'puddle',      x: 1600, y: 550 },
    { kind: 'puddle',      x: 2400, y: 550 },
    { kind: 'manhole',     x: 1500, y: 600 },
    { kind: 'manhole',     x: 2500, y: 600 },
    { kind: 'getaway_van', x: 1950, y: 450 },  // ENDA flyktbilen (back-alley)
  ],

  // === LOOT-SPOTS (25 stycken) ===
  lootSpots: [
    // VAULT INNER — final tier
    { id: 'vi1', x: 1800, y: 850,  kind: 'gold_mega_stack', value: 15000, bagTime: 8, weight: 0.50 },
    { id: 'vi2', x: 2000, y: 850,  kind: 'gold_mega_stack', value: 15000, bagTime: 8, weight: 0.50 },
    { id: 'vi3', x: 2200, y: 850,  kind: 'gold_mega_stack', value: 15000, bagTime: 8, weight: 0.50 },
    { id: 'vi4', x: 1500, y: 950,  kind: 'cash_stack',      value: 7500,  bagTime: 4, weight: 0.30 },
    { id: 'vi5', x: 2500, y: 950,  kind: 'cash_stack',      value: 7500,  bagTime: 4, weight: 0.30 },
    { id: 'vi6', x: 1400, y: 800,  kind: 'safe_open',       value: 5000,  bagTime: 4, weight: 0.20 },
    { id: 'vi7', x: 2600, y: 800,  kind: 'safe_open',       value: 5000,  bagTime: 4, weight: 0.20 },
    // VAULT OUTER
    { id: 'vc1', x: 1450, y: 1200, kind: 'cash_stack',  value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vc2', x: 1700, y: 1200, kind: 'cash_stack',  value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vc3', x: 2300, y: 1200, kind: 'cash_stack',  value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vc4', x: 2550, y: 1200, kind: 'cash_stack',  value: 5000, bagTime: 3, weight: 0.25 },
    { id: 'vg1', x: 1600, y: 1450, kind: 'gold_stack',  value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg2', x: 1850, y: 1450, kind: 'gold_stack',  value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg3', x: 2150, y: 1450, kind: 'gold_stack',  value: 8000, bagTime: 5, weight: 0.40 },
    { id: 'vg4', x: 2400, y: 1450, kind: 'gold_stack',  value: 8000, bagTime: 5, weight: 0.40 },
    // CASHIER DRAWERS (stealth-accessible) — aligned med nya counter-positioner
    { id: 'cd1', x: 1400, y: 2330, kind: 'cash_drawer', value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd2', x: 1625, y: 2330, kind: 'cash_drawer', value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd3', x: 1825, y: 2330, kind: 'cash_drawer', value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd4', x: 2375, y: 2330, kind: 'cash_drawer', value: 500,  bagTime: 1, weight: 0.05 },
    { id: 'cd5', x: 2575, y: 2330, kind: 'cash_drawer', value: 500,  bagTime: 1, weight: 0.05 },
    // MANAGER SAFE (stealth-accessible)
    { id: 'msa', x: 3320, y: 2050, kind: 'manager_safe', value: 4000, bagTime: 4, weight: 0.20 },
    // CONFERENCE LAPTOPS (NEW — stealth)
    { id: 'lap1',x: 1700, y: 2180, kind: 'laptop',       value: 800,  bagTime: 2, weight: 0.08 },
    { id: 'lap2',x: 2000, y: 2200, kind: 'laptop',       value: 800,  bagTime: 2, weight: 0.08 },
    // SECURITY CONFISCATED (kräver guard-elim eller stealth)
    { id: 'sec', x: 3050, y: 1200, kind: 'filing_cabinet', value: 2500, bagTime: 3, weight: 0.15 },
    // LOCKER ROOM (stealth om locker-door lockpickad)
    { id: 'lkr1',x: 3000, y: 1020, kind: 'locker_open',  value: 600,  bagTime: 1, weight: 0.05 },
    { id: 'lkr2',x: 3200, y: 1020, kind: 'locker_open',  value: 600,  bagTime: 1, weight: 0.05 },
    // BREAK ROOM TIP JAR
    { id: 'tip', x: 820,  y: 2230, kind: 'tip_jar',      value: 300,  bagTime: 1, weight: 0.03 },
    // STORAGE BOXES (hidden cash i kartonger)
    { id: 'box1',x: 700,  y: 800,  kind: 'cardboard_box',value: 400,  bagTime: 2, weight: 0.08 },
    { id: 'box2',x: 1000, y: 830,  kind: 'cardboard_box',value: 400,  bagTime: 2, weight: 0.08 },
  ],

  // === CAMERAS (15 stycken — smart placement) ===
  cameras: [
    // Entry-zone
    { id: 'cam_front_door',   x: 2000, y: 3380, dir: -Math.PI/2,  cone: 0.7, range: 280 },
    { id: 'cam_reception',    x: 2000, y: 3200, dir: -Math.PI/2,  cone: 0.7, range: 280 },
    // Lobby (3 overlap)
    { id: 'cam_lobby_west',   x: 1100, y: 2800, dir: 0,           cone: 0.8, range: 300 },
    { id: 'cam_lobby_east',   x: 2900, y: 2800, dir: Math.PI,     cone: 0.8, range: 300 },
    { id: 'cam_lobby_center', x: 2000, y: 2750, dir: Math.PI/2,   cone: 0.7, range: 280 },
    // Counter
    { id: 'cam_counter_l',    x: 1500, y: 2480, dir: Math.PI/2,   cone: 0.6, range: 220 },
    { id: 'cam_counter_r',    x: 2500, y: 2480, dir: Math.PI/2,   cone: 0.6, range: 220 },
    // Hallway / corridor
    { id: 'cam_hallway',      x: 2000, y: 2000, dir: -Math.PI/2,  cone: 0.8, range: 280 },
    { id: 'cam_office_entry', x: 2950, y: 1900, dir: Math.PI,     cone: 0.7, range: 240 },
    // Vault zone
    { id: 'cam_vault_outer',  x: 2000, y: 1700, dir: -Math.PI/2,  cone: 0.7, range: 220 },
    { id: 'cam_vault_inner',  x: 2000, y: 1100, dir: -Math.PI/2,  cone: 0.7, range: 220 },
    // Specialized rooms
    { id: 'cam_break',        x: 900,  y: 2050, dir: Math.PI/2,   cone: 0.7, range: 240 },
    { id: 'cam_conference',   x: 1850, y: 2050, dir: Math.PI/2,   cone: 0.7, range: 220 },
    { id: 'cam_security',     x: 2900, y: 1200, dir: 0,           cone: 0.7, range: 240 },
    { id: 'cam_server',       x: 1080, y: 1700, dir: 0,           cone: 0.6, range: 220 },
  ],

  // === HACK-TERMINALS (5 vanliga + 1 master) ===
  hackTerminals: [
    { id: 'term1', x: 750,  y: 1380, disables: ['cam_front_door', 'cam_reception', 'cam_lobby_west'], hackTime: 4 },
    { id: 'term2', x: 800,  y: 1750, disables: ['cam_lobby_east', 'cam_lobby_center', 'cam_counter_l'], hackTime: 4 },
    { id: 'term3', x: 800,  y: 1900, disables: ['cam_counter_r', 'cam_hallway', 'cam_office_entry'], hackTime: 4 },
    { id: 'term4', x: 1850, y: 2050, disables: ['cam_break', 'cam_conference'], hackTime: 4 },  // i conference!
    { id: 'term5', x: 1080, y: 1700, disables: ['cam_vault_outer', 'cam_server'], hackTime: 4 },  // server-rum själv
    // MASTER — i security room, slår ut ALLA + vault-inner-cam
    { id: 'term_master', x: 3250, y: 1550, disables: ['cam_vault_inner', 'cam_security'], hackTime: 6, master: true },
  ],

  // === CIVILIANS (15 st spridda över alla rum) ===
  civilianSpawns: [
    // Lobby customers (5)
    { id: 'civ_c1', x: 1200, y: 2850, kind: 'customer' },
    { id: 'civ_c2', x: 1800, y: 2900, kind: 'customer' },
    { id: 'civ_c3', x: 2400, y: 2850, kind: 'customer' },
    { id: 'civ_c4', x: 1500, y: 3000, kind: 'customer' },
    { id: 'civ_c5', x: 2500, y: 3000, kind: 'customer' },
    // Cashiers (5 — en per station, central-gap förblir öppen)
    { id: 'civ_ca1', x: 1400, y: 2570, kind: 'cashier' },
    { id: 'civ_ca2', x: 1625, y: 2570, kind: 'cashier' },
    { id: 'civ_ca3', x: 1825, y: 2570, kind: 'cashier' },
    { id: 'civ_ca4', x: 2375, y: 2570, kind: 'cashier' },
    { id: 'civ_ca5', x: 2575, y: 2570, kind: 'cashier' },
    // Manager
    { id: 'civ_mg',  x: 3200, y: 2180, kind: 'manager' },
    // Manager assistant (reception)
    { id: 'civ_as',  x: 2900, y: 1880, kind: 'cashier' },
    // Conference attendees
    { id: 'civ_co1', x: 1900, y: 2080, kind: 'manager' },
    { id: 'civ_co2', x: 2050, y: 2340, kind: 'customer' },
    // Janitor (vandrar — high mobility, NEW)
    { id: 'civ_jan', x: 800,  y: 2300, kind: 'janitor' },
    // Reception
    { id: 'civ_re',  x: 2000, y: 3220, kind: 'cashier' },
  ],

  // === VAKTER (6 st — strategiska patrol-paths) ===
  guardSpawns: [
    { id: 'g_lobby',   x: 2000, y: 2800, kind: 'lobby_guard',
      patrol: [[1300, 2800], [2700, 2800]], facing: 0 },
    { id: 'g_hallway', x: 2000, y: 1850, kind: 'hallway_guard',
      patrol: [[1500, 1850], [2500, 1850]], facing: 0 },
    { id: 'g_server',  x: 800,  y: 1700, kind: 'server_guard',
      patrol: [[700, 1600], [1000, 1900]], facing: -Math.PI/2 },
    { id: 'g_office',  x: 3100, y: 1850, kind: 'office_guard',
      patrol: [[2900, 1800], [3300, 2200]], facing: -Math.PI/2 },
    { id: 'g_vault',   x: 2000, y: 1600, kind: 'vault_guard',  // NEW — utanför valvet
      patrol: [[1500, 1600], [2500, 1600]], facing: 0 },
    { id: 'g_security',x: 3100, y: 1400, kind: 'security_guard', // NEW — i security-rum
      patrol: [[2900, 1300], [3300, 1500]], facing: 0 },
  ],

  // === DRILL-SPOTS (outer + inner = double-tier) ===
  drillSpot: { x: 2000, y: 1720, r: 40, durationSec: 120 },
  drillSpotInner: { x: 2000, y: 1100, r: 40, durationSec: 90 },

  // === POLICE-SPAWN-POINTS ===
  policeSpawns: [
    { x: 2000, y: 3950, kind: 'street_front' },
    { x: 700,  y: 3950, kind: 'street_left' },
    { x: 3300, y: 3950, kind: 'street_right' },
    { x: 2000, y: 200,  kind: 'alley_back' },
    { x: 900,  y: 200,  kind: 'alley_loading' },
    { x: 100,  y: 2000, kind: 'side_west' },
    { x: 3900, y: 2000, kind: 'side_east' },
    { x: 100,  y: 3700, kind: 'street_far_left' },
    { x: 3900, y: 3700, kind: 'street_far_right' },
  ],

  // === ROLES (oförändrat — fortfarande relevant) ===
  roles: [
    { id: 'hacker', name: 'HACKER', perk: 'Osynlig för kameror + -50% hack-tid' },
    { id: 'tank',   name: 'TANK',   perk: '+50% maxHP, -10% rörelse' },
    { id: 'medic',  name: 'MEDIC',  perk: '+6 HP/s passiv regen (+8 solo)' },
    { id: 'rogue',  name: 'ROGUE',  perk: 'Silent-kill + 2× lockpick + 10% snabbare + -10% HP' },
  ],

  // === DOWN-STATE ===
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
