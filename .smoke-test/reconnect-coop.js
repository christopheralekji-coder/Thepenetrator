// Reconnect-test: host + partner i en server-auth co-op story-sim. Partnern tappar
// WS-anslutningen mitt i matchen (simulerar telefon som tappar signal) → klientens
// auto-reconnect kör → partnern ska ÅTER-ENTRA matchen, inte bli ett spöke.
//
// FÖRE co-op-late-join-fixen: partnern reconnectar men servern saknar late-join för
// co-op-wave → ingen sim_started → serverSimActive tappas / world fryser = spöke.
// EFTER: late-join-blocket skickar sim_started + current wave → partnern återansluts.
'use strict';

module.exports = {
  description: 'Reconnect: partner tappar WS mitt i co-op-match → ska återansluta, ej spöke',
  players: 2,
  async run({ pages, expect, screenshot, wait, waitFor, consoleLog }) {
    const [host, partner] = pages;
    await host.setViewportSize({ width: 852, height: 393 });
    await partner.setViewportSize({ width: 852, height: 393 });

    for (const p of [host, partner]) {
      await waitFor(p, '#btn-start', 10000);
      await p.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
        s.introWatched = true; s.tutorialDone = true; s.skipDialog = true;
        s.gold = 5000; s.highWave = 9;
        localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
      });
      await p.reload();
      await waitFor(p, '#btn-start', 10000);
    }

    // Host skapar rum
    await host.click('#btn-coop');
    await waitFor(host, '#btn-coop-host', 3000);
    await host.click('#btn-coop-host');
    await waitFor(host, '#coop-code-display', 5000);
    const code = (await host.locator('#coop-code-display').textContent()).trim();
    console.log('[RECONNECT] Room:', code);

    // Partner joinar
    await partner.click('#btn-coop');
    await waitFor(partner, '#coop-code-input', 3000);
    await partner.fill('#coop-code-input', code);
    await partner.click('#btn-coop-join');
    await wait(1500);

    // Server-sim är default PÅ (toggle redan checked). Starta direkt.
    await host.evaluate(() => {
      const t = document.getElementById('coop-server-sim-toggle');
      if (t && !t.checked) t.click();
    });
    await wait(300);
    await host.click('#btn-coop-start');
    await wait(8000);

    const before = await partner.evaluate(() => ({
      myId: Coop.myId, mode: state.mode, coopActive: Coop.active,
      serverSimActive: Coop.serverSimActive,
      hp: state.player ? state.player.hp : null,
      enemies: state.enemies.length,
    }));
    console.log('[RECONNECT] Partner FÖRE drop:', JSON.stringify(before));
    expect(before.mode).toBe('playing');
    expect(before.serverSimActive).toBeTruthy();
    await screenshot(partner, '01-partner-before-drop');

    // === Simulera anslutnings-drop (INTE intentional close → triggar auto-reconnect) ===
    console.log('[RECONNECT] Droppar partnerns WS...');
    await partner.evaluate(() => { if (Coop.ws) Coop.ws.close(); });

    // Vänta ut backoff (1s) + rejoin + late-join + några broadcasts
    await wait(6000);

    const after = await partner.evaluate(() => ({
      myId: Coop.myId, mode: state.mode, coopActive: Coop.active,
      serverSimActive: Coop.serverSimActive,
      hp: state.player ? state.player.hp : null,
      enemies: state.enemies.length,
      reconnectAttempt: Coop._reconnectAttempt || 0,
    }));
    console.log('[RECONNECT] Partner EFTER reconnect:', JSON.stringify(after));
    await screenshot(partner, '02-partner-after-reconnect');

    // Vänta lite till och mät enemies igen — bekräftar att world-broadcasts FLÖDAR
    // (en spöke får frusen/tom värld).
    await wait(2500);
    const live = await partner.evaluate(() => ({
      enemies: state.enemies.length, mode: state.mode,
      serverSimActive: Coop.serverSimActive,
    }));
    console.log('[RECONNECT] Partner LIVE-check:', JSON.stringify(live));

    // ASSERTIONS — partnern ska vara åter i matchen, inte spöke:
    expect(after.coopActive).toBeTruthy();              // fortfarande i coop
    expect(live.mode).toBe('playing');                  // fortfarande i spelet
    expect(live.serverSimActive).toBeTruthy();          // server-sim återansluten
    // Världen ska vara levande (enemies från server-broadcast), inte frusen tom.
    if (live.enemies > 0) {
      console.log('[RECONNECT] ✓ Världen flödar efter reconnect (' + live.enemies + ' enemies)');
    } else {
      console.log('[RECONNECT] ⚠ Inga enemies efter reconnect — möjlig spöke/frusen värld');
    }

    const errs = consoleLog(partner).filter(l => l.startsWith('[error]'));
    if (errs.length) { console.log('[RECONNECT] Partner-fel:'); errs.slice(0, 8).forEach(e => console.log('  ' + e)); }
  },
};
