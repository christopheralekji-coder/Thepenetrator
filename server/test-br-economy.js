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

const { createSim, startSim, tickSim, applyBrBuy, applyBrInfCash, applyBrAirstrike, applyBrUseUav, applyBrAcceptContract } = require('./sim/room-sim');
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
applyBrBuy(sim, 'p0', 'armor');
let evNames = sim.eventQueue.map(e => e.type);
assert(evNames.includes('br_buy_fail'), 'köp utan station → br_buy_fail, fick ' + JSON.stringify(evNames));
assert(sim.brCash.p0 === 500, 'ingen debitering vid fail');
console.log('[OK] köp utan station nekas (too_far), ingen debitering');

// 4. Stå HELT inne i en hus-station (bounds) → köp armor lvl1 (150)
const stn = regular[0];
assert(stn.bounds, 'hus-station har bounds');
p0.playerState.x = stn.bounds.x + stn.bounds.w / 2; p0.playerState.y = stn.bounds.y + stn.bounds.h / 2;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'armor');
evNames = sim.eventQueue.map(e => e.type);
assert(evNames.includes('br_buy_ok'), 'köp inne i hus → br_buy_ok, fick ' + JSON.stringify(evNames));
assert(sim.brCash.p0 === 350, 'cash 500-150=350, fick ' + sim.brCash.p0);
assert(p0.playerState.armorLevel === 1, 'armor lvl 1, fick ' + p0.playerState.armorLevel);
console.log('[OK] köpte armor lvl1 ($150) inne i hus → -10% dmg, cash $350');

// 4b. Står UTANFÖR husets bounds → too_far (helt-inne-krav)
p0.playerState.x = stn.bounds.x - 60; p0.playerState.y = stn.bounds.y - 60;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'gas_mask');
assert(sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'too_far'), 'utanför hus-bounds → too_far');
console.log('[OK] utanför husväggarna nekas (måste vara HELT inne)');

// 5. Alien-only-vara nekas vid vanlig station, lyckas vid alien-shop
p0.playerState.x = stn.bounds.x + stn.bounds.w / 2; p0.playerState.y = stn.bounds.y + stn.bounds.h / 2;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'alien_armor');
const wrongShop = sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'wrong_shop');
assert(wrongShop, 'alien-vara vid vanlig station → wrong_shop, fick ' + JSON.stringify(sim.eventQueue.map(e => e.type + (e.reason ? ':' + e.reason : ''))));
p0.playerState.x = alien[0].x; p0.playerState.y = alien[0].y; sim.brCash.p0 = 2000; p0.playerState.armorLevel = 0;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'alien_armor');
assert(p0.playerState.armorLevel === 5, 'alien_armor → armor MAX (lvl 5), fick ' + p0.playerState.armorLevel);
assert(sim.brCash.p0 === 1100, 'cash 2000-900=1100, fick ' + sim.brCash.p0);
console.log('[OK] alien_armor exklusiv: nekas vid vanlig station, sätter armor lvl5 vid alien-shop');

// 6. Armor maxad → fler köp nekas (full) → "försvinner ur shoppen"-regel server-side
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'armor');
assert(sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'full'), 'maxad armor → full');
console.log('[OK] maxad armor (lvl5) → fler köp nekas (full)');

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
// v1.743: UAV är BÄRBAR (buy → uavCount++, aktiveras från bag)
applyBrBuy(sim, 'p0', 'uav');
assert(p0.playerState.uavCount === 1, 'UAV bärbar köpt (uavCount=1), fick ' + p0.playerState.uavCount);
sim.eventQueue.length = 0;
applyBrUseUav(sim, 'p0');
assert(p0.playerState.brUavUntil > Date.now() && p0.playerState.uavCount === 0, 'UAV aktiverad från bag → reveal + uavCount 0');
assert(sim.eventQueue.find(e => e.type === 'br_uav_active'), 'br_uav_active emitterat vid aktivering');
applyBrBuy(sim, 'p0', 'airstrike');
assert(p0.playerState.airstrikes === 1, 'airstrike köpt');
// Granat-köp + max-hp/shield-uppgraderingar
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'grenade');
assert(sim.eventQueue.find(e => e.type === 'br_grenades' && e.frag === 2), 'grenade-köp → br_grenades frag:2');
p0.playerState.maxHp = 100; p0.playerState.hp = 100; p0.playerState.maxShield = 200; p0.playerState.shield = 0;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'max_hp');
assert(p0.playerState.maxHp === 200 && p0.playerState.hp === 200, 'max_hp → maxHp 200 + heal, fick ' + p0.playerState.maxHp + '/' + p0.playerState.hp);
applyBrBuy(sim, 'p0', 'max_shield');
assert(p0.playerState.maxShield === 400 && p0.playerState.shield === 200, 'max_shield → maxShield 400 +fyll200, fick ' + p0.playerState.maxShield + '/' + p0.playerState.shield);
console.log('[OK] köpte self-revive + UAV(bärbar→bag-aktivering) + airstrike + granat + max-hp/shield');
console.log('[OK] UAV-bag-aktivering, granat-köp, max-hp(200)/max-shield(400)-uppgradering');

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

