// Per-room simulation. Phase 4: bossar + waves + stages.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy } = require('./enemies');
const { spawnPlayerBullets, applyMelee, updateBullets, damageEnemy } = require('./bullets');
const { addBot, tickBots, removeAllBots } = require('./bots');
const { updateBoss } = require('./bosses');
const { loadStage, updateZoneProgression, spawnEnemyAtEdge, isStageComplete, onWaveComplete, checkBossDeath } = require('./waves');
const { updatePickups, dropFromEnemyDeath } = require('./pickups');
const { getStage } = require('../../shared/stages-data');
const { CTF_ARENA, resolveCtfWall, bulletHitsWall } = require('../../shared/ctf-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');
const { SIEGE_ARENA } = require('../../shared/siege-arena');
const { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS } = require('../../shared/gungame-arena');

// 30Hz → 45Hz: tickar var 22ms istället för 33ms. Halverar input→pixel-delay
// från server-tick-perspektiv. 1.5× CPU-last, men Node klarar 10k+ ops/tick i
// god marginal (current load ~10ms/tick på Render free). Vid CPU-tryck kan
// vi sätta SIM_TICK_HZ env-var lokalt utan ny deploy.
const TICK_HZ = parseInt(process.env.SIM_TICK_HZ, 10) || 45;
const TICK_MS = 1000 / TICK_HZ;
// Broadcast-rate matchar nu tick (45Hz) för minimal input→pixel-delay.
// Tidigare 30Hz introducerade upp till 22ms dödtid mellan world-snapshots
// vilket var en stor del av "lagg-känslan" trots OK ping. Per-peer-broadcast
// kostar mest i deflate; men threshold:256 i server.js skippar deflate för
// små paket så CPU-impacten är acceptabel även för 8-player-rum.
const BROADCAST_HZ = parseInt(process.env.SIM_BROADCAST_HZ, 10) || 45;
const BROADCAST_EVERY = Math.max(1, Math.round(TICK_HZ / BROADCAST_HZ));
const FULL_BROADCAST_MS = 1500;
const ENEMY_CAP = 80;
const CULL_DIST = 1100;

function createSim(room) {
  const sim = {
    room,
    enemies: [],
    bullets: [],
    gasClouds: [],
    flameTrails: [],
    nextEnemyIdx: 0,
    spawnTimer: 1.5,
    waveActive: false,
    enemiesToSpawn: 0,
    activeZonePool: null,
    currentZone: -1,
    zoneState: 'idle',
    eventTimer: 0,
    eventTriggered: false,
    miniBossSpawned: false,
    bossAlive: false,
    bossDefeated: false,
    bossSequenceStep: 0,
    wave: 1,
    eventQueue: [],
    config: { difficulty: 'veteran', ngpLevel: 0, mode: 'story' },
    timeStopUntil: 0,
    lastTick: Date.now(),
    lastFullAt: 0,
    seqByPeer: new Map(),
    lastSentEnemyByPeer: new Map(),
    interval: null,
    // TDM-state (PvP)
    tdmActive: false,
    tdmKills: { red: 0, blue: 0 },
    tdmTargetKills: 10,
    tdmEnded: false,
    tdmKillsByPid: {},   // peerId → kills (för leaderboard)
    tdmDeathsByPid: {},  // peerId → deaths
    // CTF-state (Capture the Flag PVP)
    ctfActive: false,
    ctfCaptures: { red: 0, blue: 0 },
    ctfTargetCaptures: 3,
    ctfEnded: false,
    ctfKillsByPid: {},     // för leaderboard
    ctfCapturesByPid: {},  // peerId → captures
    ctfFlags: {            // flagga-state — carrierId === null betyder "på base/dropad/return-timer"
      red:  { x: 0, y: 0, baseX: 0, baseY: 0, carrierId: null, atBase: true, droppedAt: 0 },
      blue: { x: 0, y: 0, baseX: 0, baseY: 0, carrierId: null, atBase: true, droppedAt: 0 },
    },
    // CTF-turrets: en MG-torn per lag. occupantId === null = ledig, satt = en spelare sitter i.
    // hp <= 0 = destroyed (kan inte mountas igen). lastShotAt = rate-limit för MG-fire.
    ctfTurrets: {},
    // SIEGE THE BASE state
    siegeActive: false,
    siegeTargetPoints: 500,
    siegeEnded: false,
    siegeScores: { red: 0, blue: 0 },
    siegeKillsByPid: {},
    siegeBases: {},        // baseId → { id, x, y, r, owner, captureProgress, captureSide }
    siegeCores: {},        // coreId → { id, team, x, y, w, h, hp, maxHp, destroyed }
    siegeTurrets: {},      // turretId → same structure as ctfTurrets
    _siegePointAccum: { red: 0, blue: 0 }, // fractional points buffer
    _siegeLastTick: 0,
    // GUNGAME state (FFA, 15-tier progression)
    gungameActive: false,
    gungameEnded: false,
    gungameWinner: null,
    gungameTiers: {},        // peerId → 0..14 (current weapon tier)
    gungameKillsByPid: {},   // peerId → total kills (för stats)
    _gungameSpawnIdx: 0,     // roterar spawn-punkter så respawn inte upprepar
  };
  return sim;
}

const CTF_FLAG_AUTORETURN_MS = 30000;
const CTF_CARRIER_SPEED_MUL = 0.75; // -25% speed för flag-carrier

