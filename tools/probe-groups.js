// Probe matchmaking fas 2: 2 spelare grupperar → köar som EN → matchas med 2 solo
// → gruppen på SAMMA lag. node tools/probe-groups.js [ws-url]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8104';
const fails = [];
const mk = (secret) => new Promise((res) => {
  const ws = new WebSocket(URL); ws._id = null; ws._team = null; ws._matchId = null;
  ws.on('open', () => ws.send(JSON.stringify({ type: 'acct_login', secret })));
  ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'acct_logged_in') { ws._id = String(m.id); res(ws); }
    if (m.type === 'group_invited') ws._lastInvite = m.groupId;
    if (m.type === 'group_roster') ws._roster = m;
    if (m.type === 'match_found') { ws._matchId = m.matchId; ws.send(JSON.stringify({ type: 'match_accept', matchId: m.matchId })); }
    if (m.type === 'match_ready') ws._team = m.team;
    if (m.type === 'queue_error') ws._qerr = m.code;
  });
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const A = await mk('aaaaaaaaaaaaaaaa1111');  // ledare
  const B = await mk('bbbbbbbbbbbbbbbb2222');  // gruppmedlem
  A.send(JSON.stringify({ type: 'group_create' }));
  await wait(150);
  A.send(JSON.stringify({ type: 'group_invite', toId: B._id }));
  await wait(250);
  const c1 = B._lastInvite != null;
  console.log((c1 ? '✅' : '❌') + ' [1] B fick group_invited (' + B._lastInvite + ')');
  if (!c1) fails.push('ingen invite');
  B.send(JSON.stringify({ type: 'group_accept', groupId: B._lastInvite }));
  await wait(250);
  const c2 = A._roster && A._roster.members.length === 2 && A._roster.leaderId === A._id;
  console.log((c2 ? '✅' : '❌') + ' [2] grupp = 2 medlemmar, A ledare (' + (A._roster ? A._roster.members.length : 0) + ')');
  if (!c2) fails.push('grupp ej 2');
  // B (icke-ledare) försöker köa → notleader
  B.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  await wait(200);
  const c3 = B._qerr === 'notleader';
  console.log((c3 ? '✅' : '❌') + ' [3] medlem kan ej köa (notleader: ' + B._qerr + ')');
  if (!c3) fails.push('medlem kunde köa');
  // ledaren köar gruppen + 2 solo fyller
  A.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  const C = await mk('cccccccccccccccc3333'); C.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  const D = await mk('dddddddddddddddd4444'); D.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  await wait(1500);
  const c4 = A._team != null && B._team != null && A._team === B._team;
  console.log((c4 ? '✅' : '❌') + ' [4] match formad + gruppen SAMMA lag (A=' + A._team + ' B=' + B._team + ')');
  if (!c4) fails.push('grupp ej samma lag');
  console.log(fails.length ? ('\n❌ ' + fails.join(', ')) : '\n✅ ALLA 4 GRÖNA — grupp köar ihop + hamnar på samma lag');
  [A, B, C, D].forEach(w => { try { w.close(); } catch (e) {} });
  process.exit(fails.length ? 1 : 0);
})();
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 12000);
