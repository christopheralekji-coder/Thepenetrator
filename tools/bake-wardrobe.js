// DIFF-BAKAR V1:s garderob lager för lager i 3 GÅNG-FRAMES (idle/A/B) → animerade
// outfits. Skin = hel naken kropp (bas). Mascots (hel-kropp-dräkter) bakas separat
// som hela kroppar. node tools/bake-wardrobe.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'wardrobe');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const result = await page.evaluate(() => {
    save.wardrobeUnlockAll = true;
    const CW = 260, CH = 340, S = 6, OY = 168;
    const BASE = { skin: 'tan', hair: 'bald', shirt: 'naked', pants: 'none', bandana: 'none',
      glasses: 'none', hat: 'none', cape: 'none', shoes: 'none', facialHair: 'none',
      eyes: 'default', scars: 'none', nose: 'classic', eyeShape: 'classic', eyebrows: 'classic', mouth: 'classic' };
    const PHASES = [['', 0, false], ['_a', 1.2, true], ['_b', 4.4, true]];
    const slots = ['hair', 'shirt', 'pants', 'bandana', 'glasses', 'hat', 'cape', 'shoes', 'facialHair',
      'eyes', 'eyebrows', 'eyeShape', 'nose', 'mouth', 'scars'];

    function imgData(wardrobe, phase, moving, withArms) {
      save.wardrobe = Object.assign({}, BASE, wardrobe);
      ensureWardrobe();
      _costumeCache = null; _costumeCacheFrame = -999;
      const cos = getCurrentCostume();
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
      const ctx = cv.getContext('2d');
      ctx.save(); ctx.translate(CW / 2, OY); ctx.scale(S, S);
      try {
        if (withArms && !cos.mascot && typeof drawHangingArm === 'function') {
          // v2: ENDAST väst-armen (hängarmen). Kroppen bakas vänd öster — i spelet ritas
          // skjutarmen dynamiskt (roterar med aim) och hängarmen ska sitta på motsatt sida.
          // V1 in-game: facing east → drawHangingArm(facingLeft=false) = väst-arm.
          drawHangingArm(ctx, cos, false, false, 0, 0);
        }
        drawNakedBody(ctx, cos, false, phase, moving);
      } catch (e) {}
      ctx.restore();
      return ctx.getImageData(0, 0, CW, CH);
    }
    function toPNG(id) {
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
      cv.getContext('2d').putImageData(id, 0, 0);
      return cv.toDataURL();
    }
    function diff(base, variant) {
      const out = new ImageData(CW, CH);
      const b = base.data, v = variant.data, o = out.data;
      for (let i = 0; i < b.length; i += 4) {
        const cd = Math.abs(v[i] - b[i]) + Math.abs(v[i + 1] - b[i + 1]) + Math.abs(v[i + 2] - b[i + 2]);
        const ad = Math.abs(v[i + 3] - b[i + 3]);
        if (v[i + 3] > 6 && (b[i + 3] < 6 || cd > 26 || ad > 22)) {
          o[i] = v[i]; o[i + 1] = v[i + 1]; o[i + 2] = v[i + 2]; o[i + 3] = v[i + 3];
        }
      }
      return out;
    }

    const out = { meta: { CW, CH, OY, S, feetY: OY + 23 * S, frames: ['', '_a', '_b'] }, layers: {}, counts: {} };
    for (const [suf, ph, mv] of PHASES) {
      const baseImg = imgData({}, ph, mv, true);
      // SKIN = hel naken kropp (bas-lager)
      out.layers['skin'] = out.layers['skin'] || {};
      for (const opt of WARDROBE.skin) out.layers['skin'][opt.id + suf] = toPNG(imgData({ skin: opt.id }, ph, mv, true));
      // DIFF-lager
      for (const slot of slots) {
        if (!WARDROBE[slot]) continue;
        out.layers[slot] = out.layers[slot] || {};
        for (const opt of WARDROBE[slot]) {
          if (opt.mascot) continue;
          if (opt.id === BASE[slot] || opt.id === 'none' || opt.id === 'naked') continue;
          out.layers[slot][opt.id + suf] = toPNG(diff(baseImg, imgData({ [slot]: opt.id }, ph, mv, true)));
        }
      }
      // MASCOTS = hela kroppar (shirt med .mascot)
      out.layers['mascot'] = out.layers['mascot'] || {};
      for (const opt of WARDROBE.shirt) {
        if (!opt.mascot) continue;
        out.layers['mascot'][opt.id + suf] = toPNG(imgData({ shirt: opt.id }, ph, mv, false));
      }
    }
    for (const k in out.layers) out.counts[k] = Object.keys(out.layers[k]).length;
    return out;
  });

  let saved = 0;
  for (const [slot, opts] of Object.entries(result.layers)) {
    const dir = path.join(OUT, slot);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    for (const [id, dataUrl] of Object.entries(opts)) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) continue;
      fs.writeFileSync(path.join(dir, id + '.png'), Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
      saved++;
    }
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(result.meta, null, 1));
  console.log('counts:', JSON.stringify(result.counts));
  console.log('errs:', errs.slice(0, 4).join(' | '));
  console.log('SAVED', saved, 'layers ->', OUT);
  await browser.close();
})();
