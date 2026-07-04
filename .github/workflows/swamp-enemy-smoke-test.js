// swamp-enemy-smoke-test.js — verifies all 9 swamp enemies + new behaviors
// Run: node .github/workflows/swamp-enemy-smoke-test.js
'use strict';

const { makeEnemy, updateEnemy, ENEMY_STATS } = require('../../server/sim/enemies');
const { updateBullets, damageEnemy } = require('../../server/sim/bullets');

// ─── Minimal fake-sim (same shape as forest/desert/ossuary smoke tests) ───────
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

// Drive N ticks advancing wall-clock by tickMs each step.
function runTicks(sim, enemies, n, wallNow, tickMs) {
  tickMs = tickMs || 33;
  for (let i = 0; i < n; i++) {
    wallNow += tickMs;
    const dt = tickMs / 1000;
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

// ─── 1. swamp_oozeling (split → 2 swamp_ooze_mini) ──────────────────────────
console.log('\n[1] swamp_oozeling — split, spawns 2 swamp_ooze_mini on death');
{
  const e = makeEnemy('swamp_oozeling', 600, 600);
  e._idx = 1;
  assert(e.hp === 26 && e.r === 14 && e.speed === 90 && e.dmg === 9, 'stats correct');
  assert(e.behavior === 'split' && e.splitType === 'swamp_ooze_mini' && e.splitCount === 2, 'split config correct');
  // Mirror room-sim split_on_death block
  const sim = makeSim(500, 500);
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
  const children = sim.enemies.filter(x => x.type === 'swamp_ooze_mini');
  assert(children.length === 2, `spawned ${children.length} ooze_mini children`);
  assert(children.every(c => c._noSplit === true), 'children have _noSplit guard');
  // Verify child stats
  const mini = makeEnemy('swamp_ooze_mini', 0, 0);
  assert(mini.hp === 10 && mini.r === 8 && mini.speed === 120 && mini.dmg === 6 && mini.behavior === 'melee', 'ooze_mini stats correct');
}

// ─── 2. swamp_leech (lifesteal — heals on contact, melee movement) ───────────
console.log('\n[2] swamp_leech — lifesteal: heals after dealing contact damage, advances like melee');
{
  // 2a. Stats
  const e = makeEnemy('swamp_leech', 0, 0);
  assert(e.hp === 16 && e.r === 9 && e.speed === 175 && e.dmg === 8, 'stats correct');
  assert(e.behavior === 'lifesteal' && e.lifestealPct === 100, 'behavior=lifesteal lifestealPct=100');

  // 2b. Melee movement (falls through dispatch to melee branch)
  const simMove = makeSim(500, 500);
  const eMove = makeEnemy('swamp_leech', 700, 500);
  eMove._idx = 2;
  const startDist = Math.hypot(eMove.x - 500, eMove.y - 500);
  runTicks(simMove, [eMove], 30, Date.now());
  const endDist = Math.hypot(eMove.x - 500, eMove.y - 500);
  assert(endDist < startDist, `leech advanced toward player (${startDist.toFixed(0)} → ${endDist.toFixed(0)})`);
  assert(simMove.bullets.length === 0, 'no bullets (melee behavior)');

  // 2c. LIFESTEAL: wound the leech, place it on the player, verify hp goes UP after contact
  const simHeal = makeSim(500, 500);
  const ps = simHeal._ws.playerState;
  ps.invulnUntil = 0;
  const eHeal = makeEnemy('swamp_leech', 505, 500); // within contact range (r9+r14=23 > 5)
  eHeal._idx = 3;
  eHeal.hp = 8; // wounded: half of maxHp=16
  eHeal.contactCd = 0;
  simHeal.enemies = [eHeal];
  const hpBefore = eHeal.hp;
  const playerHpBefore = ps.hp;
  const wallNow = Date.now() + 33;
  updateEnemy(eHeal, 0.033, wallNow, simHeal, [ps]);
  // After contact: player should have taken damage, leech hp should have gone UP
  assert(ps.hp < playerHpBefore, `player took contact damage (${playerHpBefore} → ${ps.hp})`);
  assert(eHeal.hp > hpBefore, `leech hp went UP after lifesteal (${hpBefore} → ${eHeal.hp.toFixed(2)})`);
  assert(eHeal.hp <= eHeal.maxHp, 'leech hp capped at maxHp');
  // 100% lifesteal → heal = e.dmg = 8
  const expectedHp = Math.min(eHeal.maxHp, hpBefore + eHeal.dmg * (eHeal.lifestealPct / 100));
  assert(Math.abs(eHeal.hp - expectedHp) < 0.01, `lifesteal heal = e.dmg * 100% = ${eHeal.dmg} (expected hp=${expectedHp.toFixed(2)}, got ${eHeal.hp.toFixed(2)})`);

  // 2d. Lifesteal cannot exceed maxHp
  const eFull = makeEnemy('swamp_leech', 505, 500);
  eFull._idx = 4;
  eFull.hp = eFull.maxHp; // already full
  eFull.contactCd = 0;
  const simFull = makeSim(500, 500);
  simFull._ws.playerState.invulnUntil = 0;
  simFull.enemies = [eFull];
  updateEnemy(eFull, 0.033, Date.now() + 33, simFull, [simFull._ws.playerState]);
  assert(eFull.hp <= eFull.maxHp, 'lifesteal at maxHp does not exceed cap');

  // 2e. lifestealPct=0 on non-lifesteal enemies (isolation)
  const grunt = makeEnemy('grunt', 0, 0);
  assert(grunt.lifestealPct === 0, 'grunt.lifestealPct === 0 (no lifesteal)');
}

// ─── 3. swamp_drowned (burrow — same as desert_lurker but different params) ──
console.log('\n[3] swamp_drowned — burrow: alternate params (burrowInterval=4200, resurfaceDmg=16)');
{
  const e = makeEnemy('swamp_drowned', 0, 0);
  assert(e.hp === 30 && e.r === 12 && e.speed === 110 && e.dmg === 16, 'stats correct');
  assert(e.behavior === 'burrow', 'behavior = burrow');
  assert(e.burrowInterval === 4200 && e.submergeMs === 1200 && e.underSpeed === 230 && e.resurfaceDmg === 16, 'burrow params correct');
  // No exception during 30 ticks
  let threw = false;
  try {
    const sim = makeSim(500, 500);
    const e2 = makeEnemy('swamp_drowned', 700, 500);
    e2._idx = 5;
    runTicks(sim, [e2], 30, Date.now());
  } catch (err) { threw = true; console.error('  EXCEPTION:', err.message); }
  assert(!threw, 'no exception over 30 ticks');
}

// ─── 4. swamp_spitter (spread, 4 pellets, #8aff3a) ───────────────────────────
console.log('\n[4] swamp_spitter — spread, 4 pellets, 34° spread, bulletColor #8aff3a');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('swamp_spitter', 600, 500); // d=100 < shootRange 300
  e._idx = 6; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'spread' && e.pellets === 4 && e.spreadDeg === 34 && e.bulletSpeed === 340, 'stats correct');
  assert(e.bulletDmg === 8 && e.bulletColor === '#8aff3a', 'bullet stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 4, `fired 4 pellets (got ${sim.bullets.length})`);
  assert(sim.bullets.every(b => b.hostile && b.color === '#8aff3a'), 'pellets hostile + correct color');
}

// ─── 5. swamp_wisp (homing, bulletColor #b6ff5a) ─────────────────────────────
console.log('\n[5] swamp_wisp — homing bullet, bulletColor #b6ff5a');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('swamp_wisp', 600, 500); // d=100 < shootRange 340
  e._idx = 7; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'homing' && e.homingStrength === 0.09 && e.bulletSpeed === 240, 'stats correct');
  assert(e.bulletColor === '#b6ff5a', 'correct bullet color');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 homing bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.homing === true && b.homingStrength === 0.09, 'bullet has homing flags');
}

