// Verifierar att den globala klick-ljud-hanteraren initierar Audio + är redo att
// spela uiClick när man trycker på en menyknapp (utan föregående gestur).
'use strict';
module.exports = {
  description: 'Menu button click initializes audio + uiClick ready (global click-sound handler)',
  players: 1,
  async run({ pages, wait, waitFor, expect }) {
    const [page] = pages;
    await page.setViewportSize({ width: 844, height: 390 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await waitFor(page, '#btn-start', 10000);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true; localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await page.reload();
    await waitFor(page, '#btn-start', 10000);

    // Före någon gestur: hooka spy på Audio.uiClick (utan att initiera annat)
    await page.evaluate(() => {
      window.__uiClicks = 0;
      const tryHook = () => {
        if (typeof Audio !== 'undefined' && Audio.uiClick && !Audio.__hooked) {
          const orig = Audio.uiClick.bind(Audio);
          Audio.uiClick = function () { window.__uiClicks++; return orig(); };
          Audio.__hooked = true;
          return true;
        }
        return false;
      };
      tryHook();
    });

    // Klicka en menyknapp (öppnar achievements-overlay) → global handler ska fyra
    await page.click('#btn-achievements');
    await wait(400);

    const res = await page.evaluate(() => ({
      uiClicks: window.__uiClicks || 0,
      ctx: !!(typeof Audio !== 'undefined' && Audio.ctx),
      ctxState: (typeof Audio !== 'undefined' && Audio.ctx) ? Audio.ctx.state : 'none',
      enabled: typeof Audio !== 'undefined' && Audio.enabled,
    }));
    console.log('[MENU-SFX] ', JSON.stringify(res));
    console.log('[MENU-SFX] console errors:', errors.length, JSON.stringify(errors.slice(0, 5)));

    expect(res.ctx).toBe(true);          // global handler initierade Audio
    expect(res.uiClicks).toBeGreaterThan(0); // uiClick anropades vid knapp-klick
    if (errors.length) throw new Error('Console errors: ' + errors.slice(0, 3).join(' | '));
  },
};
