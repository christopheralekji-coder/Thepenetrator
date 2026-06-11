// Probe: BR hus/containrar — kulor stoppas av VÄGGAR men passerar FÖNSTER och
// DÖRRÖPPNINGAR (åt båda hållen), och spelare kan stå INNE i huset utan att
// servern puttar ut dem. Geometri: cabin_deep_forest (JÄGAR-STUGAN),
// bounds x3450 y2750 w220 h180 (shared/battleroyale-arena.js):
//   norr-vägg y2750-2762 med FÖNSTER x3510-3550 + x3590-3630 (passThroughBullets)
//   söder-DÖRR x3540-3590 (gap — ingen vägg alls)
// 4 scenarier (var sin BR-match, 2 spelare, pistol):
//   A) FÖNSTER IN:  skytt ute (3530,2735) ↓ → offer inne (3530,2820) = TRÄFF
//   B) VÄGG:        skytt ute (3480,2735) ↓ → offer inne (3480,2820) = BLOCKERAT
//   C) FÖNSTER UT:  skytt inne (3530,2820) ↑ → offer ute (3530,2680) = TRÄFF
//   D) DÖRR:        skytt ute (3565,2960) ↑ → offer inne (3565,2850) = TRÄFF
// + assert: offrets server-position stannar inne i stugan (resolveCtfWall
//   puttar inte ut — dörren är ett riktigt gap i vägg-geometrin).
// OBS: servern har anti-teleport-clamp (room-sim.js applyPlayerInput) — spelarna
// GÅR till sina positioner (40Hz-inputs ≈ 27px/input) med enkel detour-logik
// runt träd/stenar. Träff detekteras via pvp_hp_changed shield<200 (BR startar
// 200 shield; klient-hp-ekot rör aldrig shield — den är helt server-side).
// Kör mot lokal server:
//   $env:PORT=8091; node server\server.js   (i eget fönster)
//   node tools/probe-br-walls.js [ws://localhost:8091]
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8091';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag, msgs: [], waiters: [], worldPos: {},   // worldPos: slot → {x,y}
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} },
      close: () => { try { ws.close(); } catch (e) {} },
      _push(d) {
        if (d.type === 'world' && Array.isArray(d.players)) {
          for (const p of d.players) this.worldPos[p.c] = { x: p.x, y: p.y };
        }
        const item = { d, at: Date.now() };
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i];
          if (w.pred(item)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(item); return; }
        }
        this.msgs.push(item);
        if (this.msgs.length > 3000) this.msgs.splice(0, 1500);
      },
      wait(pred, timeoutMs) {
        const idx = this.msgs.findIndex(pred);
        if (idx >= 0) return Promise.resolve(this.msgs.splice(idx, 1)[0]);
        return new Promise((res, rej) => {
          const w = { pred, res };
          w.timer = setTimeout(() => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) this.waiters.splice(i, 1);
            rej(new Error('timeout: ' + tag));
          }, timeoutMs || 10000);
          this.waiters.push(w);
        });
      },
      waitMsg(type, timeoutMs) { return this.wait(it => it.d.type === type, timeoutMs); },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      c._push(m);
    });
  });
}