function tickSim(sim) {
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTick) / 1000);
  sim.lastTick = now;

  // Lag compensation: snapshot alla spelar-positioner FÖRE tick-logiken så vi
  // kan rewinda upp till 200ms när skott från en laggande klient anländer.
  // Ringbuffer per ws.playerState — håll bara 12 snapshots (~265ms @ 45Hz).
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (!ws.playerState._history) ws.playerState._history = [];
    ws.playerState._history.push({ t: now, x: ws.playerState.x, y: ws.playerState.y });
    // Prune äldre än 250ms (lite mer än max rewind 200ms för safety)
    while (ws.playerState._history.length > 0 && now - ws.playerState._history[0].t > 250) {
      ws.playerState._history.shift();
    }
  }

  // Bot-AI: rör bots + skjuter. Skippar countdown och time-stop internt.
  // Körs FÖRE mode-specifika branches så bot-position är updated innan
  // bullets uppdateras / damage appliceras.
  tickBots(sim, dt, now);

  // 5s startup-countdown: skicka world-snapshot (för synk) men frys enemy-AI/spawn/damage
  if (sim.simReadyAt && now < sim.simReadyAt) {
    broadcastWorld(sim, now);
    return;
  }
  if (sim.simReadyAt && now >= sim.simReadyAt) {
    sim.simReadyAt = 0;
    sim.eventQueue.push({ type: 'countdown_end' });
  }

  if (sim.enemies.length > ENEMY_CAP) {
    const boss = sim.enemies.find(e => e.isBoss);
    sim.enemies = sim.enemies.slice(-ENEMY_CAP);
    if (boss && !sim.enemies.includes(boss)) sim.enemies.push(boss);
  }

  // Time-stop fryser enemy-AI och bullets (mirror av game.js:7263)
  const timeStopped = sim.timeStopUntil && now < sim.timeStopUntil;

  // TDM-mode: skip enemy spawning/AI, but bullets MÅSTE tickas så spelare kan skjuta varandra
  if (sim.tdmActive) {
    const nowMs = Date.now();
    const arena = sim.tdmArena || { worldW: 4000, worldH: 3000 };
    const redSpawnX = Math.floor(arena.worldW * 0.10);
    const blueSpawnX = Math.floor(arena.worldW * 0.90);
    const spawnY = Math.floor(arena.worldH * 0.50);
    for (const [pid, ws] of sim.room.members) {
      if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
        ws.tdmRespawnAt = 0;
        if (ws.playerState) {
          ws.playerState.x = ws.tdmTeam === 'red' ? redSpawnX : blueSpawnX;
          ws.playerState.y = spawnY;
          ws.playerState.hp = 100;
          ws.playerState.shield = ws.playerState.maxShield || 100;
          ws.playerState.invulnUntil = Date.now() + 1500;
          // Riktat event så klienten kan reseta spectating-mode + spawna-fx
          sim.eventQueue.push({
            type: 'tdm_player_respawned',
            peerId: pid,
            x: ws.playerState.x,
            y: ws.playerState.y,
            hp: ws.playerState.hp,
            shield: ws.playerState.shield,
          });
        }
      }
    }
    // Wall-collision för spelare i TDM (server är auktoritet — annars går att
    // springa genom cover-crates). resolveCtfWall muterar entity.x/y in-place.
    for (const [, ws] of sim.room.members) {
      if (ws.playerState && ws.playerState.hp > 0) {
        const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
        resolveCtfWall(ent, TDM_ARENA.walls);
        ws.playerState.x = ent.x;
        ws.playerState.y = ent.y;
      }
    }
    // PvP-pickups: respawn-timer + collect-detection (BARA om match ej avslutad)
    if (!sim.tdmEnded) tickPvpPickups(sim, now);
    // Match-end-flagga: stoppa allt när någon nått targetKills
    if (!sim.tdmEnded) {
      updateBullets(sim, dt, now);
      // Centraliserad death-detection: även om explosioner/PvE-källor dödar
      // sätts respawn-timer + emit kill-events. Bullets.js sätter dem redan
      // för player-bullets, så vi bara fyller luckorna.
      for (const [pid, ws] of sim.room.members) {
        if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
          ws.tdmRespawnAt = nowMs + 3000;
          sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
          sim.eventQueue.push({ type: 'tdm_player_died', victim: pid, durationMs: 3000 });
        }
      }
    }
    broadcastWorld(sim, now);
    return;
  }

  // CTF-mode: pickup/drop/capture-logik + bullets
  if (sim.ctfActive) {
    tickCtf(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // SIEGE-mode: capture-bases + core-damage + scoring
  if (sim.siegeActive) {
    tickSiege(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // GUNGAME-mode: FFA, 15-tier vapen-progression
  if (sim.gungameActive) {
    tickGungame(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // Wave-spawn: spawnEnemyAtEdge
  if (sim.waveActive && sim.enemiesToSpawn > 0 && !timeStopped) {
    sim.spawnTimer -= dt;
    if (sim.spawnTimer <= 0 && sim.enemies.length < ENEMY_CAP) {
      const stage = getStage(sim.wave);
      const players = buildPlayerList(sim);
      const beforeCount = sim.enemies.length;
      if (stage) spawnEnemyAtEdge(sim, stage, players);
      // Spam-skydd: bara logga första spawn per wave (annars 100+ logs/match)
      if (process.env.SIM_DEBUG || (sim._lastLogWave !== sim.wave)) {
        const spawned = sim.enemies.length > beforeCount;
        console.log('[SIM]', sim.room.code, 'spawn wave=' + sim.wave + ' zone=' + sim.currentZone + ' toSpawn=' + sim.enemiesToSpawn + ' players=' + players.length + ' spawned=' + spawned);
        sim._lastLogWave = sim.wave;
      }
      sim.enemiesToSpawn--;
      sim.spawnTimer = 0.4 + Math.random() * 0.4;
    }
  }

  // Bygg lista av "spelare"
  const players = buildPlayerList(sim);

  // Enemy + boss AI (frozen vid time-stop)
  if (!timeStopped) {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      if (e.isBoss) {
        updateBoss(sim, e, dt, now, players);
      } else {
        updateEnemy(e, dt, now, sim, players);
      }
      // World bounds (förenklad)
      const stage = getStage(sim.wave);
      const ww = stage ? stage.worldW : 4000;
      const wh = stage ? stage.worldH : 3000;
      e.x = Math.max(20, Math.min(ww - 20, e.x));
      e.y = Math.max(20, Math.min(wh - 20, e.y));
    }
  }

  // Skriv tillbaka playerState.hp + invulnUntil från contact-damage
  if (!sim.deadBodies) sim.deadBodies = {};
  for (const p of players) {
    if (p._tookDamageFrom) {
      const ws = sim.room.members.get(p.peerId);
      if (ws && ws.playerState) {
        ws.playerState.hp = p.hp;
        ws.playerState.invulnUntil = p.invulnUntil;
      }
    }
  }
  // Centraliserad death-detektering — täcker alla damage-källor (contact, hostile bullets, hazards, explosion)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (ws.playerState.hp <= 0 && !sim.deadBodies[pid]) {
      sim.deadBodies[pid] = {
        x: ws.playerState.x,
        y: ws.playerState.y,
        reviveTimer: 0,
        revivedBy: null,
      };
      sim.eventQueue.push({ type: 'player_died', peerId: pid });
    }
  }
  // Revive-tick: om annan LEVANDE spelare står inom 50px av kroppen i 5s → revive
  updateRevive(sim, dt);

  // Bullet-uppdatering (frozen vid time-stop? Original-kod fryser BARA enemies, ej bullets)
  updateBullets(sim, dt, now);

  // Hazards: gasClouds + flameTrails — applicera DoT på spelare
  updateHazards(sim, dt, now, players);

  // Boss-death tracking + pickup-droppar
  if (sim.enemies.some(e => e.dead)) {
    for (const e of sim.enemies) {
      if (!e.dead) continue;
      if (e.isBoss) checkBossDeath(sim, e);
      // Mini-boss interlude: när miniboss dör + fler i listan → spawn enemies
      // (server-side spegling av game.js:killEnemy)
      if (e.isMiniBoss && !e._miniBossNextSpawned) {
        e._miniBossNextSpawned = true;
        // Använd top-level imports (require är hot-loop-noise + crashar mid-tick
        // om modul-load fail. getStage + makeEnemy redan importerade.)
        const stage = getStage(sim.wave);
        const list = stage && (stage.miniBosses || (stage.miniBoss ? [stage.miniBoss] : []));
        if (list && (sim.miniBossesSpawned || 0) < list.length) {
          sim._miniInterludeActive = true;
          sim._miniInterludeNextIdx = sim.miniBossesSpawned;
          // Spawn 5-7 interlude-enemies från stage-pool
          const zones = stage.zones || [];
          const pool = (zones[Math.min(sim.currentZone || 0, zones.length - 1)] || zones[0] || { pool: ['grunt'] }).pool;
          const count = 5 + Math.floor(Math.random() * 3);
          for (let i = 0; i < count; i++) {
            const t = pool[Math.floor(Math.random() * pool.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 350 + Math.random() * 200;
            const cx = e.x + Math.cos(angle) * dist;
            const cy = e.y + Math.sin(angle) * dist;
            const ne = makeEnemy(t,
              Math.max(40, Math.min(stage.worldW - 40, cx)),
              Math.max(40, Math.min(stage.worldH - 40, cy)));
            ne._idx = sim.nextEnemyIdx++;
            sim.enemies.push(ne);
          }
        }
      }
      // Drop pickup
      dropFromEnemyDeath(sim, e);
      if (sim.eventQueue) {
        sim.eventQueue.push({
          type: 'enemy_killed',
          i: e._idx,
          gold: e.gold || 0,
          killerPid: e.lastDamagerPid || null,
          isBoss: !!e.isBoss,
          isMiniBoss: !!e.isMiniBoss,
        });
      }
    }
    sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // Pickup-update (magnet, collect)
  updatePickups(sim, dt);

  // Wave progression
  if (sim.waveActive) {
    updateZoneProgression(sim, dt);
    if (isStageComplete(sim)) onWaveComplete(sim);
  }

  // Skicka world-snapshots — bara var BROADCAST_EVERY:te tick för att spara CPU
  sim._tickCount = (sim._tickCount || 0) + 1;
  if (sim._tickCount % BROADCAST_EVERY === 0) {
    broadcastWorld(sim, now);
  }
}

// Revive-system: levande spelare nära dead body 5s → respawn på platsen med 50% HP
function updateRevive(sim, dt) {
  if (!sim.deadBodies) return;
  for (const peerId of Object.keys(sim.deadBodies)) {
    const body = sim.deadBodies[peerId];
    let anyReviving = false;
    let reviverPid = null;
    for (const [pid, ws] of sim.room.members) {
      if (pid === peerId) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - body.x;
      const dy = ws.playerState.y - body.y;
      if (dx * dx + dy * dy < 50 * 50) {
        anyReviving = true;
        reviverPid = pid;
        body.reviveTimer = (body.reviveTimer || 0) + dt;
        body.revivedBy = pid;
        if (body.reviveTimer >= 5) {
          // Återuppliv!
          const deadWs = sim.room.members.get(peerId);
          if (deadWs && deadWs.playerState) {
            deadWs.playerState.x = body.x;
            deadWs.playerState.y = body.y;
            deadWs.playerState.hp = 50;
            deadWs.playerState.invulnUntil = Date.now() + 2000;
          }
          delete sim.deadBodies[peerId];
          sim.eventQueue.push({ type: 'player_revived', peerId, revivedBy: pid });
        }
        break;
      }
    }
    if (!anyReviving) body.reviveTimer = Math.max(0, (body.reviveTimer || 0) - dt);
  }
}

function buildPlayerList(sim) {
  const stage = getStage(sim.wave);
  const defaultX = stage ? stage.spawnPos.x : 1000;
  const defaultY = stage ? stage.spawnPos.y : 1000;
  const players = [];
  for (const [pid, ws] of sim.room.members) {
    // Late-joiner: init till stage spawn-pos så de inte hamnar på (1000,1000) random plats
    if (!ws.playerState) ws.playerState = { x: defaultX, y: defaultY, hp: 100 };
    const ps = ws.playerState;
    players.push({
      peerId: pid,
      x: ps.x, y: ps.y,
      hp: ps.hp != null ? ps.hp : 100,
      invulnUntil: ps.invulnUntil || 0,
      r: 14,
      _wsRef: ws, // refs för companion-aggro-AI + damage-event-routing
    });
    // Companion som "fake player" så enemy-AI kan target den + ta kontakt-skada.
    // Markeras med _isCompanion så contact-damage routar till event istället för
    // direkt p.hp-modifikation.
    if (ws.companionState && ws.companionState.alive && ws.companionState.hp > 0) {
      const c = ws.companionState;
      players.push({
        peerId: pid,
        _isCompanion: true,
        _companionId: c.id,
        x: c.x, y: c.y,
        hp: c.hp,
        invulnUntil: 0,
        r: c.r || 12,
        _wsRef: ws,
      });
    }
  }
  return players;
}

function updateHazards(sim, dt, now, players) {
  // Gas clouds (mirror av game.js:8059-)
  if (sim.gasClouds && sim.gasClouds.length) {
    for (let i = sim.gasClouds.length - 1; i >= 0; i--) {
      const g = sim.gasClouds[i];
      g.life -= dt;
      if (g.life <= 0) { sim.gasClouds.splice(i, 1); continue; }
      // DoT på spelare (skippar companion — annars dubbel-räknat per ws)
      for (const p of players) {
        if (p.hp <= 0 || p._isCompanion) continue;
        const dx = p.x - g.x, dy = p.y - g.y;
        if (dx * dx + dy * dy < g.r * g.r) {
          p.hp = Math.max(0, p.hp - g.dps * dt);
          const ws = sim.room.members.get(p.peerId);
          if (ws && ws.playerState) ws.playerState.hp = p.hp;
        }
      }
    }
  }
  // Flame trails
  if (sim.flameTrails && sim.flameTrails.length) {
    for (let i = sim.flameTrails.length - 1; i >= 0; i--) {
      const f = sim.flameTrails[i];
      f.life -= dt;
      if (f.life <= 0) { sim.flameTrails.splice(i, 1); continue; }
      for (const p of players) {
        if (p.hp <= 0 || p._isCompanion) continue;
        const dx = p.x - f.x, dy = p.y - f.y;
        if (dx * dx + dy * dy < f.r * f.r) {
          p.hp = Math.max(0, p.hp - f.dps * dt);
          const ws = sim.room.members.get(p.peerId);
          if (ws && ws.playerState) ws.playerState.hp = p.hp;
        }
      }
    }
  }
}

// ============================================================
// CTF (Capture the Flag) — server-auktoritativ logic
// ============================================================
// Tickas istället för enemy-AI/wave-progression när sim.ctfActive=true.
// Hanterar: respawn, flag-carrier-follow, pickup, capture, drop, auto-return,
// wall-collision för spelare, samt bullets via befintlig updateBullets (som
// kollar walls via shared/ctf-arena).
function tickCtf(sim, dt, now) {
  // Respawn döda spelare på random egna spawn-point
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && now >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const team = ws.tdmTeam || 'red';
        const pts = CTF_ARENA.spawns[team] || CTF_ARENA.spawns.red;
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = 100;
        ws.playerState.shield = ws.playerState.maxShield || 100;
        ws.playerState.invulnUntil = Date.now() + 1500;
        // Om spelare dog med en flagga, droppa den vid death-positionen (sker via
        // applyCtfDeath separat — denna respawn-path ger ny position).
        sim.eventQueue.push({
          type: 'ctf_player_respawned',
          peerId: pid,
          x: ws.playerState.x,
          y: ws.playerState.y,
          hp: ws.playerState.hp,
          shield: ws.playerState.shield,
        });
      }
    }
  }
  // PvP-pickups: respawn timer + collect-detection (shared mellan CTF + TDM)
  tickPvpPickups(sim, now);

  // Match-end: skippa allt
  if (sim.ctfEnded) {
    broadcastWorld(sim, now);
    return;
  }

  // Push spelare ur walls (collision)
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
    resolveCtfWall(e, CTF_ARENA.walls);
    ws.playerState.x = e.x;
    ws.playerState.y = e.y;
    // Klamp till arena-bounds
    ws.playerState.x = Math.max(20, Math.min(CTF_ARENA.worldW - 20, ws.playerState.x));
    ws.playerState.y = Math.max(20, Math.min(CTF_ARENA.worldH - 20, ws.playerState.y));
  }

  // Flagga-state: om carrier finns, flagga följer carrier-position
  for (const team of ['red', 'blue']) {
    const flag = sim.ctfFlags[team];
    if (flag.carrierId) {
      const ws = sim.room.members.get(flag.carrierId);
      if (ws && ws.playerState && ws.playerState.hp > 0) {
        flag.x = ws.playerState.x;
        flag.y = ws.playerState.y;
      } else {
        // Carrier disconnected/missing → returnera flagga
        flag.carrierId = null;
        flag.x = flag.baseX;
        flag.y = flag.baseY;
        flag.atBase = true;
        sim.eventQueue.push({ type: 'ctf_flag_returned', team, reason: 'carrier_lost' });
      }
    } else if (!flag.atBase) {
      // Dropped — kolla auto-return efter 30s
      if (now - flag.droppedAt > CTF_FLAG_AUTORETURN_MS) {
        flag.x = flag.baseX;
        flag.y = flag.baseY;
        flag.atBase = true;
        flag.droppedAt = 0;
        sim.eventQueue.push({ type: 'ctf_flag_returned', team, reason: 'timeout' });
      }
    }
  }

  // Pickup / capture / return-detection — iterera spelare
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const myTeam = ws.tdmTeam || 'red';
    const enemyTeam = myTeam === 'red' ? 'blue' : 'red';
    const px = ws.playerState.x, py = ws.playerState.y;

    // 1. Pickup enemy-flagga (om ledig)
    const enemyFlag = sim.ctfFlags[enemyTeam];
    let justPickedUp = false;
    if (!enemyFlag.carrierId) {
      const dx = px - enemyFlag.x, dy = py - enemyFlag.y;
      if (dx * dx + dy * dy < CTF_ARENA.pickupRadius * CTF_ARENA.pickupRadius) {
        enemyFlag.carrierId = pid;
        enemyFlag.atBase = false;
        enemyFlag.droppedAt = 0;
        justPickedUp = true;
        sim.eventQueue.push({
          type: 'ctf_flag_picked',
          peerId: pid,
          team: enemyTeam, // vilken flagga som plockades upp
          carrierTeam: myTeam,
        });
      }
    }

    // 2. Capture: jag bär enemy-flagga + jag är vid min egen flagga (som måste vara hemma)
    //    Skippa om vi just plockade upp denna tick → annars instant-capture-exploit
    if (justPickedUp) continue;
    if (enemyFlag.carrierId === pid) {
      const myFlag = sim.ctfFlags[myTeam];
      if (myFlag.atBase) {
        const dx = px - myFlag.baseX, dy = py - myFlag.baseY;
        if (dx * dx + dy * dy < CTF_ARENA.captureRadius * CTF_ARENA.captureRadius) {
          // CAPTURE!
          sim.ctfCaptures[myTeam] = (sim.ctfCaptures[myTeam] || 0) + 1;
          sim.ctfCapturesByPid[pid] = (sim.ctfCapturesByPid[pid] || 0) + 1;
          // Reset enemy-flagga tillbaka till sin bas
          enemyFlag.carrierId = null;
          enemyFlag.x = enemyFlag.baseX;
          enemyFlag.y = enemyFlag.baseY;
          enemyFlag.atBase = true;
          enemyFlag.droppedAt = 0;
          sim.eventQueue.push({
            type: 'ctf_flag_captured',
            peerId: pid,
            team: myTeam, // vilket lag scorade
            captures: { red: sim.ctfCaptures.red, blue: sim.ctfCaptures.blue },
          });
          // Match-end check
          if (sim.ctfCaptures[myTeam] >= sim.ctfTargetCaptures) {
            sim.ctfEnded = true;
            const stats = {
              red: sim.ctfCaptures.red,
              blue: sim.ctfCaptures.blue,
              perPlayer: {},
            };
            for (const [p, ws2] of sim.room.members) {
              stats.perPlayer[p] = {
                team: ws2.tdmTeam,
                captures: sim.ctfCapturesByPid[p] || 0,
                kills: sim.ctfKillsByPid[p] || 0,
                deaths: sim.tdmDeathsByPid[p] || 0,
              };
            }
            sim.eventQueue.push({
              type: 'ctf_match_end',
              winner: myTeam,
              captures: { red: sim.ctfCaptures.red, blue: sim.ctfCaptures.blue },
              stats,
            });
          }
        }
      }
    }

    // 3. Return own-flagga: hold-to-return (1s standing within radius) så defender
    //    inte råkar returnera av misstag när hen jagar fienden förbi den.
    const myFlag = sim.ctfFlags[myTeam];
    if (!myFlag.atBase && !myFlag.carrierId) {
      const dx = px - myFlag.x, dy = py - myFlag.y;
      const inRange = dx * dx + dy * dy < CTF_ARENA.pickupRadius * CTF_ARENA.pickupRadius;
      if (inRange) {
        const wasStarted = (ws._returnHoldT || 0) > 0;
        ws._returnHoldT = (ws._returnHoldT || 0) + dt;
        // Emit "started" event endast vid start (klient renderar progress-ring)
        if (!wasStarted) {
          sim.eventQueue.push({ type: 'ctf_return_started', peerId: pid, team: myTeam, durationMs: 1000 });
        }
        if (ws._returnHoldT >= 1.0) {
          ws._returnHoldT = 0;
          myFlag.x = myFlag.baseX;
          myFlag.y = myFlag.baseY;
          myFlag.atBase = true;
          myFlag.droppedAt = 0;
          sim.eventQueue.push({ type: 'ctf_flag_returned', team: myTeam, peerId: pid, reason: 'manual' });
        }
      } else if (ws._returnHoldT) {
        ws._returnHoldT = 0;
        sim.eventQueue.push({ type: 'ctf_return_cancelled', peerId: pid, team: myTeam });
      }
    } else if (ws._returnHoldT) {
      // Flaggan kom hem på annat sätt (auto-return, carrier-pickup) — rensa state
      ws._returnHoldT = 0;
    }
  }

  // Turret occupant position-lock: håll spelaren fast vid turret-pos
  if (sim.ctfTurrets) {
    for (const tid of Object.keys(sim.ctfTurrets)) {
      const t = sim.ctfTurrets[tid];
      if (t.destroyed) continue;
      if (t.occupantId) {
        const ws = sim.room.members.get(t.occupantId);
        if (!ws || !ws.playerState || ws.playerState.hp <= 0) {
          // Occupant disconnected/dog — släpp turret
          exitTurret(sim, tid, 'occupant_lost');
        } else {
          ws.playerState.x = t.x;
          ws.playerState.y = t.y;
        }
      }
    }
  }

  // Bullet-physics (kolla wall-hits via bullets.js: vi behöver toggla flagga
  // för wall-check inom updateBullets, så markeras via sim.ctfActive)
  updateBullets(sim, dt, now);

  // Centraliserad death-detection: explosions, hostile-bullets eller framtida
  // damage-källor som dödar en CTF-spelare måste få respawn + flag-drop. Bullets.js
  // sätter dem redan för direkt player-bullets, så vi fyller luckorna.
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = Date.now() + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'ctf_player_died', victim: pid, durationMs: 3000 });
      applyCtfDeath(sim, pid); // droppar flaggan om han bar någon + emit ctf_flag_dropped
    }
  }
}

