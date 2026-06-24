'use strict';
// ============================================================================
// WORLD-CODEC (AAA #1, 2026-06-13) — binär + kvantiserad world-serialisering
// som ersätter JSON-text över UDP. Mål: bort med JSON.parse 30Hz på telefonen
// (CPU=VÄRME, V2:s kärnsyfte) + ~5× bandbredd. Byggs ISOLERAT + bevisas
// (round-trip + cross-language golden-test mot GDScript) INNAN in-wire:ning.
//
// MAGIC byte 0xB1 först → klientens drain skiljer binär-world (0xB1) från
// JSON-text-events (`{` = 0x7B) på samma UDP-kö. Wire-format LE.
//
// Kvantisering: pos i16 (alla arenor ≤ ±32767), hp/mh/sh u16, radie u8, färg
// 3×u8 RGB, aim i16(×100), st f64 (Date.now), rT/reviveTimer f32, hz.lf u8(×255).
// Typ via enum (sträng→byte, MÅSTE matcha klientens ETYPES). bossKey/power/name/
// weaponId/pickup-typ/zoneState = längd-prefixad sträng (säkert, låg volym).
// ============================================================================

const MAGIC = 0xB2;   // C104: bumpad 0xB1->0xB2 — player mh/msh tillagt i formatet (mixed-version-skydd mot tyst misframe)
// Enemy-typ-enum — ordning MÅSTE matcha WorldCodec.gd:ETYPES på klienten.
const ETYPES = ['grunt', 'runner', 'brute', 'tank', 'ninja', 'soldier', 'shooter',
  'dog', 'robot', 'sniper', 'bomber', 'healer', 'summoner', 'swarmer', 'swordsman', 'fast'];
const ETYPE_IDX = {}; ETYPES.forEach((t, i) => { ETYPE_IDX[t] = i; });
const ETYPE_CUSTOM = 0xFF;

const F_BOSS = 1, F_MINI = 2, F_NAME = 4, F_BK = 8, F_P = 16, F_MP = 32, F_FX = 64, F_G = 128;
const P_GS = 1, P_DB = 2, P_PICKUPS = 4, P_HZ = 8;   // top-level presence-bitar
// P_EXTRA (2026-06-24): per-spelar-extras (BR air/dz + CD down/revive) som en
// APPEND-AT-END-sektion → MIXED-VERSION-SÄKER. En gammal klient läser inte denna
// presence-bit och slutar läsa efter hz → ignorerar de extra byten (ingen misframe,
// ingen MAGIC-bump). Indexerad mot players[]-ordningen (samma loop-ordning båda sidor).
const P_EXTRA = 16;
const EX_AIR = 1, EX_DZ = 2, EX_CDD = 4, EX_CDDD = 8;   // per-spelare-extras subflaggor

function clampI16(v) { v = Math.round(v); return v < -32768 ? -32768 : (v > 32767 ? 32767 : v); }
function clampU16(v) { v = Math.round(v); return v < 0 ? 0 : (v > 65535 ? 65535 : v); }
function hexToRgb(c) {
  if (typeof c === 'string' && c[0] === '#' && c.length >= 7)
    return [parseInt(c.slice(1, 3), 16) || 0, parseInt(c.slice(3, 5), 16) || 0, parseInt(c.slice(5, 7), 16) || 0];
  return [146, 82, 71];
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''); }

class W {
  constructor(cap = 65536) { this.b = Buffer.allocUnsafe(cap); this.o = 0; }
  u8(v) { this.b.writeUInt8(v & 0xFF, this.o); this.o += 1; }
  u16(v) { this.b.writeUInt16LE(clampU16(v), this.o); this.o += 2; }
  i16(v) { this.b.writeInt16LE(clampI16(v), this.o); this.o += 2; }
  f32(v) { this.b.writeFloatLE(v || 0, this.o); this.o += 4; }
  f64(v) { this.b.writeDoubleLE(v || 0, this.o); this.o += 8; }
  str(s) { const buf = Buffer.from(s == null ? '' : String(s), 'utf8').subarray(0, 255); this.u8(buf.length); buf.copy(this.b, this.o); this.o += buf.length; }
  done() { return Buffer.from(this.b.subarray(0, this.o)); }
}
class R {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.o); this.o += 8; return v; }
  str() { const n = this.u8(); const s = this.b.toString('utf8', this.o, this.o + n); this.o += n; return s; }
}

