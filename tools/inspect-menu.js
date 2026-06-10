const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const out = { imgs: [], bgs: [], buttons: [], logo: null };
    // alla <img> med src
    for (const im of document.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      if (r.width > 4) out.imgs.push({ src: (im.src || '').slice(-60), w: Math.round(r.width), h: Math.round(r.height), id: im.id, cls: im.className.toString().slice(0, 30) });
    }
    // element med background-image
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.includes('url')) {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 40) out.bgs.push({ id: el.id, cls: el.className.toString().slice(0, 30), bg: cs.backgroundImage.slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    // logo-element (sök text WARPARTY eller id med logo)
    for (const el of document.querySelectorAll('[id*=logo],[class*=logo],h1,h2')) {
      const r = el.getBoundingClientRect();
      if (r.width > 20) { out.logo = { tag: el.tagName, id: el.id, cls: el.className.toString().slice(0, 40), html: el.innerHTML.slice(0, 120), w: Math.round(r.width), h: Math.round(r.height) }; break; }
    }
    // synliga meny-knappar
    for (const b of document.querySelectorAll('button, [role=button]')) {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      if (r.width > 30 && cs.display !== 'none' && cs.visibility !== 'hidden') {
        out.buttons.push({ id: b.id, txt: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), y: Math.round(r.y) });
      }
    }
    out.buttons.sort((a, b) => a.y - b.y);
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
