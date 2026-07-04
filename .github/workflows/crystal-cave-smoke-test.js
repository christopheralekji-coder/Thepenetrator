// Crystal cave biome (stage 8) smoke-test.
// Verifies:
//   1. All 9 new crystal cave types survive 200 sim-ticks without exceptions
//   2. 'sniper' behavior: telegraphs (e.aiming) then fires a high-dmg bullet (dmg=38, r=5) from long range
//   3. 'cloaker' behavior: blinks to within blinkRange of player every blinkInterval ms
//   4. 'buff_aura' behavior: hastens a nearby ally (ally.speed > _origSpeed)
//   5. 'buff_aura' + slow composition: buffed+slowed ally is still slowed (speed = _origSpeed * slowMul * buffMul)
//   6. 'reflect_shield' (reused, facet_guardian): frontal player bullet is deflected; guardian takes 0 dmg
//   7. 'split' (shard_skitter): splitType / splitCount fields propagate correctly
//   8. Stages 1-7 (prior biomes) still spin 100 ticks each without regression
'use strict';

const { createSim } = require('../../server/sim/room-sim');
const { loadStage }  = require('../../server/sim/waves');
const { makeEnemy, updateEnemy, ENEMY_STATS } = require('../../server/sim/enemies');
const { updateBullets } = require('../../server/sim/bullets');

// ── helpers ─────────────────────────────────────────────────────────────────
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

function makeSim(stageId) {
  const room = {
    code: 'CCTEST',
    hostId: 'p1',
    members: new Map(),
  };
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: 900, y: 2200, hp: 100, shield: 0, r: 14, peerId: 'p1' },
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

// ── TEST 1: regression — stages 1-7 (100 ticks each) ───────────────────────
console.log('--- Regression: stages 1-7 (100 ticks each) ---');
for (let s = 1; s <= 7; s++) {
  const { sim } = makeSim(s);
  let threw = false;
  try { runTicks(sim, 100); } catch (err) { threw = true; console.error(`Stage ${s} threw:`, err.message); }
  assert(!threw, `Stage ${s} threw during 100 ticks`);
  console.log(`  Stage ${s} OK (enemies: ${sim.enemies.length})`);
}

// ── TEST 2: stage 8 — 200 ticks, all 9 types must not throw ─────────────────
console.log('--- Stage 8 crystal cave: 200 ticks ---');
{
  const { sim, ws } = makeSim(8);
  const types = [
    'crystal_cave_crawler', 'crystal_cave_shard_skitter', 'crystal_cave_prism_stalker',
    'crystal_cave_lumen_wisp', 'crystal_cave_prism_lance', 'crystal_cave_refraction_lurker',
    'crystal_cave_facet_guardian', 'crystal_cave_resonant_cantor', 'crystal_cave_shard_mote',
  ];
  for (const t of types) {
    assert(ENEMY_STATS[t], `ENEMY_STATS missing type: ${t}`);
    const e = makeEnemy(t, 900 + Math.random() * 200 - 100, 1800 + Math.random() * 200 - 100);
    e._idx = sim.nextEnemyIdx++;
    sim.enemies.push(e);
  }
  let threw = false;
  try { runTicks(sim, 200); } catch (err) { threw = true; console.error('Stage 8 threw:', err.message, err.stack); }
  assert(!threw, 'Stage 8 threw during 200 ticks');
  console.log(`  Stage 8 OK, ${sim.enemies.filter(e => !e.dead).length} enemies alive after 200 ticks`);
}

