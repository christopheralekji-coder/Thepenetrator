// Integrationstest: BR mid-match — en LEVANDE spelare tappar kopplingen och ateransluter
// inom 30s → ska ATERUPPTA sin run (hp>0, ratt position), INTE bli dead spectator.
process.env.PORT = process.env.PORT || '18097';
process.env.ALLOW_CHEATS = '1';
const PORT = process.env.PORT;
const WebSocket = require('ws');
require('./server.js');

const TOK = 'BRRECONNECTTOKEN';
const URL = 'ws://127.0.0.1:' + PORT;
const ok = (m) => console.log('  ✓', m);
function fail(m) { console.error('\n  ✗ FAIL:', m); process.exit(1); }
const connect = () => new WebSocket(URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function onMsg(ws, type, ms = 6000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout ' + type)), ms);
    const h = (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === type) { clearTimeout(to); ws.off('message', h); resolve(m); } };
    ws.on('message', h);
  });
}
// vänta på ett world-paket där spelaren (slot 0) finns + uppfyller pred
function waitWorld(ws, pred, tries = 30, ms = 600) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < tries; i++) {
      const w = await onMsg(ws, 'world', ms).catch(() => null);
      if (w && Array.isArray(w.players)) { const me = w.players.find((p) => Number(p.c) === 0); if (me && pred(me)) return resolve(me); }
    }
    resolve(null);
  });
}

(async () => {
  await sleep(400);
  const a = connect(); await new Promise((r) => a.on('open', r));
  a.send(JSON.stringify({ type: 'host', mode: 'battleroyale', name: 'BRsolo', bin: 0, godot: 1, reconnectToken: TOK }));
  const hosted = await onMsg(a, 'hosted'); const code = hosted.code;
  ok('host skapade BR-rum ' + code);
  a.send(JSON.stringify({ type: 'sim_start', mode: 'battleroyale', opts: { mode: 'battleroyale', difficulty: 'veteran', countdownMs: 0, bots: 6 } }));
  await onMsg(a, 'sim_started', 8000).catch(() => null);
  ok('sim_started (BR predrop)');

  // hoppa av bussen → freefall → landa (~9.5s) → predrop slutar → aktiv BR
  await sleep(300);
  a.send(JSON.stringify({ type: 'sim_br_jump' }));
  const ended = await onMsg(a, 'br_predrop_end', 16000).catch(() => null);
  ok(ended ? 'br_predrop_end → aktiv BR' : '(inget predrop_end-event; fortsätter ändå)');
  await sleep(500);

  // vänta tills vi är LEVANDE + landad (hp>0, air landad), flytta sen till känd pos
  const alive = await waitWorld(a, (me) => Number(me.hp) > 0 && (me.air === undefined || Number(me.air) === 0), 20, 700);
  if (!alive) fail('blev aldrig en levande/landad BR-spelare (kan ej testa mid-match-reconnect)');
  ok('levande BR-spelare landad (hp=' + Math.round(alive.hp) + ')');
  const PX = 2600, PY = 2600;
  for (let i = 0; i < 6; i++) { a.send(JSON.stringify({ type: 'sim_input', x: PX, y: PY, hp: alive.hp, aim: 1.0, weaponId: 'pistol', seq: i })); await sleep(40); }
  const moved = await waitWorld(a, (me) => Math.abs(Number(me.x) - PX) < 60 && Number(me.hp) > 0, 12, 500);
  if (!moved) fail('kunde ej flytta spelaren / läsa pos');
  ok('flyttad till (' + Math.round(moved.x) + ',' + Math.round(moved.y) + ') hp=' + Math.round(moved.hp));
  const hpBefore = Math.round(moved.hp);

  // DROPP
  a.terminate();
  console.log('  [TEST] BR-socket terminerad (mid-match) …');
  await sleep(800);

  // REJOIN inom 30s
  const b = connect(); await new Promise((r) => b.on('open', r));
  b.send(JSON.stringify({ type: 'join', code, name: 'BRsolo', bin: 0, godot: 1, reconnectToken: TOK }));
  const res = await Promise.race([
    onMsg(b, 'joined').then((m) => ({ k: 'joined', m })),
    onMsg(b, 'error').then((m) => ({ k: 'error', m })),
  ]).catch((e) => ({ k: 'timeout', m: { error: e.message } }));
  if (res.k !== 'joined') fail('rejoin gav ' + res.k + ': ' + JSON.stringify(res.m));
  ok('rejoin lyckades (joined)');

  // VERIFIERA: levande (hp>0, EJ spectator hp=0) + position bevarad
  const back = await waitWorld(b, (me) => true, 16, 700);
  if (!back) fail('inget world-paket med spelaren efter rejoin');
  if (Number(back.hp) <= 0) fail('blev DEAD SPECTATOR vid rejoin (hp=' + back.hp + ') — restoren misslyckades');
  ok('LEVANDE efter rejoin (hp=' + Math.round(back.hp) + ', var ' + hpBefore + ') — INTE spectator');
  if (Math.abs(Number(back.x) - PX) > 120 || Math.abs(Number(back.y) - PY) > 120) {
    fail('position ej bevarad: (' + Math.round(back.x) + ',' + Math.round(back.y) + ') vs (' + PX + ',' + PY + ')');
  }
  ok('position bevarad (' + Math.round(back.x) + ',' + Math.round(back.y) + ')');

  console.log('\n════════════════════');
  console.log('  BR 30s-RECONNECT test PASSED');
  console.log('════════════════════');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
