// Enemy stats + AI för server-side simulation. Phase 2: alla 14 typer + status-effekter.
// Speglar makeEnemy (game.js:2315-2351) och updateEnemies (game.js:7253-7491).
// SKIPPED i Phase 2 (kommer i senare faser):
//   - Cover-seeking för shooter/soldier (kräver stageState.buildings → Phase 5)
//   - Boss-AI (e.isBoss → Phase 4)
//   - Building collision (Phase 5)
//   - explode() som kallas av bomber (Phase 3)
'use strict';

// MÅSTE matcha game.js:2315-2351. Vid ändringar i game.js måste denna uppdateras.
const ENEMY_STATS = {
  grunt:    { r: 12, hp: 20, speed: 90,  dmg: 10, color: '#5a6a3a', accent: '#1a1a1a', gold: 5,  name: '' },
  runner:   { r: 10, hp: 14, speed: 170, dmg: 8,  color: '#3a2a1a', accent: '#000',     gold: 8,  name: '' },
  brute:    { r: 19, hp: 70, speed: 70,  dmg: 18, color: '#5a2828', accent: '#3a1010', gold: 14, name: '' },
  shooter:  { r: 12, hp: 22, speed: 75,  dmg: 0,  color: '#3a3a5a', accent: '#1a1a2a', gold: 12, name: '',
              shootRange: 360, shootRate: 1400, bulletSpeed: 360, bulletDmg: 9, bulletColor: '#a070ff' },
  ninja:    { r: 10, hp: 18, speed: 200, dmg: 14, color: '#1a1a1a', accent: '#7a1a1a', gold: 11, name: '' },
  swordsman:{ r: 13, hp: 35, speed: 100, dmg: 16, color: '#3a3a1a', accent: '#bcbcbc', gold: 13, name: '' },
  soldier:  { r: 12, hp: 28, speed: 90,  dmg: 0,  color: '#4a5a2a', accent: '#1a1a1a', gold: 14, name: '',
              shootRange: 280, shootRate: 1100, bulletSpeed: 480, bulletDmg: 11, bulletColor: '#ffae3a' },
  robot:    { r: 16, hp: 90, speed: 65,  dmg: 22, color: '#5a5a64', accent: '#ff3a3a', gold: 22, name: '' },
  dog:      { r: 9,  hp: 12, speed: 230, dmg: 10, color: '#2a1810', accent: '#1a0a08', gold: 6,  name: '' },
  healer:   { r: 11, hp: 26, speed: 80,  dmg: 0,  color: '#3a5a2a', accent: '#9aff5a', gold: 20, name: '' },
  summoner: { r: 12, hp: 32, speed: 70,  dmg: 0,  color: '#3a1a44', accent: '#aa3aff', gold: 25, name: '' },
  bomber:   { r: 10, hp: 18, speed: 200, dmg: 50, color: '#7a2a1a', accent: '#ff3a14', gold: 14, name: '' },
  sniper:   { r: 11, hp: 22, speed: 60,  dmg: 0,  color: '#1a2a18', accent: '#ff3a3a', gold: 22, name: '',
              shootRange: 700, shootRate: 2200, bulletSpeed: 900, bulletDmg: 35, bulletColor: '#ff3a3a' },
  swarmer:  { r: 7,  hp: 6,  speed: 260, dmg: 6,  color: '#5a3a1a', accent: '#ff8a3a', gold: 3,  name: '' },
};

function makeEnemy(type, x, y) {
  const base = ENEMY_STATS[type] || ENEMY_STATS.grunt;
  const e = {
    type, x, y,
    vx: 0, vy: 0,
    r: base.r,
    hp: base.hp, maxHp: base.hp,
    speed: base.speed, _origSpeed: base.speed,
    dmg: base.dmg,
    color: base.color, accent: base.accent,
    name: base.name || '',
    gold: base.gold,
    contactCd: 0,
    lastShot: 0,
    flashUntil: 0,
    isBoss: false,
    isMiniBoss: false,
    bossKey: '',
    phase: 0,
    facing: 0,
    walkPhase: Math.random() * Math.PI * 2,
    dead: false,
    // ranged extras
    shootRange: base.shootRange || 0,
    shootRate: base.shootRate || 0,
    bulletSpeed: base.bulletSpeed || 0,
    bulletDmg: base.bulletDmg || 0,
    bulletColor: base.bulletColor || '#ff5a5a',
    // status-effekter
    burnUntil: 0, burnDps: 0,
    slowUntil: 0, slowFactor: 1,
    mindControlled: false, mindControlUntil: 0,
    staggerUntil: 0,
    // type-specific
    healAt: 0, summonAt: 0, fuse: 0, aiming: false, aimAt: 0,
    // v2 C4/C3: FX-mål för world-paketets JSON-fält (ht/at). Påverkar INGEN AI —
    // sätts av healer/sniper-AI:n och läses bara av JSON-pkt-bygget i room-sim.
    _healTargetIdx: -1, _aimTargetPid: null,
    coverCheckUntil: 0, targetCover: null,
  };
  return e;
}

