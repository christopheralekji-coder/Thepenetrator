'use strict';
// V2 BR-EKONOMI 2.0 — test av nivå-baserade perks + bag-förbrukningsvaror.
const assert = require('assert');

function makeFakeWs(id) {
  return { id, readyState: 1, _isBot: false, playerState: null, tdmTeam: null,
    tdmRespawnAt: 0, _serverRtt: 0, _sentMessages: [], send(d) { this._sentMessages.push(typeof d === 'string' ? JSON.parse(d) : d); } };
}
function makeFakeRoom(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) members.set('p' + i, makeFakeWs('p' + i));
  return { code: 'BRTEST', hostId: 'p0', members, meta: {} };
}

const { createSim, startSim, tickSim, applyBrBuy, applyBrUseItem, applyBrUseUav } = require('./sim/room-sim');

const room = makeFakeRoom(2);
const sim = createSim(room);
startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
assert(sim.battleroyaleActive === true, 'battleroyaleActive');
const p0 = room.members.get('p0');
assert(sim.brCash.p0 === 500, 'startkapital $500');
console.log('[OK] BR startad, $500 startkapital');

// V2 (2026-06-24): shoppar är nu 3 dedikerade NPC-handlare (radie-baserade), inga hus-
// stationer. Ställ p0 PÅ en shop-NPC så närhets-checken (brStationNear) godkänner köp.
const station = sim.brBuyStations.find(s => s.npc) || sim.brBuyStations.find(s => s.r);
assert(station, 'hittade shop-NPC-station');
p0.playerState.x = station.x;
p0.playerState.y = station.y;
p0.playerState.hp = 100;

function buy(item) { sim.eventQueue.length = 0; applyBrBuy(sim, 'p0', item); return sim.eventQueue.map(e => e.type); }
function use(item) { sim.eventQueue.length = 0; applyBrUseItem(sim, 'p0', item); return sim.eventQueue.map(e => e.type); }

// Ge gott om cash för testet
sim.brCash.p0 = 99999;

// 1. PERK: move_speed nivå 1→5
for (let i = 1; i <= 5; i++) {
  const ev = buy('move_speed');
  assert(ev.includes('br_perk_level') && ev.includes('br_buy_ok'), 'move_speed lvl' + i + ' köp: ' + ev);
  assert(p0.playerState.brPerkLevels.move_speed === i, 'move_speed level=' + i);
}
let ev = buy('move_speed'); // över max
assert(ev.includes('br_buy_fail'), 'move_speed över max → fail');
assert(p0.playerState.brPerkLevels.move_speed === 5, 'move_speed kvar på 5');
console.log('[OK] move_speed 5 nivåer + max-spärr');

// 2. PERK: max_hp → maxHp + heal
p0.playerState.hp = 50;
buy('max_hp'); buy('max_hp'); buy('max_hp'); buy('max_hp');
assert(p0.playerState.maxHp === 200, 'maxHp=200 efter 4 nivåer, fick ' + p0.playerState.maxHp);
assert(p0.playerState.brPerkLevels.max_hp === 4, 'max_hp level 4');
console.log('[OK] max_hp 100→200 (4×25) + heal/nivå, hp=' + p0.playerState.hp);

// 3. PERK: shield → maxShield
buy('shield'); buy('shield'); buy('shield'); buy('shield');
assert(p0.playerState.maxShield === 400, 'maxShield=400, fick ' + p0.playerState.maxShield);
console.log('[OK] shield 200→400 (4×50), shield=' + p0.playerState.shield);

// 4. PERK: dmg_redux 10 nivåer → -50% (via brPerkLevels)
for (let i = 0; i < 10; i++) buy('dmg_redux');
assert(p0.playerState.brPerkLevels.dmg_redux === 10, 'dmg_redux level 10');
const redux = Math.min(0.5, 0.05 * p0.playerState.brPerkLevels.dmg_redux);
assert(redux === 0.5, 'dmg_redux = -50%');
console.log('[OK] dmg_redux 10 nivåer = -50% skada');

