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

// Pickups: 10 spawn-vapen (5×spegel) + 1 minigun i mitten (17:41 #6b) + granat-loot
// (6 frag + 6 rök + 4 flash + 4 molotov + 2 gravity, allt symmetriskt) + 2 hp + 2 shield
const counts = {};
for (const pu of sim.pvpPickups) counts[pu.type] = (counts[pu.type] || 0) + 1;
console.log('  pickup counts', JSON.stringify(counts));
assert(counts.weapon === 11, 'should be 11 weapon pickups (10 + center minigun)');
assert(counts.grenade === 6, 'should be 6 frag-grenade pickups (symmetriskt)');
assert(counts.smoke === 6, 'should be 6 smoke-grenade pickups (symmetriskt)');
assert(counts.flash === 4 && counts.molotov === 4 && counts.gravity === 2, 'flash/molotov/gravity oförändrade');
const weaponPus = sim.pvpPickups.filter(p => p.type === 'weapon');
assert(weaponPus.every(p => p.weaponId), 'every weapon pickup has weaponId');
// 17:41 #6b: minigun exakt i mitten (850,1000)
const mg = weaponPus.find(p => p.weaponId === 'minigun');
assert(mg && mg.x === 850 && mg.y === 1000, 'minigun pickup i dead-center (850,1000)');
console.log('[OK] pickups: 11 weapons inkl center-minigun (' + [...new Set(weaponPus.map(p => p.weaponId))].join(',') + '), 6 frag + 6 rök, hp/shield');

// Hoppa över 5s-startup-countdown (i prod passeras den av realtid)
sim.simReadyAt = 0;
for (let i = 0; i < 12; i++) tickSim(sim, Date.now());
console.log('[OK] 12 ticks (post-countdown) no crash');

// Simulera att p0 går på ett SNIPER-vapen → ska få pvp_pickup_collected ptype weapon + weaponId, pickup KVAR
const akPu = weaponPus.find(p => p.weaponId === 'ak');
const p0 = room.members.get('p0');
p0.playerState.x = akPu.x; p0.playerState.y = akPu.y; p0.playerState.hp = 100;
p0._sentMessages.length = 0;
console.log('  DBG before tick: p0 team=' + p0.tdmTeam + ' pos=(' + p0.playerState.x + ',' + p0.playerState.y + ') hp=' + p0.playerState.hp + ' wpn=' + p0.playerState.weaponId);
console.log('  DBG akPu=(' + akPu.x + ',' + akPu.y + ') avail=' + akPu.available + ' tdmEnded=' + sim.tdmEnded + ' simReadyAt=' + sim.simReadyAt);
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
assert(collected[0].weaponId === 'ak', 'collected weaponId is ak, got ' + collected[0].weaponId);
// v1.723: servern sätter EJ ps.weaponId vid pickup (klienten styr hand/förråd via tdm_equip)
assert(akPu.available === false, 'CS-runda: weapon pickup KONSUMERAS (available=false)');
console.log('[OK] walked onto ak → pickup KONSUMERAD + collected-event (weaponId styrs av klient)');

