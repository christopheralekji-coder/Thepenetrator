// Visa frisyrer på BART huvud (ta bort hatt/bandana/glasögon) i full preview-storlek.
module.exports = {
  description: 'Hair on bare head — large preview',
  players: 1,
  async run({ pages, expect, screenshot, wait }) {
    const [p] = pages;
    const clickId = (id) => p.evaluate((i) => { const e = document.getElementById(i); if (e) e.click(); }, id);
    const clickText = (sel, text) => p.evaluate((a) => {
      const b = [...document.querySelectorAll(a.sel)].find(x => (x.textContent || '').includes(a.text));
      if (b) b.click();
    }, { sel, text });

    await p.setViewportSize({ width: 844, height: 390 });
    await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(1200);
    await clickId('btn-wardrobe');
    await p.locator('#wardrobe-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(700);
    // Ta bort hatt/bandana/glasögon så håret syns rent
    await p.evaluate(() => {
      if (typeof save !== 'undefined' && save.wardrobe) {
        save.wardrobe.hat = 'none';
        save.wardrobe.bandana = 'none';
        save.wardrobe.glasses = 'none';
        if (typeof invalidateCostumeCache === 'function') invalidateCostumeCache();
      }
    });
    await clickText('.ward-group-btn', 'KROPP'); await wait(300);
    await clickText('.ward-sub-btn', 'Frisyr'); await wait(400);
    for (const h of ['Kort Svart', 'Mohawk Svart', 'Långt Brunt', 'Hästsvans Blond', 'Afro Svart', 'Man-bun']) {
      await clickText('.ward-card', h); await wait(400);
      // håll hatten av (vissa presets kan återställa)
      await p.evaluate(() => { if (typeof save !== 'undefined' && save.wardrobe) { save.wardrobe.hat = 'none'; save.wardrobe.bandana = 'none'; save.wardrobe.glasses = 'none'; if (typeof invalidateCostumeCache === 'function') invalidateCostumeCache(); } });
      await wait(250);
      await screenshot(p, 'bare-' + h.split(' ').join('').replace('å','a').replace('ä','a'));
    }
  },
};
