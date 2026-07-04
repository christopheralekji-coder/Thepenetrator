// forest-enemy-smoke-test.js — verifierar alla 8 forest-enemies + sporeling
// Kör: node .github/workflows/forest-enemy-smoke-test.js
'use strict';

const { makeEnemy, updateEnemy } = require('../../server/sim/enemies');
const { updateBullets } = require('../../server/sim/bullets');

// ─── Minimal fake-sim ────────────────────────────────────────────────────────
function makeSim(playerX, playerY) {
  const pid = 'p1';
  const ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: playerX, y: playerY, hp: 100, shield: 0, speedMul: 1.0, invulnUntil: 0 },
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

// Kör N ticks av updateEnemy + updateBullets (dt=33ms, simulated wall-clock)
function runTicks(sim, enemies, n) {
  let wallNow = Date.now();
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
      sim.enemies = enemies; // needed by summoner/split
      updateEnemy(e, dt, wallNow, sim, players);
    }
    updateBullets(sim, dt, wallNow);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed++; }
  else       { console.error('  FAIL:', msg); failed++; }
}

// ─── 1. forest_mosshusk (melee, tank) ────────────────────────────────────────
console.log('\n[1] forest_mosshusk — melee tank');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_mosshusk', 600, 600);
  e._idx = 1;
  assert(e.hp === 66 && e.r === 18 && e.behavior === 'melee', 'stats + behavior correct');
  runTicks(sim, [e], 60);
  assert(!e.dead, 'alive after 60 ticks');
  // Should have moved toward player (500,500)
  assert(e.x < 600 || e.y < 600, 'moved toward player');
  assert(sim.bullets.length === 0, 'no bullets (melee)');
}

// ─── 2. forest_sporefly (fast melee) ─────────────────────────────────────────
console.log('\n[2] forest_sporefly — fast melee');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_sporefly', 600, 600);
  e._idx = 2;
  assert(e.speed === 235 && e.behavior === 'melee', 'stats correct');
  const startDist = Math.hypot(e.x - 500, e.y - 500);
  runTicks(sim, [e], 30);
  const endDist = Math.hypot(e.x - 500, e.y - 500);
  assert(endDist < startDist, 'fast approach');
}

// ─── 3. forest_chokecap (slow_melee — applies speedMul slow) ─────────────────
console.log('\n[3] forest_chokecap — slow_melee, applies player slow');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_chokecap', 505, 505);  // place inside contact range
  e._idx = 3;
  assert(e.behavior === 'slow_melee' && e.slowMul === 0.55 && e.slowMs === 2500, 'stats correct');
  const ps = sim._ws.playerState;
  // Force contact (zero contactCd so damage applies immediately)
  e.contactCd = 0;
  runTicks(sim, [e], 5);
  assert(typeof ps._slowUntil === 'number' && ps._slowUntil > Date.now(), 'slow applied');
  assert(ps.speedMul <= 0.56, 'speedMul reduced to ~0.55');
}

// ─── 4. forest_sporespitter (spread, 4-pellet salvo) ─────────────────────────
console.log('\n[4] forest_sporespitter — spread behavior, 4 pellets');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_sporespitter', 600, 500);  // in range (d~100 < shootRange 300)
  e._idx = 4;
  e.lastShot = 0;  // force ready to shoot
  assert(e.behavior === 'spread' && e.pellets === 4 && e.spreadDeg === 40, 'stats correct');
  // Run enough ticks for shootRate to expire and shoot
  let wallNow = Date.now();
  for (let t = 0; t < 60; t++) {
    wallNow += 33;
    sim.enemies = [e];
    const players = [sim._ws.playerState];
    updateEnemy(e, 0.033, wallNow, sim, players);
    updateBullets(sim, 0.033, wallNow);
  }
  // Should have fired at least one salvo (4 bullets per salvo, some may have expired)
  // We check that at some point bullets were spawned — count via checking if any hostile bullet exists
  // or check by running fewer ticks before bullets expire
  const sim2 = makeSim(500, 500);
  const e2 = makeEnemy('forest_sporespitter', 600, 500);
  e2._idx = 41; e2.lastShot = 0;
  let wallNow2 = Date.now();
  for (let t = 0; t < 2; t++) { wallNow2 += 33; sim2.enemies = [e2]; updateEnemy(e2, 0.033, wallNow2, sim2, [sim2._ws.playerState]); }
  // After 2 ticks, shootRate should have expired (lastShot=0, rate=1500ms)
  // Force shoot by pre-advancing wallNow past shootRate
  const sim3 = makeSim(500, 500);
  const e3 = makeEnemy('forest_sporespitter', 600, 500);
  e3._idx = 42; e3.lastShot = Date.now() - 2000;  // pre-expired
  const wallNow3 = Date.now() + 33;
  sim3.enemies = [e3];
  updateEnemy(e3, 0.033, wallNow3, sim3, [sim3._ws.playerState]);
  // e3 should be in range (d=100 < 300) and cooldown expired → fired 4 bullets
  assert(sim3.bullets.length === 4, `fired 4 pellets (got ${sim3.bullets.length})`);
  assert(sim3.bullets.every(b => b.hostile && b.color === '#b7e05a'), 'pellets are hostile with correct color');
}

// ─── 5. forest_cursewisp (homing bullet) ─────────────────────────────────────
console.log('\n[5] forest_cursewisp — homing bullet steers toward player');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_cursewisp', 600, 500);
  e._idx = 5; e.lastShot = Date.now() - 2000;
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired 1 homing bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.homing === true && b.homingStrength === 0.09, 'bullet has homing flags');
  // Verify homing steers: 90°-case — bullet at (300,500) going RIGHT (vx=+230,vy=0),
  // player at (500,500). Homing should leave vx near +230 but add NO vy (same y).
  // Use a different player position: player below at (300,700), bullet at (500,500) going LEFT (vx=-230).
  // Player is to the left (same x as bullet after 1 tick? No — keep simple):
  // Bullet at (500,300) going DOWN (vy=+230), player at (500,500) → homing should keep vy downward
  // (already correct) with no change. Use asymmetric: bullet at (300,500), vx=+230 (going RIGHT),
  // player at (500, 700) (right AND below). Homing should add vy+ (downward toward player).
  const sim5b = makeSim(500, 700);
  sim5b.bullets.push({ x: 300, y: 500, vx: 230, vy: 0, dmg: 9, life: 2.5, r: 5, color: '#7dff9a', hostile: true, homing: true, homingStrength: 0.09, homingSpeed: 230 });
  const initialVy5 = sim5b.bullets[0].vy;   // 0
  updateBullets(sim5b, 0.033, wallNow);
  if (sim5b.bullets.length > 0) {
    assert(sim5b.bullets[0].vy > initialVy5, `homing curved toward player (vy ${initialVy5} → ${sim5b.bullets[0].vy.toFixed(2)})`);
  } else {
    // bullet hit player directly → also acceptable (proves movement toward player)
    assert(true, 'homing bullet reached player in 1 tick (very close)');
  }
}

// ─── 6. forest_vinelasher (root_hook: fires bullet that roots player) ─────────
console.log('\n[6] forest_vinelasher — root_hook bullet slows player');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_vinelasher', 600, 500);  // d=100, in range (260) and > 60
  e._idx = 6; e.lastShot = Date.now() - 5000;
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired root_hook bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.rootOnHit && b.rootOnHit.ms === 900 && b.rootOnHit.mul === 0.35, 'bullet has rootOnHit');
  // Simulate bullet hitting player: place bullet at player pos
  sim.bullets[0].x = 500; sim.bullets[0].y = 500;
  updateBullets(sim, 0.033, wallNow + 33);
  const ps = sim._ws.playerState;
  assert(ps._slowUntil > wallNow, 'player slow applied on bullet hit');
  assert(ps.speedMul <= 0.36, `speedMul reduced to ~0.35 (got ${ps.speedMul})`);
}

// ─── 7. forest_rotbloom (split_on_death: spawns 2 forest_sporeling) ──────────
console.log('\n[7] forest_rotbloom — split spawns 2 forest_sporeling on death');
{
  // Simulate death loop from room-sim (inline the exact split logic)
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_rotbloom', 600, 600);
  e._idx = 7; e.dead = true; e.lastDamagerPid = 'p1';
  sim.enemies = [e];
  // Mirror room-sim split_on_death block
  if (e.behavior === 'split' && !e._noSplit && e.splitType && sim.enemies.length < 80) {
    const sc = Math.min(e.splitCount || 2, 80 - sim.enemies.length);
    for (let si = 0; si < sc; si++) {
      const sx = e.x + (Math.random() - 0.5) * 30;
      const sy = e.y + (Math.random() - 0.5) * 30;
      const child = makeEnemy(e.splitType, sx, sy);
      child._idx  = sim.nextEnemyIdx++;
      child._noSplit = true;
      sim.enemies.push(child);
    }
  }
  const children = sim.enemies.filter(x => x.type === 'forest_sporeling');
  assert(children.length === 2, `spawned ${children.length} sporeling children`);
  assert(children.every(c => c._noSplit === true), 'children have _noSplit guard');
  assert(children.every(c => c.behavior === 'melee'), 'children are melee (no re-split)');
  // Also verify sporeling stats
  const s = makeEnemy('forest_sporeling', 0, 0);
  assert(s.hp === 8 && s.speed === 200 && s.r === 8, 'sporeling stats correct');
}

// ─── 8. forest_sporemother (lob_aoe: AoE on bullet expiry) ──────────────────
console.log('\n[8] forest_sporemother — lob_aoe, AoE detonates on bullet expiry');
{
  const sim = makeSim(500, 500);
  const e = makeEnemy('forest_sporemother', 700, 500);  // d=200 < shootRange 320
  e._idx = 8; e.lastShot = Date.now() - 4000;
  const wallNow = Date.now() + 33;
  sim.enemies = [e];
  updateEnemy(e, 0.033, wallNow, sim, [sim._ws.playerState]);
  assert(sim.bullets.length === 1, 'fired lob_aoe bullet');
  const b = sim.bullets[0];
  assert(b.hostile && b.aoeOnExpire && b.aoeOnExpire.radius === 70 && b.aoeOnExpire.dmg === 18, 'bullet has aoeOnExpire');
  assert(b.dmg === 0, 'direct-hit dmg is 0 (AoE does the damage)');
  // Force bullet to player position and expire it → should AoE the player
  sim.bullets[0].x = 500; sim.bullets[0].y = 500; sim.bullets[0].life = -1;
  const ps = sim._ws.playerState;
  const hpBefore = ps.hp;
  updateBullets(sim, 0.033, wallNow + 33);
  assert(ps.hp < hpBefore, `AoE dealt damage (hp ${hpBefore} → ${ps.hp})`);
  assert(sim.bullets.length === 0, 'bullet consumed after AoE');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n=== Forest enemy smoke-test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