// Hitta närmsta levande target. För companion-aggro: 25% av enemies (sticky
// per-enemy via e._companionAggro) preferar companion om finns + alive.
function findNearestPlayer(e, players) {
  // Filter companion-only och player-only
  let nearestPlayer = null, nearestPlayerD2 = Infinity;
  let nearestCompanion = null, nearestCompanionD2 = Infinity;
  for (const p of players) {
    if (p.hp <= 0) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (p._isCompanion) {
      if (d2 < nearestCompanionD2) { nearestCompanionD2 = d2; nearestCompanion = p; }
    } else {
      if (d2 < nearestPlayerD2) { nearestPlayerD2 = d2; nearestPlayer = p; }
    }
  }
  // Persistent aggro-flag: 25% av enemies targetar companion om den finns
  if (nearestCompanion) {
    if (e._companionAggro === undefined) e._companionAggro = Math.random() < 0.25;
    if (e._companionAggro && nearestCompanionD2 < nearestPlayerD2 * 2.25) {
      return nearestCompanion;
    }
  }
  return nearestPlayer || nearestCompanion;
}

function spawnHostileBullet(sim, e, target) {
  const dx = target.x - e.x, dy = target.y - e.y;
  const ang = Math.atan2(dy, dx);
  sim.bullets.push({
    x: e.x, y: e.y,
    vx: Math.cos(ang) * e.bulletSpeed,
    vy: Math.sin(ang) * e.bulletSpeed,
    dmg: e.bulletDmg, life: e.type === 'sniper' ? 1.5 : 2,
    r: e.type === 'sniper' ? 5 : 4,
    color: e.bulletColor, hostile: true,
  });
}

// Status-effekter — speglar game.js:7297-7314
// v2: allEnemies (valfri) för Kraftbrand-perkens eld-spridning
function updateStatus(e, dt, now, allEnemies) {
  let speedMul = 1;
  // v2: Kraftbrand — brinnande fiende tänder närmsta granne (ett hopp per fiende)
  if (e._fireSpread && !e._fireSpreadDone && e.burnUntil && now < e.burnUntil && allEnemies) {
    e._fireSpreadDone = true;
    let nearest = null, nd2 = 120 * 120;
    for (const o of allEnemies) {
      if (o === e || o.dead || (o.burnUntil && o.burnUntil > now)) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < nd2) { nd2 = d2; nearest = o; }
    }
    if (nearest) {
      nearest.burnUntil = now + 2500;
      nearest.burnDps = e.burnDps || 6;
      nearest._fireSpread = true;   // kedjar vidare (en gång per fiende)
      // v2 C311: bär med eldens ägare/vapen så en kedje-brand-kill krediteras
      // rätt spelare. _burnOwner/_burnWeapon sätts först i bullets.js
      // (applyBulletEffects) — tills dess undefined = oförändrat (null-credit).
      nearest._burnOwner = e._burnOwner;
      nearest._burnWeapon = e._burnWeapon;
    }
  }
  // burn (DoT)
  if (e.burnUntil && now < e.burnUntil) {
    e.hp -= (e.burnDps || 0) * dt;
    if (e.hp <= 0) {
      // v2 C311: kreditera burn-death (inkl. kedje-spridd eld) till eldens ägare.
      if (e._burnOwner) {
        e.lastDamagerPid = e._burnOwner;
        e.lastDamagerWeapon = e._burnWeapon || e.lastDamagerWeapon || 'fire';
      }
      e.dead = true; return false;
    }
  } else { e.burnUntil = 0; }
  // slow
  if (e.slowUntil && now < e.slowUntil) {
    speedMul = e.slowFactor || 0.6;
  } else { e.slowUntil = 0; e.slowFactor = 1; }
  // mind-control upphör
  if (e.mindControlled && now >= e.mindControlUntil) e.mindControlled = false;
  // tillämpa speed
  if (e._origSpeed === undefined) e._origSpeed = e.speed;
  e.speed = e._origSpeed * speedMul;
  return true;
}

