'use strict';
// BINÄR world-codec P_EXTRA round-trip: BR air/dz + CD down/revive (cdD/cdBR/cdRP/cdDD).
// Täcker det som JSON-vägs-testerna missar: binär encode↔decode-symmetri + count-klampen
// (regression: min_bytes=3 tystade bort efterföljande EX_CDDD-entries som är 2 byte).
const assert = require('assert');
const { encodeWorld, decodeWorld } = require('./net/world-codec');

function basePlayer(c) { return { c, x: 100 + c, y: 200 + c, hp: 100, sh: 0, a: 0, w: 'pistol', mh: 100, msh: 0 }; }
function rt(pkt) { return decodeWorld(encodeWorld(pkt)); }

// 1. Blandade extras: air-only, freefall(air+dz), chute, CD-downed, ren spelare
{
  const players = [
    Object.assign(basePlayer(0), { air: 1 }),
    Object.assign(basePlayer(1), { air: 2, dz: 0.33 }),
    Object.assign(basePlayer(2), { air: 3, dz: 0.81 }),
    Object.assign(basePlayer(3), { cdD: 1, cdBR: 18000, cdRP: 0.6 }),
    basePlayer(4),
  ];
  const out = rt({ seq: 1, players, enemies: [], hb: [] });
  assert(out.players[0].air === 1, 'p0 air=1');
  assert(out.players[1].air === 2 && Math.abs(out.players[1].dz - 0.33) < 0.011, 'p1 air2 dz~.33');
  assert(out.players[2].air === 3 && Math.abs(out.players[2].dz - 0.81) < 0.011, 'p2 air3 dz~.81');
  assert(out.players[3].cdD === 1 && out.players[3].cdBR === 18000 && Math.abs(out.players[3].cdRP - 0.6) < 0.011, 'p3 cd downed');
  assert(out.players[4].air === undefined && out.players[4].cdD === undefined, 'p4 clean');
  assert(out.players[2].x === 102, 'pos preserved');
  console.log('[OK] binär round-trip: blandade air/dz/cd-extras');
}

// 2. COUNT-KLAMP-regression: 6 spelare med ENBART cdDD (2 byte/entry). Med min_bytes=3
//    klampades antalet ner → efterföljande döda föll bort tyst. Alla 6 ska överleva.
{
  const players = [];
  for (let i = 0; i < 6; i++) players.push(Object.assign(basePlayer(i), { cdDD: 1 }));
  const out = rt({ seq: 2, players, enemies: [], hb: [] });
  let dead = 0;
  for (let i = 0; i < 6; i++) if (out.players[i].cdDD === 1) dead++;
  assert(dead === 6, 'alla 6 cdDD-only-entries överlever (fick ' + dead + ') — count-klamp-regression');
  console.log('[OK] count-klamp: 6 cdDD-only döda bevaras (min_bytes=2)');
}

// 3. Off-map (negativa) coords i luften klarar i16
{
  const players = [Object.assign(basePlayer(0), { air: 2, dz: 0.1, x: -2671, y: 12671 })];
  const out = rt({ seq: 3, players, enemies: [], hb: [] });
  assert(out.players[0].x === -2671 && out.players[0].y === 12671, 'off-map coords i16-säkra');
  console.log('[OK] off-map buss-coords överlever i16');
}

// 4. Inga extras → P_EXTRA-sektionen utelämnas helt (byte-ren)
{
  const players = [basePlayer(0), basePlayer(1)];
  const buf = encodeWorld({ seq: 4, players, enemies: [], hb: [] });
  const out = decodeWorld(buf);
  assert(out.players[0].air === undefined && out.players[1].cdD === undefined, 'inga extras dekodade');
  console.log('[OK] inga extras → ingen P_EXTRA-sektion');
}

console.log('\n═══════════════════════════════════════');
console.log('  WORLD-CODEC P_EXTRA binär round-trip PASSED');
console.log('═══════════════════════════════════════');
