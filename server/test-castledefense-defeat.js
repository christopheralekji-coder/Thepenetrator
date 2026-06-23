'use strict';
// CD: all-players-down → defeat (feedback 2026-06-23: dog men "spring runt 0hp utan defeat").
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim } = RS;

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'DEF', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100;
  return { sim, p0 };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }

// 1. solo player dies → goes down → no one up → match ends (defeat)
{
  const { sim, p0 } = mk();
  p0.playerState.hp = 0;
  for (let i = 0; i < 6 && !sim.castledefenseEnded; i++) step(sim);
  assert(sim.castledefenseEnded === true, 'solo death must end the match (all players down)');
  console.log('[OK] solo death → all-players-down defeat');
}

// 2. control: a healthy player keeps the match going
{
  const { sim, p0 } = mk();
  p0.playerState.hp = 100;
  for (let i = 0; i < 6; i++) step(sim);
  assert(sim.castledefenseEnded !== true, 'an alive player must NOT trigger defeat');
  console.log('[OK] alive player → no false defeat');
}

// 3. co-op: one down, one up → no defeat (revivable)
{
  const members = new Map(); members.set('p0', makeWs('p0')); members.set('p1', makeWs('p1'));
  const sim = createSim({ code: 'DEF2', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  members.get('p0').playerState.hp = 0;     // down
  members.get('p1').playerState.hp = 100;   // up
  members.get('p1').playerState.x = 100; members.get('p1').playerState.y = 100; // away (no auto-revive)
  for (let i = 0; i < 6; i++) step(sim);
  assert(sim.castledefenseEnded !== true, 'one downed + one up must NOT defeat (revivable)');
  console.log('[OK] co-op one-down-one-up → no defeat');
}

console.log('\n═══════════════════════════════════════');
console.log('  CD all-players-down defeat smoke PASSED');
console.log('═══════════════════════════════════════');