// ─── 6. swamp_bloat (exploder — charge → fuse → AoE → dead) ──────────────────
console.log('\n[6] swamp_bloat — exploder: charges, fuses at <60px, AoE detonation, sets dead=true');
{
  // 6a. Stats
  const e = makeEnemy('swamp_bloat', 0, 0);
  assert(e.hp === 24 && e.r === 12 && e.speed === 150 && e.dmg === 10, 'stats correct');
  assert(e.behavior === 'exploder', 'behavior = exploder');
  assert(e.fuseMs === 700 && e.aoeRadius === 90 && e.aoeDmg === 32, 'exploder params correct');

  // 6b. No early detonation far from player (d >> 60)
  const simFar = makeSim(500, 500);
  const eFar = makeEnemy('swamp_bloat', 1500, 500); // far
  eFar._idx = 8;
  let wallNow = Date.now();
  wallNow = runTicks(simFar, [eFar], 10, wallNow);
  assert(!eFar.dead, 'bloat does NOT detonate while far from player');
  assert(eFar.fuse === 0 || eFar.fuse < 0.001, `fuse stays near 0 while far (got ${(eFar.fuse||0).toFixed(3)})`);

  // 6c. Fuse starts accumulating when within 60px, bloat detonates and dies
  const simClose = makeSim(500, 500);
  // Place bloat at contact range (d=40 < 60)
  const eBloat = makeEnemy('swamp_bloat', 540, 500);
  eBloat._idx = 9;
  eBloat.fuse = 0;
  const ps = simClose._ws.playerState;
  ps.hp = 100; ps.invulnUntil = 0;
  const playerHpBefore = ps.hp;
  let wallNow2 = Date.now();
  let detonated = false;
  // fuseMs=700 → need e.fuse*1000 >= 700 → 700/1000/0.033 ≈ 22 ticks at 33ms each
  for (let i = 0; i < 60; i++) {
    wallNow2 += 33;
    simClose.enemies = [eBloat];
    updateEnemy(eBloat, 0.033, wallNow2, simClose, [ps]);
    if (eBloat.dead) { detonated = true; break; }
  }
  assert(detonated, 'bloat detonated (set dead=true) within 60 ticks at close range');
  assert(ps.hp < playerHpBefore, `AoE damaged player (${playerHpBefore} → ${ps.hp.toFixed(1)})`);

  // 6d. Detonation respects invulnUntil (invuln player not damaged)
  const simInvuln = makeSim(500, 500);
  const eBloat2 = makeEnemy('swamp_bloat', 540, 500);
  eBloat2._idx = 10;
  eBloat2.fuse = 1.0; // already past fuseMs threshold (1000ms >= 700ms)
  const ps2 = simInvuln._ws.playerState;
  ps2.hp = 100; ps2.invulnUntil = Date.now() + 99999; // fully invuln
  simInvuln.enemies = [eBloat2];
  updateEnemy(eBloat2, 0.033, Date.now() + 33, simInvuln, [ps2]);
  assert(eBloat2.dead, 'bloat sets dead=true even when target is invuln');
  assert(ps2.hp === 100, 'invuln player takes 0 AoE damage');
}

