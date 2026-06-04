// Logik-test för Omgång 2 hostile-bullet-pool (game.js onData data.hb-blocket).
// Replikerar EXAKT algoritmen och kör flera "snapshots" för att verifiera:
//  - egna (icke-hostile) bullets behålls + ordning (egna först, hostile sist)
//  - hostile ersätts varje snapshot (ingen ackumulering)
//  - pool återanvänds (samma objekt-referenser mellan snapshots)
//  - dead nollställs (ingen läckande wall/hit-död)
//  - krymp/växt av hb hanteras (pool.length justeras)
'use strict';
let fails = 0;
function assert(cond, msg) { if (!cond) { console.error('✗ ' + msg); fails++; } else { console.log('✓ ' + msg); } }

const state = { bullets: [], _hostilePool: null };

// EXAKT kopia av onData-blocket (håll i sync med game.js).
function applyHb(hb) {
  const pool = state._hostilePool || (state._hostilePool = []);
  for (let i = 0; i < hb.length; i++) {
    const s = hb[i];
    let o = pool[i];
    if (!o) o = pool[i] = {};
    o.x = s.x; o.y = s.y; o.vx = s.vx; o.vy = s.vy;
    o.r = s.r; o.color = s.c; o.life = 2;
    o.dmg = 0;
    o.hostile = true; o._fromHost = true; o.dead = false;
  }
  pool.length = hb.length;
  const bl = state.bullets;
  let w = 0;
  for (let r = 0; r < bl.length; r++) { if (!bl[r].hostile) bl[w++] = bl[r]; }
  bl.length = w;
  for (let i = 0; i < pool.length; i++) bl.push(pool[i]);
}

// --- Snapshot 1: 2 egna bullets finns, host skickar 3 hostile ---
state.bullets = [{ x: 1, hostile: false }, { x: 2, hostile: false }];
applyHb([{ x: 10, y: 0, vx: 1, vy: 0, r: 4, c: '#f00' }, { x: 11, y: 0, vx: 1, vy: 0, r: 4, c: '#f00' }, { x: 12, y: 0, vx: 1, vy: 0, r: 4, c: '#f00' }]);
assert(state.bullets.length === 5, 'snap1: 2 egna + 3 hostile = 5');
assert(state.bullets[0].hostile === false && state.bullets[1].hostile === false, 'snap1: egna först');
assert(state.bullets[2].hostile === true && state.bullets[4].hostile === true, 'snap1: hostile sist');
assert(state.bullets[2].dmg === 0, 'snap1: hostile dmg=0');
const poolRef0 = state.bullets[2]; // spara referens till första hostile-pool-objektet

// --- Simulera lokal fysik/kollision: en hostile dör (wall/hit), egna rör sig ---
state.bullets[3].dead = true;
state.bullets[0].x = 99;

// --- Snapshot 2: host skickar 2 hostile (KRYMPER från 3) ---
applyHb([{ x: 20, y: 0, vx: 2, vy: 0, r: 5, c: '#0f0' }, { x: 21, y: 0, vx: 2, vy: 0, r: 5, c: '#0f0' }]);
assert(state.bullets.length === 4, 'snap2: 2 egna + 2 hostile = 4 (gamla 3:e hostile borttagen)');
assert(state.bullets[0].x === 99, 'snap2: egna bullets bevarade (lokal rörelse kvar)');
assert(state.bullets[2].dead === false, 'snap2: dead NOLLSTÄLLD (ingen läckande död)');
assert(state.bullets[2].x === 20 && state.bullets[2].r === 5, 'snap2: hostile uppdaterad till nya värden');
assert(state.bullets[2] === poolRef0, 'snap2: pool ÅTERANVÄNDS (samma objekt-referens)');
assert(state._hostilePool.length === 2, 'snap2: pool krympt till 2');

// --- Snapshot 3: tom hb → alla hostile borta, egna kvar ---
applyHb([]);
assert(state.bullets.length === 2, 'snap3: tom hb → bara 2 egna kvar');
assert(state.bullets.every(b => !b.hostile), 'snap3: inga hostile kvar');

// --- Snapshot 4: växer igen till 4 hostile (pool växer) ---
applyHb([{ x: 1, c: '#00f', r: 3 }, { x: 2, c: '#00f', r: 3 }, { x: 3, c: '#00f', r: 3 }, { x: 4, c: '#00f', r: 3 }]);
assert(state.bullets.length === 6, 'snap4: 2 egna + 4 hostile = 6');
assert(state.bullets.filter(b => b.hostile).length === 4, 'snap4: exakt 4 hostile');

if (fails) { console.error('\n' + fails + ' ASSERT FAIL'); process.exit(1); }
console.log('\nALLA PASS — hostile-bullet-pool korrekt');
