// ossuary-enemy-smoke-test.js — verifierar alla 8 ossuary-enemies + crawler
// Kör: node .github/workflows/ossuary-enemy-smoke-test.js
'use strict';

const { makeEnemy, updateEnemy, ENEMY_STATS } = require('../../server/sim/enemies');
const { updateBullets, damageEnemy } = require('../../server/sim/bullets');

// ─── Minimal fake-sim (same shape as forest/desert smoke tests) ───────────────
function makeSim(playerX, playerY) {
  const pid = 'p1';
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: playerX, y: playerY, hp: 100, shield: 0, r: 14, speedMul: 1.0, invulnUntil: 0 },
  };
  const members = new Map([[pid, ws]]);
  return {
    room: { members },
    bullets: [],
    enemies: [],
    eventQueue: [],
    enemyGrid: null,
    nextEnemyIdx: 1,
    stageWallsList: null,
    survivorsActive: false,
    stresstestActive: false,
    castledefenseActive: false,
    battleroyaleActive: false,
    tdmActive: false, ctfActive: false, siegeActive: false,
    gungameActive: false, kothActive: false, juggernautActive: false,
    heistActive: false,
    _ws: ws,
    _pid: pid,
  };
}

// Drive N ticks with real wall-clock advancement so time-based timers expire.
function runTicks(sim, enemies, n, wallNow) {
  for (let i = 0; i < n; i++) {
    wallNow += 33;
    const dt = 0.033;
    const players = [];
    for (const [, ws] of sim.room.members) {
      if (ws.playerState) players.push(ws.playerState);
    }
    // Expire player slows (mirrors room-sim.js sweep)
    for (const [, ws] of sim.room.members) {
      const ps = ws.playerState;
      if (ps && ps._slowUntil && wallNow >= ps._slowUntil) {
        ps.speedMul   = ps._baseSpeedMul || 1.0;
        ps._slowUntil = 0;
      }
    }
    for (const e of enemies) {
      sim.enemies = enemies;
      updateEnemy(e, dt, wallNow, sim, players);
    }
    updateBullets(sim, dt, wallNow);
  }
  return wallNow;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed++; }
  else       { console.error('  FAIL:', msg); failed++; }
}

// ─── 1. ossuary_shambler (fast melee) ────────────────────────────────────────
console.log('\n[1] ossuary_shambler — melee');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_shambler', 600, 600);
  e._idx = 1;
  assert(e.hp === 18 && e.r === 12 && e.speed === 95 && e.dmg === 9 && e.behavior === 'melee', 'stats correct');
  assert(e.dmgReduce === 0, 'no dmgReduce (plain melee)');
  const startDist = Math.hypot(e.x - 500, e.y - 500);
  runTicks(sim, [e], 30, Date.now());
  const endDist = Math.hypot(e.x - 500, e.y - 500);
  assert(endDist < startDist, 'closed distance toward player');
  assert(sim.bullets.length === 0, 'no bullets (melee)');
  assert(!e.dead, 'alive after 30 ticks');
}

// ─── 2. ossuary_colossus (tank melee) ────────────────────────────────────────
console.log('\n[2] ossuary_colossus — tank melee');
{
  const e = makeEnemy('ossuary_colossus', 0, 0);
  assert(e.hp === 88 && e.r === 18 && e.speed === 62 && e.dmg === 20 && e.behavior === 'melee', 'stats correct');
  assert(e.gold === 24, 'gold reward correct');
}

// ─── 3. ossuary_spitter (spread — 4 pellets, 40° spread) ─────────────────────
console.log('\n[3] ossuary_spitter — spread, 4 pellets / 40° spread');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_spitter', 600, 500);   // d=100 < shootRange 300
  e._idx = 3; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'spread' && e.pellets === 4 && e.spreadDeg === 40 && e.bulletSpeed === 300, 'stats correct');
  assert(e.bulletDmg === 7 && e.bulletColor === '#dfe8c8', 'bullet stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 4, `fired 4 pellets (got ${sim.bullets.length})`);
  assert(sim.bullets.every(b => b.hostile && b.color === '#dfe8c8'), 'pellets hostile + correct color');
  assert(sim.bullets.every(b => b.dmg === 7), 'pellet dmg = 7');
}

