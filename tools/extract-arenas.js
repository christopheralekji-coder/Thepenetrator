// Extraherar V1:s arena-data (väggar/spawns/mål/världsstorlek) → JSON för Godot-V2.
// Samlar även alla unika (kind, w, h) som ska bakas som sprites.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'data', 'arenas');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const res = await page.evaluate(() => {
    const names = ['TDM_ARENA', 'CTF_ARENA', 'KOTH_ARENA', 'SIEGE_ARENA', 'JUGGERNAUT_ARENA',
      'GUNGAME_ARENA', 'BATTLEROYALE_ARENA', 'HEIST_ARENA', 'CASTLEDEFENSE_ARENA', 'SURVIVORS_ARENA'];
    const out = { arenas: {}, kinds: {}, errs: [] };
    function safe(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
    function collectKinds(walls) {
      if (!Array.isArray(walls)) return;
      for (const w of walls) {
        if (!w || !w.kind) continue;
        const key = w.kind + '|' + Math.round(w.w || 0) + 'x' + Math.round(w.h || 0);
        out.kinds[key] = (out.kinds[key] || 0) + 1;
      }
    }
    for (const n of names) {
      const a = window[n];
      if (!a) { out.errs.push('missing ' + n); continue; }
      const s = safe(a);
      if (s) { out.arenas[n] = s; collectKinds(s.walls); }
      else out.errs.push('unserializable ' + n);
    }
    // GULAG_GAMES (array av mini-arenor)
    if (window.GULAG_GAMES) {
      const g = safe(window.GULAG_GAMES);
      if (g) { out.arenas['GULAG_GAMES'] = g; if (Array.isArray(g)) for (const m of g) collectKinds(m.walls); }
    }
    return out;
  });

  for (const [name, data] of Object.entries(res.arenas)) {
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(data));
  }
  // kinds-sammanfattning
  const kinds = Object.entries(res.kinds).sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(path.join(OUT, '_kinds.json'), JSON.stringify(res.kinds, null, 1));
  console.log('ARENAS:', Object.keys(res.arenas).join(', '));
  console.log('UNIQUE (kind|wxh):', kinds.length);
  console.log('errs:', res.errs.join(' | '));
  // unika kind-NAMN (utan storlek)
  const kindNames = new Set(Object.keys(res.kinds).map(k => k.split('|')[0]));
  console.log('UNIQUE KIND NAMES (' + kindNames.size + '):', [...kindNames].sort().join(', '));
  await browser.close();
})();
