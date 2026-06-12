// Bakar V1:s IN-GAME-vapenritningar (drawPlayerWeapon — det spelaren håller i handen,
// inte meny-ikonerna) till PNG-sprites för V2. Ritas i vapen-lokal frame (origin =
// axel + 5px längs aim, +x = aim-riktning) @6x. Idle-frame (ingen muzzle/slash-anim).
//   node tools/bake-weapons-inplay.js   (kräver http://localhost:8799 i V1-dir)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'weapons_inplay');
// Canvas-extents i V1-px (vapen-lokal frame): x -6..64, y -20..20. Origin på canvas:
const X0 = -6, X1 = 64, Y0 = -20, Y1 = 20, S = 6;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const out = await page.evaluate(({ X0, X1, Y0, Y1, S }) => {
    const res = { _meta: { x0: X0, y0: Y0, scale: S, w: (X1 - X0) * S, h: (Y1 - Y0) * S } };
    const savedCtx = ctx;
    const ids = WEAPONS.map((w) => w.id);
    for (const id of ids) {
      try {
        const w = (typeof getWeapon === 'function') ? getWeapon(id) : W_BY_ID[id];
        if (!w) { res[id] = 'ERR:no-weapon'; continue; }
        const cv = document.createElement('canvas');
        cv.width = (X1 - X0) * S; cv.height = (Y1 - Y0) * S;
        ctx = cv.getContext('2d');
        ctx.save();
        ctx.translate(-X0 * S, -Y0 * S);
        ctx.scale(S, S);
        // mock-player: r=14 (V1-standard), inget nyligt skott (idle, ingen flash/slash)
        const mockP = { r: 14, lastShot: -100000, weaponId: id, aimAngle: 0, x: 0, y: 0 };
        drawPlayerWeapon(mockP, w, false, 0);
        ctx.restore();
        res[id] = cv.toDataURL();
      } catch (e) { res[id] = 'ERR:' + (e && e.message); }
      ctx = savedCtx;
    }
    return res;
  }, { X0, X1, Y0, Y1, S });

  let saved = 0;
  const failed = [];
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { failed.push(k + '=' + String(v).slice(0, 60)); continue; }
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(out._meta));
  console.log('FAILED:', failed.join(' | ') || '(inga)');
  console.log('pageerrors:', errs.slice(0, 4).join(' | ') || '(inga)');
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
