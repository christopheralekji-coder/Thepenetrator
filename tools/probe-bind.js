// Probe: BIND-LAGRET (email/Google/Apple/Game Center — server/accounts.js).
// Spawnar egen lokal server på PORT 8099 (ACCOUNTS_DATA_DIR → temp-katalog) +
// MOCK-HTTP-SERVER på 8100 som agerar Apple JWKS, Google token/JWKS och
// GC-certserver via env-overrides till den spawnade servern.
//   node tools/probe-bind.js
//
// Nyckeltrick: proben genererar egna RSA-nyckelpar (crypto.generateKeyPairSync),
// exponerar publika delen som JWKS (n/e) på mocken och signerar egna id_tokens
// (Apple+Google) med rätt iss/aud/exp → HELA verifieringskedjan körs e2e.
// GC: Node kan inte SKAPA X509-cert utan deps → mocken serverar SPKI-DER och
// servern faller tillbaka på createPublicKey(der) när X509-parsning misslyckas
// OCH GC_CERT_URL_OVERRIDE är satt (override = testläge; prod kräver äkta cert
// + .apple.com-host).
// Kör även tools/probe-accounts.js som regression (32/32) på slutet.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = 8099;
const MOCK_PORT = 8100;
const URL_WS = 'ws://localhost:' + PORT;
const GOOGLE_CLIENT_ID = 'probe-google-client';
const BUNDLE_ID = 'com.probe.warparty';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? ('— ' + JSON.stringify(extra)) : ''); }
}

// ── Nycklar + JWT-helpers ────────────────────────────────────────────────────
function genKeys() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }
const appleKeys = genKeys();
const googleKeys = genKeys();
const gcKeys = genKeys();

function jwkOf(keys, kid) {
  const jwk = keys.publicKey.export({ format: 'jwk' }); // { kty, n, e } — n/e base64url
  return Object.assign({ kid, alg: 'RS256', use: 'sig' }, jwk);
}

function b64uEnc(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(payload, privateKey, kid) {
  const h = b64uEnc(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const p = b64uEnc(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey);
  return h + '.' + p + '.' + b64uEnc(sig);
}

const nowSec = () => Math.floor(Date.now() / 1000);

function appleToken(sub, opts) {
  const o = opts || {};
  return makeJwt({
    iss: o.iss || 'https://appleid.apple.com',
    aud: o.aud || BUNDLE_ID,
    exp: o.exp !== undefined ? o.exp : nowSec() + 3600,
    sub,
  }, appleKeys.privateKey, 'apple-k1');
}

// ── Mock-server (Apple JWKS + Google token/JWKS + GC-cert) ──────────────────
function startMock() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/apple/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwkOf(appleKeys, 'apple-k1')] }));
      return;
    }
    if (u.pathname === '/google/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwkOf(googleKeys, 'google-k1')] }));
      return;
    }
    if (u.pathname === '/google/token' && req.method === 'POST') {
      // Token-exchange-mock: sub härleds av code → proben styr sub via code-param
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const code = params.get('code') || 'nocode';
        const idToken = makeJwt({
          iss: 'https://accounts.google.com',
          aud: GOOGLE_CLIENT_ID,
          exp: nowSec() + 3600,
          sub: 'g-' + code,
        }, googleKeys.privateKey, 'google-k1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id_token: idToken }));
      });
      return;
    }
    if (u.pathname === '/gc/cert') {
      // SPKI-DER (inte X509-cert — se header-kommentaren om GC-testläget)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(gcKeys.publicKey.export({ type: 'spki', format: 'der' }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => srv.listen(MOCK_PORT, () => resolve(srv)));
}

// ── HTTP-helper (följer EJ redirects — vi vill inspektera 302:an) ───────────
function httpReq(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(url), { method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ── GC-signatur (Apples format: playerId ‖ bundleId ‖ tsBE64 ‖ salt) ─────────
function gcSign(playerId, bundleId, ts, tamper) {
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(ts));
  const salt = crypto.randomBytes(16);
  const payload = Buffer.concat([Buffer.from(playerId, 'utf8'), Buffer.from(bundleId, 'utf8'), tsBuf, salt]);
  const sig = crypto.sign('sha256', payload, gcKeys.privateKey);
  if (tamper) sig[8] ^= 0xff; // förstör signaturen
  return {
    type: 'acct_gc_login', playerId, bundleId,
    publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-4.cer',
    signature: sig.toString('base64'), salt: salt.toString('base64'), timestamp: ts,
  };
}

// ── WS-klient (samma mönster som probe-accounts.js) ─────────────────────────
function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_WS);
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

