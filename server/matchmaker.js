'use strict';
// ============================================================================
// MATCHMAKING-KÖ (Mobile-Legends-stil, 2026-06-13) — fas 1: server-kärnan.
// Spelare (solo ELLER grupp) söker per läge; servern poolar dem och formar en
// match vid TARGET-storlek → ACCEPT-fas (10s, alla måste acceptera) → skapar rum,
// placerar alla, sätter lag, startar simen → 'match_ready' till var och en.
// Region = IMPLICIT (denna server-instans = en region; varje Fly-app poolar sina
// egna anslutna spelare). INGA bots (användarval — väntar på riktiga spelare).
//
// Ticket-modell stödjer N medlemmar → grupper (fas 2) slottar in som EN ticket
// som hålls ihop + samma lag. Fas 1 testas med solo-tickets (size 1).
// ============================================================================

// Lobby = party (ML-stil): matchmakern köar en HEL lobby (room.members) som en
// ticket — inget separat grupp-lager behövs (groups.js ligger kvar men oanvänt).

const groups = require('./groups');   // AUDIT C268: vän-baserad party-state måste konsumeras vid köning

let H = null; // { send, rooms, createSim, startSim, generateCode, presenceChanged?, broadcastPublicRooms? }
function setHelpers(h) { H = h; }

// target = MINSTA antal RIKTIGA spelare för att starta (ej fulla lobbyn — liten
// spelarbas + inga bots → annars fyller kön aldrig). Tunas vid behov.
const MATCH_TARGET = {
  tdm: 4, ctf: 4, siege: 4, koth: 4, gungame: 4, juggernaut: 4, battleroyale: 6,
  survivors: 2, castledefense: 2, heist: 2, story: 2, endless: 2, bossrush: 2,
};
const TEAM_MODES = new Set(['tdm', 'ctf', 'siege']);
// sim_start-opts per läge (server-side start; speglar klientens sim_start-flaggor)
const MODE_OPTS = {
  tdm: { tdm: true, tdmTargetKills: 30 },
  ctf: { ctf: true, ctfTargetCaptures: 3 },
  siege: { siege: true },
  koth: { koth: true },
  gungame: { gungame: true },
  juggernaut: { juggernaut: true },
  battleroyale: { battleroyale: true, brPredrop: true },   // plane-drop PÅ (diagnostiserar klient-hängningen — ende spelaren är dev)
  survivors: { survivors: true, survivorsDurationSec: 600 },
  castledefense: { castledefense: true },
  heist: { heist: true },
  story: { mode: 'story', wave: 1 },
};

const ACCEPT_MS = 10000;
const queues = new Map();    // mode → [ticket]   (FIFO)
const accepting = new Map(); // matchId → { mode, tickets, accepts:Set, members:[ws], timer }
let _midSeq = 1;

function targetFor(mode) { return MATCH_TARGET[mode] || 0; }
function qFor(mode) { let q = queues.get(mode); if (!q) { q = []; queues.set(mode, q); } return q; }
function ticketOf(ws) { return ws._mmTicket || null; }
function sizeOf(t) { return t.members.length; }

// ── Kö-API (anropas från server.js message-handler) ──────────────────────────

// Solo (fas 1) eller grupp (fas 2): members = [ws,...]. Returnerar fel-kod el. null.
function joinQueue(members, mode) {
  if (!targetFor(mode)) return 'badmode';
  const T = targetFor(mode);
  // grupp större än lägets lag/storlek kan aldrig matcha → neka
  const cap = TEAM_MODES.has(mode) ? (T / 2) : T;
  if (members.length > cap) return 'partytoobig';
  // AUDIT C313: någon mitt i accept-fasen (_mmMatchId satt) får INTE köa om — det skulle
  // dra leave()→declineMatch och lösa upp hela pending-matchen för alla andra (dubbel-tap /
  // läges-byte under match_found). Neka istället; klienten avbryter accepten explicit.
  for (const ws of members) {
    if (ws._mmMatchId) return 'inaccept';
  }
  // någon i gruppen redan i en STARTAD match → neka (lobby = OK, det är ju partyt)
  for (const ws of members) {
    if (ws._mmTicket) leave(ws);            // re-queue: släpp gammal ticket först (endast kö-tickets — mid-accept nekades ovan)
    const r = ws.roomCode ? H.rooms.get(ws.roomCode) : null;
    // #23: en sim i 15s-ended-fönstret räknas INTE som "i match" — spelaren sitter
    // i post-game-lobbyn och ska kunna köa igen (H.simEnded exponeras av server.js).
    if (r && r.meta && r.meta.started && !(H && H.simEnded && H.simEnded(r))) return 'inroom';
  }
  const ticket = { members: members.slice(), mode, joinedAt: Date.now(), size: members.length };
  for (const ws of members) ws._mmTicket = ticket;
  qFor(mode).push(ticket);
  for (const ws of members) send(ws, { type: 'queue_joined', mode, target: T, size: members.length });
  broadcastQueueStatus(mode);
  tryForm(mode);
  return null;
}

function cancelQueue(ws) {
  const t = ticketOf(ws);
  if (!t) return;
  const mode = t.mode;
  removeTicket(t);
  for (const m of t.members) { m._mmTicket = null; send(m, { type: 'queue_left' }); }
  broadcastQueueStatus(mode);
}

function removeTicket(t) {
  const q = queues.get(t.mode);
  if (!q) return;
  const i = q.indexOf(t);
  if (i >= 0) q.splice(i, 1);
}

// disconnect/leave: städa ur kö OCH ur ev. pågående accept-fas
function leave(ws) {
  // AUDIT C306: i accept-fas → räknas som DECLINE FÖRST (innan vi krymper ticketen),
  // annars ser dissolveAccept en redan-spliced t.members och `every()` blir vacuously
  // sann för en tom ticket → tom spök-ticket åter-köas. declineMatch nollar _mmMatchId.
  if (ws._mmMatchId) declineMatch(ws, ws._mmMatchId);
  const t = ticketOf(ws);
  if (t) {
    // ta bort BARA denna ws ur ticketen (en gruppmedlem droppar); tom ticket → bort
    const i = t.members.indexOf(ws);
    if (i >= 0) t.members.splice(i, 1);
    ws._mmTicket = null;
    if (t.members.length === 0) removeTicket(t);
    broadcastQueueStatus(t.mode);
  }
}

function broadcastQueueStatus(mode) {
  const q = queues.get(mode) || [];
  let inQ = 0;
  for (const t of q) inQ += sizeOf(t);
  const T = targetFor(mode);
  for (const t of q) for (const ws of t.members) send(ws, { type: 'queue_status', mode, inQueue: inQ, target: T });
}

// ── Match-formning ───────────────────────────────────────────────────────────

function tryForm(mode) {
  const T = targetFor(mode);
  if (T <= 0) return;   // AUDIT C319: okänt/target-0-läge → forma aldrig (annars skulle sum===T===0 trigga startAccept med tom match)
  const q = queues.get(mode) || [];
  // greedy FIFO: plocka tickets tills summan == T (hoppa över de som skulle spräcka
  // T och leta en mindre som passar). Solo-tickets (size 1) → trivialt; grupper
  // hålls ihop (en hel ticket eller inget).
  const chosen = [];
  let sum = 0;
  for (let i = 0; i < q.length && sum < T; i++) {
    if (sizeOf(q[i]) === 0) continue;   // AUDIT C319/C306: hoppa över spök-tickets (alla medlemmar lämnade)
    if (sum + sizeOf(q[i]) <= T) { chosen.push(q[i]); sum += sizeOf(q[i]); }
  }
  if (sum !== T) return;   // kunde inte fylla exakt → vänta
  // för lag-lägen: kräv att tickets kan delas i två lag à T/2 (grupper hela)
  let teamSplit = null;
  if (TEAM_MODES.has(mode)) {
    teamSplit = partitionTeams(chosen, T / 2);
    if (!teamSplit) return;  // ingen giltig lag-uppdelning (t.ex. [3,1] i 2v2) → vänta
  }
  for (const t of chosen) removeTicket(t);
  startAccept(mode, chosen, teamSplit);
}

