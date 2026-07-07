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
// Anti-abuse hardening (audit 2026-06-18): bounda allt som en peer styr storleken på,
// och guarda varje fält-läsning så ett kort/trasigt paket aldrig kraschar processen.
const MAX_FRAGS = 256;               // max fragment per meddelande (legit-msg är små; world-snapshots << detta)
const RECV_WIN = 4096;               // reliable relSeq accepteras max så här långt före recvExpected (C105)
const MAX_ASM = 64;                  // samtidiga halvfärdiga reliable-montage (C105)
const MAX_DONE = 256;                // färdiga-men-ej-levererade reliable-meddelanden (C105)
const MAX_CONNS = 4096;              // max samtidiga Connections per UdpServer — HELLO-flod-skydd (C242)
const UNVERIFIED_TIMEOUT_MS = 4000;  // overifierad (ej return-routability-bevisad) peer reaps snabbt (C242)
const MAX_RETRANSMIT = 12;           // C125: ge upp på en reliable-frame efter så här många sändningar → reap conn
const MAX_UNACKED = 1024;            // C125: tak på obekräftade reliable-frames → reap conn (send-side starvation-skydd)
// PACING (2026-06-24): ett stort reliable-meddelande (t.ex. br_started ~90KB = ~82
// fragment) blastades tidigare som EN burst → klientens UDP-ringbuffer svämmade över
// ("Buffer full, dropping packets") → tappade fragment → resend-spiral → rel-giveup-
// disconnect (BR plane-drop-buggen). Nu köas fragmenten och dräneras PACE:at: SEND_IMMEDIATE
// går direkt (små event = ingen latens), resten sprids över ticks (TICK_MS=30) à SEND_BUDGET.
const SEND_IMMEDIATE = 8;            // skicka så här många frag direkt i send() (små msg = 0 latens)
const SEND_BUDGET_PER_TICK = 12;     // dränera så här många köade frag per tick (~400 frag/s)

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
// S4: ACK utokad 13->25B med 3 extra bitmap-ord -> selective-ack-fonster 32->128
// frags. Stora reliable-msg (br_started ~82 frags) haller 20-48 i flight; med
// 32-fonstret kunde mottagna frags bortom ackBase+31 inte kvitteras vid en tidig
// lucka -> RTO-omsandning av ~50 redan-mottagna frags (~55KB spuriost) per
// forlust. MIXED-VERSION-SAKERT: parsern ar langd-gated (gamla 13B-ACKs = 0 i
// extra-orden = exakt gamla beteendet), gamla parsers ignorerar svansen.
function ackPkt(session, ackBase, w0, w1, w2, w3) {
  const b = Buffer.allocUnsafe(25);
  b[0] = T.ACK;
  b.writeUInt32LE(session >>> 0, 1);
  b.writeUInt32LE(ackBase >>> 0, 5);
  b.writeUInt32LE(w0 >>> 0, 9);
  b.writeUInt32LE(w1 >>> 0, 13);
  b.writeUInt32LE(w2 >>> 0, 17);
  b.writeUInt32LE(w3 >>> 0, 21);
  return b;
}
function ctrlPkt(type, session) {
  const b = Buffer.allocUnsafe(5);
  b[0] = type; b.writeUInt32LE(session >>> 0, 1);
  return b;
}

