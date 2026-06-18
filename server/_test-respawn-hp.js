'use strict';
// Verifierar respawn-hp-fixen: en spelare med hp/shield-upgrades (klient skickar
// maxHp/maxShield via sim_input) ska respawna till FULLT, inte hårdkodat 100.
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

const { createSim, startSim, tickSim, applyPlayerInput } = require('./sim/room-sim');

const room = makeFakeRoom(2);
const sim = createSim(room);
startSim(sim, { gungame: true });
assert(sim.gungameActive === true, 'gungame active');

const ws = room.members.get('p0');
// Klienten rapporterar upgrade-baserad max (hp 100+25*8=300, shield 100)
applyPlayerInput(sim, 'p0', { x: ws.playerState.x, y: ws.playerState.y, hp: 300, maxHp: 300, maxShield: 100, aim: 0 });
assert(ws.playerState._cliMaxHp === 300, 'server lagrade _cliMaxHp=300, fick ' + ws.playerState._cliMaxHp);
assert(ws.playerState._cliMaxShield === 100, '_cliMaxShield=100');
console.log('[OK] server lagrade klient-rapporterad maxHp/maxShield');

// Simulera död + respawn-timer i det förflutna
sim.simReadyAt = 0;                   // hoppa över 5s startup-countdown
ws.playerState.hp = 0;
ws.tdmRespawnAt = Date.now() - 100;   // respawn ska fyra direkt
tickSim(sim);

assert(ws.tdmRespawnAt === 0, 'respawn-timern nollställdes (respawn fyrade)');
assert(ws.playerState.hp === 300, 'RESPAWN-HP ska vara 300 (full), blev ' + ws.playerState.hp);
console.log('[OK] respawn gav FULL hp 300 (inte 100)');

// Kontroll: en spelare UTAN rapporterad max (gammal klient) → fallback 100
const ws2 = room.members.get('p1');
ws2.playerState.hp = 0;
ws2.tdmRespawnAt = Date.now() - 100;
tickSim(sim);
assert(ws2.playerState.hp === 100, 'gammal klient (ingen maxHp) → fallback 100, blev ' + ws2.playerState.hp);
console.log('[OK] bakåtkompatibel: ingen rapporterad maxHp → 100');

console.log('\nALLA RESPAWN-HP-TESTER PASSERADE');

process.exit(0);
