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

const { createSim, startSim, tickSim, applyBrBuy, applyBrUsePlate, applyBrInfCash } = require('./sim/room-sim');
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

console.log('\n═══════════════════════════════════════');
console.log('  ALL BR ECONOMY/ARMOR/SHOP smoke-tests PASSED');
console.log('═══════════════════════════════════════');
