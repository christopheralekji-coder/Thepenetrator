// Probe: lobby = party. Host skapar lobby + vän joinar → host köar lobbyn → matchas
// med 2 solo → lobby-paret SAMMA lag + samma match-rum. node tools/probe-lobbyqueue.js [ws]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8110';
const fails = [];
const conn = () => new WebSocket(URL);
const st = (ws) => { ws._team = null; ws._code = null; ws._mid = null;
  ws.on('message', (r) => { let m; try { m = JSON.parse(r.toString()); } catch (e) { return; }
    if (m.type === 'hosted') { ws._lobby = m.code; ws._pid = m.peerId; }
    if (m.type === 'joined') ws._pid = m.peerId;
    if (m.type === 'match_found') { ws._mid = m.matchId; ws.send(JSON.stringify({ type: 'match_accept', matchId: m.matchId })); }
    if (m.type === 'match_ready') { ws._team = m.team; ws._code = m.code; }
  }); return ws; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const host = st(conn()); await wait(300);
  host.send(JSON.stringify({ type: 'host', mode: 'tdm', name: 'HOST', godot: 1 })); await wait(400);
  const friend = st(conn()); await wait(200);
  friend.send(JSON.stringify({ type: 'join', code: host._lobby, name: 'FRIEND', godot: 1 })); await wait(400);
  console.log('lobby', host._lobby, '— host', host._pid, 'friend', friend._pid);
  // host köar lobbyn
  host.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  // 2 solo fyller
  const c = st(conn()); await wait(150); c.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  const d = st(conn()); await wait(150); d.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1 }));
  await wait(1500);
  const c1 = host._team != null && friend._team != null && host._team === friend._team;
  const c2 = host._code != null && host._code === friend._code && host._code === c._code && c._code === d._code;
  const c3 = host._code !== host._lobby;   // match-rum är ett NYTT rum (lobbyn flyttades)
  console.log((c1 ? '✅' : '❌') + ' [1] lobby-paret SAMMA lag (host=' + host._team + ' friend=' + friend._team + ')');
  console.log((c2 ? '✅' : '❌') + ' [2] alla 4 i SAMMA match-rum (' + host._code + ')');
  console.log((c3 ? '✅' : '❌') + ' [3] match-rum != gamla lobbyn (' + host._lobby + '→' + host._code + ')');
  if (!c1) fails.push('lobby ej samma lag');
  if (!c2) fails.push('ej samma rum');
  if (!c3) fails.push('rum ej nytt');
  console.log(fails.length ? ('\n❌ ' + fails.join(', ')) : '\n✅ GRÖNT — lobby köar som party, paret samma lag, lobbies → match-rum');
  [host, friend, c, d].forEach(w => { try { w.close(); } catch (e) {} });
  process.exit(fails.length ? 1 : 0);
})();
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 12000);
