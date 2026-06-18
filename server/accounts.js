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
  // Strip control chars, zero-width/joiner och bidi-override-codepoints (de
  // renderas som tomma rutor på iOS eller kan kapa namn-layouten), kollapsa
  // whitespace. Görs FÖRE trim/slice så längd-kontrollen ser det rensade namnet.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')   // C0/C1-kontroll
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '') // zero-width/bidi/joiner
    .replace(/\s+/g, ' ');
  const name = cleaned.trim().slice(0, 16);
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

// v2 PREMIUM-VAULT (additivt): opak progression-blob (gems, battle pass, kosmetik)
// som följer kontot → överlever reinstall. Klient-auktoritativ tills riktig IAP;
// servern lagrar/ekar bara (storleks-cappad mot abuse).
function sanitizeVault(raw) {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const s = JSON.stringify(raw);
    if (s.length > 12000) return null;   // för stor → ignorera
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
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
        vault: (a.vault && typeof a.vault === 'object') ? a.vault : null,
        referredBy: (typeof a.referredBy === 'string') ? a.referredBy : '',
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

let _saving = false;   // pågående async-write (förhindra överlappande skrivningar)

// PERF-FIX (2026-06-13, "feta spikes då och då"): konto-saven gjorde förr en
// SYNKRON fs.writeFileSync av ALLA konton — det blockerade hela Node-event-loopen
// medan filen skrevs (10-tals/100-tals ms på Fly-volymen). Saven debounce:as till
// var 3:e sekund medan kontot är "dirty" (XP/mynt från kills mitt i matchen) →
// sim-tick:en + world-broadcasten frös var ~3:e sekund → alla enemies stod still
// och "flög ikapp" sen. Nu: ASYNKRON write. Atomisk temp+rename behålls.
function saveNow() {
  _dirty = false;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_saving) {   // en write pågår → markera om och schemalägg ny efteråt
    _dirty = true;
    if (!_saveTimer) _saveTimer = setTimeout(() => { _saveTimer = null; if (_dirty) saveNow(); }, 3000);
    return;
  }
  let data;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    data = JSON.stringify({ accounts: [...accounts.values()] });
  } catch (e) { console.warn('[ACCT] save-prep misslyckades —', e.message); return; }
  _saving = true;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFile(tmp, data, (err) => {
    if (err) { _saving = false; console.warn('[ACCT] async write misslyckades —', err.message); return; }
    fs.rename(tmp, DATA_FILE, (err2) => {
      _saving = false;
      if (err2) console.warn('[ACCT] async rename misslyckades —', err2.message);
    });
  });
}

function saveNowSync() {
  // Synkron flush — BARA vid shutdown (SIGTERM), då async inte hinner före exit.
  _dirty = false;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ accounts: [...accounts.values()] }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.warn('[ACCT] sync save misslyckades —', e.message);
  }
}

function markDirty() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; if (_dirty) saveNow(); }, 3000);
}

process.on('SIGTERM', () => {
  try { if (_dirty || _saving) saveNowSync(); } catch (e) {}
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
  revokeSessionsFor(id); // C172: ingen stale-token-replay efter offline
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

// ── SESSION-TOKEN-LAGER (DTLS-alternativet, 2026-06-13) ──────────────────────
// Konto-SECRETEN går nu BARA över HTTPS (/auth/session, TLS-terminerad av Fly) →
// servern returnerar en kortlivad token. Klienten skickar sedan BARA token över
// UDP (acct_login{token}) → ws binds. Secreten korsar ALDRIG plaintext-UDP.
// Token roterar (TTL) + är revokerbar (vs permanent secret = oåterkallelig).
const sessionTokens = new Map(); // token → { accountId, exp }
const SESSION_TTL_MS = 60 * 60 * 1000; // 1h — klienten HTTPS-refreshar vid utgång
function issueSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessionTokens.set(token, { accountId, exp: Date.now() + SESSION_TTL_MS });
  return token;
}
function lookupSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const s = sessionTokens.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessionTokens.delete(token); return null; }
  return s.accountId;
}
// Revokera alla sessions-token för ett konto (logout/disconnect) → stänger
// replay-fönstret för en gammal token efter att socketen gått offline.
function revokeSessionsFor(accountId) {
  if (!accountId) return;
  for (const [t, s] of sessionTokens) if (s.accountId === accountId) sessionTokens.delete(t);
}
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessionTokens) if (now > s.exp) sessionTokens.delete(t);
}, 10 * 60 * 1000).unref();

