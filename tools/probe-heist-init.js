// Probe: SLUTAUDIT 2 #2 — heist-init för V2-host (godot-peer utan playerState).
// Före fixen: `continue` skippade HELA initen → ingen spawn/sköld/vapen/invuln.
// Kör mot lokal server:
//   $env:PORT=8091; node server\server.js   (i eget fönster)
//   node tools/probe-heist-init.js [ws://localhost:8091]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8091';

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
  console.log('[probe-heist-init] mot', URL);

  // a) V2-host (godot, inget join/playerState) + heist + baseShield:100
  let c = await mkClient('HEIST1');
  c.send({ type: 'host', name: 'HEIST1', godot: 1 });
  const h = await c.waitMsg('hosted', 6000);
  c.send({ type: 'sim_start', heist: true, baseShield: 100, countdownMs: 1000 });
  let w = await c.wait(it => it.t === 'msg' && it.d.type === 'world'
    && Array.isArray(it.d.players) && it.d.players.length > 0, 10000);
  const p = w.d.players[0];
  ok(p.sh === 100, 'heist + baseShield:100 → sh == 100', p);
  ok(p.hp === 100, 'hp == 100 (arena startHp)', p.hp);
  ok(Math.abs(p.y - 3950) < 80, 'spawn på street (y≈3950)', { x: p.x, y: p.y });
  ok(p.x >= 1700 && p.x <= 2300, 'spawn-x inom playerSpawns-rad', p.x);
  c.close();

  // b) Utan baseShield → sh == 0 (arena-default, V1-paritet) men spawn ändå satt
  c = await mkClient('HEIST0');
  c.send({ type: 'host', name: 'HEIST0', godot: 1 });
  await c.waitMsg('hosted', 6000);
  c.send({ type: 'sim_start', heist: true, countdownMs: 1000 });
  w = await c.wait(it => it.t === 'msg' && it.d.type === 'world'
    && Array.isArray(it.d.players) && it.d.players.length > 0, 10000);
  const q = w.d.players[0];
  ok((q.sh || 0) === 0, 'utan baseShield → sh == 0 (V1-paritet)', q.sh);
  ok(Math.abs(q.y - 3950) < 80, 'spawn på street även utan baseShield', { x: q.x, y: q.y });
  c.close();

  console.log('\n[probe-heist-init]', pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
