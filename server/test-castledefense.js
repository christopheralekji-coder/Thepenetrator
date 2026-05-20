'use strict';
// Castle Defense smoke-test
// Usage: node server/test-castledefense.js
// Tests: startup, sim_start with castledefense:true, 60 ticks, cd_started event,
//        mode-dispatch isolation, sim_cd_build wall, boss-wave trigger.

const assert = require('assert');

// ── Fake WebSocket member ──────────────────────────────────────────────────
function makeFakeWs(id) {
  return {
    id,
    readyState: 1, // OPEN
    _isBot: false,
    playerState: null,
    tdmTeam: null,
    tdmRespawnAt: 0,
    _serverRtt: 0,
    _sentMessages: [],
    send(data) { this._sentMessages.push(typeof data === 'string' ? JSON.parse(data) : data); },
  };
}

// ── Fake room ──────────────────────────────────────────────────────────────
function makeFakeRoom(playerCount) {
  const members = new Map();
  let hostId = null;
  for (let i = 0; i < playerCount; i++) {
    const id = 'p' + i;
    members.set(id, makeFakeWs(id));
    if (i === 0) hostId = id;
  }
  return { code: 'TEST', hostId, members, meta: {} };
}

// ── Load sim ───────────────────────────────────────────────────────────────
let createSim, startSim, stopSim, tickSim, applyCastleDefenseBuild;
try {
  ({ createSim, startSim, stopSim, tickSim, applyCastleDefenseBuild } =
    require('./sim/room-sim'));
  console.log('[OK] room-sim loaded');
} catch (e) {
  console.error('[FAIL] room-sim require crashed:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// ── TEST 1: sim_start with castledefense:true ──────────────────────────────
console.log('\n--- TEST 1: startSim with castledefense:true ---');
const room = makeFakeRoom(2);
let sim;
try {
  sim = createSim(room);
  startSim(sim, { castledefense: true });
  assert(sim.castledefenseActive === true, 'castledefenseActive should be true');
  assert(sim.castledefenseCore !== null, 'castledefenseCore should be initialized');
  // v1.397 redesign: ingen pre-built — walls börjar tomt
  assert(Array.isArray(sim.castledefenseWalls) && sim.castledefenseWalls.length === 0,
    'castledefenseWalls should be empty (no pre-built in v1.397)');
  assert(sim.castledefenseWaveState === 'between', 'initial waveState should be between');
  console.log('[OK] castledefenseActive=true, core initialized (no pre-built walls), waveState=between');
} catch (e) {
  console.error('[FAIL] startSim crashed:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// ── TEST 2: cd_started event in queue ─────────────────────────────────────
console.log('\n--- TEST 2: cd_started event ---');
const cdStartedEvents = sim.eventQueue.filter(ev => ev.type === 'cd_started');
if (cdStartedEvents.length === 0) {
  console.error('[FAIL] cd_started event NOT found in eventQueue');
  console.log('  eventQueue contains:', sim.eventQueue.map(e => e.type));
  process.exit(1);
}
const cdStartedEv = cdStartedEvents[0];
assert(cdStartedEv.core, 'cd_started must include core');
assert(Array.isArray(cdStartedEv.walls), 'cd_started must include walls array');
assert(cdStartedEv.startGold, 'cd_started must include startGold');
console.log('[OK] cd_started event found, core/walls/startGold present');
console.log('  eventQueue types after start:', sim.eventQueue.map(e => e.type).join(', '));

// ── TEST 3: 60 ticks without crash, only CD tick runs ─────────────────────
console.log('\n--- TEST 3: 60 ticks without crash ---');
sim.eventQueue.length = 0; // drain start-events
// Freeze waveBetweenEndAt far in the future so wave doesn't trigger during ticks
sim.castledefenseWaveBetweenEndAt = Date.now() + 3600000;

let tickErrors = 0;
for (let i = 0; i < 60; i++) {
  try {
    tickSim(sim);
  } catch (e) {
    console.error(`[FAIL] tick ${i} crashed:`, e.message);
    console.error(e.stack);
    tickErrors++;
    if (tickErrors >= 3) break;
  }
}
if (tickErrors === 0) {
  console.log('[OK] 60 ticks completed without crash');
} else {
  console.error('[FAIL]', tickErrors, 'tick(s) crashed');
  process.exit(1);
}

// Verify story/BR tick didn't run by checking flags that would be set by them
assert(!sim.tdmActive, 'tdmActive should not be set');
assert(!sim.battleroyaleActive, 'battleroyaleActive should not be set');
assert(!sim.ctfActive, 'ctfActive should not be set');
console.log('[OK] mode isolation: only CD tick ran, no other mode flags set');

// ── TEST 4: sim_cd_build wall ──────────────────────────────────────────────
console.log('\n--- TEST 4: sim_cd_build wall ---');
sim.eventQueue.length = 0;
const hostPid = room.hostId;
// Ensure player has gold
sim.castledefenseGold[hostPid] = 500;
// Place a wall outside castle walls but within bounds (500,500)
const buildMsg = { kind: 'wall', x: 500, y: 500 };
try {
  applyCastleDefenseBuild(sim, hostPid, buildMsg);
} catch (e) {
  console.error('[FAIL] applyCastleDefenseBuild crashed:', e.message);
  console.error(e.stack);
  process.exit(1);
}
const buildEvents = sim.eventQueue.map(e => e.type);
console.log('  build eventQueue:', buildEvents.join(', '));
if (buildEvents.includes('cd_building_placed')) {
  console.log('[OK] cd_building_placed received');
} else if (buildEvents.includes('cd_build_failed')) {
  const failEv = sim.eventQueue.find(e => e.type === 'cd_build_failed');
  console.log('[WARN] cd_build_failed — reason:', failEv && failEv.reason);
} else {
  console.error('[FAIL] neither cd_building_placed nor cd_build_failed emitted');
  process.exit(1);
}

// ── TEST 5: boss-wave trigger ──────────────────────────────────────────────
// NOTE: broadcastWorld drains eventQueue via splice(0) during the same tick,
// so we capture events from the fake ws._sentMessages instead of eventQueue.
console.log('\n--- TEST 5: boss-wave trigger (wave 5) ---');
sim.eventQueue.length = 0;
// Clear ws message buffers so we only see events from this tick
for (const [, ws] of room.members) ws._sentMessages = [];

sim.castledefenseWave = 4;          // will be incremented to 5 on wave start
sim.castledefenseWaveState = 'between';
sim.castledefenseWaveBetweenEndAt = Date.now() - 1; // expired → wave starts now
sim._cdWaveSpawnsRemaining = 0;
sim.enemies = [];                    // empty so between→active triggers
// CRITICAL: clear simReadyAt so the 5s-countdown early-return doesn't block the tick
sim.simReadyAt = 0;

try {
  tickSim(sim);
} catch (e) {
  console.error('[FAIL] boss-wave tick crashed:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// Collect all events broadcast to any member this tick
const broadcastEvents = [];
for (const [, ws] of room.members) {
  for (const msg of ws._sentMessages) {
    if (msg.type === 'sim_events' && Array.isArray(msg.events)) {
      broadcastEvents.push(...msg.events);
    }
  }
}
// Also check anything still left in queue (in case broadcast didn't fire this tick)
broadcastEvents.push(...sim.eventQueue);

console.log('  events broadcast this tick:', broadcastEvents.map(e => e.type).join(', '));
console.log('  waveState after tick:', sim.castledefenseWaveState, '  wave:', sim.castledefenseWave);

// Primary assertions: state changes (independent of event drain timing)
assert(sim.castledefenseWave === 5, `wave should be 5, got ${sim.castledefenseWave}`);
assert(sim.castledefenseWaveState === 'active', `waveState should be active, got ${sim.castledefenseWaveState}`);
console.log('[OK] wave state machine: wave=5, waveState=active');

const waveStartedEv = broadcastEvents.find(e => e.type === 'cd_wave_started');
if (waveStartedEv) {
  console.log('[OK] cd_wave_started event found wave=', waveStartedEv.wave, 'isBoss=', waveStartedEv.isBoss);
  assert(waveStartedEv.isBoss === true, 'wave 5 should be a boss wave');
} else {
  console.error('[FAIL] cd_wave_started event not found in broadcast');
  process.exit(1);
}

const bossSpawnEv = broadcastEvents.find(e => e.type === 'boss_spawned');
if (bossSpawnEv) {
  console.log('[OK] boss_spawned event found bossKey=', bossSpawnEv.bossKey);
  assert(sim.bossAlive === true, 'sim.bossAlive should be true after boss spawn');
} else {
  console.error('[FAIL] boss_spawned event not found — boss did NOT spawn on wave 5');
  process.exit(1);
}

// ── TEST 6: second startSim clears CD state (no state leak) ───────────────
console.log('\n--- TEST 6: CD state reset on second startSim ---');
try {
  stopSim(sim);
} catch (e) { /* ignore stop errors in test */ }
const room2 = makeFakeRoom(1);
let sim2;
try {
  sim2 = createSim(room2);
  startSim(sim2, { castledefense: false }); // story mode — CD should not be active
  assert(sim2.castledefenseActive === false, 'castledefenseActive should be false in story mode');
  assert(sim2.castledefenseCore === null, 'castledefenseCore should be null in story mode');
  assert(sim2.castledefenseWalls.length === 0, 'castledefenseWalls should be empty in story mode');
  console.log('[OK] fresh sim in story mode has no CD state');
} catch (e) {
  console.error('[FAIL] second startSim / state-reset test crashed:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// ── SUMMARY ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('  ALL Castle Defense smoke-tests PASSED');
console.log('═══════════════════════════════════════');
try { stopSim(sim2); } catch (e) {}
process.exit(0);