// ============================================================
// PvP-pickups — HP- och shield-regen-pickups på TDM- och CTF-arenor
// ============================================================
// Symmetrisk placering: 4 HP + 4 shield per arena. Respawn 15s efter collect.
// PICKUP_HEAL = +40 (delvis återställning så spelare måste samla flera).
const PICKUP_RESPAWN_MS = 15000;
const PICKUP_HEAL = 40;
const PICKUP_RADIUS = 28;

function nextPickupId(sim) {
  sim._pickupIdCounter = (sim._pickupIdCounter || 0) + 1;
  return 'pu_' + sim._pickupIdCounter;
}

function buildCtfPickups(sim) {
  // 4500×2800 arena, symmetrisk runt x=2250.
  // HP-pickups i flank-positioner (mellan baser och mitten).
  // Shield-pickups i mid-zon (riskabla att hämta — kontakt med fiender).
  return [
    // HP: 4 flanker
    { id: nextPickupId(sim), x: 1300, y: 700,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 700,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1300, y: 2100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 2100, type: 'hp',     available: true, respawnAt: 0 },
    // Shield: 4 mid-zon (mer kontestbara)
    { id: nextPickupId(sim), x: 2250, y: 350,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 2450, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1900, y: 1400, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2600, y: 1400, type: 'shield', available: true, respawnAt: 0 },
  ];
}

