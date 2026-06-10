const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, 'ward-debug');
(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 140)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    save.wardrobeUnlockAll = true;
    const CW = 260, CH = 340, S = 6, OY = 168;
    const BASE = { skin: 'tan', hair: 'bald', shirt: 'naked', pants: 'jeans', bandana: 'none', glasses: 'none', hat: 'none', cape: 'none', shoes: 'none', facialHair: 'none', eyes: 'default', scars: 'none' };
    function render(wardrobe) {
      save.wardrobe = Object.assign({}, BASE, wardrobe);
      ensureWardrobe();
      _costumeCache = null; _costumeCacheFrame = -999;
      const cos = getCurrentCostume();
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
      const ctx = cv.getContext('2d');
      ctx.save(); ctx.translate(CW / 2, OY); ctx.scale(S, S);
      if (typeof drawHangingArm === 'function') { drawHangingArm(ctx, cos, false, true, 0, 0); drawHangingArm(ctx, cos, false, false, 0, 0); }
      drawNakedBody(ctx, cos, false, 0, false);
      ctx.restore();
      return { png: cv.toDataURL(), hairStyle: cos.hairStyle, hairColor: cos.hairColor, shirt: cos.shirt, wardHair: save.wardrobe.hair };
    }
    return { base: render({}), blonde: render({ hair: 'longBlonde' }), shirtv: render({ shirt: 'supreme_box' }) };
  });
  for (const k of ['base', 'blonde', 'shirtv']) {
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(r[k].png.replace(/^data:image\/png;base64,/, ''), 'base64'));
  }
  console.log('base:', JSON.stringify({ hairStyle: r.base.hairStyle, wardHair: r.base.wardHair }));
  console.log('blonde:', JSON.stringify({ hairStyle: r.blonde.hairStyle, hairColor: r.blonde.hairColor, wardHair: r.blonde.wardHair }));
  console.log('shirtv:', JSON.stringify({ shirt: r.shirtv.shirt }));
  await browser.close();
})();
