// Smoke test: bot revives downed human teammate (fix for permanent soft-lock).
//
// Before fix: `updateRevive` skipped bots (ws._isBot continue) → bot stood next
// to the body forever, reviveTimer never ticked, human stuck downed indefinitely.
//
// After fix: bot within 50px revive-radius ticks the timer normally → human
// respawns at 50 HP after REVIVE_SEC (5 s).
//
// IMPORTANT notes on sim setup:
//   - loadStage() resets all member hp to 100 AND positions them to stage.spawnPos.
//     Set human.hp = 0 *after* loadStage, not before.
//   - Stage 1 spawnPos = {x:1000, y:2640}. addBot() places the bot at (1000,1000)
//     by default — that is 1640px away, beyond chooseReviveTarget's 750px scan
//     radius. Move the bot to stage spawnPos (or place human at bot position) after
//     addBot so the bot actually sees and targets the downed body.
//   - dt is faked by setting sim.lastTick = Date.now() - fakeDtMs before each
//     tickSim call. Each 33ms tick accumulates 0.033s on body.reviveTimer.
//     300 ticks × 0.033s = 9.9s > REVIVE_SEC(5s) → revive must complete.
//
// Run: node .github/workflows/bot-revive-smoke-test.js
'use strict';

const { createSim, tickSim } = require('../server/sim/room-sim');
const { loadStage } = require('../server/sim/waves');
const { addBot } = require('../server/sim/bots');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS:', label);
    passed++;
  } else {
    console.error('  FAIL:', label);
    failed++;
  }
}

// Run `n` ticks; each tick fakes dt = fakeDtMs/1000 by backdating sim.lastTick.
// Returns false if any tick throws.
function runTicks(sim, n, fakeDtMs) {
  for (let i = 0; i < n; i++) {
    sim.lastTick = Date.now() - fakeDtMs;
    try {
      tickSim(sim);
    } catch (e) {
      console.error('  CRASH at tick', i, ':', e.message, '\n', e.stack);
      failed++;
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal co-op story sim.
// Returns { sim, humanWs, room }.
// Caller should:
//   1. Optionally add bots via addBot(sim, ...)
//   2. Optionally position bots/human as needed
//   3. Set humanWs.playerState.hp = 0 (AFTER this call, since loadStage resets hp)
// ---------------------------------------------------------------------------
function buildSim() {
  // Stage 1 spawnPos is {x:1000, y:2640} — used below to position members.
  const SPAWN_X = 1000, SPAWN_Y = 2640;

  const eventsCapture = [];  // accumulates all JSON events sent to humanWs

  const room = {
    code: 'REVTEST',
    hostId: 'human1',
    members: new Map(),
  };

  const humanWs = {
    readyState: 1,
    send: (data) => {
      try {
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
          if (Array.isArray(msg.events)) eventsCapture.push(...msg.events);
        }
      } catch (_) {}
    },
    playerState: { x: SPAWN_X, y: SPAWN_Y, hp: 100, maxHp: 100, shield: 0, maxShield: 0, _history: [] },
    _isBot: false,
    tdmTeam: null,
    _serverRtt: 0,
    id: 'human1',
    name: 'TestHuman',
  };
  room.members.set('human1', humanWs);

  const sim = createSim(room);
  sim.config.mode = 'story';
  loadStage(sim, 1);   // resets hp→100, position→spawnPos, clears deadBodies
  sim.simReadyAt = 0;  // skip countdown
  sim.lastTick = Date.now();

  return { sim, humanWs, room, eventsCapture, SPAWN_X, SPAWN_Y };
}

// ---------------------------------------------------------------------------
// TEST 1: Bot revives downed human (the core fix).
//
// Setup: human at stage spawnPos, hp forced to 0 after loadStage.
//        Bot added and placed at spawnPos (0px away → inside 50px revive radius).
//        tickBots will keep the bot near the body (revive is its move target).
//        After 1 tick: deadBody created.
//        After 300 more ticks (9.9s): revive completes, hp=50, body gone.
// ---------------------------------------------------------------------------
console.log('\nTEST 1: Bot revives downed human');
{
  const { sim, humanWs, eventsCapture, SPAWN_X, SPAWN_Y } = buildSim();

  // Add bot, then override position to match human (spawnPos).
  addBot(sim, null, 'normal');
  const botId = sim._botIds[0];
  const botWs = sim.room.members.get(botId);
  botWs.playerState.x = SPAWN_X;
  botWs.playerState.y = SPAWN_Y;

  // Set human down AFTER loadStage (loadStage would have reset hp to 100).
  humanWs.playerState.hp = 0;
  humanWs.playerState.invulnUntil = 0;  // clear spawn-invuln so death-detect fires

  // Tick 1: death-detect creates body; updateRevive runs immediately after.
  runTicks(sim, 1, 33);
  assert(sim.deadBodies && sim.deadBodies['human1'] !== undefined,
    'deadBody created for downed human after first tick');

  // 300 more ticks = 9.9s > REVIVE_SEC (5s). Bot stays within 50px (desiredDist=30).
  runTicks(sim, 300, 33);

  assert(!sim.deadBodies['human1'],
    'deadBody removed after bot completes revive');
  assert(humanWs.playerState.hp === 50,
    'human revived to 50 HP');
  const revived = eventsCapture.some(ev => ev.type === 'player_revived' && ev.peerId === 'human1');
  assert(revived,
    'player_revived event fired (sent to clients)');
  const prog1 = eventsCapture.some(ev => ev.type === 'revive_progress' && ev.peerId === 'human1' && ev.progress === 1);
  assert(prog1,
    'revive_progress(1.0) event fired on completion');
}

// ---------------------------------------------------------------------------
// TEST 2: Human revives human — regression (must still work after fix).
// ---------------------------------------------------------------------------
console.log('\nTEST 2: Human revives human (regression)');
{
  const { sim, humanWs, room, eventsCapture, SPAWN_X, SPAWN_Y } = buildSim();

  // Second human, alive and close by.
  const human2Ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: SPAWN_X + 20, y: SPAWN_Y, hp: 100, maxHp: 100, shield: 0, _history: [] },
    _isBot: false,
    tdmTeam: null,
    _serverRtt: 0,
    id: 'human2',
    name: 'TestHuman2',
  };
  room.members.set('human2', human2Ws);

  humanWs.playerState.hp = 0;
  humanWs.playerState.invulnUntil = 0;

  runTicks(sim, 1, 33);
  assert(sim.deadBodies && sim.deadBodies['human1'] !== undefined,
    'deadBody created for downed human (regression setup)');

  runTicks(sim, 300, 33);

  assert(!sim.deadBodies['human1'],
    'deadBody removed after human teammate completes revive');
  assert(humanWs.playerState.hp === 50,
    'human revived to 50 HP by human reviver');
  const revived = eventsCapture.some(ev => ev.type === 'player_revived' && ev.peerId === 'human1');
  assert(revived,
    'player_revived event fired for human-to-human revive');
}

// ---------------------------------------------------------------------------
// TEST 3: Multiple revivers (two bots + a human) near body — no crash.
// ---------------------------------------------------------------------------
console.log('\nTEST 3: Multiple revivers (bot + human) — no crash');
{
  const { sim, humanWs, room, SPAWN_X, SPAWN_Y } = buildSim();

  // Two bots, both placed at spawnPos.
  addBot(sim, null, 'normal');
  addBot(sim, null, 'normal');
  for (const bid of sim._botIds) {
    const bw = sim.room.members.get(bid);
    bw.playerState.x = SPAWN_X;
    bw.playerState.y = SPAWN_Y;
  }

  // Second human at spawnPos.
  const human2Ws = {
    readyState: 1,
    send: () => {},
    playerState: { x: SPAWN_X, y: SPAWN_Y, hp: 100, maxHp: 100, shield: 0, _history: [] },
    _isBot: false,
    tdmTeam: null,
    _serverRtt: 0,
    id: 'human2',
    name: 'TestHuman2',
  };
  room.members.set('human2', human2Ws);

  humanWs.playerState.hp = 0;
  humanWs.playerState.invulnUntil = 0;

  const ok = runTicks(sim, 301, 33);
  assert(ok, 'no crash with multiple concurrent revivers');
  assert(!sim.deadBodies['human1'],
    'human1 still gets revived with multiple revivers present');
  assert(humanWs.playerState.hp === 50,
    'human revived to 50 HP with multiple revivers');
}

// ---------------------------------------------------------------------------
// TEST 4: Bot FAR from body does NOT advance revive timer while out of range.
// ---------------------------------------------------------------------------
console.log('\nTEST 4: Bot outside revive radius does NOT advance timer early');
{
  const { sim, humanWs, SPAWN_X, SPAWN_Y } = buildSim();

  // Add bot and place it 800px away (beyond chooseReviveTarget's 750px range).
  addBot(sim, null, 'normal');
  const botId = sim._botIds[0];
  const botWs = sim.room.members.get(botId);
  botWs.playerState.x = SPAWN_X;
  botWs.playerState.y = SPAWN_Y + 800;  // 800px south

  humanWs.playerState.hp = 0;
  humanWs.playerState.invulnUntil = 0;

  // Tick 1: create body.
  runTicks(sim, 1, 33);
  assert(sim.deadBodies && sim.deadBodies['human1'] !== undefined,
    'deadBody created while bot is out of range');

  // Run 5 ticks (0.165s). Bot is 800px away and chooseReviveTarget ignores it
  // (>750px). So the bot won't even start moving toward the body yet.
  // reviveTimer should stay at 0 (or decay back to 0 if a rounding edge appears).
  runTicks(sim, 5, 33);

  // Body must still exist.
  assert(sim.deadBodies['human1'] !== undefined,
    'body NOT revived while bot is still far away');
  const timerAfter = sim.deadBodies['human1'] ? sim.deadBodies['human1'].reviveTimer : null;
  // 5 ticks × 0.033s = 0.165s max. Even if bot somehow closed to <50px in 5 ticks
  // (impossible from 800px), timer < 1s.
  assert(timerAfter !== null && timerAfter < 1.0,
    `reviveTimer well below REVIVE_SEC while bot out of range (timer=${timerAfter !== null ? timerAfter.toFixed(3) : 'n/a'}s)`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All bot-revive smoke tests passed.');
