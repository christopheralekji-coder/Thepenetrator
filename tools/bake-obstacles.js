// Bakar V1:s arena-hinder (varje unik kind+storlek) som transparenta PNG via
// drawBuildingItem (ctx-swap). node tools/bake-obstacles.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DATA = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'data', 'arenas');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'obstacles');
const PAD = 34;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const kinds = JSON.parse(fs.readFileSync(path.join(DATA, '_kinds.json'), 'utf8'));
  const list = Object.keys(kinds).map(k => {
    const [kind, wh] = k.split('|');
    const [w, h] = wh.split('x').map(Number);
    return { kind, w, h, key: kind + '__' + w + 'x' + h };
  });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const result = await page.evaluate((args) => {
    const list = args.list, PAD = args.PAD;
    const out = {};
    const savedCtx = ctx;
    for (const it of list) {
      try {
        const cw = it.w + PAD * 2, ch = it.h + PAD * 2;
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const octx = cv.getContext('2d');
        ctx = octx;
        const mock = { x: 0, y: 0, w: it.w, h: it.h, kind: it.kind, seed: 7,
          cx: it.w / 2, cy: it.h / 2, size: Math.max(it.w, it.h) / 60 };
        try { drawBuildingItem(mock, -PAD, -PAD); } catch (e) {}
        ctx = savedCtx;
        out[it.key] = cv.toDataURL();
      } catch (e) { ctx = savedCtx; out[it.key] = 'ERR:' + (e && e.message); }
    }
    return out;
  }, { list, PAD });

  let saved = 0;
  for (const [key, url] of Object.entries(result)) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png')) continue;
    fs.writeFileSync(path.join(OUT, key + '.png'), Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify({ pad: PAD }, null, 1));
  console.log('errs:', errs.slice(0, 4).join(' | '));
  console.log('SAVED', saved, '/', list.length, '->', OUT);
  await browser.close();
})();
