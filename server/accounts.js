// WarParty — konto-/vänsystem (v2, additivt). Alla meddelanden går över den
// befintliga WS-anslutningen som JSON med type-prefix "acct_". V1-webben
// skickar aldrig acct_* → hela modulen är död kod för V1-klienter.
//
// Modell: ID är identiteten (8-siffrigt numeriskt, dubblettnamn TILLÅTNA).
// Secret = klient-genererad slumpsträng ≥16 tecken, lagras plaintext
// (spelkonto, inga lösenord). Render har flyktig disk → klienten är den
// durabla källan: friends-listan i acct_login ERSÄTTER serverns lista
// (resync-modellen), och okänt id vid login återskapar kontot.
'use strict';

const fs = require('fs');
const path = require('path');

// ── Persistens ───────────────────────────────────────────────────────────────
// ACCOUNTS_DATA_DIR-override gör att prober kan peka mot temp-katalog.
const DATA_DIR = process.env.ACCOUNTS_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

const FRIENDS_CAP = 100;
const REQUESTS_CAP = 50;
const UPDATE_THROTTLE_MS = 1000; // max 1 friends_update/s per mottagare

const accounts = new Map(); // id → { id, secret, name, avatar, stats, level, friends:[], reqIn:[], reqOut:[], lastSeen }
const online = new Map();   // id → ws (senaste socket vinner)

let H = null;               // helpers från server.js: { send, roomInfo }
let _saveTimer = null;
let _dirty = false;

function computeLevel(stats) {
  const m = (stats && +stats.matches) || 0;
  return Math.min(99, 1 + Math.floor(Math.sqrt(Math.max(0, m))));
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, 16);
  if (name.length < 2) return null;
  return name;
}

function sanitizeStats(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v) => Math.max(0, Math.min(99999999, Math.round(+v) || 0));
  return { matches: n(raw.matches), kills: n(raw.kills), wins: n(raw.wins) };
}

function sanitizeFriendIds(raw, selfId) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    const id = String(v || '').trim();
    if (!/^[0-9]{1,16}$/.test(id)) continue;
    if (id === selfId) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= FRIENDS_CAP) break;
  }
  return out;
}

function genAccountId() {
  // 8-siffrigt numeriskt ID som sträng, unikt bland kända konton
  let id;
  do {
    id = String(10000000 + Math.floor(Math.random() * 90000000));
  } while (accounts.has(id));
  return id;
}

function arrRemove(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

// ── Load / save (debounce:ad 3s + flush vid SIGTERM) ─────────────────────────
function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!raw || !Array.isArray(raw.accounts)) return;
    for (const a of raw.accounts) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string' || typeof a.secret !== 'string') continue;
      accounts.set(a.id, {
        id: a.id,
        secret: a.secret,
        name: sanitizeName(a.name) || 'Spelare',
        avatar: (a.avatar && typeof a.avatar === 'object') ? a.avatar : {},
        stats: sanitizeStats(a.stats) || { matches: 0, kills: 0, wins: 0 },
        level: 1,
        friends: sanitizeFriendIds(a.friends, a.id),
        reqIn: sanitizeFriendIds(a.reqIn, a.id).slice(0, REQUESTS_CAP),
        reqOut: sanitizeFriendIds(a.reqOut, a.id).slice(0, REQUESTS_CAP),
        lastSeen: +a.lastSeen || 0,
      });
      const acc = accounts.get(a.id);
      acc.level = computeLevel(acc.stats);
    }
    console.log('[ACCT] laddade', accounts.size, 'konton från', DATA_FILE);
  } catch (e) {
    console.warn('[ACCT] kunde inte läsa', DATA_FILE, '—', e.message);
  }
}

function saveNow() {
  _dirty = false;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [...accounts.values()] }));
  } catch (e) {
    console.warn('[ACCT] save misslyckades —', e.message);
  }
}

function markDirty() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; if (_dirty) saveNow(); }, 3000);
}

process.on('SIGTERM', () => {
  try { if (_dirty) saveNow(); } catch (e) {}
  process.exit(0);
});

load();

