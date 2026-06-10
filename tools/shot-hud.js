// Skärmdump av V1:s HUD i en live-match (mobil-landskap) + enumererar alla
// synliga knappar/HUD-element (id, text, position) så vi kan återskapa i V2.
//   node tools/shot-hud.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, 'hud-ref');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[c] ' + m.text().slice(0, 120)));
  page.on('pageerror', (e) => logs.push('[ERR] ' + (e.message || '').slice(0, 160)));

  await page.goto('http://localhost:8799/index.html?devboot=sandbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000); // låt matchen starta + HUD ritas
  await page.evaluate(() => { const t = document.getElementById('tutorial-overlay'); if (t) t.classList.add('hidden'); }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'hud-full.png') });

  // Enumerera synliga interaktiva HUD-element
  const els = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const cands = Array.from(document.querySelectorAll('button, [role=button], [onclick], [id*="btn"], [class*="btn"], canvas'));
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
      const id = el.id || '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push({
        tag: el.tagName.toLowerCase(),
        id: id,
        cls: (el.className && el.className.toString().slice(0, 40)) || '',
        txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
        title: el.title || el.getAttribute('aria-label') || '',
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  });

  fs.writeFileSync(path.join(OUT, 'hud-elements.json'), JSON.stringify(els, null, 2));
  console.log('ELEMENTS (' + els.length + '):');
  for (const e of els) console.log(`  [${e.tag}] #${e.id || '-'} "${e.txt}" ${e.title ? '("' + e.title + '")' : ''} @${e.x},${e.y} ${e.w}x${e.h}`);
  console.log('--- logs ---'); console.log(logs.slice(-8).join('\n'));
  await browser.close();
})();