// Konto-resolution från credentials (id+secret) + profil-applicering. DELAS av
// HTTPS-handshaket OCH legacy-secret-login. Returnerar acc, eller null vid auth-fel.
// H-FRI (anropas även från HTTP-tråden där H ej är satt).
function resolveAccountFromCreds(msg) {
  const secret = typeof msg.secret === 'string' ? msg.secret.slice(0, 128) : '';
  if (secret.length < 16) return null;
  let id = typeof msg.id === 'string' ? msg.id.trim() : '';
  let acc = id ? accounts.get(id) : null;
  if (acc) {
    if (acc.secret !== secret) return null;   // id finns → secret MÅSTE matcha
  } else {
    // id okänt (Render-dataförlust) eller saknas → skapa konto. Klientens id
    // återanvänds om giltigt + ledigt, annars nytt.
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
  const name = sanitizeName(msg.name);
  if (name) acc.name = name;
  if (msg.avatar && typeof msg.avatar === 'object') acc.avatar = msg.avatar;
  const stats = sanitizeStats(msg.stats);
  if (stats) { acc.stats = stats; acc.level = computeLevel(stats); }
  if (msg.vault) { const v = sanitizeVault(msg.vault); if (v) acc.vault = v; }
  // Resync-modellen: klientens friends-lista ERSÄTTER serverns (utelämnat → behåll).
  if (Array.isArray(msg.friends)) acc.friends = sanitizeFriendIds(msg.friends, acc.id);
  acc.lastSeen = Date.now();
  markDirty();
  return acc;
}

// acct_logged_in-payload (utan type). DELAS av token-bind + legacy + HTTPS-svaret.
function loginPayload(acc) {
  const requests = [];
  for (const rid of acc.reqIn) {
    const r = accounts.get(rid);
    if (r) requests.push({ id: r.id, name: r.name, avatar: r.avatar });
  }
  return {
    id: acc.id, name: acc.name, avatar: acc.avatar, level: acc.level,
    friends: buildFriendsList(acc),
    requests,
    sentRequests: acc.reqOut.slice(),
    bound: boundOf(acc),
    stats: acc.stats,
    vault: acc.vault || null,
  };
}

// Binder en SOCKET till ett (redan resolvat) konto: online-swap, ws.accountId,
// acct_logged_in + presence. Kräver H (anropas bara via WS-dispatchern → H satt).
function bindSocketToAccount(ws, acc) {
  const old = online.get(acc.id);
  if (old && old !== ws) old.accountId = null;
  // C172: byter socketen konto (switch → re-login) revokeras det gamla kontots
  // tokens så en utdelad token inte kan replaya efter bytet.
  if (ws.accountId && ws.accountId !== acc.id) revokeSessionsFor(ws.accountId);
  ws.accountId = acc.id;
  online.set(acc.id, ws);
  acc.lastSeen = Date.now();
  markDirty();
  H.send(ws, Object.assign({ type: 'acct_logged_in' }, loginPayload(acc)));
  notifyFriendsOf(acc.id); // vänner ser online:true
}

function handleLogin(ws, msg) {
  // NY VÄG: token (från HTTPS /auth/session) → secreten korsar aldrig UDP.
  if (typeof msg.token === 'string' && msg.token) {
    const accId = lookupSession(msg.token);
    const acc = accId ? accounts.get(accId) : null;
    if (!acc) { sendErr(ws, 'session'); return; } // utgången/okänd → klienten HTTPS-refreshar
    bindSocketToAccount(ws, acc);
    return;
  }
  // LEGACY: secret direkt. Säkert över WSS/TLS (lokal test) + HTTPS-fallback;
  // över plaintext-UDP osäkert → V2-prod-klienten använder token-vägen ovan.
  const acc = resolveAccountFromCreds(msg);
  if (!acc) { sendErr(ws, 'auth'); return; }
  bindSocketToAccount(ws, acc);
}

// HTTPS POST /auth/session — TLS-skyddat secret-handshake → kortlivad token.
// Körs från HTTP-servern (server.js). H-fritt anropsträd. Body = login-payloaden.
function meFromToken(token) {
  const id = lookupSession(token);
  return id ? accounts.get(id) : null;
}

// Resultat-protokoll (phase 2): cores returnerar { kind:'switch'|'bind'|'err', ... }
// → samma logik körs över BÅDE kanalen (legacy/WSS) OCH HTTPS (säkert handshake).
function applyChannelResult(ws, r) {
  if (!r || r.kind === 'err') { sendErr(ws, r ? r.code : 'invalid'); return; }
  if (r.kind === 'bind') { sendOk(ws, r.what, { bound: r.bound }); return; }
  if (r.kind === 'switch') { sendSwitch(ws, r.acc); return; }
}
function applyHttpResult(res, r) {
  if (!r || r.kind === 'err') {
    const code = r ? r.code : 'invalid';
    const status = (code === 'auth' || code === 'badlogin' || code === 'badtoken') ? 401 : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: code }));
    return;
  }
  if (r.kind === 'bind') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, what: r.what, bound: r.bound }));
    return;
  }
  // switch/login → token + secreten (för klientens framtida HTTPS-refresh) över TLS
  const token = issueSession(r.acc.id);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(Object.assign({ token, expiresInSec: Math.floor(SESSION_TTL_MS / 1000), secret: r.acc.secret, switch: true }, loginPayload(r.acc))));
}

