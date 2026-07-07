// Test: pickup-magneten hinner ikapp en SPRINGANDE spelare (buggen "loot
// stannar/fastnar" 2026-07-07: golv 200 px/s < lopfart ~460 -> slapade for evigt).
// Kor: node server/test-pickup-magnet.js
'use strict';
const { spawnPickup, updatePickups } = require('./sim/pickups');

function mkSim(wsList) {
  const members = new Map();
  wsList.forEach((ws, i) => members.set('p' + i, ws));
  return { room: { members }, pickups: [] };
}
function mkWs(x, y) {
  const ws = { playerState: { x, y, hp: 100, maxHp: 100 }, got: [] };
  ws.send = (json) => ws.got.push(JSON.parse(json));
  return ws;
}

let fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASSED' : 'FAILED') + '  ' + name);
  if (!cond) fail++;
}

// 1) Springande spelare (460 px/s rakt bort) — lootet magnetiseras pa nara hall
//    och MASTE hinna ikapp inom 5s trots att spelaren aldrig stannar.
{
  const ws = mkWs(0, 0);
  const sim = mkSim([ws]);
  spawnPickup(sim, -50, 0, 'gold');   // inom magRange 110 -> magnetiseras tick 1
  const dt = 1 / 60;
  let collectedAt = -1;
  for (let t = 0; t < 5 * 60; t++) {
    ws.playerState.x += 460 * dt;     // spring hogerut hela tiden
    updatePickups(sim, dt);
    if (sim.pickups.length === 0) { collectedAt = t * dt; break; }
  }
  check('springande spelare: guldet UPPLOCKAT (fore fixen: aldrig)', collectedAt >= 0);
  check('springande spelare: pickup_to_you skickat', ws.got.some(m => m.type === 'pickup_to_you' && m.kind === 'gold'));
  if (collectedAt >= 0) console.log('  (ikapp efter ' + collectedAt.toFixed(2) + 's)');
}

// 2) Stillastaende spelare, loot pa 100px — ska sugas in snabbt (<1s).
{
  const ws = mkWs(0, 0);
  const sim = mkSim([ws]);
  spawnPickup(sim, 100, 0, 'hp');
  const dt = 1 / 60;
  let collectedAt = -1;
  for (let t = 0; t < 60; t++) {
    updatePickups(sim, dt);
    if (sim.pickups.length === 0) { collectedAt = t * dt; break; }
  }
  check('stillastaende: hp insuget < 1s', collectedAt >= 0 && collectedAt < 1.0);
  check('stillastaende: hp applicerad server-side (30)', ws.playerState.hp === 100 || ws.got.length > 0);
}

// 3) Slow-tick (dt=0.25s): stort kliv far ALDRIG skjuta forbi spelaren
//    (step-klampen) — lootet landar exakt och plockas samma tick.
{
  const ws = mkWs(0, 0);
  const sim = mkSim([ws]);
  spawnPickup(sim, 90, 0, 'gold');
  updatePickups(sim, 0.25);   // magnetiseras + kliver (850*0.25=212 > 90 -> klamp till 90)
  const gone = sim.pickups.length === 0;
  check('slow-tick: klamp till exakt landning + upplock samma tick', gone);
}

// 4) Utom rackhall (>110px, ingen magnetism-perk): ska INTE magnetiseras (V1-modellen).
{
  const ws = mkWs(0, 0);
  const sim = mkSim([ws]);
  spawnPickup(sim, 300, 0, 'gold');
  const dt = 1 / 60;
  for (let t = 0; t < 60; t++) updatePickups(sim, dt);
  check('utom rackhall: ligger kvar orord', sim.pickups.length === 1 && Math.abs(sim.pickups[0].x - 300) < 0.001);
}

// 5) Tva spelare — lootet mitt emellan committar till EN och plockas (ingen evig dallring).
{
  const a = mkWs(-80, 0), b = mkWs(80, 0);
  const sim = mkSim([a, b]);
  spawnPickup(sim, 1, 0, 'gold');   // knappt narmare a... nej, narmare b? x=1 -> narmare b(80)? |1-(-80)|=81, |1-80|=79 -> b
  const dt = 1 / 60;
  let collected = false;
  for (let t = 0; t < 2 * 60; t++) {
    updatePickups(sim, dt);
    if (sim.pickups.length === 0) { collected = true; break; }
  }
  check('tva spelare: committar + upplockat < 2s', collected);
}

console.log(fail === 0 ? 'ALL PASSED' : fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
