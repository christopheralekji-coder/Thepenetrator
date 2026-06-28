// Verifierar BR-reconnect INVENTORY-re-sync-WIRING: vid rejoin (levande) ska
// br_started ha isReconnect=true + isSpectator=false + ownedWeapons-fält, OCH en
// re-sync-paket med br_cash_update + br_maxstat ska skickas (aterstaller HUD).
process.env.PORT = process.env.PORT || '18098';
process.env.ALLOW_CHEATS = '1';
const PORT = process.env.PORT;
const WebSocket = require('ws');
require('./server.js');
const TOK = 'BRINVTOKEN';
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
  a.send(JSON.stringify({ type: 'host', mode: 'battleroyale', name: 'BRinv', bin: 0, godot: 1, reconnectToken: TOK }));
  const hosted = await onMsg(a, 'hosted'); const code = hosted.code;
  a.send(JSON.stringify({ type: 'sim_start', mode: 'battleroyale', battleroyale: true, difficulty: 'veteran', countdownMs: 0, bots: 6 }));
  await onMsg(a, 'sim_started', 8000).catch(() => null);
  ok('BR startad');
  await sleep(300);
  a.send(JSON.stringify({ type: 'sim_br_jump' }));
  await onMsg(a, 'br_predrop_end', 16000).catch(() => null);
  await sleep(500);
  const alive = await waitWorld(a, (me) => Number(me.hp) > 0 && (me.air === undefined || Number(me.air) === 0), 20, 700);
  if (!alive) fail('blev aldrig levande/landad');
  ok('levande BR-spelare (hp=' + Math.round(alive.hp) + ')');

  // DROPP + REJOIN, fanga ALLA sim_events i 2.5s
  a.terminate();
  await sleep(800);
  const b = connect(); await new Promise((r) => b.on('open', r));
  const events = [];
  b.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'sim_events' && Array.isArray(m.events)) for (const e of m.events) events.push(e); });
  b.send(JSON.stringify({ type: 'join', code, name: 'BRinv', bin: 0, godot: 1, reconnectToken: TOK }));
  const res = await Promise.race([
    onMsg(b, 'joined').then((m) => ({ k: 'joined' })),
    onMsg(b, 'error').then((m) => ({ k: 'error', m })),
  ]).catch((e) => ({ k: 'timeout' }));
  if (res.k !== 'joined') fail('rejoin gav ' + res.k);
  ok('rejoin (joined)');
  await sleep(2200);

  const myId = (events.find((e) => e.type === 'br_cash_update') || {}).peerId;
  const brStarted = events.find((e) => e.type === 'br_started');
  if (!brStarted) fail('inget br_started-event vid rejoin');
  if (brStarted.isReconnect !== true) fail('br_started.isReconnect !== true (=' + brStarted.isReconnect + ')');
  ok('br_started.isReconnect === true');
  if (brStarted.isSpectator !== false) fail('br_started.isSpectator !== false (=' + brStarted.isSpectator + ') -> klienten skulle spectator-nolla HUD');
  ok('br_started.isSpectator === false (ingen HUD-wipe)');
  if (!('ownedWeapons' in brStarted)) fail('br_started saknar ownedWeapons-fält');
  ok('br_started har ownedWeapons-fält (=' + JSON.stringify(brStarted.ownedWeapons) + ')');

  const cashEv = events.find((e) => e.type === 'br_cash_update');
  if (!cashEv) fail('ingen br_cash_update re-sync skickad vid rejoin');
  ok('br_cash_update re-sync skickad (cash=' + cashEv.cash + ')');
  const maxEv = events.find((e) => e.type === 'br_maxstat');
  if (!maxEv) fail('ingen br_maxstat re-sync skickad vid rejoin');
  ok('br_maxstat re-sync skickad (maxHp=' + maxEv.maxHp + ' hp=' + maxEv.hp + ')');

  console.log('\n══════════');
  console.log('  BR RECONNECT-INVENTORY re-sync WIRING PASSED');
  console.log('══════════');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
