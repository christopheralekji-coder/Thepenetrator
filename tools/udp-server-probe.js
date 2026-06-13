'use strict';
// E2E-probe (fas 2b): bootar RIKTIGA servern och kör den över UDP genom hela
// dispatchen. Bevisar att en UDP-peer duck-typar ws: host -> hosted (reliable),
// sim_start -> world-paket (unreliable). UdpClient = Node-spegeln av Godot-klienten.
//   node tools/udp-server-probe.js
const { spawn } = require('child_process');
const path = require('path');
const { UdpClient } = require('../server/net/udp-transport');

const PORT = 8090;
const ROOT = path.join(__dirname, '..');
const srv = spawn(process.execPath, ['server/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), UDP_PORT: String(PORT) },
});
let booted = false;
const fails = [];
let hostedCode = null, simStarted = false, worldCount = 0, gotUdpConn = false;

function done(ok) {
  try { srv.kill(); } catch (e) {}
  setTimeout(() => {
    console.log(`[PROBE] UDP-CONN sett av server: ${gotUdpConn ? 'JA' : 'NEJ'}`);
    console.log(`[PROBE] hosted: ${hostedCode || 'NEJ'} | sim_started: ${simStarted ? 'JA' : 'NEJ'} | world-paket: ${worldCount}`);
    if (fails.length) { console.error('[PROBE] ❌ MISSLYCKADES:\n  ' + fails.join('\n  ')); process.exit(1); }
    console.log('[PROBE] ✅ UDP E2E GRÖN — host->hosted (reliable) + sim_start->world (unreliable) via riktiga servern');
    process.exit(0);
  }, 200);
}

srv.stdout.on('data', (d) => {
  const s = d.toString();
  if (s.includes('[UDP-CONN]')) gotUdpConn = true;
  if (!booted && s.includes('Listening on port')) { booted = true; startClient(); }
});
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

function startClient() {
  const client = new UdpClient({ host: '127.0.0.1', port: PORT });
  client.on('connect', () => {
    client.send(JSON.stringify({ type: 'host', mode: 'castledefense', name: 'UDPProbe', godot: 1 }));
  });
  client.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (m.type === 'hosted') {
      hostedCode = m.code;
      client.send(JSON.stringify({ type: 'sim_start', mode: 'castledefense', difficulty: 'veteran', addBot: true, botCount: 2 }));
    } else if (m.type === 'sim_started') {
      simStarted = true;
    } else if (m.type === 'world') {
      worldCount++;
    }
  });

  // utvärdera efter att sim hunnit ticka + broadcasta world ett tag
  setTimeout(() => {
    if (!gotUdpConn) fails.push('servern loggade aldrig [UDP-CONN] (handshake nådde ej dispatch)');
    if (!hostedCode) fails.push('inget hosted-svar (reliable kanal in/ut bruten)');
    if (!simStarted) fails.push('inget sim_started');
    if (worldCount < 5) fails.push(`bara ${worldCount} world-paket (unreliable world-broadcast bruten?)`);
    client.close();
    done(fails.length === 0);
  }, 5000);
}

setTimeout(() => { fails.push('TIMEOUT — servern bootade aldrig?'); done(false); }, 15000);
