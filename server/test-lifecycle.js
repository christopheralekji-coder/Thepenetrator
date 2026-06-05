'use strict';
// Livscykel-test (v1.769): bevisar att en spelare som DOG i förra matchen får hp=100
// vid nästa startSim (server-fix #2). Utan fixen ligger ws.playerState.hp=0 kvar mellan
// sims → buildPlayerList lägger spelaren i deadBodies tick 1 → instant death på "try again".
const assert = require('assert');

function makeFakeWs(id) {
  return { id, readyState: 1, _isBot: false, playerState: null, tdmTeam: null,
    tdmRespawnAt: 0, _serverRtt: 0, _sentMessages: [], send(d) { this._sentMessages.push(typeof d === 'string' ? JSON.parse(d) : d); } };
}
function makeFakeRoom(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) members.set('p' + i, makeFakeWs('p' + i));
  return { code: 'TEST', hostId: 'p0', members, meta: {} };
}
const { createSim, startSim, stopSim } = require('./sim/room-sim');

// --- Match 1: co-op story ---
const room = makeFakeRoom(2);
let sim = createSim(room);
startSim(sim, { mode: 'story', wave: 1 });
for (const [pid, ws] of room.members) assert(ws.playerState && ws.playerState.hp === 100, pid + ' startar match1 hp=100');
console.log('[OK] match1: alla spelare hp=100');

// --- Spelarna DÖR (hp ligger kvar på ws.playerState mellan sims) ---
room.members.get('p0').playerState.hp = 0;
room.members.get('p1').playerState.hp = 12;
console.log('[OK] simulerat: p0 dog (hp=0), p1 skadad (hp=12)');

// --- Rematch precis som server.js sim_start: stopSim → null → ny sim → startSim ---
try { stopSim(sim); } catch (e) {}
const oldSim = sim;
sim = createSim(room);
assert(sim !== oldSim, 'createSim ger ett NYTT sim-objekt');
startSim(sim, { mode: 'story', wave: 1 });

// --- FIXEN: hp ska vara 100 igen, INTE 0/12 ---
assert(room.members.get('p0').playerState.hp === 100, 'p0 hp NOLLSTÄLLD till 100 på rematch (var 0) — annars instant death');
assert(room.members.get('p1').playerState.hp === 100, 'p1 hp NOLLSTÄLLD till 100 på rematch (var 12)');
console.log('[OK] match2 (rematch): hp nollställd till 100 → ingen instant death ✓');

// --- Verifiera även att gamla sim:ens interval är stoppat (server-fix #1-kontext) ---
assert(!oldSim.interval, 'gamla sim:ens interval stoppat efter stopSim');
console.log('[OK] gamla sim:ens tick-loop stoppad');

try { stopSim(sim); } catch (e) {}
console.log('\n✅ test-lifecycle PASS — instant-death-på-retry fixad');
process.exit(0);
