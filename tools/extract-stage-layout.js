// Extraherar story-stagernas byggnader/dekor/collectibles (buildStageLayout per stage)
// till V2 + bakar varje unik byggnads-kind+storlek via drawBuildingItem.
// node tools/extract-stage-layout.js   (kräver http-server på 8799)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT_DATA = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'data');
const OUT_OBST = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'obstacles');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const layouts = await page.evaluate(() => {
    const out = {};
    for (let w = 1; w <= 9; w++) {
      const stage = getStage(w);
      if (!stage) continue;
      stageState.buildings = [];
      stageState.decorations = [];
      stageState.hazards = [];
      stageState.collectibles = [];
      try { buildStageLayout(stage); } catch (e) { out['err' + w] = e.message; continue; }
      out[w] = {
        buildings: stageState.buildings.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), kind: b.kind })),
        decorations: stageState.decorations.map(d => ({ x: Math.round(d.x), y: Math.round(d.y), kind: d.kind, r: d.r || 0 })),
        collectibles: stageState.collectibles.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), kind: c.kind, weaponId: c.weaponId || null, id: c.id })),
      };
    }
    return out;
  });
  fs.writeFileSync(path.join(OUT_DATA, 'stage_layouts.json'), JSON.stringify(layouts));
  let nb = 0, nd = 0;
  const kinds = {};
  for (const k of Object.keys(layouts)) {
    if (!layouts[k].buildings) continue;
    nb += layouts[k].buildings.length;
    nd += layouts[k].decorations.length;
    for (const b of layouts[k].buildings) kinds[`${b.kind}__${b.w}x${b.h}`] = b;
  }
  console.log('layouts:', Object.keys(layouts).join(','), 'buildings:', nb, 'decor:', nd, 'unika kinds:', Object.keys(kinds).length);

  // baka unika kinds (samma metod som bake-obstacles: drawBuildingItem + ctx-swap, PAD 34)
  const bakes = await page.evaluate((list) => {
    const out = {};
    const savedCtx = ctx;
    for (const b of list) {
      const PAD = 34;
      const cv = document.createElement('canvas');
      cv.width = b.w + PAD * 2; cv.height = b.h + PAD * 2;
      ctx = cv.getContext('2d');
      try {
        if (typeof Math.seedrandom === 'function') Math.seedrandom('7');
        drawBuildingItem({ x: PAD, y: PAD, w: b.w, h: b.h, kind: b.kind, seed: 7 }, 0, 0);
        out[`${b.kind}__${b.w}x${b.h}`] = cv.toDataURL();
      } catch (e) { out[`${b.kind}__${b.w}x${b.h}`] = 'ERR:' + e.message; }
      ctx = savedCtx;
    }
    return out;
  }, Object.values(kinds));
  let saved = 0, skipped = [];
  for (const [k, v] of Object.entries(bakes)) {
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { skipped.push(k + '=' + String(v).slice(0, 40)); continue; }
    fs.writeFileSync(path.join(OUT_OBST, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('SAVED', saved, 'bakes; skipped:', skipped.slice(0, 6).join(' | '));
  await browser.close();
})();
