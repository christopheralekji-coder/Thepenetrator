// Probe: TRANSPORT-LATENS & STABILITET (transport-pass 2026-06-10).
// Mäter och asserterar:
//   (a) RTT-fördelning server_ping→server_pong ×200, klient-socket MED/UTAN
//       noDelay (server-sidan har alltid noDelay — applyTcpKeepalive, server.js:21)
//   (b) world-paket-intervall-jitter över 10s (JSON-peer = 30Hz → ~33ms)
//   (c) payload-bytes per world-paket FÖRE/EFTER default-strippningen
//       (FÖRE rekonstrueras exakt: strippade default-fält åter-tillsatta, st borttaget)
//   (d) st-fält finns i world / sim_events-batch / server_pong
//   (e) backpressure: pausad klient-socket → servern skippar world till den peeren,
//       friska peers opåverkade, anslutningen överlever resume
// Kör mot lokal server:
//   $env:PORT=8111; node server\server.js   (i eget fönster)
//   node tools/probe-netcode.js [ws://localhost:8111]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8111';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = sum / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length);
  return {
    n: s.length, min: s[0], p50: pct(0.5), avg: Math.round(mean * 100) / 100,
    p95: pct(0.95), p99: pct(0.99), max: s[s.length - 1], sd: Math.round(sd * 100) / 100,
  };
}
function fmt(st) {
  return `n=${st.n} min=${st.min} p50=${st.p50} avg=${st.avg} p95=${st.p95} max=${st.max} sd=${st.sd}`;
}

// Rå klient — behåller HELA meddelanden (unwrappar INTE sim_events) + raw-bytes.
function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag, msgs: [], waiters: [],
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} },
      close: () => { try { ws.close(); } catch (e) {} },
      _push(d, rawLen) {
        const item = { d, rawLen, at: Date.now() };
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i];
          if (w.pred(item)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(item); return; }
        }
        this.msgs.push(item);
        if (this.msgs.length > 6000) this.msgs.splice(0, 3000);
      },
      wait(pred, timeoutMs) {
        const idx = this.msgs.findIndex(pred);
        if (idx >= 0) return Promise.resolve(this.msgs.splice(idx, 1)[0]);
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
      waitMsg(type, timeoutMs) { return this.wait(it => it.d.type === type, timeoutMs); },
      clear() { this.msgs.length = 0; },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw, isBinary) => {
      if (isBinary) { c._push({ type: '_binary' }, raw.length); return; }
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      c._push(m, Buffer.byteLength(raw.toString()));
    });
  });
}

async function hostGodotRoom(name, startMsg) {
  const c = await mkClient(name);
  c.send({ type: 'host', name, godot: 1 });
  const h = await c.waitMsg('hosted', 6000);
  c.code = h.d.code; c.peerId = h.d.peerId;
  if (startMsg) c.send(Object.assign({ type: 'sim_start' }, startMsg));
  return c;
}

// ── (a) RTT server_ping→server_pong ×200, klient-noDelay PÅ/AV ───────────────
async function probeRtt() {
  console.log('\n[a] RTT server_ping→server_pong ×200 (server har alltid noDelay — verifierat i kod, server.js:19-22+136)');
  async function measure(clientNoDelay) {
    const c = await mkClient('RTT' + (clientNoDelay ? 'ND' : 'NAGLE'));
    try { c.ws._socket.setNoDelay(clientNoDelay); } catch (e) {}
    const rtts = [];
    for (let i = 0; i < 200; i++) {
      const t0 = process.hrtime.bigint();
      c.send({ type: 'server_ping', t: Date.now() });
      await c.waitMsg('server_pong', 4000);
      rtts.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (i % 10 === 9) await sleep(5);
    }
    c.close();
    return stats(rtts.map(v => Math.round(v * 100) / 100));
  }
  const withNd = await measure(true);
  const withNagle = await measure(false);
  console.log('    klient-noDelay PÅ : ' + fmt(withNd) + ' (ms)');
  console.log('    klient-noDelay AV : ' + fmt(withNagle) + ' (ms)');
  console.log('    (loopback — Nagle-effekten är normalt osynlig lokalt; jämförelsen rapporteras ärligt, WAN-vinsten syns inte här)');
  // RTT-trösklarna gäller bara LOOPBACK — mot prod (Render EU) är p50 ~90ms
  // helt friskt (WAN-avstånd, inte server-fel). Där rapporteras siffrorna
  // informativt och STABILITETEN asserteras i stället (jitter-sd < 30ms).
  const isLocal = /localhost|127\.0\.0\.1/.test(URL);
  if (isLocal) {
    ok(withNd.p50 < 50, 'RTT p50 < 50ms lokalt (' + withNd.p50 + 'ms)', withNd);
    ok(withNd.p95 < 100, 'RTT p95 < 100ms lokalt (' + withNd.p95 + 'ms)', withNd);
  } else {
    console.log('    (WAN-läge: RTT-trösklar skippade — p50=' + withNd.p50 + 'ms är avstånd, inte fel)');
    ok(withNd.sd < 30, 'RTT-jitter sd < 30ms över WAN (' + withNd.sd + 'ms)', withNd);
    ok(withNd.p99 < withNd.p50 + 120, 'RTT p99 utan extrema spikar (' + withNd.p99 + 'ms)', withNd);
  }
}

