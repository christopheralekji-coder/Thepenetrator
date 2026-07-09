// Phase 4: Boss-AI för 10 typer.
// Speglar updateBoss + ai* funktionerna i game.js:7493-7827.
// Cloaker-burst (game.js:7616-7621) konverterad från setTimeout till tick-baserad burstQueue.
'use strict';

const { BOSS_CONFIGS } = require('../../shared/boss-configs');
const { makeEnemy } = require('./enemies');
// C139: mirror room-sim.js ENEMY_CAP so boss summon loops never exceed the cap.
// Kept local (not required from room-sim) to avoid a circular dependency.
const BOSS_SUMMON_CAP = 80;

function makeBoss(bossKey, x, y, coopMul) {
  const cfg = BOSS_CONFIGS[bossKey];
  if (!cfg) return null;
  coopMul = coopMul || 1;
  const scaledHp = Math.round(cfg.hp * coopMul);
  return {
    x, y, r: cfg.r,
    vx: 0, vy: 0,
    type: 'boss_' + bossKey, bossKey, ai: cfg.ai,
    hp: scaledHp, maxHp: scaledHp,
    speed: cfg.speed, dmg: cfg.dmg, contactCd: 0,
    color: cfg.color, accent: cfg.accent, glow: cfg.glow,
    gold: cfg.gold, isBoss: true, isMiniBoss: false,
    name: cfg.name, subtitle: cfg.subtitle || '',
    phase: 1, lastAttack: 0, lastSpread: 0,
    chargeUntil: 0, chargeDir: { x: 0, y: 0 },
    windupUntil: 0, windupDur: 0,  // charge-telegraf: wind-up-hold innan lunge (fx-bit 512)
    dashUntil: 0, dashDir: { x: 0, y: 0 },
    flashUntil: 0, walkAccum: 0,
    cloakUntil: 0, jetpackUntil: 0, shieldDir: 0, chargeCdAt: 0,
    bulletSpeed: 620, bulletDmg: Math.round(cfg.dmg * 0.55),
    bulletColor: cfg.bulletColor || cfg.glow,
    shootRange: 520, shootRate: 1200,
    // final_combo: 3 powers att rotera (speglar game.js:22314). powerSwapAt lazy-init:as
    // i aiFinalCombo (makeBoss saknar `now`), så power-index 0 visas hela första intervallet.
    powerSet: (cfg.powerSet && cfg.powerSet.length) ? cfg.powerSet.slice() : null,
    powerIdx: 0, powerSwapAt: 0,
    // Cloaker burst-kö: ersätter setTimeout med tick-baserad scheduling
    burstQueue: [],
    // Standard enemy-fields som även bossar har
    dead: false,
    burnUntil: 0, burnDps: 0,
    slowUntil: 0, slowFactor: 1, _origSpeed: cfg.speed,
    mindControlled: false, mindControlUntil: 0,
    staggerUntil: 0,
    lastPos: null,
    bossbarShown: false,
    // Pickup-droppar är samma som vanliga enemies, ingen extra logik här
    bk: bossKey,
  };
}

// Helper: skjut bullets från boss
function bossShoot(sim, b, dx, dy, count, spread, color, speedMul, life) {
  speedMul = speedMul || 1;
  life = life || 2.0;
  const baseAng = Math.atan2(dy, dx);
  for (let i = 0; i < count; i++) {
    const a = baseAng + (i - (count - 1) / 2) * spread;
    sim.bullets.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * b.bulletSpeed * speedMul,
      vy: Math.sin(a) * b.bulletSpeed * speedMul,
      dmg: b.bulletDmg, life, r: 5,
      color, hostile: true,
    });
  }
}

function dropGasCloud(sim, x, y, r, life, dps) {
  if (!sim.gasClouds) sim.gasClouds = [];
  sim.gasClouds.push({ x, y, r, life, maxLife: life, dps, born: Date.now() });
}

function dropFlameTrail(sim, x, y, r, life, dps) {
  if (!sim.flameTrails) sim.flameTrails = [];
  sim.flameTrails.push({ x, y, r, life, dps });
}

// Hitta närmsta levande spelare
function findNearestPlayer(b, players) {
  let bestD2 = Infinity, target = null;
  for (const p of players) {
    if (p.hp <= 0) continue;
    const dx = p.x - b.x, dy = p.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; target = p; }
  }
  return target;
}

