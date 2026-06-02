// v1.687 — verifierar att alla undermeny-skärmar med nya bakgrunder öppnas/renderar
// utan JS-fel. Single player. Laddar om sidan mellan varje skärm så varje fångas
// från ett rent meny-läge (annars startar shop-ens "FORTSÄTT" spelet).
module.exports = {
  description: 'Sub-menu backgrounds render (shop/wardrobe/ach/settings) without JS errors',
  players: 1,
  async run({ pages, expect, screenshot, wait }) {
    const [p] = pages;

    const screens = [
      { open: '#btn-shop-menu',     id: '#shop-screen',      name: 'shop' },
      { open: '#btn-wardrobe',      id: '#wardrobe-screen',  name: 'wardrobe' },
      { open: '#btn-achievements',  id: '#ach-screen',       name: 'achievements' },
      { open: '#btn-menu-settings', id: '#settings-screen',  name: 'settings' },
      { open: '#btn-menu-help',     id: '#tutorial-overlay', name: 'tutorial' },
    ];

    await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 8000 });
    await screenshot(p, 'menu');

    for (const s of screens) {
      // Rent meny-läge varje varv
      await p.reload({ waitUntil: 'networkidle' });
      await p.locator('#menu-screen').waitFor({ state: 'visible', timeout: 8000 });
      await wait(200);

      await p.locator(s.open).click();
      await p.locator(s.id).waitFor({ state: 'visible', timeout: 6000 });
      await wait(250); // låt bg-bilden ladda

      const hidden = await p.locator(s.id).evaluate(el => el.classList.contains('hidden'));
      expect(hidden).toBe(false);
      const bg = await p.locator(s.id).evaluate(el => getComputedStyle(el).backgroundImage);
      expect(bg).toMatch(/bg-(shop|wardrobe|ach|settings|help)\.jpg/);
      await screenshot(p, s.name);
    }
  },
};
