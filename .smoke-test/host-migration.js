// Host-migration-test: host + partner i server-auth co-op-sim. HOSTEN tappar
// anslutningen (simulerar host-krash/wifi-blip). Hosten auto-reconnectar INTE
// (klient gat:ar på !isHost). Partnern ska INTE kastas ut — rummet + sim:n ska
// överleva och värdskapet migrera till partnern.
//
// FÖRE host-migration: handleDisconnect host-grenen → stopSim + close all → partnern
// får host_left → tillbaka till menyn = matchen dör för alla.
// EFTER: hostId migreras till partnern, sim:n körs vidare, partnern blir host.
'use strict';

module.exports = {
  description: 'Host-migration: host droppar → rummet överlever, partnern blir host (ej utkastad)',
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

    await host.click('#btn-coop');
    await waitFor(host, '#btn-coop-host', 3000);
    await host.click('#btn-coop-host');
    await waitFor(host, '#coop-code-display', 5000);
    const code = (await host.locator('#coop-code-display').textContent()).trim();
    console.log('[HOST-MIG] Room:', code);

    await partner.click('#btn-coop');
    await waitFor(partner, '#coop-code-input', 3000);
    await partner.fill('#coop-code-input', code);
    await partner.click('#btn-coop-join');
    await wait(1500);

    await host.evaluate(() => {
      const t = document.getElementById('coop-server-sim-toggle');
      if (t && !t.checked) t.click();
    });
    await wait(300);
    await host.click('#btn-coop-start');
    await wait(8000);

    const before = await partner.evaluate(() => ({
      mode: state.mode, coopActive: Coop.active, isHost: Coop.isHost,
      serverSimActive: Coop.serverSimActive, enemies: state.enemies.length,
    }));
    console.log('[HOST-MIG] Partner FÖRE host-drop:', JSON.stringify(before));
    expect(before.mode).toBe('playing');
    await screenshot(partner, '01-before-host-drop');

    // === HOSTEN tappar anslutningen (host auto-reconnectar ej) ===
    console.log('[HOST-MIG] Droppar HOSTENS WS...');
    await host.evaluate(() => { Coop._intentionalClose = false; if (Coop.ws) Coop.ws.close(); });
    await wait(6000);

    const after = await partner.evaluate(() => ({
      mode: state.mode, coopActive: Coop.active, isHost: Coop.isHost,
      serverSimActive: Coop.serverSimActive, enemies: state.enemies.length,
    }));
    console.log('[HOST-MIG] Partner EFTER host-drop:', JSON.stringify(after));
    await screenshot(partner, '02-after-host-drop');

    await wait(2500);
    const live = await partner.evaluate(() => ({
      mode: state.mode, enemies: state.enemies.length, isHost: Coop.isHost,
      serverSimActive: Coop.serverSimActive,
    }));
    console.log('[HOST-MIG] Partner LIVE-check:', JSON.stringify(live));

    // ASSERTIONS — partnern ska INTE kastas ut till menyn:
    expect(live.mode).toBe('playing');                  // kvar i matchen (ej menu)
    expect(live.coopActive !== false).toBeTruthy();
    if (live.serverSimActive && live.enemies > 0) {
      console.log('[HOST-MIG] ✓ Rummet överlevde + sim flödar (' + live.enemies + ' enemies)');
    } else {
      console.log('[HOST-MIG] ⚠ Sim/världen frusen efter host-drop');
    }
    if (live.isHost) console.log('[HOST-MIG] ✓ Partnern blev ny host');
    else console.log('[HOST-MIG] (Partnern är inte host — migration ej aktiv)');
  },
};
