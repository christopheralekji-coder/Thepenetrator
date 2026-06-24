'use strict';
// BR FORTNITE PLANE-DROP — server state-maskin (buss → HOPPA → freefall → fallskärm →
// landning). Verifierar: predrop-init, br_started-payload, riders på bussen, applyBrJump,
// chute-deploy, landning på styrd pos, bot auto-hopp, auto-eject vid buss-ut, deadline-
// force-land + fas-rebase, ingen storm-skada i luften, air/dz i world-snapshotet.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim, applyBrJump } = RS;

function makeWs(id, isBot) {
  return {
    id, readyState: 1, _isBot: !!isBot, _jsonWorld: true, playerState: null, tdmTeam: null,
    stableSlot: null, _world: null, _events: [],
    send(m) {
      try {
        const o = typeof m === 'string' ? JSON.parse(m) : m;
        if (!o) return;
        if (o.type === 'world' && Array.isArray(o.players)) this._world = o;
        if (o.type === 'sim_events' && Array.isArray(o.events)) for (const e of o.events) this._events.push(e);
      } catch (_) {}
    },
  };
}
function mk(nHuman, nBot) {
  const members = new Map();
  let s = 0;
  for (let i = 0; i < nHuman; i++) { const ws = makeWs('p' + i, false); ws.stableSlot = s++; members.set('p' + i, ws); }
  for (let i = 0; i < (nBot || 0); i++) { const ws = makeWs('b' + i, true); ws.stableSlot = s++; members.set('b' + i, ws); }
  const sim = createSim({ code: 'PD', hostId: 'p0', members, meta: { mode: 'battleroyale' } });
  startSim(sim, { battleroyale: true, brPredrop: true, battleroyaleMatchDurationSec: 600 });
  return { sim, members };
}
function step(sim) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); }
function evOf(ws, t) { return (ws._events || []).filter(e => e && e.type === t); }
function slotEntry(ws, slot) { return ws._world ? (ws._world.players.find(p => p.c === slot) || null) : null; }

// 1. INIT: predrop aktivt, alla på bussen (brAir=1) vid buss-start; br_started-payload
{
  const { sim, members } = mk(2, 0);
  assert(sim.brPredrop === true, 'predrop aktivt');
  assert(sim.brBus && typeof sim.brBus.startX === 'number', 'buss-bana satt');
  for (const [, ws] of members) {
    assert(ws.playerState.brAir === 1, 'spelare på bussen (brAir=1)');
    assert(ws.playerState.x === sim.brBus.startX && ws.playerState.y === sim.brBus.startY, 'startar vid buss-start');
  }
  step(sim);  // br_started gick ut i första ticken (efter init pushades event)
  const p0 = members.get('p0');
  const bs = evOf(p0, 'br_started')[0];
  assert(bs && bs.predrop === true && bs.bus, 'br_started bär predrop + bus');
  assert(bs.bus.startX === sim.brBus.startX, 'bus-payload matchar');
  console.log('[OK] init: predrop, alla på bussen, br_started-payload korrekt');
}

// 2. JUMP → freefall (brAir=2) + br_jumped-event
{
  const { sim, members } = mk(2, 0);
  const p0 = members.get('p0');
  applyBrJump(sim, 'p0');
  assert(p0.playerState.brAir === 2, 'HOPPA → freefall (brAir=2)');
  assert(p0.playerState.brJumpedAt > 0, 'brJumpedAt satt');
  assert(sim.eventQueue.some(e => e.type === 'br_jumped' && e.peerId === 'p0'), 'br_jumped emitterat');
  // dubbel-jump ignoreras
  applyBrJump(sim, 'p0');
  assert(p0.playerState.brAir === 2, 'dubbel-jump idempotent');
  console.log('[OK] jump: bussen → freefall, idempotent');
}

// 3. CHUTE deploy efter freefall-tiden (brAir 2→3) + br_chute_deploy
{
  const { sim, members } = mk(2, 0);
  const p0 = members.get('p0');
  applyBrJump(sim, 'p0');
  p0.playerState.brJumpedAt = Date.now() - 3600;   // > BR_FREEFALL_MS (3500)
  step(sim);
  assert(p0.playerState.brAir === 3, 'fallskärm ute (brAir=3)');
  assert(evOf(p0, 'br_chute_deploy').length > 0, 'br_chute_deploy emitterat');
  console.log('[OK] chute: freefall → fallskärm auto-deploy');
}

