'use strict';
// Självtest för server/net/world-codec.js — bygger en representativ world-snapshot
// (60 fiender: full/delta/boss/miniboss/fx-mix + 40 fiende-kulor), encode→decode,
// verifierar byte-exakt round-trip (efter heltals-kvantisering som JSON ändå gör)
// + mäter BINÄR storlek vs JSON. node tools/world-codec-test.js
const { encodeWorld, decodeWorld } = require('../server/net/world-codec');

function buildPkt() {
  const enemies = [];
  for (let i = 0; i < 60; i++) {
    if (i % 3 === 0) {
      // delta-record (bara i/x/y/hp)
      enemies.push({ i: i, x: ((i * 137) % 8000) - 4000, y: ((i * 91) % 8000) - 4000, hp: 5 + (i % 30) });
    } else {
      // full-record (trimmat — optionella fält bara när satta, som room-sim M5-vägen)
      const e = {
        i: i, x: ((i * 137) % 8000) - 4000, y: ((i * 91) % 8000) - 4000,
        hp: 10 + (i % 50), mh: 60 + (i % 50), t: ['grunt', 'runner', 'brute', 'ninja', 'sniper'][i % 5],
        r: 14 + (i % 10), c: '#' + ((i * 99) & 0xff).toString(16).padStart(2, '0') + 'a23f',
      };
      if (i % 10 === 0) { e.b = 1; e.n = 'GROVE GRIPPER'; e.bk = 'grove'; }
      if (i % 7 === 0) { e.mb = 1; e.mp = 'caster'; }
      if (i % 5 === 0) e.fx = (i & 0x7f);
      if (i % 4 === 0) e.g = 50 + i;
      if (i % 11 === 0) e.p = (i % 4);
      if (i % 13 === 0) e.ht = (i + 1);
      enemies.push(e);
    }
  }
  const hb = [];
  for (let k = 0; k < 40; k++) {
    hb.push({ x: (k * 53) - 1000, y: (k * 71) - 1000, vx: (k % 7) * 40 - 120, vy: (k % 5) * 50 - 100, c: '#ff3a2a', r: 4 + (k % 3) });
  }
  return { seq: 4242, full: 1, enemies, hb };
}

function eq(a, b) { return a === b; }
const fails = [];
function cmpEnemy(s, d) {
  if (!eq(s.i, d.i) || !eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.hp, d.hp)) fails.push('enemy ' + s.i + ' bas-fält');
  const isFull = (s.t !== undefined);
  if (isFull !== (d.t !== undefined)) { fails.push('enemy ' + s.i + ' full/delta-mismatch'); return; }
  if (!isFull) return;
  if (!eq(s.mh, d.mh) || !eq(s.t, d.t) || !eq(s.r, d.r) || !eq(s.c, d.c)) fails.push('enemy ' + s.i + ' mh/t/r/c');
  const n = (o, k, dflt) => (o[k] === undefined ? dflt : o[k]);
  for (const [k, dflt] of [['b', 0], ['mb', 0], ['p', 0], ['fx', 0], ['g', 0], ['n', ''], ['bk', ''], ['mp', ''], ['ht', -1], ['at', '']]) {
    if (!eq(n(s, k, dflt), n(d, k, dflt))) fails.push('enemy ' + s.i + ' fält ' + k + ' (' + n(s, k, dflt) + '!=' + n(d, k, dflt) + ')');
  }
}

const pkt = buildPkt();
const bin = encodeWorld(pkt);
const dec = decodeWorld(bin);

if (dec.seq !== pkt.seq) fails.push('seq');
if (dec.enemies.length !== pkt.enemies.length) fails.push('enemy-antal');
for (let i = 0; i < pkt.enemies.length; i++) cmpEnemy(pkt.enemies[i], dec.enemies[i]);
if (dec.hb.length !== pkt.hb.length) fails.push('hb-antal');
for (let i = 0; i < pkt.hb.length; i++) {
  const s = pkt.hb[i], d = dec.hb[i];
  if (!eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.vx, d.vx) || !eq(s.vy, d.vy) || !eq(s.c, d.c) || !eq(s.r, d.r)) fails.push('hb ' + i);
}

const jsonSize = Buffer.byteLength(JSON.stringify(pkt), 'utf8');
const binSize = bin.length;
console.log(`[CODEC] enemies=${pkt.enemies.length} hb=${pkt.hb.length}`);
console.log(`[CODEC] JSON   : ${jsonSize} bytes`);
console.log(`[CODEC] BINÄRT : ${binSize} bytes  (${(jsonSize / binSize).toFixed(2)}× mindre, −${Math.round((1 - binSize / jsonSize) * 100)}%)`);
if (fails.length) { console.error('[CODEC] ❌ ROUND-TRIP FEL:\n  ' + fails.slice(0, 20).join('\n  ')); process.exit(1); }
console.log('[CODEC] ✅ ROUND-TRIP BYTE-EXAKT (efter heltals-kvantisering) — encode/decode korrekt');
process.exit(0);
