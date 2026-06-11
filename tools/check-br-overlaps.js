// S8-verifiering: kollar att inga cabins (hus/containrar/shops) överlappar varandra,
// och att flyttade shop-cabins inte krockar med fristående väggar/decor.
const { BATTLEROYALE_ARENA } = require('../shared/battleroyale-arena.js');

const a = BATTLEROYALE_ARENA;
const rectOverlap = (r1, r2) =>
  r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;

let fail = 0;

// 1) cabin vs cabin
for (let i = 0; i < a.cabins.length; i++) {
  for (let j = i + 1; j < a.cabins.length; j++) {
    const b1 = a.cabins[i].bounds, b2 = a.cabins[j].bounds;
    if (rectOverlap(b1, b2)) {
      fail++;
      console.log(`OVERLAP cabin: ${a.cabins[i].id} (${b1.x},${b1.y},${b1.w}x${b1.h}) <-> ${a.cabins[j].id} (${b2.x},${b2.y},${b2.w}x${b2.h})`);
    }
  }
}

// 2) shop-cabins vs fristående väggar (väggar som inte ligger inom någon cabins bbox,
//    dvs inte cabin-genererade) — fångar att en flytt inte landar i en sten/träd-vägg.
const inCabin = (w) => a.cabins.some(c => {
  const b = c.bounds;
  return w.x >= b.x - 14 && w.x + w.w <= b.x + b.w + 14 &&
         w.y >= b.y - 14 && w.y + w.h <= b.y + b.h + 14;
});
const freeWalls = a.walls.filter(w => !inCabin(w));
for (const c of a.cabins.filter(c => c.shop)) {
  for (const w of freeWalls) {
    if (rectOverlap(c.bounds, w)) {
      fail++;
      console.log(`OVERLAP wall: ${c.id} (${c.bounds.x},${c.bounds.y}) <-> ${w.kind || '?'} (${w.x},${w.y},${w.w}x${w.h})`);
    }
  }
}

console.log(fail === 0 ? `OK: 0 overlaps (${a.cabins.length} cabins, ${freeWalls.length} fria väggar testade)` : `FAIL: ${fail} overlaps`);
process.exit(fail === 0 ? 0 : 1);
