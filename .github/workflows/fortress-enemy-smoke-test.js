// Fortress-biome smoke test — verifies all 8 stage-10 enemy types over many
// sim ticks with per-behavior assertions. Also re-runs 100-tick regression
// across stages 1-10 to confirm zero regressions on all prior biomes.
// Run: node .github/workflows/fortress-enemy-smoke-test.js
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { ENEMY_STATS, makeEnemy, updateEnemy } = require(path.join(ROOT, 'server/sim/enemies'));
const { createSim }  = require(path.join(ROOT, 'server/sim/room-sim'));
const { loadStage }  = require(path.join(ROOT, 'server/sim/waves'));
const { tickSim }    = require(path.join(ROOT, 'server/sim/room-sim'));

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
  const room = { code: 'FORTRESSTEST', hostId: 'p1', members: new Map() };
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

/** Run updateEnemy N times with dt=0.033 and advancing now. */
function runTicks(e, sim, player, n, nowOverride) {
  sim.enemies = [e];
  const now = nowOverride !== undefined ? nowOverride : Date.now();
  for (let i = 0; i < n; i++) {
    updateEnemy(e, 0.033, now + i * 33, sim, [player]);
  }
}

// ─── 1. ENEMY_STATS presence ──────────────────────────────────────────────────
console.log('\n[1] ENEMY_STATS entries present');
const FORTRESS_TYPES = [
  'fortress_ironguard', 'fortress_colossus', 'fortress_crossbow',
  'fortress_ballista',  'fortress_tower_shield', 'fortress_lancer',
  'fortress_herald',    'fortress_hook',
];
for (const t of FORTRESS_TYPES) {
  assert(!!ENEMY_STATS[t], `ENEMY_STATS['${t}'] exists`);
}

// ─── 2. makeEnemy field copy ──────────────────────────────────────────────────
console.log('\n[2] makeEnemy copies behavior params correctly');
{
  const e = makeEnemy('fortress_crossbow', 0, 0);
  assert(e.behavior === 'spread',       'crossbow behavior=spread');
  assert(e.shootRange === 320,          'crossbow shootRange=320');
  assert(e.shootRate  === 1500,         'crossbow shootRate=1500');
  assert(e.bulletSpeed === 420,         'crossbow bulletSpeed=420');
  assert(e.bulletDmg  === 8,            'crossbow bulletDmg=8');
  assert(e.pellets    === 4,            'crossbow pellets=4');
  assert(e.spreadDeg  === 28,           'crossbow spreadDeg=28');
  assert(e.bulletColor === '#e8d27a',   'crossbow bulletColor=#e8d27a');
}
{
  const e = makeEnemy('fortress_ballista', 0, 0);
  assert(e.behavior === 'sniper',       'ballista behavior=sniper');
  assert(e.shootRange  === 720,         'ballista shootRange=720');
  assert(e.shootRate   === 2400,        'ballista shootRate=2400');
  assert(e.telegraphMs === 800,         'ballista telegraphMs=800');
  assert(e.bulletSpeed === 950,         'ballista bulletSpeed=950');
  assert(e.bulletDmg   === 40,          'ballista bulletDmg=40');
  assert(e.bulletColor === '#ffd24a',   'ballista bulletColor=#ffd24a');
}
{
  const e = makeEnemy('fortress_tower_shield', 0, 0);
  assert(e.behavior === 'shielder',     'tower_shield behavior=shielder');
  assert(e.dmgReduce === 70,            'tower_shield dmgReduce=70');
}
{
  const e = makeEnemy('fortress_lancer', 0, 0);
  assert(e.behavior === 'charger',      'lancer behavior=charger');
  assert(e.dashInterval === 3000,       'lancer dashInterval=3000');
  assert(e.dashSpeed    === 430,        'lancer dashSpeed=430');
  assert(e.dashDmg      === 32,         'lancer dashDmg=32');
  assert(e.telegraphMs  === 300,        'lancer telegraphMs=300');
}
{
  const e = makeEnemy('fortress_herald', 0, 0);
  assert(e.behavior === 'buff_aura',    'herald behavior=buff_aura');
  assert(e.auraRange    === 180,        'herald auraRange=180');
  assert(e.speedBuffPct === 35,         'herald speedBuffPct=35');
  assert(e.buffInterval === 1000,       'herald buffInterval=1000');
}
{
  const e = makeEnemy('fortress_hook', 0, 0);
  assert(e.behavior === 'root_hook',    'hook behavior=root_hook');
  assert(e.shootRange  === 300,         'hook shootRange=300');
  assert(e.shootRate   === 3500,        'hook shootRate=3500');
  assert(e.bulletSpeed === 500,         'hook bulletSpeed=500');
  assert(e.bulletDmg   === 6,           'hook bulletDmg=6');
  assert(e.rootMs      === 900,         'hook rootMs=900');
  assert(e.rootMul     === 0.40,        'hook rootMul=0.40');
  assert(e.bulletColor === '#c0a020',   'hook bulletColor=#c0a020');
}

