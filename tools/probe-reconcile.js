// Probe AAA #6: server-auktoritär input-driven rörelse + seq/ack reconcile.
// Hostar TDM (PvP) som Godot-klient och verifierar mot RIKTIGA servern:
//   1) world.ack ekar senast behandlade input-seq
//   2) gångfart accepteras exakt (serverX följer rapporterad x)
//   3) dash-fart (~900px/s) accepteras (INTE clampad — gamla 460-buggen borta)
//   4) teleport (1500px på en input) CLAMPAS (anti-fusk)
//   5) stale/omordnad input (gammalt seq) SLÄPPS (ack regredierar ej, pos orörd)
//   node tools/probe-reconcile.js [ws://localhost:8090]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';
const ws = new WebSocket(URL);

let seq = 0, myX = 0, myY = 0, started = false, t0 = 0;
let serverX = null, lastAck = -1;
const results = [];
let phase = 'init';
let phaseAt = 0;
const fails = [];

const die = (code) => {
  console.log('\n=== RESULTAT ===');
  results.forEach(r => console.log('  ' + r));
  if (fails.length) { console.log('❌ ' + fails.length + ' FEL:'); fails.forEach(f => console.log('   - ' + f)); }
  else console.log('✅ ALLA 5 KONTROLLER GRÖNA — predict/server-sim/reconcile fungerar');
  try { ws.close(); } catch (e) {}
  process.exit(code);
};
setTimeout(() => { fails.push('TIMEOUT (30s)'); die(1); }, 30000);

function send(x, y, s) { ws.send(JSON.stringify({ type: 'sim_input', x: Math.round(x), y: Math.round(y), hp: 100, aim: 0, seq: s & 0xFFFF })); }

ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'RECPROBE', godot: 1, bin: 0 })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    // tdm:true = PvP-flaggan (mode allena räcker inte — startSim gateas på opts.tdm)
    ws.send(JSON.stringify({ type: 'sim_start', mode: 'tdm', tdm: true, addBot: true, botCount: 1 }));
  } else if (m.type === 'world') {
    if (typeof m.ack === 'number') lastAck = m.ack;
    const me = (m.players || []).find(p => p.c === 0);
    if (me) serverX = me.x;
    if (me && !started) { started = true; myX = me.x; myY = me.y; t0 = Date.now(); phaseAt = Date.now(); }
  }
});
ws.on('error', (e) => { fails.push('WS-fel: ' + e.message); die(1); });

// Drivloop 100ms (dt≈0.1 → maxDelta = 1000*0.1+4 ≈ 104px/input)
setInterval(() => {
  if (!started) return;
  const since = Date.now() - t0;

  if (phase === 'init') {
    // vänta in spawn-invuln (>2.5s) så teleport-jumpen clampas (ej spawn-resync)
    myX += 30; seq++; send(myX, myY, seq);                 // gång österut 30px/input = 300px/s
    if (since > 600 && since < 700) { /* warmup */ }
    if (since > 3000) {
      // tolerans = en input (30px) + rundning: serverX släpar alltid ett paket
      const ok = Math.abs(serverX - myX) <= 40;
      results.push((ok ? '✅' : '❌') + ' [1] GÅNG accepterad: serverX=' + serverX + ' rapporterad=' + myX + ' (Δ=' + (serverX - myX) + ', ≤1 input)');
      results.push((lastAck > 0 ? '✅' : '❌') + ' [2] world.ack ekar input-seq: ack=' + lastAck + ' senast skickad=' + seq);
      if (!ok) fails.push('gång clampades fel');
      if (lastAck <= 0) fails.push('ack ekar inte');
      phase = 'dash'; phaseAt = Date.now();
    }
  } else if (phase === 'dash') {
    // EN dash-magnitud-jump: 90px på en input ≈ 900px/s @0.1 < cap → ska accepteras
    const before = serverX;
    myX += 90; seq++; send(myX, myY, seq);
    setTimeout(() => {
      const moved = serverX - before;
      const ok = moved >= 80;   // accepterades (ej clampad till gång)
      results.push((ok ? '✅' : '❌') + ' [3] DASH-fart accepterad: serverX flyttade ' + moved + 'px på en input (begärt 90, dash≈900px/s)');
      if (!ok) fails.push('dash clampades (gamla 460-buggen)');
      phase = 'tele'; phaseAt = Date.now();
    }, 250);
    phase = 'dash_wait';
  } else if (phase === 'tele') {
    const before = serverX;
    myX += 1500; seq++; send(myX, myY, seq);   // teleport-försök
    setTimeout(() => {
      const moved = serverX - before;
      const ok = moved < 400;   // clampad (cap·dt ~104-354 beroende på timer-jitter), INTE 1500
      results.push((ok ? '✅' : '❌') + ' [4] TELEPORT clampad: begärde +1500px, server flyttade ' + moved + 'px (cap≈104-354)');
      if (!ok) fails.push('teleport INTE clampad (' + moved + 'px)');
      // synka myX till serverns faktiska pos så stale-testet utgår från sanning
      myX = serverX;
      phase = 'stale'; phaseAt = Date.now();
    }, 250);
    phase = 'tele_wait';
  } else if (phase === 'stale') {
    const ackBefore = lastAck;
    const xBefore = serverX;
    // skicka en GAMMAL seq (ackBefore - 3) med stor position-hopp → ska ignoreras
    send(xBefore + 500, myY, (ackBefore - 3) & 0xFFFF);
    setTimeout(() => {
      const moved = Math.abs(serverX - xBefore);
      const ackOk = lastAck === ackBefore;   // ack regredierade inte
      const posOk = moved < 40;              // positionen rörde sig inte av stale-inputen
      const ok = ackOk && posOk;
      results.push((ok ? '✅' : '❌') + ' [5] STALE input släppt: ack ' + ackBefore + '→' + lastAck + ', pos rörde ' + moved.toFixed(0) + 'px');
      if (!ackOk) fails.push('stale input regredierade ack');
      if (!posOk) fails.push('stale input flyttade spelaren');
      die(fails.length ? 1 : 0);
    }, 300);
    phase = 'done';
  }
}, 100);
