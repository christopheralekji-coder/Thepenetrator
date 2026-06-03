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
        Object.assign(state.player, { x: 300, y: 300, hp: 200, maxHp: 200, shield: 0, maxShield: 200, weaponId: 'pistol', spectating: false, armorLevel: 3, gasMask: false, selfReviveKits: 1, airstrikes: 2, brDowned: false });
        state.camera = { x: state.player.x - 422, y: state.player.y - 195 };
        state.battleroyaleZone = { x: 5000, y: 5000, r: 6000 };
        state.battleroyaleZoneRender = { x: 5000, y: 5000, r: 6000 };
        state.battleroyaleNextZoneRender = null;
        // hus-station = bounds (helt-inne-krav), alien = radie
        state.brBuyStations = [{ x: 300, y: 300, bounds: { x: 240, y: 240, w: 120, h: 120 }, alien: false }, { x: 8850, y: 8850, r: 200, alien: true }];
        state.brCash = 750;
        state.brNearStation = null;
        if (typeof showBrHud === 'function') showBrHud();
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        return {
          goldText: (document.getElementById('gold-info') || {}).textContent,
          armorHtml: (document.getElementById('br-armor') || {}).innerHTML || '',
          promptVisible: (document.getElementById('br-buy-prompt') || {}).style ? document.getElementById('br-buy-prompt').style.display : 'none',
          nearStation: !!state.brNearStation,
          insideOnly: (function () { state.player.x = 200; state.player.y = 200; if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt(); const out = !state.brNearStation; state.player.x = 300; state.player.y = 300; if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt(); return out; })(),
        };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] staged:', JSON.stringify(staged));
    await wait(300);
    await screenshot(page, '01-br-hud-cash-armor');

    // Buy-prompt ska synas (vi står inne i huset). Öppna shoppen → gear-flik + armor-flik.
    const shopOpen = await page.evaluate(() => {
      try {
        state.player.x = 300; state.player.y = 300;
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        if (typeof openBrShop === 'function') openBrShop();
        const ov = document.getElementById('br-shop-overlay');
        const gearCards = ov ? ov.querySelectorAll('#br-shop-grid > div').length : 0;
        const tabs = ov ? ov.querySelectorAll('#br-shop-tabs > button').length : 0;
        // byt till armor-flik
        state._brShopTab = 'armor'; if (typeof _brRenderShop === 'function') _brRenderShop(false);
        const armorCards = ov ? ov.querySelectorAll('#br-shop-grid > div').length : 0;
        return { overlay: !!ov, gearCards, tabs, armorCards };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] shop:', JSON.stringify(shopOpen));
    await wait(250);
    await screenshot(page, '02-br-shop-regular');

    // Stäng + testa ALIEN-shoppen (alien-flik med exklusiv vara).
    const alienShop = await page.evaluate(() => {
      try {
        if (typeof closeBrShop === 'function') closeBrShop();
        state.player.x = 8850; state.player.y = 8850;
        state.camera = { x: state.player.x - 422, y: state.player.y - 195 };
        if (typeof updateBrBuyPrompt === 'function') updateBrBuyPrompt();
        if (typeof openBrShop === 'function') openBrShop();
        const ov = document.getElementById('br-shop-overlay');
        const tabs = ov ? ov.querySelectorAll('#br-shop-tabs > button').length : 0;
        state._brShopTab = 'alien'; if (typeof _brRenderShop === 'function') _brRenderShop(true);
        const alienCards = ov ? ov.querySelectorAll('#br-shop-grid > div').length : 0;
        return { alienPrompt: (document.getElementById('br-buy-prompt') || {}).textContent, tabs, alienCards };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] alien:', JSON.stringify(alienShop));
    await wait(250);
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

    // Fas 2/3-batch: BAG-system, airstrike-minimap-targeting, downed-overlay.
    const p2 = await page.evaluate(() => {
      try {
        if (typeof closeBrShop === 'function') closeBrShop();
        state.player.x = 300; state.player.y = 300;
        state.player.uavCount = 1; state.player.airstrikes = 1; state.player.selfReviveKits = 1;
        // BAG: knapp finns + öppna → items i grid
        const hasBagBtn = !!document.getElementById('br-bag-btn');
        if (typeof openBrBag === 'function') openBrBag();
        const bagItems = (document.getElementById('br-bag-grid') || { querySelectorAll: () => [] }).querySelectorAll('div').length;
        if (typeof closeBrBag === 'function') closeBrBag();
        // AIRSTRIKE-targeting (startas normalt från bag)
        if (typeof enterBrAirstrikeTargeting === 'function') enterBrAirstrikeTargeting();
        const targeting = !!state.brAirstrikeTargeting;
        const banner = (document.getElementById('br-airstrike-banner') || {}).style ? document.getElementById('br-airstrike-banner').style.display : 'none';
        // mock ws (staged scenariot har ingen live coop-anslutning) + minimap-hitbox
        state._minimapHitbox = { x: 700, y: 10, w: 120, h: 120 }; state._cdMinimapXform = { ox: 700, oy: 10, scale: 0.012 };
        let strikeSent = false, strikeMsg = null;
        Coop.ws = { readyState: 1, send: (d) => { try { const m = JSON.parse(d); if (m.type === 'sim_br_airstrike') { strikeSent = true; strikeMsg = m; } } catch (e) {} } };
        if (typeof enterBrAirstrikeTargeting === 'function') enterBrAirstrikeTargeting();
        if (typeof checkBrAirstrikeTap === 'function') checkBrAirstrikeTap(760, 60); // inne i minimap → skicka
        // tap UTANFÖR minimap → ska INTE skicka (avbryt)
        let outsideSent = false;
        Coop.ws.send = (d) => { try { if (JSON.parse(d).type === 'sim_br_airstrike') outsideSent = true; } catch (e) {} };
        if (typeof enterBrAirstrikeTargeting === 'function') enterBrAirstrikeTargeting();
        if (typeof checkBrAirstrikeTap === 'function') checkBrAirstrikeTap(50, 300); // utanför minimap → avbryt
        // downed-overlay
        state.player.brDowned = true; state.player.brReviveEnd = Date.now() + 6000;
        if (typeof showBrDownedOverlay === 'function') showBrDownedOverlay();
        const downedVisible = (document.getElementById('br-downed-overlay') || {}).style ? document.getElementById('br-downed-overlay').style.display : 'none';
        state.brUav = { until: Date.now() + 20000, blips: [{ x: 1000, y: 1000 }, { x: 2000, y: 2000 }], blipAt: performance.now() };
        return { hasBagBtn, bagItems, targeting, banner, strikeSent, strikeMsg, outsideSent, downedVisible };
      } catch (e) { return { error: e.message }; }
    });
    console.log('[BR-SHOP] fas2:', JSON.stringify(p2));
    await wait(250);
    await screenshot(page, '05-br-downed-overlay');
    await page.evaluate(() => { state.player.brDowned = false; if (typeof hideBrDownedOverlay === 'function') hideBrDownedOverlay(); });

    console.log('[BR-SHOP] console errors:', errors.length, JSON.stringify(errors.slice(0, 8)));
    if (staged.error) throw new Error('staging failed: ' + staged.error);
    if (p2.error) throw new Error('fas2 failed: ' + p2.error);
    if (!staged.goldText || staged.goldText.indexOf('750') < 0) throw new Error('cash i 💰-HUD fel: ' + staged.goldText);
    if (staged.promptVisible !== 'block') throw new Error('buy-prompt visades inte inne i huset');
    if (!staged.insideOnly) throw new Error('shop visades UTANFÖR huset (helt-inne-krav brutet)');
    if (!shopOpen.overlay || shopOpen.gearCards < 5) throw new Error('gear-flik saknar kort (≥5): ' + JSON.stringify(shopOpen));
    if (shopOpen.tabs < 3) throw new Error('shop saknar flikar (gear/armor/perks ≥3): ' + JSON.stringify(shopOpen));
    if (shopOpen.armorCards < 2) throw new Error('armor-flik saknar kort (pansar+maxhp/shield ≥2): ' + JSON.stringify(shopOpen));
    if (alienShop.tabs < 4) throw new Error('alien-shop saknar alien-flik (≥4 flikar): ' + JSON.stringify(alienShop));
    if (alienShop.alienCards < 1) throw new Error('alien-flik saknar exklusiv vara: ' + JSON.stringify(alienShop));
    if (cheat.cheatVisible !== 'flex') throw new Error('cash-cheat-knapp visades inte: ' + JSON.stringify(cheat));
    if (!p2.hasBagBtn) throw new Error('bag-knapp saknas');
    if (p2.bagItems < 1) throw new Error('bag-panelen saknar items: ' + JSON.stringify(p2));
    if (!p2.strikeSent) throw new Error('airstrike via minimap-tap skickades inte: ' + JSON.stringify(p2));
    if (p2.outsideSent) throw new Error('airstrike skickades vid tap UTANFÖR minimap (ska avbryta)');
    if (!p2.targeting || p2.banner !== 'block') throw new Error('airstrike-targeting startade inte: ' + JSON.stringify(p2));
    if (p2.downedVisible !== 'flex') throw new Error('downed-overlay visades inte: ' + JSON.stringify(p2));
    if (errors.length) throw new Error('console errors: ' + errors.slice(0, 5).join(' | '));
  },
};
