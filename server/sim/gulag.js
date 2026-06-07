// GULAG — server-modul. 1v1-duell mellan två BR-spelare som dött helt (inget self-revive).
// Vinnaren redeployar in i live-matchen, förloraren elimineras på riktigt.
//
// Gulag-matcher körs i SAMMA sim som BR fast på off-map-koordinater. Servern äger
// regler/hp/vinst; rörelse är klient-auktoritär så servern LÄSER positioner för fall-/
// kontakt-detektion. hp är server-auktoritärt UNDER gulag (applyPlayerInput ignorerar
// klient-hp då — se room-sim.js). Se shared/gulag-arenas.js för geometri/spel-defs.
'use strict';

const { GULAG_GAMES, GULAG_GAME_IDS, GULAG_SLOT_COUNT, gulagSlotOrigin } = require('../../shared/gulag-arenas');

function ensureGulagState(sim) {
  if (!sim.gulagQueue) sim.gulagQueue = [];
  if (!sim.gulagMatches) sim.gulagMatches = [];
  if (!sim._gulagSlotsUsed) sim._gulagSlotsUsed = new Set();
  if (sim._gulagMatchCounter == null) sim._gulagMatchCounter = 0;
}

// ---- KÖ: en spelare dör helt utan kit → in i Gulag-kön (spectar live-matchen tills parad) ----
function enterGulag(sim, pid, ws) {
  ensureGulagState(sim);
  const ps = ws.playerState;
  if (!ps) return;
  ps.gulagState = 'queued';
  ps.gulagUsed = true;          // bara EN gulag-chans per match
  ps.spectating = true;         // titta på live-matchen medan man väntar
  ps.hp = 0;
  ps.brDowned = false;
  if (!sim.gulagQueue.includes(pid)) sim.gulagQueue.push(pid);
  sim.eventQueue.push({ type: 'gulag_queued', peerId: pid, queueLen: sim.gulagQueue.length });
}

// ---- MATCHMAKING: para ihop två köade spelare ----
function gulagMatchmake(sim, now) {
  ensureGulagState(sim);
  sim.gulagQueue = sim.gulagQueue.filter(pid => {
    const ws = sim.room.members.get(pid);
    return ws && ws.playerState && ws.playerState.gulagState === 'queued';
  });
  while (sim.gulagQueue.length >= 2) {
    const a = sim.gulagQueue.shift();
    const b = sim.gulagQueue.shift();
    if (a === b) continue;
    startGulagMatch(sim, a, b, now);
  }
  // DEADLOCK-SKYDD: en ENSAM köad kan bara paras om någon ANNAN spelare dör. Om ≤1
  // spelare är kvar på kartan (t.ex. final-2: A dödade B, A dör aldrig) kommer ingen
  // opponent → matchen kan aldrig sluta. Efter en kort grace (chans till samtidig 2:a-död)
  // förlorar den ensamma köade på walkover → win-check avgör matchen.
  if (sim.gulagQueue.length === 1) {
    let onMapAlive = 0;
    for (const [pid, ws] of sim.room.members) {
      if (ws.playerState && !ws.playerState.gulagState && ws.playerState.hp > 0 &&
          !ws.playerState.brDowned && !sim.battleroyaleEliminated.includes(pid)) onMapAlive++;
    }
    if (onMapAlive <= 1) {
      if (!sim._gulagLoneSince) sim._gulagLoneSince = now;
      else if (now - sim._gulagLoneSince > 2500) {
        eliminateLoneGulag(sim, sim.gulagQueue.shift());
        sim._gulagLoneSince = 0;
      }
    } else {
      sim._gulagLoneSince = 0;
    }
  } else {
    sim._gulagLoneSince = 0;
  }
}

