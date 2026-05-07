// Stage-data — speglar STAGES i game.js:23-150.
// MÅSTE hållas i sync.
'use strict';

const STAGES = [
  { id: 1, name: 'SKOGEN', kind: 'forest', worldW: 2000, worldH: 2800,
    spawnPos: { x: 1000, y: 2640 }, goalPos: { x: 1000, y: 200 }, goalRadius: 100,
    bossKey: 'likvakare',
    miniBoss: { type: 'brute', name: 'Skogsjätten', hpMul: 5, dmgMul: 1.6, scale: 1.5, gold: 80 },
    zones: [
      { count: 8,  pool: ['grunt', 'runner'] },
      { count: 10, pool: ['grunt', 'dog', 'runner'], event: 'release_dogs' },
    ],
  },
  { id: 2, name: 'PERIMETERN', kind: 'perimeter', worldW: 2200, worldH: 2400,
    spawnPos: { x: 1100, y: 2240 }, goalPos: { x: 1100, y: 200 }, goalRadius: 100,
    bossKey: 'benkrossare',
    miniBoss: { type: 'soldier', name: 'Sergeant Krass', hpMul: 5, dmgMul: 1.5, scale: 1.4, gold: 100 },
    zones: [
      { count: 8,  pool: ['grunt', 'soldier', 'dog'] },
      { count: 12, pool: ['soldier', 'shooter', 'brute', 'bomber'], event: 'alarm' },
    ],
  },
  { id: 3, name: 'LOBBYN', kind: 'lobby', worldW: 1700, worldH: 2400,
    spawnPos: { x: 850, y: 2240 }, goalPos: { x: 850, y: 200 }, goalRadius: 90,
    bossKey: 'strypare',
    miniBoss: { type: 'ninja', name: 'Skuggdansaren', hpMul: 4, dmgMul: 1.5, scale: 1.3, gold: 110 },
    zones: [
      { count: 9,  pool: ['grunt', 'soldier'] },
      { count: 12, pool: ['ninja', 'soldier'], event: 'open_doors' },
    ],
  },
  { id: 4, name: 'BARACK-GÅRDEN', kind: 'barracks', worldW: 1800, worldH: 1800,
    spawnPos: { x: 900, y: 1620 }, goalPos: { x: 900, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'avrattare',
    miniBoss: { type: 'brute', name: 'Korpral Köttkrok', hpMul: 6, dmgMul: 1.7, scale: 1.5, gold: 130 },
    zones: [
      { count: 8,  pool: ['grunt', 'soldier'] },
      { count: 10, pool: ['brute', 'soldier'], event: 'barracks_open' },
    ],
  },
  { id: 5, name: 'HANGAREN', kind: 'hangar', worldW: 2600, worldH: 2000,
    spawnPos: { x: 200, y: 1000 }, goalPos: { x: 2400, y: 1000 }, goalRadius: 100,
    bossKey: 'kottkvarn',
    miniBoss: { type: 'robot', name: 'Prototyp X-19', hpMul: 5, dmgMul: 1.6, scale: 1.4, gold: 150 },
    zones: [
      { count: 9,  pool: ['soldier', 'shooter'] },
      { count: 12, pool: ['brute', 'robot', 'shooter', 'sniper'], event: 'fuel_blast' },
    ],
  },
  { id: 6, name: 'AMMO-DEPÅN', kind: 'depot', worldW: 2000, worldH: 2000,
    spawnPos: { x: 1000, y: 1820 }, goalPos: { x: 1000, y: 200 }, goalRadius: 90,
    bossKey: 'askmakare',
    miniBoss: { type: 'summoner', name: 'Hög-rituallisten', hpMul: 5, dmgMul: 1.4, scale: 1.4, gold: 160 },
    zones: [
      { count: 10, pool: ['soldier', 'shooter'] },
      { count: 12, pool: ['brute', 'ninja', 'shooter', 'healer', 'summoner'], event: 'barrel_chain' },
    ],
  },
  { id: 7, name: 'LASTHANGAREN', kind: 'cargo', worldW: 1900, worldH: 1900,
    spawnPos: { x: 950, y: 1700 }, goalPos: { x: 950, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'lungrivare',
    miniBoss: { type: 'sniper', name: 'Tysta Doktorn', hpMul: 4, dmgMul: 1.8, scale: 1.3, gold: 180 },
    zones: [
      { count: 8,  pool: ['soldier', 'shooter'] },
      { count: 10, pool: ['ninja', 'brute', 'shooter'], event: 'crane_drop' },
    ],
  },
  { id: 8, name: 'BUNKER-TUNNLAR', kind: 'bunker', worldW: 1500, worldH: 2800,
    spawnPos: { x: 750, y: 2640 }, goalPos: { x: 750, y: 200 }, goalRadius: 80,
    bossKey: 'skallsprackare',
    miniBoss: { type: 'swordsman', name: 'Bunker-mästaren', hpMul: 6, dmgMul: 1.6, scale: 1.5, gold: 200 },
    zones: [
      { count: 10, pool: ['soldier', 'ninja'] },
      { count: 14, pool: ['swordsman', 'robot', 'ninja', 'swarmer', 'sniper'], event: 'lights_flicker' },
    ],
  },
  { id: 9, name: 'KOMMANDO-CELLEN', kind: 'command', worldW: 1800, worldH: 1800,
    spawnPos: { x: 900, y: 1620 }, goalPos: { x: 900, y: 700 }, goalRadius: 0,
    isBoss: true, bossKey: 'sjalaatare', bossKey2: 'gravgravaren',
    miniBoss: { type: 'robot', name: 'Mourads Mardröm', hpMul: 7, dmgMul: 1.8, scale: 1.6, gold: 250 },
    zones: [
      { count: 8,  pool: ['soldier', 'ninja'] },
      { count: 10, pool: ['robot', 'brute', 'ninja'], event: 'jimmy_screens' },
    ],
  },
];

function getStage(wave) {
  return STAGES[Math.min(wave - 1, STAGES.length - 1)];
}

// Difficulty multipliers — speglar DIFF_MULTIPLIERS i game.js (förenklat)
const DIFF_MULTIPLIERS = {
  recruit:  { enemyHp: 0.7, enemyDmg: 0.7 },
  veteran:  { enemyHp: 1.0, enemyDmg: 1.0 },
  hard:     { enemyHp: 1.4, enemyDmg: 1.3 },
  nightmare:{ enemyHp: 1.8, enemyDmg: 1.6 },
};

function getDiffMul(difficulty) {
  return DIFF_MULTIPLIERS[difficulty] || DIFF_MULTIPLIERS.veteran;
}

function getCoopMultiplier(playerCount) {
  return Math.max(1, playerCount || 1);
}

function getNGPMul(ngpLevel) {
  return 1 + (ngpLevel || 0) * 0.15;
}

module.exports = { STAGES, getStage, getDiffMul, getCoopMultiplier, getNGPMul, DIFF_MULTIPLIERS };
