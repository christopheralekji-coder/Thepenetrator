// Verifierar final_combo-fixen: alla 10 kampanj-bossar ska ROTERA genom sina 3
// powers (inte falla igenom default->aiBruteCharger). Kör updateBoss över simulerad
// tid och kollar att powerIdx/phase cyklar + att bossen faktiskt attackerar utan crash.
'use strict';
const assert = require('assert');
const { makeBoss, updateBoss } = require('./sim/bosses');
const { BOSS_CONFIGS } = require('../shared/boss-configs');

function fakeSim() {
  return {
    bullets: [], enemies: [], eventQueue: [],
    gasClouds: [], flameTrails: [],
    nextEnemyIdx: 1,
    stresstestActive: false, survivorsActive: false,
  };
}
// Osårbar spelare långt bort så bossen rör sig/skjuter men matchen inte "slutar".
function fakePlayers() { return [{ x: 900, y: 600, hp: 999999, r: 14, invulnUntil: 0 }]; }

let failures = 0;
const keys = Object.keys(BOSS_CONFIGS);
assert.strictEqual(keys.length, 10, 'förväntade 10 kampanj-bossar');

for (const key of keys) {
  const cfg = BOSS_CONFIGS[key];
  const sim = fakeSim();
  const players = fakePlayers();
  const b = makeBoss(key, 400, 300, 1);
  b._idx = 0;

  // makeBoss ska ha kopierat powerSet + rotations-state
  assert.ok(b, `${key}: makeBoss returnerade null`);
  assert.strictEqual(b.ai, 'final_combo', `${key}: ai ska vara final_combo`);
  assert.ok(Array.isArray(b.powerSet) && b.powerSet.length === 3, `${key}: powerSet[3] saknas (fick ${JSON.stringify(b.powerSet)})`);
  assert.strictEqual(b.powerIdx, 0, `${key}: powerIdx ska starta på 0`);
  assert.strictEqual(b.powerSwapAt, 0, `${key}: powerSwapAt ska starta på 0 (lazy-init)`);

  const seenIdx = new Set();
  const seenPhase = new Set();
  const dt = 1 / 60;
  let now = 10000;            // monoton ms-klocka (som sim skickar in)
  const idxTimeline = [];
  try {
    // ~18s → minst 3 swap-intervall (5s vardera) = alla 3 powers hinner visas
    for (let f = 0; f < 60 * 18; f++) {
      updateBoss(sim, b, dt, now, players);
      seenIdx.add(b.powerIdx);
      seenPhase.add(b.phase);
      if (idxTimeline[idxTimeline.length - 1] !== b.powerIdx) idxTimeline.push(b.powerIdx);
      now += 1000 * dt;
    }
  } catch (e) {
    console.log(`❌ ${key}: kraschade i updateBoss — ${e.stack}`);
    failures++; continue;
  }

  const rotated = seenIdx.size >= 3;         // besökte alla 3 powers
  const held0 = idxTimeline[0] === 0;        // idx 0 hölls först (visades ej över-hoppat)
  const attacked = sim.bullets.length > 0;   // bossen sköt faktiskt
  const phaseCycled = seenPhase.size >= 2;   // fas-fältet ändrades (klient-cue)

  const ok = rotated && held0 && attacked && phaseCycled;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${key.padEnd(16)} powers=[${b.powerSet.join(',')}] rotated=${rotated}(${seenIdx.size}) held0=${held0} bullets=${sim.bullets.length} phases=${[...seenPhase].sort().join('/')} timeline=${idxTimeline.join('→')}`);
}

// Regression: ai:'final' (den 3-fas-bossen) ska fortfarande fungera efter switch-edit
try {
  const sim = fakeSim(); const b = makeBoss('witheredelder', 400, 300, 1);
  b.ai = 'final'; b.phase = 1;
  let now = 10000;
  for (let f = 0; f < 60 * 3; f++) { updateBoss(sim, b, 1/60, now, fakePlayers()); now += 1000/60; }
  console.log('✅ regression: ai:final körs utan crash');
} catch (e) { console.log('❌ regression ai:final kraschade — ' + e.message); failures++; }

console.log(failures === 0 ? '\n🎉 ALLA final_combo-bossar roterar korrekt.' : `\n💥 ${failures} boss(ar) misslyckades.`);
process.exit(failures === 0 ? 0 : 1);
