'use strict';
// SPECTATE smoke-test (sim-nivå): en åskådare (ws.isSpectator) late-joinar en
// pågående match. Verifierar att åskådaren ALDRIG blir en spelare och att matchen
// ändå avslutas korrekt — exakt de garantier server.js/room-sim.js-guardsen ska ge:
//   1) buildPlayerList (via world-paketet) exkluderar åskådaren
//   2) applyPlayerInput skapar aldrig en playerState åt åskådaren
//   3) åskådaren får ändå world-broadcasts (är i room.members)
//   4) åskådaren hamnar aldrig i score-mapsen (tdmKillsByPid/tdmDeathsByPid)
//   5) co-op lose-check: alla riktiga spelare döda + åskådare kvar → matchen FÖRLORAS
//      (åskådaren håller inte matchen vid liv)
const assert = require('assert');
const { createSim, startSim, tickSim, applyPlayerInput } = require('./sim/room-sim');

function makeWs(id, opts = {}) {
  return {
    id, readyState: 1, _isBot: false, _jsonWorld: true, bufferedAmount: 0,
    isSpectator: !!opts.spectator, playerState: null, tdmTeam: null, tdmRespawnAt: 0,
    stableSlot: opts.slot != null ? opts.slot : 0, _serverRtt: 0, _sentMessages: [],
    send(d) { this._sentMessages.push(typeof d === 'string' ? JSON.parse(d) : d); },
  };
}
function makeRoom() {
  return { code: 'SPEC', hostId: 'p0', members: new Map(), meta: { mode: 'tdm', maxPlayers: 10 } };
}
// senaste world-paketets players-array ur en ws sändlogg ("" om inga)
function lastWorldPlayers(ws) {
  let players = null;
  for (const m of ws._sentMessages) if (m.type === 'world' && Array.isArray(m.players)) players = m.players;
  return players;
}
function received(ws, type) {
  for (const m of ws._sentMessages) {
    if (m.type === type) return true;
    if (Array.isArray(m.events)) for (const e of m.events) if (e.type === type) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEL 1: TDM — åskådare blir aldrig spelare, matchen tickar normalt
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- DEL 1: TDM spectator never becomes a player ---');
const room = makeRoom();
const p0 = makeWs('p0', { slot: 0 });
const p1 = makeWs('p1', { slot: 1 });
room.members.set('p0', p0);
room.members.set('p1', p1);

const sim = createSim(room);
startSim(sim, { tdm: true, tdmTargetKills: 10 });
assert(sim.tdmActive === true, 'tdmActive');
// båda riktiga spelarna fick playerState av startSim
assert(p0.playerState && p1.playerState, 'real players have playerState after startSim');

// Late-join en SPECTATOR (server.js join-handlern lägger till i members men hoppar
// ALL registrering → ingen playerState/team/score-seed).
const spec = makeWs('spec', { spectator: true, slot: -1 });
room.members.set('spec', spec);

// Försök injicera input som åskådare → MÅSTE ignoreras (ingen playerState skapas)
applyPlayerInput(sim, 'spec', { x: 500, y: 500, hp: 100, aim: 0, seq: 1 });
assert(spec.playerState === null, 'spectator input did NOT create a playerState');
console.log('[OK] applyPlayerInput ignored spectator (playerState still null)');

// Ticka förbi countdown
sim.simReadyAt = 0;
for (let i = 0; i < 12; i++) { sim.simReadyAt = 0; tickSim(sim, Date.now()); }

// world-paketet (skickat till p0) får BARA innehålla de 2 riktiga spelarna
const players = lastWorldPlayers(p0);
assert(players !== null, 'a world packet was broadcast');
assert(players.length === 2, 'world players = exactly 2 real players, got ' + players.length);
// stableSlot -1 (åskådaren) får aldrig dyka upp som en spelar-c
assert(!players.some(pp => pp.c === -1), 'no player entry carries the spectator slot (-1)');
console.log('[OK] buildPlayerList excludes spectator (world shows 2 players, none is spectator)');

// åskådaren MÅSTE få world-broadcasts (den är ju i rummet och tittar)
assert(received(spec, 'world'), 'spectator receives world snapshots');
console.log('[OK] spectator still receives world broadcasts');

// åskådaren hamnar ALDRIG i score-mapsen
assert(sim.tdmKillsByPid['spec'] === undefined, 'spectator absent from tdmKillsByPid');
assert(sim.tdmDeathsByPid['spec'] === undefined, 'spectator absent from tdmDeathsByPid');
assert(spec.playerState === null, 'spectator STILL has no playerState after ticks');
console.log('[OK] spectator absent from all TDM score-maps + still no playerState');

// ─────────────────────────────────────────────────────────────────────────────
// DEL 2: co-op lose-check — alla riktiga spelare döda + åskådare kvar → matchen slutar
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- DEL 2: co-op lose-check unaffected by spectator ---');
const room2 = makeRoom();
room2.meta.mode = 'survivors';
const q0 = makeWs('q0', { slot: 0 });
const q1 = makeWs('q1', { slot: 1 });
room2.members.set('q0', q0);
room2.members.set('q1', q1);
const sim2 = createSim(room2);
startSim(sim2, { castledefense: true, survivors: true, survivorsDurationSec: 600 });
assert(sim2.castledefenseActive === true, 'castledefense/survivors active');

// late-join spectator
const spec2 = makeWs('spec2', { spectator: true, slot: -1 });
room2.members.set('spec2', spec2);

// ticka igång så playerStates finns, döda sedan ALLA riktiga spelare
sim2.simReadyAt = 0;
for (let i = 0; i < 5; i++) { sim2.simReadyAt = 0; tickSim(sim2, Date.now()); }
assert(spec2.playerState === null, 'spectator never lazy-created in co-op buildPlayerList');
for (const pid of ['q0', 'q1']) {
  const ws = room2.members.get(pid);
  if (ws.playerState) { ws.playerState.hp = 0; ws.playerState.cdDowned = true; }
}
// driv tills lose-checken triggar (alla riktiga döda; åskådaren får ej blockera)
let lost = false;
for (let i = 0; i < 30 && !lost; i++) {
  sim2.simReadyAt = 0;
  tickSim(sim2, Date.now());
  if (sim2.castledefenseEnded || received(q0, 'survivors_lose') || received(q1, 'survivors_lose')) lost = true;
}
assert(lost, 'co-op match ENDED (survivors_lose) even with a spectator present');
assert(spec2.playerState === null, 'spectator STILL no playerState at match end');
console.log('[OK] co-op match lost correctly; spectator never counted as alive');

// ─────────────────────────────────────────────────────────────────────────────
// DEL 3: PvP end-match scoreboard/XP — åskådaren är ALDRIG en perPlayer-rad
// (annars: phantom 0-rad på motståndarnas scoreboard + +12 oförtjänt konto-XP)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- DEL 3: PvP match-end perPlayer excludes spectator ---');
const room3 = makeRoom();
room3.meta.mode = 'gungame';
const g0 = makeWs('g0', { slot: 0 });
const g1 = makeWs('g1', { slot: 1 });
room3.members.set('g0', g0);
room3.members.set('g1', g1);
const sim3 = createSim(room3);
startSim(sim3, { gungame: true });
assert(sim3.gungameActive === true, 'gungame active');
assert(typeof sim3._endGungameMatch === 'function', '_endGungameMatch attached to sim');
// late-join spectator
const spec3 = makeWs('spec3', { spectator: true, slot: -1 });
room3.members.set('spec3', spec3);
// avsluta matchen (g0 vinner) → perPlayer byggs ur room.members
sim3._endGungameMatch(sim3, 'g0', 'test');
const ggEnd = sim3.eventQueue.find(e => e.type === 'gungame_match_end');
assert(ggEnd && ggEnd.stats && ggEnd.stats.perPlayer, 'gungame_match_end has perPlayer stats');
const pp = ggEnd.stats.perPlayer;
assert(pp['g0'] && pp['g1'], 'both real players present in perPlayer');
assert(pp['spec3'] === undefined, 'spectator ABSENT from perPlayer (no phantom row, no XP credit)');
console.log('[OK] gungame_match_end perPlayer = {g0,g1}, spectator excluded → no scoreboard row + no XP');

console.log('\n═══════════════════════════════════════');
console.log('  ALL SPECTATE smoke-tests PASSED');
console.log('═══════════════════════════════════════');
