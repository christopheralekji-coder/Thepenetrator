// The Penetrator — Co-op WebSocket relay server
// Deployas på Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const { createSim, startSim, stopSim, applyPlayerInput, applyShoot, applyLoadStage, applyBrDropWeapon, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret, applyCastleDefenseBuild, applyCastleDefenseRepair, applyCastleDefenseUpgrade, applyCastleDefenseSell, applyCastleDefenseInfMoney } = require('./sim/room-sim');
const PORT = process.env.PORT || 8080;

// Healthcheck + error-reporting endpoint
const SERVER_VERSION = 'v161-disconnect-debug';
const SERVER_BUILD_AT = new Date().toISOString();
const errorLog = []; // ring-buffer av senaste 100 client-side errors
const ERROR_LOG_MAX = 100;

// TCP keepalive på alla inkommande HTTP-anslutningar. WS körs på TCP-socket;
// utan OS-level keepalive kan intermediate routers/proxies (Render edge, mobil-NAT)
// släppa "idle" anslutningar trots WS-message-flow. Initial-delay 25s + interval 10s
// håller socketen "warm" oavsett app-level traffic-pattern.
function applyTcpKeepalive(socket) {
  try { socket.setKeepAlive(true, 25000); } catch (e) {}
  try { socket.setNoDelay(true); } catch (e) {} // disable Nagle för låg latens
}

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

wss.on('connection', (ws, req) => {
  ws.id = genId();
  ws.isAlive = true;
  ws._missedPings = 0;
  ws._connectedAt = Date.now();
  // Aktivera TCP keepalive på underliggande socket (fix för Render edge-proxy
  // idle-timeout som dödar WS efter ~60s trots app-traffic).
  if (req && req.socket) applyTcpKeepalive(req.socket);
  console.log('[CONN]', ws.id, 'connected from', req && req.headers ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : '?');

  // Heartbeat: vilken meddelande/pong som helst räknas som "alive".
  ws.on('pong', () => { ws.isAlive = true; ws._missedPings = 0; });

  ws.on('message', (raw, isBinary) => {
    ws.isAlive = true;
    ws._missedPings = 0;
    if (isBinary) {
      try { handleBinaryMessage(ws, raw); } catch (e) { console.error('bin-error:', e.message); }
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handleMessage(ws, msg); } catch (e) { console.error('msg-error:', e.message); }
  });

  // Logga close-code + reason så vi kan diagnostisera disconnect-källan
  // (1000=normal, 1006=abnormal-close, 1011=server-error, 4xxx=app-specific).
  ws.on('close', (code, reason) => {
    const lifetime = Math.round((Date.now() - ws._connectedAt) / 1000);
    const reasonStr = reason ? reason.toString().slice(0, 50) : '';
    console.log('[DISC]', ws.id, 'code=' + code, 'reason="' + reasonStr + '" lifetime=' + lifetime + 's');
    handleDisconnect(ws);
  });

  ws.on('error', (e) => console.warn('[ERR]', ws.id, e.message));
});

// Heartbeat — döda BARA helt silent connections. 25s interval med 3-strike-rule
// (max ~75s grace) så mobila spikes/4G-handoffs inte triggar onödig disconnect.
// Tidigare: 30s ping + 30s grace → ~60s exakt timing matchade Render edge
// idle-timeout och dödade live anslutningar.
const HEARTBEAT_INTERVAL_MS = 25000;
const MAX_MISSED_PINGS = 3; // 3 × 25s = ~75s helt utan svar krävs för terminate
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws._missedPings = (ws._missedPings || 0) + 1;
      if (ws._missedPings >= MAX_MISSED_PINGS) {
        console.log('[HEARTBEAT-KILL]', ws.id, 'missed', ws._missedPings, 'pings');
        ws.terminate();
        continue;
      }
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, HEARTBEAT_INTERVAL_MS);