// ── TEST 3: ENEMY_STATS field-propagation for all 9 types ───────────────────
console.log('--- Field propagation: all 9 crystal cave types ---');
{
  const lance = makeEnemy('crystal_cave_prism_lance', 0, 0);
  assert(lance.behavior === 'sniper',   `lance behavior wrong (got ${lance.behavior})`);
  assert(lance.shootRange  === 680,     `lance shootRange wrong (got ${lance.shootRange})`);
  assert(lance.shootRate   === 2400,    `lance shootRate wrong (got ${lance.shootRate})`);
  assert(lance.telegraphMs === 800,     `lance telegraphMs wrong (got ${lance.telegraphMs})`);
  assert(lance.bulletSpeed === 950,     `lance bulletSpeed wrong (got ${lance.bulletSpeed})`);
  assert(lance.bulletDmg   === 38,      `lance bulletDmg wrong (got ${lance.bulletDmg})`);
  assert(lance.bulletColor === '#eaffff', `lance bulletColor wrong (got ${lance.bulletColor})`);

  const lurker = makeEnemy('crystal_cave_refraction_lurker', 0, 0);
  assert(lurker.behavior      === 'cloaker', `lurker behavior wrong (got ${lurker.behavior})`);
  assert(lurker.blinkInterval === 3500,       `lurker blinkInterval wrong (got ${lurker.blinkInterval})`);
  assert(lurker.blinkRange    === 60,         `lurker blinkRange wrong (got ${lurker.blinkRange})`);
  assert(lurker.dmg           === 16,         `lurker dmg wrong (got ${lurker.dmg})`);

  const cantor = makeEnemy('crystal_cave_resonant_cantor', 0, 0);
  assert(cantor.behavior    === 'buff_aura', `cantor behavior wrong (got ${cantor.behavior})`);
  assert(cantor.auraRange   === 220,          `cantor auraRange wrong (got ${cantor.auraRange})`);
  assert(cantor.speedBuffPct === 30,          `cantor speedBuffPct wrong (got ${cantor.speedBuffPct})`);
  assert(cantor.buffInterval === 1500,        `cantor buffInterval wrong (got ${cantor.buffInterval})`);
  assert(cantor.dmg          === 0,           `cantor dmg must be 0 (got ${cantor.dmg})`);

  const guardian = makeEnemy('crystal_cave_facet_guardian', 0, 0);
  assert(guardian.behavior       === 'reflect_shield', `guardian behavior wrong (got ${guardian.behavior})`);
  assert(guardian.reflectArc     === 140,               `guardian reflectArc wrong (got ${guardian.reflectArc})`);
  assert(guardian.reflectSpeedMul === 0.8,              `guardian reflectSpeedMul wrong (got ${guardian.reflectSpeedMul})`);
  assert(guardian.reflectDmg     === 9,                 `guardian reflectDmg wrong (got ${guardian.reflectDmg})`);

  const skitter = makeEnemy('crystal_cave_shard_skitter', 0, 0);
  assert(skitter.behavior  === 'split',                       `skitter behavior wrong`);
  assert(skitter.splitType === 'crystal_cave_shard_mote',     `skitter splitType wrong (got ${skitter.splitType})`);
  assert(skitter.splitCount === 2,                            `skitter splitCount wrong (got ${skitter.splitCount})`);
  assert(ENEMY_STATS['crystal_cave_shard_mote'],              'crystal_cave_shard_mote missing from ENEMY_STATS');
  const mote = makeEnemy('crystal_cave_shard_mote', 0, 0);
  assert(mote.behavior === 'melee', `mote behavior wrong`);
  assert(mote.speed === 200,        `mote speed wrong (got ${mote.speed})`);
  assert(mote.hp    === 6,          `mote hp wrong (got ${mote.hp})`);

  const wisp = makeEnemy('crystal_cave_lumen_wisp', 0, 0);
  assert(wisp.behavior === 'homing',   `wisp behavior wrong`);
  assert(wisp.shootRange === 320,       `wisp shootRange wrong (got ${wisp.shootRange})`);
  assert(wisp.homingStrength === 0.09,  `wisp homingStrength wrong`);
  assert(wisp.bulletColor === '#66f0ff', `wisp bulletColor wrong (got ${wisp.bulletColor})`);

  const crawler = makeEnemy('crystal_cave_crawler', 0, 0);
  assert(crawler.behavior === 'melee', `crawler behavior wrong`);
  assert(crawler.r === 12,             `crawler r wrong (got ${crawler.r})`);
  assert(crawler.hp === 22,            `crawler hp wrong (got ${crawler.hp})`);

  const stalker = makeEnemy('crystal_cave_prism_stalker', 0, 0);
  assert(stalker.behavior === 'melee', `stalker behavior wrong`);
  assert(stalker.speed === 215,        `stalker speed wrong (got ${stalker.speed})`);

  // Verify new params default to 0/safe for all non-crystal enemies (no behavior corruption)
  const grunt = makeEnemy('grunt', 0, 0);
  assert(grunt.blinkInterval === 3500, `grunt blinkInterval default wrong (got ${grunt.blinkInterval})`);
  assert(grunt.blinkRange    === 60,   `grunt blinkRange default wrong`);
  assert(grunt.auraRange     === 0,    `grunt auraRange must be 0 (got ${grunt.auraRange})`);
  assert(grunt.speedBuffPct  === 0,    `grunt speedBuffPct must be 0 (got ${grunt.speedBuffPct})`);
  // reflectArc stays 0 on crystal enemies that don't have it
  assert(crawler.reflectArc === 0,    `crawler reflectArc must be 0 (got ${crawler.reflectArc})`);

  console.log('  All field-propagation checks OK');
}