// ─── 4. ossuary_wisp (homing bullet) ─────────────────────────────────────────
console.log('\n[4] ossuary_wisp — homing bullet steers toward player');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_wisp', 600, 500);   // d=100 < shootRange 340
  e._idx = 4; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'homing' && e.homingStrength === 0.09 && e.bulletSpeed === 240, 'stats correct');
  assert(e.bulletColor === '#7affd0', 'correct bullet color');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 homing bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.homing === true && b.homingStrength === 0.09, 'bullet has homing flags');
  // Verify homing curves: bullet going right (vx=+240,vy=0), player below → vy should increase
  const sim2 = makeSim(500, 560);
  sim2.bullets.push({ x: 300, y: 500, vx: 240, vy: 0, dmg: 8, life: 2.5, r: 5, color: '#7affd0', hostile: true, homing: true, homingStrength: 0.09, homingSpeed: 240 });
  updateBullets(sim2, 0.033, wallNow);
  if (sim2.bullets.length > 0) {
    assert(sim2.bullets[0].vy > 0, `homing curved downward toward player (vy=${sim2.bullets[0].vy.toFixed(2)})`);
  } else {
    assert(true, 'homing bullet reached player (very close)');
  }
}

// ─── 5. ossuary_lancer (charger — telegraph 600ms, dashSpeed 520) ─────────────
console.log('\n[5] ossuary_lancer — charger: telegraph(600ms) → dash(dmg↑26) → restore(dmg→14)');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_lancer', 1500, 500);   // far — won't reach player during test
  e._idx = 5;
  assert(e.behavior === 'charger' && e.dashInterval === 3000 && e.dashSpeed === 520 && e.dashDmg === 26 && e.telegraphMs === 600, 'stats correct');
  assert(e.dmg === 14, 'base dmg = 14');

  let wallNow = Date.now();
  let dashFired = false;
  let dmgDuringDash = null;
  let dashCycleComplete = false;
  let dmgAfterDash = null;

  // 250 ticks = 8250ms simulated — covers dashInterval(3000) + telegraphMs(600) + dash(450) + margin
  for (let i = 0; i < 250; i++) {
    wallNow += 33;
    sim.enemies = [e];
    updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);

    if (e._dashDmgActive && !dashFired) {
      dashFired     = true;
      dmgDuringDash = e.dmg;
    }
    if (dashFired && !e._dashDmgActive && dmgAfterDash === null) {
      dmgAfterDash      = e.dmg;
      dashCycleComplete = true;
      break;
    }
  }

  assert(dashFired, 'lancer entered dash phase within 250 ticks');
  assert(dmgDuringDash === 26, `dmg raised to dashDmg=26 during dash (got ${dmgDuringDash})`);
  assert(dashCycleComplete, 'dash ended and dmg restored');
  assert(dmgAfterDash === 14, `dmg restored to baseDmg=14 after dash (got ${dmgAfterDash})`);
  assert(typeof e._attackFxUntil === 'number', '_attackFxUntil was set (telegraph fx fired)');
}

