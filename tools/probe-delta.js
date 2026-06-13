// Probe AAA per-entitet-delta (V2): hostar survivors + bots (fiender spawnar + dör)
// och verifierar mot RIKTIGA servern:
//   1) world blir DELTA (full=0 m. magra {i,x,y,hp}-entries) i st.f. full-varje-tick
//   2) NYA fiender kommer som FULL-entries (har 't') även i delta-paket
//   3) DÖDA fiender tas bort via reliable enemy_remove (ids matchar sedda fiender)
//   4) bandbredd: delta-paket << full-paket (byte-jämförelse)
//   node tools/probe-delta.js [ws://localhost:8090]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';
const ws = new WebSocket(URL);

// argv: [2]=url [3]=botCount [4]=difficulty (för tät svärm: 0 insane)
const BOTS = process.argv[3] !== undefined ? parseInt(process.argv[3], 10) : 3;
const DIFF = process.argv[4] || 'casual';
let enemyFullBytes = 0, enemyFullN = 0, enemyDeltaBytes = 0, enemyDeltaN = 0;
let nFull = 0, nDelta = 0;
let fullBytes = 0, deltaBytes = 0;
let deltaPktsWithDeltaEntries = 0;
let fullEntriesSeen = 0, deltaEntriesSeen = 0;
let removeMsgs = 0, removeIds = 0;
const everSeen = new Set();       // idx vi någonsin sett (full-entry)
const removedKnown = new Set();   // enemy_remove-idx som vi sett tidigare
let removedUnknown = 0;
const fails = [];

const die = (code) => {
  console.log('\n=== RESULTAT ===');
  const af = nFull ? Math.round(fullBytes / nFull) : 0;
  const ad = nDelta ? Math.round(deltaBytes / nDelta) : 0;
  console.log('  paket: full=' + nFull + ' delta=' + nDelta);
  console.log('  enemy-entries: full(t)=' + fullEntriesSeen + ' delta=' + deltaEntriesSeen);
  console.log('  enemy_remove: ' + removeMsgs + ' meddelanden, ' + removeIds + ' ids (' + removedUnknown + ' okända)');
  console.log('  snitt-byte/paket: full=' + af + ' delta=' + ad + (af ? '  (delta = ' + Math.round(100 * ad / af) + '% av full)' : ''));
  const bpf = enemyFullN ? (enemyFullBytes / enemyFullN).toFixed(1) : '–';
  const bpd = enemyDeltaN ? (enemyDeltaBytes / enemyDeltaN).toFixed(1) : '–';
  const winPct = (enemyFullN && enemyDeltaN) ? Math.round(100 * (1 - (enemyDeltaBytes / enemyDeltaN) / (enemyFullBytes / enemyFullN))) : 0;
  console.log('  PER ENEMY-ENTRY: full=' + bpf + 'B  delta=' + bpd + 'B  → delta sparar ' + winPct + '%/rörlig fiende (det riktiga levret)');
  const c1 = nDelta > 5 && deltaPktsWithDeltaEntries > 0;
  const c2 = fullEntriesSeen > 0 && deltaEntriesSeen > 0;
  const c3 = removeMsgs > 0 && removeIds > 0 && removedUnknown === 0;
  const c4 = nFull > 0 && nDelta > 0 && ad < af;
  console.log((c1 ? '✅' : '❌') + ' [1] DELTA aktiv (delta-paket med magra entries)');
  console.log((c2 ? '✅' : '❌') + ' [2] nya=full-entry, rörliga=delta-entry (mix)');
  console.log((c3 ? '✅' : '❌') + ' [3] reliable enemy_remove (kända ids, inga okända)');
  console.log((c4 ? '✅' : '❌') + ' [4] delta-paket mindre än full-paket');
  if (!c1) fails.push('delta ej aktiv');
  if (!c2) fails.push('ingen full/delta-mix');
  if (!c3) fails.push('enemy_remove saknas/okända ids');
  if (!c4) fails.push('ingen bandbredds-vinst');
  console.log(fails.length ? ('\n❌ ' + fails.length + ' FEL') : '\n✅ ALLA 4 GRÖNA — per-entitet-delta + reliable remove fungerar');
  try { ws.close(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
};
setTimeout(die, 24000);
ws.on('error', (e) => { fails.push('WS-fel: ' + e.message); die(1); });

ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'DELTAPROBE', godot: 1, bin: 0 })));
let inputTimer = null;
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    ws.send(JSON.stringify({ type: 'sim_start', mode: 'survivors', addBot: BOTS > 0, botCount: BOTS, difficulty: DIFF }));
  } else if (m.type === 'sim_started') {
    if (!inputTimer) inputTimer = setInterval(() => ws.send(JSON.stringify({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0, seq: (Date.now() & 0xFFFF) })), 100);
  } else if (m.type === 'world') {
    const enemies = m.enemies || [];
    const fullE = enemies.filter(e => e && e.t !== undefined);
    const deltaE = enemies.filter(e => e && e.t === undefined);
    fullEntriesSeen += fullE.length;
    deltaEntriesSeen += deltaE.length;
    for (const e of fullE) everSeen.add(e.i);
    // enemy-PORTIONS-byte per entry-typ (det faktiska delta-levret, oberoende av
    // players/hb/gs-baslinjen som dränker aggregatet i glesa scener)
    if (fullE.length) { enemyFullBytes += JSON.stringify(fullE).length; enemyFullN += fullE.length; }
    if (deltaE.length) { enemyDeltaBytes += JSON.stringify(deltaE).length; enemyDeltaN += deltaE.length; }
    const bytes = raw.length;
    if (m.full) { nFull++; fullBytes += bytes; }
    else { nDelta++; deltaBytes += bytes; if (deltaE.length) deltaPktsWithDeltaEntries++; }
  } else if (m.type === 'enemy_remove') {
    removeMsgs++;
    for (const id of (m.ids || [])) {
      removeIds++;
      if (everSeen.has(id)) removedKnown.add(id); else removedUnknown++;
    }
  }
});
