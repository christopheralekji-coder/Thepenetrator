// Bakar V1:s EXAKTA pixel-art-sprites till PNG för Godot-V2.
// Laddar index.html (game.js definierar sprite-data + renderare globalt),
// kör de riktiga funktionerna, sparar PNG. Kör med lokal server igång.
//   node tools/bake-sprites.js
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
  await page.waitForTimeout(3500); // låt game.js definiera alla globaler

  const result = await page.evaluate(() => {
    const out = {};
    // default WarParty-soldat (grön väst). color=null → vestBase = cos.shirt.
    const cos = { skin: '#c89870', shirt: '#4a5a3a', bandana: '#c83030', accent: '#f0c020', pants: '#2a2418', hairColor: '#1a0a08' };
    function bake(name, arr, color) {
      try {
        const pal = _buildPlayerPalette(cos, color);
        return _renderPixelSpriteToCanvas(arr, pal, 1, false).toDataURL();
      } catch (e) { return 'ERR:' + (e && e.message); }
    }
    out.player_idle = bake('idle', PLAYER_SPRITE_IDLE, null);
    out.player_walk_a = bake('wa', PLAYER_SPRITE_WALK_A, null);
    out.player_walk_b = bake('wb', PLAYER_SPRITE_WALK_B, null);
    out._has = {
      idle: typeof PLAYER_SPRITE_IDLE !== 'undefined',
      render: typeof _renderPixelSpriteToCanvas !== 'undefined',
      pal: typeof _buildPlayerPalette !== 'undefined',
    };
    return out;
  });

  let saved = 0;
  for (const [k, v] of Object.entries(result)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) { console.log('SKIP', k, String(v).slice(0, 60)); continue; }
    const b64 = v.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(b64, 'base64'));
    saved++;
  }
  console.log('has:', JSON.stringify(result._has));
  console.log('pageerrors:', errs.slice(0, 5).join(' | '));
  console.log('SAVED', saved, '->', OUT);
  await browser.close();
})();
