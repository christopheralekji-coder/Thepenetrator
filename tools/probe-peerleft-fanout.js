// Probe: SLUTAUDIT 2 #12 — peer_left ska nå icke-host-_jsonWorld-peers (Godot),
// inte bara hosten. Före fixen: bara hosten fick peer_left → spök-peers hos joiners.
// Kör mot lokal server:  node tools/probe-peerleft-fanout.js [ws://localhost:8093]
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
      c._push('msg', m);
    });
  });
}

(async () => {
  console.log('[probe-peerleft-fanout] mot', URL);
  const host = await mkClient('HOST');
  host.send({ type: 'host', name: 'HOST', godot: 1 });
  const hosted = await host.waitMsg('hosted', 6000);
  const code = hosted.d.code;

  const j1 = await mkClient('J1');
  j1.send({ type: 'join', code, name: 'J1', godot: 1 });
  const j1joined = await j1.waitMsg('joined', 6000);

  const j2 = await mkClient('J2');
  j2.send({ type: 'join', code, name: 'J2', godot: 1 });
  const j2joined = await j2.waitMsg('joined', 6000);
  const j2pid = j2joined.d.peerId;

  // J1 (icke-host, _jsonWorld) ska se J2 joina...
  await j1.wait(it => it.t === 'msg' && it.d.type === 'peer_joined' && it.d.peerId === j2pid, 4000);
  // ...och J2 lämna (leave → handleDisconnect-vägen)
  j2.send({ type: 'leave' });
  let gotHost = null, gotJ1 = null;
  try { gotHost = await host.wait(it => it.t === 'msg' && it.d.type === 'peer_left' && it.d.peerId === j2pid, 4000); } catch (e) {}
  try { gotJ1 = await j1.wait(it => it.t === 'msg' && it.d.type === 'peer_left' && it.d.peerId === j2pid, 4000); } catch (e) {}
  ok(!!gotHost, 'hosten fick peer_left (oförändrat beteende)', j2pid);
  ok(!!gotJ1, 'icke-host-_jsonWorld-peer fick peer_left (#12-fixen)', j2pid);
  // Ingen dubblett till hosten
  const dupes = host.items.filter(it => it.t === 'msg' && it.d.type === 'peer_left' && it.d.peerId === j2pid).length;
  ok(dupes === 0, 'ingen dubbel peer_left till hosten', dupes);

  j1.close(); j2.close(); host.close();
  console.log('\n[probe-peerleft-fanout]', pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