// ===== FAS 3: PERKS (shop-köp) =====
console.log('\n--- FAS 3: perks ---');
p0.playerState.x = stn.bounds.x + stn.bounds.w / 2; p0.playerState.y = stn.bounds.y + stn.bounds.h / 2;
p0.playerState.hp = 200; p0.playerState.brDowned = false; sim.brCash.p0 = 5000;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
applyBrBuy(sim, 'p0', 'perk_fast_hands');
assert(p0.playerState.brPerks.fast_hands === true, 'fast_hands-perk satt');
assert(sim.eventQueue.find(e => e.type === 'br_perk_granted' && e.perk === 'fast_hands'), 'br_perk_granted fast_hands');
// Re-köp samma perk → have
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'perk_fast_hands');
assert(sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'have'), 'redan ägd perk → have');
// Double Time → speedMul 1.25
applyBrBuy(sim, 'p0', 'perk_double_time');
assert(p0.playerState.brPerks.double_time === true && p0.playerState.speedMul === 1.25, 'double_time → speedMul 1.25, fick ' + p0.playerState.speedMul);
console.log('[OK] perks köps (fast_hands/double_time), re-köp nekas (have), double_time → +25% fart');

// GHOST: p1 har UAV, p0 har ghost → p0 syns INTE i p1:s UAV-ping
p1.playerState.x = 6000; p1.playerState.y = 6000; p1.playerState.hp = 200; p1.playerState.brUavUntil = Date.now() + 20000;
applyBrBuy(sim, 'p0', 'perk_ghost');
assert(p0.playerState.brPerks.ghost === true, 'ghost-perk satt');
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim._brUavTick = 1600; // forcera UAV-ping nästa tick
sim.simReadyAt = 0; tickSim(sim, Date.now());
const pings = collectEv('br_uav_ping').filter(e => e.peerId === 'p1');
assert(pings.length >= 1, 'p1 fick UAV-ping');
assert(pings[0].blips.length === 0, 'GHOST: p0 syns EJ i p1:s UAV-ping (blips=' + pings[0].blips.length + ')');
console.log('[OK] Ghost-perk: ghosted spelare exkluderas ur fiendens UAV-ping');

// ===== FAS 4: CONTRACTS + SUPPLY DROPS =====
console.log('\n--- FAS 4: contracts + supply drops ---');
assert(Array.isArray(sim.brContracts) && sim.brContracts.length >= 6, '≥6 kontrakt skapade vid start, fick ' + (sim.brContracts ? sim.brContracts.length : 0));
// Hitta ett supply_run-kontrakt; stå vid det → acceptera
let sr = sim.brContracts.find(c => c.type === 'supply_run' && c.available);
assert(sr, 'finns ett supply_run-kontrakt');
p0.playerState.brContract = null; p0.playerState.hp = 200; p0.playerState.brDowned = false;
p0.playerState.x = sr.x; p0.playerState.y = sr.y;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
applyBrAcceptContract(sim, 'p0', sr.id);
assert(p0.playerState.brContract && p0.playerState.brContract.type === 'supply_run', 'supply_run accepterat');
assert(sr.takenBy === 'p0' && !sr.available, 'kontrakt markerat taget');
assert(collectEv('br_contract_active').length >= 1, 'br_contract_active emitterat');
console.log('[OK] supply_run accepterat (mål + deadline satt)');
// Nå målet → reward + done
p0.playerState.x = p0.playerState.brContract.goalX; p0.playerState.y = p0.playerState.brContract.goalY;
const cashBeforeSR = sim.brCash.p0 || 0;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(!p0.playerState.brContract, 'supply_run slutfört (kontrakt rensat)');
assert((sim.brCash.p0 || 0) > cashBeforeSR, 'supply_run gav cash-belöning');
assert(collectEv('br_contract_done').length >= 1, 'br_contract_done emitterat');
console.log('[OK] supply_run slutfört vid mål → cash + done');