// ── Presence / friends_update ────────────────────────────────────────────────
function activityOf(ws) {
  // ingen roomCode → meny; rum + ej startad sim → lobby; startad → match
  const ri = H && H.roomInfo ? H.roomInfo(ws) : null;
  if (!ri) return { activity: 'meny' };
  return { activity: ri.started ? 'match' : 'lobby', mode: ri.mode, code: ri.code };
}

function buildFriendEntry(fid) {
  const a = accounts.get(fid);
  if (!a) return null;
  const entry = { id: a.id, name: a.name, avatar: a.avatar, level: a.level, online: online.has(fid) };
  if (entry.online) {
    const act = activityOf(online.get(fid));
    entry.activity = act.activity;
    if (act.mode) entry.mode = act.mode;
    // code skickas BARA när vännen är i ett rum (GÅ MED-knappen)
    if (act.code) entry.code = act.code;
  }
  return entry;
}

function buildFriendsList(acc) {
  const out = [];
  for (const fid of acc.friends) {
    const e = buildFriendEntry(fid);
    if (e) out.push(e);
  }
  return out;
}

const _updState = new Map(); // mottagar-id → { lastAt, timer }

function sendFriendsUpdate(id) {
  const ws = online.get(id);
  const acc = accounts.get(id);
  if (!ws || !acc) return;
  const st = _updState.get(id) || { lastAt: 0, timer: null };
  st.lastAt = Date.now();
  _updState.set(id, st);
  H.send(ws, { type: 'acct_friends_update', friends: buildFriendsList(acc) });
}

// Throttle:ad push (max 1/s per mottagare). Alltid deferred (setTimeout) så
// rums-state hunnit uppdateras när listan byggs (onDisconnect körs FÖRE
// members.delete i handleDisconnect).
function scheduleFriendsUpdate(id) {
  if (!online.has(id)) return;
  let st = _updState.get(id);
  if (!st) { st = { lastAt: 0, timer: null }; _updState.set(id, st); }
  if (st.timer) return; // redan schemalagd → coalesce
  const wait = Math.max(0, st.lastAt + UPDATE_THROTTLE_MS - Date.now());
  st.timer = setTimeout(() => {
    st.timer = null;
    sendFriendsUpdate(id);
  }, wait);
}

// Notifiera alla online-vänner till kontot `id` att dess presence ändrats
function notifyFriendsOf(id) {
  const acc = accounts.get(id);
  if (!acc) return;
  for (const fid of acc.friends) {
    if (online.has(fid)) scheduleFriendsUpdate(fid);
  }
}

// ── Publika hooks (anropas från server.js) ───────────────────────────────────
// Presence-ändring (rum-join/leave/sim_start/sim_stop). No-op för ws utan konto.
function presenceChanged(ws) {
  if (!ws || !ws.accountId) return;
  if (online.get(ws.accountId) !== ws) return;
  notifyFriendsOf(ws.accountId);
}

// Disconnect-hook. Anropas i toppen av handleDisconnect — som även körs vid
// 'leave'/kick där socketen lever kvar (readyState OPEN=1) → då bara
// presence-ändring (→ meny), inte offline.
function onDisconnect(ws) {
  if (!ws || !ws.accountId) return;
  const id = ws.accountId;
  if (online.get(id) !== ws) return;
  if (ws.readyState === 1) {
    // 'leave'/kick — fortfarande inloggad, bara rums-presence som ändras
    notifyFriendsOf(id);
    return;
  }
  online.delete(id);
  const st = _updState.get(id);
  if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
  const acc = accounts.get(id);
  if (acc) { acc.lastSeen = Date.now(); markDirty(); }
  notifyFriendsOf(id);
}

// ── Handlers ─────────────────────────────────────────────────────────────────
function sendErr(ws, code) { H.send(ws, { type: 'acct_error', code }); }
function sendOk(ws, what) { H.send(ws, { type: 'acct_ok', what }); }

function getMe(ws) {
  if (!ws.accountId) return null;
  if (online.get(ws.accountId) !== ws) return null; // gammal socket bortkopplad
  return accounts.get(ws.accountId) || null;
}

