'use strict';
// ============================================================================
// UDP-TRANSPORT (2026-06-13) — reliable-UDP-lager för WarParty V2 (V1 dött).
// Ersätter WS/TCP för att döda head-of-line-stalls på mobilnät: world-snapshots
// går OTILLFÖRLITLIGT (nyaste vinner, släng gamla), events/acct/lobby går
// TILLFÖRLITLIGT-ORDNAT (seq + selektiv ack + resend + fragmentering).
//
// `Connection` är reliability-maskinen för EN peer-relation (delas server/klient).
// Server-sidans Connection DUCK-TYPAR `ws`-objektet (send/readyState/bufferedAmount
// + EventEmitter + godtyckliga props) → sim-koden (room-sim.js) rör sig oförändrad;
// enda sim-ändringen är att broadcastWorld kallar peer.sendUnreliable().
//
// Wire-format (allt little-endian):
//   0x01 HELLO   c->s : [type]
//   0x02 WELCOME s->c : [type][u32 session]
//   0x03 PING    both : [type][u32 session]            (heartbeat)
//   0x04 PONG    both : [type][u32 session]
//   0x05 BYE     both : [type][u32 session]
//   0x10 UNREL   data : [type][u32 session][u32 pktSeq][u16 fragIdx][u16 fragCount][payload]
//   0x20 REL     data : [type][u32 session][u32 relSeq][u32 msgId][u16 fragIdx][u16 fragCount][payload]
//   0x21 ACK     ack  : [type][u32 session][u32 ackBase][u32 ackBits]
// ============================================================================
const dgram = require('dgram');
const { EventEmitter } = require('events');

// MTU-konservativ payload (internet safe ~1200; vi lämnar marginal för headers).
const MAX_PAYLOAD = 1100;
const T = { HELLO: 0x01, WELCOME: 0x02, PING: 0x03, PONG: 0x04, BYE: 0x05,
            UNREL: 0x10, REL: 0x20, ACK: 0x21 };
const REL_HDR = 17, UNREL_HDR = 13;
const RTO_MIN = 100, RTO_MAX = 2000;
const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 8000;
const TICK_MS = 30;
// Otillförlitlig återmonterings-buffert: max antal halvfärdiga pktSeq vi håller
// (skydd mot minnesläck vid förlust). Vid överskridande slängs äldsta.
const UNREL_BUF_MAX = 8;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ── Paketbyggare ─────────────────────────────────────────────────────────────
function relPkt(session, relSeq, msgId, fragIdx, fragCount, payload) {
  const h = Buffer.allocUnsafe(REL_HDR);
  h[0] = T.REL;
  h.writeUInt32LE(session >>> 0, 1);
  h.writeUInt32LE(relSeq >>> 0, 5);
  h.writeUInt32LE(msgId >>> 0, 9);
  h.writeUInt16LE(fragIdx, 13);
  h.writeUInt16LE(fragCount, 15);
  return payload.length ? Buffer.concat([h, payload]) : h;
}
function unrelPkt(session, pktSeq, fragIdx, fragCount, payload) {
  const h = Buffer.allocUnsafe(UNREL_HDR);
  h[0] = T.UNREL;
  h.writeUInt32LE(session >>> 0, 1);
  h.writeUInt32LE(pktSeq >>> 0, 5);
  h.writeUInt16LE(fragIdx, 9);
  h.writeUInt16LE(fragCount, 11);
  return payload.length ? Buffer.concat([h, payload]) : h;
}
function ackPkt(session, ackBase, ackBits) {
  const b = Buffer.allocUnsafe(13);
  b[0] = T.ACK;
  b.writeUInt32LE(session >>> 0, 1);
  b.writeUInt32LE(ackBase >>> 0, 5);
  b.writeUInt32LE(ackBits >>> 0, 9);
  return b;
}
function ctrlPkt(type, session) {
  const b = Buffer.allocUnsafe(5);
  b[0] = type; b.writeUInt32LE(session >>> 0, 1);
  return b;
}