// 4. LANDNING på STYRD position (människa landar där den flög, clampad)
{
  const { sim, members } = mk(2, 0);
  const p0 = members.get('p0');
  applyBrJump(sim, 'p0');
  // simulera att spelaren styrt dit i freefall
  p0.playerState.x = 4321; p0.playerState.y = 6543;
  p0.playerState.brJumpedAt = Date.now() - 7000;   // > FREEFALL+CHUTE (6500)
  step(sim);
  assert(p0.playerState.brAir === 0, 'landad (brAir=0)');
  assert(p0.playerState.x === 4321 && p0.playerState.y === 6543, 'landar på STYRD pos, fick ' + p0.playerState.x + ',' + p0.playerState.y);
  assert(evOf(p0, 'br_landed').length > 0, 'br_landed emitterat');
  console.log('[OK] landning: människa landar där den styrde');
}

// 5. BOT auto-hoppar och landar på spridd spawn (ej buss-start)
{
  const { sim, members } = mk(1, 1);
  const b0 = members.get('b0');
  assert(b0.playerState.brAir === 1, 'bot på bussen');
  const landX = b0.playerState.brLandX;
  b0.playerState._brBotJumpAt = Date.now() - 10;   // tvinga hopp nu
  step(sim);
  assert(b0.playerState.brAir === 2, 'bot auto-hoppade');
  b0.playerState.brJumpedAt = Date.now() - 7000;
  step(sim);
  assert(b0.playerState.brAir === 0, 'bot landade');
  assert(b0.playerState.x === landX, 'bot landar på spridd spawn (ej styrd), x=' + b0.playerState.x);
  console.log('[OK] bot: auto-hopp + landar på spridd spawn');
}

// 6. AUTO-EJECT: spelare som aldrig hoppar tvångshoppar när bussen lämnat kartan
{
  const { sim, members } = mk(1, 0);
  const p0 = members.get('p0');
  sim.brBus.startAt = Date.now() - (sim.brBus.durMs + 100);   // bussen har passerat
  step(sim);
  assert(p0.playerState.brAir === 2, 'tvångshopp vid buss-ut (brAir=2)');
  console.log('[OK] auto-eject: buss lämnar kartan → tvångshopp');
}

// 7. DEADLINE force-land → predrop slut, fas-klocka rebasad
{
  const { sim, members } = mk(2, 0);
  const p0 = members.get('p0');
  applyBrJump(sim, 'p0');
  sim.brPredropDeadlineAt = Date.now() - 10;    // deadline passerad
  const beforePhaseEnd = sim.battleroyalePhaseEndAt;
  step(sim);
  assert(sim.brPredrop === false, 'predrop avslutat vid deadline');
  for (const [, ws] of members) assert(ws.playerState.brAir === 0, 'alla landade vid deadline');
  assert(sim.battleroyalePhaseEndAt >= Date.now() + 1000, 'fas-0-klockan rebasad till landnings-tid');
  assert(sim.eventQueue.some(e => e.type === 'br_predrop_end') || evOf(p0, 'br_predrop_end').length > 0, 'br_predrop_end emitterat');
  console.log('[OK] deadline: force-land + predrop slut + fas-rebase');
}

// 8. INGEN storm-skada under predrop
{
  const { sim, members } = mk(1, 0);
  const p0 = members.get('p0');
  p0.playerState.hp = 100;
  // applyBrOutsideDamage är intern; verifiera via flera ticks att hp ej sjunker i luften
  for (let i = 0; i < 10; i++) step(sim);
  assert(p0.playerState.hp === 100, 'ingen skada medan på bussen, hp=' + p0.playerState.hp);
  console.log('[OK] ingen storm-/combat-skada under predrop');
}

// 9. WORLD-SNAPSHOT bär air (+ dz i luften) → fjärr-render + binär-codec
{
  const { sim, members } = mk(2, 0);
  const a = members.get('p0'), b = members.get('p1');
  applyBrJump(sim, 'p0');
  a.playerState.brJumpedAt = Date.now() - 1000;   // mitt i freefall
  for (let i = 0; i < 30; i++) step(sim);
  const e0 = slotEntry(b, 0);
  assert(e0 && (e0.air === 2 || e0.air === 3), 'p0 air-flagga i snapshot, fick ' + (e0 && e0.air));
  assert(e0 && typeof e0.dz === 'number' && e0.dz > 0, 'p0 dz i snapshot, fick ' + (e0 && e0.dz));
  const e1 = slotEntry(b, 1);
  assert(e1 && e1.air === 1, 'p1 fortfarande på bussen (air=1)');
  console.log('[OK] world-snapshot: air + dz speglas till andra spelare');
}

console.log('\n═══════════════════════════════════════');
console.log('  BR FORTNITE PLANE-DROP server smoke PASSED');
console.log('═══════════════════════════════════════');
