// Extraherar STAGES (story/endless) + bakar varje unik stage-KIND:s terräng-golv.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ADIR = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'data', 'arenas');
const FDIR = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'floors');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const res = await page.evaluate(() => {
    function safe(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
    const out = { stages: [], floors: {} };
    if (typeof STAGES === 'undefined') return out;
    out.stages = safe(STAGES) || [];
    // unika kinds → baka terräng (representativ patch 1400x1400)
    const seen = {};
    const savedCtx = ctx;
    const SZ = 1400;
    for (const st of STAGES) {
      const kind = st.kind;
      if (!kind || seen[kind]) continue;
      seen[kind] = true;
      try {
        const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ;
        ctx = cv.getContext('2d');
        // sätt visible-region till patchen
        const _vw = (typeof viewW !== 'undefined') ? viewW : 0, _vh = (typeof viewH !== 'undefined') ? viewH : 0;
        try { viewW = SZ; viewH = SZ; } catch (e) {}
        if (typeof state !== 'undefined') state.camera = { x: 0, y: 0 };
        const stage = Object.assign({}, st, { worldW: SZ, worldH: SZ });
        try { drawStageTerrain(stage, 0, 0); } catch (e) {}
        try { viewW = _vw; viewH = _vh; } catch (e) {}
        ctx = savedCtx;
        out.floors['stage_' + kind] = cv.toDataURL();
      } catch (e) { ctx = savedCtx; out.floors['stage_' + kind] = 'ERR:' + e.message; }
    }
    return out;
  });

  fs.writeFileSync(path.join(ADIR, 'STAGES.json'), JSON.stringify(res.stages));
  let saved = 0;
  for (const [name, url] of Object.entries(res.floors)) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png')) { console.log('SKIP', name, String(url).slice(0, 50)); continue; }
    fs.writeFileSync(path.join(FDIR, name + '.png'), Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    saved++;
  }
  console.log('STAGES:', res.stages.length, 'kind-floors:', saved);
  console.log('kinds:', Object.keys(res.floors).join(', '));
  await browser.close();
})();
