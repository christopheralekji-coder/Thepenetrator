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
    await wait(3200); // UNDER warmupen → drawEnemy (live) + skuggan ritas, så vi ser dem

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
      const types = ['grunt','soldier','brute','tank','runner','sniper','swordsman','robot','dog'];
      const ov = document.createElement('canvas'); ov.width = 820; ov.height = 200;
      ov.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;';
      document.body.appendChild(ov);
      const cx = ov.getContext('2d');
      cx.fillStyle = '#4a5a4a'; cx.fillRect(0, 0, 820, 200);
      // Byt global ctx till overlay + rita varje typ via _drawEnemyFx (pro-finishen)
      const savedCtx = (typeof ctx !== 'undefined') ? ctx : null;
      try {
        if (savedCtx !== null) {
          // hacka in vår overlay som global ctx
          eval('ctx = cx');
          let x = 70;
          for (const t of types) {
            const r = 26;
            const e = { r, type: t, color: '#4a5a30', facing: 0, walkAccum: 0, walkPhase: 0, contactCd: 1, flashUntil: 0, aiming: false, isBoss: false, isMiniBoss: false, miniIntensity: 0, name: '', stageAccent: '#7a5aaa', stageEdge: '#aaff5a', fuse: 1, x: 0, y: 0, camera: 0 };
            try { _drawEnemyFx(e, false, performance.now(), 0, true, x, 110, 0); } catch (err) { cx.fillStyle = '#f44'; cx.fillText('ERR ' + t, x, 110); }
            cx.fillStyle = '#cde'; cx.font = '10px sans-serif'; cx.textAlign = 'center'; cx.fillText(t, x, 185);
            x += 90;
          }
          eval('ctx = savedCtx');
        }
      } catch (e2) { cx.fillStyle = '#f44'; cx.fillText('FX-ERR ' + e2.message, 20, 20); }
    });
    await wait(300);
    await screenshot(p, 'solo-enemy-closeup');
    await screenshot(p, 'polish-showcase');
    const errs = consoleLog(p).filter(l => l.startsWith('[error]') || l.toLowerCase().includes('pixi') || l.toLowerCase().includes('webgl'));
    errs.slice(0, 12).forEach(e => console.log('  LOG ' + e));
  },
};