// Ett scenario = en egen BR-match med 2 spelare (host = skytt, slot 0).
async function runScenario(name, shooterTarget, victimTarget) {
  const host = await mkClient(name + '-host');
  host.send({ type: 'host', name: 'WPROBE_A', godot: 1 });
  const h = await host.waitMsg('hosted', 6000);
  host.peerId = h.d.peerId; host.code = h.d.code; host.slot = 0;

  const peer = await mkClient(name + '-peer');
  peer.send({ type: 'join', code: host.code, name: 'WPROBE_B', godot: 1 });
  const j = await peer.waitMsg('joined', 6000);
  peer.peerId = j.d.peerId; peer.slot = j.d.stableSlot;

  // Lång match → fas 0 (LOOT, outsideDmg 0, hela kartan) varar 135s — gott om gå-tid
  host.send({ type: 'sim_start', battleroyale: true, battleroyaleMatchDurationSec: 900, countdownMs: 1000 });
  await host.wait(it => it.d.type === 'sim_events' && it.d.events.some(e => e.type === 'br_started'), 10000);
  await host.wait(it => it.d.type === 'sim_events' && it.d.events.some(e => e.type === 'countdown_end'), 10000);

  // 40Hz input-pump per klient: gå mot rörligt mål (anti-teleport-clampen flyttar
  // server-pos ≤ ~27px/input mot målet). Detour: om ingen progress på 1.5s →
  // tillfälligt sidled-mål (träd/sten-pushen + nytt mål löser fastlåsning).
  function mkPump(c, target) {
    const st = { c, target, want: { ...target }, lastPos: null, lastMoveAt: Date.now(), detourUntil: 0 };
    st.timer = setInterval(() => {
      const pos = c.worldPos[c.slot];
      const now = Date.now();
      if (pos) {
        if (!st.lastPos || Math.hypot(pos.x - st.lastPos.x, pos.y - st.lastPos.y) > 10) {
          st.lastPos = { ...pos }; st.lastMoveAt = now;
        } else if (now - st.lastMoveAt > 1500 && now > st.detourUntil &&
                   Math.hypot(pos.x - st.target.x, pos.y - st.target.y) > 30) {
          // fast bakom hinder → 1.2s sidleds-detour (slumpad riktning)
          const a = Math.atan2(st.target.y - pos.y, st.target.x - pos.x) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
          st.want = { x: pos.x + Math.cos(a) * 250, y: pos.y + Math.sin(a) * 250 };
          st.detourUntil = now + 1200;
          st.lastMoveAt = now;
        }
        if (now > st.detourUntil) st.want = { ...st.target };
      }
      c.send({ type: 'sim_input', x: st.want.x, y: st.want.y, hp: 100, aim: 0 });
    }, 25);
    return st;
  }
  const pumps = [mkPump(host, shooterTarget), mkPump(peer, victimTarget)];

  // Vänta tills BÅDA är ≤6px från målet (max 60s)
  const arriveDeadline = Date.now() + 60000;
  let arrived = false;
  while (Date.now() < arriveDeadline) {
    const sp = host.worldPos[host.slot];
    const vp = host.worldPos[peer.slot];
    if (sp && vp &&
        Math.hypot(sp.x - shooterTarget.x, sp.y - shooterTarget.y) <= 6 &&
        Math.hypot(vp.x - victimTarget.x, vp.y - victimTarget.y) <= 6) { arrived = true; break; }
    await sleep(150);
  }

  // Lyssna på skada hos offret (shield<200 = server-kulan träffade — shield är
  // helt server-side, hp-ekot i sim_input kan inte maskera den)
  let damaged = false;
  const damagedPromise = peer.wait(it =>
    it.d.type === 'sim_events' && it.d.events.some(e =>
      e.type === 'pvp_hp_changed' && e.peerId === peer.peerId &&
      typeof e.shield === 'number' && e.shield < 200),
  20000).then(() => { damaged = true; }).catch(() => {});

  // 25 pistol-skott @150ms — vinkel räknas från FAKTISKA server-positioner
  if (arrived) {
    for (let s = 0; s < 25 && !damaged; s++) {
      const sp = host.worldPos[host.slot];
      const vp = host.worldPos[peer.slot];
      const ang = Math.atan2(vp.y - sp.y, vp.x - sp.x);
      host.send({ type: 'sim_shoot', weaponId: 'pistol', x: sp.x, y: sp.y, ang });
      await sleep(150);
    }
    await sleep(800);
  }

  const lastVictimPos = host.worldPos[peer.slot] ? { ...host.worldPos[peer.slot] } : null;
  for (const p of pumps) clearInterval(p.timer);
  host.close(); peer.close();
  await sleep(200);
  return { arrived, damaged, lastVictimPos };
}

(async () => {
  console.log('[probe-br-walls] mot', URL);
  const CABIN = { x: 3450, y: 2750, w: 220, h: 180 }; // cabin_deep_forest

  // A) FÖNSTER IN — skott utifrån genom norr-fönstret (x3510-3550) träffar inne
  const a = await runScenario('FONSTER-IN', { x: 3530, y: 2735 }, { x: 3530, y: 2820 });
  ok(a.arrived, 'FÖNSTER IN: båda spelarna nådde sina positioner (offret gick in genom dörren)');
  ok(a.damaged, 'FÖNSTER IN: skott genom fönster träffar spelare inne i huset');
  ok(a.lastVictimPos &&
     a.lastVictimPos.x > CABIN.x && a.lastVictimPos.x < CABIN.x + CABIN.w &&
     a.lastVictimPos.y > CABIN.y && a.lastVictimPos.y < CABIN.y + CABIN.h,
     'INNE: servern puttar INTE ut spelaren ur huset (kan gömma sig inne)', a.lastVictimPos);

  // B) VÄGG — samma håll men mot vägg-segmentet (x3450-3510) = blockerat
  const b = await runScenario('VAGG', { x: 3480, y: 2735 }, { x: 3480, y: 2820 });
  ok(b.arrived, 'VÄGG: båda spelarna nådde sina positioner');
  ok(b.arrived && !b.damaged, 'VÄGG: skott mot vägg stoppas (ingen skada bakom väggen)');

  // C) FÖNSTER UT — skott inifrån genom samma fönster träffar ute (åt andra hållet)
  const c = await runScenario('FONSTER-UT', { x: 3530, y: 2820 }, { x: 3530, y: 2680 });
  ok(c.arrived, 'FÖNSTER UT: båda spelarna nådde sina positioner');
  ok(c.damaged, 'FÖNSTER UT: skott inifrån genom fönster träffar spelare utanför');

  // D) DÖRR — skott utifrån genom söder-dörröppningen (x3540-3590) träffar inne
  const d = await runScenario('DORR', { x: 3565, y: 2960 }, { x: 3565, y: 2850 });
  ok(d.arrived, 'DÖRR: båda spelarna nådde sina positioner');
  ok(d.damaged, 'DÖRR: skott genom dörröppningen träffar spelare inne i huset');

  console.log(`\n[probe-br-walls] ${pass}/${pass + fail} OK`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('PROBE-FEL:', e.message); process.exit(1); });
