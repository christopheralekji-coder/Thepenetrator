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
const groups = require('./groups'); // AUDIT C277/C272: socket-rebind + roster-push vid reconnect

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

// ── Namn-filter (svordomar/slurs, SV+EN) ─────────────────────────────────────
// Normaliserar bort obfuskering (leetspeak, separatorer, upprepningar, diakriter)
// och matchar mot en denylist av grova/olämpliga termer. Blockerar vid spelar-
// namnsättning (login/update) och FLAGGAR i admin-panelen. Admin kan överstyra.
// Listan är i NORMALISERAD form (gemener a-z). Distinkta termer valda för att
// hålla falska positiva låga; admin-flaggan + manuell granskning täcker resten.
function _normName(s) {
  return String(s).toLowerCase()
    .replace(/[àáâãäåāăą]/g, 'a').replace(/[èéêëēĕėęě]/g, 'e').replace(/[ìíîïĩīįı]/g, 'i')
    .replace(/[òóôõöøōő]/g, 'o').replace(/[ùúûüũūų]/g, 'u').replace(/[ýÿ]/g, 'y')
    .replace(/[ñń]/g, 'n').replace(/[çćč]/g, 'c').replace(/[ß]/g, 'b')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g')
    .replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^a-z]/g, '');
}
const NAME_DENYLIST = [
  // EN — slurs/hat (distinkta)
  'nigger', 'nigga', 'niggas', 'faggot', 'retard', 'kike', 'tranny', 'wetback',
  'chinaman', 'pedophile', 'pedophil', 'rapist', 'hitler', 'heilhitler', 'nazi',
  // EN — grov profanitet
  'fuck', 'motherfuck', 'cunt', 'pussy', 'whore', 'bitch', 'bastard', 'asshole',
  'dickhead', 'blowjob', 'handjob', 'jerkoff', 'cumslut',
  // SV — slurs/hat ('bog'/bög + 'sieg' borttagna: falsk-pos Bogdan/Siegfried)
  'neger', 'negern', 'blatte', 'svartskalle', 'pedofil', 'valdtakt', 'valdtog',
  'nazist', 'hora', 'horan', 'fitta', 'fittan', 'knulla', 'knullar',
  // SV — grov profanitet
  'javlahora', 'fitthuvud', 'kukhuvud', 'runka', 'runkar', 'satkarring',
];
function nameFlagged(name) {
  const b = _normName(name);
  if (!b) return false;
  const c = b.replace(/(.)\1+/g, '$1');   // kollapsa upprepningar (fuuuck → fuck)
  for (let i = 0; i < NAME_DENYLIST.length; i++) {
    const t = NAME_DENYLIST[i];
    if (b.indexOf(t) >= 0 || c.indexOf(t) >= 0) return true;
  }
  return false;
}

// Namn-historik (moderations-logg): varje DISTINKT namn-försök sparas med status
// (ok=godkänt, ok:false=blockerat av filtret, adm=admin-satt). Dedupas i rad så
// upprepade pushar av samma namn inte spammar. Capad till 50 senaste per konto.
function recordNameAttempt(acc, name, ok, adm) {
  if (!name || typeof name !== 'string') return;
  if (!Array.isArray(acc.nameHistory)) acc.nameHistory = [];
  const h = acc.nameHistory;
  const last = h[h.length - 1];
  if (last && last.name === name && !!last.ok === !!ok && !!last.adm === !!adm) return;
  h.push({ name: name, ok: !!ok, adm: !!adm, t: Date.now() });
  if (h.length > 50) acc.nameHistory = h.slice(-50);
  markDirty();
}

function sanitizeStats(raw, prev) {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v) => Math.max(0, Math.min(99999999, Math.round(+v) || 0));
  // DELTA: ta BARA med fält som faktiskt SKICKADES → anroparen MERGAR in i befintlig
  // stats. (Förr ersattes hela objektet → en klient som utelämnade t.ex. alevel TAPPADE
  // det server-side → föll till 1 via '|| 1'; coins/gems överlevde = exakt symptomet.)
  const out = {};
  if (raw.matches != null) out.matches = n(raw.matches);
  if (raw.kills != null) out.kills = n(raw.kills);
  if (raw.wins != null) out.wins = n(raw.wins);
  // C98-härdning: avvisa ENBART absurda en-meddelande-HÖJNINGAR (klient-fabricering).
  // SÄNKNINGAR släpps (legitim spending). Generösa tak → noll falska positiva.
  const capInc = (key, val, cap) => {
    const v = n(val);
    const base = (prev && typeof prev[key] === 'number') ? prev[key] : 0;
    if (v - base >= cap) return base;   // orimligt hopp → behåll föregående (avvisa höjningen)
    return v;
  };
  if (raw.coins != null) out.coins = capInc('coins', raw.coins, 1000000);
  if (raw.axp != null) out.axp = capInc('axp', raw.axp, 5000000);
  if (raw.alevel != null) out.alevel = Math.max(1, Math.min(999, capInc('alevel', raw.alevel, 50)));
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVER-AUKTORITATIV KONTO-XP/NIVÅ (fas 1) — bakom feature-flagga SERVERAUTH_XP.
// SPEGEL av klientens formler (Save.gd): axp_needed(level)=100+(level-1)*50, och
// match-XP = (vinst?30:12)+min(kills,20). axp lagras som "rest inom nuvarande nivå"
// (klienten subtraherar vid level-up) → vi replikerar add_axp exakt. Köpta nivåer
// (buy_account_level) är redan inbakade i alevel. FLAGGA AV = motorn rör inget.
// ════════════════════════════════════════════════════════════════════════════
function serverAuthXpOn() { return !!process.env.SERVERAUTH_XP; }
function axpNeeded(level) { return 100 + (Math.max(1, level) - 1) * 50; }
function matchXpAward(kills, won) {
  return (won ? 30 : 12) + Math.min(Math.max(0, Math.round(+kills) || 0), 20);
}
// Replikerar Save.add_axp(): lägg till axp, level-up-loop. Muterar acc.stats. Returnerar
// antal nivåer höjda. Anropas BARA server-side (match-slut / validerad uppdrags-claim).
function creditAxp(acc, n) {
  if (!acc) return 0;
  if (!acc.stats || typeof acc.stats !== 'object') acc.stats = { matches: 0, kills: 0, wins: 0 };
  if (typeof acc.stats.axp !== 'number') acc.stats.axp = 0;
  if (typeof acc.stats.alevel !== 'number' || acc.stats.alevel < 1) acc.stats.alevel = 1;
  n = Math.max(0, Math.round(+n) || 0);
  if (n <= 0) return 0;
  acc.stats.axp += n;
  let leveled = 0;
  while (acc.stats.axp >= axpNeeded(acc.stats.alevel) && acc.stats.alevel < 999) {
    acc.stats.axp -= axpNeeded(acc.stats.alevel);
    acc.stats.alevel += 1;
    leveled++;
  }
  if (acc.stats.alevel >= 999) acc.stats.axp = Math.min(acc.stats.axp, axpNeeded(999) - 1);
  return leveled;
}
// Total ackumulerad XP för (axp inom nivå, alevel) — används för MIGRERING (jämför
// server- vs klient-progression rättvist; ta den högre EN gång när server tar över).
function totalXp(axp, alevel) {
  let lv = Math.max(1, Math.min(999, Math.round(+alevel) || 1));
  let t = Math.max(0, Math.round(+axp) || 0);
  for (let k = 1; k < lv; k++) t += axpNeeded(k);
  return t;
}

// ANTI-FUSK: rullande tidsfönster-tak på hur mycket KLIENT-pushad konto-XP (monoton-max-
// vägen, dvs daily/weekly + reinstall-eko) som accepteras. Server-krediterad match-XP går
// EJ via denna väg (creditAxp muterar direkt) → orörd. Legit icke-match-XP/dygn ≈ 3 dailies
// (75) + 1 weekly (80) ≈ 155 → 800-taket är generöst men blockerar nivå-inflation (en modad
// klient kan annars pusha +49 nivåer/meddelande upp till sanitizeStats-cap:en). I minnet
// (ej persisterat): server-omstart nollar fönstret — gynnar bara legit spelare, och en
// fuskare kan inte tvinga omstarter. Returnerar true om delta får accepteras nu.
const NONMATCH_XP_WINDOW_MS = 24 * 3600 * 1000;
const NONMATCH_XP_MAX = parseInt(process.env.NONMATCH_XP_MAX, 10) || 800;
function clientXpDeltaAllowed(acc, delta, now) {
  if (delta <= 0) return true;
  const w = acc._xpWin;
  if (!w || (now - w.start) >= NONMATCH_XP_WINDOW_MS) {
    acc._xpWin = { start: now, gain: delta };
    if (delta > NONMATCH_XP_MAX) { acc._xpWin.gain = 0; return false; }  // ett enskilt skutt > taket = fusk
    return true;
  }
  if (w.gain + delta > NONMATCH_XP_MAX) return false;   // skulle spränga dygns-taket → avvisa
  w.gain += delta;
  return true;
}

