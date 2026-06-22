'use strict';
// CASTLE DEFENSE v2 REDESIGN — comprehensive server smoke.
// Pathing (south->castle), build (field + slot-only towers), upgrade 1/max, gate
// open/close, slot-tower sit-in, NPC/throne upgrade (castle HP), powder-barrel
// shoot-to-detonate + fire trail, castle-HP damage model.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim, applyCastleDefenseBuild, applyCastleDefenseUpgrade,
  applyCastleDefenseGate, applyCastleDefenseEnterTower, applyCastleDefenseExitTower,
  applyCastleDefenseNpcUpgrade } = RS;
const { CASTLEDEFENSE_ARENA: A } = require('../shared/castledefense-arena');

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'CD2', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100;
  sim.castledefenseGold['p0'] = 9999999;
  return { sim, p0 };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }

// 0. PATHING — enemies spawn SOUTH, march NORTH toward the castle, never clip walls
{
  const { sim } = mk();
  sim.castledefenseWaveBetweenEndAt = Date.now() - 1;
  for (let i = 0; i < 30 && sim.enemies.length === 0; i++) step(sim);
  assert(sim.enemies.length > 0 && sim.enemies.every(e => e.y > 3000), 'enemies spawn in the south');
  const g0 = sim.enemies.filter(e => !e._cdFlyer && !e.dead);
  const y0 = g0.reduce((s, e) => s + e.y, 0) / Math.max(1, g0.length);
  for (let i = 0; i < 200; i++) step(sim);
  const g1 = sim.enemies.filter(e => !e._cdFlyer && !e.dead);
  const y1 = g1.reduce((s, e) => s + e.y, 0) / Math.max(1, g1.length);
  assert(y1 < y0 - 50, 'enemies marched NORTH (flow-field): ' + Math.round(y0) + '->' + Math.round(y1));
  function inside(x, y, r) { return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h; }
  let clip = 0;
  for (const e of sim.enemies) { if (e.dead || e._cdFlyer) continue; for (const w of sim.castledefenseCastleWalls) if (inside(e.x, e.y, w)) { clip++; break; } }
  assert(clip === 0, clip + ' enemies clipped into castle walls');
  console.log('[OK] pathing: south->north march (' + Math.round(y0) + '->' + Math.round(y1) + '), no wall-clip');
}

// 1. BUILD — field wall + slot tower
{
  const { sim, p0 } = mk();
  applyCastleDefenseBuild(sim, 'p0', { kind: 'wall', x: 1980, y: 1500 });
  const wall = sim.castledefenseBuildings.find(b => b.kind === 'wall');
  assert(wall && wall.hp === 300 && wall.level === 0, 'wall built lvl0 hp300');
  const slot = sim.castledefenseSlots[0]; p0.playerState.x = slot.x; p0.playerState.y = slot.y;
  applyCastleDefenseBuild(sim, 'p0', { kind: 'machinegun', slot: slot.id });
  const mg = sim.castledefenseBuildings.find(b => b.kind === 'machinegun');
  assert(mg && sim.castledefenseSlots[0].towerId === mg.id, 'machinegun in slot');
  console.log('[OK] build: field wall + slot machinegun');
}

// 2. UPGRADE 1 + MAX
{
  const { sim, p0 } = mk();
  applyCastleDefenseBuild(sim, 'p0', { kind: 'wall', x: 1980, y: 1500 });
  const wall = sim.castledefenseBuildings.find(b => b.kind === 'wall');
  p0.playerState.x = wall.x + 5; p0.playerState.y = wall.y + 5;
  const hp0 = wall.maxHp;
  applyCastleDefenseUpgrade(sim, 'p0', { id: wall.id });
  assert(wall.level === 1 && wall.maxHp > hp0, 'upgrade 1: lvl1 + more hp (' + hp0 + '->' + wall.maxHp + ')');
  applyCastleDefenseUpgrade(sim, 'p0', { id: wall.id, max: true });
  assert(wall.level === A.maxBuildLevel, 'upgrade max -> lvl ' + A.maxBuildLevel + ' got ' + wall.level);
  console.log('[OK] upgrade 1 + max (wall lvl ' + wall.level + ', maxHp ' + wall.maxHp + ')');
}

