// Integration-test (v1.791): GULAG-TEST solo-flöde. En host startar BR med
// addBot + gulagPractice → servern ska para host+bot i valt spel direkt + skicka gulag_start.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 8801;
const URL = 'ws://localhost:' + PORT;
function wsOpen(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.on('open', () => res(ws)); ws.on('error', rej); }); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await wait(1300);
  let failed = false;
  try {
    const host = await wsOpen(URL);
    // Buffra ALLA events (servern buntar i sim_events-batchar; flera relevanta kan
    // ligga i samma batch → konsumera-och-släng missar dem).
    const got = {};       // type -> senaste event-objektet
    function record(m) { if (m && m.type) got[m.type] = m; }
    host.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      record(m);
      if (m.type === 'sim_events' && Array.isArray(m.events)) m.events.forEach(record);
    });
    function waitFor(type, ms = 8000) {
      return new Promise((res, rej) => {
        const t0 = Date.now();
        (function poll() {
          if (got[type]) return res(got[type]);
          if (Date.now() - t0 > ms) return rej(new Error('timeout väntar på ' + type));
          setTimeout(poll, 50);
        })();
      });
    }

    host.send(JSON.stringify({ type: 'host', name: 'Tester', mode: 'story' }));
    const hosted = await waitFor('hosted');
    console.log('[GULAG-PRACTICE] rum', hosted.code);

    host.send(JSON.stringify({
      type: 'sim_start', wave: 1, difficulty: 'veteran', ngpLevel: 0, mode: 'story',
      battleroyale: true, battleroyaleMatchDurationSec: 600,
      addBot: true, botCount: 1, botSkill: 'normal', gulagPractice: 'blade',
    }));
    await waitFor('sim_started'); console.log('[GULAG-PRACTICE] sim_started');
    await waitFor('br_started'); console.log('[GULAG-PRACTICE] br_started');

    const gs = await waitFor('gulag_start');
    console.log('[GULAG-PRACTICE] gulag_start: game=' + gs.game + ' a=' + gs.a + ' b=' + gs.b);
    assert(gs.game === 'blade', 'forcerat spel = blade, fick ' + gs.game);
    assert(gs.a && gs.b && gs.a !== gs.b, 'två olika deltagare i duellen');
    assert(gs.geo && gs.geo.shape === 'ring', 'blade-geo shape=ring, fick ' + (gs.geo && gs.geo.shape));
    assert(gs.spawnA && gs.spawnB, 'spawn-punkter skickade');
    assert(got['gulag_queued'], 'gulag_queued sänt (kö-flödet kördes)');

    console.log('\n✅ test-gulag-practice PASS — solo-test-flödet (host+bot direkt i blade) funkar end-to-end');
  } catch (e) {
    failed = true;
    console.error('❌ FAIL:', e.message);
  } finally {
    srv.kill();
    await wait(200);
    process.exit(failed ? 1 : 0);
  }
})();
