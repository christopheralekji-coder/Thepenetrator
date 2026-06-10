// Fångar V1:s riktiga vapen-ikoner (WEAPON_ICON_SVGS + emoji-fallback) som
// transparenta PNG till V2 (assets/weapons/<id>.png, 96x96).
//
// BUGGFIX (H10, V2-audit 2026-06-10): gamla versionen staplade 42 fixed-pos-celler
// vertikalt — bara de ~7 första rymdes i 720px-viewporten, och position:fixed kan
// inte scrollas in i vy → element-screenshot av cell 9-42 fångade bara body-
// bakgrunden (#0a0508) = helsvarta PNG:er. Dessutom var bakgrunden opak (baked-in).
// Nu: EN återanvänd cell på (0,0), allt annat i body göms, html/body görs
// transparenta → omitBackground ger äkta transparens.
//
//   Set-Location <V1-dir>; python -m http.server 8799
//   node tools/capture-weapon-icons.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'weapons');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // sidan kan själv-navigera (versions-reload) strax efter load — vänta ut den
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => typeof getWeaponIconHTML === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(500);

  // ALLA vapen ur shared/weapons-data (42 st) — SVG där den finns, annars emoji
  const ids = require('../shared/weapons-data').WEAPONS.map(w => w.id);

  // Göm spelets UI + gör sidan transparent, skapa EN cell på (0,0) i viewporten.
  await page.evaluate(() => {
    for (const el of Array.from(document.body.children)) el.style.display = 'none';
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const cell = document.createElement('div');
    cell.id = '__wicon_cell';
    cell.style.cssText = 'position:fixed;left:0;top:0;width:96px;height:96px;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'color:#e8eefc;background:transparent;z-index:99999;';
    document.body.appendChild(cell);
  });

  let saved = 0;
  const failed = [];
  for (const id of ids) {
    const kind = await page.evaluate((id) => {
      let cell = document.getElementById('__wicon_cell');
      if (!cell) { // spelets JS kan ha rört body — återskapa
        cell = document.createElement('div');
        cell.id = '__wicon_cell';
        cell.style.cssText = 'position:fixed;left:0;top:0;width:96px;height:96px;'
          + 'display:flex;align-items:center;justify-content:center;'
          + 'color:#e8eefc;background:transparent;z-index:99999;';
        document.body.appendChild(cell);
      }
      const html = getWeaponIconHTML(id);
      if (html && html.includes('<svg')) {
        cell.style.fontSize = '';
        cell.innerHTML = html;
        const svg = cell.querySelector('svg');
        // 80px ikon i 96px cell (samma som gamla baken); CSS-klassen .weapon-svg
        // (36px + drop-shadow) overridas inline.
        svg.setAttribute('width', '80'); svg.setAttribute('height', '80');
        svg.style.width = '80px'; svg.style.height = '80px';
        svg.style.display = 'block'; svg.style.margin = '0';
        return 'svg';
      }
      // emoji-fallback (turret_mg/turret_rocket/gulag_knock) — V1 visar emojin
      cell.innerHTML = '';
      cell.style.fontSize = '68px';
      cell.style.lineHeight = '96px';
      cell.textContent = html || '🔫';
      return 'emoji';
    }, id);
    try {
      await page.locator('#__wicon_cell').screenshot({ path: path.join(OUT, id + '.png'), omitBackground: true });
      saved++;
      if (kind === 'emoji') console.log('  (emoji)', id);
    } catch (e) {
      failed.push(id + '=' + e.message.slice(0, 60));
    }
  }
  console.log('FAILED:', failed.join(' | ') || '(inga)');
  console.log('SAVED', saved, '/', ids.length, '->', OUT);
  await browser.close();
})();
