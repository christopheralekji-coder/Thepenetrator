// Omega-biome smoke test — verifies all 9 new stage-9 enemy types + shard child
// over many sim ticks with per-behavior assertions. Also re-runs the CI sim-tick
// test over stages 1-8 to confirm zero regressions on prior biomes.
// Run: node scripts/omega-smoke-test.js
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { ENEMY_STATS, makeEnemy, updateEnemy } = require(path.join(ROOT, 'server/sim/enemies'));
const { createSim }    = require(path.join(ROOT, 'server/sim/room-sim'));
const { loadStage }    = require(path.join(ROOT, 'server/sim/waves'));
const { tickSim }      = require(path.join(ROOT, 'server/sim/room-sim'));

// ─── helpers ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed++; }
  else       { console.error('  FAIL:', msg); failed++; }
}

/** Minimal fake sim that satisfies updateEnemy + behavior functions. */
function makeFakeSim(playerX, playerY) {
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: playerX, y: playerY, hp: 100, shield: 0, r: 14 },
  };
  const room = { code: 'SMOKETEST', hostId: 'p1', members: new Map() };
  room.members.set('p1', ws);
  return {
    room,
    enemies: [],
    bullets: [],
    gasClouds: [],
    flameTrails: [],
    pickups: [],
    nextEnemyIdx: 0,
    enemyGrid: { clear() {}, insert() {}, queryRadius(x, y, r, cb) {} },
    eventQueue: [],
    survivorsActive: false,
  };
}

/** Fake player object used as AI target. */
function fakePlayer(x, y) {
  return { x, y, hp: 100, shield: 0, r: 14, peerId: 'p1',
           _isCompanion: false, _isCoreTarget: false, invulnUntil: 0 };
}

/** Run updateEnemy N times with dt=0.033 (30Hz) and a fixed now. */
function runTicks(e, sim, player, n, nowOverride) {
  sim.enemies = [e];
  const now = nowOverride !== undefined ? nowOverride : Date.now();
  for (let i = 0; i < n; i++) {
    updateEnemy(e, 0.033, now + i * 33, sim, [player]);
  }
}

// ─── 1. ENEMY_STATS presence ──────────────────────────────────────────────────
console.log('\n[1] ENEMY_STATS entries present');
const OMEGA_TYPES = [
  'omega_chrome_husk', 'omega_volt_wisp', 'omega_core_juggernaut',
  'omega_seeker_drone', 'omega_arc_lance', 'omega_overload_cell',
  'omega_nanite_mass', 'omega_aegis_dish', 'omega_nanite_shard',
];
for (const t of OMEGA_TYPES) {
  assert(!!ENEMY_STATS[t], `ENEMY_STATS['${t}'] exists`);
}

// ─── 2. makeEnemy field copy ──────────────────────────────────────────────────
console.log('\n[2] makeEnemy copies behavior params correctly');
{
  const e = makeEnemy('omega_seeker_drone', 0, 0);
  assert(e.behavior === 'homing',      'seeker_drone behavior=homing');
  assert(e.shootRange === 340,         'seeker_drone shootRange=340');
  assert(e.bulletSpeed === 300,        'seeker_drone bulletSpeed=300');
  assert(e.homingStrength === 0.09,    'seeker_drone homingStrength=0.09');
}
{
  const e = makeEnemy('omega_arc_lance', 0, 0);
  assert(e.behavior === 'charger',     'arc_lance behavior=charger');
  assert(e.dashInterval === 2600,      'arc_lance dashInterval=2600');
  assert(e.dashSpeed === 640,          'arc_lance dashSpeed=640');
  assert(e.telegraphMs === 400,        'arc_lance telegraphMs=400');
}
{
  const e = makeEnemy('omega_overload_cell', 0, 0);
  assert(e.behavior === 'exploder',    'overload_cell behavior=exploder');
  assert(e.fuseMs === 600,             'overload_cell fuseMs=600');
  assert(e.aoeRadius === 100,          'overload_cell aoeRadius=100');
  assert(e.aoeDmg === 36,              'overload_cell aoeDmg=36');
}
{
  const e = makeEnemy('omega_nanite_mass', 0, 0);
  assert(e.behavior === 'split',       'nanite_mass behavior=split');
  assert(e.splitType === 'omega_nanite_shard', 'nanite_mass splitType=omega_nanite_shard');
  assert(e.splitCount === 2,           'nanite_mass splitCount=2');
}
{
  const e = makeEnemy('omega_aegis_dish', 0, 0);
  assert(e.behavior === 'reflect_shield', 'aegis_dish behavior=reflect_shield');
  assert(e.reflectArc === 140,         'aegis_dish reflectArc=140');
  assert(e.reflectSpeedMul === 0.8,    'aegis_dish reflectSpeedMul=0.8');
  assert(e.reflectDmg === 9,           'aegis_dish reflectDmg=9');
}