// Mind-control AI: byt sida, attackera närmsta enemy
function updateMindControlled(e, dt, now, allEnemies) {
  let target = null, bestD = 600;
  for (const o of allEnemies) {
    if (o === e || o.dead || o.mindControlled) continue;
    const dx = o.x - e.x, dy = o.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; target = o; }
  }
  if (target) {
    const dx2 = target.x - e.x, dy2 = target.y - e.y;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    e.x += (dx2 / d2) * e.speed * dt;
    e.y += (dy2 / d2) * e.speed * dt;
    if (d2 < e.r + target.r + 4 && (!e.contactCd || e.contactCd <= 0)) {
      target.hp -= 25;
      e.contactCd = 0.6;
      if (target.hp <= 0) {
        // v2 C310: kreditera kill till spelaren som castade mind-control. _mcOwner
        // sätts i bullets.js (mindcontrol-grenen) — tills dess null = oförändrat
        // beteende. Death-loopen läser lastDamagerPid/Weapon för enemy_killed.
        if (e._mcOwner) {
          target.lastDamagerPid = e._mcOwner;
          target.lastDamagerWeapon = 'mindcontrol';
        }
        target.dead = true;
      }
    }
  }
}

// Per-typ AI — speglar game.js:7316-7458
function updateEnemyAI(e, dt, now, sim, p, allEnemies) {
  const dxRaw = p.x - e.x, dyRaw = p.y - e.y;
  const dRaw = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw) || 1;
  const dx = dxRaw, dy = dyRaw, d = dRaw;

  if (e.type === 'healer') {
    // Heala närmsta dålig (within 200)
    let target = null, bestNeed = 0;
    for (const o of allEnemies) {
      if (o === e || o.dead || o.isBoss) continue;
      const need = 1 - o.hp / o.maxHp;
      if (need > 0.3 && need > bestNeed) {
        const ddx = o.x - e.x, ddy = o.y - e.y;
        if (ddx * ddx + ddy * ddy < 40000) { target = o; bestNeed = need; }
      }
    }
    if (target) {
      // v2 C4: aktiv heal-target → fx-bit 16 + JSON-fältet `ht` (beam-rendering)
      e._healTargetIdx = (typeof target._idx === 'number') ? target._idx : -1;
      const tdx = target.x - e.x, tdy = target.y - e.y;
      const td = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td > 80) { e.x += (tdx / td) * e.speed * dt; e.y += (tdy / td) * e.speed * dt; }
      if (now - e.healAt > 1500) {
        e.healAt = now;
        target.hp = Math.min(target.maxHp, target.hp + 8);
      }
    } else {
      e._healTargetIdx = -1;   // v2 C4: ingen heal-target → bit 16 av
      // backa från spelaren
      e.x -= (dx / d) * e.speed * dt;
      e.y -= (dy / d) * e.speed * dt;
    }
  } else if (e.type === 'summoner') {
    if (d < 320) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
    if (now - e.summonAt > 4500) {
      e.summonAt = now;
      // Cap-check: bara summa om vi är under cap
      if (sim.enemies.length < 80) {
        for (let i = 0; i < 2 && sim.enemies.length < 80; i++) {
          const a = Math.random() * Math.PI * 2;
          const sx = e.x + Math.cos(a) * 30, sy = e.y + Math.sin(a) * 30;
          const r = makeEnemy('runner', sx, sy);
          r._idx = sim.nextEnemyIdx++;
          sim.enemies.push(r);
        }
      }
    }
  } else if (e.type === 'bomber') {
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;
    if (d < 60) e.fuse = (e.fuse || 0) + dt;
    if (e.fuse > 0.6) {
      // v2 C113: AoE-detonation som SPEGLAR explode()-co-op-grenen (bullets.js):
      // iterera ALLA spelare i radien (inte bara AI-target), respektera
      // invulnUntil (annars instakill av nyss-respawnad/odödlig co-op-spelare),
      // dra av shield FÖRE hp och tillämpa avstånds-falloff. Bombers spawnar bara
      // i PvE/co-op → alla spelare är allierade (ingen friendly-fire-gate behövs).
      const blastR = 110;
      if (sim && sim.room && sim.room.members) {
        for (const [, ws] of sim.room.members) {
          if (!ws.playerState || ws.playerState.hp <= 0) continue;
          if (now < (ws.playerState.invulnUntil || 0)) continue;
          const bdx = ws.playerState.x - e.x, bdy = ws.playerState.y - e.y;
          const bd2 = bdx * bdx + bdy * bdy;
          if (bd2 >= blastR * blastR) continue;
          const falloff = 1 - Math.sqrt(bd2) / blastR;
          let remaining = e.dmg * (0.4 + falloff * 0.6);
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          ws.playerState._tookDamageFrom = e;
        }
      }
      e.dead = true;
    }
  } else if (e.type === 'sniper') {
    // v1.425: I CD är sniper aggressivare — approachar till 220px (var: 500px
    // retreat). Tidigare stannade snipers vid världs-kanten + 500px från
    // target → osynliga campers. Player ska se dem!
    const sniperRetreat = e._cdEnemy ? 220 : 500;
    if (d < sniperRetreat) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
    else { e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; }
    if (d < e.shootRange && !e.aiming && now - e.lastShot > e.shootRate) {
      e.aiming = true; e.aimAt = now;
    }
    // v2 C3: target för sniper-laserlinjen (fx-bit 64 + JSON-fältet `at`).
    // CD/survivors-pseudo-targets ('__player_<pid>') mappas till riktig peerId;
    // core/byggnads-targets ('__core__'/'__target_*') → null (ingen laser).
    if (e.aiming) {
      const _tp = p.peerId || null;
      e._aimTargetPid = (_tp && _tp.indexOf('__player_') === 0) ? _tp.slice(9)
        : ((_tp && _tp.indexOf('__') === 0) ? null : _tp);
    }
    if (e.aiming && now - e.aimAt > 800) {
      e.aiming = false; e.lastShot = now;
      spawnHostileBullet(sim, e, p);
    }
  } else if (e.type === 'swarmer') {
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;
  } else if (e.type === 'shooter' || e.type === 'soldier') {
    // RANGED: håll avstånd, skjut, strafe (skip cover-seeking — Phase 5)
    const hpFrac = e.hp / e.maxHp;
    const ideal = hpFrac < 0.3 ? 420 : 280;
    let mvx = 0, mvy = 0;
    if (d > ideal + 30) { mvx = dx / d; mvy = dy / d; }
    else if (d < ideal - 30) { mvx = -dx / d; mvy = -dy / d; }
    // strafe
    const strafeT = Math.sin(now / 800 + (e.walkPhase || 0));
    mvx += -dy / d * strafeT * 0.4;
    mvy += dx / d * strafeT * 0.4;
    e.x += mvx * e.speed * dt;
    e.y += mvy * e.speed * dt;
    if (d <= e.shootRange && now - e.lastShot >= e.shootRate) {
      e.lastShot = now;
      spawnHostileBullet(sim, e, p);
    }
  } else {
    // melee: grunt, runner, brute, ninja, swordsman, robot, dog
    // Stagger (push-back-effekt) — om aktiv, hoppa över rörelse.
    // Alla enemies (inkl hund) jagar oavsett distance — wander-AI togs bort.
    const staggerActive = e.staggerUntil && now < e.staggerUntil;
    if (!staggerActive) {
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
    }
  }
}