// dela tickets i två lag à `half` spelare, grupper HELA. Returnerar [redTickets,
// blueTickets] eller null. Greedy: störst först till det minsta laget.
function partitionTeams(tickets, half) {
  const sorted = tickets.slice().sort((a, b) => sizeOf(b) - sizeOf(a));
  const red = [], blue = []; let rN = 0, bN = 0;
  for (const t of sorted) {
    const s = sizeOf(t);
    if (rN + s <= half && (rN <= bN || bN + s > half)) { red.push(t); rN += s; }
    else if (bN + s <= half) { blue.push(t); bN += s; }
    else return null;
  }
  if (rN !== half || bN !== half) return null;
  return [red, blue];
}

// ── Accept-fas ───────────────────────────────────────────────────────────────

function startAccept(mode, tickets, teamSplit) {
  const matchId = 'm' + (_midSeq++);
  const members = [];
  for (const t of tickets) for (const ws of t.members) members.push(ws);
  const entry = { mode, tickets, teamSplit, accepts: new Set(), members, timer: null };
  accepting.set(matchId, entry);
  for (const ws of members) {
    ws._mmMatchId = matchId;
    send(ws, { type: 'match_found', matchId, mode, players: members.length, acceptMs: ACCEPT_MS });
  }
  entry.timer = setTimeout(() => expireAccept(matchId), ACCEPT_MS);
  if (entry.timer.unref) entry.timer.unref();
}

function acceptMatch(ws, matchId) {
  const entry = accepting.get(matchId);
  if (!entry || ws._mmMatchId !== matchId) return;
  entry.accepts.add(ws.id);
  for (const m of entry.members) send(m, { type: 'match_accept_progress', matchId, accepted: entry.accepts.size, total: entry.members.length });
  // AUDIT C318: räkna mot LEVANDE medlemmar — en halv-stängd socket (readyState 2/CLOSING vars
  // close/leave ännu inte fyrat) kan aldrig acceptera och skulle annars stalla hela accept-fasen
  // i 10s. När alla levande accepterat → finalizeMatch (som själv åter-köar om live < total).
  let liveCount = 0;
  for (const m of entry.members) if (m.readyState === 1) liveCount++;
  if (entry.accepts.size >= entry.members.length || entry.accepts.size >= liveCount) finalizeMatch(matchId);
}

function declineMatch(ws, matchId) {
  const entry = accepting.get(matchId);
  if (!entry) { ws._mmMatchId = null; return; }
  dissolveAccept(matchId, ws);
}

function expireAccept(matchId) {
  const entry = accepting.get(matchId);
  if (!entry) return;
  // de som INTE accepterat = orsaken; städa dem, återställ resten
  dissolveAccept(matchId, null);
}

// lös upp accept-fasen: de som accepterat (utom ev. decliner) går TILLBAKA i kön
// (deras tickets), de som nekade/timeoutade droppas helt.
function dissolveAccept(matchId, decliner) {
  const entry = accepting.get(matchId);
  if (!entry) return;
  accepting.delete(matchId);
  if (entry.timer) clearTimeout(entry.timer);
  for (const ws of entry.members) ws._mmMatchId = null;
  for (const t of entry.tickets) {
    // AUDIT C306: en ticket vars storlek krympt (någon lämnade/dissade) ska aldrig
    // åter-köas — varken tom (vacuously-sann every()) eller delvis urholkad.
    // t.size = originalstorlek sätts i joinQueue. Tomt (0) = trivial spök-ticket;
    // krympt (!== t.size) = gruppen är inte intakt längre → neka åter-köning.
    if (t.members.length === 0 || (t.size != null && t.members.length !== t.size)) continue;
    // behåll ticket om HELA gruppen accepterade och ingen är decliner
    const allAccepted = t.members.every(m => entry.accepts.has(m.id) && m !== decliner);
    if (allAccepted) {
      // tillbaka i kön (fronten) + meddela
      qFor(t.mode).unshift(t);
      for (const m of t.members) { send(m, { type: 'match_cancelled', requeued: true }); }
    } else {
      for (const m of t.members) { m._mmTicket = null; send(m, { type: 'match_cancelled', requeued: false }); }
    }
  }
  tryForm(entry.mode);
}

