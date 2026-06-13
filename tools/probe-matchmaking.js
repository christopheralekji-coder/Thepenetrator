// Probe AAA matchmaking fas 1: 4 solo-klienter köar TDM → match formas → accept →
// rum + start + lag. node tools/probe-matchmaking.js [ws-url]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8101';
const N = 4;
const clients = [];
const fails = [];
let foundCount = 0, readyCount = 0, worldCount = 0;
const teams = {};
const codes = new Set();
const done = () => {
  console.log('\n=== RESULTAT ===');
  console.log('  match_found:', foundCount + '/' + N, ' match_ready:', readyCount + '/' + N, ' world-paket:', worldCount);
  console.log('  rumskoder:', [...codes], ' lag:', JSON.stringify(teams));
  const teamVals = Object.values(teams);
  const reds = teamVals.filter(t => t === 'red').length, blues = teamVals.filter(t => t === 'blue').length;
  const c1 = foundCount === N;
  const c2 = readyCount === N && codes.size === 1;            // alla i SAMMA rum
  const c3 = reds === 2 && blues === 2;                        // 2v2-balansering
  const c4 = worldCount > 0;                                  // simen kör
  console.log((c1 ? '✅' : '❌') + ' [1] alla 4 fick match_found');
  console.log((c2 ? '✅' : '❌') + ' [2] alla 4 fick match_ready i SAMMA rum');
  console.log((c3 ? '✅' : '❌') + ' [3] lag balanserat 2 röd / 2 blå (' + reds + '/' + blues + ')');
  console.log((c4 ? '✅' : '❌') + ' [4] simen kör (world-paket flödar)');
  if (!c1) fails.push('ej alla match_found');
  if (!c2) fails.push('ej alla match_ready/samma rum');
  if (!c3) fails.push('lag ej 2v2');
  if (!c4) fails.push('ingen world');
  console.log(fails.length ? ('\n❌ ' + fails.join(', ')) : '\n✅ ALLA 4 GRÖNA — matchmaking: kö → match → accept → rum + start + lag');
  clients.forEach(c => { try { c.close(); } catch (e) {} });
  process.exit(fails.length ? 1 : 0);
};
setTimeout(done, 12000);
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(URL);
  clients.push(ws);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'queue_join', mode: 'tdm', godot: 1, bin: 0 })));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'match_found') { foundCount++; ws.send(JSON.stringify({ type: 'match_accept', matchId: m.matchId })); }
    else if (m.type === 'match_ready') { readyCount++; codes.add(m.code); teams['c' + i] = m.team; }
    else if (m.type === 'world') { worldCount++; }
  });
  ws.on('error', (e) => fails.push('ws' + i + ' ' + e.message));
}
