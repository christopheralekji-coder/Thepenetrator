// Cyklar genom alla 23 redesignade vapen + verifierar att drawPlayerWeapon +
// drawBullet (när det går) inte kraschar. Hooks in i WEAPONS-arrayen och
// växlar weaponId direkt på state.player.
'use strict';

module.exports = {
  description: 'Cycle through all premium-redesigned weapons + check render does not throw',
  players: 1,
  async run({ pages, expect, screenshot, wait, waitFor }) {
    const [page] = pages;

    // Samla console-fel
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await waitFor(page, '#btn-start', 10000);

    // Skippa intro
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await page.reload();
    await waitFor(page, '#btn-start', 10000);
    await page.click('#btn-start');
    await wait(2500);

    // Stäng ev. tutorial / dialog
    const tutBtn = page.locator('#btn-tut-close');
    if (await tutBtn.count() > 0 && await tutBtn.isVisible()) {
      await tutBtn.click();
      await wait(300);
    }
    const dialogBtn = await page.evaluate(() => {
      if (typeof storyDialogActive !== 'undefined' && storyDialogActive && storyDialogActive.btn) {
        return storyDialogActive.btn;
      }
      return null;
    });
    if (dialogBtn) {
      const canvasBox = await page.locator('#game').boundingBox();
      await page.mouse.click(canvasBox.x + dialogBtn.x + dialogBtn.w / 2, canvasBox.y + dialogBtn.y + dialogBtn.h / 2);
      await wait(300);
    }
    await wait(800);

    // Cyklar alla 23 redesignade vapen — sätter weaponId, rendrar 30 frames,
    // fyrar 1 skott (genererar projektil), rendrar 30 frames till.
    const cycleResult = await page.evaluate(() => {
      const ids = ['fists','knuckles','knife','bat','machete','sickle','spear','axe','mace','whip','sledge','katana','energysword','lightsaber',
                   'pistol','shuriken','throwknife','revolver','burstpistol','shotgun','bow','smg','crossbow','rifle','flame','sonic','sniper',
                   'frost','tesla','grenade','boomerang','plasma','rocket','pullwhip','timestop','blackhole','mindcontrol','railgun','minigun'];
      const failed = [];
      const ok = [];
      for (const id of ids) {
        try {
          state.player.weaponId = id;
          const w = (typeof W_BY_ID !== 'undefined') && W_BY_ID[id];
          if (!w) { failed.push(id + ' (not in W_BY_ID)'); continue; }
          state.player.weapon = w;
          // Render 10 frames @ 16ms
          let now = performance.now();
          for (let i = 0; i < 10; i++) {
            now += 16;
            if (typeof runFrame === 'function') runFrame(0.016, now);
          }
          // Spawn ett bullet av detta vapen så drawBullet körs (om gun)
          if (w.type === 'gun' && Array.isArray(state.bullets)) {
            state.bullets.push({
              x: state.player.x + 30, y: state.player.y,
              vx: 200, vy: 0, r: 4, life: 1,
              color: w.color, style: w.style || w.id, weaponId: id, hostile: false,
              burn: w.burn,
            });
            for (let i = 0; i < 10; i++) {
              now += 16;
              if (typeof runFrame === 'function') runFrame(0.016, now);
            }
          }
          ok.push(id);
        } catch (e) {
          failed.push(id + ': ' + e.message);
        }
      }
      return { ok, failed, total: ids.length };
    });
    console.log('[WEAPON-CHECK]', JSON.stringify(cycleResult, null, 2));
    await screenshot(page, '01-after-weapon-cycle');

    // Verifiera att inga JS-errors slängdes
    if (errors.length > 0) {
      console.log('[CONSOLE-ERRORS]', JSON.stringify(errors, null, 2));
    }
    expect(cycleResult.failed.length).toBe(0);
    expect(errors.filter(e => !e.includes('Failed to load resource')).length).toBe(0);
  },
};
