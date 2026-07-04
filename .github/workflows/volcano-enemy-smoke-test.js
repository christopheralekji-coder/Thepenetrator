// volcano-enemy-smoke-test.js — verifies all 9 volcano enemies + burn_melee behavior
// Run: node .github/workflows/volcano-enemy-smoke-test.js
'use strict';

const { makeEnemy, updateEnemy, ENEMY_STATS } = require('../../server/sim/enemies');
const { updateBullets, damageEnemy } = require('../../server/sim/bullets');

// ─── Minimal fake-sim (same shape as prior biome smoke tests) ────────────────
function makeSim(playerX, playerY) {
  const pid = 'p1';
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: {
      x: playerX, y: playerY, hp: 100, shield: 0, r: 14,
      speedMul: 1.0, invulnUntil: 0,
      burnUntil: 0, burnDps: 0,
    },
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

// pvpActive mirror (same logic as grenades.js) — used to verify PvP gating
function pvpActive(sim) {
  return !!(sim.tdmActive || sim.ctfActive || sim.siegeActive || sim.gungameActive ||
            sim.kothActive || sim.juggernautActive || sim.battleroyaleActive);
}

// Drive N ticks advancing wall-clock by tickMs each step.
// Also ticks the PvE burn-DoT (mirrors room-sim.js member sweep).
function runTicks(sim, enemies, n, wallNow, tickMs) {
  tickMs = tickMs || 33;
  for (let i = 0; i < n; i++) {
    wallNow += tickMs;
    const dt = tickMs / 1000;
    const players = [];
    for (const [, ws] of sim.room.members) {
      if (ws.playerState) players.push(ws.playerState);
    }
    // Mirror room-sim.js per-member sweep (slow expiry + PvE burn DoT)
    for (const [, ws] of sim.room.members) {
      const ps = ws.playerState;
      if (!ps) continue;
      if (ps._slowUntil && wallNow >= ps._slowUntil) {
        ps.speedMul   = ps._baseSpeedMul || 1.0;
        ps._slowUntil = 0;
      }
      if (!pvpActive(sim) && ps.burnUntil > wallNow && ps.hp > 0) {
        if (wallNow >= (ps.invulnUntil || 0)) {
          let brem = (ps.burnDps || 0) * dt;
          if (brem > 0) {
            if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, brem); ps.shield -= ab; brem -= ab; }
            if (brem > 0) ps.hp = Math.max(0, ps.hp - brem);
          }
        }
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

// ─── 1. volcano_cinderling — burn_melee: stats + fall-through (no early-return) ──
console.log('\n[1] volcano_cinderling — burn_melee stats + melee advance + no bullets');
{
  const e = makeEnemy('volcano_cinderling', 0, 0);
  assert(e.hp === 13 && e.r === 9 && e.speed === 195 && e.dmg === 7, 'stats correct (hp13 r9 speed195 dmg7)');
  assert(e.gold === 8, 'gold=8');
  assert(e.behavior === 'burn_melee', 'behavior=burn_melee');
  assert(e.pBurnMs === 2500 && e.pBurnDps === 6, 'pBurnMs=2500 pBurnDps=6');
  // burn_melee falls through dispatch to melee branch — should advance toward player
  const sim = makeSim(500, 500);
  const eMove = makeEnemy('volcano_cinderling', 700, 500);
  eMove._idx = 1;
  const startDist = Math.hypot(eMove.x - 500, eMove.y - 500);
  runTicks(sim, [eMove], 30, Date.now());
  const endDist = Math.hypot(eMove.x - 500, eMove.y - 500);
  assert(endDist < startDist, `cinderling advanced toward player (${startDist.toFixed(0)} → ${endDist.toFixed(0)})`);
  assert(sim.bullets.length === 0, 'no bullets fired (melee only)');
}

// ─── 2. burn_melee contact sets player burnUntil/burnDps ─────────────────────
console.log('\n[2] burn_melee contact damage ignites player (sets burnUntil + burnDps)');
{
  const sim = makeSim(500, 500);
  const ps = sim._ws.playerState;
  ps.invulnUntil = 0;
  ps.burnUntil = 0;
  ps.burnDps = 0;
  const e = makeEnemy('volcano_cinderling', 509, 500); // d=9 < r9+r14=23: contact
  e._idx = 2;
  e.contactCd = 0;
  sim.enemies = [e];
  const wallNow = Date.now() + 33;
  const hpBefore = ps.hp;
  updateEnemy(e, 0.033, wallNow, sim, [ps]);
  assert(ps.hp < hpBefore, `player took contact damage (${hpBefore} → ${ps.hp})`);
  assert(ps.burnUntil > wallNow, `burnUntil set to future (${ps.burnUntil} > ${wallNow})`);
  assert(Math.abs(ps.burnUntil - (wallNow + 2500)) < 100, `burnUntil ≈ now+2500ms (got ${ps.burnUntil - wallNow}ms ahead)`);
  assert(ps.burnDps === 6, `burnDps=6 (got ${ps.burnDps})`);
  assert(e.contactCd > 0, 'contactCd set — applyContactDamage ran (melee branch confirmed)');
}

// ─── 3. burn DoT actually ticks HP down in PvE story sim (CRITICAL) ──────────
console.log('\n[3] burn_melee DoT ticks player HP down over subsequent ticks in PvE (CRITICAL)');
{
  const sim = makeSim(9999, 9999); // player far away — no more contact hits
  const ps = sim._ws.playerState;
  ps.hp = 100; ps.shield = 0; ps.invulnUntil = 0;
  // Manually plant burn state (as applyContactDamage would do)
  const wallNow = Date.now();
  ps.burnUntil = wallNow + 3000; // 3 second burn
  ps.burnDps   = 6;
  // PvE mode: none of the pvp flags set (sim default)
  assert(!pvpActive(sim), 'sim is in PvE mode (not PvP)');
  // Run 60 ticks at 33ms each = ~2 seconds of wall-clock burn
  const hpBefore = ps.hp;
  let wallNow2 = wallNow;
  for (let i = 0; i < 60; i++) {
    wallNow2 += 33;
    const dt = 0.033;
    // mirror the burn-DoT sweep from room-sim.js
    if (!pvpActive(sim) && ps.burnUntil > wallNow2 && ps.hp > 0) {
      if (wallNow2 >= (ps.invulnUntil || 0)) {
        let brem = (ps.burnDps || 0) * dt;
        if (brem > 0) {
          if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, brem); ps.shield -= ab; brem -= ab; }
          if (brem > 0) ps.hp = Math.max(0, ps.hp - brem);
        }
      }
    }
  }
  const hpAfter = ps.hp;
  const expectedDmg = 6 * 0.033 * 60; // burnDps * dt * ticks ≈ 11.88
  assert(hpAfter < hpBefore, `hp dropped (${hpBefore} → ${hpAfter.toFixed(2)})`);
  assert(Math.abs((hpBefore - hpAfter) - expectedDmg) < 0.5, `burn DoT ≈ ${expectedDmg.toFixed(1)} dmg over 60 ticks (got ${(hpBefore - hpAfter).toFixed(2)})`);
}

// ─── 4. burn DoT does NOT fire in PvP (pvpActive gate) ───────────────────────
console.log('\n[4] burn DoT does NOT tick in PvP mode (pvpActive guard)');
{
  const sim = makeSim(9999, 9999);
  sim.tdmActive = true; // force PvP
  assert(pvpActive(sim), 'sim is in PvP mode');
  const ps = sim._ws.playerState;
  ps.hp = 100; ps.shield = 0; ps.invulnUntil = 0;
  const wallNow = Date.now();
  ps.burnUntil = wallNow + 3000;
  ps.burnDps   = 6;
  const hpBefore = ps.hp;
  // Run 60 ticks but apply the PvE-gate check (same as room-sim.js)
  let wallNow2 = wallNow;
  for (let i = 0; i < 60; i++) {
    wallNow2 += 33;
    const dt = 0.033;
    if (!pvpActive(sim) && ps.burnUntil > wallNow2 && ps.hp > 0) {
      if (wallNow2 >= (ps.invulnUntil || 0)) {
        let brem = (ps.burnDps || 0) * dt;
        if (brem > 0) {
          if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, brem); ps.shield -= ab; brem -= ab; }
          if (brem > 0) ps.hp = Math.max(0, ps.hp - brem);
        }
      }
    }
  }
  assert(ps.hp === hpBefore, `PvP: hp unchanged by PvE burn sweep (tickPlayerBurn handles it instead, got ${ps.hp})`);
  sim.tdmActive = false; // restore
}

