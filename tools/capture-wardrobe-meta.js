// Dumpar V1:s WARDROBE-metadata + presets (med V1:s presetCategory) till JSON.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'wardrobe');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const data = await page.evaluate(() => {
    const cats = ['skin', 'hair', 'facialHair', 'eyes', 'eyeShape', 'eyebrows', 'nose', 'mouth', 'scars',
      'shirt', 'pants', 'shoes', 'hat', 'glasses', 'bandana', 'cape'];
    const out = { categories: {}, presets: [], mascots: [] };
    for (const cat of cats) {
      if (!WARDROBE[cat]) continue;
      out.categories[cat] = WARDROBE[cat].map(o => ({
        id: o.id, name: o.name || o.id, color: o.color || null, style: o.style || null,
        mascot: o.mascot || null, brand: o.brand || null }));
    }
    // mascot-shirt-ids (hel-kropp-dräkter)
    for (const o of WARDROBE.shirt) if (o.mascot) out.mascots.push(o.id);
    if (typeof WARDROBE_PRESETS !== 'undefined') {
      for (const p of WARDROBE_PRESETS) {
        var cat = (typeof presetCategory === 'function') ? presetCategory(p) : 'classic';
        out.presets.push({ id: p.id, name: p.name, wardrobe: p.wardrobe, cat: cat });
      }
    }
    return out;
  });
  fs.writeFileSync(path.join(OUT, 'wardrobe.json'), JSON.stringify(data, null, 1));
  const counts = {}; for (const c in data.categories) counts[c] = data.categories[c].length;
  console.log('cats:', JSON.stringify(counts), 'presets:', data.presets.length, 'mascots:', data.mascots.length);
  await browser.close();
})();
