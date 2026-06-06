// Diagnostik: syns solo-story-enemies? Dumpar pixiState-sync-räknare + enemy-sample
// så vi ser EXAKT var Pixi-minion-synken faller (skippedNullSprite / spriteCount / id-kollision).
'use strict';
module.exports = {
  description: 'Diagnostik: solo-story enemy-rendering (Pixi-sync)',
  players: 1,
  async run({ pages, expect, screenshot, wait, waitFor, consoleLog }) {
    const [p] = pages;
    await p.setViewportSize({ width: 852, height: 393 });
    await waitFor(p, '#btn-start', 10000);
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('penetrator_save_v1') || '{}');
      s.introWatched = true; s.tutorialDone = true; s.skipDialog = true;
      s.gold = 5000; s.highWave = 5;
      localStorage.setItem('penetrator_save_v1', JSON.stringify(s));
    });
    await p.reload();
    await waitFor(p, '#btn-start', 10000);
    await p.click('#btn-start');
    await wait(9000); // låt enemies spawna + passera 3s pixi-warmup

    const diag = await p.evaluate(() => {
      const ps = (typeof pixiState !== 'undefined') ? pixiState : null;  // BART namn, ej window.
      const en = state.enemies || [];
      const minions = en.filter(e => e && !e.isBoss && !e.isMiniBoss && !e.dead);
      // Teleportera spelaren ovanpå första minionen så den centreras på skärmen
      if (minions[0] && state.player) { state.player.x = minions[0].x - 50; state.player.y = minions[0].y; }
      return {
        mode: state.mode,
        minionCount: minions.length,
        minionSample: minions.slice(0, 4).map(e => ({ type: e.type, _i: e._i, _idx: e._idx, _pixiId: e._pixiId })),
        pixiExists: !!ps,
        pixiReady: ps ? ps.ready : null,
        enemiesEnabled: ps ? ps.enemiesEnabled : null,
        spriteCount: (ps && ps.sprites && ps.sprites.enemies) ? ps.sprites.enemies.size : -1,
        debug: ps ? ps._debug : null,
        texBaked: ps ? ps.enemyTexturesBaked : null,
        texKeys: (ps && ps.enemyTextures) ? Object.keys(ps.enemyTextures).slice(0, 10) : null,
        warmupActive: state._pixiWarmupUntil ? (performance.now() < state._pixiWarmupUntil) : false,
      };
    });
    console.log('[ENEMY-RENDER] ' + JSON.stringify(diag, null, 1));
    // Rita ut bakade POLERADE sprites STORT så vi kan bedöma kontur + ljus
    await p.evaluate(() => {
      const ps = (typeof pixiState !== 'undefined') ? pixiState : null;
      if (!ps || !ps._enemyCanvases) return;
      const cans = Array.from(document.querySelectorAll('canvas'));
      const top = cans[cans.length - 1]; if (!top) return;
      const cx = top.getContext && top.getContext('2d'); if (!cx) return;
      cx.save(); cx.setTransform(1,0,0,1,0,0);
      cx.fillStyle = 'rgba(20,20,28,1)'; cx.fillRect(0, 0, 760, 150);
      const keys = ['grunt_a','soldier_a','brute_a','tank_a','ninja_a','robot_a','sniper_a','swordsman_a'];
      let x = 16;
      for (const k of keys) {
        const cv = ps._enemyCanvases[k];
        if (cv) { const sc = 110/cv.height; cx.drawImage(cv, x, 18, cv.width*sc, cv.height*sc); x += cv.width*sc + 6; }
      }
      cx.restore();
    });
    await wait(300);
    await screenshot(p, 'solo-enemy-closeup');
    await screenshot(p, 'polish-showcase');
    const errs = consoleLog(p).filter(l => l.startsWith('[error]') || l.toLowerCase().includes('pixi') || l.toLowerCase().includes('webgl'));
    errs.slice(0, 12).forEach(e => console.log('  LOG ' + e));
  },
};
