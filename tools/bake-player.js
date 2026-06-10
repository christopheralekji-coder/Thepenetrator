// Bakar V1:s RIKTIGA spelar-karaktär (procedurell vektor, default-outfit) till PNG
// för Godot-V2 — ren komposition (cape + armar + drawNakedBody), UTAN mark/rim/UI,
// transparent bakgrund, 3 frames (idle/walkA/walkB).  node tools/bake-player.js
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
  await page.waitForTimeout(3500);

  const out = await page.evaluate(() => {
    const S = 6, CW = 260, CH = 340, ORIGIN_Y = 168; // fötter ≈ y 306
    ensureWardrobe();
    _costumeCache = null; _costumeCacheFrame = -999;
    const cos = getCurrentCostume();
    function bake(phase, moving) {
      try {
        const cv = document.createElement('canvas');
        cv.width = CW; cv.height = CH;
        const c = cv.getContext('2d');
        c.save();
        c.translate(CW / 2, ORIGIN_Y);
        c.scale(S, S);
        const flash = false;
        if (cos.cape && cos.cape.style && cos.cape.style !== 'none')
          drawCapeOnUprightBody(c, cos.cape.style, cos.cape.color, flash, 0, moving);
        drawHangingArm(c, cos, flash, true, 0, 0);
        drawHangingArm(c, cos, flash, false, 0, 0);
        drawNakedBody(c, cos, flash, phase, moving);
        c.restore();
        return cv.toDataURL();
      } catch (e) { return 'ERR:' + (e && e.message); }
    }
    return {
      player_idle: bake(0, false),
      player_walk_a: bake(1.2, true),
      player_walk_b: bake(4.4, true),
      _feetY: ORIGIN_Y + 23 * S, _w: CW, _h: CH,
    };
  });

  let saved = 0;
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { console.log('SKIP', k, String(v).slice(0, 70)); continue; }
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('meta:', JSON.stringify({ feetY: out._feetY, w: out._w, h: out._h }));
  console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
