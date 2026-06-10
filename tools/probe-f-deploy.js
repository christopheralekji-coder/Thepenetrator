// Probe: verifiera att F-paketet (feb3669) är live på Render.
// Testar lastlaugh-perken: host godot:1 → sim_start survivors → sim_input perks
// {lastlaugh} → hp 0 → förvänta grenade_thrown-event (finns BARA i nya koden).
//   node tools/probe-f-deploy.js [wss://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'wss://penetrator-coop-eu.onrender.com';

const ws = new WebSocket(URL);
let gotWorld = false, gotGrenade = false, inputTimer = null, hp = 100, t0 = Date.now();
const die = (msg, code) => { console.log(msg); clearInterval(inputTimer); try { ws.close(); } catch (e) {} process.exit(code); };
setTimeout(() => die('TIMEOUT (90s) — grenade_thrown kom aldrig: GAMMAL KOD eller server sover', 1), 90000);

ws.on('open', () => {
  console.log('open →', URL);
  ws.send(JSON.stringify({ type: 'host', name: 'PROBE', godot: 1 }));
});
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    console.log('hosted, rum:', m.code);
    ws.send(JSON.stringify({ type: 'sim_start', mode: 'survivors' }));
  } else if (m.type === 'sim_started') {
    console.log('sim_started — skickar input m. perks{lastlaugh}, dör om 7s (efter countdown)');
    inputTimer = setInterval(() => {
      ws.send(JSON.stringify({ type: 'sim_input', x: 2000, y: 2000, hp, aim: 0,
        perks: { lastlaugh: true } }));
    }, 100);
    setTimeout(() => { hp = 0; console.log('hp → 0 (lastlaugh ska explodera)'); }, 7000);
  } else if (m.type === 'world') {
    if (!gotWorld) { gotWorld = true; console.log('world-paket OK (JSON-path live)'); }
  } else if (m.type === 'sim_events' && Array.isArray(m.events)) {
    for (const ev of m.events) {
      if (ev.type === 'grenade_thrown' && ev.radius === 250) gotGrenade = true;
      if (ev.type === 'player_died') console.log('player_died-event mottaget');
    }
    if (gotGrenade) die('✅ grenade_thrown(radius 250) = lastlaugh-explosion → F-PAKETET LIVE PÅ RENDER (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', 0);
  }
});
ws.on('error', (e) => die('WS-fel: ' + e.message, 1));
