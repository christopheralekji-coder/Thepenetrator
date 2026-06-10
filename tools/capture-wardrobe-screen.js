// Öppnar V1:s garderobs-skärm + skärmdump + enumererar layout (flikar/knappar/positioner).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, 'wardrobe-ref');
(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 460 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('[ERR] ' + e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  // öppna garderoben
  await page.evaluate(() => { const b = document.getElementById('btn-wardrobe'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'wardrobe-screen.png') });

  // enumerera synliga UI-element i garderoben
  const els = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const sel = 'button,[role=button],[onclick],[id*="ward"],[class*="ward"],[class*="tab"],[class*="preset"],[class*="slot"],canvas,input,[class*="randomize"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.y > 460 || r.x > 1000) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
      const id = el.id || (el.className && el.className.toString().slice(0, 22));
      if (seen.has(id + Math.round(r.x) + Math.round(r.y))) continue;
      seen.add(id + Math.round(r.x) + Math.round(r.y));
      out.push({ tag: el.tagName.toLowerCase(), id: el.id, cls: (el.className || '').toString().slice(0, 26), txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  });
  fs.writeFileSync(path.join(OUT, 'wardrobe-elements.json'), JSON.stringify(els, null, 1));
  console.log('ELEMENTS (' + els.length + '):');
  for (const e of els) console.log(`  [${e.tag}] #${e.id || e.cls} "${e.txt}" @${e.x},${e.y} ${e.w}x${e.h}`);
  console.log(logs.slice(-4).join('\n'));
  await browser.close();
})();