// ─── 3. Melee movement — ironguard + colossus advance toward player ───────────
console.log('\n[3] Melee enemies move toward player');
for (const type of ['fortress_ironguard', 'fortress_colossus']) {
  const e = makeEnemy(type, 0, 0);
  const p = fakePlayer(200, 0);
  const sim = makeFakeSim(200, 0);
  const x0 = e.x;
  runTicks(e, sim, p, 5);
  assert(e.x > x0, `${type} moves toward player (x: ${x0} → ${e.x.toFixed(1)})`);
}

// ─── 4. Spread — crossbow fires 4-pellet salvo when in range ─────────────────
console.log('\n[4] fortress_crossbow fires 4-pellet spread salvo');
{
  const e = makeEnemy('fortress_crossbow', 500, 500);
  const p = fakePlayer(500 + 200, 500);  // d=200 < shootRange 320
  const sim = makeFakeSim(p.x, p.y);
  // lastShot=0 → fires immediately on first tick
  runTicks(e, sim, p, 1, Date.now());
  const pelletBullets = sim.bullets.filter(b => b.hostile);
  assert(pelletBullets.length === 4, `crossbow fired ${pelletBullets.length} pellets (expected 4)`);
  if (pelletBullets.length > 0) {
    assert(pelletBullets[0].dmg === 8,           `pellet dmg=8 (got ${pelletBullets[0].dmg})`);
    assert(pelletBullets[0].color === '#e8d27a', `pellet color=#e8d27a (got ${pelletBullets[0].color})`);
  }
}

// ─── 5. Sniper — ballista telegraphs 800ms then fires 40-dmg bolt ────────────
console.log('\n[5] fortress_ballista telegraphs then fires 40-dmg bolt');
{
  const now = Date.now();
  const e = makeEnemy('fortress_ballista', 0, 0);
  const p = fakePlayer(400, 0);   // d=400 < shootRange 720
  const sim = makeFakeSim(p.x, p.y);
  sim.enemies = [e];
  // Tick 1: in range, lastShot=0 → should enter aiming/telegraph state
  updateEnemy(e, 0.033, now, sim, [p]);
  assert(e.aiming === true,      'ballista entered aiming state on first tick');
  assert(!!e._attackFxUntil,     'ballista set _attackFxUntil for telegraph FX');
  // Tick after 800ms telegraph: fires the shot
  updateEnemy(e, 0.033, now + 810, sim, [p]);
  assert(e.aiming === false, 'ballista stopped aiming after telegraph expired');
  const sniperBullets = sim.bullets.filter(b => b.hostile && !b.homing);
  assert(sniperBullets.length >= 1, `ballista spawned ${sniperBullets.length} bolt(s)`);
  if (sniperBullets.length > 0) {
    assert(sniperBullets[0].dmg   === 40,      `bolt dmg=40 (got ${sniperBullets[0].dmg})`);
    assert(sniperBullets[0].life  === 1.5,     `bolt life=1.5 (got ${sniperBullets[0].life})`);
    assert(sniperBullets[0].color === '#ffd24a', `bolt color=#ffd24a (got ${sniperBullets[0].color})`);
  }
}

