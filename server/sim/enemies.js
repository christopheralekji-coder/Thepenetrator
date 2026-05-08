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
    coverCheckUntil: 0, targetCover: null,
  };
  return e;
}

// Hitta närmsta levande spelare (squared distance)
function findNearestPlayer(e, players) {
  let bestD2 = Infinity, target = null;
  for (const p of players) {
    if (p.hp <= 0) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; target = p; }
  }
  return target;
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
function updateStatus(e, dt, now) {
  let speedMul = 1;
  // burn (DoT)
  if (e.burnUntil && now < e.burnUntil) {
    e.hp -= (e.burnDps || 0) * dt;
    if (e.hp <= 0) { e.dead = true; return false; }
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
      if (target.hp <= 0) target.dead = true;
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
      const tdx = target.x - e.x, tdy = target.y - e.y;
      const td = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td > 80) { e.x += (tdx / td) * e.speed * dt; e.y += (tdy / td) * e.speed * dt; }
      if (now - e.healAt > 1500) {
        e.healAt = now;
        target.hp = Math.min(target.maxHp, target.hp + 8);
      }
    } else {
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
      // Phase 3 implementerar explode() — nu: gör bara contact-damage och dö
      if (d < 100) {
        p.hp = Math.max(0, p.hp - e.dmg);
        p._tookDamageFrom = e;
      }
      e.dead = true;
    }
  } else if (e.type === 'sniper') {
    if (d < 500) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
    if (d < e.shootRange && !e.aiming && now - e.lastShot > e.shootRate) {
      e.aiming = true; e.aimAt = now;
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
    // Stagger (push-back-effekt) — om aktiv, hoppa över rörelse
    const staggerActive = e.staggerUntil && now < e.staggerUntil;
    if (!staggerActive) {
      // Dog: bara aktiv inom viewport-radius (~700px). Utanför står hunden still
      // istället för att jaga över hela kartan. Andra melee jagar fortfarande.
      if (e.type === 'dog' && d > 700) {
        // Hund vandrar lite slumpmässigt utanför viewport (visar att den lever)
        if (!e._wanderTimer || now > e._wanderTimer) {
          e._wanderTimer = now + 2000 + Math.random() * 2000;
          e._wanderX = (Math.random() - 0.5) * 0.3;
          e._wanderY = (Math.random() - 0.5) * 0.3;
        }
        e.x += (e._wanderX || 0) * e.speed * dt;
        e.y += (e._wanderY || 0) * e.speed * dt;
      } else {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
      }
    }
  }
}

// Enemy-enemy separation (lätt push-effekt)
function applySeparation(e, allEnemies) {
  for (const other of allEnemies) {
    if (other === e || other.dead) continue;
    const dx = e.x - other.x, dy = e.y - other.y;
    const d2 = dx * dx + dy * dy;
    const min = e.r + other.r;
    if (d2 > 0 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
    }
  }
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
function applyContactDamage(e, p) {
  if (e.contactCd > 0 || e.dmg <= 0) return;
  const now = Date.now();
  if (p.invulnUntil && now < p.invulnUntil) return;
  const dx = p.x - e.x, dy = p.y - e.y;
  const rsum = (p.r || 14) + e.r;
  if (dx * dx + dy * dy < rsum * rsum) {
    p.hp = Math.max(0, p.hp - e.dmg);
    p._tookDamageFrom = e;
    p.invulnUntil = now + 500;  // 500ms invuln efter hit (samma som klient)
    e.contactCd = 0.6;
  }
}

// Huvud-uppdatering per fiende. Anropas från room-sim.js för varje enemy.
function updateEnemy(e, dt, now, sim, players) {
  if (e.dead) return;
  if (e.contactCd > 0) e.contactCd -= dt;
  // Status-effekter (kan döda enemy)
  if (!updateStatus(e, dt, now)) return;
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
  applySeparation(e, sim.enemies);
  applyContactDamage(e, target);
}

module.exports = {
  ENEMY_STATS,
  makeEnemy,
  updateEnemy,
  findNearestPlayer,
};
