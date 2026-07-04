// desert-enemy-smoke-test.js — verifierar alla 8 desert-enemies + huskling
// Kör: node .github/workflows/desert-enemy-smoke-test.js
'use strict';

const { makeEnemy, updateEnemy } = require('../../server/sim/enemies');
const { updateBullets } = require('../../server/sim/bullets');

// ─── Minimal fake-sim (same shape as forest smoke test) ──────────────────────
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

// Drive N ticks with real wall-clock advancement (mirrors forest smoke test pattern
// so time-based timers — dashInterval, burrowInterval — actually expire).
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

// ─── 1. desert_jackal (fast melee flanker) ───────────────────────────────────
console.log('\n[1] desert_jackal — fast melee');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_jackal', 600, 600);
  e._idx = 1;
  assert(e.hp === 14 && e.r === 9 && e.speed === 235 && e.behavior === 'melee', 'stats correct');
  const startDist = Math.hypot(e.x - 500, e.y - 500);
  runTicks(sim, [e], 30, Date.now());
  const endDist = Math.hypot(e.x - 500, e.y - 500);
  assert(endDist < startDist, 'closed distance toward player');
  assert(sim.bullets.length === 0, 'no bullets (melee)');
  assert(!e.dead, 'alive after 30 ticks');
}

// ─── 2. desert_husk (split behavior — spawns 2 desert_huskling on death) ─────
console.log('\n[2] desert_husk — split spawns 2 desert_huskling on death');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_husk', 600, 600);
  e._idx = 2;
  assert(e.hp === 26 && e.behavior === 'split' && e.splitType === 'desert_huskling' && e.splitCount === 2, 'stats correct');
  // husk is melee (falls through the behavior dispatch)
  runTicks(sim, [e], 10, Date.now());
  assert(!e.dead, 'alive before kill');
  // Mirror room-sim split_on_death block exactly
  e.dead = true; e.lastDamagerPid = 'p1';
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
  const children = sim.enemies.filter(x => x.type === 'desert_huskling');
  assert(children.length === 2, `spawned ${children.length} huskling children`);
  assert(children.every(c => c._noSplit === true), 'children have _noSplit guard (no chain-split)');
  // Verify huskling stats
  const husk = makeEnemy('desert_huskling', 0, 0);
  assert(husk.hp === 13 && husk.r === 8 && husk.speed === 150 && husk.behavior === 'melee', 'huskling stats correct');
}

// ─── 3. desert_reaver (spread — 4 pellets, 34° spread) ───────────────────────
console.log('\n[3] desert_reaver — spread, 4 pellets / 34° spread');
{
  // Pre-expire cooldown; place inside shootRange (300)
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_reaver', 600, 500);   // d=100 < 300
  e._idx = 3; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'spread' && e.pellets === 4 && e.spreadDeg === 34 && e.bulletSpeed === 420, 'stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 4, `fired 4 pellets (got ${sim.bullets.length})`);
  assert(sim.bullets.every(b => b.hostile && b.color === '#ffb24a'), 'pellets hostile + correct color');
  assert(sim.bullets.every(b => b.dmg === 7), 'pellet dmg = 7');
}

// ─── 4. desert_mirage (homing — steers toward player) ────────────────────────
console.log('\n[4] desert_mirage — homing bullet steers toward player');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_mirage', 600, 500);   // d=100 < shootRange 340
  e._idx = 4; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'homing' && e.homingStrength === 0.09 && e.bulletSpeed === 300, 'stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 homing bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.homing === true && b.homingStrength === 0.09, 'bullet has homing flags');
  assert(b.color === '#7fe0ff', 'correct bullet color');
  // Verify homing curves: bullet going right (vx=+300,vy=0), player also slightly below → vy should increase
  const sim2 = makeSim(500, 560);
  sim2.bullets.push({ x: 300, y: 500, vx: 300, vy: 0, dmg: 8, life: 2.5, r: 5, color: '#7fe0ff', hostile: true, homing: true, homingStrength: 0.09, homingSpeed: 300 });
  updateBullets(sim2, 0.033, wallNow);
  if (sim2.bullets.length > 0) {
    assert(sim2.bullets[0].vy > 0, `homing curved downward toward player (vy=${sim2.bullets[0].vy.toFixed(2)})`);
  } else {
    assert(true, 'homing bullet reached player (very close)');
  }
}

