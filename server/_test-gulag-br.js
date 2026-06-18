'use strict';
// Integration: riktiga BR-tickens death-detection -> gulag for 6 spelare i sekvens.
// Reproducerar "gulag funkar bara for de 2 forsta".
function makeFakeWs(id){return {id,readyState:1,_isBot:false,playerState:null,tdmTeam:null,tdmRespawnAt:0,_serverRtt:0,_sentMessages:[],send(){}};}
function makeFakeRoom(n){const m=new Map();for(let i=0;i<n;i++)m.set('p'+i,makeFakeWs('p'+i));return {code:'BR',hostId:'p0',members:m,meta:{}};}
const { createSim, startSim, tickSim } = require('./sim/room-sim');

const room=makeFakeRoom(6);
const sim=createSim(room);
startSim(sim,{battleroyale:true, battleroyaleMatchDurationSec:1200});
sim.simReadyAt=0;

let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log('  FAIL: '+m);}}

// Placera alla i zon-center sa de inte tar zon-skada
const z=sim.battleroyaleZone||{x:5000,y:5000};
for(const [,ws] of room.members){ws.playerState.x=z.x;ws.playerState.y=z.y;ws.playerState.hp=100;ws.playerState.selfReviveKits=0;}

function killAndTick(pid){
  room.members.get(pid).playerState.hp=0;
  for(let i=0;i<3;i++) tickSim(sim);   // nagra tickar: death-detection + matchmake
}
function st(pid){return room.members.get(pid).playerState.gulagState;}

// Doda i par och verifiera gulag for VARJE
const order=['p0','p1','p2','p3','p4'];
for(const pid of order){
  killAndTick(pid);
}
// Efter att 5 dott: alla 5 ska ha varit i gulag (queued eller fighting), INGEN direkt eliminerad
let eliminatedFirstDeath=0, gotGulag=0;
for(const pid of order){
  const ps=room.members.get(pid).playerState;
  const inGulagOrWon = ps.gulagState==='queued'||ps.gulagState==='fighting'||ps.gulagUsed===true;
  if(inGulagOrWon) gotGulag++;
  if(sim.battleroyaleEliminated.includes(pid) && ps.gulagUsed!==true) eliminatedFirstDeath++;
}
console.log('  gulag-states:', order.map(p=>p+'='+(st(p)||'none')+'/used='+room.members.get(p).playerState.gulagUsed).join(' '));
console.log('  eliminated:', JSON.stringify(sim.battleroyaleEliminated));
ok(gotGulag===5, `alla 5 doda fick gulag-chans (gulagUsed/queued/fighting), blev ${gotGulag}/5`);
ok(eliminatedFirstDeath===0, `ingen eliminerades pa forsta doden utan gulag, blev ${eliminatedFirstDeath}`);

console.log(`\nGULAG-BR: ${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
