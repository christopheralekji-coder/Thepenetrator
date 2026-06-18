'use strict';
// Temp guard-smoke för audit-fixar C241/C242/C105 (raderas efter körning).
const { Connection, T } = require('./net/udp-transport');
let ok = true;
const fail = (m) => { console.log('FAIL: ' + m); ok = false; };
const mk = (verified) => new Connection(7, () => {}, 0, !!verified);

// C241: kort/trasigt paket av varje typ får ALDRIG kasta (skulle krascha hela processen).
for (const t of [T.REL, T.ACK, T.UNREL, T.PING, T.PONG, T.BYE, 0x99, 0x00]) {
  for (let len = 1; len <= 18; len++) {
    const b = Buffer.alloc(len); b[0] = t;
    try { mk()._onPacket(b); } catch (e) { fail('throw type=0x' + t.toString(16) + ' len=' + len + ': ' + e.message); }
  }
}

// C105: REL med absurt fragCount (65535) ignoreras, ingen jätte-allokering, ingen leverans.
{
  const c = mk(); let delivered = false; c.on('message', () => delivered = true);
  const b = Buffer.alloc(20); b[0] = T.REL; b.writeUInt16LE(0, 13); b.writeUInt16LE(65535, 15);
  c._onPacket(b);
  if (delivered) fail('absurd-fragCount REL delivered');
}

// C105: flod av relSeq långt utanför fönstret får inte växa recvWin/asm.
{
  const c = mk();
  for (let i = 0; i < 50000; i++) {
    const b = Buffer.alloc(17); b[0] = T.REL; b.writeUInt32LE(1000000 + i * 7, 5); b.writeUInt32LE(i, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(1, 15);
    c._onPacket(b);
  }
  if (c._recvWin.size > 5000) fail('recvWin grew to ' + c._recvWin.size + ' under out-of-window flood');
  else console.log('  recvWin bounded at ' + c._recvWin.size + ' (out-of-window flood)');
}

// C105: flod INOM fönstret med distinkta msgId + ofullständiga frags → asm cappas vid 64.
{
  const c = mk();
  for (let i = 0; i < 300; i++) {
    const b = Buffer.alloc(17); b[0] = T.REL; b.writeUInt32LE(i, 5); b.writeUInt32LE(1000 + i, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(2, 15); // fragCount=2, bara frag0
    c._onPacket(b);
  }
  if (c._asm.size > 64) fail('asm cap exceeded: ' + c._asm.size);
  else console.log('  asm bounded at ' + c._asm.size + ' (in-window distinct-msgId flood)');
  if (c._recvWin.size > 5000) fail('recvWin grew to ' + c._recvWin.size + ' under in-window flood');
  else console.log('  recvWin bounded at ' + c._recvWin.size + ' (in-window flood, advance ran)');
}

// Happy path: ett riktigt 1-frag reliable-meddelande levereras oförändrat.
{
  const c = mk(); let got = null; c.on('message', (m) => got = m);
  const pl = Buffer.from('hello'); const b = Buffer.alloc(17 + pl.length);
  b[0] = T.REL; b.writeUInt32LE(0, 5); b.writeUInt32LE(0, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(1, 15); pl.copy(b, 17);
  c._onPacket(b);
  if (!got || got.toString() !== 'hello') fail('happy-path msg not delivered, got=' + (got && got.toString()));
  else console.log('  happy-path single-frag delivery OK');
}

// C242: overifierad conn skickar INGEN heartbeat-PING (ingen reflektion mot spoofad IP); verifierad gör det.
{
  const u = []; const cu = new Connection(7, (b) => u.push(b), 0, false); cu.tick(2000);
  if (u.some((b) => b[0] === T.PING)) fail('unverified conn emitted heartbeat PING'); else console.log('  unverified: no heartbeat PING (good)');
  const v = []; const cv = new Connection(7, (b) => v.push(b), 0, true); cv.tick(2000);
  if (!v.some((b) => b[0] === T.PING)) fail('verified conn did NOT emit heartbeat PING'); else console.log('  verified: heartbeat PING sent (good)');
  // C242: overifierad reaps snabbt (4s), verifierad lever till 8s.
  let closed = false; const cr = new Connection(7, () => {}, 0, false); cr.on('close', () => closed = true); cr.tick(5000);
  if (!closed) fail('unverified conn not reaped by 5s'); else console.log('  unverified reaped by 5s (good)');
}

console.log(ok ? '\nUDP-SMOKE OK' : '\nUDP-SMOKE FAIL');
process.exit(ok ? 0 : 1);