function encodeWorld(pkt) {
  const w = new W();
  w.u8(MAGIC);
  w.u16(pkt.seq || 0);
  w.u16(pkt.ack || 0);   // AAA #6: senast behandlade input-seq för peeren (reconcile)
  w.u8(pkt.full ? 1 : 0);
  w.f64(pkt.st || 0);
  let presence = 0;
  if (pkt.gs) presence |= P_GS;
  if (pkt.db) presence |= P_DB;
  if (pkt.pickups) presence |= P_PICKUPS;
  if (pkt.hz) presence |= P_HZ;
  // P_EXTRA: sätt om NÅGON spelare har BR-luft- eller CD-down-state (annars 0 byte).
  const _pls0 = pkt.players || [];
  let _hasExtra = false;
  for (let _i = 0; _i < _pls0.length; _i++) {
    const _p = _pls0[_i];
    if (_p && (_p.air || _p.dz !== undefined || _p.cdD || _p.cdDD)) { _hasExtra = true; break; }
  }
  if (_hasExtra) presence |= P_EXTRA;
  w.u8(presence);

  // players
  const players = pkt.players || [];
  w.u8(Math.min(255, players.length));
  for (const p of players) {
    w.u16(p.c); w.i16(p.x); w.i16(p.y); w.u16(p.hp); w.u16(p.sh || 0);
    w.i16(Math.round((p.a || 0) * 100)); w.str(p.w);
    w.u16(p.mh || 100); w.u16(p.msh || 0);   // C104: maxHp/maxShield -> korrekt hp/shield-bar for remotes (Jug 400, BR/Survivors-uppgraderingar)
    if (p.rT !== undefined) { w.u8(1); w.f32(p.rT); } else { w.u8(0); }
  }

  // enemies (full har t; delta = bara i/x/y/hp)
  const enemies = pkt.enemies || [];
  w.u16(enemies.length);
  for (const e of enemies) {
    const isFull = (e.t !== undefined);
    w.u8(isFull ? 1 : 0);
    w.u16(e.i); w.i16(e.x); w.i16(e.y); w.u16(e.hp);
    if (!isFull) continue;
    w.u16(e.mh || 0);
    const ti = ETYPE_IDX[e.t];
    if (ti === undefined) { w.u8(ETYPE_CUSTOM); w.str(e.t); } else { w.u8(ti); }
    w.u8(Math.min(255, Math.round(e.r || 0)));
    const [cr, cg, cb] = hexToRgb(e.c); w.u8(cr); w.u8(cg); w.u8(cb);
    let ff = 0;
    if (e.b) ff |= F_BOSS; if (e.mb) ff |= F_MINI; if (e.n) ff |= F_NAME;
    if (e.bk) ff |= F_BK; if (e.p) ff |= F_P; if (e.mp) ff |= F_MP;
    if (e.fx) ff |= F_FX; if (e.g) ff |= F_G;
    w.u8(ff);
    if (ff & F_NAME) w.str(e.n);
    if (ff & F_BK) w.str(e.bk);
    if (ff & F_P) w.u8(Math.min(255, e.p));
    if (ff & F_MP) w.str(e.mp);
    if (ff & F_FX) w.u16(e.fx);
    if (ff & F_G) w.u16(e.g);
    w.u8((e.ht !== undefined ? 1 : 0) | (e.at !== undefined ? 2 : 0));
    if (e.ht !== undefined) w.u16(e.ht);
    if (e.at !== undefined) w.str(e.at);
  }

  // hb (fiende-kulor)
  const hb = pkt.hb || [];
  w.u16(hb.length);
  for (const b of hb) {
    w.i16(b.x); w.i16(b.y); w.i16(b.vx); w.i16(b.vy);
    const [r, g, bl] = hexToRgb(b.c); w.u8(r); w.u8(g); w.u8(bl);
    w.u8(Math.min(255, Math.round(b.r || 0)));
  }

  // gs (gamestate)
  if (presence & P_GS) {
    const gs = pkt.gs;
    w.u16(gs.w || 0); w.i16(gs.cz || 0); w.str(gs.zs);
    w.u8(Math.min(255, gs.bss || 0)); w.u8(gs.bd ? 1 : 0);
  }
  // db (dead body)
  if (presence & P_DB) {
    const db = pkt.db;
    w.i16(db.x); w.i16(db.y); w.f32(db.reviveTimer || 0);
    w.str(db.revivedBy == null ? '' : db.revivedBy); w.str(db.color);
  }
  // pickups
  if (presence & P_PICKUPS) {
    w.u16(pkt.pickups.length);
    for (const pu of pkt.pickups) { w.i16(pu.x); w.i16(pu.y); w.str(pu.t); }
  }
  // hz (hazards)
  if (presence & P_HZ) {
    w.u16(pkt.hz.length);
    for (const h of pkt.hz) {
      w.i16(h.x); w.i16(h.y); w.u16(h.r); w.u8(h.k || 0);
      w.u8(Math.max(0, Math.min(255, Math.round((h.lf || 0) * 255))));
    }
  }
  // P_EXTRA — APPEND-AT-END: per-spelar-extras (BR air/dz + CD down/revive). Indexerad
  // mot players[]-ordningen ovan. Gammal klient ignorerar (läser ej P_EXTRA → stannar
  // efter hz). Bara spelare med någon flagga skrivs → tom i normal-spel.
  if (presence & P_EXTRA) {
    const idxs = [];
    for (let i = 0; i < _pls0.length; i++) {
      const p = _pls0[i];
      if (p && (p.air || p.dz !== undefined || p.cdD || p.cdDD)) idxs.push(i);
    }
    w.u8(Math.min(255, idxs.length));
    for (const i of idxs) {
      const p = _pls0[i];
      w.u8(i);
      let sf = 0;
      if (p.air) sf |= EX_AIR;
      if (p.dz !== undefined) sf |= EX_DZ;
      if (p.cdD) sf |= EX_CDD;
      if (p.cdDD) sf |= EX_CDDD;
      w.u8(sf);
      if (sf & EX_AIR) w.u8(Math.max(0, Math.min(255, p.air)));
      if (sf & EX_DZ) w.u8(Math.max(0, Math.min(255, Math.round((p.dz || 0) * 100))));
      if (sf & EX_CDD) { w.u16(p.cdBR || 0); w.u8(Math.max(0, Math.min(255, Math.round((p.cdRP || 0) * 100)))); }
    }
  }
  return w.done();
}

