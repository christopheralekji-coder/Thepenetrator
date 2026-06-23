'use strict';
// SWEPT bullet-vs-enemy hit (feedback 2026-06-23 "träffar utan att träffa"):
// a fast bullet whose prev→cur segment passes THROUGH an enemy must register a hit
// even though its end-of-tick position is well past the enemy (old point-test tunneled).
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim } = RS;

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'SWP', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100;
  return { sim, p0 };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }

// fast bullet starts WEST of the enemy and moves 200px east in one tick → its end
// position is 100px PAST the enemy (old point-test = miss); the swept segment crosses it.
{
  const { sim, p0 } = mk();
  p0.playerState.x = 2000; p0.playerState.y = 2000;   // owner near enemy (anti-cheese pass)
  const e = { x: 2000, y: 2000, r: 10, hp: 200, maxHp: 200, dead: false, type: 'grunt', _cdEnemy: true, _showcaseFrozen: true, _idx: 9991 };
  sim.enemies.push(e);
  sim.bullets.push({ x: 1900, y: 2000, vx: 4000, vy: 0, r: 4, dmg: 60, life: 1,
    hostile: false, ownerPid: 'p0', weaponId: 'pistol', crit: false, hitIds: new Set() });
  step(sim);
  assert(e.hp < 200 || e.dead, 'swept bullet hit the enemy it would have tunneled past (hp=' + e.hp + ')');
  console.log('[OK] swept hit: fast bullet through enemy registers (no tunneling)');
}

// control: a bullet that passes 50px ABOVE the enemy must still MISS (no false hits)
{
  const { sim, p0 } = mk();
  p0.playerState.x = 2000; p0.playerState.y = 2000;
  const e = { x: 2000, y: 2000, r: 10, hp: 200, maxHp: 200, dead: false, type: 'grunt', _cdEnemy: true, _showcaseFrozen: true, _idx: 9992 };
  sim.enemies.push(e);
  sim.bullets.push({ x: 1900, y: 1950, vx: 4000, vy: 0, r: 4, dmg: 60, life: 1,
    hostile: false, ownerPid: 'p0', weaponId: 'pistol', crit: false, hitIds: new Set() });
  step(sim);
  assert(e.hp === 200 && !e.dead, 'bullet 50px off-axis must NOT hit (hp=' + e.hp + ')');
  console.log('[OK] no false hit: off-axis bullet still misses');
}

console.log('\n═══════════════════════════════════════');
console.log('  SWEPT bullet hit-reg smoke PASSED');
console.log('═══════════════════════════════════════');
