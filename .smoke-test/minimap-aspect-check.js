// v1.667 verify: aspect-correct mode-aware minimap + getMinimapMeta + bot pathfinding wiring.
// Starts a solo match, drives frames (which call drawMiniMap every frame), verifies no
// throw, checks hitbox aspect in small vs big state, and that the button-anchor refs
// (center-x + bottom) are preserved between states.
'use strict';

module.exports = {
  description: 'Minimap aspect + mode title/legend renders without error; button anchor preserved',
  players: 1,
  async run({ pages, expect, screenshot, wait, waitFor }) {
    const [page] = pages;

    await waitFor(page, '#btn-start', 10000);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true; s.minimapHidden = false;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await page.reload();
    await waitFor(page, '#btn-start', 10000);
    await page.click('#btn-start');
    await wait(1500);
    await waitFor(page, 'canvas', 5000);

    // Dismiss tutorial / story dialog if present
    const tutBtn = page.locator('#btn-tut-close');
    if (await tutBtn.count() > 0 && await tutBtn.isVisible()) { await tutBtn.click(); await wait(400); }
    const dialogBtn = await page.evaluate(() =>
      (typeof storyDialogActive !== 'undefined' && storyDialogActive && storyDialogActive.btn) || null);
    if (dialogBtn) {
      const box = await page.locator('#game').boundingBox();
      await page.mouse.click(box.x + dialogBtn.x + dialogBtn.w / 2, box.y + dialogBtn.y + dialogBtn.h / 2);
      await wait(400);
    }
    await wait(1000);

    // Force SMALL minimap and drive frames so drawMiniMap runs many times.
    const smallProbe = await page.evaluate(() => {
      state.minimapBig = false; state._minimapZoomTarget = 0; state._minimapZoomT = 0;
      let err = null;
      try {
        let now = performance.now();
        for (let i = 0; i < 30; i++) { now += 16; runFrame(0.016, now); }
      } catch (e) { err = e.message + ' | ' + (e.stack || '').split('\n')[1]; }
      const hb = state._minimapHitbox;
      let meta = null;
      try { const st = getStage(state.wave); meta = getMinimapMeta(st); } catch (e) { meta = { err: e.message }; }
      return { err, hb, metaTitle: meta && meta.title, legendLen: meta && meta.legend && meta.legend.length };
    });
    console.log('[MM] small state:', JSON.stringify(smallProbe));
    expect(smallProbe.err).toBe(null);
    expect(!!smallProbe.hb).toBe(true);
    // Small (focus square view) → hitbox should be ~square
    expect(Math.abs(smallProbe.hb.w - smallProbe.hb.h) < 2).toBe(true);
    expect(typeof smallProbe.metaTitle).toBe('string');
    expect(smallProbe.legendLen).toBeGreaterThan(0);
    await screenshot(page, '01-minimap-small');

    const viewW = await page.evaluate(() => window.innerWidth);
    const MARGIN = 12;
    // The invariant that keeps action-buttons put: for envelope size = max(w,h),
    // center-x == viewW - margin - size/2 and bottom == 60 + size (the OLD square
    // formula). Both states must satisfy it → buttons behave exactly as before.
    const checkAnchor = (hb, label) => {
      const sz = Math.max(hb.w, hb.h);
      const cx = hb.x + hb.w / 2, bottom = hb.y + hb.h;
      const expCx = viewW - MARGIN - sz / 2, expBottom = 60 + sz;
      console.log(`[MM] anchor ${label}: cx ${cx.toFixed(1)} vs ${expCx.toFixed(1)}, bottom ${bottom.toFixed(1)} vs ${expBottom.toFixed(1)}`);
      return Math.abs(cx - expCx) < 1.5 && Math.abs(bottom - expBottom) < 1.5;
    };
    expect(checkAnchor(smallProbe.hb, 'small')).toBe(true);

    // Toggle to BIG map, let the zoom lerp settle, drive frames.
    const bigProbe = await page.evaluate(async () => {
      state.minimapBig = true; state._minimapZoomTarget = 1;
      let err = null;
      try {
        let now = performance.now();
        // 80 frames is plenty for the 0.18 lerp to reach ~1.0
        for (let i = 0; i < 80; i++) { now += 16; runFrame(0.016, now); }
      } catch (e) { err = e.message + ' | ' + (e.stack || '').split('\n')[1]; }
      const hb = state._minimapHitbox;
      const st = getStage(state.wave);
      return { err, hb, zoomT: state._minimapZoomT, worldW: st.worldW, worldH: st.worldH };
    });
    console.log('[MM] big state:', JSON.stringify(bigProbe));
    expect(bigProbe.err).toBe(null);
    expect(bigProbe.zoomT).toBeGreaterThan(0.9);

    // Button anchor preserved: big state must satisfy the same old-square formula.
    expect(checkAnchor(bigProbe.hb, 'big')).toBe(true);

    // Aspect correctness: big-map hitbox aspect should match world aspect (within rounding).
    const worldAspect = bigProbe.worldW / bigProbe.worldH;
    const boxAspect = bigProbe.hb.w / bigProbe.hb.h;
    console.log('[MM] aspect world', worldAspect.toFixed(3), 'box', boxAspect.toFixed(3));
    expect(Math.abs(worldAspect - boxAspect) < 0.06).toBe(true);
    await screenshot(page, '02-minimap-big-aspect');
  },
};
