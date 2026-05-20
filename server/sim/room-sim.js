// Per-room simulation. Phase 4: bossar + waves + stages.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy } = require('./enemies');
const { makeBoss } = require('./bosses');
const { spawnPlayerBullets, applyMelee, updateBullets, damageEnemy } = require('./bullets');
const { addBot, tickBots, removeAllBots } = require('./bots');
const { updateBoss } = require('./bosses');
const { loadStage, updateZoneProgression, spawnEnemyAtEdge, isStageComplete, onWaveComplete, checkBossDeath } = require('./waves');
const { getDiffMul: cdGetDiffMul, getCoopMultiplier: cdGetCoopMul } = require('../../shared/stages-data');
const { updatePickups, dropFromEnemyDeath } = require('./pickups');
const { getStage } = require('../../shared/stages-data');
const { CTF_ARENA, resolveCtfWall, bulletHitsWall } = require('../../shared/ctf-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');
const { SIEGE_ARENA } = require('../../shared/siege-arena');
const { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS } = require('../../shared/gungame-arena');
const { KOTH_ARENA } = require('../../shared/koth-arena');
const { JUGGERNAUT_ARENA } = require('../../shared/juggernaut-arena');
const { BATTLEROYALE_ARENA } = require('../../shared/battleroyale-arena');
const { CASTLEDEFENSE_ARENA } = require('../../shared/castledefense-arena');
const { SpatialGrid } = require('./spatial');

// 45Hz → 60Hz (v1.391): tickar var 16.7ms istället för 22ms. Sparar ~3-6ms
// quantization-lag per tick + matchar 60fps-rendering på klient.
// Server-load är 99% idle (tick avg 0.3-5ms av nuvarande 22ms budget) så
// 33% mer ticks/sec är trivial cost. Mätbart bättre input→action-feel.
// Vid CPU-tryck (50+ samtida spelare): sätt SIM_TICK_HZ=45 env-var i Render.
const TICK_HZ = parseInt(process.env.SIM_TICK_HZ, 10) || 60;
const TICK_MS = 1000 / TICK_HZ;
// Broadcast-rate matchar tick — minimal input→pixel-delay. Per-peer-broadcast
// kostar mest i deflate, men threshold:256 skippar för små paket (~32B).
// Bandwidth: ~2.5KB/s → ~3.3KB/s per peer. Försumbart.
const BROADCAST_HZ = parseInt(process.env.SIM_BROADCAST_HZ, 10) || 60;
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
    enemyGrid: new SpatialGrid(),     // built once per tick, used by bullets/explode/applySeparation
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
    // KOTH state (FFA, hold-the-hill, first to N points)
    kothActive: false,
    kothEnded: false,
    kothWinner: null,
    kothTargetPoints: 100,
    kothScores: {},          // peerId → points
    kothKillsByPid: {},      // peerId → kills (för stats)
    kothActiveZoneIdx: 0,    // current zone-index (rotates)
    _kothZoneRotateAt: 0,    // när nästa zone-rotation sker
    _kothPointAccum: {},     // peerId → fractional accumulator
    _kothSpawnIdx: 0,        // spawn-rotation
    // JUGGERNAUT state (FFA-roll, 1 JUG åt gången, mest tid-som-JUG vinner)
    juggernautActive: false,
    juggernautEnded: false,
    juggernautWinner: null,
    juggernautPid: null,           // nuvarande JUG (peerId), null = ingen
    juggernautWeapon: null,        // vapen JUG-spelaren valt (rifle/shotgun/sledge)
    juggernautScores: {},          // peerId → ackumulerad tid som JUG (sek)
    juggernautKillsByPid: {},      // peerId → kills som JUG
    juggernautHpMax: 0,            // beräknas vid match-start från hunterCount
    juggernautEndAt: 0,            // ms timestamp då matchen tar slut
    juggernautDmgToJug: {},        // peerId → ackumulerad dmg gjord mot current JUG (reset:as vid transfer)
    _juggernautLastPulseAt: 0,     // ms när senaste minimap-puls sändes
    _juggernautSpawnIdx: 0,        // roterar spawn-punkter
    _juggernautScoreAccum: 0,      // fractional second-accumulator för JUG score
    // BATTLE ROYALE state (FFA, no-respawn, shrinking zone)
    battleroyaleActive: false,
    battleroyaleEnded: false,
    battleroyaleWinner: null,
    battleroyaleMatchDurationSec: 600,
    battleroyaleStartedAt: 0,
    battleroyaleEndAt: 0,
    battleroyalePhase: 0,           // 0=LOOT, 1-3=SHRINK, 4=FINAL
    battleroyalePhaseStartedAt: 0,  // ms när nuvarande fas började
    battleroyalePhaseEndAt: 0,      // ms när nuvarande fas slutar
    battleroyaleZone: null,         // { x, y, r, nextX, nextY, nextR }
    battleroyaleLoot: [],           // [{ id, x, y, kind, weaponId, available, respawnAt }]
    battleroyaleKillsByPid: {},
    battleroyaleAliveCount: 0,
    battleroyaleEliminated: [],     // pids i ordning av elimination (för stats)
    battleroyaleRanks: {},          // pid → placering (1 = winner, N = först-eliminerad)
    _brZoneDmgTick: 0,              // ackumulator för outside-dmg-broadcasts
    _brBroadcastTick: 0,
    _brLootIdCounter: 0,
    // CASTLE DEFENSE state (co-op endless horde defense)
    castledefenseActive: false,
    castledefenseEnded: false,
    castledefenseStartedAt: 0,
    castledefenseWave: 0,                  // current wave (0 = pre-start)
    castledefenseWaveBetweenEndAt: 0,      // ms timestamp för nästa våg-start
    castledefenseWaveState: 'idle',        // 'idle' | 'between' | 'active'
    castledefenseCore: null,               // { x, y, r, hp, maxHp }
    castledefenseWalls: [],                // runtime-kopia av arena.walls med mutable hp
    castledefenseBuildings: [],            // [{ id, kind, x, y, w, h, hp, maxHp, ownerPid, ...kind-specific }]
    castledefenseScores: {},               // peerId → kills
    castledefenseGold: {},                 // peerId → per-match gold (för byggande, ej save.gold)
    castledefenseWeaponTier: {},           // peerId → vapen-tier (0 = pistol, 11 = sledge)
    castledefensePerks: {},                // peerId → perk-id (10 hero-perks, unik per spelare)
    castledefenseDownedPids: [],           // pids som är down (Phase 6)
    castledefenseRevivedCount: 0,
    _cdBuildIdCounter: 0,
    _cdBroadcastTick: 0,
    _cdWaveSpawnsRemaining: 0,
    _cdWaveSpawnTimer: 0,
  };
  return sim;
}

const CTF_FLAG_AUTORETURN_MS = 30000;
const CTF_CARRIER_SPEED_MUL = 0.75; // -25% speed för flag-carrier

function tickSim(sim) {
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTick) / 1000);
  sim.lastTick = now;

  // v1.384: debug-stats broadcast var 500ms — så klient kan visa server-side
  // tick-tid i debug-overlay (toggleable via inställning).
  if (now - (sim._lastDbgBroadcastAt || 0) > 500) {
    sim._lastDbgBroadcastAt = now;
    sim.eventQueue.push({
      type: 'dbg_stats',
      tickAvg: Math.round((sim._tickMsEMA || 0) * 10) / 10,
      tickMax: Math.round((sim._tickMsMax || 0) * 10) / 10,
      members: sim.room.members.size,
      enemies: (sim.enemies && sim.enemies.length) || 0,
      bullets: (sim.bullets && sim.bullets.length) || 0,
    });
  }

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
    for (const [pid, ws] of sim.room.members) {
      if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
        ws.tdmRespawnAt = 0;
        if (ws.playerState) {
          // Välj från team-pool den spawn som ligger LÄNGST bort från motståndare.
          const pool = ws.tdmTeam === 'red' ? TDM_ARENA.spawns.red : TDM_ARENA.spawns.blue;
          const sp = pickFarthestSpawn(pool, sim, pid) || pool[0];
          ws.playerState.x = sp.x;
          ws.playerState.y = sp.y;
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
  // KOTH-mode: hold-the-hill med roterande zon
  if (sim.kothActive) {
    tickKoth(sim, dt, now);
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
  // JUGGERNAUT-mode: 1 JUG (5× HP, +35% speed), övriga = hunters med pistol.
  // Mest tid-som-JUG vinner när timer går ut.
  if (sim.juggernautActive) {
    tickJuggernaut(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // BATTLE ROYALE: FFA, no-respawn, krympande zon. Sista överlevare vinner.
  if (sim.battleroyaleActive) {
    tickBattleRoyale(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // CASTLE DEFENSE: co-op endless horde defense. Skydda castle-core mot vågor.
  if (sim.castledefenseActive) {
    tickCastleDefense(sim, dt, now);
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

  // Bygg spatial-grid över ALIVE enemies — används av bullets-collision,
  // applySeparation (i enemies.js), chain-effekter, explode. Sparar ~1M
  // ops/s vs linear scan vid 80 enemies × 200 bullets.
  sim.enemyGrid.clear();
  for (const e of sim.enemies) {
    if (!e.dead) sim.enemyGrid.insert(e);
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

  // CTF turret-rebuild: friendly team-spelare 20s nära förstörd turret = restore
  tickTurretRebuilds(sim, sim.ctfTurrets, dt, now, 'ctf');

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

function buildKothPickups(sim) {
  // 3500×2000 arena. Pickups placerade NÄRA zon-positionerna så hill-defense
  // har strategiska resurser, men inte i zonen själv (då blir det auto-grab).
  return [
    // HP: i kvadrant-positioner runt arenan
    { id: nextPickupId(sim), x: 500,  y: 500,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3000, y: 500,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 500,  y: 1500, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3000, y: 1500, type: 'hp',     available: true, respawnAt: 0 },
    // Shield: nära mid och flank-zoner — kontestbara, värd risken
    { id: nextPickupId(sim), x: 1200, y: 1000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2300, y: 1000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1750, y: 600,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1750, y: 1400, type: 'shield', available: true, respawnAt: 0 },
    // Granater: spridda runt hörn + mid-flank för att inte hamna i zonen
    { id: nextPickupId(sim), x: 800,  y: 300,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2700, y: 300,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 800,  y: 1700, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2700, y: 1700, type: 'grenade', available: true, respawnAt: 0 },
  ];
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
    // Granater: 4 symmetriska, mellan flanker och mid (taktiska val)
    { id: nextPickupId(sim), x: 800,  y: 1400, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3700, y: 1400, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
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
    // Granater: 4 symmetriska runt mid (riskabla men taktiska)
    { id: nextPickupId(sim), x: 800,  y: 1500, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 1500, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2000, y: 1100, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2000, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
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
      // Heal — använd spelarens faktiska maxHp (JUG har 400-1300, inte 100)
      const maxHp = ws.playerState.maxHp || 100;
      const maxShield = ws.playerState.maxShield || 100;
      let grenadesGained = 0;
      if (pu.type === 'hp') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(maxHp, before + PICKUP_HEAL);
        if (ws.playerState.hp === before) continue; // redan full HP — skip pickup
      } else if (pu.type === 'shield') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(maxShield, before + PICKUP_HEAL);
        if (ws.playerState.shield === before) continue; // redan full shield
      } else if (pu.type === 'grenade') {
        // Grenade-pickup: +1 granat. Klient håller faktisk count (server bara
        // emiterar event — klient bumpar lokal counter).
        grenadesGained = 1;
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
        grenadesGained,
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

// Rebuild: friendly team-spelare nära förstörd turret tickar timern.
// 20s totalt → restore full hp. Throttle progress-events till 4Hz.
const TURRET_REBUILD_MS = 20000;
const TURRET_REBUILD_RADIUS = 70;
const TURRET_REBUILD_EMIT_MS = 250;

function tickTurretRebuilds(sim, turrets, dt, now, mode) {
  if (!turrets) return;
  const radiusSq = TURRET_REBUILD_RADIUS * TURRET_REBUILD_RADIUS;
  for (const tid of Object.keys(turrets)) {
    const t = turrets[tid];
    if (!t.destroyed) continue;
    let friendlyNear = false;
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      if (ws.tdmTeam !== t.team) continue;
      const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
      if (dx * dx + dy * dy <= radiusSq) { friendlyNear = true; break; }
    }
    const wasRebuilding = (t.rebuildT || 0) > 0;
    if (friendlyNear) {
      t.rebuildT = (t.rebuildT || 0) + dt * 1000;
      if (t.rebuildT >= TURRET_REBUILD_MS) {
        // Restore — full hp, ej destroyed, ingen occupant
        t.destroyed = false;
        t.hp = t.maxHp;
        t.destroyedAt = 0;
        t.rebuildT = 0;
        t.occupantId = null;
        t._lastRebuildEmitAt = 0;
        sim.eventQueue.push({ type: mode + '_turret_rebuilt', turretId: t.id, hp: t.hp, maxHp: t.maxHp });
        continue;
      }
      if (!t._lastRebuildEmitAt || now - t._lastRebuildEmitAt >= TURRET_REBUILD_EMIT_MS) {
        t._lastRebuildEmitAt = now;
        sim.eventQueue.push({
          type: mode + '_turret_rebuild_progress',
          turretId: t.id,
          progress: Math.min(1, t.rebuildT / TURRET_REBUILD_MS),
        });
      }
    } else if (wasRebuilding) {
      t.rebuildT = 0;
      t._lastRebuildEmitAt = 0;
      sim.eventQueue.push({ type: mode + '_turret_rebuild_progress', turretId: t.id, progress: 0 });
    }
  }
}

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

  // SIEGE turret-rebuild: båda lagens MG + rocket-turrets kan repas på 20s
  tickTurretRebuilds(sim, sim.siegeTurrets, dt, now, 'siege');

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

// === KOTH ===
// Hold-the-hill FFA. Spelare i aktiv zon får +1 pt/sek. Zone-position roterar
// var N sek så ingen kan sitta i samma hörn hela matchen. First to targetPoints.
function tickKoth(sim, dt, now) {
  const nowMs = Date.now();

  // Respawn (samma som gungame — roterande spawn, 3s cooldown)
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = KOTH_ARENA.spawns;
        const sp = spawns[sim._kothSpawnIdx % spawns.length];
        sim._kothSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = 100;
        ws.playerState.shield = ws.playerState.maxShield || 100;
        ws.playerState.invulnUntil = nowMs + 1500;
        if (ws._bot) { ws._bot.target = null; ws._bot.lastShotAt = 0; ws._bot.stuckSince = 0; }
        sim.eventQueue.push({
          type: 'koth_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
        });
      }
    }
  }

  if (sim.kothEnded) return;

  // Warning 5s före zone-byter — så spelare hinner springa till nästa zon
  const msToRotate = sim._kothZoneRotateAt - nowMs;
  if (msToRotate > 0 && msToRotate <= 5000 && !sim._kothWarningSent) {
    sim._kothWarningSent = true;
    const nextIdx = (sim.kothActiveZoneIdx + 1) % KOTH_ARENA.zones.length;
    const nextZ = KOTH_ARENA.zones[nextIdx];
    sim.eventQueue.push({
      type: 'koth_zone_warning',
      msToRotate,
      nextIdx,
      nextX: nextZ.x, nextY: nextZ.y, nextName: nextZ.name,
    });
  }
  // Zone-rotation
  if (nowMs >= sim._kothZoneRotateAt) {
    const next = (sim.kothActiveZoneIdx + 1) % KOTH_ARENA.zones.length;
    sim.kothActiveZoneIdx = next;
    sim._kothZoneRotateAt = nowMs + (KOTH_ARENA.zoneRotateSec || 45) * 1000;
    sim._kothWarningSent = false;
    const z = KOTH_ARENA.zones[next];
    sim.eventQueue.push({
      type: 'koth_zone_changed',
      idx: next,
      x: z.x, y: z.y, r: z.r, name: z.name,
      nextRotateAt: sim._kothZoneRotateAt,
    });
  }

  // Wall-collision + pickups
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, KOTH_ARENA.walls);
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }
  tickPvpPickups(sim, now);

  // Bullets
  updateBullets(sim, dt, now);

  // Score: ENSAM i aktiv zon = +1 pt/sek. Contested (>1 spelare) = ingen får
  // poäng. Bryter genre-konventionen att man bara CAN hill om uncontested.
  // Detta gör att killing/utrensning av zonen blir taktisk.
  const zone = KOTH_ARENA.zones[sim.kothActiveZoneIdx];
  const inZone = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const dx = ws.playerState.x - zone.x, dy = ws.playerState.y - zone.y;
    if (dx * dx + dy * dy <= zone.r * zone.r) inZone.push(pid);
  }
  // Bara ensam-occupant tickar poäng. Multi-occupant = contested (pausad).
  if (inZone.length === 1) {
    const pid = inZone[0];
    sim._kothPointAccum[pid] = (sim._kothPointAccum[pid] || 0) + dt * (KOTH_ARENA.pointsPerSecond || 1);
    if (sim._kothPointAccum[pid] >= 1) {
      const whole = Math.floor(sim._kothPointAccum[pid]);
      sim._kothPointAccum[pid] -= whole;
      sim.kothScores[pid] = (sim.kothScores[pid] || 0) + whole;
    }
  }
  // Skicka contested-state om relevant så klient kan visa banner
  if (inZone.length > 1) {
    sim._kothContestedSent = sim._kothContestedSent || 0;
    if (now - sim._kothContestedSent > 1000) {
      sim._kothContestedSent = now;
      sim.eventQueue.push({ type: 'koth_zone_contested', count: inZone.length });
    }
  } else {
    sim._kothContestedSent = 0;
  }

  // Death-detection
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'koth_player_died', victim: pid, durationMs: 3000 });
    }
  }

  // Score-broadcast var sekund + win-check
  sim._kothBroadcastTick = (sim._kothBroadcastTick || 0) + dt;
  if (sim._kothBroadcastTick >= 1.0) {
    sim._kothBroadcastTick = 0;
    sim.eventQueue.push({
      type: 'koth_score_update',
      scores: { ...sim.kothScores },
      target: sim.kothTargetPoints,
    });
    // Win-check
    for (const pid of Object.keys(sim.kothScores)) {
      if (sim.kothScores[pid] >= sim.kothTargetPoints) {
        endKothMatch(sim, pid, 'target_points');
        return;
      }
    }
  }
}

function endKothMatch(sim, winnerId, reason) {
  if (sim.kothEnded) return;
  sim.kothEnded = true;
  sim.kothWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p] of sim.room.members) {
    stats.perPlayer[p] = {
      score: sim.kothScores[p] || 0,
      kills: sim.kothKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'koth_match_end',
    winner: winnerId, reason, stats,
  });
}

// ============================================================
// JUGGERNAUT — FFA-roll-mode: 1 JUG (kraftig, kollar 5× HP/+speed/dash)
// ============================================================
// pickSpreadSpawns — välj N spawns från pool så att de är MAXIMALT SPRIDDA.
// Best-candidate-algoritm: pick first random, sedan iterativt välj den
// spawn som har STÖRST min-distance till alla redan valda.
// Garanterar att spelare aldrig spawnar bredvid varandra (förutsatt att
// poolen har minst N spawns med vettigt avstånd).
function pickSpreadSpawns(pool, n) {
  if (n <= 0 || pool.length === 0) return [];
  const remaining = pool.slice();
  const chosen = [];
  // Pick first randomly
  const firstIdx = Math.floor(Math.random() * remaining.length);
  chosen.push(remaining[firstIdx]);
  remaining.splice(firstIdx, 1);
  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0, bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      let minDist = Infinity;
      for (const c of chosen) {
        const dx = remaining[i].x - c.x, dy = remaining[i].y - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDist) minDist = d2;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    chosen.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  // Om n > pool.length: lägg till jitter-kopior så två spelare inte hamnar
  // på exakt samma punkt
  if (chosen.length < n) {
    const need = n - chosen.length;
    for (let k = 0; k < need; k++) {
      const base = chosen[k % pool.length];
      chosen.push({
        x: base.x + (Math.random() - 0.5) * 200,
        y: base.y + (Math.random() - 0.5) * 200,
      });
    }
  }
  return chosen;
}

