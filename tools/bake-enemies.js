// Bakar V1:s RIKTIGA fiende-sprites (drawHumanEnemy via _bakeEnemyTexture) till PNG.
//   node tools/bake-enemies.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000); // PIXI måste hinna laddas (bake kräver det)

  const out = await page.evaluate(() => {
    const list = [
      { key: 'enemy_grunt', type: 'grunt', r: 22, color: '#4a5a30' },
      { key: 'enemy_runner', type: 'runner', r: 18, color: '#5a4a30' },
      { key: 'enemy_brute', type: 'brute', r: 28, color: '#6a4030' },
      { key: 'enemy_soldier', type: 'soldier', r: 20, color: '#5a8a3a' },
      { key: 'enemy_ninja', type: 'ninja', r: 18, color: '#1a1a2a' },
    ];
    const res = { _hasPixi: typeof PIXI !== 'undefined', _meta: {} };
    for (const it of list) {
      try {
        const cv = _bakeEnemyTexture(it.type, { r: it.r, color: it.color, walkPhase: 0.6 });
        if (!cv) { res[it.key] = 'ERR:null(pixi?)'; continue; }
        res[it.key] = cv.toDataURL();
        res._meta[it.key] = { w: cv.width, h: cv.height, r: it.r };
      } catch (e) { res[it.key] = 'ERR:' + (e && e.message); }
    }
    return res;
  });

  let saved = 0;
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { console.log('SKIP', k, String(v).slice(0, 70)); continue; }
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('hasPixi:', out._hasPixi, 'meta:', JSON.stringify(out._meta));
  console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
