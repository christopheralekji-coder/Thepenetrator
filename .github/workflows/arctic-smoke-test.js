// Arctic biome + reflect_shield smoke-test.
// Verifies:
//   1. All 9 new arctic enemy types survive 200 sim-ticks without exceptions
//   2. reflect_shield FRONTAL: player bullet removed + hostile reflected bullet spawned + sentinel 0 dmg
//   3. reflect_shield FLANK:   player bullet consumed normally + sentinel loses HP
//   4. slow_melee applies player slow on contact
//   5. charger/spread/homing/split/melee variants work
//   6. Stages 1-6 (prior biomes) still spin 100 ticks without regression
'use strict';

const { createSim } = require('../../server/sim/room-sim');
const { loadStage } = require('../../server/sim/waves');
const { makeEnemy, ENEMY_STATS } = require('../../server/sim/enemies');
const { updateBullets, damageEnemy } = require('../../server/sim/bullets');

// ── helpers ─────────────────────────────────────────────────────────────────
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

function makeSim(stageId) {
  const room = {
    code: 'SMKTEST',
    hostId: 'p1',
    members: new Map(),
  };
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: 1100, y: 2200, hp: 100, shield: 0, r: 14 },
  };
  room.members.set('p1', ws);
  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  loadStage(sim, stageId);
  sim.simReadyAt = 0;
  sim.lastTick = Date.now();
  return { sim, ws };
}

function runTicks(sim, n) {
  const { tickSim } = require('../../server/sim/room-sim');
  for (let i = 0; i < n; i++) {
    sim.lastTick = Date.now() - 16; // ~60Hz
    tickSim(sim);
  }
}

// ── TEST 1: prior biomes (stages 1-6) — regression check ────────────────────
console.log('--- Regression: stages 1-6 (100 ticks each) ---');
for (let s = 1; s <= 6; s++) {
  const { sim } = makeSim(s);
  let threw = false;
  try { runTicks(sim, 100); } catch (e) { threw = true; console.error('Stage', s, 'threw:', e.message); }
  assert(!threw, `Stage ${s} threw during 100 ticks`);
  console.log(`  Stage ${s} OK (enemies at end: ${sim.enemies.length})`);
}

// ── TEST 2: stage 7 arctic — 200 ticks, all 9 types must not throw ───────────
console.log('--- Stage 7 arctic: 200 ticks ---');
{
  const { sim, ws } = makeSim(7);
  // Pre-seed one of each arctic type directly so they exist and run AI
  const types = [
    'arctic_rimeguard', 'arctic_behemoth', 'arctic_shardcaster',
    'arctic_frostseer', 'arctic_permacrawler', 'arctic_brittlerevenant',
    'arctic_avalanche', 'arctic_mirrorsentinel', 'arctic_shardling',
  ];
  for (const t of types) {
    assert(ENEMY_STATS[t], `ENEMY_STATS missing type: ${t}`);
    const e = makeEnemy(t, 1100 + Math.random() * 200 - 100, 1800 + Math.random() * 200 - 100);
    e._idx = sim.nextEnemyIdx++;
    sim.enemies.push(e);
  }

  let threw = false;
  try { runTicks(sim, 200); } catch (err) { threw = true; console.error('Stage 7 threw:', err.message, err.stack); }
  assert(!threw, 'Stage 7 threw during 200 ticks');
  console.log(`  Stage 7 OK, enemies at end: ${sim.enemies.filter(e => !e.dead).length} alive`);
}

