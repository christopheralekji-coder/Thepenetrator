// Fångar V1:s riktiga vapen-ikoner (WEAPON_ICON_SVGS) som transparenta PNG.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'weapons');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const ids = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'revolver', 'minigun', 'rocket',
    'burstpistol', 'grenadelauncher', 'lmg', 'ar', 'uzi', 'mp5', 'flamethrower', 'railgun', 'crossbow'];

  const present = await page.evaluate((ids) => {
    const out = { have: [], host: null };
    const host = document.createElement('div');
    host.id = '__wicons';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:transparent;';
    document.body.appendChild(host);
    for (const id of ids) {
      const html = (typeof getWeaponIconHTML === 'function') ? getWeaponIconHTML(id) : null;
      if (!html || html.length < 12 || !html.includes('<svg')) continue;
      const cell = document.createElement('div');
      cell.id = 'wic_' + id;
      cell.style.cssText = 'width:96px;height:96px;display:flex;align-items:center;justify-content:center;color:#e8eefc;background:transparent;';
      cell.innerHTML = html;
      const svg = cell.querySelector('svg');
      if (svg) { svg.setAttribute('width', '80'); svg.setAttribute('height', '80'); svg.style.width = '80px'; svg.style.height = '80px'; }
      host.appendChild(cell);
      out.have.push(id);
    }
    return out;
  }, ids);

  let n = 0;
  for (const id of present.have) {
    try {
      const loc = page.locator('#wic_' + id);
      if (await loc.count()) { await loc.screenshot({ path: path.join(OUT, id + '.png'), omitBackground: true }); n++; }
    } catch (e) { console.log('err', id, e.message.slice(0, 50)); }
  }
  console.log('HAVE:', present.have.join(', '));
  console.log('SAVED', n, '->', OUT);
  await browser.close();
})();
