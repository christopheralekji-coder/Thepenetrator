// GULAG-render-smoke: bootar spelet, verifierar att window.GULAG_GAMES laddar och att
// alla 6 gulag-arenor ritas utan runtime-fel (drawGulagArena + banner). Fångar JS-fel i
// den nya klient-koden utan att behöva köra en full BR-match.
'use strict';
module.exports = {
  description: 'Gulag: globals laddar + alla 6 arenor ritas utan fel',
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

    // 1) Globals laddade?
    const globals = await p.evaluate(() => ({
      hasGames: typeof window.GULAG_GAMES === 'object' && !!window.GULAG_GAMES,
      ids: window.GULAG_GAME_IDS || [],
      hasDraw: typeof drawGulagArena === 'function',
      hasBanner: typeof showGulagBanner === 'function',
      hasKnock: !!(window.W_BY_ID && window.W_BY_ID.gulag_knock),
    }));
    console.log('[GULAG] globals: ' + JSON.stringify(globals));
    expect(globals.hasGames).toBe(true);
    expect(globals.ids.length).toBe(6);
    expect(globals.hasDraw).toBe(true);
    expect(globals.hasBanner).toBe(true);

    // 2) Starta ett spel så render-loopen + ctx + state.player finns
    await p.click('#btn-start');
    await wait(2500);

    // 3) Tvinga gulag-state för varje spel, rendera, fånga ev. fel
    const results = await p.evaluate(async () => {
      const out = [];
      const ids = window.GULAG_GAME_IDS;
      // Sätt upp BR + en self-id + opponent i Coop.players
      state.battleroyaleActive = true;
      if (typeof Coop !== 'undefined') { Coop.myId = 'ME'; if (Coop.players && Coop.players.set) Coop.players.set('OPP', { x: 0, y: 0, hp: 100, weaponId: 'pistol' }); }
      for (const id of ids) {
        try {
          const g = window.GULAG_GAMES[id];
          const geo = g.build(0, 0);
          // serialisera som servern gör (platt geo räcker för rendering)
          state.gulag = {
            matchId: 'g1', game: id, gameName: g.name, emoji: g.emoji, hint: g.hint,
            noShoot: !!g.noShoot, loadoutWeapon: g.loadout.weaponId, geo,
            role: 'a', oppPid: 'OPP', platformR: geo.platformR || 0, ringR: geo.ringR || 0,
            fallen: [0, 1, 2], pu: id === 'frenzy' ? [{ id: 'pu1', x: 0, y: 0, kind: 'shield' }] : [],
            bombHolder: id === 'bombtag' ? 'ME' : null, bombMs: 8000, timeLeft: 20,
            speedMul: 1, knockUntil: 0, knockVX: 0, knockVY: 0, gunUntil: 0,
          };
          if (state.player) { state.player.x = geo.spawns[0].x; state.player.y = geo.spawns[0].y; state.player.spectating = false; state.player.hp = 100; }
          if (Coop.players) { const o = Coop.players.get('OPP'); if (o) { o.x = geo.spawns[1].x; o.y = geo.spawns[1].y; } }
          if (state.camera) { state.camera.x = geo.spawns[0].x - 426; state.camera.y = geo.spawns[0].y - 196; }
          showGulagBanner();
          if (typeof render === 'function') render();
          if (typeof updateGulagBanner === 'function') updateGulagBanner();
          out.push({ id, ok: true });
        } catch (e) {
          out.push({ id, ok: false, err: String(e && e.message || e) });
        }
      }
      // städa
      state.gulag = null; if (typeof hideGulagBanner === 'function') hideGulagBanner();
      return out;
    });
    results.forEach(r => console.log('[GULAG] render ' + r.id + ': ' + (r.ok ? 'OK' : 'FEL — ' + r.err)));

    // screenshot på en av arenorna (rita void igen)
    await p.evaluate(() => {
      const g = window.GULAG_GAMES.void; const geo = g.build(0, 0);
      state.battleroyaleActive = true;
      state.gulag = { matchId: 'g1', game: 'void', gameName: g.name, emoji: g.emoji, hint: g.hint, noShoot: false, loadoutWeapon: 'gulag_knock', geo, role: 'a', oppPid: 'OPP', platformR: geo.platformR, ringR: 0, fallen: [], pu: [], bombHolder: null, bombMs: 0, timeLeft: 22, speedMul: 1 };
      if (state.player) { state.player.x = geo.spawns[0].x; state.player.y = geo.spawns[0].y; state.player.spectating = false; }
      if (state.camera) { state.camera.x = geo.platformX - 426; state.camera.y = geo.platformY - 196; }
      showGulagBanner();
    });
    await wait(300);
    await screenshot(p, 'gulag-void-arena');

    // extra: oneshot (väggar/skydd) + floorlava (tiles) + bombtag
    for (const shot of ['oneshot', 'floorlava', 'bombtag']) {
      await p.evaluate((id) => {
        const g = window.GULAG_GAMES[id]; const geo = g.build(0, 0);
        state.battleroyaleActive = true;
        state.gulag = { matchId: 'g1', game: id, gameName: g.name, emoji: g.emoji, hint: g.hint, noShoot: !!g.noShoot, loadoutWeapon: g.loadout.weaponId, geo, role: 'a', oppPid: 'OPP', platformR: geo.platformR || 0, ringR: geo.ringR || 0, fallen: id === 'floorlava' ? [10, 11, 20, 30, 31] : [], pu: [], bombHolder: id === 'bombtag' ? 'ME' : null, bombMs: 7000, timeLeft: 18, speedMul: 1 };
        if (state.player) { state.player.x = geo.spawns[0].x; state.player.y = geo.spawns[0].y; state.player.spectating = false; }
        const o = Coop.players && Coop.players.get('OPP'); if (o) { o.x = geo.spawns[1].x; o.y = geo.spawns[1].y; }
        const cx2 = geo.bounds ? geo.bounds.x + geo.bounds.w / 2 : (geo.gridX + (geo.cols * geo.tile) / 2);
        const cy2 = geo.bounds ? geo.bounds.y + geo.bounds.h / 2 : (geo.gridY + (geo.rows * geo.tile) / 2);
        if (state.camera) { state.camera.x = cx2 - 426; state.camera.y = cy2 - 196; }
        showGulagBanner();
      }, shot);
      await wait(250);
      await screenshot(p, 'gulag-' + shot);
    }

    const errs = consoleLog(p).filter(l => l.startsWith('[error]'));
    errs.slice(0, 10).forEach(e => console.log('  CONSOLE ' + e));
    const renderFails = results.filter(r => !r.ok);
    expect(renderFails.length).toBe(0);
    expect(errs.length).toBe(0);
  },
};
