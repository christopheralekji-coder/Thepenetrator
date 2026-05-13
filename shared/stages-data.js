// Stage-data — speglar STAGES i game.js (måste hållas i sync)
// Uppdaterad till boss-revamp v119+ med miniBosses-array och nya bossKeys.
'use strict';

/**
 * @typedef {Object} MiniBoss
 * @property {string} type     - Enemy-base-typ (brute/ninja/sniper/shooter/etc)
 * @property {string} name     - Display-namn ('GROVE GRIPPER' etc)
 * @property {string} power    - AI-power-key (caster/tank_charger/cloaker/...)
 * @property {number} hpMul    - HP-multiplier vs base-enemy-typ
 * @property {number} dmgMul   - Damage-multiplier
 * @property {number} scale    - Visual scale-multiplier
 * @property {number} gold     - Gold-reward vid death
 */

/**
 * @typedef {Object} StageZone
 * @property {number} count    - Antal enemies i zonen
 * @property {string[]} pool   - Möjliga enemy-typer
 * @property {string} [event]  - Stage-event-key (release_dogs/alarm/etc)
 */

/**
 * @typedef {Object} Stage
 * @property {number} id
 * @property {string} name
 * @property {string} kind
 * @property {number} worldW
 * @property {number} worldH
 * @property {{x:number,y:number}} spawnPos
 * @property {{x:number,y:number}} goalPos
 * @property {number} [goalRadius]
 * @property {string} bossKey
 * @property {boolean} [isBoss]
 * @property {MiniBoss[]} miniBosses
 * @property {StageZone[]} zones
 */

/**
 * @typedef {Object} DiffMul
 * @property {number} enemyHp
 * @property {number} enemyDmg
 */