function decodeWorld(buf) {
  const r = new R(buf);
  if (r.u8() !== MAGIC) return null;   // ej binär-world
  const pkt = { type: 'world', seq: r.u16(), ack: r.u16(), full: r.u8(), st: r.f64(), players: [], enemies: [], hb: [] };
  const presence = r.u8();

  const pn = r.u8();
  for (let k = 0; k < pn; k++) {
    const p = { c: r.u16(), x: r.i16(), y: r.i16(), hp: r.u16(), sh: r.u16(), a: r.i16() / 100, w: r.str(), mh: r.u16(), msh: r.u16() };
    if (r.u8()) p.rT = r.f32();
    pkt.players.push(p);
  }

  const en = r.u16();
  for (let k = 0; k < en; k++) {
    const isFull = r.u8();
    const e = { i: r.u16(), x: r.i16(), y: r.i16(), hp: r.u16() };
    if (isFull) {
      e.mh = r.u16();
      const ti = r.u8();
      e.t = (ti === ETYPE_CUSTOM) ? r.str() : ETYPES[ti];
      e.r = r.u8();
      e.c = rgbToHex(r.u8(), r.u8(), r.u8());
      const ff = r.u8();
      e.b = (ff & F_BOSS) ? 1 : 0;
      e.mb = (ff & F_MINI) ? 1 : 0;
      if (ff & F_NAME) e.n = r.str();
      if (ff & F_BK) e.bk = r.str();
      if (ff & F_P) e.p = r.u8();
      if (ff & F_MP) e.mp = r.str();
      if (ff & F_FX) e.fx = r.u16();
      if (ff & F_G) e.g = r.u16();
      const tflags = r.u8();
      if (tflags & 1) e.ht = r.u16();
      if (tflags & 2) e.at = r.str();
    }
    pkt.enemies.push(e);
  }

  const hbn = r.u16();
  for (let k = 0; k < hbn; k++) {
    const b = { x: r.i16(), y: r.i16(), vx: r.i16(), vy: r.i16() };
    b.c = rgbToHex(r.u8(), r.u8(), r.u8()); b.r = r.u8();
    pkt.hb.push(b);
  }

  if (presence & P_GS) pkt.gs = { w: r.u16(), cz: r.i16(), zs: r.str(), bss: r.u8(), bd: r.u8() };
  if (presence & P_DB) {
    const db = { x: r.i16(), y: r.i16(), reviveTimer: r.f32() };
    const rb = r.str(); db.revivedBy = rb === '' ? null : rb; db.color = r.str();
    pkt.db = db;
  }
  if (presence & P_PICKUPS) {
    const n = r.u16(); pkt.pickups = [];
    for (let k = 0; k < n; k++) pkt.pickups.push({ x: r.i16(), y: r.i16(), t: r.str() });
  }
  if (presence & P_HZ) {
    const n = r.u16(); pkt.hz = [];
    for (let k = 0; k < n; k++) pkt.hz.push({ x: r.i16(), y: r.i16(), r: r.u16(), k: r.u8(), lf: r.u8() / 255 });
  }
  if (presence & P_EXTRA) {
    const n = r.u8();
    for (let k = 0; k < n; k++) {
      const idx = r.u8();
      const sf = r.u8();
      const p = pkt.players[idx];
      if (sf & EX_AIR) { const a = r.u8(); if (p) p.air = a; }
      if (sf & EX_DZ) { const dz = r.u8() / 100; if (p) p.dz = dz; }
      if (sf & EX_CDD) { const br = r.u16(); const rp = r.u8() / 100; if (p) { p.cdD = 1; p.cdBR = br; p.cdRP = rp; } }
      if (sf & EX_CDDD) { if (p) p.cdDD = 1; }
    }
  }
  return pkt;
}

module.exports = { encodeWorld, decodeWorld, ETYPES, MAGIC };
