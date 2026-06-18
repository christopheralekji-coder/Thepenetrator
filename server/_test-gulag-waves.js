'use strict';
// Reproducerar "gulag funkar bara för de 2 forsta": kor TVA vagor av gulag.
// Vag 1: A,B -> gulag -> resolve. Vag 2: C,D -> ska ocksa fa en match.
const { enterGulag, gulagMatchmake, tickGulag } = require('./sim/gulag');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } }

function makeSim() {
  return {
    room: { members: new Map() },
    eventQueue: [],
    battleroyaleActive: true,
    battleroyaleAliveCount: 6,
    battleroyaleEliminated: [],
    battleroyaleRanks: {},
    tdmDeathsByPid: {},
    battleroyaleZone: { x: 5000, y: 5000, r: 5000 },
    _brArena: { worldW: 10000, worldH: 10000 },
    brCash: {},
  };
}
function addP(sim, pid) {
  sim.room.members.set(pid, { id: pid, playerState: { x: 100, y: 100, hp: 100, shield: 0, weaponId: 'pistol', gulagUsed: false }, send() {} });
}

const sim = makeSim();
for (const p of ['A', 'B', 'C', 'D', 'E', 'F']) addP(sim, p);
let now = 100000;

// ---- VAG 1: A + B doer ----
enterGulag(sim, 'A', sim.room.members.get('A'));
enterGulag(sim, 'B', sim.room.members.get('B'));
gulagMatchmake(sim, now);
ok(sim.gulagMatches && sim.gulagMatches.length === 1, 'vag1: en match skapades');
const m1 = sim.gulagMatches[0];
ok(m1 && ((m1.a === 'A' && m1.b === 'B') || (m1.a === 'B' && m1.b === 'A')), 'vag1: A vs B');

// B foerlorar (hp 0) -> tickGulag resolvar
now += 1500;
sim.room.members.get(m1.b).playerState.hp = 0;
tickGulag(sim, 0.1, now);
ok(sim.gulagMatches.length === 0, 'vag1: matchen resolvades (gulagMatches tom)');
ok(sim._gulagSlotsUsed.size === 0, 'vag1: slot frigjordes (annars blockeras nasta)');
const winner1 = m1.a === 'B' ? 'A' : (m1.b === 'B' ? 'A' : m1.a);
ok(sim.room.members.get('A').playerState.hp > 0 || sim.room.members.get('A').playerState.gulagState == null, 'vag1: vinnaren redeployade');

// ---- VAG 2: C + D doer (forsta doden, gulagUsed=false) ----
now += 3000;
ok(sim.room.members.get('C').playerState.gulagUsed === false, 'C har inte anvant gulag an');
enterGulag(sim, 'C', sim.room.members.get('C'));
enterGulag(sim, 'D', sim.room.members.get('D'));
gulagMatchmake(sim, now);
ok(sim.gulagMatches.length === 1, 'VAG 2: en NY match skapades (C/D)');
const m2 = sim.gulagMatches[0];
ok(m2 && ((m2.a === 'C' && m2.b === 'D') || (m2.a === 'D' && m2.b === 'C')), 'vag2: C vs D');

// ---- VAG 3: E + F ----
now += 1500;
if (m2) { sim.room.members.get(m2.b).playerState.hp = 0; tickGulag(sim, 0.1, now); }
now += 1000;
enterGulag(sim, 'E', sim.room.members.get('E'));
enterGulag(sim, 'F', sim.room.members.get('F'));
gulagMatchmake(sim, now);
ok(sim.gulagMatches.length === 1, 'VAG 3: en NY match skapades (E/F)');

console.log(`\nGULAG-VAGOR: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