// Enemy-enemy separation (lätt push-effekt) — använder spatial-grid om
// tillgängligt (O(E) totalt istället för O(E²)). Fallback linear scan.
function applySeparation(e, allEnemies, grid) {
  // v2 C167: ackumulera alla push:ar under en READ-ONLY pass (mot e:s position vid
  // ankomst) och tillämpa EN gång efter. Förr muterades e.x/e.y mitt i query:n →
  // resultatet berodde på grannarnas iterations-ordning och var inkonsistent med
  // grid:ens bucketing av e (e flyttades men re-bucketades aldrig). Inga nya
  // per-frame-allokeringar: två lokala nummer-ackumulatorer.
  let ax = 0, ay = 0;
  if (grid) {
    // Max-radius vi behöver söka: e.r + worst-case other.r ≈ 60px
    const r = (e.r || 14) + 60;
    grid.queryRadius(e.x, e.y, r, other => {
      if (other === e || other.dead) return;
      const dx = e.x - other.x, dy = e.y - other.y;
      const d2 = dx * dx + dy * dy;
      const min = e.r + other.r;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
    });
    e.x += ax;
    e.y += ay;
    return;
  }
  // Fallback (utan grid)
  for (const other of allEnemies) {
    if (other === e || other.dead) continue;
    const dx = e.x - other.x, dy = e.y - other.y;
    const d2 = dx * dx + dy * dy;
    const min = e.r + other.r;
    if (d2 > 0 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      ax += (dx / d) * push;
      ay += (dy / d) * push;
    }
  }
  e.x += ax;
  e.y += ay;
}