// ── (d) st-fält i world / sim_events / server_pong ───────────────────────────
async function probeSt() {
  console.log('\n[d] st-tidsstämplar (additiva)');
  const c = await hostGodotRoom('STPROBE', { mode: 'story', countdownMs: 1000 });
  // server_pong.st
  c.send({ type: 'server_ping', t: 12345 });
  const pong = await c.waitMsg('server_pong', 5000);
  ok(pong.d.t === 12345, 'server_pong ekar t (V1-beteende intakt)', pong.d);
  ok(typeof pong.d.st === 'number' && Math.abs(pong.d.st - Date.now()) < 5000, 'server_pong.st = serverns klocka', pong.d.st);
  // world.st
  const w = await c.waitMsg('world', 8000);
  ok(typeof w.d.st === 'number' && Math.abs(w.d.st - Date.now()) < 5000, 'world.st finns + rimlig', w.d.st);
  // sim_events.st (dbg_stats-batchen kommer var 500ms via eventQueue)
  const ev = await c.waitMsg('sim_events', 8000);
  ok(typeof ev.d.st === 'number' && Math.abs(ev.d.st - Date.now()) < 5000, 'sim_events.st finns + rimlig', ev.d.st);
  // world.st monotont icke-fallande över 30 paket
  c.clear();
  let prev = 0, mono = true;
  for (let i = 0; i < 30; i++) {
    const wi = await c.waitMsg('world', 5000);
    if (wi.d.st < prev) mono = false;
    prev = wi.d.st;
  }
  ok(mono, 'world.st monotont icke-fallande (30 paket)');
  c.close();
}

// ── (b) world-intervall-jitter 10s + (c) payload FÖRE/EFTER ──────────────────
function reconstructBeforeBytes(pkt) {
  // Återskapa pre-bantnings-payloaden EXAKT: åter-tillsätt strippade default-fält
  // (verifierade mot gamla koden: b/mb/bk/n/p/fx/g i full-entries, rT i players)
  // + ta bort nya st. Aim-avrundningens besparing rekonstrueras INTE (originalets
  // decimaler okända) → FÖRE är en UNDERSKATTNING = rapporterad % är konservativ.
  const p = JSON.parse(JSON.stringify(pkt));
  delete p.st;
  for (const pl of (p.players || [])) { if (pl.rT === undefined) pl.rT = 0; }
  for (const e of (p.enemies || [])) {
    if (e.t === undefined) continue; // delta-entry (förekommer ej för JSON-peers, men säkra)
    if (e.b === undefined) e.b = 0;
    if (e.mb === undefined) e.mb = 0;
    if (e.bk === undefined) e.bk = '';
    if (e.n === undefined) e.n = '';
    if (e.p === undefined) e.p = 0;
    if (e.fx === undefined) e.fx = 0;
    if (e.g === undefined) e.g = 0;
  }
  return Buffer.byteLength(JSON.stringify(p));
}

async function measureWorldIntervals(c, ms) {
  const arrivals = [];
  const tEnd = Date.now() + ms;
  while (Date.now() < tEnd) {
    let it;
    try { it = await c.waitMsg('world', 3000); } catch (e) { break; }
    arrivals.push(it.at);
  }
  const intervals = [];
  for (let i = 1; i < arrivals.length; i++) intervals.push(arrivals[i] - arrivals[i - 1]);
  return stats(intervals);
}

