// Probe: går fiender genom PvE-stage-väggar (story-husen)? v2-fixen resolvar
// cirkel-vs-rect efter AI-rörelsen (glid längs väggen, ingen path-ändring).
//   Story-stage (wave 1: 2000×2800, spawnPos nere, goalPos uppe) med en stor
//   horisontell vägg mellan fiende-spawn-området (uppe/mitten) och spelaren (nere).
//   Väggen har fria gap på båda sidor (x 0-500 + 1500-2000) så fiender kan GLIDA
//   runt den.
//   PASS-krav över 15s world-poll:
//     1. INGEN fiende har någonsin sitt centrum inne i väggen (epsilon 1px)
//     2. Fiender närmar sig ändå spelaren (≥3 unika fiender inom 250px = glid funkar)
//   node tools/probe-enemy-walls.js [ws://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';

// Vägg mitt i stage 1 (2000×2800). Spelaren står nere till HÖGER om väggens
// skugga → fiender ovanför rör sig diagonalt mot spelaren, träffar väggen och
// ska GLIDA längs den (tangentiell komponent består) runt östra kanten (x=1500).
// Rak-på-fall (dx≈0) täcks av V1:s stuck-sidestep precis som klient-sim:en.
const WALL = { x: 500, y: 1800, w: 1000, h: 140 };
const ME = { x: 1700, y: 2300 };
const RUN_MS = 15000;

const ws = new WebSocket(URL);
let inputTimer = null;
let violations = 0;        // enemy-centrum inne i väggen
let seenEnemies = new Set();
let closeEnemies = new Set(); // unika fiender som nått inom 250px av spelaren
let packets = 0;
let endAt = 0;

function finish(extra) {
  clearInterval(inputTimer);
  try { ws.close(); } catch (e) {}
  console.log('world-paket:', packets, '| unika fiender:', seenEnemies.size,
    '| vägg-violations:', violations, '| fiender inom 250px:', closeEnemies.size, extra || '');
  const ok = packets > 10 && seenEnemies.size >= 5 && violations === 0 && closeEnemies.size >= 3;
  if (ok) {
    console.log('✅ FIENDER STOPPAS AV PvE-VÄGGAR + GLIDER RUNT (närmar sig spelaren)');
    process.exit(0);
  }
  if (violations > 0) console.log('❌ FEL: fiender hade koordinater INNE i väggen (' + violations + ' ggr)');
  else if (closeEnemies.size < 3) console.log('❌ FEL: fiender fastnar — bara ' + closeEnemies.size + ' nådde fram (glid funkar ej?)');
  else console.log('❌ FEL: för lite data (paket=' + packets + ', fiender=' + seenEnemies.size + ')');
  process.exit(1);
}

setTimeout(() => finish('(timeout)'), RUN_MS + 20000);

ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'EWPROBE', godot: 1 })));
ws.on('error', (e) => { console.log('❌ ws-fel:', e.message); process.exit(1); });
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    ws.send(JSON.stringify({
      type: 'sim_start', mode: 'story',
      stageWalls: [[WALL]],   // wave 1 = idx 0
    }));
  } else if (m.type === 'sim_started') {
    endAt = Date.now() + RUN_MS;
    inputTimer = setInterval(() => ws.send(JSON.stringify({ type: 'sim_input', x: ME.x, y: ME.y, hp: 100, aim: 0 })), 100);
  } else if (m.type === 'world' && Array.isArray(m.enemies)) {
    if (!endAt) return;
    packets++;
    for (const e of m.enemies) {
      if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') continue;
      seenEnemies.add(e.i);
      // 1. Centrum inne i väggen? (1px epsilon — resolven lämnar centrum utanför rect)
      if (e.x > WALL.x + 1 && e.x < WALL.x + WALL.w - 1 &&
          e.y > WALL.y + 1 && e.y < WALL.y + WALL.h - 1) {
        violations++;
        if (violations <= 5) console.log('  VIOLATION: enemy', e.i, 'inne i väggen @ (' + Math.round(e.x) + ',' + Math.round(e.y) + ')');
      }
      // 2. Närmar sig spelaren?
      const dx = e.x - ME.x, dy = e.y - ME.y;
      if (dx * dx + dy * dy < 250 * 250) closeEnemies.add(e.i);
    }
    if (Date.now() >= endAt) finish();
  }
});