// Hitta spawn från pool som ligger LÄNGST bort från alla levande spelare.
// Används vid respawn så spelaren inte hamnar mitt i action.
function pickFarthestSpawn(pool, sim, excludePid) {
  if (pool.length === 0) return null;
  let best = pool[0], bestDist = -1;
  for (const sp of pool) {
    let minDist = Infinity;
    for (const [pid, ws] of sim.room.members) {
      if (pid === excludePid) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - sp.x, dy = ws.playerState.y - sp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDist) minDist = d2;
    }
    if (minDist > bestDist) { bestDist = minDist; best = sp; }
  }
  return best;
}

// Spawnar alla som hunters med pistol. Random human (aldrig bot) blir initial
// JUG. JUG-spelaren får 5× HP (skalat med spelarcount), +35% speed, 1s dash CD,
// valbart vapen (rifle/shotgun/sledge). Hunters har bara pistol.
// JUG dör → killer blir ny JUG (bot kan inte → human med högst dmg blir det).
// Vinst: mest sek-som-JUG när timer går ut.
// hpFrac: 1.0 = full HP (initial JUG), 0.6 = 60% HP (transfer mid-match —
// motverkar snowball där JUG dödar någon och får full HP omedelbart).
function applyJugStats(sim, ws, hpFrac) {
  if (!ws.playerState) return;
  const frac = (typeof hpFrac === 'number') ? Math.max(0.1, Math.min(1, hpFrac)) : 1;
  ws.playerState.maxHp = sim.juggernautHpMax;
  ws.playerState.hp = Math.round(sim.juggernautHpMax * frac);
  // JUG-specifik max-shield (200, var 100) — sätt FÖRE shield-räkningen
  ws.playerState.maxShield = JUGGERNAUT_ARENA.jugShieldMax || 200;
  ws.playerState.shield = Math.round(ws.playerState.maxShield * frac);
  ws.playerState.isJug = true;
  ws.playerState.scaleMul = JUGGERNAUT_ARENA.jugScale;
  ws.playerState.speedMul = JUGGERNAUT_ARENA.jugSpeedMul;
  ws.playerState.dashCdMs = JUGGERNAUT_ARENA.jugDashCdMs;
  ws.playerState.weaponId = sim.juggernautWeapon || JUGGERNAUT_ARENA.jugDefaultWeapon;
}

function applyHunterStats(sim, ws) {
  if (!ws.playerState) return;
  ws.playerState.hp = 100;
  ws.playerState.maxHp = 100;
  ws.playerState.maxShield = JUGGERNAUT_ARENA.hunterShieldMax || 100;
  ws.playerState.shield = ws.playerState.maxShield;
  ws.playerState.isJug = false;
  ws.playerState.scaleMul = 1.0;
  ws.playerState.speedMul = JUGGERNAUT_ARENA.hunterSpeedMul || 1.10;
  // Server returnerar dashCdMs så klient kan rita CD-ring — uttryckligt 3s
  // (var 'null' vilket klient tolkade som default 3000ms; nu uttryckligt).
  ws.playerState.dashCdMs = 3000;
  ws.playerState.weaponId = JUGGERNAUT_ARENA.hunterWeapon;
}

function pickRandomHumanHunter(sim, excludePid) {
  const candidates = [];
  for (const [pid, ws] of sim.room.members) {
    if (ws._isBot) continue;
    if (pid === excludePid) continue;
    if (!ws.playerState) continue;
    candidates.push(pid);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function transferJug(sim, newPid, reason) {
  if (sim.juggernautEnded) return;
  const oldPid = sim.juggernautPid;
  // Demote gamla JUG (kan vara null vid initial)
  if (oldPid) {
    const oldWs = sim.room.members.get(oldPid);
    if (oldWs && oldWs.playerState) {
      applyHunterStats(sim, oldWs);
      oldWs.playerState.invulnUntil = Date.now() + 1500;
    }
  }
  sim.juggernautPid = newPid;
  // Reset mobility-decay-tracker så nya JUG inte ärver gamla timer
  sim._jugLastMovePos = null;
  // Reset dmg-attribution när JUG byter (nya JUG ska få fresh dmg-tally mot sig)
  sim.juggernautDmgToJug = {};
  if (newPid) {
    const newWs = sim.room.members.get(newPid);
    if (newWs) {
      // Default-vapen: behåll current sim.juggernautWeapon om satt, annars default
      if (!sim.juggernautWeapon) sim.juggernautWeapon = JUGGERNAUT_ARENA.jugDefaultWeapon;
      // Full HP + shield för ny JUG (var: 60% mid-match — nu full per user-spec)
      applyJugStats(sim, newWs, 1.0);
      newWs.playerState.invulnUntil = Date.now() + 2000; // 2s invuln för ny JUG
      newWs.tdmRespawnAt = 0;
    }
  }
  sim.eventQueue.push({
    type: 'juggernaut_jug_changed',
    newJug: newPid,
    oldJug: oldPid,
    reason,
    weapon: sim.juggernautWeapon,
    jugHp: sim.juggernautHpMax,
  });
}

function tickJuggernaut(sim, dt, now) {
  const nowMs = Date.now();

  // Respawn hunters (3s gungame-style, roterande spawn). JUG respawnar inte —
  // när JUG dör händer transferJug + ny JUG spawnar direkt på dödsplatsen.
  // Specialfall: om bot dödade förra JUG har sim._juggernautAwaitFirstRespawn
  // satts. Då blir den första humanen som respawnar ny JUG (istället för dmg-leaders).
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = JUGGERNAUT_ARENA.spawns;
        let sp = spawns[sim._juggernautSpawnIdx % spawns.length];
        for (let tries = 0; tries < spawns.length; tries++) {
          const candidate = spawns[(sim._juggernautSpawnIdx + tries) % spawns.length];
          let occupied = false;
          for (const [otherPid, otherWs] of sim.room.members) {
            if (otherPid === pid) continue;
            if (!otherWs.playerState || otherWs.playerState.hp <= 0) continue;
            const dx = otherWs.playerState.x - candidate.x;
            const dy = otherWs.playerState.y - candidate.y;
            if (dx * dx + dy * dy < 200 * 200) { occupied = true; break; }
          }
          if (!occupied) { sp = candidate; sim._juggernautSpawnIdx += tries; break; }
        }
        sim._juggernautSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        // First-respawn-after-bot-kill = blir JUG istället för hunter
        const becomesJug = sim._juggernautAwaitFirstRespawn && !ws._isBot;
        if (becomesJug) {
          sim._juggernautAwaitFirstRespawn = false;
          // Aktivera JUG-stats + transfer
          transferJug(sim, pid, 'bot_killed_jug_first_respawn');
          // transferJug har redan satt invulnUntil + applyJugStats
        } else {
          applyHunterStats(sim, ws);
          ws.playerState.invulnUntil = nowMs + 1500;
        }
        if (ws._bot) {
          ws._bot.target = null;
          ws._bot.lastShotAt = 0;
          ws._bot.stuckSince = 0;
        }
        sim.eventQueue.push({
          type: 'juggernaut_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
          isJug: becomesJug,
        });
      }
    }
  }

  // Pickups + walls (även när match slutar — bara score-tick stoppar)
  if (!sim.juggernautEnded) tickPvpPickups(sim, now);
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(ent, JUGGERNAUT_ARENA.walls);
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  if (sim.juggernautEnded) return;

  updateBullets(sim, dt, now);

  // Death-detection — kompletterar bullets.js (explosioner, gas, mfl. ej-bullet-kills)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp > 0) continue;
    if (pid === sim.juggernautPid) {
      // JUG dog från icke-bullet-källa (explosion/oob etc) — random hunter blir ny JUG
      const fallback = pickRandomHumanHunter(sim, pid);
      ws.tdmRespawnAt = nowMs + 3000;
      sim.juggernautKillsByPid[pid] = sim.juggernautKillsByPid[pid] || 0;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'juggernaut_player_died', victim: pid, durationMs: 3000, wasJug: true });
      if (fallback) transferJug(sim, fallback, 'jug_suicide_or_environment');
      else {
        // Inga humans kvar — låt JUG stå tom + flagga first-respawn-blir-JUG
        // så match självläker när en human respawnar.
        sim.juggernautPid = null;
        sim._juggernautAwaitFirstRespawn = true;
      }
    } else if (!ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'juggernaut_player_died', victim: pid, durationMs: 3000, wasJug: false });
    }
  }

  // Score-ackumulering: nuvarande JUG får dt-sek per tick
  if (sim.juggernautPid) {
    sim.juggernautScores[sim.juggernautPid] = (sim.juggernautScores[sim.juggernautPid] || 0) + dt;
  }

  // Anti-camping: JUG som inte rört sig >25px på 5s börjar tappa 2 HP/sek.
  // Tvingar JUG att hålla sig i rörelse istället för att fastna i ett hörn.
  if (sim.juggernautPid) {
    const jugWs = sim.room.members.get(sim.juggernautPid);
    if (jugWs && jugWs.playerState && jugWs.playerState.hp > 0) {
      const ps = jugWs.playerState;
      if (sim._jugLastMovePos == null) {
        sim._jugLastMovePos = { x: ps.x, y: ps.y, t: nowMs };
      } else {
        const dx = ps.x - sim._jugLastMovePos.x;
        const dy = ps.y - sim._jugLastMovePos.y;
        if (dx * dx + dy * dy > 25 * 25) {
          sim._jugLastMovePos = { x: ps.x, y: ps.y, t: nowMs };
        } else if (nowMs - sim._jugLastMovePos.t > 5000) {
          // Stationär >5s → drain 2 HP/sek
          ps.hp = Math.max(0, ps.hp - 2 * dt);
          // Throttla pvp_hp_changed till 2Hz för att inte spamma events
          sim._jugDecayBroadcast = (sim._jugDecayBroadcast || 0) + dt;
          if (sim._jugDecayBroadcast >= 0.5) {
            sim._jugDecayBroadcast = 0;
            sim.eventQueue.push({
              type: 'pvp_hp_changed',
              peerId: sim.juggernautPid,
              hp: ps.hp,
              shield: ps.shield || 0,
              decay: true,
            });
          }
        }
      }
    }
  } else {
    sim._jugLastMovePos = null;
  }

  // Score-broadcast var sekund (mirror av KOTH)
  sim._juggernautBroadcastTick = (sim._juggernautBroadcastTick || 0) + dt;
  if (sim._juggernautBroadcastTick >= 1.0) {
    sim._juggernautBroadcastTick = 0;
    const scoresRounded = {};
    for (const pid of Object.keys(sim.juggernautScores)) {
      scoresRounded[pid] = Math.floor(sim.juggernautScores[pid]);
    }
    sim.eventQueue.push({
      type: 'juggernaut_score_update',
      scores: scoresRounded,
      currentJug: sim.juggernautPid,
      msRemaining: Math.max(0, sim.juggernautEndAt - nowMs),
    });
  }

  // Minimap-puls var 5s — hunters får en kort blink av JUG-pos
  if (sim.juggernautPid && nowMs - sim._juggernautLastPulseAt >= JUGGERNAUT_ARENA.minimapPulseIntervalMs) {
    sim._juggernautLastPulseAt = nowMs;
    const jugWs = sim.room.members.get(sim.juggernautPid);
    if (jugWs && jugWs.playerState) {
      sim.eventQueue.push({
        type: 'juggernaut_minimap_pulse',
        x: Math.round(jugWs.playerState.x),
        y: Math.round(jugWs.playerState.y),
      });
    }
  }

  // Win-check: först till targetSec sekunder som JUG vinner.
  // (Tidigare: matchen tog slut på timer + mest-JUG-tid vann. Bytt till
  // "race-to-target" där match fortsätter tills någon når mål.)
  const targetSec = sim.juggernautMatchDurationSec || 360;
  for (const pid of Object.keys(sim.juggernautScores)) {
    if (sim.juggernautScores[pid] >= targetSec) {
      endJuggernautMatch(sim, pid, 'target_reached');
      return;
    }
  }
}

// Kallas från bullets.js när en kill registreras i juggernaut-mode.
// Anropas via sim._handleJuggernautKill (exponerad vid startSim).
function handleJuggernautKill(sim, killerPid, killerWs, victimPid, victimWs, weaponId) {
  if (sim.juggernautEnded) return;
  const wasJugKilled = (victimPid === sim.juggernautPid);
  sim.juggernautKillsByPid[killerPid] = (sim.juggernautKillsByPid[killerPid] || 0) + 1;
  sim.eventQueue.push({
    type: 'juggernaut_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
    wasJugKilled,
  });
  if (wasJugKilled) {
    // JUG dog. Bot kan inte bli JUG.
    sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
    victimWs.tdmRespawnAt = Date.now() + 3000;
    sim.eventQueue.push({ type: 'juggernaut_player_died', victim: victimPid, durationMs: 3000, wasJug: true });
    // Hitta human med HÖGST damage mot denna JUG (killing-blow räknas också,
    // den har redan fått sina senaste dmg-poäng via _trackJuggernautDmg).
    let bestPid = null, bestDmg = -1;
    for (const pid of Object.keys(sim.juggernautDmgToJug)) {
      const ws = sim.room.members.get(pid);
      if (!ws || ws._isBot) continue;
      if (ws.playerState && ws.playerState.hp <= 0) continue; // skippa döda
      const d = sim.juggernautDmgToJug[pid];
      if (d > bestDmg) { bestDmg = d; bestPid = pid; }
    }
    let newJugPid = bestPid;
    if (!newJugPid) {
      // Ingen human i dmg-listan vid liv → first-respawn-fallback
      sim.juggernautPid = null;
      sim._juggernautAwaitFirstRespawn = true;
    }
    if (newJugPid) {
      // Spawn ny JUG ~400px från liket i random riktning. Tidigare spawnade vi
      // PÅ liket vilket gjorde "JUG-transfer = instant farm" av närvarande
      // hunters (spawn-camp loop). Nu får hunters tid att backa.
      const newWs = sim.room.members.get(newJugPid);
      if (newWs && newWs.playerState && victimWs.playerState) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 400;
        let nx = victimWs.playerState.x + Math.cos(angle) * dist;
        let ny = victimWs.playerState.y + Math.sin(angle) * dist;
        // Klampa till arena-bounds
        nx = Math.max(60, Math.min(JUGGERNAUT_ARENA.worldW - 60, nx));
        ny = Math.max(60, Math.min(JUGGERNAUT_ARENA.worldH - 60, ny));
        newWs.playerState.x = nx;
        newWs.playerState.y = ny;
      }
      transferJug(sim, newJugPid, 'jug_killed');
    }
  } else {
    // Hunter dödad — vanlig respawn
    sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
    victimWs.tdmRespawnAt = Date.now() + 3000;
    sim.eventQueue.push({ type: 'juggernaut_player_died', victim: victimPid, durationMs: 3000, wasJug: false });
  }
}

// Damage-attribution — kallas från bullets.js när hunter skadar JUG.
// Bot-dmg räknas också (för konsistens i siffrorna) men bots kan inte BLI JUG.
function trackJuggernautDmg(sim, shooterPid, victimPid, dmg) {
  if (victimPid !== sim.juggernautPid) return;
  if (shooterPid === sim.juggernautPid) return; // self-dmg (decay/explosion) räknas inte
  sim.juggernautDmgToJug[shooterPid] = (sim.juggernautDmgToJug[shooterPid] || 0) + dmg;
}

function endJuggernautMatch(sim, winnerId, reason) {
  if (sim.juggernautEnded) return;
  sim.juggernautEnded = true;
  sim.juggernautWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p] of sim.room.members) {
    stats.perPlayer[p] = {
      timeAsJug: Math.floor(sim.juggernautScores[p] || 0),
      kills: sim.juggernautKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'juggernaut_match_end',
    winner: winnerId, reason, stats,
  });
}

// ============================================================
// BATTLE ROYALE — "LAST HUNT"
// ============================================================
// FFA, no-respawn. Krympande zon över N min (5/10/15). Loot på marken.
// Sista överlevare vinner. Bot kan vinna (samma rules).
// ============================================================
// CASTLE DEFENSE — co-op endless horde defense
// ============================================================
// Spelare försvarar tillsammans ett centralt castle (8 wall-segment + core)
// mot endless vågor av fiender som spawnar 360° runt utkanten. Bygg + reparera
// mellan attacker. Boss var 5:e våg.

// Beräkna antal fiender per våg (fas 2 scaling)
function cdEnemiesForWave(arena, wave) {
  return arena.waveBaseCount + (wave - 1) * arena.waveScalePerWave;
}

// v1.416: Special wave themes var 3:e wave (skippas vid boss-wave)
const CD_WAVE_THEMES = ['speed_rush', 'bomb_squad', 'sniper_alley', 'elite', 'horde'];
function cdGetWaveTheme(wave, arena) {
  if (wave % (arena.bossEveryWave || 5) === 0) return null;
  if (wave < 3 || wave % 3 !== 0) return null;
  const idx = Math.floor(wave / 3) - 1;
  return CD_WAVE_THEMES[idx % CD_WAVE_THEMES.length];
}
function cdGetThemePool(theme) {
  if (theme === 'speed_rush') return ['runner', 'ninja', 'dog', 'swarmer'];
  if (theme === 'bomb_squad') return ['bomber', 'bomber', 'grunt', 'grunt'];
  if (theme === 'sniper_alley') return ['shooter', 'soldier', 'sniper'];
  return null; // elite/horde använder default-pool
}
function cdGetThemeCountMul(theme) {
  if (theme === 'elite') return 0.55;
  if (theme === 'horde') return 1.8;
  return 1.0;
}
function cdGetThemeStatMul(theme) {
  if (theme === 'elite') return { hp: 1.6, dmg: 1.6, gold: 1.8 };
  return null;
}
function cdGetThemeLabel(theme) {
  if (theme === 'speed_rush') return '⚡ SPEED RUSH';
  if (theme === 'bomb_squad') return '💣 BOMB SQUAD';
  if (theme === 'sniper_alley') return '🎯 SNIPER ALLEY';
  if (theme === 'elite') return '👑 ELITE GUARD';
  if (theme === 'horde') return '🐝 HORDE';
  return null;
}

// v1.415: Returnera enemy-typer som kan spawnas vid en specifik våg (för preview).
function cdGetWavePool(wave) {
  if (wave <= 2) return ['grunt', 'runner'];
  if (wave <= 4) return ['grunt', 'runner', 'swordsman'];
  if (wave <= 6) return ['grunt', 'runner', 'swordsman', 'brute'];
  if (wave <= 9) return ['grunt', 'runner', 'swordsman', 'brute', 'shooter'];
  if (wave <= 12) return ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier'];
  return ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier', 'sniper', 'ninja'];
}

