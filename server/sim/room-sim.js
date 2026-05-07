// Per-room simulation. PHASE 2: alla 14 enemy-typer + status-effekter.
// PHASE 3 portar bullet-collision, player-bullets, weapon-effekter.
// PHASE 4 portar bossar + waves + stage-flow.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy } = require('./enemies');

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const FULL_BROADCAST_MS = 1500;
const ENEMY_CAP = 80;
const CULL_DIST = 1100;

// Förenklad world. Phase 4 portar full STAGES-data + buildStageLayout.
const WORLD = { w: 4000, h: 3000 };

function createSim(room) {
  return {
    room,
    enemies: [],
    bullets: [],            // Phase 2: bara hostile bullets från sniper/shooter/soldier
    nextEnemyIdx: 0,
    spawnTimer: 1.5,
    waveActive: true,
    enemiesToSpawn: 30,
    enemyPool: ['grunt', 'runner', 'brute', 'shooter', 'ninja', 'soldier', 'dog'],
    lastTick: Date.now(),
    lastFullAt: 0,
    seqByPeer: new Map(),
    lastSentEnemyByPeer: new Map(),
    interval: null,
  };
}

function tickSim(sim) {
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTick) / 1000);
  sim.lastTick = now;

  // Hård cap (samma som klient game.js:7253-7261)
  if (sim.enemies.length > ENEMY_CAP) {
    sim.enemies = sim.enemies.slice(-ENEMY_CAP);
  }

  // Spawn enemies med variation
  if (sim.waveActive && sim.enemiesToSpawn > 0) {
    sim.spawnTimer -= dt;
    if (sim.spawnTimer <= 0 && sim.enemies.length < ENEMY_CAP) {
      const x = 200 + Math.random() * (WORLD.w - 400);
      const y = 200 + Math.random() * (WORLD.h - 400);
      const type = sim.enemyPool[Math.floor(Math.random() * sim.enemyPool.length)];
      const e = makeEnemy(type, x, y);
      e._idx = sim.nextEnemyIdx++;
      sim.enemies.push(e);
      sim.enemiesToSpawn--;
      sim.spawnTimer = 0.4 + Math.random() * 0.4;
    }
  }

  // Bygg lista av "spelare" från room.members för enemy-AI
  const players = [];
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState || { x: WORLD.w / 2, y: WORLD.h / 2, hp: 100 };
    players.push({ peerId: pid, x: ps.x, y: ps.y, hp: ps.hp != null ? ps.hp : 100, r: 14 });
  }

  // Kör enemy-AI för alla
  for (const e of sim.enemies) {
    if (e.dead) continue;
    updateEnemy(e, dt, now, sim, players);
    // World bounds
    if (e.x < 20 || e.x > WORLD.w - 20 || e.y < 20 || e.y > WORLD.h - 20) {
      e.x = Math.max(20, Math.min(WORLD.w - 20, e.x));
      e.y = Math.max(20, Math.min(WORLD.h - 20, e.y));
    }
  }
  // Rensa döda
  if (sim.enemies.some(e => e.dead)) {
    sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // Skriv tillbaka playerState.hp för spelare som tagit damage från enemies (kontakt)
  for (const p of players) {
    if (p._tookDamageFrom) {
      const ws = sim.room.members.get(p.peerId);
      if (ws && ws.playerState) ws.playerState.hp = p.hp;
    }
  }

  // Phase 2: simpel bullet-uppdatering (bara rörelse + life). Phase 3 lägger till collision.
  const bullets = sim.bullets;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < 0 || b.x > WORLD.w || b.y < 0 || b.y > WORLD.h) {
      bullets.splice(i, 1);
    }
  }

  // Skicka world-snapshot till varje peer
  const fullBroadcast = (now - sim.lastFullAt) > FULL_BROADCAST_MS;
  if (fullBroadcast) sim.lastFullAt = now;

  const allPlayers = players.map((p, i) => ({
    c: i,
    x: Math.round(p.x), y: Math.round(p.y),
    hp: Math.round(p.hp),
    a: 0, w: 'fists', rT: 0,
  }));

  for (const [peerId, ws] of sim.room.members) {
    let lastSent = sim.lastSentEnemyByPeer.get(peerId);
    const forceFullForPeer = !lastSent || fullBroadcast;
    if (!lastSent) lastSent = {};
    const newSent = {};
    const enemiesPkt = [];
    const px = (ws.playerState && ws.playerState.x) || (WORLD.w / 2);
    const py = (ws.playerState && ws.playerState.y) || (WORLD.h / 2);
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const visible = Math.abs(e.x - px) < CULL_DIST && Math.abs(e.y - py) < CULL_DIST;
      if (!visible) continue;
      const ex = Math.round(e.x), ey = Math.round(e.y), eh = Math.round(e.hp);
      newSent[e._idx] = { x: ex, y: ey, hp: eh };
      const last = lastSent[e._idx];
      if (!forceFullForPeer && last && last.x === ex && last.y === ey && last.hp === eh) continue;
      if (forceFullForPeer) {
        enemiesPkt.push({
          i: e._idx, x: ex, y: ey, hp: eh, mh: e.maxHp,
          t: e.type, b: 0, mb: 0, bk: '',
          r: e.r, c: e.color, n: e.name || '', p: e.phase,
        });
      } else {
        enemiesPkt.push({ i: e._idx, x: ex, y: ey, hp: eh });
      }
    }
    sim.lastSentEnemyByPeer.set(peerId, newSent);

    // Bullet-cull per peer (visDist 800)
    const hb = [];
    for (const b of bullets) {
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
      pkt.gs = { w: 1, cz: 'forest', zs: 'spawning', bss: 0, bd: 0 };
    }
    const payload = encodeWorldBinary(pkt);
    if (ws && ws.readyState === 1) {
      const out = Buffer.alloc(1 + payload.length);
      out[0] = 0; // fromIdLen=0 = från servern
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

function startSim(sim) {
  if (sim.interval) return;
  console.log('[SIM]', sim.room.code, 'started');
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
  if (!ws.playerState) ws.playerState = { x: WORLD.w / 2, y: WORLD.h / 2, hp: 100 };
  if (typeof input.x === 'number') ws.playerState.x = input.x;
  if (typeof input.y === 'number') ws.playerState.y = input.y;
  if (typeof input.hp === 'number') ws.playerState.hp = input.hp;
}

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput };
