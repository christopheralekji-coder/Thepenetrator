'use strict';
// CD: down/revive SELF-HEALING via world-snapshot (user: "I want it bulletproof").
// Verifierar att den auktoritativa down-staten (cdDowned/cdDownDead/bleed/revive) speglas
// i 'world'-paketet till Godot/JSON-peers → late-joiners + paket-tapp ser markörerna.
const assert = require('assert');
const RS = require('./sim/room-sim');
const { createSim, startSim, tickSim } = RS;

function makeWs(id) {
  return {
    id, readyState: 1, _isBot: false, _jsonWorld: true, playerState: null, tdmTeam: null,
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
function mk(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) { const ws = makeWs('p' + i); ws.stableSlot = i; members.set('p' + i, ws); }
  const sim = createSim({ code: 'SN' + n, hostId: 'p0', members, meta: { mode: 'castledefense' } });
  startSim(sim, { castledefense: true });
  for (const [, ws] of members) ws.playerState.hp = 100;
  return { sim, members };
}
// steg + kör broadcast tillräckligt många gånger för att JSON-nedsamplingen ska ge ett world-paket
function pump(sim, n) { for (let i = 0; i < n; i++) { sim.simReadyAt = 0; sim.lastTick = Date.now() - 50; tickSim(sim); } }
function slotEntry(ws, slot) {
  if (!ws._world) return null;
  return ws._world.players.find(p => p.c === slot) || null;
}

// 1. DOWNED player surfaces in the world-snapshot to OTHER peers (cdD + bleed + revive)
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2400; b.playerState.y = 2000;   // up, far → no auto-revive
  a.playerState.hp = 0;                              // p0 goes down
  pump(sim, 30);
  // p1 (the would-be reviver / late observer) must SEE p0 down in its world packet
  const e0 = slotEntry(b, 0);
  assert(e0, 'p0 present in p1 world packet');
  assert(e0.cdD === 1, 'cdD=1 in snapshot (downed), got ' + JSON.stringify(e0));
  assert(typeof e0.cdBR === 'number' && e0.cdBR > 0, 'cdBR (bleed-out ms remaining) > 0, got ' + e0.cdBR);
  assert(typeof e0.cdRP === 'number' && e0.cdRP >= 0, 'cdRP (revive progress 0..1) present, got ' + e0.cdRP);
  console.log('[OK] downed player serialized into world-snapshot (cdD/cdBR/cdRP)');
}

// 2. revive progress shows up in cdRP when a teammate is nearby
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2010; b.playerState.y = 2000;   // within 60px → accumulates progress
  a.playerState.hp = 0;
  pump(sim, 1);   // enter down
  for (let i = 0; i < 30; i++) { b.playerState.x = 2010; b.playerState.y = 2000; pump(sim, 1); }
  const e0 = slotEntry(b, 0);
  assert(e0 && (e0.cdD === 1 || e0.cdDD === 1), 'p0 still tracked');
  if (e0.cdD === 1) assert(e0.cdRP > 0, 'revive progress > 0 while teammate adjacent, got ' + e0.cdRP);
  console.log('[OK] revive progress (cdRP) reflected in snapshot while reviving');
}

// 3. NOT downed → no cd fields (0 extra bytes for healthy players)
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 2400; b.playerState.y = 2000;
  pump(sim, 30);
  const e0 = slotEntry(b, 0);
  assert(e0, 'p0 present');
  assert(e0.cdD === undefined && e0.cdDD === undefined && e0.cdBR === undefined && e0.cdRP === undefined,
    'healthy player carries NO cd-down fields, got ' + JSON.stringify(e0));
  console.log('[OK] healthy player carries no down fields (byte-clean)');
}

// 4. bleed-out → cdDD=1 in snapshot (dead, awaiting respawn), with a 2nd player up (no defeat)
{
  const { sim, members } = mk(2);
  const a = members.get('p0'), b = members.get('p1');
  a.playerState.x = 2000; a.playerState.y = 2000;
  b.playerState.x = 100; b.playerState.y = 100; b.playerState.hp = 100;
  a.playerState.hp = 0;
  pump(sim, 1);
  a.playerState.cdDownStartedAt = Date.now() - 31000;   // past 30s bleed-out
  pump(sim, 30);
  const e0 = slotEntry(b, 0);
  assert(e0 && e0.cdDD === 1, 'dead player surfaces as cdDD=1, got ' + JSON.stringify(e0));
  console.log('[OK] bled-out player serialized as cdDD=1 (self-healing dead marker)');
}

console.log('\n═══════════════════════════════════════');
console.log('  CD down/revive SELF-HEALING snapshot smoke PASSED');
console.log('═══════════════════════════════════════');
