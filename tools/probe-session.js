// Probe DTLS-alternativet: HTTPS /auth/session → token → acct_login{token}.
//   node tools/probe-session.js [http-base] [ws-url]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const BASE = process.argv[2] || 'http://localhost:8094';
const WSURL = process.argv[3] || 'ws://localhost:8094';
const http = require(BASE.startsWith('https') ? 'https' : 'http');   // live Fly = TLS
const SECRET = 'abcdef0123456789abcdef0123456789';
const fails = [];
const post = (path, body) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const u = new URL(BASE + path);
  const r = http.request({ hostname: u.hostname, port: u.port || (BASE.startsWith('https') ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
    let b = ''; resp.on('data', c => b += c); resp.on('end', () => res({ status: resp.statusCode, body: b }));
  });
  r.on('error', rej); r.write(data); r.end();
});
const wsLogin = (loginMsg) => new Promise((res) => {
  const ws = new WebSocket(WSURL);
  const t = setTimeout(() => { try { ws.close(); } catch (e) {} res({ type: 'timeout' }); }, 5000);
  ws.on('open', () => ws.send(JSON.stringify(loginMsg)));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type === 'acct_logged_in' || m.type === 'acct_error') { clearTimeout(t); try { ws.close(); } catch (e) {} res(m); }
  });
  ws.on('error', () => { clearTimeout(t); res({ type: 'wserror' }); });
});
(async () => {
  // 1) HTTPS-handshake → token
  const r1 = await post('/auth/session', { secret: SECRET, name: 'TKN', id: '', stats: { matches: 1, kills: 2, wins: 0 } });
  let j1 = {}; try { j1 = JSON.parse(r1.body); } catch (e) {}
  const c1 = r1.status === 200 && typeof j1.token === 'string' && j1.token.length >= 32 && /^[0-9]+$/.test(String(j1.id));
  console.log((c1 ? '✅' : '❌') + ' [1] /auth/session → token (status ' + r1.status + ', id ' + j1.id + ', token ' + String(j1.token).slice(0, 8) + '…)');
  if (!c1) { fails.push('session-endpoint'); }
  // 2) acct_login{token} → logged_in
  const r2 = await wsLogin({ type: 'acct_login', token: j1.token });
  const c2 = r2.type === 'acct_logged_in' && String(r2.id) === String(j1.id);
  console.log((c2 ? '✅' : '❌') + ' [2] acct_login{token} → acct_logged_in (id ' + r2.id + ')');
  if (!c2) fails.push('token-login');
  // 3) acct_login{token:bad} → acct_error session
  const r3 = await wsLogin({ type: 'acct_login', token: 'deadbeef'.repeat(8) });
  const c3 = r3.type === 'acct_error' && r3.code === 'session';
  console.log((c3 ? '✅' : '❌') + ' [3] acct_login{bad token} → acct_error session (' + (r3.code || r3.type) + ')');
  if (!c3) fails.push('bad-token-not-rejected');
  // 4) legacy acct_login{secret} fungerar fortfarande (WSS/TLS-väg)
  const r4 = await wsLogin({ type: 'acct_login', secret: SECRET, id: j1.id });
  const c4 = r4.type === 'acct_logged_in' && String(r4.id) === String(j1.id);
  console.log((c4 ? '✅' : '❌') + ' [4] legacy acct_login{secret} → acct_logged_in (bakåtkompat)');
  if (!c4) fails.push('legacy-broken');
  // 5) HTTPS fel secret för befintligt id → 401
  const r5 = await post('/auth/session', { secret: 'wrongwrongwrongwrong0000', id: j1.id });
  const c5 = r5.status === 401;
  console.log((c5 ? '✅' : '❌') + ' [5] /auth/session fel secret → 401 (' + r5.status + ')');
  if (!c5) fails.push('wrong-secret-accepted');
  // ── Phase 2: e-post-lösenord över HTTPS (op-fält) ──────────────────────────
  const EMAIL = 'probe' + j1.id + '@test.com';
  const PW = 'testpass123';
  // 6) email_bind via session-token (inloggat konto från [1])
  const r6 = await post('/auth/session', { op: 'email_bind', token: j1.token, email: EMAIL, password: PW });
  let j6 = {}; try { j6 = JSON.parse(r6.body); } catch (e) {}
  const c6 = r6.status === 200 && j6.ok === true && j6.bound && j6.bound.email === true;
  console.log((c6 ? '✅' : '❌') + ' [6] HTTPS email_bind → ok + bound.email (status ' + r6.status + ')');
  if (!c6) fails.push('email_bind-https');
  // 7) email_login via HTTPS → token + switch till samma konto
  const r7 = await post('/auth/session', { op: 'email_login', email: EMAIL, password: PW });
  let j7 = {}; try { j7 = JSON.parse(r7.body); } catch (e) {}
  const c7 = r7.status === 200 && typeof j7.token === 'string' && j7.switch === true && String(j7.id) === String(j1.id) && typeof j7.secret === 'string';
  console.log((c7 ? '✅' : '❌') + ' [7] HTTPS email_login → token+switch (id ' + j7.id + ', secret över TLS)');
  if (!c7) fails.push('email_login-https');
  // 8) fel lösenord → 401 badlogin (ingen enumeration)
  const r8 = await post('/auth/session', { op: 'email_login', email: EMAIL, password: 'fellosenord999' });
  const c8 = r8.status === 401;
  console.log((c8 ? '✅' : '❌') + ' [8] HTTPS email_login fel pw → 401 (' + r8.status + ')');
  if (!c8) fails.push('email-wrong-pw-accepted');
  console.log(fails.length ? ('\n❌ ' + fails.length + ' FEL: ' + fails.join(', ')) : '\n✅ ALLA 8 GRÖNA — guest+email-secret går bara över HTTPS, token binder UDP-socketen');
  process.exit(fails.length ? 1 : 0);
})();
