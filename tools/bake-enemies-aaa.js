// AAA-ENHANCE-BAKE: bakar V1:s riktiga fiende-sprites (samma ritkod, samma geometri-kontrakt
// som tools/bake-enemies.js) och lägger sedan ett "trippel-AAA"-förbättringslager OVANPÅ:
//   - äkta walk-frames (phase = walkPhase*2π → benen alternerar i _a/_b, fötter på samma y)
//   - typ-specifika feta detaljer (ritade i V1:s tecknade stil, med outlines)
//   - _polishSprite-pass (V1:s egen kontur+ljus) EFTER detaljerna → detaljerna får samma finish
//   - rim-light uppe-vänster längs silhuettens alfa-kant + AO vid fötter + 1px outline-boost
//   - minibossar: kraftigare rim + power-färgad energi-detalj
//   - bossar: 2-lagers glow, material-sheen, vinjett, rim + tematiska accenter per boss
// GEOMETRI-KONTRAKT: exakt samma canvas-dims/ankare/filnamn som dagens PNG:er (asserts i Node).
//   node tools/bake-enemies-aaa.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets');
const SHEET = path.resolve(__dirname, 'aaa-contact-sheet.png');

function pngDims(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

(async () => {
  if (!fs.existsSync(OUT)) { console.error('OUT saknas:', OUT); process.exit(1); }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000); // PIXI måste hinna laddas

  // ============ ENEMIES + MINIBOSSAR ============
  const FRAMES = [['', 0], ['_a', 0.35], ['_b', 0.85]];
  const out = await page.evaluate(({ FRAMES }) => {
    const TAU = Math.PI * 2;
    const list = [
      { key: 'enemy_grunt', type: 'grunt', r: 22, color: '#4a5a30' },
      { key: 'enemy_runner', type: 'runner', r: 18, color: '#5a4a30' },
      { key: 'enemy_brute', type: 'brute', r: 28, color: '#6a4030' },
      { key: 'enemy_soldier', type: 'soldier', r: 20, color: '#5a8a3a' },
      { key: 'enemy_ninja', type: 'ninja', r: 18, color: '#1a1a2a' },
      { key: 'enemy_dog', type: 'dog', r: 16, color: '#7a5a3a' },
      { key: 'enemy_robot', type: 'robot', r: 22, color: '#6a7a8a' },
      { key: 'enemy_shooter', type: 'shooter', r: 20, color: '#5a7a4a' },
      { key: 'enemy_sniper', type: 'sniper', r: 19, color: '#3a5a8a' },
      { key: 'enemy_bomber', type: 'bomber', r: 21, color: '#aa5a2a' },
      { key: 'enemy_healer', type: 'healer', r: 19, color: '#3aaa7a' },
      { key: 'enemy_summoner', type: 'summoner', r: 21, color: '#7a3aaa' },
      { key: 'enemy_swarmer', type: 'swarmer', r: 14, color: '#aaaa3a' },
      { key: 'enemy_swordsman', type: 'swordsman', r: 20, color: '#8a3a3a' },
      { key: 'mb_caster', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'caster' },
      { key: 'mb_tank_charger', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'tank_charger' },
      { key: 'mb_cloaker', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'cloaker' },
      { key: 'mb_brute_charger', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'brute_charger' },
      { key: 'mb_gas_sniper', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'gas_sniper' },
      { key: 'mb_jetpack', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'jetpack' },
      { key: 'mb_plasma', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'plasma' },
      { key: 'mb_shielder', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'shielder' },
      { key: 'mb_avatar', type: 'grunt', r: 32, color: '#aa3a3a', miniPower: 'avatar' },
    ];

    // ---------- RÅ-BAKE (samma som _bakeEnemyTexture men med RIKTIG phase) ----------
    function bakeRaw(it, phase) {
      const r = it.r;
      const size = Math.ceil(r * 5);
      const cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      const c = cv.getContext('2d');
      const mockE = {
        r: r, type: it.type, color: it.color, facing: 0,
        walkAccum: phase, walkPhase: phase,
        contactCd: phase !== 0 ? 0 : 1.0,
        flashUntil: 0, fuse: 1.0, aiming: false, isBoss: false,
        isMiniBoss: !!it.miniPower, miniPower: it.miniPower || null, miniIntensity: 0.6,
        name: '', stageAccent: '#7a5aaa', stageEdge: '#aaff5a', x: 0, y: 0,
      };
      const saved = ctx; ctx = c;
      try {
        c.save();
        c.translate(size / 2, size / 2);
        if (mockE.isMiniBoss && MINIBOSS_DRAW[mockE.miniPower]) {
          MINIBOSS_DRAW[mockE.miniPower](mockE, false, 0, phase, phase !== 0);
        } else if (it.type === 'dog') drawDog(mockE, false, phase);
        else if (it.type === 'robot') drawRobot(mockE, false, 0, phase);
        else drawHumanEnemy(mockE, false, 0, phase);
        // typ-detaljer i SAMMA koordinatsystem (translate står kvar)
        if (mockE.isMiniBoss) miniDetail(c, mockE.miniPower, r);
        else typeDetail(c, it.type, r, phase);
        c.restore();
      } finally { ctx = saved; }
      return cv;
    }

    // ---------- generella hjälpare ----------
    function outl(c, w) { c.strokeStyle = 'rgba(6,4,10,0.9)'; c.lineWidth = w || 1.2; }
    function glowDot(c, x, y, rad, color, blur) {
      c.save(); c.fillStyle = color; c.shadowColor = color; c.shadowBlur = blur || 8;
      c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x, y, Math.max(1, rad * 0.42), 0, TAU); c.fill();
      c.restore();
    }

    // ---------- TYP-SPECIFIKA DETALJER (ritas i body-space, enhet r) ----------
    function typeDetail(c, type, r, phase) {
      const swing = Math.sin(phase);
      if (type === 'grunt') {
        // SLITEN VÄST-FICKA på plate-carriern (höger bröst)
        c.fillStyle = '#3a4830'; c.fillRect(r * 0.14, -r * 0.46, r * 0.22, r * 0.18);
        c.fillStyle = '#162012'; c.fillRect(r * 0.14, -r * 0.46, r * 0.22, r * 0.05);
        outl(c, 1); c.strokeRect(r * 0.14, -r * 0.46, r * 0.22, r * 0.18);
        c.fillStyle = '#5a4a30'; c.fillRect(r * 0.23, -r * 0.43, r * 0.04, r * 0.03); // knapp
        // SLITAGE-REPOR på västen
        c.strokeStyle = '#4a5a36'; c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-r * 0.24, -r * 0.06); c.lineTo(-r * 0.05, r * 0.06);
        c.moveTo(-r * 0.30, r * 0.02); c.lineTo(-r * 0.16, r * 0.12);
        c.stroke();
        // JORDFLÄCKAR (byxor + känga + torso-nederkant)
        const lfx = r * 0.05 - swing * r * 0.25, lbx = -r * 0.18 + swing * r * 0.25;
        c.fillStyle = 'rgba(46,34,14,0.55)';
        c.beginPath(); c.ellipse(lfx + r * 0.04, r * 0.98, r * 0.10, r * 0.06, 0.4, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(lbx - r * 0.02, r * 0.66, r * 0.08, r * 0.05, -0.3, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(-r * 0.30, r * 0.30, r * 0.09, r * 0.05, 0.2, 0, TAU); c.fill();
        c.fillStyle = 'rgba(60,46,20,0.45)';
        c.beginPath(); c.ellipse(lfx + r * 0.10, r * 1.28, r * 0.11, r * 0.05, 0, 0, TAU); c.fill();
      }
      else if (type === 'runner') {
        const sw = Math.sin(phase * 1.5);
        const lfx = r * 0.06 - sw * r * 0.35, lbx = -r * 0.16 + sw * r * 0.35;
        // SVETTBAND — klarröd-orange (poppar mot khaki) m. fladdrande knut
        c.fillStyle = '#cc4422'; c.fillRect(-r * 0.29, -r * 0.81, r * 0.56, r * 0.08);
        c.fillStyle = '#e86a3a'; c.fillRect(-r * 0.29, -r * 0.81, r * 0.56, r * 0.03);
        outl(c, 1); c.strokeRect(-r * 0.29, -r * 0.81, r * 0.56, r * 0.08);
        c.fillStyle = '#cc4422';
        c.beginPath();
        c.moveTo(-r * 0.29, -r * 0.78); c.lineTo(-r * 0.52, -r * 0.70 + sw * r * 0.04);
        c.lineTo(-r * 0.46, -r * 0.62 + sw * r * 0.04); c.lineTo(-r * 0.27, -r * 0.73);
        c.closePath(); c.fill();
        // FARTRÄNDER på byxbenen (ljusa racing-ränder, följer benen per frame)
        c.fillStyle = '#e8d8b0';
        c.fillRect(lfx - r * 0.02, r * 0.33, r * 0.05, r * 0.78);
        c.fillRect(lbx - r * 0.02, r * 0.33, r * 0.05, r * 0.78);
        // (lösa motion-streaks bakom benen togs bort: _polishSprite konturerade dem
        //  till grå stavar — rand-på-ben läser bättre i spel-storlek)
      }
      else if (type === 'brute') {
        // ÄRR ÖVER BRÖSTPLÅTEN (ljust, taggigt + stygn)
        c.strokeStyle = '#c97a6a'; c.lineWidth = 2.2; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-r * 0.34, -r * 0.36); c.lineTo(-r * 0.14, -r * 0.16);
        c.lineTo(-r * 0.18, -r * 0.08); c.lineTo(r * 0.10, r * 0.14);
        c.stroke();
        c.strokeStyle = '#7a3a30'; c.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          const t = 0.25 + i * 0.25;
          const x = -r * 0.34 + t * r * 0.44, y = -r * 0.36 + t * r * 0.50;
          c.beginPath(); c.moveTo(x - r * 0.05, y + r * 0.05); c.lineTo(x + r * 0.05, y - r * 0.05); c.stroke();
        }
        c.lineCap = 'butt';
        // NITARMBAND på bakre handleden
        c.fillStyle = '#1a1208'; c.fillRect(-r * 0.20, r * 0.04, r * 0.22, r * 0.09);
        outl(c, 1); c.strokeRect(-r * 0.20, r * 0.04, r * 0.22, r * 0.09);
        c.fillStyle = '#c8ccd2';
        for (let i = 0; i < 3; i++) {
          c.beginPath(); c.arc(-r * 0.15 + i * r * 0.06, r * 0.085, r * 0.022, 0, TAU); c.fill();
        }
        // TJOCKARE KÄK-SKUGGA (brutal haka)
        c.fillStyle = 'rgba(90,50,30,0.55)';
        c.beginPath(); c.ellipse(-r * 0.01, -r * 0.63, r * 0.20, r * 0.07, 0, 0, Math.PI); c.fill();
        c.fillStyle = 'rgba(40,20,12,0.40)';
        c.beginPath(); c.ellipse(0, -r * 0.68, r * 0.23, r * 0.05, 0, 0, Math.PI); c.fill();
      }
      else if (type === 'soldier') {
        // AXELPLATTA/EPÅLETT m. guldkant + frans
        c.fillStyle = '#2a3414'; c.fillRect(-r * 0.46, -r * 0.64, r * 0.26, r * 0.11);
        c.fillStyle = '#ffd54a'; c.fillRect(-r * 0.46, -r * 0.64, r * 0.26, r * 0.025);
        outl(c, 1); c.strokeRect(-r * 0.46, -r * 0.64, r * 0.26, r * 0.11);
        c.strokeStyle = '#ffd54a'; c.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.moveTo(-r * 0.44 + i * r * 0.06, -r * 0.53);
          c.lineTo(-r * 0.44 + i * r * 0.06, -r * 0.47);
          c.stroke();
        }
        // VÄST-POUCHES (2 st höger bröst, ovanför bandolieret)
        for (const px of [r * 0.06, r * 0.24]) {
          c.fillStyle = '#1a2410'; c.fillRect(px, -r * 0.32, r * 0.15, r * 0.17);
          c.fillStyle = '#2e3c1c'; c.fillRect(px, -r * 0.32, r * 0.15, r * 0.05);
          outl(c, 1); c.strokeRect(px, -r * 0.32, r * 0.15, r * 0.17);
        }
        // BERET-REM under hakan (hjälmrem-detalj)
        c.strokeStyle = '#0a0a08'; c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(-r * 0.28, -r * 1.00); c.lineTo(-r * 0.12, -r * 0.70); c.stroke();
        c.fillStyle = '#3a3028'; c.fillRect(-r * 0.16, -r * 0.70, r * 0.05, r * 0.04);
      }
      else if (type === 'ninja') {
        // GLÖDANDE CYAN-ÖGA m. bloom (över röda ögat i slitsen)
        const g = c.createRadialGradient(r * 0.10, -r * 0.90, 0, r * 0.10, -r * 0.90, r * 0.26);
        g.addColorStop(0, 'rgba(80,235,255,0.55)'); g.addColorStop(1, 'rgba(80,235,255,0)');
        c.fillStyle = g; c.fillRect(r * -0.16, -r * 1.16, r * 0.52, r * 0.52);
        c.save(); c.shadowColor = '#3ae8ff'; c.shadowBlur = 7;
        c.fillStyle = '#3ae8ff'; c.fillRect(r * 0.05, -r * 0.935, r * 0.10, r * 0.06);
        c.fillStyle = '#eaffff'; c.fillRect(r * 0.075, -r * 0.925, r * 0.05, r * 0.032);
        c.restore();
        // HALSDUK-SVANS — två flödande röda band bakåt (svajar m. phase)
        const fl = Math.sin(phase * 1.4) * r * 0.06;
        c.fillStyle = '#aa1818';
        c.beginPath();
        c.moveTo(-r * 0.28, -r * 0.78);
        c.quadraticCurveTo(-r * 0.58, -r * 0.66 + fl, -r * 0.80, -r * 0.46 + fl);
        c.lineTo(-r * 0.72, -r * 0.38 + fl);
        c.quadraticCurveTo(-r * 0.52, -r * 0.56 + fl, -r * 0.26, -r * 0.71);
        c.closePath(); c.fill();
        c.fillStyle = '#cc3030';
        c.beginPath();
        c.moveTo(-r * 0.27, -r * 0.74);
        c.quadraticCurveTo(-r * 0.50, -r * 0.50 - fl, -r * 0.64, -r * 0.26 - fl);
        c.lineTo(-r * 0.57, -r * 0.22 - fl);
        c.quadraticCurveTo(-r * 0.44, -r * 0.44 - fl, -r * 0.24, -r * 0.66);
        c.closePath(); c.fill();
        outl(c, 1);
        c.beginPath();
        c.moveTo(-r * 0.28, -r * 0.78);
        c.quadraticCurveTo(-r * 0.58, -r * 0.66 + fl, -r * 0.80, -r * 0.46 + fl);
        c.stroke();
      }
      else if (type === 'shooter') {
        const gunY = -r * 0.10;
        // AMMO-BÄLTE diagonalt över bröstet (mässingspatroner)
        c.strokeStyle = '#1a1208'; c.lineWidth = 3.4;
        c.beginPath(); c.moveTo(-r * 0.40, -r * 0.44); c.lineTo(r * 0.36, r * 0.08); c.stroke();
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5;
          const x = -r * 0.40 + t * r * 0.76, y = -r * 0.44 + t * r * 0.52;
          c.save(); c.translate(x, y); c.rotate(0.6);
          c.fillStyle = '#d8a040'; c.fillRect(-r * 0.02, -r * 0.055, r * 0.04, r * 0.11);
          c.fillStyle = '#8a5a20'; c.fillRect(-r * 0.02, -r * 0.055, r * 0.04, r * 0.03);
          c.restore();
        }
        // PIPMETALL-SHEEN + receiver-glint på AK:n
        c.fillStyle = 'rgba(176,190,200,0.65)';
        c.fillRect(r * 0.54, gunY + 0.5, r * 0.50, 1.2);
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillRect(r * 0.02, gunY - r * 0.05, r * 0.05, 1.4);
      }
      else if (type === 'sniper') {
        const gunY = -r * 0.12;
        // SCOPE-GLINT (diagonal anamorf glint + cyan bloom på linsen — EJ kors-form)
        const gx = r * 0.37, gy = gunY - r * 0.21;
        const g = c.createRadialGradient(gx, gy, 0, gx, gy, r * 0.13);
        g.addColorStop(0, 'rgba(150,235,255,0.85)'); g.addColorStop(1, 'rgba(150,235,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(gx, gy, r * 0.13, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(200,245,255,0.95)'; c.lineWidth = 1.3; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(gx - r * 0.10, gy + r * 0.10); c.lineTo(gx + r * 0.10, gy - r * 0.10);
        c.moveTo(gx - r * 0.035, gy - r * 0.035); c.lineTo(gx + r * 0.035, gy + r * 0.035);
        c.stroke(); c.lineCap = 'butt';
        c.fillStyle = '#fff'; c.beginPath(); c.arc(gx, gy, 1.3, 0, TAU); c.fill();
        // GHILLIE-FRANSAR — hängande strån från torso-nederkant + hattbrätte
        c.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const x = -r * 0.38 + i * r * 0.12;
          c.strokeStyle = i % 2 ? '#3a4a26' : '#5a6a3a'; c.lineWidth = 1.8;
          c.beginPath(); c.moveTo(x, r * 0.36); c.lineTo(x + r * 0.04, r * 0.52 + (i % 3) * r * 0.04); c.stroke();
        }
        for (let i = 0; i < 4; i++) {
          const x = -r * 0.40 + i * r * 0.26;
          c.strokeStyle = i % 2 ? '#5a6a3a' : '#3a4a26'; c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(x, -r * 0.97); c.lineTo(x - r * 0.03, -r * 0.82); c.stroke();
        }
        c.lineCap = 'butt';
      }
      else if (type === 'bomber') {
        // SYNLIG RUND BOMB i famnen m. tänd lunta + varningsränder
        const bx = r * 0.32, by = r * 0.06, br = r * 0.26;
        c.fillStyle = '#16161c'; c.beginPath(); c.arc(bx, by, br, 0, TAU); c.fill();
        // varningsränder (orange, klippta till klotet)
        c.save(); c.beginPath(); c.arc(bx, by, br, 0, TAU); c.clip();
        c.fillStyle = '#ff8a20';
        c.save(); c.translate(bx, by); c.rotate(-0.5);
        c.fillRect(-br, -br * 0.32, br * 2, br * 0.20);
        c.fillRect(-br, br * 0.18, br * 2, br * 0.20);
        c.restore(); c.restore();
        // klot-highlight + outline
        c.fillStyle = 'rgba(120,128,150,0.5)';
        c.beginPath(); c.arc(bx - br * 0.35, by - br * 0.38, br * 0.22, 0, TAU); c.fill();
        outl(c, 1.4); c.beginPath(); c.arc(bx, by, br, 0, TAU); c.stroke();
        // topp-propp + lunta + gnista
        c.fillStyle = '#3a3a44'; c.fillRect(bx - r * 0.05, by - br - r * 0.06, r * 0.10, r * 0.07);
        c.strokeStyle = '#caa46a'; c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(bx, by - br - r * 0.05);
        c.quadraticCurveTo(bx + r * 0.10, by - br - r * 0.20, bx + r * 0.04, by - br - r * 0.30);
        c.stroke();
        glowDot(c, bx + r * 0.04, by - br - r * 0.32, r * 0.05, '#ffd54a', 9);
        // handen framför klotet igen (håller bomben)
        c.fillStyle = '#8a6242';
        c.beginPath(); c.arc(bx - br * 0.25, by + br * 0.72, r * 0.09, 0, TAU); c.fill();
        outl(c, 1); c.beginPath(); c.arc(bx - br * 0.25, by + br * 0.72, r * 0.09, 0, TAU); c.stroke();
      }
      else if (type === 'healer') {
        // VITT KORS-EMBLEM på bröstet (cirkel + rött kors — tydlig medic vid 36px)
        const ex = r * 0.07, ey = -r * 0.34;
        c.fillStyle = '#eeeeee'; c.beginPath(); c.arc(ex, ey, r * 0.12, 0, TAU); c.fill();
        outl(c, 1); c.beginPath(); c.arc(ex, ey, r * 0.12, 0, TAU); c.stroke();
        c.fillStyle = '#ff2828';
        c.fillRect(ex - r * 0.075, ey - r * 0.022, r * 0.15, r * 0.045);
        c.fillRect(ex - r * 0.022, ey - r * 0.075, r * 0.045, r * 0.15);
        // FLASKA i bältet (grön healing-vätska)
        c.fillStyle = '#bfe8d8'; c.fillRect(-r * 0.34, r * 0.10, r * 0.11, r * 0.17);
        c.fillStyle = '#3aaa6a'; c.fillRect(-r * 0.34, r * 0.18, r * 0.11, r * 0.09);
        c.fillStyle = '#1a1a14'; c.fillRect(-r * 0.32, r * 0.06, r * 0.07, r * 0.05);
        outl(c, 1); c.strokeRect(-r * 0.34, r * 0.10, r * 0.11, r * 0.17);
        // SVAG GRÖN AURA-RAND (subtil inre rand som förstärker signatur-ringen)
        c.save(); c.strokeStyle = 'rgba(140,255,140,0.18)'; c.lineWidth = 1.4;
        c.shadowColor = '#9aff5a'; c.shadowBlur = 4;
        c.setLineDash([r * 0.45, r * 0.30]);
        c.beginPath(); c.arc(0, 0, r * 1.28, 0, TAU); c.stroke();
        c.restore();
      }
      else if (type === 'summoner') {
        // STORA GLÖDANDE RUNOR på manteln (riktiga glyfer, inte pixlar)
        c.save(); c.strokeStyle = '#c060ff'; c.shadowColor = '#aa3aff'; c.shadowBlur = 6;
        c.lineWidth = 1.6; c.lineCap = 'round';
        // glyf 1: uppochnervänt Y
        c.beginPath();
        c.moveTo(-r * 0.16, r * 0.48); c.lineTo(-r * 0.16, r * 0.62);
        c.moveTo(-r * 0.22, r * 0.42); c.lineTo(-r * 0.16, r * 0.48); c.lineTo(-r * 0.10, r * 0.42);
        c.stroke();
        // glyf 2: triangel m. streck
        c.beginPath();
        c.moveTo(r * 0.10, r * 0.72); c.lineTo(r * 0.18, r * 0.86); c.lineTo(r * 0.02, r * 0.86);
        c.closePath(); c.stroke();
        // glyf 3: sicksack
        c.beginPath();
        c.moveTo(-r * 0.10, r * 1.00); c.lineTo(-r * 0.02, r * 1.06); c.lineTo(-r * 0.10, r * 1.12); c.lineTo(-r * 0.02, r * 1.18);
        c.stroke();
        c.restore(); c.lineCap = 'butt';
        // GLÖDANDE ORB i framhanden (lila energi-klot m. ring-fragment)
        const ox = r * 0.36, oy = -r * 0.06;
        const g = c.createRadialGradient(ox, oy, 0, ox, oy, r * 0.26);
        g.addColorStop(0, 'rgba(200,120,255,0.6)'); g.addColorStop(1, 'rgba(170,58,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(ox, oy, r * 0.26, 0, TAU); c.fill();
        glowDot(c, ox, oy, r * 0.11, '#aa3aff', 12);
        c.save(); c.strokeStyle = '#d090ff'; c.shadowColor = '#aa3aff'; c.shadowBlur = 5; c.lineWidth = 1.3;
        c.beginPath(); c.arc(ox, oy, r * 0.18, -0.6, 1.2); c.stroke();
        c.beginPath(); c.arc(ox, oy, r * 0.18, 2.4, 3.8); c.stroke();
        c.restore();
      }
      else if (type === 'swarmer') {
        // EXTRA ANTENNER m. glödande knoppar (från huvudet, bakåtsvepta)
        c.strokeStyle = '#2a1810'; c.lineWidth = 1.7; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(r * 0.38, -r * 0.28);
        c.quadraticCurveTo(r * 0.28, -r * 0.56, r * 0.12, -r * 0.66);
        c.stroke();
        c.beginPath();
        c.moveTo(r * 0.46, -r * 0.26);
        c.quadraticCurveTo(r * 0.44, -r * 0.58, r * 0.30, -r * 0.72);
        c.stroke();
        c.lineCap = 'butt';
        glowDot(c, r * 0.12, -r * 0.66, r * 0.045, '#ff8a3a', 6);
        glowDot(c, r * 0.30, -r * 0.72, r * 0.045, '#ff8a3a', 6);
        // EXTRA BEN-LED markeringar (ljus chitin-knä på frambenen)
        c.fillStyle = '#7a5028';
        c.beginPath(); c.arc(-r * 0.44, r * 0.52, r * 0.05, 0, TAU); c.fill();
        c.beginPath(); c.arc(-r * 0.26, r * 0.52, r * 0.05, 0, TAU); c.fill();
        // GLANSIGA ÖGON — vita catchlights på de 4 glödögonen
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fillRect(r * 0.41, -r * 0.175, 1.2, 1.2);
        c.fillRect(r * 0.47, -r * 0.195, 1.2, 1.2);
        c.fillRect(r * 0.41, -r * 0.095, 1.2, 1.2);
        c.fillRect(r * 0.47, -r * 0.115, 1.2, 1.2);
      }
      else if (type === 'swordsman') {
        // KATANA-SKIDA på ryggen (BAKOM kroppen via destination-over)
        c.save(); c.globalCompositeOperation = 'destination-over';
        c.strokeStyle = '#241018'; c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-r * 0.58, -r * 1.02); c.lineTo(-r * 0.10, r * 0.34); c.stroke();
        c.strokeStyle = '#7a1818'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(-r * 0.55, -r * 0.97); c.lineTo(-r * 0.12, r * 0.28); c.stroke();
        c.lineCap = 'butt';
        // skid-ände (guldkappa)
        c.fillStyle = '#caa44a'; c.fillRect(-r * 0.15, r * 0.26, r * 0.10, r * 0.10);
        c.restore();
        // axelrem över bröstharnesket
        c.strokeStyle = '#3a1a08'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(-r * 0.32, -r * 0.52); c.lineTo(r * 0.20, r * 0.12); c.stroke();
        // PANNBAND/PLYM-SVANSAR — röda tygband från hjälmens bakkant
        const fl = Math.sin(phase) * r * 0.05;
        for (const [y0, len, col] of [[-r * 1.02, r * 0.50, '#7a1818'], [-r * 0.96, r * 0.40, '#cc3030']]) {
          c.fillStyle = col;
          c.beginPath();
          c.moveTo(-r * 0.34, y0);
          c.quadraticCurveTo(-r * 0.34 - len * 0.6, y0 + r * 0.16 + fl, -r * 0.34 - len, y0 + r * 0.34 + fl);
          c.lineTo(-r * 0.34 - len + r * 0.07, y0 + r * 0.42 + fl);
          c.quadraticCurveTo(-r * 0.34 - len * 0.5, y0 + r * 0.26 + fl, -r * 0.30, y0 + r * 0.08);
          c.closePath(); c.fill();
        }
      }
      else if (type === 'dog') {
        // PÄLS-TOFSAR längs rygglinjen + brösttofs
        c.fillStyle = '#3a2010';
        for (let i = 0; i < 5; i++) {
          const x = -r * 0.50 + i * r * 0.22;
          c.beginPath();
          c.moveTo(x, -r * 0.33);
          c.lineTo(x + r * 0.05, -r * 0.48 - (i % 2) * r * 0.04);
          c.lineTo(x + r * 0.11, -r * 0.33);
          c.closePath(); c.fill();
        }
        c.beginPath();
        c.moveTo(r * 0.60, r * 0.30); c.lineTo(r * 0.70, r * 0.46); c.lineTo(r * 0.78, r * 0.32);
        c.closePath(); c.fill();
        // TAND-GLIMT — vit huggtand under nosen + nos-glint
        c.fillStyle = '#f2f2ea';
        c.beginPath();
        c.moveTo(r * 1.64, -r * 0.20); c.lineTo(r * 1.68, -r * 0.08); c.lineTo(r * 1.73, -r * 0.20);
        c.closePath(); c.fill();
        outl(c, 0.8);
        c.beginPath();
        c.moveTo(r * 1.64, -r * 0.20); c.lineTo(r * 1.68, -r * 0.08); c.lineTo(r * 1.73, -r * 0.20);
        c.closePath(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.fillRect(r * 1.81, -r * 0.375, 1.4, 1.4);
        // HALSBAND-NIT — mässingsnit + ring på kragen
        c.fillStyle = '#d8a040';
        c.beginPath(); c.arc(r * 1.10, -r * 0.30, r * 0.035, 0, TAU); c.fill();
        c.strokeStyle = '#d8a040'; c.lineWidth = 1.3;
        c.beginPath(); c.arc(r * 1.10, -r * 0.14, r * 0.05, 0, TAU); c.stroke();
      }
      else if (type === 'robot') {
        // REAKTOR-KÄRNA boost — extra glow-ring + roterings-fragment runt kärnan
        const cx0 = 0, cy0 = -r * 0.35;
        const g = c.createRadialGradient(cx0, cy0, 0, cx0, cy0, r * 0.34);
        g.addColorStop(0, 'rgba(80,210,255,0.45)'); g.addColorStop(1, 'rgba(80,210,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(cx0, cy0, r * 0.34, 0, TAU); c.fill();
        c.save(); c.strokeStyle = '#7adfff'; c.shadowColor = '#3acaff'; c.shadowBlur = 6; c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx0, cy0, r * 0.23, -0.8, 0.9); c.stroke();
        c.beginPath(); c.arc(cx0, cy0, r * 0.23, 2.2, 3.9); c.stroke();
        c.restore();
        // ANTENN m. blink-lampa på huvudet
        c.strokeStyle = '#2a2a34'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-r * 0.12, -r * 1.06); c.lineTo(-r * 0.20, -r * 1.34); c.stroke();
        glowDot(c, -r * 0.20, -r * 1.37, r * 0.045, '#ff4040', 7);
        // PANEL-LINJER + NITAR på nedre torson
        c.strokeStyle = '#1a1a22'; c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-r * 0.30, r * 0.02); c.lineTo(r * 0.30, r * 0.02);
        c.moveTo(-r * 0.10, -r * 0.18); c.lineTo(-r * 0.10, r * 0.24);
        c.moveTo(r * 0.14, r * 0.02); c.lineTo(r * 0.14, r * 0.24);
        c.stroke();
        c.fillStyle = '#9a9aaa';
        for (const [nx, ny] of [[-0.30, -0.14], [0.30, -0.14], [-0.30, 0.20], [0.30, 0.20]]) {
          c.beginPath(); c.arc(r * nx, r * ny, 1.3, 0, TAU); c.fill();
        }
      }
    }

    // ---------- MINIBOSS POWER-DETALJER (r=32) ----------
    function miniDetail(c, power, r) {
      const TAUm = TAU;
      if (power === 'caster') {
        // runcirkel-fragment runt fötterna (lila)
        c.save(); c.strokeStyle = '#c060ff'; c.shadowColor = '#aa3aff'; c.shadowBlur = 8; c.lineWidth = 2;
        c.beginPath(); c.arc(0, r * 1.05, r * 0.62, 0.25, 1.25); c.stroke();
        c.beginPath(); c.arc(0, r * 1.05, r * 0.62, 1.9, 2.9); c.stroke();
        c.fillStyle = '#c060ff';
        c.fillRect(-r * 0.55, r * 1.16, 3, 3); c.fillRect(r * 0.50, r * 1.16, 3, 3);
        c.restore();
      } else if (power === 'plasma') {
        // kärn-glöd på bröstet + plasma-åder
        const g = c.createRadialGradient(0, -r * 0.20, 0, 0, -r * 0.20, r * 0.34);
        g.addColorStop(0, 'rgba(90,202,255,0.55)'); g.addColorStop(1, 'rgba(90,202,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0, -r * 0.20, r * 0.34, 0, TAUm); c.fill();
        glowDot(c, 0, -r * 0.20, r * 0.085, '#5acaff', 12);
        c.save(); c.strokeStyle = '#7adfff'; c.shadowColor = '#5acaff'; c.shadowBlur = 5; c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(0, -r * 0.12); c.lineTo(-r * 0.08, r * 0.02); c.lineTo(r * 0.02, r * 0.10);
        c.stroke(); c.restore();
      } else if (power === 'jetpack') {
        // flamm-munstycken vid nedre ryggen
        for (const mx of [-r * 0.40, -r * 0.22]) {
          c.fillStyle = '#2a2a34'; c.fillRect(mx - r * 0.05, r * 0.28, r * 0.10, r * 0.10);
          const g = c.createLinearGradient(mx, r * 0.38, mx, r * 0.78);
          g.addColorStop(0, 'rgba(255,220,90,0.95)'); g.addColorStop(0.5, 'rgba(255,140,40,0.75)');
          g.addColorStop(1, 'rgba(255,80,20,0)');
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(mx - r * 0.05, r * 0.38); c.lineTo(mx, r * 0.78); c.lineTo(mx + r * 0.05, r * 0.38);
          c.closePath(); c.fill();
        }
      } else if (power === 'shielder') {
        // hex-fragment framför kroppen (cyan energi)
        c.save(); c.strokeStyle = '#5acaff'; c.shadowColor = '#5acaff'; c.shadowBlur = 7; c.lineWidth = 1.6;
        for (const [hx, hy, hr] of [[r * 0.72, -r * 0.30, r * 0.14], [r * 0.84, r * 0.06, r * 0.11], [r * 0.66, r * 0.34, r * 0.12]]) {
          c.beginPath();
          for (let i = 0; i <= 6; i++) {
            const a = i * Math.PI / 3 + 0.26;
            const px = hx + Math.cos(a) * hr, py = hy + Math.sin(a) * hr;
            if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.stroke();
        }
        c.restore();
      } else if (power === 'gas_sniper') {
        // gasmask-filter-detalj + giftgrön dimslinga vid fötterna
        c.fillStyle = '#2a2a24'; c.beginPath(); c.arc(r * 0.26, -r * 0.78, r * 0.09, 0, TAUm); c.fill();
        c.strokeStyle = '#5a5a4a'; c.lineWidth = 1.2;
        c.beginPath(); c.arc(r * 0.26, -r * 0.78, r * 0.09, 0, TAUm); c.stroke();
        c.beginPath(); c.arc(r * 0.26, -r * 0.78, r * 0.045, 0, TAUm); c.stroke();
        c.save(); c.strokeStyle = 'rgba(150,255,90,0.45)'; c.shadowColor = '#9aff5a'; c.shadowBlur = 6; c.lineWidth = 2.4; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-r * 0.55, r * 1.10);
        c.quadraticCurveTo(-r * 0.15, r * 0.95, r * 0.20, r * 1.12);
        c.quadraticCurveTo(r * 0.45, r * 1.22, r * 0.62, r * 1.06);
        c.stroke(); c.restore(); c.lineCap = 'butt';
      } else if (power === 'tank_charger' || power === 'brute_charger') {
        // RAMM-PLÅT framtill m. nitar + repor
        c.fillStyle = '#4a4a52'; c.fillRect(r * 0.52, -r * 0.50, r * 0.16, r * 1.00);
        c.fillStyle = '#6a6a74'; c.fillRect(r * 0.52, -r * 0.50, r * 0.16, r * 0.06);
        outl(c, 1.4); c.strokeRect(r * 0.52, -r * 0.50, r * 0.16, r * 1.00);
        c.fillStyle = '#9a9aa2';
        for (let i = 0; i < 4; i++) {
          c.beginPath(); c.arc(r * 0.60, -r * 0.40 + i * r * 0.26, 1.8, 0, TAUm); c.fill();
        }
        c.strokeStyle = '#2a2a30'; c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(r * 0.54, -r * 0.20); c.lineTo(r * 0.66, -r * 0.05);
        c.moveTo(r * 0.55, r * 0.22); c.lineTo(r * 0.65, r * 0.34);
        c.stroke();
      } else if (power === 'cloaker') {
        // halvtransparenta kant-fragment (spök-skivor) — ritas separat efteråt på kopia av basen
        // (hanteras i cloakerGhost efter rå-baken — markeras här som no-op)
      } else if (power === 'avatar') {
        // gyllene gloria-streck ovanför huvudet
        c.save(); c.strokeStyle = '#ffd54a'; c.shadowColor = '#ffd54a'; c.shadowBlur = 9; c.lineWidth = 2.2; c.lineCap = 'round';
        c.beginPath(); c.arc(0, -r * 1.30, r * 0.30, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
        c.beginPath();
        c.moveTo(-r * 0.46, -r * 1.36); c.lineTo(-r * 0.56, -r * 1.44);
        c.moveTo(r * 0.46, -r * 1.36); c.lineTo(r * 0.56, -r * 1.44);
        c.stroke();
        c.restore(); c.lineCap = 'butt';
      }
    }

    // cloaker: spöklika kant-fragment — kopiera skivor av sprite, offsetta med låg alfa
    function cloakerGhost(cv) {
      const w = cv.width, h = cv.height;
      const src = document.createElement('canvas'); src.width = w; src.height = h;
      src.getContext('2d').drawImage(cv, 0, 0);
      const c = cv.getContext('2d');
      c.save(); c.globalAlpha = 0.22;
      // tre horisontella skivor förskjutna åt sidorna
      c.drawImage(src, 0, h * 0.18, w, h * 0.14, -w * 0.045, h * 0.18, w, h * 0.14);
      c.drawImage(src, 0, h * 0.44, w, h * 0.12, w * 0.05, h * 0.44, w, h * 0.12);
      c.drawImage(src, 0, h * 0.64, w, h * 0.10, -w * 0.035, h * 0.64, w, h * 0.10);
      c.restore();
    }

    // ---------- GLOBALA PASS (efter _polishSprite) ----------
    function rimLight(cv, strength, thick, tint) {
      const w = cv.width, h = cv.height, c = cv.getContext('2d');
      const img = c.getImageData(0, 0, w, h), d = img.data;
      const t2 = document.createElement('canvas'); t2.width = w; t2.height = h;
      const oc = t2.getContext('2d'), out = oc.createImageData(w, h), o = out.data;
      const TH = 50;
      const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = A(x, y); if (a < TH) continue;
          let edge = false;
          for (let t = 1; t <= thick && !edge; t++) {
            if (A(x - t, y - t) < TH || A(x, y - t) < TH || A(x - t, y) < TH) edge = true;
          }
          if (edge) {
            const i = (y * w + x) * 4;
            o[i] = tint[0]; o[i + 1] = tint[1]; o[i + 2] = tint[2];
            o[i + 3] = Math.round(255 * strength * (a / 255));
          }
        }
      }
      oc.putImageData(out, 0, 0);
      c.drawImage(t2, 0, 0);
    }
    function outlineBoost(cv, alpha) {
      const w = cv.width, h = cv.height;
      const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
      const sc = sil.getContext('2d');
      sc.drawImage(cv, 0, 0);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = 'rgba(3,2,7,' + alpha + ')';
      sc.fillRect(0, 0, w, h);
      const c = cv.getContext('2d');
      c.save(); c.globalCompositeOperation = 'destination-over';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) c.drawImage(sil, dx, dy);
      c.restore();
    }
    function aoPass(cv, r, humanoid) {
      const c = cv.getContext('2d'), w = cv.width, cy = w / 2;
      c.save(); c.globalCompositeOperation = 'source-atop';
      // mörkare ambient vid fötterna
      const g = c.createLinearGradient(0, cy + r * 0.82, 0, cy + r * 1.48);
      g.addColorStop(0, 'rgba(8,5,14,0)'); g.addColorStop(1, 'rgba(8,5,14,0.34)');
      c.fillStyle = g; c.fillRect(0, cy + r * 0.78, w, r * 0.75);
      if (humanoid) {
        // mjuka AO-penseldrag i armhålor/under torso
        c.fillStyle = 'rgba(10,6,16,0.16)';
        c.beginPath(); c.ellipse(w / 2 - r * 0.26, cy - r * 0.04, r * 0.10, r * 0.20, 0.2, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(w / 2 + r * 0.20, cy + r * 0.02, r * 0.09, r * 0.16, -0.2, 0, TAU); c.fill();
      }
      c.restore();
    }

    // ---------- KÖR ----------
    const res = { _hasPixi: typeof PIXI !== 'undefined', _meta: {} };
    for (const it of list) {
      for (const [suffix, wp] of FRAMES) {
        if (it.miniPower && suffix !== '') continue; // minibossar: bara idle (som V1)
        try {
          const phase = wp * TAU;
          const raw = bakeRaw(it, phase);
          if (it.miniPower === 'cloaker') cloakerGhost(raw);
          const mini = !!it.miniPower;
          // rim-light FÖRE polish → ljuskanten hamnar INNANFÖR den mörka konturen
          // (på basens alfa-kant), inte ovanpå outline-ringen (gav grå halo i v1-passet)
          rimLight(raw, mini ? 0.60 : 0.50, 2, mini ? [255, 235, 200] : [255, 242, 205]);
          const cv = _polishSprite(raw, it.r);
          aoPass(cv, it.r, it.type !== 'dog' && it.type !== 'swarmer');
          outlineBoost(cv, 0.45);
          _ENEMY_BAKE_RADIUS[it.miniPower ? ('mb_' + it.miniPower) : it.type] = it.r;
          res[it.key + suffix] = cv.toDataURL();
          res._meta[it.key + suffix] = { w: cv.width, h: cv.height, r: it.r };
        } catch (e) { res[it.key + suffix] = 'ERR:' + (e && (e.message + '|' + (e.stack || '').slice(0, 120))); }
      }
    }
    return res;
  }, { FRAMES });

  // ============ BOSSAR ============
  const bosses = await page.evaluate(() => {
    const TAU = Math.PI * 2;
    const res = {};
    // tematiska accenter per boss — ritas i figur-space (enhet r) på figur-lagret
    const THEME = {
      witheredelder: (c, r) => { // skogsande-officer: spor-/löv-gnistor + starkare horn-glöd
        c.save(); c.fillStyle = '#aaff5a'; c.shadowColor = '#5aff8a'; c.shadowBlur = 7;
        for (const [x, y, s] of [[-1.05, -0.85, 2.4], [0.95, -1.15, 2.0], [1.15, 0.25, 2.2], [-0.85, 0.65, 1.8], [0.55, -1.55, 2.0]]) {
          c.beginPath(); c.arc(r * x, r * y, s, 0, TAU); c.fill();
        }
        c.strokeStyle = '#aaff5a'; c.lineWidth = 2.4; c.shadowBlur = 10;
        c.beginPath(); c.moveTo(-r * 0.08, -r * 1.48); c.lineTo(-r * 0.20, -r * 1.65);
        c.moveTo(r * 0.08, -r * 1.48); c.lineTo(r * 0.20, -r * 1.65); c.stroke();
        c.restore();
      },
      ironclad: (c, r) => { // rost-koloss: glödande ember-sprickor + gnistor
        c.save(); c.strokeStyle = '#ffae5a'; c.shadowColor = '#ff7a3a'; c.shadowBlur = 6; c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-r * 0.30, -r * 0.10); c.lineTo(-r * 0.18, 0); c.lineTo(-r * 0.24, r * 0.12);
        c.moveTo(r * 0.20, -r * 0.30); c.lineTo(r * 0.30, -r * 0.18);
        c.stroke();
        c.fillStyle = '#ffae5a';
        for (const [x, y] of [[-0.95, -0.55], [1.0, 0.15], [0.75, -1.0]]) {
          c.beginPath(); c.arc(r * x, r * y, 2, 0, TAU); c.fill();
        }
        c.restore();
      },
      mirroredone: (c, r) => { // spegel-varelse: glas-glints + prisma-skärvor
        c.save();
        c.strokeStyle = 'rgba(220,245,255,0.95)'; c.lineWidth = 1.6; c.shadowColor = '#5acaff'; c.shadowBlur = 7;
        for (const [x, y, s] of [[-0.10, -0.30, 0.16], [0.22, 0.05, 0.11]]) {
          c.beginPath();
          c.moveTo(r * (x - s), r * y); c.lineTo(r * (x + s), r * y);
          c.moveTo(r * x, r * (y - s)); c.lineTo(r * x, r * (y + s));
          c.stroke();
        }
        c.fillStyle = 'rgba(170,90,255,0.75)';
        for (const [x, y] of [[-1.05, -0.25], [0.95, -0.85], [1.1, 0.55]]) {
          c.save(); c.translate(r * x, r * y); c.rotate(0.6);
          c.fillRect(-2.2, -3.6, 4.4, 7.2); c.restore();
        }
        c.restore();
      },
      ossarius: (c, r) => { // general: guld-glitter på epåletter/medaljer
        c.save(); c.fillStyle = '#ffe27a'; c.shadowColor = '#ffd54a'; c.shadowBlur = 8;
        for (const [x, y, s] of [[-0.45, -0.55, 2.6], [0.45, -0.55, 2.6], [-0.25, -0.25, 1.8], [0.05, -0.05, 1.6]]) {
          c.beginPath(); c.arc(r * x, r * y, s, 0, TAU); c.fill();
        }
        c.strokeStyle = 'rgba(255,226,122,0.9)'; c.lineWidth = 1.3;
        c.beginPath();
        c.moveTo(-r * 0.45 - 5, -r * 0.55); c.lineTo(-r * 0.45 + 5, -r * 0.55);
        c.moveTo(-r * 0.45, -r * 0.55 - 5); c.lineTo(-r * 0.45, -r * 0.55 + 5);
        c.stroke();
        c.restore();
      },
      vanguardatlas: (c, r) => { // halv-mekanisk: scanlines på mech-sidan + core-boost
        c.save(); c.strokeStyle = 'rgba(90,255,170,0.4)'; c.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          c.beginPath(); c.moveTo(-r * 0.62, -r * 0.45 + i * r * 0.22); c.lineTo(-r * 0.20, -r * 0.45 + i * r * 0.22); c.stroke();
        }
        const g = c.createRadialGradient(0, -r * 0.25, 0, 0, -r * 0.25, r * 0.40);
        g.addColorStop(0, 'rgba(58,202,255,0.5)'); g.addColorStop(1, 'rgba(58,202,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0, -r * 0.25, r * 0.40, 0, TAU); c.fill();
        c.restore();
      },
      emberoracle: (c, r) => { // ask-orakel: stigande glöd-partiklar + hand-glöd
        c.save(); c.fillStyle = '#ffae3a'; c.shadowColor = '#ff5a30'; c.shadowBlur = 7;
        for (const [x, y, s] of [[-0.75, 0.35, 2.2], [-0.55, -0.45, 1.8], [0.85, -0.25, 2.4], [0.65, 0.75, 1.8], [1.05, -0.95, 1.6], [-1.0, -1.05, 1.8]]) {
          c.beginPath(); c.arc(r * x, r * y, s, 0, TAU); c.fill();
        }
        const g = c.createRadialGradient(r * 0.35, r * 0.10, 0, r * 0.35, r * 0.10, r * 0.30);
        g.addColorStop(0, 'rgba(255,140,60,0.5)'); g.addColorStop(1, 'rgba(255,140,60,0)');
        c.fillStyle = g; c.beginPath(); c.arc(r * 0.35, r * 0.10, r * 0.30, 0, TAU); c.fill();
        c.restore();
      },
      blightsovereign: (c, r) => { // röt-härskare: toxiska droppar + sporer
        c.save(); c.fillStyle = '#9aff5a'; c.shadowColor = '#5affae'; c.shadowBlur = 6;
        for (const [x, y] of [[-0.35, 0.85], [0.15, 1.0], [0.45, 0.8]]) {
          c.beginPath(); c.ellipse(r * x, r * y, 2, 4.4, 0, 0, TAU); c.fill();
        }
        c.globalAlpha = 0.8;
        for (const [x, y, s] of [[-0.95, -0.35, 1.8], [0.9, -0.7, 1.6], [1.1, 0.3, 1.8], [-1.1, 0.5, 1.4]]) {
          c.beginPath(); c.arc(r * x, r * y, s, 0, TAU); c.fill();
        }
        c.restore();
      },
      buriedcrown: (c, r) => { // begravd kung: guld-damm + kron-glint
        c.save(); c.fillStyle = '#ffe27a'; c.shadowColor = '#ffd54a'; c.shadowBlur = 7;
        for (const [x, y, s] of [[-0.15, -1.5, 2.6], [0.2, -1.42, 2.0], [-0.85, 0.25, 1.6], [0.95, 0.45, 1.6], [0.75, -1.1, 1.4]]) {
          c.beginPath(); c.arc(r * x, r * y, s, 0, TAU); c.fill();
        }
        c.strokeStyle = 'rgba(255,226,122,0.9)'; c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(-r * 0.15 - 6, -r * 1.5); c.lineTo(-r * 0.15 + 6, -r * 1.5);
        c.moveTo(-r * 0.15, -r * 1.5 - 6); c.lineTo(-r * 0.15, -r * 1.5 + 6);
        c.stroke();
        c.restore();
      },
      lastsovereign: (c, r) => { // sista härskaren: lila energi-bågar
        c.save(); c.strokeStyle = '#c060ff'; c.shadowColor = '#aa3aff'; c.shadowBlur = 8; c.lineWidth = 1.8; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-r * 0.85, -r * 0.55); c.lineTo(-r * 0.70, -r * 0.42); c.lineTo(-r * 0.80, -r * 0.28);
        c.moveTo(r * 0.75, -r * 0.85); c.lineTo(r * 0.62, -r * 0.70); c.lineTo(r * 0.74, -r * 0.58);
        c.moveTo(r * 0.95, r * 0.35); c.lineTo(r * 0.82, r * 0.48);
        c.stroke();
        c.restore(); c.lineCap = 'butt';
      },
      thewarden: (c, r) => { // dödsvaktare: gyllene gloria-streck + nyckel-glints
        c.save(); c.strokeStyle = '#ffd54a'; c.shadowColor = '#ffd54a'; c.shadowBlur = 10; c.lineWidth = 2.6; c.lineCap = 'round';
        c.beginPath(); c.arc(0, -r * 1.42, r * 0.42, Math.PI * 1.12, Math.PI * 1.88); c.stroke();
        c.beginPath();
        c.moveTo(-r * 0.62, -r * 1.50); c.lineTo(-r * 0.76, -r * 1.62);
        c.moveTo(r * 0.62, -r * 1.50); c.lineTo(r * 0.76, -r * 1.62);
        c.stroke();
        c.fillStyle = '#ffe27a';
        for (const [x, y] of [[-0.45, 0.35], [0.42, 0.28]]) {
          c.beginPath(); c.arc(r * x, r * y, 1.8, 0, TAU); c.fill();
        }
        c.restore(); c.lineCap = 'butt';
      },
    };

    function rimLight(cv, strength, thick, tint) {
      const w = cv.width, h = cv.height, c = cv.getContext('2d');
      const img = c.getImageData(0, 0, w, h), d = img.data;
      const t2 = document.createElement('canvas'); t2.width = w; t2.height = h;
      const oc = t2.getContext('2d'), out = oc.createImageData(w, h), o = out.data;
      const TH = 60;
      const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = A(x, y); if (a < TH) continue;
        let edge = false;
        for (let t = 1; t <= thick && !edge; t++) {
          if (A(x - t, y - t) < TH || A(x, y - t) < TH || A(x - t, y) < TH) edge = true;
        }
        if (edge) {
          const i = (y * w + x) * 4;
          o[i] = tint[0]; o[i + 1] = tint[1]; o[i + 2] = tint[2];
          o[i + 3] = Math.round(255 * strength * (a / 255));
        }
      }
      oc.putImageData(out, 0, 0);
      c.drawImage(t2, 0, 0);
    }

    const savedCtx = ctx;
    for (const key of Object.keys(BOSS_CONFIGS)) {
      try {
        const cfg = BOSS_CONFIGS[key];
        const size = Math.ceil(cfg.r * 6);
        // FIGUR-LAGER (utan aura) — så material/vinjett/rim inte smetar på glowen
        const fig = document.createElement('canvas');
        fig.width = size; fig.height = size;
        ctx = fig.getContext('2d');
        const mockE = {
          r: cfg.r, bossKey: key, isBoss: true, type: 'boss',
          color: cfg.color, accent: cfg.accent, glow: cfg.glow, name: cfg.name,
          facing: 0, walkAccum: 0.4, walkPhase: 0.4, contactCd: 0, flashUntil: 0,
          hp: cfg.hp, maxHp: cfg.hp, x: 0, y: 0,
          stageAccent: '#7a5aaa', stageEdge: '#aaff5a',
        };
        ctx.save();
        ctx.translate(size / 2, size / 2);
        const fn = (typeof BOSS_DRAW !== 'undefined' && BOSS_DRAW[key]) || drawBossDefault;
        fn(mockE, false, 0, 0, false);
        // tematisk accent i samma space
        if (THEME[key]) THEME[key](ctx, cfg.r);
        ctx.restore();
        ctx = savedCtx;

        // MATERIAL-PASS på figuren (source-atop): metall-sheen + vinjett-tyngd
        const fc = fig.getContext('2d');
        fc.save(); fc.globalCompositeOperation = 'source-atop';
        const sheen = fc.createLinearGradient(size * 0.15, size * 0.10, size * 0.70, size * 0.65);
        sheen.addColorStop(0, 'rgba(255,248,225,0.22)');
        sheen.addColorStop(0.4, 'rgba(255,248,225,0.04)');
        sheen.addColorStop(0.65, 'rgba(255,248,225,0)');
        fc.fillStyle = sheen; fc.fillRect(0, 0, size, size);
        const dark = fc.createLinearGradient(size * 0.45, size * 0.40, size, size * 0.95);
        dark.addColorStop(0, 'rgba(8,5,16,0)'); dark.addColorStop(1, 'rgba(8,5,16,0.42)');
        fc.fillStyle = dark; fc.fillRect(0, 0, size, size);
        const vig = fc.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(5,3,10,0.26)');
        fc.fillStyle = vig; fc.fillRect(0, 0, size, size);
        fc.restore();
        // RIM-LIGHT tonad mot bossens glow-färg
        const gc = cfg.glow || '#ffffff';
        const tr = parseInt(gc.slice(1, 3), 16), tg = parseInt(gc.slice(3, 5), 16), tb = parseInt(gc.slice(5, 7), 16);
        rimLight(fig, 0.55, 3, [Math.min(255, 140 + tr * 0.45), Math.min(255, 140 + tg * 0.45), Math.min(255, 140 + tb * 0.45)]);
        // mörk 1px kontur bakom figuren
        const sil = document.createElement('canvas'); sil.width = size; sil.height = size;
        const sc = sil.getContext('2d'); sc.drawImage(fig, 0, 0);
        sc.globalCompositeOperation = 'source-in'; sc.fillStyle = 'rgba(4,3,8,0.85)'; sc.fillRect(0, 0, size, size);
        fc.save(); fc.globalCompositeOperation = 'destination-over';
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) fc.drawImage(sil, dx, dy);
        fc.restore();

        // OUTPUT: förstärkt 2-lagers glow + figuren ovanpå
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const c = cv.getContext('2d');
        c.save(); c.translate(size / 2, size / 2);
        if (mockE.glow) {
          // lager 1: V1:s breda aura
          let grad = c.createRadialGradient(0, 0, cfg.r * 0.5, 0, 0, cfg.r * 2.4);
          grad.addColorStop(0, hexA(mockE.glow, 0.40));
          grad.addColorStop(0.6, hexA(mockE.glow, 0.15));
          grad.addColorStop(1, hexA(mockE.glow, 0));
          c.fillStyle = grad;
          c.fillRect(-cfg.r * 2.6, -cfg.r * 2.6, cfg.r * 5.2, cfg.r * 5.2);
          // lager 2 (NYTT): tight inner-halo = mer "presence"
          grad = c.createRadialGradient(0, 0, cfg.r * 0.7, 0, 0, cfg.r * 1.45);
          grad.addColorStop(0, hexA(mockE.glow, 0.28));
          grad.addColorStop(1, hexA(mockE.glow, 0));
          c.fillStyle = grad;
          c.fillRect(-cfg.r * 1.6, -cfg.r * 1.6, cfg.r * 3.2, cfg.r * 3.2);
        }
        c.restore();
        c.drawImage(fig, 0, 0);
        res['boss_' + key] = cv.toDataURL();
      } catch (e) { res['boss_' + key] = 'ERR:' + (e && e.message); }
      ctx = savedCtx;
    }
    return res;
  });
  Object.assign(out, bosses);

  // ============ DIMENSIONS-VERIFIERING + SKRIV ============
  let saved = 0, failed = 0;
  const datas = {};
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || !v.startsWith('data:image/png')) {
      console.log('SKIP', k, String(v).slice(0, 160)); failed++; continue;
    }
    const buf = Buffer.from(v.replace(/^data:image\/png;base64,/, ''), 'base64');
    const file = path.join(OUT, k + '.png');
    if (fs.existsSync(file)) {
      const old = pngDims(file);
      const nw = buf.readUInt32BE(16), nh = buf.readUInt32BE(20);
      if (old.w !== nw || old.h !== nh) {
        console.log('DIM-MISMATCH', k, 'old', old.w + 'x' + old.h, 'new', nw + 'x' + nh, '— SKRIVER EJ');
        failed++; continue;
      }
    }
    datas[k] = v;
    if (!process.env.AAA_DRY) fs.writeFileSync(file, buf);
    saved++;
  }

  // ============ KONTAKTARK (full-size + spel-storlek ~36px) ============
  const sheetData = await page.evaluate((datas) => {
    return new Promise((resolve) => {
      const keys = Object.keys(datas).sort();
      const imgs = {};
      let pending = keys.length;
      for (const k of keys) {
        const im = new Image();
        im.onload = () => { imgs[k] = im; if (--pending === 0) compose(); };
        im.onerror = () => { if (--pending === 0) compose(); };
        im.src = datas[k];
      }
      function compose() {
        const cols = 8, cell = 150, label = 14;
        const rows = Math.ceil(keys.length / cols);
        const cv = document.createElement('canvas');
        cv.width = cols * cell;
        cv.height = rows * (cell + label) + 10;
        const c = cv.getContext('2d');
        c.fillStyle = '#181420'; c.fillRect(0, 0, cv.width, cv.height);
        c.font = '10px monospace'; c.textAlign = 'center';
        keys.forEach((k, i) => {
          const im = imgs[k]; if (!im) return;
          const cx = (i % cols) * cell, cy = Math.floor(i / cols) * (cell + label);
          // full-size (skala in i 104px)
          const s = Math.min(1, 104 / Math.max(im.width, im.height));
          const w = im.width * s, h = im.height * s;
          c.drawImage(im, cx + (cell - 40 - w) / 2, cy + (cell - h) / 2, w, h);
          // spel-storlek 36px till höger
          c.drawImage(im, cx + cell - 42, cy + cell / 2 - 18, 36, 36);
          c.fillStyle = '#9a93b8';
          c.fillText(k.replace(/^enemy_/, '').slice(0, 20), cx + cell / 2, cy + cell + 10);
        });
        resolve(cv.toDataURL());
      }
    });
  }, datas);
  fs.writeFileSync(SHEET, Buffer.from(sheetData.replace(/^data:image\/png;base64,/, ''), 'base64'));

  console.log('hasPixi:', out._hasPixi);
  console.log('pageerrors:', errs.slice(0, 5).join(' | ') || '(inga)');
  console.log('SAVED', saved, 'FAILED', failed, '->', OUT);
  console.log('SHEET ->', SHEET);
  await browser.close();
})();
