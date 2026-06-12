// Skärmdumpar V1:s ALLA menyer (facit för V2:s meny-paritet) + dumpar synliga
// knappars text/id per skärm. node tools/shoot-menus.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'test_shots', 'v1_menus');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } }); // mobil landskap
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  const report = {};
  async function snap(name) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    report[name] = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, [id^="btn-"], .menu-btn, .wardrobe-tab')) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || st.display === 'none' || st.visibility === 'hidden') continue;
        // synlig? (något av förfäderna display:none → bounding rect blir 0 — täcks ovan)
        out.push({ id: el.id || '', text: (el.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' '),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    console.log('SNAP', name, '-', report[name].length, 'knappar');
  }
  async function click(sel) {
    try { await page.click(sel, { timeout: 2500, force: true }); } catch (e) { console.log('CLICK FAIL', sel, e.message.slice(0, 60)); }
    await page.waitForTimeout(500);
  }

  await snap('01_main');
  // LÄGE-väljaren (btn-mode) — cykla en gång för att se
  await click('#btn-mode'); await snap('02_mode_cycled');
  // SVÅRIGHET
  await click('#btn-difficulty'); await snap('03_difficulty_cycled');
  // GARDEROB
  await click('#btn-wardrobe'); await snap('04_wardrobe');
  await click('#btn-wardrobe-close');
  // SHOP
  await click('#btn-shop-menu'); await snap('05_shop');
  const shopClose = await page.$('#btn-shop-close, .shop-close');
  if (shopClose) { await shopClose.click(); await page.waitForTimeout(400); } else { await page.keyboard.press('Escape'); }
  // ACHIEVEMENTS
  await click('#btn-achievements'); await snap('06_achievements');
  await click('#btn-ach-close');
  // SETTINGS
  await click('#btn-menu-settings'); await snap('07_settings');
  await click('#btn-settings-close');
  // HJÄLP
  await click('#btn-menu-help'); await snap('08_help');
  const helpClose = await page.$('#btn-help-close, #btn-tut-close');
  if (helpClose) { await helpClose.click(); await page.waitForTimeout(400); }
  // CO-OP (skapa game / join / lobby)
  await click('#btn-coop'); await snap('09_coop');
  await click('#btn-coop-host'); await snap('10_lobby_host');
  await snap('11_lobby_host2');
  await click('#btn-coop-close');
  await snap('12_back_main');

  fs.writeFileSync(path.join(OUT, 'buttons.json'), JSON.stringify(report, null, 1));
  console.log('KLAR ->', OUT);
  await browser.close();
})();