// ── TEST 4: 'sniper' behavior — telegraph then fire high-dmg bullet ──────────
console.log("--- 'sniper' behavior: telegraph + fire ---");
{
  const room = { code: 'SNTEST', hostId: 'p1', members: new Map() };
  const playerState = { x: 1000, y: 1350, hp: 100, shield: 0, r: 14, peerId: 'p1' };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null;

  // Sniper at (1000, 2000), player at (1000, 1350) → d = 650, within shootRange 680
  const lance = makeEnemy('crystal_cave_prism_lance', 1000, 2000);
  lance._idx = sim.nextEnemyIdx++;
  sim.enemies.push(lance);

  const players = [playerState];
  const now1 = Date.now();

  // Tick 1: cooldown ready (lastShot=0) → should start aiming
  lance.lastShot = 0;
  updateEnemy(lance, 1 / 60, now1, sim, players);
  assert(lance.aiming === true, `sniper: aiming not set after tick 1 (aiming=${lance.aiming})`);
  assert(lance.aimAt === now1,  `sniper: aimAt not set correctly (aimAt=${lance.aimAt}, now=${now1})`);
  console.log(`  Tick 1 OK: aiming=true, aimAt=${lance.aimAt}`);

  // Tick 2: advance time past telegraphMs (800ms) → should fire bullet
  const now2 = now1 + 900;   // 900ms > telegraphMs 800ms
  updateEnemy(lance, 1 / 60, now2, sim, players);
  assert(lance.aiming === false, `sniper: still aiming after telegraph expired`);
  const hostileBullets = sim.bullets.filter(b => b.hostile);
  assert(hostileBullets.length >= 1, `sniper: no bullet fired (hostile count=${hostileBullets.length})`);
  const sb = hostileBullets[0];
  assert(sb.dmg === 38,          `sniper: bullet dmg wrong (got ${sb.dmg}, expected 38)`);
  assert(sb.r   === 5,           `sniper: bullet r wrong (got ${sb.r}, expected 5)`);
  assert(sb.life === 1.5,        `sniper: bullet life wrong (got ${sb.life}, expected 1.5)`);
  assert(sb.color === '#eaffff', `sniper: bullet color wrong (got ${sb.color})`);
  assert(sb.hostile === true,    `sniper: bullet not hostile`);
  const spd = Math.hypot(sb.vx, sb.vy);
  assert(Math.abs(spd - 950) < 5, `sniper: bullet speed wrong (got ${spd.toFixed(1)}, expected ~950)`);
  console.log(`  Tick 2 OK: bullet fired dmg=${sb.dmg} r=${sb.r} speed=${spd.toFixed(1)}`);

  // Retreat check: player within retreatDist (680*0.4=272 px)
  const lanceClose = makeEnemy('crystal_cave_prism_lance', 1000, 1200); // 150px from player
  lanceClose._idx = sim.nextEnemyIdx++;
  sim.enemies.push(lanceClose);
  lanceClose.lastShot = now2 - 1; // cooldown not ready
  const prevY = lanceClose.y;
  updateEnemy(lanceClose, 1 / 60, now2 + 1, sim, players);
  // Player at (1000,1350), lance at (1000,1200): dy towards player = +150. Retreat = move away = y decreases.
  assert(lanceClose.y < prevY, `sniper retreat: y should decrease when player is too close (prevY=${prevY}, newY=${lanceClose.y.toFixed(2)})`);
  console.log(`  Retreat OK: moved from y=${prevY} to y=${lanceClose.y.toFixed(2)} (away from player)`);
}

