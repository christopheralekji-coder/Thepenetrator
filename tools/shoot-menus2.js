// Del 2: settings/achievements/hjälp/coop/lobby + garderobens KROPP/KLÄDER-flikar.
// Reload mellan varje sektion så overlays aldrig blockerar. node tools/shoot-menus2.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'test_shots', 'v1_menus');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const report = {};

  async function fresh() {
    await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
  }
  async function snap(name) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    report[name] = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, [id^="btn-"], input, select, .menu-btn')) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || st.display === 'none' || st.visibility === 'hidden') continue;
        out.push({ id: el.id || '', text: (el.textContent || el.placeholder || '').trim().slice(0, 45).replace(/\s+/g, ' '),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    console.log('SNAP', name, '-', report[name].length, 'element');
  }
  async function click(sel) {
    try { await page.click(sel, { timeout: 2500, force: true }); } catch (e) { console.log('CLICK FAIL', sel, e.message.slice(0, 50)); }
    await page.waitForTimeout(600);
  }

  await fresh(); await click('#btn-menu-settings'); await snap('07_settings');
  await fresh(); await click('#btn-achievements'); await snap('06_achievements');
  await fresh(); await click('#btn-menu-help'); await snap('08_help');
  // coop-dialog + lobby (host)
  await fresh(); await click('#btn-coop'); await snap('09_coop');
  await click('#btn-coop-host'); await snap('10_lobby_host');
  await page.waitForTimeout(2500); await snap('11_lobby_host_b');
  // garderobens huvudflikar
  await fresh(); await click('#btn-wardrobe'); await snap('04_wardrobe_outfits');
  await page.evaluate(() => { const tabs = document.querySelectorAll('.wd-main-tab, [data-wdtab]'); });
  // klicka via text
  for (const [name, label] of [['04_wardrobe_kropp', 'KROPP'], ['04_wardrobe_klader', 'KLÄDER']]) {
    try {
      await page.click(`text="${label}"`, { timeout: 2500, force: true });
      await snap(name);
    } catch (e) { console.log('TAB FAIL', label, e.message.slice(0, 50)); }
  }
  fs.writeFileSync(path.join(OUT, 'buttons2.json'), JSON.stringify(report, null, 1));
  console.log('KLAR');
  await browser.close();
})();
