// Probe: V2 fiende-FX-bitar (C4+C3) + kill-event weaponId (E6).
//   fx-bitar: 16=HEALING (+ht), 32=SUMMONING, 64=SNIPER-AIM (+at), 128=BOMBER-ARMED
//   kill-weaponId: rifle-kill → enemy_killed.weaponId=='rifle', katana → 'katana',
//                  granat (sim_grenade_throw) → 'grenade'
// Kör mot lokal server:
//   $env:PORT=8109; node server\server.js   (i eget fönster)
//   node tools/probe-fx-bits.js [ws://localhost:8109]
// OBS: healer-biten kräver att en skadad fiende kommer inom 200px av healern —
// proben teleporterar spelaren intill healern så skadade brutes (som jagar
// spelaren) hamnar i heal-range. Beteende-driven → körningen tar ~1-2 min.
'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8109';

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
      } else {
        c._push('msg', m);
      }
    });
  });
}

async function hostRoom(name) {
  const c = await mkClient(name);
  c.send({ type: 'host', name, godot: 1 });
  const h = await c.waitMsg('hosted', 6000);
  c.code = h.d.code; c.peerId = h.d.peerId;
  return c;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Starta story-stage med given enemy-pool. Returnerar klient + input-pump-kontroll.
async function startStage(name, pool, count) {
  const c = await hostRoom(name);
  c.send({
    type: 'sim_start', mode: 'story', wave: 1, countdownMs: 1000,
    customStages: [{
      id: 'fx1', name: 'FX-PROBE', kind: 'arena',
      worldW: 2000, worldH: 2000,
      spawnPos: { x: 1000, y: 1400 }, goalPos: { x: 1000, y: 400 },
      zones: [{ count, pool }],
    }],
  });
  await c.waitEvt('countdown_end', 10000);
  c.me = { x: 1000, y: 1400, aim: 0 };
  c.pump = setInterval(() => {
    c.send({ type: 'sim_input', x: c.me.x, y: c.me.y, hp: 100, aim: c.me.aim });
  }, 50);
  return c;
}
function stop(c) { if (c.pump) clearInterval(c.pump); c.close(); }

// Vänta (max ms) på ett world-paket där pred(world) ger truthy. Returnerar pred-värdet.
async function watchWorld(c, ms, pred) {
  const tEnd = Date.now() + ms;
  while (Date.now() < tEnd) {
    let it;
    try {
      it = await c.wait(x => x.t === 'msg' && x.d.type === 'world', Math.max(50, tEnd - Date.now()));
    } catch (e) { return null; }
    const r = pred(it.d);
    if (r) return r;
  }
  return null;
}

// ── A) SUMMONING (bit 32) ────────────────────────────────────────────────────
async function probeSummoner() {
  console.log('\n[A] fx 32 — SUMMONING');
  const c = await startStage('FXSUM', ['summoner'], 3);
  const hit = await watchWorld(c, 25000, w =>
    (w.enemies || []).find(e => e.t === 'summoner' && (e.fx & 32)));
  ok(!!hit, 'summoner fick fx-bit 32 (pre-summon-fönster)', hit);
  // Bonus-bevis: summonen hände faktiskt (runners dyker upp i world)
  const rn = await watchWorld(c, 10000, w => (w.enemies || []).find(e => e.t === 'runner'));
  ok(!!rn, 'summon skedde (runner i world efter cast)');
  stop(c);
}

// ── B) SNIPER-AIM (bit 64 + at) ──────────────────────────────────────────────
async function probeSniper() {
  console.log('\n[B] fx 64 — SNIPER-AIM (+at)');
  const c = await startStage('FXSNP', ['sniper'], 3);
  const hit = await watchWorld(c, 35000, w =>
    (w.enemies || []).find(e => e.t === 'sniper' && (e.fx & 64)));
  ok(!!hit, 'sniper fick fx-bit 64 under aim-fasen', hit);
  ok(!!hit && hit.at === c.peerId, 'at == spelarens peerId (' + c.peerId + ')', hit && hit.at);
  stop(c);
}

// ── C) BOMBER-ARMED (bit 128) ────────────────────────────────────────────────
async function probeBomber() {
  console.log('\n[C] fx 128 — BOMBER-ARMED');
  const c = await startStage('FXBMB', ['bomber'], 4);
  const hit = await watchWorld(c, 25000, w =>
    (w.enemies || []).find(e => e.t === 'bomber' && (e.fx & 128)));
  ok(!!hit, 'bomber fick fx-bit 128 (fuse tänd nära spelaren)', hit);
  stop(c);
}

// ── D) HEALING (bit 16 + ht) ─────────────────────────────────────────────────
async function probeHealer() {
  console.log('\n[D] fx 16 — HEALING (+ht)');
  const c = await startStage('FXHEAL', ['healer', 'brute', 'brute'], 12);
  let healHit = null, lastWorld = null;
  const tEnd = Date.now() + 60000;
  while (Date.now() < tEnd && !healHit) {
    // Kort fönster: leta heal-bit, annars agera på senaste world
    healHit = await watchWorld(c, 600, w => {
      lastWorld = w;
      return (w.enemies || []).find(e => e.t === 'healer' && (e.fx & 16));
    });
    if (healHit || !lastWorld) continue;
    const ens = lastWorld.enemies || [];
    const healer = ens.find(e => e.t === 'healer' && e.hp > 0);
    if (!healer) continue;
    // Teleportera spelaren intill healern (non-PvP accepterar klient-pos) så
    // skadade brutes (som jagar spelaren) hamnar i healerns 200px-sökradie.
    c.me.x = healer.x + 110; c.me.y = healer.y;
    // Skada närmsta brute (need > 0.3 krävs): pistol-salva tills hp/mh < 0.6,
    // men låt den inte dö (skjut bara om hp > 40% av mh).
    let brute = null, bd = Infinity;
    for (const e of ens) {
      if (e.t !== 'brute' || e.hp <= 0) continue;
      const d = Math.hypot(e.x - c.me.x, e.y - c.me.y);
      if (d < bd) { bd = d; brute = e; }
    }
    if (brute && brute.mh && brute.hp > brute.mh * 0.4 && brute.hp > brute.mh * 0.55 && bd < 650) {
      const ang = Math.atan2(brute.y - c.me.y, brute.x - c.me.x);
      c.me.aim = ang;
      for (let i = 0; i < 2; i++) {
        c.send({ type: 'sim_shoot', weaponId: 'pistol', x: c.me.x, y: c.me.y, ang });
        await sleep(120);
      }
    }
    await sleep(250);
    c.clear();
  }
  ok(!!healHit, 'healer fick fx-bit 16 (aktiv heal)', healHit);
  if (healHit) {
    const tgt = (lastWorld.enemies || []).find(e => e.i === healHit.ht);
    ok(typeof healHit.ht === 'number', 'ht-fält satt (enemy-idx ' + healHit.ht + ')', healHit.ht);
    ok(!tgt || tgt.t !== 'healer', 'ht pekar på icke-healer (beam-target)', tgt && tgt.t);
  } else {
    fail++; console.log('  ❌ ht-fält ej verifierat (bit 16 triggade aldrig)');
  }
  stop(c);
}

// ── E) KILL-EVENT WEAPONID ───────────────────────────────────────────────────
async function probeKillWeapon() {
  console.log('\n[E] enemy_killed.weaponId (rifle/katana/grenade)');
  const c = await startStage('FXKILL', ['grunt'], 8);
  // Hjälpare: hitta närmsta levande grunt i senaste world
  const nearestGrunt = async () => watchWorld(c, 8000, w => {
    let best = null, bd = Infinity;
    for (const e of (w.enemies || [])) {
      if (e.t !== 'grunt' || e.hp <= 0) continue;
      const d = Math.hypot(e.x - c.me.x, e.y - c.me.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best && bd < 650 ? best : null;
  });

  // 1) RIFLE-KILL
  let g = await nearestGrunt();
  if (g) {
    c.clear();
    const ang = Math.atan2(g.y - c.me.y, g.x - c.me.x);
    c.me.aim = ang;
    for (let i = 0; i < 6; i++) {
      c.send({ type: 'sim_shoot', weaponId: 'rifle', x: c.me.x, y: c.me.y, ang });
      await sleep(100);
    }
    let ev = null;
    try { ev = (await c.waitEvt('enemy_killed', 8000)).d; } catch (e) {}
    ok(!!ev && ev.weaponId === 'rifle', 'rifle-kill → enemy_killed.weaponId == "rifle"', ev);
    ok(!!ev && ev.killerPid === c.peerId, 'rifle-kill → killerPid == skytten', ev && ev.killerPid);
  } else {
    fail++; console.log('  ❌ ingen grunt inom räckhåll för rifle-test');
  }

  // 2) KATANA-KILL (server-melee är _jsonWorld-gated → vi är Godot-klient)
  await sleep(1500); c.clear();
  g = await nearestGrunt();
  if (g) {
    // Teleportera intill grunten + invänta att playerState uppdaterats
    c.me.x = g.x - 40; c.me.y = g.y;
    await sleep(300); c.clear();
    let ev = null;
    for (let i = 0; i < 6 && !ev; i++) {
      const w2 = await watchWorld(c, 1500, w => (w.enemies || []).find(e => e.i === g.i && e.hp > 0) || 'gone');
      if (w2 === 'gone' || !w2) break;
      const ang = Math.atan2(w2.y - c.me.y, w2.x - c.me.x);
      c.me.aim = ang;
      c.send({ type: 'sim_shoot', weaponId: 'katana', x: c.me.x, y: c.me.y, ang });
      try { ev = (await c.waitEvt('enemy_killed', 700)).d; } catch (e) {}
    }
    ok(!!ev && ev.weaponId === 'katana', 'katana-kill → enemy_killed.weaponId == "katana"', ev);
  } else {
    fail++; console.log('  ❌ ingen grunt kvar för katana-test');
  }

  // 3) GRANAT-KILL (sim_grenade_throw → explode(..., "grenade"))
  await sleep(1500); c.clear();
  g = await nearestGrunt();
  if (g) {
    c.clear();
    c.send({
      type: 'sim_grenade_throw',
      fromX: c.me.x, fromY: c.me.y, toX: g.x, toY: g.y, flightMs: 250, kind: 'frag',
    });
    let ev = null;
    try { ev = (await c.waitEvt('enemy_killed', 8000)).d; } catch (e) {}
    ok(!!ev && ev.weaponId === 'grenade', 'granat-kill → enemy_killed.weaponId == "grenade"', ev);
  } else {
    fail++; console.log('  ❌ ingen grunt kvar för granat-test');
  }
  stop(c);
}

(async () => {
  try {
    await probeSummoner();
    await probeSniper();
    await probeBomber();
    await probeHealer();
    await probeKillWeapon();
  } catch (e) {
    fail++;
    console.log('  ❌ PROBE-EXCEPTION:', e.message);
  }
  console.log('\n══════════════════════════════');
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
})();