// Cloaker burst-kö processor — körs i updateBoss varje tick.
// Använder `now` från caller (inte Date.now()) så testbar med fake-clock.
function flushBurstQueue(sim, b, players, now) {
  if (!b.burstQueue || b.burstQueue.length === 0) return;
  while (b.burstQueue.length && b.burstQueue[0].firesAt <= now) {
    b.burstQueue.shift();
    if (b.dead) return;
    const target = findNearestPlayer(b, players);
    if (target) {
      bossShoot(sim, b, target.x - b.x, target.y - b.y, 1, 0.06, b.bulletColor, 0.95, 1.4);
    }
  }
}

// Stuck-detection — om boss står still > 1.5s, teleportera lite
function applyStuckDetection(b, ndx, ndy, now) {
  if (!b.lastPos) { b.lastPos = { x: b.x, y: b.y, t: now }; return; }
  const dx = b.x - b.lastPos.x, dy = b.y - b.lastPos.y;
  const moved = Math.sqrt(dx * dx + dy * dy);
  if (moved > 5) { b.lastPos = { x: b.x, y: b.y, t: now }; }
  else if (now - b.lastPos.t > 1500) {
    b.x += ndx * 30; b.y += ndy * 30;
    b.lastPos = { x: b.x, y: b.y, t: now };
  }
}

// 1) CASTER (Likvakare)
function aiCaster(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  const ideal = 280;
  if (d > ideal + 50) { b.x += ndx * b.speed * dt; b.y += ndy * b.speed * dt; }
  else if (d < ideal - 30) { b.x -= ndx * b.speed * dt; b.y -= ndy * b.speed * dt; }
  if (now - b.lastAttack > 1600) {
    b.lastAttack = now;
    for (let i = -1; i <= 1; i++) {
      const a = Math.atan2(p.y - b.y, p.x - b.x) + i * 0.20;
      sim.bullets.push({
        x: b.x, y: b.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420,
        dmg: b.bulletDmg, life: 1.6, r: 7, color: b.bulletColor, hostile: true,
        gasOnHit: true,
      });
    }
  }
  if (hpFrac < 0.5 && now - b.lastSpread > 5000) {
    b.lastSpread = now;
    // C139: gate summons on cap (mirror enemies.js summoner guard)
    const _cap = sim.stresstestActive ? 1500 : BOSS_SUMMON_CAP;
    for (let i = 0; i < 2 && sim.enemies.length < _cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = makeEnemy('runner', b.x + Math.cos(a) * 60, b.y + Math.sin(a) * 60);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  }
}

// C316 (audit 2026-06-18): slow/freeze ratio so hardcoded charge/dash speeds
// honor status effects (updateStatus scales b.speed but charges used raw px/s).
function slowRatio(b) {
  return b._origSpeed > 0 ? (b.speed / b._origSpeed) : 1;
}

// Charge-telegraf: charge-attackerna (tank/brute/shielder) lungar inte direkt utan
// köar en kort wind-up. updateBoss håller bossen still + tänder fx-bit 512 under
// wind-upen och commit:ar sedan laddningen → spelaren får ett läsbart väj-fönster.
const CHARGE_WINDUP_MS = 450;
function startCharge(b, now, dur, dx, dy) {
  b.windupUntil = now + CHARGE_WINDUP_MS;
  b.windupDur = dur;
  b.chargeDir = { x: dx, y: dy };
}

// 2) TANK_CHARGER (Benkrossare)
function aiTankCharger(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.chargeUntil && now < b.chargeUntil) {
    const sm = slowRatio(b);
    b.x += b.chargeDir.x * 360 * sm * dt;
    b.y += b.chargeDir.y * 360 * sm * dt;
  } else {
    if (b.chargeUntil) b.chargeUntil = 0;
    b.x += ndx * b.speed * dt;
    b.y += ndy * b.speed * dt;
    if (now - b.lastAttack > (hpFrac < 0.5 ? 2800 : 4200)) {
      b.lastAttack = now;
      startCharge(b, now, 900, ndx, ndy);
    }
  }
}

