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

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const result = await page.evaluate((arenas) => {
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
  }, ARENAS);

  // tileable golv-tiles (returnerar en canvas)
  const tiles = await page.evaluate(() => {
    const out = {};
    try { if (typeof _getSurvFloorTile === 'function') { const cv = _getSurvFloorTile(); if (cv && cv.toDataURL) out['survivors_tile'] = cv.toDataURL(); } } catch (e) {}
    try { if (typeof _getBrFloorTile === 'function') { const cv = _getBrFloorTile(); if (cv && cv.toDataURL) out['br_tile'] = cv.toDataURL(); } } catch (e) {}
    return out;
  });
  Object.assign(result, tiles);

  let saved = 0;
  for (const [name, url] of Object.entries(result)) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png')) { console.log('SKIP', name, String(url).slice(0, 50)); continue; }
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