// Stuck-detection: om enemy inte rört sig nämnvärt på 1s, sidestepa för att gå runt obstacles.
// Bossar undantagna — telegraph-windups (charge prep, slam) behöver hålla position
// för att vara läsbara. Stagger initial check med per-enemy random offset så alla inte
// kollar exakt samtidigt (annars synkad sidestep-dans när spelaren står still).
function applyStuckSidestep(e, dt, now, target) {
  if (!target) return;
  if (e.isBoss) return;
  if (e._lastPosCheck === undefined) {
    e._lastPosCheck = now - Math.random() * 1000;
    e._lastCheckX = e.x; e._lastCheckY = e.y; e._sidestepUntil = 0;
  }
  if (e._sidestepUntil && now < e._sidestepUntil) {
    const pdx = target.x - e.x, pdy = target.y - e.y;
    const pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
    const sgn = e._sidestepDir || 1;
    e.x += (-pdy / pd) * sgn * e.speed * dt * 1.1;
    e.y += (pdx / pd) * sgn * e.speed * dt * 1.1;
  } else if (now - e._lastPosCheck > 1000) {
    const dx = e.x - e._lastCheckX, dy = e.y - e._lastCheckY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved < 30 && !e.staggerUntil) {
      e._sidestepUntil = now + 600;
      e._sidestepDir = Math.random() < 0.5 ? -1 : 1;
    }
    e._lastPosCheck = now;
    e._lastCheckX = e.x;
    e._lastCheckY = e.y;
  }
}

// Kontaktskada till närmsta spelare. Respekterar player.invulnUntil så multipla enemies
// inte dödar spelaren på 1 sekund (matchar klient-side damagePlayer's invuln-frames).
function applyContactDamage(e, p, sim) {
  if (e.contactCd > 0 || e.dmg <= 0) return;
  const now = Date.now();
  if (p.invulnUntil && now < p.invulnUntil) return;
  const dx = p.x - e.x, dy = p.y - e.y;
  const rsum = (p.r || 14) + e.r;
  if (dx * dx + dy * dy < rsum * rsum) {
    if (p._isCompanion && p._wsRef && p._wsRef.companionState) {
      // Companion-fallet: uppdatera server-side companion-state + skicka event
      const c = p._wsRef.companionState;
      c.hp = Math.max(0, c.hp - e.dmg);
      if (sim && sim.eventQueue) {
        sim.eventQueue.push({
          type: 'companion_damaged',
          peerId: p.peerId,
          hp: c.hp,
          maxHp: c.maxHp,
          dmg: e.dmg,
        });
      }
      if (c.hp <= 0) {
        c.alive = false;
        if (sim && sim.eventQueue) {
          sim.eventQueue.push({
            type: 'companion_died',
            peerId: p.peerId,
            companionId: c.id,
          });
        }
      }
      p.hp = c.hp; // för konsistent return-state
    } else {
      // v1.549: STRESSTEST gör spelaren odödlig (pure prestanda-test, ingen död)
      if (sim && sim.stresstestActive) {
        p.invulnUntil = now + 500;
        e.contactCd = 0.6;
        return;
      }
      // v1.531: Shield absorberar damage först (var bug: damage gick direkt på HP)
      let dmgRemaining = e.dmg;
      if (p.shield && p.shield > 0) {
        const absorbed = Math.min(dmgRemaining, p.shield);
        p.shield -= absorbed;
        dmgRemaining -= absorbed;
      }
      if (dmgRemaining > 0) {
        p.hp = Math.max(0, p.hp - dmgRemaining);
      }
      p._tookDamageFrom = e;
      p._lastDamageAt = now;
      // v1.610: SURVIVORS sänker invuln 500→150ms så 20 enemies kan döda dig på
      // rimlig tid. Tidigare: 500ms blockerade alla andra enemies → 1 hit/0.5s
      // oavsett hur många runt dig = 15-20s att dö trots omringning.
      p.invulnUntil = now + (sim && sim.survivorsActive ? 150 : 500);
    }
    e.contactCd = 0.6;
  }
}

