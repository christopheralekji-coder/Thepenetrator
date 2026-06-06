// Repro + regression: "bara svart när jag öppnar".
// (1) vanlig story-start, (2) trainGulag-klientvägen (host→sim_start→br_started→gulag_start),
// (3) STATE-LÄCKA: efter gulag → starta vanlig mode igen och verifiera att den INTE är svart
//     (kamera måste re-clampa till kart-bounds när state.gulag rensats).
'use strict';
module.exports = {
  description: 'Repro black-screen: story + gulag-test + post-gulag-mode (state-läcka)',
  players: 1,
  async run({ pages, expect, screenshot, wait, waitFor, consoleLog }) {
    const [p] = pages;
    await p.setViewportSize({ width: 852, height: 393 });
    await waitFor(p, '#btn-start', 12000);
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true; s.tutorialDone = true; s.skipDialog = true; s.gold = 5000;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await p.reload();
    await waitFor(p, '#btn-start', 12000);
    await screenshot(p, 'bs-1-menu');

    // (1) VANLIG story-start
    await p.click('#btn-start');
    await wait(2500);
    const story = await p.evaluate(() => ({ mode: state.mode, hasPlayer: !!state.player, px: state.player && Math.round(state.player.x), py: state.player && Math.round(state.player.y), pending: state._pendingServerMode || null, gulag: !!state.gulag }));
    console.log('[BS] story: ' + JSON.stringify(story));
    await screenshot(p, 'bs-2-story');

    await p.reload();
    await waitFor(p, '#btn-start', 12000);

    // (2) trainGulag-klientvägen (samma som panel-knappen)
    await p.evaluate(() => { if (typeof trainGulag === 'function') trainGulag('void'); else console.error('[error] trainGulag saknas'); });
    await wait(9000); // host + sim_start + br_started + gulag_start
    const g = await p.evaluate(() => {
      const camFollows = state.player && state.camera &&
        Math.abs(state.camera.x + (window.innerWidth || 852) / 2 - state.player.x) < 1500 &&
        Math.abs(state.camera.y + (window.innerHeight || 393) / 2 - state.player.y) < 1500;
      return {
        mode: state.mode, hasPlayer: !!state.player,
        px: state.player && Math.round(state.player.x), py: state.player && Math.round(state.player.y),
        camx: state.camera && Math.round(state.camera.x), camy: state.camera && Math.round(state.camera.y),
        gulag: state.gulag ? state.gulag.game : null, camFollows: !!camFollows,
      };
    });
    console.log('[BS] gulag-test: ' + JSON.stringify(g));
    await screenshot(p, 'bs-3-gulagtest');
    // ASSERTS: positiv off-map-koord (ej Int16-klampad -32768) + kameran följer dit
    if (g.px == null || g.px < 11000 || g.px > 31000) console.log('[BS] FAIL: spelare ej på positiv off-map-koord: px=' + g.px);
    else console.log('[BS] PASS: spelare på off-map-koord px=' + g.px);
    if (!g.camFollows) console.log('[BS] FAIL: kameran följer EJ spelaren i gulag (svart skärm-risk) cam=' + g.camx + ',' + g.camy);
    else console.log('[BS] PASS: kameran följer spelaren i gulag');

    // (3) STATE-LÄCKA: tillbaka till meny → ny vanlig mode → får EJ vara svart
    await p.reload();
    await waitFor(p, '#btn-start', 12000);
    await p.click('#btn-start');
    await wait(2500);
    const after = await p.evaluate(() => {
      const w = (window.WORLD || {}).w || 10000, h = (window.WORLD || {}).h || 10000;
      const camInBounds = state.camera && state.camera.x >= -1 && state.camera.y >= -1 &&
        state.camera.x <= w && state.camera.y <= h;
      return {
        mode: state.mode, hasPlayer: !!state.player,
        px: state.player && Math.round(state.player.x), py: state.player && Math.round(state.player.y),
        camx: state.camera && Math.round(state.camera.x), camy: state.camera && Math.round(state.camera.y),
        gulag: !!state.gulag, camInBounds: !!camInBounds,
      };
    });
    console.log('[BS] post-gulag-mode: ' + JSON.stringify(after));
    await screenshot(p, 'bs-4-postgulag');
    if (after.gulag) console.log('[BS] FAIL: state.gulag läckte in i ny mode');
    else if (!after.camInBounds) console.log('[BS] FAIL: kameran ur kart-bounds i ny mode (svart) cam=' + after.camx + ',' + after.camy);
    else console.log('[BS] PASS: ny mode efter gulag OK (ingen state-läcka)');

    const errs = consoleLog(p).filter(l => l.startsWith('[error]'));
    errs.slice(0, 15).forEach(e => console.log('  CONSOLE ' + e));
    console.log('[BS] total console errors: ' + errs.length);
  },
};
