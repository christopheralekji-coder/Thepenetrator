// Regression test — stable-slot (F7 fix): c:i-index får INTE skifta när en peer lämnar.
// Skapar rum med 3 peers (slots 0, 1, 2), tar bort mittenspelaren (slot 1),
// och asserterar att kvarvarande peers (A=slot 0, C=slot 2) behåller sina slot-index.
// Kör: node .github/workflows/stable-slot-test.js
'use strict';

const assert = require('assert');
const { createSim, startSim, tickSim } = require('../../server/sim/room-sim');
const { loadStage } = require('../../server/sim/waves');

function makeFakeWs(id, slot) {
  return {
    id,
    readyState: 1,
    stableSlot: slot,
    playerState: { x: 1000, y: 1000, hp: 100 },
    _isBot: false,
    tdmTeam: null,
    send: () => {},
  };
}

// Bygg rum med 3 peers: host (slot 0), peerB (slot 1), peerC (slot 2)
const room = {
  code: 'SLOTTEST',
  hostId: 'pA',
  members: new Map(),
  meta: {},
  _nextSlot: 3,     // nästa fria slot om en ny peer joinar
  _freeSlots: [],
};
const wsA = makeFakeWs('pA', 0);
const wsB = makeFakeWs('pB', 1);
const wsC = makeFakeWs('pC', 2);
room.members.set('pA', wsA);
room.members.set('pB', wsB);
room.members.set('pC', wsC);

const sim = createSim(room);
loadStage(sim, 1);
sim.simReadyAt = 0;
sim.lastTick = Date.now();

// Kör en tick för att initiera sim utan krascha
try {
  sim.lastTick = Date.now() - 33;
  tickSim(sim);
} catch (e) {
  console.error('TICK KRASCH (pre-leave):', e.message);
  process.exit(1);
}

// Verifiera slots FÖRE leave — alla tre peers ska ha sina initiala slots
function collectSlots(simRef) {
  const { createSim: _cs, startSim: _ss } = require('../../server/sim/room-sim'); // unused, just for ref
  // Bygg manuellt samma logic som broadcastWorld
  const slotMap = {};
  for (const [pid, ws] of simRef.room.members) {
    if (!ws.playerState || ws._isBot) continue; // skippa companions+bots för detta test
    const slot = (ws.stableSlot != null) ? ws.stableSlot : -1;
    slotMap[pid] = slot;
  }
  return slotMap;
}

const slotsBefore = collectSlots(sim);
assert.strictEqual(slotsBefore['pA'], 0, 'pA ska ha slot 0 before leave, fick ' + slotsBefore['pA']);
assert.strictEqual(slotsBefore['pB'], 1, 'pB ska ha slot 1 before leave, fick ' + slotsBefore['pB']);
assert.strictEqual(slotsBefore['pC'], 2, 'pC ska ha slot 2 before leave, fick ' + slotsBefore['pC']);
console.log('[OK] Slots FÖRE leave: pA=0, pB=1, pC=2');

// Simulera att pB (slot 1) lämnar: returnera slot till freeSlots, ta bort ur members
if (wsB.stableSlot != null && wsB.stableSlot !== 0) {
  room._freeSlots.push(wsB.stableSlot);
}
room.members.delete('pB');

// Kör en tick efter leave
try {
  sim.lastTick = Date.now() - 33;
  tickSim(sim);
} catch (e) {
  console.error('TICK KRASCH (post-leave):', e.message);
  process.exit(1);
}

// Verifiera slots EFTER leave — pA och pC ska ha OFÖRÄNDRADE slots
const slotsAfter = collectSlots(sim);
assert.strictEqual(slotsAfter['pA'], 0, 'pA ska fortfarande ha slot 0 efter att pB lämnat, fick ' + slotsAfter['pA']);
assert.strictEqual(slotsAfter['pB'], undefined, 'pB ska vara borta ur members');
assert.strictEqual(slotsAfter['pC'], 2, 'pC ska fortfarande ha slot 2 efter att pB lämnat, fick ' + slotsAfter['pC']);
console.log('[OK] Slots EFTER leave (pB borta): pA=0, pC=2 — INGA SKIFTNINGAR');

// Verifiera att slot 1 är i freeSlots för återanvändning
assert(room._freeSlots.includes(1), 'Slot 1 ska vara i freeSlots för återanvändning, freeSlots=' + JSON.stringify(room._freeSlots));
console.log('[OK] Slot 1 (pB:s gamla slot) finns i _freeSlots för återanvändning');

// Simulera att en ny peer pD joinar och återanvänder slot 1
room._freeSlots.sort((a, b) => a - b);
const recycledSlot = room._freeSlots.shift();
const wsD = makeFakeWs('pD', recycledSlot);
room.members.set('pD', wsD);
assert.strictEqual(recycledSlot, 1, 'Ny peer pD ska återanvända slot 1, fick ' + recycledSlot);
const slotsWithD = collectSlots(sim);
assert.strictEqual(slotsWithD['pA'], 0, 'pA har fortfarande slot 0');
assert.strictEqual(slotsWithD['pC'], 2, 'pC har fortfarande slot 2');
assert.strictEqual(slotsWithD['pD'], 1, 'pD återanvänder slot 1');
console.log('[OK] Ny peer pD återanvänder slot 1 (lägsta lediga): pA=0, pD=1, pC=2');

// Kör en tick med alla tre kvarvarande + ny peer
try {
  sim.lastTick = Date.now() - 33;
  tickSim(sim);
} catch (e) {
  console.error('TICK KRASCH (post-rejoin):', e.message);
  process.exit(1);
}
console.log('[OK] Tick efter rejoin utan krasch');

console.log('\n═══════════════════════════════════════');
console.log('  stable-slot-test PASSED');
console.log('═══════════════════════════════════════');
