// Renderar V1:s RIKTIGA spelar-gubbe (garderob-preview) i flera outfits + naken,
// och sparar PNG så vi ser exakt vad V2 ska matcha.
//   node tools/render-character.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, 'char-ref');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const looks = await page.evaluate(() => {
    const results = {};
    function renderLook(w) {
      try {
        if (w === null) {
          ensureWardrobe(); // default out-of-box
        } else {
          save.wardrobe = Object.assign({}, w);
          ensureWardrobe();
        }
        if (typeof invalidateCostumeCache === 'function') invalidateCostumeCache();
        _costumeCache = null; _costumeCacheFrame = -999;
        _wardrobeRotation = 0; _wardrobeAutoSpin = false; _wardrobeDragging = false;
        _wardrobeAnimStart = performance.now();
        const cv = document.getElementById('wardrobe-preview');
        if (!cv) return 'ERR:no-canvas';
        cv.width = 600; cv.height = 760;
        drawWardrobePreviewV2();
        return cv.toDataURL();
      } catch (e) { return 'ERR:' + (e && e.message); }
    }
    results.default = renderLook(null);
    results.naked = renderLook({ skin: 'tan', hair: 'shortDark', shirt: 'none', pants: 'none', bandana: 'none', shoes: 'none', glasses: 'none', hat: 'none', cape: 'none' });
    results.classic_hero = renderLook({ skin: 'tan', hair: 'shortDark', shirt: 'black', pants: 'khaki', bandana: 'red' });
    results.soldier = renderLook({ skin: 'olive', hair: 'shortDark', shirt: 'tactical', pants: 'tactical', bandana: 'green' });
    results.cyber_punk = renderLook({ skin: 'pink', hair: 'mohawkPink', shirt: 'cyber', pants: 'black', bandana: 'pink' });
    results.demon = renderLook({ skin: 'red', hair: 'mohawkBlack', shirt: 'crimson', pants: 'black', bandana: 'red' });
    return results;
  });

  let saved = 0;
  for (const [k, v] of Object.entries(looks)) {
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { console.log('SKIP', k, String(v).slice(0, 70)); continue; }
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
