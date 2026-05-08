// The Penetrator — Co-op WebSocket relay server
// Deployas på Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const { createSim, startSim, stopSim, applyPlayerInput, applyShoot, applyLoadStage } = require('./sim/room-sim');
const PORT = process.env.PORT || 8080;

// Healthcheck endpoint så Render håller servern vid liv. Visar build-info
// så vi kan se om Render kör senaste deploy.
const SERVER_VERSION = 'v128-coop-fix';
const SERVER_BUILD_AT = new Date().toISOString();
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Penetrator co-op server\nVersion: ${SERVER_VERSION}\nBuilt: ${SERVER_BUILD_AT}\nRooms: ${rooms.size}\nUptime: ${Math.round(process.uptime())}s`);
  } else {
    res.writeHead(404); res.end();
  }
});

// perMessageDeflate: transparent gzip-komprimering på frame-nivå.
// Browsers förhandlar automatiskt. ~30-50% extra på binär världs-paket
// utöver vår egen binära packning. CPU-kostnad är låg med dessa defaults.
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 3 },        // 3 = bra balans speed vs ratio (default 6 är dyrare)
    threshold: 256,                          // skippa kompression för paket < 256 B (overhead lönar sig inte)
    concurrencyLimit: 10,                    // max samtidiga compress-jobb
    serverNoContextTakeover: true,           // släpp kompressionskontext mellan paket → mindre minne, lite sämre ratio
    clientNoContextTakeover: true,
  },
});
const rooms = new Map(); // code → { hostId, members: Map(id → ws) }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  } while (rooms.has(code));
  return code;
}

let _idCounter = 0;
function genId() { return 'p' + (++_idCounter) + '_' + Math.random().toString(36).slice(2, 7); }

wss.on('connection', (ws) => {
  ws.id = genId();
  ws.isAlive = true;
  console.log('[CONN]', ws.id, 'connected');

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      try { handleBinaryMessage(ws, raw); } catch (e) { console.error('bin-error:', e.message); }
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handleMessage(ws, msg); } catch (e) { console.error('msg-error:', e.message); }
  });

  ws.on('close', () => {
    console.log('[DISC]', ws.id);
    handleDisconnect(ws);
  });

  ws.on('error', (e) => console.warn('[ERR]', ws.id, e.message));
});

// Heartbeat — döda silent connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function broadcast(room, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const [id, m] of room.members) {
    if (id === exceptId) continue;
    if (m.readyState === WebSocket.OPEN) try { m.send(data); } catch (e) {}
  }
}

function sendBinary(ws, buf) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(buf, { binary: true }); } catch (e) {}
}

function broadcastBinary(room, buf, exceptId) {
  for (const [id, m] of room.members) {
    if (id === exceptId) continue;
    sendBinary(m, buf);
  }
}

// Binär message-format (klient → server):
//   [u8 routeByte][u8 idLen][idBytes...][payload...]
//   routeByte = 0 → broadcast i rummet (utom avsändaren)
//   routeByte = 1 → directed till peer med id i idBytes
// Server → klient binär format:
//   [u8 fromIdLen][fromIdBytes...][payload...]
function handleBinaryMessage(ws, raw) {
  // raw är Buffer på Node
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (raw.length < 2) return;
  const routeByte = raw[0];
  const idLen = raw[1];
  if (raw.length < 2 + idLen) return;
  const targetId = idLen > 0 ? raw.slice(2, 2 + idLen).toString('utf8') : '';
  const payload = raw.slice(2 + idLen);
  // Bygg utgående frame: [fromIdLen][fromIdBytes][payload]
  const fromIdBytes = Buffer.from(ws.id, 'utf8');
  const out = Buffer.allocUnsafe(1 + fromIdBytes.length + payload.length);
  out[0] = fromIdBytes.length;
  fromIdBytes.copy(out, 1);
  payload.copy(out, 1 + fromIdBytes.length);
  if (routeByte === 1 && targetId) {
    const target = room.members.get(targetId);
    if (target) sendBinary(target, out);
  } else {
    broadcastBinary(room, out, ws.id);
  }
}

function handleMessage(ws, msg) {
  if (msg.type === 'host') {
    // Skapa rum
    const code = generateCode();
    const room = { code, hostId: ws.id, members: new Map() };
    room.members.set(ws.id, ws);
    rooms.set(code, room);
    ws.roomCode = code;
    send(ws, { type: 'hosted', code, peerId: ws.id });
    console.log('[ROOM]', code, 'created by', ws.id);
    return;
  }

  if (msg.type === 'join') {
    const code = (msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { send(ws, { type: 'error', error: 'Rummet finns inte' }); return; }
    if (room.members.size >= 8) { send(ws, { type: 'error', error: 'Rummet är fullt (max 8)' }); return; }
    room.members.set(ws.id, ws);
    ws.roomCode = code;
    send(ws, { type: 'joined', peerId: ws.id, hostId: room.hostId });
    // Meddela host
    const host = room.members.get(room.hostId);
    if (host) send(host, { type: 'peer_joined', peerId: ws.id });
    console.log('[ROOM]', code, ws.id, 'joined (', room.members.size, 'members)');
    // TDM late-joiner: tilldela team baserat på balans, push tdm_started-event riktat
    if (room.sim && room.sim.tdmActive) {
      let red = 0, blue = 0;
      for (const [, m] of room.members) {
        if (m.tdmTeam === 'red') red++;
        else if (m.tdmTeam === 'blue') blue++;
      }
      const team = red <= blue ? 'red' : 'blue';
      ws.tdmTeam = team;
      const arena = room.sim.tdmArena || { worldW: 4000, worldH: 3000 };
      const spawnX = team === 'red' ? Math.floor(arena.worldW * 0.10) : Math.floor(arena.worldW * 0.90);
      const spawnY = Math.floor(arena.worldH * 0.50);
      ws.playerState = { x: spawnX, y: spawnY, hp: 100, invulnUntil: Date.now() + 1500 };
      room.sim.tdmKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      // Bygg fullständig roster så late-joiner ser alla teams
      const teams = {};
      for (const [pid, m] of room.members) if (m.tdmTeam) teams[pid] = m.tdmTeam;
      // Skicka tdm_started bara till late-joiner (inte broadcast — andra har det redan)
      send(ws, { type: 'sim_event', event: {
        type: 'tdm_started',
        targetKills: room.sim.tdmTargetKills,
        teams,
        arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
        spawns: { red: { x: Math.floor(arena.worldW * 0.10), y: spawnY }, blue: { x: Math.floor(arena.worldW * 0.90), y: spawnY } },
      }});
      // Andra peers får team-uppdatering så deras tdmTeams-roster är komplett
      for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_event', event: { type: 'tdm_team_assigned', peerId: ws.id, team } });
      }
    }
    return;
  }

  if (msg.type === 'relay') {
    // Forwarda meddelande till specifik peer eller alla i rummet
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const payload = { type: 'relay', from: ws.id, data: msg.data };
    if (msg.to) {
      const target = room.members.get(msg.to);
      if (target) send(target, payload);
    } else {
      // Broadcast till alla utom avsändaren
      broadcast(room, payload, ws.id);
    }
    return;
  }

  if (msg.type === 'leave') {
    handleDisconnect(ws);
    return;
  }

  // ── SERVER-AUTHORITATIVE SIM ──────────────────────────────────────────────
  // Phase 1: opt-in via 'sim_start' från host. Server tar över enemy-AI.
  // Klienter skickar sin position via 'sim_input'. Server broadcastar world-paket.
  // Default OFF — gamla host-authoritative kör som tidigare när sim inte är aktiverad.
  if (msg.type === 'sim_start') {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (room.hostId !== ws.id) return;  // bara host får starta
    if (!room.sim) room.sim = createSim(room);
    startSim(room.sim, {
      difficulty: msg.difficulty,
      ngpLevel: msg.ngpLevel,
      mode: msg.mode,
      wave: msg.wave,
      tdm: msg.tdm,
      tdmTargetKills: msg.tdmTargetKills,
    });
    send(ws, { type: 'sim_started' });
    // Meddela alla i rummet
    for (const [, m] of room.members) {
      if (m !== ws) send(m, { type: 'sim_started' });
    }
    return;
  }
  if (msg.type === 'sim_load_stage') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyLoadStage(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_stop') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (room.hostId !== ws.id) return;
    stopSim(room.sim);
    return;
  }
  if (msg.type === 'sim_input') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyPlayerInput(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'server_ping') {
    // Echo tillbaka klient-timestamp så de kan beräkna RTT mot servern
    send(ws, { type: 'server_pong', t: msg.t });
    return;
  }
  if (msg.type === 'sim_shoot') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyShoot(room.sim, ws.id, msg);
    return;
  }
}

function handleDisconnect(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.members.delete(ws.id);
  if (room.hostId === ws.id) {
    // Host lämnade — stäng rummet
    console.log('[ROOM]', room.code, 'closed (host left)');
    if (room.sim) stopSim(room.sim);
    for (const m of room.members.values()) {
      send(m, { type: 'host_left' });
      try { m.close(); } catch (e) {}
    }
    rooms.delete(room.code);
  } else {
    // Vanlig peer lämnade — meddela host
    const host = room.members.get(room.hostId);
    if (host) send(host, { type: 'peer_left', peerId: ws.id });
    console.log('[ROOM]', room.code, ws.id, 'left (', room.members.size, 'members)');
    if (room.members.size === 0) {
      // Säkerhetsnät: stoppa eventuell sim som lever vidare i ett tomt rum
      if (room.sim) stopSim(room.sim);
      rooms.delete(room.code);
    }
  }
}

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  THE PENETRATOR — Co-op Server v1');
  console.log('  Listening on port ' + PORT);
  console.log('═══════════════════════════════════════');
});