function buildTdmPickups(sim, arena) {
  // 4000×3000 öppen arena. Symmetrisk runt center x=2000, y=1500.
  return [
    { id: nextPickupId(sim), x: 1200, y: 1000, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2800, y: 1000, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1200, y: 2000, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2800, y: 2000, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2000, y: 600,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2000, y: 2400, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1600, y: 1500, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2400, y: 1500, type: 'shield', available: true, respawnAt: 0 },
  ];
}

// Tickas från CTF + TDM: respawn timer + collision-detection mot spelare.
// Emiterar pvp_pickup_collected (med uppdaterad hp/shield) + pvp_pickup_spawned.
function tickPvpPickups(sim, now) {
  if (!sim.pvpPickups) return;
  for (const pu of sim.pvpPickups) {
    // Respawn
    if (!pu.available && now >= pu.respawnAt) {
      pu.available = true;
      sim.eventQueue.push({ type: 'pvp_pickup_spawned', id: pu.id, x: pu.x, y: pu.y, ptype: pu.type });
    }
    if (!pu.available) continue;
    // Collect: kolla alla levande spelare
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - pu.x, dy = ws.playerState.y - pu.y;
      if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue;
      // Heal
      const maxHp = 100;
      const maxShield = ws.playerState.maxShield || 100;
      if (pu.type === 'hp') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(maxHp, before + PICKUP_HEAL);
        if (ws.playerState.hp === before) continue; // redan full HP — skip pickup
      } else { // 'shield'
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(maxShield, before + PICKUP_HEAL);
        if (ws.playerState.shield === before) continue; // redan full shield
      }
      pu.available = false;
      pu.respawnAt = now + PICKUP_RESPAWN_MS;
      sim.eventQueue.push({
        type: 'pvp_pickup_collected',
        id: pu.id,
        peerId: pid,
        ptype: pu.type,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
        respawnAt: pu.respawnAt,
      });
      break; // pickup borta — gå till nästa
    }
  }
}

// ============================================================
// CTF-turrets — enter/exit + damage-routing
// ============================================================
const TURRET_ENTER_RADIUS = 50;

function tryEnterTurret(sim, peerId, turretId) {
  // Diagnostisk logging för att hitta varför enter ibland inte funkar
  const fail = (reason) => {
    console.log('[TURRET-ENTER-FAIL]', sim.room && sim.room.code, peerId, 'turret=' + turretId, 'reason=' + reason);
    return false;
  };
  if (!sim.ctfActive) return fail('not_ctf_active');
  const t = sim.ctfTurrets && sim.ctfTurrets[turretId];
  if (!t) return fail('turret_not_found_' + turretId);
  if (t.destroyed) return fail('destroyed');
  if (t.occupantId) return fail('occupied_by_' + t.occupantId);
  const ws = sim.room.members.get(peerId);
  if (!ws) return fail('ws_missing');
  if (!ws.playerState) return fail('no_player_state');
  if (ws.playerState.hp <= 0) return fail('dead');
  // Lag-check: turret måste matcha spelarens team
  if (ws.tdmTeam !== t.team) return fail('wrong_team_' + ws.tdmTeam + '_vs_' + t.team);
  // Avstånds-check — använd en generös radie så enter inte misslyckas pga lag-jitter
  const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
  const d2 = dx * dx + dy * dy;
  const maxR = (CTF_ARENA.turretEnterRadius || 50) + 20; // +20px tolerance
  if (d2 > maxR * maxR) return fail('too_far_' + Math.round(Math.sqrt(d2)) + 'px');
  t.occupantId = peerId;
  ws._mountedCtfTurretId = turretId;
  // Lås spelare till turret-position
  ws.playerState.x = t.x;
  ws.playerState.y = t.y;
  console.log('[TURRET-ENTER-OK]', sim.room && sim.room.code, peerId, '→', turretId);
  sim.eventQueue.push({ type: 'ctf_turret_entered', peerId, turretId });
  return true;
}

function exitTurret(sim, turretId, reason) {
  const t = sim.ctfTurrets && sim.ctfTurrets[turretId];
  if (!t) return;
  const peerId = t.occupantId;
  t.occupantId = null;
  if (peerId) {
    const ws = sim.room.members.get(peerId);
    if (ws) {
      ws._mountedCtfTurretId = null;
      // Knuffa spelaren ~30px utåt så de inte direkt re-enterar
      if (ws.playerState) {
        const dir = t.team === 'red' ? 1 : -1; // röd står mer höger om sin turret
        ws.playerState.x = t.x + dir * 35;
        ws.playerState.y = t.y;
      }
    }
  }
  sim.eventQueue.push({ type: 'ctf_turret_exited', peerId, turretId, reason: reason || 'manual' });
}

// SIEGE-turret enter — mirror av CTF men för sim.siegeTurrets + använder turret.weaponId
function tryEnterSiegeTurret(sim, peerId, turretId) {
  const fail = (reason) => {
    console.log('[SIEGE-TURRET-ENTER-FAIL]', sim.room && sim.room.code, peerId, 'turret=' + turretId, 'reason=' + reason);
    return false;
  };
  if (!sim.siegeActive) return fail('not_siege_active');
  const t = sim.siegeTurrets && sim.siegeTurrets[turretId];
  if (!t) return fail('turret_not_found_' + turretId);
  if (t.destroyed) return fail('destroyed');
  if (t.occupantId) return fail('occupied_by_' + t.occupantId);
  const ws = sim.room.members.get(peerId);
  if (!ws) return fail('ws_missing');
  if (!ws.playerState) return fail('no_player_state');
  if (ws.playerState.hp <= 0) return fail('dead');
  if (ws.tdmTeam !== t.team) return fail('wrong_team_' + ws.tdmTeam + '_vs_' + t.team);
  const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
  const d2 = dx * dx + dy * dy;
  const maxR = (SIEGE_ARENA.turretEnterRadius || 50) + 20;
  if (d2 > maxR * maxR) return fail('too_far_' + Math.round(Math.sqrt(d2)) + 'px');
  t.occupantId = peerId;
  ws._mountedSiegeTurretId = turretId;
  ws.playerState.x = t.x;
  ws.playerState.y = t.y;
  console.log('[SIEGE-TURRET-ENTER-OK]', sim.room && sim.room.code, peerId, '→', turretId, '(' + t.turretType + ')');
  sim.eventQueue.push({
    type: 'siege_turret_entered',
    peerId, turretId,
    weaponId: t.weaponId || 'turret_mg',
    turretType: t.turretType || 'mg',
  });
  return true;
}

function exitSiegeTurret(sim, turretId, reason) {
  const t = sim.siegeTurrets && sim.siegeTurrets[turretId];
  if (!t) return;
  const peerId = t.occupantId;
  t.occupantId = null;
  if (peerId) {
    const ws = sim.room.members.get(peerId);
    if (ws) {
      ws._mountedSiegeTurretId = null;
      if (ws.playerState) {
        const dir = t.team === 'red' ? 1 : -1;
        ws.playerState.x = t.x + dir * 35;
        ws.playerState.y = t.y;
      }
    }
  }
  sim.eventQueue.push({ type: 'siege_turret_exited', peerId, turretId, reason: reason || 'manual' });
}

// Hantera spelare-död under CTF: droppa flagga vid death-position
function applyCtfDeath(sim, peerId) {
  if (!sim.ctfActive) return;
  for (const team of ['red', 'blue']) {
    const flag = sim.ctfFlags[team];
    if (flag.carrierId === peerId) {
      const ws = sim.room.members.get(peerId);
      const dx = ws && ws.playerState ? ws.playerState.x : flag.baseX;
      const dy = ws && ws.playerState ? ws.playerState.y : flag.baseY;
      flag.carrierId = null;
      flag.atBase = false;
      flag.x = dx;
      flag.y = dy;
      flag.droppedAt = Date.now();
      sim.eventQueue.push({
        type: 'ctf_flag_dropped',
        team,
        x: dx, y: dy,
        droppedBy: peerId,
      });
    }
  }
}

