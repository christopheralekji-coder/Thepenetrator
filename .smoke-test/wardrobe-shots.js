module.exports = {
  description: 'Capture all wardrobe characters (gubbar) for design reference',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const p = pages[0];
    await p.setViewportSize({ width: 1280, height: 800 });
    await waitFor(p, '#btn-start', 12000);
    await wait(1500);
    await p.evaluate(() => { try { if (typeof save !== 'undefined' && save) save.wardrobeUnlockAll = true; } catch (e) {} });
    // klicka GARDEROB (samma som fungerade i art-refs)
    const wb = p.locator('#btn-wardrobe');
    try { await wb.click({ timeout: 4000 }); } catch (e) {}
    await wait(1500);
    await screenshot(p, 'ward-default');
    // iterera alla tab-knappar (grupper + sub-tabbar) → en grid per tab
    const tabs = p.locator('#wardrobe-tabs button');
    const tn = await tabs.count();
    for (let i = 0; i < Math.min(tn, 16); i++) {
      try { await tabs.nth(i).click({ timeout: 2500 }); } catch (e) {}
      await wait(500);
      await screenshot(p, 'ward-tab-' + String(i).padStart(2, '0'));
    }
    // stora previews av första korten i sist visade griden
    const cards = p.locator('#wardrobe-options > *');
    const cn = await cards.count();
    for (let i = 0; i < Math.min(cn, 5); i++) {
      try { await cards.nth(i).click({ timeout: 2500 }); } catch (e) {}
      await wait(450);
      await screenshot(p, 'ward-preview-' + String(i).padStart(2, '0'));
    }
  },
};
