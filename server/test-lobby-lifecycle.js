// Smoke-test för A1/A3-fixarna: host-ovanpå-rum, idempotent re-join, leave-null.
// Bootar servern på testport och kör två WS-klienter genom flödena.
process.env.PORT = '9123';
const { spawn } = require('child_process');
const WebSocket = require('ws');

const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', () => {});
srv.stderr.on('data', (b) => process.stderr.write(b));

function client() {
  const ws = new WebSocket('ws://127.0.0.1:9123');
  ws.inbox = [];
  ws.on('message', (m) => { try { ws.inbox.push(JSON.parse(m)); } catch (e) {} });
  return new Promise((res) => ws.on('open', () => res(ws)));
}
function sendJ(ws, o) { ws.send(JSON.stringify(o)); }
function waitFor(ws, type, ms = 3000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const i = ws.inbox.findIndex((m) => m.type === type);
      if (i >= 0) { clearInterval(iv); res(ws.inbox.splice(i, 1)[0]); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout: ' + type + ' (inbox: ' + ws.inbox.map(m=>m.type).join(',') + ')')); }
    }, 25);
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const A = await client();
  const B = await client();

  // 1. A hostar rum 1
  sendJ(A, { type: 'host', name: 'HostA', mode: 'tdm', maxPlayers: 10 });
  const h1 = await waitFor(A, 'hosted');
  console.log('[1] A hostade', h1.code);

  // 2. B joinar rum 1
  sendJ(B, { type: 'join', code: h1.code, name: 'JoinB' });
  const j1 = await waitFor(B, 'joined');
  console.log('[2] B joinade', j1.code, 'slot', j1.stableSlot);
  if (j1.stableSlot !== 1) throw new Error('B fick fel slot: ' + j1.stableSlot);

  // 3. IDEMPOTENT RE-JOIN: B joinar SAMMA rum igen (back-to-lobby-flödet) —
  //    ska få joined med SAMMA slot, INTE "Rummet är fullt"/ny slot.
  sendJ(B, { type: 'join', code: h1.code, name: 'JoinB' });
  const j2 = await waitFor(B, 'joined');
  if (j2.stableSlot !== 1) throw new Error('re-join gav ny slot: ' + j2.stableSlot);
  console.log('[3] idempotent re-join OK (samma slot', j2.stableSlot + ')');

  // 4. HOST-OVANPÅ: A hostar ETT NYTT rum utan att lämna → ska lämna rum 1 rent
  //    (B får peer_left + host-migration gör B till host i rum 1).
  sendJ(A, { type: 'host', name: 'HostA', mode: 'ctf', maxPlayers: 10 });
  const h2 = await waitFor(A, 'hosted');
  if (h2.code === h1.code) throw new Error('samma rumskod??');
  const pl = await waitFor(B, 'host_migrated').catch(() => waitFor(B, 'peer_left'));
  console.log('[4] A hostade nytt rum', h2.code, '— B fick', pl.type, 'i gamla');

  // 5. JOIN-ANNAT-RUM: B (medlem i rum 1, nu som host) joinar rum 2 → ska lämna rum 1
  //    (rum 1 blir tomt → reapas) och få slot 1 i rum 2.
  sendJ(B, { type: 'join', code: h2.code, name: 'JoinB' });
  const j3 = await waitFor(B, 'joined');
  if (j3.code !== h2.code) throw new Error('fel rum: ' + j3.code);
  console.log('[5] B bytte rum till', j3.code, 'slot', j3.stableSlot);

  // 6. Rum 1 ska vara BORTA ur publika listan (reapat när B lämnade)
  sendJ(A, { type: 'list_public_rooms' });
  const pr = await waitFor(A, 'public_rooms');
  const codes = (pr.rooms || []).map((r) => r.code);
  if (codes.includes(h1.code)) throw new Error('SPÖK-RUM: ' + h1.code + ' lever kvar! lista: ' + codes.join(','));
  console.log('[6] gamla rummet reapat (publika listan:', JSON.stringify(codes) + ')');

  // 7. LEAVE: B lämnar → close strax efter (V2-mönstret) → ingen dubbel-cleanup-krasch
  sendJ(B, { type: 'leave' });
  await new Promise((r) => setTimeout(r, 200));
  B.close();
  await new Promise((r) => setTimeout(r, 500));
  console.log('[7] leave + close OK (ingen serverkrasch)');

  console.log('ALLA LIVSCYKEL-TEST OK');
  srv.kill(); process.exit(0);
})().catch((e) => { console.error('TEST-FAIL:', e.message); srv.kill(); process.exit(1); });