// 3) CLOAKER (Strypare) — nu med tick-baserad burst-kö
function aiCloaker(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.cloakUntil && now < b.cloakUntil) return; // osynlig, repositionerar
  if (b.cloakUntil && now >= b.cloakUntil) {
    const a = Math.atan2(p.y - b.y, p.x - b.x) + Math.PI + (Math.random() - 0.5) * 0.8;
    b.x = p.x + Math.cos(a) * 180;
    b.y = p.y + Math.sin(a) * 180;
    b.cloakUntil = 0;
    b.lastAttack = now;
  }
  if (d > 250) { b.x += ndx * b.speed * dt; b.y += ndy * b.speed * dt; }
  else if (d < 150) { b.x -= ndx * b.speed * dt; b.y -= ndy * b.speed * dt; }
  if (now - b.lastAttack > 1200) {
    b.lastAttack = now;
    // Schemalägg 5 burst-shots @ 80ms intervall (ersätter setTimeout)
    for (let i = 0; i < 5; i++) {
      b.burstQueue.push({ firesAt: now + i * 80 });
    }
  }
  if (hpFrac < 0.6 && now - b.lastSpread > 6000) {
    b.lastSpread = now;
    b.cloakUntil = now + 1500;
  }
}

// 4) BRUTE_CHARGER (Avrättaren)
function aiBruteCharger(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.chargeUntil && now < b.chargeUntil) {
    const sm = slowRatio(b);
    b.x += b.chargeDir.x * 420 * sm * dt;
    b.y += b.chargeDir.y * 420 * sm * dt;
    return;
  }
  if (b.chargeUntil) b.chargeUntil = 0;
  b.x += ndx * b.speed * dt;
  b.y += ndy * b.speed * dt;
  const cd = hpFrac < 0.33 ? 2000 : (hpFrac < 0.66 ? 3000 : 4000);
  if (now - b.lastAttack > cd) {
    b.lastAttack = now;
    startCharge(b, now, 850, ndx, ndy);
  }
  if (hpFrac < 0.5 && now - b.lastSpread > 2500) {
    b.lastSpread = now;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 5, 0.20, b.bulletColor, 0.9, 1.6);
  }
}

// 5) PLASMA (Köttkvarn)
function aiPlasma(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.dashUntil && now < b.dashUntil) {
    const sm = slowRatio(b);
    b.x += b.dashDir.x * 500 * sm * dt;
    b.y += b.dashDir.y * 500 * sm * dt;
    return;
  }
  if (b.dashUntil) b.dashUntil = 0;
  const ideal = 320;
  if (d > ideal + 40) { b.x += ndx * b.speed * dt; b.y += ndy * b.speed * dt; }
  else if (d < ideal - 40) { b.x -= ndx * b.speed * dt; b.y -= ndy * b.speed * dt; }
  if (now - b.lastAttack > 900) {
    b.lastAttack = now;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 1, 0, b.bulletColor, 1.1, 2.4);
  }
  if (hpFrac < 0.5 && now - b.lastSpread > 3500) {
    b.lastSpread = now;
    b.dashUntil = now + 600;
    const a = Math.atan2(p.y - b.y, p.x - b.x) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    b.dashDir = { x: Math.cos(a), y: Math.sin(a) };
  }
}

// 6) JETPACK (Askmakare)
function aiJetpack(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.jetpackUntil && now < b.jetpackUntil) {
    b.x += ndx * b.speed * 1.6 * dt;
    b.y += ndy * b.speed * 1.6 * dt;
    if (Math.random() < 0.4) {
      dropFlameTrail(sim, b.x, b.y, 30, 2.5, 12);
    }
    return;
  }
  if (b.jetpackUntil && now >= b.jetpackUntil) b.jetpackUntil = 0;
  if (d > 260) { b.x += ndx * b.speed * 0.7 * dt; b.y += ndy * b.speed * 0.7 * dt; }
  if (now - b.lastAttack > 1300) {
    b.lastAttack = now;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 3, 0.15, b.bulletColor, 1.0, 1.8);
  }
  if (now - b.lastSpread > 5000) {
    b.lastSpread = now;
    b.jetpackUntil = now + 1200;
  }
}