// Pick enemy-type för current våg. Phase 5: mixad pool per våg-band.
// Använder existing enemy-typer; sapper-rollen täcks av 'bomber' (suicide-explode),
// flyer-rollen läggs på 'swarmer'/'dog' med _cdFlyer flag som skippar wall-collision.
function cdPickEnemyType(wave) {
  // Pool definieras per våg-band — bombers pushas till våg 10+ från playtest
  // (50 dmg one-shottar otränat spelare på våg 7 utan warning)
  let pool;
  if (wave <= 2) pool = ['grunt', 'grunt', 'grunt', 'runner'];
  else if (wave <= 4) pool = ['grunt', 'grunt', 'runner', 'runner', 'swordsman'];
  else if (wave <= 6) pool = ['grunt', 'runner', 'swordsman', 'brute'];
  else if (wave <= 9) pool = ['grunt', 'runner', 'swordsman', 'brute', 'shooter'];
  else if (wave <= 12) pool = ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier'];
  else pool = ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier', 'sniper', 'ninja'];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Vissa typer agerar som "flyer" (ignorerar walls i castledefense).
// För variety: 30% av 'swarmer' och 'ninja' markeras som flyers.
function cdMaybeAssignFlyer(e) {
  if ((e.type === 'swarmer' || e.type === 'ninja') && Math.random() < 0.35) {
    e._cdFlyer = true;
  }
}

// Boss-rotation per boss-våg (fas 7)
const CD_BOSS_ROTATION = [
  'witheredelder', 'ironclad', 'mirroredone', 'ossarius', 'vanguardatlas',
  'emberoracle', 'blightsovereign', 'buriedcrown', 'lastsovereign',
];

function cdPickBossKey(wave) {
  // Wave 5 = idx 0, wave 10 = idx 1, etc. Cycle:as runt om hög våg.
  const idx = Math.floor(wave / 5) - 1;
  return CD_BOSS_ROTATION[idx % CD_BOSS_ROTATION.length];
}

// Per-tick uppdatering av alla aktiva castle-defense buildings.
// Auto-turret skjuter, traps skadar/slow:ar, repair-station regenererar walls,
// health-station regenererar spelare.
function updateCastleDefenseBuildings(sim, dt, nowMs) {
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0) continue;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    // === AUTO-TURRET ===
    if (b.kind === 'auto_turret') {
      if (b._fireCd > 0) b._fireCd -= dt;
      // v1.416: STRATEGIST aura — om strategist-player är inom 250px, +35% dmg + range
      let stratMul = 1.0;
      for (const [pid, ws] of sim.room.members) {
        if (sim.castledefensePerks[pid] !== 'strategist') continue;
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const dxs = ws.playerState.x - bcx, dys = ws.playerState.y - bcy;
        if (dxs * dxs + dys * dys <= 250 * 250) { stratMul = 1.35; break; }
      }
      const effRange = b.range * (stratMul > 1 ? 1.2 : 1);
      if (b._fireCd <= 0 && b.range > 0 && b.fireRate > 0) {
        let best = null, bestD = effRange * effRange;
        for (const e of sim.enemies) {
          if (e.dead) continue;
          const dx = e.x - bcx, dy = e.y - bcy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) { bestD = d2; best = e; }
        }
        if (best) {
          // Skjut: dmg = (b.dps / b.fireRate) per bullet, bullet hostile=false (våra)
          const ang = Math.atan2(best.y - bcy, best.x - bcx);
          const SPEED = 700;
          sim.bullets.push({
            x: bcx, y: bcy,
            vx: Math.cos(ang) * SPEED,
            vy: Math.sin(ang) * SPEED,
            dmg: (b.dps / b.fireRate) * stratMul, // v1.416: STRATEGIST +35%
            life: 1.5,
            r: 3,
            color: '#3acaff',
            hostile: false,
            ownerPid: b.ownerPid,
            _autoTurret: true,
          });
          b._fireCd = 1 / b.fireRate;
          // v1.415: emit fire-event så client kan rita muzzle-flash + spela ljud
          sim.eventQueue.push({
            type: 'cd_turret_fired',
            id: b.id,
            x: Math.round(bcx),
            y: Math.round(bcy),
            ang,
          });
        }
      }
    }
    // === SPIKE TRAP === (v1.400: kill-count baserat — efter 3 kills försvinner trapen)
    else if (b.kind === 'spike_trap' && b.dmgOnPass > 0) {
      for (const e of sim.enemies) {
        if (e.dead) continue;
        if (e.x + e.r < b.x || e.x - e.r > b.x + b.w) continue;
        if (e.y + e.r < b.y || e.y - e.r > b.y + b.h) continue;
        e._spikeCdMs = e._spikeCdMs || {};
        if ((e._spikeCdMs[b.id] || 0) > nowMs) continue;
        e._spikeCdMs[b.id] = nowMs + 1200;
        e.hp -= b.dmgOnPass;
        if (e.hp <= 0) {
          e.dead = true;
          // Track kill för spike-trap destruction
          b._spikeKills = (b._spikeKills || 0) + 1;
          const cap = 5; // killCapacity från arena-spec
          // Visual: hp speglar (cap - kills) / cap × maxHp så HP-bar visar uses remaining
          b.hp = Math.max(0, ((cap - b._spikeKills) / cap) * b.maxHp);
          sim.eventQueue.push({
            type: 'cd_building_damaged',
            id: b.id, hp: b.hp, maxHp: b.maxHp,
          });
          if (b._spikeKills >= cap) {
            sim.eventQueue.push({ type: 'cd_building_destroyed', id: b.id });
          }
        }
      }
    }
    // === SLOW TRAP (AOE aura — v1.414) ===
    // v1.417: BUG-FIX — slowUntil måste vara i MILLISEKUNDER (matchar updateStatus's
    // `now` som är Date.now() i ms). Tidigare nowSec gjorde att slow aldrig var aktiv.
    else if (b.kind === 'slow_trap' && b.slowDurSec > 0 && b.radius > 0) {
      const r2 = b.radius * b.radius;
      for (const e of sim.enemies) {
        if (e.dead) continue;
        const dx = e.x - bcx, dy = e.y - bcy;
        if (dx * dx + dy * dy > r2) continue;
        e.slowUntil = nowMs + b.slowDurSec * 1000;
        e.slowFactor = b.slowMul;
      }
    }
    // === REPAIR STATION ===
    else if (b.kind === 'repair_stn' && b.healPerSec > 0 && b.radius > 0) {
      const r2 = b.radius * b.radius;
      for (const w of sim.castledefenseWalls) {
        if (w.hp <= 0 || w.hp >= w.maxHp) continue;
        const wcx = w.x + w.w / 2, wcy = w.y + w.h / 2;
        const dx = wcx - bcx, dy = wcy - bcy;
        if (dx * dx + dy * dy > r2) continue;
        const heal = b.healPerSec * dt;
        w.hp = Math.min(w.maxHp, w.hp + heal);
        if (!w._lastHealBroadcast || nowMs - w._lastHealBroadcast > 250) {
          w._lastHealBroadcast = nowMs;
          sim.eventQueue.push({ type: 'cd_wall_damaged', id: w.id, hp: w.hp, maxHp: w.maxHp });
        }
      }
      for (const b2 of sim.castledefenseBuildings) {
        if (b2 === b || b2.hp <= 0 || b2.hp >= b2.maxHp) continue;
        const b2cx = b2.x + b2.w / 2, b2cy = b2.y + b2.h / 2;
        const dx = b2cx - bcx, dy = b2cy - bcy;
        if (dx * dx + dy * dy > r2) continue;
        b2.hp = Math.min(b2.maxHp, b2.hp + b.healPerSec * dt);
        if (!b2._lastHealBroadcast || nowMs - b2._lastHealBroadcast > 250) {
          b2._lastHealBroadcast = nowMs;
          sim.eventQueue.push({ type: 'cd_building_damaged', id: b2.id, hp: b2.hp, maxHp: b2.maxHp });
        }
      }
      // v1.411: Repair-station healar CORE (extended reach: radius + core.r).
      // v1.413: bara EN repair-stn får heala core per tick (annars stackar
      // multipla stations linjärt = OP-recipe vid 4-5 stations runt core).
      if (sim.castledefenseCore && sim.castledefenseCore.hp > 0 && sim.castledefenseCore.hp < sim.castledefenseCore.maxHp && !sim._cdCoreHealedThisTick) {
        const core = sim.castledefenseCore;
        const dxc = core.x - bcx, dyc = core.y - bcy;
        const reach = b.radius + core.r;
        if (dxc * dxc + dyc * dyc <= reach * reach) {
          // Core får 50% av wall-heal-rate så det inte trivialiserar boss-vågor
          core.hp = Math.min(core.maxHp, core.hp + b.healPerSec * 0.5 * dt);
          sim._cdCoreHealedThisTick = true;
          if (!sim._cdCoreLastHealBroadcast || nowMs - sim._cdCoreLastHealBroadcast > 250) {
            sim._cdCoreLastHealBroadcast = nowMs;
            sim.eventQueue.push({ type: 'cd_core_damaged', hp: core.hp, maxHp: core.maxHp });
          }
        }
      }
    }
    // === HEALTH STATION ===
    else if (b.kind === 'health_stn' && b.playerHealPerSec > 0 && b.radius > 0) {
      const r2 = b.radius * b.radius;
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const ps = ws.playerState;
        if (ps.hp >= (ps.maxHp || 100)) continue;
        const dx = ps.x - bcx, dy = ps.y - bcy;
        if (dx * dx + dy * dy > r2) continue;
        ps.hp = Math.min(ps.maxHp || 100, ps.hp + b.playerHealPerSec * dt);
      }
    }
    // === MANNED TURRET (fas 7 polish) ===
    // För nu: passar som ett extra stort wall-segment. Fas 7 lägger till
    // enter/exit-mekanik + dpsMul när spelare sitter i.
  }
}

// ============================================================
// CASTLE DEFENSE — FLOW FIELD PATHFINDING (v1.398)
// ============================================================
// Pre-computed flow field — BFS från core utåt, lagrar för varje grid-cell
// vilken riktning enemy ska gå för att komma närmast core. Recomputeras vid
// building-place/destroy. Enemies hittar ALLTID väg om sådan finns.
function buildCdFlowField(sim) {
  const arena = CASTLEDEFENSE_ARENA;
  const grid = arena.buildGridSize;             // 30
  const cols = Math.ceil(arena.worldW / grid);
  const rows = Math.ceil(arena.worldH / grid);
  const cellCount = cols * rows;

  // Walkable-map: 1 = går igenom, 0 = blocked
  const walkable = new Uint8Array(cellCount);
  walkable.fill(1);

  // Markera alla solida buildings som blocked (traps är walkable)
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0) continue;
    if (b.kind === 'spike_trap' || b.kind === 'slow_trap') continue;
    const ciStart = Math.floor(b.x / grid);
    const cjStart = Math.floor(b.y / grid);
    const ciEnd = Math.floor((b.x + b.w - 1) / grid);
    const cjEnd = Math.floor((b.y + b.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }
  // Legacy pre-built walls (om några)
  for (const w of sim.castledefenseWalls) {
    if (w.hp <= 0) continue;
    const ciStart = Math.floor(w.x / grid), cjStart = Math.floor(w.y / grid);
    const ciEnd = Math.floor((w.x + w.w - 1) / grid), cjEnd = Math.floor((w.y + w.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }

  // BFS från ALLA cells i en ring runt core (så enemies pathfindar till core-edge)
  const coreCi = Math.floor(arena.centerX / grid);
  const coreCj = Math.floor(arena.centerY / grid);
  const dist = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) dist[i] = -1;
  const queue = new Int32Array(cellCount);
  let qHead = 0, qTail = 0;

  const coreRange = (sim.castledefenseCore ? sim.castledefenseCore.r : 60) + grid;
  const coreRangeCells = Math.ceil(coreRange / grid);
  for (let dci = -coreRangeCells; dci <= coreRangeCells; dci++) {
    for (let dcj = -coreRangeCells; dcj <= coreRangeCells; dcj++) {
      const ci = coreCi + dci, cj = coreCj + dcj;
      if (ci < 0 || ci >= cols || cj < 0 || cj >= rows) continue;
      const cellX = ci * grid + grid / 2;
      const cellY = cj * grid + grid / 2;
      const ddx = cellX - arena.centerX, ddy = cellY - arena.centerY;
      if (ddx * ddx + ddy * ddy <= coreRange * coreRange) {
        const idx = cj * cols + ci;
        dist[idx] = 0;
        queue[qTail++] = idx;
      }
    }
  }

  // 4-dir BFS för Manhattan-distance
  const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qHead < qTail) {
    const idx = queue[qHead++];
    const ci = idx % cols;
    const cj = (idx - ci) / cols;
    const d = dist[idx];
    for (const [dx, dy] of nb4) {
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
      const nIdx = nj * cols + ni;
      if (!walkable[nIdx]) continue;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = d + 1;
      queue[qTail++] = nIdx;
    }
  }

  // Post-process: för varje walkable cell, hitta 8-dir neighbor med lägst dist.
  // Det är riktningen mot core (jämnare paths än ren 4-dir).
  const nextStep = new Int8Array(cellCount * 2);
  const nb8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      const idx = cj * cols + ci;
      if (dist[idx] === -1) { nextStep[idx * 2] = 0; nextStep[idx * 2 + 1] = 0; continue; }
      if (dist[idx] === 0) { nextStep[idx * 2] = 0; nextStep[idx * 2 + 1] = 0; continue; }
      let bestDist = dist[idx], bestDx = 0, bestDy = 0;
      for (const [dx, dy] of nb8) {
        const ni = ci + dx, nj = cj + dy;
        if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
        const nIdx = nj * cols + ni;
        if (dist[nIdx] === -1) continue;
        // Diagonal: kräv att båda ortogonala är walkable (annars cuttar vi hörn)
        if (dx !== 0 && dy !== 0) {
          if (!walkable[cj * cols + ni] || !walkable[nj * cols + ci]) continue;
        }
        if (dist[nIdx] < bestDist) {
          bestDist = dist[nIdx];
          bestDx = dx; bestDy = dy;
        }
      }
      nextStep[idx * 2] = bestDx;
      nextStep[idx * 2 + 1] = bestDy;
    }
  }

  return { cols, rows, grid, dist, nextStep, coreCi, coreCj };
}

function cdFlowLookup(field, x, y) {
  if (!field) return null;
  const ci = Math.floor(x / field.grid);
  const cj = Math.floor(y / field.grid);
  if (ci < 0 || ci >= field.cols || cj < 0 || cj >= field.rows) return null;
  const idx = cj * field.cols + ci;
  if (field.dist[idx] === -1) return null;       // unreachable
  return {
    dx: field.nextStep[idx * 2],
    dy: field.nextStep[idx * 2 + 1],
    dist: field.dist[idx],
  };
}

// === DOWN-STATE + REVIVE-SYSTEM (fas 6) ===
// Spelare med hp <= 0 går till crawl-state istället för att dö direkt.
// 30s bleed-out timer. Lagkamrat står över i 5s → revive med 50hp.
// Bleed-out → real death; respawn vid next wave-start.
function updateCastleDefenseDownState(sim, dt, nowMs) {
  const arena = CASTLEDEFENSE_ARENA;
  // Steg 1: Spelare som just blev "döda" → enter down-state istället
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    const ps = ws.playerState;
    if (ps.hp <= 0 && !ps.cdDowned && !ps.cdDownDead) {
      // Enter down-state
      ps.cdDowned = true;
      ps.cdDownStartedAt = nowMs;
      ps.cdDownReviveProgress = 0;
      ps.hp = 1; // hold at 1 hp så player_died-detektion ej triggar
      ps._cdPrevWeapon = ps.weaponId;
      ps.weaponId = 'knife';
      ps._cdPrevSpeedMul = ps.speedMul;
      ps.speedMul = arena.downCrawlSpeedMul || 0.35;
      // Invulnerable under hela bleed-out — bleed-out timer är danger:n, inte enemies.
      // Sätts om vid revive (2s grace) eller cdDownDead (respawn-grace).
      ps.invulnUntil = nowMs + ((arena.downBleedoutSec || 30) * 1000) + 1000;
      sim.eventQueue.push({
        type: 'cd_player_downed',
        peerId: pid,
        x: Math.round(ps.x), y: Math.round(ps.y),
      });
      sim.castledefenseDownedPids = sim.castledefenseDownedPids || [];
      if (!sim.castledefenseDownedPids.includes(pid)) sim.castledefenseDownedPids.push(pid);
    }
  }
  // Steg 2: Tickar för aktiv down-state — bleed-out + revive
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || !ws.playerState.cdDowned) continue;
    const ps = ws.playerState;
    // Bleed-out timer
    const elapsedSec = (nowMs - ps.cdDownStartedAt) / 1000;
    const bleedoutSec = arena.downBleedoutSec || 30;
    if (elapsedSec >= bleedoutSec) {
      // Real death (respawn vid next wave)
      ps.cdDowned = false;
      ps.cdDownDead = true;
      ps.hp = 0;
      sim.eventQueue.push({
        type: 'cd_player_died_out',
        peerId: pid,
      });
      continue;
    }
    // Sök efter lagkamrat inom downReviveRadius för revive
    const reviveRadius = arena.downReviveRadius || 60;
    const reviveR2 = reviveRadius * reviveRadius;
    let reviverPid = null;
    let reviverWs = null;
    for (const [pid2, ws2] of sim.room.members) {
      if (pid2 === pid) continue;
      if (!ws2.playerState || ws2.playerState.hp <= 0) continue;
      if (ws2.playerState.cdDowned) continue; // downade kan inte revive
      const dx = ws2.playerState.x - ps.x;
      const dy = ws2.playerState.y - ps.y;
      if (dx * dx + dy * dy < reviveR2) {
        reviverPid = pid2;
        reviverWs = ws2;
        break;
      }
    }
    if (reviverPid) {
      ps.cdDownReviveProgress = (ps.cdDownReviveProgress || 0) + dt;
      const reviveSec = arena.downReviveSec || 5;
      // Broadcast progress event (~5Hz)
      if (!ps._cdLastReviveBroadcast || nowMs - ps._cdLastReviveBroadcast > 200) {
        ps._cdLastReviveBroadcast = nowMs;
        sim.eventQueue.push({
          type: 'cd_revive_progress',
          peerId: pid,
          reviverPid,
          progress: Math.min(1, ps.cdDownReviveProgress / reviveSec),
        });
      }
      if (ps.cdDownReviveProgress >= reviveSec) {
        // REVIVED!
        ps.cdDowned = false;
        ps.cdDownStartedAt = 0;
        ps.cdDownReviveProgress = 0;
        ps.hp = Math.min(ps.maxHp || 100, 50);
        ps.weaponId = ps._cdPrevWeapon || arena.startWeapon;
        ps.speedMul = ps._cdPrevSpeedMul || 1.0;
        ps.invulnUntil = nowMs + 2000;
        sim.castledefenseRevivedCount += 1;
        sim.castledefenseDownedPids = (sim.castledefenseDownedPids || []).filter(p => p !== pid);
        sim.eventQueue.push({
          type: 'cd_player_revived',
          peerId: pid,
          reviverPid,
        });
      }
    } else {
      // Ingen revives → reset progress
      if ((ps.cdDownReviveProgress || 0) > 0) {
        ps.cdDownReviveProgress = Math.max(0, ps.cdDownReviveProgress - dt * 0.5);
      }
    }
  }
  // Steg 3: Respawn döda spelare vid next wave-start
  if (sim.castledefenseWaveState === 'active' && sim._cdLastWaveProcessed !== sim.castledefenseWave) {
    sim._cdLastWaveProcessed = sim.castledefenseWave;
    // Vid wave-start: alla cdDownDead spelare respawnar vid core
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || !ws.playerState.cdDownDead) continue;
      const ps = ws.playerState;
      ps.cdDownDead = false;
      ps.hp = ps.maxHp || 100;
      ps.x = sim.castledefenseCore ? sim.castledefenseCore.x : arena.centerX;
      ps.y = sim.castledefenseCore ? sim.castledefenseCore.y : arena.centerY;
      ps.weaponId = ps._cdPrevWeapon || arena.startWeapon;
      ps.speedMul = 1.0;
      ps.invulnUntil = nowMs + 3000;
      sim.eventQueue.push({
        type: 'cd_player_respawned',
        peerId: pid,
        wave: sim.castledefenseWave,
      });
    }
  }
}