// ─── 3. Melee movement (chrome_husk, volt_wisp, juggernaut, shard) ─────────────
console.log('\n[3] Melee enemies move toward player');
for (const type of ['omega_chrome_husk', 'omega_volt_wisp', 'omega_core_juggernaut', 'omega_nanite_shard']) {
  const e = makeEnemy(type, 0, 0);
  const p = fakePlayer(200, 0);
  const sim = makeFakeSim(200, 0);
  const x0 = e.x;
  runTicks(e, sim, p, 5);
  assert(e.x > x0, `${type} moves toward player (x advanced from ${x0} to ${e.x.toFixed(1)})`);
}

// ─── 4. Homing — seeker_drone fires homing bullet on first tick ────────────────
console.log('\n[4] omega_seeker_drone fires homing bullet');
{
  const e = makeEnemy('omega_seeker_drone', 500, 500);
  const p = fakePlayer(500 + 200, 500); // within shootRange 340 — actually 200 < 340
  const sim = makeFakeSim(p.x, p.y);
  // e.lastShot=0 → now - lastShot = very large number > shootRate → fires immediately
  runTicks(e, sim, p, 1, Date.now());
  const homingBullets = sim.bullets.filter(b => b.homing && b.hostile);
  assert(homingBullets.length >= 1, `seeker_drone spawned ${homingBullets.length} homing bullet(s)`);
  if (homingBullets.length > 0) {
    assert(homingBullets[0].homingStrength === 0.09, 'homing bullet has correct homingStrength=0.09');
    assert(homingBullets[0].dmg === 10, `homing bullet dmg=10 (got ${homingBullets[0].dmg})`);
    assert(homingBullets[0].color === '#26ffe6', 'homing bullet uses omega cyan color');
  }
}

// ─── 5. Charger — arc_lance telegraphs then dashes with elevated dmg ─────────
console.log('\n[5] omega_arc_lance telegraphs and dashes');
{
  const now = Date.now();
  const e = makeEnemy('omega_arc_lance', 0, 0);
  const p = fakePlayer(300, 0);
  const sim = makeFakeSim(p.x, p.y);
  // Pre-trigger: set _nextDash to now-1 so first call to _behaviorCharger triggers telegraph
  e._nextDash = now - 1;
  const baseDmg = e.dmg;
  // Tick 1: triggers telegraph (sets _telegraphUntil, _attackFxUntil, locks direction)
  updateEnemy(e, 0.033, now, sim, [p]);
  assert(!!e._telegraphUntil, 'arc_lance entered telegraph state (_telegraphUntil set)');
  assert(!!e._attackFxUntil,  'arc_lance _attackFxUntil set during telegraph');
  // Tick at telegraph+500ms: telegraph expires, dash launches
  updateEnemy(e, 0.033, now + e.telegraphMs + 10, sim, [p]);
  assert(!!e._dashUntil, 'arc_lance launched dash (_dashUntil set)');
  // Tick mid-dash: dmg elevated to dashDmg
  updateEnemy(e, 0.033, now + e.telegraphMs + 20, sim, [p]);
  assert(e.dmg === 26, `arc_lance dashDmg=26 during dash (got ${e.dmg})`);
}

// ─── 6. Exploder — overload_cell fuses when close, blast radius 100, dmg 36 ───
console.log('\n[6] omega_overload_cell accumulates fuse and detonates with aoeDmg=36');
{
  // Place enemy at origin, player at d=40 (well within d<60 fuse threshold)
  const e = makeEnemy('omega_overload_cell', 0, 0);
  const p = fakePlayer(40, 0);
  const sim = makeFakeSim(40, 0);
  sim.enemies = [e];
  const now = Date.now();
  let detonate = false;
  // fuseMs=600ms, dt=0.033 → need ~18.2 ticks; run 25 to be safe
  for (let i = 0; i < 25; i++) {
    if (e.dead) { detonate = true; break; }
    updateEnemy(e, 0.033, now + i * 33, sim, [p]);
  }
  assert(detonate, `overload_cell detonated (e.dead=true) within 25 ticks`);
  // Player should have taken blast damage (d=40 < aoeRadius=100, with falloff)
  const expectedMin = 36 * 0.4; // worst falloff at edge
  assert(p.hp < 100, `player took AoE damage (hp=${p.hp.toFixed(1)} < 100)`);
}

