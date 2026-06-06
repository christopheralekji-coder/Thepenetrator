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
    await wait(700); // låt några frames rita med spelaren på enemyn
    await screenshot(p, 'solo-enemy-closeup');
    const errs = consoleLog(p).filter(l => l.startsWith('[error]') || l.toLowerCase().includes('pixi') || l.toLowerCase().includes('webgl'));
    errs.slice(0, 12).forEach(e => console.log('  LOG ' + e));
  },
};
