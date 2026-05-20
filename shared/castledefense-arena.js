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
  startShield: 100,                // v1.403: shield-system (samma som PvP) — skydd mot minions
  maxShield: 100,
  startWeapon: 'pistol',           // v1.401: börjar med pistol, progresserar via boss-kills
  startGrenades: 2,                // 2 grenades vid match-start
  shieldRegenPerWave: 50,          // shield återställs +50 per cleared wave

  // === VAPENPROGRESSION (v1.401) ===
  // 12 vapen. Start = tier 0 (pistol). Varje boss-kill ger +1 tier.
  // Plockad ur GG-listan med de svagaste (shuriken, burstpistol, sonic) borttagna.
  weaponProgression: [
    'pistol',      // 0 — start
    'shotgun',     // 1 — boss 1 (wave 5)
    'revolver',    // 2 — boss 2 (wave 10)
    'smg',         // 3 — boss 3 (wave 15)
    'bow',         // 4 — boss 4 (wave 20)
    'crossbow',    // 5 — boss 5 (wave 25)
    'rifle',       // 6 — boss 6 (wave 30)
    'sniper',      // 7 — boss 7 (wave 35)
    'plasma',      // 8 — boss 8 (wave 40)
    'minigun',     // 9 — boss 9 (wave 45)
    'rocket',      // 10 — boss 10 (wave 50)
    'railgun',     // 11 — boss 11 (wave 55) — final, ranged piercing (sledge byttes ut: melee var en straff på final-tier)
  ],
  // Grenades per cleared wave (v1.401)
  grenadesPerWave: 2,

  // v1.416: 10 Hero perks (unique per spelare — kan inte tas av två)
  heroPerks: [
    { id: 'tank',         icon: '🛡', name: 'TANK',         desc: '+50% maxHP · -20% rörelse · -25% melee-dmg' },
    { id: 'builder',      icon: '🏗', name: 'BUILDER',      desc: '-30% bygg + uppgrade-cost · gratis första wall/wave' },
    { id: 'gunner',       icon: '💥', name: 'GUNNER',       desc: '+40% vapen-skada · +30% ammo-cap' },
    { id: 'medic',        icon: '💚', name: 'MEDIC',        desc: 'Auto-regen 2hp/s · revive 2x snabbare · repair-stn +50%' },
    { id: 'scout',        icon: '⚡', name: 'SCOUT',        desc: '+40% rörelsehastighet · +50% dash-cooldown-reduction' },
    { id: 'sharpshooter', icon: '🎯', name: 'SHARPSHOOTER', desc: '25% chans crit (2x dmg) · +50% bullet-räckvidd' },
    { id: 'strategist',   icon: '🧠', name: 'STRATEGIST',   desc: 'Auto-turrets i 250px aura får +35% dmg + range' },
    { id: 'berserker',    icon: '🔥', name: 'BERSERKER',    desc: 'Vid <50% hp: +1% dmg per saknad hp (max +50%)' },
    { id: 'looter',       icon: '💰', name: 'LOOTER',       desc: '+60% gold från kills · 10% chans ammo-drop' },
    { id: 'gambler',      icon: '🎲', name: 'GAMBLER',      desc: '15% chans efter kill: 3x gold / +1 granat / shield-refill' },
  ],

  // === DOWN-STATE (fas 6) ===
  downBleedoutSec: 25,
  downReviveSec: 4,
  downCrawlSpeedMul: 0.5,
  downReviveRadius: 60,

  // === WAVE-SCALING (v1.412: balance — wave 1 mindre brutal, paus lite längre)
  waveBaseCount: 8,                  // 12→8 (wave 1 mindre överväldigande)
  waveScalePerWave: 4,
  waveBetweenSec: 8,                 // 6→8 (mer build-tid)
  bossEveryWave: 5,

  // === BUILD-SYSTEM ===
  buildGridSize: 30,
  startGold: 600,                    // 400→600 (mer gold när inget är pre-built)
  waveBonusBase: 180,                // 150→180
  waveBonusPerWave: 35,              // 30→35
  // v1.422: BALANCE-PASS — sänkta base-priser och flackare upgrade-curve.
  // Tidigare: max ut ETT auto_turret kostade ~34k g (~17-34 vågor). Nu ~21k → ~10-15 vågor.
  // Behov av spridning: spelaren ska kunna ha 3-5 maxade torn på wave 20+, inte 1.
  buildables: {
    wall:        { cost: 60,   hp: 250, w: 30, h: 30, hpScalePerLvl: 1.2 },        // 75→60
    auto_turret: { cost: 550,  hp: 200, w: 30, h: 30, range: 165, dps: 20, fireRate: 2.0 }, // range 220→165 (-25%)
    man_turret:  { cost: 950,  hp: 350, w: 30, h: 30, range: 225, dpsMul: 2.5 },   // range 300→225 (-25%)
    spike_trap:  { cost: 160,  hp: 250, w: 30, h: 30, dmgOnPass: 30, killCapacity: 5 }, // 200→160
    slow_trap:   { cost: 250,  hp: 120, w: 30, h: 30, slowMul: 0.4, slowDurSec: 2, radius: 140 }, // 300→250
    repair_stn:  { cost: 400,  hp: 200, w: 30, h: 30, healPerSec: 1, radius: 140, healScalePerLvl: 2.0 }, // 500→400
    health_stn:  { cost: 500,  hp: 150, w: 30, h: 30, playerHealPerSec: 3, radius: 140 }, // 600→500
  },
  // v1.410/v1.422: Level-system. upgradeCost = baseCost × upgradeCostBase × (lvl+1)^upgradeCostExp
  // Sänkt från 0.6 × 1.3 (max ~10500g/turret) till 0.5 × 1.2 (max ~5800g/turret).
  maxBuildLevel: 9,
  upgradeCostBase: 0.5,              // 0.6→0.5
  upgradeCostExp: 1.2,               // 1.3→1.2
  // Stats scalar STÖRRE per level (user-feedback "större skillnad")
  upgradeStatMul: {
    hp:    0.50,    // +50% hp/lvl (9 = 5.5x base)
    dps:   0.45,    // +45% dps/lvl
    range: 0.10,    // +10% range/lvl
    heal:  0.40,    // +40% healing/lvl
    dmg:   0.40,    // +40% dmg/lvl
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CASTLEDEFENSE_ARENA };
}
if (typeof window !== 'undefined') {
  window.CASTLEDEFENSE_ARENA = CASTLEDEFENSE_ARENA;
}