function handleLogin(ws, msg) {
  const secret = typeof msg.secret === 'string' ? msg.secret.slice(0, 128) : '';
  if (secret.length < 16) { sendErr(ws, 'auth'); return; }
  let id = typeof msg.id === 'string' ? msg.id.trim() : '';
  let acc = id ? accounts.get(id) : null;
  if (acc) {
    // id finns server-side → secret MÅSTE matcha
    if (acc.secret !== secret) { sendErr(ws, 'auth'); return; }
  } else {
    // id okänt (servern kan ha tappat data — Render flyktig disk) eller saknas
    // → skapa konto. Klientens id återanvänds om giltigt + ledigt, annars nytt.
    if (!/^[0-9]{1,16}$/.test(id) || accounts.has(id)) id = genAccountId();
    acc = {
      id, secret,
      name: 'Spelare', avatar: {},
      stats: { matches: 0, kills: 0, wins: 0 }, level: 1,
      friends: [], reqIn: [], reqOut: [],
      lastSeen: Date.now(),
    };
    accounts.set(id, acc);
    console.log('[ACCT]', id, 'konto skapat');
  }
  // Profil-payload från login
  const name = sanitizeName(msg.name);
  if (name) acc.name = name;
  if (msg.avatar && typeof msg.avatar === 'object') acc.avatar = msg.avatar;
  const stats = sanitizeStats(msg.stats);
  if (stats) { acc.stats = stats; acc.level = computeLevel(stats); }
  // Resync-modellen: klientens friends-lista är den durabla kopian → ERSÄTTER
  // serverns lista för detta konto (fältet utelämnat → behåll serverns).
  if (Array.isArray(msg.friends)) acc.friends = sanitizeFriendIds(msg.friends, id);
  // Samma konto från ny socket → gamla socketens accountId kopplas loss (senaste vinner)
  const old = online.get(id);
  if (old && old !== ws) old.accountId = null;
  ws.accountId = id;
  online.set(id, ws);
  acc.lastSeen = Date.now();
  markDirty();
  // requests = inkommande förfrågningar med avsändar-profil
  const requests = [];
  for (const rid of acc.reqIn) {
    const r = accounts.get(rid);
    if (r) requests.push({ id: r.id, name: r.name, avatar: r.avatar });
  }
  H.send(ws, {
    type: 'acct_logged_in',
    id: acc.id, name: acc.name, avatar: acc.avatar, level: acc.level,
    friends: buildFriendsList(acc),
    requests,
    sentRequests: acc.reqOut.slice(),
  });
  notifyFriendsOf(id); // vänner ser online:true
}

function handleUpdate(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const name = sanitizeName(msg.name);
  if (name) me.name = name;
  if (msg.avatar && typeof msg.avatar === 'object') me.avatar = msg.avatar;
  const stats = sanitizeStats(msg.stats);
  if (stats) { me.stats = stats; me.level = computeLevel(stats); }
  markDirty();
  sendOk(ws, 'update');
}

function handleSearch(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const q = String(msg.q || '').trim().slice(0, 32);
  const results = [];
  const pushAcc = (a) => results.push({ id: a.id, name: a.name, avatar: a.avatar, level: a.level, online: online.has(a.id) });
  if (q.length > 0) {
    // Exakt ID-träff först
    const exact = accounts.get(q);
    if (exact && exact.id !== me.id) pushAcc(exact);
    // Sedan namn-prefix case-insensitive, max 10 totalt
    const qlc = q.toLowerCase();
    for (const a of accounts.values()) {
      if (results.length >= 10) break;
      if (a.id === me.id) continue;
      if (exact && a.id === exact.id) continue;
      if (a.name.toLowerCase().startsWith(qlc)) pushAcc(a);
    }
  }
  H.send(ws, { type: 'acct_search_result', results });
}