// ─── 6. Shielder — tower_shield advances (melee fall-through), dmgReduce=70 ──
console.log('\n[6] fortress_tower_shield moves toward player (shielder fall-through to melee)');
{
  const e = makeEnemy('fortress_tower_shield', 0, 0);
  const p = fakePlayer(300, 0);
  const sim = makeFakeSim(p.x, p.y);
  const x0 = e.x;
  runTicks(e, sim, p, 5);
  assert(e.x > x0, `tower_shield advances toward player (x: ${x0} → ${e.x.toFixed(1)})`);
  assert(e.dmgReduce === 70, 'tower_shield dmgReduce=70 preserved on live enemy');
}

// ─── 7. Charger — lancer telegraphs 300ms then dashes with dashDmg=32 ────────
console.log('\n[7] fortress_lancer telegraphs then dashes with dashDmg=32');
{
  const now = Date.now();
  const e = makeEnemy('fortress_lancer', 0, 0);
  const p = fakePlayer(300, 0);
  const sim = makeFakeSim(p.x, p.y);
  // Pre-trigger: set _nextDash to now-1 so first call immediately triggers telegraph
  e._nextDash = now - 1;
  const baseDmg = e.dmg;
  // Tick 1: triggers telegraph (sets _telegraphUntil, locks direction)
  updateEnemy(e, 0.033, now, sim, [p]);
  assert(!!e._telegraphUntil,  'lancer entered telegraph (_telegraphUntil set)');
  assert(!!e._attackFxUntil,   'lancer _attackFxUntil set during 300ms telegraph');
  // Tick after 300ms telegraph: dash launches
  updateEnemy(e, 0.033, now + 310, sim, [p]);
  assert(!!e._dashUntil, 'lancer launched dash (_dashUntil set)');
  // Tick mid-dash: dmg elevated to dashDmg=32
  updateEnemy(e, 0.033, now + 320, sim, [p]);
  assert(e.dmg === 32, `lancer dashDmg=32 active during dash (got ${e.dmg})`);
}

// ─── 8. Buff_aura — herald hastens allies within auraRange=180 ────────────────
console.log('\n[8] fortress_herald hastens allies within auraRange');
{
  const now = Date.now();
  const herald = makeEnemy('fortress_herald', 0, 0);
  // An ally within auraRange=180 should be buffed; an ally outside should not
  const allyClose  = makeEnemy('fortress_ironguard', 100, 0);  // d=100 < 180
  const allyFar    = makeEnemy('fortress_ironguard', 250, 0);  // d=250 > 180
  const p = fakePlayer(0, 500);   // player is far; herald backs away from it
  const sim = makeFakeSim(p.x, p.y);
  sim.enemies = [herald, allyClose, allyFar];
  // _nextBuff=undefined → first tick triggers buff (now >= undefined is false, but
  // _nextBuff gets set to now+buffInterval in the behavior. Force it to fire immediately:
  herald._nextBuff = now - 1;
  updateEnemy(herald, 0.033, now, sim, [p]);
  assert(!!allyClose._speedBuffUntil && allyClose._speedBuff > 1,
    `close ally buffed: _speedBuff=${allyClose._speedBuff} _speedBuffUntil set`);
  assert(!allyFar._speedBuffUntil || allyFar._speedBuff === 1 || allyFar._speedBuff === undefined,
    `far ally NOT buffed: _speedBuff=${allyFar._speedBuff}`);
  // Verify buff multiplier matches speedBuffPct=35 → 1.35
  if (allyClose._speedBuff) {
    assert(Math.abs(allyClose._speedBuff - 1.35) < 0.001,
      `buff multiplier=1.35 (speedBuffPct=35), got ${allyClose._speedBuff}`);
  }
}