// ── Spawna spelservern med bind-env → mocken ────────────────────────────────
function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-bind-probe-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ACCOUNTS_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: 'probe-google-secret',
      GOOGLE_REDIRECT_URL: 'http://localhost:' + PORT + '/auth/google/callback',
      GOOGLE_TOKEN_URL: 'http://localhost:' + MOCK_PORT + '/google/token',
      GOOGLE_JWKS_URL: 'http://localhost:' + MOCK_PORT + '/google/jwks',
      APPLE_JWKS_URL: 'http://localhost:' + MOCK_PORT + '/apple/jwks',
      APPLE_BUNDLE_IDS: BUNDLE_ID + ',com.probe.other',
      GC_CERT_URL_OVERRIDE: 'http://localhost:' + MOCK_PORT + '/gc/cert',
    },
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

// Regression: kör probe-accounts.js och kräv 32/32
function runRegression() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'probe-accounts.js')], {
      env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SECRET_A = 'a'.repeat(8) + 'bindSecretA0001';
const SECRET_B = 'b'.repeat(8) + 'bindSecretB0002';
const SECRET_G = 'g'.repeat(8) + 'bindSecretG0003';
const EMAIL_A = 'anna.bind@test.se';
const PASS_A = 'superHemligt123';

(async () => {
  console.log('[probe-bind] startar mock på', MOCK_PORT, '+ server på', PORT);
  const mock = await startMock();
  const { child, dataDir } = await startServer();
  console.log('[probe-bind] uppe, datadir:', dataDir);
  try {
    // ── 1) Guest-login → bound finns och allt är false ──────────────────────
    const A = await mkClient('A');
    A.send({ type: 'acct_login', secret: SECRET_A, name: 'ProbeAnna', v: 1 });
    const aIn = (await A.waitMsg('acct_logged_in')).d;
    ok(aIn.bound && typeof aIn.bound === 'object', 'A: acct_logged_in har bound-objekt', aIn.bound);
    ok(aIn.bound.email === false && aIn.bound.google === false && aIn.bound.apple === false && aIn.bound.gc === false,
      'A: nytt konto → alla bound-flaggor false', aIn.bound);

    // ── 2) EMAIL: valideringar + bind ───────────────────────────────────────
    A.send({ type: 'acct_email_bind', email: 'inteenmail', password: PASS_A });
    ok((await A.waitMsg('acct_error')).d.code === 'invalid', 'A: ogiltig email → invalid');
    A.send({ type: 'acct_email_bind', email: EMAIL_A, password: 'kort7t' });
    ok((await A.waitMsg('acct_error')).d.code === 'invalid', 'A: password <8 → invalid');
    A.send({ type: 'acct_email_bind', email: 'Anna.Bind@Test.SE', password: PASS_A }); // blandat case → lowercase
    const ebOk = (await A.waitMsg('acct_ok')).d;
    ok(ebOk.what === 'email_bind', 'A: acct_ok what=email_bind', ebOk);
    ok(ebOk.bound && ebOk.bound.email === true, 'A: bound.email=true efter bind', ebOk.bound);

    // ── 3) EMAIL-LOGIN från "ny enhet" → acct_switch med samma id ───────────
    const N1 = await mkClient('N1');
    N1.send({ type: 'acct_email_login', email: EMAIL_A, password: PASS_A });
    const sw1 = (await N1.waitMsg('acct_switch')).d;
    ok(sw1.id === aIn.id, 'N1: acct_switch till A:s id (email lowercase-normaliserad)', sw1.id);
    ok(sw1.secret === SECRET_A, 'N1: acct_switch bär A:s secret');
    ok(sw1.name === 'ProbeAnna', 'N1: acct_switch bär namnet', sw1.name);
    N1.send({ type: 'acct_email_login', email: EMAIL_A, password: 'felLösenord99' });
    ok((await N1.waitMsg('acct_error')).d.code === 'badlogin', 'N1: fel lösenord → badlogin');
    N1.send({ type: 'acct_email_login', email: 'okand@test.se', password: PASS_A });
    ok((await N1.waitMsg('acct_error')).d.code === 'badlogin', 'N1: okänd email → badlogin (samma kod — ingen enumeration)');
    N1.close();

    // ── 4) EMAIL: dubbelbind från annan användare → taken; utan login → auth ─
    const B = await mkClient('B');
    B.send({ type: 'acct_login', secret: SECRET_B, name: 'ProbeBjörn', v: 1 });
    const bIn = (await B.waitMsg('acct_logged_in')).d;
    B.send({ type: 'acct_email_bind', email: EMAIL_A, password: 'annatLösen123' });
    ok((await B.waitMsg('acct_error')).d.code === 'taken', 'B: bind av A:s email → taken');
    const NoAuth = await mkClient('NoAuth');
    NoAuth.send({ type: 'acct_email_bind', email: 'x@y.se', password: 'lösenord123' });
    ok((await NoAuth.waitMsg('acct_error')).d.code === 'auth', 'NoAuth: email_bind utan login → auth');
    NoAuth.close();

    // ── 5) APPLE: giltig token → bind på inloggad B ─────────────────────────
    B.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-B') });
    const apOk = (await B.waitMsg('acct_ok')).d;
    ok(apOk.what === 'apple_bind', 'B: acct_ok what=apple_bind', apOk);
    ok(apOk.bound && apOk.bound.apple === true && apOk.bound.email === false, 'B: bound.apple=true (email fortf. false)', apOk.bound);

    // ── 6) APPLE: manipulerad signatur / fel aud / utgången → badtoken ──────
    const tampered = appleToken('apple-sub-X');
    const tParts = tampered.split('.');
    tParts[2] = tParts[2].slice(0, -2) + (tParts[2].endsWith('AA') ? 'BB' : 'AA');
    B.send({ type: 'acct_apple_login', identityToken: tParts.join('.') });
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: manipulerad signatur → badtoken');
    B.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-X', { aud: 'com.evil.app' }) });
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: fel aud → badtoken');
    B.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-X', { exp: nowSec() - 100 }) });
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: utgången token → badtoken');

    // ── 7) APPLE: A binder B:s sub → taken ──────────────────────────────────
    A.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-B') });
    ok((await A.waitMsg('acct_error')).d.code === 'taken', 'A: bind av B:s apple-sub → taken');

    // ── 8) APPLE: login utan konto → nytt konto; samma sub → samma id ───────
    const E = await mkClient('E');
    E.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-E') });
    const swE = (await E.waitMsg('acct_switch')).d;
    ok(/^[0-9]{8}$/.test(swE.id) && swE.id !== aIn.id && swE.id !== bIn.id,
      'E: apple-login utan konto → NYTT konto via acct_switch', swE.id);
    ok(typeof swE.secret === 'string' && swE.secret.length >= 16, 'E: nytt konto har server-genererat secret ≥16');
    E.close();
    const E2 = await mkClient('E2');
    E2.send({ type: 'acct_apple_login', identityToken: appleToken('apple-sub-E') });
    const swE2 = (await E2.waitMsg('acct_switch')).d;
    ok(swE2.id === swE.id, 'E2: samma apple-sub igen → acct_switch till SAMMA id', swE2.id);
    E2.close();

    // ── 9) GOOGLE: hela HTTP-flödet e2e (start → 302 → callback → WS-push) ──
    A.send({ type: 'acct_google_start' });
    const gUrl = (await A.waitMsg('acct_google_url')).d;
    ok(typeof gUrl.url === 'string' && gUrl.url.includes('/auth/google?s='), 'A: acct_google_url med engångstoken', gUrl.url);
    const r302 = await httpReq(gUrl.url);
    ok(r302.status === 302, 'GET /auth/google → 302', r302.status);
    const loc = new URL(r302.headers.location);
    ok(loc.hostname === 'accounts.google.com', '302 → accounts.google.com', loc.hostname);
    ok(loc.searchParams.get('client_id') === GOOGLE_CLIENT_ID, '302 bär client_id');
    ok(loc.searchParams.get('scope') === 'openid email', '302 bär scope openid email');
    const state = loc.searchParams.get('state');
    ok(state === gUrl.url.split('?s=')[1], '302 bär state = engångstoken');
    // Mock-exchange: code='annacode' → mocken signerar id_token med sub 'g-annacode'
    const rCb = await httpReq('http://localhost:' + PORT + '/auth/google/callback?code=annacode&state=' + state);
    ok(rCb.status === 200 && rCb.body.includes('Klart'), 'callback → 200 "✅ Klart"', rCb.status);
    const gOk = (await A.waitMsg('acct_ok')).d;
    ok(gOk.what === 'google_bind', 'A: WS-push acct_ok what=google_bind', gOk);
    ok(gOk.bound && gOk.bound.google === true && gOk.bound.email === true, 'A: bound {google:true, email:true}', gOk.bound);
    // Återanvänt state → engångstoken konsumerad → 400
    const rReuse = await httpReq('http://localhost:' + PORT + '/auth/google/callback?code=annacode&state=' + state);
    ok(rReuse.status === 400, 'callback med konsumerat state → 400', rReuse.status);

    // ── 10) GOOGLE: oinloggad ws + redan bunden sub → acct_switch ───────────
    const F = await mkClient('F');
    F.send({ type: 'acct_google_start' });
    const gUrl2 = (await F.waitMsg('acct_google_url')).d;
    const state2 = gUrl2.url.split('?s=')[1];
    await httpReq('http://localhost:' + PORT + '/auth/google/callback?code=annacode&state=' + state2);
    const swF = (await F.waitMsg('acct_switch')).d;
    ok(swF.id === aIn.id && swF.secret === SECRET_A, 'F: google-login (samma sub) utan konto → acct_switch till A', swF.id);
    F.close();

    // ── 11) GAME CENTER: giltig signatur → tyst bind på inloggad B ──────────
    const GC_ID = 'G:1234567890B';
    B.send(gcSign(GC_ID, BUNDLE_ID, Date.now()));
    const gcOk = (await B.waitMsg('acct_ok')).d;
    ok(gcOk.what === 'gc_bind', 'B: acct_ok what=gc_bind', gcOk);
    ok(gcOk.bound && gcOk.bound.gc === true && gcOk.bound.apple === true, 'B: bound {gc:true, apple:true}', gcOk.bound);

    // ── 12) GC: fel signatur / gammal timestamp / fel bundleId → badtoken ───
    B.send(gcSign('G:annan', BUNDLE_ID, Date.now(), true));
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: GC fel signatur → badtoken');
    B.send(gcSign('G:annan', BUNDLE_ID, Date.now() - 8 * 24 * 3600 * 1000));
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: GC timestamp >7 dygn → badtoken');
    B.send(gcSign('G:annan', 'com.evil.app', Date.now()));
    ok((await B.waitMsg('acct_error')).d.code === 'badtoken', 'B: GC fel bundleId → badtoken');

    // ── 13) GC REINSTALL: nytt guest-konto + samma gcPlayerId → acct_switch ─
    // (auto-räddningen: INTE taken-fel — reinstall ska byta till gamla kontot)
    const G = await mkClient('G');
    G.send({ type: 'acct_login', secret: SECRET_G, name: 'ProbeGustav', v: 1 });
    const gIn = (await G.waitMsg('acct_logged_in')).d;
    ok(gIn.id !== bIn.id, 'G: reinstall-guest har eget id', gIn.id);
    G.send(gcSign(GC_ID, BUNDLE_ID, Date.now()));
    const swG = (await G.waitMsg('acct_switch')).d;
    ok(swG.id === bIn.id && swG.secret === SECRET_B, 'G: samma gcPlayerId → acct_switch till GAMLA kontot (B)', swG.id);
    G.close();

    // ── 14) GC: oinloggad + okänd playerId → nytt konto via acct_switch ─────
    const Hc = await mkClient('H');
    Hc.send(gcSign('G:heltNy999', BUNDLE_ID, Date.now()));
    const swH = (await Hc.waitMsg('acct_switch')).d;
    ok(/^[0-9]{8}$/.test(swH.id) && swH.id !== bIn.id && swH.id !== aIn.id && swH.id !== swE.id,
      'H: GC-login utan konto → nytt konto', swH.id);
    Hc.close();

    // ── 15) bound-flaggor korrekta i acct_logged_in efter allt ──────────────
    const A2 = await mkClient('A2');
    A2.send({ type: 'acct_login', id: aIn.id, secret: SECRET_A, name: 'ProbeAnna', v: 1 });
    const a2In = (await A2.waitMsg('acct_logged_in')).d;
    ok(a2In.bound && a2In.bound.email === true && a2In.bound.google === true
      && a2In.bound.apple === false && a2In.bound.gc === false,
      'A re-login: bound {email,google} (ej apple/gc)', a2In.bound);
    const B2 = await mkClient('B2');
    B2.send({ type: 'acct_login', id: bIn.id, secret: SECRET_B, name: 'ProbeBjörn', v: 1 });
    const b2In = (await B2.waitMsg('acct_logged_in')).d;
    ok(b2In.bound && b2In.bound.apple === true && b2In.bound.gc === true
      && b2In.bound.email === false && b2In.bound.google === false,
      'B re-login: bound {apple,gc} (ej email/google)', b2In.bound);
    A2.close(); B2.close(); A.close(); B.close();
  } catch (e) {
    fail++;
    console.error('  ❌ PROBE-FEL:', e.message);
  } finally {
    try { child.kill(); } catch (e) {}
    try { mock.close(); } catch (e) {}
  }
  await sleep(300);
  console.log('\n[probe-bind]', pass + ' pass, ' + fail + ' fail');

  // ── REGRESSION: probe-accounts.js måste fortfarande gå 32/32 ──────────────
  console.log('[probe-bind] kör regression: probe-accounts.js …');
  const reg = await runRegression();
  const regOk = reg.code === 0 && reg.out.includes('32 pass, 0 fail');
  console.log(regOk ? '  ✅ regression 32/32' : '  ❌ regression FAIL (kod ' + reg.code + ')\n' + reg.out);
  if (!regOk) fail++;

  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE-FEL:', e.message); process.exit(2); });
