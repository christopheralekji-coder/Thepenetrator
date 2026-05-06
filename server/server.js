// The Penetrator — Co-op WebSocket relay server
// Deployas på Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;

// Healthcheck endpoint så Render håller servern vid liv
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Penetrator co-op server v1\nRooms: ' + rooms.size);
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocket.Server({ server });
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

  ws.on('message', (raw) => {
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
}

function handleDisconnect(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.members.delete(ws.id);
  if (room.hostId === ws.id) {
    // Host lämnade — stäng rummet
    console.log('[ROOM]', room.code, 'closed (host left)');
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
    if (room.members.size === 0) rooms.delete(room.code);
  }
}

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  THE PENETRATOR — Co-op Server v1');
  console.log('  Listening on port ' + PORT);
  console.log('═══════════════════════════════════════');
});