// 7) GAS_SNIPER (Lungrivare)
function aiGasSniper(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.dashUntil && now < b.dashUntil) {
    const sm = slowRatio(b);
    b.x += b.dashDir.x * 480 * sm * dt;
    b.y += b.dashDir.y * 480 * sm * dt;
    return;
  }
  if (b.dashUntil) b.dashUntil = 0;
  const ideal = hpFrac < 0.5 ? 240 : 380;
  if (d > ideal + 40) { b.x += ndx * b.speed * dt; b.y += ndy * b.speed * dt; }
  else if (d < ideal - 40) { b.x -= ndx * b.speed * dt; b.y -= ndy * b.speed * dt; }
  if (d <= 600 && now - b.lastAttack > (hpFrac < 0.5 ? 1100 : 1600)) {
    b.lastAttack = now;
    for (let i = -1; i <= 1; i++) {
      const a = Math.atan2(p.y - b.y, p.x - b.x) + i * 0.07;
      sim.bullets.push({
        x: b.x, y: b.y, vx: Math.cos(a) * 720, vy: Math.sin(a) * 720,
        dmg: b.bulletDmg, life: 2.4, r: 5, color: b.bulletColor, hostile: true,
      });
    }
  }
  if (now - b.lastSpread > 4000) {
    b.lastSpread = now;
    dropGasCloud(sim, b.x, b.y, 90, 5, 8);
    b.dashUntil = now + 400;
    const a = Math.atan2(p.y - b.y, p.x - b.x) + Math.PI;
    b.dashDir = { x: Math.cos(a), y: Math.sin(a) };
  }
}

// 8) SHIELDER (Skallspräckare)
function aiShielder(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  b.shieldDir = Math.atan2(p.y - b.y, p.x - b.x);
  b.x += ndx * b.speed * dt;
  b.y += ndy * b.speed * dt;
  if (d < 380 && now - b.lastAttack > 1400) {
    b.lastAttack = now;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 1, 0, b.bulletColor, 1.3, 2.0);
  }
  if (hpFrac < 0.4 && now - b.lastSpread > 4000 && !b.chargeUntil && !b.windupUntil) {
    b.lastSpread = now;
    startCharge(b, now, 700, ndx, ndy);
  }
  if (b.chargeUntil && now < b.chargeUntil) {
    const sm = slowRatio(b);
    b.x += b.chargeDir.x * 380 * sm * dt;
    b.y += b.chargeDir.y * 380 * sm * dt;
  } else if (b.chargeUntil) b.chargeUntil = 0;
}

// 9) AVATAR (Själaätare)
function aiAvatar(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  if (b.cloakUntil && now < b.cloakUntil) return;
  if (b.cloakUntil && now >= b.cloakUntil) {
    const a = Math.random() * Math.PI * 2;
    b.x = p.x + Math.cos(a) * 250;
    b.y = p.y + Math.sin(a) * 250;
    b.cloakUntil = 0;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 8, Math.PI / 4, b.bulletColor, 0.85, 2.5);
  }
  const ideal = 300;
  if (d > ideal + 50) { b.x += ndx * b.speed * 0.6 * dt; b.y += ndy * b.speed * 0.6 * dt; }
  if (now - b.lastAttack > 1800) {
    b.lastAttack = now;
    bossShoot(sim, b, p.x - b.x, p.y - b.y, 12, Math.PI * 2 / 12, b.bulletColor, 0.7, 3.0);
  }
  if (hpFrac < 0.6 && now - b.lastSpread > 6000) {
    b.lastSpread = now;
    // C139: gate summons on cap
    const _cap = sim.stresstestActive ? 1500 : BOSS_SUMMON_CAP;
    for (let i = 0; i < 3 && sim.enemies.length < _cap; i++) {
      const a = i * Math.PI * 2 / 3;
      const e = makeEnemy('ninja', b.x + Math.cos(a) * 70, b.y + Math.sin(a) * 70);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  }
  if (hpFrac < 0.33 && !b.cloakUntil && now > b.lastAttack + 700 && Math.random() < 0.01) {
    b.cloakUntil = now + 800;
  }
}

