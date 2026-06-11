// Probe: N6/N7 (V2 CTF-paketet) — FUNKTIONSKOLL av MG-tornet + CTF-regler.
//   1) Host (A) + joiner (B) startar CTF.
//   2) A går till SIN bas-flagga och står på den 1.5s → får ALDRIG plocka egen
//      flagga från basen (inget ctf_flag_picked).
//   3) A går till sitt lags turret, skickar ctf_turret_enter → ctf_turret_entered.
//   4) B (motståndarlaget) går till öppet fält framför tornet.
//   5) A skjuter (sim_shoot — servern forcerar turret_mg + turret-pos) mot B:s
//      live-position → asserta att B:s hp/shield SJUNKER (tornet TRÄFFAR) och
//      att B till slut dör (ctf_player_died/ctf_kill).
//   6) A lämnar tornet (ctf_turret_exit → ctf_turret_exited).
// Kör mot lokal server:
//   $env:PORT=8091; node server\server.js   (i eget fönster)
//   node tools/probe-ctf-turret.js [ws://localhost:8091]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8091';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag,
      items: [],
      waiters: [],
      world: null,          // senaste world-paketet (players: [{c,x,y,hp,sh,a,w}])
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} },
      close: () => { try { ws.close(); } catch (e) {} },
      _push(t, d) {
        const item = { t, d, at: Date.now() };
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i];
          if (w.pred(item)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(item); return; }
        }
        this.items.push(item);
        if (this.items.length > 4000) this.items.splice(0, 2000);
      },
      wait(pred, timeoutMs, consume) {
        if (consume !== false) {
          const idx = this.items.findIndex(pred);
          if (idx >= 0) return Promise.resolve(this.items.splice(idx, 1)[0]);
        }
        return new Promise((res, rej) => {
          const w = { pred, res };
          w.timer = setTimeout(() => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) this.waiters.splice(i, 1);
            rej(new Error('timeout: ' + tag));
          }, timeoutMs || 8000);
          this.waiters.push(w);
        });
      },
      waitEvt(type, timeoutMs) { return this.wait(it => it.t === 'evt' && it.d.type === type, timeoutMs); },
      waitMsg(type, timeoutMs) { return this.wait(it => it.t === 'msg' && it.d.type === type, timeoutMs); },
      sawEvt(type) { return this.items.some(it => it.t === 'evt' && it.d.type === type); },
      clear() { this.items.length = 0; },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === 'sim_events' && Array.isArray(m.events)) {
        for (const e of m.events) c._push('evt', e);
      } else if (m.type === 'sim_event' && m.event) {
        c._push('evt', m.event);
      } else if (m.type === 'world') {
        c.world = m;            // hålls färsk — pollas för positioner/hp
      } else {
        c._push('msg', m);
      }
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Spelarens server-state ur senaste world (via stable-slot c)
function pstate(c, slot) {
  if (!c.world || !Array.isArray(c.world.players)) return null;
  return c.world.players.find(p => p.c === slot) || null;
}

// Gå klient till mål med legal hastighet (servern clampar ~460 px/s + 12px/tick).
// Skickar sim_input var 100:e ms och stegar 40px per steg (=400 px/s).
async function walkTo(c, from, to, hpEcho) {
  let x = from.x, y = from.y;
  const step = 40;
  for (let i = 0; i < 600; i++) {
    const dx = to.x - x, dy = to.y - y;
    const d = Math.hypot(dx, dy);
    if (d <= step) { x = to.x; y = to.y; } else { x += dx / d * step; y += dy / d * step; }
    c.send({ type: 'sim_input', x, y, hp: hpEcho == null ? 100 : hpEcho, aim: 0 });
    if (x === to.x && y === to.y) return { x, y };
    await sleep(100);
  }
  return { x, y };
}

