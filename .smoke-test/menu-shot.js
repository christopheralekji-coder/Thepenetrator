module.exports = {
  description: 'Screenshot main menu at phone-landscape (fit-to-screen check)',
  players: 1,
  async run({ pages, screenshot, wait }) {
    const [host] = pages;
    // iPhone-landskap ~852x393 — testar att allt får plats utan scroll
    await host.setViewportSize({ width: 852, height: 393 });
    await wait(1600);
    if (typeof host.evaluate === 'function') {
      try { await host.evaluate(() => window.fitMenu && window.fitMenu()); } catch (e) {}
    }
    await wait(300);
    await screenshot(host, 'warparty-menu-landscape');
    // även en kortare/mindre skärm för att se nedskalningen
    await host.setViewportSize({ width: 740, height: 340 });
    await wait(400);
    try { await host.evaluate(() => window.fitMenu && window.fitMenu()); } catch (e) {}
    await wait(200);
    await screenshot(host, 'warparty-menu-small');
  },
};