// Gating: vilka konton är server-auktoritativa för XP. SERVERAUTH_XP osatt → ingen
// (full klient-auth, oförändrat). ='all' → alla. annat truthy → BARA dev-konton (test).
const _DEV_XP = new Set((process.env.DEV_ACCOUNT_IDS || '86743226').split(',').map((s) => s.trim()).filter(Boolean));
function serverAuthXpFor(acc) {
  const f = process.env.SERVERAUTH_XP;
  if (!f || !acc) return false;
  if (f === 'all') return true;
  return _DEV_XP.has(String(acc.id));
}
// Lägen där SERVERN krediterar match-XP (har per-spelar-kills i match_end-eventet).
// Övriga lägen + uppdrag förblir klient-auth (servern accepterar via merge). Utöka när
// fler lägen verifierats / PvE-kills spåras. Klienten hoppar lokal XP BARA för dessa.
const SERVER_XP_MODES = new Set((process.env.SERVERAUTH_XP_MODES || 'tdm,ctf,siege,koth,gungame,juggernaut,battleroyale').split(',').map((s) => s.trim()).filter(Boolean));

// Krediterar match-XP server-side för ett bundet, server-auth-konto i ett wired läge.
// Returnerar {peerId, axp, alevel, gained} för acct_xp-eventet, eller null (no-op).
function creditMatchEndXp(ws, mode, kills, won) {
  if (!ws || !ws.accountId) return null;
  if (!serverAuthXpFor({ id: ws.accountId }) || !SERVER_XP_MODES.has(String(mode))) return null;
  const acc = accounts.get(ws.accountId);
  if (!acc) return null;
  const gained = matchXpAward(kills, won);
  creditAxp(acc, gained);
  markDirty();
  console.log('[XP] credit', acc.id, mode, 'kills=' + (kills | 0), 'won=' + !!won, '→ +' + gained + ' axp, alevel=' + acc.stats.alevel);
  return { peerId: ws.id, axp: acc.stats.axp, alevel: acc.stats.alevel, gained: gained };
}

// Laddar LAGRAD (betrodd) stats utan delta-cap (cap:en gäller bara klient-input — annars
// hade ett konto med >1M coins nollställts vid server-omstart).
function loadStats(raw) {
  if (!raw || typeof raw !== 'object') return { matches: 0, kills: 0, wins: 0 };
  const n = (v) => Math.max(0, Math.min(99999999, Math.round(+v) || 0));
  const out = { matches: n(raw.matches), kills: n(raw.kills), wins: n(raw.wins) };
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
    // valvet bär gems/battle-pass/kosmetik — ALDRIG coins/axp/alevel (de bor i stats
    // med delta-cap). Strippa ekonomi-stat-nycklar + __proto__ så valvet varken blir en
    // bypass-vektor eller prototyp-förgiftning.
    const clean = {};
    for (const k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k === 'coins' || k === 'axp' || k === 'alevel' || k === '__proto__') continue;
      clean[k] = raw[k];
    }
    const s = JSON.stringify(clean);
    // C-fix: höjt 12000→65536 — en spelare med mycket kosmetik hade ett valv >12KB som
    // TYST avvisades → gems fastnade på 0 server-side. 64KB rymmer värsta-fall med marginal.
    if (s.length > 65536) { console.warn('[ACCT] vault för stor (' + s.length + ' bytes) — ignorerad'); return null; }
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
        stats: loadStats(a.stats),
        level: 1,
        friends: sanitizeFriendIds(a.friends, a.id),
        reqIn: sanitizeFriendIds(a.reqIn, a.id).slice(0, REQUESTS_CAP),
        reqOut: sanitizeFriendIds(a.reqOut, a.id).slice(0, REQUESTS_CAP),
        lastSeen: +a.lastSeen || 0,
        vault: (a.vault && typeof a.vault === 'object') ? a.vault : null,
        referredBy: (typeof a.referredBy === 'string') ? a.referredBy : '',
        banned: !!a.banned,   // admin-ban (persisterar — load() återskapar explicita fält)
        nameHistory: Array.isArray(a.nameHistory) ? a.nameHistory.slice(-50) : [],   // namn-historik
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
      // server-auth XP: migrering redan utförd → återställ flaggan (saveNow persisterar den
      // i råobjektet). Utan detta nollas _xpMigrated vid varje omstart → migreringen kör om
      // på första acct_update och skulle adoptera en klient-uppblåst nivå (fusk-fönster).
      if (a._xpMigrated) acc._xpMigrated = true;
      // admin-force (ekonomi/namn) ska överleva en server-omstart — annars tappas en admin-
      // ändring som gjordes strax före omstart (spelaren adopterar den aldrig → kan reverta).
      if (a._economyForce) acc._economyForce = true;
      if (a._nameForce) acc._nameForce = true;
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
  // ADMIN-FORCE vid LOGIN: respektera _economyForce/_nameForce även här (login-vägen) —
  // annars revertar klientens login-stats/-namn det admin-satta värdet INNAN economyForce-
  // adoptionen ens hinner verka. (Detta var roten: handleUpdate skyddade acct_update men
  // INTE login. alevel/coins/axp bor i stats, gems i vault, namnet i acc.name.)
  const forced = !!acc._economyForce;
  const nameForced = !!acc._nameForce;
  const name = sanitizeName(msg.name);
  if (name && !nameForced) recordNameAttempt(acc, name, !nameFlagged(name), false);   // logga försöket (även blockerat)
  if (name && !nameForced && !nameFlagged(name)) acc.name = name;   // blockera olämpliga namn / behåll admin-namn
  if (msg.avatar && typeof msg.avatar === 'object') acc.avatar = msg.avatar;
  const stats = sanitizeStats(msg.stats, acc.stats);
  if (stats) {
    if (forced && acc.stats) {
      // behåll serverns admin-satta coins/axp/alevel — skriv INTE klientens vid login
      if (stats.coins != null) stats.coins = acc.stats.coins || 0;
      if (stats.axp != null) stats.axp = acc.stats.axp || 0;
      if (stats.alevel != null) stats.alevel = acc.stats.alevel || 1;
    }
    acc.stats = Object.assign({}, acc.stats || {}, stats);
    acc.level = computeLevel(acc.stats);
  }
  if (msg.vault) {
    const v = sanitizeVault(msg.vault);
    if (v) {
      if (forced && acc.vault && typeof acc.vault.gems === 'number') v.gems = acc.vault.gems;  // behåll admin-satta gems
      acc.vault = v;
    }
  }
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
    banned: !!acc.banned,
    economyForce: !!acc._economyForce,   // admin satte ekonomi → klienten adopterar ovillkorligt
    nameForce: !!acc._nameForce,         // admin döpte om → klienten adopterar namnet i Config.player_name
    // Lägen där SERVERN äger match-XP för DETTA konto. Tom lista = klient-auth (oförändrat).
    // Klienten hoppar lokal add_axp för dessa lägen och adopterar acct_xp-eventet istället.
    serverXpModes: serverAuthXpFor(acc) ? [...SERVER_XP_MODES] : [],
  };
}

