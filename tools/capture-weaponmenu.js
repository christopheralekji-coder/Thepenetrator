// Öppnar V1:s vapenmeny + fångar den + varje vapen-ikon (SVG) som referens/assets.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, 'weapon-ref');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push('[c] ' + m.text().slice(0, 100)));
  page.on('pageerror', e => logs.push('[ERR] ' + e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html?devboot=sandbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // info om vapen + öppna menyn
  const info = await page.evaluate(() => {
    const out = { weapons: [], opened: false, menuId: null };
    try {
      if (typeof WEAPONS !== 'undefined') {
        const arr = Array.isArray(WEAPONS) ? WEAPONS : Object.values(WEAPONS);
        for (const w of arr.slice(0, 40)) out.weapons.push({ id: w.id, name: w.name, dmg: w.dmg, rof: w.fireRate || w.rof, mag: w.mag || w.magSize });
      }
    } catch (e) { out.werr = e.message; }
    // klicka vapen-knappen
    const b = document.getElementById('btn-weapon-menu');
    if (b) { b.click(); out.opened = true; }
    return out;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const t = document.getElementById('tutorial-overlay'); if (t) t.style.display = 'none'; });
  await page.screenshot({ path: path.join(OUT, 'weaponmenu-full.png') });

  // hitta synlig meny-overlay + alla weapon-svg-ikoner
  const dom = await page.evaluate(() => {
    const res = { overlays: [], icons: [] };
    document.querySelectorAll('[id*="weapon"],[class*="weapon"],[id*="menu"]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 80 && r.height > 80 && getComputedStyle(el).display !== 'none')
        res.overlays.push({ id: el.id, cls: el.className.toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    });
    document.querySelectorAll('svg.weapon-svg, .weapon-svg').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 8) res.icons.push({ i, w: Math.round(r.width), h: Math.round(r.height), parent: (el.parentElement && el.parentElement.className.toString().slice(0, 30)) });
    });
    return res;
  });
  console.log('WEAPONS:', JSON.stringify(info.weapons.slice(0, 20)));
  console.log('OVERLAYS:', JSON.stringify(dom.overlays));
  console.log('ICONS:', dom.icons.length);
  console.log(logs.slice(-6).join('\n'));
  await browser.close();
})();
