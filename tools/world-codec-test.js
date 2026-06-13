'use strict';
// Självtest för server/net/world-codec.js — bygger en KOMPLETT world-snapshot
// (players + 60 fiender full/delta/boss/mini/fx + 40 kulor + gs + db + pickups + hz),
// encode→decode, verifierar round-trip (efter kvantisering JSON ändå gör) + mäter
// binär storlek vs JSON. node tools/world-codec-test.js
const { encodeWorld, decodeWorld } = require('../server/net/world-codec');

function buildPkt() {
  const players = [];
  for (let i = 0; i < 4; i++) {
    const p = { c: i, x: i * 300 - 600, y: i * 120 - 200, hp: 100 - i * 7, sh: 100 - i * 11,
      a: Math.round((i * 0.77 - 1.5) * 100) / 100, w: ['pistol', 'smg', 'rifle', 'sniper'][i] };
    if (i === 2) p.rT = 3.5;
    players.push(p);
  }
  const enemies = [];
  for (let i = 0; i < 60; i++) {
    if (i % 3 === 0) {
      enemies.push({ i: i, x: ((i * 137) % 8000) - 4000, y: ((i * 91) % 8000) - 4000, hp: 5 + (i % 30) });
    } else {
      const e = { i: i, x: ((i * 137) % 8000) - 4000, y: ((i * 91) % 8000) - 4000,
        hp: 10 + (i % 50), mh: 60 + (i % 50), t: ['grunt', 'runner', 'brute', 'ninja', 'sniper'][i % 5],
        r: 14 + (i % 10), c: '#' + ((i * 99) & 0xff).toString(16).padStart(2, '0') + 'a23f' };
      if (i % 10 === 0) { e.b = 1; e.n = 'GROVE GRIPPER'; e.bk = 'grove'; }
      if (i % 7 === 0) { e.mb = 1; e.mp = 'caster'; }
      if (i % 5 === 0) e.fx = (i & 0x7f);
      if (i % 4 === 0) e.g = 50 + i;
      if (i % 11 === 0) e.p = (i % 4);
      if (i % 13 === 0) e.ht = (i + 1);
      enemies.push(e);
    }
  }
  // custom-typ (ej i ETYPES) → ETYPE_CUSTOM-vägen (sträng-fallback)
  enemies.push({ i: 200, x: 1234, y: -1234, hp: 99, mh: 200, t: 'mystery_xyz', r: 30, c: '#abcdef', b: 1, n: 'WEIRD ONE', at: 'p7_zz99' });
  const hb = [];
  for (let k = 0; k < 40; k++)
    hb.push({ x: (k * 53) - 1000, y: (k * 71) - 1000, vx: (k % 7) * 40 - 120, vy: (k % 5) * 50 - 100, c: '#ff3a2a', r: 4 + (k % 3) });
  const pkt = {
    type: 'world', seq: 4242, ack: 31337, full: 1, st: 1765000000123,
    players, enemies, hb,
    gs: { w: 7, cz: 2, zs: 'fighting', bss: 1, bd: 0 },
    db: { x: 1200, y: -800, reviveTimer: 2.5, revivedBy: 'p3_ab12', color: '#222222' },
    pickups: [{ x: 100, y: 200, t: 'health' }, { x: -300, y: 400, t: 'ammo' }],
    hz: [{ x: 500, y: 500, r: 80, k: 0, lf: 0.5 }, { x: -200, y: 100, r: 60, k: 1, lf: 0.9 }],
  };
  return pkt;
}

const fails = [];
const eq = (a, b) => a === b;
const n = (o, k, d) => (o[k] === undefined ? d : o[k]);

const pkt = buildPkt();
const bin = encodeWorld(pkt);
const dec = decodeWorld(bin);

if (!dec) { console.error('[CODEC] ❌ decode gav null (magic-fel?)'); process.exit(1); }
if (dec.seq !== pkt.seq) fails.push('seq');
if (dec.ack !== pkt.ack) fails.push('ack (' + dec.ack + ')');   // AAA #6
if (dec.full !== pkt.full) fails.push('full');
if (Math.abs(dec.st - pkt.st) > 0.001) fails.push('st (' + dec.st + ')');

