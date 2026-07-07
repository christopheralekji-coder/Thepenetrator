// WarParty â€” Co-op WebSocket relay server
// Deployas pÃ¥ Render.com / Fly.io / Glitch / Railway free tier

const WebSocket = require('ws');
const http = require('http');
const { createSim, startSim, stopSim, applyPlayerInput, applyShoot, applyLoadStage, applyBrDropWeapon, applyBrJump, applyBrBuy, applyBrInfCash, applyBrAirstrike, applyBrUseUav, applyBrUseItem, applyBrAcceptContract, applyBrAbandonContract, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret, applyCastleDefenseBuild, applyCastleDefenseRepair, applyCastleDefenseUpgrade, applyCastleDefenseSell, applyCastleDefensePerk, applyCastleDefensePerkBuy, applyCastleDefenseInfMoney, applyCastleDefenseGate, applyCastleDefenseAbility, applyCastleDefenseEnterTower, applyCastleDefenseExitTower, applyCastleDefenseNpcUpgrade, applyCastleDefenseBuyWeapon, isDevAccount, pickRandomHumanHunter, transferJug } = require('./sim/room-sim');
const accounts = require('./accounts'); // v2 konto/vÃ¤nner (acct_* â€” additivt, no-op fÃ¶r V1)
const matchmaker = require('./matchmaker'); // v2 matchmaking-kö (queue_*/match_* — additivt)
const groups = require('./groups'); // v2 matchmaking grupp-lager (group_* — additivt)
const { attachUdp } = require('./net/udp-integration'); // UDP-transport (V2-native, V1 dött)
const PORT = process.env.PORT || 8080;

// Healthcheck + error-reporting endpoint
const SERVER_VERSION = 'v273-account-progress';
const SERVER_BUILD_AT = new Date().toISOString();
const errorLog = []; // ring-buffer av senaste 100 client-side errors
const ERROR_LOG_MAX = 100;

// S8: event-loop-lag-matare — ALLA rums tickar + konto-save + broadcast delar EN
// loop; driften har fangar det [SLOW-TICK] inte ser (GC-pauser, sync-stringify-
// stalls, CPU-throttling). EMA + sakta avklingande max (98%/500ms ~ 30s minne).
let loopLagEmaMs = 0, loopLagMaxMs = 0;
{
  let expectedTick = Date.now() + 500;
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expectedTick);
    loopLagEmaMs = loopLagEmaMs * 0.8 + lag * 0.2;
    loopLagMaxMs = Math.max(loopLagMaxMs * 0.98, lag);
    expectedTick = now + 500;
  }, 500);
  if (lagTimer.unref) lagTimer.unref();
}

// C99: SERVER-AUKTORITATIV survivors-shop-priser. Spegel av klientens
// SURVIVORS_SHOP_WEAPONS (game.js). Servern litade tidigare på msg.cost från
// klienten → en manipulerad klient kunde köpa vilket vapen som helst för 0 guld.
// Nu slås priset upp här per weaponId; köp av okänt id avvisas. Håll i synk med
// klientens lista vid balansändring (samordnad deploy).
const SURVIVORS_SHOP_PRICES = {
  pistol: 0, throwknife: 300, revolver: 700, burstpistol: 1200, shotgun: 1800,
  shuriken: 2500, smg: 3500, crossbow: 4500, sniper: 6000, rifle: 7500,
  plasma: 9500, rocket: 12000, minigun: 15000, flame: 18000, sledge: 25000,
};

// TCP keepalive pÃ¥ alla inkommande HTTP-anslutningar. WS kÃ¶rs pÃ¥ TCP-socket;
// utan OS-level keepalive kan intermediate routers/proxies (Render edge, mobil-NAT)
// slÃ¤ppa "idle" anslutningar trots WS-message-flow. Initial-delay 25s + interval 10s
// hÃ¥ller socketen "warm" oavsett app-level traffic-pattern.
function applyTcpKeepalive(socket) {
  try { socket.setKeepAlive(true, 25000); } catch (e) {}
  try { socket.setNoDelay(true); } catch (e) {} // disable Nagle fÃ¶r lÃ¥g latens
}

const server = http.createServer((req, res) => {
  // CORS fÃ¶r fetch frÃ¥n klient (PWA)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health' || req.url === '/' || req.url.startsWith('/health?')) {
    // S8: ?verbose=1 -> JSON med per-rum tick-telemetri + minne + loop-lag.
    // Rumskoder medvetet UTELAMNADE (privata koder ska inte lacka via HTTP).
    if (req.url.includes('verbose=1')) {
      const mem = process.memoryUsage();
      const roomList = [];
      let tickMsPerSec = 0;
      for (const [, room] of rooms) {
        const sim = room.sim;
        const r = {
          mode: (room.meta && room.meta.mode) || '?',
          members: room.members ? room.members.size : 0,
          started: !!(room.meta && room.meta.started),
        };
        if (sim) {
          r.tickAvg = Math.round((sim._tickMsEMA || 0) * 10) / 10;
          r.tickMax = Math.round((sim._tickMsMax || 0) * 10) / 10;
          r.enemies = Array.isArray(sim.enemies) ? sim.enemies.length : 0;
          r.bullets = Array.isArray(sim.bullets) ? sim.bullets.length : 0;
          tickMsPerSec += (sim._tickMsEMA || 0) * 60; // 60Hz -> summerad sim-CPU ms/s (quota-headroom)
        }
        roomList.push(r);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        version: SERVER_VERSION,
        uptimeSec: Math.round(process.uptime()),
        rooms: roomList,
        simMsPerSec: Math.round(tickMsPerSec),
        loopLag: { emaMs: Math.round(loopLagEmaMs * 10) / 10, maxMs: Math.round(loopLagMaxMs * 10) / 10 },
        memoryMB: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
          external: Math.round(mem.external / 1048576),
        },
        errorsLogged: errorLog.length,
      }, null, 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`WarParty co-op server\nVersion: ${SERVER_VERSION}\nBuilt: ${SERVER_BUILD_AT}\nRooms: ${rooms.size}\nUptime: ${Math.round(process.uptime())}s\nErrors logged: ${errorLog.length}`);
    return;
  }
  // v2 konto-bind: Google-OAuth fÃ¶rmedlas via servern (acct_google_start ger
  // klienten /auth/google?s=â€¦ â†’ 302 till Google â†’ callback â†’ push Ã¶ver WS).
  // Additivt â€” V1 trÃ¤ffar aldrig dessa paths.
  if (req.url.startsWith('/auth/google/callback') && req.method === 'GET') {
    accounts.handleGoogleCallback(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} });
    return;
  }
  if (req.url.startsWith('/auth/google') && req.method === 'GET') {
    accounts.handleGoogleRedirect(req, res);
    return;
  }
  // DTLS-alternativet: TLS-skyddat secret-handshake → kortlivad session-token.
  // Klienten skickar sedan BARA token över UDP (acct_login{token}) → secreten
  // korsar aldrig plaintext-UDP. Additivt — V1 träffar aldrig denna path.
  if (req.url === '/auth/session' && req.method === 'POST') {
    accounts.handleSessionHttp(req, res);
    return;
  }
  // Admin-panel (skyddad moderations-yta): GET /admin = dashboard (token-fri skal),
  // /admin/api/* = data bakom ADMIN_TOKEN. All logik bor i accounts.handleAdminHttp.
  if (req.url === '/admin' || req.url.startsWith('/admin/') || req.url.startsWith('/admin?')) {
    accounts.handleAdminHttp(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} });
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

// PERF (v1.815 â€” #2 vÃ¤rme-fix): perMessageDeflate AV. Tidigare komprimerades varje frame,
// vilket tvingade MOBIL-KLIENTEN att INFLATE:a varje inkommande vÃ¤rlds-paket 60Ã—/sek = konstant
// CPU + zlib-scratch-allokeringar pÃ¥ den separata audio/main-trÃ¥den som INTE syns i frame-EMA:n
// (en av de dolda vÃ¤rmekÃ¤llorna native-spel slipper). VÃ¤rlds-paketen Ã¤r redan tÃ¤tt binÃ¤r-packade
// (Int16/enum/delta) â†’ deflate gav dÃ¥lig ratio men kostade CPU pÃ¥ BÃ…DA sidor 60Hz. Av = mindre
// bandbredd-besparing men klart mindre CPU/vÃ¤rme pÃ¥ telefonen. Radion Ã¤r Ã¤ndÃ¥ vaken 60Hz.
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false,
  // H9 (audit 2026-06-10): ws-default Ã¤r 100MiB â†’ en oautentiserad klient kunde
  // skicka en jÃ¤tteframe som JSON.parse:as pÃ¥ event-loopen och fryser ALLA rums
  // 60Hz-sims (DoS). VÃ¤rsta legitima payload Ã¤r sim_start med customStages +
  // stageWalls (~300KB) â†’ 1MiB ger god marginal. ws stÃ¤nger med 1009 vid Ã¶verskott.
  maxPayload: 1024 * 1024,
});
const rooms = new Map(); // code â†’ { hostId, members: Map(id â†’ ws), meta: { hostName, mode, private, started, createdAt } }
const publicRoomSubscribers = new Set(); // ws-references som vill ha live room-list updates

// Bygg publikt room-snapshot fÃ¶r broadcast/snapshot till browse-skÃ¤rmen
function buildPublicRoomsList() {
  const list = [];
  for (const [code, room] of rooms) {
    if (room.meta && room.meta.private) continue;
    list.push({
      code,
      hostName: (room.meta && room.meta.hostName) || 'Spelare',
      mode: (room.meta && room.meta.mode) || 'story',
      players: room.members.size,
      maxPlayers: (room.meta && room.meta.maxPlayers) || 8,
      started: !!(room.meta && room.meta.started),
      createdAt: (room.meta && room.meta.createdAt) || 0,
    });
  }
  // Senaste rummen fÃ¶rst
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function broadcastPublicRooms() {
  if (publicRoomSubscribers.size === 0) return;
  // Lokalt namn `list` (inte `rooms`) sÃ¥ vi inte skuggar module-level `rooms` Map
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
  ws._lastSeenAt = Date.now();
  // Aktivera TCP keepalive pÃ¥ underliggande socket (fix fÃ¶r Render edge-proxy
  // idle-timeout som dÃ¶dar WS efter ~60s trots app-traffic).
  if (req && req.socket) applyTcpKeepalive(req.socket);
  // DEL 4: Spara klientens IP på ws-objektet så accounts.js kan rate-limita konto-skapande.
  ws._remoteIp = req && req.headers ? String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim() : '';
  console.log('[CONN]', ws.id, 'connected from', ws._remoteIp || '?');

  // Heartbeat: vilken meddelande/pong som helst rÃ¤knas som "alive".
  ws.on('pong', () => { ws.isAlive = true; ws._missedPings = 0; ws._lastSeenAt = Date.now(); ws._isBackgrounded = false; });

  ws.on('message', (raw, isBinary) => {
    ws.isAlive = true;
    ws._missedPings = 0;
    ws._lastSeenAt = Date.now();
    ws._isBackgrounded = false;   // #br-bg: ev. meddelande = appen ar i forgrund (client_bg satter den ater i handleMessage)
    if (isBinary) {
      try { handleBinaryMessage(ws, raw); } catch (e) { console.error('bin-error:', e.message); }
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handleMessage(ws, msg); } catch (e) { console.error('msg-error:', e.message); }
  });

  // Logga close-code + reason sÃ¥ vi kan diagnostisera disconnect-kÃ¤llan
  // (1000=normal, 1006=abnormal-close, 1011=server-error, 4xxx=app-specific).
  ws.on('close', (code, reason) => {
    const lifetime = Math.round((Date.now() - ws._connectedAt) / 1000);
    const reasonStr = reason ? reason.toString().slice(0, 50) : '';
    console.log('[DISC]', ws.id, 'code=' + code, 'reason="' + reasonStr + '" lifetime=' + lifetime + 's');
    handleDisconnect(ws);
  });

  ws.on('error', (e) => console.warn('[ERR]', ws.id, e.message));
});

// Heartbeat â€” dÃ¶da BARA helt silent connections. 25s interval med 3-strike-rule
// (max ~75s grace) sÃ¥ mobila spikes/4G-handoffs inte triggar onÃ¶dig disconnect.
// Tidigare: 30s ping + 30s grace â†’ ~60s exakt timing matchade Render edge
// idle-timeout och dÃ¶dade live anslutningar.
const HEARTBEAT_INTERVAL_MS = 25000;
const RECONNECT_STASH_TTL_MS = 180000; // rejoin-window (~3 min)
const MAX_MISSED_PINGS = 7; // 3 Ã— 25s = ~75s helt utan svar krÃ¤vs fÃ¶r terminate
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