function tickCastleDefense(sim, dt, now) {
  const nowMs = Date.now();
  const arena = CASTLEDEFENSE_ARENA;

  if (sim.castledefenseEnded) return;

  // === FLOW FIELD: bygg/rebygg om dirty ===
  if (sim._cdFlowDirty || !sim._cdFlowField) {
    sim._cdFlowField = buildCdFlowField(sim);
    sim._cdFlowDirty = false;
  }

  // Bygg alive-walls + buildings för collision-checks.
  // v1.398: ALLA non-trap buildings är solida (per user feedback "gå inte igenom föremålen").
  // Bara spike_trap + slow_trap är walkable (de skadar vid overlap).
  const cdLiveWalls = sim.castledefenseWalls.filter(w => w.hp > 0);
  const cdLiveBuildings = sim.castledefenseBuildings.filter(b => b.hp > 0);
  const cdSolidBuildings = cdLiveBuildings.filter(b =>
    b.kind !== 'spike_trap' && b.kind !== 'slow_trap');
  const cdAllSolids = cdLiveWalls.concat(cdSolidBuildings);

  // === PLAYER COLLISION (v1.410: walls/turrets BLOCKERAR player igen — user-feedback)
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      // v1.410: player kan INTE längre gå genom egna walls. Samma collision-set
      // som enemies (alla solida non-trap buildings).
      resolveCtfWall(ent, cdAllSolids);
      // Core är en CIRKEL — alltid blockerad.
      if (sim.castledefenseCore && sim.castledefenseCore.hp > 0) {
        const core = sim.castledefenseCore;
        const dx = ent.x - core.x, dy = ent.y - core.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const minD = core.r + ent.r;
        if (d < minD && d > 0.01) {
          ent.x = core.x + (dx / d) * minD;
          ent.y = core.y + (dy / d) * minD;
        } else if (d < 0.01) {
          ent.x = core.x + minD;
        }
      }
      ent.x = Math.max(20, Math.min(arena.worldW - 20, ent.x));
      ent.y = Math.max(20, Math.min(arena.worldH - 20, ent.y));
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  // === WAVE STATE MACHINE ===
  if (sim.castledefenseWaveState === 'between' && nowMs >= sim.castledefenseWaveBetweenEndAt) {
    // Starta nästa våg
    sim.castledefenseWaveState = 'active';
    sim.castledefenseWave += 1;
    const w = sim.castledefenseWave;
    const isBoss = w % arena.bossEveryWave === 0;
    // v1.416: special wave-theme (var 3:e wave, skippas vid boss)
    const theme = cdGetWaveTheme(w, arena);
    sim._cdActiveTheme = theme;
    if (isBoss) {
      const bossKey = cdPickBossKey(w);
      const sp = arena.enemySpawns[Math.floor(Math.random() * arena.enemySpawns.length)];
      const coopMul = Math.max(1, sim.room.members.size);
      const boss = makeBoss(bossKey, sp.x, sp.y, coopMul);
      if (boss) {
        // v1.418: applicera difficulty på BOSS också (saknades helt — boss
        // var lika svår på casual som på hardcore). casual extra-rabatt 0.8
        // ovanpå sin diff-mul så boss inte överraskningskillar nybörjare.
        const bDiff = cdGetDiffMul(sim.config.difficulty);
        const casualBossRelief = sim.config.difficulty === 'casual' ? 0.7 : 1.0;
        boss.hp = Math.max(1, Math.round(boss.hp * bDiff.enemyHp * casualBossRelief));
        boss.maxHp = boss.hp;
        boss.dmg = Math.max(1, Math.round(boss.dmg * bDiff.enemyDmg * casualBossRelief));
        if (boss.bulletDmg) boss.bulletDmg = Math.max(1, Math.round(boss.bulletDmg * bDiff.enemyDmg * casualBossRelief));
        boss._idx = sim.nextEnemyIdx++;
        boss._cdEnemy = true;
        boss._cdBossWave = w;
        sim.enemies.push(boss);
        sim.bossAlive = true;
        sim.eventQueue.push({
          type: 'boss_spawned',
          bossKey,
          name: boss.name,
          sub: boss.subtitle,
        });
      }
      sim._cdWaveSpawnsRemaining = 3 + Math.floor(w / 5);
    } else {
      const base = cdEnemiesForWave(arena, w);
      const countMul = cdGetThemeCountMul(theme);
      sim._cdWaveSpawnsRemaining = Math.max(1, Math.round(base * countMul));
    }
    sim._cdWaveSpawnTimer = 0;
    sim.eventQueue.push({
      type: 'cd_wave_started',
      wave: w,
      enemiesIncoming: sim._cdWaveSpawnsRemaining,
      isBoss,
      theme,
      themeLabel: cdGetThemeLabel(theme),
    });
  }

  // === SPAWN ENEMIES (under active-fasen) ===
  if (sim.castledefenseWaveState === 'active' && sim._cdWaveSpawnsRemaining > 0) {
    sim._cdWaveSpawnTimer -= dt;
    if (sim._cdWaveSpawnTimer <= 0 && sim.enemies.length < ENEMY_CAP) {
      const sp = arena.enemySpawns[Math.floor(Math.random() * arena.enemySpawns.length)];
      // v1.416: theme override pool
      const themePool = cdGetThemePool(sim._cdActiveTheme);
      const type = themePool ? themePool[Math.floor(Math.random() * themePool.length)] : cdPickEnemyType(sim.castledefenseWave);
      const e = makeEnemy(type, sp.x, sp.y);
      e._idx = sim.nextEnemyIdx++;
      e._cdEnemy = true;
      cdMaybeAssignFlyer(e);
      // v1.407: scale by difficulty + wave + co-op (samma formel som story-mode)
      const cdWaveScale = 1 + (sim.castledefenseWave - 1) * 0.08;
      const cdDiff = cdGetDiffMul(sim.config.difficulty);
      // v1.417: STRIKT linear coop-scaling — 2p=2x, 3p=3x, 4p=4x både HP + DMG
      const cdCoop = Math.max(1, sim.room.members.size);
      // v1.416: theme stat-multiplier (ELITE = +60% hp/dmg/gold)
      const themeStat = cdGetThemeStatMul(sim._cdActiveTheme);
      const themeHpMul = themeStat ? themeStat.hp : 1.0;
      const themeDmgMul = themeStat ? themeStat.dmg : 1.0;
      const themeGoldMul = themeStat ? themeStat.gold : 1.0;
      e.hp = Math.round(e.hp * cdWaveScale * cdDiff.enemyHp * cdCoop * themeHpMul);
      e.maxHp = e.hp;
      e.dmg = Math.round(e.dmg * cdWaveScale * cdDiff.enemyDmg * cdCoop * themeDmgMul);
      if (e.bulletDmg) e.bulletDmg = Math.round(e.bulletDmg * cdDiff.enemyDmg * cdCoop * themeDmgMul);
      if (e.gold) e.gold = Math.round(e.gold * themeGoldMul);
      // v1.410: speed-buff för "fast" enemy-typer — gör dem REALA hot. User-feedback
      // "vissa fiender ännu snabbare". runner/ninja/dog/swarmer +35%.
      if (type === 'runner' || type === 'ninja' || type === 'dog' || type === 'swarmer') {
        e.speed = Math.round(e.speed * 1.35);
      } else if (type === 'bomber') {
        e.speed = Math.round(e.speed * 1.15);
      }
      e._origSpeed = e.speed;
      // 50/50 role: attacker (target player) vs siege (target buildings/core)
      e._cdRole = Math.random() < 0.5 ? 'attacker' : 'siege';
      sim.enemies.push(e);
      sim._cdWaveSpawnsRemaining -= 1;
      // v1.411: snabbare spawn-rate. Base 0.7→0.45, floor 0.25→0.12.
      sim._cdWaveSpawnTimer = Math.max(0.12, 0.45 - sim.castledefenseWave * 0.025)
        + Math.random() * 0.15;
    }
  }

  // === BUILDINGS RUNTIME — auto-turret fire, traps, repair/health stations ===
  if (sim.castledefenseBuildings.length > 0) {
    sim._cdCoreHealedThisTick = false; // v1.413: reset per tick — cap multi-repair-stack
    updateCastleDefenseBuildings(sim, dt, nowMs);
  }

  // v1.416: MEDIC auto-regen (2 hp/s) — per-player perk-effect
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) continue;
    if (sim.castledefensePerks[pid] === 'medic') {
      const maxH = ws.playerState.maxHp || 100;
      if (ws.playerState.hp < maxH) {
        ws.playerState.hp = Math.min(maxH, ws.playerState.hp + 2 * dt);
      }
    }
  }

  // === DOWN-STATE + REVIVE (fas 6) ===
  updateCastleDefenseDownState(sim, dt, nowMs);

  // === ENEMY AI + COLLISION + ATTACK ===
  // v1.401: Fienderna delas i två roller:
  //  - 'siege' (50%): targetar närmaste player-built solid building → core
  //  - 'attacker' (50%): targetar närmaste LEVANDE player → core
  //  Flyers + bossar går alltid rakt mot core (för dramatik).
  const corePos = sim.castledefenseCore;
  // Pre-compute lista av solida buildings (samma filter som collision)
  const cdSolidsForTarget = cdLiveBuildings.filter(b =>
    b.kind !== 'spike_trap' && b.kind !== 'slow_trap');
  // Pre-compute alive players (real, not bots — bots are members too)
  const cdAlivePlayers = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (ws.playerState.cdDowned) continue; // downed räknas inte som mål
    cdAlivePlayers.push({ peerId: pid, x: ws.playerState.x, y: ws.playerState.y });
  }
  for (const e of sim.enemies) {
    if (e.dead) continue;
    let target;
    // v1.411: Ranged enemies (shooter/soldier/sniper) ALLTID siege-role — skjuter
    // mot torn istället för att jaga players. Annars stannar de aldrig vid turrets.
    const isRangedType = (e.type === 'shooter' || e.type === 'soldier' || e.type === 'sniper');
    if (e._cdFlyer || e.isBoss) {
      // Flyers + bossar: rakt mot core
      target = corePos ? {
        peerId: '__core__', _isCoreTarget: true,
        x: corePos.x, y: corePos.y,
        hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60,
      } : { x: 2000, y: 2000, hp: 99999, r: 60, peerId: '__core__', invulnUntil: 0 };
    } else if (!isRangedType && e._cdRole === 'attacker' && cdAlivePlayers.length > 0) {
      // Attacker: target nearest alive player
      let bestPlayer = null, bestPD2 = Infinity;
      for (const p of cdAlivePlayers) {
        const dx = p.x - e.x, dy = p.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestPD2) { bestPD2 = d2; bestPlayer = p; }
      }
      if (bestPlayer) {
        // Reset aim om target bytte (annars sniper låser på död spelare)
        const newTargetId = '__player_' + bestPlayer.peerId;
        if (e._cdLastTargetId && e._cdLastTargetId !== newTargetId) {
          e.aiming = false; e.aimAt = 0;
        }
        e._cdLastTargetId = newTargetId;
        target = {
          peerId: newTargetId, _isCoreTarget: false,
          x: bestPlayer.x, y: bestPlayer.y,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14,
        };
      } else {
        // Fallback: core. Uppdatera _cdLastTargetId så aim resetas vid nästa byte.
        if (e._cdLastTargetId !== '__core__') {
          e.aiming = false; e.aimAt = 0;
        }
        e._cdLastTargetId = '__core__';
        target = corePos ? {
          peerId: '__core__', _isCoreTarget: true,
          x: corePos.x, y: corePos.y,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60,
        } : null;
      }
    } else {
      // Andra fiender: hitta NÄRMSTA player-built solid building som är "på vägen"
      // mot core (filter: building är närmare core än enemy). Annars skulle shooters
      // skjuta walls långt åt sidan istället för core-relaterade defenser.
      let nearestBuild = null, nearestD2 = Infinity;
      const dxEC = corePos ? (corePos.x - e.x) : 0;
      const dyEC = corePos ? (corePos.y - e.y) : 0;
      const dEC2 = dxEC * dxEC + dyEC * dyEC;
      for (const b of cdSolidsForTarget) {
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        // Filter: building måste vara närmare core än enemy (= "på vägen")
        if (corePos) {
          const dxBC = bcx - corePos.x, dyBC = bcy - corePos.y;
          if (dxBC * dxBC + dyBC * dyBC > dEC2) continue;
        }
        const dx = bcx - e.x, dy = bcy - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearestBuild = b; }
      }
      if (nearestBuild) {
        // v1.400-fix: om enemy bytte target mid-aim → reset aim-state så sniper
        // inte slutför lock-on på fel mål
        const newTargetId = '__target_' + nearestBuild.id;
        if (e._cdLastTargetId && e._cdLastTargetId !== newTargetId) {
          e.aiming = false;
          e.aimAt = 0;
        }
        e._cdLastTargetId = newTargetId;
        target = {
          peerId: newTargetId, _isCoreTarget: true,
          x: nearestBuild.x + nearestBuild.w / 2,
          y: nearestBuild.y + nearestBuild.h / 2,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14,
        };
      } else {
        // Inga defenses kvar → core
        target = corePos ? {
          peerId: '__core__', _isCoreTarget: true,
          x: corePos.x, y: corePos.y,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60,
        } : { x: 2000, y: 2000, hp: 99999, r: 60, peerId: '__core__', invulnUntil: 0 };
      }
    }
    const players = [target];
    if (e.isBoss) {
      updateBoss(sim, e, dt, now, players);
    } else {
      updateEnemy(e, dt, now, sim, players);
    }
    // v1.400: Melee contact-damage på REAL players (eftersom AI targetar fake-building,
    // skulle riktiga spelare annars vara osårbara från melee). Skadar player om
    // enemy överlappar dem + cooldown + respect invuln + cdDowned.
    if (!e._cdFlyer && (e.dmg || 0) > 0) {
      if (e._cdPlayerContactCd > 0) e._cdPlayerContactCd -= dt;
      else e._cdPlayerContactCd = 0;
      if (e._cdPlayerContactCd <= 0) {
        for (const [, wsP] of sim.room.members) {
          if (!wsP.playerState || wsP.playerState.hp <= 0) continue;
          if (wsP.playerState.cdDowned) continue;
          const psP = wsP.playerState;
          if (Date.now() < (psP.invulnUntil || 0)) continue;
          const ddx = psP.x - e.x, ddy = psP.y - e.y;
          const rsumP = (e.r || 12) + 14;
          if (ddx * ddx + ddy * ddy < rsumP * rsumP) {
            // v1.403: shield absorberar först
            let remaining = e.dmg;
            if ((psP.shield || 0) > 0) {
              const absorb = Math.min(psP.shield, remaining);
              psP.shield -= absorb;
              remaining -= absorb;
            }
            if (remaining > 0) psP.hp = Math.max(0, psP.hp - remaining);
            psP.invulnUntil = Date.now() + 500;
            e._cdPlayerContactCd = 0.7;
            // v1.404: broadcast hp+shield-ändring så klient ser shield-droppen
            // Hitta pid via reverse-lookup (psP är ws.playerState)
            for (const [pidLookup, wsLookup] of sim.room.members) {
              if (wsLookup.playerState === psP) {
                sim.eventQueue.push({
                  type: 'cd_hp_changed', peerId: pidLookup,
                  hp: psP.hp, shield: psP.shield || 0,
                });
                break;
              }
            }
            break;
          }
        }
      }
    }
    // Bounds-clamp
    e.x = Math.max(20, Math.min(arena.worldW - 20, e.x));
    e.y = Math.max(20, Math.min(arena.worldH - 20, e.y));
    // Wall-collision för enemies (skippa flyers — de ignorerar walls).
    if (!e._cdFlyer) {
      resolveCtfWall(e, cdAllSolids);
    }
    // Core circle-collision för ALLA fiender (även flyers — annars kan de attacka
    // core från insidan). v1.398-fix: d=0 fallback för enemy också.
    if (sim.castledefenseCore && sim.castledefenseCore.hp > 0) {
      const core = sim.castledefenseCore;
      const dxe = e.x - core.x, dye = e.y - core.y;
      const de = Math.sqrt(dxe * dxe + dye * dye);
      const minDe = core.r + e.r;
      if (de < minDe && de > 0.01) {
        e.x = core.x + (dxe / de) * minDe;
        e.y = core.y + (dye / de) * minDe;
      } else if (de <= 0.01) {
        // Exakt på center — pusha åt höger
        e.x = core.x + minDe;
      }
    }
    // Attack-timer
    if (e._cdAttackCd > 0) e._cdAttackCd -= dt;
    else e._cdAttackCd = 0;
    // === ENEMY ATTACK PÅ WALL/CORE ===
    // v1.400 fix: skippa redan-döda targets (mid-tick destruction från attack-loop
    // skulle annars trigga dubbel destroy-event)
    let attackTarget = null;
    // Pass 1: prioriterade target (walls, turrets — saker som blockerar path)
    for (const w of cdAllSolids) {
      if (w.hp <= 0) continue;
      if (w.kind !== 'wall' && w.kind !== 'castle_wall' && w.kind !== 'auto_turret' && w.kind !== 'man_turret') continue;
      const cx2 = Math.max(w.x, Math.min(e.x, w.x + w.w));
      const cy2 = Math.max(w.y, Math.min(e.y, w.y + w.h));
      const dx2 = e.x - cx2, dy2 = e.y - cy2;
      if (dx2 * dx2 + dy2 * dy2 < (e.r + 1) * (e.r + 1)) {
        attackTarget = w;
        break;
      }
    }
    // Pass 2: stations (repair/health) bara om inget mur/turret i kontakt
    if (!attackTarget) {
      for (const w of cdAllSolids) {
        if (w.hp <= 0) continue;
        const cx2 = Math.max(w.x, Math.min(e.x, w.x + w.w));
        const cy2 = Math.max(w.y, Math.min(e.y, w.y + w.h));
        const dx2 = e.x - cx2, dy2 = e.y - cy2;
        if (dx2 * dx2 + dy2 * dy2 < (e.r + 1) * (e.r + 1)) {
          attackTarget = w;
          break;
        }
      }
    }
    // Eller core om i kontakt (om enemy lyckats nå inre)
    if (!attackTarget && sim.castledefenseCore && sim.castledefenseCore.hp > 0) {
      const core = sim.castledefenseCore;
      const dx3 = e.x - core.x, dy3 = e.y - core.y;
      const minD = e.r + core.r + 2;
      if (dx3 * dx3 + dy3 * dy3 < minD * minD) {
        attackTarget = core;
      }
    }
    if (attackTarget && e._cdAttackCd <= 0) {
      const isCore = (attackTarget === sim.castledefenseCore);
      // Robust kind-check: walls har kind='castle_wall', byggnader har kind matching buildable-key
      const isBuild = !isCore && attackTarget.kind && attackTarget.kind !== 'castle_wall';
      // Damage per attack (grunt=5 baseline)
      const dmg = e.dmg || 5;
      attackTarget.hp = Math.max(0, attackTarget.hp - dmg);
      e._cdAttackCd = 0.8; // attack-cooldown
      sim.eventQueue.push({
        type: isCore ? 'cd_core_damaged' : (isBuild ? 'cd_building_damaged' : 'cd_wall_damaged'),
        id: isCore ? 'core' : attackTarget.id,
        hp: attackTarget.hp,
        maxHp: attackTarget.maxHp,
      });
      if (attackTarget.hp <= 0) {
        // Solid building/wall förstörd → flow field måste recomputeras
        if (!isCore && (!attackTarget.kind || (attackTarget.kind !== 'spike_trap' && attackTarget.kind !== 'slow_trap'))) {
          sim._cdFlowDirty = true;
        }
        sim.eventQueue.push({
          type: isCore ? 'cd_core_destroyed' : (isBuild ? 'cd_building_destroyed' : 'cd_wall_destroyed'),
          id: isCore ? 'core' : attackTarget.id,
        });
      }
    }
  }

  // Spatial grid (för bullet-collision)
  sim.enemyGrid.clear();
  for (const e of sim.enemies) {
    if (!e.dead) sim.enemyGrid.insert(e);
  }

  // v1.398: Fienderna targetar fake-core, ej real players. Ingen player-writeback
  // behövs (fake-core hp är dummy). Behåll deadBodies-init för andra systems.
  if (!sim.deadBodies) sim.deadBodies = {};

  // === BULLETS ===
  updateBullets(sim, dt, now);

  // === HAZARDS (gas clouds, flame trails) — för bossar med gas_sniper/avatar powers ===
  if ((sim.gasClouds && sim.gasClouds.length) || (sim.flameTrails && sim.flameTrails.length)) {
    // Bygg lista av riktiga spelare för hazard-skada (gas/eld måste kunna skada players)
    const realPlayers = buildPlayerList(sim);
    updateHazards(sim, dt, now, realPlayers);
    // Writeback från hazard-damage
    for (const p of realPlayers) {
      if (p._tookDamageFrom) {
        const ws = sim.room.members.get(p.peerId);
        if (ws && ws.playerState) {
          ws.playerState.hp = p.hp;
          ws.playerState.invulnUntil = p.invulnUntil;
        }
      }
    }
  }

  // === CORE HP-CHECK (game over) ===
  if (sim.castledefenseCore && sim.castledefenseCore.hp <= 0 && !sim.castledefenseEnded) {
    sim.castledefenseEnded = true;
    sim.eventQueue.push({
      type: 'cd_ended',
      reason: 'core_destroyed',
      wave: sim.castledefenseWave,
      survivedSec: Math.round((nowMs - sim.castledefenseStartedAt) / 1000),
    });
    return;
  }

  // === ENEMY DEATH DROP-EVENTS ===
  if (sim.enemies.some(e => e.dead)) {
    for (const e of sim.enemies) {
      if (!e.dead) continue;
      // Drop pickup (gold etc.) — använd standard pipeline
      dropFromEnemyDeath(sim, e);
      // v1.401: Boss-kill = weapon upgrade för ALLA levande spelare
      if (e.isBoss) {
        sim.bossAlive = false;
        const progression = arena.weaponProgression || ['pistol'];
        for (const [pid, ws] of sim.room.members) {
          if (!ws.playerState) continue;
          if (ws._isBot) continue;          // bots skippas — egen AI hanterar inte uppgraderade vapen
          const oldTier = sim.castledefenseWeaponTier[pid] || 0;
          const newTier = Math.min(progression.length - 1, oldTier + 1);
          if (newTier !== oldTier) {
            sim.castledefenseWeaponTier[pid] = newTier;
            const newWeapon = progression[newTier];
            ws.playerState.weaponId = newWeapon;
            sim.eventQueue.push({
              type: 'cd_weapon_upgraded',
              peerId: pid,
              tier: newTier,
              weaponId: newWeapon,
              maxed: newTier === progression.length - 1,
            });
          } else if (oldTier === progression.length - 1) {
            // Redan på max — emit "maxed"-event så client kan visa feedback
            sim.eventQueue.push({
              type: 'cd_weapon_upgraded',
              peerId: pid,
              tier: oldTier,
              weaponId: progression[oldTier],
              maxed: true,
              noChange: true,
            });
          }
        }
      }
      sim.eventQueue.push({
        type: 'enemy_killed',
        i: e._idx,
        gold: e.gold || 0,
        killerPid: e.lastDamagerPid || null,
        isBoss: !!e.isBoss,
        isMiniBoss: !!e.isMiniBoss,
      });
      // Score + per-match gold-grant
      if (e.lastDamagerPid) {
        sim.castledefenseScores[e.lastDamagerPid] = (sim.castledefenseScores[e.lastDamagerPid] || 0) + 1;
        // v1.416: LOOTER perk +60% gold, GAMBLER 15% chans bonus
        const killerPerk = sim.castledefensePerks[e.lastDamagerPid];
        let goldGain = e.gold || 0;
        if (killerPerk === 'looter') goldGain = Math.round(goldGain * 1.6);
        if (killerPerk === 'gambler' && Math.random() < 0.15) {
          const r = Math.random();
          if (r < 0.34) {
            goldGain *= 3;
            sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'gold' });
          } else if (r < 0.67) {
            sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'grenade' });
          } else {
            const lwsk = sim.room.members.get(e.lastDamagerPid);
            if (lwsk && lwsk.playerState) {
              lwsk.playerState.shield = lwsk.playerState.maxShield || 100;
              sim.eventQueue.push({ type: 'cd_hp_changed', peerId: e.lastDamagerPid, hp: lwsk.playerState.hp, shield: lwsk.playerState.shield });
              sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'shield' });
            }
          }
        }
        if (goldGain > 0) {
          // Boss-gold splittas mellan ALLA levande spelare (annars ger 500-3000g till 1 spelare = swingar ekonomi).
          // Vanliga enemies: bara killer får gold.
          if (e.isBoss) {
            const alivePids = [];
            for (const [pid, ws] of sim.room.members) {
              if (ws.playerState && ws.playerState.hp > 0) alivePids.push(pid);
            }
            const share = alivePids.length > 0 ? Math.floor(goldGain / alivePids.length) : goldGain;
            for (const pid of alivePids) {
              sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + share;
              sim.eventQueue.push({
                type: 'cd_gold_update', peerId: pid, gold: sim.castledefenseGold[pid], delta: share,
              });
            }
          } else {
            sim.castledefenseGold[e.lastDamagerPid] = (sim.castledefenseGold[e.lastDamagerPid] || 0) + goldGain;
            sim.eventQueue.push({
              type: 'cd_gold_update', peerId: e.lastDamagerPid, gold: sim.castledefenseGold[e.lastDamagerPid], delta: goldGain,
            });
          }
        }
      }
    }
    sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // === PICKUPS-UPDATE (gold/HP/ammo) ===
  updatePickups(sim, dt, now);

  // === WAVE COMPLETE? ===
  if (sim.castledefenseWaveState === 'active' &&
      sim._cdWaveSpawnsRemaining <= 0 &&
      sim.enemies.length === 0) {
    sim.castledefenseWaveState = 'between';
    sim.castledefenseWaveBetweenEndAt = nowMs + arena.waveBetweenSec * 1000;
    const nextWave = sim.castledefenseWave + 1;
    const nextIsBoss = nextWave % arena.bossEveryWave === 0;
    const nextTheme = cdGetWaveTheme(nextWave, arena);
    const themePool = cdGetThemePool(nextTheme);
    const nextPool = themePool || cdGetWavePool(nextWave);
    const baseCount = cdEnemiesForWave(arena, nextWave);
    const nextCount = nextIsBoss ? (3 + Math.floor(nextWave / 5) + 1) : Math.round(baseCount * cdGetThemeCountMul(nextTheme));
    const nextBossKey = nextIsBoss ? cdPickBossKey(nextWave) : null;
    sim.eventQueue.push({
      type: 'cd_wave_complete',
      wave: sim.castledefenseWave,
      nextWaveInSec: arena.waveBetweenSec,
      nextIsBoss, nextWave, nextPool, nextCount, nextBossKey,
      nextTheme, nextThemeLabel: cdGetThemeLabel(nextTheme),
    });
    // Wave-clear gold-bonus + grenades + shield-regen så player är redo för nästa våg
    const bonus = (arena.waveBonusBase || 150) + sim.castledefenseWave * (arena.waveBonusPerWave || 30);
    const grenadeGrant = arena.grenadesPerWave || 2;
    const shieldRegen = arena.shieldRegenPerWave || 50;
    for (const [pid, ws] of sim.room.members) {
      sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + bonus;
      // v1.403: shield regen
      if (ws.playerState) {
        const max = ws.playerState.maxShield || arena.maxShield || 100;
        ws.playerState.shield = Math.min(max, (ws.playerState.shield || 0) + shieldRegen);
      }
      sim.eventQueue.push({
        type: 'cd_wave_bonus',
        peerId: pid,
        gold: bonus,
        totalGold: sim.castledefenseGold[pid],
        grenades: grenadeGrant,
        shieldRegen,
        shield: ws.playerState ? ws.playerState.shield : 0,
        wave: sim.castledefenseWave,
      });
    }
  }

  // === HEARTBEAT BROADCAST FÖR HUD (varje 500ms) ===
  if (nowMs - (sim._cdHudBroadcastAt || 0) > 500) {
    sim._cdHudBroadcastAt = nowMs;
    sim.eventQueue.push({
      type: 'cd_hud_update',
      wave: sim.castledefenseWave,
      waveState: sim.castledefenseWaveState,
      enemiesAlive: sim.enemies.length,
      enemiesIncoming: sim._cdWaveSpawnsRemaining,
      coreHp: sim.castledefenseCore ? sim.castledefenseCore.hp : 0,
      coreMaxHp: sim.castledefenseCore ? sim.castledefenseCore.maxHp : 0,
      waveBetweenEndAt: sim.castledefenseWaveBetweenEndAt,
    });
  }
}

