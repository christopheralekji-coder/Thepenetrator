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

    // (2b) RÖRELSE-TEST: kan spelaren faktiskt röra sig i gulag?
    const lockState = await p.evaluate(() => ({
      countdownEndAt: state._countdownEndAt || 0, now: Math.round(performance.now()),
      countdownLabel: state._countdownLabel || null,
      inputLocked: typeof isInputLocked === 'function' ? isInputLocked() : 'n/a',
      px0: state.player && Math.round(state.player.x), py0: state.player && Math.round(state.player.y),
    }));
    console.log('[BS] lock-state: ' + JSON.stringify(lockState));
    // JOYSTICK-vägen (mobil): sätt input.moveX direkt + logga positions-kurva
    const mvBefore = await p.evaluate(() => ({ x: state.player.x, y: state.player.y }));
    const curve = [];
    for (let t = 0; t < 10; t++) {
      await p.evaluate(() => { input.moveX = 1; input.moveY = 0; }); // joystick höger
      await wait(150);
      const pt = await p.evaluate(() => ({ x: Math.round(state.player.x), inSent: (Coop._lastInputSent && Coop._lastInputSent.x) || null }));
      curve.push(pt.x);
    }
    await p.evaluate(() => { input.moveX = 0; input.moveY = 0; });
    const probe = await p.evaluate(() => ({
      serverSimActive: Coop.serverSimActive, active: Coop.active, inLobby: Coop.inLobby, isHost: Coop.isHost,
      lastInputSent: Coop._lastInputSent || null, lastBroadcast: Math.round(Coop._lastBroadcast || 0),
      spectating: state.player && state.player.spectating, hasWs: !!Coop.ws,
      wsBuffered: Coop.ws ? Coop.ws.bufferedAmount : 'no-ws',
    }));
    console.log('[BS] probe: ' + JSON.stringify(probe));
    const mvAfter = await p.evaluate(() => ({ x: state.player.x, y: state.player.y, lastSent: Coop._lastInputSent ? Coop._lastInputSent.x : null }));
    const moved = Math.hypot(mvAfter.x - mvBefore.x, mvAfter.y - mvBefore.y);
    console.log('[BS] joystick-curve x: ' + curve.join(' → '));
    console.log('[BS] movement: before=' + Math.round(mvBefore.x) + ' after=' + Math.round(mvAfter.x) + ' lastSentToServer=' + mvAfter.lastSent + ' dist=' + Math.round(moved));
    if (moved < 80) console.log('[BS] FAIL: spelaren kunde INTE röra sig i gulag (dist=' + Math.round(moved) + ')');
    else console.log('[BS] PASS: spelaren rörde sig i gulag (dist=' + Math.round(moved) + ')');

    // (2c) AIM-TEST: kan spelaren sikta? (gulag early-return skippade tidigare aim-koden)
    const aim = await p.evaluate(async () => {
      input.moveX = 0; input.moveY = 0;
      input.fireJoyActive = true; input.aimX = 0; input.aimY = 1; // sikta nedåt (PI/2)
      await new Promise(r => setTimeout(r, 200));
      const a1 = state.player.aimAngle;
      input.aimX = 1; input.aimY = 0; // sikta höger (0)
      await new Promise(r => setTimeout(r, 200));
      const a2 = state.player.aimAngle;
      input.fireJoyActive = false; input.aimX = 0; input.aimY = 0;
      return { a1: Math.round(a1 * 100) / 100, a2: Math.round(a2 * 100) / 100 };
    });
    const aimWorks = Math.abs(aim.a1 - 1.57) < 0.3 && Math.abs(aim.a2) < 0.3;
    console.log('[BS] aim: nedåt=' + aim.a1 + ' (vänta ~1.57) höger=' + aim.a2 + ' (vänta ~0)');
    console.log(aimWorks ? '[BS] PASS: spelaren kan sikta i gulag' : '[BS] FAIL: aim svarar inte på input i gulag');

    // (2d) HP/MAXHP-TEST: maxHp ska matcha loadout (void=100, men kolla att den är satt + finit)
    const hp = await p.evaluate(() => ({ hp: state.player.hp, maxHp: state.player.maxHp, shield: state.player.shield, maxShield: state.player.maxShield }));
    console.log('[BS] hp-state: ' + JSON.stringify(hp));
    const hpOk = hp.maxHp === 100 && hp.hp <= hp.maxHp && hp.hp > 0;
    console.log(hpOk ? '[BS] PASS: HP/maxHp korrekt satt (void 100/100)' : '[BS] FAIL: HP/maxHp fel: ' + JSON.stringify(hp));

    // (2e) SKJUT-TEST (The Void gulag_knock): kan man avfyra skott?
    const fire = await p.evaluate(async () => {
      const pre = { ammo: state.player.ammo, reloading: state.player.reloading, weaponId: state.player.weaponId, bullets0: state.bullets.length, shotsSent0: (typeof _simDiag !== 'undefined' ? _simDiag.shotsSent : -1) };
      input.fireJoyActive = true; input.aimX = 1; input.aimY = 0; input.firing = true;
      let maxBullets = state.bullets.length;
      for (let k = 0; k < 12; k++) { await new Promise(r => setTimeout(r, 80)); if (state.bullets.length > maxBullets) maxBullets = state.bullets.length; }
      input.firing = false; input.fireJoyActive = false; input.aimX = 0; input.aimY = 0;
      return { pre, maxBullets, shotsSent1: (typeof _simDiag !== 'undefined' ? _simDiag.shotsSent : -1), ammoAfter: state.player.ammo };
    });
    const shotsFired = (fire.shotsSent1 - fire.pre.shotsSent0);
    console.log('[BS] fire: pre-ammo=' + fire.pre.ammo + ' reloading=' + fire.pre.reloading + ' weapon=' + fire.pre.weaponId + ' maxBullets=' + fire.maxBullets + ' shotsSent=' + shotsFired + ' ammoAfter=' + fire.ammoAfter);
    if (fire.maxBullets > fire.pre.bullets0 || shotsFired > 0) console.log('[BS] PASS: The Void avfyrar skott');
    else console.log('[BS] FAIL: The Void avfyrar INGA skott (ammo=' + fire.pre.ammo + ' reloading=' + fire.pre.reloading + ')');
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

    // (5) SPECTATE-LÄCKA: simulera att man speccar (spectating=true + specTarget) och
    // verifiera att clearSpectateState() + teardown nollar det (annars = fast i nästa match).
    const spec = await p.evaluate(() => {
      state.player.spectating = true; state.player.specTarget = 'ghost-peer';
      const had = { spectating: state.player.spectating, specTarget: state.player.specTarget };
      if (typeof clearSpectateState === 'function') clearSpectateState();
      return { had, after: { spectating: state.player.spectating, specTarget: state.player.specTarget } };
    });
    console.log('[BS] spectate-clear: före=' + JSON.stringify(spec.had) + ' efter=' + JSON.stringify(spec.after));
    if (spec.after.spectating || spec.after.specTarget) console.log('[BS] FAIL: spectate-state läckte (ej nollad)');
    else console.log('[BS] PASS: clearSpectateState nollar spectating+specTarget');

    const errs = consoleLog(p).filter(l => l.startsWith('[error]'));
    errs.slice(0, 15).forEach(e => console.log('  CONSOLE ' + e));
    console.log('[BS] total console errors: ' + errs.length);
  },
};