// RTT-mÃ¤tning per WS fÃ¶r lag compensation. Server pingar varje aktiv WS-klient
// 1Hz; klient ekar omedelbart tillbaka via srv_rtt_pong. Server berÃ¤knar RTT
// och sparar i ws._serverRtt (millisekunder). bullets.js anvÃ¤nder det fÃ¶r att
// rewinda target-positioner ws._serverRtt/2 bakÃ¥t vid hit-check (cap 200ms).
const RTT_PING_INTERVAL_MS = 1000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // Bara mÃ¤t RTT nÃ¤r klient Ã¤r aktivt i ett sim-aktivt rum
    if (!ws.roomCode) continue;
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) continue;
    ws._lastRttPingAt = Date.now();
    try { ws.send(JSON.stringify({ type: 'srv_rtt_ping', t: ws._lastRttPingAt })); } catch (e) {}
    // DISCONNECT-GRACE (2026-06-28): en spelare vars socket TYSTNAT (app i bakgrund / wifi-blip)
    // far INTE dodas i gapet innan keepalive-terminaten (upp till ~75s). Klienten svarar pa
    // srv_rtt_ping varje sekund -> >2.5s utan ETT meddelande = genuint borta, inte bara idle.
    // Skydda kroppen genom att refresha invulnUntil (honoreras av bullets/enemies/grenades).
    // Co-op: hela tiden (sakert). PvP: bara ~10s (tacker notis-glimt, men begransar
    // KOTH-camp / CTF-flagg-las / BR-stall fran en avsiktligt bakgrundad osarbar kropp).
    const _ps = ws.playerState;
    if (_ps && _ps.hp > 0 && ws._reconnectToken) {
      const _silentMs = Date.now() - (ws._lastSeenAt || ws._connectedAt || Date.now());
      if (_silentMs > 2500 || ws._isBackgrounded) {   // #br-bg: skydda kroppen DIREKT vid app-bakgrund (ej vanta 2.5s)
        const _s = room.sim;
        const _isPvP = !!(_s.tdmActive || _s.ctfActive || _s.siegeActive || _s.gungameActive ||
                          _s.kothActive || _s.juggernautActive || _s.battleroyaleActive);
        const _graceMs = (_s && _s.battleroyaleActive) ? 30000 : 10000;   // #br-30s: BR-kropp skyddad 30s
        if (!_isPvP || _silentMs < _graceMs) _ps.invulnUntil = Date.now() + 1500;
      }
    }
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

// v2 konto/vÃ¤nner: helpers till accounts.js (skicka + presence-uppslag).
// roomInfo krÃ¤ver att ws faktiskt Ã¤r medlem i rummet (efter 'leave' hÃ¤nger
// ws.roomCode kvar som V1-quirk â€” membership-checken gÃ¶r presensen korrekt).
const acctHelpers = {
  send,
  roomInfo(w) {
    if (!w || !w.roomCode) return null;
    const room = rooms.get(w.roomCode);
    if (!room || !room.members.has(w.id)) return null;
    return {
      code: w.roomCode,
      started: !!(room.sim || (room.meta && room.meta.started)),
      mode: (room.meta && room.meta.mode) || 'story',
    };
  },
};

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

