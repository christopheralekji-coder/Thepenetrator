// Inspektera hur ärr sitter på ansiktet (mobil-landskap). Klär av gubben så ansiktet
// syns, sätter på olika ärr, screenshotar för zoom.
module.exports = {
  description: 'Scar placement inspection',
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
    // KROPP -> Ärr
    await clickText('.ward-group-btn', 'KROPP'); await wait(400);
    await clickText('.ward-sub-btn', 'Ärr'); await wait(400);

    for (const scar of ['Krigsmålning', 'Kors', 'Ögon', 'Tredje']) {
      await clickText('.ward-card', scar); await wait(450);
      await screenshot(p, 'scar-' + scar);
    }
  },
};
