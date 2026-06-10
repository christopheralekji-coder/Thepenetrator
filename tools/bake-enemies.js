// Bakar V1:s RIKTIGA fiende-sprites (drawHumanEnemy via _bakeEnemyTexture) till PNG.
//   node tools/bake-enemies.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000); // PIXI måste hinna laddas (bake kräver det)

  const out = await page.evaluate(() => {
    const list = [
      { key: 'enemy_grunt', type: 'grunt', r: 22, color: '#4a5a30' },
      { key: 'enemy_runner', type: 'runner', r: 18, color: '#5a4a30' },
      { key: 'enemy_brute', type: 'brute', r: 28, color: '#6a4030' },
      { key: 'enemy_soldier', type: 'soldier', r: 20, color: '#5a8a3a' },
      { key: 'enemy_ninja', type: 'ninja', r: 18, color: '#1a1a2a' },
      // resterande story-typer (STAGES zone-pools)
      { key: 'enemy_dog', type: 'dog', r: 16, color: '#7a5a3a' },
      { key: 'enemy_robot', type: 'robot', r: 22, color: '#6a7a8a' },
      { key: 'enemy_shooter', type: 'shooter', r: 20, color: '#5a7a4a' },
      { key: 'enemy_sniper', type: 'sniper', r: 19, color: '#3a5a8a' },
      { key: 'enemy_bomber', type: 'bomber', r: 21, color: '#aa5a2a' },
      { key: 'enemy_healer', type: 'healer', r: 19, color: '#3aaa7a' },
      { key: 'enemy_summoner', type: 'summoner', r: 21, color: '#7a3aaa' },
      { key: 'enemy_swarmer', type: 'swarmer', r: 14, color: '#aaaa3a' },
      { key: 'enemy_swordsman', type: 'swordsman', r: 20, color: '#8a3a3a' },
      // minibossar (MINIBOSS_DRAW per power, r 32 som V1:s bake)
      { key: 'mb_caster', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'caster' },
      { key: 'mb_tank_charger', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'tank_charger' },
      { key: 'mb_cloaker', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'cloaker' },
      { key: 'mb_brute_charger', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'brute_charger' },
      { key: 'mb_gas_sniper', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'gas_sniper' },
      { key: 'mb_jetpack', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'jetpack' },
      { key: 'mb_plasma', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'plasma' },
      { key: 'mb_shielder', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'shielder' },
      { key: 'mb_avatar', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'avatar' },
    ];
    const res = { _hasPixi: typeof PIXI !== 'undefined', _meta: {} };
    for (const it of list) {
      try {
        const cv = _bakeEnemyTexture(it.type, { r: it.r, color: it.color, walkPhase: 0.6 });
        if (!cv) { res[it.key] = 'ERR:null(pixi?)'; continue; }
        res[it.key] = cv.toDataURL();
        res._meta[it.key] = { w: cv.width, h: cv.height, r: it.r };
      } catch (e) { res[it.key] = 'ERR:' + (e && e.message); }
    }
    return res;
  });

  // BOSSAR: BOSS_DRAW[bossKey] + glow-aura (samma som boss-wrappern game.js ~66242)
  const bosses = await page.evaluate(() => {
    const res = {};
    const savedCtx = ctx;
    for (const key of Object.keys(BOSS_CONFIGS)) {
      try {
        const cfg = BOSS_CONFIGS[key];
        const size = Math.ceil(cfg.r * 6);
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        ctx = cv.getContext('2d');
        const mockE = {
          r: cfg.r, bossKey: key, isBoss: true, type: 'boss',
          color: cfg.color, accent: cfg.accent, glow: cfg.glow, name: cfg.name,
          facing: 0, walkAccum: 0.4, walkPhase: 0.4, contactCd: 0, flashUntil: 0,
          hp: cfg.hp, maxHp: cfg.hp, x: 0, y: 0,
          stageAccent: '#7a5aaa', stageEdge: '#aaff5a',
        };
        ctx.save();
        ctx.translate(size / 2, size / 2);
        // glow-aura (statisk puls = 1)
        if (mockE.glow) {
          const grad = ctx.createRadialGradient(0, 0, cfg.r * 0.5, 0, 0, cfg.r * 2.4);
          grad.addColorStop(0, hexA(mockE.glow, 0.40));
          grad.addColorStop(0.6, hexA(mockE.glow, 0.15));
          grad.addColorStop(1, hexA(mockE.glow, 0));
          ctx.fillStyle = grad;
          ctx.fillRect(-cfg.r * 2.6, -cfg.r * 2.6, cfg.r * 5.2, cfg.r * 5.2);
        }
        const fn = (typeof BOSS_DRAW !== 'undefined' && BOSS_DRAW[key]) || drawBossDefault;
        fn(mockE, false, 0, 0, false);
        ctx.restore();
        res['boss_' + key] = cv.toDataURL();
      } catch (e) { res['boss_' + key] = 'ERR:' + (e && e.message); }
      ctx = savedCtx;
    }
    return res;
  });
  Object.assign(out, bosses);

  let saved = 0;
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { console.log('SKIP', k, String(v).slice(0, 70)); continue; }
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('hasPixi:', out._hasPixi, 'meta:', JSON.stringify(out._meta));
  console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
