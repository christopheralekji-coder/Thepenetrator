// Per-room simulation. Phase 4: bossar + waves + stages.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy } = require('./enemies');
const { spawnPlayerBullets, updateBullets, damageEnemy } = require('./bullets');
const { updateBoss } = require('./bosses');
const { loadStage, updateZoneProgression, spawnEnemyAtEdge, isStageComplete, onWaveComplete, checkBossDeath } = require('./waves');
const { updatePickups, dropFromEnemyDeath } = require('./pickups');
const { getStage } = require('../../shared/stages-data');
const { CTF_ARENA, resolveCtfWall, bulletHitsWall } = require('../../shared/ctf-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');

// 30Hz → 45Hz: tickar var 22ms istället för 33ms. Halverar input→pixel-delay
// från server-tick-perspektiv. 1.5× CPU-last, men Node klarar 10k+ ops/tick i
// god marginal (current load ~10ms/tick på Render free). Vid CPU-tryck kan
// vi sätta SIM_TICK_HZ env-var lokalt utan ny deploy.
const TICK_HZ = parseInt(process.env.SIM_TICK_HZ, 10) || 45;
const TICK_MS = 1000 / TICK_HZ;
// Broadcast-rate separat från tick: sim räknar fortfarande 45Hz för snabb
// input-response, men world-broadcast sker bara 30Hz för att spara CPU vid
// 8-player-rum (perMessageDeflate-compression är dyrast delen per-peer-send).
// Klient interpolerar partner-positioner så 30Hz visual känns smooth.
const BROADCAST_HZ = parseInt(process.env.SIM_BROADCAST_HZ, 10) || 30;
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
  };
  return sim;
}

const CTF_FLAG_AUTORETURN_MS = 30000;
const CTF_CARRIER_SPEED_MUL = 0.75; // -25% speed för flag-carrier

function tickSim(sim) {
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTick) / 1000);
  sim.lastTick = now;

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
  sim.tdmEnded = false;
  sim.ctfEnded = false;
  sim.tdmKills = { red: 0, blue: 0 };
  sim.ctfCaptures = { red: 0, blue: 0 };
  sim.tdmKillsByPid = {};
  sim.tdmDeathsByPid = {};
  sim.ctfKillsByPid = {};
  sim.ctfCapturesByPid = {};
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
  }
  console.log('[SIM]', sim.room.code, 'started mode=' + (sim.ctfActive ? 'ctf' : (sim.tdmActive ? 'tdm' : sim.config.mode)) + ' diff=' + sim.config.difficulty);
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
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      const team = i % 2 === 0 ? 'red' : 'blue';
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
      const team = i % 2 === 0 ? 'red' : 'blue';
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
  } else {
    loadStage(sim, sim.wave);
  }
  sim.lastTick = Date.now();
  sim.interval = setInterval(() => {
    try { tickSim(sim); } catch (e) { console.error('sim-tick error:', e.message, e.stack); }
  }, TICK_MS);
}

function stopSim(sim) {
  if (sim.interval) {
    clearInterval(sim.interval);
    sim.interval = null;
    console.log('[SIM]', sim.room.code, 'stopped');
  }
}

function applyPlayerInput(sim, peerId, input) {
  const ws = sim.room.members.get(peerId);
  if (!ws) return;
  if (!ws.playerState) ws.playerState = { x: 1000, y: 1000, hp: 100 };
  // PvP anti-cheat / carrier-slow enforcement: klampa positionsdelta per tick
  // till rimlig max-speed. Klient kan annars skicka godtycklig x/y och teleporta
  // genom väggar eller kringgå CTF_CARRIER_SPEED_MUL (-25% när man bär flagga).
  if ((sim.tdmActive || sim.ctfActive) && typeof input.x === 'number' && typeof input.y === 'number') {
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
  const weaponId = msg.weaponId || ps.weaponId || 'pistol';
  const p = {
    x: typeof msg.x === 'number' ? msg.x : ps.x,
    y: typeof msg.y === 'number' ? msg.y : ps.y,
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

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput, applyShoot, applyLoadStage };
