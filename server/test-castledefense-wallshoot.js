'use strict';
// CD: can't shoot THROUGH a solid castle wall via the muzzle/pip-offset (feedback
// 2026-06-23 "vapnet sträcker sig över väggen → skjuter igenom"). A shot whose
// spawn (player + barrel offset) lands inside/past a castle wall must not be created.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, applyShoot } = RS;
const { CASTLEDEFENSE_ARENA: A } = require('../shared/castledefense-arena');

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'WSH', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100; p0.playerState.weaponId = 'pistol';
  return { sim, p0 };
}

// the south-west castle wall spans roughly x1200-1900, y950-1000.
// stand just NORTH of it (inside) and aim SOUTH (+y) into the wall: spawn ≈ (1500, 954) = inside the wall.
{
  const { sim, p0 } = mk();
  p0.playerState.x = 1500; p0.playerState.y = 940;
  const before = sim.bullets.length;
  applyShoot(sim, 'p0', { weaponId: 'pistol', x: 1500, y: 940, ang: Math.PI / 2 });
  assert(sim.bullets.length === before, 'shot INTO a castle wall must spawn no bullet (got +' + (sim.bullets.length - before) + ')');
  console.log('[OK] no shooting through a solid castle wall (pip-offset blocked)');
}

// control: same shot out in the open field spawns a bullet normally.
{
  const { sim, p0 } = mk();
  p0.playerState.x = 2000; p0.playerState.y = 2500;
  const before = sim.bullets.length;
  applyShoot(sim, 'p0', { weaponId: 'pistol', x: 2000, y: 2500, ang: Math.PI / 2 });
  assert(sim.bullets.length > before, 'a normal open-field shot must spawn a bullet');
  console.log('[OK] normal open-field shot still spawns a bullet');
}

console.log('\n═══════════════════════════════════════');
console.log('  CD wall-shoot-through smoke PASSED');
console.log('═══════════════════════════════════════');