// ===== CS-RUNDA-FLÖDE =====
console.log('\n--- CS-RUNDA: team-wipe → round-end → reset ---');
assert(sim.tdmRoundActive === true && sim.tdmRoundNum === 1, 'round 1 active vid start');
const p1 = room.members.get('p1');
console.log('  teams: p0=' + p0.tdmTeam + ' p1=' + p1.tdmTeam);
// Helper: samla event-typ från BÅDE eventQueue + dränade sim_events (broadcastWorld tömmer kön)
function collectEvents(type) {
  const out = [];
  for (const e of sim.eventQueue) if (e.type === type) out.push(e);
  for (const m of p0._sentMessages) {
    if (m.type === type) out.push(m);
    if (Array.isArray(m.events)) for (const e of m.events) if (e.type === type) out.push(e);
  }
  return out;
}
// v1.734: ge BÅDA lagen ett icke-pistol-vapen för att verifiera lag-baserad behåll/reset
p0.playerState.weaponId = 'ak'; // röd (vinnare) — ska BEHÅLLA
p1.playerState.weaponId = 'shotgun'; // blå (förlorare) — ska TAPPA → pistol
// Döda p1 (blå) → blueAlive=0 → röd vinner rundan. Ticka tills broadcast sker (event drän).
p1.playerState.hp = 0;
sim.simReadyAt = 0;
p0._sentMessages.length = 0;
for (let i = 0; i < 6; i++) { sim.simReadyAt = 0; tickSim(sim, Date.now()); }
const roundEnd = collectEvents('tdm_round_end');
assert(roundEnd.length >= 1, 'tdm_round_end emitted on team-wipe (got ' + roundEnd.length + ')');
const winnerTeam = p0.tdmTeam; // p0 lever → p0:s lag vinner
assert(roundEnd[0].winner === winnerTeam, 'winner = surviving team (' + winnerTeam + '), got ' + roundEnd[0].winner);
assert(sim.tdmRoundActive === false && sim.tdmRoundResetAt > 0, 'round inactive + reset-timer satt');
assert(sim.tdmRoundWins[winnerTeam] === 1, 'rundvinst +1 till vinnaren (' + winnerTeam + '): ' + JSON.stringify(sim.tdmRoundWins));
assert(roundEnd[0].redWins === sim.tdmRoundWins.red && roundEnd[0].blueWins === sim.tdmRoundWins.blue, 'round_end bär rundvinst-ställning');
console.log('[OK] team-wipe → tdm_round_end winner=' + roundEnd[0].winner + ', rundvinst-ställning ' + sim.tdmRoundWins.red + '-' + sim.tdmRoundWins.blue);

// Avancera förbi 3s-reset → ny runda. (Reset-checken använder Date.now() i prod;
// forcera timern bakåt i testet så vi slipper sleep:a 3s.)
sim.simReadyAt = 0;
p0._sentMessages.length = 0;
sim.tdmRoundResetAt = Date.now() - 100;
for (let i = 0; i < 3; i++) { sim.simReadyAt = 0; tickSim(sim, Date.now()); }
assert(sim.tdmRoundActive === true && sim.tdmRoundNum === 2, 'round 2 active efter reset (num=' + sim.tdmRoundNum + ')');
assert(p1.playerState.hp === 100 && p0.playerState.hp === 100, 'alla respawnade med full HP');
// v1.734: LAG-baserad reset — vinnande laget (röd/p0) BEHÅLLER vapen, förlorande (blå/p1) → pistol
assert(sim._tdmLastLoser === 'blue', 'förlorande laget lagrat = blue, got ' + sim._tdmLastLoser);
assert(p0.playerState.weaponId === 'ak', 'VINNARE (röd/p0) behåller ak, got ' + p0.playerState.weaponId);
assert(p1.playerState.weaponId === 'pistol', 'FÖRLORARE (blå/p1) resettad till pistol, got ' + p1.playerState.weaponId);
const respawns = collectEvents('tdm_player_respawned');
const p0resp = respawns.find(e => e.peerId === 'p0');
const p1resp = respawns.find(e => e.peerId === 'p1');
assert(p0resp && p0resp.reset === false, 'p0 (vinnare) respawn reset=false');
assert(p1resp && p1resp.reset === true, 'p1 (förlorare) respawn reset=true');
assert(akPu.available === true, 'vapen-pickups återställda (available=true) vid runda-start');
const roundStart = collectEvents('tdm_round_start');
assert(roundStart.length >= 1, 'tdm_round_start emitted');
console.log('[OK] 3s → ny runda: LAG-baserad reset (vinnare behåller, förlorare→pistol) + roundNum=2');

console.log('\n═══════════════════════════════════════');
console.log('  ALL TDM fy_ + CS-RUNDA smoke-tests PASSED');
console.log('═══════════════════════════════════════');
