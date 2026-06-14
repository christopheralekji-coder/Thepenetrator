// V2 granatsystem — bländgranat / molotov / gravitationsgranat (+ brinnande mark
// från eldkastaren). Frag/rök hanteras kvar i server.js (explode/visuell). CC bor
// ENBART här (granater), aldrig i vapnen. Designspec: penetrator_v2_weapon_redesign.
//
// Modell:
//  - Bländgranat: omedelbar effekt vid nedslag. Alla spelare+bots i radie (skalat med
//    avstånd, BLOCKERAS av väggar/LoS, TRÄFFAR ALLA inkl kastaren) → 'flashed'-event
//    till spelar-klienter (vit overlay) + bot/fiende-flashed-state (desorienterad AI).
//  - Molotov + brinnande mark: en FIRE-zon (sim.grenadeZones) som tickGrenadeZones
//    skadar entiteter i, sedan dör. Klienten ritar elden deterministiskt ur eventet.
//  - Gravitationsgranat: en GRAVITY-zon som drar entiteter mot centrum varje tick.
'use strict';

const { getActiveWalls, losBlocked } = require('./bots');

// Är (x,y) i ett aktivt PvP-läge? (avgör om granater träffar spelare vs fiender)
function pvpActive(sim) {
  return !!(sim.tdmActive || sim.ctfActive || sim.siegeActive || sim.gungameActive ||
            sim.kothActive || sim.juggernautActive || sim.battleroyaleActive);
}

// BLÄNDGRANAT — vitnar fiendens skärm. Skalar med avstånd, LoS-blockerad, träffar ALLA.
function applyFlashbang(sim, x, y, radius, fromPid) {
  const now = Date.now();
  const MAXDUR = 2200;   // ms full bländning på nära håll
  // Spelare (inkl kastaren — design: alla i radien). Klienten whitar ut via 'flashed'.
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const dx = ws.playerState.x - x, dy = ws.playerState.y - y;
    const d = Math.hypot(dx, dy);
    if (d > radius) continue;
    if (losBlocked(sim, x, y, ws.playerState.x, ws.playerState.y)) continue;  // bakom vägg = skyddad
    const frac = 1 - d / radius;                 // 1 nära → 0 vid kanten
    const dur = Math.round(MAXDUR * (0.35 + 0.65 * frac));
    if (ws._isBot) {
      ws._flashedUntil = now + dur;              // bot-AI desorienteras (bots.js)
    } else {
      sim.eventQueue.push({ type: 'flashed', peerId: pid, durationMs: dur, intensity: frac });
    }
  }
  // Fiender (PvE) — blinda → AI desorienteras (enemies.js läser e.flashedUntil om wirat;
  // annars no-op, skadefritt). Vi sätter flaggan oavsett.
  if (!pvpActive(sim) && Array.isArray(sim.enemies)) {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      if (losBlocked(sim, x, y, e.x, e.y)) continue;
      e.flashedUntil = now + Math.round(MAXDUR * (0.35 + 0.65 * (1 - d / radius)));
    }
  }
}

// Skapa en zon (fire eller gravity). Klienten ritar visuellt ur grenade_thrown-eventet.
function spawnZone(sim, type, x, y, radius, durationMs, fromPid, dmgPerTick) {
  if (!sim.grenadeZones) sim.grenadeZones = [];
  sim.grenadeZones.push({
    type, x, y, r: radius,
    until: Date.now() + durationMs,
    fromPid: fromPid || null,
    dmgPerTick: dmgPerTick || 0,
    nextTick: 0,
  });
  // Cap så en spammare inte bygger upp tusentals zoner
  if (sim.grenadeZones.length > 80) sim.grenadeZones.splice(0, sim.grenadeZones.length - 80);
}

