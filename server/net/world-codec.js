'use strict';
// ============================================================================
// WORLD-CODEC (AAA #1, 2026-06-13) — binär + kvantiserad world-serialisering
// som ersätter JSON-text över UDP. Mål: bort med JSON.parse 30Hz på telefonen
// (CPU=VÄRME, V2:s kärnsyfte) + ~5-10× bandbredd. Byggs ISOLERAT + bevisas
// (round-trip + storleks-mätning) INNAN den wire:as in i hot-path:en.
//
// Kvantisering: positioner i16 (alla arenor ≤ ±32767 — BR 10000² ryms), hp/mh
// u16, radie u8, färg 3×u8 RGB. Typ/bossKey/power via enum (sträng→byte).
// Delta-records (utan t) bär bara i/x/y/hp. Full-records bär allt + fält-flaggor.
//
// Fält täckta i denna fas: enemies (full+delta) + hb (fiende-kulor). Players/gs/
// pickups/db/hz läggs till när codecen wire:as in (de är få → liten JSON-kostnad).
// Wire-format LE, matchar resten av UDP-lagret.
// ============================================================================

// Enemy-typ-enum (ordning MÅSTE matcha klientens dekoder när den byggs).
const ETYPES = ['grunt', 'runner', 'brute', 'tank', 'ninja', 'soldier', 'shooter',
  'dog', 'robot', 'sniper', 'bomber', 'healer', 'summoner', 'swarmer', 'swordsman', 'fast'];
const ETYPE_IDX = {}; ETYPES.forEach((t, i) => { ETYPE_IDX[t] = i; });
const ETYPE_CUSTOM = 0xFF;

// fält-flaggor (full enemy record)
const F_BOSS = 1, F_MINI = 2, F_NAME = 4, F_BK = 8, F_P = 16, F_MP = 32, F_FX = 64, F_G = 128;

function clampI16(v) { v = Math.round(v); return v < -32768 ? -32768 : (v > 32767 ? 32767 : v); }
function clampU16(v) { v = Math.round(v); return v < 0 ? 0 : (v > 65535 ? 65535 : v); }
function hexToRgb(c) {
  if (typeof c === 'string' && c[0] === '#' && c.length >= 7) {
    return [parseInt(c.slice(1, 3), 16) || 0, parseInt(c.slice(3, 5), 16) || 0, parseInt(c.slice(5, 7), 16) || 0];
  }
  return [146, 82, 71]; // fallback (samma som klientens generiska)
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── liten byte-writer (preallok + slice) ──
class W {
  constructor(cap = 65536) { this.b = Buffer.allocUnsafe(cap); this.o = 0; }
  u8(v) { this.b.writeUInt8(v & 0xFF, this.o); this.o += 1; }
  u16(v) { this.b.writeUInt16LE(clampU16(v), this.o); this.o += 2; }
  i16(v) { this.b.writeInt16LE(clampI16(v), this.o); this.o += 2; }
  str(s) { const buf = Buffer.from(String(s), 'utf8').subarray(0, 255); this.u8(buf.length); buf.copy(this.b, this.o); this.o += buf.length; }
  done() { return this.b.subarray(0, this.o); }
}
class R {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  str() { const n = this.u8(); const s = this.b.toString('utf8', this.o, this.o + n); this.o += n; return s; }
}

function encodeWorld(pkt) {
  const w = new W();
  w.u16(pkt.seq || 0);
  w.u8(pkt.full ? 1 : 0);
  const enemies = pkt.enemies || [];
  w.u16(enemies.length);
  for (const e of enemies) {
    const isFull = (e.t !== undefined);
    w.u8(isFull ? 1 : 0);
    w.u16(e.i);
    w.i16(e.x); w.i16(e.y); w.u16(e.hp);
    if (!isFull) continue;
    w.u16(e.mh || 0);
    const ti = ETYPE_IDX[e.t];
    if (ti === undefined) { w.u8(ETYPE_CUSTOM); w.str(e.t); } else { w.u8(ti); }
    w.u8(Math.min(255, Math.round(e.r || 0)));
    const [cr, cg, cb] = hexToRgb(e.c);
    w.u8(cr); w.u8(cg); w.u8(cb);
    let ff = 0;
    if (e.b) ff |= F_BOSS;
    if (e.mb) ff |= F_MINI;
    if (e.n) ff |= F_NAME;
    if (e.bk) ff |= F_BK;
    if (e.p) ff |= F_P;
    if (e.mp) ff |= F_MP;
    if (e.fx) ff |= F_FX;
    if (e.g) ff |= F_G;
    w.u8(ff);
    if (ff & F_NAME) w.str(e.n);
    if (ff & F_BK) w.str(e.bk);
    if (ff & F_P) w.u8(Math.min(255, e.p));
    if (ff & F_MP) w.str(e.mp);
    if (ff & F_FX) w.u16(e.fx);
    if (ff & F_G) w.u16(e.g);
    // ht/at (heal/aim-target) — sällsynta, egna flaggor via fx-bitar redan; skicka om satta
    w.u8((e.ht !== undefined ? 1 : 0) | (e.at !== undefined ? 2 : 0));
    if (e.ht !== undefined) w.u16(e.ht);
    if (e.at !== undefined) w.str(e.at);
  }
  const hb = pkt.hb || [];
  w.u16(hb.length);
  for (const b of hb) {
    w.i16(b.x); w.i16(b.y); w.i16(b.vx); w.i16(b.vy);
    const [r, g, bl] = hexToRgb(b.c); w.u8(r); w.u8(g); w.u8(bl);
    w.u8(Math.min(255, Math.round(b.r || 0)));
  }
  return w.done();
}

function decodeWorld(buf) {
  const r = new R(buf);
  const pkt = { seq: r.u16(), full: r.u8(), enemies: [], hb: [] };
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
    b.c = rgbToHex(r.u8(), r.u8(), r.u8());
    b.r = r.u8();
    pkt.hb.push(b);
  }
  return pkt;
}

module.exports = { encodeWorld, decodeWorld, ETYPES };
