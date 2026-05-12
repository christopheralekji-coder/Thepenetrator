// The Penetrator — Co-op WebSocket relay server
// Deployas på Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const { createSim, startSim, stopSim, applyPlayerInput, applyShoot, applyLoadStage } = require('./sim/room-sim');
const PORT = process.env.PORT || 8080;

// Healthcheck + error-reporting endpoint
const SERVER_VERSION = 'v131-skills-batch';
const SERVER_BUILD_AT = new Date().toISOString();
const errorLog = []; // ring-buffer av senaste 100 client-side errors
const ERROR_LOG_MAX = 100;

const server = http.createServer((req, res) => {
  // CORS för fetch från klient (PWA)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Penetrator co-op server\nVersion: ${SERVER_VERSION}\nBuilt: ${SERVER_BUILD_AT}\nRooms: ${rooms.size}\nUptime: ${Math.round(process.uptime())}s\nErrors logged: ${errorLog.length}`);
    return;
  }
  if (req.url === '/errors' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorLog, null, 2));
    return;
  }
  if (req.url === '/errors' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5000) { req.destroy(); }});
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const entry = {
          ts: new Date().toISOString(),
          msg: String(data.msg || '').slice(0, 500),
          src: String(data.src || '').slice(0, 200),
          line: data.line | 0,
          stack: String(data.stack || '').slice(0, 1000),
          ua: String(data.ua || '').slice(0, 200),
          version: String(data.version || '').slice(0, 30),
        };
        errorLog.unshift(entry);
        if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
        console.log('[CLIENT-ERR]', entry.version, entry.msg.slice(0, 80));
        res.writeHead(204); res.end();
      } catch (e) {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }
  res.writeHead(404); res.end();
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
const rooms = new Map(); // code → { hostId, members: Map(id → ws), meta: { hostName, mode, private, started, createdAt } }
const publicRoomSubscribers = new Set(); // ws-references som vill ha live room-list updates