// 3. GATE open/close
{
  const { sim, p0 } = mk();
  applyCastleDefenseBuild(sim, 'p0', { kind: 'gate', x: 1860, y: 1500 });
  const gate = sim.castledefenseBuildings.find(b => b.kind === 'gate');
  assert(gate.open === false, 'gate starts closed');
  p0.playerState.x = gate.x + 5; p0.playerState.y = gate.y + 5;
  applyCastleDefenseGate(sim, 'p0', { id: gate.id });
  assert(gate.open === true, 'gate toggled open');
  applyCastleDefenseGate(sim, 'p0', { id: gate.id });
  assert(gate.open === false, 'gate toggled closed');
  console.log('[OK] gate open/close');
}

// 4. SLOT-TOWER sit-in / exit
{
  const { sim, p0 } = mk();
  const slot = sim.castledefenseSlots[2]; p0.playerState.x = slot.x; p0.playerState.y = slot.y;
  applyCastleDefenseBuild(sim, 'p0', { kind: 'bomber', slot: slot.id });
  const bomber = sim.castledefenseBuildings.find(b => b.kind === 'bomber');
  applyCastleDefenseEnterTower(sim, 'p0', { id: bomber.id });
  assert(bomber.occupantId === 'p0' && p0._mountedCdTowerId === bomber.id, 'seated in bomber');
  applyCastleDefenseExitTower(sim, 'p0', {});
  assert(bomber.occupantId === null && !p0._mountedCdTowerId, 'exited bomber');
  console.log('[OK] slot-tower sit-in + exit');
}

// 5. THRONE raises castle maxHp; heal-NPC level-up
{
  const { sim, p0 } = mk();
  const t = A.castleNpcs.throne; p0.playerState.x = t.x; p0.playerState.y = t.y;
  const maxHp0 = sim.castledefenseCore.maxHp;
  applyCastleDefenseNpcUpgrade(sim, 'p0', { npc: 'throne' });
  assert(sim.castledefenseNpcs.throne.level === 1 && sim.castledefenseCore.maxHp > maxHp0, 'throne lvl1 raises castle maxHp (' + maxHp0 + '->' + sim.castledefenseCore.maxHp + ')');
  const h = A.castleNpcs.heal_npc; p0.playerState.x = h.x; p0.playerState.y = h.y;
  applyCastleDefenseNpcUpgrade(sim, 'p0', { npc: 'heal_npc', max: true });
  assert(sim.castledefenseNpcs.heal_npc.level === A.maxBuildLevel, 'heal_npc maxed');
  console.log('[OK] throne raises castle HP + heal-NPC upgrade');
}

// 6. POWDER BARREL shoot-to-detonate -> blast + fire trail
{
  const { sim, p0 } = mk();
  applyCastleDefenseBuild(sim, 'p0', { kind: 'powder_barrel', x: 1980, y: 2000 });
  const barrel = sim.castledefenseBuildings.find(b => b.kind === 'powder_barrel');
  // put an enemy near the barrel
  sim.enemies.push({ x: barrel.x + 10, y: barrel.y + 10, r: 12, hp: 200, dead: false, type: 'grunt', _cdEnemy: true });
  const enemy = sim.enemies[sim.enemies.length - 1];
  // simulate a friendly bullet on the barrel
  sim.bullets.push({ x: barrel.x + 5, y: barrel.y + 5, _prevX: barrel.x + 5, _prevY: barrel.y + 5, vx: 0, vy: 0, r: 4, dmg: 10, life: 1, hostile: false, ownerPid: 'p0' });
  step(sim);
  assert(barrel.hp <= 0, 'barrel detonated (hp<=0)');
  assert(enemy.hp <= 0 || enemy.dead, 'blast killed nearby enemy');
  const fire = sim.castledefenseBuildings.find(b => b.kind === 'oil_fire');
  assert(fire, 'fire trail (oil_fire) spawned');
  console.log('[OK] powder barrel shoot-to-detonate + fire trail');
}

// 7. CASTLE HP damage model — enemy at the core chips castle HP
{
  const { sim } = mk();
  const core = sim.castledefenseCore; const hp0 = core.hp;
  sim.enemies.push({ x: core.x, y: core.y - core.r + 4, r: 12, hp: 9999, dead: false, type: 'grunt', dmg: 25, speed: 60, _cdAttackCd: 0, _cdEnemy: true, _cdRole: 'siege' });
  for (let i = 0; i < 30; i++) step(sim);
  assert(core.hp < hp0, 'enemy at core damaged castle HP (' + hp0 + '->' + Math.round(core.hp) + ')');
  console.log('[OK] castle-HP damage model (enemy at core chips it)');
}

console.log('\n═══════════════════════════════════════');
console.log('  CASTLE DEFENSE v2 server smoke PASSED');
console.log('═══════════════════════════════════════');
