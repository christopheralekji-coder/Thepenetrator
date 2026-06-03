'use strict';
// BR ekonomi/armor/buy-station smoke-test (v1.739):
// startkapital, cash från loot + kills, buy-stations (≥12 + alien), köp av
// armor_plate/gas_mask (validering: cash, närhet, alien-only), applicera platta,
// armor absorberar skada FÖRE shield/hp, cash-cheat.
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

const { createSim, startSim, tickSim, applyBrBuy, applyBrUsePlate, applyBrInfCash, applyBrAirstrike } = require('./sim/room-sim');
const { BATTLEROYALE_ARENA } = require('../shared/battleroyale-arena');

const room = makeFakeRoom(2);
const sim = createSim(room);
startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
assert(sim.battleroyaleActive === true, 'battleroyaleActive');
console.log('[OK] BR started, arena', sim.battleroyaleArena ? '' : BATTLEROYALE_ARENA.worldW + 'x' + BATTLEROYALE_ARENA.worldH);

// 1. Startkapital
const p0 = room.members.get('p0'), p1 = room.members.get('p1');
assert(sim.brCash.p0 === 500 && sim.brCash.p1 === 500, 'startkapital $500: ' + JSON.stringify(sim.brCash));
console.log('[OK] startkapital $500 per spelare');

// 2. Buy-stations ≥12 + exakt 1 alien
assert(Array.isArray(sim.brBuyStations), 'brBuyStations array');
const regular = sim.brBuyStations.filter(s => !s.alien);
const alien = sim.brBuyStations.filter(s => s.alien);
assert(regular.length >= 12, '≥12 vanliga buy-stations, fick ' + regular.length);
assert(alien.length === 1, 'exakt 1 alien-shop, fick ' + alien.length);
assert(alien[0].x > 7900 && alien[0].y > 7900, 'alien-shop i lila SE-hörnet: ' + alien[0].x + ',' + alien[0].y);
console.log('[OK] ' + regular.length + ' vanliga buy-stations + 1 alien-shop @ (' + alien[0].x + ',' + alien[0].y + ')');

// 3. Köp utan att stå vid station → fail (too_far). Flytta p0 långt från alla.
p0.playerState.x = -9999; p0.playerState.y = -9999; p0.playerState.hp = 100;
p0._sentMessages.length = 0; sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'armor_plate');
let evNames = sim.eventQueue.map(e => e.type);
assert(evNames.includes('br_buy_fail'), 'köp utan station → br_buy_fail, fick ' + JSON.stringify(evNames));
assert(sim.brCash.p0 === 500, 'ingen debitering vid fail');
console.log('[OK] köp utan station nekas (too_far), ingen debitering');

// 4. Stå vid en vanlig station → köp armor_plate ok
const stn = regular[0];
p0.playerState.x = stn.x; p0.playerState.y = stn.y;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'armor_plate');
evNames = sim.eventQueue.map(e => e.type);
assert(evNames.includes('br_buy_ok'), 'köp vid station → br_buy_ok, fick ' + JSON.stringify(evNames));
assert(sim.brCash.p0 === 350, 'cash 500-150=350, fick ' + sim.brCash.p0);
assert(p0.playerState.armorPlates === 1, 'fick 1 reserv-platta, fick ' + p0.playerState.armorPlates);
console.log('[OK] köpte armor_plate ($150) vid station → 1 platta, cash $350');

// 5. Alien-only-vara nekas vid vanlig station, lyckas vid alien-shop
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'alien_armor');
evNames = sim.eventQueue.map(e => e.type);
const wrongShop = sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'wrong_shop');
assert(wrongShop, 'alien-vara vid vanlig station → wrong_shop, fick ' + JSON.stringify(sim.eventQueue.map(e => e.type + (e.reason ? ':' + e.reason : ''))));
p0.playerState.x = alien[0].x; p0.playerState.y = alien[0].y; sim.brCash.p0 = 1000;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'alien_armor');
assert(p0.playerState.armor === 150, 'alien_armor fyller pansaret till 150, fick ' + p0.playerState.armor);
assert(sim.brCash.p0 === 400, 'cash 1000-600=400, fick ' + sim.brCash.p0);
console.log('[OK] alien_armor exklusiv: nekas vid vanlig station, fyller 150 pansar vid alien-shop');

// 6. Applicera reserv-platta → armor +50 (vi har 1 platta, armor=150 redan → ingen ändring;
//    nollställ armor först för att testa applicering)
p0.playerState.armor = 0; p0.playerState.armorPlates = 1;
applyBrUsePlate(sim, 'p0');
assert(p0.playerState.armor === 50 && p0.playerState.armorPlates === 0, 'platta applicerad: armor 50, plates 0, fick ' + p0.playerState.armor + '/' + p0.playerState.armorPlates);
console.log('[OK] applicera platta → +50 armor, reserv -1');

// 7. För lite pengar → no_cash
sim.brCash.p0 = 10; p0.playerState.x = stn.x; p0.playerState.y = stn.y;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'gas_mask');
assert(sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'no_cash'), 'för lite pengar → no_cash');
console.log('[OK] för lite pengar nekas (no_cash)');

// 8. Cash-cheat +5000
sim.brCash.p0 = 0;
applyBrInfCash(sim, 'p0');
assert(sim.brCash.p0 === 5000, 'cash-cheat +5000, fick ' + sim.brCash.p0);
console.log('[OK] cash-cheat +$5000');

