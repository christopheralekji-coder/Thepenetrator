// Bakar V1:s arena-GOLV (per arena) som världs-texturer. node tools/bake-floors.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'floors');

// arena → {fn: golv-funktion, w, h, setup: körs före (sätter state), call: anrops-uttryck}
const ARENAS = [
  { name: 'tdm', fn: 'drawTdmArenaFloor', w: 1700, h: 2000 },
  { name: 'ctf', fn: 'drawCtfArenaFloor', w: 4500, h: 2800 },
  // heist: regions-golvet kräver state.heistArena (färger) + viewW=världen (culling)
  { name: 'heist', fn: 'drawHeistArenaGround', w: 4000, h: 4000,
    setup: 'state.heistArena = HEIST_ARENA; ',
    call: 'drawHeistArenaGround()' },
  // jugg: stage-kind-golv med (stage,cx,cy)-signatur
  { name: 'jugg', fn: 'drawJuggernautGround', w: 5000, h: 3500,
    call: 'drawJuggernautGround({worldW:5000,worldH:3500}, 0, 0)' },
];

// --tiles-only: hoppa arena-golven, baka bara tile-golven (survivors/br)
const TILES_ONLY = process.argv.includes('--tiles-only');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const result = await page.evaluate((arenas) => {
    if (!arenas.length) return {};
    const out = {};
    const savedCtx = ctx;
    const savedVW = viewW, savedVH = viewH;
    for (const a of arenas) {
      try {
        if (typeof window[a.fn] !== 'function' && typeof eval(a.fn) !== 'function') { out[a.name] = 'ERR:no-fn'; continue; }
        if (typeof WORLD !== 'undefined') { WORLD.w = a.w; WORLD.h = a.h; }
        if (typeof state !== 'undefined') { state.camera = { x: 0, y: 0 }; }
        // golv-fn:erna cullar mot viewW/viewH → sätt = världen så HELA golvet bakas
        viewW = a.w; viewH = a.h;
        if (a.setup) { try { eval(a.setup); } catch (e) { out[a.name] = 'ERR:setup:' + e.message; continue; } }
        const cv = document.createElement('canvas'); cv.width = a.w; cv.height = a.h;
        ctx = cv.getContext('2d');
        try { eval(a.call || (a.fn + '()')); } catch (e) { out[a.name] = 'ERR:' + e.message; ctx = savedCtx; continue; }
        ctx = savedCtx;
        out[a.name] = cv.toDataURL();
      } catch (e) { ctx = savedCtx; out[a.name] = 'ERR:' + (e && e.message); }
    }
    viewW = savedVW; viewH = savedVH;
    return out;
  }, TILES_ONLY ? [] : ARENAS);

  // tileable golv-tiles (returnerar en canvas).
  // F1 (V2): survivors-tilen efterbehandlas med ett detalj-pass — tonvariations-
  // fläckar, sprickor, gräs-tufts, stenkluster, grus-speckles. Allt seedat
  // (deterministiskt) + ritat med 3×3-wrap → tilen förblir sömlös.
  const tiles = await page.evaluate(() => {
    const out = {};
    function decorateSurv(src) {
      const T = src.width;
      const c = document.createElement('canvas'); c.width = T; c.height = T;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0);
      // mulberry32 — deterministisk seed (re-bakes ger identisk tile)
      let s = 0x5EEDF1; const rnd = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const R = (a, b) => a + rnd() * (b - a);
      // wrap-hjälpare: rita featuren 3×3 (canvas klipper) → sömlös tile
      const wrap = (fn) => { for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) fn(ox, oy); };

      // 1) STORA TONVARIATIONS-FLÄCKAR (mossa-grönt / varm jord / ask-grått)
      const tones = [[46, 58, 30], [66, 48, 30], [56, 54, 50]];
      for (let i = 0; i < 16; i++) {
        const x = R(0, T), y = R(0, T), r = R(180, 420);
        const tc = tones[i % 3], a = R(0.07, 0.13);
        wrap((ox, oy) => {
          const gr = g.createRadialGradient(x + ox, y + oy, r * 0.15, x + ox, y + oy, r);
          gr.addColorStop(0, `rgba(${tc[0]},${tc[1]},${tc[2]},${a.toFixed(3)})`);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
        });
      }

      // 2) SPRICKOR — taggiga polylines m. svag ljuskant (djup-känsla)
      for (let i = 0; i < 24; i++) {
        const segs = 4 + (rnd() * 5 | 0);
        const pts = [[R(0, T), R(0, T)]];
        let ang = R(0, Math.PI * 2);
        for (let sgi = 0; sgi < segs; sgi++) {
          ang += R(-0.7, 0.7);
          const len = R(18, 48);
          const lp = pts[pts.length - 1];
          pts.push([lp[0] + Math.cos(ang) * len, lp[1] + Math.sin(ang) * len]);
        }
        wrap((ox, oy) => {
          // ljuskant (offset ner-höger) först, mörka sprickan över
          for (const [dx, dy, st, lw] of [
            [1.4, 1.4, 'rgba(125,105,80,0.10)', 2.6],
            [0, 0, 'rgba(7,4,2,0.5)', 2.0],
          ]) {
            g.strokeStyle = st; g.lineWidth = lw; g.lineCap = 'round';
            g.beginPath();
            g.moveTo(pts[0][0] + ox + dx, pts[0][1] + oy + dy);
            for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0] + ox + dx, pts[k][1] + oy + dy);
            g.stroke();
          }
        });
        // kort sidogren
        if (rnd() < 0.6) {
          const bi = 1 + (rnd() * (pts.length - 2) | 0);
          const ba = R(0, Math.PI * 2), bl = R(10, 26);
          wrap((ox, oy) => {
            g.strokeStyle = 'rgba(7,4,2,0.4)'; g.lineWidth = 1.4;
            g.beginPath();
            g.moveTo(pts[bi][0] + ox, pts[bi][1] + oy);
            g.lineTo(pts[bi][0] + Math.cos(ba) * bl + ox, pts[bi][1] + Math.sin(ba) * bl + oy);
            g.stroke();
          });
        }
      }

      // 3) GRUS-SPECKLES (små ljusa korn)
      for (let i = 0; i < 520; i++) {
        const x = R(0, T), y = R(0, T), r = R(0.7, 1.9), a = R(0.08, 0.2);
        wrap((ox, oy) => {
          g.fillStyle = `rgba(112,97,75,${a.toFixed(3)})`;
          g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
        });
      }

      // 4) STENKLUSTER (2-4 stenar m. skugga + topp-highlight)
      for (let i = 0; i < 34; i++) {
        const cx = R(0, T), cy = R(0, T), n = 2 + (rnd() * 3 | 0);
        const stones = [];
        for (let k = 0; k < n; k++) stones.push([cx + R(-14, 14), cy + R(-10, 10), R(2.5, 7), R(-0.18, 0.14)]);
        wrap((ox, oy) => {
          for (const [sx, sy, sr, tone] of stones) {
            // mark-skugga
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.beginPath(); g.ellipse(sx + ox + 1.2, sy + oy + sr * 0.55, sr * 1.1, sr * 0.55, 0, 0, Math.PI * 2); g.fill();
            // kropp
            const v = (b) => Math.max(0, Math.min(255, Math.round(b * (1 + tone))));
            g.fillStyle = `rgb(${v(86)},${v(77)},${v(63)})`;
            g.beginPath(); g.arc(sx + ox, sy + oy, sr, 0, Math.PI * 2); g.fill();
            // kontur + highlight
            g.strokeStyle = 'rgba(22,16,11,0.7)'; g.lineWidth = 1;
            g.beginPath(); g.arc(sx + ox, sy + oy, sr, 0, Math.PI * 2); g.stroke();
            g.strokeStyle = 'rgba(150,136,112,0.55)'; g.lineWidth = 1.1;
            g.beginPath(); g.arc(sx + ox - sr * 0.18, sy + oy - sr * 0.2, sr * 0.62, Math.PI * 0.95, Math.PI * 1.75); g.stroke();
          }
        });
      }

      // 5) GRÄS-TUFTS (5-7 böjda strån i två gröna toner + mörk bas)
      for (let i = 0; i < 110; i++) {
        const bx = R(0, T), by = R(0, T), blades = 5 + (rnd() * 3 | 0);
        const bl = [];
        for (let k = 0; k < blades; k++) {
          bl.push([R(-5, 5), R(8, 15), R(-6, 6), rnd() < 0.5]);  // [rot-x, höjd, böj, ton]
        }
        wrap((ox, oy) => {
          g.fillStyle = 'rgba(0,0,0,0.16)';
          g.beginPath(); g.ellipse(bx + ox, by + oy + 1.5, 6.5, 2.2, 0, 0, Math.PI * 2); g.fill();
          g.lineCap = 'round';
          for (const [rx, h, bend, dark] of bl) {
            g.strokeStyle = dark ? 'rgba(46,62,30,0.85)' : 'rgba(66,86,42,0.8)';
            g.lineWidth = 1.3;
            g.beginPath();
            g.moveTo(bx + rx + ox, by + oy);
            g.quadraticCurveTo(bx + rx + bend * 0.4 + ox, by - h * 0.6 + oy, bx + rx + bend + ox, by - h + oy);
            g.stroke();
          }
        });
      }
      return c;
    }
    try {
      if (typeof _getSurvFloorTile === 'function') {
        const cv = _getSurvFloorTile();
        if (cv && cv.toDataURL) out['survivors_tile'] = decorateSurv(cv).toDataURL();
      }
    } catch (e) { out['survivors_tile'] = 'ERR:' + (e && e.message); }
    try { if (typeof _getBrFloorTile === 'function') { const cv = _getBrFloorTile(); if (cv && cv.toDataURL) out['br_tile'] = cv.toDataURL(); } } catch (e) {}
    return out;
  });
  Object.assign(result, tiles);

  let saved = 0;
  // --tiles-only riktar F1: rör BARA survivors-tilen (br-tilen kan ha icke-seedad
  // slump i bake-fn → skriv inte om den i onödan)
  if (TILES_ONLY) { for (const k of Object.keys(result)) { if (k !== 'survivors_tile') delete result[k]; } }
  for (const [name, url] of Object.entries(result)) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png')) { console.log('SKIP', name, String(url).slice(0, 50)); continue; }
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
