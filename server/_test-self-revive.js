'use strict';
// Smoke-test: self-revive downed→revive-cycle (v1.749)
//
// OBS: dt ≈ 0 i synkrona tick-anrop (sim.lastTick = Date.now() vid createSim/startSim).
// Zone-damage är dt-baserad (dmg/s * dt) → för att testa den, sätt lastTick bakåt
// med 16.7ms (= 1 tick @ 60Hz) inför varje tickSim-anrop.
//
// Testar tre scenarier:
//   A) Happy path — innanför zon → downed + auto-revive
//   B) Bugg-repro — utanför zon (storm), downed med hp=1 → storm nollar hp → elimineras
//   B2) Downed+revive-timer slut MEN utanför zon → tickBrMeta-revive-check missar (hp=0)

const assert = require('assert');
const { BATTLEROYALE_ARENA } = require('../shared/battleroyale-arena');
const { createSim, startSim, tickSim } = require('./sim/room-sim');

function makeFakeWs(id) {
  return {
    id,
    readyState: 1,
    _isBot: false,
    playerState: null,
    tdmTeam: null,
    tdmRespawnAt: 0,
    _serverRtt: 0,
    _sentMessages: [],
    send(d) { this._sentMessages.push(typeof d === 'string' ? JSON.parse(d) : d); }
  };
}

function makeFakeRoom(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) members.set('p' + i, makeFakeWs('p' + i));
  return { code: 'BRTEST', hostId: 'p0', members, meta: {} };
}

// Kör tickSim med ett realistiskt dt (16.7ms @ 60Hz) genom att sätta lastTick bakåt.
function tickSimWithDt(sim, dtMs) {
  sim.lastTick = Date.now() - dtMs;
  tickSim(sim);
}

// Samla events av typ från eventQueue + sända msgs
function collectEv(sim, ws_arr, type) {
  const out = [];
  for (const e of sim.eventQueue) if (e.type === type) out.push(e);
  for (const ws of ws_arr) {
    for (const m of ws._sentMessages) {
      if (m && m.type === type) out.push(m);
      if (m && Array.isArray(m.events)) for (const e of m.events) if (e.type === type) out.push(e);
    }
  }
  return out;
}

// Sätt zone: liten radie runt centrum, fas=1 (outsideDmg=4/s)
function setupZone(sim, phase) {
  const arena = BATTLEROYALE_ARENA;
  const cx = arena.worldW / 2;
  const cy = arena.worldH / 2;
  sim.battleroyaleZone = { x: cx, y: cy, r: 100, startX: cx, startY: cy, startR: 100, nextR: null };
  sim.battleroyalePhase = phase !== undefined ? phase : 1;
  sim.battleroyalePhaseEndAt = Date.now() + 9999999;
  sim.battleroyalePhaseStartedAt = Date.now() - 1000;
}

let passed = 0;
let failed = 0;
function ok(label) { console.log('[OK] ' + label); passed++; }
function fail(label) { console.log('[FAIL] ' + label); failed++; }
function info(label) { console.log('  [INFO] ' + label); }

// ==========================================
// SCENARIO A: Happy path (innanför zon)
// ==========================================
console.log('\n=== SCENARIO A: Happy path (innanför zon, hp→0 → downed → revived) ===');
{
  const room = makeFakeRoom(2);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');
  const p1 = room.members.get('p1');
  p1.playerState.hp = 100;

  setupZone(sim, 0); // LOOT-fas, outsideDmg=0 (irrelevant — p0 är innanför)
  p0.playerState.x = sim.battleroyaleZone.x;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 0;
  p0.playerState.selfReviveKits = 1;
  p0.playerState.brDowned = false;

  sim.eventQueue.length = 0;
  tickSimWithDt(sim, 16);

  if (p0.playerState.brDowned === true) {
    ok('A1: hp=0 + kit → DOWNED (brDowned=true)');
  } else {
    fail('A1: p0 ej downed — brDowned=' + p0.playerState.brDowned + ', eliminated=' + sim.battleroyaleEliminated.includes('p0'));
  }
  if (p0.playerState.hp === 1) ok('A2: downed hp=1'); else fail('A2: downed hp=' + p0.playerState.hp);
  if (p0.playerState.selfReviveKits === 0) ok('A3: kit förbrukad (kits=0)'); else fail('A3: kits=' + p0.playerState.selfReviveKits);
  if (!sim.battleroyaleEliminated.includes('p0')) ok('A4: p0 EJ eliminerad'); else fail('A4: p0 eliminerades!');
  if (collectEv(sim, [p0, p1], 'br_downed').length >= 1) ok('A5: br_downed event emitterat'); else fail('A5: br_downed event saknas');

  // Forcera revive-timer förbi → revive
  p0.playerState.brReviveEnd = Date.now() - 50;
  sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
  tickSimWithDt(sim, 16);

  if (p0.playerState.brDowned === false) ok('A6: revived (brDowned=false)'); else fail('A6: ej revivad, brDowned=' + p0.playerState.brDowned);
  if (p0.playerState.hp === 50) ok('A7: revived hp=50'); else fail('A7: revived hp=' + p0.playerState.hp);
  if (collectEv(sim, [p0, p1], 'br_revived').length >= 1) ok('A8: br_revived event emitterat'); else fail('A8: br_revived event saknas');
}

