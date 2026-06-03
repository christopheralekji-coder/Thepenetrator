// v1.737 visuell verifiering: rik frag-explosion + texturerad rök.
// Mobil-viewport (390×844). Startar solo, går in i spelet, triggar
// spawnExplosion + spawnSmokeCloud nära spelaren och fångar faser.
'use strict';

module.exports = {
  description: 'Verify rich frag explosion + textured smoke render without errors (mobile)',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const [page] = pages;
    await page.setViewportSize({ width: 844, height: 390 }); // mobil LANDSKAP (shooter spelas liggande)

    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await waitFor(page, '#btn-start', 10000);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await page.reload();
    await waitFor(page, '#btn-start', 10000);
    await page.click('#btn-start');
    await wait(2200);

    // Stäng tutorial + ev. story-dialog
    const tutBtn = page.locator('#btn-tut-close');
    if (await tutBtn.count() > 0 && await tutBtn.isVisible()) { await tutBtn.click(); await wait(400); }
    const dialogBtn = await page.evaluate(() =>
      (typeof storyDialogActive !== 'undefined' && storyDialogActive && storyDialogActive.btn) ? storyDialogActive.btn : null);
    if (dialogBtn) {
      const box = await page.locator('#game').boundingBox();
      await page.mouse.click(box.x + dialogBtn.x + dialogBtn.w / 2, box.y + dialogBtn.y + dialogBtn.h / 2);
      await wait(600);
    }
    await wait(1200);

    const ready = await page.evaluate(() => ({
      mode: typeof state !== 'undefined' && state.mode,
      hasSpawnExpl: typeof spawnExplosion === 'function',
      hasSpawnSmoke: typeof spawnSmokeCloud === 'function',
      hasDrawExpl: typeof drawExplosions === 'function',
      player: typeof state !== 'undefined' && !!state.player,
    }));
    console.log('[VFX-DIAG] ready:', JSON.stringify(ready));

    // Trigga rök (vänster om spelaren) + explosion (höger om spelaren)
    await page.evaluate(() => {
      const p = state.player;
      if (typeof spawnSmokeCloud === 'function') spawnSmokeCloud(p.x - 60, p.y + 10);
      if (typeof spawnExplosion === 'function') spawnExplosion(p.x + 55, p.y, 90);
    });
    await wait(50);  await screenshot(page, '01-expl-flash-50ms');
    await wait(150); await screenshot(page, '02-expl-fireball-200ms');
    await wait(300); await screenshot(page, '03-expl-flames-500ms');
    await wait(500); await screenshot(page, '04-expl-smoke-1000ms');

    // Andra explosionen för säkerhets skull + rök som mognat
    await page.evaluate(() => {
      const p = state.player;
      if (typeof spawnExplosion === 'function') spawnExplosion(p.x, p.y - 50, 90);
    });
    await wait(200); await screenshot(page, '05-second-expl');
    await wait(2500); await screenshot(page, '06-smoke-matured');

    const post = await page.evaluate(() => ({
      explosions: (typeof state !== 'undefined' && state.explosions) ? state.explosions.length : 'n/a',
      smoke: (typeof state !== 'undefined' && state.smokeClouds) ? state.smokeClouds.length : 'n/a',
      mode: typeof state !== 'undefined' && state.mode,
    }));
    console.log('[VFX-DIAG] post:', JSON.stringify(post));
    console.log('[VFX-DIAG] console errors:', errors.length, JSON.stringify(errors.slice(0, 8)));
    if (errors.length) throw new Error('Console errors during VFX: ' + errors.slice(0, 5).join(' | '));
    if (post.mode !== 'playing') throw new Error('Spelet kraschade ur playing-läge (mode=' + post.mode + ')');
  },
};
