// Mäter exakta rects + computed styles för coop-dialogen & lobbyn (V2-paritet).
// node tools/measure-coop.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.click('#btn-coop', { force: true });
  await page.waitForTimeout(700);
  const m = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return { sel: s, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      font: st.fontSize, weight: st.fontWeight, color: st.color, bg: st.backgroundColor || st.background.slice(0, 60),
      ls: st.letterSpacing, radius: st.borderRadius, border: st.border };
  }, sel);
  const sels1 = ['#coop-screen > h2', '#coop-screen > .menu-sub', '#coop-init', '#btn-coop-host', '#coop-code-input',
    '#btn-coop-join', '#public-rooms-list', '.prf-btn', '#btn-public-rooms-refresh', '#btn-coop-close'];
  for (const s of sels1) console.log(JSON.stringify(await m(s)));
  // hosta → lobby
  await page.click('#btn-coop-host', { force: true });
  await page.waitForTimeout(2500);
  const sels2 = ['#coop-lobby', '.lobby-room-card', '.lobby-room-meta', '#coop-code-display', '#btn-copy-code',
    '#coop-lobby .lobby-card-title', '#lobby-player-count', '.lobby-name-label', '#coop-name-input',
    '#coop-player-list .player-row', '#lobby-match-info', '.match-info-chip', '.lobby-tab', '.lobby-tab.active',
    '#lobby-mode-buttons button', '#lobby-diff-buttons button', '#coop-difficulty-info', '.lobby-advanced',
    '#btn-coop-start', '#coop-status'];
  for (const s of sels2) console.log(JSON.stringify(await m(s)));
  await browser.close();
})();
