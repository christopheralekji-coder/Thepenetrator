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
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// ── Persistens ───────────────────────────────────────────────────────────────
// ACCOUNTS_DATA_DIR-override gör att prober kan peka mot temp-katalog.
const DATA_DIR = process.env.ACCOUNTS_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

const FRIENDS_CAP = 100;
const REQUESTS_CAP = 50;
const UPDATE_THROTTLE_MS = 1000; // max 1 friends_update/s per mottagare

const accounts = new Map(); // id → { id, secret, name, avatar, stats, level, friends:[], reqIn:[], reqOut:[], lastSeen,
                            //         email?, pwHash?, pwSalt?, googleSub?, appleSub?, gcPlayerId? } (bind-lagret)
const online = new Map();   // id → ws (senaste socket vinner)

// ── Bind-lagrets unika index (provider-nyckel → accountId) ──────────────────
// Byggs i load() och underhålls i alla bind/switch-vägar. INGEN av nycklarna
// (email/googleSub/appleSub/gcPlayerId) lämnar någonsin servern utom som
// bool i `bound` (Apples Attachment 3 — GC playerId får aldrig exponeras).
const emailIdx = new Map();  // email (lowercase) → id
const googleIdx = new Map(); // googleSub → id
const appleIdx = new Map();  // appleSub → id
const gcIdx = new Map();     // gcPlayerId → id

function indexAccount(acc) {
  if (acc.email) emailIdx.set(acc.email, acc.id);
  if (acc.googleSub) googleIdx.set(acc.googleSub, acc.id);
  if (acc.appleSub) appleIdx.set(acc.appleSub, acc.id);
  if (acc.gcPlayerId) gcIdx.set(acc.gcPlayerId, acc.id);
}

// bound-status (bara booleans — aldrig själva nycklarna)
function boundOf(acc) {
  return {
    email: !!acc.email,
    google: !!acc.googleSub,
    apple: !!acc.appleSub,
    gc: !!acc.gcPlayerId,
  };
}

let H = null;               // helpers från server.js: { send, roomInfo }
let _saveTimer = null;
let _dirty = false;

function computeLevel(stats) {
  // v2 konto-progression (2026-06-12, additivt): klienten räknar sin riktiga
  // konto-nivå (XP-kurva) och skickar alevel — den vinner när den finns.
  // V1/äldre klienter skickar aldrig fältet → gamla matches-formeln.
  const al = (stats && +stats.alevel) || 0;
  if (al >= 1) return Math.min(999, Math.round(al));
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
  const out = { matches: n(raw.matches), kills: n(raw.kills), wins: n(raw.wins) };
  // v2 konto-progression (additivt): mynt/XP/nivå följer kontot → överlever
  // reinstall (login-svaret ekar stats). V1 skickar aldrig fälten → utelämnas.
  if (raw.coins != null) out.coins = n(raw.coins);
  if (raw.axp != null) out.axp = n(raw.axp);
  if (raw.alevel != null) out.alevel = Math.max(1, Math.min(999, n(raw.alevel)));
  return out;
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
      // Bind-lagret: provider-fält (utelämnas i JSON om obundna)
      if (typeof a.email === 'string' && a.email) acc.email = a.email.toLowerCase();
      if (typeof a.pwHash === 'string' && a.pwHash) acc.pwHash = a.pwHash;
      if (typeof a.pwSalt === 'string' && a.pwSalt) acc.pwSalt = a.pwSalt;
      if (typeof a.googleSub === 'string' && a.googleSub) acc.googleSub = a.googleSub;
      if (typeof a.appleSub === 'string' && a.appleSub) acc.appleSub = a.appleSub;
      if (typeof a.gcPlayerId === 'string' && a.gcPlayerId) acc.gcPlayerId = a.gcPlayerId;
      indexAccount(acc);
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
    // Atomisk skrivning (granskning 2026-06-12): temp + rename — en crash mitt i
    // write trunkerar annars accounts.json (datan är långlivad på Fly-volymen).
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ accounts: [...accounts.values()] }));
    fs.renameSync(tmp, DATA_FILE);
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
  // VÄNFÖRLUST-FIX (2026-06-12): okänt konto = vännen har inte loggat in på DEN
  // HÄR servern ännu (färsk region-volym / dataförlust). Förr: null → vännen
  // FÖLL UR login-svaret → klienten skrev över sin durabla cache med den
  // amputerade listan = permanent förlust åt båda håll. Nu: placeholder-entry
  // (pending:1) så relationen överlever — klienten visar cachat namn och
  // entryt blir komplett när vännen loggar in en gång på servern.
  if (!a) return { id: fid, name: '', avatar: {}, level: 1, online: false, pending: 1 };
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
// extra = ev. extra fält (bind-ops skickar bound-status i samma acct_ok)
function sendOk(ws, what, extra) { H.send(ws, Object.assign({ type: 'acct_ok', what }, extra || {})); }

