// Probe: stoppar PvE-stage-väggar kulor? Två faser i survivors (PvE):
//   A) sim_start MED stageWalls = jätte-vägg som täcker allt → skott ska INTE skada.
//   B) nytt rum UTAN stageWalls → skott SKA skada (kontroll).
//   node tools/probe-pve-walls.js [ws://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';

function run(withWalls) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    let me = { x: 2000, y: 2000 }, target = null, baseHp = null, shots = 0, timer = null, damaged = false;
    const done = (ok) => { clearInterval(timer); try { ws.close(); } catch (e) {} resolve(ok); };
    setTimeout(() => done(damaged), 25000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'WPROBE', godot: 1 })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === 'hosted') {
        const start = { type: 'sim_start', mode: 'survivors' };
        if (withWalls) start.stageWalls = [[{ x: 0, y: 0, w: 6000, h: 6000 }]];
        ws.send(JSON.stringify(start));
      } else if (m.type === 'sim_started') {
        timer = setInterval(() => ws.send(JSON.stringify({ type: 'sim_input', x: me.x, y: me.y, hp: 100, aim: 0 })), 100);
      } else if (m.type === 'world' && Array.isArray(m.enemies)) {
        const full = m.enemies.filter(e => e && typeof e.x === 'number' && typeof e.hp === 'number');
        if (!target && full.length) { target = full[0].i; baseHp = full[0].hp; }
        if (target != null) {
          const t = full.find(e => e.i === target);
          if (!t) { if (shots > 3) { damaged = true; done(true); } else target = null; return; }
          if (t.hp < baseHp) { damaged = true; done(true); return; }
          me = { x: t.x - 150, y: t.y };
          ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: 'rifle', x: me.x, y: me.y, ang: Math.atan2(t.y - me.y, t.x - me.x) }));
          shots++;
        }
      }
    });
    ws.on('error', (e) => reject(e));
  });
}

(async () => {
  const dmgWithWalls = await run(true);
  const dmgWithout = await run(false);
  console.log('med jätte-vägg → skada:', dmgWithWalls, '| utan väggar → skada:', dmgWithout);
  if (!dmgWithWalls && dmgWithout) { console.log('✅ PvE-VÄGGAR STOPPAR KULOR (och utan väggar = V1-beteende)'); process.exit(0); }
  console.log('❌ FEL: väggarna stoppar inte kulor som väntat');
  process.exit(1);
})();
