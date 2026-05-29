module.exports = {
  description: 'Screenshot main menu (WarParty branding + layout check)',
  players: 1,
  async run({ pages, screenshot, wait }) {
    const [host] = pages;
    await wait(1800); // låt meny + fonts + entrance-animation rendera klart
    await screenshot(host, 'warparty-menu');
  },
};