// acct_switch: klienten BYTER konto (skriver om user://account.json + re-login).
// Gamla kontot lämnas orört server-side (guest-kontot blir vilande).
function sendSwitch(ws, acc) {
  H.send(ws, { type: 'acct_switch', id: acc.id, secret: acc.secret, name: acc.name });
}

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
    bound: boundOf(acc), // bind-lagret: vilka providers kontot är knutet till
    stats: acc.stats,    // v2 (additivt): mynt/XP-recovery vid reinstall — V1 ignorerar
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

// ═════════════════════════════════════════════════════════════════════════════
// BIND-LAGRET — e-post/Google/Apple/Game Center knyts till guest-konton.
// Allt additivt: nya acct_*-typer + två HTTP-routes (/auth/google*) i server.js.
// ═════════════════════════════════════════════════════════════════════════════

// Skicka säkert även från async-kontext (Google-callback kan trigga innan H
// satts om servern aldrig fått ett acct_-meddelande — fall tillbaka på rå ws).
function safeSend(ws, obj) {
  if (!ws) return;
  if (H) { H.send(ws, obj); return; }
  if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
}

// ── HTTP-fetch-helper ────────────────────────────────────────────────────────
// Följer EJ redirects (Apple/Google svarar direkt). Stödjer http:// utöver
// https:// så prober kan peka env-URL:erna mot en lokal mock — prod-defaults
// är alltid https.
function fetchBuf(url, opts) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(new Error('bad url')); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, {
      method: (opts && opts.method) || 'GET',
      headers: (opts && opts.headers) || {},
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' från ' + u.hostname)); return; }
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout mot ' + u.hostname)));
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

function b64u(s) {
  return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ── JWKS-/cert-cache (12h) ───────────────────────────────────────────────────
const CACHE_TTL_MS = 12 * 3600 * 1000;
const _jwksCache = new Map(); // url → { keys, exp }
const _certCache = new Map(); // url → { buf, exp }

async function getJwks(url) {
  const hit = _jwksCache.get(url);
  if (hit && hit.exp > Date.now()) return hit.keys;
  const raw = await fetchBuf(url);
  const parsed = JSON.parse(raw.toString('utf8'));
  if (!parsed || !Array.isArray(parsed.keys)) throw new Error('ogiltig JWKS');
  _jwksCache.set(url, { keys: parsed.keys, exp: Date.now() + CACHE_TTL_MS });
  return parsed.keys;
}

async function getCertDer(url) {
  const hit = _certCache.get(url);
  if (hit && hit.exp > Date.now()) return hit.buf;
  const buf = await fetchBuf(url);
  _certCache.set(url, { buf, exp: Date.now() + CACHE_TTL_MS });
  return buf;
}

// Verifiera RS256-JWT mot en JWKS-URL. Returnerar payload eller null.
// (iss/aud/exp kollas av anroparen — olika providers, olika krav.)
async function verifyJwtRS256(token, jwksUrl) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64u(parts[0]).toString('utf8'));
    payload = JSON.parse(b64u(parts[1]).toString('utf8'));
  } catch (e) { return null; }
  if (!header || header.alg !== 'RS256' || !header.kid) return null;
  let keys;
  try { keys = await getJwks(jwksUrl); } catch (e) {
    console.warn('[ACCT] JWKS-hämtning misslyckades —', e.message);
    return null;
  }
  const jwk = keys.find((k) => k && k.kid === header.kid);
  if (!jwk) return null;
  let pub;
  try { pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch (e) { return null; }
  let okSig = false;
  try { okSig = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pub, b64u(parts[2])); } catch (e) {}
  if (!okSig) return null;
  return payload;
}