async function probeJitterAndPayload() {
  console.log('\n[b]+[c] world-intervall-jitter + payload FÖRE/EFTER');
  // BASELINE: lätt rum (story, få enemies) — isolerar timer-granularitet från last.
  // OBS: Windows-setInterval kvantiseras till ~15.6ms → lokalt blir 33ms-målet
  // ofta ~31-47ms-mix. Render (Linux) har 1ms-timers → ~33ms där. Vi asserterar
  // därför KADENS-STABILITET (sd/p95 nära snittet), inte exakt 33.
  const lite = await hostGodotRoom('JITLITE', { mode: 'story', countdownMs: 1000 });
  await lite.wait(it => it.d.type === 'sim_events' && (it.d.events || []).some(e => e.type === 'countdown_end'), 10000);
  lite.clear();
  const liteSt = await measureWorldIntervals(lite, 5000);
  console.log('    BASELINE lätt rum : ' + fmt(liteSt) + ' (ms)');
  lite.close();
  console.log('    … stress-rum (~200 enemies):');
  const c = await hostGodotRoom('JITPAY', { stresstest: 1, countdownMs: 1000 });
  await c.wait(it => it.d.type === 'sim_events' && (it.d.events || []).some(e => e.type === 'countdown_end'), 10000);
  c.send({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0 });
  c.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  c.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  await sleep(800);
  c.clear();
  // Samla 10s world-paket
  const arrivals = [], sizes = [], beforeSizes = [];
  let enemyCounts = [];
  const tEnd = Date.now() + 10000;
  while (Date.now() < tEnd) {
    let it;
    try { it = await c.waitMsg('world', 3000); } catch (e) { break; }
    arrivals.push(it.at);
    sizes.push(it.rawLen);
    beforeSizes.push(reconstructBeforeBytes(it.d));
    enemyCounts.push((it.d.enemies || []).length);
    // Sanity på bantningen — kör på första paketet
    if (arrivals.length === 1) {
      const pl = it.d.players[0];
      ok(pl.rT === undefined, 'players[].rT strippad när 0', pl);
      ok(pl.sh !== undefined, 'players[].sh ALDRIG strippad (sticky default i V2)', pl);
      const aStr = String(pl.a);
      const dec = aStr.includes('.') ? aStr.split('.')[1].length : 0;
      ok(dec <= 2, 'players[].a max 2 decimaler', pl.a);
      const fullE = (it.d.enemies || []).find(e => e.t !== undefined && !e.b);
      ok(!!fullE && fullE.b === undefined && fullE.mb === undefined && fullE.n === undefined,
        'enemy full-entry: b/mb/n strippade vid default', fullE);
      ok(!!fullE && fullE.t !== undefined && fullE.mh !== undefined && fullE.c !== undefined,
        'enemy full-entry: t/mh/c kvar (t = full/delta-diskriminator)', fullE);
    }
  }
  const intervals = [];
  for (let i = 1; i < arrivals.length; i++) intervals.push(arrivals[i] - arrivals[i - 1]);
  const ist = stats(intervals);
  console.log('    world-intervall: ' + fmt(ist) + ' (ms) — mål ~33ms (30Hz JSON-peer; lokalt Windows: timer-kvantisering ger ~31-47)');
  ok(ist.n > 180, '≥180 world-paket på 10s (' + ist.n + ')');
  ok(ist.avg > 25 && ist.avg < 55, 'snitt-intervall 25-55ms (' + ist.avg + 'ms; 33 på Linux/Render)', ist);
  ok(ist.p95 < 85, 'p95-intervall < 85ms (' + ist.p95 + 'ms)', ist);
  ok(ist.max < 150, 'inga hick >150ms (max ' + ist.max + 'ms)', ist);
  // Stress får inte degradera kadensen mer än marginellt mot lätt rum
  ok(liteSt.avg > 0 && ist.avg < liteSt.avg * 1.6, 'stress-kadens inom 1.6× baseline (' + liteSt.avg + ' → ' + ist.avg + 'ms)');
  const szAfter = stats(sizes), szBefore = stats(beforeSizes);
  const savePct = Math.round((1 - szAfter.avg / szBefore.avg) * 1000) / 10;
  const avgEnemies = Math.round(enemyCounts.reduce((a, b) => a + b, 0) / Math.max(1, enemyCounts.length));
  console.log('    payload/paket (snitt ' + avgEnemies + ' enemies synliga):');
  console.log('      FÖRE  (rekonstruerad): avg=' + szBefore.avg + 'B  p95=' + szBefore.p95 + 'B');
  console.log('      EFTER (faktisk, inkl st): avg=' + szAfter.avg + 'B  p95=' + szAfter.p95 + 'B');
  console.log('      BESPARING: ' + savePct + '% (konservativ — aim-avrundningen ej medräknad i FÖRE)');
  ok(szAfter.avg < szBefore.avg, 'payload mindre än före bantning (' + savePct + '%)');
  c.close();
}