// ==========================================
// SCENARIO B: Bugg-repro — downed utanför zon (zone-damage)
// dt=16.7ms, outsideDmg=4/s → 0.067 HP per tick
// downed hp=1 → behöver ~15 ticks (0.25s) för att dö av zone
// ==========================================
console.log('\n=== SCENARIO B: Bugg-repro — downed utanför zon, storm dödar hp=1 ===');
{
  const room = makeFakeRoom(2);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');
  const p1 = room.members.get('p1');
  p1.playerState.hp = 100;

  setupZone(sim, 1); // SHRINK 1, outsideDmg=4/s
  // p0 utanför zon
  p0.playerState.x = sim.battleroyaleZone.x + 5000;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 1;           // just blivit downed
  p0.playerState.brDowned = true;
  p0.playerState.selfReviveKits = 0; // kit redan förbrukat
  p0.playerState.brReviveEnd = Date.now() + 10000; // timer ej slut
  p0.playerState.invulnUntil = 0;
  // Klargör att p0 INTE är i eliminated (annars skippar death-loopen)
  sim.battleroyaleEliminated = sim.battleroyaleEliminated.filter(id => id !== 'p0');

  info('Fas=' + sim.battleroyalePhase + ' outsideDmg=' +
    BATTLEROYALE_ARENA.phases[sim.battleroyalePhase].outsideDmg + '/s' +
    ', dt=16.7ms → ' + (BATTLEROYALE_ARENA.phases[sim.battleroyalePhase].outsideDmg * 0.0167).toFixed(4) + ' dmg/tick');
  info('p0 dist from zone=' + Math.round(Math.hypot(p0.playerState.x - sim.battleroyaleZone.x, p0.playerState.y - sim.battleroyaleZone.y)));

  // Kör 20 ticks (≈0.33s väggklocka simulerad via lastTick-trick)
  let ticksToZero = -1;
  let ticksToElim = -1;
  for (let i = 0; i < 30; i++) {
    sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
    tickSimWithDt(sim, 16);
    if (p0.playerState.hp <= 0 && ticksToZero < 0) ticksToZero = i + 1;
    if (sim.battleroyaleEliminated.includes('p0') && ticksToElim < 0) ticksToElim = i + 1;
    if (ticksToZero > 0 && ticksToElim > 0) break;
  }

  info('hp efter 30 ticks: ' + p0.playerState.hp.toFixed(4) +
    ', hp nollade vid tick: ' + ticksToZero +
    ', eliminerades vid tick: ' + ticksToElim);

  if (ticksToZero > 0) {
    fail('B1 BUG: Zone-damage nollade hp på downed spelare vid tick ' + ticksToZero +
      ' — applyBrOutsideDamage filtrerar INTE på brDowned!');
  } else {
    ok('B1: Zone-damage träffar INTE downed spelare (skyddad korrekt)');
  }

  if (ticksToElim > 0) {
    fail('B2 BUG: p0 eliminerades vid tick ' + ticksToElim +
      ' trots aktiv self-revive-kanal — death-loop träffar brDowned=true+kits=0!');
  } else {
    ok('B2: p0 EJ eliminerad (self-revive-kanalen överlever)');
  }
}

