// Probe: PvE-melee-gaten — Godot-klient (godot:1 → _jsonWorld) ska FORTFARANDE
// kunna melee-skada enemies i survivors efter V1-dubbelskade-gaten.
//   node tools/probe-melee-gate.js [ws://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';

const ws = new WebSocket(URL);
let me = { x: 2000, y: 2000 }, target = null, baseHp = null, swung = 0, inputTimer = null;
const die = (msg, code) => { console.log(msg); clearInterval(inputTimer); try { ws.close(); } catch (e) {} process.exit(code); };
setTimeout(() => die('TIMEOUT (60s) — ingen melee-skada registrerad: GATEN BLOCKERAR GODOT?', 1), 60000);

ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'MPROBE', godot: 1 })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    ws.send(JSON.stringify({ type: 'sim_start', mode: 'survivors' }));
  } else if (m.type === 'sim_started') {
    inputTimer = setInterval(() => {
      ws.send(JSON.stringify({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: 0 }));
    }, 100);
  } else if (m.type === 'world' && Array.isArray(m.enemies)) {
    const full = m.enemies.filter(e => e && typeof e.x === 'number' && typeof e.hp === 'number');
    if (!target && full.length) {
      target = full[0].i;
      baseHp = full[0].hp;
      console.log('mål: enemy', target, 'hp', baseHp);
    }
    if (target != null) {
      const t = full.find(e => e.i === target);
      if (!t) { if (swung > 0) die('✅ målet DOG av melee → PvE-melee funkar för Godot-klient', 0); target = null; return; }
      if (t.hp < baseHp && swung > 0) die('✅ enemy-hp ' + baseHp + ' → ' + t.hp + ' efter melee → gaten släpper igenom Godot', 0);
      // teleportera intill + svinga katana mot målet
      me = { x: t.x - 40, y: t.y };
      const ang = Math.atan2(t.y - me.y, t.x - me.x);
      ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: 'katana', x: me.x, y: me.y, ang }));
      swung++;
    }
  }
});
ws.on('error', (e) => die('WS-fel: ' + e.message, 1));
