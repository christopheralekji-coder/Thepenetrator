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
  { id: 1, name: 'DE VISSNA SKOGARNA', kind: 'forest', worldW: 2000, worldH: 2800,
    spawnPos: { x: 1000, y: 2640 }, goalPos: { x: 1000, y: 220 }, goalRadius: 100,
    bossKey: 'witheredelder',
    miniBosses: [
      { type: 'forest_miniboss', name: 'SPORE BEHEMOTH',       power: '', hpMul: 6,  dmgMul: 1.6, scale: 1.4,  gold: 180 },
      { type: 'forest_miniboss', name: 'ELDER SPORE BEHEMOTH', power: '', hpMul: 9,  dmgMul: 1.9, scale: 1.5,  gold: 260 },
    ],
    zones: [
      { count: 8,  pool: ['forest_mosshusk', 'forest_sporefly', 'forest_chokecap', 'forest_rotbloom'] },
      { count: 10, pool: ['forest_sporespitter', 'forest_cursewisp', 'forest_vinelasher', 'forest_sporemother', 'forest_rotbloom'], event: 'release_dogs' },
    ],
  },
  { id: 2, name: 'DEN BRÄNDA ÖKNEN', kind: 'desert', worldW: 2200, worldH: 2600,
    spawnPos: { x: 1100, y: 2440 }, goalPos: { x: 1100, y: 220 }, goalRadius: 100,
    bossKey: 'buriedcrown',
    miniBosses: [
      { type: 'desert_miniboss', name: 'TOMB COLOSSUS',         power: '', hpMul: 6,  dmgMul: 1.6, scale: 1.4,  gold: 200 },
      { type: 'desert_miniboss', name: 'ANCIENT TOMB COLOSSUS', power: '', hpMul: 9,  dmgMul: 2.0, scale: 1.5,  gold: 290 },
    ],
    zones: [
      { count: 9,  pool: ['desert_jackal', 'desert_husk', 'desert_reaver', 'desert_sandram'] },
      { count: 12, pool: ['desert_mirage', 'desert_lurker', 'desert_tarspitter', 'desert_warden', 'desert_husk'], event: 'alarm' },
    ],
  },
  { id: 3, name: 'JÄRNPERIMETERN', kind: 'military', worldW: 2200, worldH: 2400,
    spawnPos: { x: 1100, y: 2240 }, goalPos: { x: 1100, y: 220 }, goalRadius: 100,
    bossKey: 'ironclad',
    miniBosses: [
      { type: 'military_miniboss', name: 'JUGGER-MECH',       power: '', hpMul: 6,  dmgMul: 1.7, scale: 1.4,  gold: 200 },
      { type: 'military_miniboss', name: 'SIEGE JUGGER-MECH', power: '', hpMul: 9,  dmgMul: 2.0, scale: 1.5,  gold: 290 },
    ],
    zones: [
      { count: 9,  pool: ['grunt', 'soldier', 'dog'] },
      { count: 13, pool: ['soldier', 'shooter', 'brute', 'bomber'], event: 'alarm' },
    ],
  },
  { id: 4, name: 'BENKATAKOMBEN', kind: 'ossuary', worldW: 1900, worldH: 2600,
    spawnPos: { x: 950, y: 2440 }, goalPos: { x: 950, y: 220 }, goalRadius: 100,
    bossKey: 'ossarius',
    miniBosses: [
      { type: 'ossuary_miniboss', name: 'GRAVE TITAN',       power: '', hpMul: 7,  dmgMul: 1.7, scale: 1.4,  gold: 210 },
      { type: 'ossuary_miniboss', name: 'ELDER GRAVE TITAN', power: '', hpMul: 10, dmgMul: 2.0, scale: 1.5,  gold: 300 },
    ],
    zones: [
      { count: 8,  pool: ['ossuary_shambler', 'ossuary_colossus', 'ossuary_spitter', 'ossuary_splitter'] },
      { count: 11, pool: ['ossuary_wisp', 'ossuary_lancer', 'ossuary_bulwark', 'ossuary_hook_wraith', 'ossuary_splitter'], event: 'barracks_open' },
    ],
  },
  { id: 5, name: 'GIFTTRÄSKET', kind: 'swamp', worldW: 2000, worldH: 2600,
    spawnPos: { x: 1000, y: 2440 }, goalPos: { x: 1000, y: 220 }, goalRadius: 100,
    bossKey: 'blightsovereign',
    miniBosses: [
      { type: 'swamp_miniboss', name: 'PLAGUE HULK',       power: '', hpMul: 7,  dmgMul: 1.7, scale: 1.4,  gold: 210 },
      { type: 'swamp_miniboss', name: 'ELDER PLAGUE HULK', power: '', hpMul: 10, dmgMul: 2.0, scale: 1.5,  gold: 300 },
    ],
    zones: [
      { count: 10, pool: ['swamp_oozeling', 'swamp_leech', 'swamp_drowned', 'swamp_spitter'] },
      { count: 12, pool: ['swamp_wisp', 'swamp_bloat', 'swamp_angler', 'swamp_bulwark', 'swamp_oozeling'], event: 'crane_drop' },
    ],
  },
  { id: 6, name: 'VULKANEN', kind: 'volcano', worldW: 2200, worldH: 2600,
    spawnPos: { x: 1100, y: 2440 }, goalPos: { x: 1100, y: 220 }, goalRadius: 100,
    bossKey: 'emberoracle',
    miniBosses: [
      { type: 'volcano_miniboss', name: 'MAGMA GOLEM',       power: '', hpMul: 7,  dmgMul: 1.8, scale: 1.4,  gold: 220 },
      { type: 'volcano_miniboss', name: 'ELDER MAGMA GOLEM', power: '', hpMul: 11, dmgMul: 2.1, scale: 1.5,  gold: 310 },
    ],
    zones: [
      { count: 10, pool: ['volcano_cinderling', 'volcano_magma_hound', 'volcano_slag_behemoth', 'volcano_molten_spawn'] },
      { count: 13, pool: ['volcano_pyre_zealot', 'volcano_ember_seer', 'volcano_obsidian_ram', 'volcano_lava_warden', 'volcano_molten_spawn'], event: 'barrel_chain' },
    ],
  },
  { id: 7, name: 'FRUSNA ARKTIS', kind: 'arctic', worldW: 2200, worldH: 2600,
    spawnPos: { x: 1100, y: 2440 }, goalPos: { x: 1100, y: 220 }, goalRadius: 100,
    bossKey: 'mirroredone',
    miniBosses: [
      { type: 'arctic_miniboss', name: 'FROST WYRM',       power: '', hpMul: 8,  dmgMul: 1.8, scale: 1.4,  gold: 220 },
      { type: 'arctic_miniboss', name: 'ELDER FROST WYRM', power: '', hpMul: 11, dmgMul: 2.1, scale: 1.5,  gold: 310 },
    ],
    zones: [
      { count: 10, pool: ['arctic_rimeguard', 'arctic_behemoth', 'arctic_shardcaster', 'arctic_brittlerevenant'] },
      { count: 13, pool: ['arctic_frostseer', 'arctic_permacrawler', 'arctic_avalanche', 'arctic_mirrorsentinel', 'arctic_brittlerevenant'], event: 'open_doors' },
    ],
  },
  { id: 8, name: 'KRISTALLGROTTORNA', kind: 'crystal_cave', worldW: 1800, worldH: 2800,
    spawnPos: { x: 900, y: 2640 }, goalPos: { x: 900, y: 220 }, goalRadius: 100,
    bossKey: 'vanguardatlas',
    miniBosses: [
      { type: 'crystal_cave_miniboss', name: 'GEODE GUARDIAN',       power: '', hpMul: 8,  dmgMul: 1.9, scale: 1.4,  gold: 240 },
      { type: 'crystal_cave_miniboss', name: 'ELDER GEODE GUARDIAN', power: '', hpMul: 12, dmgMul: 2.2, scale: 1.5,  gold: 330 },
    ],
    zones: [
      { count: 11, pool: ['crystal_cave_crawler', 'crystal_cave_shard_skitter', 'crystal_cave_prism_stalker', 'crystal_cave_refraction_lurker'] },
      { count: 14, pool: ['crystal_cave_lumen_wisp', 'crystal_cave_prism_lance', 'crystal_cave_facet_guardian', 'crystal_cave_resonant_cantor', 'crystal_cave_crawler'], event: 'lights_flicker' },
    ],
  },
  { id: 9, name: 'OMEGA-KÄRNAN', kind: 'omega', worldW: 2000, worldH: 2400,
    spawnPos: { x: 1000, y: 2240 }, goalPos: { x: 1000, y: 220 }, goalRadius: 100,
    bossKey: 'lastsovereign',
    miniBosses: [
      { type: 'omega_miniboss', name: 'SENTINEL PRIME',      power: '', hpMul: 9,  dmgMul: 1.9, scale: 1.4,  gold: 240 },
      { type: 'omega_miniboss', name: 'APEX SENTINEL PRIME', power: '', hpMul: 13, dmgMul: 2.3, scale: 1.55, gold: 340 },
    ],
    zones: [
      { count: 10, pool: ['omega_chrome_husk', 'omega_volt_wisp', 'omega_core_juggernaut', 'omega_overload_cell'] },
      { count: 12, pool: ['omega_seeker_drone', 'omega_arc_lance', 'omega_nanite_mass', 'omega_aegis_dish', 'omega_chrome_husk'], event: 'core_pulse' },
    ],
  },
  { id: 10, name: 'VÄKTARENS FÄSTNING', kind: 'fortress', worldW: 2200, worldH: 2800,
    spawnPos: { x: 1100, y: 2640 }, goalPos: { x: 1100, y: 300 }, goalRadius: 120,
    bossKey: 'thewarden',
    miniBosses: [
      { type: 'fortress_miniboss', name: 'BLACK KNIGHT',      power: '', hpMul: 10, dmgMul: 2.0, scale: 1.45, gold: 260 },
      { type: 'fortress_miniboss', name: 'IRON BLACK KNIGHT', power: '', hpMul: 14, dmgMul: 2.5, scale: 1.55, gold: 360 },
    ],
    zones: [
      { count: 12, pool: ['fortress_ironguard', 'fortress_colossus', 'fortress_crossbow', 'fortress_tower_shield'] },
      { count: 15, pool: ['fortress_ballista', 'fortress_lancer', 'fortress_herald', 'fortress_hook', 'fortress_ironguard'], event: 'alarm' },
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

// v1.418: Lagt till casual/hardcore/insane (klient-naming) så server-sim faktiskt
// applicerar diff-multiplier. Tidigare bug: klient skickade 'casual' men shared
// kände bara 'recruit/veteran/hard/nightmare' → casual föll tillbaka till veteran
// (1.0×) → spelarna kände CD som svårare än vad casual borde vara.
// 'casual' satt extra mjukt (0.4/0.5) per user-feedback "boss för svår på casual".
const DIFF_MULTIPLIERS = {
  casual:    { enemyHp: 0.4, enemyDmg: 0.5 },
  recruit:   { enemyHp: 0.7, enemyDmg: 0.7 },
  veteran:   { enemyHp: 1.0, enemyDmg: 1.0 },
  hard:      { enemyHp: 1.4, enemyDmg: 1.3 },
  hardcore:  { enemyHp: 1.3, enemyDmg: 1.3 },
  nightmare: { enemyHp: 1.8, enemyDmg: 1.6 },
  insane:    { enemyHp: 2.5, enemyDmg: 2.0 },
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
  // v1.697b: 0.15→0.30. Endast CD/Survivors använder denna (story-dmg har egen formel).
  // Balans-re-audit: vid 0.15 blev co-op "för säkert" (inkommande dmg/spelare ~0.53× @8p
  // pga svärmen sprids snabbare än bufften kompenserade). 0.30 → ~0.76×/spelare = co-op
  // fortf. lite säkrare än solo (rätt feel) men inte trivialt.
  return 1 + (n - 1) * 0.30;
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