// ============================================================
// SIEGE THE BASE — capture-bases + core-damage + scoring
// ============================================================
function tickSiege(sim, dt, now) {
  const nowMs = Date.now();

  // Respawn döda spelare på random egna spawn-point
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const team = ws.tdmTeam || 'red';
        const pts = SIEGE_ARENA.spawns[team] || SIEGE_ARENA.spawns.red;
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = 100;
        ws.playerState.shield = ws.playerState.maxShield || 100;
        ws.playerState.invulnUntil = Date.now() + 1500;
        sim.eventQueue.push({
          type: 'siege_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
        });
      }
    }
  }

  // Pickups respawn + collect
  if (!sim.siegeEnded) tickPvpPickups(sim, now);

  // Match-end? Skip game-logic
  if (sim.siegeEnded) return;

  // Wall-collision för spelare + turret-collision (turrets är cirklar, push out)
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      // Hoppa över wall/turret-collision om spelaren sitter i sin turret
      if (ws._mountedSiegeTurretId) continue;
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, SIEGE_ARENA.walls);
      // Turret-collision: push player out om de överlappar med turret-radius
      if (sim.siegeTurrets) {
        for (const tid of Object.keys(sim.siegeTurrets)) {
          const t = sim.siegeTurrets[tid];
          const dx = e.x - t.x, dy = e.y - t.y;
          const rsum = t.r + e.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < rsum * rsum && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (rsum - d) / d;
            e.x += dx * push;
            e.y += dy * push;
          }
        }
      }
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }

  // Turret-occupant lock (BÅDE ctf och siege)
  if (sim.siegeTurrets) {
    for (const tid of Object.keys(sim.siegeTurrets)) {
      const t = sim.siegeTurrets[tid];
      if (t.destroyed) continue;
      if (t.occupantId) {
        const ws = sim.room.members.get(t.occupantId);
        if (!ws || !ws.playerState || ws.playerState.hp <= 0) {
          // Auto-eject
          exitSiegeTurret(sim, tid, 'occupant_lost');
        } else {
          ws.playerState.x = t.x;
          ws.playerState.y = t.y;
        }
      }
    }
  }

  // Capture-base-logik med 2-fas: NEUTRALIZE (5s om enemy äger) + CAPTURE (10s).
  // base.phase: null (neutral, fri att capturera) eller 'neutralize' (måste först
  // göra basen neutral) eller 'capture' (capturerar mot neutral base).
  const CAPTURE_TIME = SIEGE_ARENA.captureTimeSec || 10.0;
  const NEUTRALIZE_TIME = SIEGE_ARENA.neutralizeTimeSec || 5.0;
  for (const baseId of Object.keys(sim.siegeBases)) {
    const base = sim.siegeBases[baseId];
    let redOn = 0, blueOn = 0;
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - base.x, dy = ws.playerState.y - base.y;
      if (dx * dx + dy * dy <= base.r * base.r) {
        if (ws.tdmTeam === 'red') redOn++;
        else if (ws.tdmTeam === 'blue') blueOn++;
      }
    }
    const contested = redOn > 0 && blueOn > 0;
    const onlyRed = redOn > 0 && blueOn === 0;
    const onlyBlue = blueOn > 0 && redOn === 0;
    // Spara count för broadcast (klient visar "2 vs 1 contested")
    base.redOn = redOn;
    base.blueOn = blueOn;
    if (contested) {
      // Pausa progress (first-occupant-protection)
    } else if (onlyRed) {
      if (base.owner === 'red') {
        // Egen bas, reset eventuell progress
        base.captureProgress = 0;
        base.captureSide = null;
        base.phase = null;
      } else if (base.owner === 'blue') {
        // FAS 1: Neutralisera blå-basen först (5s)
        if (base.captureSide !== 'red' || base.phase !== 'neutralize') {
          base.captureProgress = 0;
          base.captureSide = 'red';
          base.phase = 'neutralize';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / NEUTRALIZE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = null;
          base.captureProgress = 0;
          base.phase = 'capture'; // direkt in i capture-fasen
          sim.eventQueue.push({ type: 'siege_base_neutralized', baseId, by: 'red' });
        }
      } else {
        // FAS 2 (eller direkt om neutral): Capturera neutral (10s)
        if (base.captureSide !== 'red' || base.phase !== 'capture') {
          base.captureProgress = 0;
          base.captureSide = 'red';
          base.phase = 'capture';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / CAPTURE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = 'red';
          base.captureProgress = 0;
          base.captureSide = null;
          base.phase = null;
          sim.eventQueue.push({ type: 'siege_base_captured', baseId, team: 'red' });
        }
      }
    } else if (onlyBlue) {
      if (base.owner === 'blue') {
        base.captureProgress = 0;
        base.captureSide = null;
        base.phase = null;
      } else if (base.owner === 'red') {
        if (base.captureSide !== 'blue' || base.phase !== 'neutralize') {
          base.captureProgress = 0;
          base.captureSide = 'blue';
          base.phase = 'neutralize';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / NEUTRALIZE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = null;
          base.captureProgress = 0;
          base.phase = 'capture';
          sim.eventQueue.push({ type: 'siege_base_neutralized', baseId, by: 'blue' });
        }
      } else {
        if (base.captureSide !== 'blue' || base.phase !== 'capture') {
          base.captureProgress = 0;
          base.captureSide = 'blue';
          base.phase = 'capture';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / CAPTURE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = 'blue';
          base.captureProgress = 0;
          base.captureSide = null;
          base.phase = null;
          sim.eventQueue.push({ type: 'siege_base_captured', baseId, team: 'blue' });
        }
      }
    } else {
      // Ingen på basen — decay progress (50% rate)
      if (base.captureProgress > 0) {
        const decayTime = base.phase === 'neutralize' ? NEUTRALIZE_TIME : CAPTURE_TIME;
        base.captureProgress = Math.max(0, base.captureProgress - dt / decayTime * 0.5);
        if (base.captureProgress === 0) {
          base.captureSide = null;
          base.phase = null;
        }
      }
    }
  }

  // Broadcasta capture-progress till klienten ungefär 5Hz (var 9 tick @ 45Hz)
  sim._siegeProgressBroadcastTick = (sim._siegeProgressBroadcastTick || 0) + 1;
  if (sim._siegeProgressBroadcastTick >= 9) {
    sim._siegeProgressBroadcastTick = 0;
    const progress = {};
    for (const baseId of Object.keys(sim.siegeBases)) {
      const b = sim.siegeBases[baseId];
      if (b.captureProgress > 0 || b.owner !== null || b.redOn || b.blueOn) {
        progress[baseId] = {
          owner: b.owner,
          captureProgress: b.captureProgress,
          captureSide: b.captureSide,
          phase: b.phase,
          redOn: b.redOn || 0,
          blueOn: b.blueOn || 0,
        };
      }
    }
    sim.eventQueue.push({ type: 'siege_base_progress', bases: progress });
  }

  // Passive points: varje ägd bas ger 1 pt/sek till owning team
  for (const baseId of Object.keys(sim.siegeBases)) {
    const base = sim.siegeBases[baseId];
    if (base.owner === 'red')  sim._siegePointAccum.red  += dt;
    if (base.owner === 'blue') sim._siegePointAccum.blue += dt;
  }
  // Flush integer-poäng från accumulator
  let scoreChanged = false;
  for (const team of ['red', 'blue']) {
    while (sim._siegePointAccum[team] >= 1) {
      sim._siegePointAccum[team] -= 1;
      sim.siegeScores[team] += 1;
      scoreChanged = true;
    }
  }
  if (scoreChanged) {
    sim.eventQueue.push({ type: 'siege_score_update', red: sim.siegeScores.red, blue: sim.siegeScores.blue });
    // Vinst-check via poäng
    if (sim.siegeScores.red >= sim.siegeTargetPoints || sim.siegeScores.blue >= sim.siegeTargetPoints) {
      const winner = sim.siegeScores.red >= sim.siegeTargetPoints ? 'red' : 'blue';
      endSiegeMatch(sim, winner, 'points');
      return;
    }
  }

  // Bullets — uppdaterad efter resolveCtfWall så de inte träffar inuti walls
  updateBullets(sim, dt, now);

  // Centraliserad death-detection
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'siege_player_died', victim: pid, durationMs: 3000 });
    }
  }
}

function endSiegeMatch(sim, winner, reason) {
  if (sim.siegeEnded) return; // dubbel-fire-guard
  sim.siegeEnded = true;
  const stats = { red: sim.siegeScores.red, blue: sim.siegeScores.blue, perPlayer: {} };
  for (const [p, ws] of sim.room.members) {
    stats.perPlayer[p] = {
      team: ws.tdmTeam,
      kills: sim.siegeKillsByPid[p] || 0,
      deaths: sim.tdmDeathsByPid[p] || 0,
    };
  }
  sim.eventQueue.push({
    type: 'siege_match_end',
    winner, reason,
    scores: { red: sim.siegeScores.red, blue: sim.siegeScores.blue },
    stats,
  });
}

