// Skärmdumpar V1:s 4 submenyer (shop/settings/achievements/help) för layout-referens.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, 'submenu-ref');
const screens = [
  ['shop', 'btn-shop-menu'],
  ['settings', 'btn-menu-settings'],
  ['achievements', 'btn-achievements'],
  ['help', 'btn-menu-help'],
];
(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [name, id] of screens) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 460 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4500);
      await page.evaluate((bid) => { const b = document.getElementById(bid); if (b) b.click(); }, id);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('shot', name);
    } catch (e) { console.log('err', name, e.message.slice(0, 60)); }
    await ctx.close();
  }
  await browser.close();
})();