// 9. Gas mask köp + flag
sim.brCash.p0 = 1000; p0.playerState.gasMask = false;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'gas_mask');
assert(p0.playerState.gasMask === true, 'gas_mask-flagga satt');
assert(sim.eventQueue.find(e => e.type === 'br_item_granted' && e.item === 'gas_mask'), 'br_item_granted gas_mask emitterat');
console.log('[OK] gas_mask köpt → flagga + grant-event');

// ===== FAS 2: self-revive / UAV / airstrike / downed-revive / kill-credit =====
console.log('\n--- FAS 2: self-revive, UAV, airstrike, downed ---');
sim.simReadyAt = 0;
p0.playerState.x = stn.x; p0.playerState.y = stn.y; p0.playerState.hp = 200; p0.playerState.brDowned = false;
sim.brCash.p0 = 5000;

applyBrBuy(sim, 'p0', 'self_revive');
assert(p0.playerState.selfReviveKits === 1, 'self-revive köpt: ' + p0.playerState.selfReviveKits);
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'uav');
assert(p0.playerState.brUavUntil > Date.now(), 'UAV aktiv');
assert(sim.eventQueue.find(e => e.type === 'br_uav_active'), 'br_uav_active emitterat');
applyBrBuy(sim, 'p0', 'airstrike');
assert(p0.playerState.airstrikes === 1, 'airstrike köpt');
console.log('[OK] köpte self-revive + UAV (aktiverad) + airstrike');

// Helper: events drän:as av broadcastWorld i tickSim → scanna BÅDE eventQueue + sända msgs.
function collectEv(type) {
  const out = [];
  for (const e of sim.eventQueue) if (e.type === type) out.push(e);
  for (const m of [...p0._sentMessages, ...p1._sentMessages]) {
    if (m && m.type === type) out.push(m);
    if (m && Array.isArray(m.events)) for (const e of m.events) if (e.type === type) out.push(e);
  }
  return out;
}

// DOWNED: hp→0 med kit → går downed (ej eliminerad)
p0.playerState.hp = 0;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(p0.playerState.brDowned === true, 'p0 downed istället för eliminerad');
assert(p0.playerState.hp === 1, 'downed hp=1, fick ' + p0.playerState.hp);
assert(p0.playerState.selfReviveKits === 0, 'kit förbrukad vid down');
assert(!sim.battleroyaleEliminated.includes('p0'), 'p0 EJ eliminerad (downed)');
assert(collectEv('br_downed').length >= 1, 'br_downed emitterat');
console.log('[OK] hp→0 med kit → DOWNED (ej eliminerad), hp=1, kit förbrukad');

// REVIVE-channel: forcera timern bakåt → tick → rest upp (hp 50)
p0.playerState.brReviveEnd = Date.now() - 50;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(p0.playerState.brDowned === false, 'p0 rest upp');
assert(p0.playerState.hp === 50, 'revive hp=50, fick ' + p0.playerState.hp);
assert(collectEv('br_revived').length >= 1, 'br_revived emitterat');
console.log('[OK] self-revive-channel klar → rest upp med 50 hp');

// AIRSTRIKE-impact + skada: rikta på p1, forcera nedslag → blast + dmg
p1.playerState.x = 5000; p1.playerState.y = 5000; p1.playerState.hp = 200;
p1.playerState.shield = 0; p1.playerState.armor = 0; p1.playerState.invulnUntil = 0;
applyBrAirstrike(sim, 'p0', 5000, 5000);
assert(p0.playerState.airstrikes === 0, 'airstrike-laddning förbrukad');
assert(sim._brAirstrikes && sim._brAirstrikes.length === 1, 'pending airstrike registrerad');
sim._brAirstrikes[0].impactAt = Date.now() - 1; // forcera nedslag NU
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(collectEv('br_airstrike_blast').length >= 1, 'br_airstrike_blast emitterat');
assert(p1.playerState.hp < 200, 'p1 tog airstrike-skada, hp=' + p1.playerState.hp);
console.log('[OK] airstrike: rikta → nedslag → blast-event + AoE-skada (' + Math.round(200 - p1.playerState.hp) + ' dmg)');

// KILL-CREDIT vid finish: p1 hp→0 utan kit + färsk angripare p0 → p0 krediteras
p1.playerState.hp = 0; p1.playerState.selfReviveKits = 0; p1.playerState.brDowned = false;
p1.playerState._brLastAttacker = 'p0'; p1.playerState._brLastAttackerAt = Date.now(); p1.playerState._brLastWeapon = 'rifle';
const killsBefore = sim.battleroyaleKillsByPid.p0 || 0;
sim.eventQueue.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(sim.battleroyaleEliminated.includes('p1'), 'p1 eliminerad');
assert((sim.battleroyaleKillsByPid.p0 || 0) === killsBefore + 1, 'p0 krediterad kill vid elimination (' + (sim.battleroyaleKillsByPid.p0 || 0) + ')');
console.log('[OK] kill-credit: finish av sårbar spelare krediterar färsk angripare');

console.log('\n═══════════════════════════════════════');
console.log('  ALL BR ECONOMY/ARMOR/SHOP + FAS 2 smoke-tests PASSED');
console.log('═══════════════════════════════════════');
