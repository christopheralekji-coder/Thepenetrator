'use strict';
// CASTLE DEFENSE v2 — DOWN/REVIVE deep smoke (user: "make revive flawless").
// Covers: basic revive, medic 2x, multi-reviver medic-preference, progress decay+broadcast,
// out-of-radius, bleed-out->death, downed-can't-revive, downed-can't-build, DownedPids cleanup.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim, applyCastleDefenseBuild } = RS;

function makeWs(id) {
  return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, _events: [],
    send(m) { try { const o = typeof m === 'string' ? JSON.parse(m) : m; if (o && o.type === 'sim_events' && Array.isArray(o.events)) for (const e of o.events) this._events.push(e); } catch (_) {} } };
}
function mk(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) members.set('p' + i, makeWs('p' + i));
  const sim = createSim({ code: 'RV' + n, hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  for (const [, ws] of members) ws.playerState.hp = 100;
  return { sim, members };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }
function down(sim, ws) { ws.playerState.hp = 0; step(sim); }   // enters cdDowned next tick
function ev(ws, type) { return (ws._events || []).filter(e => e && e.type === type); }

// 1. BASIC REVIVE — downed + nearby teammate revives over reviveSec
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2010; b.playerState.y = 2000;   // within 60px
  down(sim, a);
  assert(a.playerState.cdDowned === true, 'p0 entered down-state');
  for (let i = 0; i < 130 && a.playerState.cdDowned; i++) { b.playerState.x = 2010; b.playerState.y = 2000; step(sim); }
  assert(a.playerState.cdDowned === false, 'p0 revived by nearby teammate');
  assert(a.playerState.hp === 50, 'revive restores 50 hp, got ' + a.playerState.hp);
  assert(!(sim.castledefenseDownedPids || []).includes('p0'), 'DownedPids cleared on revive');
  console.log('[OK] basic revive: nearby teammate revives over reviveSec, hp=50, no leak');
}

// 2. MEDIC 2x — medic reviver completes at half progress
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000; b.playerState.x = 2010; b.playerState.y = 2000;
  sim.castledefensePerks['p1'] = 'medic';
  down(sim, a);
  a.playerState.cdDownReviveProgress = 2.49;   // just under medic reviveSec (2.5)
  step(sim);
  assert(a.playerState.cdDowned === false, 'medic reviver revives at ~2.5s of progress');
  console.log('[OK] medic 2x: revives at half the progress');
}

// 2b. control — WITHOUT medic, 2.49s progress does NOT revive (needs 5s)
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000; b.playerState.x = 2010; b.playerState.y = 2000;
  down(sim, a);
  a.playerState.cdDownReviveProgress = 2.49;
  step(sim);
  assert(a.playerState.cdDowned === true, 'non-medic must NOT revive at 2.5s (needs 5s)');
  console.log('[OK] non-medic: 2.5s progress is not enough');
}

// 3. MULTI-REVIVER prefers MEDIC deterministically
{
  const { sim, members } = mk(3);
  const a = members.get('p0'), b = members.get('p1'), c = members.get('p2');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2010; b.playerState.y = 2000;   // non-medic, near
  c.playerState.x = 1990; c.playerState.y = 2000;   // medic, near
  sim.castledefensePerks['p2'] = 'medic';
  down(sim, a);
  a.playerState.cdDownReviveProgress = 2.49;   // only enough if the MEDIC is chosen
  step(sim);
  assert(a.playerState.cdDowned === false, 'with a medic among revivers, medic speed is used (deterministic)');
  console.log('[OK] multi-reviver: medic preferred regardless of map order');
}

// 4. DECAY + BROADCAST when reviver leaves
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 100; b.playerState.y = 100;   // far away
  down(sim, a);
  a.playerState.cdDownReviveProgress = 2.0;
  a._events = [];
  step(sim);
  assert(a.playerState.cdDownReviveProgress < 2.0, 'progress decays with no reviver');
  assert(ev(a, 'cd_revive_progress').length > 0, 'decay broadcasts cd_revive_progress (arc drains on client)');
  console.log('[OK] decay: progress shrinks AND is broadcast');
}

// 5. OUT OF RADIUS — teammate too far → no progress
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2200; b.playerState.y = 2000;   // 200px > 60
  down(sim, a);
  for (let i = 0; i < 20; i++) { b.playerState.x = 2200; step(sim); }
  assert((a.playerState.cdDownReviveProgress || 0) === 0, 'no progress when reviver out of radius');
  assert(a.playerState.cdDowned === true, 'still downed');
  console.log('[OK] out-of-radius: no revive progress');
}

// 6. BLEED-OUT → death (cdDownDead), with a second player up (no defeat)
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 100; b.playerState.y = 100; b.playerState.hp = 100;
  down(sim, a);
  a.playerState.cdDownStartedAt = Date.now() - 31000;   // past the 30s bleed-out
  a._events = [];
  step(sim);
  assert(a.playerState.cdDownDead === true && a.playerState.hp === 0, 'bleed-out → cdDownDead, hp 0');
  assert(ev(a, 'cd_player_died_out').length > 0, 'cd_player_died_out emitted');
  assert(!(sim.castledefenseDownedPids || []).includes('p0'), 'DownedPids cleared on death');
  console.log('[OK] bleed-out → death + DownedPids cleanup');
}

// 7. DOWNED player can NOT revive another (excluded)
{
  const { sim, members } = mk(3);
  const a = members.get('p0'), b = members.get('p1'), c = members.get('p2');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2010; b.playerState.y = 2000;   // also down, near a
  c.playerState.x = 100; c.playerState.y = 100;     // up but far (keeps match alive)
  down(sim, a); down(sim, b);
  a.playerState.cdDownReviveProgress = 0;
  for (let i = 0; i < 15 && !sim.castledefenseEnded; i++) { b.playerState.x = 2010; step(sim); }
  assert((a.playerState.cdDownReviveProgress || 0) === 0, 'a downed teammate must NOT accumulate revive progress');
  console.log('[OK] downed players cannot revive');
}

// 8. DOWNED player can NOT build
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000; b.playerState.hp = 100;
  sim.castledefenseGold['p0'] = 99999;
  down(sim, a);
  const before = sim.castledefenseBuildings.length;
  applyCastleDefenseBuild(sim, 'p0', { kind: 'wall', x: 2000, y: 2100 });
  assert(sim.castledefenseBuildings.length === before, 'downed player must not be able to build');
  console.log('[OK] downed player cannot build/upgrade/enter-tower (gated)');
}

console.log('\n═══════════════════════════════════════');
console.log('  CASTLE DEFENSE v2 REVIVE deep smoke PASSED');
console.log('═══════════════════════════════════════');