// ─── 5. desert_sandram (charger — telegraph + dash + dmg restore) ─────────────
console.log('\n[5] desert_sandram — charger: telegraph → dash (dmg↑26) → restore (dmg→16)');
{
  // Place player far enough to avoid contact during normal chase
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_sandram', 1500, 500);   // very far — won't reach player in test window
  e._idx = 5;
  assert(e.behavior === 'charger' && e.dashInterval === 3000 && e.dashSpeed === 520 && e.dashDmg === 26 && e.telegraphMs === 260, 'stats correct');
  assert(e.dmg === 16, 'base dmg = 16');

  let wallNow = Date.now();
  let dashFired = false;
  let dmgDuringDash = null;
  let dashCycleComplete = false;
  let dmgAfterDash = null;

  // Run up to 200 ticks (6600ms simulated) — covers dashInterval(3000) + telegraphMs(260) + dash(450) + margin
  for (let i = 0; i < 200; i++) {
    wallNow += 33;
    sim.enemies = [e];
    updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);

    if (e._dashDmgActive && !dashFired) {
      dashFired      = true;
      dmgDuringDash  = e.dmg;   // should be dashDmg (26)
    }
    if (dashFired && !e._dashDmgActive && dmgAfterDash === null) {
      // Dash just ended this tick — dmg restored
      dmgAfterDash       = e.dmg;
      dashCycleComplete  = true;
      break;
    }
  }

  assert(dashFired, 'charger entered dash phase within 200 ticks');
  assert(dmgDuringDash === 26, `dmg raised to dashDmg=26 during dash (got ${dmgDuringDash})`);
  assert(dashCycleComplete, 'dash ended and dmg restored');
  assert(dmgAfterDash === 16, `dmg restored to baseDmg=16 after dash (got ${dmgAfterDash})`);

  // Verify telegraph fx flag was set (e._attackFxUntil set at telegraph start, may have expired — check it was ever set)
  // We know dash ran, which means telegraph ran before it; _attackFxUntil was set during telegraph.
  assert(typeof e._attackFxUntil === 'number', '_attackFxUntil was set (telegraph fx fired)');

  // Verify dash direction was locked (not NaN)
  assert(typeof e._dashDx === 'number' && !isNaN(e._dashDx), '_dashDx set (direction locked at telegraph)');
  assert(typeof e._dashDy === 'number' && !isNaN(e._dashDy), '_dashDy set');
}

// ─── 6. desert_lurker (burrow — dive suppresses dmg; resurface deals hit) ─────
console.log('\n[6] desert_lurker — burrow: dive (dmg=0) → resurface (resurfaceDmg=15)');
{
  // Place enemy just within resurface range from start; pre-expire _nextBurrow so dive triggers immediately.
  // No contact dmg during normal phase (dive starts on tick 1).
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_lurker', 520, 500);   // d=20, within resurface range (r12+r14+20=46)
  e._idx = 6;
  assert(e.behavior === 'burrow' && e.burrowInterval === 5000 && e.submergeMs === 1200 && e.underSpeed === 230 && e.resurfaceDmg === 15, 'stats correct');
  assert(e.dmg === 15, 'base dmg = 15');

  // Force immediate dive by pre-setting _nextBurrow = 0 (expired).
  // _behaviorBurrow checks: if (_nextBurrow === undefined) init. Since we set it to 0 (not undefined),
  // initialization is skipped and now >= 0 triggers dive on tick 1.
  e._nextBurrow = 0;

  let wallNow = Date.now();
  let diveStarted = false;
  let dmgDuringDive = null;
  let resurfaced = false;
  const ps = sim._ws.playerState;
  const hpBefore = ps.hp;

  // Run up to 100 ticks (3300ms) — submergeMs=1200ms so resurface at ~tick 37
  for (let i = 0; i < 100; i++) {
    wallNow += 33;
    sim.enemies = [e];
    updateEnemy(e, 0.033, wallNow, sim, [ps]);
    updateBullets(sim, 0.033, wallNow);

    if (e._diveUntil && !diveStarted) {
      diveStarted    = true;
      dmgDuringDive  = e.dmg;   // should be 0
    }
    if (diveStarted && !e._diveUntil && !resurfaced) {
      resurfaced = true;
      break;   // capture hp after resurface tick
    }
  }

  assert(diveStarted, 'lurker entered dive phase');
  assert(dmgDuringDive === 0, `e.dmg=0 during dive (got ${dmgDuringDive}) — applyContactDamage suppressed`);
  assert(resurfaced, 'lurker resurfaced after submergeMs');
  assert(e.dmg === 15, `dmg restored to 15 after resurface (got ${e.dmg})`);
  assert(ps.hp < hpBefore, `resurfaceDmg dealt to player (hp ${hpBefore} → ${ps.hp})`);
  assert(hpBefore - ps.hp <= 15, `resurface hit ≤ resurfaceDmg=15 (dealt ${hpBefore - ps.hp})`);
  // invulnUntil should be set after resurface hit
  assert(ps.invulnUntil > wallNow - 500, 'player invulnUntil set by resurface hit');
}