// ==========================================
// SCENARIO B2: Tick-ordnings-test
// zone-damage körs FÖRE tickBrMeta i tickBattleRoyale.
// Om zone nollar hp=1 SAMMA tick som revive-timer löper ut,
// missar tickBrMeta:s "ps.hp > 0"-check reviven.
// ==========================================
console.log('\n=== SCENARIO B2: Tick-ordnings-test — zone nollar hp samma tick som revive-timer löper ut ===');
{
  const room = makeFakeRoom(2);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');
  const p1 = room.members.get('p1');
  p1.playerState.hp = 100;

  setupZone(sim, 1); // SHRINK 1
  p0.playerState.x = sim.battleroyaleZone.x + 5000;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 0.05;     // extremt låg hp — zone-damage denna tick nollar det
  p0.playerState.brDowned = true;
  p0.playerState.selfReviveKits = 0;
  p0.playerState.brReviveEnd = Date.now() - 50; // timer LÖPT UT → revive ska ske
  p0.playerState.invulnUntil = 0;
  sim.battleroyaleEliminated = sim.battleroyaleEliminated.filter(id => id !== 'p0');

  info('p0: brDowned=true, hp=0.05, reviveEnd=utgången, utanför zon');
  info('Tick-ordning i tickBattleRoyale: applyBrOutsideDamage → tickBrMeta → death-loop');
  info('Om zone nollar hp→0 FÖRE tickBrMeta: tickBrMeta missar revive (kollar hp>0)');

  sim.eventQueue.length = 0; p0._sentMessages.length = 0; p1._sentMessages.length = 0;
  tickSimWithDt(sim, 16);

  const revived = collectEv(sim, [p0, p1], 'br_revived');
  const eliminated = sim.battleroyaleEliminated.includes('p0');
  info('hp=' + p0.playerState.hp.toFixed(4) + ', brDowned=' + p0.playerState.brDowned +
    ', revived-events=' + revived.length + ', eliminated=' + eliminated);

  if (revived.length === 0 && (eliminated || p0.playerState.hp <= 0)) {
    fail('B2 BUG: tickBrMeta missade revive — zone-damage (applyBrOutsideDamage) körs FÖRE tickBrMeta' +
      ' och nollade hp → revive-check (ps.hp>0) misslyckades');
  } else if (revived.length >= 1) {
    ok('B2: Revive skedde korrekt trots utgången timer');
  } else {
    info('B2: Oklart utfall — hp=' + p0.playerState.hp.toFixed(4) + ', revived=' + revived.length);
  }
}

// ==========================================
// SCENARIO C: Solo-match (battleroyaleStartCount=1)
// ==========================================
console.log('\n=== SCENARIO C: Solo BR (1 spelare) — downed → revived ===');
{
  const room = makeFakeRoom(1);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');

  setupZone(sim, 0);
  p0.playerState.x = sim.battleroyaleZone.x;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 0;
  p0.playerState.selfReviveKits = 1;
  p0.playerState.brDowned = false;

  info('battleroyaleStartCount=' + sim.battleroyaleStartCount);

  sim.eventQueue.length = 0;
  tickSimWithDt(sim, 16);

  if (p0.playerState.brDowned === true) {
    ok('C1: Solo: downed (brDowned=true)');
  } else if (sim.battleroyaleEliminated.includes('p0')) {
    fail('C1 BUG: Solo: p0 eliminerades direkt trots kit (StartCount issue?)');
  } else {
    fail('C1: Okänt utfall — hp=' + p0.playerState.hp + ', brDowned=' + p0.playerState.brDowned);
  }

  // Revive
  if (p0.playerState.brDowned) {
    p0.playerState.brReviveEnd = Date.now() - 50;
    sim.eventQueue.length = 0;
    tickSimWithDt(sim, 16);
    if (p0.playerState.brDowned === false && p0.playerState.hp === 50) {
      ok('C2: Solo: revived hp=50');
    } else {
      fail('C2: Solo: revive misslyckades — brDowned=' + p0.playerState.brDowned + ', hp=' + p0.playerState.hp);
    }
  }
}

// ==========================================
// SCENARIO D: Direkt-test applyBrOutsideDamage via dt-manipulation
// (bekräftar att zone-damage faktiskt appliceras på icke-downed spelare)
// ==========================================
console.log('\n=== SCENARIO D: Verifiera att zone-damage fungerar för icke-downed spelare ===');
{
  const room = makeFakeRoom(2);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');
  const p1 = room.members.get('p1');
  p1.playerState.hp = 100;

  setupZone(sim, 1); // outsideDmg=4/s
  p0.playerState.x = sim.battleroyaleZone.x + 5000;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 100;
  p0.playerState.brDowned = false;
  p0.playerState.invulnUntil = 0;
  p0.playerState.shield = 0;
  const hpBefore = p0.playerState.hp;

  tickSimWithDt(sim, 100); // 100ms dt → 0.4 dmg (4/s * 0.1s)

  const dmgTaken = hpBefore - p0.playerState.hp;
  info('Icke-downed p0 utanför zon: hp ' + hpBefore + ' → ' + p0.playerState.hp.toFixed(4) + ' (dmg=' + dmgTaken.toFixed(4) + ')');

  if (dmgTaken > 0) {
    ok('D1: Zone-damage fungerar för icke-downed spelare (dtMs=100 → ' + dmgTaken.toFixed(3) + ' dmg)');
  } else {
    fail('D1: Zone-damage appliceras INTE — testupplägg trasigt (dt-trick fungerar ej?)');
  }
}