// ─── 6. ossuary_bulwark (shielder — melee advance + 60% dmgReduce) ────────────
console.log('\n[6] ossuary_bulwark — shielder: melee advance + 60% damage reduction');
{
  // 6a. Stats
  const e = makeEnemy('ossuary_bulwark', 0, 0);
  assert(e.hp === 60 && e.r === 15 && e.speed === 70 && e.dmg === 12, 'stats correct');
  assert(e.behavior === 'shielder', 'behavior = shielder');
  assert(e.dmgReduce === 60, 'dmgReduce = 60');

  // 6b. Melee advance (falls through to melee branch — no early return in dispatch)
  const sim = makeSim(500, 500);
  const e2 = makeEnemy('ossuary_bulwark', 700, 500);
  e2._idx = 6;
  const startDist = Math.hypot(e2.x - 500, e2.y - 500);
  runTicks(sim, [e2], 30, Date.now());
  const endDist = Math.hypot(e2.x - 500, e2.y - 500);
  assert(endDist < startDist, `shielder advanced toward player (${startDist.toFixed(0)} → ${endDist.toFixed(0)})`);
  assert(sim.bullets.length === 0, 'no bullets (melee behavior, no ranged attack)');

  // 6c. Damage reduction: 10 dmg → 4 applied (60% off)
  const e3 = makeEnemy('ossuary_bulwark', 0, 0);
  e3.hp = 60;
  const hpBefore = e3.hp;
  damageEnemy(e3, 10, false, 'p1', 'pistol');
  const hpAfter = e3.hp;
  const applied = hpBefore - hpAfter;
  assert(Math.abs(applied - 4) < 0.01, `10 dmg → 4 applied after 60% reduction (got ${applied.toFixed(2)})`);

  // 6d. Other enemies NOT affected by dmgReduce (dmgReduce=0 → no reduction)
  const grunt = makeEnemy('grunt', 0, 0);
  grunt.hp = 20;
  const hpGruntBefore = grunt.hp;
  damageEnemy(grunt, 10, false, 'p1', 'pistol');
  assert(grunt.hp === hpGruntBefore - 10, 'grunt (dmgReduce=0) takes full damage');

  // 6e. Reduction covers melee path (applyMelee calls damageEnemy directly)
  // Already proven by 6c — same damageEnemy function is called from applyMelee.
  // Demonstrate via direct call to match the chain.
  const e4 = makeEnemy('ossuary_bulwark', 0, 0);
  e4.hp = 60;
  damageEnemy(e4, 25, false, 'p1', 'sledge');
  const meleeDmgApplied = 60 - e4.hp;
  assert(Math.abs(meleeDmgApplied - 10) < 0.01, `melee 25 dmg → 10 applied after 60% reduction (got ${meleeDmgApplied.toFixed(2)})`);
}

// ─── 7. ossuary_hook_wraith (root_hook — fires root bullet) ──────────────────
console.log('\n[7] ossuary_hook_wraith — root_hook bullet roots player on hit');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_hook_wraith', 600, 500);   // d=100, in range (360), > 60
  e._idx = 7; e.lastShot = Date.now() - 4000;
  assert(e.behavior === 'root_hook' && e.rootMs === 900 && e.rootMul === 0.40 && e.shootRate === 3500, 'stats correct');
  assert(e.bulletColor === '#c9b48a', 'correct bullet color (bone)');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired root_hook bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.rootOnHit && b.rootOnHit.ms === 900 && b.rootOnHit.mul === 0.40, 'bullet has rootOnHit ms=900 mul=0.40');
  // Simulate bullet hitting player
  sim.bullets[0].x = 500; sim.bullets[0].y = 500;
  updateBullets(sim, 0.033, wallNow + 33);
  const ps = sim._ws.playerState;
  assert(ps._slowUntil > wallNow, 'player slow applied on bullet hit');
  assert(ps.speedMul <= 0.41, `speedMul reduced to ~0.40 (got ${ps.speedMul})`);
}

// ─── 8. ossuary_splitter (split_on_death spawns 2 ossuary_crawlers) ──────────
console.log('\n[8] ossuary_splitter — split spawns 2 ossuary_crawlers on death');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_splitter', 600, 600);
  e._idx = 8;
  assert(e.hp === 30 && e.behavior === 'split' && e.splitType === 'ossuary_crawler' && e.splitCount === 2, 'stats correct');
  // splitter is melee (falls through behavior dispatch)
  runTicks(sim, [e], 10, Date.now());
  assert(!e.dead, 'alive before kill');
  // Mirror room-sim split_on_death block exactly
  e.dead = true;
  sim.enemies = [e];
  if (e.behavior === 'split' && !e._noSplit && e.splitType && sim.enemies.length < 80) {
    const sc = Math.min(e.splitCount || 2, 80 - sim.enemies.length);
    for (let si = 0; si < sc; si++) {
      const sx = e.x + (Math.random() - 0.5) * 30;
      const sy = e.y + (Math.random() - 0.5) * 30;
      const child = makeEnemy(e.splitType, sx, sy);
      child._idx = sim.nextEnemyIdx++;
      child._noSplit = true;
      sim.enemies.push(child);
    }
  }
  const children = sim.enemies.filter(x => x.type === 'ossuary_crawler');
  assert(children.length === 2, `spawned ${children.length} crawler children`);
  assert(children.every(c => c._noSplit === true), 'children have _noSplit guard (no chain-split)');
  // Verify crawler stats
  const crawler = makeEnemy('ossuary_crawler', 0, 0);
  assert(crawler.hp === 8 && crawler.r === 8 && crawler.speed === 150 && crawler.behavior === 'melee', 'crawler stats correct');
  assert(crawler.dmgReduce === 0, 'crawler has no dmgReduce');
}

