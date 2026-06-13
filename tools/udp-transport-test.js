'use strict';
// Självtest för server/net/udp-transport.js — kör server+klient över localhost
// med simulerad paketförlust (20% BÅDA riktningar) och verifierar:
//   A. RELIABLE: 120 meddelanden (flera fragmenterade, ett 64KB) → ALLA mottagna,
//      I ORDNING, byte-exakta.
//   B. UNRELIABLE: 60 world-paket (några fragmenterade) → newest-wins (aldrig en
//      äldre seq efter en nyare) + minst några levererade.
//   node tools/udp-transport-test.js
const { UdpServer, UdpClient, MAX_PAYLOAD } = require('../server/net/udp-transport');

const PORT = 8101 + Math.floor((parseFloat(process.argv[2]) || 0.20) * 100);
const LOSS = parseFloat(process.argv[2]) || 0.20;
const N_REL = 120;
const BIG_AT = N_REL - 1;           // sista meddelandet = 64KB
const N_UNREL = 60;

// deterministiskt innehåll så mottagaren kan verifiera integritet utan att veta storlek
function makeMsg(tag, i, size) {
  const b = Buffer.alloc(size);
  const head = `${tag}:${i}:`;
  b.write(head, 0, 'latin1');
  for (let k = head.length; k < size; k++) b[k] = (i + k) & 0xff;
  return b;
}
function relSize(i) {
  if (i === BIG_AT) return 64 * 1024;           // tvinga ~60 fragment
  if (i % 17 === 0) return MAX_PAYLOAD * 2 + 50; // ibland 3 fragment
  return 40;
}
function verify(buf, tag) {
  const s = buf.toString('latin1', 0, 24);
  const m = s.match(new RegExp('^' + tag + ':(\\d+):'));
  if (!m) return { ok: false, i: -1, why: 'ingen header' };
  const i = parseInt(m[1], 10);
  const head = m[0].length;
  for (let k = head; k < buf.length; k++) {
    if (buf[k] !== ((i + k) & 0xff)) return { ok: false, i, why: 'filler-mismatch @' + k };
  }
  return { ok: true, i };
}

const fails = [];
const relGot = [];      // i-ordning mottagna reliable
const unrelGot = [];    // seq-ordning mottagna unreliable

const server = new UdpServer({ port: PORT, lossSim: LOSS });
server.on('listening', () => {
  const client = new UdpClient({ host: '127.0.0.1', port: PORT, lossSim: LOSS });

  server.on('connection', (peer) => {
    // ws-yta-sanity
    if (peer.readyState !== 1) fails.push('peer.readyState != 1 vid connect');
    if (typeof peer.bufferedAmount !== 'number') fails.push('peer.bufferedAmount ej number');
    peer.on('message', (buf) => {
      const r = verify(buf, 'R');
      if (!r.ok) fails.push('RELIABLE korrupt: ' + r.why);
      else relGot.push(r.i);
    });
    // börja spruta unreliable world-paket (några fragmenterade) snabbt
    let s = 0;
    const iv = setInterval(() => {
      if (s >= N_UNREL || peer.closed) { clearInterval(iv); return; }
      const size = (s % 13 === 0) ? MAX_PAYLOAD * 2 + 7 : 60;  // ibland 2 fragment
      peer.sendUnreliable(makeMsg('U', s, size));
      s++;
    }, 18);
  });

  client.on('connect', () => {
    // skicka alla reliable direkt (de buffras + ack:as + resänds vid förlust)
    for (let i = 0; i < N_REL; i++) client.send(makeMsg('R', i, relSize(i)));
  });
  client.on('message', (buf) => {
    const r = verify(buf, 'U');
    if (!r.ok) fails.push('UNRELIABLE korrupt: ' + r.why);
    else unrelGot.push(r.i);
  });

  // utvärdera efter att resends hunnit konvergera
  setTimeout(() => {
    // A. reliable: exakt 0..N_REL-1 i ordning
    let relOk = relGot.length === N_REL;
    for (let i = 0; i < relGot.length; i++) if (relGot[i] !== i) { relOk = false; break; }
    if (!relOk) fails.push(`RELIABLE: fick ${relGot.length}/${N_REL}, ordning bruten? första fel @${relGot.findIndex((v,i)=>v!==i)}`);

    // B. unreliable: strikt växande (newest-wins) + minst några
    let unrelOk = unrelGot.length > 0;
    for (let i = 1; i < unrelGot.length; i++) if (unrelGot[i] <= unrelGot[i - 1]) { unrelOk = false; break; }
    if (!unrelOk) fails.push(`UNRELIABLE: ${unrelGot.length} mottagna, monotont? nej`);

    console.log(`[TEST] loss=${LOSS*100}% båda håll`);
    console.log(`[TEST] RELIABLE  : ${relGot.length}/${N_REL} i ordning (inkl 64KB-frag) -> ${relOk ? 'OK' : 'FAIL'}`);
    console.log(`[TEST] UNRELIABLE: ${unrelGot.length}/${N_UNREL} levererade, newest-wins -> ${unrelOk ? 'OK' : 'FAIL'} (seq: ${unrelGot.slice(0,12).join(',')}${unrelGot.length>12?'…':''})`);

    client.close(); server.close();
    if (fails.length) { console.error('[TEST] ❌ MISSLYCKADES:\n  ' + fails.join('\n  ')); process.exit(1); }
    console.log('[TEST] ✅ ALLT GRÖNT — reliable in-order+fragmentering+resend OK, unreliable newest-wins OK');
    process.exit(0);
  }, 7000);
});
server.on('error', (e) => { console.error('[TEST] server-fel', e); process.exit(1); });
