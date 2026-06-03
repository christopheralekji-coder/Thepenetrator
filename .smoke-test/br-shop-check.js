// v1.739 BR-shop UI runtime-check (mobil-landskap). Stagar ett BR-state och kör
// HUD + buy-prompt + shop-modal + cash-cheat-knappen — verifierar DOM + 0 console-fel.
'use strict';

module.exports = {
  description: 'Battle Royale shop/cash/armor HUD + cheat render without errors (mobile)',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const [page] = pages;
    await page.setViewportSize({ width: 844, height: 390 });

    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await waitFor(page, '#btn-start', 10000);
    await wait(800);

    // Stage ett minimalt BR-state + spelare och bygg HUD:en.
    const staged = await page.evaluate(() => {
      try {
        state.mode = 'playing';
        state.battleroyaleActive = true;
        state.battleroyaleAliveCount = 8;
        state.battleroyalePhase = 0;
        state.battleroyalePhases = [{ name: 'LOOT', outsideDmg: 0 }];
        state.battleroyaleMatchEndAt = Date.now() + 600000;
        state.battleroyalePhaseEndAt = Date.now() + 90000;
        state.player = state.player || {};
        Object.assign(state.player, { x: 300, y: 300, hp: 200, maxHp: 200, shield: 0, maxShield: 200, weaponId: 'pistol', spectating: false, armor: 100, maxArmor: 150, armorPlates: 2, gasMask: false });
        state.camera = { x: state.player.x - 422, y: state.player.y - 195 };
        state.battleroyaleZone = { x: 5000, y: 5000, r: 6000 };
        state.battleroyaleZoneRender = { x: 5000, y: 5000, r: 6000 };
        state.battleroyaleNextZoneRender = null;
        state.brBuyStations = [{ x: 300, y: 300, r: 200, alien: false }, { x: 8850, y: 8850, r: 200, alien: true }];
        state.brCash = 750;
        state.brNearStation = null;
        if (typeof showBrHud === 'function') showBrHud();
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        return {
          cashText: (document.getElementById('br-cash') || {}).textContent,
          armorHtml: !!document.getElementById('br-armor'),
          promptVisible: (document.getElementById('br-buy-prompt') || {}).style ? document.getElementById('br-buy-prompt').style.display : 'none',
          nearStation: !!state.brNearStation,
        };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] staged:', JSON.stringify(staged));
    await wait(300);
    await screenshot(page, '01-br-hud-cash-armor');

    // Buy-prompt ska synas (vi står på en station). Öppna shoppen.
    const shopOpen = await page.evaluate(() => {
      try {
        state.player.x = 300; state.player.y = 300;
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        if (typeof openBrShop === 'function') openBrShop();
        const ov = document.getElementById('br-shop-overlay');
        const cards = ov ? ov.querySelectorAll('#br-shop-grid > div').length : 0;
        return { overlay: !!ov, cards };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] shop:', JSON.stringify(shopOpen));
    await wait(300);
    await screenshot(page, '02-br-shop-regular');

    // Stäng + testa ALIEN-shoppen (flytta till alien-stationen).
    const alienShop = await page.evaluate(() => {
      try {
        if (typeof closeBrShop === 'function') closeBrShop();
        state.player.x = 8850; state.player.y = 8850;
        state.camera = { x: state.player.x - 422, y: state.player.y - 195 };
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        if (typeof openBrShop === 'function') openBrShop();
        const ov = document.getElementById('br-shop-overlay');
        const cards = ov ? ov.querySelectorAll('#br-shop-grid > div').length : 0;
        return { alienPrompt: (document.getElementById('br-buy-prompt') || {}).textContent, cards };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] alien:', JSON.stringify(alienShop));
    await wait(300);
    await screenshot(page, '03-br-shop-alien');

    // Cash-cheat: 4 klick nere till vänster → br-cash-cheat-btn ska bli synlig.
    const cheat = await page.evaluate(() => {
      try {
        if (typeof closeBrShop === 'function') closeBrShop();
        const vh = (typeof viewH === 'number') ? viewH : window.innerHeight;
        for (let i = 0; i < 4; i++) checkCdGoldCornerTap(20, vh - 20);
        const btn = document.getElementById('br-cash-cheat-btn');
        return { cheatVisible: btn ? btn.style.display : 'missing' };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] cheat:', JSON.stringify(cheat));
    await wait(200);
    await screenshot(page, '04-br-cash-cheat-btn');

    console.log('[BR-SHOP] console errors:', errors.length, JSON.stringify(errors.slice(0, 8)));
    if (staged.error) throw new Error('staging failed: ' + staged.error);
    if (!staged.cashText || staged.cashText.indexOf('750') < 0) throw new Error('cash HUD fel: ' + staged.cashText);
    if (staged.promptVisible !== 'block') throw new Error('buy-prompt visades inte vid station');
    if (!shopOpen.overlay || shopOpen.cards < 2) throw new Error('shop-modal saknar kort: ' + JSON.stringify(shopOpen));
    if (alienShop.cards < 3) throw new Error('alien-shop saknar exklusiv vara: ' + JSON.stringify(alienShop));
    if (cheat.cheatVisible !== 'flex') throw new Error('cash-cheat-knapp visades inte: ' + JSON.stringify(cheat));
    if (errors.length) throw new Error('console errors: ' + errors.slice(0, 5).join(' | '));
  },
};
