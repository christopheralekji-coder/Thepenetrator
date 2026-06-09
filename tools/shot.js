// Headless skärmdump-rigg — laddar spelet, ev. kör in-page setup, skärmdumpar i mobil-vy.
// Användning: node tools/shot.js <url> <out.png> [setupFnNamn]
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'https://christopheralekji-coder.github.io/Thepenetrator/';
  const out = process.argv[3] || 'tools/shot.png';
  const waitMs = parseInt(process.argv[4] || '4500', 10);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[c] ' + m.text().slice(0, 140)));
  page.on('pageerror', (e) => logs.push('[ERR] ' + (e.message || '').slice(0, 200)));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) { logs.push('[goto] ' + e.message.slice(0, 120)); }
  await page.waitForTimeout(waitMs);
  // dölj tutorial/hjälp-overlays så vi ser gameplay
  await page.evaluate(() => {
    for (const id of ['tutorial-overlay']) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(logs.slice(-25).join('\n'));
  console.log('SCREENSHOT -> ' + out);
})();
