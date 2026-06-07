// Phase 3: bullets + collision på server.
// Speglar spawnPlayerBullets (game.js:4982-5071) + updateBullets (game.js:7870-8010) + applyBulletEffects (game.js:7829-7868).
// Skippat i Phase 3a (kommer i 3b/3c):
//   - Boomerang return-mekanik (komplext)
//   - Blackhole pull (kräver continuous-effekt på enemies)
//   - Mind-control (gjorts via mark på enemy direkt utan bullet)
//   - Drone summon (klient-side ändå)
//   - Time-stop (state.timeStopUntil — kunde porteras enkelt)
//   - Pull-whip (drar enemy mot spelaren)
'use strict';

const { W_BY_ID } = require('../../shared/weapons-data');
const { findNearestPlayer } = require('./enemies');
const { CTF_ARENA, bulletHitsWall } = require('../../shared/ctf-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');
const { SIEGE_ARENA } = require('../../shared/siege-arena');
const { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS, GUNGAME_DEMOTE_FLOOR } = require('../../shared/gungame-arena');
const { KOTH_ARENA } = require('../../shared/koth-arena');
const { JUGGERNAUT_ARENA } = require('../../shared/juggernaut-arena');
const { BATTLEROYALE_ARENA } = require('../../shared/battleroyale-arena');
const { CASTLEDEFENSE_ARENA } = require('../../shared/castledefense-arena');
const { HEIST_ARENA } = require('../../shared/heist-arena');

// v1.656: återanvänd scratch-array för bullet-collision spatial-query (noll-alloc).
// Säkert att dela mellan rum: servern är single-threaded och arrayen fylls + läses
// inom EN synkron loop-iteration (ingen await emellan). explode()/chain använder
// fortfarande getNearby (egen alloc) så ingen scratch-korruption mitt i iterationen.
const _bulletQueryScratch = [];

// PvP balance-overrides: tillämpas bara när sim.tdmActive eller sim.ctfActive.
// Sniper nerf: 130→95 (fortfarande 2-shot genom shield+hp men inte instant).
// Pistol buff: 18→24 (TTK 200hp 6→7 shots, mer relevant än 12).
// Railgun nerf: 280→140 (annars 1-shot genom 200 EHP, no counterplay).
// Rocket direct nerf: 150→95 (AoE 140 behålls — duo-träffar är fortfarande starka).
const PVP_DMG_OVERRIDE = {
  sniper: 95,
  pistol: 24,
  railgun: 140,
  rocket: 95,
};
function getPvpDmg(weaponId, baseDmg) {
  if (PVP_DMG_OVERRIDE[weaponId] != null) return PVP_DMG_OVERRIDE[weaponId];
  return baseDmg;
}

// Lag compensation: returnera target-position rewindad shooterRtt/2 (cap 200ms)
// så klienten som sköt ser "sina träffar registrera" mot vad de såg på sin
// skärm. Server-tickSim pushar positionssnapshots till playerState._history.
// Anti-cheat: cap 200ms => cheaters kan inte claim 5000ms ping för att träffa
// genom väggar / mot teleporterade spelare.
// v1.701: cap 200→250 + lägg klientens INTERP_DELAY (60ms) ovanpå RTT/2. Klienten
// renderar nu remotes ~60ms bakåt (interp-buffert i game.js) — utan att matcha det i
// rewinden skulle skott registrera mot en position 60ms FÖRE det skytten såg → miss på
// rörliga mål. INTERP_DELAY måste hållas i sync med game.js INTERP_DELAY_MS.
const MAX_REWIND_MS = 250;
const CLIENT_INTERP_DELAY_MS = 60;
function rewoundPosition(targetWs, shooterRtt) {
  if (!targetWs || !targetWs.playerState) return null;
  const cur = { x: targetWs.playerState.x, y: targetWs.playerState.y };
  // v1.701: skippa BARA för bots (rtt 0/undefined → ingen klient-interp). Alla människor
  // har 60ms interp-delay → behöver rewind även vid låg ping (annars miss på rörliga mål).
  if (!shooterRtt) return cur;
  const rewindMs = Math.min(MAX_REWIND_MS, shooterRtt / 2 + CLIENT_INTERP_DELAY_MS);
  const targetTime = Date.now() - rewindMs;
  const hist = targetWs.playerState._history;
  if (!hist || hist.length === 0) return cur;
  // Hitta snapshot vid targetTime (linear scan från slut — oftast nyligen)
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].t <= targetTime) {
      const next = hist[i + 1];
      if (next) {
        // Interpolera mellan hist[i] och next för exakt position vid targetTime
        const span = next.t - hist[i].t;
        const f = span > 0 ? (targetTime - hist[i].t) / span : 0;
        return { x: hist[i].x + (next.x - hist[i].x) * f, y: hist[i].y + (next.y - hist[i].y) * f };
      }
      return { x: hist[i].x, y: hist[i].y };
    }
  }
  // targetTime äldre än alla snapshots — använd äldsta tillgängliga
  return { x: hist[0].x, y: hist[0].y };
}

// Skada enemy server-side (mirror av game.js:5073-5116, utan UI/audio)
// Returnerar true om enemy dog.
function damageEnemy(e, dmg, isCrit, fromPid) {
  if (e.dead) return false;
  e.hp -= dmg;
  e.flashUntil = (Date.now() + 80);
  if (fromPid) e.lastDamagerPid = fromPid;
  if (e.hp <= 0) {
    e.dead = true;
    return true;
  }
  return false;
}

