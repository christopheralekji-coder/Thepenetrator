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

// damageEnemy ligger i ./bullets som lazy-requirar ./grenades (cirkulärt) → kräv lat
// vid första anrop, precis som bullets gör åt andra hållet. Cachas efter första hämtning.
let _damageEnemy = null;
function damageEnemy(e, dmg, isCrit, fromPid, weaponId) {
  if (!_damageEnemy) _damageEnemy = require('./bullets').damageEnemy;
  return _damageEnemy(e, dmg, isCrit, fromPid, weaponId);
}

// C158: återanvänd scratch-array för enemyGrid.queryInto (gravity + fire broad-phase).
// Noll allokering per tick. Endast en zon itereras åt gången i tickGrenadeZones så
// samma scratch kan delas mellan fire- och gravity-grenarna utan korruption.
const _zoneScratch = [];

// Är (x,y) i ett aktivt PvP-läge? (avgör om granater träffar spelare vs fiender)
function pvpActive(sim) {
  return !!(sim.tdmActive || sim.ctfActive || sim.siegeActive || sim.gungameActive ||
            sim.kothActive || sim.juggernautActive || sim.battleroyaleActive);
}

// BLÄNDGRANAT — vitnar fiendens skärm. Skalar med avstånd, LoS-blockerad, träffar ALLA.
function applyFlashbang(sim, x, y, radius, fromPid) {
  const now = Date.now();
  const MAXDUR = 3800;   // ms full bländning på nära håll (höjt — kändes för kort)
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
  // Cap så en spammare inte bygger upp tusentals zoner. C159: rensa FÖRST utgångna zoner
  // (until<=now) i st.f. blint FIFO-splice som kunde radera fortfarande aktiva grav/fire-
  // zoner (en molotov = 25 patches → 4 nästan-samtidiga slår i taket). Bara om vi
  // fortfarande är över taket FIFO-evictas levande zoner som sista utväg.
  if (sim.grenadeZones.length > 80) {
    const nowMs = Date.now();
    const zs = sim.grenadeZones;
    for (let i = zs.length - 1; i >= 0; i--) {
      if (zs[i].until <= nowMs) zs.splice(i, 1);
    }
    if (zs.length > 80) zs.splice(0, zs.length - 80);
  }
}

