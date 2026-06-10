#!/usr/bin/env node
// net-proxy.js — WS-latensproxy för V2:s fjärr-smoothness-mätning.
//
// Lyssnar på --listen (default 8113) och vidarebefordrar varje WS-anslutning
// till --target (default ws://127.0.0.1:8112) med konfigurerbar artificiell
// fördröjning + jitter + drop på SERVER→KLIENT-paketen (snapshot-vägen som
// styr fjärr-rendering). Klient→server vidarebefordras ofördröjt.
//
//   node tools/net-proxy.js --listen 8113 --target ws://127.0.0.1:8112 \
//        --delay 80 --jitter 20 --drop 0 --inject-st
//
//   --delay N      grund-fördröjning ms (server→klient)
//   --jitter N     ± uniform jitter ms per paket
//   --drop P       sannolikhet 0..1 att DROPPA ett world-paket (bara world —
//                  kontrollpaket som hosted/joined får aldrig droppas)
//   --inject-st    TEST: stämpla st=Date.now() i world/server_pong-JSON vid
//                  MOTTAG från servern (innan fördröjningen) — simulerar
//                  server-agentens st-fält med korrekt semantik (stämpeln är
//                  "gammal" när paketet når klienten). Behövs ej när servern
//                  redan skickar st (room-sim.js pkt.st).
//   --synth        TEST: injicera en syntetisk fiende (i=9999, "grunt") som rör
//                  sig i PERFEKT cirkel med konstant 150 px/s, position beräknad
//                  ur paketets st → ground-truth-hastighetsvarians = 0. All
//                  uppmätt varians i klienten = ren render-stutter. (V2:s
//                  netmetric-läge låser på just i=9999.)
//
// FIFO BEVARAS (TCP omordnar aldrig): varje riktnings release-tid är
// max(now + delay + jitter, förra release-tiden) → jitter blir varierande
// kö-fördröjning, inte omkastade paket.
//
// Binära paket (V1-webbens world-format) passerar orörda — proxyn funkar för
// både V1- och V2-klienter.

'use strict';
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const args = process.argv.slice(2);
function argNum(name, def) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return def;
  const v = parseFloat(args[i + 1]);
  return Number.isFinite(v) ? v : def;
}
function argStr(name, def) {
  const i = args.indexOf(name);
  return (i >= 0 && i + 1 < args.length) ? args[i + 1] : def;
}
const LISTEN = argNum('--listen', 8113);
const TARGET = argStr('--target', 'ws://127.0.0.1:8112');
const DELAY = argNum('--delay', 0);
const JITTER = argNum('--jitter', 0);
const DROP = argNum('--drop', 0);
const INJECT_ST = args.includes('--inject-st');
const SYNTH = args.includes('--synth');
// syntetisk cirkel: radie 300px, vinkelhastighet 0.5 rad/s → konstant 150 px/s
const SY_CX = 1000, SY_CY = 1400, SY_R = 300, SY_W = 0.5;

console.log(`[net-proxy] :${LISTEN} -> ${TARGET}  delay=${DELAY}ms jitter=±${JITTER}ms drop=${DROP} inject-st=${INJECT_ST} synth=${SYNTH}`);

// FIFO-bevarande fördröjd sändare (en per riktning per anslutning)
function mkDelayedSender(sendFn) {
  let lastAt = 0;
  return (data, isBinary, delayMs) => {
    const at = Math.max(Date.now() + Math.max(0, delayMs), lastAt);
    lastAt = at;
    const wait = Math.max(0, at - Date.now());
    if (wait === 0) { try { sendFn(data, isBinary); } catch (e) {} return; }
    setTimeout(() => { try { sendFn(data, isBinary); } catch (e) {} }, wait);
  };
}

const srv = new WebSocket.Server({ port: LISTEN });
let connNo = 0;

srv.on('connection', (client) => {
  const id = ++connNo;
  const up = new WebSocket(TARGET);
  const pendingToServer = [];   // klient-paket som anlände innan upstream öppnat
  let upOpen = false;

  const sendToClient = mkDelayedSender((d, bin) => {
    if (client.readyState === WebSocket.OPEN) client.send(d, { binary: bin });
  });
  const sendToServer = (d, bin) => {
    if (up.readyState === WebSocket.OPEN) { try { up.send(d, { binary: bin }); } catch (e) {} }
  };

  console.log(`[net-proxy] #${id} klient ansluten`);

  up.on('open', () => {
    upOpen = true;
    for (const [d, bin] of pendingToServer.splice(0)) sendToServer(d, bin);
  });

  // klient → server: ofördröjt (input-vägen ska vara ren; RTT genom proxyn
  // blir då = bas-RTT + delay+jitter på nedvägen, vilket är det som mäts)
  client.on('message', (data, isBinary) => {
    if (!upOpen) { pendingToServer.push([data, isBinary]); return; }
    sendToServer(data, isBinary);
  });

  // server → klient: inject-st + drop + fördröjning med bevarad ordning
  up.on('message', (data, isBinary) => {
    let out = data;
    let isWorld = false;
    if (!isBinary && (INJECT_ST || DROP > 0 || SYNTH)) {
      const txt = data.toString('utf8');
      // billig pre-check innan JSON.parse (world @30Hz + events varje tick)
      if (txt.startsWith('{') && (txt.includes('"world"') || txt.includes('"server_pong"'))) {
        try {
          const obj = JSON.parse(txt);
          if (obj && obj.type === 'world') {
            isWorld = true;
            let dirty = false;
            if (INJECT_ST) { obj.st = Date.now(); dirty = true; }
            if (SYNTH) {
              // position ur paketets EGEN st (server-stämpel eller injicerad) →
              // (t, pos)-paret är exakt; klientens render av i=9999 ska bli en
              // perfekt cirkel — all uppmätt hastighetsvarians = render-stutter
              const ts = (typeof obj.st === 'number' ? obj.st : Date.now()) * 0.001;
              obj.enemies = obj.enemies || [];
              obj.enemies.push({
                i: 9999,
                x: Math.round(SY_CX + SY_R * Math.cos(ts * SY_W)),
                y: Math.round(SY_CY + SY_R * Math.sin(ts * SY_W)),
                hp: 100, mh: 100, t: 'grunt', b: 0, mb: 0, bk: '', r: 16,
                c: '#8888ff', n: '', fx: 0, g: 0,
              });
              dirty = true;
            }
            if (dirty) out = JSON.stringify(obj);
          } else if (obj && obj.type === 'server_pong' && INJECT_ST) {
            obj.st = Date.now();
            out = JSON.stringify(obj);
          }
        } catch (e) { /* icke-JSON text — vidarebefordra orört */ }
      }
    }
    if (isWorld && DROP > 0 && Math.random() < DROP) return;   // simulerad paketförlust
    const d = DELAY + (JITTER > 0 ? (Math.random() * 2 - 1) * JITTER : 0);
    sendToClient(out, isBinary, d);
  });

  const closeBoth = () => {
    try { client.close(); } catch (e) {}
    try { up.close(); } catch (e) {}
  };
  client.on('close', () => { console.log(`[net-proxy] #${id} klient stängde`); closeBoth(); });
  up.on('close', () => { console.log(`[net-proxy] #${id} server stängde`); closeBoth(); });
  client.on('error', closeBoth);
  up.on('error', (e) => { console.log(`[net-proxy] #${id} upstream-fel: ${e.message}`); closeBoth(); });
});

srv.on('listening', () => console.log(`[net-proxy] lyssnar på :${LISTEN}`));