// ── TEST 3: reflect_shield — FRONTAL shot deflected, sentinel takes 0 dmg ────
console.log('--- reflect_shield: FRONTAL deflect ---');
{
  const room = {
    code: 'RFTEST',
    hostId: 'p1',
    members: new Map(),
  };
  // Geometry: sentinel at (1000,1000), player NORTH at (1000,800).
  // sentinel 'front' = normalize((1000,800)-(1000,1000)) = (0,-1)  [north]
  // Bullet starts at (1000,978) — 22px north (within rsum = e.r15 + b.r4 + 8lag = 27)
  //   hitFrom = normalize((1000,978)-(1000,1000)) = normalize(0,-22) = (0,-1)
  //   dot(front=(0,-1), hitFrom=(0,-1)) = 1.0 > cos(60°)=0.5 → FRONTAL → reflect
  const playerState = { x: 1000, y: 800, hp: 100, shield: 0, r: 14 };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null; // use linear scan so we don't need to rebuild the grid

  const sentinel = makeEnemy('arctic_mirrorsentinel', 1000, 1000);
  sentinel._idx = sim.nextEnemyIdx++;
  sim.enemies.push(sentinel);

  const initialHp = sentinel.hp; // 55

  // Player bullet 22px north of sentinel, heading south (+vy)
  sim.bullets.push({
    x: 1000, y: 978,
    vx: 0, vy: 400,
    dmg: 20, r: 4, life: 2,
    hostile: false,
    ownerPid: 'p1',
  });

  const dt = 1 / 60;
  const now = Date.now();
  updateBullets(sim, dt, now);

  // Player bullet should have been consumed (removed from bullets[])
  const playerBullets = sim.bullets.filter(b => !b.hostile);
  assert(playerBullets.length === 0,
    `Frontal: player bullet not removed (${playerBullets.length} remain, bullets: ${JSON.stringify(sim.bullets)})`);

  // A hostile (reflected) bullet should have been spawned
  const hostileBullets = sim.bullets.filter(b => b.hostile);
  assert(hostileBullets.length >= 1,
    `Frontal: no reflected hostile bullet spawned (hostile count=${hostileBullets.length})`);

  // Sentinel must have taken 0 damage
  assert(sentinel.hp === initialHp,
    `Frontal: sentinel took damage (hp=${sentinel.hp} vs initial=${initialHp})`);

  // Reflected bullet must travel NORTH (vy < 0) at ~80% of original speed
  const rb = hostileBullets[0];
  assert(rb.vy < 0,
    `Reflected bullet going wrong direction (vy=${rb.vy}, expected <0 = northward)`);
  const origSpd = 400;
  const reflSpd = Math.hypot(rb.vx, rb.vy);
  assert(Math.abs(reflSpd - origSpd * 0.8) < 5,
    `Reflected speed wrong (got ${reflSpd.toFixed(1)}, expected ~${(origSpd * 0.8).toFixed(1)})`);
  assert(rb.dmg === 9,
    `Reflected dmg wrong (got ${rb.dmg}, expected 9)`);
  assert(rb.color === '#bfe8ff',
    `Reflected color wrong (got ${rb.color})`);
  assert(rb.hostile === true,
    `Reflected bullet not marked hostile`);

  console.log(`  FRONTAL OK: player bullet removed, hostile bullet spawned (spd=${reflSpd.toFixed(1)}, dmg=${rb.dmg}, vy=${rb.vy.toFixed(1)}), sentinel hp=${sentinel.hp}/${initialHp} (0 dmg taken)`);
}

// ── TEST 4: reflect_shield — FLANK shot damages sentinel normally ─────────────
console.log('--- reflect_shield: FLANK damages sentinel ---');
{
  const room = {
    code: 'FLTEST',
    hostId: 'p1',
    members: new Map(),
  };
  // Geometry: sentinel at (1000,1000), player NORTH at (1000,800).
  // sentinel 'front' = (0,-1)  [north]
  // Bullet starts at (1022,1000) — 22px EAST (within rsum=27)
  //   hitFrom = normalize((1022,1000)-(1000,1000)) = (1,0)
  //   dot(front=(0,-1), hitFrom=(1,0)) = 0.0 < cos(60°)=0.5 → NOT frontal → damage
  const playerState = { x: 1000, y: 800, hp: 100, shield: 0, r: 14 };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null; // linear scan

  const sentinel = makeEnemy('arctic_mirrorsentinel', 1000, 1000);
  sentinel._idx = sim.nextEnemyIdx++;
  sim.enemies.push(sentinel);

  const initialHp = sentinel.hp;

  // Bullet from 22px east, heading west (into the sentinel's flank)
  sim.bullets.push({
    x: 1022, y: 1000,
    vx: -400, vy: 0,
    dmg: 20, r: 4, life: 2,
    hostile: false,
    ownerPid: 'p1',
  });

  const dt = 1 / 60;
  const now = Date.now();
  updateBullets(sim, dt, now);

  // No reflected hostile bullet should have been spawned
  const hostileBullets = sim.bullets.filter(b => b.hostile);
  assert(hostileBullets.length === 0,
    `Flank: unexpected reflected hostile bullet spawned (${hostileBullets.length})`);

  // Player bullet must have been consumed (hit the sentinel)
  const playerBullets = sim.bullets.filter(b => !b.hostile);
  assert(playerBullets.length === 0,
    `Flank: player bullet not consumed (${playerBullets.length} remain)`);

  // Sentinel must have taken 20 damage
  assert(sentinel.hp < initialHp,
    `Flank: sentinel took no damage (hp=${sentinel.hp} unchanged from ${initialHp})`);
  assert(sentinel.hp === initialHp - 20,
    `Flank: wrong damage (hp=${sentinel.hp}, expected ${initialHp - 20})`);

  console.log(`  FLANK OK: no reflection, sentinel hp=${sentinel.hp}/${initialHp} (took ${initialHp - sentinel.hp} dmg)`);
}

