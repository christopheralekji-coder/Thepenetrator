// UDP-SPIKE (2026-06-13): bevisa att Node dgram <-> Godot PacketPeerUDP pratar.
// Minimal handshake + ping/pong. Ingen del av servern än — ren interop-test.
//   node tools/udp-spike.js [port]
// Protokoll (1 byte type + payload, little-endian):
//   0x01 HELLO    klient->server  (ingen payload)
//   0x02 WELCOME  server->klient  (u32 session)
//   0x03 PING     klient->server  (u64 klient-ts-ms)
//   0x04 PONG     server->klient  (u64 ekad ts)
const dgram = require('dgram');
const PORT = parseInt(process.argv[2] || '8099', 10);
const sock = dgram.createSocket('udp4');
let nextSession = 1;
const clients = new Map(); // 'addr:port' -> { session, lastSeen }

sock.on('message', (msg, rinfo) => {
  if (!msg.length) return;
  const type = msg[0];
  const key = rinfo.address + ':' + rinfo.port;
  if (type === 0x01) { // HELLO
    const session = nextSession++;
    clients.set(key, { session, lastSeen: Date.now() });
    const out = Buffer.alloc(5);
    out[0] = 0x02;
    out.writeUInt32LE(session, 1);
    sock.send(out, rinfo.port, rinfo.address);
    console.log('[UDP-SPIKE] HELLO', key, '-> WELCOME session', session);
  } else if (type === 0x03) { // PING -> PONG (eka 8 byte ts)
    const out = Buffer.alloc(9);
    out[0] = 0x04;
    msg.copy(out, 1, 1, 9);
    sock.send(out, rinfo.port, rinfo.address);
    const c = clients.get(key);
    if (c) c.lastSeen = Date.now();
    console.log('[UDP-SPIKE] PING<-', key, ' PONG->');
  }
});
sock.on('error', (e) => { console.error('[UDP-SPIKE] err', e); });
sock.bind(PORT, () => console.log('[UDP-SPIKE] lyssnar på udp://0.0.0.0:' + PORT));
