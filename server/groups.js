'use strict';
// ============================================================================
// GRUPP/PARTY-LAGER (matchmaking fas 2, 2026-06-13). Spelare grupperar sig FÖRE
// kön (via vän-systemet) och köar som EN ticket → hålls ihop + samma lag. Bara
// LEDAREN initierar kön. Grupp keyas på konto-id (kräver inloggning).
// ============================================================================

let H = null; // { send, wsForAccount }
function setHelpers(h) { H = h; }

const groups = new Map(); // groupId → { id, leaderId, members:Map(accountId→ws), invited:Set }
let _gidSeq = 1;
const MAX_GROUP = 5;

function send(ws, o) { if (H) H.send(ws, o); }
function groupOf(ws) { return ws._groupId ? groups.get(ws._groupId) : null; }

function roster(g) {
  const arr = [];
  for (const [aid, ws] of g.members) arr.push({ id: aid, name: ws.playerName || 'Spelare', leader: aid === g.leaderId });
  return { type: 'group_roster', groupId: g.id, leaderId: g.leaderId, members: arr };
}
function pushRoster(g) { for (const [, ws] of g.members) send(ws, roster(g)); }

function create(ws) {
  if (!ws.accountId) { send(ws, { type: 'group_error', code: 'noaccount' }); return null; }
  const ex = groupOf(ws);
  if (ex) return ex;
  const id = 'g' + (_gidSeq++);
  const g = { id, leaderId: ws.accountId, members: new Map([[ws.accountId, ws]]), invited: new Set() };
  groups.set(id, g);
  ws._groupId = id;
  pushRoster(g);
  return g;
}

function invite(ws, toId) {
  let g = groupOf(ws);
  if (!g) g = create(ws);
  if (!g) return;
  if (g.leaderId !== ws.accountId) { send(ws, { type: 'group_error', code: 'notleader' }); return; }
  if (g.members.size >= MAX_GROUP) { send(ws, { type: 'group_error', code: 'full' }); return; }
  if (!toId || toId === ws.accountId) return;
  const target = H.wsForAccount(toId);
  if (!target) { send(ws, { type: 'group_error', code: 'offline' }); return; }
  g.invited.add(toId);
  send(target, { type: 'group_invited', groupId: g.id, from: { id: ws.accountId, name: ws.playerName || 'Spelare' } });
}

function accept(ws, groupId) {
  const g = groups.get(groupId);
  if (!g || !ws.accountId || !g.invited.has(ws.accountId)) { send(ws, { type: 'group_error', code: 'badinvite' }); return; }
  if (g.members.size >= MAX_GROUP) { send(ws, { type: 'group_error', code: 'full' }); return; }
  leave(ws); // lämna ev. nuvarande grupp först
  g.invited.delete(ws.accountId);
  g.members.set(ws.accountId, ws);
  ws._groupId = g.id;
  pushRoster(g);
}

function leave(ws) {
  const g = groupOf(ws);
  if (!g) return;
  g.members.delete(ws.accountId);
  ws._groupId = null;
  send(ws, { type: 'group_left' });
  if (g.members.size === 0) { groups.delete(g.id); return; }
  if (g.leaderId === ws.accountId) g.leaderId = g.members.keys().next().value; // ny ledare
  pushRoster(g);
}

// MATCHMAKER-integration: ws:ens grupp-medlemmar (ws-array) om i grupp + ledare;
// 'notleader' om i grupp men EJ ledare (medlem kan ej köa); null om ej i grupp (solo).
function partyMembers(ws) {
  const g = groupOf(ws);
  if (!g) return null;
  if (g.leaderId !== ws.accountId) return 'notleader';
  return [...g.members.values()];
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'group_create': create(ws); return;
    case 'group_invite': invite(ws, String(msg.toId || '')); return;
    case 'group_accept': accept(ws, String(msg.groupId || '')); return;
    case 'group_leave': leave(ws); return;
    default: return;
  }
}

module.exports = { setHelpers, handle, leave, partyMembers };