// ── Connection: reliability-maskin för EN peer ───────────────────────────────
class Connection extends EventEmitter {
  constructor(session, sendRaw, now) {
    super();
    this.session = session >>> 0;
    this._sendRaw = sendRaw;                // (Buffer) => void  (dgram-send till remote)
    this.closed = false;
    // duck-typade ws-fält (sim sätter playerState m.fl. själv)
    this.id = String(session);
    this.readyStateClosed = false;
    // reliable SEND
    this._relSeqNext = 0;
    this._msgIdNext = 0;
    this._unacked = new Map();              // relSeq -> {pkt, sentAt, sends, size}
    // reliable RECV
    this._recvExpected = 0;                 // minsta relSeq ej mottaget
    this._recvWin = new Set();              // mottagna relSeq >= recvExpected
    this._asm = new Map();                  // msgId -> {fragCount, parts:[], got}
    this._done = new Map();                 // msgId -> Buffer (färdig, väntar in-order)
    this._deliverNext = 0;                  // nästa msgId att leverera
    // unreliable SEND/RECV
    this._unrelSeqNext = 0;
    this._unrelNewest = -1;
    this._unrelAsm = new Map();             // pktSeq -> {fragCount, parts:[], got}
    // RTT / timing
    this._srtt = 200; this._rto = 300;
    this._lastRecvAt = now;
    this._lastHbAt = now;
  }

  // ── WS-kompatibel yta ──
  get readyState() { return this.readyStateClosed ? 3 : 1; }   // 1 OPEN / 3 CLOSED (WebSocket)
  get bufferedAmount() {
    let n = 0; for (const e of this._unacked.values()) n += e.size; return n;
  }