function tickBattleRoyale(sim, dt, now) {
  const nowMs = Date.now();
  const arena = BATTLEROYALE_ARENA;

  // Match-end? Skip game-logic men fortsätt broadcasta för spec-mode.
  if (sim.battleroyaleEnded) return;

  // Wall-collision för LEVANDE spelare (BR är no-respawn, dead = spectator)
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(ent, arena.walls);
      // Klamp till arena-bounds
      ent.x = Math.max(20, Math.min(arena.worldW - 20, ent.x));
      ent.y = Math.max(20, Math.min(arena.worldH - 20, ent.y));
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  // Phase-progression: kolla om current phase slutat
  if (sim.battleroyalePhaseEndAt && nowMs >= sim.battleroyalePhaseEndAt) {
    advanceBrPhase(sim);
  }

  // Zone-shrink: interpolera mellan current radius och next-radius över phase-tid.
  // Den första 50% av fasen är "warning"-fas (zon visar var den ska krympa till),
  // den sista 50% är själva shrink-animationen. Detta ger spelare tid att flytta sig.
  if (sim.battleroyaleZone) {
    const z = sim.battleroyaleZone;
    const phaseDur = sim.battleroyalePhaseEndAt - sim.battleroyalePhaseStartedAt;
    const phaseElapsed = nowMs - sim.battleroyalePhaseStartedAt;
    if (phaseDur > 0 && z.nextR != null) {
      // 1. Warning-fas (0-50% av phase): zon hålls stilla, klient ritar "next-zone"
      // 2. Shrink-fas (50-100% av phase): radien interpolerar från start till next
      const f = Math.max(0, Math.min(1, (phaseElapsed - phaseDur * 0.5) / (phaseDur * 0.5)));
      if (f > 0) {
        // Interpolera linjärt; clamping krävs inte (f är redan i [0,1])
        z.r = z.startR + (z.nextR - z.startR) * f;
        z.x = z.startX + (z.nextX - z.startX) * f;
        z.y = z.startY + (z.nextY - z.startY) * f;
      }
    }
  }

  // Outside-zone damage: applicera på spelare utanför zonen
  applyBrOutsideDamage(sim, dt);

  // Loot-pickup collision-detection
  tickBrLootPickups(sim, nowMs);

  // Bullets
  updateBullets(sim, dt, now);

  // Centraliserad death-detection (täcker explosion/oob/zone-dmg)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (ws.playerState.hp <= 0 && !sim.battleroyaleEliminated.includes(pid)) {
      // BR: ingen respawn. Markera som eliminated + flagga som spectator.
      const placement = sim.battleroyaleAliveCount; // current alive blir deras placering
      sim.battleroyaleRanks[pid] = placement;
      sim.battleroyaleEliminated.push(pid);
      sim.battleroyaleAliveCount = Math.max(0, sim.battleroyaleAliveCount - 1);
      ws.tdmRespawnAt = 0; // ingen respawn
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      // CORPSE-DROP: dropp current vapen + small HP-pack vid death-pos (kill-reward)
      const deathX = ws.playerState.x, deathY = ws.playerState.y;
      const droppedWeapon = ws.playerState.weaponId && ws.playerState.weaponId !== 'pistol' && ws.playerState.weaponId !== 'knife'
        ? ws.playerState.weaponId : null;
      if (droppedWeapon) {
        sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
        sim.battleroyaleLoot.push({
          id: 'br_loot_' + sim._brLootIdCounter,
          x: deathX + (Math.random() - 0.5) * 20,
          y: deathY + (Math.random() - 0.5) * 20,
          kind: 'weapon',
          weaponId: droppedWeapon,
          tier: 'corpse',
          available: true,
          unlockAt: 0,
        });
      }
      // Liten HP-pack också (mer reward även om vapen var pistol/knife)
      sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
      sim.battleroyaleLoot.push({
        id: 'br_loot_' + sim._brLootIdCounter,
        x: deathX + (Math.random() - 0.5) * 30,
        y: deathY + (Math.random() - 0.5) * 30,
        kind: 'hp_small',
        weaponId: null,
        tier: 'corpse',
        available: true,
        unlockAt: 0,
      });
      // BUGFIX: hårdkodad slice(-2) plockade fel items om bara hp_small pushades
      // (pistol/knife = ingen weapon-drop). Använd faktisk count.
      const dropCount = droppedWeapon ? 2 : 1;
      const newLoot = sim.battleroyaleLoot.slice(-dropCount);
      sim.eventQueue.push({
        type: 'br_corpse_drop',
        x: Math.round(deathX),
        y: Math.round(deathY),
        loot: newLoot.map(lo => ({
          id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: 0,
        })),
      });
      sim.eventQueue.push({
        type: 'br_player_eliminated',
        victim: pid,
        placement,
        aliveCount: sim.battleroyaleAliveCount,
      });
    }
  }

  // Win-check: 1 levande kvar
  if (sim.battleroyaleAliveCount <= 1) {
    // Hitta sista levande (om någon)
    let winner = null;
    for (const [pid, ws] of sim.room.members) {
      if (ws.playerState && ws.playerState.hp > 0) {
        winner = pid;
        break;
      }
    }
    // EDGE-CASE: båda sista dog samma tick → ingen levande. Pick LAST eliminated
    // (senast på listan = sist död) som "moral winner" — bättre än null.
    if (!winner && sim.battleroyaleEliminated.length > 0) {
      // Hitta senast eliminerad som inte är spectator (placement < 999)
      for (let i = sim.battleroyaleEliminated.length - 1; i >= 0; i--) {
        const pid = sim.battleroyaleEliminated[i];
        if ((sim.battleroyaleRanks[pid] || 0) < 999) {
          winner = pid;
          break;
        }
      }
    }
    endBattleRoyaleMatch(sim, winner, 'last_alive');
    return;
  }

  // Score-broadcast var sekund (timer + alive-count + phase)
  sim._brBroadcastTick = (sim._brBroadcastTick || 0) + dt;
  if (sim._brBroadcastTick >= 1.0) {
    sim._brBroadcastTick = 0;
    sim.eventQueue.push({
      type: 'br_state_update',
      aliveCount: sim.battleroyaleAliveCount,
      phase: sim.battleroyalePhase,
      msToNextPhase: Math.max(0, sim.battleroyalePhaseEndAt - nowMs),
      zoneX: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.x) : 0,
      zoneY: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.y) : 0,
      zoneR: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.r) : 0,
      nextZoneX: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextX || sim.battleroyaleZone.x) : 0,
      nextZoneY: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextY || sim.battleroyaleZone.y) : 0,
      nextZoneR: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextR || sim.battleroyaleZone.r) : 0,
    });
  }

  // Final timeout-skydd: om matchen pågår > matchDurationSec + 30s safety
  // → forced end (skydd mot stuck-final med 2 spelare som kampar i evighet)
  if (sim.battleroyaleEndAt && nowMs > sim.battleroyaleEndAt + 30000) {
    // Pick winner = LEVANDE spelare med högst HP (FILTRERA bort spectators/late-joiners)
    let bestPid = null, bestHp = -1;
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      if (ws.playerState.hp > bestHp) {
        bestHp = ws.playerState.hp;
        bestPid = pid;
      }
    }
    // Fallback: om INGEN är levande (extrem edge case), välj senast eliminated
    if (!bestPid && sim.battleroyaleEliminated.length > 0) {
      bestPid = sim.battleroyaleEliminated[sim.battleroyaleEliminated.length - 1];
    }
    endBattleRoyaleMatch(sim, bestPid, 'timeout');
  }
}

// Phase-advance: 0→1→2→3→4 (sista fasen körs tills sista spelare dör)
function advanceBrPhase(sim) {
  const arena = BATTLEROYALE_ARENA;
  const totalDurSec = sim.battleroyaleMatchDurationSec || 600;
  const nowMs = Date.now();
  const nextPhase = sim.battleroyalePhase + 1;
  if (nextPhase >= arena.phases.length) {
    // Sista fasen — den fortsätter tills nån dör. Sätt phaseEndAt långt fram.
    sim.battleroyalePhaseEndAt = nowMs + 999999999;
    return;
  }
  sim.battleroyalePhase = nextPhase;
  sim.battleroyalePhaseStartedAt = nowMs;
  const phaseCfg = arena.phases[nextPhase];
  const phaseDurMs = totalDurSec * 1000 * phaseCfg.durationFrac;
  sim.battleroyalePhaseEndAt = nowMs + phaseDurMs;
  // v1.378: final-zone-center pre-bestäms vid match-start (random på hela mapen).
  // Varje phase lerpar nuvarande center MOT final-target med fraction = phase/totalPhases.
  // Plus liten random noise per phase så det inte är perfekt linjärt.
  // Resultat: final-zonen hamnar på olika ställen varje match (inkl nära hörnen),
  // men progression är förutsägbar nog att spelare kan rotera.
  const cur = sim.battleroyaleZone;
  const newR = Math.round(Math.sqrt(arena.worldW * arena.worldH * phaseCfg.areaFrac / Math.PI));
  const totalShrinkPhases = arena.phases.length - 1;
  const t = totalShrinkPhases > 0 ? nextPhase / totalShrinkPhases : 1;
  const finalCx = sim.brFinalCenterX != null ? sim.brFinalCenterX : (arena.worldW / 2);
  const finalCy = sim.brFinalCenterY != null ? sim.brFinalCenterY : (arena.worldH / 2);
  // Lerp mot final-target
  let nx = cur.x + (finalCx - cur.x) * t;
  let ny = cur.y + (finalCy - cur.y) * t;
  // Liten random noise (max 250px per phase) så det inte syns perfekt linjärt
  const noiseAng = Math.random() * Math.PI * 2;
  const noiseDist = Math.random() * Math.min(250, cur.r * 0.08);
  nx += Math.cos(noiseAng) * noiseDist;
  ny += Math.sin(noiseAng) * noiseDist;
  // Klamp inside current zone (fairness — players i safe-area får inte get screwed)
  const maxDrift = Math.max(0, cur.r - newR - 30);
  const dxc = nx - cur.x, dyc = ny - cur.y;
  const curDist = Math.hypot(dxc, dyc);
  if (curDist > maxDrift && maxDrift > 0) {
    const k = maxDrift / curDist;
    nx = cur.x + dxc * k;
    ny = cur.y + dyc * k;
  }
  // Map clamp (zonen får nudda edge)
  nx = Math.max(newR, Math.min(arena.worldW - newR, nx));
  ny = Math.max(newR, Math.min(arena.worldH - newR, ny));
  // Spara start- + next-värden för interpolation
  cur.startX = cur.x;
  cur.startY = cur.y;
  cur.startR = cur.r;
  cur.nextX = nx;
  cur.nextY = ny;
  cur.nextR = newR;
  sim.eventQueue.push({
    type: 'br_phase_changed',
    phase: nextPhase,
    name: phaseCfg.name,
    outsideDmg: phaseCfg.outsideDmg,
    phaseDurMs,
    nextZoneX: Math.round(nx),
    nextZoneY: Math.round(ny),
    nextZoneR: Math.round(newR),
  });
}

// Outside-zone damage: alla spelare utanför zonens current-radius tar phase-dmg/s
function applyBrOutsideDamage(sim, dt) {
  if (!sim.battleroyaleZone) return;
  const arena = BATTLEROYALE_ARENA;
  const phaseCfg = arena.phases[sim.battleroyalePhase];
  if (!phaseCfg || phaseCfg.outsideDmg <= 0) return;
  const z = sim.battleroyaleZone;
  const r2 = z.r * z.r;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - z.x;
    const dy = ws.playerState.y - z.y;
    if (dx * dx + dy * dy <= r2) continue; // i zonen — safe
    // Utanför — applicera dmg. Shield tar damage först.
    const dmg = phaseCfg.outsideDmg * dt;
    let remaining = dmg;
    if ((ws.playerState.shield || 0) > 0) {
      const absorb = Math.min(ws.playerState.shield, remaining);
      ws.playerState.shield -= absorb;
      remaining -= absorb;
    }
    if (remaining > 0) {
      ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
    }
  }
  // Throttla broadcast så vi inte spammar pvp_hp_changed varje tick
  sim._brZoneDmgTick = (sim._brZoneDmgTick || 0) + dt;
  if (sim._brZoneDmgTick >= 0.4) {
    sim._brZoneDmgTick = 0;
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState) continue;
      const dx = ws.playerState.x - z.x;
      const dy = ws.playerState.y - z.y;
      if (dx * dx + dy * dy <= r2) continue;
      sim.eventQueue.push({
        type: 'pvp_hp_changed',
        peerId: pid,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
        zoneDmg: true,
      });
    }
  }
}