// ==========================================
// SCENARIO E: Bekräfta om buggen existerar — downed tar zone-damage via dt-trick
// ==========================================
console.log('\n=== SCENARIO E: Bugg-existens-test — tar downed spelare zone-damage? ===');
{
  const room = makeFakeRoom(2);
  const sim = createSim(room);
  startSim(sim, { battleroyale: true, battleroyaleMatchDurationSec: 600 });
  sim.simReadyAt = 0;
  const p0 = room.members.get('p0');
  const p1 = room.members.get('p1');
  p1.playerState.hp = 100;

  setupZone(sim, 1); // outsideDmg=4/s
  p0.playerState.x = sim.battleroyaleZone.x + 5000;
  p0.playerState.y = sim.battleroyaleZone.y;
  p0.playerState.hp = 1;       // downed hp
  p0.playerState.brDowned = true;
  p0.playerState.selfReviveKits = 0;
  p0.playerState.brReviveEnd = Date.now() + 10000; // timer ej slut
  p0.playerState.invulnUntil = 0;
  p0.playerState.shield = 0;
  sim.battleroyaleEliminated = sim.battleroyaleEliminated.filter(id => id !== 'p0');

  const hpBefore = p0.playerState.hp;
  tickSimWithDt(sim, 100); // 100ms dt → borde ge 0.4 dmg om downed EJ skyddas

  const hpAfter = p0.playerState.hp;
  const dmgTaken = hpBefore - hpAfter;
  const eliminated = sim.battleroyaleEliminated.includes('p0');
  info('downed p0 utanför zon: hp ' + hpBefore + ' → ' + hpAfter.toFixed(4) + ' (dmg=' + dmgTaken.toFixed(4) + '), eliminated=' + eliminated);

  if (dmgTaken > 0 || hpAfter <= 0 || eliminated) {
    fail('E1 BUG BEKRAFTAD: Downed spelare tar zone-damage (dmg=' + dmgTaken.toFixed(3) + ')' +
      (eliminated ? ' → eliminerades!' : ''));
    console.log('');
    console.log('  ROOT CAUSE: server/sim/room-sim.js rad ~3955');
    console.log('  applyBrOutsideDamage loop-filter:');
    console.log('    if (!ws.playerState || ws.playerState.hp <= 0) continue;');
    console.log('  Saknar check: || ws.playerState.brDowned');
    console.log('  Downed spelare har hp=1 (inte <=0) → zone-damage appliceras → hp→0');
    console.log('  → death-loopen ser brDowned=true+kits=0 → eliminerar');
  } else {
    ok('E1: Downed spelare skyddas från zone-damage (buggen finns EJ)');
  }
}

// ==========================================
// SAMMANFATTNING
// ==========================================
console.log('\n=== TESTRESULTAT ===');
console.log('Godkända: ' + passed + ', Misslyckade: ' + failed);
if (failed > 0) {
  console.log('\n--- DIAGNOSERADE BUGGAR ---');
  console.log('Se [FAIL]-rader ovan för detaljer.');
  console.log('\nFIX-KANDIDAT:');
  console.log('server/sim/room-sim.js rad ~3955 (applyBrOutsideDamage):');
  console.log('  INNAN:');
  console.log('    if (!ws.playerState || ws.playerState.hp <= 0) continue;');
  console.log('  EFTER:');
  console.log('    if (!ws.playerState || ws.playerState.hp <= 0 || ws.playerState.brDowned) continue;');
  console.log('');
  console.log('  ALTERNATIV FIX (djupare skydd, täcker även bullets/explosioner):');
  console.log('  I death-loopen rad ~3744, sätt invulnUntil = nowMs + 7000 vid downed:');
  console.log('    ws.playerState.invulnUntil = nowMs + 7000; // invuln hela revive-kanalen');
  console.log('  (applyBrOutsideDamage rad 3956 kollar redan invulnUntil)');
  process.exit(1);
} else {
  console.log('\nAlla tester godkändes — inga buggar hittades.');
}