// 5. PERK: self_revive → selfReviveKits (max 2)
buy('self_revive'); assert(p0.playerState.selfReviveKits === 1, 'self_revive kit 1');
buy('self_revive'); assert(p0.playerState.selfReviveKits === 2, 'self_revive kit 2');
ev = buy('self_revive'); assert(ev.includes('br_buy_fail'), 'self_revive över max 2 → fail');
console.log('[OK] self_revive → selfReviveKits max 2');

// 6. BAG: köp + räknare
buy('medkit'); buy('medkit'); assert(p0.playerState.medkits === 2, 'medkits=2');
buy('shieldkit'); assert(p0.playerState.shieldkits === 1, 'shieldkits=1');
buy('adrenaline'); assert(p0.playerState.adrenalines === 1, 'adrenalines=1');
buy('uav'); assert(p0.playerState.uavCount === 1, 'uavCount=1');
buy('airstrike'); assert(p0.playerState.airstrikes === 1, 'airstrikes=1');
console.log('[OK] bag-köp: medkit/shieldkit/adrenaline/uav/airstrike räknare ökar');

// 7. ANVÄND bag-items
p0.playerState.hp = 60; p0.playerState.maxHp = 200;
ev = use('medkit');
assert(p0.playerState.medkits === 1, 'medkit-räknare -1');
assert(p0.playerState.brMedkitTicks === 5 && ev.includes('br_heal_active'), 'medkit startade heal-over-time');

p0.playerState.shield = 50; p0.playerState.maxShield = 400;
ev = use('shieldkit');
assert(p0.playerState.shield === 150, 'shieldkit +100 shield, fick ' + p0.playerState.shield);
assert(p0.playerState.shieldkits === 0 && ev.includes('pvp_hp_changed'), 'shieldkit konsumerad + event');

ev = use('adrenaline');
assert(p0.playerState.adrenalines === 0 && p0.playerState.brAdrenalineEnd > Date.now() && ev.includes('br_adrenaline'), 'adrenalin aktiverad');

ev = use('uav');
assert(p0.playerState.uavCount === 0 && p0.playerState.brUavUntil > Date.now() && ev.includes('br_uav_active'), 'uav aktiverad');
console.log('[OK] bag-use: medkit/shieldkit/adrenaline/uav effekter korrekta');

// 8. Medkit heal-over-time via tickSim. tickBrMeta använder Date.now() för
// tick-fönstren → tvinga fram varje tick genom att backdatera brMedkitNext.
sim.simReadyAt = 0; // hoppa över 5s startup-countdown så tickBattleRoyale/tickBrMeta körs
// ISOLERA medkit-mätningen: p0 står på en shop-NPC där BR-loot (slumpad placering)
// ibland hamnar inom pickup-radien → ett hp_small (+60) kunde plockas upp under
// tickSim och kontaminera heal-summan (flaky 150 vs 200). Töm loot-listan.
sim.battleroyaleLoot.length = 0;
p0.playerState.hp = 60; p0.playerState.maxHp = 200;
p0.playerState.brMedkitTicks = 5; p0.playerState.brMedkitNext = 0;
const startHp = p0.playerState.hp;
let medkitEvents = 0;
for (let t = 0; t < 5; t++) {
  p0.playerState.brMedkitNext = Date.now() - 1; // gör nästa tick "förfallen"
  sim.eventQueue.length = 0;
  tickSim(sim, 1 / 60);
  if (sim.eventQueue.some(e => e.type === 'pvp_hp_changed' && e.peerId === 'p0')) medkitEvents++;
}
assert(p0.playerState.hp === startHp + 90, 'medkit +90 hp (5×18), från ' + startHp + ' till ' + p0.playerState.hp);
assert(p0.playerState.brMedkitTicks === 0, 'medkit klar (0 tickar kvar)');
console.log('[OK] medkit heal-over-time: hp ' + startHp + ' → ' + p0.playerState.hp + ' (' + medkitEvents + ' hp-events)');

// 9. Otillräcklig cash → fail
sim.brCash.p0 = 10;
ev = buy('rapid_fire');
assert(ev.includes('br_buy_fail'), 'otillräcklig cash → fail');
console.log('[OK] otillräcklig cash nekas');

console.log('\n===== ALLA TESTER PASS =====');
process.exit(0);