// Loot pickup collision (BR-specifik — speglar tickPvpPickups men för loot-typer)
function tickBrLootPickups(sim, nowMs) {
  if (!sim.battleroyaleLoot) return;
  for (const lo of sim.battleroyaleLoot) {
    if (!lo.available) continue;
    // Anti-rush: center-loot låst första 30s
    if (lo.unlockAt && nowMs < lo.unlockAt) continue;
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - lo.x;
      const dy = ws.playerState.y - lo.y;
      const r = BATTLEROYALE_ARENA.lootPickupRadius;
      if (dx * dx + dy * dy > r * r) continue;
      // Pickup! Apply effect
      let applied = false;
      if (lo.kind === 'hp_small') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(ws.playerState.maxHp || 100, before + 60);
        if (ws.playerState.hp !== before) applied = true;
      } else if (lo.kind === 'hp_big') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(ws.playerState.maxHp || 100, before + 120);
        if (ws.playerState.hp !== before) applied = true;
      } else if (lo.kind === 'shield_small') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(ws.playerState.maxShield || 100, before + 50);
        if (ws.playerState.shield !== before) applied = true;
      } else if (lo.kind === 'shield_big') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(ws.playerState.maxShield || 100, before + 100);
        if (ws.playerState.shield !== before) applied = true;
      } else if (lo.kind === 'ammo') {
        // Klient hanterar ammo lokalt; vi skickar event
        applied = true;
      } else if (lo.kind === 'grenade') {
        // BR grenade-pickup: ger +3 granater. Klient bumpar lokal counter.
        applied = true;
      } else if (lo.kind === 'weapon' && lo.weaponId) {
        // BR tier-baserad auto-equip:
        // - Picked tier > current tier → auto-equip
        // - Picked tier == current tier → BEHÅLL nuvarande (ingen ändring)
        // - Picked tier < current tier → BEHÅLL nuvarande
        // Vapnet läggs alltid i klient-inventoriet (save.owned) via event.
        const TIER_RANK = {
          starter: 0, corpse: 0, dropped: 0,
          common: 1, uncommon: 2, rare: 3, legendary: 4,
        };
        const currentTier = ws.playerState._brWeaponTier || 'starter';
        const oldRank = TIER_RANK[currentTier] != null ? TIER_RANK[currentTier] : 0;
        const newRank = TIER_RANK[lo.tier] != null ? TIER_RANK[lo.tier] : 0;
        let equippedNow = false;
        if (newRank > oldRank) {
          ws.playerState.weaponId = lo.weaponId;
          ws.playerState._brWeaponTier = lo.tier;
          equippedNow = true;
        }
        // Trigger event ALLTID så klient kan lägga vapnet i sitt inventory
        applied = true;
        lo._brEquippedOnPickup = equippedNow;
      }
      if (!applied) continue;
      lo.available = false;
      sim.eventQueue.push({
        type: 'br_loot_picked',
        peerId: pid,
        lootId: lo.id,
        kind: lo.kind,
        weaponId: lo.weaponId || null,
        tier: lo.tier || null,
        // For weapon pickups: did server auto-equip it? Client uses this för
        // att veta om state.player.weaponId ska uppdateras.
        equipped: lo._brEquippedOnPickup != null ? lo._brEquippedOnPickup : true,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
      });
      break; // pickup tagen — gå till nästa
    }
  }
}

// Helper: kolla om punkt (x,y) är inom en wall (med 20px buffer för pickup-radie)
function brPointInAnyWall(x, y, walls) {
  for (const w of walls) {
    // 20px buffer så loot inte spawnar precis bredvid wall heller
    if (x + 20 >= w.x && x - 20 <= w.x + w.w &&
        y + 20 >= w.y && y - 20 <= w.y + w.h) {
      return true;
    }
  }
  return false;
}

// Hitta närmaste fria punkt om original-pos är inuti wall (spiral-search)
function brFindFreeSpot(x, y, walls, worldW, worldH) {
  if (!brPointInAnyWall(x, y, walls)) return { x, y };
  // Spiral-search: prova punkter i ökande radie runt original
  for (let r = 40; r < 400; r += 30) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const nx = x + Math.cos(a) * r;
      const ny = y + Math.sin(a) * r;
      if (nx < 50 || nx > worldW - 50 || ny < 50 || ny > worldH - 50) continue;
      if (!brPointInAnyWall(nx, ny, walls)) {
        return { x: Math.round(nx), y: Math.round(ny) };
      }
    }
  }
  // Fallback: original (worst case)
  return { x, y };
}

// Initialisera loot vid match-start enligt arena.lootSpawns + lootByTier
function initBrLoot(sim) {
  const arena = BATTLEROYALE_ARENA;
  const loot = [];
  // Center-spawn (sista i lootSpawns) är ALLTID legendary, men UNLOCKAS först
  // efter 30s (anti-rush). Klient ser containern men kan inte plocka loot.
  const centerIdx = arena.lootSpawns.length - 1;
  const matchStartMs = Date.now();
  let movedCount = 0;
  for (let i = 0; i < arena.lootSpawns.length; i++) {
    const origSp = arena.lootSpawns[i];
    // VALIDATION: om loot-pos är inuti wall, hitta närmaste fria pos
    const sp = brFindFreeSpot(origSp.x, origSp.y, arena.walls, arena.worldW, arena.worldH);
    if (sp.x !== origSp.x || sp.y !== origSp.y) movedCount++;
    let tier;
    if (i === centerIdx) {
      tier = 'legendary';
    } else {
      const r = Math.random();
      const t = arena.lootTiers;
      if (r < t.common) tier = 'common';
      else if (r < t.common + t.uncommon) tier = 'uncommon';
      else if (r < t.common + t.uncommon + t.rare) tier = 'rare';
      else tier = 'legendary';
    }
    // Välj item från tier (viktad)
    const items = arena.lootByTier[tier];
    let totalW = 0;
    for (const it of items) totalW += it.weight;
    let rr = Math.random() * totalW;
    let chosen = items[0];
    for (const it of items) {
      rr -= it.weight;
      if (rr <= 0) { chosen = it; break; }
    }
    sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
    // Center-loot låst första 30s — anti-rush
    const unlockAt = (i === centerIdx) ? (matchStartMs + 30000) : 0;
    loot.push({
      id: 'br_loot_' + sim._brLootIdCounter,
      x: sp.x,
      y: sp.y,
      kind: chosen.kind,
      weaponId: chosen.weaponId || null,
      tier,
      available: true,
      unlockAt,
    });
  }
  if (movedCount > 0) {
    console.log('[BR] initBrLoot: ' + movedCount + ' loot-spawns flyttade ur walls');
  }
  return loot;
}

function endBattleRoyaleMatch(sim, winnerId, reason) {
  if (sim.battleroyaleEnded) return;
  sim.battleroyaleEnded = true;
  sim.battleroyaleWinner = winnerId;
  // Winner får placement 1 (om de var alive)
  if (winnerId && !sim.battleroyaleRanks[winnerId]) {
    sim.battleroyaleRanks[winnerId] = 1;
  }
  const stats = { perPlayer: {}, winner: winnerId, reason };
  for (const [p] of sim.room.members) {
    stats.perPlayer[p] = {
      placement: sim.battleroyaleRanks[p] || 999,
      kills: sim.battleroyaleKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'br_match_end',
    winner: winnerId, reason, stats,
  });
}

// Kallas från bullets.js när PvP-kill registreras i BR
// GUARD: Shotgun spawnar flera pellets per tick — alla räknas som "kill" om
// vi guardar bara via eliminated-listan (som uppdateras senare i tick).
// Använd även victimWs._brCreditedKill för att markera at offret redan
// gett credit till en killer den här ticken.
function handleBattleRoyaleKill(sim, killerPid, killerWs, victimPid, victimWs, weaponId) {
  if (sim.battleroyaleEnded) return;
  if (!sim.room.members.has(killerPid)) return;
  // GUARD 1: redan eliminated (force-stop)
  if (sim.battleroyaleEliminated.includes(victimPid)) return;
  // GUARD 2: redan crediterad denna tick (multi-pellet shotgun)
  if (victimWs._brCreditedKill) return;
  victimWs._brCreditedKill = true;
  // Rensa flaggan vid nästa tick-start så att samma victim kan döda igen senare
  // (skulle inte hända i BR no-respawn men säkrare).
  setTimeout(() => { victimWs._brCreditedKill = false; }, 100);
  sim.battleroyaleKillsByPid[killerPid] = (sim.battleroyaleKillsByPid[killerPid] || 0) + 1;
  // Death-detection-loopen i tickBattleRoyale tar hand om eliminated-flag,
  // men vi emit:ar kill-event här för killfeed.
  sim.eventQueue.push({
    type: 'br_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
  });
}

