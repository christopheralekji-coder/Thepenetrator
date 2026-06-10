// Test-hjälpare: hostar ett rum som Godot-klient, skriver RUMSKODEN till fil,
// startar sim efter en delay (så en Godot-joiner hinner ansluta) och håller
// rummet vid liv. node tools/host-room-for-test.js [ws-url] [mode] [delayMs] [codefil]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const fs = require('fs');
const URL = process.argv[2] || 'ws://localhost:8090';
const MODE = process.argv[3] || 'survivors';
const DELAY = parseInt(process.argv[4] || '18000', 10);
const CODEFILE = process.argv[5] || require('path').join(__dirname, '_room_code.txt');

const OPTS = {
  survivors: { survivors: true, survivorsDurationSec: 600, difficulty: 'normal', addBot: true, botCount: 2 },
  tdm: { tdm: true, tdmTargetKills: 30, addBot: true, botCount: 3 },
  ctf: { ctf: true, ctfTargetCaptures: 3, addBot: true, botCount: 3 },
};

const ws = new WebSocket(URL);
let t0 = Date.now();
ws.on('open', () => {
  console.log('[HOST] ansluten', URL);
  ws.send(JSON.stringify({ type: 'host', mode: MODE, name: 'TestHost', private: true, godot: 1 }));
});
ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    console.log('[HOST] rum', m.code, '— startar sim om', DELAY, 'ms');
    fs.writeFileSync(CODEFILE, m.code);
    setTimeout(() => {
      const opts = Object.assign({ type: 'sim_start', mode: MODE }, OPTS[MODE] || OPTS.survivors);
      ws.send(JSON.stringify(opts));
      console.log('[HOST] sim_start skickad');
    }, DELAY);
  } else if (m.type === 'sim_started') {
    console.log('[HOST] sim igång');
  } else if (m.type === 'peer_joined') {
    console.log('[HOST] peer joinade:', m.peerId, 'slot', m.stableSlot);
  } else if (m.type === 'relay') {
    // svara hello med roster (som LobbyScreen-hosten gör) så joiner-klienten får mode
    if (m.data && m.data.t === 'hello') {
      ws.send(JSON.stringify({ type: 'relay', data: { t: 'roster', roster: { host: 'TestHost' }, mode: MODE } }));
    }
  }
});
ws.on('error', (e) => { console.log('[HOST] FEL', e.message); process.exit(3); });
// håll igång 120s — skicka input så host inte cullas
setInterval(() => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0, weaponId: 'rifle' }));
  if (Date.now() - t0 > 120000) process.exit(0);
}, 250);