// ─── 9. Root_hook — fortress_hook fires rootOnHit bullet when in range ────────
console.log('\n[9] fortress_hook fires rootOnHit bullet when in range');
{
  const e = makeEnemy('fortress_hook', 500, 500);
  const p = fakePlayer(500 + 200, 500);  // d=200 < shootRange 300, > 60 melee-min
  const sim = makeFakeSim(p.x, p.y);
  // lastShot=0 → fires immediately
  runTicks(e, sim, p, 1, Date.now());
  const rootBullets = sim.bullets.filter(b => b.hostile && b.rootOnHit);
  assert(rootBullets.length >= 1, `fortress_hook spawned ${rootBullets.length} rootOnHit bullet(s)`);
  if (rootBullets.length > 0) {
    assert(rootBullets[0].dmg  === 6,       `hook bullet dmg=6 (got ${rootBullets[0].dmg})`);
    assert(rootBullets[0].rootOnHit.ms  === 900,  `rootOnHit.ms=900 (got ${rootBullets[0].rootOnHit.ms})`);
    assert(Math.abs(rootBullets[0].rootOnHit.mul - 0.40) < 0.001,
      `rootOnHit.mul=0.40 (got ${rootBullets[0].rootOnHit.mul})`);
    assert(rootBullets[0].color === '#c0a020', `hook bullet color=#c0a020 (got ${rootBullets[0].color})`);
  }
}

// ─── 10. Stage-10 pool wiring in stages-data.js ───────────────────────────────
console.log('\n[10] Stage 10 zones reference fortress_ types');
{
  const { STAGES } = require(path.join(ROOT, 'shared/stages-data'));
  const stage10 = STAGES.find(s => s.id === 10);
  assert(!!stage10, 'Stage 10 exists');
  assert(stage10 && stage10.kind === 'fortress', `Stage 10 kind=fortress (got ${stage10 && stage10.kind})`);
  if (stage10) {
    const z1 = stage10.zones[0];
    const z2 = stage10.zones[1];
    assert(z1.pool.includes('fortress_ironguard'),    'zone1 has fortress_ironguard');
    assert(z1.pool.includes('fortress_colossus'),     'zone1 has fortress_colossus');
    assert(z1.pool.includes('fortress_crossbow'),     'zone1 has fortress_crossbow');
    assert(z1.pool.includes('fortress_tower_shield'), 'zone1 has fortress_tower_shield');
    assert(z2.pool.includes('fortress_ballista'),     'zone2 has fortress_ballista');
    assert(z2.pool.includes('fortress_lancer'),       'zone2 has fortress_lancer');
    assert(z2.pool.includes('fortress_herald'),       'zone2 has fortress_herald');
    assert(z2.pool.includes('fortress_hook'),         'zone2 has fortress_hook');
    assert(z2.pool.includes('fortress_ironguard'),    'zone2 also has fortress_ironguard (anchor type)');
    assert(z2.event === 'alarm',                      `zone2 event=alarm (got ${z2.event})`);
    assert(z1.count === 12, `zone1 count=12 (got ${z1.count})`);
    assert(z2.count === 15, `zone2 count=15 (got ${z2.count})`);
    // Confirm no old generic enemies leaked into stage-10 pools
    const allPool = [...z1.pool, ...z2.pool];
    const nonFortress = allPool.filter(t => !t.startsWith('fortress_'));
    assert(nonFortress.length === 0,
      `All stage-10 pool types are fortress_ (found non-fortress: [${nonFortress.join(', ')}])`);
  }
}

// ─── 11. Regression — 100 ticks per stage (1-10) without crash ────────────────
console.log('\n[11] Regression: 100 ticks per stage (1-10) without crash, enemies spawn');
for (let stageId = 1; stageId <= 10; stageId++) {
  const room = { code: `STAGE${stageId}`, hostId: 'p1', members: new Map() };
  const ws = { readyState: 1, send: () => {}, playerState: { x: 1100, y: 2640, hp: 100 } };
  room.members.set('p1', ws);
  const sim = createSim(room);
  loadStage(sim, stageId);
  sim.simReadyAt = 0;
  sim.lastTick   = Date.now();
  let maxEnemies = 0;
  let crashed    = false;
  for (let i = 0; i < 100; i++) {
    sim.lastTick = Date.now() - 33;
    try { tickSim(sim); }
    catch (err) { console.error(`  Stage ${stageId} crashed @ tick ${i}:`, err.message); crashed = true; break; }
    maxEnemies = Math.max(maxEnemies, sim.enemies.length);
  }
  assert(!crashed,       `Stage ${stageId}: 100 ticks without crash`);
  assert(maxEnemies > 0, `Stage ${stageId}: enemies spawned (max=${maxEnemies})`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed} assertions — ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
else console.log('ALL ASSERTIONS PASSED');