const STAGES = [
  { id: 1, name: 'DEN FÖRRUTTNADE SKOGEN', kind: 'forest', worldW: 2000, worldH: 2800,
    spawnPos: { x: 1000, y: 2640 }, goalPos: { x: 1000, y: 200 }, goalRadius: 100,
    bossKey: 'witheredelder',
    miniBosses: [
      { type: 'brute', name: 'GROVE GRIPPER',  power: 'caster',       hpMul: 7,  dmgMul: 1.6, scale: 1.3, gold: 120 },
      { type: 'brute', name: 'BARK WARDEN',    power: 'tank_charger', hpMul: 10, dmgMul: 1.9, scale: 1.5, gold: 180 },
      { type: 'ninja', name: 'SHADOW STALKER', power: 'cloaker',      hpMul: 14, dmgMul: 2.2, scale: 1.4, gold: 250 },
    ],
    zones: [
      { count: 8,  pool: ['grunt', 'runner'] },
      { count: 10, pool: ['grunt', 'dog', 'runner'], event: 'release_dogs' },
    ],
  },
  { id: 2, name: 'JÄRNVALLEN', kind: 'perimeter', worldW: 2200, worldH: 2400,
    spawnPos: { x: 1100, y: 2240 }, goalPos: { x: 1100, y: 200 }, goalRadius: 100,
    bossKey: 'ironclad',
    miniBosses: [
      { type: 'soldier', name: 'STEEL JAW',       power: 'brute_charger', hpMul: 7,  dmgMul: 1.7, scale: 1.3, gold: 150 },
      { type: 'sniper',  name: 'WIRE-EYE SENTRY', power: 'gas_sniper',    hpMul: 10, dmgMul: 2.0, scale: 1.3, gold: 220 },
      { type: 'soldier', name: 'BUNKER PRIME',    power: 'shielder',      hpMul: 14, dmgMul: 2.2, scale: 1.6, gold: 290 },
    ],
    zones: [
      { count: 8,  pool: ['grunt', 'soldier', 'dog'] },
      { count: 12, pool: ['soldier', 'shooter', 'brute', 'bomber'], event: 'alarm' },
    ],
  },
  { id: 3, name: 'SPEGELHALLEN', kind: 'lobby', worldW: 1700, worldH: 2400,
    spawnPos: { x: 850, y: 2240 }, goalPos: { x: 850, y: 200 }, goalRadius: 90,
    bossKey: 'mirroredone',
    miniBosses: [
      { type: 'ninja',   name: 'GLASS REAPER',  power: 'cloaker', hpMul: 7,  dmgMul: 1.7, scale: 1.2, gold: 170 },
      { type: 'shooter', name: 'ECHO PRIEST',   power: 'caster',  hpMul: 10, dmgMul: 1.9, scale: 1.3, gold: 230 },
      { type: 'shooter', name: 'HOLLOW DANCER', power: 'plasma',  hpMul: 14, dmgMul: 2.2, scale: 1.4, gold: 310 },
    ],
    zones: [
      { count: 9,  pool: ['grunt', 'soldier'] },
      { count: 12, pool: ['ninja', 'soldier'], event: 'open_doors' },
    ],
  },
  { id: 4, name: 'BENBARACKEN', kind: 'barracks', worldW: 1800, worldH: 1800,
    spawnPos: { x: 900, y: 1620 }, goalPos: { x: 900, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'ossarius',
    miniBosses: [
      { type: 'brute',   name: 'BONE-CRACK CAPTAIN', power: 'brute_charger', hpMul: 8,  dmgMul: 1.8, scale: 1.4, gold: 200 },
      { type: 'brute',   name: 'COFFIN-MAKER',       power: 'tank_charger',  hpMul: 11, dmgMul: 2.1, scale: 1.5, gold: 270 },
      { type: 'shooter', name: 'TWITCHING REGIMENT', power: 'avatar',        hpMul: 15, dmgMul: 2.3, scale: 1.5, gold: 340 },
    ],
    zones: [
      { count: 8,  pool: ['grunt', 'soldier'] },
      { count: 10, pool: ['brute', 'soldier'], event: 'barracks_open' },
    ],
  },
  { id: 5, name: 'VALV XIII', kind: 'hangar', worldW: 2600, worldH: 2000,
    spawnPos: { x: 200, y: 1000 }, goalPos: { x: 2400, y: 1000 }, goalRadius: 100,
    bossKey: 'vanguardatlas',
    miniBosses: [
      { type: 'robot',  name: 'PROTOTYPE Z-7', power: 'plasma',     hpMul: 8,  dmgMul: 1.8, scale: 1.3, gold: 220 },
      { type: 'sniper', name: 'TURRET-87',     power: 'gas_sniper', hpMul: 11, dmgMul: 2.1, scale: 1.3, gold: 290 },
      { type: 'robot',  name: 'SKUNKWORKS',    power: 'avatar',     hpMul: 15, dmgMul: 2.3, scale: 1.5, gold: 370 },
    ],
    zones: [
      { count: 9,  pool: ['soldier', 'shooter'] },
      { count: 12, pool: ['brute', 'robot', 'shooter', 'sniper'], event: 'fuel_blast' },
    ],
  },
  { id: 6, name: 'ASKE-DEPÅN', kind: 'depot', worldW: 2000, worldH: 2000,
    spawnPos: { x: 1000, y: 1820 }, goalPos: { x: 1000, y: 200 }, goalRadius: 90,
    bossKey: 'emberoracle',
    miniBosses: [
      { type: 'shooter', name: 'ASH PRIEST',    power: 'caster',  hpMul: 8,  dmgMul: 1.8, scale: 1.4, gold: 240 },
      { type: 'soldier', name: 'PYRE-CRAWLER',  power: 'jetpack', hpMul: 11, dmgMul: 2.0, scale: 1.4, gold: 320 },
      { type: 'ninja',   name: 'WICK & EMBER',  power: 'avatar',  hpMul: 15, dmgMul: 2.3, scale: 1.5, gold: 400 },
    ],
    zones: [
      { count: 10, pool: ['soldier', 'shooter'] },
      { count: 12, pool: ['brute', 'ninja', 'shooter', 'healer', 'summoner'], event: 'barrel_chain' },
    ],
  },
  { id: 7, name: 'BRUTET LASTRUM', kind: 'cargo', worldW: 1900, worldH: 1900,
    spawnPos: { x: 950, y: 1700 }, goalPos: { x: 950, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'blightsovereign',
    miniBosses: [
      { type: 'sniper',  name: 'TOXIC SHADE',      power: 'gas_sniper', hpMul: 7,  dmgMul: 2.0, scale: 1.3, gold: 270 },
      { type: 'ninja',   name: 'DRIFTSPECTRE',     power: 'cloaker',    hpMul: 10, dmgMul: 2.2, scale: 1.3, gold: 350 },
      { type: 'shooter', name: 'VENOM ARCHITECT', power: 'caster',      hpMul: 14, dmgMul: 2.4, scale: 1.4, gold: 440 },
    ],
    zones: [
      { count: 8,  pool: ['soldier', 'shooter'] },
      { count: 10, pool: ['ninja', 'brute', 'shooter'], event: 'crane_drop' },
    ],
  },
  { id: 8, name: 'DEN SJUNKNA KRYPTAN', kind: 'bunker', worldW: 1500, worldH: 2800,
    spawnPos: { x: 750, y: 2640 }, goalPos: { x: 750, y: 200 }, goalRadius: 80,
    bossKey: 'buriedcrown',
    miniBosses: [
      { type: 'brute',     name: 'DEEP-CHASER',       power: 'brute_charger', hpMul: 8,  dmgMul: 1.9, scale: 1.4, gold: 300 },
      { type: 'swordsman', name: 'SHATTERED MARSHAL', power: 'shielder',      hpMul: 12, dmgMul: 2.2, scale: 1.5, gold: 390 },
      { type: 'shooter',   name: 'SUBSONIC PROPHET',  power: 'plasma',        hpMul: 16, dmgMul: 2.5, scale: 1.6, gold: 490 },
    ],
    zones: [
      { count: 10, pool: ['soldier', 'ninja'] },
      { count: 14, pool: ['swordsman', 'robot', 'ninja', 'swarmer', 'sniper'], event: 'lights_flicker' },
    ],
  },
  { id: 9, name: 'OMEGA-KÄRNAN', kind: 'command', worldW: 1800, worldH: 1800,
    spawnPos: { x: 900, y: 1620 }, goalPos: { x: 900, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'lastsovereign',
    miniBosses: [
      { type: 'robot',   name: 'OMEGA-LOGIC',     power: 'avatar',     hpMul: 9,  dmgMul: 2.1, scale: 1.5, gold: 380 },
      { type: 'shooter', name: 'SOULFIRE WARDEN', power: 'jetpack',    hpMul: 13, dmgMul: 2.4, scale: 1.5, gold: 480 },
      { type: 'sniper',  name: 'VOID JUDGE',      power: 'gas_sniper', hpMul: 19, dmgMul: 2.7, scale: 1.6, gold: 600 },
    ],
    zones: [
      { count: 8,  pool: ['soldier', 'ninja'] },
      { count: 10, pool: ['robot', 'brute', 'ninja'], event: 'core_pulse' },
    ],
  },
];

/**
 * Hämta stage-config för given wave (clampad till sista stage).
 * @param {number} wave
 * @returns {Stage}
 */
function getStage(wave) {
  return STAGES[Math.min(wave - 1, STAGES.length - 1)];
}

const DIFF_MULTIPLIERS = {
  recruit:  { enemyHp: 0.7, enemyDmg: 0.7 },
  veteran:  { enemyHp: 1.0, enemyDmg: 1.0 },
  hard:     { enemyHp: 1.4, enemyDmg: 1.3 },
  nightmare:{ enemyHp: 1.8, enemyDmg: 1.6 },
};

// Helper-funktioner som server (waves.js, enemies.js) använder. Tidigare av misstag
// borttagna i shared/stages-data omskrivning → server kraschade varje tick med
// 'getDiffMul is not a function' → inga enemies spawnade någonsin i coop server-sim.
// JSDoc-typer fångar liknande regressioner i framtiden.

/**
 * @param {string} difficulty - 'recruit' | 'veteran' | 'hard' | 'nightmare'
 * @returns {DiffMul}
 */
function getDiffMul(difficulty) {
  return DIFF_MULTIPLIERS[difficulty] || DIFF_MULTIPLIERS.veteran;
}

/**
 * NG+-scaling. NG=1.0, NG+=1.5, NG++=2.0, ... cap NG+++++=3.5.
 * @param {number} ngpLevel - 0..5
 * @returns {number}
 */
function getNGPMul(ngpLevel) {
  const lvl = Math.max(0, Math.min(5, ngpLevel || 0));
  return 1 + lvl * 0.5;
}

/**
 * Coop-multiplier för enemy-HP så svårighet håller jämn nivå per spelare.
 * Tidigare 1.6/2.2/2.8 vid 2/3/4p — gjorde coop *lättare* än solo eftersom
 * 4 spelares firepower är ~4× men HP bara 2.8×. Höjt till 1.85/2.7/3.55/4.4.
 * @param {number} playerCount
 * @returns {number}
 */
function getCoopMultiplier(playerCount) {
  const n = Math.max(1, playerCount || 1);
  // 0.85 per spelare: 4p HP×3.55 + dmg×1.45 + spawn×1.45 vs 4× firepower
  // = 0.89× effective difficulty vs solo (11% lättare). Standard "co-op
  // trivializer" feel som matchar spelar-förväntning. Tidigare 0.70 gav
  // 0.78× = 22% lättare än solo, vilket motsade kommentaren.
  return 1 + (n - 1) * 0.85;
}

/**
 * Coop enemy-damage-scaling: +15% dmg per extra spelare (1.0/1.15/1.30/1.45).
 * Solo känns just nu tätare än 4p — det här pressar 4p-grupperna mer.
 * @param {number} playerCount
 * @returns {number}
 */
function getCoopDmgMultiplier(playerCount) {
  const n = Math.max(1, playerCount || 1);
  return 1 + (n - 1) * 0.15;
}

/**
 * Coop enemy-spawn-count-scaling: +15% spawn per extra spelare så svärmen växer.
 * @param {number} playerCount
 * @returns {number}
 */
function getCoopSpawnMultiplier(playerCount) {
  const n = Math.max(1, playerCount || 1);
  return 1 + (n - 1) * 0.15;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STAGES, getStage, DIFF_MULTIPLIERS, getDiffMul, getNGPMul, getCoopMultiplier, getCoopDmgMultiplier, getCoopSpawnMultiplier };
}