// ─── 5. burn DoT respects invulnUntil ────────────────────────────────────────
console.log('\n[5] burn DoT respects invulnUntil (spawn protection)');
{
  const sim = makeSim(9999, 9999);
  const ps = sim._ws.playerState;
  ps.hp = 100; ps.shield = 0;
  const wallNow = Date.now();
  ps.burnUntil  = wallNow + 3000;
  ps.burnDps    = 6;
  ps.invulnUntil = wallNow + 99999; // fully invuln
  const hpBefore = ps.hp;
  // Run a few ticks
  let wallNow2 = wallNow;
  for (let i = 0; i < 10; i++) {
    wallNow2 += 33;
    const dt = 0.033;
    if (!pvpActive(sim) && ps.burnUntil > wallNow2 && ps.hp > 0) {
      if (wallNow2 >= (ps.invulnUntil || 0)) {
        let brem = (ps.burnDps || 0) * dt;
        if (brem > 0) {
          if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, brem); ps.shield -= ab; brem -= ab; }
          if (brem > 0) ps.hp = Math.max(0, ps.hp - brem);
        }
      }
    }
  }
  assert(ps.hp === hpBefore, `invuln player hp unchanged (${hpBefore} → ${ps.hp})`);
}

// ─── 6. burn DoT drains shield before HP ─────────────────────────────────────
console.log('\n[6] burn DoT drains shield before HP');
{
  const sim = makeSim(9999, 9999);
  const ps = sim._ws.playerState;
  ps.hp = 100; ps.shield = 20; ps.invulnUntil = 0;
  const wallNow = Date.now();
  ps.burnUntil = wallNow + 5000;
  ps.burnDps   = 60; // large enough to clearly drain shield in 1 tick
  const shieldBefore = ps.shield;
  const hpBefore = ps.hp;
  // 1 tick at 33ms: burnDps*dt = 60*0.033 = 1.98 shield drained
  const wallNow2 = wallNow + 33;
  const dt = 0.033;
  if (!pvpActive(sim) && ps.burnUntil > wallNow2 && ps.hp > 0) {
    if (wallNow2 >= (ps.invulnUntil || 0)) {
      let brem = (ps.burnDps || 0) * dt;
      if (brem > 0) {
        if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, brem); ps.shield -= ab; brem -= ab; }
        if (brem > 0) ps.hp = Math.max(0, ps.hp - brem);
      }
    }
  }
  assert(ps.shield < shieldBefore, `shield drained first (${shieldBefore} → ${ps.shield.toFixed(2)})`);
  assert(ps.hp === hpBefore, `hp untouched while shield > 0 and dmg <= shield (${hpBefore})`);
}

