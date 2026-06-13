'use strict';
// ============================================================================
// UDP-INTEGRATION (2026-06-13) — kopplar UdpServer till serverns rum/dispatch.
// V2-native talar UDP (V1 dött). Körs BREDVID WS under övergången. En UDP-peer
// DUCK-TYPAR ws-objektet (send/sendUnreliable/readyState/bufferedAmount/
// EventEmitter + godtyckliga props) → SAMMA handleMessage/handleDisconnect/
// broadcast/send som WS. Liveness sköts av transportens egen heartbeat/timeout
// (UDP-peers är ALDRIG i wss.clients → WS-heartbeat/RTT-looparna rör dem inte).
// Binder samma portnummer som HTTP/WS men på UDP (separat socket-namespace).
// Fly: kräver UDP-service i fly.toml (deploy-steget).
// ============================================================================
const { UdpServer } = require('./udp-transport');

function attachUdp({ handleMessage, handleDisconnect, genId, port, rttIntervalMs }) {
  // Fly: UDP_BIND='fly-global-services'. Lokalt: 0.0.0.0 (default).
  const udpServer = new UdpServer({ port, bindAddr: process.env.UDP_BIND || '0.0.0.0' });
  udpServer.on('listening', (p) => console.log('  UDP-transport: udp://0.0.0.0:' + p));
  udpServer.on('error', (e) => console.warn('[UDP-ERR]', e.message));
  udpServer.on('connection', (peer) => {
    peer.id = genId();                 // samma id-format som WS → rum/peer-maps konsekventa
    peer._connectedAt = Date.now();
    peer._jsonWorld = true;            // alla UDP-klienter är Godot/V2 → JSON-world
    peer._isUdp = true;
    console.log('[UDP-CONN]', peer.id, 'from', peer.address + ':' + peer.port);
    peer.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch (e) { return; }
      try { handleMessage(peer, msg); } catch (e) { console.error('udp-msg-error:', e.message); }
    });
    peer.on('close', (reason) => {
      const lifetime = Math.round((Date.now() - peer._connectedAt) / 1000);
      console.log('[UDP-DISC]', peer.id, 'reason=' + reason, 'lifetime=' + lifetime + 's');
      handleDisconnect(peer);
    });
  });
  // RTT-brygga: transportens srtt (ack-timing) → peer._serverRtt (bullets.js lag-comp).
  // Ersätter srv_rtt_ping/pong för UDP-peers (de träffar aldrig WS-RTT-loopen).
  setInterval(() => {
    for (const peer of udpServer.peers()) {
      if (peer.roomCode) peer._serverRtt = peer.getRtt();
    }
  }, rttIntervalMs || 1000);
  return udpServer;
}

module.exports = { attachUdp };