function applyMolotov(sim, x, y, radius, fromPid) {
  spawnZone(sim, 'fire', x, y, radius, 5000, fromPid, 14);   // 5s brinnande zon
}
function applyGravity(sim, x, y, radius, fromPid) {
  spawnZone(sim, 'gravity', x, y, radius, 2600, fromPid, 0); // 2.6s dragning
}
// Eldkastarens brinnande mark — liten kort fläck där kulan slår ner (throttlad i bullets).
function spawnFlamePatch(sim, x, y, fromPid) {
  spawnZone(sim, 'fire', x, y, 60, 1800, fromPid, 8);
}

// Tickas varje sim-tick: FIRE skadar entiteter (throttlat ~4/s), GRAVITY drar dem mot
// centrum. Utgångna zoner tas bort. Returnerar inget — muterar sim.
function tickGrenadeZones(sim, dt, now) {
  if (!sim.grenadeZones || !sim.grenadeZones.length) return;
  const isPvP = pvpActive(sim);
  for (let i = sim.grenadeZones.length - 1; i >= 0; i--) {
    const z = sim.grenadeZones[i];
    if (now >= z.until) { sim.grenadeZones.splice(i, 1); continue; }
    const fromWs = z.fromPid ? sim.room.members.get(z.fromPid) : null;
    const fromTeam = fromWs && fromWs.tdmTeam;
    if (z.type === 'fire') {
      if (now < z.nextTick) continue;
      z.nextTick = now + 250;            // 4 ticks/s
      // Fiender (PvE)
      if (!isPvP && Array.isArray(sim.enemies)) {
        const list = sim.enemyGrid ? sim.enemyGrid.getNearby(z.x, z.y, z.r) : sim.enemies;
        for (const e of list) {
          if (e.dead) continue;
          const dx = e.x - z.x, dy = e.y - z.y;
          if (dx * dx + dy * dy <= z.r * z.r) {
            e.hp = (e.hp || 0) - z.dmgPerTick;
            e.burnUntil = now + 600;     // visuell brand-stack
            if (e.hp <= 0) e.dead = true;
          }
        }
      }
      // Spelare (PvP: motståndare; co-op: ingen friendly skada)
      for (const [pid, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (pid === z.fromPid) continue;
        if (!isPvP) continue;
        if (fromTeam && ws.tdmTeam && ws.tdmTeam === fromTeam) continue;
        if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
        const dx = ws.playerState.x - z.x, dy = ws.playerState.y - z.y;
        if (dx * dx + dy * dy > z.r * z.r) continue;
        let rem = z.dmgPerTick;
        if ((ws.playerState.shield || 0) > 0) {
          const ab = Math.min(ws.playerState.shield, rem);
          ws.playerState.shield -= ab; rem -= ab;
        }
        if (rem > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - rem);
        sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ws.playerState.hp,
          shield: ws.playerState.shield || 0, attackerPid: z.fromPid || null });
      }
    } else if (z.type === 'gravity') {
      const pull = 260 * dt;             // px/s mot centrum
      // Fiender
      if (Array.isArray(sim.enemies)) {
        for (const e of sim.enemies) {
          if (e.dead) continue;
          const dx = z.x - e.x, dy = z.y - e.y;
          const d = Math.hypot(dx, dy);
          if (d > 8 && d <= z.r) { e.x += (dx / d) * pull; e.y += (dy / d) * pull; }
        }
      }
      // Spelare (bara PvP-motståndare dras; co-op drar ingen)
      if (isPvP) {
        for (const [pid, ws] of sim.room.members) {
          if (!ws.playerState || ws.playerState.hp <= 0) continue;
          if (pid === z.fromPid) continue;
          if (fromTeam && ws.tdmTeam && ws.tdmTeam === fromTeam) continue;
          const dx = z.x - ws.playerState.x, dy = z.y - ws.playerState.y;
          const d = Math.hypot(dx, dy);
          if (d > 8 && d <= z.r) { ws.playerState.x += (dx / d) * pull; ws.playerState.y += (dy / d) * pull; }
        }
      }
    }
  }
}

module.exports = { applyFlashbang, applyMolotov, applyGravity, spawnFlamePatch, tickGrenadeZones };