// players
if (dec.players.length !== pkt.players.length) fails.push('player-antal');
for (let i = 0; i < pkt.players.length; i++) {
  const s = pkt.players[i], d = dec.players[i];
  if (!eq(s.c, d.c) || !eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.hp, d.hp) || !eq(s.sh, d.sh) || !eq(s.w, d.w)) fails.push('player ' + i + ' fält');
  if (Math.abs(s.a - d.a) > 0.005) fails.push('player ' + i + ' aim (' + s.a + '!=' + d.a + ')');
  if (Math.abs(n(s, 'rT', 0) - n(d, 'rT', 0)) > 0.01) fails.push('player ' + i + ' rT');
}

// enemies
if (dec.enemies.length !== pkt.enemies.length) fails.push('enemy-antal');
for (let i = 0; i < pkt.enemies.length; i++) {
  const s = pkt.enemies[i], d = dec.enemies[i];
  if (!eq(s.i, d.i) || !eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.hp, d.hp)) fails.push('enemy ' + s.i + ' bas');
  const isFull = (s.t !== undefined);
  if (isFull !== (d.t !== undefined)) { fails.push('enemy ' + s.i + ' full/delta'); continue; }
  if (!isFull) continue;
  if (!eq(s.mh, d.mh) || !eq(s.t, d.t) || !eq(s.r, d.r) || !eq(s.c, d.c)) fails.push('enemy ' + s.i + ' mh/t/r/c');
  for (const [k, dflt] of [['b', 0], ['mb', 0], ['p', 0], ['fx', 0], ['g', 0], ['n', ''], ['bk', ''], ['mp', ''], ['ht', -1], ['at', '']])
    if (!eq(n(s, k, dflt), n(d, k, dflt))) fails.push('enemy ' + s.i + ' ' + k);
}

// hb
for (let i = 0; i < pkt.hb.length; i++) {
  const s = pkt.hb[i], d = dec.hb[i];
  if (!eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.vx, d.vx) || !eq(s.vy, d.vy) || !eq(s.c, d.c) || !eq(s.r, d.r)) fails.push('hb ' + i);
}

// gs / db / pickups / hz
for (const k of ['w', 'cz', 'zs', 'bss', 'bd']) if (!eq(pkt.gs[k], dec.gs[k])) fails.push('gs.' + k);
if (!eq(pkt.db.x, dec.db.x) || !eq(pkt.db.y, dec.db.y) || !eq(pkt.db.revivedBy, dec.db.revivedBy) || !eq(pkt.db.color, dec.db.color)) fails.push('db');
if (Math.abs(pkt.db.reviveTimer - dec.db.reviveTimer) > 0.01) fails.push('db.reviveTimer');
if (dec.pickups.length !== pkt.pickups.length) fails.push('pickup-antal');
for (let i = 0; i < pkt.pickups.length; i++) { const s = pkt.pickups[i], d = dec.pickups[i]; if (!eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.t, d.t)) fails.push('pickup ' + i); }
for (let i = 0; i < pkt.hz.length; i++) {
  const s = pkt.hz[i], d = dec.hz[i];
  if (!eq(s.x, d.x) || !eq(s.y, d.y) || !eq(s.r, d.r) || !eq(s.k, d.k)) fails.push('hz ' + i + ' fält');
  if (Math.abs(s.lf - d.lf) > 1 / 255 + 0.001) fails.push('hz ' + i + ' lf (' + s.lf + '!=' + d.lf + ')');
}

const jsonSize = Buffer.byteLength(JSON.stringify(pkt), 'utf8');
console.log(`[CODEC] players=${pkt.players.length} enemies=${pkt.enemies.length} hb=${pkt.hb.length} +gs/db/pickups/hz`);
console.log(`[CODEC] JSON   : ${jsonSize} bytes`);
console.log(`[CODEC] BINÄRT : ${bin.length} bytes  (${(jsonSize / bin.length).toFixed(2)}× mindre, −${Math.round((1 - bin.length / jsonSize) * 100)}%)`);
if (fails.length) { console.error('[CODEC] ❌ ROUND-TRIP FEL:\n  ' + fails.slice(0, 25).join('\n  ')); process.exit(1); }
console.log('[CODEC] ✅ KOMPLETT ROUND-TRIP BYTE-EXAKT — alla world-fält encode/decode korrekt');

// Skriv golden-fixtur för cross-language-test (Godot dekodar denna + jämför)
const fs = require('fs');
const path = require('path');
const outDir = path.join(__dirname, '..', 'data', 'golden');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'world.bin'), bin);
fs.writeFileSync(path.join(outDir, 'world.json'), JSON.stringify(pkt));
console.log('[CODEC] golden-fixtur skriven: data/golden/world.bin + world.json');
process.exit(0);