// ── 1) E-POST (scrypt N=16384, 16-byte slumpsalt) ────────────────────────────
function scryptHash(password, saltBuf) {
  // N=16384 är Nodes default — sätts explicit så spec-parametern är synlig
  return crypto.scryptSync(password, saltBuf, 64, { N: 16384, r: 8, p: 1 });
}

function normEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  // Light format-validering enligt spec (ingen RFC-pedanteri)
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

function handleEmailBind(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const email = normEmail(msg.email);
  const password = typeof msg.password === 'string' ? msg.password : '';
  if (!email || password.length < 8) { sendErr(ws, 'invalid'); return; }
  const ownerId = emailIdx.get(email);
  if (ownerId && ownerId !== me.id) { sendErr(ws, 'taken'); return; }
  const salt = crypto.randomBytes(16);
  // Rebind av egen email → städa gamla index-nyckeln
  if (me.email && me.email !== email) emailIdx.delete(me.email);
  me.email = email;
  me.pwSalt = salt.toString('hex');
  me.pwHash = scryptHash(password, salt).toString('hex');
  emailIdx.set(email, me.id);
  markDirty();
  sendOk(ws, 'email_bind', { bound: boundOf(me) });
}

function handleEmailLogin(ws, msg) {
  // Kräver EJ inloggad. Okänd email och fel lösenord ger SAMMA kod (badlogin)
  // — ingen user-enumeration.
  const email = normEmail(msg.email);
  const password = typeof msg.password === 'string' ? msg.password : '';
  const acc = email ? accounts.get(emailIdx.get(email)) : null;
  if (!acc || !acc.pwHash || !acc.pwSalt) { sendErr(ws, 'badlogin'); return; }
  let match = false;
  try {
    const h = scryptHash(password, Buffer.from(acc.pwSalt, 'hex'));
    const stored = Buffer.from(acc.pwHash, 'hex');
    match = h.length === stored.length && crypto.timingSafeEqual(h, stored);
  } catch (e) {}
  if (!match) { sendErr(ws, 'badlogin'); return; }
  sendSwitch(ws, acc);
}

// ── 2) GOOGLE (browser-OAuth, server-förmedlad) ──────────────────────────────
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const _googleStates = new Map(); // engångstoken → { ws, exp }

function sweepGoogleStates() {
  const now = Date.now();
  for (const [t, st] of _googleStates) {
    if (st.exp <= now) _googleStates.delete(t);
  }
}

function googleEnv() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return {
    clientId: id,
    clientSecret: secret,
    redirectUrl: process.env.GOOGLE_REDIRECT_URL || null, // saknas → härleds av host i /auth/google
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    jwksUrl: process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
  };
}

function handleGoogleStart(ws) {
  const env = googleEnv();
  if (!env) { sendErr(ws, 'notconfigured'); return; }
  sweepGoogleStates();
  const token = crypto.randomBytes(24).toString('hex');
  _googleStates.set(token, { ws, exp: Date.now() + GOOGLE_STATE_TTL_MS });
  // Bas-URL för vår egen /auth/google: härled ur GOOGLE_REDIRECT_URL
  // (…/auth/google/callback → …/auth/google), annars localhost:PORT (dev/probe).
  let base;
  if (env.redirectUrl) base = env.redirectUrl.replace(/\/callback\/?$/, '');
  else base = 'http://localhost:' + (process.env.PORT || 8080) + '/auth/google';
  H.send(ws, { type: 'acct_google_url', url: base + '?s=' + token });
}

