'use strict';
// Temp guard-smoke för audit-fixar C241/C242/C105 (raderas efter körning).
const { Connection, UdpServer, T } = require('./net/udp-transport');
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

const SESS = 7;   // C8: mk() ger session=7 → data-paket måste bära rätt session i offset 1 (annars droppas de av session-guarden)

// C105: REL med absurt fragCount (65535) ignoreras, ingen jätte-allokering, ingen leverans.
{
  const c = mk(); let delivered = false; c.on('message', () => delivered = true);
  const b = Buffer.alloc(20); b[0] = T.REL; b.writeUInt32LE(SESS, 1); b.writeUInt16LE(0, 13); b.writeUInt16LE(65535, 15);
  c._onPacket(b);
  if (delivered) fail('absurd-fragCount REL delivered');
}

// C105: flod av relSeq långt utanför fönstret får inte växa recvWin/asm.
{
  const c = mk();
  for (let i = 0; i < 50000; i++) {
    const b = Buffer.alloc(17); b[0] = T.REL; b.writeUInt32LE(SESS, 1); b.writeUInt32LE(1000000 + i * 7, 5); b.writeUInt32LE(i, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(1, 15);
    c._onPacket(b);
  }
  if (c._recvWin.size > 5000) fail('recvWin grew to ' + c._recvWin.size + ' under out-of-window flood');
  else console.log('  recvWin bounded at ' + c._recvWin.size + ' (out-of-window flood)');
}

// C105: flod INOM fönstret med distinkta msgId + ofullständiga frags → asm cappas vid 64.
{
  const c = mk();
  for (let i = 0; i < 300; i++) {
    const b = Buffer.alloc(17); b[0] = T.REL; b.writeUInt32LE(SESS, 1); b.writeUInt32LE(i, 5); b.writeUInt32LE(1000 + i, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(2, 15); // fragCount=2, bara frag0
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
  b[0] = T.REL; b.writeUInt32LE(SESS, 1); b.writeUInt32LE(0, 5); b.writeUInt32LE(0, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(1, 15); pl.copy(b, 17);
  c._onPacket(b);
  if (!got || got.toString() !== 'hello') fail('happy-path msg not delivered, got=' + (got && got.toString()));
  else console.log('  happy-path single-frag delivery OK');
}

// C8: session-guard — paket med FEL session droppas (ingen leverans, lastRecvAt oförändrat).
{
  const c = mk(); let got = null; c.on('message', (m) => got = m);
  const before = c._lastRecvAt;
  const pl = Buffer.from('spoof'); const b = Buffer.alloc(17 + pl.length);
  b[0] = T.REL; b.writeUInt32LE(SESS + 1, 1); b.writeUInt32LE(0, 5); b.writeUInt32LE(0, 9); b.writeUInt16LE(0, 13); b.writeUInt16LE(1, 15); pl.copy(b, 17);
  c._onPacket(b);
  if (got) fail('wrong-session REL delivered');
  else if (c._lastRecvAt !== before) fail('wrong-session packet advanced lastRecvAt');
  else console.log('  wrong-session packet dropped, lastRecvAt untouched (good)');
}

// C46: LINGER-close — close() med obekräftade frags stänger INTE direkt; retransmitterar i tick
// och hård-stänger (BYE + emit close) först när _unacked töms eller lingret löper ut.
{
  const sent = []; const c = new Connection(SESS, (b) => sent.push(b), 0, true);
  let closed = null; c.on('close', (r) => closed = r);
  c.send(Buffer.from('important-event'));     // 1 frag i _unacked
  c.close('spectate_ended');
  if (closed) fail('close hard-closed immediately despite unacked frags');
  else if (!c._lingering) fail('close did not enter linger with unacked frags');
  else console.log('  close lingers with unacked frags (good)');
  // ACK:a allt → nästa tick ska hård-stänga.
  const ack = Buffer.alloc(25); ack[0] = T.ACK; ack.writeUInt32LE(SESS, 1); ack.writeUInt32LE(c._relSeqNext >>> 0, 5);
  c._onPacket(ack);
  c.tick(Date.now());
  if (closed !== 'spectate_ended') fail('linger did not hard-close after unacked drained, closed=' + closed);
  else console.log('  linger hard-closed after unacked drained (good)');
}

// C46: linger med tomt _unacked hård-stänger direkt (snabb-väg oförändrad).
{
  const c = new Connection(SESS, () => {}, 0, true);
  let closed = null; c.on('close', (r) => closed = r);
  c.close('bye');
  if (closed !== 'bye' || c._lingering) fail('empty-unacked close did not hard-close immediately');
  else console.log('  empty-unacked close hard-closes immediately (good)');
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

// C4 / C32: UdpServer-nivå — okänd-key BYE-reflektion + HELLO-supersede av rum-conn.
{
  const srv = new UdpServer({ port: 0, bindAddr: '127.0.0.1' });
  const outbox = [];
  srv._send = (buf, port, addr) => outbox.push({ buf, port, addr });   // fånga utgående paket

  // C4: paket från okänd addr:port → server svarar med BYE som bär klientens claimade session.
  const claimed = 0xABCDEF01;
  const rel = Buffer.alloc(17); rel[0] = T.REL; rel.writeUInt32LE(claimed, 1);
  srv._onMessage(rel, { address: '10.0.0.9', port: 55001 });
  const bye = outbox.find((o) => o.buf[0] === T.BYE);
  if (!bye) fail('C4: unknown-key packet did not trigger reflected BYE');
  else if (bye.buf.readUInt32LE(1) !== claimed) fail('C4: reflected BYE session mismatch');
  else console.log('  unknown-key packet → reflected BYE with claimed session (good)');
  // C4: andra paketet inom 1s samma nyckel → rate-limitad (ingen andra BYE).
  outbox.length = 0;
  srv._onMessage(rel, { address: '10.0.0.9', port: 55001 });
  if (outbox.some((o) => o.buf[0] === T.BYE)) fail('C4: reflected BYE not rate-limited');
  else console.log('  reflected BYE rate-limited within 1s (good)');

  // C32: HELLO skapar conn + WELCOME.
  outbox.length = 0;
  const hello = Buffer.from([T.HELLO, 0, 0, 0, 0]);
  srv._onMessage(hello, { address: '10.0.0.9', port: 55002 });
  const key = '10.0.0.9:55002';
  const c1 = srv._conns.get(key);
  if (!c1) fail('C32: HELLO did not create Connection');
  else console.log('  HELLO created Connection + WELCOME (good)');
  // simulera att conn:en gått in i ett rum (verifierad + roomCode).
  if (c1) { c1._verified = true; c1.roomCode = 'ABCD'; }
  const s1 = c1 && c1.session;
  let discFired = false; if (c1) c1.on('close', (r) => { if (r === 'replaced') discFired = true; });
  // C32: färsk HELLO från samma key → gammal conn 'replaced', ny conn med NY session.
  outbox.length = 0;
  srv._onMessage(hello, { address: '10.0.0.9', port: 55002 });
  const c2 = srv._conns.get(key);
  if (!discFired) fail('C32: old room-conn not closed(replaced) on fresh HELLO');
  else if (!c2 || c2 === c1) fail('C32: fresh HELLO did not allocate new Connection');
  else if (c2.session === s1) fail('C32: fresh HELLO reused old session');
  else console.log('  fresh HELLO on room-conn → supersede + new session (good)');

  srv.close();
}

console.log(ok ? '\nUDP-SMOKE OK' : '\nUDP-SMOKE FAIL');
process.exit(ok ? 0 : 1);