// applyMelee — server-auth melee-attack i PvP-modes. Klienten skickar sim_shoot
// även för melee-vapen så server kan göra hit-detection mot andra spelare.
// Story-mode melee körs fortfarande lokalt på klient mot state.enemies.
// p = { x, y, aimAngle, r, peerId }
function applyMelee(sim, p, weaponId, params) {
  const w = W_BY_ID[weaponId];
  if (!w || w.type !== 'melee') return;
  // PvP-modes hanteras nedan. v1.640: HEIST också (co-op vs server-AI police/guards)
  const inGungame = !!sim.gungameActive && !sim.gungameEnded;
  const inTdm = !!sim.tdmActive && !sim.tdmEnded;
  const inCtf = !!sim.ctfActive && !sim.ctfEnded;
  const inSiege = !!sim.siegeActive && !sim.siegeEnded;
  const inKoth = !!sim.kothActive && !sim.kothEnded;
  const inJug = !!sim.juggernautActive && !sim.juggernautEnded;
  const inBr = !!sim.battleroyaleActive && !sim.battleroyaleEnded;
  const inHeist = !!sim.heistActive && !sim.heistEnded;
  if (!inGungame && !inTdm && !inCtf && !inSiege && !inKoth && !inJug && !inBr && !inHeist) return;

  // HEIST melee: damage enemies (police/guards) inom range
  if (inHeist) {
    const range = w.range || 40;
    const dmgMul = params.dmgMul || 1;
    const baseDmg = (w.dmg || 25) * dmgMul;
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d2 = dx * dx + dy * dy;
      const r = range + (e.r || 14);
      if (d2 > r * r) continue;
      // Cone-check: enemy ska vara i aim-riktningen (90° cone)
      const a = Math.atan2(dy, dx);
      let da = a - p.aimAngle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > Math.PI / 2) continue;
      const died = damageEnemy(e, baseDmg, false, p.peerId);
      if (died) {
        // Emit enemy_killed event så klient ser kill-bekräftelse
        sim.eventQueue.push({ type: 'enemy_killed', i: e._idx, killerPid: p.peerId });
      }
    }
    return;
  }

  const ownerWs = sim.room.members.get(p.peerId);
  if (!ownerWs) return;
  const range = w.range || 40;
  const cheats = params.cheats || {};
  const dmgMul = params.dmgMul || 1;
  const adrenalineDmg = params.adrenalineDmg || 1;
  const stealthBonus = params.stealthBonus || 1;
  const critChance = params.critChance || 0;
  const headshotPerk = !!(params.perks && params.perks.headshot);
  const ultMul = cheats.ultimate ? 10 : 1;
  const ownerTeam = ownerWs.tdmTeam;
  const shooterIsJug = inJug && ownerWs.playerState && ownerWs.playerState.isJug;

  for (const [pid, ws] of sim.room.members) {
    if (pid === p.peerId) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    // Friendly-fire av i team-modes (KOTH + gungame + BR är FFA — alla mål).
    // Juggernaut: hunters får BARA skada JUG, JUG får skada alla hunters.
    const isFfa = inGungame || inKoth || inBr;
    // Friendly fire FAIL-CLOSED i team-modes: skada BARA en spelare vars team är KÄNT
    // och SKILJER sig från skytten. Okänt mål-team (late-join/edge) → ingen skada
    // (förr: fail-open → träffade lagkamrater vars team saknades i mappen = FF-bugg).
    if (!isFfa && !inJug && ownerTeam && (!ws.tdmTeam || ws.tdmTeam === ownerTeam)) continue;
    if (inJug) {
      const targetIsJug = !!ws.playerState.isJug;
      if (!shooterIsJug && !targetIsJug) continue; // hunter→hunter blockerat
      if (shooterIsJug && targetIsJug) continue;   // (kan inte hända, en JUG)
    }

    const dx = ws.playerState.x - p.x;
    const dy = ws.playerState.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > range + 14) continue;
    // Cone-check: 0.9 rad framför aimAngle (samma som klient game.js:10876)
    const a = Math.atan2(dy, dx);
    const diff = Math.abs(((a - p.aimAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > 0.9) continue;

    const isCrit = cheats.chozza ? true : Math.random() < critChance;
    const isHead = headshotPerk && Math.random() < 0.15;
    let baseDmg = getPvpDmg(weaponId, w.dmg);
    // JUG-vapen-specialer:
    //  - Sledge = 1-hit-kill garanterat (bygger high-risk-close-quarters-fantasin)
    //  - Övriga vapen får jugWeaponDmgMul
    if (inJug && shooterIsJug) {
      if (weaponId === 'sledge') {
        baseDmg = 99999; // garanterad kill genom shield + max HP
      } else if (JUGGERNAUT_ARENA.jugWeaponDmgMul) {
        const mul = JUGGERNAUT_ARENA.jugWeaponDmgMul[weaponId];
        if (typeof mul === 'number') baseDmg *= mul;
      }
    }
    const finalDmg = baseDmg * dmgMul * adrenalineDmg * stealthBonus * ultMul * (isCrit ? 2 : 1) * (isHead ? 3 : 1);

    // Apply damage (shield först)
    let remaining = finalDmg;
    if ((ws.playerState.shield || 0) > 0) {
      const absorb = Math.min(ws.playerState.shield, remaining);
      ws.playerState.shield -= absorb;
      remaining -= absorb;
    }
    if (remaining > 0) {
      ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
    }
    sim.eventQueue.push({
      type: 'pvp_hp_changed',
      peerId: pid,
      hp: ws.playerState.hp,
      shield: ws.playerState.shield || 0,
    });

    // Damage-attribution för juggernaut (hunter skadar JUG → tracka för transfer)
    if (inJug && !shooterIsJug && ws.playerState.isJug && sim._trackJuggernautDmg) {
      sim._trackJuggernautDmg(sim, p.peerId, pid, finalDmg);
    }
    // Kill-flow (mode-specifikt)
    if (ws.playerState.hp <= 0) {
      if (inJug) {
        if (sim._handleJuggernautKill) sim._handleJuggernautKill(sim, p.peerId, ownerWs, pid, ws, weaponId);
      } else if (inGungame) {
        handleGungameKill(sim, p.peerId, ownerWs, pid, ws, weaponId);
      } else if (inKoth) {
        handleKothKill(sim, p.peerId, pid, ws, weaponId);
      } else if (inTdm) {
        handleTdmKill(sim, p.peerId, pid, ws, ownerTeam, weaponId);
      } else if (inCtf) {
        handleCtfKill(sim, p.peerId, pid, ws, ownerTeam, weaponId);
      } else if (inSiege) {
        handleSiegeKill(sim, p.peerId, pid, ws, ownerTeam, weaponId);
      } else if (inBr && ws.playerState.gulagState !== 'fighting') {
        if (sim._handleBattleRoyaleKill) sim._handleBattleRoyaleKill(sim, p.peerId, ownerWs, pid, ws, weaponId);
      }
      // GULAG (v1.790): melee-död i duell hanteras av tickGulag (hp=0 redan satt ovan).
      // BREAK: en swing träffar bara en spelare (mirror av klient-melee). Utan
      // detta promotras gungame-bot dubbelt om 2 fiender står i cone+range.
      break;
    }
  }
}

// handleTdmKill — kill-flow för TDM. Refactor av bullets-loopen så applyMelee kan
// återanvända samma flow. Antar att invuln+team-checks redan gjorts av caller.
// GUARD: om victim redan har respawn-timer (= redan dödad denna tick) → skip,
// annars dubbel-räknas explosion+bullet samma tick → score-inflation + falsk match-end.
function handleTdmKill(sim, killerPid, victimPid, victimWs, ownerTeam, weaponId) {
  // CS-runda: ingen mid-runda-respawn. Dubbel-count-guard via _tdmDeadRound
  // (sätts här + rensas vid runda-start). Tidigare användes tdmRespawnAt.
  if (victimWs._tdmDeadRound) return;
  // Killer kan ha disconnectat mellan bullet-spawn och hit (rare). Skip credit
  // så stats inte rapporterar ghost-kills för borttagna peerId:n.
  if (!sim.room.members.has(killerPid)) return;
  victimWs._tdmDeadRound = true;
  sim.tdmKills[ownerTeam] = (sim.tdmKills[ownerTeam] || 0) + 1;
  sim.tdmKillsByPid[killerPid] = (sim.tdmKillsByPid[killerPid] || 0) + 1;
  sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
  sim.eventQueue.push({
    type: 'tdm_kill',
    killer: killerPid,
    victim: victimPid,
    killerTeam: ownerTeam,
    victimTeam: victimWs.tdmTeam,
    weapon: weaponId || null,
    redKills: sim.tdmKills.red,
    blueKills: sim.tdmKills.blue,
  });
  sim.eventQueue.push({
    type: 'tdm_player_died',
    victim: victimPid,
    round: true,
  });
  // v1.732: match slutar EJ på kills längre — det avgörs av RUNDA-VINSTER (team-wipe →
  // round-end i room-sim.js). Kills räknas bara för scoreboard/stats + kill-feed.
}

// handleCtfKill — kill-flow för CTF inkl. flag-drop om offret bar flagga.
function handleCtfKill(sim, killerPid, victimPid, victimWs, ownerTeam, weaponId) {
  if (victimWs.tdmRespawnAt) return;
  if (!sim.room.members.has(killerPid)) return;
  victimWs.tdmRespawnAt = Date.now() + 3000;
  sim.ctfKillsByPid[killerPid] = (sim.ctfKillsByPid[killerPid] || 0) + 1;
  sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
  sim.eventQueue.push({
    type: 'ctf_kill',
    killer: killerPid,
    victim: victimPid,
    killerTeam: ownerTeam,
    victimTeam: victimWs.tdmTeam,
    weapon: weaponId || null,
  });
  sim.eventQueue.push({
    type: 'ctf_player_died',
    victim: victimPid,
    durationMs: 3000,
  });
  // Drop flagga om victim bar en
  for (const team of ['red', 'blue']) {
    const flag = sim.ctfFlags[team];
    if (flag.carrierId === victimPid) {
      flag.carrierId = null;
      flag.atBase = false;
      flag.x = victimWs.playerState.x;
      flag.y = victimWs.playerState.y;
      flag.droppedAt = Date.now();
      sim.eventQueue.push({
        type: 'ctf_flag_dropped',
        team, x: flag.x, y: flag.y, droppedBy: victimPid,
      });
    }
  }
}