// ── (e) backpressure: pausad klient ───────────────────────────────────────────
async function probeBackpressure() {
  console.log('\n[e] backpressure — pausad klient-socket (läser inte) under stress');
  const host = await hostGodotRoom('BPHOST', null);
  const slow = await mkClient('BPSLOW');
  slow.send({ type: 'join', code: host.code, name: 'SLOW', godot: 1 });
  await slow.waitMsg('joined', 6000);
  host.send({ type: 'sim_start', stresstest: 1, countdownMs: 1000 });
  await host.wait(it => it.d.type === 'sim_events' && (it.d.events || []).some(e => e.type === 'countdown_end'), 10000);
  host.send({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0 });
  slow.send({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0 });
  host.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  host.send({ type: 'sim_stresstest', what: 'enemies', n: 100 });
  await sleep(800);
  // BASELINE: frisk peers world-takt FÖRE pausen (3s)
  host.clear();
  const tb = Date.now();
  let baseWorlds = 0;
  while (Date.now() - tb < 3000) {
    try { await host.waitMsg('world', 2000); baseWorlds++; } catch (e) { break; }
  }
  const baseRate = baseWorlds / 3;
  // PAUSA slow:s socket — TCP-fönstret stängs → serverns buffert växer → skip
  slow.ws._socket.pause();
  host.clear(); slow.clear();
  const t0 = Date.now();
  let hostWorlds = 0;
  while (Date.now() - t0 < 6000) {
    try { await host.waitMsg('world', 2000); hostWorlds++; } catch (e) { break; }
  }
  const hostRate = hostWorlds / 6;
  console.log('    frisk peer: ' + Math.round(baseRate * 10) / 10 + '/s före paus → ' + Math.round(hostRate * 10) / 10 + '/s under 6s slow-paus');
  ok(hostRate >= baseRate * 0.75, 'frisk peer opåverkad (≥75% av baseline-takt: ' + Math.round(hostRate * 10) / 10 + ' vs ' + Math.round(baseRate * 10) / 10 + '/s)');
  // RTT från frisk peer mitt under backpressure — servern får inte vara blockerad
  const tp = Date.now();
  host.send({ type: 'server_ping', t: tp });
  const pong = await host.waitMsg('server_pong', 3000);
  ok(Date.now() - tp < 500, 'server svarar ping <500ms under backpressure (' + (Date.now() - tp) + 'ms)');
  ok(typeof pong.d.st === 'number', 'pong.st även under backpressure');
  // Resume — anslutningen ska överleva och world-flödet återupptas
  slow.ws._socket.resume();
  await sleep(500);
  slow.clear();
  let resumed = false;
  try { await slow.waitMsg('world', 5000); resumed = true; } catch (e) {}
  ok(resumed, 'slow peer får world igen efter resume (anslutningen överlevde — ingen kick)');
  ok(slow.ws.readyState === WebSocket.OPEN, 'slow peer-socket fortfarande OPEN');
  host.close(); slow.close();
}