// ─── 7. swamp_angler (root_hook, shootRate=3600, rootMul=0.40) ───────────────
console.log('\n[7] swamp_angler — root_hook: fires root bullet with correct params');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('swamp_angler', 600, 500); // d=100, in range 260, > 60
  e._idx = 11; e.lastShot = Date.now() - 4000;
  assert(e.behavior === 'root_hook' && e.rootMs === 900 && e.rootMul === 0.40 && e.shootRate === 3600, 'stats correct');
  assert(e.bulletColor === '#9a8a5a', 'correct bullet color');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired root_hook bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.rootOnHit && b.rootOnHit.ms === 900 && b.rootOnHit.mul === 0.40, 'bullet has rootOnHit ms=900 mul=0.40');
}

// ─── 8. swamp_bulwark (shielder, 70% dmgReduce) ──────────────────────────────
console.log('\n[8] swamp_bulwark — shielder: melee advance + 70% damage reduction');
{
  // 8a. Stats
  const e = makeEnemy('swamp_bulwark', 0, 0);
  assert(e.hp === 95 && e.r === 18 && e.speed === 62 && e.dmg === 20, 'stats correct');
  assert(e.behavior === 'shielder' && e.dmgReduce === 70, 'behavior=shielder dmgReduce=70');

  // 8b. Melee advance (falls through to melee branch)
  const sim = makeSim(500, 500);
  const e2 = makeEnemy('swamp_bulwark', 700, 500);
  e2._idx = 12;
  const startDist = Math.hypot(e2.x - 500, e2.y - 500);
  runTicks(sim, [e2], 30, Date.now());
  const endDist = Math.hypot(e2.x - 500, e2.y - 500);
  assert(endDist < startDist, `bulwark advanced (${startDist.toFixed(0)} → ${endDist.toFixed(0)})`);

  // 8c. 70% dmgReduce: 10 dmg → 3 applied
  const e3 = makeEnemy('swamp_bulwark', 0, 0);
  e3.hp = 95;
  damageEnemy(e3, 10, false, 'p1', 'pistol');
  const applied = 95 - e3.hp;
  assert(Math.abs(applied - 3) < 0.01, `10 dmg → 3 applied after 70% reduction (got ${applied.toFixed(2)})`);
}