// Binder en SOCKET till ett (redan resolvat) konto: online-swap, ws.accountId,
// acct_logged_in + presence. Kräver H (anropas bara via WS-dispatchern → H satt).
function bindSocketToAccount(ws, acc) {
  if (isBanned(acc)) { sendErr(ws, 'banned'); try { ws.close(); } catch (e) {} return; }
  const old = online.get(acc.id);
  if (old && old !== ws) {
    // AUDIT C277: om den gamla socketen är i en grupp, transfera gruppmedlemskapet
    // till den nya socketen INNAN vi nollar old.accountId — annars pekar
    // g.members[accountId] på stale `old` och groupOf(newWs) returnerar null.
    if (old._groupId) groups.rebindSocket(acc.id, ws);
    old.accountId = null;
  }
  // C172: byter socketen konto (switch → re-login) revokeras det gamla kontots
  // tokens så en utdelad token inte kan replaya efter bytet.
  if (ws.accountId && ws.accountId !== acc.id) revokeSessionsFor(ws.accountId);
  ws.accountId = acc.id;
  online.set(acc.id, ws);
  acc.lastSeen = Date.now();
  markDirty();
  H.send(ws, Object.assign({ type: 'acct_logged_in' }, loginPayload(acc)));
  // ADOPTIONS-SCOPING: markera att DENNA socket fick (ev.) force-flaggorna i sin loginPayload.
  // Bara en socket som faktiskt fick dem får senare KONSUMERA dem i handleUpdate. En redan-
  // online socket (där admin satte flaggan EFTER dess login) har dessa = false → dess gamla
  // acct_update kan inte äta upp override:n i förtid (buggen: admin-ändring revertades).
  ws._forceEcon = !!acc._economyForce;
  ws._forceName = !!acc._nameForce;
  // OBS: _economyForce rensas INTE här (en tappad login-frame skulle annars förlora
  // override:n permanent). Den konsumeras i handleUpdate vid första acct_update efter
  // login — då har klienten bevisligen tagit emot+adopterat acct_logged_in.
  notifyFriendsOf(acc.id); // vänner ser online:true
  // AUDIT C272: pusha auktoritativt grupp-roster (eller group_left) direkt efter
  // login/reconnect så klienten snapper till rätt grupp-state utan fördröjning.
  groups.pushRosterFor(ws);
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
        if (isBanned(acc)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'banned' })); return; }
        const token = issueSession(acc.id);
        console.log('[ACCT] HTTPS session-token utfärdad', acc.id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ token, expiresInSec: Math.floor(SESSION_TTL_MS / 1000) }, loginPayload(acc))));
        return;
      }
      if (op === 'email_login') return applyHttpResult(res, coreEmailLogin(msg));
      if (op === 'email_bind') return applyHttpResult(res, coreEmailBind(meFromToken(msg.token), msg));
      // apple/gc: resolva me via token ELLER creds-fallback (id+secret över TLS) → binder på
      // gäst-kontot i st.f. att skapa ett nytt (dubbelkonto-fix).
      if (op === 'apple_login') return applyHttpResult(res, await coreAppleLogin(meFromTokenOrCreds(msg), msg));
      if (op === 'gc_login') return applyHttpResult(res, await coreGcLogin(meFromTokenOrCreds(msg), msg));
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
  const nameForced = !!me._nameForce;  // admin döpte om → ignorera klientens namn-push tills adopterat
  const name = sanitizeName(msg.name);
  if (name && !nameForced) recordNameAttempt(me, name, !nameFlagged(name), false);   // logga försöket
  if (name && !nameForced && !nameFlagged(name)) me.name = name;   // blockera olämpliga namn
  if (msg.avatar && typeof msg.avatar === 'object') me.avatar = msg.avatar;
  const forced = !!me._economyForce;   // admin satte ekonomi → ignorera klientens ekonomi denna gång
  const stats = sanitizeStats(msg.stats, me.stats);
  if (stats) {
    if (forced && me.stats) {
      // behåll serverns coins/axp/alevel (admin satte dem) — överskriv BARA det klienten skickade
      if (stats.coins != null) stats.coins = me.stats.coins || 0;
      if (stats.axp != null) stats.axp = me.stats.axp || 0;
      if (stats.alevel != null) stats.alevel = me.stats.alevel || 1;
    }
    // SERVER-AUKTORITATIV XP: när servern äger XP för kontot ignoreras klientens axp/alevel.
    // EN gång (migrering) tas dock det HÖGRE av server/klient (skyddar nivå-wipeade konton)
    // innan servern tar över helt. forced (admin) har företräde och hoppar migreringen.
    if (!forced && serverAuthXpFor(me) && me.stats) {
      // MIGRERING läser RÅA klient-värden (msg.stats), INTE de delta-cappade (sanitizeStats
      // klampar alevel-hopp >50 över server-basen → en nivå-60-klient mot server-bas 1 skulle
      // annars klampas till 1 och låsas PERMANENT av _xpMigrated = nivå-förlust). Detta är ett
      // engångs-betrott steg → anti-fusk-cap:en är irrelevant här. Normala (klient-auth) vägen
      // behåller cap:en (sanitizeStats orörd). axp är "rest inom nivå" (<~50k) → aldrig cappad.
      const rawStats = (msg && msg.stats && typeof msg.stats === 'object') ? msg.stats : null;
      const hasRawXp = rawStats && (rawStats.axp != null || rawStats.alevel != null);
      if (!me._xpMigrated && hasRawXp) {
        const cliAxp = rawStats.axp != null ? Math.max(0, Math.round(+rawStats.axp) || 0) : (me.stats.axp || 0);
        const cliLv = rawStats.alevel != null ? Math.max(1, Math.min(999, Math.round(+rawStats.alevel) || 1)) : (me.stats.alevel || 1);
        if (totalXp(cliAxp, cliLv) > totalXp(me.stats.axp || 0, me.stats.alevel || 1)) {
          me.stats.axp = cliAxp; me.stats.alevel = cliLv;   // klientens progression var högre → behåll
        }
        me._xpMigrated = true;
        console.log('[XP] migrated', me.id, '→ axp=' + (me.stats.axp || 0) + ' alevel=' + (me.stats.alevel || 1));
      }
      // MONOTON-MAX (ersätter tidigare hård strip): acceptera klientens (cappade) axp/alevel
      // BARA som en ÖKNING — så legitim ICKE-match-XP (daily +25 / weekly +80 via Save.add_axp)
      // krediteras kontot. ALDRIG en MINSKNING (skyddar server-krediterad match-XP om ett
      // acct_xp-event tappades). Ingen dubbelräkning: klienten adopterar serverns match-XP via
      // acct_xp + hoppar lokal match-XP, och pushar sedan SAMMA värde (max = no-op); match-XP
      // räknas via identisk formel server↔klient. Anti-fusk = sanitizeStats-cap:en (oförändrad).
      const cAxp = stats.axp != null ? stats.axp : (me.stats.axp || 0);
      const cLv = stats.alevel != null ? stats.alevel : (me.stats.alevel || 1);
      const srvTot = totalXp(me.stats.axp || 0, me.stats.alevel || 1);
      const delta = totalXp(cAxp, cLv) - srvTot;
      // ANTI-FUSK: acceptera ökningen BARA om den ryms i dygns-taket (blockerar nivå-inflation
      // via modad klient). Server-krediterad match-XP påverkas ej (går ej via denna väg).
      if (delta > 0 && clientXpDeltaAllowed(me, delta, Date.now())) {
        stats.axp = cAxp; stats.alevel = cLv;       // klienten HÖGRE (la till daily/weekly) → behåll
      } else {
        if (delta > 0) console.log('[XP] cap-block', me.id, 'delta=' + delta + ' (dygns-tak ' + NONMATCH_XP_MAX + ')');
        delete stats.axp; delete stats.alevel;       // lägre/lika ELLER över taket → behåll serverns
      }
    }
    me.stats = Object.assign({}, me.stats || {}, stats);   // MERGE → tappa ALDRIG ej-skickade fält (t.ex. alevel)
    me.level = computeLevel(me.stats);
  }
  // BUGFIX: vault (gems/battle pass/kosmetik) applicerades ALDRIG i acct_update → servern
  // hade alltid tom vault (admin såg 0 gems hos alla; gems/kosmetik överlevde ej reinstall).
  if (msg.vault) {
    const v = sanitizeVault(msg.vault);
    if (v) {
      if (forced && me.vault && typeof me.vault.gems === 'number') v.gems = me.vault.gems;  // bevara admin-satta gems
      me.vault = v;
    }
  }
  // Konsumera force-flaggorna BARA om DENNA socket fick dem i sin loginPayload (ws._force*) —
  // dvs en FÄRSK login EFTER admin-ändringen, då klienten bevisligen adopterat värdena. En
  // redan-online socket (flaggan sattes efter dess login → ws._force* = false) konsumerar EJ,
  // så dess gamla acct_update kan varken äta upp override:n eller reverta det admin-satta värdet.
  //
  // BUGFIX: konsumera flaggan BARA om klienten faktiskt skickade TILLBAKA de admin-satta värdena
  // (adoption bekräftad). Tidigare konsumerades flaggan vid FÖRSTA acct_update oavsett om
  // klientens stats matchade — vilket lämnade nästa push oskyddad och aleveln reverterade till
  // klientens gamla värde på 2:a pushen. Nu: flaggan sitter kvar tills klienten skickar korrekt.
  if (forced && ws._forceEcon) {
    // ADOPTION-BEVIS: konsumera flaggan BARA när klienten EKAR tillbaka serverns admin-satta
    // ekonomi-värden (= bevis på att den faktiskt adopterat). En klient som pushar GAMLA värden
    // (icke-adopterande/gammal build, eller en stale push) konsumerar EJ → flaggan + serverns
    // värde behålls (ingen backend-revert). En push UTAN stats är inte heller adoption-bevis.
    const s = (msg.stats && typeof msg.stats === 'object') ? msg.stats : null;
    let adopted = !!s;
    if (s) {
      if (s.alevel != null && Math.round(+s.alevel) !== (me.stats.alevel || 1)) adopted = false;
      if (s.coins  != null && Math.round(+s.coins)  !== (me.stats.coins  || 0)) adopted = false;
      if (s.axp    != null && Math.round(+s.axp)    !== (me.stats.axp    || 0)) adopted = false;
      const g = (msg.vault && typeof msg.vault === 'object' && msg.vault.gems != null) ? Math.round(+msg.vault.gems) : null;
      if (g != null && g !== ((me.vault && me.vault.gems) || 0)) adopted = false;
    }
    if (adopted) { me._economyForce = false; ws._forceEcon = false; }
  }
  if (nameForced && ws._forceName) { me._nameForce = false; ws._forceName = false; }
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

// DUBBELKONTO-FIX: klienten skapar ETT gäst-konto vid app-start (resolveAccountFromCreds),
// och en provider-login (Apple/GC) skapade FÖRR ett ANDRA konto när `me` var null (klienten
// skickade ingen token innan den hunnit logga in) → gäst-kontot blev en föräldralös "Spelare"-
// spöke (2 profiler i panelen). Fix: (1) klienten skickar nu ALLTID sina creds (id+secret över
// TLS) med provider-loginen → servern resolvar gäst-kontot här och BINDER providern på det
// (inget nytt konto). (2) Är providern redan knuten till ett ANNAT konto OCH `me` är ett tomt
// gäst-konto → SWITCH till det riktiga + städa bort det tomma gästkontot.