// ── Rum-skapande + start ─────────────────────────────────────────────────────

function finalizeMatch(matchId) {
  const entry = accepting.get(matchId);
  if (!entry) return;
  accepting.delete(matchId);
  if (entry.timer) clearTimeout(entry.timer);
  const mode = entry.mode;
  // verifiera att alla fortfarande är anslutna (lobby = party → de ÄR i sina
  // lobby-rum, så ws.roomCode är satt; kolla bara att socketen lever)
  const live = entry.members.filter(ws => ws.readyState === 1);
  if (live.length < entry.members.length) {
    // någon hann disconnecta → lös upp (de kvarvarandes tickets tillbaka i kön)
    for (const ws of entry.members) ws._mmMatchId = null;
    for (const t of entry.tickets) {
      const ok = t.members.every(m => m.readyState === 1);
      if (ok) { qFor(mode).unshift(t); for (const m of t.members) send(m, { type: 'match_cancelled', requeued: true }); }
      else for (const m of t.members) { m._mmTicket = null; if (m.readyState === 1) send(m, { type: 'match_cancelled', requeued: false }); }
    }
    tryForm(mode);
    return;
  }
  // skapa rum (replikerar 'host'-handlern). Host = första ticketens första medlem.
  const code = H.generateCode();
  const host = entry.members[0];
  const room = {
    code, hostId: host.id, members: new Map(),
    meta: { hostName: host.playerName || 'Spelare', mode, private: true, started: false, createdAt: Date.now(), maxPlayers: Math.max(2, entry.members.length) },
    _nextSlot: 1, _freeSlots: [], _matchmade: true,
  };
  // lag-tilldelning (TEAM_MODES): teamSplit → peerId→team
  const teamOf = {};
  if (entry.teamSplit) {
    for (const t of entry.teamSplit[0]) for (const m of t.members) teamOf[m.id] = 'red';
    for (const t of entry.teamSplit[1]) for (const m of t.members) teamOf[m.id] = 'blue';
  }
  // placera medlemmar: host slot 0, resten 1..N. Lobby = party → flytta varje
  // medlem UT ur sin lobby in i match-rummet; töm + radera tomma lobbies.
  for (const ws of entry.members) {
    // AUDIT C27: null matchmaker-fälten FÖRST så den re-entranta matchmaker.leave()
    // inne i handleDisconnect blir en no-op vid eviction ur gamla lobbyn.
    ws._mmMatchId = null;
    ws._mmTicket = null;
    const oldRoom = H.rooms.get(ws.roomCode);
    if (oldRoom && oldRoom !== room) {
      // Återanvänd handleDisconnect istället för rå members.delete: ger slot-return,
      // peer_left/_jsonWorld-spegling, host-migration (!_isBot && !isSpectator) och
      // stopSim + rooms.delete på tomt rum (annars läcker sim-intervallet).
      if (H.handleDisconnect) {
        H.handleDisconnect(ws);
      } else {
        oldRoom.members.delete(ws.id);
        if (oldRoom.members.size === 0) H.rooms.delete(oldRoom.code);
        else if (oldRoom.hostId === ws.id) oldRoom.hostId = oldRoom.members.keys().next().value;
      }
    }
    ws.roomCode = code;
    ws.stableSlot = (ws === host) ? 0 : (room._nextSlot++);
    if (teamOf[ws.id]) ws.tdmTeam = teamOf[ws.id];
    room.members.set(ws.id, ws);
  }
  H.rooms.set(code, room);
  // starta simen server-side med lägets opts
  room.sim = H.createSim(room);
  const opts = Object.assign({ mode, difficulty: 'normal', addBot: false, baseShield: 100, countdownMs: 3000 }, MODE_OPTS[mode] || {});
  if (Object.keys(teamOf).length) opts.teams = teamOf;
  H.startSim(room.sim, opts);
  room.meta.started = true;
  // AUDIT C312: push presence-uppdatering till vänner (matchmade → i match, ej lobby).
  // broadcastPublicRooms: stale lobbykod försvinner ur publika rum-listan.
  if (H.broadcastPublicRooms) H.broadcastPublicRooms();
  for (const ws of entry.members) { if (H.presenceChanged) H.presenceChanged(ws); }
  // 'match_ready' till var och en (kombinerad hosted/joined + sim körs redan)
  const memberList = [];
  for (const [, m] of room.members) memberList.push({ id: m.id, slot: m.stableSlot, name: m.playerName || 'Spelare' });
  for (const ws of entry.members) {
    send(ws, {
      type: 'match_ready', code, mode, peerId: ws.id, hostId: host.id,
      stableSlot: ws.stableSlot, team: teamOf[ws.id] || null, members: memberList,
    });
  }
  console.log('[MATCHMAKER]', mode, 'match formad', code, entry.members.length, 'spelare', entry.teamSplit ? '(lag)' : '');
}