// Ensam köad utan möjlig motståndare → placeras/elimineras (walkover-förlust).
function eliminateLoneGulag(sim, pid) {
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState) return;
  const ps = ws.playerState;
  clearGulagFields(ps);
  ps.brDowned = false; ps.hp = 0; ps.spectating = true;
  let placement = sim.battleroyaleAliveCount;
  if (!sim.battleroyaleEliminated.includes(pid)) {
    sim.battleroyaleRanks[pid] = placement;
    sim.battleroyaleEliminated.push(pid);
    sim.battleroyaleAliveCount = Math.max(0, sim.battleroyaleAliveCount - 1);
    sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
    ws.tdmRespawnAt = 0;
  }
  sim.eventQueue.push({ type: 'gulag_lost', peerId: pid, placement, aliveCount: sim.battleroyaleAliveCount, game: null, winner: null });
}

function freeSlot(sim) {
  for (let i = 0; i < GULAG_SLOT_COUNT; i++) {
    if (!sim._gulagSlotsUsed.has(i)) { sim._gulagSlotsUsed.add(i); return i; }
  }
  sim._gulagSlotsUsed.add(0); return 0; // >8 samtidiga (osannolikt) → återanvänd
}

function pickGame(sim) {
  // DEBUG: _gulagForceGame (satt av startGulagPractice) tvingar ett specifikt spel
  if (sim && sim._gulagForceGame && GULAG_GAMES[sim._gulagForceGame]) return sim._gulagForceGame;
  return GULAG_GAME_IDS[Math.floor(Math.random() * GULAG_GAME_IDS.length)];
}

// DEBUG/TEST: droppa host + en bot direkt i ett valt gulag-spel (för solo-bugfix).
// Anropas i slutet av BR-init när sim_start har gulagPractice satt. Boten står still
// (tickBots skippar gulag-bots) — räcker för att testa win-path + rendering + HUD.
function startGulagPractice(sim, gameId, now) {
  ensureGulagState(sim);
  if (gameId && GULAG_GAMES[gameId]) sim._gulagForceGame = gameId;
  // hitta host (första riktiga spelaren) + första boten
  let hostPid = null, botPid = null;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (ws._isBot) { if (!botPid) botPid = pid; }
    else if (!hostPid) hostPid = pid;
  }
  if (!hostPid || !botPid) return; // behöver både spelare + bot
  for (const pid of [hostPid, botPid]) {
    const ws = sim.room.members.get(pid);
    ws.playerState.gulagUsed = false; // tillåt (om)gulag
    enterGulag(sim, pid, ws);
  }
  gulagMatchmake(sim, now);
}

// Skicka bara geometrin klienten behöver för rendering (one-shot event)
function serializeGeo(geo) {
  return {
    shape: geo.shape, groundColor: geo.groundColor,
    walls: geo.walls || [],
    bounds: geo.bounds || null,
    platformX: geo.platformX, platformY: geo.platformY, platformR: geo.platformR,
    ringX: geo.ringX, ringY: geo.ringY, ringR: geo.ringR,
    cols: geo.cols, rows: geo.rows, tile: geo.tile, gridX: geo.gridX, gridY: geo.gridY,
    tiles: geo.tiles ? geo.tiles.map(t => ({ x: Math.round(t.x), y: Math.round(t.y) })) : null,
  };
}