// ── TEST 5: 'cloaker' behavior — blink to near-player ───────────────────────
console.log("--- 'cloaker' behavior: blink teleport ---");
{
  const room = { code: 'CLTEST', hostId: 'p1', members: new Map() };
  const playerState = { x: 1000, y: 1000, hp: 100, shield: 0, r: 14, peerId: 'p1' };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null;

  // Cloaker at (1000, 1500) — 500px from player
  const lurker = makeEnemy('crystal_cave_refraction_lurker', 1000, 1500);
  lurker._idx = sim.nextEnemyIdx++;
  sim.enemies.push(lurker);

  const players = [playerState];
  const now = Date.now();

  // Pre-set _nextBlink to fire immediately
  lurker._nextBlink = now - 1;

  updateEnemy(lurker, 1 / 60, now, sim, players);

  // After blink: should be within blinkRange (60px) of player
  const dx = lurker.x - playerState.x, dy = lurker.y - playerState.y;
  const dist = Math.hypot(dx, dy);
  assert(Math.abs(dist - 60) < 2, `cloaker: post-blink distance wrong (got ${dist.toFixed(2)}, expected ~60)`);
  // _attackFxUntil should be set (strike windup)
  assert(lurker._attackFxUntil && lurker._attackFxUntil > now, `cloaker: _attackFxUntil not set after blink`);
  // _nextBlink re-scheduled
  assert(lurker._nextBlink > now, `cloaker: _nextBlink not re-scheduled (got ${lurker._nextBlink})`);
  console.log(`  Blink OK: post-blink dist=${dist.toFixed(2)}px from player (expected 60), _attackFxUntil set`);

  // Second call without blink trigger: should do normal chase (no second blink)
  const preX = lurker.x, preY = lurker.y;
  lurker.contactCd = 0.6; // suppress contact damage
  updateEnemy(lurker, 1 / 60, now + 1, sim, players);
  // Should have moved toward player (not teleported back to 60px exactly)
  const dist2 = Math.hypot(lurker.x - playerState.x, lurker.y - playerState.y);
  assert(dist2 < 60 || Math.abs(dist2 - 60) < 15, `cloaker: normal chase after blink seems broken (dist=${dist2.toFixed(2)})`);
  console.log(`  Normal chase OK: dist after chase tick=${dist2.toFixed(2)}px`);
}

