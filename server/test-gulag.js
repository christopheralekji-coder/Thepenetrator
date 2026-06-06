// Fokuserat unit-test för Gulag-modulen (server/sim/gulag.js).
// Stubbar en minimal sim och kör kö → parning → duell → resolve för alla 6 spel.
'use strict';
const { enterGulag, gulagMatchmake, tickGulag, voidAllGulag } = require('./sim/gulag');
const { GULAG_GAMES } = require('../shared/gulag-arenas');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ❌ ' + msg); } }

function makeSim() {
  return {
    room: { members: new Map() },
    eventQueue: [],
    battleroyaleAliveCount: 2,
    battleroyaleEliminated: [],
    battleroyaleRanks: {},
    tdmDeathsByPid: {},
    battleroyaleZone: { x: 5000, y: 5000, r: 1500 },
    _brArena: { worldW: 10000, worldH: 10000 },
  };
}
function addPlayer(sim, pid) {
  sim.room.members.set(pid, { playerState: { x: 100, y: 100, hp: 0, shield: 0, weaponId: 'pistol', gulagUsed: false } });
}
function evs(sim, type) { return sim.eventQueue.filter(e => e.type === type); }

// Sätt upp en parad match och TVINGA ett specifikt spel (bygger om geo korrekt — i
// verkligheten matchar gameId+geo alltid eftersom startGulagMatch bygger båda ihop).
function pairedMatch(sim, gameId, now) {
  addPlayer(sim, 'A'); addPlayer(sim, 'B');
  enterGulag(sim, 'A', sim.room.members.get('A'));
  enterGulag(sim, 'B', sim.room.members.get('B'));
  gulagMatchmake(sim, now);
  const m = sim.gulagMatches[0];
  const game = GULAG_GAMES[gameId];
  m.gameId = gameId;
  m.geo = game.build(m.origin.x, m.origin.y);
  m.platformR = m.geo.platformR || 0;
  m.ringR = m.geo.ringR || 0;
  m.fallenTiles = []; m.tileStandSince = {};
  m.nextTileFallAt = game.fallStartMs ? now + game.fallStartMs : 0;
  m.bombHolder = null; m.bombEndsAt = 0; m.bombPassReadyAt = 0;
  m.powerups = []; m.nextPowerupAt = game.powerupEverMs ? now + 1800 : 0;
  const lo = game.loadout;
  [m.a, m.b].forEach((pid, idx) => {
    const ps = sim.room.members.get(pid).playerState;
    const sp = m.geo.spawns[idx];
    ps.x = sp.x; ps.y = sp.y; ps.hp = lo.hp; ps.shield = lo.shield || 0;
    ps._gulagGame = gameId; ps._gulagWeapon = lo.weaponId; ps._gulagNoShoot = !!game.noShoot;
  });
  if (gameId === 'bombtag') { m.bombHolder = m.a; m.bombEndsAt = now + game.bombMs; m.bombPassReadyAt = now + 1300; }
  return m;
}

// ---- T1: kö + parning ----
(function () {
  const sim = makeSim();
  addPlayer(sim, 'A'); addPlayer(sim, 'B');
  enterGulag(sim, 'A', sim.room.members.get('A'));
  enterGulag(sim, 'B', sim.room.members.get('B'));
  ok(sim.gulagQueue.length === 2, 'T1: 2 i kö');
  ok(sim.room.members.get('A').playerState.spectating === true, 'T1: köad spectar');
  ok(sim.room.members.get('A').playerState.gulagUsed === true, 'T1: gulagUsed satt');
  gulagMatchmake(sim, 1000);
  ok(sim.gulagQueue.length === 0, 'T1: kö tömd');
  ok(sim.gulagMatches.length === 1, 'T1: 1 aktiv match');
  ok(evs(sim, 'gulag_start').length === 1, 'T1: gulag_start sänt');
  const m = sim.gulagMatches[0];
  ok(sim.room.members.get('A').playerState.gulagState === 'fighting', 'T1: A fighting');
  ok(sim.room.members.get('A').playerState.x < -30000, 'T1: A off-map');
  ok(sim.room.members.get('A').playerState.hp === GULAG_GAMES[m.gameId].loadout.hp, 'T1: loadout-hp');
})();

// ---- T3: hp-död resolve (oneshot/frenzy/blade) ----
(function () {
  for (const g of ['oneshot', 'frenzy', 'blade']) {
    const sim = makeSim();
    const m = pairedMatch(sim, g, 1000);
    sim.room.members.get('B').playerState.hp = 0; // B dör
    sim.eventQueue = [];
    tickGulag(sim, 0.05, 1100);
    const aPs = sim.room.members.get('A').playerState, bPs = sim.room.members.get('B').playerState;
    ok(aPs.gulagState === null, `T3[${g}]: vinnare A ur gulag`);
    ok(aPs.hp === 75 && aPs.shield === 25, `T3[${g}]: A redeploy 75/25`);
    ok(aPs.x >= 60 && aPs.x <= 9940, `T3[${g}]: A inom kartan`);
    ok(bPs.gulagState === null && bPs.spectating === true, `T3[${g}]: B spectar`);
    ok(sim.battleroyaleEliminated.includes('B'), `T3[${g}]: B eliminerad`);
    ok(sim.battleroyaleAliveCount === 1, `T3[${g}]: aliveCount -1`);
    ok(evs(sim, 'gulag_won').length === 1 && evs(sim, 'gulag_lost').length === 1, `T3[${g}]: won+lost`);
  }
})();