// handleSiegeKill — kill-flow för SIEGE. +3 poäng till killer-teamet.
function handleSiegeKill(sim, killerPid, victimPid, victimWs, ownerTeam, weaponId) {
  if (victimWs.tdmRespawnAt) return;
  if (!sim.room.members.has(killerPid)) return;
  victimWs.tdmRespawnAt = Date.now() + 3000;
  sim.siegeKillsByPid[killerPid] = (sim.siegeKillsByPid[killerPid] || 0) + 1;
  sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
  sim.siegeScores[ownerTeam] = (sim.siegeScores[ownerTeam] || 0) + 3;
  sim.eventQueue.push({
    type: 'siege_kill',
    killer: killerPid, victim: victimPid,
    killerTeam: ownerTeam, victimTeam: victimWs.tdmTeam,
    weapon: weaponId || null,
  });
  sim.eventQueue.push({ type: 'siege_player_died', victim: victimPid, durationMs: 3000 });
  sim.eventQueue.push({ type: 'siege_score_update', red: sim.siegeScores.red, blue: sim.siegeScores.blue });
  if (sim.siegeScores[ownerTeam] >= sim.siegeTargetPoints) {
    sim.siegeEnded = true;
    const stats = { red: sim.siegeScores.red, blue: sim.siegeScores.blue, perPlayer: {} };
    for (const [p, w2] of sim.room.members) {
      stats.perPlayer[p] = {
        team: w2.tdmTeam,
        kills: sim.siegeKillsByPid[p] || 0,
        deaths: sim.tdmDeathsByPid[p] || 0,
      };
    }
    sim.eventQueue.push({
      type: 'siege_match_end',
      winner: ownerTeam, reason: 'points',
      scores: { red: sim.siegeScores.red, blue: sim.siegeScores.blue },
      stats,
    });
  }
}

// handleKothKill — kill-flow för KOTH. Inkrementera kills, respawn-timer.
// Ingen tier-progression, ingen poäng-bonus för kill (KOTH-poäng kommer från
// zone-occupancy). Bara kill-feed + respawn.
function handleKothKill(sim, killerPid, victimPid, victimWs, weaponId) {
  if (victimWs.tdmRespawnAt) return;
  if (!sim.room.members.has(killerPid)) return;
  sim.kothKillsByPid[killerPid] = (sim.kothKillsByPid[killerPid] || 0) + 1;
  sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
  victimWs.tdmRespawnAt = Date.now() + 3000;
  sim.eventQueue.push({
    type: 'koth_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
  });
  sim.eventQueue.push({
    type: 'koth_respawn_pending',
    peerId: victimPid,
    durationMs: 3000,
  });
}

// handleGungameKill — promote shooter, demote victim om melee, schedule respawn,
// emit gungame_kill + gungame_respawn_pending, check win-condition.
// Kallas från bullets-loopen (PvP-hit) och applyMelee.
// GUARD: dubbel-kill samma tick → bara första räknas (annars dubbel tier-promote).
function handleGungameKill(sim, killerPid, killerWs, victimPid, victimWs, weaponId) {
  if (victimWs.tdmRespawnAt) return;
  if (!sim.room.members.has(killerPid)) return;
  const wasMelee = GUNGAME_MELEE_DEMOTERS.has(weaponId);
  sim.gungameKillsByPid[killerPid] = (sim.gungameKillsByPid[killerPid] || 0) + 1;
  const oldTier = sim.gungameTiers[killerPid] || 0;
  const vTierBefore = sim.gungameTiers[victimPid] || 0;
  const newTier = Math.min(GUNGAME_WEAPONS.length - 1, oldTier + 1);
  sim.gungameTiers[killerPid] = newTier;
  if (killerWs.playerState) {
    killerWs.playerState.weaponId = GUNGAME_WEAPONS[newTier];
  }
  // Demote-regler:
  // - Late-game (tier >= DEMOTE_FLOOR = level 10+): ANY death demoteras, floor 9.
  //   Stakes höjs i late-game — kan inte campa toppen riskfritt.
  // - Early/mid (tier < 9): bara melee-kill demoterar, om killer >= tier 5
  //   ELLER offret leder med ≥3 tiers (catch-up). Floor 0.
  let demoted = false;
  if (vTierBefore >= GUNGAME_DEMOTE_FLOOR) {
    const newVTier = Math.max(GUNGAME_DEMOTE_FLOOR, vTierBefore - 1);
    if (newVTier < vTierBefore) {
      sim.gungameTiers[victimPid] = newVTier;
      demoted = true;
    }
  } else if (wasMelee && (oldTier >= 5 || (vTierBefore - oldTier) >= 3)) {
    const newVTier = Math.max(0, vTierBefore - 1);
    if (newVTier < vTierBefore) {
      sim.gungameTiers[victimPid] = newVTier;
      demoted = true;
    }
  }
  sim.eventQueue.push({
    type: 'gungame_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
    killerTier: newTier,
    victimTier: sim.gungameTiers[victimPid],
    wasMelee,
    demoted,
  });
  victimWs.tdmRespawnAt = Date.now() + 3000;
  sim.eventQueue.push({
    type: 'gungame_respawn_pending',
    peerId: victimPid,
    durationMs: 3000,
  });
  // Win: killer hade redan tier 14 (sledge) när killen registrerades
  if (oldTier === GUNGAME_WEAPONS.length - 1) {
    if (sim._endGungameMatch) {
      sim._endGungameMatch(sim, killerPid, 'final_tier_kill');
    }
  }
}

// Spawna player bullets — speglar spawnPlayerBullets-loopen (game.js:5029-5068)
// p = { x, y, aimAngle, r=14, peerId, dmgMul, bspeedMul, explMul, kbMul, critChance, perks, cheats }
function spawnPlayerBullets(sim, p, weaponId, params) {
  const w = W_BY_ID[weaponId];
  if (!w || w.type === 'melee') return;  // melee handled by applyMelee
  // Special: mind-control — mark närmsta fiende, ingen bullet
  if (w.id === 'mindcontrol') {
    let target = null, bestD2 = 999 * 999;
    for (const e of sim.enemies) {
      if (e.dead || e.isBoss || e.mindControlled) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; target = e; }
    }
    if (target) {
      target.mindControlled = true;
      target.mindControlUntil = Date.now() + (w.mindControlMs || 5000);
    }
    return;
  }
  // Time-stop — sätt server-side global flag
  if (w.timeStopMs) {
    sim.timeStopUntil = Date.now() + w.timeStopMs;
  }
  const pellets = w.pellets || 1;
  const cheats = params.cheats || {};
  const cheatChozza = !!cheats.chozza;
  const cheatPen = !!cheats.penetrera;
  const cheatUlt = !!cheats.ultimate;
  const speedBonus = (cheatPen ? 1.5 : 1) * (cheatUlt ? 1.5 : 1);
  const ultDmgMul = cheatUlt ? 10 : 1;
  const dmgMul = params.dmgMul || 1;
  const bspeedMul = params.bspeedMul || 1;
  const explMul = params.explMul || 1;
  const kbMul = params.kbMul || 1;
  const critChance = params.critChance || 0;
  const adrenalineDmg = params.adrenalineDmg || 1;
  const stealthBonus = params.stealthBonus || 1;
  const headshotPerk = !!(params.perks && params.perks.headshot);

  // BR wall-check helper: testa om punkt är inuti en SOLID wall (icke-fönster)
  const brWalls = sim.battleroyaleActive
    ? BATTLEROYALE_ARENA.walls.filter(w => !w.passThroughBullets)
    : null;
  const isInsideBrWall = (bx, by) => {
    if (!brWalls) return false;
    for (let i = 0; i < brWalls.length; i++) {
      const w = brWalls[i];
      if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) return true;
    }
    return false;
  };
  // Raytrace: sampla punkter mellan player och spawn → om någon inuti wall = blocked
  const raycastBlocked = (px, py, sx, sy) => {
    if (!brWalls) return false;
    const dx = sx - px, dy = sy - py;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(4, Math.ceil(len / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (isInsideBrWall(px + dx * t, py + dy * t)) return true;
    }
    return false;
  };
  for (let i = 0; i < pellets; i++) {
    const spread = (Math.random() - 0.5) * 2 * (w.spread || 0);
    const ang = p.aimAngle + spread;
    const speed = w.speed * bspeedMul * speedBonus;
    const isCrit = cheatChozza ? true : Math.random() < critChance;
    const isHead = headshotPerk && Math.random() < 0.15;
    // Bullet-start vid player+offset
    const bx = p.x + Math.cos(ang) * (p.r || 14);
    const by = p.y + Math.sin(ang) * (p.r || 14);
    // BUG-FIX: raytrace från player till bullet-start. Om någon wall är
    // mellan player och spawn → bullet skapas inte. Förhindrar
    // "skjut genom väggen via pip-offset"-exploit.
    if (sim.battleroyaleActive) {
      if (raycastBlocked(p.x, p.y, bx, by)) continue;
      if (isInsideBrWall(bx, by)) continue;
    }
    sim.bullets.push({
      x: bx,
      y: by,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      dmg: w.dmg * dmgMul * adrenalineDmg * stealthBonus * (isCrit ? 2 : 1) * (isHead ? 3 : 1) * ultDmgMul,
      life: w.id === 'flame' ? 0.5 : (w.id === 'boomerang' ? 2.5 : 1.6),
      r: isCrit ? 5 : (w.id === 'flame' ? 6 : 4),
      color: (isCrit || isHead || cheatChozza) ? '#ffeb3b' : w.color,
      hostile: false,
      weaponId: weaponId,
      pierce: cheatPen || cheatUlt || !!w.pierce,
      explosive: (w.explosive || 0) * explMul,
      crit: isCrit || isHead,
      style: w.id,
      burn: w.burn || 0,
      chain: w.chain || 0,
      slow: w.slow || 0,
      knockback: (w.knockback || 0) * kbMul,
      pullRadius: w.pullRadius || 0,
      pullsEnemy: !!w.pullsEnemy,
      returns: !!w.returns,
      returnTimer: 0,
      origin: { x: p.x, y: p.y },
      bounced: false,
      ownerPid: p.peerId,  // kill-credit
      hitIds: null,
    });
  }
}