// Resolvar `me` från session-token ELLER (fallback, TLS-only) klientens id+secret. Secret-
// kollen gör att en angripare bara kan resolva SITT EGET konto (ingen takeover).
function meFromTokenOrCreds(msg) {
  const t = meFromToken(msg.token);
  if (t) return t;
  const id = typeof msg.id === 'string' ? msg.id.trim() : '';
  const secret = typeof msg.secret === 'string' ? msg.secret : '';
  if (id && secret.length >= 16) {
    const a = accounts.get(id);
    if (a && typeof a.secret === 'string' && a.secret.length === secret.length) {
      try { if (crypto.timingSafeEqual(Buffer.from(a.secret), Buffer.from(secret))) return a; } catch (e) {}
    }
  }
  return null;
}

// Strikt tomt-gäst-test: INGA provider-bindningar, default-namn, NOLL progression, inga
// vänner/förfrågningar, tom vault. Måste vara strikt — vi får ALDRIG reclaim:a/radera ett
// konto med riktig progress.
function isEmptyGuest(acc) {
  if (!acc) return false;
  if (acc.email || acc.googleSub || acc.appleSub || acc.gcPlayerId) return false;  // bundet = riktigt
  if (acc.banned || acc._economyForce || acc._nameForce) return false;             // admin rörde kontot → rör ej
  if (acc.name && acc.name !== 'Spelare') return false;                            // omdöpt = engagerad
  if (acc.referredBy) return false;                                                // referral-inlöst → bevara markören
  if (acc.avatar && typeof acc.avatar === 'object' && Object.keys(acc.avatar).length > 0) return false;  // vald avatar
  const s = acc.stats || {};
  if ((s.matches | 0) || (s.kills | 0) || (s.wins | 0) || (s.coins | 0) || (s.axp | 0)) return false;
  if ((s.alevel || 1) > 1) return false;
  if ((acc.friends || []).length || (acc.reqIn || []).length || (acc.reqOut || []).length) return false;
  const v = acc.vault;
  if (v && typeof v === 'object' && ((v.gems | 0) > 0 || Object.keys(v).length > 0)) return false;
  return true;
}