// RTT-mätning per WS för lag compensation. Server pingar varje aktiv WS-klient
// 1Hz; klient ekar omedelbart tillbaka via srv_rtt_pong. Server beräknar RTT
// och sparar i ws._serverRtt (millisekunder). bullets.js använder det för att
// rewinda target-positioner ws._serverRtt/2 bakåt vid hit-check (cap 200ms).
const RTT_PING_INTERVAL_MS = 1000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // Bara mät RTT när klient är aktivt i ett sim-aktivt rum
    if (!ws.roomCode) continue;
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) continue;
    ws._lastRttPingAt = Date.now();
    try { ws.send(JSON.stringify({ type: 'srv_rtt_ping', t: ws._lastRttPingAt })); } catch (e) {}
  }
}, RTT_PING_INTERVAL_MS);

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
    // SIEGE late-joiner: samma pattern som CTF
    if (room.sim && room.sim.siegeActive) {
      const { SIEGE_ARENA } = require('../shared/siege-arena');
      let red = 0, blue = 0;
      for (const [, m] of room.members) {
        if (m.tdmTeam === 'red') red++;
        else if (m.tdmTeam === 'blue') blue++;
      }
      const team = red <= blue ? 'red' : 'blue';
      ws.tdmTeam = team;
      const pts = SIEGE_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
      room.sim.siegeKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      const teams = {};
      for (const [pid, m] of room.members) if (m.tdmTeam) teams[pid] = m.tdmTeam;
      send(ws, { type: 'sim_events', events: [{
        type: 'siege_started',
        targetPoints: room.sim.siegeTargetPoints,
        teams,
        arena: { worldW: SIEGE_ARENA.worldW, worldH: SIEGE_ARENA.worldH, name: SIEGE_ARENA.name },
        spawns: SIEGE_ARENA.spawns,
        walls: SIEGE_ARENA.walls,
        cores: Object.values(room.sim.siegeCores).map(c => ({ id: c.id, team: c.team, x: c.x, y: c.y, w: c.w, h: c.h, maxHp: c.maxHp, hp: c.hp })),
        bases: Object.values(room.sim.siegeBases).map(b => ({ id: b.id, x: b.x, y: b.y, r: b.r, owner: b.owner })),
        turrets: Object.values(room.sim.siegeTurrets).map(t => ({
          id: t.id, team: t.team, x: t.x, y: t.y, r: t.r, maxHp: t.maxHp, hp: t.hp,
          weaponId: t.weaponId, turretType: t.turretType,
        })),
        turretEnterRadius: SIEGE_ARENA.turretEnterRadius,
        captureTimeSec: SIEGE_ARENA.captureTimeSec,
        neutralizeTimeSec: SIEGE_ARENA.neutralizeTimeSec,
        decorations: SIEGE_ARENA.decorations || [],
        pvpPickups: (room.sim.pvpPickups || []).map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
        shieldMax: 100,
      }] });
      for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_events', events: [{ type: 'siege_team_assigned', peerId: ws.id, team }] });
      }
    }
    // GUNGAME late-joiner: spawna på roterande spawn, tier 0, FFA (inget team)
    if (room.sim && room.sim.gungameActive) {
      const { GUNGAME_ARENA, GUNGAME_WEAPONS } = require('../shared/gungame-arena');
      const idx = (room.sim._gungameSpawnIdx || 0) % GUNGAME_ARENA.spawns.length;
      room.sim._gungameSpawnIdx = (room.sim._gungameSpawnIdx || 0) + 1;
      const sp = GUNGAME_ARENA.spawns[idx];
      ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500, weaponId: GUNGAME_WEAPONS[0] };
      ws.tdmTeam = null; // FFA
      room.sim.gungameTiers[ws.id] = 0;
      room.sim.gungameKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      const lateJoinEvents = [{
        type: 'gungame_started',
        arena: { worldW: GUNGAME_ARENA.worldW, worldH: GUNGAME_ARENA.worldH, name: GUNGAME_ARENA.name },
        walls: GUNGAME_ARENA.walls,
        spawns: GUNGAME_ARENA.spawns,
        decorations: GUNGAME_ARENA.decorations || [],
        weapons: GUNGAME_WEAPONS,
        totalTiers: GUNGAME_WEAPONS.length,
        shieldMax: 100,
      }];
      // Om sim fortfarande är i 5s prep-countdown, skicka countdown_start med
      // resten av tiden så late-joiner ser samma overlay som andra spelare.
      if (room.sim.simReadyAt && Date.now() < room.sim.simReadyAt) {
        lateJoinEvents.push({
          type: 'countdown_start',
          durationMs: room.sim.simReadyAt - Date.now(),
        });
      }
      // Befintliga bots — late-joiner ser dem inte utan synthetiska bot_joined
      if (room.sim._botIds && room.sim._botIds.length) {
        const memberList = [...room.members.keys()];
        for (const botId of room.sim._botIds) {
          const botWs = room.members.get(botId);
          if (!botWs) continue;
          lateJoinEvents.push({
            type: 'bot_joined',
            peerId: botId,
            name: botWs.name || 'BOT',
            team: botWs.tdmTeam || null,
            colorIdx: memberList.indexOf(botId),
          });
        }
      }
      send(ws, { type: 'sim_events', events: lateJoinEvents });
    }
    // KOTH late-joiner: spawna på roterande spawn-point + skicka current scores
    if (room.sim && room.sim.kothActive) {
      const { KOTH_ARENA } = require('../shared/koth-arena');
      const idx = (room.sim._kothSpawnIdx || 0) % KOTH_ARENA.spawns.length;
      room.sim._kothSpawnIdx = (room.sim._kothSpawnIdx || 0) + 1;
      const sp = KOTH_ARENA.spawns[idx];
      ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500, weaponId: 'pistol' };
      ws.tdmTeam = null;
      room.sim.kothScores[ws.id] = 0;
      room.sim.kothKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      room.sim._kothPointAccum[ws.id] = 0;
      const lateKothEvents = [{
        type: 'koth_started',
        arena: { worldW: KOTH_ARENA.worldW, worldH: KOTH_ARENA.worldH, name: KOTH_ARENA.name },
        walls: KOTH_ARENA.walls,
        spawns: KOTH_ARENA.spawns,
        decorations: KOTH_ARENA.decorations || [],
        zones: KOTH_ARENA.zones,
        activeZoneIdx: room.sim.kothActiveZoneIdx || 0,
        zoneRotateSec: KOTH_ARENA.zoneRotateSec,
        targetPoints: room.sim.kothTargetPoints,
        pvpPickups: (room.sim.pvpPickups || []).map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
        shieldMax: 100,
      }];
      // Aktuella scores så late-joiner ser leaderboard direkt
      lateKothEvents.push({
        type: 'koth_score_update',
        scores: { ...(room.sim.kothScores || {}) },
        target: room.sim.kothTargetPoints,
      });
      // Också nästa zone-rotate-tid
      if (room.sim._kothZoneRotateAt) {
        const zone = KOTH_ARENA.zones[room.sim.kothActiveZoneIdx || 0];
        lateKothEvents.push({
          type: 'koth_zone_changed',
          idx: room.sim.kothActiveZoneIdx || 0,
          x: zone.x, y: zone.y, r: zone.r, name: zone.name,
          nextRotateAt: room.sim._kothZoneRotateAt,
        });
      }
      // Befintliga bots i sim:n — late-joiner ser dem inte annars (bot_joined
      // emittades vid sim-start och queuen tömdes innan denna spelare anslöt).
      if (room.sim._botIds && room.sim._botIds.length) {
        const memberList = [...room.members.keys()];
        for (const botId of room.sim._botIds) {
          const botWs = room.members.get(botId);
          if (!botWs) continue;
          lateKothEvents.push({
            type: 'bot_joined',
            peerId: botId,
            name: botWs.name || 'BOT',
            team: botWs.tdmTeam || null,
            colorIdx: memberList.indexOf(botId),
          });
        }
      }
      send(ws, { type: 'sim_events', events: lateKothEvents });
    }
    // JUGGERNAUT late-joiner: spawn som hunter, roterande spawn-pos, fresh score
    if (room.sim && room.sim.juggernautActive) {
      const { JUGGERNAUT_ARENA } = require('../shared/juggernaut-arena');
      const idx = (room.sim._juggernautSpawnIdx || 0) % JUGGERNAUT_ARENA.spawns.length;
      room.sim._juggernautSpawnIdx = (room.sim._juggernautSpawnIdx || 0) + 1;
      const sp = JUGGERNAUT_ARENA.spawns[idx];
      ws.playerState = {
        x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, maxHp: 100,
        invulnUntil: Date.now() + 1500,
        weaponId: JUGGERNAUT_ARENA.hunterWeapon,
        isJug: false, scaleMul: 1.0, speedMul: 1.0, dashCdMs: null,
      };
      ws.tdmTeam = null;
      room.sim.juggernautScores[ws.id] = 0;
      room.sim.juggernautKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      const lateJugEvents = [{
        type: 'juggernaut_started',
        arena: { worldW: JUGGERNAUT_ARENA.worldW, worldH: JUGGERNAUT_ARENA.worldH, name: JUGGERNAUT_ARENA.name },
        walls: JUGGERNAUT_ARENA.walls,
        spawns: JUGGERNAUT_ARENA.spawns,
        decorations: JUGGERNAUT_ARENA.decorations || [],
        pvpPickups: (room.sim.pvpPickups || []).map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
        shieldMax: 100,
        initialJug: room.sim.juggernautPid,
        jugWeapons: JUGGERNAUT_ARENA.jugWeapons,
        jugDefaultWeapon: JUGGERNAUT_ARENA.jugDefaultWeapon,
        jugHpMax: room.sim.juggernautHpMax,
        jugSpeedMul: JUGGERNAUT_ARENA.jugSpeedMul,
        jugScale: JUGGERNAUT_ARENA.jugScale,
        jugDashCdMs: JUGGERNAUT_ARENA.jugDashCdMs,
        hunterWeapon: JUGGERNAUT_ARENA.hunterWeapon,
        matchDurationSec: room.sim.juggernautMatchDurationSec,
        matchEndAt: room.sim.juggernautEndAt,
        minimapPulseIntervalMs: JUGGERNAUT_ARENA.minimapPulseIntervalMs,
      }];
      // Aktuella scores för leaderboard
      const scoresRounded = {};
      for (const pid of Object.keys(room.sim.juggernautScores || {})) {
        scoresRounded[pid] = Math.floor(room.sim.juggernautScores[pid]);
      }
      lateJugEvents.push({
        type: 'juggernaut_score_update',
        scores: scoresRounded,
        currentJug: room.sim.juggernautPid,
        msRemaining: Math.max(0, room.sim.juggernautEndAt - Date.now()),
      });
      if (room.sim._botIds && room.sim._botIds.length) {
        const memberList = [...room.members.keys()];
        for (const botId of room.sim._botIds) {
          const botWs = room.members.get(botId);
          if (!botWs) continue;
          lateJugEvents.push({
            type: 'bot_joined',
            peerId: botId,
            name: botWs.name || 'BOT',
            team: null,
            colorIdx: memberList.indexOf(botId),
          });
        }
      }
      send(ws, { type: 'sim_events', events: lateJugEvents });
    }
    // BATTLE ROYALE late-joiner: BR är no-respawn — sätt direkt som spectator.
    // Klient renderar match från spectator-cam. När matchen slutar kan de joina
    // rematch (vanlig flow).
    if (room.sim && room.sim.battleroyaleActive) {
      const { BATTLEROYALE_ARENA } = require('../shared/battleroyale-arena');
      // Spawnpos i mitten — de blir spectator omedelbart (hp=0)
      ws.playerState = {
        x: BATTLEROYALE_ARENA.worldW / 2,
        y: BATTLEROYALE_ARENA.worldH / 2,
        hp: 0, // dead = spectator från start
        maxHp: BATTLEROYALE_ARENA.maxHp,
        shield: 0,
        maxShield: BATTLEROYALE_ARENA.maxShield,
        invulnUntil: 0,
        weaponId: BATTLEROYALE_ARENA.startWeapon,
        isJug: false, scaleMul: 1.0, speedMul: 1.0, dashCdMs: null,
      };
      ws.tdmTeam = null;
      ws.tdmRespawnAt = 0;
      // Markera som already-eliminated så de inte räknas i alive-count + ger placement-999
      if (!room.sim.battleroyaleEliminated.includes(ws.id)) {
        room.sim.battleroyaleEliminated.push(ws.id);
        room.sim.battleroyaleRanks[ws.id] = 999; // late = ranking N/A
      }
      room.sim.battleroyaleKillsByPid[ws.id] = 0;
      room.sim.tdmDeathsByPid[ws.id] = 0;
      const lateBrEvents = [{
        type: 'br_started',
        arena: { worldW: BATTLEROYALE_ARENA.worldW, worldH: BATTLEROYALE_ARENA.worldH, name: BATTLEROYALE_ARENA.name },
        walls: BATTLEROYALE_ARENA.walls,
        spawns: BATTLEROYALE_ARENA.spawns,
        decorations: BATTLEROYALE_ARENA.decorations || [],
        cabins: BATTLEROYALE_ARENA.cabins || [],
        loot: (room.sim.battleroyaleLoot || []).filter(lo => lo.available).map(lo => ({
          id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: lo.unlockAt || 0,
        })),
        phases: BATTLEROYALE_ARENA.phases,
        matchDurationSec: room.sim.battleroyaleMatchDurationSec,
        matchEndAt: room.sim.battleroyaleEndAt,
        phaseEndAt: room.sim.battleroyalePhaseEndAt,
        currentPhase: room.sim.battleroyalePhase,
        zone: room.sim.battleroyaleZone ? {
          x: room.sim.battleroyaleZone.x,
          y: room.sim.battleroyaleZone.y,
          r: room.sim.battleroyaleZone.r,
        } : { x: BATTLEROYALE_ARENA.worldW / 2, y: BATTLEROYALE_ARENA.worldH / 2, r: 1000 },
        aliveCount: room.sim.battleroyaleAliveCount,
        startWeapon: BATTLEROYALE_ARENA.startWeapon,
        startHp: BATTLEROYALE_ARENA.startHp,
        maxHp: BATTLEROYALE_ARENA.maxHp,
        maxShield: BATTLEROYALE_ARENA.maxShield,
        lootPickupRadius: BATTLEROYALE_ARENA.lootPickupRadius,
        shieldMax: BATTLEROYALE_ARENA.maxShield,
        isSpectator: true, // klient ska direkt gå in i spec-cam
      }];
      if (room.sim._botIds && room.sim._botIds.length) {
        const memberList = [...room.members.keys()];
        for (const botId of room.sim._botIds) {
          const botWs = room.members.get(botId);
          if (!botWs) continue;
          lateBrEvents.push({
            type: 'bot_joined',
            peerId: botId,
            name: botWs.name || 'BOT',
            team: null,
            colorIdx: memberList.indexOf(botId),
          });
        }
      }
      send(ws, { type: 'sim_events', events: lateBrEvents });
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
    // Tillämpa team-assignments från host (om shuffle/pick aktiverat).
    // msg.teams: { peerId → 'red' | 'blue' }. Sätt ws.tdmTeam INNAN startSim
    // så room-sim plockar upp dem istället för i%2-defaulten.
    if (msg.teams && typeof msg.teams === 'object') {
      for (const [pid, team] of Object.entries(msg.teams)) {
        const member = room.members.get(pid);
        if (member && (team === 'red' || team === 'blue')) {
          member.tdmTeam = team;
        }
      }
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
      siege: msg.siege,
      siegeTargetPoints: msg.siegeTargetPoints,
      gungame: msg.gungame,
      koth: msg.koth,
      kothTargetPoints: msg.kothTargetPoints,
      juggernaut: msg.juggernaut,
      juggernautMatchDurationSec: msg.juggernautMatchDurationSec,
      battleroyale: msg.battleroyale,
      battleroyaleMatchDurationSec: msg.battleroyaleMatchDurationSec,
      castledefense: msg.castledefense,
      addBot: !!msg.addBot,
      botCount: Math.max(1, Math.min(7, msg.botCount || 1)),
      botSkill: msg.botSkill || 'normal',
      botTeam: msg.botTeam,
      botNames: Array.isArray(msg.botNames) ? msg.botNames : null,
      botTeams: Array.isArray(msg.botTeams) ? msg.botTeams : null,
    });
    // Markera rummet som "startat" i public-listan + uppdatera mode
    if (room.meta) {
      room.meta.started = true;
      if (msg.battleroyale) room.meta.mode = 'battleroyale';
      else if (msg.castledefense) room.meta.mode = 'castledefense';
      else if (msg.juggernaut) room.meta.mode = 'juggernaut';
      else if (msg.koth) room.meta.mode = 'koth';
      else if (msg.gungame) room.meta.mode = 'gungame';
      else if (msg.siege) room.meta.mode = 'siege';
      else if (msg.ctf) room.meta.mode = 'ctf';
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

  // CTF turret-enter: spelaren vill mounta turret. Server auktoritet kollar
  // avstånd + lag + ledig + ej destroyed.
  if (msg.type === 'ctf_turret_enter') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.ctfActive) return;
    tryEnterTurret(room.sim, ws.id, msg.turretId);
    return;
  }
  if (msg.type === 'ctf_turret_exit') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.ctfActive) return;
    const tid = msg.turretId;
    const t = room.sim.ctfTurrets && room.sim.ctfTurrets[tid];
    if (t && t.occupantId === ws.id) {
      exitTurret(room.sim, tid, 'manual');
    }
    return;
  }
  // SIEGE turret-enter / exit
  if (msg.type === 'siege_turret_enter') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.siegeActive) return;
    tryEnterSiegeTurret(room.sim, ws.id, msg.turretId);
    return;
  }
  if (msg.type === 'siege_turret_exit') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.siegeActive) return;
    const tid = msg.turretId;
    const t = room.sim.siegeTurrets && room.sim.siegeTurrets[tid];
    if (t && t.occupantId === ws.id) {
      exitSiegeTurret(room.sim, tid, 'manual');
    }
    return;
  }

  // PvP-shield-ability: 3s immunitet, 45s cooldown. TDM/CTF/Siege.
  if (msg.type === 'pvp_ability_shield') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.tdmActive && !room.sim.ctfActive && !room.sim.siegeActive && !room.sim.kothActive && !room.sim.gungameActive && !room.sim.juggernautActive && !room.sim.battleroyaleActive && !room.sim.castledefenseActive) return;
    if (!ws.playerState || ws.playerState.hp <= 0) return;
    const now = Date.now();
    const SHIELD_DURATION = 3000;
    // Juggernaut: JUG har 45s CD, hunters 20s CD. Andra modes: 45s standard.
    let SHIELD_COOLDOWN = 45000;
    if (room.sim.juggernautActive) {
      const isJug = ws.playerState.isJug;
      SHIELD_COOLDOWN = isJug ? 45000 : 20000;
    }
    if (ws._lastShieldUseAt && now - ws._lastShieldUseAt < SHIELD_COOLDOWN) return; // cooldown
    ws._lastShieldUseAt = now;
    // Sätter invulnUntil — bullets.js/explode kollar redan denna
    ws.playerState.invulnUntil = Math.max(ws.playerState.invulnUntil || 0, now + SHIELD_DURATION);
    // Broadcasta så alla klienter renderar bubblan + ljudet
    room.sim.eventQueue.push({
      type: 'pvp_shield_used',
      peerId: ws.id,
      durationMs: SHIELD_DURATION,
      cooldownMs: SHIELD_COOLDOWN, // klient använder för CD-ring
    });
    return;
  }
  // JUGGERNAUT vapen-byte: bara nuvarande JUG-spelaren får byta, valet måste
  // vara inom listan från arena-konfig.
  if (msg.type === 'juggernaut_weapon_change') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (!room.sim.juggernautActive || room.sim.juggernautEnded) return;
    if (room.sim.juggernautPid !== ws.id) return;
    const { JUGGERNAUT_ARENA } = require('../shared/juggernaut-arena');
    const newWeapon = msg.weaponId;
    if (!JUGGERNAUT_ARENA.jugWeapons.includes(newWeapon)) return;
    room.sim.juggernautWeapon = newWeapon;
    if (ws.playerState) ws.playerState.weaponId = newWeapon;
    room.sim.eventQueue.push({
      type: 'juggernaut_weapon_changed',
      peerId: ws.id,
      weaponId: newWeapon,
    });
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
  // Lag comp: klient ekar tillbaka RTT-ping. Server beräknar RTT och sparar.
  // Smooth via EMA (0.3 ny, 0.7 gammal) så enstaka spikes inte ger felaktig rewind.
  if (msg.type === 'srv_rtt_pong') {
    const now = Date.now();
    const sent = typeof msg.t === 'number' ? msg.t : ws._lastRttPingAt;
    if (sent) {
      const rtt = Math.max(0, Math.min(500, now - sent));
      ws._serverRtt = ws._serverRtt == null ? rtt : Math.round(ws._serverRtt * 0.7 + rtt * 0.3);
    }
    return;
  }
  if (msg.type === 'sim_shoot') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyShoot(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_br_drop') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrDropWeapon(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_build') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseBuild(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_repair') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseRepair(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_upgrade') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseUpgrade(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_sell') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseSell(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_infmoney') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseInfMoney(room.sim, ws.id, msg);
    return;
  }
  // v1.376: Granat-throw från klient. Server schemalägger detonation efter
  // flight-time och kör explode() (med friendly-fire-regler + turret-damage).
  // v1.381: server pushar grenade_thrown till eventQueue → broadcastas till
  // alla peers så de ser projektilen + explosion-VFX (tidigare såg motståndare
  // bara HP-droppet, ingen visuell granat).
  if (msg.type === 'sim_grenade_throw') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    const sim = room.sim;
    const fromX = Math.max(0, Math.min(20000, +msg.fromX || 0));
    const fromY = Math.max(0, Math.min(20000, +msg.fromY || 0));
    const toX = Math.max(0, Math.min(20000, +msg.toX || 0));
    const toY = Math.max(0, Math.min(20000, +msg.toY || 0));
    const FLIGHT_MS = 800;
    const RADIUS = 85;
    const DMG = 120;
    // Broadcast till alla klienter (inkl thrower — thrower dedupar via ownerPid)
    sim.eventQueue.push({
      type: 'grenade_thrown',
      ownerPid: ws.id,
      fromX, fromY, toX, toY,
      flightMs: FLIGHT_MS,
      radius: RADIUS,
    });
    setTimeout(() => {
      if (!sim || sim._stopped) return;
      const { explode } = require('./sim/bullets');
      if (typeof explode === 'function') {
        explode(sim, toX, toY, RADIUS, DMG, ws.id);
      }
    }, FLIGHT_MS);
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
    // JUGGERNAUT: om JUG-spelaren disconnectade, frigör JUG-rollen så nästa
    // human-respawn ärver den (i stället för att JUG sitter död tills timer går ut).
    if (room.sim && room.sim.juggernautActive && room.sim.juggernautPid === ws.id) {
      room.sim.juggernautPid = null;
      room.sim._juggernautAwaitFirstRespawn = true;
      room.sim.eventQueue.push({
        type: 'juggernaut_jug_changed',
        newJug: null, oldJug: ws.id, reason: 'jug_disconnected',
        weapon: room.sim.juggernautWeapon, jugHp: room.sim.juggernautHpMax,
      });
    }
    // KRITISKT: räkna inte bots i tom-rum-check, annars lever sim:en vidare med
    // bara bot-ws kvar (rum-läcka, evig bot-AI-tick).
    let realCount = 0;
    for (const [, m] of room.members) { if (!m._isBot) realCount++; }
    if (realCount === 0) {
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