// BinÃ¤r message-format (klient â†’ server):
//   [u8 routeByte][u8 idLen][idBytes...][payload...]
//   routeByte = 0 â†’ broadcast i rummet (utom avsÃ¤ndaren)
//   routeByte = 1 â†’ directed till peer med id i idBytes
// Server â†’ klient binÃ¤r format:
//   [u8 fromIdLen][fromIdBytes...][payload...]
function handleBinaryMessage(ws, raw) {
  // raw Ã¤r Buffer pÃ¥ Node
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (raw.length < 2) return;
  const routeByte = raw[0];
  const idLen = raw[1];
  if (raw.length < 2 + idLen) return;
  const targetId = idLen > 0 ? raw.slice(2, 2 + idLen).toString('utf8') : '';
  const payload = raw.slice(2 + idLen);
  // Bygg utgÃ¥ende frame: [fromIdLen][fromIdBytes][payload]
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
  // Godot/V2-klienter fÃ¥r world-snapshots som JSON-text (text) istÃ¤llet fÃ¶r det
  // binÃ¤ra delta-formatet. SÃ¤tts via host/join (msg.godot:1). Allt annat
  // (klientâ†’server-meddelanden, sim_events) Ã¤r redan JSON i bÃ¥da riktningar.
  if (msg.godot) ws._jsonWorld = true;
  if (msg.bin) ws._binWorld = true;   // AAA #1: klienten begär binär world (UDP-only)
  // SPECTATE: en spectator skickar aldrig spel-aktioner. Släpp ALLA sim_*-meddelanden
  // (input/shoot/br/castle/turret m.fl.) defensivt så en manipulerad spectate-klient
  // inte kan påverka matchen. join/host/leave/acct_/queue_ släpps förbi som vanligt.
  if (ws.isSpectator && typeof msg.type === 'string' && msg.type.indexOf('sim_') === 0) return;
  // v2 konto/vÃ¤nner: EN ingÃ¥ng fÃ¶r alla acct_* (V1 skickar aldrig dessa â†’ no-op)
  if (typeof msg.type === 'string' && msg.type.startsWith('acct_')) return accounts.handle(ws, msg, acctHelpers);
  // v2 matchmaking-kö: queue_join/queue_cancel/match_accept/match_decline (additivt)
  if (typeof msg.type === 'string' && (msg.type.startsWith('queue_') || msg.type.startsWith('match_'))) return matchmaker.handle(ws, msg);
  if (typeof msg.type === 'string' && msg.type.startsWith('group_')) return groups.handle(ws, msg);
  if (msg.type === 'host') {
    // C123: släpp ev. kvarvarande matchmaker-ticket/grupp innan vi skapar rum direkt.
    // joinQueue() releasar bara vid re-queue → en köande spelare som hostar/joinar
    // utan queue_cancel lämnar annars en stale ticket kvar (kan dras in i en match
    // medan hen redan spelar). No-op om ej i kö/grupp.
    matchmaker.leave(ws);
    groups.leave(ws);
    // Skapa rum
    const code = generateCode();
    const hostName = String(msg.name || '').trim().slice(0, 14) || 'Spelare';
    const mode = String(msg.mode || 'story').slice(0, 16);
    const isPrivate = !!msg.private;
    // v2 (additivt): per-läge rum-tak — klienten skickar maxPlayers ur sin
    // läges-katalog (BR 25, gungame 20, övriga PvP 10, co-op 8). V1 skickar
    // aldrig fältet → 8 som förr. Clamp 2-25 (anti-abuse).
    const maxP = Math.max(2, Math.min(25, parseInt(msg.maxPlayers, 10) || 8));
    const room = {
      code,
      hostId: ws.id,
      members: new Map(),
      meta: { hostName, mode, private: isPrivate, started: false, createdAt: Date.now(), maxPlayers: maxP },
      // stable-slot: host=0, peers tilldelas 1,2,... vid join. Lediga slots
      // Ã¥teranvÃ¤nds via _freeSlots-listan sÃ¥ en ny peer som joinar efter att
      // en annan lÃ¤mnat fÃ¥r det lÃ¤gsta lediga slot-numret.
      _nextSlot: 1,
      _freeSlots: [],
    };
    room.members.set(ws.id, ws);
    rooms.set(code, room);
    ws.roomCode = code;
    ws.playerName = hostName;
    // Host Ã¤r alltid slot 0
    ws.stableSlot = 0;
    // #wifi: host:en behover OCKSA en reconnect-token sa en stash skapas vid disconnect ->
    // rummet (+ stashen) overlever sista-manniskan-droppen -> auto-rejoin hittar rummet
    // (annars "Rummet finns inte"). Solo-spel = host -> utan detta var hela reconnecten dod.
    if (msg.reconnectToken) ws._reconnectToken = String(msg.reconnectToken).slice(0, 40);
    send(ws, { type: 'hosted', code, peerId: ws.id });
    console.log('[ROOM]', code, 'created by', ws.id, 'name="' + hostName + '" mode=' + mode + (isPrivate ? ' [PRIVATE]' : ''));
    broadcastPublicRooms();
    accounts.presenceChanged(ws); // v2 konto: vÃ¤nner ser lobby + rumskod
    return;
  }

  // Host kan uppdatera room-meta (mode/namn/private) â€” speglas i public-rooms-list
  if (msg.type === 'update_room_meta') {
    const room = rooms.get(ws.roomCode);
    if (!room || room.hostId !== ws.id) return;
    if (msg.hostName != null) {
      room.meta.hostName = String(msg.hostName).trim().slice(0, 14) || 'Spelare';
      ws.playerName = room.meta.hostName;
    }
    if (msg.mode != null) room.meta.mode = String(msg.mode).slice(0, 16);
    if (msg.private != null) room.meta.private = !!msg.private;
    // v2 (additivt): BYT LÄGE i lobbyn → nytt tak följer läget (aldrig under
    // nuvarande antal medlemmar — ingen ska kastas ut av ett lägesbyte)
    if (msg.maxPlayers != null) {
      room.meta.maxPlayers = Math.max(Math.max(2, room.members.size),
        Math.min(25, parseInt(msg.maxPlayers, 10) || 8));
    }
    broadcastPublicRooms();
    return;
  }

  // Klient vill se publika rum (engÃ¥ngs-snapshot)
  if (msg.type === 'list_public_rooms') {
    send(ws, { type: 'public_rooms', rooms: buildPublicRoomsList() });
    return;
  }

  // Klient prenumererar pÃ¥ publika rum-uppdateringar (live pÃ¥ join-skÃ¤rmen)
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
    // SPECTATE (additivt): klienten joinar för att TITTA på en vän-match i progress.
    // En spectator får world-broadcasts (är i room.members) men registreras ALDRIG
    // som spelare — ingen playerState, inga score-maps, inget team, ingen slot, inga
    // peer_joined-notiser. Sätts ALLTID (icke-spectate-join nollar den → reset).
    ws.isSpectator = !!msg.spectate;
    // En åskådare kan BARA titta på en match som FAKTISKT körs (room.sim). Avvisa
    // spectate-join mot ett rum utan aktiv sim (lobby) → det finns inget att titta
    // på, och det garanterar att en åskådare aldrig existerar i ett ej-startat rum
    // (stänger matchmaker-vägen där en åskådare annars kunde dras in som spelare).
    if (ws.isSpectator && !room.sim) { send(ws, { type: 'error', error: 'Matchen har inte startat' }); return; }
    // C123: släpp ev. kvarvarande matchmaker-ticket/grupp innan vi joinar ett rum
    // direkt (samma stale-ticket-läcka som i 'host'). No-op om ej i kö/grupp.
    matchmaker.leave(ws);
    groups.leave(ws);
    // v1.771: ghost-dedupe FÃ–RE size-check + slot-alloc. En halv-trasig anslutning vars
    // close ej firat (mobil byter wifiâ†”mobilnÃ¤t) ligger kvar som spÃ¶k-spelare i ~75s.
    // Kasta ut ev. kvarlevande ws med samma reconnect-token â†’ reconnecten Ã¥teranvÃ¤nder
    // ghost:ens slot (slot-kontinuitet) + ett fullt rum blockerar inte en rejoin. Hoppar
    // host (host-migration skÃ¶ter den) + bots. roomCode=null â†’ handleDisconnect early-
    // returnar pÃ¥ ghost:ens senare close (ingen dubbel-cleanup/dubbel-slot-free).
    if (msg.reconnectToken) {
      ws._reconnectToken = String(msg.reconnectToken).slice(0, 40);
      if (!room._freeSlots) room._freeSlots = [];
      for (const [ghostPid, ghostWs] of room.members) {
        if (ghostPid === ws.id || ghostWs._isBot || ghostPid === room.hostId) continue;
        if (ghostWs._reconnectToken && ghostWs._reconnectToken === ws._reconnectToken) {
          if (ghostWs.playerState && !ws.playerState) ws.playerState = ghostWs.playerState;
          if (ghostWs._heistRole) { ws._heistRole = ghostWs._heistRole; ws._heistRoleLocked = ghostWs._heistRoleLocked; }
          if (room.sim) {
            const _s = room.sim;
            // #br-30s: BR -> kopiera cash/kills/deaths/pending/vapen ghost->nytt id INNAN delete-loopen.
            if (_s.battleroyaleActive) {
              for (const _bm of ['battleroyaleKillsByPid', 'tdmDeathsByPid', 'brCash']) {
                if (_s[_bm] && _s[_bm][ghostPid] !== undefined && _s[_bm][ws.id] === undefined) _s[_bm][ws.id] = _s[_bm][ghostPid];
              }
              if (_s._brPendingElim) { delete _s._brPendingElim[ghostPid]; delete _s._brPendingElim[ws.id]; }
              if (ghostWs._brOwnedWeapons instanceof Set) ws._brOwnedWeapons = ghostWs._brOwnedWeapons;
              if (ghostWs.playerState && (ghostWs.playerState.hp || 0) > 0) ws._brReconnect = true;
            }
            for (const m of ['deadBodies', 'kothScores', '_kothPointAccum', 'juggernautScores', 'juggernautKillsByPid', 'juggernautDmgToJug', 'battleroyaleKillsByPid', 'tdmKillsByPid', 'tdmDeathsByPid', 'ctfKillsByPid', 'ctfCapturesByPid', 'siegeKillsByPid', 'gungameTiers', 'gungameKillsByPid']) {
              if (_s[m] && _s[m][ghostPid] !== undefined) delete _s[m][ghostPid];
            }
            // CD: BEHALL perks/vapen/tier/guld over reconnect -> flytta per-pid-mapparna ghost->nytt
            // id (annars far reconnectaren tomma cdFlags + tier 0 -> vapen klampas till pistol = tappade allt).
            for (const m of ['castledefensePerkFlags', 'castledefensePerkRanks', 'castledefensePerkPoints', 'castledefensePerks', 'castledefenseWeaponTier', 'castledefenseOwnedWeapons', 'castledefensePurchasedWeapons', 'castledefenseGold', 'castledefenseScores']) {
              if (_s[m] && _s[m][ghostPid] !== undefined) { _s[m][ws.id] = _s[m][ghostPid]; delete _s[m][ghostPid]; }
            }
            if (_s.castledefenseActive) ws._cdReconnect = true;
          }
          if (ghostWs.stableSlot != null && ghostWs.stableSlot !== 0) room._freeSlots.push(ghostWs.stableSlot);
          room.members.delete(ghostPid);
          ghostWs.roomCode = null;  // â†’ handleDisconnect early-returnar pÃ¥ dess close
          try { (ghostWs.terminate || ghostWs.close).call(ghostWs); } catch (e) {}
          const _hostWs = room.members.get(room.hostId);
          if (_hostWs) send(_hostWs, { type: 'peer_left', peerId: ghostPid });
          // SLUTAUDIT 2 #12: peer_left gick bara till hosten â†’ icke-host-Godot-klienter
          // ackumulerade spÃ¶k-peers i roster/minimap. Spegla K2-mÃ¶nstret (peer_joined):
          // skicka Ã¤ven till alla _jsonWorld-peers (ej hosten â€” den fick sitt ovan).
          // V1-webbens icke-hosts Ã¤r aldrig _jsonWorld â†’ V1 opÃ¥verkad.
          for (const [_plPid, _plM] of room.members) {
            if (_plPid === room.hostId) continue;
            if (_plM._jsonWorld) send(_plM, { type: 'peer_left', peerId: ghostPid });
          }
          console.log('[ROOM]', code, 'ghost', ghostPid, 'ersatt av', ws.id, '(samma reconnect-token)');
          break;
        }
      }
    }
    const _joinMaxP = (room.meta && room.meta.maxPlayers) || 8;
    // Spectators räknas inte mot rum-taket (de är inte spelare).
    if (!ws.isSpectator && room.members.size >= _joinMaxP) { send(ws, { type: 'error', error: 'Rummet är fullt (max ' + _joinMaxP + ')' }); return; }
    // Tilldela stabilt slot-index: Ã¥teranvÃ¤nd lÃ¤gsta lediga slot fÃ¶rst,
    // annars ta nÃ¤sta frÃ¥n rÃ¤knaren. Slot Ã¤ndras ALDRIG fÃ¶r en peer under
    // dess session; nÃ¤r peer lÃ¤mnar returneras slottet till _freeSlots.
    if (!room._freeSlots) room._freeSlots = [];
    if (!room._nextSlot) room._nextSlot = 1;
    if (ws.isSpectator) {
      // Spectator får ingen spelar-slot (den syns aldrig i players[]).
      ws.stableSlot = -1;
    } else {
      let slot;
      if (room._freeSlots.length > 0) {
        room._freeSlots.sort((a, b) => a - b);
        slot = room._freeSlots.shift();
      } else {
        slot = room._nextSlot++;
      }
      ws.stableSlot = slot;
    }
    room.members.set(ws.id, ws);
    ws.roomCode = code;
    if (msg.name) ws.playerName = String(msg.name).trim().slice(0, 14);
    // v1.659: reconnect-restore â€” om token matchar en fÃ¤rsk stash (spelare som tappade
    // anslutningen <60s sedan i aktiv sim) Ã¥terstÃ¤ll server-side-only-state som INTE
    // self-healar via sim_input: Heist-roll + hp/shield (annars gratis-heal + roll-loss).
    // KÃ¶rs FÃ–RE late-join-blocken; PvP-blocken sÃ¤tter sedan fresh spawn (korrekt fÃ¶r PvP),
    // co-op/heist (utan PvP-block) behÃ¥ller restoren.
    if (msg.reconnectToken) {
      ws._reconnectToken = String(msg.reconnectToken).slice(0, 40);
      // (ghost-dedupe kÃ¶rs nu HÃ–GRE UPP, fÃ¶re size-check/slot-alloc â€” se v1.771-blocket)
      // v1.697: rensa utgÃ¥ngna stash-entries (>60s) sÃ¥ de inte ackumuleras obegrÃ¤nsat
      // (DoS-yta: join-flood med unika tokens utan reconnect). Cappa Ã¤ven till 16 nyaste.
      if (room._reconnectStash) {
        const _cut = Date.now() - RECONNECT_STASH_TTL_MS;
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
      if (stash && Date.now() - stash.ts < RECONNECT_STASH_TTL_MS) {
        // #wifi: HOST (ingen ghost-transfer) -> ta HELA stashade playerState sa position +
        // vapen + hp aterstalls exakt (annars (0,0)-spawn uppe-vanster + startvapen + fel hp).
        if (stash.pstate && !ws.playerState) ws.playerState = stash.pstate;
        ws._heistRole = stash.heistRole;
        ws._heistRoleLocked = stash.heistRoleLocked;
        if (!ws.playerState) ws.playerState = {};
        // C134: restorera hp ÄVEN när stash.hp <= 0. En spelare som var död/nere vid
        // disconnect hade tidigare hp INTE restorerad → buildPlayerList defaultade dem
        // till 100 (gratis återuppståndelse). Behåll dödstillståndet: stashad hp <= 0
        // läggs tillbaka som hp <= 0 (clampad till min 1 om exakt 0 saknades så de inte
        // tolkas som "okänd" → 100). hp <= 0 passerar buildPlayerList korrekt.
        if (stash.hp != null) ws.playerState.hp = stash.hp;
        if (stash.maxHp != null) ws.playerState.maxHp = stash.maxHp;
        if (stash.shield != null) ws.playerState.shield = stash.shield;
        if (stash.speedMul != null) ws.playerState.speedMul = stash.speedMul;
        if (stash.weaponId != null) ws.playerState.weaponId = stash.weaponId;
        // CD: terminerad-ghost-vagen -> flytta CD-mapparna fran gamla pid:t (stash.pid) -> nytt id.
        if (room.sim && room.sim.castledefenseActive && stash.pid && stash.pid !== ws.id) {
          const _sr = room.sim;
          for (const m of ['castledefensePerkFlags', 'castledefensePerkRanks', 'castledefensePerkPoints', 'castledefensePerks', 'castledefenseWeaponTier', 'castledefenseOwnedWeapons', 'castledefensePurchasedWeapons', 'castledefenseGold', 'castledefenseScores']) {
            if (_sr[m] && _sr[m][stash.pid] !== undefined && _sr[m][ws.id] === undefined) { _sr[m][ws.id] = _sr[m][stash.pid]; delete _sr[m][stash.pid]; }
          }
          ws._cdReconnect = true;
        }
        // #br-30s: BR-reconnect <30s -> aterstall living run (cash/kills/vapen) + flagga sa BR-join-blocket
        // INTE clobbrar till spectator. >30s -> faller igenom till spectator.
        if (room.sim && room.sim.battleroyaleActive && stash.pstate && (stash.pstate.hp || 0) > 0 && (Date.now() - (stash.ts || 0)) < 30000) {
          const _sb = room.sim;
          if (stash.brCash != null) { _sb.brCash = _sb.brCash || {}; _sb.brCash[ws.id] = stash.brCash; }
          if (stash.brKills != null) { _sb.battleroyaleKillsByPid = _sb.battleroyaleKillsByPid || {}; _sb.battleroyaleKillsByPid[ws.id] = stash.brKills; }
          if (stash.brDeaths != null) { _sb.tdmDeathsByPid = _sb.tdmDeathsByPid || {}; _sb.tdmDeathsByPid[ws.id] = stash.brDeaths; }
          if (Array.isArray(stash.brOwnedWeapons)) ws._brOwnedWeapons = new Set(stash.brOwnedWeapons);
          if (_sb._brPendingElim) { delete _sb._brPendingElim[stash.pid]; delete _sb._brPendingElim[ws.id]; }
          ws._brReconnect = true;
        }
        if (room.sim && stash.heistRole) { room.sim.heistRoles = room.sim.heistRoles || {}; room.sim.heistRoles[ws.id] = stash.heistRole; }
        // #wifi: atervandande HOST (stash.pid === hostId) -> ge tillbaka slot 0 + host-rollen
        // sa room.hostId pekar pa en LEVANDE ws igen (annars stale dod hostId -> host-only-
        // kommandon vagras + klientens kvar-true is_host stamde inte med servern).
        if (stash.pid && stash.pid === room.hostId && ws.id !== room.hostId) {
          if (ws.stableSlot > 0 && room._freeSlots) room._freeSlots.push(ws.stableSlot);
          ws.stableSlot = 0;
          room.hostId = ws.id;
          if (room.meta) room.meta.hostName = ws.playerName || room.meta.hostName;
          console.log('[ROOM]', code, 'host reconnected', stash.pid, '->', ws.id, '(slot 0 + host-roll aterstalld)');
        }
        delete room._reconnectStash[ws._reconnectToken];
        console.log('[ROOM]', code, ws.id, 'reconnect-restored role=' + (stash.heistRole || '-') + ' hp=' + (stash.hp != null ? Math.round(stash.hp) : '-'));
      }
    }
    // K2 (audit 2026-06-10, additivt): joined-svaret bÃ¤r nu stableSlot + code.
    // V1-webbens joined-gren lÃ¤ser bara peerId/hostId (game.js:25107) och
    // ignorerar okÃ¤nda fÃ¤lt â†’ V1 opÃ¥verkad. Godot-joiners behÃ¶ver slotten fÃ¶r
    // att hitta SIG SJÃ„LVA i world-paketens players[].c (annars doppelgÃ¤nger +
    // ingen server-auth hp/shield-synk). `code` = F3 (joiner-UI visar rumskod).
    // E2E-fynd 1: joiners fick aldrig pidâ†’slot fÃ¶r TIDIGARE medlemmar (rÃ¥ peerId
    // i kill-feed, slumpad bot-outfit pÃ¥ riktiga spelare, ingen lagfÃ¤rg). Additiv
    // members-lista (exkl. joinern sjÃ¤lv) â€” V1 ignorerar okÃ¤nda fÃ¤lt.
    const memberList = [];
    for (const [mpid, mm] of room.members) {
      if (mpid === ws.id) continue;
      memberList.push({ id: mpid, name: mm.playerName || '', slot: mm.stableSlot != null ? mm.stableSlot : -1 });
    }
    send(ws, { type: 'joined', peerId: ws.id, hostId: room.hostId, stableSlot: ws.stableSlot, code, members: memberList });
    // Meddela host â€” inkludera stableSlot sÃ¥ host:s klient bygger slotToPeerId
    // med det stabila slot-numret (annars rÃ¤knas colorIdx om vid varje join).
    // Spectators annonseras ALDRIG som peers (ingen ska se dem i roster/minimap).
    if (!ws.isSpectator) {
      const host = room.members.get(room.hostId);
      if (host) send(host, { type: 'peer_joined', peerId: ws.id, stableSlot: ws.stableSlot });
      // K2 (forts): skicka peer_joined Ã¤ven till Ã¶vriga rumsmedlemmar â€” men BARA
      // _jsonWorld-peers (Godot). V1-webbens peer_joined-hantering (game.js:25111)
      // Ã¤r host-orienterad: den skickar 'welcome' + 'config' till joinern â€” om en
      // V1-JOINER fick eventet skulle den dubblera welcome med fel roster. Godot-
      // joiners behÃ¶ver eventet fÃ¶r pidâ†’stableSlot-mappning av senare joiners.
      for (const [pid, m] of room.members) {
        if (pid === ws.id || pid === room.hostId) continue;
        if (m._jsonWorld) send(m, { type: 'peer_joined', peerId: ws.id, stableSlot: ws.stableSlot });
      }
    }
    console.log('[ROOM]', code, ws.id, (ws.isSpectator ? 'joined as SPECTATOR (' : 'joined (') + room.members.size + ' members)');
    broadcastPublicRooms();
    // Spectator-presence speglas inte (de "spelar" inte → vänner ska inte se dem i match).
    if (!ws.isSpectator) accounts.presenceChanged(ws); // v2 konto: vÃ¤nner ser lobby/match + rumskod
    // TDM late-joiner: tilldela team baserat pÃ¥ balans, push tdm_started-event riktat
    if (room.sim && room.sim.tdmActive) {
      let red = 0, blue = 0;
      for (const [, m] of room.members) {
        if (m.tdmTeam === 'red') red++;
        else if (m.tdmTeam === 'blue') blue++;
      }
      const team = red <= blue ? 'red' : 'blue';
      const arena = room.sim.tdmArena || { worldW: 4000, worldH: 3000 };
      // spawnX/spawnY hoistas UT ur spectator-guarden — tdm_started-payloaden nedan
      // (skickas till BÅDE åskådare och riktiga late-joiners) läser spawnY.
      const spawnX = team === 'red' ? Math.floor(arena.worldW * 0.10) : Math.floor(arena.worldW * 0.90);
      const spawnY = Math.floor(arena.worldH * 0.50);
      if (!ws.isSpectator) {
        ws.tdmTeam = team;
        // Late-joiner fÃ¥r ocksÃ¥ shield + maxShield (annars saknar de PvP-shield helt)
        ws.playerState = { x: spawnX, y: spawnY, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
        room.sim.tdmKillsByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
      }
      // Bygg fullstÃ¤ndig roster sÃ¥ late-joiner ser alla teams
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
      if (!ws.isSpectator) for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_events', events: [{ type: 'tdm_team_assigned', peerId: ws.id, team }] });
      }
    }
    // CTF late-joiner: samma pattern men fÃ¶r CTF-arena + flag-state + ctf_started
    if (room.sim && room.sim.ctfActive) {
      const { CTF_ARENA } = require('../shared/ctf-arena');
      let red = 0, blue = 0;
      for (const [, m] of room.members) {
        if (m.tdmTeam === 'red') red++;
        else if (m.tdmTeam === 'blue') blue++;
      }
      const team = red <= blue ? 'red' : 'blue';
      if (!ws.isSpectator) {
        ws.tdmTeam = team;
        const pts = CTF_ARENA.spawns[team];
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
        room.sim.ctfKillsByPid[ws.id] = 0;
        room.sim.ctfCapturesByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
      }
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
      if (!ws.isSpectator) for (const [pid, m] of room.members) {
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
      if (!ws.isSpectator) {
        ws.tdmTeam = team;
        const pts = SIEGE_ARENA.spawns[team];
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500 };
        room.sim.siegeKillsByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
      }
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
      if (!ws.isSpectator) for (const [pid, m] of room.members) {
        if (pid === ws.id) continue;
        send(m, { type: 'sim_events', events: [{ type: 'siege_team_assigned', peerId: ws.id, team }] });
      }
    }
    // GUNGAME late-joiner: spawna pÃ¥ roterande spawn, tier 0, FFA (inget team)
    if (room.sim && room.sim.gungameActive) {
      const { GUNGAME_ARENA, GUNGAME_WEAPONS } = require('../shared/gungame-arena');
      if (!ws.isSpectator) {
        const idx = (room.sim._gungameSpawnIdx || 0) % GUNGAME_ARENA.spawns.length;
        room.sim._gungameSpawnIdx = (room.sim._gungameSpawnIdx || 0) + 1;
        const sp = GUNGAME_ARENA.spawns[idx];
        ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500, weaponId: GUNGAME_WEAPONS[0] };
        ws.tdmTeam = null; // FFA
        room.sim.gungameTiers[ws.id] = 0;
        room.sim.gungameKillsByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
      }
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
      // Om sim fortfarande Ã¤r i 5s prep-countdown, skicka countdown_start med
      // resten av tiden sÃ¥ late-joiner ser samma overlay som andra spelare.
      if (room.sim.simReadyAt && Date.now() < room.sim.simReadyAt) {
        lateJoinEvents.push({
          type: 'countdown_start',
          durationMs: room.sim.simReadyAt - Date.now(),
        });
      }
      // Befintliga bots â€” late-joiner ser dem inte utan synthetiska bot_joined
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
    // KOTH late-joiner: spawna pÃ¥ roterande spawn-point + skicka current scores
    if (room.sim && room.sim.kothActive) {
      const { KOTH_ARENA } = require('../shared/koth-arena');
      if (!ws.isSpectator) {
        const idx = (room.sim._kothSpawnIdx || 0) % KOTH_ARENA.spawns.length;
        room.sim._kothSpawnIdx = (room.sim._kothSpawnIdx || 0) + 1;
        const sp = KOTH_ARENA.spawns[idx];
        ws.playerState = { x: sp.x, y: sp.y, hp: 100, shield: 100, maxShield: 100, invulnUntil: Date.now() + 1500, weaponId: 'pistol' };
        ws.tdmTeam = null;
        room.sim.kothScores[ws.id] = 0;
        room.sim.kothKillsByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
        room.sim._kothPointAccum[ws.id] = 0;
      }
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
      // Aktuella scores sÃ¥ late-joiner ser leaderboard direkt
      lateKothEvents.push({
        type: 'koth_score_update',
        scores: { ...(room.sim.kothScores || {}) },
        target: room.sim.kothTargetPoints,
      });
      // OcksÃ¥ nÃ¤sta zone-rotate-tid
      if (room.sim._kothZoneRotateAt) {
        const zone = KOTH_ARENA.zones[room.sim.kothActiveZoneIdx || 0];
        lateKothEvents.push({
          type: 'koth_zone_changed',
          idx: room.sim.kothActiveZoneIdx || 0,
          x: zone.x, y: zone.y, r: zone.r, name: zone.name,
          nextRotateAt: room.sim._kothZoneRotateAt,
        });
      }
      // Befintliga bots i sim:n â€” late-joiner ser dem inte annars (bot_joined
      // emittades vid sim-start och queuen tÃ¶mdes innan denna spelare anslÃ¶t).
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
      if (!ws.isSpectator) {
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
      }
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
      // Aktuella scores fÃ¶r leaderboard
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
    // BATTLE ROYALE late-joiner: BR Ã¤r no-respawn â€” sÃ¤tt direkt som spectator.
    // Klient renderar match frÃ¥n spectator-cam. NÃ¤r matchen slutar kan de joina
    // rematch (vanlig flow).
    if (room.sim && room.sim.battleroyaleActive) {
      const { BATTLEROYALE_ARENA } = require('../shared/battleroyale-arena');
      // Spawnpos i mitten â€” de blir spectator omedelbart (hp=0)
      if (!ws.isSpectator && room.sim.brPredrop) {
        // PRE-DROP aktiv � joinaren blir en RIKTIG levande spelare PA bussen.
        const _A = BATTLEROYALE_ARENA;
        const _bx = room.sim.brBus ? room.sim.brBus.startX : _A.worldW / 2;
        const _by = room.sim.brBus ? room.sim.brBus.startY : _A.worldH / 2;
        const _spawns = (room.sim._brArena && room.sim._brArena.spawns) || _A.spawns;
        const _ls = _spawns[Math.floor(Math.random() * _spawns.length)] || { x: _A.worldW / 2, y: _A.worldH / 2 };
        ws.playerState = {
          x: _bx, y: _by, hp: _A.startHp, maxHp: _A.maxHp,
          shield: _A.startShield, maxShield: _A.maxShield,
          invulnUntil: (room.sim.brPredropDeadlineAt || Date.now() + 30000) + 1500,
          weaponId: _A.startWeapon, _brWeaponTier: 'starter',
          isJug: false, scaleMul: 1.0, speedMul: 1.0, dashCdMs: null,
          brAir: 1, brJumpedAt: 0, brLandX: _ls.x, brLandY: _ls.y,
          brPerkLevels: {}, selfReviveKits: 0, airstrikes: 0, uavCount: 0,
          medkits: 0, shieldkits: 0, adrenalines: 0,
          brDowned: false, gulagState: null, spectating: false,
        };
        ws._brOwnedWeapons = new Set(['fists', 'knife', _A.startWeapon || 'pistol']);
        ws.tdmTeam = null; ws.tdmRespawnAt = 0;
        room.sim.battleroyaleKillsByPid[ws.id] = 0;
        room.sim.tdmDeathsByPid[ws.id] = 0;
        room.sim.brCash[ws.id] = room.sim._brStartCash;
        room.sim.battleroyaleAliveCount = (room.sim.battleroyaleAliveCount || 0) + 1;
      } else if (!ws.isSpectator) {
        if (room.sim && room.sim.battleroyaleActive && ws._brReconnect && ws.playerState && (ws.playerState.hp || 0) > 0 &&
            (!room.sim.battleroyaleEliminated || !room.sim.battleroyaleEliminated.includes(ws.id))) {
          // #br-30s: RECONNECT <30s -> BEHALL den restorerade levande BR-runden (cash/kills/vapen redan satta).
          ws._brReconnect = false;
          if (room.sim._brPendingElim && room.sim._brPendingElim[ws.id] != null) delete room.sim._brPendingElim[ws.id];
        } else {
          ws.playerState = {
            x: BATTLEROYALE_ARENA.worldW / 2,
            y: BATTLEROYALE_ARENA.worldH / 2,
            hp: 0,
            maxHp: BATTLEROYALE_ARENA.maxHp,
            shield: 0,
            maxShield: BATTLEROYALE_ARENA.maxShield,
            invulnUntil: 0,
            weaponId: BATTLEROYALE_ARENA.startWeapon,
            isJug: false, scaleMul: 1.0, speedMul: 1.0, dashCdMs: null,
          };
          ws.tdmTeam = null;
          ws.tdmRespawnAt = 0;
          if (!room.sim.battleroyaleEliminated.includes(ws.id)) {
            room.sim.battleroyaleEliminated.push(ws.id);
            room.sim.battleroyaleRanks[ws.id] = 999;
          }
          room.sim.battleroyaleKillsByPid[ws.id] = 0;
          room.sim.tdmDeathsByPid[ws.id] = 0;
        }
      }
      const lateBrEvents = [{
        type: 'br_started',
        arena: { worldW: BATTLEROYALE_ARENA.worldW, worldH: BATTLEROYALE_ARENA.worldH, name: BATTLEROYALE_ARENA.name },
        // walls + decorations utelämnade (klienten läser dem aldrig ur br_started — bygger
        // banan lokalt). Drar ner late-join-paketet 400KB→~90KB.
        spawns: BATTLEROYALE_ARENA.spawns,
        // Bara renderade cabin-fält (se room-sim.js br_started) → håll under MAX_FRAGS=64.
        cabins: (BATTLEROYALE_ARENA.cabins || []).map(c => ({
          bounds: c.bounds, door: c.door, windows: c.windows,
          roof: c.roof, floor: c.floor, shop: c.shop, _isContainer: c._isContainer,
        })),
        loot: (room.sim.battleroyaleLoot || []).filter(lo => lo.available).map(lo => ({
          id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: lo.unlockAt || 0,
        })),
        contracts: (room.sim.brContracts || []).map(c => ({ id: c.id, x: c.x, y: c.y, type: c.type, available: c.available })),
        buyStations: room.sim.brBuyStations,
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
        predrop: !!room.sim.brPredrop,
        bus: room.sim.brBus ? { startX: room.sim.brBus.startX, startY: room.sim.brBus.startY, endX: room.sim.brBus.endX, endY: room.sim.brBus.endY, startAt: room.sim.brBus.startAt, durMs: room.sim.brBus.durMs } : null,
        serverNow: Date.now(),
        worldW: BATTLEROYALE_ARENA.worldW, worldH: BATTLEROYALE_ARENA.worldH,
        isSpectator: !room.sim.brPredrop && !(ws.playerState && (ws.playerState.hp || 0) > 0),
        isReconnect: !room.sim.brPredrop && !!(ws.playerState && (ws.playerState.hp || 0) > 0),
        ownedWeapons: (!room.sim.brPredrop && (ws._brOwnedWeapons instanceof Set) && ws.playerState && (ws.playerState.hp || 0) > 0) ? Array.from(ws._brOwnedWeapons) : null, // klient ska direkt gÃ¥ in i spec-cam
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
      // #br-reconnect: levande reconnect -> klientens HUD nollas av br_started. Skicka
      // full ackumulerad state sa cash/vaska/perks/maxstat aterstalls (ej bara vapen).
      if (!room.sim.brPredrop && ws.playerState && (ws.playerState.hp || 0) > 0) {
        const _ps = ws.playerState;
        const _rs = [
          { type: 'br_cash_update', peerId: ws.id, cash: (room.sim.brCash && room.sim.brCash[ws.id]) || 0 },
          { type: 'br_maxstat', peerId: ws.id, maxHp: _ps.maxHp || 100, maxShield: _ps.maxShield || 200, hp: _ps.hp, shield: _ps.shield || 0 },
        ];
        if (_ps.brPerkLevels) { for (const _pk in _ps.brPerkLevels) { if (_ps.brPerkLevels[_pk] > 0) _rs.push({ type: 'br_perk_level', peerId: ws.id, perk: _pk, level: _ps.brPerkLevels[_pk] }); } }
        const _items = [['self_revive','selfReviveKits'],['airstrike','airstrikes'],['uav','uavCount'],['medkit','medkits'],['shieldkit','shieldkits'],['adrenaline','adrenalines']];
        for (const _it of _items) { const _c = _ps[_it[1]] || 0; if (_c > 0) _rs.push({ type: 'br_item_count', peerId: ws.id, item: _it[0], count: _c }); }
        if (_ps.brContract) { _rs.push({ type: 'br_contract_active', peerId: ws.id, contract: _ps.brContract }); }
        send(ws, { type: 'sim_events', events: _rs });
      }
      return;
    }

    // C106: CASTLE DEFENSE / SURVIVORS late-joiner. Tidigare fanns INGET block →
    // joinaren blev ett off-map-spöke utan spawn/gold/vapen/UI (story-blocket nedan
    // exkluderar dessutom explicit castledefenseActive). Spegla heist/KOTH-mönstret:
    // spawna inne i castle, seed:a per-pid match-state, skicka cd_started.
    if (room.sim && room.sim.castledefenseActive && !room.sim.castledefenseEnded) {
      const sim = room.sim;
      const { CASTLEDEFENSE_ARENA: cdArena } = require('../shared/castledefense-arena');
      if (!ws.isSpectator && ws._cdReconnect) {
        // RECONNECT: behall transfererad/restorerad playerState + re-keyade CD-mappar (perks/tier/guld).
        // Bygg INTE om playerState och NOLLA INTE mapparna (det var bugg #3 = tappade allt mid-game).
        ws.playerState = ws.playerState || {};
        if (ws.playerState.weaponId == null) ws.playerState.weaponId = cdArena.startWeapon;
        ws.playerState.invulnUntil = Date.now() + 2000;
        ws.playerState.cdDowned = false; ws.playerState.cdDownDead = false; ws.playerState.spectating = false;
        ws.tdmTeam = null; ws.tdmRespawnAt = 0;
      } else if (!ws.isSpectator) {
        const cdSpawnList = cdArena.playerSpawns || [{ x: cdArena.centerX, y: cdArena.centerY }];
        const cdSp = cdSpawnList[(sim._cdLateJoinIdx || 0) % cdSpawnList.length];
        sim._cdLateJoinIdx = (sim._cdLateJoinIdx || 0) + 1;
        ws.playerState = {
          x: cdSp.x, y: cdSp.y,
          hp: cdArena.startHp, maxHp: cdArena.maxHp,
          shield: sim.baseShield > 0 ? sim.baseShield : cdArena.startShield,
          maxShield: Math.max(cdArena.maxShield, sim.baseShield || 0),
          invulnUntil: Date.now() + 2000,
          weaponId: cdArena.startWeapon,
          isJug: false, scaleMul: 1.0, speedMul: 1.0, dashCdMs: null,
          cdDowned: false, cdDownDead: false, cdDownStartedAt: 0,
          cdDownReviveProgress: 0, spectating: false, aim: 0,
        };
        ws.tdmTeam = null; // co-op
        ws.tdmRespawnAt = 0;
        ws._mountedCtfTurretId = null;
        ws._mountedSiegeTurretId = null;
        sim.castledefenseGold = sim.castledefenseGold || {};
        sim.castledefenseWeaponTier = sim.castledefenseWeaponTier || {};
        sim.castledefenseScores = sim.castledefenseScores || {};
        sim.castledefenseGold[ws.id] = sim.survivorsActive ? 100 : (cdArena.startGold || 400);
        sim.castledefenseWeaponTier[ws.id] = 0;
        sim.castledefenseScores[ws.id] = 0;
        sim.tdmDeathsByPid[ws.id] = 0;
        if (sim.survivorsActive) {
          sim.castledefenseOwnedWeapons = sim.castledefenseOwnedWeapons || {};
          sim.castledefenseOwnedWeapons[ws.id] = ['pistol'];
        }
      }
      send(ws, { type: 'sim_events', events: [{
        type: 'cd_started',
        arena: {
          worldW: cdArena.worldW, worldH: cdArena.worldH, name: cdArena.name,
          groundColor: cdArena.groundColor, plazaColor: cdArena.plazaColor,
          pathColor: cdArena.pathColor, plazaRadius: cdArena.plazaRadius,
          centerX: cdArena.centerX, centerY: cdArena.centerY,
          startWeapon: cdArena.startWeapon, startGrenades: cdArena.startGrenades,
          weaponProgression: cdArena.weaponProgression,
        },
        walls: [],
        core: { ...sim.castledefenseCore },
        playerSpawns: cdArena.playerSpawns,
        enemySpawns: cdArena.enemySpawns,
        decorations: cdArena.decorations || [],
        buildables: cdArena.buildables,
        buildGridSize: cdArena.buildGridSize,
        startHp: cdArena.startHp,
        maxHp: cdArena.maxHp,
        startGold: sim.castledefenseGold,
        waveBetweenEndAt: sim.castledefenseWaveBetweenEndAt,
        bossEveryWave: cdArena.bossEveryWave,
        // v3 perk-träd: spec + late-joinarens nuvarande poäng (oftast 0).
        perkTrees: cdArena.perkTrees,
        perkPoints: (sim.castledefensePerkPoints && sim.castledefensePerkPoints[ws.id]) || 0,
        perkRanks: (sim.castledefensePerkRanks && sim.castledefensePerkRanks[ws.id]) || {},
        weaponTier: (sim.castledefenseWeaponTier && sim.castledefenseWeaponTier[ws.id]) || 0,
        ownedWeapons: (sim.castledefenseOwnedWeapons && sim.castledefenseOwnedWeapons[ws.id]) || null,
        isReconnect: !!ws._cdReconnect,
        isLateJoin: true,
      }] });
      return;
    }

    // HEIST late-joiner (v1.697): fÃ¶rr fanns inget block â†’ joinaren blev ett spÃ¶ke
    // utan roll/fas/UI mid-match. Skicka full heist_started + aktuell fas/progress.
    if (room.sim && room.sim.heistActive && !room.sim.heistEnded) {
      const sim = room.sim;
      const { HEIST_ARENA: arena } = require('../shared/heist-arena');
      if (!ws.isSpectator) {
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
        // v1.697b: _heistApplyRole Ã¤r INTE i join-handlerns scope (fri variabel â†’ typeof gav
        // 'undefined' i sloppy mode â†’ rollstats applicerades aldrig). Inline-require som pick_role.
        const { _heistApplyRole: _applyHeistRoleFn } = require('./sim/room-sim');
        if (typeof _applyHeistRoleFn === 'function') _applyHeistRoleFn(ws, ws._heistRole, sim, arena);
      }
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
    // SLUTAUDIT 2 #3: STORY-FAMILJEN late-joiner (story/endless/bossrush/truck/daily/
    // speedrun). loadStage broadcastade stage_loaded vid stage-start men event-kÃ¶n
    // var lÃ¤ngesedan tÃ¶md â†’ late-joinern fick aldrig wave/stage â†’ tom vÃ¤rld. ResÃ¤nd
    // EXAKT samma fÃ¤lt som loadStage (sim/waves.js:378). Stage hÃ¤rleds deterministiskt
    // med samma uppslag som stageFor i waves.js: customStagesList (Godot-modes) annars
    // getStage(wave). Gate:at pÃ¥ _jsonWorld (Godot) â€” V1-webben fÃ¥r inget = no-op.
    if (ws._jsonWorld && room.sim && room.sim.waveActive
        && !room.sim.tdmActive && !room.sim.ctfActive && !room.sim.siegeActive
        && !room.sim.gungameActive && !room.sim.kothActive && !room.sim.juggernautActive
        && !room.sim.battleroyaleActive && !room.sim.castledefenseActive && !room.sim.heistActive) {
      const sim = room.sim;
      const { getStage } = require('../shared/stages-data');
      const cs = sim.customStagesList;
      const stage = (cs && cs[sim.wave - 1]) || getStage(sim.wave);
      if (stage) {
        send(ws, { type: 'sim_events', events: [{
          type: 'stage_loaded', wave: sim.wave, stageName: stage.name, stageKind: stage.kind,
        }] });
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
      // Broadcast till alla utom avsÃ¤ndaren
      broadcast(room, payload, ws.id);
    }
    return;
  }

  if (msg.type === 'leave') {
    handleDisconnect(ws);
    return;
  }

  if (msg.type === 'client_bg') {
    // #br-bg: appen bakgrundades -> skydda kroppen OMEDELBART (annars hinner en snabb
    // app-vaxling <2.5s skjuta/downa spelaren i PvP innan disconnect-grace:n vaknar).
    const _ps = ws.playerState;
    if (_ps && _ps.hp > 0) {
      const _r = rooms.get(ws.roomCode);
      const _s = _r && _r.sim ? _r.sim : null;
      const _isPvP = _s && !!(_s.tdmActive || _s.ctfActive || _s.siegeActive || _s.gungameActive ||
                              _s.kothActive || _s.juggernautActive || _s.battleroyaleActive);
      _ps.invulnUntil = Date.now() + (_isPvP ? 1500 : 3000);
      ws._isBackgrounded = true;   // RTT-loopen fortsatter refresha (PvP cappat ~10s)
    }
    return;
  }
  if (msg.type === 'client_fg') { ws._isBackgrounded = false; return; }

  // â”€â”€ SERVER-AUTHORITATIVE SIM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Phase 1: opt-in via 'sim_start' frÃ¥n host. Server tar Ã¶ver enemy-AI.
  // Klienter skickar sin position via 'sim_input'. Server broadcastar world-paket.
  // Default OFF â€” gamla host-authoritative kÃ¶r som tidigare nÃ¤r sim inte Ã¤r aktiverad.
  if (msg.type === 'sim_start') {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (room.hostId !== ws.id) return;  // bara host fÃ¥r starta
    // SPECTATE: en ny match (rematch/läges-byte) får ALDRIG dra in en spectator som
    // spelare i startSim-loparna. Släpp alla spectators ur rummet innan ny sim skapas
    // — deras klient återgår till menyn på 'spectate_ended'.
    {
      const _specs = [];
      for (const [pid, m] of room.members) { if (m.isSpectator) _specs.push(m); }
      for (const m of _specs) {
        room.members.delete(m.id);
        try { send(m, { type: 'spectate_ended' }); } catch (e) {}
        try { (m.close || m.terminate).call(m); } catch (e) {}
      }
    }
    // v2-tillÃ¤gg (additivt): custom stage-listor (Godot endless/bossrush m.fl.).
    // Saniteras hÃ¥rt â€” utan fÃ¤ltet Ã¤r beteendet EXAKT som fÃ¶rut.
    // M3 (audit 2026-06-10): saniteringen kÃ¶rs nu FÃ–RE stopSim-blocket nedan +
    // .filter(s => s && typeof s === 'object') fÃ¶re .map (Ã¤ven miniBosses/zones).
    // FÃ¶rr kastade String(s.id) pÃ¥ null-element EFTER att stopSim + room.sim=null
    // redan kÃ¶rts â†’ trasigt customStages vid rematch dÃ¶dade pÃ¥gÃ¥ende sim och
    // lÃ¤mnade rummet utan sim_started. Nu: kastar inget, och skulle nÃ¥got Ã¤ndÃ¥
    // kasta sker det innan nÃ¥gon destruktiv state-Ã¤ndring.
    let customStages = null;
    if (Array.isArray(msg.customStages) && msg.customStages.length > 0) {
      const okTypes = new Set(['grunt', 'runner', 'brute', 'shooter', 'ninja', 'swordsman', 'soldier', 'robot', 'dog', 'healer', 'summoner', 'swarmer', 'swordsman', 'sniper', 'bomber']);
      const num = (v, d, lo, hi) => Math.max(lo, Math.min(hi, +v || d));
      customStages = msg.customStages.slice(0, 60).filter(s => s && typeof s === 'object').map((s, i) => ({
        id: String(s.id || ('custom' + (i + 1))).slice(0, 32),
        name: String(s.name || ('STAGE ' + (i + 1))).slice(0, 40),
        kind: String(s.kind || 'forest').slice(0, 16),
        worldW: num(s.worldW, 2000, 800, 6000),
        worldH: num(s.worldH, 2800, 800, 6000),
        spawnPos: { x: num(s.spawnPos && s.spawnPos.x, 1000, 50, 6000), y: num(s.spawnPos && s.spawnPos.y, 2600, 50, 6000) },
        goalPos: { x: num(s.goalPos && s.goalPos.x, 1000, 50, 6000), y: num(s.goalPos && s.goalPos.y, 200, 50, 6000) },
        goalRadius: num(s.goalRadius, 100, 40, 300),
        bossKey: s.bossKey ? String(s.bossKey).slice(0, 24) : undefined,
        miniBosses: Array.isArray(s.miniBosses) ? s.miniBosses.slice(0, 4).filter(m => m && typeof m === 'object').map(m => ({
          type: okTypes.has(String(m.type)) ? String(m.type) : 'brute',
          name: String(m.name || 'ELITE').slice(0, 28),
          power: String(m.power || 'caster').slice(0, 20),
          hpMul: num(m.hpMul, 8, 1, 40), dmgMul: num(m.dmgMul, 1.5, 0.5, 4),
          scale: num(m.scale, 1.3, 1, 2.2), gold: num(m.gold, 150, 0, 3000),
        })) : undefined,
        zones: Array.isArray(s.zones) ? s.zones.slice(0, 8).filter(z => z && typeof z === 'object').map(z => ({
          count: num(z.count, 8, 1, 50),
          pool: Array.isArray(z.pool) ? z.pool.filter(t => okTypes.has(String(t))).slice(0, 6) : ['grunt'],
          event: z.event ? String(z.event).slice(0, 24) : undefined,
        })) : [{ count: 8, pool: ['grunt'] }],
        bgColor: String(s.bgColor || '#2a2a30').slice(0, 9),
        accentColor: String(s.accentColor || '#10101a').slice(0, 9),
        // v2 #58 (additivt): sandbox-stage â€” ingen wave-progression/boss, 6 odÃ¶dliga
        // dummy-fiender i ring runt stage-center. V1 skickar aldrig fÃ¤ltet â†’ undefined.
        sandbox: s.sandbox === true ? true : undefined,
      }));
      if (customStages.length === 0) customStages = null;  // bara skrÃ¤p-element â†’ som om fÃ¤ltet saknades
    }
    // Rematch / mode-byte: stoppa ev. tidigare sim och skapa en ny sÃ¥ ingen
    // gammal state (tdmActive/ctfActive/scores/pickup-ids) lÃ¤cker in i nÃ¤sta match.
    if (room.sim) {
      try { stopSim(room.sim); } catch (e) {}
      // v1.769 livscykel-fix: nulla room.sim efter stopSim. Om stopSim kastade levde
      // gamla sim:ens setInterval-tick kvar; eftersom createSim ger ett NYTT objekt
      // (interval=null) passerade startSim:s guard â†’ TVÃ… tick-loopar mot samma rum
      // (hp hoppar, spÃ¶ken, "ibland funkar/ibland inte"). Garantera ren slate.
      room.sim = null;
    }
    // TillÃ¤mpa team-assignments frÃ¥n host (om shuffle/pick aktiverat).
    // msg.teams: { peerId â†’ 'red' | 'blue' }. SÃ¤tt ws.tdmTeam INNAN startSim
    // sÃ¥ room-sim plockar upp dem istÃ¤llet fÃ¶r i%2-defaulten.
    if (msg.teams && typeof msg.teams === 'object') {
      for (const [pid, team] of Object.entries(msg.teams)) {
        const member = room.members.get(pid);
        if (member && (team === 'red' || team === 'blue')) {
          member.tdmTeam = team;
        }
      }
    }
    room.sim = createSim(room);
    if (customStages) room.sim.customStagesList = customStages;
    // v2: PvE-stage-vÃ¤ggar frÃ¥n Godot-klienten (story-byggnader per wave) â€” kulor
    // stoppas server-side (bullets.js _pveWalls). Saniterat: max 60 stages Ã— 120
    // walls, talen clampade. V1-webben skickar aldrig fÃ¤ltet â†’ no-op.
    if (Array.isArray(msg.stageWalls)) {
      const wnum = (v, d, lo, hi) => Math.max(lo, Math.min(hi, +v || d));
      // M3 (samma klass): filtrera icke-objekt-element sÃ¥ wnum(r.x) inte kastar
      // pÃ¥ null mitt mellan createSim och startSim (rummet skulle fastna utan sim).
      room.sim.stageWallsList = msg.stageWalls.slice(0, 60).map((list) =>
        Array.isArray(list) ? list.slice(0, 120).filter(r => r && typeof r === 'object').map((r) => ({
          x: wnum(r.x, 0, -2000, 12000), y: wnum(r.y, 0, -2000, 12000),
          w: wnum(r.w, 10, 1, 4000), h: wnum(r.h, 10, 1, 4000),
        })) : []);
    }
    startSim(room.sim, {
      difficulty: msg.difficulty,
      ngpLevel: msg.ngpLevel,
      mode: msg.mode,
      wave: msg.wave,
      // v2-tillÃ¤gg: dagliga modifiers (clampade, default 1 = no-op)
      enemySpeedMul: Math.max(0.5, Math.min(2.0, +msg.enemySpeedMul || 1)),
      goldMul: Math.max(0.5, Math.min(3.0, +msg.goldMul || 1)),
      // v2 #62 (additivt): countdown-lÃ¤ngd. V1 skickar aldrig â†’ 0 â†’ default (5000/3000 heist).
      countdownMs: msg.countdownMs ? Math.max(1000, Math.min(8000, Math.round(+msg.countdownMs) || 0)) : 0,
      // v2 #68 (additivt): start-shield i alla modes. V1 skickar aldrig â†’ 0 â†’ exakt gammalt beteende.
      baseShield: Math.max(0, Math.min(100, Math.round(+msg.baseShield) || 0)),
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
      // BR FORTNITE PLANE-DROP: slå PÅ predrop även för host-startade BR-matcher (klienten
      // host-startar solo → träffar denna väg, INTE matchmakern som redan har brPredrop:true).
      // Detta var den kvarvarande orsaken till "spawnar på marken, inget flyg".
      brPredrop: !!msg.battleroyale,
      gulagPractice: msg.gulagPractice, // DEBUG: hoppa direkt in i ett gulag-spel vs bot

      castledefense: msg.castledefense,
      survivors: msg.survivors,
      survivorsDurationSec: msg.survivorsDurationSec,
      stresstest: msg.stresstest,
      heist: msg.heist,
      heistRoles: msg.heistRoles,
      addBot: !!msg.addBot,
      botCount: Math.max(1, Math.min(24, msg.botCount || 1)),
      botSkill: msg.botSkill || 'normal',
      botTeam: msg.botTeam,
      botNames: Array.isArray(msg.botNames) ? msg.botNames : null,
      botTeams: Array.isArray(msg.botTeams) ? msg.botTeams : null,
      // V2: per-bot skill-mix (saniterad — bara giltiga nivåer släpps igenom,
      // resten faller tillbaka på botSkill i spawn-loopen).
      botSkills: Array.isArray(msg.botSkills)
        ? msg.botSkills.slice(0, 24).map(s => (s === 'easy' || s === 'normal' || s === 'hard') ? s : null)
        : null,
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
    for (const [, m] of room.members) accounts.presenceChanged(m); // v2 konto: lobby â†’ match
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
    room.sim = null;  // v1.771: hÃ¥ll invarianten "om room.sim existerar Ã¤r den aktiv"
    if (room.meta) room.meta.started = false;
    broadcastPublicRooms();
    for (const [, m] of room.members) accounts.presenceChanged(m); // v2 konto: match â†’ lobby
    return;
  }

  // v2 #60 (additivt): host kan sparka spelare/bot ur rummet. V1-webben skickar
  // aldrig kick_peer â†’ handlern Ã¤r dÃ¶d kod fÃ¶r V1. Bot â†’ bort ur rum+sim;
  // mÃ¤nniska â†’ {type:'kicked'} + ws-close + samma stÃ¤dning som disconnect.
  if (msg.type === 'request_team_change') {
    const room = rooms.get(ws.roomCode);
    if (!room || room.sim) return;                     // bara i lobbyn (fore match)
    const team = (msg.team === 'red' || msg.team === 'blue') ? msg.team : null;
    if (!team) return;
    ws.tdmTeam = team;                                 // server-auktoritativt lagbyte
    broadcast(room, { type: 'team_changed', peerId: ws.id, team });
    return;
  }
  if (msg.type === 'kick_peer') {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (room.hostId !== ws.id) return;                 // bara host
    const peerId = typeof msg.peerId === 'string' ? msg.peerId : '';
    if (!peerId || peerId === ws.id) return;           // kan inte kicka sig sjÃ¤lv
    const target = room.members.get(peerId);
    if (!target) return;
    if (target._isBot) {
      // BOT: ta bort ur rummet + sim (botIds + per-pid sim-state, mirror av disconnect-stÃ¤dning)
      room.members.delete(peerId);
      if (target.stableSlot != null && target.stableSlot !== 0 && room._freeSlots) {
        room._freeSlots.push(target.stableSlot);
      }
      if (room.sim) {
        const _s = room.sim;
        if (_s._botIds) _s._botIds = _s._botIds.filter(id => id !== peerId);
        if (_s.deadBodies) delete _s.deadBodies[peerId];
        if (_s.kothScores) delete _s.kothScores[peerId];
        if (_s._kothPointAccum) delete _s._kothPointAccum[peerId];
        if (_s.juggernautScores) delete _s.juggernautScores[peerId];
        if (_s.battleroyaleKillsByPid) delete _s.battleroyaleKillsByPid[peerId];
        if (_s.tdmDeathsByPid) delete _s.tdmDeathsByPid[peerId];
        if (_s.battleroyaleActive && _s.battleroyaleEliminated && !_s.battleroyaleEliminated.includes(peerId)) {
          _s.battleroyaleEliminated.push(peerId);
          if (typeof _s.battleroyaleAliveCount === 'number') _s.battleroyaleAliveCount = Math.max(0, _s.battleroyaleAliveCount - 1);
        }
        if (_s.juggernautActive && _s.juggernautPid === peerId) {
          // C229: immediately install a live human as the new JUG instead of
          // leaving the role vacant until the next human respawn.
          const _nextJug = pickRandomHumanHunter(_s, peerId);
          if (_nextJug) {
            transferJug(_s, _nextJug, 'jug_kicked');
          } else {
            _s.juggernautPid = null;
            _s._juggernautAwaitFirstRespawn = true;
            _s.eventQueue.push({ type: 'juggernaut_jug_changed', newJug: null, oldJug: peerId, reason: 'jug_kicked', weapon: _s.juggernautWeapon, jugHp: _s.juggernautHpMax });
          }
        }
      }
      console.log('[ROOM]', room.code, 'bot', peerId, 'kicked by host');
    } else {
      // MÃ„NNISKA: meddela offret, stÃ¤da som disconnect, stÃ¤ng socketen.
      send(target, { type: 'kicked' });
      handleDisconnect(target);
      target.roomCode = null;            // close-eventets handleDisconnect no-op:ar dÃ¥
      try { target.close(); } catch (e) {}
      console.log('[ROOM]', room.code, peerId, 'kicked by host');
    }
    for (const [, m] of room.members) {
      if (!m._isBot) send(m, { type: 'peer_kicked', peerId });
    }
    broadcastPublicRooms();
    return;
  }

  // CTF turret-enter: spelaren vill mounta turret. Server auktoritet kollar
  // avstÃ¥nd + lag + ledig + ej destroyed.
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

  // SkÃ¶ld-ability: 3s immunitet, 45s cooldown (20s JUG-hunter).
  // v1.714: tillÃ¥ten i ALLA server-sim-lÃ¤gen (PvP + co-op PvE: survivors/heist/CD/
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
    // SÃ¤tter invulnUntil â€” bullets.js/explode kollar redan denna
    ws.playerState.invulnUntil = Math.max(ws.playerState.invulnUntil || 0, now + SHIELD_DURATION);
    // Broadcasta sÃ¥ alla klienter renderar bubblan + ljudet
    room.sim.eventQueue.push({
      type: 'pvp_shield_used',
      peerId: ws.id,
      durationMs: SHIELD_DURATION,
      cooldownMs: SHIELD_COOLDOWN, // klient anvÃ¤nder fÃ¶r CD-ring
    });
    return;
  }
  // TDM fy_-fÃ¶rrÃ¥d: klienten synkar vilket vapen som Ã¤r i HANDEN (snapshot till andra).
  // Servern litar pÃ¥ klientens equip (TDM har redan klient-betrodd weaponId via sim_shoot).
  if (msg.type === 'tdm_equip') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim || !room.sim.tdmActive) return;
    if (!ws.playerState || typeof msg.weaponId !== 'string') return;
    ws.playerState.weaponId = msg.weaponId;
    return;
  }
  // JUGGERNAUT vapen-byte: bara nuvarande JUG-spelaren fÃ¥r byta, valet mÃ¥ste
  // vara inom listan frÃ¥n arena-konfig.
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
    // Echo tillbaka klient-timestamp sÃ¥ de kan berÃ¤kna RTT mot servern.
    // st (additivt, transport-pass 2026-06-10): serverns klocka vid svar â€”
    // klienten kan kalibrera server-tid-offset (RTT/2-metoden) fÃ¶r sin
    // interpolationsbuffert. V1-webben lÃ¤ser bara t â†’ opÃ¥verkad.
    send(ws, { type: 'server_pong', t: msg.t, st: Date.now() });
    return;
  }
  // Lag comp: klient ekar tillbaka RTT-ping. Server berÃ¤knar RTT och sparar.
  // Smooth via EMA (0.3 ny, 0.7 gammal) sÃ¥ enstaka spikes inte ger felaktig rewind.
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
  if (msg.type === 'sim_br_jump') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrJump(room.sim, ws.id);
    return;
  }
  if (msg.type === 'sim_br_buy') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrBuy(room.sim, ws.id, msg.item);
    return;
  }
  if (msg.type === 'sim_br_infcash') {
    // C100: dev-cheat — gate:ad bakom env-flagga + host-only (mirror av sim_stresstest).
    // Utan ALLOW_CHEATS kan ingen klient ge sig själv +100k cash i produktion.
    if (!process.env.ALLOW_CHEATS) return;
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (room.hostId !== ws.id) return;
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
  if (msg.type === 'sim_br_use_item') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrUseItem(room.sim, ws.id, msg.item);
    return;
  }
  if (msg.type === 'sim_br_accept_contract') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrAcceptContract(room.sim, ws.id, msg.id);
    return;
  }
  if (msg.type === 'sim_br_abandon_contract') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyBrAbandonContract(room.sim, ws.id);
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
  // v3 perk-träd: köp av en träd-nod ({ node:'jug_hp' }) → applyCastleDefensePerkBuy.
  if (msg.type === 'sim_cd_perk_buy') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefensePerkBuy(room.sim, ws.id, msg);
    return;
  }
  // v2 REDESIGN: port öppna/stäng, slot-torn sätt-dig/kliv-av, slotts-NPC-uppgrade
  if (msg.type === 'sim_cd_gate') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseGate(room.sim, ws.id, msg);
    return;
  }
  // v3 perk-ABILITY: warhorn war-roar (AoE knockback + stagger + slow)
  if (msg.type === 'sim_cd_ability') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseAbility(room.sim, ws.id);
    return;
  }
  if (msg.type === 'sim_cd_enter_tower') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseEnterTower(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_exit_tower') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseExitTower(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_npc_upgrade') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseNpcUpgrade(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_buy_weapon') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    applyCastleDefenseBuyWeapon(room.sim, ws.id, msg);
    return;
  }
  if (msg.type === 'sim_cd_ping') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    // v1.660: ping tillÃ¥ts i ALLA co-op-lÃ¤gen (var bara castledefense). Co-op =
    // ingen PvP-mode aktiv (i PvP skulle ping lÃ¤cka info till motstÃ¥ndarlaget).
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
  // v1.620: HEIST actions â€” bag loot, start drill (alarm trigger), hack terminal
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
      // v1.625/v1.646: tier-baserad gate. 'outer' krÃ¤ver outer-drill,
      // 'inner' krÃ¤ver BÃ…DE outer- och inner-drill. Ã–vrig loot (cash_drawer,
      // manager_safe, laptop, locker, tip_jar, storage box) Ã¤r stealth-accessible
      // i alla phases (stealth â†’ instant alarm-trigger).
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
      // har LOS + Ã¤r inom 200px av loot-positionen (kassÃ¶r/manager ser dig).
      // Tidigare: alarm trigger oavsett (Ã¤ven om alla cashiers var dÃ¶da/borta).
      // Bortre civilians och de i panic/hostage/calmed-state rÃ¤knas inte.
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
          // LOS-check: vÃ¤gg mellan civilian och loot = de ser ej
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
      // v1.621: Bag â†’ carry-weight pÃ¥ spelaren (sÃ¤kras vid extract-van)
      // v1.624: AnvÃ¤nd faktisk loot.weight per typ (0.05-0.40) istÃ¤llet fÃ¶r flat 0.10
      sim.heistLootBagged[lootId] = true;
      ws._heistBagsCarrying = (ws._heistBagsCarrying || 0) + 1;
      ws._heistBagsValue = (ws._heistBagsValue || 0) + (loot.value || 0);
      ws._heistBagsWeight = (ws._heistBagsWeight || 0) + (loot.weight || 0.10);
      // SpeedMul baseras pÃ¥ summan av loot.weight (gold = 0.40, cash drawer = 0.05)
      // Cap vid 0.4 (60% slow) sÃ¥ player aldrig fastnar helt
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
      // v1.652: Drop nu EN sÃ¤ck per tap istÃ¤llet fÃ¶r ALLA. Spelaren kan
      // koordinera bag-distribution mellan partners utan att tappa allt.
      // Legacy 'drop_bags' aliasas till samma som 'drop_one_bag' sÃ¥ ingen
      // klient bryter. (Den gamla "drop all"-funktionen var fÃ¶r aggressiv â€”
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
      // v1.652: Tank-only â€” kasta object fÃ¶r att distrahera vakt.
      // Vakt vÃ¤nder bort frÃ¥n player + stÃ¥r still i 5s. Cooldown 30s.
      if (ws._heistRole !== 'tank') return;
      if (sim.heistPhase !== 'stealth') return;
      const now = Date.now();
      if ((ws._heistDistractCdUntil || 0) > now) return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'guard' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 150 * 150) return; // 150px range (Tank kan kasta lÃ¥ngt)
      // Distract: face bort frÃ¥n player, frys patrol 5s
      npc.facing = Math.atan2(-dy, -dx);
      npc._distractedUntil = now + 5000;
      npc.state = 'distracted'; // klient renderar â“ + grÃ¥ cone
      npc._patrolPauseUntil = now + 5000; // pause patrol-movement
      ws._heistDistractCdUntil = now + 30000;
      sim.eventQueue.push({
        type: 'heist_guard_distracted',
        guardId: npcId, by: ws.id, durationMs: 5000,
      });
    } else if (action === 'calm_civilian') {
      // v1.652: Medic-only â€” lugna civilian â†’ ingen panic pÃ¥ 15s.
      // KrÃ¤ver nÃ¤rhet (60px). Cooldown 20s. Fungerar i stealth.
      if (ws._heistRole !== 'medic') return;
      if (sim.heistPhase !== 'stealth') return;
      const now = Date.now();
      if ((ws._heistCalmCdUntil || 0) > now) return;
      const npcId = String(msg.npcId || '');
      const npc = (sim.heistNPCs || []).find(n => n.id === npcId && n.type === 'civilian' && !n.dead);
      if (!npc) return;
      const dx = ps.x - npc.x, dy = ps.y - npc.y;
      if (dx * dx + dy * dy > 60 * 60) return;
      // Calm: civilian till "calmed"-state. Ingen panic-trigger pÃ¥ 15s, Ã¤ven
      // om de ser vapen. Bryts om Medic dÃ¶r eller faserna Ã¤ndras.
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
        // Phase-byte sker i nÃ¤sta tick
      }
    } else if (action === 'intimidate_civilian') {
      // v1.623: Hostage-system â€” make civilian a hostage (no panic, no alarm-trigger)
      // KrÃ¤ver: nÃ¤ra civilian (60px), vapen = 'fists' (NO weapon drawn)
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
      // v1.623: Plocka upp nÃ¤rmaste dropped bag (50px range)
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
      // v1.624: anvÃ¤nd genomsnitts-weight (vi vet inte ursprungs-loot.kind), default 0.15
      ws._heistBagsWeight = (ws._heistBagsWeight || 0) + 0.15;
      ps.speedMul = Math.max(0.4, 1 - ws._heistBagsWeight);
      sim.eventQueue.push({
        type: 'heist_bag_picked',
        peerId: ws.id, bagId: bag.id, value: bag.value,
        bagsCarrying: ws._heistBagsCarrying, bagsValue: ws._heistBagsValue,
      });
    } else if (action === 'lockpick_door') {
      // v1.623/v1.647: Lockpicking. Two-tap legacy + server-tick auto-complete
      // (samma pattern som hack-terminal i v1.645). Player tappar EN gÃ¥ng,
      // server completar nÃ¤r finishesAt nÃ¥dd (i tickHeist) sÃ¥ lÃ¤nge spelaren
      // stÃ¥r kvar inom 60px.
      const doorId = String(msg.doorId || 'back');
      const door = HEIST_ARENA.doors.find(d => d.id === doorId);
      if (!door || !door.lockpickable) return;
      sim.heistUnlockedDoors = sim.heistUnlockedDoors || {};
      if (sim.heistUnlockedDoors[doorId]) return;
      // Range-check (60px frÃ¥n door-center)
      const dcx = door.x + door.w / 2, dcy = door.y + door.h / 2;
      const dx = ps.x - dcx, dy = ps.y - dcy;
      if (dx * dx + dy * dy > 60 * 60) return;
      // Lockpick-tid: 6s normal, 3s fÃ¶r Rogue
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
      // v1.626: Hostage-trade â€” slÃ¤pp hostage civilian â†’ cease-fire frÃ¥n polisen
      // v1.650: Diminishing returns. Tidigare: 10s stackat oÃ¤ndligt (15 hostages
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
        // Helt cappad â€” slÃ¤pp hostage utan reward (markerar dock som released)
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
      // Hostage springer ivÃ¤g
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
      // v1.623: Rogue-only silent-melee mot guard â€” ingen alarm, guard dÃ¶r
      if (ws._heistRole !== 'rogue') return;
      if (sim.heistPhase !== 'stealth') return;
      // Melee-vapen krÃ¤vs (fists/knife/melee-types)
      const meleeWeapons = ['fists', 'knife', 'katana'];
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
      // Two-tap pattern: fÃ¶rsta tappet startar timer, vidare tap completes vid finish.
      // Hacker-role: -50% hack-tid. Range-check pÃ¥ varje tap sÃ¥ player mÃ¥ste stanna.
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
      // v1.642: In-game role-pick. TillÃ¥tet en gÃ¥ng per match. Stealth-fas
      // krÃ¤vs sÃ¥ fÃ¶rdelar inte kan bytas mitt under intense extract-fight.
      // v1.654: UNIQUE-roll-validation. Varje roll fÃ¥r bara vÃ¤ljas av EN
      // spelare per match. Om nÃ¥gon annan redan har rollen â†’ reject + emit
      // 'heist_role_taken' sÃ¥ klient kan visa toast.
      if (ws._heistRoleLocked) return;
      if (sim.heistPhase !== 'stealth') return;
      const role = String(msg.role || 'hacker');
      const validRoles = ['hacker', 'tank', 'medic', 'rogue'];
      if (validRoles.indexOf(role) < 0) return;
      // Unique-check: bara LOCKED peers blockar rollen (en peer som har
      // 'hacker' som default men inte locked Ã¤nnu rÃ¤knas som "available").
      sim.heistRoles = sim.heistRoles || {};
      const room = rooms.get(ws.roomCode);
      if (room && room.sim && room.sim.room && room.sim.room.members) {
        for (const [otherPid, otherWs] of room.sim.room.members) {
          if (otherPid === ws.id) continue;
          if (!otherWs._heistRoleLocked) continue; // ej lÃ¥st â†’ rÃ¤knas inte
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
  // v1.607: SURVIVORS shop-buy â€” validera + dra gold + ge weapon
  if (msg.type === 'sim_survivors_buy') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    const sim = room.sim;
    if (!sim.survivorsActive) return;
    const wid = String(msg.weaponId || '');
    // C99: slå upp priset SERVER-SIDE per weaponId — ignorera msg.cost helt.
    // Okänt/icke-shop-vapen avvisas (anti-cheat: kunde annars köpas gratis).
    if (!Object.prototype.hasOwnProperty.call(SURVIVORS_SHOP_PRICES, wid)) return;
    const cost = SURVIVORS_SHOP_PRICES[wid];
    const gold = sim.castledefenseGold[ws.id] || 0;
    if (gold < cost) return; // not enough gold (silent â€” klient visar UI-error)
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
    // Dev-cheat: DEV-KONTO (86743226) får alltid igenom (funkar i prod utan env),
    // annars krävs ALLOW_CHEATS-env. applyCastleDefenseInfMoney dubbel-gatar på dev-konto.
    if (!process.env.ALLOW_CHEATS && !isDevAccount(ws)) return;
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    if (room.hostId !== ws.id) return;
    applyCastleDefenseInfMoney(room.sim, ws.id, msg);
    return;
  }
  // v1.537: STRESS-TEST spawn-handler (klient klickar +20 ENEMIES etc)
  if (msg.type === 'sim_stresstest') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim || !room.sim.stresstestActive) return;
    // v2 #59 (additivt): `what`-varianten â€” host-only spawn av n enemies/kulor.
    // V1-webben skickar bara `action` (grenen nedan) â†’ helt opÃ¥verkad.
    if (msg.what === 'enemies' || msg.what === 'bullets' || msg.what === 'showcase') {
      if (room.hostId !== ws.id) return;  // bara host
      const sim = room.sim;
      const ws2 = sim.room.members.get(ws.id);
      if (!ws2 || !ws2.playerState) return;
      const px = ws2.playerState.x, py = ws2.playerState.y;
      if (msg.what === 'showcase') {
        // v2 R10b (additivt): SHOWROOM â€” en av varje enemy-typ + miniboss-power +
        // boss i frusna rader nedanfÃ¶r hosten (V1-paritet: spawnEnemyShowcase).
        const { applyStresstestShowcase } = require('./sim/room-sim');
        applyStresstestShowcase(sim, px, py);
        return;
      }
      if (msg.what === 'enemies') {
        const n = Math.max(1, Math.min(100, Math.round(+msg.n) || 20));
        const { makeEnemy } = require('./sim/enemies');
        const types = ['grunt', 'runner', 'brute'];
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const dist = 400 + Math.random() * 300;
          const t = types[Math.floor(Math.random() * types.length)];
          const e = makeEnemy(t, px + Math.cos(a) * dist, py + Math.sin(a) * dist);
          e._idx = sim.nextEnemyIdx++;
          sim.enemies.push(e);
        }
      } else {
        const n = Math.max(1, Math.min(200, Math.round(+msg.n) || 50));
        // v2 R10a: V1-PARITET (game.js spawnStresstestBullets) â€” jÃ¤mn radiell
        // solfjÃ¤der UTÃ…T frÃ¥n avsÃ¤ndaren, gula, ofarliga (dmg 0; M4-guarden gÃ¶r
        // dem Ã¤ndÃ¥ ofarliga i stresstest). FÃ¶rr: rÃ¶da kulor INÃ…T mot spelaren =
        // sÃ¥g ut som ett bakhÃ¥ll, inte som "+50 BULLETS". hostile:true behÃ¥lls
        // fÃ¶r hb-syncen (icke-hostile kulor skickas aldrig till klienter).
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          sim.bullets.push({
            x: px + Math.cos(a) * 30, y: py + Math.sin(a) * 30,
            vx: Math.cos(a) * 400, vy: Math.sin(a) * 400,
            dmg: 0, life: 2, r: 4, color: '#ffeb3b', hostile: true,
          });
        }
      }
      return;
    }
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
  // v1.376: Granat-throw frÃ¥n klient. Server schemalÃ¤gger detonation efter
  // flight-time och kÃ¶r explode() (med friendly-fire-regler + turret-damage).
  // v1.381: server pushar grenade_thrown till eventQueue â†’ broadcastas till
  // alla peers sÃ¥ de ser projektilen + explosion-VFX (tidigare sÃ¥g motstÃ¥ndare
  // bara HP-droppet, ingen visuell granat).
  if (msg.type === 'sim_grenade_throw') {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.sim) return;
    const sim = room.sim;
    // BUGFIX: en DÖD/nere/spectator-spelare ska INTE kunna kasta granat. Klienten gate:ade
    // skott (applyShoot: hp/brDowned/cdDowned) men granat-inputen var öppen → server-enforce
    // här (samma dödstillstånd som blockerar skott).
    const gps = ws.playerState;
    if (!gps || gps.hp <= 0 || gps.brDowned || gps.cdDowned || gps.spectating) return;
    if (gps.brAir) return; // BATTLE BUS / SKYDIVE: ingen granat på bussen/i luften
    const fromX = Math.max(0, Math.min(20000, +msg.fromX || 0));
    const fromY = Math.max(0, Math.min(20000, +msg.fromY || 0));
    const toX = Math.max(0, Math.min(20000, +msg.toX || 0));
    const toY = Math.max(0, Math.min(20000, +msg.toY || 0));
    // flightMs styrs av klienten (skalas med kast-distans, TDM dubbel rÃ¤ckvidd) â€”
    // klampa till sant intervall sÃ¥ explosion-timing + peer-broadcast matchar thrower.
    const FLIGHT_MS = Math.max(200, Math.min(3000, +msg.flightMs || 800));
    const RADIUS = 85;
    const DMG = 120;
    // V2: 5 granat-typer. CC (bländ/gravity) + area-denial (molotov) bor ENBART här.
    const VALID = ['frag', 'smoke', 'flashbang', 'molotov', 'gravity'];
    const kind = VALID.indexOf(msg.kind) >= 0 ? msg.kind : 'frag';
    const RADIUS_BY = { frag: 85, smoke: 130, flashbang: 160, molotov: 110, gravity: 140 };
    const DUR_BY = { frag: 0, smoke: 5000, flashbang: 2200, molotov: 5000, gravity: 2600 };
    const radius = RADIUS_BY[kind] || 85;
    // Broadcast till alla klienter (inkl thrower — dedupar via ownerPid). Klienten ritar
    // effekten deterministiskt ur eventet (rök/eld/gravity); skada/CC är server-auth.
    sim.eventQueue.push({
      type: 'grenade_thrown',
      ownerPid: ws.id,
      fromX, fromY, toX, toY,
      flightMs: FLIGHT_MS,
      radius, kind,
      durationMs: DUR_BY[kind] || 0,
    });
    // Effekt vid nedslag (efter flightMs). Rök = bara visuell.
    if (kind !== 'smoke') {
      setTimeout(() => {
        if (!sim || sim._stopped) return;
        if (kind === 'frag') {
          const { explode } = require('./sim/bullets');
          if (typeof explode === 'function') explode(sim, toX, toY, RADIUS, DMG, ws.id, 'grenade');
        } else {
          const g = require('./sim/grenades');
          if (kind === 'flashbang') g.applyFlashbang(sim, toX, toY, radius, ws.id);
          else if (kind === 'molotov') g.applyMolotov(sim, toX, toY, radius, ws.id);
          else if (kind === 'gravity') g.applyGravity(sim, toX, toY, radius, ws.id);
        }
      }, FLIGHT_MS);
    }
    return;
  }
}

