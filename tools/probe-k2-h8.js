// Probe: K2 + H8 (audit 2026-06-10).
//   K2: joined-svaret innehåller stableSlot + code; peer_joined når Godot-joiners
//       (men ALDRIG V1-joiners — deras handler skulle dubblera welcome/config).
//   H8: EN (1) enemy_killed per PvE-melee-kill (dubbel-event-dedupe).
// Kör mot lokal server:
//   $env:PORT=8096; node server\server.js   (i eget fönster)
//   node tools/probe-k2-h8.js [ws://localhost:8096]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8096';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag,
      items: [],
      waiters: [],
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
      wait(pred, timeoutMs, consume) {
        if (consume !== false) {
          const idx = this.items.findIndex(pred);
          if (idx >= 0) return Promise.resolve(this.items.splice(idx, 1)[0]);
        }
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
      clear() { this.items.length = 0; },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === 'sim_events' && Array.isArray(m.events)) {
        for (const e of m.events) c._push('evt', e);
      } else if (m.type === 'sim_event' && m.event) {
        c._push('evt', m.event);
      } else {
        c._push('msg', m);
      }
    });
  });
}

// ── K2: joined.stableSlot + code, peer_joined-broadcast ──────────────────────
async function probeK2() {
  console.log('\n[K2] joined-svar + peer_joined-broadcast');
  const host = await mkClient('K2HOST');
  host.send({ type: 'host', name: 'K2HOST', godot: 1 });
  const h = await host.waitMsg('hosted', 6000);
  const code = h.d.code;

  // Joiner 1 (Godot)
  const j1 = await mkClient('K2J1');
  j1.send({ type: 'join', code, name: 'K2J1', godot: 1 });
  const jm1 = await j1.waitMsg('joined', 6000);
  ok(typeof jm1.d.stableSlot === 'number' && jm1.d.stableSlot >= 1,
    'joined-svar innehåller stableSlot (' + jm1.d.stableSlot + ')', jm1.d);
  ok(jm1.d.code === code, 'joined-svar innehåller code (' + jm1.d.code + ')', jm1.d);
  ok(jm1.d.hostId === h.d.peerId, 'joined-svar har kvar hostId (V1-fält intakt)', jm1.d);
  const pj1 = await host.waitMsg('peer_joined', 6000);
  ok(pj1.d.peerId === jm1.d.peerId && pj1.d.stableSlot === jm1.d.stableSlot,
    'host får peer_joined(j1) med samma stableSlot', pj1.d);

  // Joiner 2 (V1-stil, INGEN godot-flagga)
  const j2 = await mkClient('K2J2');
  j2.send({ type: 'join', code, name: 'K2J2' });
  const jm2 = await j2.waitMsg('joined', 6000);
  ok(typeof jm2.d.stableSlot === 'number' && jm2.d.stableSlot !== jm1.d.stableSlot,
    'j2 får eget stableSlot (' + jm2.d.stableSlot + ' ≠ ' + jm1.d.stableSlot + ')', jm2.d);
  // → host OCH godot-joinern j1 ska få peer_joined(j2)
  const pj2h = await host.waitMsg('peer_joined', 6000);
  ok(pj2h.d.peerId === jm2.d.peerId, 'host får peer_joined(j2)', pj2h.d);
  const pj2j1 = await j1.waitMsg('peer_joined', 6000);
  ok(pj2j1.d.peerId === jm2.d.peerId && pj2j1.d.stableSlot === jm2.d.stableSlot,
    'Godot-joinern j1 får peer_joined(j2) + stableSlot', pj2j1.d);

  // Joiner 3 (Godot) → host + j1 får peer_joined, men V1-joinern j2 får ALDRIG
  j2.clear();
  const j3 = await mkClient('K2J3');
  j3.send({ type: 'join', code, name: 'K2J3', godot: 1 });
  const jm3 = await j3.waitMsg('joined', 6000);
  await j1.waitMsg('peer_joined', 6000);
  ok(true, 'j1 får peer_joined(j3)');
  await sleep(1200);
  const v1Got = j2.items.some(it => it.t === 'msg' && it.d.type === 'peer_joined');
  ok(!v1Got, 'V1-joinern (utan godot-flagga) får INTE peer_joined (skulle dubblera welcome/config)');
  // j3 (ny joiner) ska inte få peer_joined om SIG SJÄLV
  const j3SelfPj = j3.items.some(it => it.t === 'msg' && it.d.type === 'peer_joined' && it.d.peerId === jm3.d.peerId);
  ok(!j3SelfPj, 'joinern får inte peer_joined om sig själv (doppelgänger-skydd)');

  host.close(); j1.close(); j2.close(); j3.close();
}

// ── H8: EN enemy_killed per PvE-melee-kill ───────────────────────────────────
async function probeH8() {
  console.log('\n[H8] enemy_killed-dedupe vid PvE-melee');
  const c = await mkClient('H8');
  c.send({ type: 'host', name: 'H8', godot: 1 });
  await c.waitMsg('hosted', 6000);
  c.send({ type: 'sim_start', mode: 'survivors' });
  await c.waitMsg('sim_started', 8000);

  const kills = [];        // alla enemy_killed-event (d.i = enemy-idx)
  // Sug upp events i bakgrunden via wait-loop på items: enklare — polla items.
  let me = { x: 2000, y: 2000 };
  const t0 = Date.now();
  let firstKillAt = 0;
  while (Date.now() - t0 < 30000) {
    // dränera buffrade enemy_killed
    for (let i = c.items.length - 1; i >= 0; i--) {
      const it = c.items[i];
      if (it.t === 'evt' && it.d.type === 'enemy_killed') { kills.push(it.d); c.items.splice(i, 1); }
    }
    if (!firstKillAt && kills.length > 0) firstKillAt = Date.now();
    if (firstKillAt && Date.now() - firstKillAt > 1500) break;   // 1.5s efterfönster för ev. dubblett
    // hitta senaste world-paket med enemies
    let world = null;
    for (let i = c.items.length - 1; i >= 0; i--) {
      const it = c.items[i];
      if (it.t === 'msg' && it.d.type === 'world' && Array.isArray(it.d.enemies) && it.d.enemies.length) { world = it.d; break; }
    }
    if (c.items.length > 800) c.items.splice(0, 400);
    if (world) {
      const t = world.enemies.find(e => typeof e.x === 'number');
      if (t) {
        me = { x: t.x - 40, y: t.y };
        const ang = Math.atan2(t.y - me.y, t.x - me.x);
        c.send({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: ang });
        c.send({ type: 'sim_shoot', weaponId: 'katana', x: me.x, y: me.y, ang });
      }
    } else {
      c.send({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: 0 });
    }
    await sleep(100);
  }
  ok(kills.length >= 1, 'minst en melee-kill registrerad (' + kills.length + ' enemy_killed)');
  const byIdx = {};
  for (const k of kills) byIdx[k.i] = (byIdx[k.i] || 0) + 1;
  const dupes = Object.keys(byIdx).filter(i => byIdx[i] > 1);
  ok(dupes.length === 0, 'ingen enemy-idx förekommer i fler än ETT enemy_killed', byIdx);
  c.close();
}

(async () => {
  try {
    await probeK2();
    await probeH8();
  } catch (e) {
    fail++;
    console.log('  ❌ PROBE-EXCEPTION:', e.message);
  }
  console.log('\n══════════════════════════════');
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
})();