// Apply bullet effects på en träffad fiende (mirror av game.js:7829-7868)
function applyBulletEffects(b, e, sim) {
  // Burn (DoT)
  if (b.burn > 0) {
    e.burnUntil = Date.now() + 4000;
    e.burnDps = b.burn;
  }
  // Slow
  if (b.slow > 0) {
    e.slowUntil = Date.now() + 1500;
    e.slowFactor = 1 / b.slow;
  }
  // Knockback (push)
  if (b.knockback > 0) {
    const ang = Math.atan2(b.vy, b.vx);
    e.x += Math.cos(ang) * b.knockback * 0.05;
    e.y += Math.sin(ang) * b.knockback * 0.05;
    e.staggerUntil = Date.now() + 200;
  }
  // Chain (tesla) — spatial-hash: bara enemies inom 240px-radie per hop
  if (b.chain > 0) {
    let prevPos = { x: e.x, y: e.y };
    let chainsLeft = b.chain;
    const hitSet = new Set([e]);
    while (chainsLeft > 0) {
      let nextE = null, bestD2 = 240 * 240;
      const candidates = sim.enemyGrid
        ? sim.enemyGrid.getNearby(prevPos.x, prevPos.y, 240)
        : sim.enemies;
      for (let i = 0; i < candidates.length; i++) {
        const o = candidates[i];
        if (hitSet.has(o) || o.dead) continue;
        const dx = o.x - prevPos.x, dy = o.y - prevPos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; nextE = o; }
      }
      if (!nextE) break;
      damageEnemy(nextE, b.dmg * 0.5, false, b.ownerPid);
      hitSet.add(nextE);
      prevPos = { x: nextE.x, y: nextE.y };
      chainsLeft--;
    }
  }
}

// Explode (radius damage) — speglar game.js:5435-5458
// v1.374: friendly-fire blockerat i ALLA team-baserade scenarier:
//   - Co-op (story/sandbox/endless/bossrush) — INGEN spelare-skada alls
//   - TDM/CTF/Siege — eget lag blockerat
//   - Juggernaut — hunter→hunter blockerat
//   - FFA-modes (gungame/koth/BR) — alla utom self skadas
function explode(sim, x, y, radius, dmg, fromPid) {
  const fromWs = fromPid ? sim.room.members.get(fromPid) : null;
  const fromTeam = fromWs && fromWs.tdmTeam;
  const fromIsJug = !!(fromWs && fromWs.playerState && fromWs.playerState.isJug);
  const inGungame = !!sim.gungameActive;
  const inKoth = !!sim.kothActive;
  const inBr = !!sim.battleroyaleActive;
  const inJug = !!sim.juggernautActive;
  const inTeamPvP = !!(sim.tdmActive || sim.ctfActive || sim.siegeActive);
  const inPvP = inTeamPvP || inGungame || inKoth || inBr || inJug;
  if (!inPvP) {
    // Spatial-hash: query bara enemies inom explosion-radie
    const list = sim.enemyGrid ? sim.enemyGrid.getNearby(x, y, radius) : sim.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius) {
        const falloff = 1 - Math.sqrt(d2) / radius;
        damageEnemy(e, dmg * (0.4 + falloff * 0.6), false, fromPid);
      }
    }
  }
  // Skadar även spelare i radie
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    // Aldrig skada sig själv (gäller även co-op story)
    if (pid === fromPid) continue;
    // Co-op (icke-PvP): ALDRIG skada andra spelare — alla är allierade
    if (!inPvP) continue;
    // Team-PvP: eget lag blockerat
    if (inTeamPvP) {
      if (!fromTeam || !ws.tdmTeam) continue;  // okänt team → no-op (safer)
      if (ws.tdmTeam === fromTeam) continue;   // friendly fire av
    }
    // Juggernaut: hunter→hunter blockerat (JUG→JUG kan inte hända, en JUG)
    if (inJug) {
      const targetIsJug = !!ws.playerState.isJug;
      if (!fromIsJug && !targetIsJug) continue;
      if (fromIsJug && targetIsJug) continue;
    }
    const invuln = ws.playerState.invulnUntil || 0;
    if (Date.now() < invuln) continue;         // respawn-invuln skyddar
    const dx = ws.playerState.x - x, dy = ws.playerState.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      const falloff = 1 - Math.sqrt(d2) / radius;
      const finalDmg = dmg * (0.3 + falloff * 0.4);
      // Shield absorberar först
      let remaining = finalDmg;
      if ((ws.playerState.shield || 0) > 0) {
        const absorb = Math.min(ws.playerState.shield, remaining);
        ws.playerState.shield -= absorb;
        remaining -= absorb;
      }
      if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
      sim.eventQueue.push({
        type: 'pvp_hp_changed',
        peerId: pid,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
      });
      // v1.698: explosiv kill-attribution. Förr anropade explode() ALDRIG per-mode
      // kill-handlers → GunGame promotade ej på rocket-kill (fastnade tier 12), JUG-
      // explosiv-kill överförde rollen till RANDOM hunter, ingen kill-credit/win-check.
      // Mirror av bullet-pathen (men INGEN break — en explosion kan döda flera).
      if (inJug && !fromIsJug && ws.playerState.isJug && sim._trackJuggernautDmg) {
        sim._trackJuggernautDmg(sim, fromPid, pid, finalDmg);
      }
      if (ws.playerState.hp <= 0 && fromPid && fromWs) {
        if (inJug) {
          if (sim._handleJuggernautKill) sim._handleJuggernautKill(sim, fromPid, fromWs, pid, ws, 'explosion');
        } else if (inGungame) {
          handleGungameKill(sim, fromPid, fromWs, pid, ws, 'explosion');
        } else if (inKoth) {
          handleKothKill(sim, fromPid, pid, ws, 'explosion');
        } else if (sim.tdmActive) {
          handleTdmKill(sim, fromPid, pid, ws, fromTeam, 'explosion');
        } else if (sim.ctfActive) {
          handleCtfKill(sim, fromPid, pid, ws, fromTeam, 'explosion');
        } else if (sim.siegeActive) {
          handleSiegeKill(sim, fromPid, pid, ws, fromTeam, 'explosion');
        } else if (inBr) {
          if (sim._handleBattleRoyaleKill) sim._handleBattleRoyaleKill(sim, fromPid, fromWs, pid, ws, 'explosion');
        }
      }
    }
  }
  // Siege-cores: explosion nära enemy-core ska skada den (med 0.15× nerf så
  // explosive-spam inte trivialiserar core-rush). Förhindrar friendly fire.
  if (sim.siegeActive && fromPid && sim.siegeCores) {
    const fromTeamSiege = fromWs && fromWs.tdmTeam;
    for (const cid of Object.keys(sim.siegeCores)) {
      const core = sim.siegeCores[cid];
      if (core.destroyed || core.team === fromTeamSiege) continue;
      const cx = core.x + (core.w || 0) / 2;
      const cy = core.y + (core.h || 0) / 2;
      const dx = cx - x, dy = cy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius) {
        const falloff = 1 - Math.sqrt(d2) / radius;
        core.hp = Math.max(0, core.hp - dmg * 0.15 * falloff);
        sim.eventQueue.push({ type: 'siege_core_damaged', coreId: cid, hp: core.hp, maxHp: core.maxHp });
        if (core.hp <= 0 && !core.destroyed) {
          core.destroyed = true;
          if (sim._endSiegeMatch) sim._endSiegeMatch(sim, fromTeamSiege, 'core_destroyed');
        }
      }
    }
  }
  // v1.376: explosions skadar nu turrets (rockets/grenade-launcher mot torn).
  // Friendly fire: ego-laget passerar genom egen turret = no damage.
  const explodeTurrets = (turrets, dmgEvent) => {
    if (!turrets) return;
    for (const tid of Object.keys(turrets)) {
      const t = turrets[tid];
      if (!t || t.destroyed) continue;
      if (fromTeam && fromTeam === t.team) continue; // friendly = skip
      const dx = t.x - x, dy = t.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius) {
        const falloff = 1 - Math.sqrt(d2) / radius;
        t.hp = Math.max(0, t.hp - dmg * (0.3 + falloff * 0.5));
        sim.eventQueue.push({ type: dmgEvent, turretId: t.id, hp: t.hp, maxHp: t.maxHp });
        if (t.hp <= 0 && !t.destroyed) {
          t.destroyed = true;
          t.destroyedAt = Date.now();
          const ejected = t.occupantId;
          if (ejected) {
            const ws2 = sim.room.members.get(ejected);
            if (ws2) {
              if (sim.ctfActive) ws2._mountedCtfTurretId = null;
              else if (sim.siegeActive) ws2._mountedSiegeTurretId = null;
              if (ws2.playerState) {
                ws2.playerState.x = t.x + (t.team === 'red' ? 35 : -35);
                ws2.playerState.y = t.y;
              }
            }
            t.occupantId = null;
            const exitEv = sim.ctfActive ? 'ctf_turret_exited' : 'siege_turret_exited';
            sim.eventQueue.push({ type: exitEv, peerId: ejected, turretId: t.id, reason: 'destroyed' });
          }
          const destrEv = sim.ctfActive ? 'ctf_turret_destroyed' : 'siege_turret_destroyed';
          sim.eventQueue.push({ type: destrEv, turretId: t.id });
        }
      }
    }
  };
  if (sim.ctfActive && sim.ctfTurrets) explodeTurrets(sim.ctfTurrets, 'ctf_turret_damaged');
  if (sim.siegeActive && sim.siegeTurrets) explodeTurrets(sim.siegeTurrets, 'siege_turret_damaged');
}