// Pickup-builder för juggernaut-arenan — symmetrisk runt 2500,1750
function buildJuggernautPickups(sim) {
  return [
    // HP-pickups vid hörn-spawns (hunters behöver healing efter JUG-möte)
    { id: nextPickupId(sim), x: 900,  y: 900,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 4100, y: 900,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 900,  y: 2600, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 4100, y: 2600, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 1750, type: 'hp',     available: true, respawnAt: 0 },
    // Shield-pickups i flank-zoner (riskabla — JUG kan campa här)
    { id: nextPickupId(sim), x: 2500, y: 500,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 3000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1500, y: 1750, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1750, type: 'shield', available: true, respawnAt: 0 },
    // Granater: 4 spridda runt mitten + flank (anti-JUG tool)
    { id: nextPickupId(sim), x: 1700, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3300, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1700, y: 2600, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3300, y: 2600, type: 'grenade', available: true, respawnAt: 0 },
  ];
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
  // KOTH reset
  sim.kothActive = false;
  sim.kothEnded = false;
  sim.kothWinner = null;
  sim.kothScores = {};
  sim.kothKillsByPid = {};
  sim.kothActiveZoneIdx = 0;
  sim._kothPointAccum = {};
  sim._kothSpawnIdx = 0;
  sim._kothZoneRotateAt = 0;
  sim._kothBroadcastTick = 0;
  // JUGGERNAUT reset
  sim.juggernautActive = false;
  sim.juggernautEnded = false;
  sim.juggernautWinner = null;
  sim.juggernautPid = null;
  sim.juggernautWeapon = null;
  sim.juggernautScores = {};
  sim.juggernautKillsByPid = {};
  sim.juggernautHpMax = 0;
  sim.juggernautEndAt = 0;
  sim._juggernautLastPulseAt = 0;
  sim._juggernautSpawnIdx = 0;
  sim._juggernautScoreAccum = 0;
  sim._juggernautBroadcastTick = 0;
  sim._juggernautAwaitFirstRespawn = false;
  sim.juggernautDmgToJug = {};
  // BATTLE ROYALE reset
  sim.battleroyaleActive = false;
  sim.battleroyaleEnded = false;
  sim.battleroyaleWinner = null;
  sim.battleroyaleStartedAt = 0;
  sim.battleroyaleEndAt = 0;
  sim.battleroyalePhase = 0;
  sim.battleroyalePhaseStartedAt = 0;
  sim.battleroyalePhaseEndAt = 0;
  sim.battleroyaleZone = null;
  sim.battleroyaleLoot = [];
  sim.battleroyaleKillsByPid = {};
  sim.battleroyaleAliveCount = 0;
  sim.battleroyaleEliminated = [];
  sim.battleroyaleRanks = {};
  sim._brZoneDmgTick = 0;
  sim._brBroadcastTick = 0;
  sim._brLootIdCounter = 0;
  // CASTLE DEFENSE reset
  sim.castledefenseActive = false;
  sim.castledefenseEnded = false;
  sim.castledefenseStartedAt = 0;
  sim.castledefenseWave = 0;
  sim.castledefenseWaveBetweenEndAt = 0;
  sim.castledefenseWaveState = 'idle';
  sim.castledefenseCore = null;
  sim.castledefenseWalls = [];
  sim.castledefenseBuildings = [];
  sim.castledefenseScores = {};
  sim.castledefenseGold = {};
  sim.castledefenseWeaponTier = {};
  sim.castledefensePerks = {};
  sim.castledefenseDownedPids = [];
  sim.castledefenseRevivedCount = 0;
  sim._cdBuildIdCounter = 0;
  sim._cdBroadcastTick = 0;
  sim._cdWaveSpawnsRemaining = 0;
  sim._cdWaveSpawnTimer = 0;
  sim._cdLastWaveProcessed = -1;   // v1.395 fix: rematch lämnade stale-värde annars
  sim._cdHudBroadcastAt = 0;
  sim._cdFlowField = null;          // pathfinding flow field (recomputed on first tick + on building changes)
  sim._cdFlowDirty = true;          // force first-tick build
  sim.bossAlive = false;            // även för CD-bossar — annars läcker till andra modes
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
    if (opts.koth) {
      sim.kothActive = true;
      sim.kothTargetPoints = opts.kothTargetPoints || 100;
    }
    if (opts.juggernaut) {
      sim.juggernautActive = true;
      sim.juggernautMatchDurationSec = opts.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration;
    }
    if (opts.battleroyale) {
      sim.battleroyaleActive = true;
      sim.battleroyaleMatchDurationSec = opts.battleroyaleMatchDurationSec || BATTLEROYALE_ARENA.defaultMatchDuration;
    }
    if (opts.castledefense) {
      sim.castledefenseActive = true;
    }
  }
  // Bot-spawn: lägg bot(s) som virtuella members INNAN mode-init så loopen tilldelar
  // dem team + spawn-pos precis som riktiga spelare. Pre-set team respekteras
  // av mode-init-loopen via ws._isBot-check.
  const botCount = Math.max(0, Math.min(7, (opts && opts.addBot) ? (opts.botCount || 1) : 0));
  if (botCount > 0) {
    const inTeamMode = sim.tdmActive || sim.ctfActive || sim.siegeActive;
    const skill = (opts && opts.botSkill) || 'normal';
    // KRITISKT: colorIdx måste matcha loop-position i broadcastWorld's
    // realPlayers-array (klient mappar c: i mot slotToPeerId). Bot kommer sist
    // i sim.room.members (insertion order), så colorIdx = nuvarande size + bi.
    let nextColorIdx = sim.room.members.size;
    // Beräkna host-team-prediction (host hamnar typiskt i loop-index 0 = red).
    // 'auto'-default sätter bot på MOTSATT sida så solo-spelare får en motståndare,
    // inte en teammate. Med flera bots: alternera red/blue.
    const realCount = [...sim.room.members.values()].filter(m => !m._isBot).length;
    const hostPredictTeam = realCount > 0 ? 'red' : 'red'; // host typiskt i=0 → red
    for (let bi = 0; bi < botCount; bi++) {
      let botTeam = null;
      if (inTeamMode) {
        // Prio: per-bot-override från host-free-pick > botTeamMode > auto
        const perBotOverride = (opts && Array.isArray(opts.botTeams)) ? opts.botTeams[bi] : null;
        if (perBotOverride === 'red' || perBotOverride === 'blue') {
          botTeam = perBotOverride;
        } else {
          const tm = opts.botTeam || 'auto';
          if (tm === 'red') botTeam = 'red';
          else if (tm === 'blue') botTeam = 'blue';
          else {
            // AUTO: motsatt host. Med 1 bot = motsatt. Flera bots: alternera men
            // första boten på motsatt sida för balans.
            const oppHost = hostPredictTeam === 'red' ? 'blue' : 'red';
            if (botCount === 1) botTeam = oppHost;
            else botTeam = (bi % 2 === 0) ? oppHost : hostPredictTeam;
          }
        }
      }
      // Använd host-skickat namn om tillgängligt (synkar lobby ↔ match),
      // annars fall tillbaka till server-shuffle från BOT_NAMES.
      const customName = (opts && Array.isArray(opts.botNames) && opts.botNames[bi]) || null;
      const botInfo = addBot(sim, botTeam, skill, customName);
      // Skicka bot_joined så klienter lägger in bot i sin Coop.players-map.
      // Ingen #N-suffix längre — namnen är redan unika via shuffle-poolen.
      sim.eventQueue.push({
        type: 'bot_joined',
        peerId: botInfo.id,
        name: botInfo.name,
        team: botTeam,
        colorIdx: nextColorIdx++,
      });
    }
  }
  console.log('[SIM]', sim.room.code, 'started mode=' + (sim.castledefenseActive ? 'castledefense' : (sim.battleroyaleActive ? 'battleroyale' : (sim.juggernautActive ? 'juggernaut' : (sim.ctfActive ? 'ctf' : (sim.tdmActive ? 'tdm' : sim.config.mode))))) + ' diff=' + sim.config.difficulty + (opts && opts.addBot ? ' +bot' : ''));
  // Anti-mode-leakage: rensa JUG-flaggor från ev. förra match på alla members.
  // Annars kan en spelare som var JUG i förra rundan behålla isJug=true / scaleMul=1.8
  // / speedMul=1.35 / dashCdMs=1000 / maxHp=500 in i nästa mode.
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    ws.playerState.isJug = false;
    ws.playerState.scaleMul = 1.0;
    ws.playerState.speedMul = 1.0;
    ws.playerState.dashCdMs = null;
    if (ws.playerState.maxHp > 100) ws.playerState.maxHp = 100;
  }
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
      const team = ws.tdmTeam || (i % 2 === 0 ? 'red' : 'blue');
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
    // Team-tilldelning först — alternering så lag blir jämna
    const teams = {};
    const redIds = [], blueIds = [];
    let tIdx = 0;
    for (const [pid, ws] of sim.room.members) {
      const team = ws.tdmTeam || (tIdx % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      teams[pid] = team;
      if (team === 'red') redIds.push(pid); else blueIds.push(pid);
      tIdx++;
    }
    // Spawn-pool per team (array av punkter från arena-config)
    const redPool = TDM_ARENA.spawns.red;
    const bluePool = TDM_ARENA.spawns.blue;
    const redSpawns = pickSpreadSpawns(redPool, redIds.length);
    const blueSpawns = pickSpreadSpawns(bluePool, blueIds.length);
    // Tilldela varje spelare en UNIK spawn från sin team-pool
    let ri = 0, bi = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = ws.tdmTeam === 'red' ? redSpawns[ri++] : blueSpawns[bi++];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      sim.tdmKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
    }
    // Behåll legacy spawn-coords för respawn-fallback (mitten av varje team-pool)
    const redSpawnX = Math.floor(arena.worldW * 0.10);
    const blueSpawnX = Math.floor(arena.worldW * 0.90);
    const spawnY = Math.floor(arena.worldH * 0.50);
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
      const team = ws.tdmTeam || (i % 2 === 0 ? 'red' : 'blue');
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
    // GUNGAME: FFA på 3500×2000 close-quarters arena, 15-tier progression.
    // Start-vapen är pistol (tier 0) — tidigare knife var för frustrerande.
    // Tier 15 = sledge (final melee humiliation).
    sim.simReadyAt = Date.now() + 5000;
    // FFA — alla är fiender → använd max-spread så ingen spawnar bredvid varandra.
    const playerCount = sim.room.members.size;
    const spreadSpawns = pickSpreadSpawns(GUNGAME_ARENA.spawns, playerCount);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = spreadSpawns[i];
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
    // Gungame: INGA pickups (varken hp/shield/granater — granater finns inte i GG)
    sim.pvpPickups = [];
    sim.eventQueue.push({
      type: 'gungame_started',
      arena: { worldW: GUNGAME_ARENA.worldW, worldH: GUNGAME_ARENA.worldH, name: GUNGAME_ARENA.name },
      walls: GUNGAME_ARENA.walls,
      spawns: GUNGAME_ARENA.spawns,
      decorations: GUNGAME_ARENA.decorations || [],
      pvpPickups: [],
      weapons: GUNGAME_WEAPONS,
      totalTiers: GUNGAME_WEAPONS.length,
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    // Exponera promote/demote till bullets.js
    sim._endGungameMatch = endGungameMatch;
  } else if (sim.kothActive) {
    // KOTH: hold-the-hill FFA på 3500×2000 close-quarters arena.
    sim.simReadyAt = Date.now() + 5000;
    // Bot:s vapen-roterande i KOTH — random från common-arsenal så de inte alla
    // har samma vapen. Riktiga spelare behåller sin equipped.
    const KOTH_BOT_WEAPONS = ['pistol', 'smg', 'rifle', 'shotgun', 'burstpistol', 'revolver'];
    // FFA — max-spread så ingen spawnar bredvid varandra.
    const kothPlayerCount = sim.room.members.size;
    const kothSpreadSpawns = pickSpreadSpawns(KOTH_ARENA.spawns, kothPlayerCount);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = kothSpreadSpawns[i];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      // Bots får random gun, riktiga spelare behåller sin equipped (default pistol).
      if (ws._isBot) {
        ws.playerState.weaponId = KOTH_BOT_WEAPONS[Math.floor(Math.random() * KOTH_BOT_WEAPONS.length)];
      } else if (!ws.playerState.weaponId) {
        ws.playerState.weaponId = 'pistol';
      }
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.kothScores[pid] = 0;
      sim.kothKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      sim._kothPointAccum[pid] = 0;
      i++;
    }
    sim._kothSpawnIdx = i;
    sim.kothActiveZoneIdx = 0;
    sim._kothZoneRotateAt = Date.now() + (KOTH_ARENA.zoneRotateSec || 45) * 1000;
    // PvP-pickups: 4 HP + 4 shield runt arenan
    sim.pvpPickups = buildKothPickups(sim);
    sim.eventQueue.push({
      type: 'koth_started',
      arena: { worldW: KOTH_ARENA.worldW, worldH: KOTH_ARENA.worldH, name: KOTH_ARENA.name },
      walls: KOTH_ARENA.walls,
      spawns: KOTH_ARENA.spawns,
      decorations: KOTH_ARENA.decorations || [],
      zones: KOTH_ARENA.zones,
      activeZoneIdx: sim.kothActiveZoneIdx,
      zoneRotateSec: KOTH_ARENA.zoneRotateSec,
      nextRotateAt: sim._kothZoneRotateAt,
      targetPoints: sim.kothTargetPoints,
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    sim._endKothMatch = endKothMatch;
  } else if (sim.juggernautActive) {
    // JUGGERNAUT: 5000×3500 underjordisk parkering. Random human blir initial JUG.
    // Spawn-logik: JUG ensam på ena sidan, ALLA HUNTERS klustrade på motsatt sida
    // — så hunters kan koordinera mot JUG direkt utan att JUG kan one-shot:a en
    // ensam hunter vid match-start.
    sim.simReadyAt = Date.now() + 5000;
    const humanIds = [];
    const allPids = [];
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      if (!ws._isBot) humanIds.push(pid);
      allPids.push(pid);
    }
    // Välj initial JUG först (random human)
    let initialJug = null;
    if (humanIds.length > 0) initialJug = humanIds[Math.floor(Math.random() * humanIds.length)];
    // JUG-spawn: pick random från pool. Hunters-spawn-base: spawn LÄNGST från JUG.
    const allSpawns = JUGGERNAUT_ARENA.spawns;
    const jugSpawn = allSpawns[Math.floor(Math.random() * allSpawns.length)];
    // Hitta spawn längst bort från JUG → hunters samlas där
    let hunterBase = allSpawns[0];
    let bestD2 = -1;
    for (const sp of allSpawns) {
      const dx = sp.x - jugSpawn.x, dy = sp.y - jugSpawn.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) { bestD2 = d2; hunterBase = sp; }
    }
    // Tilldela spawns: JUG på sin spawn, hunters klustrade runt hunterBase med jitter
    const hunterCount2 = allPids.length - (initialJug ? 1 : 0);
    let hunterIdx = 0;
    for (const pid of allPids) {
      const ws = sim.room.members.get(pid);
      let sp;
      if (pid === initialJug) {
        sp = jugSpawn;
      } else {
        // Hunter: kluster runt hunterBase med jitter så de inte stackar
        const angle = (hunterIdx / Math.max(1, hunterCount2)) * Math.PI * 2;
        const radius = 60 + (hunterIdx % 3) * 30; // 60-120px
        sp = {
          x: hunterBase.x + Math.cos(angle) * radius,
          y: hunterBase.y + Math.sin(angle) * radius,
        };
        hunterIdx++;
      }
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      // Default = hunter — JUG-roll appliceras efter spawning
      applyHunterStats(sim, ws);
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.juggernautScores[pid] = 0;
      sim.juggernautKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
    }
    sim._juggernautSpawnIdx = allPids.length;
    sim.juggernautWeapon = JUGGERNAUT_ARENA.jugDefaultWeapon;
    // Beräkna JUG HP utifrån hunter-count (snapshot vid start)
    const hunterCount = Math.max(1, sim.room.members.size - 1);
    sim.juggernautHpMax = JUGGERNAUT_ARENA.jugBaseHp + JUGGERNAUT_ARENA.jugHpPerHunter * hunterCount;
    sim.juggernautEndAt = Date.now() + (sim.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration) * 1000;
    // Pickups
    sim.pvpPickups = buildJuggernautPickups(sim);
    // Aktivera JUG-stats på den valde
    if (initialJug) {
      const jws = sim.room.members.get(initialJug);
      if (jws) applyJugStats(sim, jws);
      sim.juggernautPid = initialJug;
    }
    sim.eventQueue.push({
      type: 'juggernaut_started',
      arena: { worldW: JUGGERNAUT_ARENA.worldW, worldH: JUGGERNAUT_ARENA.worldH, name: JUGGERNAUT_ARENA.name },
      walls: JUGGERNAUT_ARENA.walls,
      spawns: JUGGERNAUT_ARENA.spawns,
      decorations: JUGGERNAUT_ARENA.decorations || [],
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: JUGGERNAUT_ARENA.hunterShieldMax || 100,
      initialJug,
      jugWeapons: JUGGERNAUT_ARENA.jugWeapons,
      jugDefaultWeapon: JUGGERNAUT_ARENA.jugDefaultWeapon,
      jugHpMax: sim.juggernautHpMax,
      jugShieldMax: JUGGERNAUT_ARENA.jugShieldMax || 200,
      jugSpeedMul: JUGGERNAUT_ARENA.jugSpeedMul,
      jugScale: JUGGERNAUT_ARENA.jugScale,
      jugDashCdMs: JUGGERNAUT_ARENA.jugDashCdMs,
      hunterWeapon: JUGGERNAUT_ARENA.hunterWeapon,
      hunterSpeedMul: JUGGERNAUT_ARENA.hunterSpeedMul || 1.10,
      hunterShieldMax: JUGGERNAUT_ARENA.hunterShieldMax || 100,
      hunterDashCdMs: 3000,
      matchDurationSec: sim.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration,
      matchEndAt: sim.juggernautEndAt,
      minimapPulseIntervalMs: JUGGERNAUT_ARENA.minimapPulseIntervalMs,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    // Exponera kill-handler + dmg-tracker till bullets.js
    sim._handleJuggernautKill = handleJuggernautKill;
    sim._trackJuggernautDmg = trackJuggernautDmg;
  } else if (sim.battleroyaleActive) {
    // BATTLE ROYALE: 6000×6000 FFA no-respawn arena. Krympande zon.
    sim.simReadyAt = Date.now() + 5000;
    const arena = BATTLEROYALE_ARENA;
    // Initial zon = täcker HELA kartan inklusive hörn. Diagonal/2 + buffer.
    // För 10000×10000 ger sqrt(2)*5000 ≈ 7071, +200 buffer = 7272 så hörn-spawns ligger inne.
    const initialR = Math.round(Math.sqrt(2) * Math.max(arena.worldW, arena.worldH) / 2 + 200);
    sim.battleroyaleZone = {
      x: arena.worldW / 2,
      y: arena.worldH / 2,
      r: initialR,
      startX: arena.worldW / 2,
      startY: arena.worldH / 2,
      startR: initialR,
      nextX: arena.worldW / 2,
      nextY: arena.worldH / 2,
      nextR: initialR,
    };
    // v1.378: pre-bestäm var FINAL-zonen ska hamna (random på hela mapen).
    // Varje shrink-phase lerpar mot detta target → variation match-till-match.
    const finalAreaFrac = arena.phases[arena.phases.length - 1].areaFrac;
    const finalR = Math.round(Math.sqrt(arena.worldW * arena.worldH * finalAreaFrac / Math.PI));
    sim.brFinalCenterX = finalR + Math.random() * (arena.worldW - 2 * finalR);
    sim.brFinalCenterY = finalR + Math.random() * (arena.worldH - 2 * finalR);
    sim.battleroyalePhase = 0;
    sim.battleroyaleStartedAt = Date.now();
    sim.battleroyaleEndAt = Date.now() + sim.battleroyaleMatchDurationSec * 1000;
    sim.battleroyalePhaseStartedAt = Date.now();
    const totalDurSec = sim.battleroyaleMatchDurationSec;
    sim.battleroyalePhaseEndAt = Date.now() + arena.phases[0].durationFrac * totalDurSec * 1000;
    // Init loot från arena
    sim.battleroyaleLoot = initBrLoot(sim);
    // Init alla spelare på spridd spawn-punkt — MAX-SPREAD via pickSpreadSpawns
    // så ingen spawnar bredvid varandra ens i en full lobby.
    let aliveCount = 0;
    const brSpreadSpawns = pickSpreadSpawns(arena.spawns, sim.room.members.size);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = brSpreadSpawns[i];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = arena.startHp;
      ws.playerState.maxHp = arena.maxHp;
      ws.playerState.shield = arena.startShield;
      ws.playerState.maxShield = arena.maxShield;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.playerState.weaponId = arena.startWeapon;
      ws.playerState._brWeaponTier = 'starter'; // för tier-baserad pickup-jämförelse
      ws.playerState.isJug = false;
      ws.playerState.scaleMul = 1.0;
      ws.playerState.speedMul = 1.0;
      ws.playerState.dashCdMs = null;
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.battleroyaleKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      aliveCount++;
      i++;
    }
    sim.battleroyaleAliveCount = aliveCount;
    sim.eventQueue.push({
      type: 'br_started',
      arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
      walls: arena.walls,
      spawns: arena.spawns,
      decorations: arena.decorations || [],
      cabins: arena.cabins || [],
      loot: sim.battleroyaleLoot.map(lo => ({
        id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: lo.unlockAt || 0,
      })),
      phases: arena.phases,
      matchDurationSec: sim.battleroyaleMatchDurationSec,
      matchEndAt: sim.battleroyaleEndAt,
      phaseEndAt: sim.battleroyalePhaseEndAt,
      currentPhase: 0,
      zone: {
        x: sim.battleroyaleZone.x,
        y: sim.battleroyaleZone.y,
        r: sim.battleroyaleZone.r,
      },
      aliveCount,
      startWeapon: arena.startWeapon,
      startHp: arena.startHp,
      maxHp: arena.maxHp,
      maxShield: arena.maxShield,
      lootPickupRadius: arena.lootPickupRadius,
      shieldMax: arena.maxShield,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
    sim._endBattleRoyaleMatch = endBattleRoyaleMatch;
    sim._handleBattleRoyaleKill = handleBattleRoyaleKill;
  } else if (sim.castledefenseActive) {
    // CASTLE DEFENSE init — fasta walls + core + spawn-spelare inne i castle
    sim.simReadyAt = Date.now() + 5000;
    const arena = CASTLEDEFENSE_ARENA;
    // Runtime-kopia av walls så vi kan mutera hp utan att röra arena-konstanten
    sim.castledefenseWalls = arena.walls.map(w => ({ ...w }));
    sim.castledefenseCore = { ...arena.core };
    sim.castledefenseBuildings = [];
    sim.castledefenseStartedAt = Date.now();
    sim.castledefenseWave = 0;
    sim.castledefenseWaveState = 'between';
    // Första vågen startar efter 10 sek så spelare hinner orientera sig + bygga
    sim.castledefenseWaveBetweenEndAt = Date.now() + 10000;
    // Spawn spelare på fasta points inne i castle. Cykla genom 4 punkter om fler spelare.
    const cdSpawns = pickSpreadSpawns(arena.playerSpawns, sim.room.members.size);
    let cdIdx = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = cdSpawns[cdIdx % cdSpawns.length] || arena.playerSpawns[cdIdx % arena.playerSpawns.length];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = arena.startHp;
      ws.playerState.maxHp = arena.maxHp;
      ws.playerState.shield = arena.startShield;
      ws.playerState.maxShield = arena.maxShield;
      ws.playerState.invulnUntil = Date.now() + 2000;
      ws.playerState.weaponId = arena.startWeapon;
      ws.playerState.isJug = false;
      ws.playerState.scaleMul = 1.0;
      ws.playerState.speedMul = 1.0;
      ws.playerState.dashCdMs = null;
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // Co-op (alla är "allies")
      sim.castledefenseScores[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      // Castle Defense gold är per-match (inte save.gold). Lagras på sim per peerId.
      sim.castledefenseGold = sim.castledefenseGold || {};
      sim.castledefenseGold[pid] = arena.startGold || 400;
      // v1.401: vapen-tier startar på 0 (pistol)
      sim.castledefenseWeaponTier = sim.castledefenseWeaponTier || {};
      sim.castledefenseWeaponTier[pid] = 0;
      cdIdx++;
    }
    sim.eventQueue.push({
      type: 'cd_started',
      arena: {
        worldW: arena.worldW,
        worldH: arena.worldH,
        name: arena.name,
        groundColor: arena.groundColor,
        plazaColor: arena.plazaColor,
        pathColor: arena.pathColor,
        plazaRadius: arena.plazaRadius,
        centerX: arena.centerX,
        centerY: arena.centerY,
        startWeapon: arena.startWeapon,
        startGrenades: arena.startGrenades,
        weaponProgression: arena.weaponProgression,
      },
      walls: [],                          // v1.397: ingen pre-built
      core: { ...sim.castledefenseCore },
      playerSpawns: arena.playerSpawns,
      enemySpawns: arena.enemySpawns,
      decorations: arena.decorations || [],
      buildables: arena.buildables,
      buildGridSize: arena.buildGridSize,
      startHp: arena.startHp,
      maxHp: arena.maxHp,
      startGold: sim.castledefenseGold,  // {pid: amount}
      waveBetweenEndAt: sim.castledefenseWaveBetweenEndAt,
      bossEveryWave: arena.bossEveryWave,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: 5000 });
  } else {
    loadStage(sim, sim.wave);
  }
  sim.lastTick = Date.now();
  // Tick-profiling: logga slow ticks > 16ms så vi kan se CPU-spikes i prod.
  // Throttled till 1Hz max så vi inte spammar logs.
  sim._slowTickLogAt = 0;
  sim.interval = setInterval(() => {
    const t0 = process.hrtime.bigint();
    try { tickSim(sim); } catch (e) { console.error('sim-tick error:', e.message, e.stack); }
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    // v1.384: tick-tid EMA + max för debug-overlay
    sim._tickMsEMA = sim._tickMsEMA == null ? elapsedMs : sim._tickMsEMA * 0.92 + elapsedMs * 0.08;
    // Max decay: efter 5s utan spike, glömmer servern bort gamla spikes
    sim._tickMsMax = Math.max((sim._tickMsMax || 0) * 0.995, elapsedMs);
    if (elapsedMs > 16) {
      const now = Date.now();
      if (now - sim._slowTickLogAt > 1000) {
        sim._slowTickLogAt = now;
        console.warn('[SLOW-TICK]', sim.room.code, elapsedMs.toFixed(1) + 'ms',
          'enemies=' + sim.enemies.length,
          'bullets=' + sim.bullets.length,
          'members=' + sim.room.members.size);
      }
    }
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
    // Granater: 4 spridda mellan baser/mid
    { id: nextPickupId(sim), x: 1500, y: 1100, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1100, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1500, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
  ];
}

function stopSim(sim) {
  if (sim.interval) {
    clearInterval(sim.interval);
    sim.interval = null;
    console.log('[SIM]', sim.room.code, 'stopped');
  }
  // Broadcasta bot_left till klienter INNAN vi rensar — annars hänger bot
  // kvar i Coop.players även efter match-end.
  if (sim._botIds && sim._botIds.length && sim.room && sim.room.members) {
    for (const botId of sim._botIds) {
      const msg = JSON.stringify({ type: 'sim_events', events: [{ type: 'bot_left', peerId: botId }] });
      for (const [, ws] of sim.room.members) {
        if (ws._isBot) continue;
        if (ws.readyState === 1) try { ws.send(msg); } catch (_) {}
      }
    }
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
  // v1.382: extended to ALL PvP modes (TDM/CTF/Siege/Gungame/KOTH/JUG/BR).
  // v1.383 (post-audit fix): spawn-grace skulle frysa spelaren även under
  // PvP-shield (3s invuln) och hit-invuln (500ms). FIX: spawn-grace triggar
  // BARA om både invuln AND klient-pos avviker >500px från server-pos
  // (= riktig spawn-resync, inte mid-game shield).
  const inPvP = sim.tdmActive || sim.ctfActive || sim.siegeActive ||
                sim.gungameActive || sim.kothActive ||
                sim.juggernautActive || sim.battleroyaleActive ||
                sim.castledefenseActive;
  if (inPvP && typeof input.x === 'number' && typeof input.y === 'number') {
    const now = Date.now();
    const isInvuln = (ws.playerState.invulnUntil || 0) > now;
    const _dxRaw = input.x - ws.playerState.x;
    const _dyRaw = input.y - ws.playerState.y;
    const _isHugeJump = (_dxRaw * _dxRaw + _dyRaw * _dyRaw) > 500 * 500;
    const isSpawnResync = isInvuln && _isHugeJump;
    if (!isSpawnResync) {
      const lastT = ws._lastInputT || now;
      const dt = Math.max(0.001, Math.min(0.25, (now - lastT) / 1000));
      ws._lastInputT = now;
      let maxSpeed = 230 * 2.0;
      if (sim.ctfActive) {
        const isCarrier = sim.ctfFlags && (
          (sim.ctfFlags.red && sim.ctfFlags.red.carrierId === peerId) ||
          (sim.ctfFlags.blue && sim.ctfFlags.blue.carrierId === peerId)
        );
        if (isCarrier) maxSpeed *= CTF_CARRIER_SPEED_MUL; // 0.75
      }
      const maxDelta = maxSpeed * dt + 12;
      const d = Math.hypot(_dxRaw, _dyRaw);
      if (d > maxDelta && d > 0) {
        const scale = maxDelta / d;
        ws.playerState.x += _dxRaw * scale;
        ws.playerState.y += _dyRaw * scale;
      } else {
        ws.playerState.x = input.x;
        ws.playerState.y = input.y;
      }
    }
    // isSpawnResync = true: ignorera klient x/y. Server-spawnen står fast,
    // klient snappar via world-packet (klient-side discrepancy check).
  } else {
    // Non-PvP (coop story etc.): acceptera klient x/y unchecked
    if (typeof input.x === 'number') ws.playerState.x = input.x;
    if (typeof input.y === 'number') ws.playerState.y = input.y;
  }
  if (typeof input.hp === 'number') ws.playerState.hp = input.hp;
  if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
  if (input.weaponId) {
    ws.playerState.weaponId = input.weaponId;
    // BR: när klient SKICKAR vapen-byte (via radial/menu) skicka ALSO weaponTier
    // så servern vet vilken tier nu equipped (för auto-equip-jämförelse vid nästa pickup).
    if (sim.battleroyaleActive && input.weaponTier) {
      ws.playerState._brWeaponTier = input.weaponTier;
    }
  }
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
  // Castle Defense down-state: bara knife tillåten (server-enforce, annars
  // kan klient skicka rifle/sniper-shots medan downed).
  if (ps.cdDowned) {
    // Tillåt bara knife-shots. Om client försöker skjuta annat → reject.
    if (msg.weaponId && msg.weaponId !== 'knife') return;
  }
  // Mounted turret: tvinga rätt vapen-id + position. Annars kan client säga
  // "weaponId: railgun" och få railgun-dmg från turret-position.
  let weaponId = msg.weaponId || ps.weaponId || 'pistol';
  if (ps.cdDowned) weaponId = 'knife';
  // v1.401 anti-cheat: Castle Defense — validera mot vapen-tier
  if (sim.castledefenseActive && msg.weaponId) {
    const cdArena = CASTLEDEFENSE_ARENA;
    const tier = sim.castledefenseWeaponTier[peerId] || 0;
    const allowed = ['fists', 'knife'];
    const prog = (cdArena && cdArena.weaponProgression) || [];
    for (let i = 0; i <= tier && i < prog.length; i++) allowed.push(prog[i]);
    if (!allowed.includes(msg.weaponId)) {
      // Cheat-försök — fallback till server-side weapon
      weaponId = ps.weaponId || prog[tier] || 'pistol';
    }
  }
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
  // v1.416: Apply CD hero-perk effects to params
  if (sim.castledefenseActive) {
    const perk = sim.castledefensePerks[peerId];
    if (perk === 'gunner') params.dmgMul *= 1.4;
    if (perk === 'sharpshooter') {
      params.critChance = Math.max(params.critChance, 0.25);
      params.bspeedMul *= 1.5;
    }
    if (perk === 'berserker') {
      const hpPct = (ps.hp || 1) / (ps.maxHp || 100);
      if (hpPct < 0.5) {
        const bonus = Math.max(0, Math.min(0.5, 1 - 2 * hpPct));
        params.dmgMul *= (1 + bonus);
      }
    }
  }
  // Melee i PvP-modes: direkt hit-check, ingen bullet spawnas.
  // (Story-mode melee körs lokalt på klient mot state.enemies.)
  const w = require('../../shared/weapons-data').W_BY_ID[weaponId];
  if (w && w.type === 'melee') {
    applyMelee(sim, p, weaponId, params);
    return;
  }
  spawnPlayerBullets(sim, p, weaponId, params);
}

// BR: spelaren dropar ett vapen från inventory → spawna loot vid sin pos
function applyBrDropWeapon(sim, peerId, msg) {
  if (!sim.battleroyaleActive) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const weaponId = msg && msg.weaponId;
  if (!weaponId) return;
  // Block default-starter dropp (fists/knife/pistol kan inte tas bort)
  if (weaponId === 'fists' || weaponId === 'knife' || weaponId === 'pistol') return;
  const px = ws.playerState.x, py = ws.playerState.y;
  sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
  const lo = {
    id: 'br_loot_' + sim._brLootIdCounter,
    x: px + (Math.random() - 0.5) * 30,
    y: py + (Math.random() - 0.5) * 30,
    kind: 'weapon',
    weaponId,
    tier: 'dropped',
    available: true,
    unlockAt: 0,
  };
  sim.battleroyaleLoot.push(lo);
  // Server-side equip: byt till nästa vapen klienten skickade (eller pistol fallback)
  if (msg.newWeaponId) ws.playerState.weaponId = msg.newWeaponId;
  sim.eventQueue.push({
    type: 'br_corpse_drop',
    x: Math.round(lo.x),
    y: Math.round(lo.y),
    loot: [{ id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: 0 }],
  });
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

// ============================================================
// CASTLE DEFENSE — build + repair-handlers (client → server)
// ============================================================
function applyCastleDefenseBuild(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const arena = CASTLEDEFENSE_ARENA;
  const kind = msg && msg.kind;
  if (!kind || !arena.buildables[kind]) return;
  const spec = arena.buildables[kind];
  const grid = arena.buildGridSize;
  // Grid-snap server-side (klient kan vara felaktig)
  const x = Math.floor((+msg.x || 0) / grid) * grid;
  const y = Math.floor((+msg.y || 0) / grid) * grid;
  if (x < 20 || y < 20 || x + spec.w > arena.worldW - 20 || y + spec.h > arena.worldH - 20) {
    sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'out_of_bounds', kind });
    return;
  }
  // v1.416: BUILDER perk -30% cost
  const buildPerk = sim.castledefensePerks[peerId];
  const buildCostMul = buildPerk === 'builder' ? 0.7 : 1.0;
  const effectiveCost = Math.round(spec.cost * buildCostMul);
  const playerGold = sim.castledefenseGold[peerId] || 0;
  if (playerGold < effectiveCost) {
    sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'insufficient_gold', kind });
    return;
  }
  // Overlap-check med walls
  for (const w of sim.castledefenseWalls) {
    if (w.hp <= 0) continue;
    if (x < w.x + w.w && x + spec.w > w.x && y < w.y + w.h && y + spec.h > w.y) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_wall', kind });
      return;
    }
  }
  // Overlap-check med befintliga buildings
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0) continue;
    if (x < b.x + b.w && x + spec.w > b.x && y < b.y + b.h && y + spec.h > b.y) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_building', kind });
      return;
    }
  }
  // Overlap-check med core (circle vs AABB)
  if (sim.castledefenseCore) {
    const core = sim.castledefenseCore;
    const cx2 = Math.max(x, Math.min(core.x, x + spec.w));
    const cy2 = Math.max(y, Math.min(core.y, y + spec.h));
    const dxC = core.x - cx2, dyC = core.y - cy2;
    if (dxC * dxC + dyC * dyC < (core.r + 5) * (core.r + 5)) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_core', kind });
      return;
    }
  }
  // Overlap-check med levande spelare (man får inte bygga på spelare)
  for (const [, ws2] of sim.room.members) {
    if (!ws2.playerState || ws2.playerState.hp <= 0) continue;
    const ps = ws2.playerState;
    const r = 14;
    const ccx = Math.max(x, Math.min(ps.x, x + spec.w));
    const ccy = Math.max(y, Math.min(ps.y, y + spec.h));
    const ddx = ps.x - ccx, ddy = ps.y - ccy;
    if (ddx * ddx + ddy * ddy < r * r) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_player', kind });
      return;
    }
  }
  // v1.398: Blocka även overlap med levande fiender (annars kan fiende fastna inuti
  // mur som placeras runt dem — flow-field returnerar då unreachable för cellen).
  // Bara solida buildings — traps får placeras under fiender (skadar dem).
  if (kind !== 'spike_trap' && kind !== 'slow_trap') {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const ccx2 = Math.max(x, Math.min(e.x, x + spec.w));
      const ccy2 = Math.max(y, Math.min(e.y, y + spec.h));
      const eddx = e.x - ccx2, eddy = e.y - ccy2;
      if (eddx * eddx + eddy * eddy < (e.r || 12) * (e.r || 12)) {
        sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_enemy', kind });
        return;
      }
    }
  }
  // OK → deducera gold + skapa building
  sim.castledefenseGold[peerId] = playerGold - effectiveCost;
  sim._cdBuildIdCounter += 1;
  const building = {
    id: 'build_' + sim._cdBuildIdCounter,
    kind, x, y, w: spec.w, h: spec.h,
    hp: spec.hp, maxHp: spec.hp,
    ownerPid: peerId,
    fireRate: spec.fireRate || 0,
    range: spec.range || 0,
    dps: spec.dps || 0,
    dpsMul: spec.dpsMul || 0,
    dmgOnPass: spec.dmgOnPass || 0,
    slowMul: spec.slowMul || 1,
    slowDurSec: spec.slowDurSec || 0,
    healPerSec: spec.healPerSec || 0,
    playerHealPerSec: spec.playerHealPerSec || 0,
    radius: spec.radius || 0,
    level: 0,                     // v1.407: level-system (0-9 = 10 nivåer)
    _baseCost: spec.cost,         // för upgrade-cost-beräkning
    _baseStats: {                 // för upgrade-stat-beräkning
      hp: spec.hp, dps: spec.dps || 0, range: spec.range || 0,
      healPerSec: spec.healPerSec || 0, playerHealPerSec: spec.playerHealPerSec || 0,
      dmgOnPass: spec.dmgOnPass || 0, fireRate: spec.fireRate || 0,
    },
    _fireCd: 0,
    _spikeCd: 0,
    occupiedByPid: null,
  };
  building._totalInvested = spec.cost; // för sell-refund
  sim.castledefenseBuildings.push(building);
  // Solid buildings ändrar pathfinding-grid → rebuild flow field nästa tick
  if (kind !== 'spike_trap' && kind !== 'slow_trap') sim._cdFlowDirty = true;
  sim.eventQueue.push({
    type: 'cd_building_placed',
    id: building.id, kind: building.kind,
    x: building.x, y: building.y, w: building.w, h: building.h,
    hp: building.hp, maxHp: building.maxHp,
    ownerPid: peerId,
    range: building.range, dpsMul: building.dpsMul,
    // v1.407: skicka radius + healPerSec + playerHealPerSec så klient kan rita aura
    radius: building.radius,
    healPerSec: building.healPerSec,
    playerHealPerSec: building.playerHealPerSec,
    level: building.level || 0,
    totalInvested: building._totalInvested || spec.cost, // v1.415: för repair-cost-calc
  });
  sim.eventQueue.push({
    type: 'cd_gold_update',
    peerId, gold: sim.castledefenseGold[peerId], delta: -spec.cost,
  });
}

