// Per-room simulation. Phase 4: bossar + waves + stages.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy } = require('./enemies');
const { spawnPlayerBullets, updateBullets, damageEnemy } = require('./bullets');
const { updateBoss } = require('./bosses');
const { loadStage, updateZoneProgression, spawnEnemyAtEdge, isStageComplete, onWaveComplete, checkBossDeath } = require('./waves');
const { updatePickups, dropFromEnemyDeath } = require('./pickups');
const { getStage } = require('../../shared/stages-data');

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
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
  };
  return sim;
}

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
          ws.playerState.invulnUntil = Date.now() + 1500;
          // Riktat event så klienten kan reseta spectating-mode + spawna-fx
          sim.eventQueue.push({
            type: 'tdm_player_respawned',
            peerId: pid,
            x: ws.playerState.x,
            y: ws.playerState.y,
          });
        }
      }
    }
    // Match-end-flagga: stoppa allt när någon nått targetKills
    if (!sim.tdmEnded) {
      updateBullets(sim, dt, now);
    }
    broadcastWorld(sim, now);
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
      const spawned = sim.enemies.length > beforeCount;
      console.log('[SIM]', sim.room.code, 'spawn-attempt: wave=' + sim.wave + ' zone=' + sim.currentZone + ' toSpawn=' + sim.enemiesToSpawn + ' players=' + players.length + ' spawned=' + spawned + ' total=' + sim.enemies.length);
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
      // Drop pickup
      dropFromEnemyDeath(sim, e);
      // Gold-share-event så alla klienter får guld + kill-credit. Inkluderar enemy-index
      // så klient kan ta bort enemy ur state.enemies direkt (annars dröjer 1.5s till nästa full-broadcast).
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

  // Skicka world-snapshots
  broadcastWorld(sim, now);
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
    });
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
      // DoT på spelare
      for (const p of players) {
        if (p.hp <= 0) continue;
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
        if (p.hp <= 0) continue;
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

function broadcastWorld(sim, now) {
  const fullBroadcast = (now - sim.lastFullAt) > FULL_BROADCAST_MS;
  if (fullBroadcast) sim.lastFullAt = now;

  // Bygg player-array
  const players = buildPlayerList(sim);
  const allPlayers = players.map((p, i) => ({
    c: i,
    x: Math.round(p.x), y: Math.round(p.y),
    hp: Math.round(p.hp),
    a: 0, w: 'fists', rT: 0,
  }));

  // Drain event-queue (broadcast som JSON via room.members)
  if (sim.eventQueue.length > 0) {
    const events = sim.eventQueue.slice();
    sim.eventQueue.length = 0;
    for (const ev of events) {
      const json = JSON.stringify({ type: 'sim_event', event: ev });
      for (const [, ws] of sim.room.members) {
        if (ws.readyState === 1) try { ws.send(json); } catch (e) {}
      }
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
      const out = Buffer.alloc(1 + payload.length);
      out[0] = 0;
      payload.copy(out, 1);
      try { ws.send(out, { binary: true }); } catch (e) {}
    }
  }

  // Cleanup peers som lämnat
  if (sim.lastSentEnemyByPeer.size > sim.room.members.size) {
    for (const peerId of [...sim.lastSentEnemyByPeer.keys()]) {
      if (!sim.room.members.has(peerId)) sim.lastSentEnemyByPeer.delete(peerId);
    }
  }
}

function startSim(sim, opts) {
  if (sim.interval) return;
  if (opts) {
    if (opts.difficulty) sim.config.difficulty = opts.difficulty;
    if (opts.ngpLevel) sim.config.ngpLevel = opts.ngpLevel;
    if (opts.mode) sim.config.mode = opts.mode;
    if (opts.wave) sim.wave = opts.wave;
    if (opts.tdm) {
      sim.tdmActive = true;
      sim.tdmTargetKills = opts.tdmTargetKills || 10;
      sim.tdmKills = { red: 0, blue: 0 };
      sim.tdmEnded = false;
      sim.tdmKillsByPid = {};
      sim.tdmDeathsByPid = {};
    }
  }
  console.log('[SIM]', sim.room.code, 'started mode=' + (sim.tdmActive ? 'tdm' : sim.config.mode) + ' diff=' + sim.config.difficulty);
  if (sim.tdmActive) {
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
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.tdmKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    // Skicka arena-info till klient så de kan rita rätt map + spawn-positions
    sim.eventQueue.push({
      type: 'tdm_started',
      targetKills: sim.tdmTargetKills,
      teams,
      arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
      spawns: { red: { x: redSpawnX, y: spawnY }, blue: { x: blueSpawnX, y: spawnY } },
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
  if (typeof input.x === 'number') ws.playerState.x = input.x;
  if (typeof input.y === 'number') ws.playerState.y = input.y;
  if (typeof input.hp === 'number') ws.playerState.hp = input.hp;
  if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
  if (input.weaponId) ws.playerState.weaponId = input.weaponId;
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
  // Klient kan ha custom-stages längre än 9 (story+convoy = 11). Server måste matcha,
  // annars divergent state. Begränsa max till 30 för att skydda mot orimliga värden.
  const wave = Math.max(1, Math.min(30, msg.wave || 1));
  loadStage(sim, wave);
}

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput, applyShoot, applyLoadStage };
