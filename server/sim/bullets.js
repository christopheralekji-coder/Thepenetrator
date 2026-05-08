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

// Spawna player bullets — speglar spawnPlayerBullets-loopen (game.js:5029-5068)
// p = { x, y, aimAngle, r=14, peerId, dmgMul, bspeedMul, explMul, kbMul, critChance, perks, cheats }
function spawnPlayerBullets(sim, p, weaponId, params) {
  const w = W_BY_ID[weaponId];
  if (!w || w.type === 'melee') return;  // melee handled separately (Phase 6)
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

  for (let i = 0; i < pellets; i++) {
    const spread = (Math.random() - 0.5) * 2 * (w.spread || 0);
    const ang = p.aimAngle + spread;
    const speed = w.speed * bspeedMul * speedBonus;
    const isCrit = cheatChozza ? true : Math.random() < critChance;
    const isHead = headshotPerk && Math.random() < 0.15;
    sim.bullets.push({
      x: p.x + Math.cos(ang) * (p.r || 14),
      y: p.y + Math.sin(ang) * (p.r || 14),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      dmg: w.dmg * dmgMul * adrenalineDmg * stealthBonus * (isCrit ? 2 : 1) * (isHead ? 2.5 : 1) * ultDmgMul,
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
  // Chain (tesla)
  if (b.chain > 0) {
    let prevPos = { x: e.x, y: e.y };
    let chainsLeft = b.chain;
    const hitSet = new Set([e]);
    while (chainsLeft > 0) {
      let nextE = null, bestD2 = 240 * 240;
      for (const o of sim.enemies) {
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
function explode(sim, x, y, radius, dmg, fromPid) {
  // I TDM: en explosion från en spelare ska INTE skada eget lag eller egen
  // spelare. PvE-skada på enemies skippas också i TDM (inga enemies).
  const fromWs = fromPid ? sim.room.members.get(fromPid) : null;
  const fromTeam = fromWs && fromWs.tdmTeam;
  if (!sim.tdmActive) {
    for (const e of sim.enemies) {
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
    if (sim.tdmActive) {
      if (pid === fromPid) continue;             // egen spelare oskadad
      if (fromTeam && ws.tdmTeam === fromTeam) continue;  // friendly fire av
      const invuln = ws.playerState.invulnUntil || 0;
      if (Date.now() < invuln) continue;          // respawn-invuln skyddar
    }
    const dx = ws.playerState.x - x, dy = ws.playerState.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      const falloff = 1 - Math.sqrt(d2) / radius;
      ws.playerState.hp = Math.max(0, ws.playerState.hp - dmg * (0.3 + falloff * 0.4));
    }
  }
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
    // Out-of-bounds eller life-ut → spräng om explosive
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > 5000 || b.y > 5000) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
    }
    // Hostile bullets — collision mot players (Phase 6 polish — sker även i enemies.js)
    // I aktuell flow: enemy contact-damage hanteras i enemies.js, hostile bullets
    // som flyger måste också kolla mot players.
    if (b.hostile) {
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const dx = ws.playerState.x - b.x, dy = ws.playerState.y - b.y;
        const rsum = 14 + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
          ws.playerState.hp = Math.max(0, ws.playerState.hp - b.dmg);
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
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (ws.tdmTeam === ownerTeam) continue;  // friendly fire off
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;       // respawn-invuln skyddar
        const dx = ws.playerState.x - b.x, dy = ws.playerState.y - b.y;
        const rsum = 14 + b.r + 8;
        if (dx * dx + dy * dy < rsum * rsum) {
          ws.playerState.hp = Math.max(0, ws.playerState.hp - b.dmg);
          if (ws.playerState.hp <= 0) {
            // Kill — respawn timer + öka team-score + per-pid stats
            const respawnAt = Date.now() + 3000;
            ws.tdmRespawnAt = respawnAt;
            sim.tdmKills[ownerTeam] = (sim.tdmKills[ownerTeam] || 0) + 1;
            sim.tdmKillsByPid[b.ownerPid] = (sim.tdmKillsByPid[b.ownerPid] || 0) + 1;
            sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
            sim.eventQueue.push({
              type: 'tdm_kill',
              killer: b.ownerPid,
              victim: pid,
              killerTeam: ownerTeam,
              victimTeam: ws.tdmTeam,
              weapon: b.weaponId || null,
              redKills: sim.tdmKills.red,
              blueKills: sim.tdmKills.blue,
            });
            // Riktat event till victim så de kan rendera respawn-countdown.
            // Skickar durationMs istället för respawnAt (server-clock) — annars
            // räknar klient från sin egen Date.now() vilket driftar.
            sim.eventQueue.push({
              type: 'tdm_player_died',
              victim: pid,
              durationMs: 3000,
            });
            if (sim.tdmKills[ownerTeam] >= sim.tdmTargetKills) {
              sim.tdmEnded = true;
              sim.eventQueue.push({
                type: 'tdm_match_end',
                winner: ownerTeam,
                redKills: sim.tdmKills.red,
                blueKills: sim.tdmKills.blue,
                stats: Object.keys(sim.tdmKillsByPid).map(p => ({
                  peerId: p,
                  team: sim.room.members.get(p) && sim.room.members.get(p).tdmTeam,
                  kills: sim.tdmKillsByPid[p] || 0,
                  deaths: sim.tdmDeathsByPid[p] || 0,
                })),
              });
            }
          }
          pvpHit = true;
          break;
        }
      }
      if (pvpHit) bullets.splice(i, 1);
      continue;  // skip enemy collision when in TDM
    }
    // Player bullet — kolla mot enemies. Lag-kompensation: utöka hit-radie med 8px så klient
    // som skjuter på snabb enemy (runner/ninja: 200+ px/s = 20-25px lag på 100ms RTT) träffar.
    let hit = false;
    if (!b.hitIds) b.hitIds = new Set();
    for (let j = 0; j < sim.enemies.length; j++) {
      const e = sim.enemies[j];
      if (e.dead || b.hitIds.has(e)) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      const rsum = e.r + b.r + 8;  // +8 lag-kompensation
      if (dx * dx + dy * dy < rsum * rsum) {
        if (b.explosive) {
          explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
          hit = true; break;
        }
        applyBulletEffects(b, e, sim);
        damageEnemy(e, b.dmg, b.crit, b.ownerPid);
        b.hitIds.add(e);
        if (!b.pierce) { hit = true; break; }
      }
    }
    if (hit) bullets.splice(i, 1);
  }
}

module.exports = {
  spawnPlayerBullets,
  updateBullets,
  damageEnemy,
  explode,
  applyBulletEffects,
};
