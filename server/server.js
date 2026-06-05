// WarParty — Co-op WebSocket relay server
// Deployas på Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const { createSim, startSim, stopSim, applyPlayerInput, applyShoot, applyLoadStage, applyBrDropWeapon, applyBrBuy, applyBrInfCash, applyBrAirstrike, applyBrUseUav, applyBrAcceptContract, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret, applyCastleDefenseBuild, applyCastleDefenseRepair, applyCastleDefenseUpgrade, applyCastleDefenseSell, applyCastleDefensePerk, applyCastleDefenseInfMoney } = require('./sim/room-sim');
const PORT = process.env.PORT || 8080;

// Healthcheck + error-reporting endpoint
const SERVER_VERSION = 'v248-lifecycle-fix-v1.769';
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
    res.end(`WarParty co-op server\nVersion: ${SERVER_VERSION}\nBuilt: ${SERVER_BUILD_AT}\nRooms: ${rooms.size}\nUptime: ${Math.round(process.uptime())}s\nErrors logged: ${errorLog.length}`);
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
      // stable-slot: host=0, peers tilldelas 1,2,... vid join. Lediga slots
      // återanvänds via _freeSlots-listan så en ny peer som joinar efter att
      // en annan lämnat får det lägsta lediga slot-numret.
      _nextSlot: 1,
      _freeSlots: [],
    };
    room.members.set(ws.id, ws);
    rooms.set(code, room);
    ws.roomCode = code;
    ws.playerName = hostName;
    // Host är alltid slot 0
    ws.stableSlot = 0;
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
    // Tilldela stabilt slot-index: återanvänd lägsta lediga slot först,
    // annars ta nästa från räknaren. Slot ändras ALDRIG för en peer under
    // dess session; när peer lämnar returneras slottet till _freeSlots.
    if (!room._freeSlots) room._freeSlots = [];
    if (!room._nextSlot) room._nextSlot = 1;
    let slot;
    if (room._freeSlots.length > 0) {
      room._freeSlots.sort((a, b) => a - b);
      slot = room._freeSlots.shift();
    } else {
      slot = room._nextSlot++;
    }
    ws.stableSlot = slot;
    room.members.set(ws.id, ws);
    ws.roomCode = code;
    if (msg.name) ws.playerName = String(msg.name).trim().slice(0, 14);
    // v1.659: reconnect-restore — om token matchar en färsk stash (spelare som tappade
    // anslutningen <60s sedan i aktiv sim) återställ server-side-only-state som INTE
    // self-healar via sim_input: Heist-roll + hp/shield (annars gratis-heal + roll-loss).
    // Körs FÖRE late-join-blocken; PvP-blocken sätter sedan fresh spawn (korrekt för PvP),
    // co-op/heist (utan PvP-block) behåller restoren.
    if (msg.reconnectToken) {
      ws._reconnectToken = String(msg.reconnectToken).slice(0, 40);
      // v1.697: rensa utgångna stash-entries (>60s) så de inte ackumuleras obegränsat
      // (DoS-yta: join-flood med unika tokens utan reconnect). Cappa även till 16 nyaste.
      if (room._reconnectStash) {
        const _cut = Date.now() - 60000;
        for (const k of Object.keys(room._reconnectStash)) {
          if ((room._reconnectStash[k].ts || 0) < _cut) delete room._reconnectStash[k];
        }
        const _live = Object.keys(room._reconnectStash);
        if (_live.length > 16) {
          _live.sort((a, b) => (room._reconnectStash[b].ts || 0) - (room._reconnectStash[a].ts || 0));
          for (const k of _live.slice(16)) delete room._reconnectStash[k];
        }
      }
      const stash = room._reconnectStash && room._reconnectStash[ws._reconnectToken];
      if (stash && Date.now() - stash.ts < 60000) {
        ws._heistRole = stash.heistRole;
        ws._heistRoleLocked = stash.heistRoleLocked;
        if (!ws.playerState) ws.playerState = {};
        if (stash.hp != null && stash.hp > 0) ws.playerState.hp = stash.hp;
        if (stash.maxHp != null) ws.playerState.maxHp = stash.maxHp;
        if (stash.shield != null) ws.playerState.shield = stash.shield;
        if (stash.speedMul != null) ws.playerState.speedMul = stash.speedMul;
        if (room.sim && stash.heistRole) { room.sim.heistRoles = room.sim.heistRoles || {}; room.sim.heistRoles[ws.id] = stash.heistRole; }
        delete room._reconnectStash[ws._reconnectToken];
        console.log('[ROOM]', code, ws.id, 'reconnect-restored role=' + (stash.heistRole || '-') + ' hp=' + (stash.hp != null ? Math.round(stash.hp) : '-'));
      }
    }
    send(ws, { type: 'joined', peerId: ws.id, hostId: room.hostId });
    // Meddela host — inkludera stableSlot så host:s klient bygger slotToPeerId
    // med det stabila slot-numret (annars räknas colorIdx om vid varje join).
    const host = room.members.get(room.hostId);
    if (host) send(host, { type: 'peer_joined', peerId: ws.id, stableSlot: ws.stableSlot });
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
            colorIdx: (botWs.stableSlot != null) ? botWs.stableSlot : memberList.indexOf(botId),
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
            colorIdx: (botWs.stableSlot != null) ? botWs.stableSlot : memberList.indexOf(botId),
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
            colorIdx: (botWs.stableSlot != null) ? botWs.stableSlot : memberList.indexOf(botId),
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
            colorIdx: (botWs.stableSlot != null) ? botWs.stableSlot : memberList.indexOf(botId),
          });
        }
      }
      send(ws, { type: 'sim_events', events: lateBrEvents });
      return;
    }

    // HEIST late-joiner (v1.697): förr fanns inget block → joinaren blev ett spöke
    // utan roll/fas/UI mid-match. Skicka full heist_started + aktuell fas/progress.
    if (room.sim && room.sim.heistActive && !room.sim.heistEnded) {
      const sim = room.sim;
      const { HEIST_ARENA: arena } = require('../shared/heist-arena');
      const hsp = (arena.playerSpawns && arena.playerSpawns[0]) || { x: arena.worldW / 2, y: arena.worldH / 2 };
      ws.playerState = {
        x: hsp.x, y: hsp.y,
        hp: arena.startHp || 100, maxHp: arena.maxHp || 100,
        shield: arena.startShield || 0, maxShield: arena.maxShield || 100,
        weaponId: arena.startWeapon || 'pistol',
        invulnUntil: Date.now() + 2000, speedMul: 1.0,
        isJug: false, scaleMul: 1.0,
      };
      ws.tdmTeam = null;
      ws.tdmRespawnAt = 0;
      ws._heistRole = ws._heistRole || 'hacker';
      ws._heistRoleLocked = false;
      sim.heistRoles = sim.heistRoles || {};
      sim.heistRoles[ws.id] = ws._heistRole;
      // v1.697b: _heistApplyRole är INTE i join-handlerns scope (fri variabel → typeof gav
      // 'undefined' i sloppy mode → rollstats applicerades aldrig). Inline-require som pick_role.
      const { _heistApplyRole: _applyHeistRoleFn } = require('./sim/room-sim');
      if (typeof _applyHeistRoleFn === 'function') _applyHeistRoleFn(ws, ws._heistRole, sim, arena);
      send(ws, { type: 'sim_events', events: [{
        type: 'heist_started',
        arena: {
          worldW: arena.worldW, worldH: arena.worldH, name: arena.name,
          streetColor: arena.streetColor, sidewalkColor: arena.sidewalkColor,
          bankFloorColor: arena.bankFloorColor, vaultFloorColor: arena.vaultFloorColor,
          carpetColor: arena.carpetColor, serverFloorColor: arena.serverFloorColor,
          matchDurationSec: arena.matchDurationSec, stealthPhaseMaxSec: arena.stealthPhaseMaxSec,
          drillDurationSec: arena.drillDurationSec, extractDurationSec: arena.extractDurationSec,
          startWeapon: arena.startWeapon, startHp: arena.startHp, maxHp: arena.maxHp,
          startShield: arena.startShield, maxShield: arena.maxShield,
          extractZones: arena.extractZones, drillSpot: arena.drillSpot,
        },
        walls: arena.walls, doors: arena.doors, decorations: arena.decorations,
        cameras: arena.cameras, hackTerminals: arena.hackTerminals,
        civilianSpawns: arena.civilianSpawns, guardSpawns: arena.guardSpawns,
        lootSpots: arena.lootSpots, playerSpawns: arena.playerSpawns,
        phase: sim.heistPhase,
        roles: sim.heistRoles,
        drillProgress: sim.heistDrillProgress || 0,
        vaultUnlocked: !!sim.heistVaultUnlocked,
        innerDrillProgress: sim.heistInnerDrillProgress || 0,
        innerVaultUnlocked: !!sim.heistInnerVaultUnlocked,
        alarmTriggered: !!sim.heistAlarmTriggered,
        lootBagged: Object.keys(sim.heistLootBagged || {}),
        isLateJoin: true,
      }] });
      return;
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
      // v1.769 livscykel-fix: nulla room.sim efter stopSim. Om stopSim kastade levde
      // gamla sim:ens setInterval-tick kvar; eftersom createSim ger ett NYTT objekt
      // (interval=null) passerade startSim:s guard → TVÅ tick-loopar mot samma rum
      // (hp hoppar, spöken, "ibland funkar/ibland inte"). Garantera ren slate.
      room.sim = null;
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
      survivors: msg.survivors,
      survivorsDurationSec: msg.survivorsDurationSec,
      stresstest: msg.stresstest,
      heist: msg.heist,
      heistRoles: msg.heistRoles,
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
      else if (msg.heist) room.meta.mode = 'heist';
      else if (msg.survivors) room.meta.mode = 'survivors';
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

  // Sköld-ability: 3s immunitet, 45s cooldown (20s JUG-hunter).
  // v1.714: tillåten i ALLA server-sim-lägen (PvP + co-op PvE: survivors/heist/CD/
  // story-coop). Mode-gaten borttagen; cooldown enforces fortfarande via _lastShieldUseAt.
  if (msg.type === 'pvp_ability_shield') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
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
  // TDM fy_-förråd: klienten synkar vilket vapen som är i HANDEN (snapshot till andra).
  // Servern litar på klientens equip (TDM har redan klient-betrodd weaponId via sim_shoot).
  if (msg.type === 'tdm_equip') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim || !room.sim.tdmActive) return;
    if (!ws.playerState || typeof msg.weaponId !== 'string') return;
    ws.playerState.weaponId = msg.weaponId;
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
  if (msg.type === 'sim_br_buy') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrBuy(room.sim, ws.id, msg.item);
    return;
  }
  if (msg.type === 'sim_br_infcash') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrInfCash(room.sim, ws.id);
    return;
  }
  if (msg.type === 'sim_br_airstrike') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrAirstrike(room.sim, ws.id, msg.x, msg.y);
    return;
  }
  if (msg.type === 'sim_br_use_uav') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrUseUav(room.sim, ws.id);
    return;
  }
  if (msg.type === 'sim_br_accept_contract') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrAcceptContract(room.sim, ws.id, msg.id);
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
  if (msg.type === 'sim_cd_perk') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefensePerk(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_ping') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    // v1.660: ping tillåts i ALLA co-op-lägen (var bara castledefense). Co-op =
    // ingen PvP-mode aktiv (i PvP skulle ping läcka info till motståndarlaget).
    const _s = room.sim;
    const _isPvp = _s.tdmActive || _s.ctfActive || _s.siegeActive || _s.kothActive ||
                   _s.gungameActive || _s.juggernautActive || _s.battleroyaleActive;
    if (_isPvp) return;
    // Throttle per spelare: 1 ping per 1.5s
    const now = Date.now();
    if (ws._lastCdPingAt && now - ws._lastCdPingAt < 1500) return;
    ws._lastCdPingAt = now;
    room.sim.eventQueue.push({
      type: 'cd_ping',
      senderPid: ws.id,
      x: Math.max(0, Math.min(20000, +msg.x || 0)),
      y: Math.max(0, Math.min(20000, +msg.y || 0)),
    });
    return;
  }
  // v1.620: HEIST actions — bag loot, start drill (alarm trigger), hack terminal
  if (msg.type === 'sim_heist_action') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    const sim = room.sim;
    if (!sim.heistActive || sim.heistEnded) return;
    const { HEIST_ARENA } = require('../shared/heist-arena');
    const action = String(msg.action || '');
    const ps = ws.playerState;
    if (!ps || ps.hp <= 0) return;

    if (action === 'bag_loot') {
      const lootId = String(msg.lootId || '');
      const loot = HEIST_ARENA.lootSpots.find(l => l.id === lootId);
      if (!loot) return;
      // v1.625/v1.646: tier-baserad gate. 'outer' kräver outer-drill,
      // 'inner' kräver BÅDE outer- och inner-drill. Övrig loot (cash_drawer,
      // manager_safe, laptop, locker, tip_jar, storage box) är stealth-accessible
      // i alla phases (stealth → instant alarm-trigger).
      const tier = loot.tier; // 'outer' | 'inner' | undefined
      const isVaultLoot = (tier === 'outer' || tier === 'inner');
      if (isVaultLoot) {
        if (sim.heistPhase !== 'alarm' && sim.heistPhase !== 'extract') return;
        if (tier === 'outer' && !sim.heistVaultUnlocked) return;
        if (tier === 'inner' && !sim.heistInnerVaultUnlocked) return;
      } else {
        if (sim.heistPhase === 'ended') return;
      }
      // Inte redan bagged
      if (sim.heistLootBagged[lootId]) return;
      // Range-check (60px radius)
      const dx = ps.x - loot.x, dy = ps.y - loot.y;
      if (dx * dx + dy * dy > 60 * 60) return;
      // v1.625/v1.653: Stealth-bagging triggar alarm BARA om en civilian
      // har LOS + är inom 200px av loot-positionen (kassör/manager ser dig).
      // Tidigare: alarm trigger oavsett (även om alla cashiers var döda/borta).
      // Bortre civilians och de i panic/hostage/calmed-state räknas inte.
      if (!isVaultLoot && sim.heistPhase === 'stealth') {
        const { _heistLineBlockedByWall } = require('./sim/room-sim');
        let witnessed = false;
        const witnessR2 = 200 * 200;
        for (const npc of (sim.heistNPCs || [])) {
          if (!npc || npc.dead) continue;
          if (npc.type !== 'civilian') continue;
          // Hostage/calmed/panic civilians skvallrar inte
          if (npc.state === 'hostage' || npc.state === 'calmed' || npc.state === 'panic') continue;
          const dx = loot.x - npc.x, dy = loot.y - npc.y;
          if (dx * dx + dy * dy > witnessR2) continue;
          // LOS-check: vägg mellan civilian och loot = de ser ej
          if (typeof _heistLineBlockedByWall === 'function' &&
              _heistLineBlockedByWall(npc.x, npc.y, loot.x, loot.y, HEIST_ARENA)) continue;
          witnessed = true;
          break;
        }
        if (witnessed) {
          sim.heistAlarmTriggered = true;
          sim.eventQueue.push({ type: 'heist_loot_alarm', lootKind: loot.kind });
        }
      }
      // v1.621: Bag → carry-weight på spelaren (säkras vid extract-van)
      // v1.624: Använd faktisk loot.weight per typ (0.05-0.40) istället för flat 0.10
      sim.heistLootBagged[lootId] = true;
      ws._heistBagsCarrying = (ws._heistBagsCarrying || 0) + 1;
      ws._heistBagsValue = (ws._heistBagsValue || 0) + (loot.value || 0);
      ws._heistBagsWeight = (ws._heistBagsWeight || 0) + (loot.weight || 0.10);
      // SpeedMul baseras på summan av loot.weight (gold = 0.40, cash drawer = 0.05)
      // Cap vid 0.4 (60% slow) så player aldrig fastnar helt
      ps.speedMul = Math.max(0.4, 1 - ws._heistBagsWeight);
      sim.eventQueue.push({
        type: 'heist_loot_bagged',
        lootId,
        baggerPid: ws.id,
        value: loot.value,
        bagsCarrying: ws._heistBagsCarrying,
        bagsValue: ws._heistBagsValue,
      });
    } else if (action === 'drop_bags' || action === 'drop_one_bag') {
      // v1.652: Drop nu EN säck per tap istället för ALLA. Spelaren kan
      // koordinera bag-distribution mellan partners utan att tappa allt.
      // Legacy 'drop_bags' aliasas till samma som 'drop_one_bag' så ingen
      // klient bryter. (Den gamla "drop all"-funktionen var för aggressiv —
      // en accidental tap = match-disaster.)
      if (ws._heistBagsCarrying > 0) {
        sim.heistDroppedBags = sim.heistDroppedBags || [];
        sim._heistNextBagId = sim._heistNextBagId || 1;
        const perBagValue = Math.floor(ws._heistBagsValue / ws._heistBagsCarrying);
        const bagId = 'bg' + (sim._heistNextBagId++);
        sim.heistDroppedBags.push({
          id: bagId,
          x: ps.x + (Math.random() - 0.5) * 30,
          y: ps.y + (Math.random() - 0.5) * 30,
          value: perBagValue,
          droppedBy: ws.id,
        });
        ws._heistBagsCarrying -= 1;
        ws._heistBagsValue -= perBagValue;
        // Weight: ta bort genomsnitts-weight (totala viktet / antal kvar+1)
        const perBagWeight = ws._heistBagsCarrying > 0
          ? ws._heistBagsWeight / (ws._heistBagsCarrying + 1)
          : ws._heistBagsWeight;
        ws._heistBagsWeight = Math.max(0, ws._heistBagsWeight - perBagWeight);
        ps.speedMul = ws._heistBagsCarrying > 0
          ? Math.max(0.4, 1 - ws._heistBagsWeight)
          : 1.0;
        sim.eventQueue.push({
          type: 'heist_bags_dropped',
          peerId: ws.id, bagsDropped: 1, value: perBagValue,
          bagsRemaining: ws._heistBagsCarrying,
          valueRemaining: ws._heistBagsValue,
        });
      }
    } else if (action === 'distract_guard') {
      // v1.652: Tank-only — kasta object för att distrahera vakt.
      // Vakt vänder bort från player + står still i 5s. Cooldown 30s.
      if (ws._heistRole !== 'tank') return;
      if (sim.heistPhase !== 'stealth') return;
      const now = Date.now();
      if ((ws._heistDistractCdUntil || 0) > now) return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'guard' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 150 * 150) return; // 150px range (Tank kan kasta långt)
      // Distract: face bort från player, frys patrol 5s
      npc.facing = Math.atan2(-dy, -dx);
      npc._distractedUntil = now + 5000;
      npc.state = 'distracted'; // klient renderar ❓ + grå cone
      npc._patrolPauseUntil = now + 5000; // pause patrol-movement
      ws._heistDistractCdUntil = now + 30000;
      sim.eventQueue.push({
        type: 'heist_guard_distracted',
        guardId: npcId, by: ws.id, durationMs: 5000,
      });
    } else if (action === 'calm_civilian') {
      // v1.652: Medic-only — lugna civilian → ingen panic på 15s.
      // Kräver närhet (60px). Cooldown 20s. Fungerar i stealth.
      if (ws._heistRole !== 'medic') return;
      if (sim.heistPhase !== 'stealth') return;
      const now = Date.now();
      if ((ws._heistCalmCdUntil || 0) > now) return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'civilian' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 60 * 60) return;
      // Calm: civilian till "calmed"-state. Ingen panic-trigger på 15s, även
      // om de ser vapen. Bryts om Medic dör eller faserna ändras.
      npc.state = 'calmed';
      npc._calmedUntil = now + 15000;
      ws._heistCalmCdUntil = now + 20000;
      sim.eventQueue.push({
        type: 'heist_civilian_calmed',
        npcId, by: ws.id, durationMs: 15000,
      });
    } else if (action === 'start_drill') {
      // Triggar alarm-fas omedelbart om i stealth
      if (sim.heistPhase === 'stealth') {
        sim.heistAlarmTriggered = true;
        // Phase-byte sker i nästa tick
      }
    } else if (action === 'intimidate_civilian') {
      // v1.623: Hostage-system — make civilian a hostage (no panic, no alarm-trigger)
      // Kräver: nära civilian (60px), vapen = 'fists' (NO weapon drawn)
      if (ps.weaponId !== 'fists') return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'civilian');
      if (!npc || npc.dead) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 60 * 60) return;
      // Toggle hostage-state
      npc.state = 'hostage';
      npc._hostageBy = ws.id;
      sim.eventQueue.push({
        type: 'heist_civilian_hostage',
        npcId, by: ws.id,
      });
    } else if (action === 'pickup_bag') {
      // v1.623: Plocka upp närmaste dropped bag (50px range)
      if (!sim.heistDroppedBags || sim.heistDroppedBags.length === 0) return;
      let nearestIdx = -1, nearestD2 = 50 * 50;
      for (let i = 0; i < sim.heistDroppedBags.length; i++) {
        const b = sim.heistDroppedBags[i];
        const dx = ps.x - b.x, dy = ps.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearestIdx = i; }
      }
      if (nearestIdx < 0) return;
      const bag = sim.heistDroppedBags.splice(nearestIdx, 1)[0];
      ws._heistBagsCarrying = (ws._heistBagsCarrying || 0) + 1;
      ws._heistBagsValue = (ws._heistBagsValue || 0) + bag.value;
      // v1.624: använd genomsnitts-weight (vi vet inte ursprungs-loot.kind), default 0.15
      ws._heistBagsWeight = (ws._heistBagsWeight || 0) + 0.15;
      ps.speedMul = Math.max(0.4, 1 - ws._heistBagsWeight);
      sim.eventQueue.push({
        type: 'heist_bag_picked',
        peerId: ws.id, bagId: bag.id, value: bag.value,
        bagsCarrying: ws._heistBagsCarrying, bagsValue: ws._heistBagsValue,
      });
    } else if (action === 'lockpick_door') {
      // v1.623/v1.647: Lockpicking. Two-tap legacy + server-tick auto-complete
      // (samma pattern som hack-terminal i v1.645). Player tappar EN gång,
      // server completar när finishesAt nådd (i tickHeist) så länge spelaren
      // står kvar inom 60px.
      const doorId = String(msg.doorId || 'back');
      const door = HEIST_ARENA.doors.find(d => d.id === doorId);
      if (!door || !door.lockpickable) return;
      sim.heistUnlockedDoors = sim.heistUnlockedDoors || {};
      if (sim.heistUnlockedDoors[doorId]) return;
      // Range-check (60px från door-center)
      const dcx = door.x + door.w / 2, dcy = door.y + door.h / 2;
      const dx = ps.x - dcx, dy = ps.y - dcy;
      if (dx * dx + dy * dy > 60 * 60) return;
      // Lockpick-tid: 6s normal, 3s för Rogue
      const role = ws._heistRole || 'hacker';
      const pickTime = role === 'rogue' ? 3000 : 6000;
      const now = Date.now();
      if (!ws._heistLockpickStart || ws._heistLockpickDoorId !== doorId) {
        ws._heistLockpickStart = now;
        ws._heistLockpickDoorId = doorId;
        ws._heistLockpickFinishesAt = now + pickTime;
        sim.eventQueue.push({
          type: 'heist_lockpick_start',
          peerId: ws.id, doorId, pickTimeMs: pickTime,
        });
        return;
      }
      // Legacy: andra tap = check completion (om finish-tick missade ett tick)
      if (now >= ws._heistLockpickFinishesAt) {
        sim.heistUnlockedDoors[doorId] = true;
        if (door.kind === 'back_door') {
          if (HEIST_ARENA.extractZones && HEIST_ARENA.extractZones.back) {
            sim.heistBackExtractUnlocked = true;
          }
        }
        sim.eventQueue.push({
          type: 'heist_door_unlocked',
          peerId: ws.id, doorId,
        });
        ws._heistLockpickStart = 0;
        ws._heistLockpickDoorId = null;
      }
    } else if (action === 'release_hostage') {
      // v1.626: Hostage-trade — släpp hostage civilian → cease-fire från polisen
      // v1.650: Diminishing returns. Tidigare: 10s stackat oändligt (15 hostages
      // = 150s gratis drill). Nu: 1:a release 10s, 2:a 7s, 3:e 5s, 4+ 3s.
      // Plus TOTAL CAP 30s ackumulerat per match.
      if (sim.heistPhase !== 'alarm' && sim.heistPhase !== 'extract') return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n =>
        n.id === npcId && n.type === 'civilian' && n.state === 'hostage' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 60 * 60) return;
      const now = Date.now();
      sim.heistTotalCeasefireMs = sim.heistTotalCeasefireMs || 0;
      sim.heistReleaseCount = (sim.heistReleaseCount || 0) + 1;
      // Diminishing returns + cap mot 30s totalt
      const tiers = [10000, 7000, 5000, 3000];
      let gainMs = tiers[Math.min(sim.heistReleaseCount - 1, tiers.length - 1)];
      const remaining = Math.max(0, 30000 - sim.heistTotalCeasefireMs);
      gainMs = Math.min(gainMs, remaining);
      if (gainMs <= 0) {
        // Helt cappad — släpp hostage utan reward (markerar dock som released)
        npc.state = 'panic';
        npc._panicTarget = { x: 2000, y: 3500 };
        sim.eventQueue.push({
          type: 'heist_hostage_released',
          npcId, by: ws.id, ceasefireMs: 0, capped: true,
        });
        return;
      }
      sim.heistTotalCeasefireMs += gainMs;
      sim.heistCeasefireUntil = Math.max(sim.heistCeasefireUntil || 0, now) + gainMs;
      // Hostage springer iväg
      npc.state = 'panic';
      npc._panicTarget = { x: 2000, y: 3500 };
      if (sim._heistNextPoliceAt && sim._heistNextPoliceAt < sim.heistCeasefireUntil) {
        sim._heistNextPoliceAt = sim.heistCeasefireUntil + 1000;
      }
      ws._heistStatHostages = (ws._heistStatHostages || 0) + 1;
      sim.eventQueue.push({
        type: 'heist_hostage_released',
        npcId, by: ws.id,
        ceasefireMs: gainMs,
        totalUsedMs: sim.heistTotalCeasefireMs,
      });
    } else if (action === 'silent_kill') {
      // v1.623: Rogue-only silent-melee mot guard — ingen alarm, guard dör
      if (ws._heistRole !== 'rogue') return;
      if (sim.heistPhase !== 'stealth') return;
      // Melee-vapen krävs (fists/knife/melee-types)
      const meleeWeapons = ['fists', 'knife', 'knuckles', 'bat', 'machete'];
      if (!meleeWeapons.includes(ps.weaponId)) return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'guard' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 40 * 40) return; // close-range only
      npc.dead = true;
      sim.eventQueue.push({
        type: 'heist_guard_silent_kill',
        guardId: npcId, by: ws.id,
      });
    } else if (action === 'hack_terminal') {
      // v1.645: HACK NU MED TIDS-PROGRESS (var instant trots arena.hackTime=4/6).
      // Two-tap pattern: första tappet startar timer, vidare tap completes vid finish.
      // Hacker-role: -50% hack-tid. Range-check på varje tap så player måste stanna.
      const termId = String(msg.terminalId || '');
      const term = HEIST_ARENA.hackTerminals.find(t => t.id === termId);
      if (!term) return;
      const dx = ps.x - term.x, dy = ps.y - term.y;
      if (dx * dx + dy * dy > 50 * 50) return;
      sim.heistHackedTerminals = sim.heistHackedTerminals || {};
      if (sim.heistHackedTerminals[termId]) return;
      const role = ws._heistRole || 'hacker';
      const baseTime = (term.hackTime || 4) * 1000;
      const hackTime = role === 'hacker' ? Math.round(baseTime * 0.5) : baseTime;
      const now = Date.now();
      if (!ws._heistHackStart || ws._heistHackTermId !== termId) {
        ws._heistHackStart = now;
        ws._heistHackTermId = termId;
        ws._heistHackFinishesAt = now + hackTime;
        sim.eventQueue.push({
          type: 'heist_hack_start',
          peerId: ws.id, terminalId: termId, hackTimeMs: hackTime,
          isMaster: !!term.master,
        });
        return;
      }
      if (now >= ws._heistHackFinishesAt) {
        sim.heistHackedTerminals[termId] = true;
        sim.heistDisabledCameras = sim.heistDisabledCameras || {};
        for (const camId of (term.disables || [])) sim.heistDisabledCameras[camId] = true;
        sim.eventQueue.push({
          type: 'heist_terminal_hacked',
          terminalId: termId,
          disabledCameras: term.disables,
          isMaster: !!term.master,
        });
        ws._heistHackStart = 0;
        ws._heistHackTermId = null;
      }
    } else if (action === 'pick_role') {
      // v1.642: In-game role-pick. Tillåtet en gång per match. Stealth-fas
      // krävs så fördelar inte kan bytas mitt under intense extract-fight.
      // v1.654: UNIQUE-roll-validation. Varje roll får bara väljas av EN
      // spelare per match. Om någon annan redan har rollen → reject + emit
      // 'heist_role_taken' så klient kan visa toast.
      if (ws._heistRoleLocked) return;
      if (sim.heistPhase !== 'stealth') return;
      const role = String(msg.role || 'hacker');
      const validRoles = ['hacker', 'tank', 'medic', 'rogue'];
      if (validRoles.indexOf(role) < 0) return;
      // Unique-check: bara LOCKED peers blockar rollen (en peer som har
      // 'hacker' som default men inte locked ännu räknas som "available").
      sim.heistRoles = sim.heistRoles || {};
      const room = rooms.get(ws.roomCode);
      if (room && room.sim && room.sim.room && room.sim.room.members) {
        for (const [otherPid, otherWs] of room.sim.room.members) {
          if (otherPid === ws.id) continue;
          if (!otherWs._heistRoleLocked) continue; // ej låst → räknas inte
          if ((sim.heistRoles[otherPid] || otherWs._heistRole) === role) {
            sim.eventQueue.push({
              type: 'heist_role_taken',
              peerId: ws.id, role,
              takenByPid: otherPid,
            });
            return;
          }
        }
      }
      const { _heistApplyRole } = require('./sim/room-sim');
      if (typeof _heistApplyRole === 'function') {
        _heistApplyRole(ws, role, sim, HEIST_ARENA);
      } else {
        ws._heistRole = role;
      }
      ws._heistRoleLocked = true;
      sim.heistRoles[ws.id] = role;
      sim.eventQueue.push({
        type: 'heist_role_picked',
        peerId: ws.id, role,
        hp: ws.playerState.hp, maxHp: ws.playerState.maxHp,
        speedMul: ws.playerState.speedMul,
      });
    }
    return;
  }
  // v1.607: SURVIVORS shop-buy — validera + dra gold + ge weapon
  if (msg.type === 'sim_survivors_buy') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    const sim = room.sim;
    if (!sim.survivorsActive) return;
    const wid = String(msg.weaponId || '');
    const cost = Math.max(0, Math.min(99999, parseInt(msg.cost) || 0));
    const gold = sim.castledefenseGold[ws.id] || 0;
    if (gold < cost) return; // not enough gold (silent — klient visar UI-error)
    sim.castledefenseGold[ws.id] = gold - cost;
    sim.castledefenseOwnedWeapons = sim.castledefenseOwnedWeapons || {};
    sim.castledefenseOwnedWeapons[ws.id] = sim.castledefenseOwnedWeapons[ws.id] || ['pistol'];
    if (!sim.castledefenseOwnedWeapons[ws.id].includes(wid)) {
      sim.castledefenseOwnedWeapons[ws.id].push(wid);
    }
    if (ws.playerState) ws.playerState.weaponId = wid;
    sim.eventQueue.push({
      type: 'cd_gold_update', peerId: ws.id,
      gold: sim.castledefenseGold[ws.id], delta: -cost,
    });
    sim.eventQueue.push({
      type: 'survivors_weapon_bought', peerId: ws.id,
      weaponId: wid,
    });
    return;
  }
  if (msg.type === 'sim_cd_infmoney') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseInfMoney(room.sim, ws.id, msg);
    return;
  }
  // v1.537: STRESS-TEST spawn-handler (klient klickar +20 ENEMIES etc)
  if (msg.type === 'sim_stresstest') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim || !room.sim.stresstestActive) return;
    if (msg.action === 'enemies') {
      const sim = room.sim;
      const count = Math.max(1, Math.min(100, +msg.count || 20));
      const ws2 = sim.room.members.get(ws.id);
      if (!ws2 || !ws2.playerState) return;
      const px = ws2.playerState.x, py = ws2.playerState.y;
      const { makeEnemy } = require('./sim/enemies');
      const types = ['grunt', 'runner', 'brute'];
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const dist = 400 + Math.random() * 300;
        const ex = px + Math.cos(a) * dist;
        const ey = py + Math.sin(a) * dist;
        const t = types[Math.floor(Math.random() * types.length)];
        const e = makeEnemy(t, ex, ey);
        e._idx = sim.nextEnemyIdx++;
        sim.enemies.push(e);
      }
    }
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
    // flightMs styrs av klienten (skalas med kast-distans, TDM dubbel räckvidd) —
    // klampa till sant intervall så explosion-timing + peer-broadcast matchar thrower.
    const FLIGHT_MS = Math.max(200, Math.min(3000, +msg.flightMs || 800));
    const RADIUS = 85;
    const DMG = 120;
    const kind = msg.kind === 'smoke' ? 'smoke' : 'frag';
    // Broadcast till alla klienter (inkl thrower — thrower dedupar via ownerPid).
    // Rök-molnet ritas client-side deterministiskt från detta event (samma pos+tid
    // hos alla) — ingen kontinuerlig sync behövs.
    sim.eventQueue.push({
      type: 'grenade_thrown',
      ownerPid: ws.id,
      fromX, fromY, toX, toY,
      flightMs: FLIGHT_MS,
      radius: kind === 'smoke' ? 130 : RADIUS,
      kind,
    });
    // RÖKGRANAT gör INGEN skada → ingen explode. Spränggranat exploderar server-auth.
    if (kind !== 'smoke') {
      setTimeout(() => {
        if (!sim || sim._stopped) return;
        const { explode } = require('./sim/bullets');
        if (typeof explode === 'function') {
          explode(sim, toX, toY, RADIUS, DMG, ws.id);
        }
      }, FLIGHT_MS);
    }
    return;
  }
}

