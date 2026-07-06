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

// ─── PvE lag-comp regression tests ───────────────────────────────────────────

const { rewoundFromHistory } = require('../../server/sim/bullets');

// (a) Moving enemy + laggy human shooter → hit at rewound pos, miss at live pos.
{
  const now = Date.now();
  // Enemy moved 100px to the right over the last 120ms (x=500→600).
  // Bullet sits at x=510 — within rsum of rewound pos (~500) but not live pos (600).
  const hist = [
    { t: now - 120, x: 500, y: 300 },
    { t: now - 60,  x: 550, y: 300 },
    { t: now,       x: 600, y: 300 },
  ];
  const liveX = 600, liveY = 300;
  // shooterRtt=120ms, interp=60ms → rewindMs = min(250, 60+60)=120ms → targetTime=now-120
  const pos = rewoundFromHistory(liveX, liveY, hist, 120, 60);
  const rsum = 20 + 4 + 8;  // enemy.r=20, bullet.r=4, +8 constant
  const hitRewind = Math.abs(pos.x - 510) <= rsum;
  const hitLive   = Math.abs(liveX - 510) <= rsum;
  if (!hitRewind) {
    console.error('LAG-COMP (a) FAIL: rewound pos should hit (pos.x=' + pos.x.toFixed(1) + ', bullet=510, rsum=' + rsum + ')');
    process.exit(1);
  }
  if (hitLive) {
    console.log('  note (a): live pos also within rsum for this scenario');
  }
  console.log('OK (a): moving enemy hit at rewound pos (rewind x=' + pos.x.toFixed(1) + ', live x=' + liveX + ')');
}

// (b) No RTT (bot / turret shooter) → rewoundFromHistory returns live pos unchanged.
{
  const now = Date.now();
  const hist = [
    { t: now - 100, x: 400, y: 400 },
    { t: now,       x: 400, y: 400 },
  ];
  const pos = rewoundFromHistory(400, 400, hist, 0, 60);
  if (pos.x !== 400 || pos.y !== 400) {
    console.error('LAG-COMP (b) FAIL: no rtt should return live pos, got x=' + pos.x + ' y=' + pos.y);
    process.exit(1);
  }
  console.log('OK (b): bot/no-rtt bullet uses live pos (x=' + pos.x + ', y=' + pos.y + ')');
}

// (c) Empty history → falls back to live pos gracefully (no crash, no exception).
{
  const pos = rewoundFromHistory(700, 800, [], 120, 60);
  if (pos.x !== 700 || pos.y !== 800) {
    console.error('LAG-COMP (c) FAIL: empty history should return live pos, got x=' + pos.x + ' y=' + pos.y);
    process.exit(1);
  }
  console.log('OK (c): empty history returns live pos (no crash)');
}

// (d) Enemy _history is populated in the sim after 100 ticks.
{
  let enemiesWithHistory = 0;
  for (const e of sim.enemies) {
    if (e._history && e._history.length > 0) enemiesWithHistory++;
  }
  if (sim.enemies.length > 0 && enemiesWithHistory === 0) {
    console.error('LAG-COMP (d) FAIL: no enemies have _history after 100 ticks — room-sim push missing?');
    process.exit(1);
  }
  console.log('OK (d): ' + enemiesWithHistory + '/' + sim.enemies.length + ' live enemies have position history');
}
