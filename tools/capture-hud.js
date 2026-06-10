// Fångar V1:s RIKTIGA HUD-knappar/joystick som transparenta PNG → Godot-V2.
// Döljer game-canvas + dynamiska barn (ammo/count) så vi får rena knapp-baser.
//   node tools/capture-hud.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'hud');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8799/index.html?devboot=sandbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // dölj spel-canvas + tutorial + dynamiska badge-barn så knapparna blir rena
  await page.evaluate(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    // KRITISKT: ta bort ytter-skuggor + pseudo-glow så Playwright inte fångar
    // dem i hörnen (= "fyrkant med färg-läckage"). Bara den rena cirkeln kvar.
    const st = document.createElement('style');
    st.textContent = '*{box-shadow:none !important;}'
      + '.action-btn::before,.action-btn::after,#joystick::before,#joystick::after,#grenade-switch::before,#grenade-switch::after{display:none !important;}';
    document.head.appendChild(st);
    // gör ALLA bakgrunder transparenta så knapparna isoleras (utom själva knapparna)
    document.querySelectorAll('div, section, main, .overlay, .screen').forEach((e) => {
      if (!e.closest('.action-btn') && !e.classList.contains('action-btn') && e.id !== 'joystick')
        e.style.background = 'transparent';
    });
    for (const id of ['game', 'pixi-canvas', 'hud-canvas', 'minimap-canvas', 'tutorial-overlay']) {
      const el = document.getElementById(id); if (el) el.style.visibility = 'hidden';
    }
    const hideSel = ['.fire-ammo', '.grenade-count'];
    for (const s of hideSel) document.querySelectorAll(s).forEach(e => e.style.visibility = 'hidden');
    document.querySelectorAll('.action-btn.dash, .action-btn.pvp-shield').forEach(e => {
      e.style.setProperty('--dash-cd', '1'); e.style.setProperty('--shield-cd', '1'); e.style.filter = 'none';
    });
  }).catch((e) => console.log('prep err', e.message));
  await page.waitForTimeout(400);

  const shots = [
    ['joystick_knob', '#joystick-knob'],
    ['btn_fire', '#btn-fire'],
    ['btn_dash', '#btn-dash'],
    ['btn_grenade', '#btn-grenade'],
    ['btn_shield', '#btn-pvp-shield'],
    ['btn_reload', '#btn-reload'],
    ['btn_emote', '#btn-emote'],
    ['btn_settings', '#btn-ingame-settings'],
    ['btn_weapon', '#btn-weapon-menu'],
  ];
  let n = 0;
  // joystick-bas: dölj knoben först
  try {
    await page.evaluate(() => { const k = document.getElementById('joystick-knob'); if (k) k.style.visibility = 'hidden'; });
    const j = page.locator('#joystick');
    if (await j.count()) { await j.screenshot({ path: path.join(OUT, 'joystick_base.png'), omitBackground: true }); n++; }
    await page.evaluate(() => { const k = document.getElementById('joystick-knob'); if (k) k.style.visibility = 'visible'; });
  } catch (e) { console.log('joystick err', e.message); }
  // granat-swap-chip separat (dölj den under granat-capture, fånga den egen)
  await page.evaluate(() => { const s = document.getElementById('grenade-switch'); if (s) s.style.visibility = 'hidden'; });
  for (const [name, sel] of shots) {
    try {
      const loc = page.locator(sel);
      if (await loc.count() === 0) { console.log('MISSING', sel); continue; }
      await loc.screenshot({ path: path.join(OUT, name + '.png'), omitBackground: true });
      n++;
    } catch (e) { console.log('err', sel, e.message.slice(0, 60)); }
  }
  // swap-chip
  try {
    await page.evaluate(() => { const s = document.getElementById('grenade-switch'); if (s) { s.style.visibility = 'visible'; s.style.display = 'flex'; } });
    const sw = page.locator('#grenade-switch');
    if (await sw.count()) { await sw.screenshot({ path: path.join(OUT, 'grenade_switch.png'), omitBackground: true }); n++; }
  } catch (e) { console.log('swap err', e.message.slice(0, 60)); }
  // rök-granat-knapp (V1 byter ikon till rök)
  try {
    await page.evaluate(() => {
      if (typeof state !== 'undefined') state.grenadeType = 'smoke';
      if (typeof updateGrenadeTypeChip === 'function') updateGrenadeTypeChip();
      const s = document.getElementById('grenade-switch'); if (s) s.style.visibility = 'hidden';
      document.querySelectorAll('.grenade-count').forEach(e => e.style.visibility = 'hidden');
    });
    await page.waitForTimeout(200);
    const gs = page.locator('#btn-grenade');
    if (await gs.count()) { await gs.screenshot({ path: path.join(OUT, 'btn_grenade_smoke.png'), omitBackground: true }); n++; }
  } catch (e) { console.log('smoke err', e.message.slice(0, 60)); }
  console.log('CAPTURED', n, '->', OUT);
  await browser.close();
})();
