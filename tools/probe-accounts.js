// Probe: konto-/vänsystemet (acct_* — server/accounts.js). Spawnar egen lokal
// server på PORT 8096 (ACCOUNTS_DATA_DIR → temp-katalog så riktig data inte
// rörs), kör hela scenariot, dödar servern efteråt.
//   node tools/probe-accounts.js
// Scenario: A registrerar (utan id) → 8-siffrigt id; B registrerar; sök;
// friend-request → request_in → accept → friends_update online:true;
// A hostar → B ser activity lobby + code; A invite → B får acct_invited;
// B disconnect → A ser online:false; B re-login med id+secret → vänlista kvar;
// C med B:s id + FEL secret → acct_error auth; SIMULERAD DATAFÖRLUST:
// okänt id + friends-lista → kontot återskapas med vänlistan (resync).
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = process.env.PORT || 8096;
const URL = 'ws://localhost:' + PORT;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = {
      ws, tag, items: [], waiters: [],
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
      wait(pred, timeoutMs) {
        const idx = this.items.findIndex(pred);
        if (idx >= 0) return Promise.resolve(this.items.splice(idx, 1)[0]);
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
      waitMsg(type, timeoutMs) { return this.wait(it => it.t === 'msg' && it.d.type === type, timeoutMs); },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (m.type === 'sim_events' && Array.isArray(m.events)) {
        for (const e of m.events) c._push('evt', e);
      } else c._push('msg', m);
    });
  });
}

