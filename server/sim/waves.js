// Phase 4: Wave/spawn-progression server-side.
// Speglar startZone, spawnBoss, spawnMiniBoss, spawnEnemyAtEdge, updateZoneProgression,
// onWaveComplete, isStageComplete (game.js:5731-6001).
// Skippade beroenden (visual/audio/save):
//   - Audio.bossSpawn, Music.setIntensity, triggerShake → skip på server
//   - showToast, Achievements.unlock → skip
//   - save.x → server har ingen save; events broadcast:as till klient
//   - isInsideAnyBuilding → Phase 5 layout-port; tills dess: trust spawn pos
'use strict';

const { makeEnemy } = require('./enemies');
const { makeBoss } = require('./bosses');
const { getStage, getDiffMul, getCoopMultiplier, getNGPMul } = require('../../shared/stages-data');

// Server-side spawn för stage-events (release_dogs, alarm, open_doors).
// Mirror av game.js:triggerStageEvent enemy-spawning. Utan detta blev events
// bara visuella toast — klient-side spawn av hundar kördes inte i serverSim
// så de stod stilla där de spawnade.
function handleServerStageEvent(sim, stage, eventType) {
  if (eventType === 'release_dogs') {
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? 60 : stage.worldW - 60;
      const y = 400 + i * 200;
      const e = makeEnemy('dog', side, y);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  } else if (eventType === 'alarm') {
    for (let i = 0; i < 3; i++) {
      const e = makeEnemy('shooter', stage.goalPos.x + (i - 1) * 60, stage.goalPos.y + 200);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  } else if (eventType === 'open_doors') {
    for (let i = 0; i < 5; i++) {
      const e = makeEnemy('ninja', stage.worldW * 0.5 + (i - 2) * 80, 100);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
    }
  }
}

function startZone(sim, stage, zoneIdx) {
  const zones = stage.zones || [{ count: 8, pool: ['grunt'] }];
  if (zoneIdx >= zones.length) {
    spawnBoss(sim, stage);
    return;
  }
  const z = zones[zoneIdx];
  sim.currentZone = zoneIdx;
  sim.zoneState = 'spawning';
  sim.enemiesToSpawn = z.count;
  sim.spawnTimer = 0.5;
  sim.eventTriggered = false;
  sim.activeZonePool = z.pool;
}

function spawnBoss(sim, stage) {
  sim.zoneState = 'boss';
  const coopMul = getCoopMultiplier(sim.room.members.size);
  const boss = makeBoss(stage.bossKey, stage.goalPos.x, stage.goalPos.y, coopMul);
  if (boss) {
    boss._idx = sim.nextEnemyIdx++;
    sim.enemies.push(boss);
    sim.bossAlive = true;
    sim.bossSequenceStep = 1;
    // Broadcasta boss-spawn-event till klienter (för intro-cinematic)
    sim.eventQueue.push({
      type: 'boss_spawned',
      bossKey: stage.bossKey,
      name: boss.name,
      sub: boss.subtitle,
    });
  }
}

function spawnSecondBoss(sim, stage) {
  if (!stage.bossKey2) return;
  const coopMul = getCoopMultiplier(sim.room.members.size);
  const boss = makeBoss(stage.bossKey2, stage.goalPos.x, stage.goalPos.y, coopMul);
  if (boss) {
    boss._idx = sim.nextEnemyIdx++;
    sim.enemies.push(boss);
    sim.bossAlive = true;
    sim.bossSequenceStep = 2;
    sim.eventQueue.push({
      type: 'boss_spawned',
      bossKey: stage.bossKey2,
      name: boss.name,
      sub: boss.subtitle,
    });
  }
}

function spawnMiniBoss(sim, stage, idx) {
  // Stöder både nya stage.miniBosses[]-array OCH legacy stage.miniBoss
  let m = null;
  if (stage.miniBosses && stage.miniBosses.length > 0) {
    m = stage.miniBosses[Math.min(idx || 0, stage.miniBosses.length - 1)];
  } else {
    m = stage.miniBoss;
  }
  if (!m) return;
  const sx = stage.worldW / 2 + (Math.random() - 0.5) * 200;
  const sy = stage.worldH / 2 + (Math.random() - 0.5) * 200;
  const e = makeEnemy(m.type || 'brute', sx, sy);
  const wave = sim.wave;
  const scale = Math.min(1 + (wave - 1) * 0.10, 4.0);
  const diff = getDiffMul(sim.config.difficulty);
  const ngpMul = getNGPMul(sim.config.ngpLevel);
  const coopMul = getCoopMultiplier(sim.room.members.size);
  e.hp = Math.round(e.hp * (m.hpMul || 4) * scale * diff.enemyHp * ngpMul * coopMul);
  e.maxHp = e.hp;
  e.dmg = Math.round(e.dmg * (m.dmgMul || 1.5) * scale * diff.enemyDmg * ngpMul);
  if (e.bulletDmg) e.bulletDmg = Math.round(e.bulletDmg * (m.dmgMul || 1.5));
  e.r = Math.round(e.r * (m.scale || 1.4));
  e.speed = Math.round(e.speed * 1.1);
  e._origSpeed = e.speed;
  e.gold = m.gold || 100;
  e.isMiniBoss = true;
  e.miniBossIdx = idx || 0;
  e.miniPower = m.power || null;
  e.name = m.name || 'Mini-boss';
  e._idx = sim.nextEnemyIdx++;
  sim.enemies.push(e);
  sim.eventQueue.push({ type: 'miniboss_spawned', name: e.name, power: e.miniPower, idx: e.miniBossIdx });
}

// spawnEnemyAtEdge — mirror av game.js:5792-5838
// Phase 4: skippar isInsideAnyBuilding (Phase 5)
function spawnEnemyAtEdge(sim, stage, players) {
  const pool = sim.activeZonePool || ['grunt'];
  const type = pool[Math.floor(Math.random() * pool.length)];
  // Använd centroid-spelar-pos för "för nära" check
  let pcx = stage.spawnPos.x, pcy = stage.spawnPos.y;
  if (players.length > 0) {
    pcx = 0; pcy = 0;
    for (const p of players) { pcx += p.x; pcy += p.y; }
    pcx /= players.length; pcy /= players.length;
  }
  let x = 0, y = 0, ok = false;
  for (let tries = 0; tries < 14 && !ok; tries++) {
    const t = 0.15 + Math.random() * 0.7;
    x = stage.spawnPos.x + (stage.goalPos.x - stage.spawnPos.x) * (1 - t)
      + (Math.random() - 0.5) * stage.worldW * 0.6;
    y = stage.spawnPos.y + (stage.goalPos.y - stage.spawnPos.y) * (1 - t)
      + (Math.random() - 0.5) * stage.worldH * 0.4;
    x = Math.max(40, Math.min(stage.worldW - 40, x));
    y = Math.max(40, Math.min(stage.worldH - 40, y));
    const dx = x - pcx, dy = y - pcy;
    if (dx * dx + dy * dy < 320 * 320) continue;
    ok = true;
  }
  if (!ok) return;
  const e = makeEnemy(type, x, y);
  const wave = sim.wave;
  const scale = 1 + (wave - 1) * 0.10;
  const diff = getDiffMul(sim.config.difficulty);
  const ngpMul = getNGPMul(sim.config.ngpLevel);
  const coopMul = getCoopMultiplier(sim.room.members.size);
  e.hp = Math.round(e.hp * scale * diff.enemyHp * ngpMul * coopMul);
  e.maxHp = e.hp;
  e.dmg = Math.round(e.dmg * scale * diff.enemyDmg * ngpMul * (1 + (coopMul - 1) * 0.5));
  e._origSpeed = e.speed;
  if (e.bulletDmg) e.bulletDmg = Math.round(e.bulletDmg * diff.enemyDmg * ngpMul);
  e._idx = sim.nextEnemyIdx++;
  sim.enemies.push(e);
}

// Update wave progression — mirror av game.js:5877-5934
function updateZoneProgression(sim, dt) {
  const stage = getStage(sim.wave);
  if (!stage) return;
  // Boss fail-safe (game.js:5878-5893)
  if (stage.bossKey && sim.bossSequenceStep === 0) {
    const zones = stage.zones || [];
    const lastZoneDone = sim.currentZone >= zones.length - 1;
    const noEnemies = sim.enemies.length === 0 && sim.enemiesToSpawn <= 0;
    if (lastZoneDone && noEnemies) {
      sim._bossFailsafeTimer = (sim._bossFailsafeTimer || 0) + dt;
      if (sim._bossFailsafeTimer > 3) {
        sim._bossFailsafeTimer = 0;
        spawnBoss(sim, stage);
        return;
      }
    } else {
      sim._bossFailsafeTimer = 0;
    }
  }
  if (sim.zoneState === 'spawning' && sim.enemiesToSpawn <= 0) {
    sim.zoneState = 'clearing';
  }
  // Interlude-wave clear → spawn nästa miniboss
  if (sim.enemies.length === 0 && sim._miniInterludeActive) {
    sim._miniInterludeActive = false;
    const nextIdx = sim._miniInterludeNextIdx || 0;
    const list2 = stage.miniBosses || (stage.miniBoss ? [stage.miniBoss] : []);
    if (nextIdx < list2.length) {
      sim.miniBossesSpawned = nextIdx + 1;
      spawnMiniBoss(sim, stage, nextIdx);
      return;
    }
    sim.zoneState = 'clearing';
  }
  if (sim.zoneState === 'clearing' && sim.enemies.length === 0) {
    // Mini-boss-sekvens (3 minibosses + interlude-waves)
    const miniList = stage.miniBosses || (stage.miniBoss ? [stage.miniBoss] : []);
    if (miniList.length > 0 && (sim.miniBossesSpawned || 0) === 0) {
      sim.miniBossesSpawned = 1;
      spawnMiniBoss(sim, stage, 0);
      return;
    }
    // Vänta på alla minibosses
    if (miniList.length > 0 && (sim.miniBossesSpawned || 0) < miniList.length) {
      return;
    }
    const zones = stage.zones || [];
    const z = zones[sim.currentZone];
    if (z && z.event && !sim.eventTriggered) {
      sim.eventTriggered = true;
      sim.eventQueue.push({ type: 'stage_event', event: z.event });
      sim.zoneState = 'event';
      sim.eventTimer = 1.2;
      // Server-side enemy-spawn för stage-events (annars står hundarna stilla — klient
      // spawnade lokalt men server visste inget om dem så ingen AI-update kördes).
      handleServerStageEvent(sim, stage, z.event);
    } else {
      const next = sim.currentZone + 1;
      if (next < zones.length) {
        startZone(sim, stage, next);
      } else if (sim.bossSequenceStep === 0) {
        spawnBoss(sim, stage);
      }
    }
  }
  if (sim.zoneState === 'event') {
    sim.eventTimer -= dt;
    if (sim.eventTimer <= 0) {
      const next = sim.currentZone + 1;
      if (next < (stage.zones || []).length) {
        startZone(sim, stage, next);
      } else if (sim.bossSequenceStep === 0) {
        spawnBoss(sim, stage);
      }
    }
  }
}

// Boss-defeat tracking (kallas från damageEnemy när boss dör)
function checkBossDeath(sim, deadEntity) {
  if (!deadEntity.isBoss) return;
  const stage = getStage(sim.wave);
  if (!stage) return;
  // Stage med två-boss-sekvens
  if (stage.bossKey2 && sim.bossSequenceStep === 1) {
    sim.eventQueue.push({ type: 'boss_killed', step: 1 });
    setTimeout(() => spawnSecondBoss(sim, stage), 1200);
    return;
  }
  // Sista boss död → stage clear
  sim.bossDefeated = true;
  sim.eventQueue.push({ type: 'boss_killed', step: sim.bossSequenceStep });
}

// Stage-clear check
function isStageComplete(sim) {
  if (!sim.waveActive) return false;
  if (!sim.bossDefeated) return false;
  if (sim.enemies.length > 0) return false;
  const stage = getStage(sim.wave);
  if (stage && stage.bossKey2 && sim.bossSequenceStep < 2) return false;
  return true;
}

// Server-side onWaveComplete — bara state, inga UI-anrop
function onWaveComplete(sim) {
  if (sim._waveCompleting) return;
  sim._waveCompleting = true;
  sim.waveActive = false;
  sim.eventQueue.push({ type: 'stage_complete', wave: sim.wave });
  console.log('[SIM]', sim.room.code, 'stage', sim.wave, 'complete');
}

// Init eller load nästa stage
function loadStage(sim, wave) {
  const stage = getStage(wave);
  if (!stage) return;
  sim.wave = wave;
  sim.waveActive = true;
  sim.bossAlive = false;
  sim.bossDefeated = false;
  sim.bossSequenceStep = 0;
  sim.currentZone = -1;
  sim.zoneState = 'idle';
  sim.eventTimer = 0;
  sim.eventTriggered = false;
  sim.miniBossSpawned = false;
  sim.miniBossesSpawned = 0;
  sim._miniInterludeActive = false;
  sim._miniInterludeNextIdx = 0;
  sim._waveCompleting = false;
  sim._bossFailsafeTimer = 0;
  sim.activeZonePool = null;
  // Rensa enemies/bullets/dead-bodies från förra stage
  sim.enemies = [];
  sim.bullets = [];
  if (sim.gasClouds) sim.gasClouds = [];
  if (sim.flameTrails) sim.flameTrails = [];
  if (sim.deadBodies) sim.deadBodies = {};
  // Återställ alla spelare HP + position
  for (const [, ws] of sim.room.members) {
    if (ws.playerState) {
      ws.playerState.hp = 100;
      ws.playerState.x = stage.spawnPos.x;
      ws.playerState.y = stage.spawnPos.y;
      ws.playerState.invulnUntil = Date.now() + 1500;
    }
  }
  // Initiera alla peers playerState till stage spawn-pos så enemy-spawn + cull blir korrekt
  // tills första sim_input anländer från klient
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState) ws.playerState = { x: stage.spawnPos.x, y: stage.spawnPos.y, hp: 100 };
  }
  // Starta första zon
  startZone(sim, stage, 0);
  // 5-sekunders countdown vid varje stage-start så alla peers hinner synka position
  // och se "FÖRBERED 5..4..3..2..1" innan enemies börjar spawna
  sim.simReadyAt = Date.now() + 5000;
  sim.eventQueue.push({ type: 'stage_loaded', wave, stageName: stage.name, stageKind: stage.kind });
  sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
}

module.exports = {
  startZone, spawnBoss, spawnSecondBoss, spawnMiniBoss, spawnEnemyAtEdge,
  updateZoneProgression, isStageComplete, onWaveComplete, loadStage,
  checkBossDeath,
};
