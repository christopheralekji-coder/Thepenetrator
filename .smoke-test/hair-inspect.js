// Inspektera hur frisyrer sitter på huvudet (mobil-landskap). Fångar Frisyr-griden
// (head-framade thumbnails) i två scroll-lägen + några på preview-karaktären.
module.exports = {
  description: 'Hairstyle fit inspection',
  players: 1,
  async run({ pages, expect, screenshot, wait }) {
    const [p] = pages;
    const clickId = (id) => p.evaluate((i) => { const e = document.getElementById(i); if (e) e.click(); }, id);
    const clickText = (sel, text) => p.evaluate((a) => {
      const b = [...document.querySelectorAll(a.sel)].find(x => (x.textContent || '').includes(a.text));
      if (b) b.click();
    }, { sel, text });
    const scrollOpts = (top) => p.evaluate((t) => { const s = document.getElementById('wardrobe-options'); if (s) s.scrollTop = t; }, top);

    await p.setViewportSize({ width: 844, height: 390 });
    await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(1200);
    await clickId('btn-wardrobe');
    await p.locator('#wardrobe-screen').waitFor({ state: 'visible', timeout: 8000 });
    await wait(700);
    await clickText('.ward-group-btn', 'KROPP'); await wait(400);
    await clickText('.ward-sub-btn', 'Frisyr'); await wait(500);
    await scrollOpts(0); await wait(200); await screenshot(p, 'hair-grid-1');
    await scrollOpts(220); await wait(200); await screenshot(p, 'hair-grid-2');
    await scrollOpts(460); await wait(200); await screenshot(p, 'hair-grid-3');
    // några på preview
    for (const h of ['Mohawk Svart', 'Långt Brunt', 'Afro', 'Man-bun']) {
      await clickText('.ward-card', h); await wait(400);
      await screenshot(p, 'hairp-' + h.split(' ')[0]);
    }
  },
};