// DROPBOX-kontrakt → spawnar supply-drop
let db = sim.brContracts.find(c => c.type === 'dropbox' && c.available);
assert(db, 'finns ett dropbox-kontrakt');
p0.playerState.x = db.x; p0.playerState.y = db.y;
const dropsBefore = sim.brSupplyDrops.length;
applyBrAcceptContract(sim, 'p0', db.id);
assert(p0.playerState.brContract && p0.playerState.brContract.type === 'dropbox', 'dropbox accepterat');
assert(sim.brSupplyDrops.length === dropsBefore + 1, 'dropbox spawnade en supply-drop');
console.log('[OK] dropbox accepterat → supply-drop spawnad');

// Supply-drop: forcera landning + pickup → br_supply_opened + cash + dropbox done
const drop = sim.brSupplyDrops[sim.brSupplyDrops.length - 1];
drop.landAt = Date.now() - 1; // forcera landad
p0.playerState.x = drop.x; p0.playerState.y = drop.y;
const cashBeforeDrop = sim.brCash.p0 || 0;
sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
sim.simReadyAt = 0; tickSim(sim, Date.now());
assert(drop.opened, 'supply-drop öppnad vid pickup');
assert(collectEv('br_supply_opened').length >= 1, 'br_supply_opened emitterat');
assert((sim.brCash.p0 || 0) > cashBeforeDrop, 'supply-drop gav cash');
assert(!p0.playerState.brContract, 'dropbox-kontrakt slutfört vid pickup');
console.log('[OK] supply-drop: landning → pickup → epic loot + cash + dropbox done');

// BOUNTY-kontrakt → måltavla tilldelas
let bt = sim.brContracts.find(c => c.type === 'bounty' && c.available);
assert(bt, 'finns ett bounty-kontrakt');
p1.playerState.hp = 200;
p0.playerState.x = bt.x; p0.playerState.y = bt.y;
applyBrAcceptContract(sim, 'p0', bt.id);
assert(p0.playerState.brContract && p0.playerState.brContract.type === 'bounty' && p0.playerState.brContract.target === 'p1', 'bounty → p1 är måltavla');
console.log('[OK] bounty accepterat → måltavla tilldelad + pingas');
p0.playerState.brContract = null; // rensa inför kill-credit-testet nedan

// ===== FAS 5: alien-exklusiva varor =====
console.log('\n--- FAS 5: alien-shop exklusivt ---');
p0.playerState.x = alien[0].x; p0.playerState.y = alien[0].y; sim.brCash.p0 = 8000;
p0.playerState.brPerks = {}; p0.playerState.hp = 50; p0.playerState.shield = 0;
p0.playerState.maxHp = 200; p0.playerState.maxShield = 400; p0.playerState.armorLevel = 0;
applyBrBuy(sim, 'p0', 'alien_loadout');
assert(p0.playerState.hp === 200 && p0.playerState.shield === 400 && p0.playerState.armorLevel === 5, 'alien_loadout → full restore (hp200/shield400/armor5)');
applyBrBuy(sim, 'p0', 'alien_perks');
assert(['fast_hands', 'double_time', 'ghost', 'tracker', 'high_alert'].every(k => p0.playerState.brPerks[k]), 'alien_perks → alla 5 perks');
sim.eventQueue.length = 0; p0._sentMessages.length = 0;
applyBrBuy(sim, 'p0', 'alien_weapon');
assert(collectEv('br_supply_opened').find(e => e.peerId === 'p0' && e.weaponId), 'alien_weapon → top-tier-vapen-grant');
// alien-vara nekas vid VANLIG station
p0.playerState.x = stn.bounds.x + stn.bounds.w / 2; p0.playerState.y = stn.bounds.y + stn.bounds.h / 2;
sim.eventQueue.length = 0;
applyBrBuy(sim, 'p0', 'alien_loadout');
assert(sim.eventQueue.find(e => e.type === 'br_buy_fail' && e.reason === 'wrong_shop'), 'alien_loadout nekas vid vanlig station');
console.log('[OK] fas5: alien_loadout/perks/weapon (exklusiva, bara hos alien-shoppen)');

// KILL-CREDIT vid finish: p1 hp→0 utan kit + färsk angripare p0 → p0 krediteras
p1.playerState.brUavUntil = 0;
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
