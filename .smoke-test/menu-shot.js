module.exports = {
  description: 'Screenshot menu (new hero) + co-op screen (new bg)',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const [host] = pages;
    await host.setViewportSize({ width: 852, height: 393 });
    await waitFor(host, '#btn-start', 10000);
    await wait(1500);
    try { await host.evaluate(() => window.fitMenu && window.fitMenu()); } catch (e) {}
    await wait(300);
    await screenshot(host, 'warparty-menu');
    // co-op-skärmen
    try {
      await host.click('#btn-coop'); await wait(1200);
      await screenshot(host, 'warparty-coop');
    } catch (e) {}
  },
};
