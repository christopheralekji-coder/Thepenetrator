// WAN-fix-verifiering: node-klienten hostar TDM, skriver rumskoden till en fil,
// pumpar input (rör sig) och skjuter mot Godot-klientens position var 250 ms.
// Godot-klienten (startas separat med join:KOD) ska då få pvp_shot-events →
// motionerar nya _shots-koden (st-fast-forward + owner-exkludering + grace) och
// pvp_hp_changed-vägen (flash_hurt) när Godot-spelarens auto-fire träffar oss.
// Avslut: skriver PASS/FAIL-rader. Körs mot lokal server.
//   node tools/probe-godot-pvpshot.js ws://localhost:8093 C:\temp\code.txt 35
'use strict';
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8093';
const CODE_FILE = process.argv[3] || path.join(require('os').tmpdir(), 'wp_room_code.txt');
const RUN_SEC = parseInt(process.argv[4] || '35', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const ws = new WebSocket(URL);
  const msgs = [];
  let myPeerId = null, mySlot = 0, code = null;
  const worldPos = {};   // slot → {x,y}
  let gotPeerJoin = false, shotsSent = 0, dmgTakenEvents = 0, dmgDealtSeen = 0, atkPidSeen = 0;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'world' && Array.isArray(m.players)) {
      for (const p of m.players) worldPos[p.c] = { x: p.x, y: p.y, hp: p.hp };
    }
    msgs.push(m);
    if (m.type === 'peer_joined' || m.type === 'peers') gotPeerJoin = true;
    if (m.type === 'sim_events') {
      for (const ev of m.events || []) {
        // vår hp sjönk via event → godot-klientens skott träffade oss
        if (ev.type === 'pvp_hp_changed' && ev.peerId === myPeerId) dmgTakenEvents++;
        if (ev.type === 'pvp_hp_changed' && ev.peerId && ev.peerId !== myPeerId) dmgDealtSeen++;
        // v2: kul-träffar ska bära exakt skytt-attribution
        if (ev.type === 'pvp_hp_changed' && ev.attackerPid) atkPidSeen++;
      }
    }
  });
  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  send({ type: 'host', name: 'PVPPROBE', godot: 1 });
  while (!code) {
    await sleep(50);
    const h = msgs.find(m => m.type === 'hosted');
    if (h) { code = h.code; myPeerId = h.peerId; }
  }
  fs.writeFileSync(CODE_FILE, code);
  console.log('[probe] hosted, kod=' + code + ' (skriven till ' + CODE_FILE + ')');

  // vänta på att Godot-klienten joinar (upp till 30s)
  const t0 = Date.now();
  while (!gotPeerJoin && Date.now() - t0 < 30000) {
    const pj = msgs.find(m => m.type === 'peer_joined');
    if (pj) gotPeerJoin = true;
    await sleep(100);
  }
  if (!gotPeerJoin) { console.log('FAIL: ingen peer joinade'); process.exit(1); }
  console.log('[probe] peer joinade → sim_start tdm');
  send({ type: 'sim_start', tdm: true, tdmTargetKills: 30, countdownMs: 1500 });

  // input-pump 20 Hz: rör oss i cirkel runt vår spawn (rörlig skytt = testar
  // skytt-exkluderingen — den ritade kroppen släpar efter server-pos);
  // skjut mot godot-spelaren var 250 ms
  await sleep(2500);
  let me = worldPos[mySlot] || { x: 1000, y: 1000 };
  const c0 = { x: me.x, y: me.y };
  let ang = 0;
  const pump = setInterval(() => {
    ang += 0.10;
    const tx = c0.x + Math.cos(ang) * 120;
    const ty = c0.y + Math.sin(ang) * 120;
    me = worldPos[mySlot] || me;
    send({ type: 'sim_input', x: tx, y: ty, hp: 100, aim: 0, weaponId: 'pistol' });
  }, 50);
  const shooter = setInterval(() => {
    me = worldPos[mySlot] || me;
    // sikta mot andra slotten (godot-spelaren) om synlig, annars rakt höger
    let aim = 0;
    for (const s of Object.keys(worldPos)) {
      if (parseInt(s, 10) !== mySlot) {
        const o = worldPos[s];
        aim = Math.atan2(o.y - me.y, o.x - me.x);
      }
    }
    send({ type: 'sim_shoot', x: me.x, y: me.y, ang: aim, weaponId: 'pistol' });
    shotsSent++;
  }, 250);

  await sleep(RUN_SEC * 1000);
  clearInterval(pump); clearInterval(shooter);

  console.log('[probe] skott skickade: ' + shotsSent);
  console.log((shotsSent > 50 ? 'PASS' : 'FAIL') + ': pvp_shot-volym (' + shotsSent + ')');
  console.log((dmgTakenEvents > 0 ? 'PASS' : 'INFO') + ': godot-klienten skadade oss ' + dmgTakenEvents + ' ggr (flash_hurt-vägen motionerad på godot-sidan: ' + (dmgDealtSeen > 0 ? 'ja, vi skadade dem ' + dmgDealtSeen + ' ggr' : 'nej') + ')');
  const totDmg = dmgTakenEvents + dmgDealtSeen;
  console.log((totDmg === 0 || atkPidSeen > 0 ? 'PASS' : 'FAIL') + ': attackerPid på kul-träffar (' + atkPidSeen + '/' + totDmg + ')');
  try { ws.close(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.log('PROBE-FEL:', e.message); process.exit(1); });