function applyCastleDefenseRepair(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const id = msg && msg.id;
  if (!id) return;
  let target = null;
  let isBuild = false;
  for (const w of sim.castledefenseWalls) {
    if (w.id === id && w.hp > 0 && w.hp < w.maxHp) { target = w; break; }
  }
  if (!target) {
    for (const b of sim.castledefenseBuildings) {
      if (b.id === id && b.hp > 0 && b.hp < b.maxHp) { target = b; isBuild = true; break; }
    }
  }
  if (!target) return;
  // v1.418: player står invid (≤22px från edge). Collisionen pushar player UT
  // av byggnadens AABB, så strikt "center inside" går ej. 22px = mjuk men tight.
  const px = ws.playerState.x, py = ws.playerState.y;
  const cxR = Math.max(target.x, Math.min(px, target.x + target.w));
  const cyR = Math.max(target.y, Math.min(py, target.y + target.h));
  const dxR = px - cxR, dyR = py - cyR;
  if (dxR * dxR + dyR * dyR > 22 * 22) return;
  // v1.415: Repair-cost scaling efter dmg-pct + total invest.
  // 99% damaged → cost ≈ 0.75 × totalInvested. 1% damaged → cost ≈ 0.0075 × totalInvested.
  const dmgPct = 1 - (target.hp / target.maxHp);
  if (dmgPct < 0.01) return; // i princip full hp, ingen reparation behövs
  const invested = target._totalInvested || 50;
  const REPAIR_COST = Math.max(1, Math.ceil(0.75 * invested * dmgPct));
  if ((sim.castledefenseGold[peerId] || 0) < REPAIR_COST) {
    sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'insufficient_gold', kind: 'repair', cost: REPAIR_COST });
    return;
  }
  sim.castledefenseGold[peerId] -= REPAIR_COST;
  // FULL HEAL till maxHp (var: +80hp). Mer intuitivt + matchar cost-scaling.
  target.hp = target.maxHp;
  sim.eventQueue.push({
    type: isBuild ? 'cd_building_damaged' : 'cd_wall_damaged',
    id: target.id, hp: target.hp, maxHp: target.maxHp,
  });
  sim.eventQueue.push({
    type: 'cd_gold_update',
    peerId, gold: sim.castledefenseGold[peerId], delta: -REPAIR_COST,
  });
}

// v1.407: Upgrade existing building. Increments level + scales stats + deducts gold.
function applyCastleDefenseUpgrade(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const arena = CASTLEDEFENSE_ARENA;
  const id = msg && msg.id;
  if (!id) return;
  const b = sim.castledefenseBuildings.find(x => x.id === id && x.hp > 0);
  if (!b) return;
  if (b.kind === 'spike_trap') return; // spike-trap är disposable, ingen upgrade
  // v1.418: player står invid (≤22px från edge) — matchar klient
  const upgPx = ws.playerState.x, upgPy = ws.playerState.y;
  const ucx = Math.max(b.x, Math.min(upgPx, b.x + b.w));
  const ucy = Math.max(b.y, Math.min(upgPy, b.y + b.h));
  const udx = upgPx - ucx, udy = upgPy - ucy;
  if (udx * udx + udy * udy > 22 * 22) return;
  const curLevel = b.level || 0;
  const maxLevel = arena.maxBuildLevel || 9;
  if (curLevel >= maxLevel) {
    sim.eventQueue.push({ type: 'cd_upgrade_failed', peerId, id, reason: 'max_level' });
    return;
  }
  const baseCost = b._baseCost || arena.buildables[b.kind].cost;
  // v1.410: exponential cost-scaling: baseCost × base × (lvl+1)^exp
  const ucBase = arena.upgradeCostBase || 0.6;
  const ucExp = arena.upgradeCostExp || 1.3;
  // v1.416: BUILDER perk -30% upgrade-cost
  const upgPerk = sim.castledefensePerks[peerId];
  const upgMul = upgPerk === 'builder' ? 0.7 : 1.0;
  const upgradeCost = Math.round(baseCost * ucBase * Math.pow(curLevel + 1, ucExp) * upgMul);
  const playerGold = sim.castledefenseGold[peerId] || 0;
  if (playerGold < upgradeCost) {
    sim.eventQueue.push({ type: 'cd_upgrade_failed', peerId, id, reason: 'insufficient_gold', cost: upgradeCost });
    return;
  }
  // OK — deducera + level up
  sim.castledefenseGold[peerId] = playerGold - upgradeCost;
  b._totalInvested = (b._totalInvested || baseCost) + upgradeCost;
  b.level = curLevel + 1;
  const mul = arena.upgradeStatMul || {};
  const base = b._baseStats || {};
  // Skala stats baserat på base × (1 + level × multiplier)
  const lvl = b.level;
  if (base.hp) {
    // v1.411: per-kind override för hp-scaling (wall får +120%/lvl, andra +50%)
    const spec = arena.buildables[b.kind] || {};
    const hpScale = spec.hpScalePerLvl != null ? spec.hpScalePerLvl : (mul.hp || 0.5);
    const newMax = Math.round(base.hp * (1 + lvl * hpScale));
    const hpPct = b.hp / b.maxHp;
    b.maxHp = newMax;
    b.hp = Math.round(newMax * hpPct);
  }
  if (base.dps) b.dps = base.dps * (1 + lvl * (mul.dps || 0.25));
  if (base.range) b.range = Math.round(base.range * (1 + lvl * (mul.range || 0.05)));
  // v1.414: per-kind override för heal-scaling (repair_stn har 2.0 = +200%/lvl)
  const specForHeal = arena.buildables[b.kind] || {};
  const healScale = specForHeal.healScalePerLvl != null ? specForHeal.healScalePerLvl : (mul.heal || 0.4);
  if (base.healPerSec) b.healPerSec = base.healPerSec * (1 + lvl * healScale);
  if (base.playerHealPerSec) b.playerHealPerSec = base.playerHealPerSec * (1 + lvl * healScale);
  if (base.dmgOnPass) b.dmgOnPass = Math.round(base.dmgOnPass * (1 + lvl * (mul.dmg || 0.25)));
  sim.eventQueue.push({
    type: 'cd_building_upgraded',
    id: b.id, level: b.level, peerId,
    hp: b.hp, maxHp: b.maxHp, dps: b.dps, range: b.range,
    healPerSec: b.healPerSec, playerHealPerSec: b.playerHealPerSec,
    dmgOnPass: b.dmgOnPass,
    upgradeCost,
    totalInvested: b._totalInvested,   // v1.415: updated invest för repair-cost
  });
  sim.eventQueue.push({
    type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -upgradeCost,
  });
}

// v1.411: Sälja byggnad — bara owner får sälja, refund = 50% av totalt invest
function applyCastleDefenseSell(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  // v1.413: blockera sell om player är död eller downed (matchar repair/build/upgrade)
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  if (ws.playerState.cdDowned) return;
  const id = msg && msg.id;
  if (!id) return;
  const b = sim.castledefenseBuildings.find(x => x.id === id && x.hp > 0);
  if (!b) return;
  // Owner-only
  if (b.ownerPid !== peerId) {
    sim.eventQueue.push({ type: 'cd_sell_failed', peerId, id, reason: 'not_owner' });
    return;
  }
  // v1.418: player står invid (≤22px från edge) — matchar klient
  const sellPx = ws.playerState.x, sellPy = ws.playerState.y;
  const scx = Math.max(b.x, Math.min(sellPx, b.x + b.w));
  const scy = Math.max(b.y, Math.min(sellPy, b.y + b.h));
  const sdx = sellPx - scx, sdy = sellPy - scy;
  if (sdx * sdx + sdy * sdy > 22 * 22) {
    sim.eventQueue.push({ type: 'cd_sell_failed', peerId, id, reason: 'not_in_range' });
    return;
  }
  const refund = Math.round((b._totalInvested || 0) * 0.5);
  sim.castledefenseGold[peerId] = (sim.castledefenseGold[peerId] || 0) + refund;
  b.hp = 0;
  // Solid building → flow field dirty
  if (b.kind !== 'spike_trap' && b.kind !== 'slow_trap') sim._cdFlowDirty = true;
  sim.eventQueue.push({ type: 'cd_building_sold', id: b.id, peerId, refund });
  sim.eventQueue.push({ type: 'cd_building_destroyed', id: b.id });
  sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: refund });
}

// v1.416: Hero-perk selection — unik per spelare (rejects duplicate).
function applyCastleDefensePerk(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState) return;
  const perkId = msg && msg.perkId;
  if (!perkId) return;
  // Validera mot arena.heroPerks
  const arena = CASTLEDEFENSE_ARENA;
  const validPerk = (arena.heroPerks || []).find(p => p.id === perkId);
  if (!validPerk) {
    sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'invalid_id' });
    return;
  }
  // Kolla att inte annan spelare redan har den
  for (const [otherPid, otherPerk] of Object.entries(sim.castledefensePerks)) {
    if (otherPid !== peerId && otherPerk === perkId) {
      sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'taken', perkId });
      return;
    }
  }
  // OK — sätt perk + applicera at-start-effekter
  sim.castledefensePerks[peerId] = perkId;
  applyCdPerkEffects(ws.playerState, perkId);
  sim.eventQueue.push({
    type: 'cd_perk_selected', peerId, perkId,
    allPerks: { ...sim.castledefensePerks },
  });
}

// v1.416: Applicera at-start-effekter för perk (resten är passiva via flags)
function applyCdPerkEffects(ps, perkId) {
  if (!ps) return;
  if (perkId === 'tank') {
    ps.maxHp = 150;
    ps.hp = 150;
    ps.speedMul = (ps.speedMul || 1) * 0.8;
  } else if (perkId === 'scout') {
    ps.speedMul = (ps.speedMul || 1) * 1.4;
  } else if (perkId === 'gunner') {
    // hanteras i applyShoot via tier-check
  }
  // Övriga perks är passiva — read i tick/handlers
}

// v1.407: DEBUG infinity-money — ger spelaren 5000 gold per call. Tas bort i prod.
function applyCastleDefenseInfMoney(sim, peerId, msg) {
  if (!sim.castledefenseActive) return;
  if (!sim.castledefenseGold[peerId]) sim.castledefenseGold[peerId] = 0;
  sim.castledefenseGold[peerId] += 5000;
  sim.eventQueue.push({
    type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: 5000,
  });
}

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput, applyShoot, applyLoadStage, applyBrDropWeapon, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret, applyCastleDefenseBuild, applyCastleDefenseRepair, applyCastleDefenseUpgrade, applyCastleDefenseSell, applyCastleDefensePerk, applyCastleDefenseInfMoney };
