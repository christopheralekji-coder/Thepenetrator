'use strict';
// CASTLE DEFENSE v2 — enemy AI + wave-pacing smoke (feedback 2026-06-23):
// (1) ground enemy PEELS OFF to a nearby player (aggro) but core stays primary;
// (2) far player → enemy follows flow/core, not the player;
// (3) ranged enemy does NOT aggro (keeps sieging);
// (4) wave advances on the TIMED deadline even with enemies alive (overlap);
// (5) wave does NOT advance past a LIVE boss.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim } = RS;

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'CDAI', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100;
  sim.castledefenseGold['p0'] = 9999999;
  return { sim, p0 };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }
function mkEnemy(o) {
  return Object.assign({ r: 12, hp: 200, maxHp: 200, dead: false, type: 'grunt', dmg: 10,
    speed: 60, _cdAttackCd: 0, _cdPlayerContactCd: 0, _cdEnemy: true }, o);
}

// 1. AGGRO — melee enemy with a player within ~240px targets the PLAYER
{
  const { sim, p0 } = mk();
  p0.playerState.x = 2000; p0.playerState.y = 1450;     // in the field, not on a wall
  const e = mkEnemy({ x: 2000, y: 1500 });               // 50px from p0
  sim.enemies.push(e);
  step(sim);
  assert(e._cdLastTargetId === '__player_p0', 'enemy aggro\'d nearby player, got ' + e._cdLastTargetId);
  console.log('[OK] aggro: enemy peels off to a nearby player');
}

// 2. NO AGGRO when player is far → follows flow/core (NOT the player)
{
  const { sim, p0 } = mk();
  p0.playerState.x = 400; p0.playerState.y = 400;        // far away (>240px)
  const e = mkEnemy({ x: 2000, y: 2500 });
  sim.enemies.push(e);
  step(sim);
  assert(e._cdLastTargetId === '__flow__' || e._cdLastTargetId === '__core__',
    'far player → flow/core, got ' + e._cdLastTargetId);
  console.log('[OK] no-aggro: distant player ignored, enemy heads for core');
}

// 3. RANGED enemy does NOT aggro (keeps sieging via flow/core)
{
  const { sim, p0 } = mk();
  p0.playerState.x = 2000; p0.playerState.y = 1460;
  const e = mkEnemy({ x: 2000, y: 1500, type: 'shooter' });
  sim.enemies.push(e);
  step(sim);
  assert(e._cdLastTargetId !== '__player_p0', 'ranged enemy must NOT aggro player, got ' + e._cdLastTargetId);
  console.log('[OK] ranged enemy ignores player-aggro (sieges)');
}

// 4. TIMED ADVANCE — wave goes 'between' on the deadline even with enemies alive
{
  const { sim } = mk();
  sim.castledefenseWaveState = 'active';
  sim._cdWaveSpawnsRemaining = 0;
  sim.bossAlive = false;
  sim._cdWaveActiveDeadline = Date.now() - 1000;          // deadline already passed
  sim.enemies.push(mkEnemy({ x: 2000, y: 3000 }));        // straggler still alive
  step(sim);
  assert(sim.castledefenseWaveState === 'between', 'wave should auto-advance on deadline; state=' + sim.castledefenseWaveState);
  console.log('[OK] timed advance: next wave starts with stragglers still alive');
}

// 5. NEVER advance past a LIVE boss
{
  const { sim } = mk();
  sim.castledefenseWaveState = 'active';
  sim._cdWaveSpawnsRemaining = 0;
  sim.bossAlive = true;                                   // boss up → must NOT advance
  sim._cdWaveActiveDeadline = Date.now() - 1000;
  sim.enemies.push(mkEnemy({ x: 2000, y: 3000, isBoss: true }));
  step(sim);
  assert(sim.castledefenseWaveState === 'active', 'must NOT advance while boss alive; state=' + sim.castledefenseWaveState);
  console.log('[OK] boss-guard: wave holds while boss is alive');
}

console.log('\n═══════════════════════════════════════');
console.log('  CASTLE DEFENSE v2 enemy-AI smoke PASSED');
console.log('═══════════════════════════════════════');