// ── TEST 6: 'buff_aura' — ally speed increases + slow composition ────────────
console.log("--- 'buff_aura' behavior: hasten ally + slow composition ---");
{
  const room = { code: 'BATEST', hostId: 'p1', members: new Map() };
  const playerState = { x: 1000, y: 1500, hp: 100, shield: 0, r: 14, peerId: 'p1' };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null;

  // Cantor at (1000, 1000), crawler ally at (1100, 1000) — 100px apart, within auraRange 220
  const cantor  = makeEnemy('crystal_cave_resonant_cantor', 1000, 1000);
  const crawler = makeEnemy('crystal_cave_crawler', 1100, 1000);
  cantor._idx  = sim.nextEnemyIdx++;
  crawler._idx = sim.nextEnemyIdx++;
  sim.enemies.push(cantor);
  sim.enemies.push(crawler);

  const players = [playerState];
  const now = Date.now();

  // Pre-set _nextBuff to fire immediately
  cantor._nextBuff = now - 1;

  const origSpeed = crawler._origSpeed;  // 95
  assert(origSpeed === 95, `crawler _origSpeed wrong (got ${origSpeed})`);

  // Step A: run cantor AI — should buff the crawler
  updateEnemy(cantor, 1 / 60, now, sim, players);

  assert(crawler._speedBuff !== undefined && crawler._speedBuff > 1,
    `buff_aura: crawler._speedBuff not set (got ${crawler._speedBuff})`);
  assert(crawler._speedBuffUntil !== undefined && crawler._speedBuffUntil > now,
    `buff_aura: crawler._speedBuffUntil not set (got ${crawler._speedBuffUntil})`);

  const expectedBuffMul = 1 + 30 / 100; // speedBuffPct=30 → 1.3
  assert(Math.abs(crawler._speedBuff - expectedBuffMul) < 0.001,
    `buff_aura: _speedBuff wrong (got ${crawler._speedBuff}, expected ${expectedBuffMul})`);

  // Step B: run crawler AI — updateStatus applies the buff
  crawler.contactCd = 0.6; // suppress contact damage during test
  updateEnemy(crawler, 1 / 60, now, sim, players);

  const expectedBuffedSpeed = origSpeed * expectedBuffMul; // 95 * 1.3 = 123.5
  assert(Math.abs(crawler.speed - expectedBuffedSpeed) < 0.5,
    `buff_aura: buff-only speed wrong (got ${crawler.speed.toFixed(2)}, expected ${expectedBuffedSpeed.toFixed(2)})`);
  console.log(`  Buff-only OK: crawler.speed=${crawler.speed.toFixed(2)} (expected ${expectedBuffedSpeed.toFixed(2)} = ${origSpeed}×${expectedBuffMul})`);

  // Step C: apply slow to crawler — speed must be LESS than unbuffed (_origSpeed)
  // because slow composes multiplicatively: speed = _origSpeed * slowMul * buffMul
  crawler.slowUntil  = now + 5000;
  crawler.slowFactor = 0.6;     // matches _behaviorSlowMelee: slowMul=0.55..0.6

  crawler.contactCd = 0.6;
  updateEnemy(crawler, 1 / 60, now, sim, players);

  // Expected: 95 * 0.6 * 1.3 = 74.1
  const expectedSlowBuffSpeed = origSpeed * 0.6 * expectedBuffMul;
  assert(Math.abs(crawler.speed - expectedSlowBuffSpeed) < 0.5,
    `buff_aura+slow: speed wrong (got ${crawler.speed.toFixed(2)}, expected ${expectedSlowBuffSpeed.toFixed(2)} = ${origSpeed}×0.6×${expectedBuffMul})`);
  // Must be LESS than base _origSpeed (slow is dominant when combined with any buff)
  assert(crawler.speed < origSpeed,
    `buff_aura+slow: speed ${crawler.speed.toFixed(2)} should be < base ${origSpeed} (slow must still dominate)`);
  console.log(`  Slow+buff composition OK: crawler.speed=${crawler.speed.toFixed(2)} (expected ${expectedSlowBuffSpeed.toFixed(2)} = ${origSpeed}×0.6×${expectedBuffMul}); slow DOMINATES (speed < base ${origSpeed})`);

  // Step D: buff expires — speed should return to _origSpeed (only slow still active)
  crawler._speedBuffUntil = now - 1;  // force expiry
  crawler.contactCd = 0.6;
  updateEnemy(crawler, 1 / 60, now, sim, players);
  // slow still active → speed = _origSpeed * 0.6
  const expectedPostBuffExpiry = origSpeed * 0.6;
  assert(Math.abs(crawler.speed - expectedPostBuffExpiry) < 0.5,
    `buff expiry: speed wrong (got ${crawler.speed.toFixed(2)}, expected ${expectedPostBuffExpiry.toFixed(2)} = ${origSpeed}×0.6)`);
  console.log(`  Buff expiry OK: speed=${crawler.speed.toFixed(2)} (slow-only: ${expectedPostBuffExpiry.toFixed(2)})`);

  // Step E: cantor should NOT buff itself
  const cantorSpeedBefore = cantor.speed;
  // Cantor's own _speedBuff must not be set (it skips itself in the loop)
  assert(!cantor._speedBuff || cantor._speedBuff === 1 || cantor._speedBuffUntil <= now,
    `buff_aura: cantor buffed itself (not expected)`);
  console.log(`  Self-skip OK: cantor not buffed by itself`);
}