// HTTPS POST /auth/session — TLS-skyddad ersättning för ALLA secret-bärande
// auth-handshakes. op: 'guest' (default, secret→token) | 'email_login' |
// 'email_bind' | 'apple_login' | 'gc_login'. Bind-ops identifierar kontot via
// session-token (msg.token); login-ops via credentials. H-fritt anropsträd.
function handleSessionHttp(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 16384) { try { req.destroy(); } catch (e) {} } });
  req.on('end', async () => {
    let msg; try { msg = JSON.parse(body || '{}'); } catch (e) { res.writeHead(400); res.end('bad json'); return; }
    msg = msg || {};
    try {
      const op = typeof msg.op === 'string' ? msg.op : 'guest';
      if (op === 'guest') {
        const acc = resolveAccountFromCreds(msg);
        if (!acc) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'auth' })); return; }
        const token = issueSession(acc.id);
        console.log('[ACCT] HTTPS session-token utfärdad', acc.id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ token, expiresInSec: Math.floor(SESSION_TTL_MS / 1000) }, loginPayload(acc))));
        return;
      }
      if (op === 'email_login') return applyHttpResult(res, coreEmailLogin(msg));
      if (op === 'email_bind') return applyHttpResult(res, coreEmailBind(meFromToken(msg.token), msg));
      if (op === 'apple_login') return applyHttpResult(res, await coreAppleLogin(meFromToken(msg.token), msg));
      if (op === 'gc_login') return applyHttpResult(res, await coreGcLogin(meFromToken(msg.token), msg));
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'badop' }));
    } catch (e) {
      console.warn('[ACCT] /auth/session fel —', e.message);
      try { res.writeHead(500); res.end(); } catch (e2) {}
    }
  });
  req.on('error', () => { try { res.writeHead(400); res.end(); } catch (e) {} });
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

