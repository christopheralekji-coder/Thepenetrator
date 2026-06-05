'use strict';
// Integration-test (v1.770): ghost-dedupe. Två peers joinar SAMMA rum med SAMMA
// reconnectToken utan att den första stängs → servern ska kasta ut den första (ghost)
// så ingen frusen dubblett ligger kvar. Simulerar mobil som tappar signal + rejoinar
// innan gamla anslutningens close-event hinner fira.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 8799;
const URL = 'ws://localhost:' + PORT;

function wsOpen(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
function nextMsg(ws, typeWanted, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout väntar på ' + typeWanted)), timeoutMs);
    function onMsg(data) {
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (!typeWanted || m.type === typeWanted) { clearTimeout(to); ws.off('message', onMsg); res(m); }
    }
    ws.on('message', onMsg);
  });
}
function waitClose(ws, timeoutMs = 5000) {
  return new Promise((res) => {
    const to = setTimeout(() => res(false), timeoutMs);
    ws.on('close', () => { clearTimeout(to); res(true); });
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await wait(1300); // ge servern tid att lyssna
  let failed = false;
  try {
    const host = await wsOpen(URL);
    host.send(JSON.stringify({ type: 'host', name: 'Host', mode: 'story' }));
    const code = (await nextMsg(host, 'hosted')).code;
    console.log('[GHOST] rum', code);

    // Peer A joinar med token TOK123
    const a = await wsOpen(URL);
    a.send(JSON.stringify({ type: 'join', code, name: 'A', reconnectToken: 'TOK123' }));
    const aJoined = await nextMsg(a, 'joined');
    console.log('[GHOST] peer A inne som', aJoined.peerId);

    // Host ska få peer_left för A när B kastar ut den
    const hostPeerLeft = nextMsg(host, 'peer_left', 5000).catch(() => null);
    // Lyssna på A:s close INNAN B joinar (race-säkert)
    const aClosePromise = waitClose(a, 5000);

    // Peer B joinar SAMMA rum med SAMMA token — A stängs INTE av oss
    const b = await wsOpen(URL);
    b.send(JSON.stringify({ type: 'join', code, name: 'B', reconnectToken: 'TOK123' }));
    const bJoined = await nextMsg(b, 'joined');
    console.log('[GHOST] peer B inne som', bJoined.peerId);

    const aClosed = await aClosePromise;
    assert(aClosed === true, 'ghost (peer A) ska ha stängts av servern när B joinade med samma token');
    console.log('[GHOST] ✓ ghost A stängdes av servern (ingen frusen dubblett)');

    assert(bJoined.peerId && bJoined.peerId !== aJoined.peerId, 'B fick eget peerId, ej A:s');
    console.log('[GHOST] ✓ B är inne med eget id');

    const pl = await hostPeerLeft;
    assert(pl && pl.peerId === aJoined.peerId, 'host fick peer_left för ghost A (slotToPeerId städas)');
    console.log('[GHOST] ✓ host fick peer_left för A → slot-mappning städad');

    host.close(); b.close();
    console.log('\n✅ test-ghost-dedupe PASS');
  } catch (e) {
    failed = true;
    console.error('❌ test-ghost-dedupe FAIL:', e.message);
  } finally {
    srv.kill();
    await wait(200);
    process.exit(failed ? 1 : 0);
  }
})();
