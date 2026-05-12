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

// PvP balance-overrides: tillämpas bara när sim.tdmActive eller sim.ctfActive.
// Sniper nerf: 130→95 (fortfarande 2-shot genom shield+hp men inte instant).
// Pistol buff: 18→24 (TTK 200hp 6→7 shots, mer relevant än 12).
const PVP_DMG_OVERRIDE = {
  sniper: 95,
  pistol: 24,
};
function getPvpDmg(weaponId, baseDmg) {
  if (PVP_DMG_OVERRIDE[weaponId] != null) return PVP_DMG_OVERRIDE[weaponId];
  return baseDmg;
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
  // PvP-modes (TDM + CTF): explosion ska INTE skada eget lag, egen spelare,
  // eller respawn-invuln. Shield absorberar först, sedan HP. Emiterar pvp_hp_changed.
  const fromWs = fromPid ? sim.room.members.get(fromPid) : null;
  const fromTeam = fromWs && fromWs.tdmTeam;
  const inPvP = sim.tdmActive || sim.ctfActive;
  if (!inPvP) {
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
    if (inPvP) {
      if (pid === fromPid) continue;             // egen spelare oskadad
      if (!fromTeam || !ws.tdmTeam) continue;    // okänt team → no-op (safer)
      if (ws.tdmTeam === fromTeam) continue;     // friendly fire av
      const invuln = ws.playerState.invulnUntil || 0;
      if (Date.now() < invuln) continue;         // respawn-invuln skyddar
    }
    const dx = ws.playerState.x - x, dy = ws.playerState.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      const falloff = 1 - Math.sqrt(d2) / radius;
      const finalDmg = dmg * (0.3 + falloff * 0.4);
      if (inPvP) {
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
      } else {
        ws.playerState.hp = Math.max(0, ws.playerState.hp - finalDmg);
      }
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
    // Out-of-bounds eller life-ut → spräng om explosive
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > 5000 || b.y > 5000) {
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
    if (sim.tdmActive && bulletHitsWall(b, TDM_ARENA.walls)) {
      if (b.explosive && !b.hostile) {
        explode(sim, b.x, b.y, b.explosive, b.dmg, b.ownerPid);
      }
      bullets.splice(i, 1);
      continue;
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
              sim._siegeCoreDmgAccum = sim._siegeCoreDmgAccum || { red: 0, blue: 0 };
              sim._siegeCoreDmgAccum[ownerTeam] = (sim._siegeCoreDmgAccum[ownerTeam] || 0) + b.dmg;
              while (sim._siegeCoreDmgAccum[ownerTeam] >= 100) {
                sim._siegeCoreDmgAccum[ownerTeam] -= 100;
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
                if (typeof endSiegeMatch === 'function') endSiegeMatch(sim, winner, 'core_destroyed');
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
    // SIEGE: turret hit detection (samma som CTF)
    if (sim.siegeActive && sim.siegeTurrets) {
      let hitTurret = false;
      for (const tid of Object.keys(sim.siegeTurrets)) {
        const t = sim.siegeTurrets[tid];
        if (t.destroyed) continue;
        const dx = t.x - b.x, dy = t.y - b.y;
        const rsum = t.r + b.r;
        if (dx * dx + dy * dy < rsum * rsum) {
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
    // Egen lags-turret kan fortfarande beskjutas (fri damage från alla håll).
    if (sim.ctfActive && sim.ctfTurrets) {
      let hitTurret = false;
      for (const tid of Object.keys(sim.ctfTurrets)) {
        const t = sim.ctfTurrets[tid];
        if (t.destroyed) continue;
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
    // CTF-mode: player-bullet kollar mot andra spelare (andra laget) + dödar
    // → applyCtfDeath droppar ev. flagga, sim.ctfKillsByPid trackar
    if (sim.ctfActive) {
      if (sim.ctfEnded) continue;
      let pvpHit = false;
      const ownerWs = sim.room.members.get(b.ownerPid);
      const ownerTeam = ownerWs && ownerWs.tdmTeam;
      if (!ownerTeam) continue;
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (ws.tdmTeam === ownerTeam) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const dx = ws.playerState.x - b.x, dy = ws.playerState.y - b.y;
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
            ws.tdmRespawnAt = Date.now() + 3000;
            sim.ctfKillsByPid[b.ownerPid] = (sim.ctfKillsByPid[b.ownerPid] || 0) + 1;
            sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
            sim.eventQueue.push({
              type: 'ctf_kill',
              killer: b.ownerPid,
              victim: pid,
              killerTeam: ownerTeam,
              victimTeam: ws.tdmTeam,
              weapon: b.weaponId || null,
            });
            sim.eventQueue.push({
              type: 'ctf_player_died',
              victim: pid,
              durationMs: 3000,
            });
            // Drop flagga om victim bar en (refererar applyCtfDeath inline)
            for (const team of ['red', 'blue']) {
              const flag = sim.ctfFlags[team];
              if (flag.carrierId === pid) {
                flag.carrierId = null;
                flag.atBase = false;
                flag.x = ws.playerState.x;
                flag.y = ws.playerState.y;
                flag.droppedAt = Date.now();
                sim.eventQueue.push({
                  type: 'ctf_flag_dropped',
                  team, x: flag.x, y: flag.y, droppedBy: pid,
                });
              }
            }
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
      for (const [pid, ws] of sim.room.members) {
        if (pid === b.ownerPid) continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (ws.tdmTeam === ownerTeam) continue;
        const invuln = ws.playerState.invulnUntil || 0;
        if (Date.now() < invuln) continue;
        const dx = ws.playerState.x - b.x, dy = ws.playerState.y - b.y;
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
            ws.tdmRespawnAt = Date.now() + 3000;
            sim.siegeKillsByPid[b.ownerPid] = (sim.siegeKillsByPid[b.ownerPid] || 0) + 1;
            sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
            sim.siegeScores[ownerTeam] = (sim.siegeScores[ownerTeam] || 0) + 3; // +3 per kill
            sim.eventQueue.push({
              type: 'siege_kill',
              killer: b.ownerPid, victim: pid,
              killerTeam: ownerTeam, victimTeam: ws.tdmTeam,
              weapon: b.weaponId || null,
            });
            sim.eventQueue.push({ type: 'siege_player_died', victim: pid, durationMs: 3000 });
            sim.eventQueue.push({ type: 'siege_score_update', red: sim.siegeScores.red, blue: sim.siegeScores.blue });
            // Vinst på 100p?
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
    const ownerWsForCheese = b.ownerPid ? sim.room.members.get(b.ownerPid) : null;
    const ownerPosForCheese = (ownerWsForCheese && ownerWsForCheese.playerState)
      ? { x: ownerWsForCheese.playerState.x, y: ownerWsForCheese.playerState.y } : null;
    for (let j = 0; j < sim.enemies.length; j++) {
      const e = sim.enemies[j];
      if (e.dead || b.hitIds.has(e)) continue;
      // Anti-cheese: explicit long-range allow-list (sniper/railgun/crossbow/bow/rifle/
      // minigun) — boomerang/lightsaber har också pierce:true men ska inte få exemption.
      const _longRangeIds = ['sniper', 'railgun', 'crossbow', 'bow', 'rifle', 'minigun'];
      const _isLong = b.weaponId && _longRangeIds.indexOf(b.weaponId) >= 0;
      if (ownerPosForCheese && !e.isBoss && !e.isMiniBoss && !_isLong && !b._companion) {
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
