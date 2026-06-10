// Probe: gör GUN-skott (sim_shoot rifle) skada på enemies i survivors (Godot-klient)?
//   node tools/probe-gun-dmg.js [ws://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';

const ws = new WebSocket(URL);
let me = { x: 2000, y: 2000 }, target = null, baseHp = null, shots = 0, inputTimer = null;
const die = (msg, code) => { console.log(msg); clearInterval(inputTimer); try { ws.close(); } catch (e) {} process.exit(code); };
setTimeout(() => die('TIMEOUT (60s) — ingen gun-skada registrerad (skott: ' + shots + ')', 1), 60000);

ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'GPROBE', godot: 1 })));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
  if (m.type === 'hosted') ws.send(JSON.stringify({ type: 'sim_start', mode: 'survivors' }));
  else if (m.type === 'sim_started') {
    inputTimer = setInterval(() => ws.send(JSON.stringify({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: 0 })), 100);
  } else if (m.type === 'world' && Array.isArray(m.enemies)) {
    const full = m.enemies.filter(e => e && typeof e.x === 'number' && typeof e.hp === 'number');
    if (!target && full.length) { target = full[0].i; baseHp = full[0].hp; console.log('mål: enemy', target, 'hp', baseHp); }
    if (target != null) {
      const t = full.find(e => e.i === target);
      if (!t) { if (shots > 0) die('✅ målet DOG av rifle-skott (' + shots + ' skott) → GUN-SKADA FUNKAR', 0); target = null; return; }
      if (t.hp < baseHp && shots > 0) die('✅ enemy-hp ' + baseHp + ' → ' + t.hp + ' efter ' + shots + ' rifle-skott → GUN-SKADA FUNKAR', 0);
      // stå 150px väster om målet, skjut österut mot det
      me = { x: t.x - 150, y: t.y };
      const ang = Math.atan2(t.y - me.y, t.x - me.x);
      ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: 'rifle', x: me.x, y: me.y, ang }));
      shots++;
    }
  }
});
ws.on('error', (e) => die('WS-fel: ' + e.message, 1));