// Update bullets — collision + life + special-effekter (boomerang/blackhole/pull-whip).
// Mirror av game.js:7870-8010.
function updateBullets(sim, dt, now) {
  const bullets = sim.bullets;
  // Hitta ägare-spelare för boomerang-return
  function findOwnerPos(ownerPid) {
    if (!ownerPid) return null;
    const ws = sim.room.members.get(ownerPid);
    return ws && ws.playerState ? { x: ws.playerState.x, y: ws.playerState.y } : null;
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    // Spara förra position för swept-collision (bulletHitsWall i CTF använder den).
    b._prevX = b.x; b._prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    // Blackhole: drar enemies mot bullet (mirror av game.js:7881-7892)
    if (b.pullRadius && !b.hostile) {
      const pr = b.pullRadius;
      for (const e of sim.enemies) {
        if (e.dead || e.isBoss) continue;
        const dx = b.x - e.x, dy = b.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < pr * pr) {
          const d = Math.sqrt(d2) || 1;
          const force = (1 - d / pr) * 200 * dt;
          e.x += (dx / d) * force;
          e.y += (dy / d) * force;
        }
      }
    }
    // Boomerang return-mekanik (game.js:7894-7903)
    if (b.returns && !b.hostile) {
      b.returnTimer = (b.returnTimer || 0) + dt;
      if (b.returnTimer > 0.7) {
        const ownerPos = findOwnerPos(b.ownerPid);
        if (ownerPos) {
          const dxp = ownerPos.x - b.x, dyp = ownerPos.y - b.y;
          const dp = Math.sqrt(dxp * dxp + dyp * dyp) || 1;
          const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          b.vx = (dxp / dp) * speed;
          b.vy = (dyp / dp) * speed;
          if (dp < 25) { bullets.splice(i, 1); continue; }
        }
      }
    }
    // Pull-whip: drar enemy mot ägare (game.js:7906-7913)
    if (b.pullsEnemy && !b.hostile) {
      const ownerPos = findOwnerPos(b.ownerPid);
      if (ownerPos) {
        for (const e of sim.enemies) {
          if (e.dead || e.isBoss) continue;
          const dx = e.x - b.x, dy = e.y - b.y;
          const rsum = e.r + b.r + 8;
          if (dx * dx + dy * dy < rsum * rsum) {
            const dxp = ownerPos.x - e.x, dyp = ownerPos.y - e.y;
            const dp = Math.sqrt(dxp * dxp + dyp * dyp) || 1;
            e.x += (dxp / dp) * 80;
            e.y += (dyp / dp) * 80;
          }
        }
      }
    }
    // Out-of-bounds eller life-ut → spräng om explosive.
    // Använd arena-specifik worldW/H så bullets cullas vid rätt edge i alla modes.
    let worldMaxX = 5000, worldMaxY = 5000;
    if (sim.siegeActive) { worldMaxY = SIEGE_ARENA.worldH; }
    else if (sim.juggernautActive) { worldMaxX = JUGGERNAUT_ARENA.worldW; worldMaxY = JUGGERNAUT_ARENA.worldH; }
    else if (sim.battleroyaleActive) { worldMaxX = BATTLEROYALE_ARENA.worldW; worldMaxY = BATTLEROYALE_ARENA.worldH; }
    else if (sim.castledefenseActive) { worldMaxX = CASTLEDEFENSE_ARENA.worldW; worldMaxY = CASTLEDEFENSE_ARENA.worldH; }
    // GULAG (v1.795): kulor från off-map-duellen (13000+) cullas EJ på map-bounds —
    // bara på life-ut/explosion. Annars dog de direkt och nådde aldrig motståndaren.
    if (b.life <= 0 || (!b.gulag && (b.x < 0 || b.y < 0 || b.x > worldMaxX || b.y > worldMaxY))) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    // PvP: wall-collision. Skott dör vid wall-hit så cover faktiskt skyddar.
    if (sim.ctfActive && bulletHitsWall(b, CTF_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    // v1.799: GULAG arena-väggar blockerar kulor (oneshot/frenzy skydd) — tidigare gick
    // skott rakt genom väggarna. Slå upp skyttens aktiva duell-arena via _gulagMatchId.
    if (b.gulag) {
      const _ow = sim.room.members.get(b.ownerPid);
      const _mid = _ow && _ow.playerState && _ow.playerState._gulagMatchId;
      if (_mid && sim.gulagMatches) {
        const _gm = sim.gulagMatches.find(mm => mm.id === _mid);
        if (_gm && _gm.geo && _gm.geo.walls && _gm.geo.walls.length && bulletHitsWall(b, _gm.geo.walls)) {
          bullets.splice(i, 1);
          continue;
        }
      }
    }
    // v1.638/640: HEIST — bara faktiska VÄGGAR blockerar skott (inte counters/pillars
    // som är knähögt cover du ska kunna skjuta över)
    if (sim.heistActive) {
      if (!HEIST_ARENA._bulletWalls) {
        HEIST_ARENA._bulletWalls = HEIST_ARENA.walls.filter(w =>
          w.kind === 'wall' || w.kind === 'wall_vault'
        );
      }
      if (bulletHitsWall(b, HEIST_ARENA._bulletWalls)) {
        if (b.explosive && !b.hostile) {
          explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
        }
        bullets.splice(i, 1);
        continue;
      }
    }
    if (sim.tdmActive && bulletHitsWall(b, TDM_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    if (sim.gungameActive && bulletHitsWall(b, GUNGAME_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    if (sim.kothActive && bulletHitsWall(b, KOTH_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    if (sim.juggernautActive && bulletHitsWall(b, JUGGERNAUT_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    if (sim.battleroyaleActive) {
      // Skippa fönster-walls (passThroughBullets=true) så bullets passerar
      const brSolidWalls = sim._brSolidWalls || (sim._brSolidWalls = BATTLEROYALE_ARENA.walls.filter(w => !w.passThroughBullets));
      if (bulletHitsWall(b, brSolidWalls)) {
        if (b.explosive && !b.hostile) {
          explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
        }
        bullets.splice(i, 1);
        continue;
      }
    }
    // CASTLE DEFENSE bullet-wall:
    // - Hostile bullets (enemies/bosses) stoppas av castle-walls + solida buildings
    //   och DELAR DAMAGE till wall/building (de attackerar muren).
    // - Friendly bullets (spelare + auto-turrets) passerar genom egna walls/turrets
    //   så de når fiender bakom murarna. Annars är auto-turret bakom mur värdelös
    //   och spelare kan inte skjuta från säkerhet av sin egen castle.
    if (sim.castledefenseActive) {
      const cdLiveWalls = sim.castledefenseWalls.filter(w => w.hp > 0);
      const cdLiveBuildings = sim.castledefenseBuildings.filter(s => s.hp > 0);
      // v1.398 fix: matcha tickCastleDefense — ALLA non-trap är solida
      const cdSolidBuildings = cdLiveBuildings.filter(s =>
        s.kind !== 'spike_trap' && s.kind !== 'slow_trap');
      // Friendly bullets: ignorera ALL castle-collision. Hostile: stoppas av allt solidt.
      const cdAllSolids = b.hostile ? cdLiveWalls.concat(cdSolidBuildings) : [];
      if (cdAllSolids.length > 0 && bulletHitsWall(b, cdAllSolids)) {
        // Skada wall/building om bullet är hostile (enemy)
        if (b.hostile && b.dmg > 0) {
          for (const w of cdAllSolids) {
            if (b.x + b.r >= w.x && b.x - b.r <= w.x + w.w &&
                b.y + b.r >= w.y && b.y - b.r <= w.y + w.h) {
              w.hp = Math.max(0, w.hp - b.dmg);
              // Robust check: byggnader har kind != 'castle_wall'
              const isBuild = w.kind && w.kind !== 'castle_wall';
              sim.eventQueue.push({
                type: isBuild ? 'cd_building_damaged' : 'cd_wall_damaged',
                id: w.id, hp: w.hp, maxHp: w.maxHp,
              });
              if (w.hp <= 0) {
                // Flow field rebuild trigger när solid struktur faller
                if (!w.kind || (w.kind !== 'spike_trap' && w.kind !== 'slow_trap')) {
                  sim._cdFlowDirty = true;
                }
                sim.eventQueue.push({
                  type: isBuild ? 'cd_building_destroyed' : 'cd_wall_destroyed',
                  id: w.id,
                });
              }
              break;
            }
          }
        }
        if (b.explosive && !b.hostile) {
          explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
        }
        bullets.splice(i, 1);
        continue;
      }
    }
    // SIEGE: walls + core-damage routing
    if (sim.siegeActive && bulletHitsWall(b, SIEGE_ARENA.walls)) {
      // Hitta vilken wall som träffades — om coreId så damage core
      let coreDamaged = false;
      for (const w of SIEGE_ARENA.walls) {
        if (!w.coreId) continue;
        if (b.x + b.r >= w.x && b.x - b.r <= w.x + w.w &&
            b.y + b.r >= w.y && b.y - b.r <= w.y + w.h) {
          const core = sim.siegeCores[w.coreId];
          if (core && !core.destroyed) {
            // Hindra friendly-fire mot egen core (egen lagets bullet)
            const ownerWs = sim.room.members.get(b.ownerPid);
            const ownerTeam = ownerWs && ownerWs.tdmTeam;
            if (ownerTeam && ownerTeam !== core.team) {
              core.hp = Math.max(0, core.hp - b.dmg);
              sim.eventQueue.push({ type: 'siege_core_damaged', coreId: core.id, hp: core.hp, maxHp: core.maxHp, by: b.ownerPid });
              // Score: 1 pt per 100 dmg dealt to enemy core
              // Balansering: 1 pt per 250 core-dmg (var 100). MG-turret på core
              // ger då 0.75 pt/s istället för 1.87 — inte längre dominant strategi.
              sim._siegeCoreDmgAccum = sim._siegeCoreDmgAccum || { red: 0, blue: 0 };
              sim._siegeCoreDmgAccum[ownerTeam] = (sim._siegeCoreDmgAccum[ownerTeam] || 0) + b.dmg;
              while (sim._siegeCoreDmgAccum[ownerTeam] >= 250) {
                sim._siegeCoreDmgAccum[ownerTeam] -= 250;
                sim.siegeScores[ownerTeam] = (sim.siegeScores[ownerTeam] || 0) + 1;
              }
              sim.eventQueue.push({ type: 'siege_score_update', red: sim.siegeScores.red, blue: sim.siegeScores.blue });
              // Core destroyed → instant win
              if (core.hp <= 0 && !core.destroyed) {
                core.destroyed = true;
                core.destroyedAt = Date.now();
                sim.eventQueue.push({ type: 'siege_core_destroyed', coreId: core.id });
                const { _siegePointAccum } = sim;
                // Vinnaren är den som SKADADE coren (motståndarlaget till core.team)
                const winner = core.team === 'red' ? 'blue' : 'red';
                // sim._endSiegeMatch är callback satt av room-sim.js (lokal scope där)
                if (sim._endSiegeMatch) sim._endSiegeMatch(sim, winner, 'core_destroyed');
              }
            }
          }
          coreDamaged = true;
          break;
        }
      }
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    // SIEGE: turret hit detection — turrets fungerar som väggar (även destroyed
    // vrak blockerar). Skott stannar alltid när de träffar.
    // Friendly fire: bullets från samma lag passerar GENOM egen turret (ignorerar helt).
    if (sim.siegeActive && sim.siegeTurrets) {
      const shooter = b.ownerPid && sim.room.members.get(b.ownerPid);
      const shooterTeam = shooter && shooter.tdmTeam;
      let hitTurret = false;
      for (const tid of Object.keys(sim.siegeTurrets)) {
        const t = sim.siegeTurrets[tid];
        if (shooterTeam && shooterTeam === t.team) continue; // egen turret = ingen kollision
        const dx = t.x - b.x, dy = t.y - b.y;
        const rsum = t.r + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
          if (t.destroyed) {
            // Vrak blockerar skott men tar ingen mer skada
            hitTurret = true;
            break;
          }
          t.hp = Math.max(0, t.hp - b.dmg);
          sim.eventQueue.push({ type: 'siege_turret_damaged', turretId: t.id, hp: t.hp, maxHp: t.maxHp });
          if (t.hp <= 0 && !t.destroyed) {
            t.destroyed = true;
            const ejected = t.occupantId;
            if (ejected) {
              const ws2 = sim.room.members.get(ejected);
              if (ws2) {
                ws2._mountedSiegeTurretId = null;
                if (ws2.playerState) {
                  ws2.playerState.x = t.x + (t.team === 'red' ? 35 : -35);
                  ws2.playerState.y = t.y;
                }
              }
              t.occupantId = null;
              sim.eventQueue.push({ type: 'siege_turret_exited', peerId: ejected, turretId: t.id, reason: 'destroyed' });
            }
            sim.eventQueue.push({ type: 'siege_turret_destroyed', turretId: t.id });
          }
          hitTurret = true;
          break;
        }
      }
      if (hitTurret) { bullets.splice(i, 1); continue; }
    }
    // CTF: bullet träffar turret? Damage routes till turret-hp, bullet dies.
    // Friendly fire: egna lagets bullets passerar genom egen turret (kan inte döda den).
    if (sim.ctfActive && sim.ctfTurrets) {
      const shooter = b.ownerPid && sim.room.members.get(b.ownerPid);
      const shooterTeam = shooter && shooter.tdmTeam;
      let hitTurret = false;
      for (const tid of Object.keys(sim.ctfTurrets)) {
        const t = sim.ctfTurrets[tid];
        if (t.destroyed) continue;
        if (shooterTeam && shooterTeam === t.team) continue; // egen turret = ingen kollision
        const dx = t.x - b.x, dy = t.y - b.y;
        const rsum = t.r + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
          // Hit! Skada turret. Bullet dies.
          t.hp = Math.max(0, t.hp - b.dmg);
          sim.eventQueue.push({ type: 'ctf_turret_damaged', turretId: t.id, hp: t.hp, maxHp: t.maxHp });
          if (t.hp <= 0 && !t.destroyed) {
            t.destroyed = true;
            t.destroyedAt = Date.now();
            const ejected = t.occupantId;
            if (ejected) {
              // Ejecta occupant ur turret + emit
              const ws2 = sim.room.members.get(ejected);
              if (ws2) {
                ws2._mountedCtfTurretId = null;
                if (ws2.playerState) {
                  ws2.playerState.x = t.x + (t.team === 'red' ? 35 : -35);
                  ws2.playerState.y = t.y;
                }
              }
              t.occupantId = null;
              sim.eventQueue.push({ type: 'ctf_turret_exited', peerId: ejected, turretId: t.id, reason: 'destroyed' });
            }
            sim.eventQueue.push({ type: 'ctf_turret_destroyed', turretId: t.id });
          }
          hitTurret = true;
          break;
        }
      }
      if (hitTurret) { bullets.splice(i, 1); continue; }
    }
    // Hostile bullets — collision mot players (Phase 6 polish — sker även i enemies.js)
    // I aktuell flow: enemy contact-damage hanteras i enemies.js, hostile bullets
    // som flyger måste också kolla mot players.
    if (b.hostile) {
      // v1.397 Castle Defense: hostile bullets kan också skada CORE.
      // Kollas FÖRE player-hit så bullets som flyger mot core inte stoppas
      // av en player som råkar gå förbi (men om player är i vägen + tar damage,
      // OK — basen bevaras lite).
      let bulletConsumed = false;
      if (sim.castledefenseActive && sim.castledefenseCore && sim.castledefenseCore.hp > 0) {
        const core = sim.castledefenseCore;
        const dx = core.x - b.x, dy = core.y - b.y;
        const rsum = core.r + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
          core.hp = Math.max(0, core.hp - b.dmg);
          sim.eventQueue.push({
            type: 'cd_core_damaged',
            hp: core.hp, maxHp: core.maxHp,
          });
          bullets.splice(i, 1);
          bulletConsumed = true;
        }
      }
      if (bulletConsumed) continue;
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        // v1.395 fix: respektera invulnUntil + cdDowned (annars sniper-bullets
        // kan instant-killa downade spelare i bleed-out)
        if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
        if (ws.playerState.cdDowned) continue;
        // v1.423: CD player som står PÅ solid byggnad = immune mot hostile bullets.
        // Walls = full cover (matchar melee-immune i room-sim.js).
        if (sim.castledefenseActive && b.hostile) {
          const psP = ws.playerState;
          let onSolidB = false;
          if (sim.castledefenseWalls) {
            for (const sB of sim.castledefenseWalls) {
              if (sB.hp <= 0) continue;
              if (psP.x >= sB.x && psP.x <= sB.x + sB.w &&
                  psP.y >= sB.y && psP.y <= sB.y + sB.h) { onSolidB = true; break; }
            }
          }
          if (!onSolidB && sim.castledefenseBuildings) {
            for (const sB of sim.castledefenseBuildings) {
              if (sB.hp <= 0) continue;
              if (sB.kind === 'spike_trap' || sB.kind === 'slow_trap') continue;
              if (psP.x >= sB.x && psP.x <= sB.x + sB.w &&
                  psP.y >= sB.y && psP.y <= sB.y + sB.h) { onSolidB = true; break; }
            }
          }
          if (onSolidB) continue;
        }
        const dx = ws.playerState.x - b.x, dy = ws.playerState.y - b.y;
        const rsum = 14 + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
          // v1.403: shield absorberar först (CD + PvP)
          let remaining = b.dmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          // v1.404: broadcast hp+shield i CD så client uppdaterar UI
          if (sim.castledefenseActive) {
            for (const [pidLookup, wsLookup] of sim.room.members) {
              if (wsLookup === ws) {
                sim.eventQueue.push({
                  type: 'cd_hp_changed', peerId: pidLookup,
                  hp: ws.playerState.hp, shield: ws.playerState.shield || 0,
                });
                break;
              }
            }
          }
          bullets.splice(i, 1);
          break;
        }
      }
      continue;
    }
    // TDM-mode: player-bullet kollar mot ANDRA SPELARE (andra laget) istället för enemies
    if (sim.tdmActive) {
      // Kort-circuit: ingen damage efter match-end
      if (sim.tdmEnded) { continue; }
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      const ownerTeam = ownerWs && ownerWs.tdmTeam;
      if (!ownerTeam) { continue; }  // late-joiner utan team — skippa
      // Lag comp: rewinda target-position till där skytten såg dem
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (!ws.tdmTeam || ws.tdmTeam === ownerTeam) continue;  // FF fail-closed: okänt team → ingen skada
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;       // respawn-invuln skyddar
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          // PvP-balance: vissa vapen overriddar dmg (sniper nerf, pistol buff)
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          // Shield absorberar först, sedan HP. Shield = lika mycket som HP (= 100).
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) {
            ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          }
          // Broadcasta uppdaterad hp+shield så klienten kan visa exakt
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          if (ws.playerState.hp <= 0) {
            handleTdmKill(sim, b.ownerPid, pid, ws, ownerTeam, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;  // skip enemy collision when in TDM
    }
    // CTF-mode: player-bullet kollar mot andra spelare (andra laget) + dödar
    // → applyCtfDeath droppar ev. flagga, sim.ctfKillsByPid trackar
    if (sim.ctfActive) {
      if (sim.ctfEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      const ownerTeam = ownerWs && ownerWs.tdmTeam;
      if (!ownerTeam) continue;
      // Lag comp: rewinda target-position till där skytten såg dem
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (!ws.tdmTeam || ws.tdmTeam === ownerTeam) continue; // FF fail-closed
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          // PvP-balance: vissa vapen overriddar dmg
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          // Shield absorberar först, sedan HP
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) {
            ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          }
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          if (ws.playerState.hp <= 0) {
            handleCtfKill(sim, b.ownerPid, pid, ws, ownerTeam, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // SIEGE-mode: player-bullet kollar mot andra spelare (andra laget). Kill +3 pt.
    if (sim.siegeActive) {
      if (sim.siegeEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      const ownerTeam = ownerWs && ownerWs.tdmTeam;
      if (!ownerTeam) continue;
      // Lag comp: rewinda target-position till där skytten såg dem
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (!ws.tdmTeam || ws.tdmTeam === ownerTeam) continue; // FF fail-closed
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          if (ws.playerState.hp <= 0) {
            handleSiegeKill(sim, b.ownerPid, pid, ws, ownerTeam, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // KOTH-mode: FFA player-bullet kollar mot ALLA andra spelare. Kill =
    // bara kill-feed + respawn. Inget tier-system.
    if (sim.kothActive) {
      if (sim.kothEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      if (!ownerWs) continue;
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          if (ws.playerState.hp <= 0) {
            handleKothKill(sim, b.ownerPid, pid, ws, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // BATTLE ROYALE-mode: FFA, no friendly-fire constraints. Bullet träffar
    // alla andra spelare (inkl bots). Kill → handleBattleRoyaleKill.
    if (sim.battleroyaleActive) {
      if (sim.battleroyaleEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      if (!ownerWs) continue;
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          // ARMOR (v1.741): nivå-baserad % dmg-reduktion (10%/nivå, max 50%) → sedan shield/HP.
          let remaining = effDmg * (1 - 0.10 * (ws.playerState.armorLevel || 0));
          if (remaining > 0 && (ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          // v1.740: registrera senaste angripare (för kill-credit VID elimination, ej
          // direkt — en spelare kan gå "downed" m. self-revive innan riktig död).
          ws.playerState._brLastAttacker = b.ownerPid;
          ws.playerState._brLastWeapon = b.weaponId;
          ws.playerState._brLastAttackerAt = Date.now();
          // GULAG The Void (v1.790): knuff-kanon (0 dmg) → skicka impuls-event; klienten
          // applicerar knuffen på sin egen position (rörelse är klient-auktoritär).
          if (ws.playerState.gulagState === 'fighting' && ws.playerState._gulagGame === 'void') {
            sim.eventQueue.push({ type: 'gulag_knockback', peerId: pid, vx: Math.round(b.vx), vy: Math.round(b.vy) });
            // v1.799: spara knuff-RIKTNING server-side så BOTS (som saknar klient att
            // applicera impulsen) ändå puttas — tickGulag integrerar den med game.knockForce.
            const _km = Math.hypot(b.vx, b.vy) || 1;
            ws.playerState._gulagKnockDX = b.vx / _km;
            ws.playerState._gulagKnockDY = b.vy / _km;
            ws.playerState._gulagKnockUntil = Date.now() + 220;
          }
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          // Downed/elimination + kill-credit hanteras centralt i tickBattleRoyale.
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // JUGGERNAUT-mode: hunters skjuter BARA på JUG, JUG skjuter på alla hunters.
    // Friendly-fire av för hunters → hunter-bullet ignorerar andra hunters.
    if (sim.juggernautActive) {
      if (sim.juggernautEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      if (!ownerWs) continue;
      const ownerIsJug = ownerWs.playerState && ownerWs.playerState.isJug;
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const targetIsJug = !!ws.playerState.isJug;
        // Friendly-fire-regler: hunter→hunter blockerat, JUG→JUG kan inte hända
        if (!ownerIsJug && !targetIsJug) continue;
        if (ownerIsJug && targetIsJug) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          let effDmg = getPvpDmg(b.weaponId, b.dmg);
          // JUG-vapen-mul: nerfa rifle, buffa sledge så valet är meningsfullt
          if (ownerIsJug && JUGGERNAUT_ARENA.jugWeaponDmgMul) {
            const mul = JUGGERNAUT_ARENA.jugWeaponDmgMul[b.weaponId];
            if (typeof mul === 'number') effDmg *= mul;
          }
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) {
            ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          }
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          // Damage-attribution för juggernaut (hunter skadar JUG → tracka för transfer)
          if (!ownerIsJug && targetIsJug && sim._trackJuggernautDmg) {
            sim._trackJuggernautDmg(sim, b.ownerPid, pid, effDmg);
          }
          if (ws.playerState.hp <= 0) {
            if (sim._handleJuggernautKill) sim._handleJuggernautKill(sim, b.ownerPid, ownerWs, pid, ws, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // GUNGAME-mode: FFA player-bullet kollar mot ALLA andra spelare. Kill →
    // promote shooter +1 tier, set weapon till nästa tier. Kill med melee →
    // demote offret -1 tier (cant go below 0). Kill på tier 15 vinner matchen.
    if (sim.gungameActive) {
      if (sim.gungameEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      if (!ownerWs) continue;
      // Lag comp: rewinda target-position till där skytten såg dem
      const shooterRtt = ownerWs && ownerWs._serverRtt;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue; // ingen self-fire
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const rPos = rewoundPosition(ws, shooterRtt) || ws.playerState;
        const dx = rPos.x - b.x, dy = rPos.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          const effDmg = getPvpDmg(b.weaponId, b.dmg);
          let remaining = effDmg;
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) {
            ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          }
          sim.eventQueue.push({
            type: 'pvp_hp_changed',
            peerId: pid,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield || 0,
          });
          if (ws.playerState.hp <= 0) {
            handleGungameKill(sim, b.ownerPid, ownerWs, pid, ws, b.weaponId);
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;
    }
    // Player bullet — kolla mot enemies. Lag-kompensation: utöka hit-radie med 8px så klient
    // som skjuter på snabb enemy (runner/ninja: 200+ px/s = 20-25px lag på 100ms RTT) träffar.
    let hit = false;
    if (!b.hitIds) b.hitIds = new Set();
    // Anti-cheese: enemy måste vara nära ägarens spelare (på dennes skärm).
    // Bossar undantagna. ~viewport-radie för iPhone landscape ≈ 600px.
    // v1.639: HEIST har stor karta (4000x4000) — skippa cheese-check så police
    // kan skjutas över rummen (annars passerar skott rakt genom dem)
    const ownerWsForCheese = (b.ownerPid && !sim.heistActive) ? sim.room.members.get(b.ownerPid) : null;
    const ownerPosForCheese = (ownerWsForCheese && ownerWsForCheese.playerState)
      ? { x: ownerWsForCheese.playerState.x, y: ownerWsForCheese.playerState.y } : null;
    // SPATIAL-HASH: query bara enemies inom ~60px av bullet istället för linear-scan
    // (max enemy-r ≈ 50, max bullet-r ≈ 5 + lag-comp 8 = 63px worst-case).
    const _longRangeIds = ['sniper', 'railgun', 'crossbow', 'bow', 'rifle', 'minigun'];
    const _isLong = b.weaponId && _longRangeIds.indexOf(b.weaponId) >= 0;
    const queryR = (b.r || 4) + 60;
    // v1.656: queryInto (noll-alloc, återanvänd scratch) istället för getNearby som
    // allokerade en ny array per bullet per tick — största GC-tryck-källan på servern.
    const nearby = sim.enemyGrid ? sim.enemyGrid.queryInto(b.x, b.y, queryR, _bulletQueryScratch) : sim.enemies;
    for (let j = 0; j < nearby.length; j++) {
      const e = nearby[j];
      if (e.dead || b.hitIds.has(e)) continue;
      // Anti-cheese: explicit long-range allow-list (auto-turrets undantagna — de
      // är stationära byggnader vars range bestäms av building-spec, inte ägaren)
      if (ownerPosForCheese && !e.isBoss && !e.isMiniBoss && !_isLong && !b._companion && !b._autoTurret) {
        const ddx = e.x - ownerPosForCheese.x;
        const ddy = e.y - ownerPosForCheese.y;
        const cheeseRange = 700;
        if (ddx * ddx + ddy * ddy > cheeseRange * cheeseRange) continue;
      }
      const dx = e.x - b.x, dy = e.y - b.y;
      const rsum = e.r + b.r + 8;  // +8 lag-kompensation
      if (dx * dx + dy * dy < rsum * rsum) {
        if (b.explosive) {
          explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
          hit = true; break;
        }
        applyBulletEffects(b, e, sim);
        damageEnemy(e, b.dmg, b.crit, b.ownerPid);
        // v1.400/v1.431: emit damage-number event för auto-turret bullets så player ser
        // hur mycket turrets gör. Throttle till max 8Hz globalt (purely cosmetic;
        // för många torn-shots gav 20+ events/sek = backpressure).
        if (sim.castledefenseActive && b._autoTurret) {
          const _now = Date.now();
          if (!sim._lastTurretDmgEvtAt || _now - sim._lastTurretDmgEvtAt > 125) {
            sim._lastTurretDmgEvtAt = _now;
            sim.eventQueue.push({
              type: 'cd_turret_dmg',
              x: Math.round(e.x), y: Math.round(e.y),
              dmg: Math.round(b.dmg),
            });
          }
        }
        b.hitIds.add(e);
        if (!b.pierce) { hit = true; break; }
      }
    }
    if (hit) bullets.splice(i, 1);
  }
}

module.exports = {
  spawnPlayerBullets,
  applyMelee,
  updateBullets,
  damageEnemy,
  explode,
  applyBulletEffects,
};
