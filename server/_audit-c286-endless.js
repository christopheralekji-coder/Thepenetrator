'use strict';
// Audit C286-regressionstest: en bosslös stage (endless icke-boss-våg) ska KLARAS, inte hänga.
const assert = require('assert');
const waves = require('./sim/waves');

// --- bosslös stage: spawnBoss ska markera klar, inte fastna i 'boss' ---
const bl = { zones: [{ count: 1, pool: ['grunt'] }], goalPos: { x: 0, y: 0 }, spawnPos: { x: 0, y: 0 } };
const sim = {
  customStagesList: [bl], zoneState: 'clearing', enemies: [], bossDefeated: false,
  waveActive: true, wave: 1, bossSequenceStep: 0, room: { members: new Map(), code: 'TEST' }, eventQueue: [],
};
waves.spawnBoss(sim, bl);
assert.strictEqual(sim.bossDefeated, true, 'bosslös spawnBoss ska sätta bossDefeated');
assert.notStrictEqual(sim.zoneState, 'boss', 'bosslös stage ska INTE fastna i boss-state');
assert.strictEqual(waves.isStageComplete(sim), true, 'bosslös stage med 0 fiender ska vara KLAR (ingen soft-lock)');
console.log('  bosslös endless-våg: KLARAS korrekt (ingen soft-lock)');

// --- boss-stage: oförändrat beteende (går in i boss-state, klaras ej förrän boss dör) ---
const bs = { bossKey: 'witheredelder', zones: [], goalPos: { x: 100, y: 100 }, spawnPos: { x: 0, y: 0 } };
const sim2 = {
  customStagesList: [bs], zoneState: 'clearing', enemies: [], bossDefeated: false,
  waveActive: true, wave: 1, bossSequenceStep: 0, room: { members: new Map(), code: 'T2' }, eventQueue: [], nextEnemyIdx: 0,
};
waves.spawnBoss(sim2, bs);
assert.strictEqual(sim2.zoneState, 'boss', 'boss-stage ska gå in i boss-state');
assert.strictEqual(sim2.bossDefeated, false, 'boss-stage ska INTE markeras klar förrän bossen dör');
console.log('  boss-våg: oförändrat (kräver fortfarande boss-kill)');

console.log('\nC286-ENDLESS OK');