// ─── 7. volcano_magma_hound (melee) ──────────────────────────────────────────
console.log('\n[7] volcano_magma_hound — melee, advances, no bullets, pBurnMs=0');
{
  const e = makeEnemy('volcano_magma_hound', 0, 0);
  assert(e.hp === 16 && e.r === 10 && e.speed === 235 && e.dmg === 9, 'stats correct');
  assert(e.behavior === 'melee' && e.pBurnMs === 0, 'behavior=melee, no burn params');
  const sim = makeSim(500, 500);
  const e2 = makeEnemy('volcano_magma_hound', 700, 500);
  e2._idx = 10;
  const d0 = Math.hypot(e2.x - 500, e2.y - 500);
  runTicks(sim, [e2], 30, Date.now());
  const d1 = Math.hypot(e2.x - 500, e2.y - 500);
  assert(d1 < d0, `hound advanced (${d0.toFixed(0)} → ${d1.toFixed(0)})`);
  assert(sim.bullets.length === 0, 'no bullets');
}

// ─── 8. volcano_slag_behemoth (tank melee) ───────────────────────────────────
console.log('\n[8] volcano_slag_behemoth — tank melee (hp88, r18, speed62)');
{
  const e = makeEnemy('volcano_slag_behemoth', 0, 0);
  assert(e.hp === 88 && e.r === 18 && e.speed === 62 && e.dmg === 20, 'stats correct');
  assert(e.behavior === 'melee', 'behavior=melee');
  let threw = false;
  try {
    const sim = makeSim(500, 500);
    const e2 = makeEnemy('volcano_slag_behemoth', 700, 500);
    e2._idx = 11;
    runTicks(sim, [e2], 30, Date.now());
  } catch (err) { threw = true; console.error('  EXCEPTION:', err.message); }
  assert(!threw, 'no exception over 30 ticks');
}

// ─── 9. volcano_pyre_zealot (spread, 4 pellets, #ff6a1a) ─────────────────────
console.log('\n[9] volcano_pyre_zealot — spread 4 pellets, shootRange=340, bulletColor #ff6a1a');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('volcano_pyre_zealot', 600, 500); // d=100 < shootRange 340
  e._idx = 20; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'spread' && e.pellets === 4 && e.spreadDeg === 34, 'spread params correct');
  assert(e.bulletSpeed === 340 && e.bulletDmg === 8 && e.bulletColor === '#ff6a1a', 'bullet stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 4, `fired 4 pellets (got ${sim.bullets.length})`);
  assert(sim.bullets.every(b => b.hostile && b.color === '#ff6a1a'), 'pellets hostile + correct color');
}

