// Probe: V2-additiva server-tillägg (#62 countdownMs, #68 baseShield, #60 kick_peer,
// #58 sandbox-stage, #59 stresstest what/n). Kör mot lokal server:
//   $env:PORT=8091; node server\server.js   (i eget fönster)
//   node tools/probe-v2-server-additions.js [ws://localhost:8091]
// Asserterar BÅDE nya beteendet (med fält) och V1-default (utan fält).
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8091';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

// Klient-wrapper: unified stream av meddelanden + sim_events-events.
function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag,
      items: [],          // { t: 'msg'|'evt', d, at }
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
      // Vänta på item som matchar pred. consume=true tar äldsta buffrade matchen först.
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
      waitEvt(type, timeoutMs) { return this.wait(it => it.t === 'evt' && it.d.type === type, timeoutMs); },
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

async function hostRoom(name, godot) {
  const c = await mkClient(name);
  c.send({ type: 'host', name, godot: godot ? 1 : undefined });
  const h = await c.waitMsg('hosted', 6000);
  c.code = h.d.code; c.peerId = h.d.peerId;
  return c;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── a) #62 COUNTDOWN-PARAM ───────────────────────────────────────────────────
async function probeCountdown() {
  console.log('\n[a] #62 countdownMs');
  // Med countdownMs:3000
  let c = await hostRoom('CD3K', true);
  c.send({ type: 'sim_start', mode: 'story', countdownMs: 3000 });
  let cs = await c.waitEvt('countdown_start', 8000);
  ok(cs.d.durationMs === 3000, 'countdown_start.durationMs == 3000', cs.d.durationMs);
  const t0 = Date.now();
  await c.waitEvt('countdown_end', 8000);
  const dt = Date.now() - t0;
  ok(dt > 2300 && dt < 4300, 'countdown_end ~3s senare (' + dt + 'ms)', dt);
  c.close();
  // Utan param → 5000 (V1-default)
  c = await hostRoom('CD5K', true);
  c.send({ type: 'sim_start', mode: 'story' });
  cs = await c.waitEvt('countdown_start', 8000);
  ok(cs.d.durationMs === 5000, 'utan param → durationMs == 5000 (V1-default)', cs.d.durationMs);
  c.close();
}

// ── b) #68 BASE-SHIELD ───────────────────────────────────────────────────────
async function probeShield() {
  console.log('\n[b] #68 baseShield');
  // survivors (co-op) + baseShield:100 → world-paketets sh == 100
  let c = await hostRoom('SH100', true);
  c.send({ type: 'sim_start', survivors: 1, survivorsDurationSec: 120, baseShield: 100 });
  let w = await c.wait(it => it.t === 'msg' && it.d.type === 'world' && Array.isArray(it.d.players) && it.d.players.length > 0, 8000);
  ok(w.d.players[0].sh === 100, 'survivors + baseShield:100 → world players[0].sh == 100', w.d.players[0]);
  c.close();
  // story + baseShield:100 → sh == 100 (co-op story har annars ingen shield)
  c = await hostRoom('SHST', true);
  c.send({ type: 'sim_start', mode: 'story', baseShield: 100 });
  w = await c.wait(it => it.t === 'msg' && it.d.type === 'world' && Array.isArray(it.d.players) && it.d.players.length > 0, 8000);
  ok(w.d.players[0].sh === 100, 'story + baseShield:100 → sh == 100', w.d.players[0]);
  c.close();
  // story UTAN baseShield → sh == 0 (V1-paritet)
  c = await hostRoom('SH0', true);
  c.send({ type: 'sim_start', mode: 'story' });
  w = await c.wait(it => it.t === 'msg' && it.d.type === 'world' && Array.isArray(it.d.players) && it.d.players.length > 0, 8000);
  ok((w.d.players[0].sh || 0) === 0, 'story utan baseShield → sh == 0 (V1-default)', w.d.players[0]);
  c.close();
}

