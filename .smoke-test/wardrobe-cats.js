// MOBIL-verifiering (390×844): garderobens preset-subtabs + action-bar (där lilan
// satt) + en KROPP-kategori + hjälp/tutorial. WarParty är mobilspel → portrait.
// JS-baserade klick (p.evaluate) för att undvika mobil-animations-instabilitet.
module.exports = {
  description: 'Wardrobe + help MOBILE purple/transparency check',
  players: 1,
  async run({ pages, expect, screenshot, wait }) {
    const [p] = pages;
    const clickId = (id) => p.evaluate((i) => { const e = document.getElementById(i); if (e) e.click(); }, id);
    const clickText = (sel, text) => p.evaluate((a) => {
      const b = [...document.querySelectorAll(a.sel)].find(x => (x.textContent || '').includes(a.text));
      if (b) b.click();
    }, { sel, text });

    await p.setViewportSize({ width: 844, height: 390 }); // mobil LANDSKAP (spelet kräver landscape)
    await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(1200);

    // GARDEROB
    await clickId('btn-wardrobe');
    await p.locator('#wardrobe-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(700);
    await clickText('.ward-group-btn', 'OUTFITS'); await wait(500);
    await screenshot(p, 'ward-outfits');
    await p.evaluate(() => { const s = document.getElementById('wardrobe-screen'); if (s) s.scrollTop = s.scrollHeight; });
    await wait(400);
    await screenshot(p, 'ward-actionbar');
    await p.evaluate(() => { const s = document.getElementById('wardrobe-screen'); if (s) s.scrollTop = 0; });
    await clickText('.ward-group-btn', 'KROPP'); await wait(400);
    await clickText('.ward-sub-btn', 'Skägg'); await wait(500);
    await screenshot(p, 'ward-skagg');
    await clickId('btn-wardrobe-close'); await wait(500);

    // HJÄLP / TUTORIAL
    await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 6000 });
    await clickId('btn-menu-help');
    await p.locator('#tutorial-overlay').waitFor({ state: 'visible', timeout: 6000 });
    await wait(500);
    await screenshot(p, 'help');
  },
};
