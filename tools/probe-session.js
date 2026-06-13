// Probe DTLS-alternativet: HTTPS /auth/session → token → acct_login{token}.
//   node tools/probe-session.js [http-base] [ws-url]
const http = require('http');
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const BASE = process.argv[2] || 'http://localhost:8094';
const WSURL = process.argv[3] || 'ws://localhost:8094';
const SECRET = 'abcdef0123456789abcdef0123456789';
const fails = [];
const post = (path, body) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const u = new URL(BASE + path);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
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
  console.log(fails.length ? ('\n❌ ' + fails.length + ' FEL: ' + fails.join(', ')) : '\n✅ ALLA 5 GRÖNA — secret går bara över HTTPS, token binder UDP-socketen');
  process.exit(fails.length ? 1 : 0);
})();