// Hämta en spelares PUBLIKA profil (vän/medspelare) — stats + senaste matcher.
// Stats: acc.stats (matches/kills/wins, auktoritativt) + vault.pub_stats (rikare:
// best_streak/gold_earned) + vault.recent (senaste matcherna, klient-pushade).
function handleGetProfile(ws, msg) {
  const me = getMe(ws);
  if (!me) { sendErr(ws, 'auth'); return; }
  const id = String(msg.id || '').slice(0, 40);
  const a = accounts.get(id);
  if (!a) { H.send(ws, { type: 'acct_profile', id, found: false }); return; }
  const v = (a.vault && typeof a.vault === 'object') ? a.vault : {};
  const ps = (v.pub_stats && typeof v.pub_stats === 'object') ? v.pub_stats : {};
  // vitlista formen — recent är klient-pushad (osaniterad i vaulten) → mappa till
  // en känd, typ-koercad form innan den skickas vidare till andra spelare.
  const recent = (Array.isArray(v.recent) ? v.recent.slice(0, 8) : []).map((r) => ({
    mode: String((r && r.mode) || '').slice(0, 24),
    kills: Math.max(0, Math.min(9999, +(r && r.kills) || 0)),
    gold: Math.max(0, Math.min(9999999, +(r && r.gold) || 0)),
    won: !!(r && r.won),
  }));
  H.send(ws, {
    type: 'acct_profile', id: a.id, found: true,
    name: a.name, avatar: a.avatar, level: a.level,
    online: online.has(a.id),
    stats: {
      matches: (a.stats && +a.stats.matches) || +ps.matches || 0,
      kills: (a.stats && +a.stats.kills) || +ps.kills || 0,
      wins: (a.stats && +a.stats.wins) || +ps.wins || 0,
      best_streak: +ps.best_streak || 0,
      gold_earned: +ps.gold_earned || 0,
    },
    recent,
  });
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

// Resultat-baserade cores (phase 2) — DELAS av kanal-handlern + HTTPS-vägen.
// H-fria (HTTPS-tråden saknar H). `me` = inloggat konto (token/ws) eller null.
function coreEmailBind(me, msg) {
  if (!me) return { kind: 'err', code: 'auth' };
  const email = normEmail(msg.email);
  const password = typeof msg.password === 'string' ? msg.password : '';
  if (!email || password.length < 8) return { kind: 'err', code: 'invalid' };
  const ownerId = emailIdx.get(email);
  if (ownerId && ownerId !== me.id) return { kind: 'err', code: 'taken' };
  const salt = crypto.randomBytes(16);
  if (me.email && me.email !== email) emailIdx.delete(me.email); // rebind → städa gammalt index
  me.email = email;
  me.pwSalt = salt.toString('hex');
  me.pwHash = scryptHash(password, salt).toString('hex');
  emailIdx.set(email, me.id);
  markDirty();
  return { kind: 'bind', what: 'email_bind', bound: boundOf(me) };
}
function coreEmailLogin(msg) {
  // Okänd email OCH fel lösenord ger SAMMA kod (badlogin) — ingen user-enumeration.
  const email = normEmail(msg.email);
  const password = typeof msg.password === 'string' ? msg.password : '';
  const acc = email ? accounts.get(emailIdx.get(email)) : null;
  if (!acc || !acc.pwHash || !acc.pwSalt) return { kind: 'err', code: 'badlogin' };
  let match = false;
  try {
    const h = scryptHash(password, Buffer.from(acc.pwSalt, 'hex'));
    const stored = Buffer.from(acc.pwHash, 'hex');
    match = h.length === stored.length && crypto.timingSafeEqual(h, stored);
  } catch (e) {}
  if (!match) return { kind: 'err', code: 'badlogin' };
  return { kind: 'switch', acc };
}
function handleEmailBind(ws, msg) { applyChannelResult(ws, coreEmailBind(getMe(ws), msg)); }
function handleEmailLogin(ws, msg) { applyChannelResult(ws, coreEmailLogin(msg)); }

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

async function coreAppleLogin(me, msg) {
  const bundleIds = appleBundleIds();
  if (!bundleIds) return { kind: 'err', code: 'notconfigured' };
  const jwksUrl = process.env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys';
  const payload = await verifyJwtRS256(msg.identityToken, jwksUrl);
  const issOk = payload && payload.iss === 'https://appleid.apple.com';
  const audOk = payload && bundleIds.includes(payload.aud);
  const expOk = payload && (+payload.exp * 1000) > Date.now();
  const sub = (payload && typeof payload.sub === 'string') ? payload.sub : '';
  if (!issOk || !audOk || !expOk || !sub) return { kind: 'err', code: 'badtoken' };
  const ownerId = appleIdx.get(sub);
  if (me) {
    if (ownerId && ownerId !== me.id) return { kind: 'err', code: 'taken' }; // sub tillhör annat konto
    if (me.appleSub && me.appleSub !== sub) appleIdx.delete(me.appleSub);
    me.appleSub = sub;
    appleIdx.set(sub, me.id);
    markDirty();
    return { kind: 'bind', what: 'apple_bind', bound: boundOf(me) };
  } else if (ownerId && accounts.has(ownerId)) {
    return { kind: 'switch', acc: accounts.get(ownerId) };   // sub har konto → byt
  }
  const acc = createProviderAccount({ appleSub: sub });        // okänd sub → skapa
  appleIdx.set(sub, acc.id);
  markDirty();
  return { kind: 'switch', acc };
}
async function handleAppleLogin(ws, msg) { applyChannelResult(ws, await coreAppleLogin(getMe(ws), msg)); }

// ── 4) GAME CENTER (fetchItems-signatur verifierad mot Apples cert) ──────────
// Payload som Apple signerar: playerId(utf8) ‖ bundleId(utf8) ‖ timestampBE64 ‖ salt.
// publicKeyUrl-hosten MÅSTE sluta på .apple.com. GC_CERT_URL_OVERRIDE = testläge:
// proben ersätter hela cert-URL:en med sin mock. Node kan inte SKAPA X509-cert
// utan externa deps → mocken serverar rå SPKI-DER och servern faller tillbaka
// på createPublicKey(spki-der) när X509-parsning misslyckas OCH override är
// satt. Prod (utan override) kräver äkta DER-cert från *.apple.com.
async function coreGcLogin(me, msg) {
  const bundleIds = appleBundleIds();
  if (!bundleIds) return { kind: 'err', code: 'notconfigured' };
  const playerId = typeof msg.playerId === 'string' ? msg.playerId.slice(0, 128) : '';
  const bundleId = typeof msg.bundleId === 'string' ? msg.bundleId : '';
  const ts = +msg.timestamp;
  if (!playerId || !bundleId || !Number.isFinite(ts) || ts <= 0) return { kind: 'err', code: 'badtoken' };
  if (!bundleIds.includes(bundleId)) return { kind: 'err', code: 'badtoken' };
  if (Math.abs(Date.now() - ts) > 7 * 24 * 3600 * 1000) return { kind: 'err', code: 'badtoken' }; // ±7 dygn
  const override = process.env.GC_CERT_URL_OVERRIDE;
  let certUrl;
  if (override) {
    certUrl = override; // testläge — proben pekar mot sin mock
  } else {
    let host = '';
    try { host = new URL(String(msg.publicKeyUrl || '')).hostname; } catch (e) {}
    if (!host.endsWith('.apple.com')) return { kind: 'err', code: 'badtoken' };
    certUrl = String(msg.publicKeyUrl);
  }
  let pubKey = null;
  try {
    const der = await getCertDer(certUrl);
    try {
      pubKey = new crypto.X509Certificate(der).publicKey;
    } catch (e) {
      if (override) pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); // bara testläge
      else throw e;
    }
  } catch (e) {
    console.warn('[ACCT] gc-cert fel —', e.message);
    return { kind: 'err', code: 'badtoken' };
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
  if (!okSig) return { kind: 'err', code: 'badtoken' };
  const ownerId = gcIdx.get(playerId);
  if (me) {
    // VIKTIGT undantag: gcPlayerId som tillhör ANNAT konto → SWITCH, inte taken
    // (GC = reinstall-räddningen: nytt guest-konto byter tillbaka till det gamla).
    if (ownerId && ownerId !== me.id) return { kind: 'switch', acc: accounts.get(ownerId) };
    if (me.gcPlayerId && me.gcPlayerId !== playerId) gcIdx.delete(me.gcPlayerId);
    me.gcPlayerId = playerId; // TYST bind
    gcIdx.set(playerId, me.id);
    markDirty();
    return { kind: 'bind', what: 'gc_bind', bound: boundOf(me) };
  } else if (ownerId && accounts.has(ownerId)) {
    return { kind: 'switch', acc: accounts.get(ownerId) };
  }
  const acc = createProviderAccount({ gcPlayerId: playerId });
  gcIdx.set(playerId, acc.id);
  markDirty();
  return { kind: 'switch', acc };
}
async function handleGcLogin(ws, msg) { applyChannelResult(ws, await coreGcLogin(getMe(ws), msg)); }

// EN ingång från server.js message-handler (alla type som börjar med "acct_")
// LEDERBORD: topp 25 konton efter vald metrik (read-only).
function handleLeaderboard(ws, msg) {
  const metric = (msg.metric === 'kills' || msg.metric === 'level') ? msg.metric : 'wins';
  const arr = [];
  for (const acc of accounts.values()) {
    let v;
    if (metric === 'level') v = computeLevel(acc.stats);
    else v = (acc.stats && +acc.stats[metric]) || 0;
    arr.push({ id: acc.id, name: acc.name, level: computeLevel(acc.stats), value: v });
  }
  arr.sort((a, b) => b.value - a.value);
  H.send(ws, { type: 'acct_leaderboard_result', metric, top: arr.slice(0, 25) });
}

// REFERRAL: någon löste in DIN kod → +gems till referrern (additivt, max-merge-säkert).
// Redeemerns egen välkomstbonus delas ut klient-side (engångs, spårad i vault).
function handleReferral(ws, msg) {
  const me = getMe(ws);
  const code = String(msg.code || '').trim();
  if (!me || !code || code === me.id) return;
  if (me.referredBy) { sendErr(ws, 'already'); return; }   // engångs (server-auktoritativt)
  const ref = accounts.get(code);
  if (!ref) { sendErr(ws, 'badcode'); return; }
  me.referredBy = ref.id;   // markera FÖRE kreditering → ingen upprepad credit-exploit
  if (!ref.vault) ref.vault = {};
  ref.vault.gems = (Math.max(0, Math.round(+ref.vault.gems) || 0)) + 150;   // referrer-bonus
  markDirty();
  sendOk(ws, 'referral');
  const rws = online.get(code);
  if (rws) H.send(rws, { type: 'acct_referral_credit', amount: 150 });
}

function handle(ws, msg, helpers) {
  if (helpers) H = helpers;
  if (!H) return;
  switch (msg.type) {
    case 'acct_login': handleLogin(ws, msg); return;
    case 'acct_update': handleUpdate(ws, msg); return;
    case 'acct_search': handleSearch(ws, msg); return;
    case 'acct_get_profile': handleGetProfile(ws, msg); return;
    case 'acct_friend_request': handleFriendRequest(ws, msg); return;
    case 'acct_friend_accept': handleFriendAccept(ws, msg); return;
    case 'acct_friend_decline': handleFriendDecline(ws, msg); return;
    case 'acct_friend_remove': handleFriendRemove(ws, msg); return;
    case 'acct_invite': handleInvite(ws, msg); return;
    case 'acct_leaderboard': handleLeaderboard(ws, msg); return;
    case 'acct_referral': handleReferral(ws, msg); return;
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

// matchmaking grupp-lager (fas 2): hitta en INLOGGAD spelares socket via konto-id
function wsForAccount(id) { return online.get(id) || null; }

module.exports = { handle, onDisconnect, presenceChanged, handleGoogleRedirect, handleGoogleCallback, handleSessionHttp, wsForAccount };