function startGulagMatch(sim, pidA, pidB, now) {
  const wsA = sim.room.members.get(pidA), wsB = sim.room.members.get(pidB);
  if (!wsA || !wsB || !wsA.playerState || !wsB.playerState) {
    [pidA, pidB].forEach(p => {
      const w = sim.room.members.get(p);
      if (w && w.playerState && w.playerState.gulagState === 'queued') sim.gulagQueue.push(p);
    });
    return;
  }
  const slot = freeSlot(sim);
  const origin = gulagSlotOrigin(slot);
  const gameId = pickGame(sim);
  const game = GULAG_GAMES[gameId];
  const geo = game.build(origin.x, origin.y);
  const matchId = 'g' + (++sim._gulagMatchCounter);
  const lo = game.loadout;

  [pidA, pidB].forEach((pid, idx) => {
    const ps = sim.room.members.get(pid).playerState;
    const sp = geo.spawns[idx];
    ps.gulagState = 'fighting';
    ps._gulagMatchId = matchId;
    ps._gulagGame = gameId;
    ps._gulagWeapon = lo.weaponId;
    ps._gulagNoShoot = !!game.noShoot;
    ps.x = sp.x; ps.y = sp.y; ps.aim = sp.facing;
    ps.hp = lo.hp; ps.maxHp = lo.hp; ps.shield = lo.shield || 0; // v1.796: maxHp = loadout (frenzy 140) → heal-cap rätt
    ps.weaponId = lo.weaponId;
    ps.armorLevel = 0; ps.speedMul = 1;
    ps.invulnUntil = now + 800; // spawn-grace + skydd mot in-flight-position-desync
    ps.brDowned = false; ps.spectating = false;
    ps._gulagSpeedUntil = 0; ps._gulagGunUntil = 0;
    ps._gulagWeapons = [lo.weaponId]; ps._gulagDmgUntil = 0; ps._gulagFrozenUntil = 0; // v1.800: frenzy/freeze/berserk-state fräsch
    ps._gulagKnockUntil = 0;
  });

  const match = {
    id: matchId, slot, gameId, origin, geo, a: pidA, b: pidB,
    startedAt: now, lastTickEmit: 0, ended: false,
    platformR: geo.platformR || 0,
    ringR: geo.ringR || 0,
    fallenTiles: [],
    warningTiles: [],
    tileStandSince: {},
    nextTileFallAt: game.fallStartMs ? now + game.fallStartMs : 0,
    bombHolder: null, bombEndsAt: 0, bombPassReadyAt: 0,
    powerups: [], nextPowerupAt: game.powerupEverMs ? now + 1800 : 0, puCounter: 0,
  };
  if (gameId === 'bombtag') {
    match.bombHolder = Math.random() < 0.5 ? pidA : pidB;
    match.bombEndsAt = now + game.bombMs;
    match.bombPassReadyAt = now + 1300;
  }
  sim.gulagMatches.push(match);

  sim.eventQueue.push({
    type: 'gulag_start', matchId, game: gameId, gameName: game.name, emoji: game.emoji,
    hint: game.hint, a: pidA, b: pidB, noShoot: !!game.noShoot, loadoutWeapon: lo.weaponId,
    geo: serializeGeo(geo),
    spawnA: { x: Math.round(geo.spawns[0].x), y: Math.round(geo.spawns[0].y), facing: geo.spawns[0].facing },
    spawnB: { x: Math.round(geo.spawns[1].x), y: Math.round(geo.spawns[1].y), facing: geo.spawns[1].facing },
    bombHolder: match.bombHolder, bombMs: game.bombMs || 0,
  });
}

// ---- helpers ----
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function tileIndexAt(m, x, y) {
  const g = m.geo;
  const c = Math.floor((x - g.gridX) / g.tile);
  const r = Math.floor((y - g.gridY) / g.tile);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}