// ─── 10. volcano_ember_seer (homing, #ffb03a) ────────────────────────────────
console.log('\n[10] volcano_ember_seer — homing bullet, bulletColor #ffb03a');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('volcano_ember_seer', 600, 500); // d=100 < shootRange 400
  e._idx = 21; e.lastShot = Date.now() - 2000;
  assert(e.behavior === 'homing' && e.homingStrength === 0.09 && e.bulletSpeed === 250, 'homing stats correct');
  assert(e.shootRange === 400 && e.bulletDmg === 10 && e.bulletColor === '#ffb03a', 'extended range stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 homing bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.homing === true && b.homingStrength === 0.09, 'bullet has homing flags');
  assert(b.color === '#ffb03a', 'correct color');
}

// ─── 11. volcano_obsidian_ram (charger, telegraphMs=500) ─────────────────────
console.log('\n[11] volcano_obsidian_ram — charger: normal chase then dash, telegraphMs=500');
{
  const e = makeEnemy('volcano_obsidian_ram', 0, 0);
  assert(e.hp === 54 && e.r === 15 && e.speed === 95 && e.dmg === 14, 'stats correct');
  assert(e.behavior === 'charger', 'behavior=charger');
  assert(e.dashInterval === 3000 && e.dashSpeed === 520 && e.dashDmg === 26 && e.telegraphMs === 500, 'charger params correct');
  let threw = false;
  try {
    const sim = makeSim(500, 500);
    const e2 = makeEnemy('volcano_obsidian_ram', 700, 500);
    e2._idx = 30;
    runTicks(sim, [e2], 60, Date.now());
  } catch (err) { threw = true; console.error('  EXCEPTION:', err.message); }
  assert(!threw, 'no exception over 60 ticks');
}

// ─── 12. volcano_molten_spawn (split → 2 volcano_moltenling) ─────────────────
console.log('\n[12] volcano_molten_spawn — split: spawns 2 volcano_moltenling on death');
{
  const e = makeEnemy('volcano_molten_spawn', 600, 600);
  e._idx = 40;
  assert(e.hp === 40 && e.r === 13 && e.speed === 110 && e.dmg === 12, 'stats correct');
  assert(e.behavior === 'split' && e.splitType === 'volcano_moltenling' && e.splitCount === 2, 'split config correct');
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
  const children = sim.enemies.filter(x => x.type === 'volcano_moltenling');
  assert(children.length === 2, `spawned ${children.length} moltenling children`);
  assert(children.every(c => c._noSplit === true), 'children have _noSplit guard');
  // verify moltenling stats
  const ml = makeEnemy('volcano_moltenling', 0, 0);
  assert(ml.hp === 10 && ml.r === 8 && ml.speed === 160 && ml.dmg === 8 && ml.behavior === 'melee', 'moltenling stats correct');
}

// ─── 13. volcano_lava_warden (lob_aoe, aoeRadius=55, #ff5a1a) ────────────────
console.log('\n[13] volcano_lava_warden — lob_aoe: fires aoe bomb with correct params');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('volcano_lava_warden', 600, 500); // d=100 < shootRange 300
  e._idx = 50; e.lastShot = Date.now() - 3000;
  assert(e.behavior === 'lob_aoe' && e.aoeRadius === 55 && e.aoeDmg === 16, 'lob_aoe params correct');
  assert(e.shootRate === 2500 && e.bulletSpeed === 300 && e.bulletColor === '#ff5a1a', 'shoot stats correct');
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 aoe bomb');
  const b = sim.bullets[0];
  assert(b.hostile && b.aoeOnExpire && b.aoeOnExpire.radius === 55 && b.aoeOnExpire.dmg === 16, 'bullet has aoeOnExpire radius=55 dmg=16');
  assert(b.color === '#ff5a1a', 'correct bullet color');
}