// === GUNGAME ===
// FFA mode: 15-tier vapen-progression. Varje kill promotar shooter +1 tier.
// Kill med melee-vapen → offret demoteras 1 tier (cap 0). Första som dödar
// någon på tier 15 (sledge) vinner. Inga teams — alla är fiender.
function tickGungame(sim, dt, now) {
  const nowMs = Date.now();

  // Respawn döda spelare på roterande spawn-point (anti-spawn-camp).
  // Försök upp till N spawn-punkter tills vi hittar en utan levande spelare
  // inom 120px — annars spawnar man rakt ovanpå en motståndare.
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = GUNGAME_ARENA.spawns;
        let sp = spawns[sim._gungameSpawnIdx % spawns.length];
        for (let tries = 0; tries < spawns.length; tries++) {
          const candidate = spawns[(sim._gungameSpawnIdx + tries) % spawns.length];
          let occupied = false;
          for (const [otherPid, otherWs] of sim.room.members) {
            if (otherPid === pid) continue;
            if (!otherWs.playerState || otherWs.playerState.hp <= 0) continue;
            const dx = otherWs.playerState.x - candidate.x;
            const dy = otherWs.playerState.y - candidate.y;
            if (dx * dx + dy * dy < 120 * 120) { occupied = true; break; }
          }
          if (!occupied) { sp = candidate; sim._gungameSpawnIdx += tries; break; }
        }
        sim._gungameSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = 100;
        ws.playerState.shield = ws.playerState.maxShield || 100;
        ws.playerState.invulnUntil = nowMs + 1500;
        // Sätt vapen till current tier (kan ha demoterats)
        const tier = sim.gungameTiers[pid] || 0;
        ws.playerState.weaponId = GUNGAME_WEAPONS[tier];
        // Rensa bot-state vid respawn (annars siktar bot på en stale target-ref
        // som kan vara död/disconnected)
        if (ws._bot) {
          ws._bot.target = null;
          ws._bot.lastShotAt = 0;
          ws._bot.stuckSince = 0;
        }
        sim.eventQueue.push({
          type: 'gungame_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
          tier, weaponId: GUNGAME_WEAPONS[tier],
        });
      }
    }
  }

  // Pickups (HP/ammo) tickas också för gungame
  if (!sim.gungameEnded) tickPvpPickups(sim, now);

  // Match-end? Skip game-logic
  if (sim.gungameEnded) return;

  // Wall-collision för spelare
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, GUNGAME_ARENA.walls);
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }

  // Bullets uppdateras efter wall-collision
  updateBullets(sim, dt, now);

  // Death-detection + promote/demote-logik. Kill-attribution måste komma från
  // bullets.js som sätter sim._gungameLastKill { victim, killer, weaponId } per dödsfall.
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid = sim.tdmDeathsByPid || {};
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'gungame_player_died', victim: pid, durationMs: 3000 });
    }
  }
}

function endGungameMatch(sim, winnerId, reason) {
  if (sim.gungameEnded) return;
  sim.gungameEnded = true;
  sim.gungameWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p] of sim.room.members) {
    stats.perPlayer[p] = {
      kills: sim.gungameKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
      tier: sim.gungameTiers[p] || 0,
    };
  }
  sim.eventQueue.push({
    type: 'gungame_match_end',
    winner: winnerId, reason, stats,
  });
}

function broadcastWorld(sim, now) {
  const fullBroadcast = (now - sim.lastFullAt) > FULL_BROADCAST_MS;
  if (fullBroadcast) sim.lastFullAt = now;

  // Bygg player-array — companions inkluderas i sim's enemy-AI-targeting men FÅR INTE
  // skickas som spelare till klient (deras position renderas separat via companion-state).
  // BUG-FIX: tidigare läckte companions in i klient's player-rendering → host-companion
  // mappades till partner-slot → "kompis-gubbe följer dig hela tiden".
  const players = buildPlayerList(sim);
  const realPlayers = players.filter(p => !p._isCompanion);
  const allPlayers = realPlayers.map((p, i) => ({
    c: i,
    x: Math.round(p.x), y: Math.round(p.y),
    hp: Math.round(p.hp),
    a: 0, w: 'fists', rT: 0,
  }));

  // Drain event-queue. Batch ALLA events i ett enda 'sim_events'-meddelande per
  // peer per tick — sparar 1 JSON.stringify + 1 ws.send per event per client.
  // Skipsa helt om inga events. Klienten hanterar bakåtkompat genom att stödja
  // både 'sim_event' (en) och 'sim_events' (lista).
  // Bugfix: dräna BARA om vi faktiskt har subscribers (annars förlorades
  // ctf_match_end om sista spelaren disconnectade samma tick).
  if (sim.eventQueue.length > 0 && sim.room.members.size > 0) {
    const events = sim.eventQueue.splice(0);
    const json = JSON.stringify({ type: 'sim_events', events });
    for (const [, ws] of sim.room.members) {
      if (ws.readyState === 1) try { ws.send(json); } catch (e) {}
    }
  }

  for (const [peerId, ws] of sim.room.members) {
    let lastSent = sim.lastSentEnemyByPeer.get(peerId);
    let forceFullForPeer = !lastSent || fullBroadcast;
    if (!lastSent) lastSent = {};
    // Pre-scan: om någon synlig enemy är NY för peeren, forcera full-paket så vi får med
    // bossKey/isBoss/color/name. Annars syns bossen som "bara skugga" tills nästa full-broadcast.
    if (!forceFullForPeer) {
      for (const e of sim.enemies) {
        if (e.dead) continue;
        if (!lastSent[e._idx]) { forceFullForPeer = true; break; }
      }
    }
    const newSent = {};
    const enemiesPkt = [];
    const px = (ws.playerState && ws.playerState.x) || 1000;
    const py = (ws.playerState && ws.playerState.y) || 1000;
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const visible = e.isBoss || e.isMiniBoss ||
                      (Math.abs(e.x - px) < CULL_DIST && Math.abs(e.y - py) < CULL_DIST);
      if (!visible) continue;
      const ex = Math.round(e.x), ey = Math.round(e.y), eh = Math.round(e.hp);
      newSent[e._idx] = { x: ex, y: ey, hp: eh };
      const last = lastSent[e._idx];
      if (!forceFullForPeer && last && last.x === ex && last.y === ey && last.hp === eh) continue;
      if (forceFullForPeer) {
        enemiesPkt.push({
          i: e._idx, x: ex, y: ey, hp: eh, mh: e.maxHp,
          t: e.type, b: e.isBoss ? 1 : 0, mb: e.isMiniBoss ? 1 : 0,
          bk: e.bossKey || '', r: e.r, c: e.color, n: e.name || '', p: e.phase || 0,
        });
      } else {
        enemiesPkt.push({ i: e._idx, x: ex, y: ey, hp: eh });
      }
    }
    sim.lastSentEnemyByPeer.set(peerId, newSent);

    // Hostile bullets only (player-bullets renderas lokalt på klient via Coop.broadcastShots)
    const hb = [];
    for (const b of sim.bullets) {
      if (!b.hostile) continue;
      if (Math.abs(b.x - px) < 800 && Math.abs(b.y - py) < 800) {
        hb.push({
          x: Math.round(b.x), y: Math.round(b.y),
          vx: Math.round(b.vx), vy: Math.round(b.vy),
          c: b.color, r: b.r,
        });
      }
    }

    const seq = ((sim.seqByPeer.get(peerId) || 0) + 1) & 0xFFFF;
    sim.seqByPeer.set(peerId, seq);

    const pkt = {
      players: allPlayers,
      enemies: enemiesPkt,
      hb,
      full: forceFullForPeer ? 1 : 0,
      seq,
    };
    if (fullBroadcast) {
      pkt.gs = {
        w: sim.wave,
        cz: sim.currentZone,        // BUG-FIX: cz = current zone INDEX (0/1/etc), inte stage.kind. Klient räknar `cz + 1` aritmetiskt.
        zs: sim.zoneState,
        bss: sim.bossSequenceStep,
        bd: sim.bossDefeated ? 1 : 0,
      };
    }
    // Dead body — prioritera egen kropp (om dead), annars första partners. Klient renderar
    // kroppen + revive-timern. Multi-body stöd: bara en sänds via wireformat (begränsning).
    if (sim.deadBodies) {
      let bodyToSend = sim.deadBodies[peerId];  // egen kropp först
      if (!bodyToSend) {
        for (const otherPid in sim.deadBodies) {
          bodyToSend = sim.deadBodies[otherPid];
          break;
        }
      }
      if (bodyToSend) {
        pkt.db = {
          x: bodyToSend.x,
          y: bodyToSend.y,
          reviveTimer: bodyToSend.reviveTimer || 0,
          revivedBy: bodyToSend.revivedBy || null,
          color: '#222',
        };
      }
    }
    // Pickups: skickas i full broadcast eller om något ändrats
    if (sim.pickups && sim.pickups.length > 0) {
      pkt.pickups = sim.pickups.map(p => ({
        x: Math.round(p.x), y: Math.round(p.y), t: p.type,
      }));
    } else if (fullBroadcast) {
      pkt.pickups = [];
    }
    const payload = encodeWorldBinary(pkt);
    if (ws && ws.readyState === 1) {
      // Backpressure-guard: om klient inte hänger med (buffer fullt), skippa
      // denna tick. Klient re-syncs vid nästa full-broadcast (var 1500ms).
      // Tröskel 32KB är generös; klient adaptiv-rate kicked in vid 15KB.
      if (ws.bufferedAmount > 32768) continue;
      const out = Buffer.alloc(1 + payload.length);
      out[0] = 0;
      payload.copy(out, 1);
      try { ws.send(out, { binary: true }); } catch (e) {}
    }
  }

  // Cleanup peers som lämnat — både enemy-delta-cache OCH seq-tracker (annars
  // växer seqByPeer obegränsat över sessionens livstid).
  if (sim.lastSentEnemyByPeer.size > sim.room.members.size) {
    for (const peerId of [...sim.lastSentEnemyByPeer.keys()]) {
      if (!sim.room.members.has(peerId)) {
        sim.lastSentEnemyByPeer.delete(peerId);
        sim.seqByPeer.delete(peerId);
      }
    }
  }
}