// Spawna lokal server med temp-datadir
function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-acct-probe-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ACCOUNTS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server startade inte inom 10s')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('Listening on port')) { clearTimeout(to); resolve({ child, dataDir }); }
    });
    child.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));
    child.on('exit', (code) => { clearTimeout(to); reject(new Error('servern dog vid start, kod ' + code)); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SECRET_A = 'a'.repeat(8) + 'probeSecretA0001';
const SECRET_B = 'b'.repeat(8) + 'probeSecretB0002';

(async () => {
  console.log('[probe-accounts] spawnar server på port', PORT);
  const { child, dataDir } = await startServer();
  console.log('[probe-accounts] server uppe, datadir:', dataDir);
  try {
    // ── 1) A registrerar (utan id) → 8-siffrigt numeriskt id ────────────────
    const A = await mkClient('A');
    A.send({ type: 'acct_login', secret: SECRET_A, name: 'ProbeAnna', avatar: { skin: 2, hat: 'cap' }, stats: { matches: 9, kills: 50, wins: 3 }, v: 1 });
    const aIn = (await A.waitMsg('acct_logged_in')).d;
    ok(/^[0-9]{8}$/.test(aIn.id), 'A: nytt konto fick 8-siffrigt numeriskt id', aIn.id);
    ok(aIn.name === 'ProbeAnna', 'A: namn satt', aIn.name);
    ok(aIn.level === 4, 'A: level = 1+floor(sqrt(9)) = 4', aIn.level);
    ok(Array.isArray(aIn.friends) && aIn.friends.length === 0, 'A: tom vänlista', aIn.friends);

    // ── 2) B registrerar ────────────────────────────────────────────────────
    const B = await mkClient('B');
    B.send({ type: 'acct_login', secret: SECRET_B, name: 'ProbeBjörn', avatar: { skin: 5 }, v: 1 });
    const bIn = (await B.waitMsg('acct_logged_in')).d;
    ok(/^[0-9]{8}$/.test(bIn.id) && bIn.id !== aIn.id, 'B: eget 8-siffrigt id', bIn.id);

    // ── 3) A söker B: namn-prefix + exakt id ────────────────────────────────
    A.send({ type: 'acct_search', q: 'probebj' });
    let sr = (await A.waitMsg('acct_search_result')).d;
    ok(sr.results.some(r => r.id === bIn.id), 'A: namn-prefix-sök (case-insensitive) hittar B', sr.results);
    ok(!sr.results.some(r => r.id === aIn.id), 'A: sökresultat exkluderar mig själv');
    A.send({ type: 'acct_search', q: bIn.id });
    sr = (await A.waitMsg('acct_search_result')).d;
    ok(sr.results.length > 0 && sr.results[0].id === bIn.id, 'A: exakt ID-träff först', sr.results);
    ok(sr.results[0].online === true, 'A: B visas online i sökresultat');

    // ── 4) A → friend request → B får acct_request_in ───────────────────────
    A.send({ type: 'acct_friend_request', toId: bIn.id });
    const okReq = (await A.waitMsg('acct_ok')).d;
    ok(okReq.what === 'request', 'A: acct_ok what=request', okReq);
    const reqIn = (await B.waitMsg('acct_request_in')).d;
    ok(reqIn.from && reqIn.from.id === aIn.id && reqIn.from.name === 'ProbeAnna', 'B: acct_request_in med A:s profil', reqIn.from);
    // dubblett-request → already
    A.send({ type: 'acct_friend_request', toId: bIn.id });
    const dupErr = (await A.waitMsg('acct_error')).d;
    ok(dupErr.code === 'already', 'A: dubblett-request → acct_error already', dupErr);
    // self-request → self
    A.send({ type: 'acct_friend_request', toId: aIn.id });
    ok((await A.waitMsg('acct_error')).d.code === 'self', 'A: request till sig själv → self');

    // ── 5) B accepterar → båda får friends_update med online:true ──────────
    B.send({ type: 'acct_friend_accept', fromId: aIn.id });
    const aUpd = (await A.wait(it => it.t === 'msg' && it.d.type === 'acct_friends_update')).d;
    const bUpd = (await B.wait(it => it.t === 'msg' && it.d.type === 'acct_friends_update')).d;
    const aSeesB = aUpd.friends.find(f => f.id === bIn.id);
    const bSeesA = bUpd.friends.find(f => f.id === aIn.id);
    ok(aSeesB && aSeesB.online === true, 'A: friends_update visar B online:true', aUpd.friends);
    ok(bSeesA && bSeesA.online === true, 'B: friends_update visar A online:true', bUpd.friends);
    ok(bSeesA && bSeesA.activity === 'meny', 'B: A:s activity = meny (inget rum)', bSeesA);

    // ── 6) A hostar rum → B:s friends_update visar lobby + code ────────────
    A.send({ type: 'host', name: 'ProbeAnna', godot: 1 });
    const hosted = (await A.waitMsg('hosted')).d;
    const bUpd2 = (await B.wait(it => it.t === 'msg' && it.d.type === 'acct_friends_update'
      && it.d.friends.some(f => f.id === aIn.id && f.activity === 'lobby'), 6000)).d;
    const aEntry = bUpd2.friends.find(f => f.id === aIn.id);
    ok(aEntry.activity === 'lobby', 'B: A:s activity = lobby efter host', aEntry);
    ok(aEntry.code === hosted.code, 'B: friends_update bär rumskoden (GÅ MED)', aEntry);
    ok(typeof aEntry.mode === 'string' && aEntry.mode.length > 0, 'B: mode med i friend-entry', aEntry.mode);

    // ── 7) A invite B → B får acct_invited med code + mode ─────────────────
    A.send({ type: 'acct_invite', toId: bIn.id });
    ok((await A.waitMsg('acct_ok')).d.what === 'invite', 'A: acct_ok what=invite');
    const inv = (await B.waitMsg('acct_invited')).d;
    ok(inv.from && inv.from.id === aIn.id, 'B: acct_invited från A', inv.from);
    ok(inv.code === hosted.code, 'B: invite bär rumskoden', inv);
    ok(typeof inv.mode === 'string', 'B: invite bär mode', inv.mode);
    // invite till icke-vän → notfriend
    A.send({ type: 'acct_invite', toId: '00000001' });
    ok((await A.waitMsg('acct_error')).d.code === 'notfriend', 'A: invite till icke-vän → notfriend');

    // ── 8) B disconnectar → A får friends_update online:false ──────────────
    B.close();
    const aUpd3 = (await A.wait(it => it.t === 'msg' && it.d.type === 'acct_friends_update'
      && it.d.friends.some(f => f.id === bIn.id && f.online === false), 6000)).d;
    ok(aUpd3.friends.find(f => f.id === bIn.id).online === false, 'A: B offline efter disconnect');

    // ── 9) B loggar in IGEN med samma id+secret → vänlistan kvar ────────────
    const B2 = await mkClient('B2');
    B2.send({ type: 'acct_login', id: bIn.id, secret: SECRET_B, name: 'ProbeBjörn', avatar: { skin: 5 }, v: 1 });
    const b2In = (await B2.waitMsg('acct_logged_in')).d;
    ok(b2In.id === bIn.id, 'B2: samma id efter re-login', b2In.id);
    const b2SeesA = b2In.friends.find(f => f.id === aIn.id);
    ok(!!b2SeesA, 'B2: vänlistan kvar (innehåller A)', b2In.friends);
    ok(b2SeesA && b2SeesA.online === true && b2SeesA.activity === 'lobby' && b2SeesA.code === hosted.code,
      'B2: A:s presence (lobby + code) i login-svaret', b2SeesA);

    // ── 10) C: B:s id + FEL secret → acct_error auth ────────────────────────
    const C = await mkClient('C');
    C.send({ type: 'acct_login', id: bIn.id, secret: 'x'.repeat(24) + 'WRONG', name: 'ProbeC', v: 1 });
    ok((await C.waitMsg('acct_error')).d.code === 'auth', 'C: fel secret → acct_error auth');
    C.close();

    // ── 11) SIMULERAD DATAFÖRLUST: okänt id + friends → återskapas m. lista ──
    // (servern "tappade" kontot — klienten är durabel källa, resync-modellen)
    const D = await mkClient('D');
    const lostId = '43219876'; // okänt server-side
    D.send({ type: 'acct_login', id: lostId, secret: 'd'.repeat(20), name: 'ProbeDavid', avatar: {}, friends: [aIn.id], v: 1 });
    const dIn = (await D.waitMsg('acct_logged_in')).d;
    ok(dIn.id === lostId, 'D: kontot återskapat med klientens id', dIn.id);
    const dSeesA = dIn.friends.find(f => f.id === aIn.id);
    ok(!!dSeesA, 'D: vänlistan från login-payloaden gäller (resync)', dIn.friends);
    ok(dSeesA && dSeesA.online === true, 'D: A online i resync:ad lista', dSeesA);
    D.close();

    // ── 12) VÄNFÖRLUST-REGRESSION (2026-06-12): resync med vän vars konto INTE
    // finns på servern (färsk region-volym) → login-svaret ska behålla vännen
    // som pending-placeholder, INTE filtrera bort den (förr: bort → klienten
    // skrev över sin durabla cache med amputerad lista = permanent förlust).
    const E = await mkClient('E');
    const ghostId = '99887766';   // existerar INTE server-side
    E.send({ type: 'acct_login', id: '55667788', secret: 'e'.repeat(20), name: 'ProbeElsa', friends: [ghostId, aIn.id], v: 1 });
    const eIn = (await E.waitMsg('acct_logged_in')).d;
    const eGhost = eIn.friends.find(f => f.id === ghostId);
    ok(!!eGhost, 'E: okänd vän KVAR i login-svaret (pending-placeholder)', eIn.friends.map(f => f.id));
    ok(eGhost && eGhost.pending === 1 && eGhost.online === false, 'E: placeholder flaggad pending + offline', eGhost);
    ok(!!eIn.friends.find(f => f.id === aIn.id), 'E: känd vän (A) fortfarande komplett i samma lista');
    E.close();

    A.close(); B2.close();
  } catch (e) {
    fail++;
    console.error('  ❌ PROBE-FEL:', e.message);
  } finally {
    try { child.kill(); } catch (e) {}
  }
  await sleep(300);
  console.log('\n[probe-accounts]', pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