// #wifi (2026-06-28): nar SISTA manniskan tappar kopplingen mid-match (t.ex. wifi-blipp)
// slangde servern HELA rummet -> reconnect-stashen (som ligger PA rummet) slangdes med ->
// auto-rejoin ett par sekunder senare mottes av "Rummet finns inte" -> hard menu-kick. Hall
// istallet rummet + stashen vid liv en bounded stund sa rejoin kan aterstalla somlost.
const HUMANLESS_ROOM_GRACE_MS = 60000;
function roomHasLiveReconnectStash(room) {
  if (!room || !room._reconnectStash) return false;
  const now = Date.now();
  for (const k in room._reconnectStash) {
    const s = room._reconnectStash[k];
    if (s && (now - (s.ts || 0)) < RECONNECT_STASH_TTL_MS) return true;
  }
  return false;
}
function scheduleHumanlessRoomCleanup(room) {
  if (!room || room._humanlessTimer) return;
  room._humanlessTimer = setTimeout(() => {
    room._humanlessTimer = null;
    if (!rooms.has(room.code)) return;
    let real = 0;
    for (const [, m] of room.members) { if (!m._isBot) real++; }
    if (real === 0) {
      if (room.sim) stopSim(room.sim);
      rooms.delete(room.code);
      broadcastPublicRooms();
      console.log('[ROOM]', room.code, 'closed (humanless reconnect-grace expired)');
    }
  }, HUMANLESS_ROOM_GRACE_MS);
}