// 10) FINAL (Mourad Gravgrävaren) — 3 faser
function aiFinal(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  const phase = hpFrac < 0.33 ? 3 : (hpFrac < 0.66 ? 2 : 1);
  if (phase !== b.phase) {
    b.phase = phase;
    bossShoot(sim, b, 1, 0, 16, Math.PI * 2 / 16, b.bulletColor, 1.0, 2.5);
  }
  if (b.chargeUntil && now < b.chargeUntil) {
    const sm = slowRatio(b);
    b.x += b.chargeDir.x * 480 * sm * dt;
    b.y += b.chargeDir.y * 480 * sm * dt;
    return;
  }
  if (b.chargeUntil) b.chargeUntil = 0;
  const speedMul = phase === 3 ? 1.3 : (phase === 2 ? 1.0 : 0.7);
  b.x += ndx * b.speed * speedMul * dt;
  b.y += ndy * b.speed * speedMul * dt;
  if (now - b.lastSpread >= (phase === 3 ? 800 : 1100)) {
    b.lastSpread = now;
    const shots = phase === 3 ? 9 : (phase === 2 ? 7 : 5);
    bossShoot(sim, b, p.x - b.x, p.y - b.y, shots, 0.16, b.bulletColor, 1.0, 2.2);
  }
  if (phase >= 2 && now - b.lastAttack >= 5000) {
    b.lastAttack = now;
    // C139: gate summons on cap
    const _cap = sim.stresstestActive ? 1500 : BOSS_SUMMON_CAP;
    const _count = phase === 3 ? 4 : 3;
    for (let i = 0; i < _count && sim.enemies.length < _cap; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = makeEnemy('runner', b.x + Math.cos(a) * 90, b.y + Math.sin(a) * 90);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  }
  if (phase === 3 && now - b.chargeCdAt > 3000) {
    b.chargeCdAt = now;
    b.chargeUntil = now + 700;
    b.chargeDir = { x: ndx, y: ndy };
  }
}

// Power-glow-tint per aktiv power (speglar game.js:45410). Modul-const → ingen
// per-tick-allokering (körs för varje boss varje tick).
const POWER_TINTS = {
  caster:        '#9aff5a',
  tank_charger:  '#ff3a3a',
  cloaker:       '#aa3aff',
  brute_charger: '#ff8a30',
  plasma:        '#3acaff',
  jetpack:       '#ff5a14',
  gas_sniper:    '#aaff5a',
  shielder:      '#ffd54a',
  avatar:        '#ff5aff',
};

// FINAL COMBO (alla 10 kampanj-bossar): roterar genom 3 powers ur b.powerSet var
// 5:e sek (3:e vid <33% HP för crescendo), delegerar till befintlig ai*-funktion så
// varje boss spelar som sina 3 minibossar kombinerade. Speglar game.js:45402
// aiFinalCombo — klient-only partiklar/shake borttagna; b.phase driver klientens
// fas-FX (p-fältet är redan wire:at end-to-end) så varje power-byte syns visuellt.
function aiFinalCombo(sim, b, p, ndx, ndy, d, hpFrac, dt, now) {
  const ps = (b.powerSet && b.powerSet.length) ? b.powerSet : ['caster', 'tank_charger', 'cloaker'];
  const swapInterval = hpFrac < 0.33 ? 3000 : 5000;
  // Lazy-init: makeBoss saknar `now`, så sätt första deadline här → idx 0 hålls
  // hela första intervallet (annars swap direkt till idx 1 och idx 0 visas aldrig).
  if (!b.powerSwapAt) b.powerSwapAt = now + swapInterval;
  if (now > b.powerSwapAt) {
    b.powerSwapAt = now + swapInterval;
    b.powerIdx = (b.powerIdx + 1) % ps.length;
    const newPower = ps[b.powerIdx % ps.length];
    if (POWER_TINTS[newPower]) b.glow = POWER_TINTS[newPower];
    // b.phase 1..3 cyklar per swap → klientens fas-visuell lyser upp vid varje byte.
    b.phase = (b.powerIdx % ps.length) + 1;
  }
  const power = ps[b.powerIdx % ps.length];
  switch (power) {
    case 'caster':         aiCaster(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'tank_charger':   aiTankCharger(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'cloaker':        aiCloaker(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'brute_charger':  aiBruteCharger(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'plasma':         aiPlasma(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'jetpack':        aiJetpack(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'gas_sniper':     aiGasSniper(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'shielder':       aiShielder(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    case 'avatar':         aiAvatar(sim, b, p, ndx, ndy, d, hpFrac, dt, now); break;
    default:               aiBruteCharger(sim, b, p, ndx, ndy, d, hpFrac, dt, now);
  }
}

// updateBoss dispatcher
function updateBoss(sim, b, dt, now, players) {
  const target = findNearestPlayer(b, players);
  if (!target) return;
  const dx = target.x - b.x, dy = target.y - b.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ndx = dx / d, ndy = dy / d;
  const hpFrac = b.hp / b.maxHp;

  applyStuckDetection(b, ndx, ndy, now);

  // Flush burst-kö (cloaker)
  if (b.burstQueue && b.burstQueue.length) flushBurstQueue(sim, b, players, now);

  // Charge-telegraf wind-up: håll bossen still + telegrafera (fx-bit 512 sätts i
  // room-sim.js) medan wind-upen tickar, commit:a sedan den köade laddningen. Gäller
  // tank/brute/shielder-lunges (startCharge). Kontakt-skada nedan körs fortf. under hold.
  let _windingUp = false;
  if (b.windupUntil) {
    if (now < b.windupUntil) {
      _windingUp = true;                          // telegraferar — kör inte power-AI:n denna tick
    } else {
      b.windupUntil = 0;
      b.chargeUntil = now + (b.windupDur || 700);  // wind-up klar → commit:a laddningen
      b.windupDur = 0;
    }
  }

  if (!_windingUp) switch (b.ai) {
    case 'caster':         aiCaster(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'tank_charger':   aiTankCharger(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'cloaker':        aiCloaker(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'brute_charger':  aiBruteCharger(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'plasma':         aiPlasma(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'jetpack':        aiJetpack(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'gas_sniper':     aiGasSniper(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'shielder':       aiShielder(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'avatar':         aiAvatar(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'final_combo':    aiFinalCombo(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    case 'final':          aiFinal(sim, b, target, ndx, ndy, d, hpFrac, dt, now); break;
    default:               aiBruteCharger(sim, b, target, ndx, ndy, d, hpFrac, dt, now);
  }

  // World bounds: caller (room-sim.js) re-clamps every enemy/boss to the active
  // stage's worldW/worldH right after updateBoss, so an internal hardcoded
  // 4000x3000 clamp here was dead (looser than every real stage) AND wrong.
  // C320 (audit 2026-06-18): removed — rely on the caller's stage-correct clamp.

  // Boss contact damage — mirror enemies.js applyContactDamage so the boss
  // respects invuln-frames, shield-absorption and routes companion-hits to
  // companionState instead of stomping the owner's HP.
  if (b.contactCd > 0) b.contactCd -= dt;
  // C317 (audit 2026-06-18): recompute separation from POST-move positions
  // (the ai* fns mutate b.x/b.y) so a charge that ends on the player still
  // registers contact instead of using the stale pre-move distance.
  const cdx = target.x - b.x, cdy = target.y - b.y;
  const rsum = (target.r || 14) + b.r;
  if (cdx * cdx + cdy * cdy < rsum * rsum && b.contactCd <= 0 && b.dmg > 0) {
    const tnow = Date.now();
    // C307: respect player invuln-frames (same as the normal-enemy path).
    if (target.invulnUntil && tnow < target.invulnUntil) return;
    if (target._isCompanion && target._wsRef && target._wsRef.companionState) {
      // C308: companion-hit → update server-side companion-state + emit events.
      // Do NOT set _tookDamageFrom on companions (that would write the owner's HP).
      const c = target._wsRef.companionState;
      c.hp = Math.max(0, c.hp - b.dmg);
      if (sim && sim.eventQueue) {
        sim.eventQueue.push({
          type: 'companion_damaged',
          peerId: target.peerId,
          hp: c.hp,
          maxHp: c.maxHp,
          dmg: b.dmg,
        });
      }
      if (c.hp <= 0) {
        c.alive = false;
        if (sim && sim.eventQueue) {
          sim.eventQueue.push({
            type: 'companion_died',
            peerId: target.peerId,
            companionId: c.id,
          });
        }
      }
    } else {
      // STRESSTEST: spelaren odödlig (rent prestanda-test, ingen död).
      if (sim && sim.stresstestActive) {
        target.invulnUntil = tnow + 500;
        b.contactCd = 0.5;
        return;
      }
      // C307: shield absorberar damage först, resten går på HP.
      let dmgRemaining = b.dmg;
      if (target.shield && target.shield > 0) {
        const absorbed = Math.min(dmgRemaining, target.shield);
        target.shield -= absorbed;
        dmgRemaining -= absorbed;
      }
      if (dmgRemaining > 0) {
        target.hp = Math.max(0, target.hp - dmgRemaining);
      }
      target._tookDamageFrom = b;
      target._lastDamageAt = tnow;
      target.invulnUntil = tnow + (sim && sim.survivorsActive ? 150 : 500);
    }
    b.contactCd = 0.5;
    b._attackFxUntil = tnow + 220;   // attack-anim-telegraf (klient fx-bit 256)
  }
}

module.exports = { makeBoss, updateBoss, bossShoot, dropGasCloud, dropFlameTrail };
