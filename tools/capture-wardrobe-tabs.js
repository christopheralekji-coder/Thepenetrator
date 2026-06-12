// Dumpar V1:s garderob i 844x390 — OUTFITS / KROPP / KLÄDER + element-enumeration.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, 'wardrobe-ref');
(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('[ERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.evaluate(() => { const b = document.getElementById('btn-wardrobe'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'tab-outfits.png') });

  const enumEls = async () => page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#wardrobe-screen button, #wardrobe-screen canvas, #wardrobe-screen .ward-card, #wardrobe-screen .ward-slot, #wardrobe-screen h2, #wardrobe-screen .menu-sub, #wardrobe-screen .ward-slot-label')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || r.width < 4) continue;
      out.push({ tag: el.tagName.toLowerCase(), id: el.id, cls: (el.className || '').toString().slice(0, 30), txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), fs: cs.fontSize, bg: cs.backgroundColor });
    }
    return out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  });
  const elsOutfits = await enumEls();
  fs.writeFileSync(path.join(OUT, 'els-outfits.json'), JSON.stringify(elsOutfits, null, 1));

  // KROPP
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('#wardrobe-tabs .ward-group-btn')) {
      if (b.textContent.includes('KROPP')) b.click();
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'tab-kropp.png') });
  const elsKropp = await enumEls();
  fs.writeFileSync(path.join(OUT, 'els-kropp.json'), JSON.stringify(elsKropp, null, 1));

  // KLÄDER
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('#wardrobe-tabs .ward-group-btn')) {
      if (b.textContent.includes('KLÄDER')) b.click();
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'tab-klader.png') });
  const elsKlader = await enumEls();
  fs.writeFileSync(path.join(OUT, 'els-klader.json'), JSON.stringify(elsKlader, null, 1));

  // Scrolla ner till footern (slots + action-bar) i OUTFITS-läget
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('#wardrobe-tabs .ward-group-btn')) {
      if (b.textContent.includes('OUTFITS')) b.click();
    }
    document.getElementById('wardrobe-screen').scrollTop = 99999;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'footer.png') });
  const elsFooter = await enumEls();
  fs.writeFileSync(path.join(OUT, 'els-footer.json'), JSON.stringify(elsFooter, null, 1));

  console.log('DONE');
  console.log(logs.slice(-5).join('\n'));
  await browser.close();
})();