// ─── 7. Split — nanite_mass spawns 2 omega_nanite_shards on death ─────────────
console.log('\n[7] omega_nanite_mass splits into 2 omega_nanite_shards on death');
{
  // Use createSim + loadStage so tickSim's death-sweep runs properly
  const room2 = { code: 'SPLITTEST', hostId: 'p1', members: new Map() };
  const ws2 = {
    readyState: 1, send: () => {},
    playerState: { x: 1000, y: 2000, hp: 100, shield: 0, r: 14 },
  };
  room2.members.set('p1', ws2);
  const sim2 = createSim(room2);
  // Manually inject the nanite_mass without going through wave spawn
  const mass = makeEnemy('omega_nanite_mass', 1000, 2000);
  mass._idx = sim2.nextEnemyIdx++;
  sim2.enemies.push(mass);
  // Kill the mass directly
  mass.dead = true;
  // Run one tickSim pass — the death-sweep handles split + removes dead
  sim2.lastTick = Date.now() - 33;
  sim2.simReadyAt = 0;
  tickSim(sim2);
  const shards = sim2.enemies.filter(e => e.type === 'omega_nanite_shard');
  assert(shards.length === 2, `split spawned ${shards.length} omega_nanite_shard(s) (expected 2)`);
  if (shards.length > 0) {
    assert(shards[0].behavior === 'melee', 'shard has behavior=melee');
    assert(shards[0]._noSplit === true,    'shard has _noSplit=true (prevents chain-split)');
    assert(shards[0].speed === 205,        `shard speed=205 (got ${shards[0].speed})`);
  }
}

// ─── 8. Reflect_shield — aegis_dish chases player (melee fall-through) ────────
console.log('\n[8] omega_aegis_dish moves toward player (reflect_shield falls through to melee)');
{
  const e = makeEnemy('omega_aegis_dish', 0, 0);
  const p = fakePlayer(300, 0);
  const sim = makeFakeSim(p.x, p.y);
  const x0 = e.x;
  runTicks(e, sim, p, 5);
  assert(e.x > x0, `aegis_dish advances toward player (x: ${x0} → ${e.x.toFixed(1)})`);
  assert(e.reflectArc === 140,      'aegis_dish reflectArc=140 preserved on live enemy');
  assert(e.reflectDmg === 9,        'aegis_dish reflectDmg=9 preserved on live enemy');
}

// ─── 9. Stage-9 pool wiring in stages-data.js ─────────────────────────────────
console.log('\n[9] Stage 9 zones reference only omega_ types');
{
  const { STAGES } = require(path.join(ROOT, 'shared/stages-data'));
  const stage9 = STAGES.find(s => s.id === 9);
  assert(!!stage9, 'Stage 9 exists');
  if (stage9) {
    const allPoolTypes = stage9.zones.flatMap(z => z.pool);
    const nonOmega = allPoolTypes.filter(t => !t.startsWith('omega_'));
    assert(nonOmega.length === 0, `All stage-9 pool types are omega_ (found non-omega: [${nonOmega.join(', ')}])`);
    assert(stage9.zones[0].pool.includes('omega_chrome_husk'),     'zone1 has omega_chrome_husk');
    assert(stage9.zones[0].pool.includes('omega_core_juggernaut'), 'zone1 has omega_core_juggernaut');
    assert(stage9.zones[0].pool.includes('omega_overload_cell'),   'zone1 has omega_overload_cell');
    assert(stage9.zones[1].pool.includes('omega_seeker_drone'),    'zone2 has omega_seeker_drone');
    assert(stage9.zones[1].pool.includes('omega_arc_lance'),       'zone2 has omega_arc_lance');
    assert(stage9.zones[1].pool.includes('omega_nanite_mass'),     'zone2 has omega_nanite_mass');
    assert(stage9.zones[1].pool.includes('omega_aegis_dish'),      'zone2 has omega_aegis_dish');
    assert(stage9.zones[1].event === 'core_pulse',                 'zone2 event=core_pulse');
  }
}

// ─── 10. Regression — sim-tick through all 9 stages ─────────────────────────
console.log('\n[10] Regression: 100 ticks per stage (1-9) without crash, enemies spawn');
for (let stageId = 1; stageId <= 9; stageId++) {
  const room = { code: `STAGE${stageId}`, hostId: 'p1', members: new Map() };
  const ws = { readyState: 1, send: () => {}, playerState: { x: 1000, y: 2640, hp: 100 } };
  room.members.set('p1', ws);
  const sim = createSim(room);
  loadStage(sim, stageId);
  sim.simReadyAt = 0;
  sim.lastTick = Date.now();
  let maxEnemies = 0;
  let crashed = false;
  for (let i = 0; i < 100; i++) {
    sim.lastTick = Date.now() - 33;
    try { tickSim(sim); }
    catch (err) { console.error(`  Stage ${stageId} crashed @ tick ${i}:`, err.message); crashed = true; break; }
    maxEnemies = Math.max(maxEnemies, sim.enemies.length);
  }
  if (!crashed) {
    assert(!crashed,       `Stage ${stageId}: 100 ticks without crash`);
    assert(maxEnemies > 0, `Stage ${stageId}: enemies spawned (max=${maxEnemies})`);
  } else {
    assert(false, `Stage ${stageId}: 100 ticks without crash`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed} assertions — ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
else console.log('ALL ASSERTIONS PASSED');