// ── TEST 5: slow_melee (arctic_permacrawler) applies player slow on contact ──
console.log('--- slow_melee: arctic_permacrawler slows player ---');
{
  const { updateEnemy } = require('../../server/sim/enemies');
  const { sim, ws } = makeSim(7);
  const crawl = makeEnemy('arctic_permacrawler', 1100, 2200);
  crawl._idx = sim.nextEnemyIdx++;
  sim.enemies.push(crawl);

  // Put crawl exactly on top of player so contact distance = 0 (within rsum)
  crawl.x = ws.playerState.x;
  crawl.y = ws.playerState.y;
  crawl.contactCd = 0;
  ws.playerState.invulnUntil = 0;
  ws.playerState.r = 14;

  // Build players array matching what findNearestPlayer expects
  const players = [ws.playerState];
  ws.playerState.peerId = 'p1';

  updateEnemy(crawl, 1 / 60, Date.now(), sim, players);

  assert(ws.playerState._slowUntil && ws.playerState._slowUntil > Date.now(),
    `slow_melee: player not slowed (slowUntil=${ws.playerState._slowUntil})`);
  assert(ws.playerState.speedMul === 0.55,
    `slow_melee: wrong speedMul (got ${ws.playerState.speedMul}, expected 0.55)`);
  console.log(`  slow_melee OK: player speedMul=${ws.playerState.speedMul}, slowUntil in ${(ws.playerState._slowUntil - Date.now()).toFixed(0)}ms`);
}

// ── TEST 6: charger (arctic_avalanche) — verify per-enemy state fields copy ─
console.log('--- charger: arctic_avalanche fields ---');
{
  const av = makeEnemy('arctic_avalanche', 1000, 1000);
  assert(av.behavior === 'charger', `avalanche behavior wrong (got ${av.behavior})`);
  assert(av.dashInterval === 2600, `avalanche dashInterval wrong (got ${av.dashInterval})`);
  assert(av.dashSpeed === 430, `avalanche dashSpeed wrong (got ${av.dashSpeed})`);
  assert(av.dashDmg === 26, `avalanche dashDmg wrong (got ${av.dashDmg})`);
  assert(av.telegraphMs === 400, `avalanche telegraphMs wrong (got ${av.telegraphMs})`);
  console.log(`  charger fields OK: dashInterval=${av.dashInterval}, dashSpeed=${av.dashSpeed}, dashDmg=${av.dashDmg}`);
}

// ── TEST 7: spread (arctic_shardcaster) — 5 pellets ──────────────────────────
console.log('--- spread: arctic_shardcaster 5-pellet ---');
{
  const sc = makeEnemy('arctic_shardcaster', 1000, 1000);
  assert(sc.behavior === 'spread', `shardcaster behavior wrong`);
  assert(sc.pellets === 5, `shardcaster pellets wrong (got ${sc.pellets})`);
  assert(sc.spreadDeg === 44, `shardcaster spreadDeg wrong (got ${sc.spreadDeg})`);
  assert(sc.bulletColor === '#bfe8ff', `shardcaster bulletColor wrong`);
  console.log(`  spread fields OK: pellets=${sc.pellets}, spreadDeg=${sc.spreadDeg}`);
}