// ── c) #60 KICK_PEER ─────────────────────────────────────────────────────────
async function probeKick() {
  console.log('\n[c] #60 kick_peer');
  const host = await hostRoom('KHOST', true);
  const peer = await mkClient('KPEER');
  peer.send({ type: 'join', code: host.code, name: 'KPEER', godot: 1 });
  const j = await peer.waitMsg('joined', 6000);
  const peerPid = j.d.peerId;
  await host.waitMsg('peer_joined', 6000);
  host.send({ type: 'sim_start', tdm: 1, addBot: 1, botCount: 1 });
  const bj = await host.waitEvt('bot_joined', 8000);
  const botId = bj.d.peerId;
  // 3 deltagare i world (host + peer + bot)
  await host.wait(it => it.t === 'msg' && it.d.type === 'world' && it.d.players && it.d.players.length === 3, 8000);
  // Icke-host försöker kicka boten → ska ignoreras
  peer.send({ type: 'kick_peer', peerId: botId });
  let gotKick = true;
  try { await host.waitMsg('peer_kicked', 1500); } catch (e) { gotKick = false; }
  ok(!gotKick, 'icke-host kick_peer → ignoreras (ingen peer_kicked)');
  // Host kickar boten → peer_kicked + bot bort ur world-players
  host.clear(); peer.clear();
  host.send({ type: 'kick_peer', peerId: botId });
  const pk = await host.waitMsg('peer_kicked', 5000);
  ok(pk.d.peerId === botId, 'host kick av bot → peer_kicked(botId)', pk.d);
  await host.wait(it => it.t === 'msg' && it.d.type === 'world' && it.d.players && it.d.players.length === 2, 8000);
  ok(true, 'bot borta ur world-players (3 → 2)');
  // Host kickar människan → offret får {type:"kicked"}, host får peer_kicked
  host.clear();
  host.send({ type: 'kick_peer', peerId: peerPid });
  const kicked = await peer.waitMsg('kicked', 5000);
  ok(kicked.d.type === 'kicked', 'offret fick {type:"kicked"}');
  const pk2 = await host.waitMsg('peer_kicked', 5000);
  ok(pk2.d.peerId === peerPid, 'host fick peer_kicked(människa)', pk2.d);
  host.close(); peer.close();
}

// ── d) #58 SANDBOX ───────────────────────────────────────────────────────────
async function probeSandbox() {
  console.log('\n[d] #58 sandbox-stage');
  const c = await hostRoom('SBOX', true);
  c.send({
    type: 'sim_start', mode: 'story', wave: 1, countdownMs: 1000,
    customStages: [{
      id: 'sb1', name: 'SANDBOX', kind: 'arena',
      worldW: 1800, worldH: 1800,
      spawnPos: { x: 900, y: 900 }, goalPos: { x: 900, y: 200 },
      sandbox: true,
      zones: [{ count: 8, pool: ['grunt'] }],   // ska IGNORERAS i sandbox
    }],
  });
  await c.waitEvt('countdown_end', 8000);
  // Samla full world-snapshot — 6 dummies med hp 99999
  const w0 = await c.wait(it => it.t === 'msg' && it.d.type === 'world' && it.d.full === 1 && it.d.enemies && it.d.enemies.length > 0, 8000);
  ok(w0.d.enemies.length === 6, '6 dummy-fiender spawnade', w0.d.enemies.length);
  ok(w0.d.enemies.every(e => e.hp === 99999), 'alla dummies hp == 99999', w0.d.enemies.map(e => e.hp));
  const ringOk = w0.d.enemies.every(e => {
    const d = Math.hypot(e.x - 900, e.y - 900);
    return d > 200 && d < 300;
  });
  ok(ringOk, 'dummies i ~250px-ring runt center (900,900)');
  // 50 rifle-skott rakt mot närmsta dummy
  const tgt = w0.d.enemies[0];
  const me = { x: tgt.x - 120, y: tgt.y };
  const ang = Math.atan2(tgt.y - me.y, tgt.x - me.x);
  for (let i = 0; i < 50; i++) {
    c.send({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: ang });
    c.send({ type: 'sim_shoot', weaponId: 'rifle', x: me.x, y: me.y, ang });
    await sleep(40);
  }
  await sleep(1500);
  c.clear();
  const w1 = await c.wait(it => it.t === 'msg' && it.d.type === 'world' && it.d.full === 1 && it.d.enemies && it.d.enemies.length > 0, 8000);
  ok(w1.d.enemies.length === 6, 'efter 50 rifle-skott: fortfarande 6 dummies', w1.d.enemies.length);
  const t1 = w1.d.enemies.find(e => e.i === tgt.i);
  ok(!!t1 && t1.hp === 99999, 'beskjuten dummy odödlig (hp 99999)', t1 && t1.hp);
  // 20s utan wave-progression: zoneState 'idle' + max 6 enemies hela tiden
  let maxEnemies = 0, zsBad = null;
  const tEnd = Date.now() + 20000;
  while (Date.now() < tEnd) {
    let it;
    try { it = await c.wait(x => x.t === 'msg' && x.d.type === 'world', 5000); } catch (e) { break; }
    if (it.d.enemies) maxEnemies = Math.max(maxEnemies, it.d.full ? it.d.enemies.length : 0);
    if (it.d.gs && it.d.gs.zs !== 'idle') zsBad = it.d.gs.zs;
    await sleep(150); c.clear();
  }
  ok(maxEnemies <= 6, '20s: ingen extra enemy-spawn (max ' + maxEnemies + ')');
  ok(zsBad === null, '20s: zoneState förblir idle', zsBad);
  c.close();
}