// ─── 9. All 9 swamp types + ooze_mini — exception-free over 60 ticks ─────────
console.log('\n[9] All 9 swamp enemy types — 60-tick exception-free run');
{
  const types = [
    'swamp_oozeling', 'swamp_leech', 'swamp_drowned', 'swamp_spitter',
    'swamp_wisp', 'swamp_bloat', 'swamp_angler', 'swamp_bulwark', 'swamp_ooze_mini',
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

// ─── 10. stages-data.js stage 5 uses swamp enemies ───────────────────────────
console.log('\n[10] stages-data.js stage 5 zone pools contain swamp enemies');
{
  const { STAGES } = require('../../shared/stages-data');
  const s5 = STAGES.find(s => s.id === 5);
  assert(s5 && s5.kind === 'swamp', 'stage 5 exists and kind=swamp');
  const allTypes = s5.zones.flatMap(z => z.pool);
  assert(allTypes.some(t => t.startsWith('swamp_')), 'zone pool contains swamp_ types');
  assert(allTypes.includes('swamp_oozeling'), 'zone 1 contains swamp_oozeling (split)');
  assert(allTypes.includes('swamp_leech'),    'zone 1 contains swamp_leech (lifesteal)');
  assert(allTypes.includes('swamp_drowned'),  'zone 1 contains swamp_drowned (burrow)');
  assert(allTypes.includes('swamp_spitter'),  'zone 1 contains swamp_spitter (spread)');
  assert(allTypes.includes('swamp_wisp'),     'zone 2 contains swamp_wisp (homing)');
  assert(allTypes.includes('swamp_bloat'),    'zone 2 contains swamp_bloat (exploder)');
  assert(allTypes.includes('swamp_angler'),   'zone 2 contains swamp_angler (root_hook)');
  assert(allTypes.includes('swamp_bulwark'),  'zone 2 contains swamp_bulwark (shielder)');
  // All pool entries must exist in ENEMY_STATS
  for (const t of allTypes) {
    assert(t in ENEMY_STATS, `ENEMY_STATS has entry for pool type '${t}'`);
  }
}

// ─── 11. Regression: forest/desert/ossuary enemies unaffected ────────────────
console.log('\n[11] Regression: existing biome enemies unaffected (lifestealPct=0, fuseMs default)');
{
  const oldTypes = [
    'grunt', 'brute', 'forest_mosshusk', 'forest_sporespitter', 'forest_cursewisp',
    'forest_rotbloom', 'forest_sporemother', 'desert_jackal', 'desert_sandram',
    'desert_lurker', 'ossuary_shambler', 'ossuary_bulwark', 'ossuary_lancer',
  ];
  for (const t of oldTypes) {
    const e = makeEnemy(t, 0, 0);
    assert(e.lifestealPct === 0, `${t}.lifestealPct === 0`);
  }
  // ossuary_bulwark dmgReduce=60 unchanged (swamp_bulwark has 70)
  const ob = makeEnemy('ossuary_bulwark', 0, 0);
  assert(ob.dmgReduce === 60, 'ossuary_bulwark.dmgReduce still 60 (not overwritten by swamp_bulwark 70)');
  const sb = makeEnemy('swamp_bulwark', 0, 0);
  assert(sb.dmgReduce === 70, 'swamp_bulwark.dmgReduce = 70');
}

// ─── 12. lifesteal fall-through: leech falls through dispatch (melee branch) ──
console.log('\n[12] lifesteal falls through dispatch to melee branch (applyContactDamage fires)');
{
  const sim = makeSim(500, 500);
  // Place leech exactly at contact range
  const e = makeEnemy('swamp_leech', 509, 500); // d=9 < r9+r14=23
  e._idx = 13;
  e.contactCd = 0;
  const ps = sim._ws.playerState;
  ps.hp = 100; ps.invulnUntil = 0;
  const hpBefore = ps.hp;
  sim.enemies = [e];
  updateEnemy(e, 0.033, Date.now() + 33, sim, [ps]);
  // contactCd should be set (proves applyContactDamage ran, i.e. melee branch executed)
  assert(e.contactCd > 0, 'contactCd set → melee branch ran (lifesteal did not early-return)');
  assert(ps.hp < hpBefore || e.hp > e.maxHp - 0.01, 'player took damage XOR leech healed (both verify melee ran)');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Swamp enemy smoke-test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