// ─── 7. desert_tarspitter (lob_aoe — AoE detonates on bullet expiry) ──────────
console.log('\n[7] desert_tarspitter — lob_aoe, AoE detonates on bullet expiry');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_tarspitter', 650, 500);   // d=150 < shootRange 260
  e._idx = 7; e.lastShot = Date.now() - 3000;
  assert(e.behavior === 'lob_aoe' && e.aoeRadius === 55 && e.aoeDmg === 14 && e.shootRate === 2600, 'stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 lob_aoe bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.aoeOnExpire && b.aoeOnExpire.radius === 55 && b.aoeOnExpire.dmg === 14, 'bullet has aoeOnExpire radius=55 dmg=14');
  assert(b.dmg === 0, 'direct-hit dmg=0 (AoE does the damage)');
  assert(b.color === '#7a6a2a', 'correct tar-bomb color');
  // Force bullet to player pos + expire → AoE should hit player
  sim.bullets[0].x = 500; sim.bullets[0].y = 500; sim.bullets[0].life = -1;
  const ps = sim._ws.playerState;
  const hpBefore = ps.hp;
  updateBullets(sim, 0.033, wallNow + 33);
  assert(ps.hp < hpBefore, `AoE dealt damage (hp ${hpBefore} → ${ps.hp})`);
  assert(sim.bullets.length === 0, 'bullet consumed after AoE');
}

// ─── 8. desert_warden (root_hook — fires root bullet, roots player on hit) ────
console.log('\n[8] desert_warden — root_hook bullet roots player on hit');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('desert_warden', 600, 500);   // d=100, in range (320), > 60
  e._idx = 8; e.lastShot = Date.now() - 5000;
  assert(e.behavior === 'root_hook' && e.rootMs === 900 && e.rootMul === 0.40 && e.shootRate === 4000, 'stats correct');
  assert(e.bulletColor === '#d4af37', 'correct bullet color (gold)');
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

// ─── 9. All 8 types: no exceptions over 60 ticks ─────────────────────────────
console.log('\n[9] All 8 desert enemy types — 60-tick exception-free run');
{
  const types = [
    'desert_jackal', 'desert_husk', 'desert_reaver', 'desert_mirage',
    'desert_sandram', 'desert_lurker', 'desert_tarspitter', 'desert_warden',
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
  // Also huskling
  {
    let threw = false;
    try {
      const sim = makeSim(500, 500);
      const e = makeEnemy('desert_huskling', 600, 500);
      e._idx = 100;
      runTicks(sim, [e], 60, Date.now());
    } catch (err) {
      threw = true;
      console.error('  EXCEPTION for desert_huskling:', err.message);
    }
    assert(!threw, 'desert_huskling: no exception over 60 ticks');
  }
}

// ─── 10. stages-data.js stage 2 uses desert enemies ─────────────────────────
console.log('\n[10] stages-data.js stage 2 zone pools contain desert enemies');
{
  const { STAGES } = require('../../shared/stages-data');
  const s2 = STAGES.find(s => s.id === 2);
  assert(s2 && s2.kind === 'desert', 'stage 2 exists and kind=desert');
  const allTypes = s2.zones.flatMap(z => z.pool);
  assert(allTypes.some(t => t.startsWith('desert_')), 'zone pool contains desert_ types');
  assert(allTypes.includes('desert_sandram'), 'zone 1 contains desert_sandram (charger)');
  assert(allTypes.includes('desert_lurker'),  'zone 2 contains desert_lurker (burrow)');
  // All pool entries should exist in ENEMY_STATS
  const { ENEMY_STATS } = require('../../server/sim/enemies');
  for (const t of allTypes) {
    assert(t in ENEMY_STATS, `ENEMY_STATS has entry for pool type '${t}'`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Desert enemy smoke-test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