async function main() {
  console.log('PROBE ctf-turret →', URL);
  const A = await mkClient('A');
  A.send({ type: 'host', name: 'TURRA', godot: 1 });
  const h = await A.waitMsg('hosted', 6000);
  A.code = h.d.code; A.peerId = h.d.peerId; A.slot = h.d.stableSlot != null ? h.d.stableSlot : 0;

  const B = await mkClient('B');
  B.send({ type: 'join', code: A.code, name: 'OFFER', godot: 1 });
  const j = await B.waitMsg('joined', 6000);
  B.peerId = j.d.peerId; B.slot = j.d.stableSlot != null ? j.d.stableSlot : 1;

  A.send({ type: 'sim_start', mode: 'ctf', ctf: true, ctfTargetCaptures: 3, countdownMs: 500, baseShield: 100 });
  const st = await A.waitEvt('ctf_started', 8000);
  const ev = st.d;
  ok(Array.isArray(ev.turrets) && ev.turrets.length === 2, 'ctf_started bär 2 turrets', ev.turrets);
  const teams = ev.teams || {};
  const aTeam = teams[A.peerId], bTeam = teams[B.peerId];
  ok(aTeam && bTeam && aTeam !== bTeam, 'A+B på olika lag', teams);
  const myTur = (ev.turrets || []).find(t => t.team === aTeam);
  const myFlag = ev.flags[aTeam];
  console.log('  A=' + aTeam, 'turret=', myTur, 'flag=', myFlag);
  try { await A.waitEvt('countdown_end', 5000); } catch (e) {}

  // A:s spawn ur world (sänd en input för att trigga world åt oss)
  A.send({ type: 'sim_input', hp: 100, aim: 0 });
  await sleep(600);
  let aSt = pstate(A, A.slot);
  ok(!!aSt, 'A syns i world-paketet', A.world && A.world.players);
  const aSpawn = aSt ? { x: aSt.x, y: aSt.y } : (ev.spawns[aTeam][0]);

  // ── REGEL: kan INTE plocka EGEN flagga från basen ─────────────────────────
  A.clear();
  let aPos = await walkTo(A, aSpawn, { x: myFlag.baseX, y: myFlag.baseY });
  await sleep(1500);
  ok(!A.sawEvt('ctf_flag_picked'), 'egen flagga på bas kan EJ plockas (inget ctf_flag_picked)');

  // ── N6a: MOUNTA TURRET ────────────────────────────────────────────────────
  aPos = await walkTo(A, aPos, { x: myTur.x, y: myTur.y });
  await sleep(200);
  A.send({ type: 'ctf_turret_enter', turretId: myTur.id });
  const ent = await A.waitEvt('ctf_turret_entered', 5000);
  ok(ent.d.peerId === A.peerId && ent.d.turretId === myTur.id, 'ctf_turret_entered (A bemannar)', ent.d);

  // ── B går ut på öppet fält framför tornet (samma y-linje, 420px bort) ─────
  const bSpawn = ev.spawns[bTeam][0];
  const tgt = { x: myTur.x + (aTeam === 'red' ? 420 : -420), y: myTur.y };
  // gå i två etapper: först mitt-lane y=1050 (över center-pelaren), sen ner
  await walkTo(B, bSpawn, { x: tgt.x, y: 1050 });
  await walkTo(B, { x: tgt.x, y: 1050 }, tgt);
  await sleep(400);
  let bSt = pstate(A, B.slot);
  ok(!!bSt && Math.hypot(bSt.x - tgt.x, bSt.y - tgt.y) < 60, 'B står framför tornet', bSt);
  const hp0 = bSt ? bSt.hp : 100;
  const sh0 = bSt ? bSt.sh : 100;

  // ── N6a: SKJUT från tornet — träffar den? ────────────────────────────────
  // sim_shoot med "fel" vapen (pistol) — servern ska forcera turret_mg + turret-pos.
  A.clear();
  let died = false;
  for (let i = 0; i < 120 && !died; i++) {
    bSt = pstate(A, B.slot) || bSt;
    const ang = Math.atan2((bSt ? bSt.y : tgt.y) - myTur.y, (bSt ? bSt.x : tgt.x) - myTur.x);
    A.send({ type: 'sim_shoot', weaponId: 'pistol', x: myTur.x, y: myTur.y, ang });
    if (bSt && bSt.hp <= 0) died = true;
    if (A.sawEvt('ctf_player_died') || A.sawEvt('ctf_kill')) died = true;
    await sleep(80);
  }
  bSt = pstate(A, B.slot) || bSt;
  const dmg = (hp0 + sh0) - ((bSt ? bSt.hp : hp0) + (bSt ? bSt.sh : sh0));
  ok(dmg > 0 || died, 'turret-eld TRÄFFAR (B:s hp/shield sjönk: ' + dmg + ')', { hp0, sh0, now: bSt });
  ok(died, 'B DÖR av turret-eld (ctf_player_died/ctf_kill)', null);
  // pvp_shot ska vara källad från TURRET-positionen (inte A:s gamla pos)
  const shot = A.items.find(it => it.t === 'evt' && it.d.type === 'pvp_shot' && it.d.ownerPid === A.peerId);
  const b0 = shot && shot.d.bs && shot.d.bs[0];
  ok(!!b0 && Math.hypot(b0.x - myTur.x, b0.y - myTur.y) < 80, 'pvp_shot källad från turret-pos', b0);

  // ── lämna tornet ──────────────────────────────────────────────────────────
  A.send({ type: 'ctf_turret_exit', turretId: myTur.id });
  const ex = await A.waitEvt('ctf_turret_exited', 5000);
  ok(ex.d.peerId === A.peerId, 'ctf_turret_exited (A lämnar)', ex.d);

  console.log('\nRESULTAT:', pass + ' pass, ' + fail + ' fail');
  A.close(); B.close();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
