// Omgång 1 perf-batch verifiering: adaptiv DPR, ljud-noise-buffer-återanvändning,
// crit-throttle, allokerings-hoists (longRangeIds/cheeseRange, BR-walls, dmg-siffror,
// survivors-pickup-Set). Mobil LANDSKAP (portrait triggar orientation-warning som
// blockerar klick). Bootar solo, stressar ljud, verifierar DPR-logik, kör riktig
// combat (håll eld med fiender runt spelaren) + verifierar inga console-fel.
'use strict';

module.exports = {
  description: 'Verify Omgång 1 perf-batch (DPR/audio/alloc-hoists) boots + combat without errors (mobile)',
  players: 1,
  async run({ pages, screenshot, wait, waitFor, expect }) {
    const [page] = pages;
    await page.setViewportSize({ width: 844, height: 390 }); // mobil LANDSKAP

    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

    await waitFor(page, '#btn-start', 10000);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await page.reload();
    await waitFor(page, '#btn-start', 10000);
    await page.click('#btn-start');
    await wait(2200);

    // Stäng tutorial + ev. story-dialog
    const tutBtn = page.locator('#btn-tut-close');
    if (await tutBtn.count() > 0 && await tutBtn.isVisible()) { await tutBtn.click(); await wait(400); }
    const dialogBtn = await page.evaluate(() =>
      (typeof storyDialogActive !== 'undefined' && storyDialogActive && storyDialogActive.btn) ? storyDialogActive.btn : null);
    if (dialogBtn) {
      const box = await page.locator('#game').boundingBox();
      await page.mouse.click(box.x + dialogBtn.x + dialogBtn.w / 2, box.y + dialogBtn.y + dialogBtn.h / 2);
      await wait(600);
    }
    await wait(1500);

    // --- DIAG: funktioner finns + i playing ---
    const ready = await page.evaluate(() => ({
      mode: typeof state !== 'undefined' && state.mode,
      player: typeof state !== 'undefined' && !!state.player,
      hasComputeDPR: typeof computeDPR === 'function',
      hasResize: typeof resize === 'function',
      hasAudio: typeof Audio !== 'undefined' && typeof Audio.shootGun === 'function',
      hasLongRange: typeof LONG_RANGE_WEAPON_IDS !== 'undefined',
      hasSurvSet: typeof _SURVIVORS_PICKUP_TYPES !== 'undefined',
    }));
    console.log('[PERF-DIAG] ready:', JSON.stringify(ready));
    expect(ready.hasComputeDPR).toBe(true);
    expect(ready.hasResize).toBe(true);
    expect(ready.hasLongRange).toBe(true);
    expect(ready.hasSurvSet).toBe(true);

    // --- ADAPTIV DPR: cap per kvalitets-tier + resize() utan krasch ---
    const dprCheck = await page.evaluate(() => {
      const raw = window.devicePixelRatio || 1;
      const orig = (typeof save !== 'undefined' && save) ? save.quality : undefined;
      const out = {};
      for (const q of ['high', 'medium', 'low']) {
        if (typeof save !== 'undefined' && save) save.quality = q;
        out[q] = { dpr: computeDPR() };
        if (typeof resize === 'function') resize(); // får ej kasta
        out[q].canvasW = document.getElementById('game').width;
      }
      // capet ska vara high>=medium>=low (vid raw>=2; vid raw=1 är alla = raw)
      out.expectedCaps = { high: Math.min(raw, 2), medium: Math.min(raw, 1.5), low: Math.min(raw, 1.25) };
      out.raw = raw;
      if (typeof save !== 'undefined' && save) save.quality = orig; // återställ
      if (typeof resize === 'function') resize();
      return out;
    });
    console.log('[PERF-DIAG] dpr:', JSON.stringify(dprCheck));
    expect(dprCheck.high.dpr).toBe(dprCheck.expectedCaps.high);
    expect(dprCheck.medium.dpr).toBe(dprCheck.expectedCaps.medium);
    expect(dprCheck.low.dpr).toBe(dprCheck.expectedCaps.low);

    // --- LJUD: stressa shootGun/hit/hitCrit/explosion (noise-buffer-återanvändning + crit-throttle) ---
    const audio = await page.evaluate(() => {
      if (typeof Audio === 'undefined' || !Audio.enabled) return { skipped: true };
      if (typeof Audio.init === 'function') Audio.init();
      let threw = null;
      try {
        for (let i = 0; i < 60; i++) { Audio.shootGun(); Audio.hit(); Audio.hitCrit(); }
        Audio.explosion(); Audio.kill();
      } catch (e) { threw = String(e); }
      return {
        threw,
        noiseBufBuilt: !!Audio._noiseBuf,
        activeNodes: Audio._activeNodes,
        activeNodesIsNum: typeof Audio._activeNodes === 'number',
      };
    });
    console.log('[PERF-DIAG] audio:', JSON.stringify(audio));
    if (!audio.skipped) {
      expect(audio.threw).toBe(null);
      expect(audio.activeNodesIsNum).toBe(true);
      expect(audio.activeNodes).toBeLessThan(70); // cap (60) ska hålla, inkl _noise nu
    }

    // --- COMBAT: placera fiender runt spelaren + håll eld → riktig kollisions-loop + dmg-siffror ---
    await page.evaluate(() => {
      if (!state.player || !state.enemies) return;
      const p = state.player;
      const R = 90;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        // klona en befintlig fiende-mall om möjligt, annars minimal
        const base = state.enemies[0] ? { ...state.enemies[0] } : { r: 12, hp: 40, maxHp: 40 };
        const e = Object.assign(base, {
          x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R,
          hp: 60, maxHp: 60, dead: false, _i: 90000 + k,
        });
        state.enemies.push(e);
      }
    });
    await screenshot(page, '01-enemies-around-player');

    // Håll eld i ~2.5s via fire-knappen
    const fireBox = await page.locator('#btn-fire').boundingBox().catch(() => null);
    if (fireBox) {
      await page.mouse.move(fireBox.x + fireBox.width / 2, fireBox.y + fireBox.height / 2);
      await page.mouse.down();
      await wait(2500);
      await page.mouse.up();
    } else {
      // fallback: håll skärm-tap i spel-ytan
      const gb = await page.locator('#game').boundingBox();
      await page.mouse.move(gb.x + gb.width * 0.5, gb.y + gb.height * 0.5);
      await page.mouse.down(); await wait(2500); await page.mouse.up();
    }
    await screenshot(page, '02-after-holding-fire');

    // Direkt dmg-siffer-stress (testa den allokeringsfria FIFO-capen)
    const dmg = await page.evaluate(() => {
      let threw = null;
      try {
        if (typeof spawnDamageNumber === 'function' && state.player) {
          for (let i = 0; i < 20; i++) spawnDamageNumber(state.player.x + i, state.player.y, 10 + i, i % 3 === 0);
        }
      } catch (e) { threw = String(e); }
      const dmgParticles = (state.particles || []).filter(p => p.isDamageNumber).length;
      return { threw, dmgParticles, bullets: (state.bullets || []).length, enemies: (state.enemies || []).length };
    });
    console.log('[PERF-DIAG] dmg/combat:', JSON.stringify(dmg));
    expect(dmg.threw).toBe(null);

    await wait(600);
    await screenshot(page, '03-final');

    const post = await page.evaluate(() => ({
      mode: typeof state !== 'undefined' && state.mode,
      hasPlayer: !!(typeof state !== 'undefined' && state.player),
    }));
    console.log('[PERF-DIAG] post:', JSON.stringify(post));
    console.log('[PERF-DIAG] console errors:', errors.length, JSON.stringify(errors.slice(0, 8)));
    if (errors.length) throw new Error('Console errors: ' + errors.slice(0, 5).join(' | '));
    if (post.mode !== 'playing') throw new Error('Spelet kraschade ur playing-läge (mode=' + post.mode + ')');
  },
};
