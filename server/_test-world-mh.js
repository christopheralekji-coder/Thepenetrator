'use strict';
const assert = require('assert');
function makeFakeWs(id){return {id,readyState:1,_isBot:false,_jsonWorld:true,stableSlot:null,playerState:null,tdmTeam:null,tdmRespawnAt:0,_serverRtt:0,_sentMessages:[],send(d){this._sentMessages.push(typeof d==='string'?JSON.parse(d):d);}};}
function makeFakeRoom(n){const members=new Map();for(let i=0;i<n;i++){const w=makeFakeWs('p'+i);w.stableSlot=i;members.set('p'+i,w);}return {code:'TEST',hostId:'p0',members,meta:{}};}
const {createSim,startSim,tickSim,applyPlayerInput}=require('./sim/room-sim');
const room=makeFakeRoom(2);const sim=createSim(room);startSim(sim,{gungame:true});
const ws=room.members.get('p0');
applyPlayerInput(sim,'p0',{x:ws.playerState.x,y:ws.playerState.y,hp:150,maxHp:300,maxShield:100,aim:0});
sim.simReadyAt=0;
ws._sentMessages.length=0;
tickSim(sim);
const world=ws._sentMessages.filter(m=>m.type==='world').pop();
assert(world,'fick world-paket');
const me=world.players.find(p=>p.c===0);
assert(me,'hittade min spelare i world');
console.log('player packet:',JSON.stringify(me));
assert(me.mh===300,'mh ska vara 300 (cliMaxHp), blev '+me.mh);
assert(me.msh===100,'msh ska vara 100, blev '+me.msh);
assert(me.hp===150,'hp 150');
console.log('[OK] world-paketet bar mh=300, msh=100 -> NetPlayer visar 150/300 = halv bar (ratt)');
process.exit(0);