// ── Connection: reliability-maskin för EN peer ───────────────────────────────
class Connection extends EventEmitter {
  constructor(session, sendRaw, now, verified) {
    super();
    this.session = session >>> 0;
    this._sendRaw = sendRaw;                // (Buffer) => void  (dgram-send till remote)
    this.closed = false;
    this._verified = !!verified;            // return-routability bevisad? (C242: overifierad = ingen heartbeat + snabb reap)
    // duck-typade ws-fält (sim sätter playerState m.fl. själv)
    this.id = String(session);
    this.readyStateClosed = false;
    // reliable SEND
    this._relSeqNext = 0;
    this._msgIdNext = 0;
    this._unacked = new Map();              // relSeq -> {pkt, sentAt, sends, size}
    this._sendQ = [];                       // PACING: köade relSeq att skicka (paced i tick)
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
  getRtt() { return Math.round(this._srtt); }    // smoothed RTT (ms) — bullets.js lag-comp

  send(data) {                              // RELIABLE (default — events/acct/lobby)
    if (this.closed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const msgId = this._msgIdNext++;
    const fragCount = Math.max(1, Math.ceil(buf.length / MAX_PAYLOAD));
    const now = Date.now();
    for (let i = 0; i < fragCount; i++) {
      // C125: peer som slutar acka → _unacked växer obegränsat. Reap istället för att svälta.
      if (this._unacked.size >= MAX_UNACKED) { this.close('rel-overflow'); return; }
      const slice = buf.subarray(i * MAX_PAYLOAD, (i + 1) * MAX_PAYLOAD);
      const relSeq = this._relSeqNext++;
      const pkt = relPkt(this.session, relSeq, msgId, i, fragCount, slice);
      // PACING: sentAt:0 = köad-ej-sänd (sätts vid faktisk sändning i _drainSendQ så
      // RTO-timern inte startar medan fragmentet ligger i kön).
      this._unacked.set(relSeq, { pkt, sentAt: 0, sends: 0, size: slice.length });
      this._sendQ.push(relSeq);
    }
    // Små meddelanden (≤ SEND_IMMEDIATE frag) går direkt → ingen latens. Stora (br_started)
    // skickar SEND_IMMEDIATE nu + resten paced i tick → ingen burst-överrsvämning.
    this._drainSendQ(now, SEND_IMMEDIATE);
  }

  // PACING: skicka upp till `budget` köade fragment; sätt sentAt vid faktisk sändning.
  _drainSendQ(now, budget) {
    let n = 0;
    while (this._sendQ.length > 0 && n < budget) {
      const relSeq = this._sendQ.shift();
      const e = this._unacked.get(relSeq);
      if (!e) continue;                     // redan ackad innan den hann sändas
      e.sentAt = now; e.sends++;
      this._sendRaw(e.pkt);
      n++;
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
    this._verified = true;                  // varje mottaget paket bevisar return-routability (C242)
    try {
      switch (buf[0]) {
        case T.REL:   this._onRel(buf);  break;
        case T.ACK:   this._onAck(buf);  break;
        case T.UNREL: this._onUnrel(buf); break;
        case T.PING:  this._sendRaw(ctrlPkt(T.PONG, this.session)); break;
        case T.PONG:  break;                // lastRecvAt redan uppdaterat
        case T.BYE:   this.close('remote-bye'); break;
      }
    } catch (e) { /* trasigt/kort paket — släng, krascha ALDRIG processen (audit C241) */ }
  }

  _onRel(buf) {
    if (buf.length < REL_HDR) return;                                            // C241: längd-guard
    const relSeq = buf.readUInt32LE(5);
    const msgId = buf.readUInt32LE(9);
    const fragIdx = buf.readUInt16LE(13);
    const fragCount = buf.readUInt16LE(15);
    if (fragCount < 1 || fragCount > MAX_FRAGS || fragIdx >= fragCount) return;   // C105: sanity på frag-fält
    // duplikat / redan passerat / absurt långt fram → bara acka, väx inga buffrar
    if (relSeq < this._recvExpected || this._recvWin.has(relSeq)) { this._sendAck(); return; }
    if (relSeq - this._recvExpected > RECV_WIN) { this._sendAck(); return; }      // C105: utanför mottagar-fönstret
    const payload = buf.subarray(REL_HDR);
    this._recvWin.add(relSeq);
    // montera meddelandet (per msgId); vid tak: hoppa montaget men ACKa + avancera recvExpected ändå
    // (annars kan _recvWin växa när _asm är mättad — single-exit nedan håller den boundad).
    let a = this._asm.get(msgId);
    if (!a && this._asm.size < MAX_ASM) {                                         // C105: tak på samtidiga montage
      a = { fragCount, parts: new Array(fragCount), got: 0 }; this._asm.set(msgId, a);
    }
    if (a && a.fragCount === fragCount && fragIdx < a.parts.length && !a.parts[fragIdx]) { a.parts[fragIdx] = payload; a.got++; }
    if (a && a.got === a.fragCount) {
      if (this._done.size < MAX_DONE) this._done.set(msgId, a.fragCount === 1 ? a.parts[0] : Buffer.concat(a.parts));  // C105: tak
      this._asm.delete(msgId);
      this._deliverReady();
    }
    // flytta fram recvExpected över kontinuerligt mottagna relSeq
    while (this._recvWin.has(this._recvExpected)) {
      this._recvWin.delete(this._recvExpected);
      this._recvExpected = (this._recvExpected + 1) >>> 0;
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
    const w = [0, 0, 0, 0];
    for (let i = 1; i < 128; i++) {
      if (this._recvWin.has((this._recvExpected + i) >>> 0)) w[i >> 5] |= (1 << (i & 31));
    }
    this._sendRaw(ackPkt(this.session, this._recvExpected, w[0], w[1], w[2], w[3]));
  }

  _onAck(buf) {
    if (buf.length < 13) return;                                                 // C241: längd-guard
    const ackBase = buf.readUInt32LE(5);
    // S4: langd-gated parse av upp till 4 bitmap-ord (gamla peers skickar 13B = 1 ord)
    const w0 = buf.readUInt32LE(9);
    const w1 = buf.length >= 17 ? buf.readUInt32LE(13) : 0;
    const w2 = buf.length >= 21 ? buf.readUInt32LE(17) : 0;
    const w3 = buf.length >= 25 ? buf.readUInt32LE(21) : 0;
    const words = [w0, w1, w2, w3];
    const now = Date.now();
    for (const [relSeq, e] of this._unacked) {
      let acked = false;
      // ackBase = remote-sidans recvExpected → allt < ackBase är garanterat mottaget
      if (((relSeq - ackBase) >>> 0) >= 0x80000000 || relSeq < ackBase) acked = true;
      else {
        const off = (relSeq - ackBase) >>> 0;
        if (off < 128 && (words[off >> 5] & (1 << (off & 31)))) acked = true;
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
    if (buf.length < UNREL_HDR) return;                                          // C241: längd-guard
    const pktSeq = buf.readUInt32LE(5);
    const fragIdx = buf.readUInt16LE(9);
    const fragCount = buf.readUInt16LE(11);
    if (fragCount < 1 || fragCount > MAX_FRAGS || fragIdx >= fragCount) return;   // C105/C241: sanity på frag-fält
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
    if (a.fragCount === fragCount && !a.parts[fragIdx]) { a.parts[fragIdx] = payload; a.got++; }
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
    const timeoutMs = this._verified ? TIMEOUT_MS : UNVERIFIED_TIMEOUT_MS;   // C242: reap spoofad/overifierad peer snabbt
    if (now - this._lastRecvAt >= timeoutMs) { this.close('timeout'); return; }
    for (const [relSeq, e] of this._unacked) {          // resend obekräftade frags (PACED)
      if (e.sentAt > 0 && now - e.sentAt >= this._rto) {
        // C125: liveness knyts till ACK-framsteg, ej bara _lastRecvAt. En peer som håller
        // conn vid liv (inputs/pings) men vars ACKs ständigt tappas → frame når retransmit-taket → reap.
        if (e.sends >= MAX_RETRANSMIT) {
          try { const p = e.pkt; console.log('[REL-GIVEUP] msgId=' + p.readUInt32LE(9) + ' fragIdx=' + p.readUInt16LE(13) + '/' + p.readUInt16LE(15) + ' unacked=' + this._unacked.size + ' size=' + e.size); } catch (_) {}
          this.close('rel-giveup'); return;
        }
        // re-köa i st.f. att blasta ALLA på en gång (annars samma burst-spiral som orsakade
        // klientens "Buffer full"). sentAt:0 → drain sätter sentAt + sends vid faktisk sändning.
        e.sentAt = 0;
        this._sendQ.push(relSeq);
      }
    }
    this._drainSendQ(now, SEND_BUDGET_PER_TICK);
    // C242: skicka ALDRIG heartbeat till en overifierad peer → ingen reflektions-amplifiering mot spoofad IP.
    if (this._verified && now - this._lastHbAt >= HEARTBEAT_MS) {
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
  constructor({ port, onConnection, lossSim = 0, bindAddr = '0.0.0.0' }) {
    super();
    this.port = port;
    this.lossSim = lossSim;
    this._conns = new Map();                // 'addr:port' -> Connection
    this._sock = dgram.createSocket('udp4');
    this._nextSession = 1;
    this._sock.on('message', (buf, rinfo) => this._onMessage(buf, rinfo));
    this._sock.on('error', (e) => this.emit('error', e));
    // Fly.io UDP KRÄVER bind till 'fly-global-services' (ej 0.0.0.0 — Linux skickar
    // annars fel käll-adress i svaret). Lokalt = 0.0.0.0. Sätts via UDP_BIND-env.
    this._sock.bind(port, bindAddr, () => this.emit('listening', port));
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
        if (this._conns.size >= MAX_CONNS) return;        // C242: vägra nya conns när tabellen är full (släng tyst, ingen WELCOME)
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
  peers() { return [...this._conns.values()]; }   // aktiva Connections (för app-loopar t.ex. RTT)
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
      if (buf.length < 5) return;                         // C241: längd-guard
      if (this.conn) return;                              // redan ansluten (dubbel-WELCOME)
      const session = buf.readUInt32LE(1);
      // klienten initierade → return-routability implicit (vi fick WELCOME) → verifierad direkt
      this.conn = new Connection(session, (b) => this._sendRaw(b), Date.now(), true);
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