// ── TEST 8: homing (arctic_frostseer) ────────────────────────────────────────
console.log('--- homing: arctic_frostseer ---');
{
  const fs = makeEnemy('arctic_frostseer', 1000, 1000);
  assert(fs.behavior === 'homing', `frostseer behavior wrong`);
  assert(fs.shootRange === 400, `frostseer shootRange wrong (got ${fs.shootRange})`);
  assert(fs.homingStrength === 0.09, `frostseer homingStrength wrong (got ${fs.homingStrength})`);
  console.log(`  homing fields OK: shootRange=${fs.shootRange}, homingStrength=${fs.homingStrength}`);
}

// ── TEST 9: split (arctic_brittlerevenant) spawns arctic_shardlings ──────────
console.log('--- split: arctic_brittlerevenant → arctic_shardling ---');
{
  const rev = makeEnemy('arctic_brittlerevenant', 1000, 1000);
  assert(rev.behavior === 'split', `brittlerevenant behavior wrong`);
  assert(rev.splitType === 'arctic_shardling', `brittlerevenant splitType wrong (got ${rev.splitType})`);
  assert(rev.splitCount === 2, `brittlerevenant splitCount wrong (got ${rev.splitCount})`);
  assert(ENEMY_STATS['arctic_shardling'], 'arctic_shardling missing from ENEMY_STATS');
  const sl = makeEnemy('arctic_shardling', 0, 0);
  assert(sl.speed === 165, `arctic_shardling speed wrong (got ${sl.speed})`);
  console.log(`  split fields OK: splitType=${rev.splitType}, splitCount=${rev.splitCount}`);
}

// ── TEST 10: mirrorsentinel reflectArc/reflectDmg fields propagate ────────────
console.log('--- reflect_shield: mirrorsentinel field propagation ---');
{
  const ms = makeEnemy('arctic_mirrorsentinel', 0, 0);
  assert(ms.behavior === 'reflect_shield', `mirrorsentinel behavior wrong (got ${ms.behavior})`);
  assert(ms.reflectArc === 120, `mirrorsentinel reflectArc wrong (got ${ms.reflectArc})`);
  assert(ms.reflectSpeedMul === 0.8, `mirrorsentinel reflectSpeedMul wrong (got ${ms.reflectSpeedMul})`);
  assert(ms.reflectDmg === 9, `mirrorsentinel reflectDmg wrong (got ${ms.reflectDmg})`);
  // All other enemies must have reflectArc===0 (no reflect)
  const grunt = makeEnemy('grunt', 0, 0);
  assert(grunt.reflectArc === 0, `grunt has reflectArc>0 (would break non-arctic bullets)`);
  const fmoss = makeEnemy('forest_mosshusk', 0, 0);
  assert(fmoss.reflectArc === 0, `forest_mosshusk has reflectArc>0`);
  console.log(`  field propagation OK: reflectArc=${ms.reflectArc}, reflectSpeedMul=${ms.reflectSpeedMul}, reflectDmg=${ms.reflectDmg}`);
  console.log(`  non-sentinel guard OK: grunt.reflectArc=0, forest_mosshusk.reflectArc=0`);
}

// ── TEST 11: behemoth melee (tank) ────────────────────────────────────────────
console.log('--- melee: arctic_behemoth (tank) ---');
{
  const beh = makeEnemy('arctic_behemoth', 0, 0);
  assert(beh.behavior === 'melee', `behemoth behavior wrong`);
  assert(beh.hp === 100, `behemoth hp wrong (got ${beh.hp})`);
  assert(beh.r === 19, `behemoth r wrong (got ${beh.r})`);
  assert(beh.speed === 62, `behemoth speed wrong (got ${beh.speed})`);
  console.log(`  behemoth OK: hp=${beh.hp}, r=${beh.r}, speed=${beh.speed}`);
}

// ── ALL PASSED ─────────────────────────────────────────────────────────────────
console.log('\nALL ARCTIC SMOKE TESTS PASSED');