// ── TEST 7: 'reflect_shield' (facet_guardian) — frontal deflect ──────────────
console.log("--- 'reflect_shield': crystal_cave_facet_guardian frontal deflect ---");
{
  const room = { code: 'FGTEST', hostId: 'p1', members: new Map() };
  // Guardian at (1000,1000), player NORTH at (1000,800)
  // front = (0,-1), bullet from (1000,978) heading south → hitFrom=(0,-1) → frontal
  const playerState = { x: 1000, y: 800, hp: 100, shield: 0, r: 14 };
  room.members.set('p1', { readyState: 1, send: () => {}, playerState });

  const sim = createSim(room);
  sim.config = { difficulty: 'veteran', mode: 'story', ngpLevel: 0 };
  sim.eventQueue = sim.eventQueue || [];
  sim.enemyGrid = null;

  const guardian = makeEnemy('crystal_cave_facet_guardian', 1000, 1000);
  guardian._idx = sim.nextEnemyIdx++;
  sim.enemies.push(guardian);

  const initialHp = guardian.hp; // 85

  sim.bullets.push({
    x: 1000, y: 978,
    vx: 0, vy: 400,
    dmg: 30, r: 4, life: 2,
    hostile: false, ownerPid: 'p1',
  });

  const dt = 1 / 60, now = Date.now();
  updateBullets(sim, dt, now);

  // Player bullet consumed
  assert(sim.bullets.filter(b => !b.hostile).length === 0,
    `facet_guardian frontal: player bullet not removed`);
  // Reflected hostile bullet spawned
  const reflected = sim.bullets.filter(b => b.hostile);
  assert(reflected.length >= 1, `facet_guardian frontal: no reflected bullet spawned`);
  // Guardian takes 0 damage (reflectArc=140 > 120, should still deflect)
  assert(guardian.hp === initialHp,
    `facet_guardian frontal: guardian took damage (hp=${guardian.hp} vs ${initialHp})`);
  const rb = reflected[0];
  assert(rb.dmg === 9,          `facet_guardian: reflected dmg wrong (got ${rb.dmg})`);
  assert(rb.hostile === true,   `facet_guardian: reflected bullet not hostile`);
  assert(rb.vy < 0,             `facet_guardian: reflected bullet wrong direction (vy=${rb.vy})`);
  console.log(`  facet_guardian FRONTAL OK: reflected dmg=${rb.dmg} vy=${rb.vy.toFixed(1)}, guardian hp=${guardian.hp}/${initialHp} (0 dmg)`);
}

// ── TEST 8: 'split' — shard_skitter field propagation + mote exists ──────────
console.log("--- 'split': crystal_cave_shard_skitter → crystal_cave_shard_mote ---");
{
  const sk = makeEnemy('crystal_cave_shard_skitter', 0, 0);
  assert(sk.behavior   === 'split',                    `skitter behavior wrong`);
  assert(sk.splitType  === 'crystal_cave_shard_mote',  `skitter splitType wrong (got ${sk.splitType})`);
  assert(sk.splitCount === 2,                          `skitter splitCount wrong (got ${sk.splitCount})`);
  assert(ENEMY_STATS['crystal_cave_shard_mote'],       'crystal_cave_shard_mote missing from ENEMY_STATS');
  const mote = makeEnemy('crystal_cave_shard_mote', 0, 0);
  assert(mote.behavior === 'melee', `mote behavior wrong (got ${mote.behavior})`);
  assert(mote.r   === 6,            `mote r wrong (got ${mote.r})`);
  assert(mote.hp  === 6,            `mote hp wrong (got ${mote.hp})`);
  assert(mote.dmg === 5,            `mote dmg wrong (got ${mote.dmg})`);
  assert(mote.speed === 200,        `mote speed wrong (got ${mote.speed})`);
  assert(mote.gold  === 1,          `mote gold wrong (got ${mote.gold})`);
  // mote must NOT have reflectArc>0 (would activate reflect in bullets.js)
  assert(mote.reflectArc === 0,     `mote reflectArc must be 0 (got ${mote.reflectArc})`);
  // mote must NOT buff allies (auraRange 0)
  assert(mote.auraRange === 0,      `mote auraRange must be 0 (got ${mote.auraRange})`);
  console.log(`  split fields OK: splitType=${sk.splitType}, splitCount=${sk.splitCount}, mote: r=${mote.r} hp=${mote.hp} speed=${mote.speed}`);
}

// ── TEST 9: stage 8 zone pool references valid ENEMY_STATS keys ──────────────
console.log('--- Stage 8 zone pool: all types in ENEMY_STATS ---');
{
  const { STAGES } = require('../../shared/stages-data');
  const stage8 = STAGES.find(s => s.id === 8);
  assert(stage8, 'Stage 8 not found in STAGES');
  assert(stage8.kind === 'crystal_cave', `Stage 8 kind wrong (got ${stage8.kind})`);
  for (const zone of stage8.zones) {
    for (const t of zone.pool) {
      assert(ENEMY_STATS[t], `Stage 8 zone pool references unknown type: '${t}'`);
    }
  }
  console.log(`  Zone 1 pool: [${stage8.zones[0].pool.join(', ')}]`);
  console.log(`  Zone 2 pool: [${stage8.zones[1].pool.join(', ')}]`);
  console.log('  All zone pool types found in ENEMY_STATS OK');
}

// ── ALL PASSED ────────────────────────────────────────────────────────────────
console.log('\nALL CRYSTAL CAVE SMOKE TESTS PASSED');
