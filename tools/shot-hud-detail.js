// Detalj-crops av V1:s HUD: HP-bar, minimap, och shield AKTIVERAD.
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, 'hud-ref');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8799/index.html?devboot=sandbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { const t = document.getElementById('tutorial-overlay'); if (t) t.classList.add('hidden'); }).catch(() => {});

  // sänk HP + ge shield så bägge barerna syns
  const info = await page.evaluate(() => {
    const r = {};
    try {
      const p = state.player;
      if (p) {
        p.hp = Math.round((p.maxHp || 100) * 0.55);
        p.shield = p.maxShield || 50; if (!p.maxShield) { p.maxShield = 50; p.shield = 50; }
        p.pvpShieldUntil = performance.now() + 4000;
        r.hp = p.hp; r.shield = p.shield;
      }
    } catch (e) { r.err = e.message; }
    return r;
  });
  await page.waitForTimeout(700);

  await page.screenshot({ path: path.join(OUT, 'detail-hp-shield.png'), clip: { x: 0, y: 0, width: 320, height: 150 } });
  await page.screenshot({ path: path.join(OUT, 'detail-minimap.png'), clip: { x: 560, y: 20, width: 340, height: 340 } });
  await page.screenshot({ path: path.join(OUT, 'detail-buttons.png'), clip: { x: 600, y: 150, width: 300, height: 270 } });
  await page.screenshot({ path: path.join(OUT, 'detail-player-shield.png'), clip: { x: 330, y: 120, width: 240, height: 240 } });
  console.log('info:', JSON.stringify(info));
  console.log('SAVED detail crops');
  await browser.close();
})();