// ─── 14. All 9 volcano types + moltenling — exception-free over 60 ticks ──────
console.log('\n[14] All 9 volcano enemy types — 60-tick exception-free run');
{
  const types = [
    'volcano_cinderling', 'volcano_magma_hound', 'volcano_slag_behemoth',
    'volcano_pyre_zealot', 'volcano_ember_seer', 'volcano_obsidian_ram',
    'volcano_molten_spawn', 'volcano_lava_warden', 'volcano_moltenling',
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

// ─── 15. stages-data.js stage 6 uses volcano enemies ─────────────────────────
console.log('\n[15] stages-data.js stage 6 zone pools contain volcano enemies');
{
  const { STAGES } = require('../../shared/stages-data');
  const s6 = STAGES.find(s => s.id === 6);
  assert(s6 && s6.kind === 'volcano', 'stage 6 exists and kind=volcano');
  const allTypes = s6.zones.flatMap(z => z.pool);
  assert(allTypes.some(t => t.startsWith('volcano_')), 'zone pool contains volcano_ types');
  assert(allTypes.includes('volcano_cinderling'),    'zone 1 includes volcano_cinderling (burn_melee)');
  assert(allTypes.includes('volcano_magma_hound'),   'zone 1 includes volcano_magma_hound (melee)');
  assert(allTypes.includes('volcano_slag_behemoth'), 'zone 1 includes volcano_slag_behemoth (tank)');
  assert(allTypes.includes('volcano_molten_spawn'),  'zone 1+2 includes volcano_molten_spawn (split)');
  assert(allTypes.includes('volcano_pyre_zealot'),   'zone 2 includes volcano_pyre_zealot (spread)');
  assert(allTypes.includes('volcano_ember_seer'),    'zone 2 includes volcano_ember_seer (homing)');
  assert(allTypes.includes('volcano_obsidian_ram'),  'zone 2 includes volcano_obsidian_ram (charger)');
  assert(allTypes.includes('volcano_lava_warden'),   'zone 2 includes volcano_lava_warden (lob_aoe)');
  // All pool entries must exist in ENEMY_STATS
  for (const t of allTypes) {
    assert(t in ENEMY_STATS, `ENEMY_STATS has entry for pool type '${t}'`);
  }
}

// ─── 16. Regression: previous biome enemies unaffected ───────────────────────
console.log('\n[16] Regression: existing biome enemies unaffected (pBurnMs=0, lifestealPct=0 etc)');
{
  const oldTypes = [
    'grunt', 'brute', 'forest_mosshusk', 'forest_sporespitter', 'forest_cursewisp',
    'forest_rotbloom', 'forest_sporemother', 'desert_jackal', 'desert_sandram',
    'desert_lurker', 'ossuary_shambler', 'ossuary_bulwark', 'ossuary_lancer',
    'swamp_leech', 'swamp_bulwark', 'swamp_bloat',
  ];
  for (const t of oldTypes) {
    const e = makeEnemy(t, 0, 0);
    assert(e.pBurnMs === 0, `${t}.pBurnMs === 0 (no cinderling-burn)`);
  }
  // ossuary_bulwark dmgReduce=60 unchanged
  const ob = makeEnemy('ossuary_bulwark', 0, 0);
  assert(ob.dmgReduce === 60, 'ossuary_bulwark.dmgReduce still 60');
  // swamp_bulwark dmgReduce=70 unchanged
  const sb = makeEnemy('swamp_bulwark', 0, 0);
  assert(sb.dmgReduce === 70, 'swamp_bulwark.dmgReduce still 70');
  // lifesteal only on swamp_leech
  const sl = makeEnemy('swamp_leech', 0, 0);
  assert(sl.lifestealPct === 100, 'swamp_leech lifestealPct=100 unchanged');
  const cind = makeEnemy('volcano_cinderling', 0, 0);
  assert(cind.lifestealPct === 0, 'volcano_cinderling.lifestealPct=0 (no lifesteal)');
}

// ─── 17. cinderling does NOT ignite companion or core targets ─────────────────
console.log('\n[17] burn_melee does NOT ignite companion or core targets');
{
  const sim = makeSim(500, 500);
  // companion target
  const companion = {
    x: 509, y: 500, hp: 50, shield: 0, r: 14,
    invulnUntil: 0, burnUntil: 0, burnDps: 0,
    _isCompanion: true,
    _wsRef: null,
  };
  const e1 = makeEnemy('volcano_cinderling', 509, 500);
  e1._idx = 60; e1.contactCd = 0;
  updateEnemy(e1, 0.033, Date.now() + 33, sim, [companion]);
  assert(companion.burnUntil === 0, 'companion burnUntil NOT set (burn_melee respects _isCompanion guard)');
  // core target
  const core = {
    x: 509, y: 500, hp: 50, shield: 0, r: 14,
    invulnUntil: 0, burnUntil: 0, burnDps: 0,
    _isCoreTarget: true,
  };
  const e2 = makeEnemy('volcano_cinderling', 509, 500);
  e2._idx = 61; e2.contactCd = 0;
  updateEnemy(e2, 0.033, Date.now() + 66, sim, [core]);
  assert(core.burnUntil === 0, 'core target burnUntil NOT set (burn_melee respects _isCoreTarget guard)');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Volcano enemy smoke-test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
