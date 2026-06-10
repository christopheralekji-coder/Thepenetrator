// Bakar V1:s procedurella musik (Music-objektet i game.js) till loopbara WAV-filer
// via OfflineAudioContext — exakt samma syntes (pad sine+triangle ±3c, bell-melodi,
// mjuk bas, sub-kick, lowpass 1800 + delay-echo). Renderar 8 ackord-cykler och
// exporterar de sista 4 (steady state) → sömlös loop.
//   node tools/bake-music.js   (kräver http-server 8799)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'WarParty-V2', 'assets', 'music');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 120)));
  await page.goto('http://localhost:8799/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const themes = await page.evaluate(() => Object.keys(Music.themes));
  console.log('teman:', themes.join(','));

  for (const name of themes) {
    const wavB64 = await page.evaluate(async (themeName) => {
      const theme = Music.themes[themeName];
      const scale = Music.scales[theme.mode];
      const SR = 22050;
      const stepDur = 60 / theme.tempo / 4;
      const cycleDur = stepDur * 16;
      const totalCycles = 8;            // 8 cykler → ta de sista 4 (steady delay-tail)
      const loopCycles = 4;
      const totalDur = cycleDur * totalCycles;
      const ctx2 = new OfflineAudioContext(1, Math.ceil(SR * totalDur), SR);

      // master: gain 0.30 + lowpass 1800 + delay-echo (som startStage)
      const master = ctx2.createGain(); master.gain.value = 0.30; master.connect(ctx2.destination);
      const lp = ctx2.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.4; lp.connect(master);
      const delay = ctx2.createDelay(0.5); delay.delayTime.value = 0.25;
      const dlyG = ctx2.createGain(); dlyG.gain.value = 0.15;
      delay.connect(dlyG); dlyG.connect(delay); dlyG.connect(lp);

      const noteToFreq = (rootHz, sc, step) => {
        const len = sc.length - 1; let oct = 0, s = step;
        while (s < 0) { oct--; s += len; }
        while (s >= len) { oct++; s -= len; }
        return rootHz * Math.pow(2, (sc[s] + oct * 12) / 12);
      };
      const playChord = (t, rootFreq, dur) => {
        const notes = [rootFreq, rootFreq * Math.pow(2, scale[2] / 12), rootFreq * Math.pow(2, scale[4] / 12)];
        for (const f of notes) for (let ti = 0; ti < 2; ti++) {
          const o = ctx2.createOscillator(); o.type = ti === 0 ? 'sine' : 'triangle';
          o.frequency.value = f; o.detune.value = ti === 0 ? -3 : 3;
          const g = ctx2.createGain(); const v = 0.08 * (ti === 0 ? 1.0 : 0.4);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(v, t + 1.0);
          g.gain.linearRampToValueAtTime(v * 0.7, t + dur - 0.8);
          g.gain.linearRampToValueAtTime(0.001, t + dur);
          o.connect(g); g.connect(lp); o.start(t); o.stop(t + dur + 0.1);
        }
      };
      const playMelody = (t, freq, dur) => {
        const o = ctx2.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(lp); g.connect(delay); o.start(t); o.stop(t + dur + 0.05);
        const o2 = ctx2.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq / 2;
        const g2 = ctx2.createGain();
        g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.036, t + 0.05);
        g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o2.connect(g2); g2.connect(lp); o2.start(t); o2.stop(t + dur + 0.05);
      };
      const playBass = (t, freq, dur) => {
        const o = ctx2.createOscillator(); o.type = 'sine'; o.frequency.value = freq / 2;
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.15);
        g.gain.linearRampToValueAtTime(0.09, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(lp); o.start(t); o.stop(t + dur + 0.05);
      };
      const playKick = (t) => {
        const o = ctx2.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.18);
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g); g.connect(lp); o.start(t); o.stop(t + 0.22);
      };

      const style = theme.style || 'mellow';
      const mel = Music.melodyPatterns[style], bas = Music.bassPatterns[style], kik = Music.kickPatterns[style];
      for (let cyc = 0; cyc < totalCycles; cyc++) {
        const chordOffset = theme.chords[cyc % theme.chords.length];
        const chordRoot = noteToFreq(theme.root, scale, chordOffset);
        const base = cyc * cycleDur;
        playChord(base, chordRoot, cycleDur);
        for (let step = 0; step < 16; step++) {
          const t = base + step * stepDur;
          if (mel[step] >= 0) playMelody(t, noteToFreq(chordRoot, scale, mel[step]) * 2, stepDur * 4);
          if (bas[step]) playBass(t, chordRoot, stepDur * 4);
          if (kik[step]) playKick(t);
        }
      }
      const buf = await ctx2.startRendering();
      // klipp ut sista loopCycles cykler → loopbar region
      const startS = Math.floor((totalCycles - loopCycles) * cycleDur * SR);
      const lenS = Math.floor(loopCycles * cycleDur * SR);
      const data = buf.getChannelData(0).slice(startS, startS + lenS);
      // WAV-encode PCM16 mono
      const w = new DataView(new ArrayBuffer(44 + data.length * 2));
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) w.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); w.setUint32(4, 36 + data.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      w.setUint32(16, 16, true); w.setUint16(20, 1, true); w.setUint16(22, 1, true);
      w.setUint32(24, SR, true); w.setUint32(28, SR * 2, true); w.setUint16(32, 2, true); w.setUint16(34, 16, true);
      ws(36, 'data'); w.setUint32(40, data.length * 2, true);
      for (let i = 0; i < data.length; i++) {
        const s = Math.max(-1, Math.min(1, data[i]));
        w.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      let bin = '';
      const bytes = new Uint8Array(w.buffer);
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      return btoa(bin);
    }, name);
    fs.writeFileSync(path.join(OUT, name + '.wav'), Buffer.from(wavB64, 'base64'));
    console.log('bakade', name);
  }
  console.log('KLART →', OUT);
  await browser.close();
})();