// Städar bort ett TOMT gäst-konto efter en switch till spelarens riktiga konto. Dubbel-
// kollar isEmptyGuest (aldrig radera progress). keepId = kontot vi switchar TILL (rör ej).
function reclaimEmptyGuest(guestId, keepId) {
  if (!guestId || guestId === keepId) return;
  const g = accounts.get(guestId);
  if (!g || !isEmptyGuest(g)) return;   // säkerhetsspärr: bara verifierat tomma gäster
  accounts.delete(guestId);
  online.delete(guestId);
  revokeSessionsFor(guestId);
  markDirty();
  console.log('[ACCT] tomt gäst-konto', guestId, 'städat (switch →', keepId + ')');
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
  const ownerAcc = ownerId ? accounts.get(ownerId) : null;
  if (ownerId && !ownerAcc) appleIdx.delete(sub);   // index-desync (kontot raderat) → städa, fall igenom till bind
  if (me && ownerAcc && ownerId !== me.id) {
    // Apple-sub tillhör ett ANNAT (existerande) konto. Är `me` bara detta installs tomma
    // gäst-konto → reinstall/byte-av-enhet: SWITCH till det riktiga + städa gästkontot EFTER
    // att vi vet att målet finns. Är `me` ett RIKTIGT konto → taken (ingen kapning).
    if (isEmptyGuest(me)) { reclaimEmptyGuest(me.id, ownerId); return { kind: 'switch', acc: ownerAcc }; }
    return { kind: 'err', code: 'taken' };
  }
  if (me) {
    if (me.appleSub && me.appleSub !== sub) appleIdx.delete(me.appleSub);
    me.appleSub = sub;                                         // bind sub på BEFINTLIGT konto (gäst el. riktigt)
    appleIdx.set(sub, me.id);
    markDirty();
    return { kind: 'bind', what: 'apple_bind', bound: boundOf(me) };
  } else if (ownerAcc) {
    return { kind: 'switch', acc: ownerAcc };   // sub har konto, ingen me → byt
  }
  const acc = createProviderAccount({ appleSub: sub });        // okänd sub + ingen me → skapa (sista utväg)
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
  const ownerAcc = ownerId ? accounts.get(ownerId) : null;
  if (ownerId && !ownerAcc) gcIdx.delete(playerId);   // index-desync (kontot raderat) → städa
  if (me) {
    // VIKTIGT undantag: gcPlayerId som tillhör ANNAT konto → SWITCH, inte taken
    // (GC = reinstall-räddningen: nytt guest-konto byter tillbaka till det gamla).
    // Är `me` detta installs TOMMA gäst-konto → städa bort det (annars spöke kvar).
    if (ownerAcc && ownerId !== me.id) {
      if (isEmptyGuest(me)) reclaimEmptyGuest(me.id, ownerId);
      return { kind: 'switch', acc: ownerAcc };
    }
    if (me.gcPlayerId && me.gcPlayerId !== playerId) gcIdx.delete(me.gcPlayerId);
    me.gcPlayerId = playerId; // TYST bind på BEFINTLIGT konto (gäst el. riktigt)
    gcIdx.set(playerId, me.id);
    markDirty();
    return { kind: 'bind', what: 'gc_bind', bound: boundOf(me) };
  } else if (ownerAcc) {
    return { kind: 'switch', acc: ownerAcc };
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

// ════════════════════════════════════════════════════════════════════════════
// ADMIN-BACKEND (2026-06-19) — skyddad moderations-yta: se alla spelare, banna,
// justera coins/gems/level. Bakom ADMIN_TOKEN (env, konstant-tids-jämförelse).
// ADMIN_TOKEN OSATT → admin-API:t är AVSTÄNGT (503) — aldrig öppet av misstag.
// Dashboard-skalet (GET /admin) serveras utan token (ingen data); ALL data kräver
// token via x-admin-token-headern. isBanned() enforce:as i login-chokepointen.
// ════════════════════════════════════════════════════════════════════════════
function isBanned(acc) { return !!(acc && acc.banned); }

function adminTokenOk(token) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || typeof token !== 'string' || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function adminPlayerRow(acc) {
  return {
    id: acc.id,
    name: acc.name,
    level: acc.level,
    coins: (acc.stats && acc.stats.coins) || 0,
    axp: (acc.stats && acc.stats.axp) || 0,
    alevel: (acc.stats && acc.stats.alevel) || 1,
    gems: (acc.vault && typeof acc.vault.gems === 'number') ? acc.vault.gems : 0,
    matches: (acc.stats && acc.stats.matches) || 0,
    kills: (acc.stats && acc.stats.kills) || 0,
    wins: (acc.stats && acc.stats.wins) || 0,
    lastSeen: acc.lastSeen || 0,
    online: online.has(acc.id),
    banned: !!acc.banned,
    flagged: nameFlagged(acc.name),   // namn-filter: misstänkt olämpligt namn → ⚠ i panelen
    nameHistory: (acc.nameHistory || []).slice(-20),
    badNames: (acc.nameHistory || []).reduce(function (n, e) { return n + (e && !e.ok ? 1 : 0); }, 0),
    bound: boundOf(acc),
  };
}

function adminListPlayers(q) {
  const needle = (q || '').toString().trim().toLowerCase();
  const out = [];
  for (const acc of accounts.values()) {
    if (needle && !(String(acc.id).includes(needle) || (acc.name || '').toLowerCase().includes(needle))) continue;
    out.push(adminPlayerRow(acc));
  }
  out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return out.slice(0, 500);
}

function adminSummary() {
  let total = 0, on = 0, banned = 0, coins = 0, gems = 0, flagged = 0;
  for (const acc of accounts.values()) {
    total++;
    if (online.has(acc.id)) on++;
    if (acc.banned) banned++;
    if (nameFlagged(acc.name)) flagged++;
    coins += (acc.stats && acc.stats.coins) || 0;
    gems += (acc.vault && typeof acc.vault.gems === 'number') ? acc.vault.gems : 0;
  }
  return { total, online: on, banned, coins, gems, flagged };
}

function adminKickSocket(id, code) {
  const ws = online.get(String(id));
  if (!ws) return;
  try { safeSend(ws, { type: 'acct_error', code: code || 'kicked' }); } catch (e) {}
  try { ws.close(); } catch (e) {}
  console.log('[ADMIN] kick', id, '(readyState ' + (ws.readyState != null ? ws.readyState : '?') + ')');
}

// Live-adoption UTAN disconnect: pushar en FÄRSK acct_logged_in (loginPayload) till en ev.
// online-socket så klienten adopterar de admin-satta värdena DIREKT (economyForce/nameForce) —
// ändringen syns in-game på en gång. INGEN ws.close() → ingen match-vräkning, ingen token-revoke
// (onDisconnect körs ej), ingen game-rejoin-väg (som hoppar över re-login). Sätter ws._force* på
// SAMMA socket så den får konsumera flaggan vid nästa acct_update (klienten ekar då adopterade
// värden). Klientens logged_in-lyssnare är rena UI-uppdateringar (FriendsScreen._render_all +
// Menu._on_account_changed) → säkert att re-emitta mid-session, även mitt i en match. Offline →
// no-op (värdena levereras vid spelarens nästa riktiga login via bindSocketToAccount-taggningen).
function adminPushAdoption(acc) {
  const ws = online.get(acc.id);
  if (!ws || ws.readyState !== 1) return false;
  try {
    safeSend(ws, Object.assign({ type: 'acct_logged_in' }, loginPayload(acc)));
    ws._forceEcon = !!acc._economyForce;
    ws._forceName = !!acc._nameForce;
  } catch (e) { return false; }
  console.log('[ADMIN] live-adoption push', acc.id);
  return true;
}

function adminSetBanned(id, banned) {
  const acc = accounts.get(String(id));
  if (!acc) return null;
  acc.banned = !!banned;
  markDirty();
  console.log('[ADMIN] ban', id, '→', acc.banned);
  if (acc.banned) {
    revokeSessionsFor(acc.id);          // ogiltigförklara alla utdelade tokens → ingen replay-window
    adminKickSocket(acc.id, 'banned');  // sparka ut direkt om online
  }
  return adminPlayerRow(acc);
}

function adminSetEconomy(id, fields) {
  if (!/^[0-9]{1,16}$/.test(String(id))) return null;
  const acc = accounts.get(String(id));
  if (!acc) return null;
  const clampN = (v, max) => Math.max(0, Math.min(max, Math.round(+v) || 0));
  if (!acc.stats) acc.stats = { matches: 0, kills: 0, wins: 0 };
  const before = { coins: acc.stats.coins || 0, gems: (acc.vault && acc.vault.gems) || 0, alevel: acc.stats.alevel || 1 };
  if (fields.coins != null) acc.stats.coins = clampN(fields.coins, 99999999);
  if (fields.axp != null) acc.stats.axp = clampN(fields.axp, 99999999);
  if (fields.alevel != null) acc.stats.alevel = Math.max(1, Math.min(999, clampN(fields.alevel, 999)));
  if (fields.gems != null) {
    if (!acc.vault || typeof acc.vault !== 'object') acc.vault = {};
    acc.vault.gems = clampN(fields.gems, 99999999);
  }
  acc.level = computeLevel(acc.stats);
  acc._economyForce = true;   // klienten adopterar serverns värden ovillkorligt vid nästa login
  markDirty();
  adminPushAdoption(acc);  // online? → live re-send av acct_logged_in så ändringen syns in-game direkt
  console.log('[ADMIN] economy', id, '| coins', before.coins, '→', acc.stats.coins,
    '| gems', before.gems, '→', (acc.vault && acc.vault.gems) || 0, '| alevel', before.alevel, '→', acc.stats.alevel);
  return adminPlayerRow(acc);
}

function adminSetName(id, name) {
  if (!/^[0-9]{1,16}$/.test(String(id))) return null;
  const acc = accounts.get(String(id));
  if (!acc) return null;
  const clean = sanitizeName(name);
  if (!clean) return null;
  const before = acc.name;
  acc.name = clean;
  acc._nameForce = true;   // klienten adopterar namnet vid nästa login (annars skriver den tillbaka sitt lokala)
  recordNameAttempt(acc, clean, true, true);   // logga admin-rename i namn-historiken
  markDirty();
  adminPushAdoption(acc);  // online? → live re-send av acct_logged_in så namnet syns in-game direkt
  console.log('[ADMIN] rename', id, '|', before, '→', clean);
  return adminPlayerRow(acc);
}

function adminDeleteAccount(id) {
  if (!/^[0-9]{1,16}$/.test(String(id))) return false;
  const acc = accounts.get(String(id));
  if (!acc) return false;
  acc.banned = true;   // stäng reconnect-fönstret mellan kick och delete (bindSocketToAccount avvisar)
  adminKickSocket(acc.id, 'deleted');
  revokeSessionsFor(acc.id);
  online.delete(acc.id);
  // reversera provider-index (indexAccount) så stale uppslag inte pekar på raderat konto
  if (acc.email) emailIdx.delete(acc.email);
  if (acc.googleSub) googleIdx.delete(acc.googleSub);
  if (acc.appleSub) appleIdx.delete(acc.appleSub);
  if (acc.gcPlayerId) gcIdx.delete(acc.gcPlayerId);
  // rensa kvarvarande referenser ur andras vän-/förfrågnings-listor (annars spök-vänskap
  // om ett nytt konto senare får samma id)
  for (const other of accounts.values()) {
    if (other.id === acc.id) continue;
    arrRemove(other.friends, acc.id);
    arrRemove(other.reqIn, acc.id);
    arrRemove(other.reqOut, acc.id);
  }
  accounts.delete(acc.id);
  markDirty();
  console.log('[ADMIN] delete', id, '(', acc.name, ')');
  return true;
}

function _adminReadBody(req) {
  return new Promise((resolve) => {
    let body = ''; let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      body += c;
      if (body.length > 16384) { tooLarge = true; try { req.destroy(); } catch (e) {} resolve(null); }
    });
    req.on('end', () => { if (tooLarge) return; try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function _adminJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// brute-force-broms (per-IP): 10 auth-fel → 15 min block. In-memory, transient.
const _adminFails = new Map();
function _adminIp(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
}
function _adminThrottled(ip) { const e = _adminFails.get(ip); return !!(e && e.until && Date.now() < e.until); }
function _adminFail(ip) {
  const e = _adminFails.get(ip) || { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= 10) { e.until = Date.now() + 15 * 60 * 1000; e.n = 0; }
  _adminFails.set(ip, e);
}

async function handleAdminHttp(req, res) {
  // admin-ytan är SAME-ORIGIN (dashboard fetchar från samma host) → ta bort den globala
  // wildcard-CORS:en så ingen cross-origin-sida kan läsa admin-svar med en stulen token.
  try { res.removeHeader('Access-Control-Allow-Origin'); } catch (e) {}
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // ADMIN_TOKEN osatt → HELA admin-ytan osynlig (404), även dashboard-skalet (ingen recon).
  if (!process.env.ADMIN_TOKEN) { res.writeHead(404); res.end(); return; }
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (path === '/admin' || path === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ADMIN_HTML);
    return;
  }
  const ip = _adminIp(req);
  if (_adminThrottled(ip)) { _adminJson(res, 429, { error: 'too many attempts' }); return; }
  // token ENBART via header (aldrig query-param → ingen log/referer/historik-läcka)
  const token = req.headers['x-admin-token'] || '';
  if (!adminTokenOk(token)) { _adminFail(ip); _adminJson(res, 401, { error: 'unauthorized' }); return; }
  _adminFails.delete(ip);   // lyckad auth → nolla räknaren

  if (req.method === 'GET' && path === '/admin/api/players') {
    _adminJson(res, 200, { players: adminListPlayers(u.searchParams.get('q')), summary: adminSummary() });
    return;
  }
  if (req.method === 'POST' && path === '/admin/api/ban') {
    const body = await _adminReadBody(req);
    if (!body || !body.id) { _adminJson(res, 400, { error: 'bad request' }); return; }
    const row = adminSetBanned(body.id, !!body.banned);
    if (!row) { _adminJson(res, 404, { error: 'not found' }); return; }
    _adminJson(res, 200, { player: row });
    return;
  }
  if (req.method === 'POST' && path === '/admin/api/economy') {
    const body = await _adminReadBody(req);
    if (!body || !body.id) { _adminJson(res, 400, { error: 'bad request' }); return; }
    const row = adminSetEconomy(body.id, body);
    if (!row) { _adminJson(res, 404, { error: 'not found' }); return; }
    _adminJson(res, 200, { player: row });
    return;
  }
  if (req.method === 'POST' && path === '/admin/api/rename') {
    const body = await _adminReadBody(req);
    if (!body || !body.id || typeof body.name !== 'string') { _adminJson(res, 400, { error: 'bad request' }); return; }
    const row = adminSetName(body.id, body.name);
    if (!row) { _adminJson(res, 404, { error: 'not found eller ogiltigt namn (2-16 tecken)' }); return; }
    _adminJson(res, 200, { player: row });
    return;
  }
  if (req.method === 'POST' && path === '/admin/api/delete') {
    const body = await _adminReadBody(req);
    if (!body || !body.id) { _adminJson(res, 400, { error: 'bad request' }); return; }
    const ok = adminDeleteAccount(body.id);
    if (!ok) { _adminJson(res, 404, { error: 'not found' }); return; }
    _adminJson(res, 200, { deleted: true });
    return;
  }
  _adminJson(res, 404, { error: 'unknown admin route' });
}

const ADMIN_HTML = `<!doctype html><html lang="sv"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>WarParty · Admin</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{
 --bg:#0a0c11;--panel:#12151e;--panel2:#171b26;--line:#232a39;--line2:#2e3749;
 --txt:#e9ecf3;--mut:#8b93a8;--mut2:#5f6678;
 --gold:#f5b53f;--gold2:#ffd16b;--danger:#ff5d6c;--ok:#46d39a;--on:#3ddc84;--blue:#5aa9ff;
 --r:14px;--sh:0 8px 30px rgba(0,0,0,.45)}
html,body{margin:0;height:100%}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:
 radial-gradient(1200px 600px at 80% -10%,#1a2030 0,transparent 60%),var(--bg);
 color:var(--txt);font-size:14px;-webkit-font-smoothing:antialiased;padding-bottom:env(safe-area-inset-bottom)}
button{font:inherit;cursor:pointer;border:0;border-radius:10px;color:var(--txt);background:var(--panel2);transition:.15s}
button:active{transform:scale(.97)}
input,select{font:inherit;color:var(--txt);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 12px;outline:none;transition:.15s}
input:focus,select:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(245,181,63,.15)}
.mut{color:var(--mut)}.tiny{font-size:11px}
.hide{display:none!important}
/* LOGIN */
#login{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;
 background:radial-gradient(900px 500px at 50% 0,#171d2b 0,var(--bg) 60%);z-index:50}
#login .card{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);
 border-radius:20px;padding:28px 24px;box-shadow:var(--sh);text-align:center}
#login .lock{width:58px;height:58px;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;
 justify-content:center;font-size:26px;background:linear-gradient(160deg,#23283a,#161a26);border:1px solid var(--line2)}
#login h1{margin:0 0 4px;font-size:19px;letter-spacing:.3px}
#login p{margin:0 0 20px;color:var(--mut);font-size:13px}
#login input{width:100%;text-align:center;letter-spacing:2px;margin-bottom:12px}
#login button{width:100%;padding:13px;font-weight:700;background:linear-gradient(135deg,var(--gold),#e6a32b);color:#1a1205}
#login .err{color:var(--danger);font-size:12.5px;min-height:18px;margin-top:10px}
/* HEADER */
header{position:sticky;top:0;z-index:20;background:rgba(10,12,17,.86);backdrop-filter:blur(12px);
 border-bottom:1px solid var(--line);padding:14px 16px calc(14px);padding-top:calc(14px + env(safe-area-inset-top))}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.brand .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--gold),#d8881f);
 display:flex;align-items:center;justify-content:center;font-weight:800;color:#1a1205}
.brand h1{font-size:16px;margin:0;font-weight:700;flex:1}
.brand .logout{padding:7px 12px;font-size:12.5px;color:var(--mut);background:transparent;border:1px solid var(--line)}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:13px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 11px}
.stat .n{font-size:18px;font-weight:800;line-height:1.1}
.stat .l{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.6px;margin-top:3px}
.stat.on .n{color:var(--on)}.stat.ban .n{color:var(--danger)}.stat.coin .n{color:var(--gold)}.stat.gem .n{color:var(--blue)}
.tools{display:flex;gap:8px;align-items:center}
.search{position:relative;flex:1}
.search input{width:100%;padding-left:36px}
.search .ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--mut2)}
.tools select{padding:11px 10px}
.tools .rf{padding:11px 13px;border:1px solid var(--line)}
/* LIST */
main{padding:14px 16px 40px;max-width:920px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:11px}
.pc{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:13px;cursor:pointer;
 transition:.16s;display:flex;flex-direction:column;gap:10px;position:relative;overflow:hidden}
.pc:hover{border-color:var(--line2);transform:translateY(-2px);box-shadow:var(--sh)}
.pc.bn{border-color:rgba(255,93,108,.4)}
.pc .top{display:flex;align-items:center;gap:11px}
.av{width:42px;height:42px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;
 font-weight:800;font-size:17px;color:#0c0e14}
.pc .nm{font-weight:700;font-size:14.5px;display:flex;align-items:center;gap:7px;line-height:1.15}
.pc .id{color:var(--mut);font-size:11.5px;font-variant-numeric:tabular-nums;margin-top:2px}
.badge{font-size:10px;font-weight:800;padding:3px 7px;border-radius:999px;letter-spacing:.4px;text-transform:uppercase}
.b-on{background:rgba(61,220,132,.16);color:var(--on)}
.b-off{background:#222838;color:var(--mut)}
.b-ban{background:rgba(255,93,108,.16);color:var(--danger)}
.flag-ic{color:var(--gold);font-size:13px;cursor:help}
.rf.act{background:rgba(245,181,63,.18);border-color:var(--gold);color:var(--gold)}
.dotL{width:7px;height:7px;border-radius:50%;display:inline-block}
.dotL.g{background:var(--on);box-shadow:0 0 7px var(--on)}.dotL.o{background:var(--mut2)}
.pc .row{display:flex;gap:8px}
.kv{flex:1;background:var(--panel2);border-radius:9px;padding:7px 9px}
.kv .k{font-size:9.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
.kv .v{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;margin-top:1px}
.kv .v.gold{color:var(--gold)}.kv .v.blue{color:var(--blue)}
.pc .foot{display:flex;justify-content:space-between;align-items:center;color:var(--mut);font-size:11.5px}
.empty{text-align:center;color:var(--mut);padding:60px 0}
.empty .big{font-size:34px;margin-bottom:8px;opacity:.5}
/* DRAWER */
.scrim{position:fixed;inset:0;background:rgba(4,6,10,.62);backdrop-filter:blur(3px);z-index:30;opacity:0;
 pointer-events:none;transition:.22s}
.scrim.show{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(440px,100%);background:var(--panel);
 border-left:1px solid var(--line);z-index:31;transform:translateX(100%);transition:transform .26s cubic-bezier(.4,0,.2,1);
 display:flex;flex-direction:column;box-shadow:var(--sh)}
.drawer.show{transform:none}
.dh{padding:18px 18px 16px;padding-top:calc(18px + env(safe-area-inset-top));border-bottom:1px solid var(--line);
 display:flex;gap:13px;align-items:center}
.dh .av{width:52px;height:52px;border-radius:14px;font-size:21px}
.dh .nm{font-size:18px;font-weight:800}
.dh .id{color:var(--mut);font-size:12.5px;margin-top:3px;display:flex;align-items:center;gap:6px;cursor:pointer}
.dh .id .cp{font-size:11px;color:var(--gold)}
.dh .x{margin-left:auto;align-self:flex-start;width:34px;height:34px;border-radius:10px;font-size:18px;
 background:var(--panel2);color:var(--mut);display:flex;align-items:center;justify-content:center}
.db{flex:1;overflow:auto;padding:18px}
.sec{margin-bottom:22px}
.sec h3{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut);margin:0 0 11px;font-weight:700}
.sgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.sgrid .kv{background:var(--panel2);border:1px solid var(--line)}
.eco{display:flex;flex-direction:column;gap:11px}
.field{display:flex;align-items:center;gap:10px}
.field label{width:78px;font-size:13px;color:var(--mut)}
.stepper{flex:1;display:flex;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.stepper button{width:42px;height:42px;font-size:20px;background:transparent;color:var(--gold);border-radius:0}
.stepper button:hover{background:#1d2330}
.stepper input{flex:1;border:0;border-radius:0;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;background:transparent}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px 88px}
.presets button{padding:5px 10px;font-size:11.5px;background:var(--panel2);border:1px solid var(--line);color:var(--mut)}
.presets button:hover{border-color:var(--gold);color:var(--gold)}
.save{width:100%;padding:13px;font-weight:800;background:linear-gradient(135deg,var(--gold),#e6a32b);color:#1a1205;margin-top:4px}
.save:disabled{opacity:.45;filter:grayscale(.5)}
.mod{display:flex;gap:9px}
.mod button{flex:1;padding:13px;font-weight:700;border:1px solid var(--line)}
.btn-ban{background:rgba(255,93,108,.12);color:var(--danger);border-color:rgba(255,93,108,.35)}
.btn-unban{background:rgba(70,211,154,.12);color:var(--ok);border-color:rgba(70,211,154,.35)}
.btn-kick{background:var(--panel2);color:var(--mut)}
.prov{display:flex;gap:6px;flex-wrap:wrap}
.prov span{font-size:11px;padding:4px 9px;border-radius:8px;background:var(--panel2);color:var(--mut);border:1px solid var(--line)}
.prov span.y{color:var(--ok);border-color:rgba(70,211,154,.3)}
.nhist{display:flex;flex-direction:column;gap:5px}
.nhrow{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:9px}
.nhname{flex:1;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nhname.blk{color:var(--danger);text-decoration:line-through;opacity:.9}
.nhtag{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.3px}
.nhtag.ok{background:rgba(70,211,154,.14);color:var(--ok)}
.nhtag.blk{background:rgba(255,93,108,.16);color:var(--danger)}
.nhtag.adm{background:rgba(245,181,63,.16);color:var(--gold)}
.nhtime{font-size:11px;color:var(--mut);min-width:54px;text-align:right}
/* CONFIRM */
.cf{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:24px;
 background:rgba(4,6,10,.7);opacity:0;pointer-events:none;transition:.18s}
.cf.show{opacity:1;pointer-events:auto}
.cf .box{background:var(--panel);border:1px solid var(--line2);border-radius:18px;padding:22px;max-width:340px;width:100%;text-align:center;box-shadow:var(--sh)}
.cf h4{margin:0 0 8px;font-size:17px}.cf p{margin:0 0 18px;color:var(--mut);font-size:13.5px;line-height:1.5}
.cf .btns{display:flex;gap:9px}.cf .btns button{flex:1;padding:12px;font-weight:700}
.cf .no{background:var(--panel2);color:var(--mut)}.cf .yes{color:#fff}
.cf .yes.danger{background:var(--danger)}.cf .yes.gold{background:var(--gold);color:#1a1205}
/* TOAST */
#toasts{position:fixed;left:0;right:0;bottom:calc(18px + env(safe-area-inset-bottom));z-index:60;
 display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;padding:0 16px}
.toast{background:var(--panel2);border:1px solid var(--line2);border-radius:12px;padding:11px 16px;font-size:13.5px;
 font-weight:600;box-shadow:var(--sh);display:flex;align-items:center;gap:9px;animation:tin .25s;max-width:420px}
.toast.ok{border-color:rgba(70,211,154,.4)}.toast.err{border-color:rgba(255,93,108,.4)}
.toast .i{font-size:16px}
@keyframes tin{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media(max-width:560px){.stats{grid-template-columns:repeat(3,1fr)}.stat:nth-child(4),.stat:nth-child(5){display:none}
 .brand h1{font-size:15px}.grid{grid-template-columns:1fr}}
</style></head><body>

<div id="login"><div class="card">
 <div class="lock">&#128274;</div>
 <h1>WarParty Admin</h1>
 <p>Ange admin-token för att fortsätta</p>
 <input id="ltok" type="password" placeholder="admin-token" autocomplete="off" autocapitalize="off">
 <button id="lbtn">Lås upp</button>
 <div class="err" id="lerr"></div>
</div></div>

<div id="app" class="hide">
 <header>
  <div class="brand">
   <div class="dot">W</div><h1>Admin-panel</h1>
   <button class="logout" id="logout">Logga ut</button>
  </div>
  <div class="stats" id="stats"></div>
  <div class="tools">
   <div class="search"><span class="ico">&#128269;</span><input id="q" placeholder="Sök namn eller id…" autocomplete="off"></div>
   <select id="sort">
    <option value="lastSeen">Senast online</option>
    <option value="coins">Mest coins</option>
    <option value="gems">Mest gems</option>
    <option value="alevel">Högst nivå</option>
    <option value="name">Namn A–Ö</option>
   </select>
   <button class="rf" id="flagf" title="Visa bara flaggade namn">&#9888;</button>
   <button class="rf" id="refresh" title="Uppdatera">&#8635;</button>
  </div>
 </header>
 <main><div class="grid" id="grid"></div><div class="empty hide" id="empty"><div class="big">&#128100;</div>Inga spelare matchar</div></main>
</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer"></aside>
<div class="cf" id="cf"></div>
<div id="toasts"></div>

<script>
var TOK="",DATA=[],CUR=null,FLAGONLY=false;
function $(i){return document.getElementById(i)}
function el(t,c,tx){var e=document.createElement(t);if(c)e.className=c;if(tx!=null)e.textContent=tx;return e}
function fmt(n){return (n||0).toLocaleString("sv-SE")}
function ago(ms){if(!ms)return "aldrig";var s=(Date.now()-ms)/1000;if(s<60)return Math.round(s)+"s sen";
 if(s<3600)return Math.round(s/60)+"m sen";if(s<86400)return Math.round(s/3600)+"h sen";var d=Math.round(s/86400);
 return d<30?d+"d sen":Math.round(d/30)+"mån sen"}
function hue(id){var h=0,s=String(id);for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h}
function avStyle(id){var h=hue(id);return "background:linear-gradient(135deg,hsl("+h+",62%,58%),hsl("+((h+40)%360)+",62%,46%))"}
function initial(nm){return (nm||"?").trim().charAt(0).toUpperCase()||"?"}
function toast(msg,kind){var t=el("div","toast "+(kind||""));var i=el("span","i");i.textContent=kind==="err"?"⚠":kind==="ok"?"✓":"ℹ";
 t.appendChild(i);t.appendChild(el("span",null,msg));$("toasts").appendChild(t);setTimeout(function(){t.style.opacity=0;t.style.transform="translateY(10px)";t.style.transition=".25s";setTimeout(function(){t.remove()},260)},2600)}
function hdr(){return {"x-admin-token":TOK,"Content-Type":"application/json"}}

/* AUTH */
(function(){var t=sessionStorage.getItem("wpadmin");if(t){TOK=t;boot()}})();
$("lbtn").onclick=function(){TOK=$("ltok").value.trim();if(!TOK)return;boot(true)};
$("ltok").addEventListener("keydown",function(e){if(e.key==="Enter")$("lbtn").click()});
$("logout").onclick=function(){TOK="";sessionStorage.removeItem("wpadmin");$("app").classList.add("hide");$("login").classList.remove("hide");$("ltok").value=""};
function boot(fromLogin){load(function(ok){
 if(ok){sessionStorage.setItem("wpadmin",TOK);$("login").classList.add("hide");$("app").classList.remove("hide")}
 else if(fromLogin){$("lerr").textContent="Fel token";}
 else{$("login").classList.remove("hide");$("app").classList.add("hide")}
})}

/* LOAD */
var _t;
$("q").addEventListener("input",function(){clearTimeout(_t);_t=setTimeout(function(){load()},220)});
$("sort").addEventListener("change",render);
 $("flagf").addEventListener("click",function(){FLAGONLY=!FLAGONLY;$("flagf").classList.toggle("act",FLAGONLY);render()});
$("refresh").onclick=function(){load(function(){toast("Uppdaterad","ok")})};
function load(cb){
 fetch("/admin/api/players?q="+encodeURIComponent($("q").value||""),{headers:hdr()}).then(function(r){
  if(r.status===200)return r.json();
  if(r.status===429){toast("För många försök — vänta","err")}
  throw r.status;
 }).then(function(d){DATA=d.players||[];renderStats(d.summary);render();if(cb)cb(true)})
 .catch(function(){if(cb)cb(false)})
}
function renderStats(s){
 s=s||{};var box=$("stats");box.textContent="";
 var cards=[["",s.total||DATA.length,"Spelare"],["on",s.online||0,"Online"],["ban",s.banned||0,"Bannade"],
  ["coin",fmt(s.coins),"Σ Coins"],["gem",fmt(s.gems),"Σ Gems"]];
 cards.forEach(function(c){var d=el("div","stat "+c[0]);d.appendChild(el("div","n",typeof c[1]==="number"?fmt(c[1]):c[1]));
  d.appendChild(el("div","l",c[2]));box.appendChild(d)})
}
function render(){
 var sort=$("sort").value,rows=DATA.slice();
 if(FLAGONLY)rows=rows.filter(function(p){return p.flagged});
 rows.sort(function(a,b){if(sort==="name")return (a.name||"").localeCompare(b.name||"");return (b[sort]||0)-(a[sort]||0)});
 var g=$("grid");g.textContent="";
 $("empty").classList.toggle("hide",rows.length>0);
 rows.forEach(function(p){g.appendChild(card(p))})
}
function card(p){
 var c=el("div","pc"+(p.banned?" bn":""));c.onclick=function(){openDrawer(p)};
 var top=el("div","top");var av=el("div","av",initial(p.name));av.setAttribute("style",avStyle(p.id));top.appendChild(av);
 var info=el("div");info.style.flex="1";info.style.minWidth="0";
 var nm=el("div","nm");nm.appendChild(el("span",null,p.name||"(namnlös)"));if(p.flagged){var fw=el("span","flag-ic","⚠");fw.title="Misstänkt olämpligt namn";nm.appendChild(fw)}info.appendChild(nm);
 info.appendChild(el("div","id","#"+p.id));top.appendChild(info);
 top.appendChild(badge(p));c.appendChild(top);
 var row=el("div","row");
 row.appendChild(kv("Coins",fmt(p.coins),"gold"));row.appendChild(kv("Gems",fmt(p.gems),"blue"));row.appendChild(kv("Nivå",p.alevel||1));
 c.appendChild(row);
 var f=el("div","foot");f.appendChild(el("span",null,"Lvl "+(p.level||1)+" · "+fmt(p.kills)+" kills"));f.appendChild(el("span",null,ago(p.lastSeen)));
 c.appendChild(f);return c
}
function badge(p){
 if(p.banned){var b=el("span","badge b-ban","Bannad");return b}
 var s=el("span","badge "+(p.online?"b-on":"b-off"));var d=el("span","dotL "+(p.online?"g":"o"));s.appendChild(d);
 s.appendChild(document.createTextNode(p.online?"Online":"Offline"));return s
}
function kv(k,v,cls){var d=el("div","kv");d.appendChild(el("div","k",k));var vv=el("div","v"+(cls?" "+cls:""),String(v));d.appendChild(vv);return d}

/* DRAWER */
function openDrawer(p){CUR=p;var d=$("drawer");d.textContent="";
 var h=el("div","dh");var av=el("div","av",initial(p.name));av.setAttribute("style",avStyle(p.id));h.appendChild(av);
 var ti=el("div");ti.style.flex="1";ti.style.minWidth="0";ti.appendChild(el("div","nm",p.name||"(namnlös)"));
 var id=el("div","id");id.appendChild(el("span",null,"#"+p.id));var cp=el("span","cp","kopiera");id.appendChild(cp);
 id.onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(p.id);toast("ID kopierat","ok")};ti.appendChild(id);h.appendChild(ti);
 var x=el("button","x","×");x.onclick=closeDrawer;h.appendChild(x);d.appendChild(h);

 var body=el("div","db");
 // status
 var st=el("div","sec");st.appendChild(secTitle("Status"));var sr=el("div");sr.style.display="flex";sr.style.gap="8px";sr.style.alignItems="center";
 sr.appendChild(badge(p));sr.appendChild(el("span","mut tiny",ago(p.lastSeen)));st.appendChild(sr);body.appendChild(st);
 var rn=el("div","sec");rn.appendChild(secTitle("Byt namn"));var rf=el("div","field");
 var rinp=el("input");rinp.type="text";rinp.value=p.name||"";rinp.maxLength=16;rinp.style.flex="1";rf.appendChild(rinp);
 var rbtn=el("button",null,"Spara");rbtn.style.cssText="padding:11px 16px;background:var(--panel2);border:1px solid var(--line)";
 rbtn.onclick=function(){var nn=(rinp.value||"").trim();if(nn.length<2){toast("Minst 2 tecken","err");return}postJSON("/admin/api/rename",{id:p.id,name:nn},function(ok,r){if(ok){toast("Namn sparat","ok");mergeRow(r.player);closeDrawer()}else toast("Ogiltigt namn","err")})};
 rf.appendChild(rbtn);rn.appendChild(rf);body.appendChild(rn);
 if(p.nameHistory&&p.nameHistory.length){
  var nh=el("div","sec");var ht="Namn-historik ("+p.nameHistory.length+")";if(p.badNames)ht+=" · "+p.badNames+" blockerade";nh.appendChild(secTitle(ht));
  var nl=el("div","nhist");
  p.nameHistory.slice().reverse().forEach(function(e){
   var row=el("div","nhrow");
   var nm2=el("span","nhname"+(e.ok?"":" blk"),e.name);row.appendChild(nm2);
   var tag=el("span","nhtag "+(e.adm?"adm":e.ok?"ok":"blk"),e.adm?"admin":e.ok?"ok":"blockerad");row.appendChild(tag);
   row.appendChild(el("span","nhtime",ago(e.t)));
   nl.appendChild(row);
  });
  nh.appendChild(nl);body.appendChild(nh);
 }
 // identity
 var prov=[["E-post",p.bound&&p.bound.email],["Google",p.bound&&p.bound.google],["Apple",p.bound&&p.bound.apple],["Game Center",p.bound&&p.bound.gc]];
 var ps=el("div","sec");ps.appendChild(secTitle("Inloggning"));var pw=el("div","prov");
 prov.forEach(function(x){var s=el("span",x[1]?"y":null,(x[1]?"✓ ":"")+x[0]);pw.appendChild(s)});ps.appendChild(pw);body.appendChild(ps);
 // stats
 var stg=el("div","sec");stg.appendChild(secTitle("Statistik"));var sg=el("div","sgrid");
 sg.appendChild(kv("Matcher",fmt(p.matches)));sg.appendChild(kv("Kills",fmt(p.kills)));sg.appendChild(kv("Wins",fmt(p.wins)));
 sg.appendChild(kv("Konto-XP",fmt(p.axp)));sg.appendChild(kv("Lvl (stat)",p.level||1));sg.appendChild(kv("Konto-niv",p.alevel||1));
 stg.appendChild(sg);body.appendChild(stg);
 // economy editor
 var ec=el("div","sec");ec.appendChild(secTitle("Justera ekonomi"));var ew=el("div","eco");
 var fc=stepperField("Coins","coins",p.coins,[["0",0],["+1k",p.coins+1000],["+10k",p.coins+10000]]);
 var fg=stepperField("Gems","gems",p.gems,[["0",0],["+100",p.gems+100],["+1000",p.gems+1000]]);
 var fl=stepperField("Konto-niv","alevel",p.alevel||1,[["1",1],["+5",(p.alevel||1)+5],["50",50]]);
 ew.appendChild(fc.field);ew.appendChild(fc.presets);ew.appendChild(fg.field);ew.appendChild(fg.presets);ew.appendChild(fl.field);ew.appendChild(fl.presets);
 var save=el("button","save","Spara ändringar");save.disabled=true;
 function dirty(){var ch=fc.val()!==p.coins||fg.val()!==p.gems||fl.val()!==(p.alevel||1);save.disabled=!ch;
  save.textContent=ch?"Spara ändringar":"Inga ändringar"}
 fc.onChange=dirty;fg.onChange=dirty;fl.onChange=dirty;dirty();
 save.onclick=function(){save.disabled=true;save.textContent="Sparar…";
  // skicka BARA ändrade fält (annars skulle t.ex. en coins-ändring även skriva alevel/gems)
  var body={id:p.id};
  if(fc.val()!==p.coins)body.coins=fc.val();
  if(fg.val()!==p.gems)body.gems=fg.val();
  if(fl.val()!==(p.alevel||1))body.alevel=fl.val();
  postJSON("/admin/api/economy",body,function(ok,r){
   if(ok){toast("Ekonomi sparad — gäller vid spelarens nästa login","ok");mergeRow(r.player);closeDrawer()}
   else{toast("Kunde inte spara","err");save.disabled=false;save.textContent="Spara ändringar"}})};
 ew.appendChild(save);ec.appendChild(ew);body.appendChild(ec);
 // moderation
 var mo=el("div","sec");mo.appendChild(secTitle("Moderering"));var mw=el("div","mod");
 var banBtn=el("button",p.banned?"btn-unban":"btn-ban",p.banned?"Avbanna spelare":"Banna spelare");
 banBtn.onclick=function(){confirmBox(p.banned?"Avbanna "+(p.name||p.id)+"?":"Banna "+(p.name||p.id)+"?",
   p.banned?"Spelaren får tillgång till sitt konto igen.":"Kontot låses, alla tokens revokeras och spelaren sparkas ut direkt.",
   p.banned?"Avbanna":"Banna",p.banned?"gold":"danger",function(){
    postJSON("/admin/api/ban",{id:p.id,banned:!p.banned},function(ok,r){
     if(ok){toast(p.banned?"Avbannad":"Bannad","ok");mergeRow(r.player);closeDrawer()}else toast("Misslyckades","err")})})};
 mw.appendChild(banBtn);
 var delBtn=el("button","btn-kick","Radera");delBtn.style.color="var(--danger)";
 delBtn.onclick=function(){confirmBox("Radera "+(p.name||p.id)+"?","Kontot raderas permanent och kan inte återställas. Använd för skräp-/test-konton.","Radera permanent","danger",function(){postJSON("/admin/api/delete",{id:p.id},function(ok){if(ok){toast("Kontot raderat","ok");closeDrawer();load()}else toast("Misslyckades","err")})})};
 mw.appendChild(delBtn);
 mo.appendChild(mw);body.appendChild(mo);
 d.appendChild(body);
 $("scrim").classList.add("show");d.classList.add("show")
}
function secTitle(t){return el("h3",null,t)}
function stepperField(label,key,val,presets){
 var field=el("div","field");field.appendChild(el("label",null,label));
 var st=el("div","stepper");var minus=el("button",null,"−");var inp=el("input");inp.type="text";inp.inputMode="numeric";inp.value=val;
 var plus=el("button",null,"+");st.appendChild(minus);st.appendChild(inp);st.appendChild(plus);field.appendChild(st);
 var obj={field:field,onChange:null,val:function(){var n=parseInt((inp.value||"0").replace(/\s/g,""),10);return isNaN(n)?0:Math.max(0,n)}};
 var step=key==="gems"?50:key==="alevel"?1:500;
 function set(v){inp.value=Math.max(0,v);if(obj.onChange)obj.onChange()}
 minus.onclick=function(){set(obj.val()-step)};plus.onclick=function(){set(obj.val()+step)};
 inp.addEventListener("input",function(){if(obj.onChange)obj.onChange()});
 var pr=el("div","presets");presets.forEach(function(x){var b=el("button",null,x[0]);b.onclick=function(){set(x[1])};pr.appendChild(b)});
 obj.presets=pr;return obj
}
function closeDrawer(){$("drawer").classList.remove("show");$("scrim").classList.remove("show")}
$("scrim").onclick=closeDrawer;
document.addEventListener("keydown",function(e){if(e.key==="Escape")closeDrawer()});
function mergeRow(np){if(!np)return load();for(var i=0;i<DATA.length;i++)if(DATA[i].id===np.id){DATA[i]=np;break}render()}

/* CONFIRM + POST */
function confirmBox(title,msg,yesLabel,kind,onYes){
 var c=$("cf");c.textContent="";var box=el("div","box");box.appendChild(el("h4",null,title));box.appendChild(el("p",null,msg));
 var btns=el("div","btns");var no=el("button","no","Avbryt");no.onclick=function(){c.classList.remove("show")};
 var yes=el("button","yes "+(kind||"gold"),yesLabel);yes.onclick=function(){c.classList.remove("show");onYes()};
 btns.appendChild(no);btns.appendChild(yes);box.appendChild(btns);c.appendChild(box);c.classList.add("show")}
$("cf").onclick=function(e){if(e.target===this)this.classList.remove("show")};
function postJSON(url,body,cb){fetch(url,{method:"POST",headers:hdr(),body:JSON.stringify(body)}).then(function(r){
 return r.json().then(function(j){cb(r.ok,j)}).catch(function(){cb(r.ok,{})})}).catch(function(){cb(false,{})})}
</script></body></html>`;

module.exports = { handle, onDisconnect, presenceChanged, handleGoogleRedirect, handleGoogleCallback, handleSessionHttp, wsForAccount, handleAdminHttp, creditMatchEndXp };