function send(ws, obj) { if (H) H.send(ws, obj); }

// dispatch från server.js (alla type som börjar med "queue_"/"match_")
function handle(ws, msg) {
  switch (msg.type) {
    case 'queue_join': {
      let mode = String(msg.mode || '');
      let members;
      // AUDIT C268: vän-baserad party (groups.js) har FÖRETRÄDE. Utan detta köade ledaren SOLO
      // och gruppmedlemmarna strandade för evigt ("Väntar på att ledaren startar").
      const party = groups.partyMembers(ws);
      if (party === 'notleader') { send(ws, { type: 'queue_error', code: 'notleader' }); return; }
      if (Array.isArray(party) && party.length > 0) {
        members = party.filter((m) => m && m.readyState === 1 && !m.isSpectator);
      } else {
        // LOBBY = PARTY (ML-stil): köa FRÅN lobbyn → hela lobbyn (utom bots) blir EN ticket;
        // bara host:en får köa. Varken grupp eller lobby → solo.
        const room = ws.roomCode ? H.rooms.get(ws.roomCode) : null;
        if (room) {
          if (ws.id !== room.hostId) { send(ws, { type: 'queue_error', code: 'notleader' }); return; }
          // #23: 15s-ended-fönstret (post-game-lobby) räknas inte som "i match" — host
          // ska kunna köa nästa match direkt (H.simEnded exponeras av server.js).
          if (room.meta && room.meta.started && !(H && H.simEnded && H.simEnded(room))) { send(ws, { type: 'queue_error', code: 'inroom' }); return; }
          members = [];
          // SPECTATE: åskådare ska aldrig dras in i en matchmaking-ticket som spelare.
          for (const [, m] of room.members) if (!m._isBot && !m.isSpectator && m.readyState === 1) members.push(m);
          if (!mode) mode = (room.meta && room.meta.mode) || '';
        } else {
          members = [ws];
        }
      }
      // world-format-flaggor (host/join sätter dem annars) på ALLA matchmade
      for (const m of members) { if (msg.godot) m._jsonWorld = true; if (msg.bin) m._binWorld = true; }
      const err = joinQueue(members, mode);
      if (err) send(ws, { type: 'queue_error', code: err });
      return;
    }
    case 'queue_cancel': cancelQueue(ws); return;
    case 'match_accept': acceptMatch(ws, String(msg.matchId || '')); return;
    case 'match_decline': declineMatch(ws, String(msg.matchId || '')); return;
    default: return;
  }
}

module.exports = { setHelpers, handle, leave, joinQueue, MATCH_TARGET };