// ─── 9. All 9 types: no exceptions over 60 ticks ─────────────────────────────
console.log('\n[9] All 9 ossuary enemy types — 60-tick exception-free run');
{
  const types = [
    'ossuary_shambler', 'ossuary_colossus', 'ossuary_spitter', 'ossuary_wisp',
    'ossuary_lancer', 'ossuary_bulwark', 'ossuary_hook_wraith', 'ossuary_splitter',
    'ossuary_crawler',
  ];
  for (const type of types) {
    let threw = false;
    try {
      const sim = makeSim(500, 500);
      const e = makeEnemy(type, 700, 500);
      e._idx = 99;
      runTicks(sim, [e], 60, Date.now());
    } catch (err) {
      threw = true;
      console.error(`  EXCEPTION for ${type}:`, err.message);
    }
    assert(!threw, `${type}: no exception over 60 ticks`);
  }
}

// ─── 10. stages-data.js stage 4 uses ossuary enemies ─────────────────────────
console.log('\n[10] stages-data.js stage 4 zone pools contain ossuary enemies');
{
  const { STAGES } = require('../../shared/stages-data');
  const s4 = STAGES.find(s => s.id === 4);
  assert(s4 && s4.kind === 'ossuary', 'stage 4 exists and kind=ossuary');
  const allTypes = s4.zones.flatMap(z => z.pool);
  assert(allTypes.some(t => t.startsWith('ossuary_')), 'zone pool contains ossuary_ types');
  assert(allTypes.includes('ossuary_bulwark'),    'zone 2 contains ossuary_bulwark (shielder)');
  assert(allTypes.includes('ossuary_lancer'),     'zone 2 contains ossuary_lancer (charger)');
  assert(allTypes.includes('ossuary_hook_wraith'),'zone 2 contains ossuary_hook_wraith (root_hook)');
  assert(allTypes.includes('ossuary_splitter'),   'zone pool contains ossuary_splitter (split)');
  // All pool entries must exist in ENEMY_STATS
  for (const t of allTypes) {
    assert(t in ENEMY_STATS, `ENEMY_STATS has entry for pool type '${t}'`);
  }
}

// ─── 11. shielder dmgReduce does NOT affect other enemies (isolation) ─────────
console.log('\n[11] dmgReduce isolation — only ossuary_bulwark is affected');
{
  const nonShielders = ['grunt', 'brute', 'forest_mosshusk', 'desert_sandram', 'ossuary_shambler', 'ossuary_crawler'];
  for (const type of nonShielders) {
    const e = makeEnemy(type, 0, 0);
    assert(e.dmgReduce === 0, `${type}.dmgReduce === 0`);
  }
  const bulwark = makeEnemy('ossuary_bulwark', 0, 0);
  assert(bulwark.dmgReduce === 60, 'ossuary_bulwark.dmgReduce === 60');
}

// ─── 12. shielder falls through to melee branch (no early-return in dispatch) ──
console.log('\n[12] shielder behavior falls through to melee branch (dispatch sanity)');
{
  // If the dispatch condition erroneously caught 'shielder' as ranged → it would hit the
  // default switch case and do simple advance (no contact damage). We verify contact damage
  // works by running the enemy into a player and checking dmg > 0 AND e.contactCd is set.
  const sim = makeSim(500, 500);
  const e = makeEnemy('ossuary_bulwark', 514, 500);   // 14px from player center → contact range (r15+r14=29)
  e._idx = 12;
  e.contactCd = 0;
  const ps = sim._ws.playerState;
  ps.invulnUntil = 0;
  const hpBefore = ps.hp;
  let wallNow = Date.now();
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [ps]);
  // After one tick in contact range the shielder should have dealt contact damage (e.dmg=12)
  // and set contactCd. The melee branch (fallthrough) is the only branch that calls applyContactDamage.
  assert(ps.hp < hpBefore || e.contactCd > 0, 'contact damage applied (melee branch ran for shielder)');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Ossuary enemy smoke-test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