// ── (f) event-latens: sim_events skickas samma flush, FÖRE world ─────────────
async function probeEventOrder() {
  console.log('\n[f] event-ordning — sim_events FÖRE world i samma flush');
  const c = await hostGodotRoom('EVORD', { mode: 'story', countdownMs: 1000 });
  // Samla 5s rå meddelande-ordning; varje sim_events ska komma före (eller utan) world
  // med samma ankomst-ms — vi asserterar att event aldrig släpar >40ms efter att
  // dess flush-world anlänt (skulle indikera ackumulering över ticks).
  c.clear();
  const seq = [];
  const tEnd = Date.now() + 5000;
  while (Date.now() < tEnd) {
    let it;
    try { it = await c.wait(x => x.d.type === 'world' || x.d.type === 'sim_events', 3000); } catch (e) { break; }
    seq.push({ type: it.d.type, at: it.at, st: it.d.st });
  }
  const evs = seq.filter(s => s.type === 'sim_events');
  ok(evs.length >= 8, 'dbg_stats-events flödar (' + evs.length + ' batchar på 5s, ~2/s förväntat)');
  // För varje events-batch: närmaste FÖLJANDE world ska komma inom 40ms (samma/nästa flush)
  let orderedOk = 0;
  for (const e of evs) {
    const nextWorld = seq.find(s => s.type === 'world' && s.at >= e.at);
    if (nextWorld && nextWorld.at - e.at <= 40) orderedOk++;
  }
  ok(orderedOk >= evs.length - 1, 'events följs av world inom 40ms (' + orderedOk + '/' + evs.length + ') — ingen ackumulering över ticks');
  // st-delta events↔world i samma flush ska vara 0 (samma tick-now)
  const pairs = [];
  for (const e of evs) {
    const w = seq.find(s => s.type === 'world' && s.at >= e.at && typeof s.st === 'number');
    if (w && typeof e.st === 'number') pairs.push(Math.abs(w.st - e.st));
  }
  const maxStDelta = pairs.length ? Math.max(...pairs) : -1;
  ok(maxStDelta >= 0 && maxStDelta <= 35, 'st-delta events↔world ≤ 35ms (max ' + maxStDelta + 'ms) — samma/intilliggande tick');
  c.close();
}

// ── (g) V1-RISK-GUARD: binär världs-ström (icke-godot-klient) intakt ─────────
async function probeBinaryUnchanged() {
  console.log('\n[g] V1-guard — binärt world-paket (icke-godot) oförändrat format');
  const c = await new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const cc = { ws, bins: [], msgs: [] };
    ws.on('open', () => resolve(cc));
    ws.on('error', reject);
    ws.on('message', (raw, isBinary) => {
      if (isBinary) { cc.bins.push(Buffer.from(raw)); return; }
      try { cc.msgs.push(JSON.parse(raw.toString())); } catch (e) {}
    });
  });
  c.ws.send(JSON.stringify({ type: 'host', name: 'V1BIN' }));   // INGEN godot-flagga
  await sleep(500);
  c.ws.send(JSON.stringify({ type: 'sim_start', mode: 'story', wave: 1 }));
  c.ws.send(JSON.stringify({ type: 'sim_input', x: 1000, y: 2600, hp: 100, aim: 1.234567 }));
  const tEnd = Date.now() + 6000;
  while (c.bins.length < 10 && Date.now() < tEnd) await sleep(100);
  ok(c.bins.length >= 10, 'binära world-frames flödar till V1-klient (' + c.bins.length + ' st)');
  const noJsonWorld = !c.msgs.some(m => m.type === 'world');
  ok(noJsonWorld, 'ingen JSON-world läcker till V1-klient');
  const f = c.bins.find(b => b.length > 6 && b[0] === 0 && b[1] === 0xA3);
  ok(!!f, 'frame: [0][WP_MAGIC 0xA3] — server-world-prefix + magic intakt');
  if (f) {
    // payload: [magic][flags][seq u16][playerCount u8][c u8][x i16][y i16][hp u16][a i16]...
    const playerCount = f[5];
    ok(playerCount === 1, 'playerCount == 1', playerCount);
    const x = f.readInt16LE(7), y = f.readInt16LE(9), hp = f.readUInt16LE(11), a = f.readInt16LE(13);
    ok(x === 1000 && y === 2600, 'player x/y intakta (' + x + ',' + y + ')');
    ok(hp === 100, 'player hp intakt (' + hp + ')');
    ok(a === 1235, 'aim kvantiserad ×1000 = 1235 (FULL precision — JSON-avrundningen läcker INTE in i binär-vägen)', a);
  }
  try { c.ws.close(); } catch (e) {}
}

(async () => {
  console.log('PROBE-NETCODE mot ' + URL);
  try {
    await probeRtt();
    await probeSt();
    await probeJitterAndPayload();
    await probeBackpressure();
    await probeEventOrder();
    await probeBinaryUnchanged();
  } catch (e) {
    fail++;
    console.log('  ❌ PROBE-EXCEPTION:', e.message, e.stack && e.stack.split('\n')[1]);
  }
  console.log('\n══════════════════════════════');
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
})();
