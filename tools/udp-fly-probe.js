'use strict';
// Live-UDP-probe mot Fly (fas 3): UdpClient mot den dedikerade IPv4:n över internet.
// Bevisar att UDP-transporten funkar i PROD (handshake + reliable + unreliable world).
//   node tools/udp-fly-probe.js [host] [port]
const { UdpClient } = require('../server/net/udp-transport');
const HOST = process.argv[2] || '137.66.8.225';   // warparty-eu dedikerad v4
const PORT = parseInt(process.argv[3] || '8080', 10);

let hosted = null, simStarted = false, world = 0, connected = false;
const client = new UdpClient({ host: HOST, port: PORT });
console.log('[FLY-PROBE] ansluter UDP ' + HOST + ':' + PORT + ' …');
client.on('connect', () => {
  connected = true;
  console.log('[FLY-PROBE] WELCOME — skickar host');
  client.send(JSON.stringify({ type: 'host', mode: 'castledefense', name: 'FlyProbe', godot: 1 }));
});
client.on('message', (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
  if (m.type === 'hosted') {
    hosted = m.code;
    console.log('[FLY-PROBE] hosted=' + hosted + ' — skickar sim_start');
    client.send(JSON.stringify({ type: 'sim_start', mode: 'castledefense', difficulty: 'veteran', addBot: true, botCount: 2 }));
  } else if (m.type === 'sim_started') simStarted = true;
  else if (m.type === 'world') world++;
});
setTimeout(() => {
  console.log(`[FLY-PROBE] connected=${connected} hosted=${hosted || 'NEJ'} sim_started=${simStarted} world=${world}`);
  client.close();
  const ok = connected && hosted && simStarted && world >= 5;
  if (ok) console.log('[FLY-PROBE] ✅ UDP LIVE PÅ FLY — handshake + reliable + unreliable world över internet');
  else console.log('[FLY-PROBE] ❌ UDP nådde inte hela vägen (deploy klar? IP rätt? UDP-routing?)');
  process.exit(ok ? 0 : 1);
}, 9000);
