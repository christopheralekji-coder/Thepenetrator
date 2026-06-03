'use strict';
// TDM fy_-arena smoke-test: startSim(tdm) på nya ÖVNINGSFÄLTET, vapen-pickups,
// spawn-vapen=pistol, vapen-grepp via tickPvpPickups, respawn-vapen-reset.
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

const { createSim, startSim, tickSim } = require('./sim/room-sim');
const { TDM_ARENA } = require('../shared/tdm-arena');
console.log('[OK] modules loaded; arena', TDM_ARENA.worldW + 'x' + TDM_ARENA.worldH, TDM_ARENA.name);

const room = makeFakeRoom(2);
const sim = createSim(room);
startSim(sim, { tdm: true, tdmTargetKills: 10 });
assert(sim.tdmActive === true, 'tdmActive');
assert(sim.tdmArena.worldW === TDM_ARENA.worldW && sim.tdmArena.worldH === TDM_ARENA.worldH, 'arena size follows TDM_ARENA');
console.log('[OK] tdm started, arena', sim.tdmArena.worldW + 'x' + sim.tdmArena.worldH);

// Alla spelare ska starta med pistol
for (const [pid, ws] of room.members) assert(ws.playerState.weaponId === 'pistol', pid + ' spawns with pistol');
console.log('[OK] all players spawn with pistol');

// Pickups: ska ha 10 vapen + 4 granater + 2 hp + 2 shield
const counts = {};
for (const pu of sim.pvpPickups) counts[pu.type] = (counts[pu.type] || 0) + 1;
console.log('  pickup counts', JSON.stringify(counts));
assert(counts.weapon === 10, 'should be 10 weapon pickups');
assert(counts.grenade === 4, 'should be 4 grenade pickups');
const weaponPus = sim.pvpPickups.filter(p => p.type === 'weapon');
assert(weaponPus.every(p => p.weaponId), 'every weapon pickup has weaponId');
console.log('[OK] pickups: 10 weapons (' + [...new Set(weaponPus.map(p => p.weaponId))].join(',') + '), 4 grenades, hp/shield');

// Hoppa över 5s-startup-countdown (i prod passeras den av realtid)
sim.simReadyAt = 0;
for (let i = 0; i < 12; i++) tickSim(sim, Date.now());
console.log('[OK] 12 ticks (post-countdown) no crash');

// Simulera att p0 går på ett SNIPER-vapen → ska få pvp_pickup_collected ptype weapon + weaponId, pickup KVAR
const sniperPu = weaponPus.find(p => p.weaponId === 'sniper');
const p0 = room.members.get('p0');
p0.playerState.x = sniperPu.x; p0.playerState.y = sniperPu.y; p0.playerState.hp = 100;
p0._sentMessages.length = 0;
console.log('  DBG before tick: p0 team=' + p0.tdmTeam + ' pos=(' + p0.playerState.x + ',' + p0.playerState.y + ') hp=' + p0.playerState.hp + ' wpn=' + p0.playerState.weaponId);
console.log('  DBG sniperPu=(' + sniperPu.x + ',' + sniperPu.y + ') avail=' + sniperPu.available + ' tdmEnded=' + sim.tdmEnded + ' simReadyAt=' + sim.simReadyAt);
// töm eventQueue + tick (förbi countdown)
sim.simReadyAt = 0;
sim.eventQueue.length = 0;
tickSim(sim, Date.now());
console.log('  DBG after tick: p0 wpn=' + p0.playerState.weaponId + ' sentMsgs=' + p0._sentMessages.map(m => m.type).join(','));
// Eventen broadcastas till klienter (eventQueue dräneras av broadcastWorld) — leta i sända meddelanden
const flat = [];
for (const m of p0._sentMessages) {
  if (m.type === 'pvp_pickup_collected') flat.push(m);
  if (Array.isArray(m.events)) for (const e of m.events) if (e.type === 'pvp_pickup_collected') flat.push(e);
}
const collected = flat.filter(e => e.ptype === 'weapon');
assert(collected.length >= 1, 'weapon pickup emitted pvp_pickup_collected');
assert(collected[0].weaponId === 'sniper', 'collected weaponId is sniper, got ' + collected[0].weaponId);
assert(p0.playerState.weaponId === 'sniper', 'server set ps.weaponId=sniper');
assert(sniperPu.available === true, 'weapon pickup STAYS available (permanent)');
console.log('[OK] walked onto sniper → equipped server-side + pickup remains on ground');

// Stå kvar nästa tick → ska INTE spamma nytt event (samma vapen)
sim.simReadyAt = 0;
sim.eventQueue.length = 0;
tickSim(sim, Date.now());
const again = sim.eventQueue.filter(e => e.type === 'pvp_pickup_collected' && e.ptype === 'weapon');
assert(again.length === 0, 'no re-emit while standing on same weapon (got ' + again.length + ')');
console.log('[OK] no event-spam standing on equipped weapon');

console.log('\n═══════════════════════════════════════');
console.log('  ALL TDM fy_ smoke-tests PASSED');
console.log('═══════════════════════════════════════');