function startSim(sim, opts) {
  if (sim.interval) return;
  // Bugfix: nollställ ALLA PvP-flags vid varje startSim. Annars läckte
  // tdmActive/ctfActive från föregående match in i nästa (rematch / mode-byte
  // i samma rum) och triggade fel logik-gren.
  sim.tdmActive = false;
  sim.ctfActive = false;
  sim.siegeActive = false;
  sim.gungameActive = false;
  sim.tdmEnded = false;
  sim.ctfEnded = false;
  sim.siegeEnded = false;
  sim.gungameEnded = false;
  sim.gungameWinner = null;
  sim.tdmKills = { red: 0, blue: 0 };
  sim.ctfCaptures = { red: 0, blue: 0 };
  sim.siegeScores = { red: 0, blue: 0 };
  sim.tdmKillsByPid = {};
  sim.tdmDeathsByPid = {};
  sim.ctfKillsByPid = {};
  sim.ctfCapturesByPid = {};
  sim.siegeKillsByPid = {};
  sim.gungameTiers = {};
  sim.gungameKillsByPid = {};
  sim._gungameSpawnIdx = 0;
  sim._siegePointAccum = { red: 0, blue: 0 };
  sim.pvpPickups = null;
  sim.bullets = [];
  sim.enemies = [];
  sim.eventQueue.length = 0;
  if (opts) {
    if (opts.difficulty) sim.config.difficulty = opts.difficulty;
    if (opts.ngpLevel) sim.config.ngpLevel = opts.ngpLevel;
    if (opts.mode) sim.config.mode = opts.mode;
    if (opts.wave) sim.wave = opts.wave;
    if (opts.tdm) {
      sim.tdmActive = true;
      sim.tdmTargetKills = opts.tdmTargetKills || 10;
    }
    if (opts.ctf) {
      sim.ctfActive = true;
      sim.ctfTargetCaptures = opts.ctfTargetCaptures || 3;
    }
    if (opts.siege) {
      sim.siegeActive = true;
      sim.siegeTargetPoints = opts.siegeTargetPoints || 500;
    }
    if (opts.gungame) {
      sim.gungameActive = true;
    }
  }
  // Bot-spawn: lägg bot som virtuell member INNAN mode-init så loopen tilldelar
  // den team + spawn-pos precis som riktiga spelare. Pre-set team respekteras
  // av mode-init-loopen via ws._isBot-check.
  if (opts && opts.addBot) {
    const inTeamMode = sim.tdmActive || sim.ctfActive || sim.siegeActive;
    const botTeam = inTeamMode ? (opts.botTeam === 'blue' ? 'blue' : 'red') : null;
    addBot(sim, botTeam);
  }
  console.log('[SIM]', sim.room.code, 'started mode=' + (sim.ctfActive ? 'ctf' : (sim.tdmActive ? 'tdm' : sim.config.mode)) + ' diff=' + sim.config.difficulty + (opts && opts.addBot ? ' +bot' : ''));
  if (sim.ctfActive) {
    // CTF: dedikerad arena (4500×2800 med walls). Symmetrisk röd/blå.
    sim.simReadyAt = Date.now() + 5000;
    // Init flag-state från CTF_ARENA
    for (const team of ['red', 'blue']) {
      const fs = CTF_ARENA.flags[team];
      sim.ctfFlags[team] = {
        baseX: fs.baseX, baseY: fs.baseY,
        x: fs.baseX, y: fs.baseY,
        carrierId: null, atBase: true, droppedAt: 0,
      };
    }
    // Init turret-state per lag (full hp, ingen occupant, ej destroyed)
    sim.ctfTurrets = {};
    for (const t of CTF_ARENA.turrets) {
      sim.ctfTurrets[t.id] = {
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r,
        hp: t.maxHp, maxHp: t.maxHp,
        occupantId: null, destroyed: false, destroyedAt: 0,
        lastShotAt: 0, aim: 0,
      };
    }
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      // Bot:s tdmTeam är pre-satt av addBot — respektera. Andra spelare alternerar.
      const team = (ws._isBot && ws.tdmTeam) ? ws.tdmTeam : (i % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      ws.playerState = ws.playerState || {};
      // Spawn på random egna spawn-point (slumpa per spelare så 8-mannarum
      // inte staplar players ovanpå varandra på samma pixel).
      const pts = CTF_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.ctfKillsByPid[pid] = 0;
      sim.ctfCapturesByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    // PvP-pickups på CTF-arenan — symmetrisk 4 HP + 4 shield, respawn 15s
    sim.pvpPickups = buildCtfPickups(sim);
    sim.eventQueue.push({
      type: 'ctf_started',
      targetCaptures: sim.ctfTargetCaptures,
      teams,
      arena: { worldW: CTF_ARENA.worldW, worldH: CTF_ARENA.worldH, name: CTF_ARENA.name },
      flags: {
        red:  { baseX: CTF_ARENA.flags.red.baseX,  baseY: CTF_ARENA.flags.red.baseY  },
        blue: { baseX: CTF_ARENA.flags.blue.baseX, baseY: CTF_ARENA.flags.blue.baseY },
      },
      spawns: CTF_ARENA.spawns,
      walls: CTF_ARENA.walls,
      pickupRadius: CTF_ARENA.pickupRadius,
      captureRadius: CTF_ARENA.captureRadius,
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
      turrets: Object.values(sim.ctfTurrets).map(t => ({
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r, maxHp: t.maxHp, hp: t.hp,
      })),
      turretEnterRadius: CTF_ARENA.turretEnterRadius,
      decorations: CTF_ARENA.decorations || [],
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
  } else if (sim.tdmActive) {
    // PvP-mode: dedikerad TDM-arena (4000×3000 öppet fält). Inget enemy-spawn,
    // ingen wave-progression. Lagen spawnar på motsatta sidor.
    sim.simReadyAt = Date.now() + 5000;
    sim.tdmArena = { worldW: 4000, worldH: 3000, name: 'ARENA' };
    const arena = sim.tdmArena;
    const redSpawnX = Math.floor(arena.worldW * 0.10);   // x=400
    const blueSpawnX = Math.floor(arena.worldW * 0.90);  // x=3600
    const spawnY = Math.floor(arena.worldH * 0.50);      // y=1500
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      // Bot:s tdmTeam är pre-satt av addBot — respektera. Andra alternerar.
      const team = (ws._isBot && ws.tdmTeam) ? ws.tdmTeam : (i % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      ws.playerState = ws.playerState || {};
      ws.playerState.x = team === 'red' ? redSpawnX : blueSpawnX;
      ws.playerState.y = spawnY;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.tdmKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    // PvP-pickups på arenan — symmetrisk 4 HP + 4 shield, respawn 15s
    sim.pvpPickups = buildTdmPickups(sim, arena);
    // Skicka arena-info + walls (TDM har nu cover så sniper inte one-shots edge-to-edge)
    sim.eventQueue.push({
      type: 'tdm_started',
      targetKills: sim.tdmTargetKills,
      teams,
      arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
      walls: TDM_ARENA.walls,
      spawns: { red: { x: redSpawnX, y: spawnY }, blue: { x: blueSpawnX, y: spawnY } },
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
  } else if (sim.siegeActive) {
    // SIEGE THE BASE: 5000×3000 arena med 2 cores + 6 capture-bases.
    sim.simReadyAt = Date.now() + 5000;
    // Init cores
    sim.siegeCores = {};
    for (const c of SIEGE_ARENA.cores) {
      sim.siegeCores[c.id] = {
        id: c.id, team: c.team, x: c.x, y: c.y, w: c.w, h: c.h,
        hp: c.maxHp, maxHp: c.maxHp, destroyed: false,
      };
    }
    // Init bases — ALLA startar NEUTRALA (grå)
    sim.siegeBases = {};
    for (const b of SIEGE_ARENA.bases) {
      sim.siegeBases[b.id] = {
        id: b.id, x: b.x, y: b.y, r: b.r,
        owner: null,                // alla starts neutral
        captureProgress: 0,         // 0..1
        captureSide: null,          // 'red' / 'blue' / null
        phase: null,                // 'neutralize' / 'capture' / null
      };
    }
    // Init turrets — bevara weaponId + turretType per torn
    sim.siegeTurrets = {};
    for (const t of SIEGE_ARENA.turrets) {
      sim.siegeTurrets[t.id] = {
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r,
        hp: t.maxHp, maxHp: t.maxHp,
        occupantId: null, destroyed: false, destroyedAt: 0,
        weaponId: t.weaponId || 'turret_mg',
        turretType: t.turretType || 'mg',
      };
    }
    // Team-tilldelning + spawn
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      // Bot:s tdmTeam är pre-satt av addBot — respektera. Andra alternerar.
      const team = (ws._isBot && ws.tdmTeam) ? ws.tdmTeam : (i % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      ws.playerState = ws.playerState || {};
      const pts = SIEGE_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.siegeKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    sim.pvpPickups = buildSiegePickups(sim);
    sim.eventQueue.push({
      type: 'siege_started',
      targetPoints: sim.siegeTargetPoints,
      teams,
      arena: { worldW: SIEGE_ARENA.worldW, worldH: SIEGE_ARENA.worldH, name: SIEGE_ARENA.name },
      spawns: SIEGE_ARENA.spawns,
      walls: SIEGE_ARENA.walls,
      cores: Object.values(sim.siegeCores).map(c => ({ id: c.id, team: c.team, x: c.x, y: c.y, w: c.w, h: c.h, maxHp: c.maxHp, hp: c.hp })),
      bases: Object.values(sim.siegeBases).map(b => ({ id: b.id, x: b.x, y: b.y, r: b.r, owner: b.owner })),
      turrets: Object.values(sim.siegeTurrets).map(t => ({
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r, maxHp: t.maxHp, hp: t.hp,
        weaponId: t.weaponId, turretType: t.turretType,
      })),
      turretEnterRadius: SIEGE_ARENA.turretEnterRadius,
      captureTimeSec: SIEGE_ARENA.captureTimeSec,
      neutralizeTimeSec: SIEGE_ARENA.neutralizeTimeSec,
      decorations: SIEGE_ARENA.decorations || [],
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    // Bullets.js behöver kunna kalla endSiegeMatch när core förstörs.
    // Eftersom funktionen är local i denna fil exponerar vi via sim-objektet.
    sim._endSiegeMatch = endSiegeMatch;
  } else if (sim.gungameActive) {
    // GUNGAME: FFA på 3500×2000 close-quarters arena, 15-tier progression
    sim.simReadyAt = Date.now() + 5000;
    // Init alla spelare på tier 0 (fists), roterande spawn-point
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = GUNGAME_ARENA.spawns[i % GUNGAME_ARENA.spawns.length];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.playerState.weaponId = GUNGAME_WEAPONS[0]; // fists
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA - inget team
      sim.gungameTiers[pid] = 0;
      sim.gungameKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    sim._gungameSpawnIdx = i; // fortsätt rotera vid respawn
    sim.eventQueue.push({
      type: 'gungame_started',
      arena: { worldW: GUNGAME_ARENA.worldW, worldH: GUNGAME_ARENA.worldH, name: GUNGAME_ARENA.name },
      walls: GUNGAME_ARENA.walls,
      spawns: GUNGAME_ARENA.spawns,
      decorations: GUNGAME_ARENA.decorations || [],
      weapons: GUNGAME_WEAPONS,
      totalTiers: GUNGAME_WEAPONS.length,
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    // Exponera promote/demote till bullets.js
    sim._endGungameMatch = endGungameMatch;
  } else {
    loadStage(sim, sim.wave);
  }
  sim.lastTick = Date.now();
  sim.interval = setInterval(() => {
    try { tickSim(sim); } catch (e) { console.error('sim-tick error:', e.message, e.stack); }
  }, TICK_MS);
}

// Pickups för siege-arena — symmetrisk runt mitten + flank-positions
function buildSiegePickups(sim) {
  return [
    // HP-pickups vid mid-bases
    { id: nextPickupId(sim), x: 1800, y: 1100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 1100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1800, y: 1900, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 1900, type: 'hp',     available: true, respawnAt: 0 },
    // Shield-pickups i mid och vid hörn
    { id: nextPickupId(sim), x: 2500, y: 800,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 2200, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1200, y: 1500, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3800, y: 1500, type: 'shield', available: true, respawnAt: 0 },
  ];
}

function stopSim(sim) {
  if (sim.interval) {
    clearInterval(sim.interval);
    sim.interval = null;
    console.log('[SIM]', sim.room.code, 'stopped');
  }
  // Rensa bots ur room.members så de inte hänger kvar till nästa match
  removeAllBots(sim);
}

function applyPlayerInput(sim, peerId, input) {
  const ws = sim.room.members.get(peerId);
  if (!ws) return;
  if (!ws.playerState) ws.playerState = { x: 1000, y: 1000, hp: 100 };
  // Mounted turret-spelare: position låst av server. Ignorera klient-position
  // helt så ingen kan skjuta från fel pos eller bypass turret-occupant.
  if (ws._mountedSiegeTurretId || ws._mountedCtfTurretId) {
    if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
    if (input.weaponId) ws.playerState.weaponId = input.weaponId;
    return;
  }
  // PvP anti-cheat / carrier-slow enforcement: klampa positionsdelta per tick
  // till rimlig max-speed. Klient kan annars skicka godtycklig x/y och teleporta
  // genom väggar eller kringgå CTF_CARRIER_SPEED_MUL (-25% när man bär flagga).
  // Inkluderar nu siegeActive (saknades innan → kunde teleporta i siege).
  if ((sim.tdmActive || sim.ctfActive || sim.siegeActive) && typeof input.x === 'number' && typeof input.y === 'number') {
    const now = Date.now();
    const lastT = ws._lastInputT || now;
    const dt = Math.max(0.001, Math.min(0.25, (now - lastT) / 1000));
    ws._lastInputT = now;
    // Bas-speed 230, adrenalin 1.35×, cheat 2×. Tillåt 2× för säkerhets-margin
    // (lag-spikes). Carrier i CTF är 0.75× — men late lag kan göra delta större;
    // ge en generös cap. Server tar slut-snapshot från klient ändå.
    let maxSpeed = 230 * 2.0;
    if (sim.ctfActive) {
      // Kolla om peeren bär en flagga
      const isCarrier = sim.ctfFlags && (
        (sim.ctfFlags.red && sim.ctfFlags.red.carrierId === peerId) ||
        (sim.ctfFlags.blue && sim.ctfFlags.blue.carrierId === peerId)
      );
      if (isCarrier) maxSpeed *= CTF_CARRIER_SPEED_MUL; // 0.75
    }
    const maxDelta = maxSpeed * dt + 12; // +12 buffer för server-tick-overlap
    const dx = input.x - ws.playerState.x;
    const dy = input.y - ws.playerState.y;
    const d = Math.hypot(dx, dy);
    if (d > maxDelta && d > 0) {
      const scale = maxDelta / d;
      ws.playerState.x += dx * scale;
      ws.playerState.y += dy * scale;
    } else {
      ws.playerState.x = input.x;
      ws.playerState.y = input.y;
    }
  } else {
    if (typeof input.x === 'number') ws.playerState.x = input.x;
    if (typeof input.y === 'number') ws.playerState.y = input.y;
  }
  if (typeof input.hp === 'number') ws.playerState.hp = input.hp;
  if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
  if (input.weaponId) ws.playerState.weaponId = input.weaponId;
  // Companion-state: server är AUKTORITET för hp + alive (klient kan annars skriva
  // över server-side damage genom att skicka full hp). Klient skickar position +
  // metadata; server preservar hp/alive om companion redan finns.
  if (input.companion) {
    const prev = ws.companionState;
    if (prev && prev.id === input.companion.id) {
      // Existing companion: behåll server-auth hp + alive, uppdatera bara pos/r.
      prev.x = input.companion.x;
      prev.y = input.companion.y;
      prev.r = input.companion.r || prev.r;
      prev.maxHp = input.companion.maxHp || prev.maxHp;
    } else {
      // Ny companion (första input eller byte) — initiera från klient.
      ws.companionState = {
        id: input.companion.id,
        x: input.companion.x,
        y: input.companion.y,
        hp: typeof input.companion.hp === 'number' ? input.companion.hp : 100,
        maxHp: input.companion.maxHp || 100,
        alive: input.companion.alive !== false,
        r: input.companion.r || 12,
        lastAggroAt: 0,
      };
    }
  } else if (ws.companionState) {
    ws.companionState = null;
  }
}

function applyShoot(sim, peerId, msg) {
  const ws = sim.room.members.get(peerId);
  if (!ws) return;
  if (!ws.playerState) {
    ws.playerState = {
      x: typeof msg.x === 'number' ? msg.x : 1000,
      y: typeof msg.y === 'number' ? msg.y : 1000,
      hp: 100,
    };
  }
  const ps = ws.playerState;
  // Mounted turret: tvinga rätt vapen-id + position. Annars kan client säga
  // "weaponId: railgun" och få railgun-dmg från turret-position.
  let weaponId = msg.weaponId || ps.weaponId || 'pistol';
  let posX = typeof msg.x === 'number' ? msg.x : ps.x;
  let posY = typeof msg.y === 'number' ? msg.y : ps.y;
  if (ws._mountedSiegeTurretId && sim.siegeTurrets) {
    const t = sim.siegeTurrets[ws._mountedSiegeTurretId];
    if (t) { weaponId = t.weaponId || 'turret_mg'; posX = t.x; posY = t.y; }
  } else if (ws._mountedCtfTurretId && sim.ctfTurrets) {
    const t = sim.ctfTurrets[ws._mountedCtfTurretId];
    if (t) { weaponId = t.weaponId || 'turret_mg'; posX = t.x; posY = t.y; }
  }
  const p = {
    x: posX, y: posY,
    aimAngle: typeof msg.ang === 'number' ? msg.ang : (ps.aim || 0),
    r: 14, peerId,
  };
  // Diagnostik (avstängt i prod via env-var)
  if (process.env.SIM_DEBUG) {
    console.log('[SIM]', sim.room.code, 'shoot from', peerId, 'weapon=' + weaponId, 'pos=(' + p.x + ',' + p.y + ')', 'enemies=' + sim.enemies.length, 'bullets=' + sim.bullets.length);
  }
  const params = {
    dmgMul: msg.dmgMul || 1, bspeedMul: msg.bspeedMul || 1,
    explMul: msg.explMul || 1, kbMul: msg.kbMul || 1,
    critChance: msg.critChance || 0,
    adrenalineDmg: msg.adrenalineDmg || 1,
    stealthBonus: msg.stealthBonus || 1,
    perks: msg.perks || {}, cheats: msg.cheats || {},
  };
  // Melee i PvP-modes: direkt hit-check, ingen bullet spawnas.
  // (Story-mode melee körs lokalt på klient mot state.enemies.)
  const w = require('../../shared/weapons-data').W_BY_ID[weaponId];
  if (w && w.type === 'melee') {
    applyMelee(sim, p, weaponId, params);
    return;
  }
  spawnPlayerBullets(sim, p, weaponId, params);
}

// Ny: host kan köra "next stage" via sim_load_stage-meddelande
function applyLoadStage(sim, peerId, msg) {
  if (sim.room.hostId !== peerId) return;
  // Klient skickar maxStages så server vet stage-count. Annars fallback till
  // generös 30 (säkrare mot orimliga värden men låter custom-modes köra).
  const maxStages = (typeof msg.maxStages === 'number' && msg.maxStages > 0)
    ? Math.min(50, msg.maxStages)
    : 30;
  const wave = Math.max(1, Math.min(maxStages, msg.wave || 1));
  // Reset deadBodies vid stage-load så ev. icke-revivad spelare från förra stage
  // inte är stuck. Spelare som dog precis innan stage-clear ska respawna fresh.
  sim.deadBodies = {};
  loadStage(sim, wave);
}

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput, applyShoot, applyLoadStage, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret };
