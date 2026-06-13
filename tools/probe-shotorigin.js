// Probe AAA anti-cheat: skott-origin clampas vid teleport-skott (PvP).
//   node tools/probe-shotorigin.js <ws-url> <sim-debug-logfile>
const fs = require('fs');
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8098';
const LOG = process.argv[3];
const ws = new WebSocket(URL);
let myPeer = '', myX = null, myY = null, phase = 'drive', shotAt = 0;
const fails = [];
const fin = (code) => { try { ws.close(); } catch (e) {} process.exit(code); };
setTimeout(() => { fails.push('TIMEOUT'); done(); }, 20000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'ORIGINPROBE', godot: 1, bin: 0 })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') { myPeer = m.peerId; ws.send(JSON.stringify({ type: 'sim_start', mode: 'tdm', tdm: true, addBot: false, botCount: 0 })); }
  else if (m.type === 'world') { const me = (m.players || []).find(p => p.c === 0); if (me) { myX = me.x; myY = me.y; } }
});
ws.on('error', (e) => { fails.push('WS ' + e.message); done(); });
const shoot = (x, y) => ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: 'pistol', x, y, ang: 0 }));
setInterval(() => {
  if (myX === null) return;
  ws.send(JSON.stringify({ type: 'sim_input', x: 2000, y: 2000, hp: 100, aim: 0, seq: (Date.now() & 0xFFFF) }));
  const near = Math.abs(myX - 2000) < 120 && Math.abs(myY - 2000) < 120;
  if (phase === 'drive' && near) { phase = 'legit'; shotAt = Date.now(); console.log('stabil vid', myX, myY, '→ skjuter'); }
  else if (phase === 'legit' && Date.now() - shotAt > 300) { shoot(myX, myY); console.log('LEGIT skott @', myX, myY); phase = 'tele'; shotAt = Date.now(); }
  else if (phase === 'tele' && Date.now() - shotAt > 600) { shoot(myX + 7000, myY); console.log('TELE skott @', myX + 7000, myY); phase = 'wait'; shotAt = Date.now(); }
  else if (phase === 'wait' && Date.now() - shotAt > 800) { phase = 'done'; done(); }
}, 100);
function done() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8'); } catch (e) { fails.push('log saknas'); }
  const poss = log.split('\n').filter(l => l.includes('shoot from ' + myPeer) && l.includes('pos=('))
    .map(l => { const mo = l.match(/pos=\((-?\d+),(-?\d+)\)/); return mo ? { x: +mo[1], y: +mo[2] } : null; }).filter(Boolean);
  console.log('skott-origins i loggen:', JSON.stringify(poss));
  if (poss.length < 2) { fails.push('för få shoot-loggar (' + poss.length + ')'); }
  else {
    const legit = poss[poss.length - 2], tele = poss[poss.length - 1];
    const cLegit = Math.abs(legit.x - 2000) < 150;
    const cTele = tele.x < 2600 && Math.abs(tele.x - 9000) > 5000;   // clampad nära 2000, EJ ~9000
    console.log((cLegit ? '✅' : '❌') + ' [1] LEGIT origin=' + legit.x + ' (~2000, oförändrat)');
    console.log((cTele ? '✅' : '❌') + ' [2] TELEPORT origin=' + tele.x + ' clampat (begärde 9000 → server-pos ~2000)');
    if (!cLegit) fails.push('legit felklampat (' + legit.x + ')');
    if (!cTele) fails.push('teleport EJ clampat (' + tele.x + ')');
  }
  console.log(fails.length ? ('\n❌ ' + fails.join(', ')) : '\n✅ GRÖNT — skott-origin valideras (teleport clampas, legit orört)');
  fin(fails.length ? 1 : 0);
}