// ---- T4: The Void fall ----
(function () {
  const sim = makeSim();
  const m = pairedMatch(sim, 'void', 1000);
  const bPs = sim.room.members.get('B').playerState;
  bPs.x = m.geo.platformX + 5000; bPs.y = m.geo.platformY;
  sim.eventQueue = [];
  tickGulag(sim, 0.05, 1100);
  ok(sim.room.members.get('A').playerState.hp === 75, 'T4: A vann när B föll');
  ok(sim.battleroyaleEliminated.includes('B'), 'T4: B föll i tomheten');
})();

// ---- T5: Bomb Tag briserar ----
(function () {
  const sim = makeSim();
  const m = pairedMatch(sim, 'bombtag', 1000);
  m.bombHolder = 'A'; m.bombEndsAt = 2000;
  sim.eventQueue = [];
  tickGulag(sim, 0.05, 3000);
  ok(sim.battleroyaleEliminated.includes('A'), 'T5: bomb-hållare A förlorar');
  ok(sim.room.members.get('B').playerState.hp === 75, 'T5: B vinner');
})();

// ---- T6: Floor is Lava hål ----
(function () {
  const sim = makeSim();
  const m = pairedMatch(sim, 'floorlava', 1000);
  sim.room.members.get('A').playerState.x = m.geo.gridX - 5000;
  sim.room.members.get('A').playerState.y = m.geo.gridY - 5000;
  sim.eventQueue = [];
  tickGulag(sim, 0.05, 1100);
  ok(sim.battleroyaleEliminated.includes('A'), 'T6: A (över hål) förlorar');
  ok(sim.room.members.get('B').playerState.hp === 75, 'T6: B vinner');
})();

// ---- T7: backstop timeout tiebreak ----
(function () {
  const sim = makeSim();
  const m = pairedMatch(sim, 'oneshot', 1000);
  sim.room.members.get('A').playerState.hp = 5; // mer hp → vinner
  sim.room.members.get('B').playerState.hp = 1;
  sim.eventQueue = [];
  tickGulag(sim, 0.05, 1000 + GULAG_GAMES.oneshot.maxMs + 1000);
  ok(sim.gulagMatches.length === 0, 'T7: match avslutad vid timeout');
  ok(sim.battleroyaleEliminated.length === 1, 'T7: 1 eliminerad');
  ok(sim.battleroyaleEliminated[0] === 'B', 'T7: lägre hp (B) förlorar tiebreak');
})();

// ---- T8: voidAllGulag städar ----
(function () {
  const sim = makeSim();
  pairedMatch(sim, 'oneshot', 1000);
  voidAllGulag(sim);
  ok(sim.gulagMatches.length === 0 && sim.gulagQueue.length === 0, 'T8: gulag tömd');
  ok(sim.room.members.get('A').playerState.gulagState === null, 'T8: ingen gulag-state kvar');
})();

// ---- T9: deadlock-skydd — ensam köad + ≤1 på kartan → walkover-förlust efter grace ----
(function () {
  const sim = makeSim();
  addPlayer(sim, 'A'); addPlayer(sim, 'B');
  sim.battleroyaleAliveCount = 2;
  sim.room.members.get('A').playerState.hp = 100; // A lever på kartan
  // B dör → köas ensam
  enterGulag(sim, 'B', sim.room.members.get('B'));
  gulagMatchmake(sim, 1000); // onMapAlive=1, sätter _gulagLoneSince
  ok(sim.gulagQueue.length === 1, 'T9: B ensam i kö (ingen att paras med)');
  ok(!sim.battleroyaleEliminated.includes('B'), 'T9: B EJ eliminerad direkt (grace)');
  gulagMatchmake(sim, 1000 + 3000); // efter grace
  ok(sim.battleroyaleEliminated.includes('B'), 'T9: B walkover-elimineras efter grace');
  ok(sim.battleroyaleAliveCount === 1, 'T9: aliveCount=1 → win-check kan avgöra matchen');
  ok(sim.gulagQueue.length === 0, 'T9: kö tömd');
})();

// ---- T10: ensam köad MEN fler kvar på kartan → väntar (paras ej, elimineras ej) ----
(function () {
  const sim = makeSim();
  addPlayer(sim, 'A'); addPlayer(sim, 'B'); addPlayer(sim, 'C');
  sim.battleroyaleAliveCount = 3;
  sim.room.members.get('A').playerState.hp = 100;
  sim.room.members.get('C').playerState.hp = 100; // 2 kvar på kartan
  enterGulag(sim, 'B', sim.room.members.get('B'));
  gulagMatchmake(sim, 1000);
  gulagMatchmake(sim, 1000 + 5000); // även efter lång tid
  ok(!sim.battleroyaleEliminated.includes('B'), 'T10: B väntar (möjlig opponent finns kvar)');
  ok(sim.gulagQueue.length === 1, 'T10: B kvar i kö');
})();

console.log(`\nGULAG-TEST: ${pass} OK, ${fail} fel`);
process.exit(fail > 0 ? 1 : 0);