// v2: FIENDE-vs-PvE-STAGE-VÄGGAR (story-husen från Godot-klientens sim_start.stageWalls).
// Kulor stoppades redan server-side (bullets.js _pveWalls) men fiender gick rakt
// genom husen (V1 solo körde klient-side kollision → V2-spelare såg fiender gå
// genom väggar). Klassisk cirkel-vs-rect-resolve EFTER att AI:n flyttat (ingen
// path-ändring): knuffa ut längs minsta-penetrations-axeln så fienden GLIDER
// längs väggen istället för att fastna (V1-klientens beteende). Anropas BARA
// när walls finns (caller gate:ar på pveWalls(sim) != null) → V1-vägar orörda.
// Täcker även spawn-i-vägg (center inne i rect → knuffas till närmaste fria kant).
function resolveWallsCircle(e, walls) {
  const r = e.r || 12;
  for (let i = 0; i < walls.length; i++) {
    const wl = walls[i];
    // Närmaste punkt på rect till cirkelcentrum
    const cx = Math.max(wl.x, Math.min(wl.x + wl.w, e.x));
    const cy = Math.max(wl.y, Math.min(wl.y + wl.h, e.y));
    const dx = e.x - cx, dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;       // ingen överlapp
    if (d2 > 1e-6) {
      // Centrum utanför rect: knuffa ut längs kontakt-normalen. Vid kant-kontakt är
      // normalen axel-rät (= bara den penetrerande axeln resolvas) → tangentiella
      // rörelsekomponenten består = glid. Vid hörn blir det diagonalt (naturligt).
      const d = Math.sqrt(d2);
      const pen = r - d;
      e.x += (dx / d) * pen;
      e.y += (dy / d) * pen;
    } else {
      // Centrum INNE i rect (spawn i vägg / hög fart): ut längs minsta-penetrations-axeln
      const left = e.x - wl.x, right = wl.x + wl.w - e.x;
      const top = e.y - wl.y, bottom = wl.y + wl.h - e.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) e.x = wl.x - r;
      else if (m === right) e.x = wl.x + wl.w + r;
      else if (m === top) e.y = wl.y - r;
      else e.y = wl.y + wl.h + r;
    }
  }
}

// Huvud-uppdatering per fiende. Anropas från room-sim.js för varje enemy.
function updateEnemy(e, dt, now, sim, players) {
  if (e.dead) return;
  if (e.contactCd > 0) e.contactCd -= dt;
  // Status-effekter (kan döda enemy)
  if (!updateStatus(e, dt, now, sim.enemies)) return;
  // Mind-control byter sida
  if (e.mindControlled && now < e.mindControlUntil) {
    updateMindControlled(e, dt, now, sim.enemies);
    return;
  }
  // Hitta target
  const target = findNearestPlayer(e, players);
  if (!target) return;
  // Per-typ AI
  if (!e.isBoss) {
    updateEnemyAI(e, dt, now, sim, target, sim.enemies);
  }
  // Smartare AI: gå runt obstacles om stuck
  applyStuckSidestep(e, dt, now, target);
  // Fysik: separation + contact damage
  applySeparation(e, sim.enemies, sim.enemyGrid);
  applyContactDamage(e, target, sim);
}

module.exports = {
  ENEMY_STATS,
  makeEnemy,
  updateEnemy,
  findNearestPlayer,
  resolveWallsCircle,
};
