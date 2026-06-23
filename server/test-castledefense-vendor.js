'use strict';
// CASTLE DEFENSE v2 — weapon-vendor smoke (feedback 2026-06-23):
// buy near vendor with gold → deduct + record + equip; reject when too far / too poor / owned.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, applyCastleDefenseBuyWeapon } = RS;
const { CASTLEDEFENSE_ARENA: A } = require('../shared/castledefense-arena');

function makeWs(id) { return { id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null, send() {} }; }
function mk() {
  const members = new Map(); members.set('p0', makeWs('p0'));
  const sim = createSim({ code: 'CDV', hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  const p0 = members.get('p0'); p0.playerState.hp = 100;
  return { sim, p0 };
}
const V = A.castleNpcs.weapon_vendor;

// 1. BUY near vendor with enough gold → deduct + record + auto-equip
{
  const { sim, p0 } = mk();
  p0.playerState.x = V.x; p0.playerState.y = V.y;
  sim.castledefenseGold['p0'] = 60000;
  applyCastleDefenseBuyWeapon(sim, 'p0', { weaponId: 'shotgun' });
  assert(sim.castledefenseGold['p0'] < 60000, 'gold deducted (' + sim.castledefenseGold['p0'] + ')');
  assert(sim.castledefensePurchasedWeapons['p0'].has('shotgun'), 'weapon recorded as purchased');
  assert(p0.playerState.weaponId === 'shotgun', 'weapon auto-equipped, got ' + p0.playerState.weaponId);
  console.log('[OK] buy: gold deducted + recorded + auto-equipped');
}

// 2. BUY too far → no deduct
{
  const { sim, p0 } = mk();
  p0.playerState.x = 200; p0.playerState.y = 200;
  sim.castledefenseGold['p0'] = 60000;
  applyCastleDefenseBuyWeapon(sim, 'p0', { weaponId: 'shotgun' });
  assert(sim.castledefenseGold['p0'] === 60000, 'no deduct when too far');
  console.log('[OK] buy rejected when too far from vendor');
}

// 3. BUY insufficient gold → no deduct, not purchased
{
  const { sim, p0 } = mk();
  p0.playerState.x = V.x; p0.playerState.y = V.y;
  sim.castledefenseGold['p0'] = 100;
  applyCastleDefenseBuyWeapon(sim, 'p0', { weaponId: 'rocket' });
  assert(sim.castledefenseGold['p0'] === 100, 'no deduct when poor');
  assert(!sim.castledefensePurchasedWeapons['p0'].has('rocket'), 'not purchased when poor');
  console.log('[OK] buy rejected when too poor');
}

// 4. BUY already-owned → no double deduct
{
  const { sim, p0 } = mk();
  p0.playerState.x = V.x; p0.playerState.y = V.y;
  sim.castledefenseGold['p0'] = 60000;
  applyCastleDefenseBuyWeapon(sim, 'p0', { weaponId: 'smg' });
  const after1 = sim.castledefenseGold['p0'];
  applyCastleDefenseBuyWeapon(sim, 'p0', { weaponId: 'smg' });
  assert(sim.castledefenseGold['p0'] === after1, 'no second charge for owned weapon');
  console.log('[OK] buy rejected when already owned');
}

console.log('\n═══════════════════════════════════════');
console.log('  CASTLE DEFENSE v2 vendor smoke PASSED');
console.log('═══════════════════════════════════════');
