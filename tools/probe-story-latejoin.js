// Probe: SLUTAUDIT 2 #3 — late-join i story-familjen (story/endless/bossrush/
// truck/daily/speedrun) ska få stage_loaded resänt direkt vid join.
// Före fixen: join-handlern hade late-join-resend för tdm/ctf/koth/siege/gungame/
// juggernaut/BR/heist men INGET för story-familjen → joinern fick tom värld.
// Kör mot lokal server:
//   $env:PORT=8093; node server\server.js   (i eget fönster)
//   node tools/probe-story-latejoin.js [ws://localhost:8093]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8093';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag, items: [], waiters: [],
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} },
      close: () => { try { ws.close(); } catch (e) {} },
      _push(t, d) {
        const item = { t, d, at: Date.now() };
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i];
          if (w.pred(item)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(item); return; }
        }
        this.items.push(item);
        if (this.items.length > 4000) this.items.splice(0, 2000);
      },
      wait(pred, timeoutMs) {
        const idx = this.items.findIndex(pred);
        if (idx >= 0) return Promise.resolve(this.items.splice(idx, 1)[0]);
        return new Promise((res, rej) => {
          const w = { pred, res };
          w.timer = setTimeout(() => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) this.waiters.splice(i, 1);
            rej(new Error('timeout: ' + tag));
          }, timeoutMs || 8000);
          this.waiters.push(w);
        });
      },
      waitMsg(type, timeoutMs) { return this.wait(it => it.t === 'msg' && it.d.type === type, timeoutMs); },
      waitEvt(type, timeoutMs) { return this.wait(it => it.t === 'evt' && it.d.type === type, timeoutMs); },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === 'sim_events' && Array.isArray(m.events)) {
        for (const e of m.events) c._push('evt', e);
      } else c._push('msg', m);
    });
  });
}

(async () => {
  console.log('[probe-story-latejoin] mot', URL);

  // Host (godot) startar story-sim
  const host = await mkClient('HOST');
  host.send({ type: 'host', name: 'HOST', godot: 1, mode: 'story' });
  const hosted = await host.waitMsg('hosted', 6000);
  const code = hosted.d.code;
  host.send({ type: 'sim_start', mode: 'story', countdownMs: 1000 });
  const hostStage = await host.waitEvt('stage_loaded', 8000);
  ok(hostStage.d.wave >= 1, 'host fick stage_loaded (wave=' + hostStage.d.wave + ')', hostStage.d);
  ok(typeof hostStage.d.stageName === 'string' && hostStage.d.stageName.length > 0,
    'stage_loaded har stageName', hostStage.d);

  // Vänta tills hostens event-kö garanterat är dränerad (några world-ticks)
  await host.wait(it => it.t === 'msg' && it.d.type === 'world', 8000);

  // Late-joiner (godot) — ska få stage_loaded inom 3s med samma wave/stageName
  const joiner = await mkClient('JOINER');
  joiner.send({ type: 'join', code, name: 'JOINER', godot: 1 });
  await joiner.waitMsg('joined', 6000);
  let late = null;
  try {
    late = await joiner.waitEvt('stage_loaded', 3000);
  } catch (e) { /* timeout → fail nedan */ }
  ok(!!late, 'joinern fick stage_loaded inom 3s', late && late.d);
  if (late) {
    ok(late.d.wave === hostStage.d.wave, 'samma wave (' + hostStage.d.wave + ')', late.d.wave);
    ok(late.d.stageName === hostStage.d.stageName,
      'samma stageName (' + hostStage.d.stageName + ')', late.d.stageName);
    ok(late.d.stageKind === hostStage.d.stageKind,
      'samma stageKind (' + hostStage.d.stageKind + ')', late.d.stageKind);
  }

  joiner.close();
  host.close();

  console.log('\n[probe-story-latejoin]', pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