// G2-fix 2026-06-15: molotov lägger SAMMA LILLA flame-patches som eldkastaren (r=16)
// utspridda i ett täckande mönster inom nedslagsradien. Det ger visuell paritet med
// flamethrowerns eldspår. EN central fläck + 8 i ring vid r*0.55 + 16 i ring vid r*0.95
// (triangelärt grid) för 110px-radien → täcker ytan utan stora gluggar. Zoner lever 5s.
function applyMolotov(sim, x, y, radius, fromPid) {
  // Central fläck
  spawnFlamePatch(sim, x, y, fromPid);
  // Inre ring (8 punkter vid r*0.55)
  const innerR = radius * 0.55;
  const outerR = radius * 0.95;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    spawnFlamePatch(sim, x + Math.cos(ang) * innerR, y + Math.sin(ang) * innerR, fromPid);
  }
  // Yttre ring (16 punkter vid r*0.95)
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    spawnFlamePatch(sim, x + Math.cos(ang) * outerR, y + Math.sin(ang) * outerR, fromPid);
  }
}
function applyGravity(sim, x, y, radius, fromPid) {
  spawnZone(sim, 'gravity', x, y, radius, 2600, fromPid, 0); // 2.6s dragning
}
// Eldkastarens brinnande mark — liten kort fläck där kulan slår ner (throttlad i bullets).
function spawnFlamePatch(sim, x, y, fromPid) {
  spawnZone(sim, 'fire', x, y, 16, 1800, fromPid, 8);   // ~75% mindre eldspår (var 60)
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
        // C158: noll-alloc broad-phase via queryInto (återanvänd scratch) i st.f. getNearby.
        const list = sim.enemyGrid
          ? sim.enemyGrid.queryInto(z.x, z.y, z.r, _zoneScratch)
          : sim.enemies;
        for (const e of list) {
          if (e.dead) continue;
          const dx = e.x - z.x, dy = e.y - z.y;
          if (dx * dx + dy * dy <= z.r * z.r) {
            // Eldkastar-nerf 2026-07-08: max EN eld-zon-tick per offer per 250ms.
            // Strålen lägger patch-linjer var 160ms med 1800ms livstid → ~6 zoner
            // stackade på samma punkt tickade OBEROENDE (~192 mark-DPS, mer än
            // minigunens totala). Gaten kapar till dmgPerTick*4/s per offer oavsett
            // zon-antal; en ensam molotov (patchar utan överlapp) påverkas inte.
            if ((e._fireTickNext || 0) > now) continue;
            e._fireTickNext = now + 250;
            // C137: gå via damageEnemy → kill-credit, vapen-XP (molotov) + flash bevaras
            // i st.f. direkt hp-subtraktion (förlorade lastDamagerPid/Weapon).
            damageEnemy(e, z.dmgPerTick, false, z.fromPid, 'molotov');
            e.burnUntil = now + 600;     // visuell brand-stack
          }
        }
      }
      // Spelare — PvP: skada motståndare direkt. Co-op: förnya fire-DOT (1 dmg/s i 3s).
      // G2-fix 2026-06-15: spelaren rör sig FRITT genom elden (ingen kollision/blocking),
      // men tar fire-DOT medan man är i zonen + 3s efter att man lämnat. Ingen invuln-gate
      // för DOT (invuln skyddar bara mot direktskada vid spawn, ej hazard-DOT).
      for (const [pid, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (pid === z.fromPid) continue;  // kastaren skonas (designval: man eldar framåt)
        const dx = ws.playerState.x - z.x, dy = ws.playerState.y - z.y;
        const inFire = (dx * dx + dy * dy) <= z.r * z.r;
        if (isPvP) {
          // PvP: direkt skada per zone-tick (som förr), friendly fire av
          if (!inFire) continue;
          if (fromTeam && ws.tdmTeam && ws.tdmTeam === fromTeam) continue;
          if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
          // Eldkastar-nerf 2026-07-08: samma per-offer-gate som fiende-grenen ovan —
          // överlappande eld-zoner får inte multiplicera tick-skadan (max 1 tick/250ms).
          if ((ws.playerState._fireTickNext || 0) > now) continue;
          ws.playerState._fireTickNext = now + 250;
          let rem = z.dmgPerTick;
          if ((ws.playerState.shield || 0) > 0) {
            const ab = Math.min(ws.playerState.shield, rem);
            ws.playerState.shield -= ab; rem -= ab;
          }
          if (rem > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - rem);
          sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0, attackerPid: z.fromPid || null });
          // FATTA ELD: brinn 3s efter träff (lingrande DoT via tickPlayerBurn, även
          // efter att man lämnat elden). Förnyas medan man står kvar i lågorna.
          ws.playerState.burnUntil = now + 3000;
          ws.playerState.burnDps = 7;
          ws.playerState._burnFrom = z.fromPid || null;
        } else {
          // Co-op / PvE: fire-DOT. Förnya timer medan i elden, lös ut 3s efter att man lämnat.
          if (inFire) {
            // I elden: förnya DOT-timern (3s från nu) + markera nästa DOT-tick om ej satt
            ws.playerState._fireDotUntil = now + 3000;
            if (!ws.playerState._fireDotNextTick || ws.playerState._fireDotNextTick <= now) {
              ws.playerState._fireDotNextTick = now + 1000;  // första DOT-tick om 1s
            }
          }
          // DOT-tick (1 dmg/s i 3s, körs oavsett om man är kvar i elden eller just lämnat)
          if ((ws.playerState._fireDotUntil || 0) > now &&
              (ws.playerState._fireDotNextTick || 0) <= now) {
            ws.playerState._fireDotNextTick = now + 1000;
            const dotDmg = 8;   // samma som spawnFlamePatch.dmgPerTick
            ws.playerState.hp = Math.max(0, ws.playerState.hp - dotDmg);
            // Informera klienten om hp-ändringen (server-auth hp i V2)
            sim.eventQueue.push({ type: 'cd_hp_changed', peerId: pid,
              hp: ws.playerState.hp, shield: ws.playerState.shield || 0,
              src: 'fire' });
          }
        }
      }
    } else if (z.type === 'gravity') {
      const pull = 260 * dt;             // px/s mot centrum
      // Fiender — C158: broad-phase via enemyGrid.queryInto (noll-alloc scratch) i st.f.
      // full linjär scan av sim.enemies varje tick per gravity-zon.
      if (Array.isArray(sim.enemies)) {
        const glist = sim.enemyGrid
          ? sim.enemyGrid.queryInto(z.x, z.y, z.r, _zoneScratch)
          : sim.enemies;
        for (const e of glist) {
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
          if (ws.playerState.brAir) continue;   // BR luftburen (buss/freefall) → dras ej av gravity-zon
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

// Lingrande BRAND-DoT på spelare (PvP): brinn burnDps/sek tills burnUntil — körs varje
// tick (oberoende av om eld-zonerna finns kvar) så elden följer offret hela 3s efter
// träff. burnUntil sätts i tickGrenadeZones fire-grenen. Första ticken sker direkt
// (_burnNext odefinierad). player_burning-event driver klientens brinn-visual.
function tickPlayerBurn(sim, now) {
  if (!pvpActive(sim)) return;
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState;
    if (!ps || ps.hp <= 0) continue;
    if (!(ps.burnUntil > now)) continue;
    if ((ps._burnNext || 0) > now) continue;
    ps._burnNext = now + 1000;   // 1 tick/sek
    if (now < (ps.invulnUntil || 0)) continue;   // spawn-invuln skyddar mot DoT med
    let rem = ps.burnDps || 7;
    if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, rem); ps.shield -= ab; rem -= ab; }
    if (rem > 0) ps.hp = Math.max(0, ps.hp - rem);
    sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ps.hp,
      shield: ps.shield || 0, attackerPid: ps._burnFrom || null });
    sim.eventQueue.push({ type: 'player_burning', peerId: pid, until: ps.burnUntil });
  }
}

module.exports = { applyFlashbang, applyMolotov, applyGravity, spawnFlamePatch, tickGrenadeZones, tickPlayerBurn, pvpActive };
