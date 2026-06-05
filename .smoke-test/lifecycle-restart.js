// Livscykel-test (v1.769): exakt användarens scenario — spela en co-op-match, ALLA
// går till menyn (game-over → TILL MENY-path), starta sen ETT NYTT game. Före fixen
// revs co-op-sessionen aldrig ner på meny-vägen → orphan WS + Coop.active=true levde
// kvar → nästa game double-socketade / instant-death → man fick starta om appen.
// Detta test verifierar: (1) normal co-op-flöde funkar efter mina edits, (2) full
// teardown via btn-menu (Coop.disconnect: active=false, ws=null, slotToPeerId tom),
// (3) ETT NYTT game efteråt funkar felfritt (ingen double-socket / stale state).
'use strict';

module.exports = {
  description: 'Livscykel: co-op-match → alla till meny → NYTT game funkar (ingen app-omstart)',
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

    // Liten hjälpare: host skapar rum, partner joinar, host startar server-sim-match.
    async function hostJoinStart(label) {
      await host.click('#btn-coop');
      await waitFor(host, '#btn-coop-host', 4000);
      await host.click('#btn-coop-host');
      await waitFor(host, '#coop-code-display', 6000);
      const code = (await host.locator('#coop-code-display').textContent()).trim();
      console.log('[LIFECYCLE] ' + label + ' rum:', code);
      await partner.click('#btn-coop');
      await waitFor(partner, '#coop-code-input', 4000);
      await partner.fill('#coop-code-input', code);
      await partner.click('#btn-coop-join');
      await wait(1800);
      await host.evaluate(() => { const t = document.getElementById('coop-server-sim-toggle'); if (t && !t.checked) t.click(); });
      await wait(300);
      await host.click('#btn-coop-start');
      await wait(8000);
      return code;
    }

    // ===== GAME 1 =====
    await hostJoinStart('GAME1');
    const g1 = await Promise.all([host, partner].map(p => p.evaluate(() => ({
      mode: state.mode, coopActive: Coop.active, serverSim: Coop.serverSimActive,
      hp: state.player ? state.player.hp : null,
    }))));
    console.log('[LIFECYCLE] GAME1 host:', JSON.stringify(g1[0]), 'partner:', JSON.stringify(g1[1]));
    expect(g1[0].mode).toBe('playing');
    expect(g1[1].mode).toBe('playing');
    expect(g1[0].serverSim).toBeTruthy();
    await screenshot(host, '01-game1-host');

    // ===== ALLA TILL MENY (game-over → TILL MENY-path = btn-menu) =====
    // Kör handlern direkt (även om gameover-overlay inte visas exekverar den teardown).
    console.log('[LIFECYCLE] Alla trycker TILL MENY (btn-menu)...');
    for (const p of [partner, host]) {
      await p.evaluate(() => { const b = document.getElementById('btn-menu'); if (b) b.click(); });
      await wait(800);
    }
    await wait(2000);
    const torn = await Promise.all([host, partner].map(p => p.evaluate(() => ({
      coopActive: Coop.active, wsNull: Coop.ws === null, mode: state.mode,
      slots: Coop.slotToPeerId ? Coop.slotToPeerId.size : -1,
      simConfirmed: Coop._simStartedConfirmed,
    }))));
    console.log('[LIFECYCLE] Efter teardown host:', JSON.stringify(torn[0]), 'partner:', JSON.stringify(torn[1]));
    // KRITISKT: sessionen ska vara helt nedriven (annars orphan → måste starta om appen)
    expect(torn[0].coopActive).toBe(false);
    expect(torn[0].wsNull).toBeTruthy();
    expect(torn[1].coopActive).toBe(false);
    expect(torn[1].wsNull).toBeTruthy();
    // slotToPeerId ska vara tömd (fix #3) — ej stale slot→peer in i nästa match
    expect(torn[0].slots).toBe(0);
    await screenshot(host, '02-after-teardown-menu');

    // ===== GAME 2 (NYTT game utan att starta om appen) =====
    await hostJoinStart('GAME2');
    const g2 = await Promise.all([host, partner].map(p => p.evaluate(() => ({
      mode: state.mode, coopActive: Coop.active, serverSim: Coop.serverSimActive,
      hp: state.player ? state.player.hp : null,
      players: Coop.players ? Coop.players.size : -1,
    }))));
    console.log('[LIFECYCLE] GAME2 host:', JSON.stringify(g2[0]), 'partner:', JSON.stringify(g2[1]));
    // DET STORA: nytt game funkar felfritt efter teardown (ingen double-socket / stale)
    expect(g2[0].mode).toBe('playing');
    expect(g2[1].mode).toBe('playing');
    expect(g2[0].serverSim).toBeTruthy();
    expect(g2[1].serverSim).toBeTruthy();
    // Ingen instant-death: hp full vid start
    if (g2[0].hp != null) expect(g2[0].hp).toBeGreaterThan(0);
    if (g2[1].hp != null) expect(g2[1].hp).toBeGreaterThan(0);
    await screenshot(host, '03-game2-host');
    await screenshot(partner, '04-game2-partner');

    // Inga console-errors under hela cykeln
    for (const [name, p] of [['host', host], ['partner', partner]]) {
      const errs = consoleLog(p).filter(l => l.startsWith('[error]'));
      if (errs.length) { console.log('[LIFECYCLE] ' + name + '-fel:'); errs.slice(0, 8).forEach(e => console.log('  ' + e)); }
      expect(errs.length).toBe(0);
    }
    console.log('[LIFECYCLE] ✓ Full cykel game1 → meny → game2 utan fel eller app-omstart');
  },
};