function isOverHole(m, x, y) {
  const idx = tileIndexAt(m, x, y);
  if (idx < 0) return true;               // utanför rutnätet
  return m.fallenTiles.includes(idx);     // över fallen platta
}
function dropRandomTile(m) {
  const g = m.geo;
  const total = g.cols * g.rows;
  // undvik plattor spelare just nu står på (låt stå-vacklan sköta dem)
  const occupied = new Set();
  [m.a, m.b].forEach(pid => {
    const rec = m.tileStandSince[pid];
    if (rec) occupied.add(rec.idx);
  });
  const candidates = [];
  for (let i = 0; i < total; i++) {
    if (!m.fallenTiles.includes(i) && !occupied.has(i)) candidates.push(i);
  }
  if (!candidates.length) return;
  m.fallenTiles.push(candidates[Math.floor(Math.random() * candidates.length)]);
}
// v1.794: välj en platta att VARNA (röd blink) innan den faller. Exkluderar redan
// fallna, redan varnade och plattor spelarna står på just nu.
function pickWarnTile(m) {
  const g = m.geo;
  const total = g.cols * g.rows;
  const occupied = new Set();
  [m.a, m.b].forEach(pid => { const rec = m.tileStandSince[pid]; if (rec) occupied.add(rec.idx); });
  const warned = new Set((m.warningTiles || []).map(w => w.idx));
  const candidates = [];
  for (let i = 0; i < total; i++) {
    if (!m.fallenTiles.includes(i) && !occupied.has(i) && !warned.has(i)) candidates.push(i);
  }
  if (!candidates.length) return -1;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function safeRedeployPos(sim) {
  const z = sim.battleroyaleZone;
  const arena = sim._brArena;
  const wW = (arena && arena.worldW) || 10000, wH = (arena && arena.worldH) || 10000;
  if (z && z.r > 0) {
    const ang = Math.random() * Math.PI * 2;
    const rad = z.r * (0.45 + Math.random() * 0.3);
    let x = z.x + Math.cos(ang) * rad;
    let y = z.y + Math.sin(ang) * rad;
    x = Math.max(60, Math.min(wW - 60, x));
    y = Math.max(60, Math.min(wH - 60, y));
    return { x, y };
  }
  return { x: wW / 2, y: wH / 2 };
}

function clearGulagFields(ps) {
  ps.gulagState = null;
  ps._gulagMatchId = null; ps._gulagGame = null; ps._gulagWeapon = null;
  ps._gulagNoShoot = false; ps._gulagSpeedUntil = 0; ps._gulagGunUntil = 0;
  // v1.800: rensa frenzy/void-temp-state så det ej läcker till nästa duell/match
  ps._gulagWeapons = null; ps._gulagDmgUntil = 0; ps._gulagFrozenUntil = 0;
  ps._gulagKnockUntil = 0; ps._gulagKnockDX = 0; ps._gulagKnockDY = 0;
  // v1.798: rensa kill-credit-state — annars fick gulag-MOTSTÅNDAREN (redan eliminerad)
  // kill-credit om vinnaren dog kort efter redeploy (fel kills + cash till en spöke).
  ps._brLastAttacker = null; ps._brLastWeapon = null; ps._brLastAttackerAt = 0;
}

// ---- RESOLVE: vinnare redeployar, förlorare elimineras ----
function resolveGulag(sim, m, winnerPid, loserPid, now) {
  if (m.ended) return;
  m.ended = true;
  sim._gulagSlotsUsed.delete(m.slot);

  // VINNARE → redeploy in i live-matchen
  const wWs = sim.room.members.get(winnerPid);
  if (wWs && wWs.playerState) {
    const ps = wWs.playerState;
    clearGulagFields(ps);
    ps.spectating = false; ps.brDowned = false;
    ps.hp = 75; ps.maxHp = 100; ps.shield = 25; ps.weaponId = 'pistol'; // v1.796: maxHp tillbaka till BR-100
    ps.armorLevel = 0; ps.speedMul = 1;
    const pos = safeRedeployPos(sim);
    ps.x = pos.x; ps.y = pos.y;
    ps.invulnUntil = Date.now() + 3000;
    sim.eventQueue.push({
      type: 'gulag_won', peerId: winnerPid, x: Math.round(pos.x), y: Math.round(pos.y),
      hp: 75, shield: 25, game: m.gameId,
    });
    sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: winnerPid, hp: 75, shield: 25 });
  }

  // FÖRLORARE → riktig elimination (replikerar tickBattleRoyale, utan corpse-loot off-map)
  let placement = sim.battleroyaleAliveCount;
  const lWs = sim.room.members.get(loserPid);
  if (lWs && lWs.playerState) {
    const ps = lWs.playerState;
    clearGulagFields(ps);
    ps.brDowned = false; ps.hp = 0; ps.spectating = true;
    if (!sim.battleroyaleEliminated.includes(loserPid)) {
      placement = sim.battleroyaleAliveCount;
      sim.battleroyaleRanks[loserPid] = placement;
      sim.battleroyaleEliminated.push(loserPid);
      sim.battleroyaleAliveCount = Math.max(0, sim.battleroyaleAliveCount - 1);
      sim.tdmDeathsByPid[loserPid] = (sim.tdmDeathsByPid[loserPid] || 0) + 1;
      lWs.tdmRespawnAt = 0;
    }
  }
  sim.eventQueue.push({
    type: 'gulag_lost', peerId: loserPid, placement, aliveCount: sim.battleroyaleAliveCount,
    game: m.gameId, winner: winnerPid,
  });
}