// ── e) #59 STRESSTEST ────────────────────────────────────────────────────────
async function probeStresstest() {
  console.log('\n[e] #59 stresstest');
  const c = await hostRoom('STRESS', true);
  c.send({ type: 'sim_start', stresstest: 1, countdownMs: 1000 });
  await c.waitEvt('countdown_end', 8000);
  c.send({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0 });
  // Baseline enemy-count från dbg_stats
  let st = await c.waitEvt('dbg_stats', 6000);
  const base = st.d.enemies;
  // 2 × 100 enemies → ska gå ÖVER 80-capen (stresstest-cap = 1500)
  c.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  c.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  let maxE = base;
  const tEnd = Date.now() + 8000;
  while (Date.now() < tEnd && maxE < base + 190) {
    try { st = await c.waitEvt('dbg_stats', 4000); } catch (e) { break; }
    maxE = Math.max(maxE, st.d.enemies);
  }
  ok(maxE >= base + 190, '2×(what:enemies,n:100) → +200 enemies (' + base + ' → ' + maxE + ')');
  ok(maxE > 80, 'enemy-count över gamla 80-capen (' + maxE + ')');
  // Clamp: n:5000 ska clampas till 100
  c.send({ type: 'sim_stresstest', what: 'enemies', n: 5000 });
  await sleep(1200);
  let afterClamp = 0;
  try { st = await c.waitEvt('dbg_stats', 4000); afterClamp = st.d.enemies; } catch (e) {}
  ok(afterClamp <= maxE + 110, 'n clampas till max 100 per anrop (' + maxE + ' → ' + afterClamp + ')');
  // Bullets: what:'bullets', n:200 → fiende-kulor i sim:en
  c.send({ type: 'sim_stresstest', what: 'bullets', n: 200 });
  let maxB = 0;
  const tEndB = Date.now() + 4000;
  while (Date.now() < tEndB && maxB < 150) {
    try { st = await c.waitEvt('dbg_stats', 3000); } catch (e) { break; }
    maxB = Math.max(maxB, st.d.bullets);
  }
  ok(maxB >= 150, '(what:bullets,n:200) → ≥150 kulor i sim (' + maxB + ')');
  c.close();
}

(async () => {
  try {
    await probeCountdown();
    await probeShield();
    await probeKick();
    await probeSandbox();
    await probeStresstest();
  } catch (e) {
    fail++;
    console.log('  ❌ PROBE-EXCEPTION:', e.message);
  }
  console.log('\n══════════════════════════════');
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
})();
