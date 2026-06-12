// Detaljdumpar av V1:s coop-lobby (host-vy) — scrollar genom hela overlayen
// så V2 kan matcha host-controls/tabs/diff/avancerat/start-knappen.
// node tools/shoot-lobby-detail.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'test_shots', 'v1_menus');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.click('#btn-coop', { force: true });
  await page.waitForTimeout(800);
  // coop-init i full höjd (scrolla ner för filter + rooms-lista)
  await page.screenshot({ path: path.join(OUT, 'd00_coop_init_top.png') });
  await page.evaluate(() => { document.getElementById('coop-screen').scrollTop = 200; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'd01_coop_init_scroll.png') });
  await page.evaluate(() => { document.getElementById('coop-screen').scrollTop = 9999; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'd02_coop_init_bottom.png') });
  // hosta
  await page.evaluate(() => { document.getElementById('coop-screen').scrollTop = 0; });
  await page.click('#btn-coop-host', { force: true });
  await page.waitForTimeout(2500);
  const scr = () => page.evaluate(() => document.getElementById('coop-screen').scrollTop);
  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: path.join(OUT, 'd1' + i + '_lobby_scroll.png') });
    const before = await scr();
    await page.evaluate(() => { document.getElementById('coop-screen').scrollTop += 300; });
    await page.waitForTimeout(350);
    if ((await scr()) === before) break;
  }
  // PVP-tab
  await page.click('.lobby-tab[data-tab="pvp"]', { force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'd20_lobby_pvp_tab.png') });
  // TDM på (öppnar popup) — stäng popup, visa team-controls
  await page.evaluate(() => { document.getElementById('coop-screen').scrollTop -= 100; });
  await page.screenshot({ path: path.join(OUT, 'd21_lobby_pvp_tab_b.png') });
  // BOTS-tab
  await page.click('.lobby-tab[data-tab="bots"]', { force: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'd22_lobby_bots_tab.png') });
  console.log('DONE');
  await browser.close();
})();