function handleDisconnect(ws) {
  // v2 konto: offline/presence-push till vÃ¤nner (no-op utan acct_login).
  // Skiljer sjÃ¤lv pÃ¥ riktig disconnect vs 'leave'/kick via ws.readyState.
  accounts.onDisconnect(ws);
  // v2 matchmaking: städa ur kö + ev. accept-fas (no-op om ej i kö). MÅSTE köras
  // FÖRE roomCode-early-return — köande spelare har inget rum.
  matchmaker.leave(ws);
  groups.leave(ws);   // v2 matchmaking: lämna ev. grupp (no-op om ej i grupp)
  // Rensa public-rooms-prenumeration
  publicRoomSubscribers.delete(ws);
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  // SPECTATE: en spectator var aldrig spelare → ingen reconnect-stash, ingen slot-retur,
  // inga peer_left-notiser, ingen BR-alivecount-justering. Ta bara bort ur rummet.
  if (ws.isSpectator) {
    room.members.delete(ws.id);
    broadcastPublicRooms();
    return;
  }
  // v1.659: stasha server-side-only-state fÃ¶r ev. reconnect (Heist-roll + hp/shield)
  // innan vi rensar. Bara under aktiv sim + om klienten har en reconnect-token.
  // Stashen lever i rummet (rensas nÃ¤r rummet stÃ¤ngs) och utgÃ¥r efter 60s vid restore.
  if (room.sim && ws._reconnectToken) {
    room._reconnectStash = room._reconnectStash || {};
    const ps = ws.playerState || {};
    room._reconnectStash[ws._reconnectToken] = {
      heistRole: ws._heistRole, heistRoleLocked: ws._heistRoleLocked,
      hp: ps.hp, maxHp: ps.maxHp, shield: ps.shield, speedMul: ps.speedMul,
      pid: ws.id, weaponId: ps.weaponId,   // CD: aterstall identitet + vapen vid reconnect (terminerad ghost)
      pstate: ws.playerState,   // #wifi: HELA playerState (x/y/aim/maxShield...) sa HOST (utan ghost)
                                // ateransluter DAR den DC:ade + behaller exakt state, ej (0,0)+startvapen
      brCash: (room.sim.brCash && room.sim.brCash[ws.id]) || 0,
      brKills: (room.sim.battleroyaleKillsByPid && room.sim.battleroyaleKillsByPid[ws.id]) || 0,
      brDeaths: (room.sim.tdmDeathsByPid && room.sim.tdmDeathsByPid[ws.id]) || 0,
      brOwnedWeapons: (ws._brOwnedWeapons instanceof Set) ? Array.from(ws._brOwnedWeapons) : null,
      ts: Date.now(),
    };
  }
  // Returnera stable-slot till den lediga poolen sÃ¥ nÃ¤sta peer som joinar
  // kan Ã¥teranvÃ¤nda det lÃ¤gsta lediga slot-numret. Host (slot 0) returneras
  // INTE â€” slot 0 Ã¤r alltid hosten, host-migration uppdaterar bara hostId.
  if (ws.stableSlot != null && ws.stableSlot !== 0 && room._freeSlots) {
    room._freeSlots.push(ws.stableSlot);
  }
  room.members.delete(ws.id);
  if (room.hostId === ws.id) {
    // v1.658: HOST MIGRATION â€” migrera vÃ¤rdskapet till en annan nÃ¤rvarande human
    // istÃ¤llet fÃ¶r att dÃ¶da rummet. En host som tappar signalen ska inte avsluta
    // allas match. Sim:n kÃ¶rs server-side oberoende av hostId (hostId styr bara
    // host-only-kommandon sim_stop/sim_load_stage + peer_joined-notiser), sÃ¥ att
    // byta hostId mitt i match Ã¤r sÃ¤kert â€” sim:n fortsÃ¤tter oavbrutet.
    let newHost = null;
    for (const [, m] of room.members) { if (!m._isBot && !m.isSpectator) { newHost = m; break; } }
    if (newHost) {
      room.hostId = newHost.id;
      if (room.meta) room.meta.hostName = newHost.playerName || room.meta.hostName;
      // Rensa lÃ¤mnande host:s per-pid sim-state (samma som vanlig-peer-grenen).
      if (room.sim) {
        const _s = room.sim, _pid = ws.id;
        if (_s.deadBodies) delete _s.deadBodies[_pid];
        if (_s.kothScores) delete _s.kothScores[_pid];
        if (_s._kothPointAccum) delete _s._kothPointAccum[_pid];
        if (_s.juggernautScores) delete _s.juggernautScores[_pid];
        // C170: rensa ÄVEN JUG-kill/dmg-trackers (ghost-dedupe-pathen 401 gör det
        // redan, men disconnect-grenarna missade dem → spöke i JUG-leaderboard).
        if (_s.juggernautKillsByPid) delete _s.juggernautKillsByPid[_pid];
        if (_s.juggernautDmgToJug) delete _s.juggernautDmgToJug[_pid];
        if (_s.battleroyaleKillsByPid) delete _s.battleroyaleKillsByPid[_pid];
        if (_s.tdmDeathsByPid) delete _s.tdmDeathsByPid[_pid];
        // v1.698: dekrementera aliveCount om en LEVANDE BR-spelare lÃ¤mnar â€” annars
        // triggas last_alive-win aldrig (matchen hÃ¤nger till 30s-fallbacken).
        if (_s.battleroyaleActive && _s.battleroyaleEliminated && !_s.battleroyaleEliminated.includes(_pid)) {
          // #br-30s: elimera INTE direkt — ge 30s reconnect-fonster (svep i tickBattleRoyale) om token finns.
          if (ws._reconnectToken) { _s._brPendingElim = _s._brPendingElim || {}; _s._brPendingElim[_pid] = Date.now(); }
          else { _s.battleroyaleEliminated.push(_pid); if (typeof _s.battleroyaleAliveCount === 'number') _s.battleroyaleAliveCount = Math.max(0, _s.battleroyaleAliveCount - 1); }
        }
        // C229: Om host var JUG, transferera direkt till en levande human (ej vänta på respawn).
        if (_s.juggernautActive && _s.juggernautPid === ws.id) {
          const _nextJug = pickRandomHumanHunter(_s, ws.id);
          if (_nextJug) {
            transferJug(_s, _nextJug, 'jug_host_migrated');
          } else {
            _s.juggernautPid = null;
            _s._juggernautAwaitFirstRespawn = true;
            _s.eventQueue.push({ type: 'juggernaut_jug_changed', newJug: null, oldJug: ws.id, reason: 'jug_disconnected', weapon: _s.juggernautWeapon, jugHp: _s.juggernautHpMax });
          }
        }
      }
      for (const [, m] of room.members) {
        if (m._isBot) continue;
        send(m, { type: 'host_migrated', newHostId: newHost.id, peerLeft: ws.id });
      }
      console.log('[ROOM]', room.code, 'host migrated', ws.id, 'â†’', newHost.id, '(', room.members.size, 'members)');
      broadcastPublicRooms();
      return;
    }
    // Ingen human kvar â€” stÃ¤ng rummet (befintligt beteende).
    // #wifi: sista manniskan (host) tappade kopplingen — har den en farsk reconnect-stash,
    // hall rummet + sim:en vid liv for grace-fonstret sa auto-rejoin kan aterstalla.
    if (roomHasLiveReconnectStash(room)) {
      console.log('[ROOM]', room.code, 'host-drop — haller rummet for reconnect-grace');
      scheduleHumanlessRoomCleanup(room);
      broadcastPublicRooms();
      return;
    }
    console.log('[ROOM]', room.code, 'closed (host left, no members)');
    if (room.sim) stopSim(room.sim);
    for (const m of room.members.values()) {
      send(m, { type: 'host_left' });
      try { m.close(); } catch (e) {}
    }
    rooms.delete(room.code);
  } else {
    // Vanlig peer lÃ¤mnade â€” meddela host
    const host = room.members.get(room.hostId);
    if (host) send(host, { type: 'peer_left', peerId: ws.id });
    // SLUTAUDIT 2 #12: peer_left gick bara till hosten â†’ icke-host-Godot-klienter
    // ackumulerade spÃ¶k-peers i roster/minimap. Spegla K2-mÃ¶nstret (peer_joined):
    // skicka Ã¤ven till alla _jsonWorld-peers (ej hosten â€” den fick sitt ovan).
    // V1-webbens icke-hosts Ã¤r aldrig _jsonWorld â†’ V1 opÃ¥verkad.
    for (const [_plPid, _plM] of room.members) {
      if (_plPid === room.hostId) continue;
      if (_plM._jsonWorld) send(_plM, { type: 'peer_left', peerId: ws.id });
    }
    console.log('[ROOM]', room.code, ws.id, 'left (', room.members.size, 'members)');
    // v1.657: rensa per-pid sim-state fÃ¶r den lÃ¤mnande peer:n sÃ¥ stale pids inte
    // hÃ¤nger kvar â€” annars spÃ¶k-spelare i leaderboards (koth/jug/BR) + onÃ¶dig
    // deadBodies-iteration matchen ut. Defensivt guardat (no-op om saknas).
    if (room.sim) {
      const _s = room.sim, _pid = ws.id;
      if (_s.deadBodies) delete _s.deadBodies[_pid];
      if (_s.kothScores) delete _s.kothScores[_pid];
      if (_s._kothPointAccum) delete _s._kothPointAccum[_pid];
      if (_s.juggernautScores) delete _s.juggernautScores[_pid];
      // C170: rensa ÄVEN JUG-kill/dmg-trackers (annars spöke i JUG-leaderboard).
      if (_s.juggernautKillsByPid) delete _s.juggernautKillsByPid[_pid];
      if (_s.juggernautDmgToJug) delete _s.juggernautDmgToJug[_pid];
      if (_s.battleroyaleKillsByPid) delete _s.battleroyaleKillsByPid[_pid];
      if (_s.tdmDeathsByPid) delete _s.tdmDeathsByPid[_pid];
      // v1.698: dekrementera aliveCount om en LEVANDE BR-spelare lÃ¤mnar â€” annars
      // triggas last_alive-win aldrig (matchen hÃ¤nger till 30s-fallbacken).
      if (_s.battleroyaleActive && _s.battleroyaleEliminated && !_s.battleroyaleEliminated.includes(_pid)) {
        // #br-30s: ge 30s reconnect-fonster fore elimination (svep i tickBattleRoyale) om token finns.
        if (ws._reconnectToken) { _s._brPendingElim = _s._brPendingElim || {}; _s._brPendingElim[_pid] = Date.now(); }
        else { _s.battleroyaleEliminated.push(_pid); if (typeof _s.battleroyaleAliveCount === 'number') _s.battleroyaleAliveCount = Math.max(0, _s.battleroyaleAliveCount - 1); }
      }
    }
    // C229: JUGGERNAUT — om JUG disconnectade, transferera direkt till en levande
    // human i st.f. att vänta på att en hunter respawnar (matchen staller annars).
    if (room.sim && room.sim.juggernautActive && room.sim.juggernautPid === ws.id) {
      const _nextJug = pickRandomHumanHunter(room.sim, ws.id);
      if (_nextJug) {
        transferJug(room.sim, _nextJug, 'jug_disconnected');
      } else {
        room.sim.juggernautPid = null;
        room.sim._juggernautAwaitFirstRespawn = true;
        room.sim.eventQueue.push({
          type: 'juggernaut_jug_changed',
          newJug: null, oldJug: ws.id, reason: 'jug_disconnected',
          weapon: room.sim.juggernautWeapon, jugHp: room.sim.juggernautHpMax,
        });
      }
    }
    // KRITISKT: rÃ¤kna inte bots i tom-rum-check, annars lever sim:en vidare med
    // bara bot-ws kvar (rum-lÃ¤cka, evig bot-AI-tick).
    let realCount = 0;
    for (const [, m] of room.members) { if (!m._isBot) realCount++; }
    if (realCount === 0) {
      // #wifi: behall rummet + stashen om sista manniskan just tappade kopplingen (rejoin-grace)
      if (roomHasLiveReconnectStash(room)) {
        scheduleHumanlessRoomCleanup(room);
      } else {
        if (room.sim) stopSim(room.sim);
        rooms.delete(room.code);
      }
    }
  }
  broadcastPublicRooms();
}

// v2 matchmaking: ge matchmakern serverns helpers (send/rooms/sim/kod-generator)
// AUDIT C312: matchmakern behöver presenceChanged + broadcastPublicRooms för att
// vänner ska se matchmade spelare som 'i match' (ej fast i 'lobby' med stale kod).
matchmaker.setHelpers({ send, rooms, createSim, startSim, generateCode, presenceChanged: accounts.presenceChanged, broadcastPublicRooms });
groups.setHelpers({ send, wsForAccount: accounts.wsForAccount, isBlocked: accounts.isBlockedPair }); // B2: droppa grupp-invites blockad→blockerare

server.listen(PORT, () => {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  THE PENETRATOR â€” Co-op Server v1');
  console.log('  Listening on port ' + PORT);
  // UDP-transport bredvid WS (V2). Samma portnummer, separat socket-namespace.
  attachUdp({
    handleMessage, handleDisconnect, genId,
    port: parseInt(process.env.UDP_PORT || PORT, 10),
    rttIntervalMs: RTT_PING_INTERVAL_MS,
  });
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
});
