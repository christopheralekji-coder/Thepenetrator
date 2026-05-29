module.exports = {
  description: 'Capture coolest wardrobe outfits (riddare/mytologi/marken) as refs',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const p = pages[0];
    await p.setViewportSize({ width: 1280, height: 800 });
    await waitFor(p, '#btn-start', 12000); await wait(1500);
    await p.evaluate(() => { try { if (typeof save !== 'undefined' && save) save.wardrobeUnlockAll = true; } catch (e) {} });
    try { await p.locator('#btn-wardrobe').click({ timeout: 4000 }); } catch (e) {}
    await wait(1500);
    const wanted = ['RIDDARE', 'MYTOLOGI', 'MÄRKEN', 'KLASSIKER'];
    const groupBtns = p.locator('#wardrobe-tabs button');
    const gn = await groupBtns.count();
    const done = {};
    for (let g = 0; g < gn; g++) {
      try { await groupBtns.nth(g).click({ timeout: 2000 }); } catch (e) {}
      await wait(450);
      for (const label of wanted) {
        if (done[label]) continue;
        const sub = p.locator('#wardrobe-tabs button', { hasText: label });
        if (await sub.count() > 0) {
          try { await sub.first().click({ timeout: 2000 }); } catch (e) {}
          await wait(550);
          const cards = p.locator('#wardrobe-options > *');
          const cn = Math.min(await cards.count(), 4);
          for (let i = 0; i < cn; i++) {
            try { await cards.nth(i).click({ timeout: 2000 }); } catch (e) {}
            await wait(400);
            await screenshot(p, label + '-' + i);
          }
          done[label] = true;
        }
      }
    }
  },
};