// Bygg publikt room-snapshot för broadcast/snapshot till browse-skärmen
function buildPublicRoomsList() {
  const list = [];
  for (const [code, room] of rooms) {
    if (room.meta && room.meta.private) continue;
    list.push({
      code,
      hostName: (room.meta && room.meta.hostName) || 'Spelare',
      mode: (room.meta && room.meta.mode) || 'story',
      players: room.members.size,
      maxPlayers: 8,
      started: !!(room.meta && room.meta.started),
      createdAt: (room.meta && room.meta.createdAt) || 0,
    });
  }
  // Senaste rummen först
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function broadcastPublicRooms() {
  if (publicRoomSubscribers.size === 0) return;
  // Lokalt namn `list` (inte `rooms`) så vi inte skuggar module-level `rooms` Map
  const list = buildPublicRoomsList();
  const json = JSON.stringify({ type: 'public_rooms', rooms: list });
  for (const ws of publicRoomSubscribers) {
    if (ws.readyState === 1) try { ws.send(json); } catch (e) {}
  }
}

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
    const hostName = String(msg.name || '').trim().slice(0, 14) || 'Spelare';
    const mode = String(msg.mode || 'story').slice(0, 16);
    const isPrivate = !!msg.private;
    const room = {
      code,
      hostId: ws.id,
      members: new Map(),
      meta: { hostName, mode, private: isPrivate, started: false, createdAt: Date.now() },
    };
    room.members.set(ws.id, ws);
    rooms.set(code, room);
    ws.roomCode = code;
    ws.playerName = hostName;
    send(ws, { type: 'hosted', code, peerId: ws.id });
    console.log('[ROOM]', code, 'created by', ws.id, 'name="' + hostName + '" mode=' + mode + (isPrivate ? ' [PRIVATE]' : ''));
    broadcastPublicRooms();
    return;
  }

  // Host kan uppdatera room-meta (mode/namn/private) — speglas i public-rooms-list
  if (msg.type === 'update_room_meta') {
    const room = rooms.get(ws.roomCode);
    if (!room || room.hostId !== ws.id) return;
    if (msg.hostName != null) {
      room.meta.hostName = String(msg.hostName).trim().slice(0, 14) || 'Spelare';
      ws.playerName = room.meta.hostName;
    }
    if (msg.mode != null) room.meta.mode = String(msg.mode).slice(0, 16);
    if (msg.private != null) room.meta.private = !!msg.private;
    broadcastPublicRooms();
    return;
  }

  // Klient vill se publika rum (engångs-snapshot)
  if (msg.type === 'list_public_rooms') {
    send(ws, { type: 'public_rooms', rooms: buildPublicRoomsList() });
    return;
  }

  // Klient prenumererar på publika rum-uppdateringar (live på join-skärmen)
  if (msg.type === 'subscribe_public_rooms') {
    publicRoomSubscribers.add(ws);
    send(ws, { type: 'public_rooms', rooms: buildPublicRoomsList() });
    return;
  }
  if (msg.type === 'unsubscribe_public_rooms') {
    publicRoomSubscribers.delete(ws);
    return;
  }

  if (msg.type === 'join') {
    const code = (msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) { send(ws, { type: 'error', error: 'Rummet finns inte' }); return; }
    if (room.members.size >= 8) { send(ws, { type: 'error', error: 'Rummet är fullt (max 8)' }); return; }
    room.members.set(ws.id, ws);
    ws.roomCode = code;
    if (msg.name) ws.playerName = String(msg.name).trim().slice(0, 14);
    send(ws, { type: 'joined', peerId: ws.id, hostId: room.hostId });
    // Meddela host
    const host = room.members.get(room.hostId);
    if (host) send(host, { type: 'peer_joined', peerId: ws.id });
    console.log('[ROOM]', code, ws.id, 'joined (', room.members.size, 'members)');
    broadcastPublicRooms();
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
      // Late-joiner får också shield + maxShield (annars saknar de PvP-shield helt)
      ws.playerState = { x: spawnX, y: spawnY, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
      room.sim.tdmKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      // Bygg fullständig roster så late-joiner ser alla teams
      const teams = {};
      for (const [pid, m] of room.members) if (m.tdmTeam) teams[pid] = m.tdmTeam;
      send(ws, { type: 'sim_events', events: [{
        type: 'tdm_started',
        targetKills: room.sim.tdmTargetKills,
        teams,
        arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
        spawns: { red: { x: Math.floor(arena.worldW * 0.10), y: spawnY }, blue: { x: Math.floor(arena.worldW * 0.90), y: spawnY } },
        pvpPickups: (room.sim.pvpPickups || []).map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
        shieldMax: 100,
      }] });
      for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_events', events: [{ type: 'tdm_team_assigned', peerId: ws.id, team }] });
      }
    }
    // CTF late-joiner: samma pattern men för CTF-arena + flag-state + ctf_started
    if (room.sim && room.sim.ctfActive) {
      const { CTF_ARENA } = require('../shared/ctf-arena');
      let red = 0, blue = 0;
      for (const [, m] of room.members) {
        if (m.tdmTeam === 'red') red++;
        else if (m.tdmTeam === 'blue') blue++;
      }
      const team = red <= blue ? 'red' : 'blue';
      ws.tdmTeam = team;
      const pts = CTF_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
      room.sim.ctfKillsByPid[ws.id] = 0;
      room.sim.ctfCapturesByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      const teams = {};
      for (const [pid, m] of room.members) if (m.tdmTeam) teams[pid] = m.tdmTeam;
      send(ws, { type: 'sim_events', events: [{
        type: 'ctf_started',
        targetCaptures: room.sim.ctfTargetCaptures,
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
        pvpPickups: (room.sim.pvpPickups || []).map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
        shieldMax: 100,
      }] });
      for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_events', events: [{ type: 'ctf_team_assigned', peerId: ws.id, team }] });
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
    // Rematch / mode-byte: stoppa ev. tidigare sim och skapa en ny så ingen
    // gammal state (tdmActive/ctfActive/scores/pickup-ids) läcker in i nästa match.
    if (room.sim) {
      try { stopSim(room.sim); } catch (e) {}
    }
    room.sim = createSim(room);
    startSim(room.sim, {
      difficulty: msg.difficulty,
      ngpLevel: msg.ngpLevel,
      mode: msg.mode,
      wave: msg.wave,
      tdm: msg.tdm,
      tdmTargetKills: msg.tdmTargetKills,
      ctf: msg.ctf,
      ctfTargetCaptures: msg.ctfTargetCaptures,
    });
    // Markera rummet som "startat" i public-listan + uppdatera mode om CTF/TDM
    if (room.meta) {
      room.meta.started = true;
      if (msg.ctf) room.meta.mode = 'ctf';
      else if (msg.tdm) room.meta.mode = 'tdm';
      else if (msg.mode) room.meta.mode = msg.mode;
    }
    broadcastPublicRooms();
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
    if (room.meta) room.meta.started = false;
    broadcastPublicRooms();
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
  // Rensa public-rooms-prenumeration
  publicRoomSubscribers.delete(ws);
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
  broadcastPublicRooms();
}

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  THE PENETRATOR — Co-op Server v1');
  console.log('  Listening on port ' + PORT);
  console.log('═══════════════════════════════════════');
});
