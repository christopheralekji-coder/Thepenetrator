// V2 bot-AI-verifiering: hostar ETT läge med N bots, spårar varje bots position via
// JSON-world i ~RUN_SEC, och rapporterar:
//   - sim kraschade INTE (world-paket fortsätter komma)
//   - bot-positioner är FINITA (ingen NaN från wall-wiringen)
//   - bots NAVIGERAR (ackumulerad väglängd > tröskel = inte frusna/fast vid vägg)
//   - bots fastnar inte DJUPT i väggar (för väggbaserade arenor: andel ticks inne i solid vägg)
//
// Körs mot lokal server:  node tools/probe-bot-nav.js ws://localhost:8090 juggernaut hard 24
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const URL  = process.argv[2] || 'ws://localhost:8090';
const MODE = process.argv[3] || 'tdm';
const SKILL = process.argv[4] || 'hard';
const RUN_SEC = parseInt(process.argv[5] || '24', 10);
const BOTS = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// mode → sim_start-opts
const MODE_OPTS = {
  tdm:          { tdm: true, tdmTargetKills: 50 },
  ctf:          { ctf: true, ctfTargetCaptures: 5 },
  siege:        { siege: true },
  koth:         { koth: true },
  gungame:      { gungame: true },
  juggernaut:   { juggernaut: true },
  battleroyale: { battleroyale: true },
  survivors:    { survivors: true },
  castledefense:{ castledefense: true },
  heist:        { heist: true },
  story:        { mode: 'story', wave: 1 },
};

// Solid-walls för väggbaserade arenor (embed-check). Saknas → hoppa embed-check.
function loadWalls(mode) {
  try {
    if (mode === 'juggernaut') return require('../shared/juggernaut-arena').JUGGERNAUT_ARENA.walls;
    if (mode === 'heist')      return require('../shared/heist-arena').HEIST_ARENA.walls;
    if (mode === 'ctf')        return require('../shared/ctf-arena').CTF_ARENA.walls;
    if (mode === 'siege')      return require('../shared/siege-arena').SIEGE_ARENA.walls;
    if (mode === 'koth')       return require('../shared/koth-arena').KOTH_ARENA.walls;
    if (mode === 'gungame')    return require('../shared/gungame-arena').GUNGAME_ARENA.walls;
  } catch (e) {}
  return null;
}
function inWall(x, y, walls) {
  const r = 8; // strikt: bara DJUPA intrång räknas (bot-radie ~16, vägg-clamp tillåter kant-tangering)
  for (const w of walls) {
    if (w.w == null || w.h == null) continue;
    if (x + r >= w.x && x - r <= w.x + w.w && y + r >= w.y && y - r <= w.y + w.h) return true;
  }
  return false;
}

(async () => {
  const opts = MODE_OPTS[MODE];
  if (!opts) { console.log('OKÄNT MODE: ' + MODE); process.exit(1); }
  const walls = loadWalls(MODE);

  const ws = new WebSocket(URL);
  const msgs = [];
  let myPeerId = null, code = null;
  const botSlots = new Set();
  const worldPlayers = {};          // slot → {x,y,hp}
  const track = {};                 // slot → {pts:[], pathLen, embedTicks, samples}
  let worldCount = 0, lastWorldAt = 0;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    msgs.push(m);
    if (m.type === 'world' && Array.isArray(m.players)) {
      worldCount++; lastWorldAt = Date.now();
      for (const p of m.players) worldPlayers[p.c] = { x: p.x, y: p.y, hp: p.hp };
    }
    if (m.type === 'sim_events') {
      for (const ev of m.events || []) {
        if (ev.type === 'bot_joined' && ev.colorIdx != null) botSlots.add(ev.colorIdx);
      }
    }
  });
  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  send({ type: 'host', name: 'NAVPROBE', godot: 1 });
  for (let i = 0; i < 60 && !code; i++) {
    await sleep(50);
    const h = msgs.find(m => m.type === 'hosted');
    if (h) { code = h.code; myPeerId = h.peerId; }
  }
  if (!code) { console.log('FAIL: ingen hosted'); process.exit(1); }

  send(Object.assign({ type: 'sim_start', addBot: true, botCount: BOTS, botSkill: SKILL, countdownMs: 1500 }, opts));
  console.log('[nav] mode=' + MODE + ' skill=' + SKILL + ' bots=' + BOTS + ' — kör ' + RUN_SEC + 's');

  // Host står still i ett hörn (ger bots något att navigera mot/runt utan att vi stör).
  // Vänta ut countdown + spawn först.
  await sleep(3000);
  const myStart = worldPlayers[0] || { x: 1200, y: 1200 };
  const pump = setInterval(() => {
    send({ type: 'sim_input', x: myStart.x, y: myStart.y, hp: 100, aim: 0, weaponId: 'pistol' });
  }, 60);

  // Sampla bot-positioner var 250ms
  const startSample = Date.now();
  const sampler = setInterval(() => {
    for (const slot of botSlots) {
      const p = worldPlayers[slot];
      if (!p) continue;
      let t = track[slot];
      if (!t) { t = track[slot] = { last: null, pathLen: 0, embedTicks: 0, samples: 0, nan: 0, cells: new Set() }; }
      if (!isFinite(p.x) || !isFinite(p.y)) { t.nan++; continue; }
      t.samples++;
      t.cells.add(((p.x / 200) | 0) + ',' + ((p.y / 200) | 0));
      if (t.last) t.pathLen += Math.hypot(p.x - t.last.x, p.y - t.last.y);
      t.last = { x: p.x, y: p.y };
      if (walls && inWall(p.x, p.y, walls)) t.embedTicks++;
    }
  }, 250);

  await sleep(RUN_SEC * 1000);
  clearInterval(pump); clearInterval(sampler);

  // Rapport
  const sinceWorld = Date.now() - lastWorldAt;
  console.log('[nav] world-paket: ' + worldCount + ' (senast ' + sinceWorld + 'ms sedan)');
  const alive = sinceWorld < 2000 && worldCount > 20;
  console.log((alive ? 'PASS' : 'FAIL') + ': sim levande (inga tick-crash)');

  if (botSlots.size === 0) { console.log('FAIL: inga bots spawnade'); ws.close(); process.exit(1); }

  let anyNan = false, allMoved = true, anyEmbed = false;
  for (const slot of botSlots) {
    const t = track[slot];
    if (!t) { console.log('  bot slot ' + slot + ': INGEN DATA'); allMoved = false; continue; }
    const embedPct = t.samples ? Math.round(100 * t.embedTicks / t.samples) : 0;
    const moved = t.pathLen > 300;          // >300px över hela körningen = navigerar
    if (t.nan > 0) anyNan = true;
    if (!moved) allMoved = false;
    if (embedPct > 25) anyEmbed = true;     // >25% av tiden djupt i vägg = wall-running
    console.log('  bot slot ' + slot + ': väg=' + Math.round(t.pathLen) + 'px  unika-celler=' + t.cells.size +
                '  embed=' + embedPct + '%  nan=' + t.nan);
  }
  console.log((!anyNan ? 'PASS' : 'FAIL') + ': finita positioner (ingen NaN)');
  console.log((allMoved ? 'PASS' : 'FAIL') + ': alla bots navigerar (>300px väg)');
  if (walls) console.log((!anyEmbed ? 'PASS' : 'FAIL') + ': bots fastnar inte i väggar (<25% embed)');

  ws.close();
  process.exit((alive && !anyNan && allMoved && !anyEmbed) ? 0 : 2);
})().catch(e => { console.log('PROBE-FEL:', e.message); process.exit(1); });