function handleFriendRequest(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const toId = String(msg.toId || '').trim();
  if (toId === me.id) { sendErr(ws, 'self'); return; }
  const target = accounts.get(toId);
  if (!target) { sendErr(ws, 'notfound'); return; }
  if (me.friends.includes(toId)) { sendErr(ws, 'already'); return; }
  if (me.reqOut.includes(toId) || target.reqIn.includes(me.id)) { sendErr(ws, 'already'); return; }
  if (me.friends.length >= FRIENDS_CAP || target.friends.length >= FRIENDS_CAP) { sendErr(ws, 'full'); return; }
  if (target.reqIn.length >= REQUESTS_CAP || me.reqOut.length >= REQUESTS_CAP) { sendErr(ws, 'full'); return; }
  target.reqIn.push(me.id);
  me.reqOut.push(toId);
  markDirty();
  sendOk(ws, 'request');
  const tws = online.get(toId);
  if (tws) H.send(tws, { type: 'acct_request_in', from: { id: me.id, name: me.name, avatar: me.avatar, level: me.level } });
}

function handleFriendAccept(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const fromId = String(msg.fromId || '').trim();
  const other = accounts.get(fromId);
  if (!other || !me.reqIn.includes(fromId)) { sendErr(ws, 'notfound'); return; }
  if (me.friends.length >= FRIENDS_CAP || other.friends.length >= FRIENDS_CAP) { sendErr(ws, 'full'); return; }
  arrRemove(me.reqIn, fromId);
  arrRemove(other.reqOut, me.id);
  // städa ev. korsade requests (båda hann skicka)
  arrRemove(me.reqOut, fromId);
  arrRemove(other.reqIn, me.id);
  if (!me.friends.includes(fromId)) me.friends.push(fromId);
  if (!other.friends.includes(me.id)) other.friends.push(me.id);
  markDirty();
  sendOk(ws, 'accept');
  // Ömsesidig vänskap → båda (om online) får friends_update direkt
  if (online.has(me.id)) sendFriendsUpdate(me.id);
  if (online.has(fromId)) sendFriendsUpdate(fromId);
}

function handleFriendDecline(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const fromId = String(msg.fromId || '').trim();
  const other = accounts.get(fromId);
  if (!me.reqIn.includes(fromId)) { sendErr(ws, 'notfound'); return; }
  arrRemove(me.reqIn, fromId);
  if (other) arrRemove(other.reqOut, me.id);
  markDirty();
  sendOk(ws, 'decline');
  if (online.has(me.id)) sendFriendsUpdate(me.id);
  if (other && online.has(fromId)) sendFriendsUpdate(fromId);
}

function handleFriendRemove(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const id = String(msg.id || '').trim();
  if (!me.friends.includes(id)) { sendErr(ws, 'notfound'); return; }
  arrRemove(me.friends, id);
  const other = accounts.get(id);
  if (other) arrRemove(other.friends, me.id);
  markDirty();
  sendOk(ws, 'remove');
  if (online.has(me.id)) sendFriendsUpdate(me.id);
  if (other && online.has(id)) sendFriendsUpdate(id);
}

function handleInvite(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const toId = String(msg.toId || '').trim();
  if (!me.friends.includes(toId)) { sendErr(ws, 'notfriend'); return; }
  const tws = online.get(toId);
  if (!tws) { sendErr(ws, 'offline'); return; }
  const ri = H.roomInfo(ws);
  if (!ri) { sendErr(ws, 'noroom'); return; }
  H.send(tws, { type: 'acct_invited', from: { id: me.id, name: me.name, avatar: me.avatar }, code: ri.code, mode: ri.mode });
  sendOk(ws, 'invite');
}

// EN ingång från server.js message-handler (alla type som börjar med "acct_")
function handle(ws, msg, helpers) {
  if (helpers) H = helpers;
  if (!H) return;
  switch (msg.type) {
    case 'acct_login': handleLogin(ws, msg); return;
    case 'acct_update': handleUpdate(ws, msg); return;
    case 'acct_search': handleSearch(ws, msg); return;
    case 'acct_friend_request': handleFriendRequest(ws, msg); return;
    case 'acct_friend_accept': handleFriendAccept(ws, msg); return;
    case 'acct_friend_decline': handleFriendDecline(ws, msg); return;
    case 'acct_friend_remove': handleFriendRemove(ws, msg); return;
    case 'acct_invite': handleInvite(ws, msg); return;
    default: return; // okänd acct_-typ → ignorera tyst
  }
}

module.exports = { handle, onDisconnect, presenceChanged };
