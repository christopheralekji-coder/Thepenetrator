// CI sim-tick test — verify server tickSim kan köras 100 frames utan att kasta
// (catches getDiffMul/getNGPMul-style 'is not a function' regressioner)
'use strict';

const { createSim, applyLoadStage, tickSim } = require('../../server/sim/room-sim');
// Använd waves.loadStage direkt — applyLoadStage kräver host-peerId-match.
const { loadStage } = require('../../server/sim/waves');

const room = { code: 'CITEST', hostId: 'p1', members: new Map() };
const ws = {
  readyState: 1,
  send: () => {},
  playerState: { x: 1000, y: 2640, hp: 100 },
};
room.members.set('p1', ws);

const sim = createSim(room, { difficulty: 'veteran', mode: 'story', ngpLevel: 0 });
loadStage(sim, 1);

// Hoppa över wakeup-countdown så enemies börjar spawna direkt
sim.simReadyAt = 0;
sim.lastTick = Date.now();

let totalEnemies = 0;
for (let i = 0; i < 100; i++) {
  // Simulera 33ms-tick (30Hz)
  sim.lastTick = Date.now() - 33;
  try {
    tickSim(sim);
  } catch (e) {
    console.error('SIM TICK ERROR @ frame', i, ':', e.message);
    process.exit(1);
  }
  totalEnemies = Math.max(totalEnemies, sim.enemies.length);
}

if (totalEnemies === 0) {
  console.error('Inga enemies spawnade efter 100 ticks — spawn-logik bruten?');
  process.exit(1);
}

console.log(`OK: 100 ticks utan crash, max ${totalEnemies} enemies aktiva (${sim.enemies.length} just nu)`);