// GET /auth/google?s=… → 302 till Googles auth-URL (anropas från server.js)
function handleGoogleRedirect(req, res) {
  const env = googleEnv();
  let q;
  try { q = new URL(req.url, 'http://x').searchParams; } catch (e) { q = new URLSearchParams(); }
  const s = q.get('s') || '';
  sweepGoogleStates();
  const st = _googleStates.get(s);
  if (!env || !st) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body>❌ Ogiltig eller utgången länk — starta om från spelet.</body></html>');
    return;
  }
  const redirectUri = env.redirectUrl
    || ('https://' + (req.headers.host || 'localhost') + '/auth/google/callback');
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(env.clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('openid email')
    + '&state=' + encodeURIComponent(s);
  res.writeHead(302, { Location: authUrl });
  res.end();
}

// GET /auth/google/callback?code&state → token-exchange → id_token → bind/switch
async function handleGoogleCallback(req, res) {
  const env = googleEnv();
  let q;
  try { q = new URL(req.url, 'http://x').searchParams; } catch (e) { q = new URLSearchParams(); }
  const code = q.get('code') || '';
  const state = q.get('state') || '';
  sweepGoogleStates();
  const st = _googleStates.get(state);
  _googleStates.delete(state); // engångstoken — konsumeras oavsett utfall
  const htmlEnd = (ok2, text) => {
    res.writeHead(ok2 ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body style="font-family:sans-serif;text-align:center;padding-top:40px">' + text + '</body></html>');
  };
  if (!env || !st || !code) { htmlEnd(false, '❌ Ogiltig eller utgången länk — starta om från spelet.'); return; }
  const ws = st.ws;
  try {
    const redirectUri = env.redirectUrl
      || ('https://' + (req.headers.host || 'localhost') + '/auth/google/callback');
    const body = 'code=' + encodeURIComponent(code)
      + '&client_id=' + encodeURIComponent(env.clientId)
      + '&client_secret=' + encodeURIComponent(env.clientSecret)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&grant_type=authorization_code';
    const raw = await fetchBuf(env.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tok = JSON.parse(raw.toString('utf8'));
    const payload = tok && tok.id_token ? await verifyJwtRS256(tok.id_token, env.jwksUrl) : null;
    const issOk = payload && (payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com');
    const audOk = payload && payload.aud === env.clientId;
    const expOk = payload && (+payload.exp * 1000) > Date.now();
    const sub = (payload && typeof payload.sub === 'string') ? payload.sub : '';
    if (!issOk || !audOk || !expOk || !sub) {
      safeSend(ws, { type: 'acct_error', code: 'badtoken' });
      htmlEnd(false, '❌ Kunde inte verifiera Google-kontot. Försök igen.');
      return;
    }
    // ws:ens inloggnings-status avgör bind vs switch vs skapa
    const me = (ws && ws.accountId && online.get(ws.accountId) === ws) ? accounts.get(ws.accountId) : null;
    const ownerId = googleIdx.get(sub);
    if (me) {
      if (ownerId && ownerId !== me.id) {
        safeSend(ws, { type: 'acct_error', code: 'taken' });
        htmlEnd(false, '❌ Det Google-kontot är redan knutet till ett annat spelkonto.');
        return;
      }
      if (me.googleSub && me.googleSub !== sub) googleIdx.delete(me.googleSub);
      me.googleSub = sub;
      googleIdx.set(sub, me.id);
      markDirty();
      safeSend(ws, { type: 'acct_ok', what: 'google_bind', bound: boundOf(me) });
    } else if (ownerId && accounts.has(ownerId)) {
      const acc = accounts.get(ownerId);
      if (ws) sendSwitchRaw(ws, acc);
    } else {
      const acc = createProviderAccount({ googleSub: sub });
      googleIdx.set(sub, acc.id);
      markDirty();
      if (ws) sendSwitchRaw(ws, acc);
    }
    htmlEnd(true, '✅ Klart — gå tillbaka till spelet');
  } catch (e) {
    console.warn('[ACCT] google-callback fel —', e.message);
    safeSend(ws, { type: 'acct_error', code: 'badtoken' });
    htmlEnd(false, '❌ Något gick fel. Försök igen.');
  }
}

// acct_switch via safeSend (async-kontexter där H kan saknas)
function sendSwitchRaw(ws, acc) {
  safeSend(ws, { type: 'acct_switch', id: acc.id, secret: acc.secret, name: acc.name });
}

// Nytt konto skapat av en provider-login (Apple/Google/GC utan befintligt
// konto). Servern genererar secret — klienten tar över det via acct_switch.
function createProviderAccount(fields) {
  const id = genAccountId();
  const acc = {
    id,
    secret: crypto.randomBytes(24).toString('hex'),
    name: 'Spelare', avatar: {},
    stats: { matches: 0, kills: 0, wins: 0 }, level: 1,
    friends: [], reqIn: [], reqOut: [],
    lastSeen: Date.now(),
  };
  Object.assign(acc, fields || {});
  accounts.set(id, acc);
  console.log('[ACCT]', id, 'konto skapat (provider-login)');
  return acc;
}

// ── 3) APPLE (Sign in with Apple — identityToken är en RS256-JWT) ────────────
function appleBundleIds() {
  const raw = process.env.APPLE_BUNDLE_IDS;
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return ids.length > 0 ? ids : null;
}

async function handleAppleLogin(ws, msg) {
  const bundleIds = appleBundleIds();
  if (!bundleIds) { sendErr(ws, 'notconfigured'); return; }
  const jwksUrl = process.env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys';
  const payload = await verifyJwtRS256(msg.identityToken, jwksUrl);
  const issOk = payload && payload.iss === 'https://appleid.apple.com';
  const audOk = payload && bundleIds.includes(payload.aud);
  const expOk = payload && (+payload.exp * 1000) > Date.now();
  const sub = (payload && typeof payload.sub === 'string') ? payload.sub : '';
  if (!issOk || !audOk || !expOk || !sub) { sendErr(ws, 'badtoken'); return; }
  const me = getMe(ws);
  const ownerId = appleIdx.get(sub);
  if (me) {
    // Inloggad → bind (taken om sub tillhör annat konto)
    if (ownerId && ownerId !== me.id) { sendErr(ws, 'taken'); return; }
    if (me.appleSub && me.appleSub !== sub) appleIdx.delete(me.appleSub);
    me.appleSub = sub;
    appleIdx.set(sub, me.id);
    markDirty();
    sendOk(ws, 'apple_bind', { bound: boundOf(me) });
  } else if (ownerId && accounts.has(ownerId)) {
    // Ej inloggad + sub har konto → byt till det
    sendSwitch(ws, accounts.get(ownerId));
  } else {
    // Ej inloggad + okänd sub → skapa konto knutet till sub
    const acc = createProviderAccount({ appleSub: sub });
    appleIdx.set(sub, acc.id);
    markDirty();
    sendSwitch(ws, acc);
  }
}

// ── 4) GAME CENTER (fetchItems-signatur verifierad mot Apples cert) ──────────
// Payload som Apple signerar: playerId(utf8) ‖ bundleId(utf8) ‖ timestampBE64 ‖ salt.
// publicKeyUrl-hosten MÅSTE sluta på .apple.com. GC_CERT_URL_OVERRIDE = testläge:
// proben ersätter hela cert-URL:en med sin mock. Node kan inte SKAPA X509-cert
// utan externa deps → mocken serverar rå SPKI-DER och servern faller tillbaka
// på createPublicKey(spki-der) när X509-parsning misslyckas OCH override är
// satt. Prod (utan override) kräver äkta DER-cert från *.apple.com.
async function handleGcLogin(ws, msg) {
  const bundleIds = appleBundleIds();
  if (!bundleIds) { sendErr(ws, 'notconfigured'); return; }
  const playerId = typeof msg.playerId === 'string' ? msg.playerId.slice(0, 128) : '';
  const bundleId = typeof msg.bundleId === 'string' ? msg.bundleId : '';
  const ts = +msg.timestamp;
  if (!playerId || !bundleId || !Number.isFinite(ts) || ts <= 0) { sendErr(ws, 'badtoken'); return; }
  if (!bundleIds.includes(bundleId)) { sendErr(ws, 'badtoken'); return; }
  if (Math.abs(Date.now() - ts) > 7 * 24 * 3600 * 1000) { sendErr(ws, 'badtoken'); return; } // ±7 dygn
  const override = process.env.GC_CERT_URL_OVERRIDE;
  let certUrl;
  if (override) {
    certUrl = override; // testläge — proben pekar mot sin mock
  } else {
    let host = '';
    try { host = new URL(String(msg.publicKeyUrl || '')).hostname; } catch (e) {}
    if (!host.endsWith('.apple.com')) { sendErr(ws, 'badtoken'); return; }
    certUrl = String(msg.publicKeyUrl);
  }
  let pubKey = null;
  try {
    const der = await getCertDer(certUrl);
    try {
      pubKey = new crypto.X509Certificate(der).publicKey;
    } catch (e) {
      // Fallback ENDAST i testläge (se kommentar ovan)
      if (override) pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      else throw e;
    }
  } catch (e) {
    console.warn('[ACCT] gc-cert fel —', e.message);
    sendErr(ws, 'badtoken');
    return;
  }
  let okSig = false;
  try {
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigUInt64BE(BigInt(Math.round(ts)));
    const signed = Buffer.concat([
      Buffer.from(playerId, 'utf8'),
      Buffer.from(bundleId, 'utf8'),
      tsBuf,
      Buffer.from(String(msg.salt || ''), 'base64'),
    ]);
    okSig = crypto.verify('sha256', signed, pubKey, Buffer.from(String(msg.signature || ''), 'base64'));
  } catch (e) {}
  if (!okSig) { sendErr(ws, 'badtoken'); return; }
  const me = getMe(ws);
  const ownerId = gcIdx.get(playerId);
  if (me) {
    // VIKTIGT undantag: gcPlayerId som tillhör ANNAT konto → acct_switch, inte
    // taken. GC är auto-räddningen: reinstall (nytt guest-konto) ska byta
    // tillbaka till det gamla kontot. Gamla guest-kontot lämnas vilande.
    if (ownerId && ownerId !== me.id) { sendSwitch(ws, accounts.get(ownerId)); return; }
    if (me.gcPlayerId && me.gcPlayerId !== playerId) gcIdx.delete(me.gcPlayerId);
    me.gcPlayerId = playerId; // TYST bind
    gcIdx.set(playerId, me.id);
    markDirty();
    sendOk(ws, 'gc_bind', { bound: boundOf(me) });
  } else if (ownerId && accounts.has(ownerId)) {
    sendSwitch(ws, accounts.get(ownerId));
  } else {
    const acc = createProviderAccount({ gcPlayerId: playerId });
    gcIdx.set(playerId, acc.id);
    markDirty();
    sendSwitch(ws, acc);
  }
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
    // Bind-lagret (async-handlers sköter sina fel själva — fire-and-forget)
    case 'acct_email_bind': handleEmailBind(ws, msg); return;
    case 'acct_email_login': handleEmailLogin(ws, msg); return;
    case 'acct_google_start': handleGoogleStart(ws); return;
    case 'acct_apple_login':
      handleAppleLogin(ws, msg).catch((e) => { console.warn('[ACCT] apple fel —', e.message); sendErr(ws, 'badtoken'); });
      return;
    case 'acct_gc_login':
      handleGcLogin(ws, msg).catch((e) => { console.warn('[ACCT] gc fel —', e.message); sendErr(ws, 'badtoken'); });
      return;
    default: return; // okänd acct_-typ → ignorera tyst
  }
}

module.exports = { handle, onDisconnect, presenceChanged, handleGoogleRedirect, handleGoogleCallback };
