// Integrationstest: solo-HOST tappar kopplingen mid-CD-match → rejoin med samma
// reconnect-token ska HITTA rummet (ej "Rummet finns inte") och få slot 0 + host-roll.
process.env.PORT = process.env.PORT || '18099';
process.env.ALLOW_CHEATS = '1';
const PORT = process.env.PORT;
const WebSocket = require('ws');
require('./server.js'); // auto-listen på PORT

const TOK = 'WIFITESTTOKEN123';
const URL = 'ws://127.0.0.1:' + PORT;
const log = (...a) => console.log('[TEST]', ...a);
function fail(m) { console.error('\n  ✗ FAIL:', m); process.exit(1); }
function ok(m) { console.log('  ✓', m); }

function connect() { return new WebSocket(URL); }
function onMsg(ws, type, ms = 4000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout väntan på ' + type)), ms);
    const h = (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === type) { clearTimeout(to); ws.off('message', h); resolve(m); }
    };
    ws.on('message', h);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(400); // låt servern binda porten

  // 1) HOST en CD-match med reconnect-token
  const a = connect();
  await new Promise((r) => a.on('open', r));
  a.send(JSON.stringify({ type: 'host', mode: 'castledefense', name: 'Solo', bin: 0, godot: 1, reconnectToken: TOK }));
  const hosted = await onMsg(a, 'hosted');
  const code = hosted.code;
  const aPid = hosted.peerId;
  ok('host skapade rum ' + code + ' (pid ' + aPid + ')');

  // 2) starta simen
  a.send(JSON.stringify({ type: 'sim_start', mode: 'castledefense', opts: { mode: 'castledefense', difficulty: 'veteran', countdownMs: 0, baseShield: 100, bots: 0 } }));
  await onMsg(a, 'sim_started');
  ok('sim_started (room.sim finns nu → stash skapas vid drop)');
  await sleep(300); // några tick → playerState finns

  // 2b) flytta spelaren till en TYDLIG position (co-op = klient-auktoritär pos)
  const PX = 1234, PY = 888;
  for (let i = 0; i < 5; i++) {
    a.send(JSON.stringify({ type: 'sim_input', x: PX, y: PY, hp: 100, aim: 1.5, weaponId: 'rifle', seq: i }));
    await sleep(40);
  }
  ok('spelaren flyttad till (' + PX + ',' + PY + ')');

  // 3) DROPP: stäng socketen abrupt (wifi-bortkoppling)
  a.terminate();
  log('host-socket terminerad (simulerad wifi-dropp)…');
  await sleep(600); // handleDisconnect kör: stash skapas, rummet ska HÅLLAS vid liv

  // 4) REJOIN med samma token på en NY socket
  const b = connect();
  await new Promise((r) => b.on('open', r));
  b.send(JSON.stringify({ type: 'join', code, name: 'Solo', bin: 0, godot: 1, reconnectToken: TOK }));

  // 5) förvänta 'joined' — INTE 'error: Rummet finns inte'
  const winner = await Promise.race([
    onMsg(b, 'joined').then((m) => ({ kind: 'joined', m })),
    onMsg(b, 'error').then((m) => ({ kind: 'error', m })),
  ]).catch((e) => ({ kind: 'timeout', m: { error: e.message } }));

  if (winner.kind !== 'joined') {
    fail('rejoin gav "' + winner.kind + '": ' + JSON.stringify(winner.m) + ' (rummet raderades / stash slängd)');
  }
  ok('rejoin lyckades — rummet ÖVERLEVDE host-droppen');

  const jm = winner.m;
  if (jm.hostId !== jm.peerId) fail('host-roll ej återställd: hostId=' + jm.hostId + ' peerId=' + jm.peerId);
  ok('host-roll återställd (hostId === peerId)');
  if (Number(jm.stableSlot) !== 0) fail('slot ej 0 vid host-rejoin: stableSlot=' + jm.stableSlot);
  ok('slot 0 återställd');

  // 6) POSITION + VAPEN: world-paketet ska visa spelaren DÄR den DC:ade, ej (0,0)
  let world = null;
  for (let i = 0; i < 6 && !world; i++) {
    const w = await onMsg(b, 'world', 2000).catch(() => null);
    if (w && Array.isArray(w.players) && w.players.some((p) => Number(p.c) === 0)) world = w;
  }
  if (!world) fail('inget world-paket med spelaren (slot 0) → matchen återupptas inte');
  ok('world-paket mottaget → matchen fortsätter');
  const me = world.players.find((p) => Number(p.c) === 0);
  if (Math.abs(Number(me.x) - PX) > 50 || Math.abs(Number(me.y) - PY) > 50) {
    fail('position EJ återställd: rejoin på (' + me.x + ',' + me.y + ') men DC:ade på (' + PX + ',' + PY + ')');
  }
  ok('position återställd (' + me.x + ',' + me.y + ') ≈ DC-position — INTE (0,0) uppe-vänster');

  console.log('\n═══════════════════════════════════════');
  console.log('  WIFI HOST-RECONNECT test PASSED');
  console.log('═══════════════════════════════════════');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