// v1.800: vapen-powerups i frenzy (ackumuleras i förrådet, byts via radialen)
const FRENZY_WEAPON_KINDS = ['shotgun', 'smg', 'rifle'];
// v1.799: KREATIVA powerups (ej bara vapen) — freeze hanteras i pickup-loopen (träffar
// motståndaren). Self-buffs här: shield/heal/speed/berserk.
function applyFrenzyPowerup(ps, kind, now) {
  if (kind === 'shield') ps.shield = Math.min(100, (ps.shield || 0) + 50);
  else if (kind === 'heal') ps.hp = Math.min(ps.maxHp || 100, (ps.hp || 0) + 45);
  else if (kind === 'speed') { ps.speedMul = 1.6; ps._gulagSpeedUntil = now + 5000; }
  else if (kind === 'berserk') { ps._gulagDmgUntil = now + 6000; } // 2× skada i 6s (appliceras i applyShoot)
}

// ---- TICK: kör alla aktiva matcher ----
function tickGulag(sim, dt, now) {
  ensureGulagState(sim);
  if (!sim.gulagMatches.length) return;

  for (const m of sim.gulagMatches) {
    if (m.ended) continue;
    const game = GULAG_GAMES[m.gameId];
    const wsA = sim.room.members.get(m.a), wsB = sim.room.members.get(m.b);
    if (!wsA || !wsA.playerState) { resolveGulag(sim, m, m.b, m.a, now); continue; }
    if (!wsB || !wsB.playerState) { resolveGulag(sim, m, m.a, m.b, now); continue; }
    const psA = wsA.playerState, psB = wsB.playerState;
    let winner = null, loser = null;

    switch (m.gameId) {
      case 'void': {
        const t = Math.max(0, now - m.startedAt - game.shrinkStartMs);
        const f = game.shrinkMs > 0 ? Math.min(1, t / game.shrinkMs) : 0;
        m.platformR = game.platformR0 + (game.platformRmin - game.platformR0) * f;
        // v1.799: server-side knockback-integration för BOTS (riktiga spelare applicerar
        // knuffen klient-side via sin egen position; bots har ingen klient → puttas här).
        [m.a, m.b].forEach(pid => {
          const ws = sim.room.members.get(pid);
          if (!ws || !ws._isBot || !ws.playerState) return;
          const ps = ws.playerState;
          if (ps._gulagKnockUntil && now < ps._gulagKnockUntil) {
            ps.x += (ps._gulagKnockDX || 0) * (game.knockForce || 600) * dt;
            ps.y += (ps._gulagKnockDY || 0) * (game.knockForce || 600) * dt;
          }
        });
        const cx = m.geo.platformX, cy = m.geo.platformY;
        const dA = dist(psA.x, psA.y, cx, cy), dB = dist(psB.x, psB.y, cx, cy);
        const offA = dA > m.platformR + 18, offB = dB > m.platformR + 18;
        if (offA && offB) { if (dA >= dB) { winner = m.b; loser = m.a; } else { winner = m.a; loser = m.b; } }
        else if (offA) { winner = m.b; loser = m.a; }
        else if (offB) { winner = m.a; loser = m.b; }
        break;
      }
      case 'blade': {
        const t = Math.max(0, now - m.startedAt - game.shrinkStartMs);
        const f = game.shrinkMs > 0 ? Math.min(1, t / game.shrinkMs) : 0;
        m.ringR = game.ringR0 + (game.ringRmin - game.ringR0) * f;
        const cx = m.geo.ringX, cy = m.geo.ringY;
        // lava utanför ring
        const lava = (game.lavaDps || 0) * dt;
        if (lava > 0) {
          if (dist(psA.x, psA.y, cx, cy) > m.ringR) { psA.hp = Math.max(0, psA.hp - lava); sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: m.a, hp: Math.round(psA.hp), shield: psA.shield || 0 }); }
          if (dist(psB.x, psB.y, cx, cy) > m.ringR) { psB.hp = Math.max(0, psB.hp - lava); sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: m.b, hp: Math.round(psB.hp), shield: psB.shield || 0 }); }
        }
        break; // hp-död hanteras av generic-check nedan
      }
      case 'frenzy': {
        // expirera tidsbegränsade powerups
        [m.a, m.b].forEach(pid => {
          const ps = sim.room.members.get(pid).playerState;
          if (ps._gulagSpeedUntil && now > ps._gulagSpeedUntil) { ps.speedMul = 1; ps._gulagSpeedUntil = 0; }
          if (ps._gulagGunUntil && now > ps._gulagGunUntil) { ps._gulagWeapon = game.loadout.weaponId; ps.weaponId = game.loadout.weaponId; ps._gulagGunUntil = 0; }
        });
        // spawna powerup (v1.796: cap 6 samtidigt = tätt men läsbart)
        if (m.nextPowerupAt && now >= m.nextPowerupAt && m.powerups.length < 6) {
          const spots = m.geo.powerupSpawns || [];
          if (spots.length) {
            const spot = spots[Math.floor(Math.random() * spots.length)];
            // v1.800: KREATIVA powerups (freeze/berserk/utility) + VAPEN som ACKUMULERAS
            // i vapen-radialen (byt fritt mellan upplockade — ej fast på senaste).
            const kinds = ['shield', 'heal', 'speed', 'berserk', 'freeze', 'shotgun', 'smg', 'rifle'];
            m.powerups.push({ id: 'pu' + (++m.puCounter), x: spot.x, y: spot.y, kind: kinds[Math.floor(Math.random() * kinds.length)] });
            m.nextPowerupAt = now + game.powerupEverMs;
          }
        }
        // pickup
        for (let i = m.powerups.length - 1; i >= 0; i--) {
          const pu = m.powerups[i];
          for (const pid of [m.a, m.b]) {
            const ps = sim.room.members.get(pid).playerState;
            if (dist(ps.x, ps.y, pu.x, pu.y) < 36) {
              if (pu.kind === 'freeze') {
                // ❄️ FREEZE träffar MOTSTÅNDAREN (frys 1.4s) — server enforce:ar i applyPlayerInput
                const oppPid = (pid === m.a) ? m.b : m.a;
                const ows = sim.room.members.get(oppPid);
                if (ows && ows.playerState) { ows.playerState._gulagFrozenUntil = now + 1400; sim.eventQueue.push({ type: 'gulag_frozen', peerId: oppPid, ms: 1400 }); }
              } else if (FRENZY_WEAPON_KINDS.includes(pu.kind)) {
                // 🔫 VAPEN — ackumulera i förrådet (permanent), equippa senaste. applyShoot
                // tillåter byte mellan ps._gulagWeapons → man kan välja via radialen.
                if (!Array.isArray(ps._gulagWeapons)) ps._gulagWeapons = [];
                if (!ps._gulagWeapons.includes(pu.kind)) ps._gulagWeapons.push(pu.kind);
                ps._gulagWeapon = pu.kind; ps.weaponId = pu.kind;
              } else {
                applyFrenzyPowerup(ps, pu.kind, now);
              }
              sim.eventQueue.push({ type: 'gulag_powerup', peerId: pid, kind: pu.kind });
              sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: Math.round(ps.hp), shield: ps.shield || 0 });
              m.powerups.splice(i, 1);
              break;
            }
          }
        }
        break; // hp-död hanteras nedan
      }
      case 'oneshot': break; // hp-död hanteras nedan
      case 'bombtag': {
        if (now >= m.bombEndsAt) { winner = (m.bombHolder === m.a) ? m.b : m.a; loser = m.bombHolder; break; }
        if (now >= m.bombPassReadyAt && dist(psA.x, psA.y, psB.x, psB.y) < game.contactRange) {
          m.bombHolder = (m.bombHolder === m.a) ? m.b : m.a;
          m.bombPassReadyAt = now + game.passCooldownMs;
          sim.eventQueue.push({ type: 'gulag_bomb', matchId: m.id, a: m.a, b: m.b, holder: m.bombHolder, endsAt: m.bombEndsAt });
          // v1.796: SHOVE den nya hållaren bort från taggaren → läsbar orsak/verkan
          // ("jag taggade dig, du är det nu, spring!"). Mjukare knuff än void (force 380).
          const nh = sim.room.members.get(m.bombHolder).playerState;
          const oh = (m.bombHolder === m.a) ? psB : psA;
          let kdx = nh.x - oh.x, kdy = nh.y - oh.y;
          if (kdx === 0 && kdy === 0) kdx = 1; // v1.797: fallback om exakt samma pixel → knuff ändå
          sim.eventQueue.push({ type: 'gulag_knockback', peerId: m.bombHolder, vx: Math.round(kdx), vy: Math.round(kdy), force: 380 });
        }
        break;
      }
      case 'floorlava': {
        if (!m.warningTiles) m.warningTiles = [];
        // 1) promota varnade plattor som passerat sin fallAt → faktiskt fallna
        for (let wi = m.warningTiles.length - 1; wi >= 0; wi--) {
          if (now >= m.warningTiles[wi].fallAt) {
            const fidx = m.warningTiles[wi].idx;
            if (!m.fallenTiles.includes(fidx)) m.fallenTiles.push(fidx);
            m.warningTiles.splice(wi, 1);
          }
        }
        // 2) schemalägg ny varning. ACCELERATION: intervallet krymper ju fler plattor
        // som fallit (750ms → ~220ms golv) så tempot ökar mot slutet. v1.796: warn-tiden
        // skalas med intervallet (men aldrig under 450ms) → rättvist reaktionsfönster
        // även när plattor faller snabbt sent i matchen.
        if (m.nextTileFallAt && now >= m.nextTileFallAt) {
          const totalT = m.geo.cols * m.geo.rows;
          const frac = m.fallenTiles.length / totalT;
          const interval = Math.max(220, game.fallEveryMs * (1 - frac * 1.25));
          const warn = Math.max(450, interval * 0.9);
          const widx = pickWarnTile(m);
          if (widx >= 0) m.warningTiles.push({ idx: widx, fallAt: now + warn });
          m.nextTileFallAt = now + interval;
        }
        // stå-för-länge → platta vacklar
        [m.a, m.b].forEach(pid => {
          const ps = sim.room.members.get(pid).playerState;
          const idx = tileIndexAt(m, ps.x, ps.y);
          if (idx < 0) { m.tileStandSince[pid] = null; return; }
          const rec = m.tileStandSince[pid];
          if (!rec || rec.idx !== idx) m.tileStandSince[pid] = { idx, since: now };
          else if (now - rec.since > game.standCrumbleMs && !m.fallenTiles.includes(idx)) {
            // v1.800: TELEGRAFERA crumble — plattan BLINKAR (warningTiles) i 500ms innan
            // den faller, i st.f. instant fall (tidigare försvann den abrupt under en
            // som stod stilla → såg ut som en bugg). Promoteras av warning-loopen ovan.
            if (!m.warningTiles.some(w => w.idx === idx)) m.warningTiles.push({ idx, fallAt: now + 500 });
            m.tileStandSince[pid] = null;
          }
        });
        // off-hole-tidsstämpel → RÄTTVIS dubbel-fall-tiebreak (ingen coin-flip i en
        // eliminerings-match). Den som höll fast mark LÄNGST (föll senast) vinner.
        const aOff = isOverHole(m, psA.x, psA.y), bOff = isOverHole(m, psB.x, psB.y);
        if (aOff) { if (!m._aOffSince) m._aOffSince = now; } else m._aOffSince = 0;
        if (bOff) { if (!m._bOffSince) m._bOffSince = now; } else m._bOffSince = 0;
        if (aOff && bOff) {
          const aT = m._aOffSince || now, bT = m._bOffSince || now;
          if (aT > bT) { winner = m.a; loser = m.b; }          // A föll senare → A vinner
          else if (bT > aT) { winner = m.b; loser = m.a; }
          else if ((psA.hp || 0) >= (psB.hp || 0)) { winner = m.a; loser = m.b; } // exakt samma tick → mer hp
          else { winner = m.b; loser = m.a; }
        }
        else if (aOff) { winner = m.b; loser = m.a; }
        else if (bOff) { winner = m.a; loser = m.b; }
        break;
      }
    }

    // GENERIC hp-död (oneshot/blade/frenzy)
    if (!winner) {
      if (psA.hp <= 0 && psB.hp <= 0) { if ((psA.shield || 0) >= (psB.shield || 0)) { winner = m.a; loser = m.b; } else { winner = m.b; loser = m.a; } }
      else if (psA.hp <= 0) { winner = m.b; loser = m.a; }
      else if (psB.hp <= 0) { winner = m.a; loser = m.b; }
    }

    // BACKSTOP timeout
    if (!winner && now - m.startedAt > game.maxMs) {
      // tiebreak: mer hp → annars närmare centrum → annars slump
      let cx = m.geo.platformX || m.geo.ringX || (m.geo.bounds ? m.geo.bounds.x + m.geo.bounds.w / 2 : m.origin.x);
      let cy = m.geo.platformY || m.geo.ringY || (m.geo.bounds ? m.geo.bounds.y + m.geo.bounds.h / 2 : m.origin.y);
      if (psA.hp !== psB.hp) { if (psA.hp > psB.hp) { winner = m.a; loser = m.b; } else { winner = m.b; loser = m.a; } }
      else {
        const dA = dist(psA.x, psA.y, cx, cy), dB = dist(psB.x, psB.y, cx, cy);
        if (dA < dB) { winner = m.a; loser = m.b; }
        else if (dB < dA) { winner = m.b; loser = m.a; }
        else if (Math.random() < 0.5) { winner = m.a; loser = m.b; }
        else { winner = m.b; loser = m.a; }
      }
    }

    if (winner) { resolveGulag(sim, m, winner, loser, now); continue; }

    // DYNAMISK state-broadcast (~8Hz)
    if (now - m.lastTickEmit > 120) {
      m.lastTickEmit = now;
      sim.eventQueue.push({
        type: 'gulag_tick', matchId: m.id, a: m.a, b: m.b,
        platformR: Math.round(m.platformR), ringR: Math.round(m.ringR),
        fallen: m.fallenTiles.slice(),
        warn: (m.warningTiles || []).map(w => w.idx),
        bombHolder: m.bombHolder, bombMs: m.bombEndsAt ? Math.max(0, m.bombEndsAt - now) : 0,
        pu: m.powerups.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), kind: p.kind })),
        timeLeft: Math.max(0, Math.round((game.maxMs - (now - m.startedAt)) / 1000)),
      });
    }
  }

  sim.gulagMatches = sim.gulagMatches.filter(m => !m.ended);
}

// ---- VOID: BR-matchen slutar medan gulags pågår → städa, lämna spelare som spectators ----
function voidAllGulag(sim) {
  ensureGulagState(sim);
  for (const m of sim.gulagMatches) m.ended = true;
  for (const pid of sim.gulagQueue) {
    const ws = sim.room.members.get(pid);
    if (ws && ws.playerState) { clearGulagFields(ws.playerState); ws.playerState.spectating = true; }
  }
  // även fighting-spelare som ev. inte hann resolva
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.gulagState) { clearGulagFields(ws.playerState); ws.playerState.spectating = true; }
  }
  sim.gulagQueue = [];
  sim.gulagMatches = [];
  if (sim._gulagSlotsUsed) sim._gulagSlotsUsed.clear();
}

module.exports = { enterGulag, gulagMatchmake, tickGulag, voidAllGulag, ensureGulagState, startGulagPractice };