  send(data) {                              // RELIABLE (default — events/acct/lobby)
    if (this.closed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const msgId = this._msgIdNext++;
    const fragCount = Math.max(1, Math.ceil(buf.length / MAX_PAYLOAD));
    const now = Date.now();
    for (let i = 0; i < fragCount; i++) {
      const slice = buf.subarray(i * MAX_PAYLOAD, (i + 1) * MAX_PAYLOAD);
      const relSeq = this._relSeqNext++;
      const pkt = relPkt(this.session, relSeq, msgId, i, fragCount, slice);
      this._unacked.set(relSeq, { pkt, sentAt: now, sends: 1, size: slice.length });
      this._sendRaw(pkt);
    }
  }

  sendUnreliable(data) {                    // UNRELIABLE (world-snapshots)
    if (this.closed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const pktSeq = this._unrelSeqNext++;
    const fragCount = Math.max(1, Math.ceil(buf.length / MAX_PAYLOAD));
    for (let i = 0; i < fragCount; i++) {
      const slice = buf.subarray(i * MAX_PAYLOAD, (i + 1) * MAX_PAYLOAD);
      this._sendRaw(unrelPkt(this.session, pktSeq, i, fragCount, slice));
    }
  }

  // ── Inkommande datagram ──
  _onPacket(buf) {
    if (this.closed) return;
    this._lastRecvAt = Date.now();
    switch (buf[0]) {
      case T.REL:   this._onRel(buf);  break;
      case T.ACK:   this._onAck(buf);  break;
      case T.UNREL: this._onUnrel(buf); break;
      case T.PING:  this._sendRaw(ctrlPkt(T.PONG, this.session)); break;
      case T.PONG:  break;                  // lastRecvAt redan uppdaterat
      case T.BYE:   this.close('remote-bye'); break;
    }
  }

  _onRel(buf) {
    const relSeq = buf.readUInt32LE(5);
    const msgId = buf.readUInt32LE(9);
    const fragIdx = buf.readUInt16LE(13);
    const fragCount = buf.readUInt16LE(15);
    const payload = buf.subarray(REL_HDR);
    // duplikat eller redan passerat → bara acka
    if (relSeq >= this._recvExpected && !this._recvWin.has(relSeq)) {
      this._recvWin.add(relSeq);
      // montera meddelandet (per msgId)
      let a = this._asm.get(msgId);
      if (!a) { a = { fragCount, parts: new Array(fragCount), got: 0 }; this._asm.set(msgId, a); }
      if (!a.parts[fragIdx]) { a.parts[fragIdx] = payload; a.got++; }
      if (a.got === a.fragCount) {
        this._done.set(msgId, a.fragCount === 1 ? a.parts[0] : Buffer.concat(a.parts));
        this._asm.delete(msgId);
        this._deliverReady();
      }
      // flytta fram recvExpected över kontinuerligt mottagna relSeq
      while (this._recvWin.has(this._recvExpected)) {
        this._recvWin.delete(this._recvExpected);
        this._recvExpected = (this._recvExpected + 1) >>> 0;
      }
    }
    this._sendAck();
  }

  _deliverReady() {
    while (this._done.has(this._deliverNext)) {
      const m = this._done.get(this._deliverNext);
      this._done.delete(this._deliverNext);
      this._deliverNext = (this._deliverNext + 1) >>> 0;
      this.emit('message', m);
    }
  }

  _sendAck() {
    let bits = 0;
    for (let i = 1; i < 32; i++) {
      if (this._recvWin.has((this._recvExpected + i) >>> 0)) bits |= (1 << i);
    }
    this._sendRaw(ackPkt(this.session, this._recvExpected, bits >>> 0));
  }

  _onAck(buf) {
    const ackBase = buf.readUInt32LE(5);
    const ackBits = buf.readUInt32LE(9);
    const now = Date.now();
    for (const [relSeq, e] of this._unacked) {
      let acked = false;
      // ackBase = remote-sidans recvExpected → allt < ackBase är garanterat mottaget
      if (((relSeq - ackBase) >>> 0) >= 0x80000000 || relSeq < ackBase) acked = true;
      else {
        const off = (relSeq - ackBase) >>> 0;
        if (off < 32 && (ackBits & (1 << off))) acked = true;
      }
      if (acked) {
        if (e.sends === 1) {                // Karn: RTT bara från ej-omsända frags
          const sample = now - e.sentAt;
          this._srtt = this._srtt * 0.875 + sample * 0.125;
          this._rto = clamp(this._srtt * 2, RTO_MIN, RTO_MAX);
        }
        this._unacked.delete(relSeq);
      }
    }
  }

  _onUnrel(buf) {
    const pktSeq = buf.readUInt32LE(5);
    const fragIdx = buf.readUInt16LE(9);
    const fragCount = buf.readUInt16LE(11);
    const payload = buf.subarray(UNREL_HDR);
    if (pktSeq < this._unrelNewest) return;             // äldre än senast levererade → släng
    let a = this._unrelAsm.get(pktSeq);
    if (!a) {
      a = { fragCount, parts: new Array(fragCount), got: 0 };
      this._unrelAsm.set(pktSeq, a);
      if (this._unrelAsm.size > UNREL_BUF_MAX) {         // bounda minnet — släng äldsta halvfärdiga
        let oldest = Infinity;
        for (const k of this._unrelAsm.keys()) if (k < oldest) oldest = k;
        if (oldest !== pktSeq) this._unrelAsm.delete(oldest);
      }
    }
    if (!a.parts[fragIdx]) { a.parts[fragIdx] = payload; a.got++; }
    if (a.got === a.fragCount) {
      this._unrelAsm.delete(pktSeq);
      this._unrelNewest = pktSeq;
      // släng alla äldre halvfärdiga (de är nu inaktuella)
      for (const k of [...this._unrelAsm.keys()]) if (k < pktSeq) this._unrelAsm.delete(k);
      this.emit('message', a.fragCount === 1 ? a.parts[0] : Buffer.concat(a.parts));
    }
  }

  tick(now) {
    if (this.closed) return;
    if (now - this._lastRecvAt >= TIMEOUT_MS) { this.close('timeout'); return; }
    for (const e of this._unacked.values()) {           // resend obekräftade frags
      if (now - e.sentAt >= this._rto) {
        e.sentAt = now; e.sends++;
        this._sendRaw(e.pkt);
      }
    }
    if (now - this._lastHbAt >= HEARTBEAT_MS) {          // heartbeat
      this._lastHbAt = now;
      this._sendRaw(ctrlPkt(T.PING, this.session));
    }
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true; this.readyStateClosed = true;
    try { this._sendRaw(ctrlPkt(T.BYE, this.session)); } catch (e) { /* socket kan vara död */ }
    this.emit('close', reason || 'closed');
  }
  terminate() { this.close('terminate'); }                // ws-kompat alias
}

// ── UdpServer: binder en port, hanterar handshake + många Connections ────────
class UdpServer extends EventEmitter {
  constructor({ port, onConnection, lossSim = 0 }) {
    super();
    this.port = port;
    this.lossSim = lossSim;
    this._conns = new Map();                // 'addr:port' -> Connection
    this._sock = dgram.createSocket('udp4');
    this._nextSession = 1;
    this._sock.on('message', (buf, rinfo) => this._onMessage(buf, rinfo));
    this._sock.on('error', (e) => this.emit('error', e));
    this._sock.bind(port, () => this.emit('listening', port));
    if (onConnection) this.on('connection', onConnection);
    this._timer = setInterval(() => {
      const now = Date.now();
      for (const c of this._conns.values()) c.tick(now);
    }, TICK_MS);
  }
  _send(buf, port, addr) {
    if (this.lossSim > 0 && Math.random() < this.lossSim) return;   // simulera paketförlust
    this._sock.send(buf, port, addr);
  }
  _onMessage(buf, rinfo) {
    if (!buf.length) return;
    const key = rinfo.address + ':' + rinfo.port;
    if (buf[0] === T.HELLO) {
      let conn = this._conns.get(key);
      if (!conn) {
        const session = this._nextSession++;
        conn = new Connection(session, (b) => this._send(b, rinfo.port, rinfo.address), Date.now());
        conn.address = rinfo.address; conn.port = rinfo.port; conn._key = key;
        conn.on('close', () => this._conns.delete(key));
        this._conns.set(key, conn);
        this.emit('connection', conn);
      }
      this._send(ctrlPkt(T.WELCOME, conn.session), rinfo.port, rinfo.address);   // (re)WELCOME (idempotent)
      return;
    }
    const conn = this._conns.get(key);
    if (conn) conn._onPacket(buf);
  }
  close() {
    clearInterval(this._timer);
    for (const c of this._conns.values()) c.close('server-shutdown');
    try { this._sock.close(); } catch (e) { /* redan stängd */ }
  }
}

// ── UdpClient: ansluter till host:port, en Connection (speglar Godot-klienten) ─
class UdpClient extends EventEmitter {
  constructor({ host, port, lossSim = 0 }) {
    super();
    this.host = host; this.port = port; this.lossSim = lossSim;
    this.conn = null;
    this._sock = dgram.createSocket('udp4');
    this._sock.on('message', (buf) => this._onMessage(buf));
    this._sock.on('error', (e) => this.emit('error', e));
    this._sock.bind(0, () => { this._sendRaw(ctrlPkt(T.HELLO, 0)); });   // HELLO direkt
    this._timer = setInterval(() => {
      const now = Date.now();
      if (!this.conn) this._sendRaw(ctrlPkt(T.HELLO, 0));   // retry tills WELCOME (UDP = paket kan tappas)
      else this.conn.tick(now);
    }, TICK_MS);
  }
  _sendRaw(buf) {
    if (this.lossSim > 0 && Math.random() < this.lossSim) return;
    this._sock.send(buf, this.port, this.host);
  }
  _onMessage(buf) {
    if (!buf.length) return;
    if (buf[0] === T.WELCOME) {
      if (this.conn) return;                              // redan ansluten (dubbel-WELCOME)
      const session = buf.readUInt32LE(1);
      this.conn = new Connection(session, (b) => this._sendRaw(b), Date.now());
      this.conn.on('message', (m) => this.emit('message', m));
      this.conn.on('close', (r) => this.emit('close', r));
      this.emit('connect', this.conn);
      return;
    }
    if (this.conn) this.conn._onPacket(buf);
  }
  send(data) { if (this.conn) this.conn.send(data); }
  sendUnreliable(data) { if (this.conn) this.conn.sendUnreliable(data); }
  close() {
    clearInterval(this._timer);
    if (this.conn) this.conn.close('client-shutdown');
    try { this._sock.close(); } catch (e) { /* redan stängd */ }
  }
}

module.exports = { Connection, UdpServer, UdpClient, MAX_PAYLOAD, T };