function handleDisconnect(ws) {
  // Rensa public-rooms-prenumeration
  publicRoomSubscribers.delete(ws);
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  // v1.659: stasha server-side-only-state för ev. reconnect (Heist-roll + hp/shield)
  // innan vi rensar. Bara under aktiv sim + om klienten har en reconnect-token.
  // Stashen lever i rummet (rensas när rummet stängs) och utgår efter 60s vid restore.
  if (room.sim && ws._reconnectToken) {
    room._reconnectStash = room._reconnectStash || {};
    const ps = ws.playerState || {};
    room._reconnectStash[ws._reconnectToken] = {
      heistRole: ws._heistRole, heistRoleLocked: ws._heistRoleLocked,
      hp: ps.hp, maxHp: ps.maxHp, shield: ps.shield, speedMul: ps.speedMul,
      ts: Date.now(),
    };
  }
  // Returnera stable-slot till den lediga poolen så nästa peer som joinar
  // kan återanvända det lägsta lediga slot-numret. Host (slot 0) returneras
  // INTE — slot 0 är alltid hosten, host-migration uppdaterar bara hostId.
  if (ws.stableSlot != null && ws.stableSlot !== 0 && room._freeSlots) {
    room._freeSlots.push(ws.stableSlot);
  }
  room.members.delete(ws.id);
  if (room.hostId === ws.id) {
    // v1.658: HOST MIGRATION — migrera värdskapet till en annan närvarande human
    // istället för att döda rummet. En host som tappar signalen ska inte avsluta
    // allas match. Sim:n körs server-side oberoende av hostId (hostId styr bara
    // host-only-kommandon sim_stop/sim_load_stage + peer_joined-notiser), så att
    // byta hostId mitt i match är säkert — sim:n fortsätter oavbrutet.
    let newHost = null;
    for (const [, m] of room.members) { if (!m._isBot) { newHost = m; break; } }
    if (newHost) {
      room.hostId = newHost.id;
      if (room.meta) room.meta.hostName = newHost.playerName || room.meta.hostName;
      // Rensa lämnande host:s per-pid sim-state (samma som vanlig-peer-grenen).
      if (room.sim) {
        const _s = room.sim, _pid = ws.id;
        if (_s.deadBodies) delete _s.deadBodies[_pid];
        if (_s.kothScores) delete _s.kothScores[_pid];
        if (_s._kothPointAccum) delete _s._kothPointAccum[_pid];
        if (_s.juggernautScores) delete _s.juggernautScores[_pid];
        if (_s.battleroyaleKillsByPid) delete _s.battleroyaleKillsByPid[_pid];
        if (_s.tdmDeathsByPid) delete _s.tdmDeathsByPid[_pid];
        // v1.698: dekrementera aliveCount om en LEVANDE BR-spelare lämnar — annars
        // triggas last_alive-win aldrig (matchen hänger till 30s-fallbacken).
        if (_s.battleroyaleActive && _s.battleroyaleEliminated && !_s.battleroyaleEliminated.includes(_pid)) {
          _s.battleroyaleEliminated.push(_pid);
          if (typeof _s.battleroyaleAliveCount === 'number') _s.battleroyaleAliveCount = Math.max(0, _s.battleroyaleAliveCount - 1);
        }
        // Om host var JUG, frigör rollen (samma som vanlig-peer-grenen).
        if (_s.juggernautActive && _s.juggernautPid === ws.id) {
          _s.juggernautPid = null;
          _s._juggernautAwaitFirstRespawn = true;
          _s.eventQueue.push({ type: 'juggernaut_jug_changed', newJug: null, oldJug: ws.id, reason: 'jug_disconnected', weapon: _s.juggernautWeapon, jugHp: _s.juggernautHpMax });
        }
      }
      for (const [, m] of room.members) {
        if (m._isBot) continue;
        send(m, { type: 'host_migrated', newHostId: newHost.id, peerLeft: ws.id });
      }
      console.log('[ROOM]', room.code, 'host migrated', ws.id, '→', newHost.id, '(', room.members.size, 'members)');
      broadcastPublicRooms();
      return;
    }
    // Ingen human kvar — stäng rummet (befintligt beteende).
    console.log('[ROOM]', room.code, 'closed (host left, no members)');
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
    // v1.657: rensa per-pid sim-state för den lämnande peer:n så stale pids inte
    // hänger kvar — annars spök-spelare i leaderboards (koth/jug/BR) + onödig
    // deadBodies-iteration matchen ut. Defensivt guardat (no-op om saknas).
    if (room.sim) {
      const _s = room.sim, _pid = ws.id;
      if (_s.deadBodies) delete _s.deadBodies[_pid];
      if (_s.kothScores) delete _s.kothScores[_pid];
      if (_s._kothPointAccum) delete _s._kothPointAccum[_pid];
      if (_s.juggernautScores) delete _s.juggernautScores[_pid];
      if (_s.battleroyaleKillsByPid) delete _s.battleroyaleKillsByPid[_pid];
      if (_s.tdmDeathsByPid) delete _s.tdmDeathsByPid[_pid];
      // v1.698: dekrementera aliveCount om en LEVANDE BR-spelare lämnar — annars
      // triggas last_alive-win aldrig (matchen hänger till 30s-fallbacken).
      if (_s.battleroyaleActive && _s.battleroyaleEliminated && !_s.battleroyaleEliminated.includes(_pid)) {
        _s.battleroyaleEliminated.push(_pid);
        if (typeof _s.battleroyaleAliveCount === 'number') _s.battleroyaleAliveCount = Math.max(0, _s.battleroyaleAliveCount - 1);
      }
    }
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
