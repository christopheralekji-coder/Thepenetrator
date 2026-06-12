// Genererar skräddarsydd kort-art per spelläge via Gemini (användarens API-nyckel).
// 14 lägen × 16:9 @1K → sparas som råa PNG i temp (skalas ner separat med PIL).
//   node tools/generate-mode-art.js <API_KEY> <utkatalog>
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = process.argv[2];
const OUT = process.argv[3] || path.join(require('os').tmpdir(), 'mode_art');
if (!KEY) { console.error('API-nyckel saknas'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// Gemensam stil (samma värld som app-ikonen: banan-soldater, tecknad militär)
const STYLE = 'Vibrant stylized mobile game mode-select card artwork for a cartoon ' +
  'military top-down shooter where the soldiers are anthropomorphic BANANAS with arms, ' +
  'legs and angry faces wearing tactical gear. Dramatic cinematic lighting, rich colors, ' +
  'painterly cartoon style, dark moody background with glow accents. ' +
  'ABSOLUTELY NO TEXT, no letters, no numbers, no logos, no watermark. ' +
  'Composition readable as a small card thumbnail.';

const MODES = [
  ['story', 'A squad of banana soldiers storming an enemy military base at night, explosions and muzzle flashes behind them, heroic campaign feeling'],
  ['survivors', 'One banana soldier surrounded by a huge horde of shadowy zombie aliens closing in from all sides, sickly green toxic glow, last stand'],
  ['castledefense', 'A stone castle with mounted gun turrets on the walls, banana soldiers defending against a wave of monsters charging the gate, warm torch light'],
  ['heist', 'Banana robbers in black ski masks inside a golden bank vault, gold bars and bursting money bags, laser security beams, teal and gold palette'],
  ['bossrush', 'A gigantic terrifying boss monster with a glowing crown towering over a tiny brave banana soldier, epic scale contrast, purple and red'],
  ['sandbox', 'A weapons training range: banana soldier aiming at wooden target dummies, weapon rack with many guns, workshop vibe, neutral cool tones'],
  ['stresstest', 'An absurdly massive swarm of hundreds of small enemies flooding toward the camera, red alert warning atmosphere, chaotic energy'],
  ['battleroyale', 'Banana soldiers parachuting from the sky over a big island battlefield, a glowing purple storm circle closing in on the horizon, sunset'],
  ['tdm', 'Two teams of banana soldiers, one glowing red and one glowing blue, clashing head-on in an arena firefight, symmetrical composition'],
  ['ctf', 'A banana soldier sprinting away mid-dive clutching a big red flag while blue team chases shooting, motion blur, adrenaline'],
  ['koth', 'A banana soldier with a golden crown standing on a glowing capture zone on a hilltop, defending it against attackers from below, golden light'],
  ['siege', 'Armored banana soldiers with riot shields pushing toward a fortified base with sandbags and turrets, smoke and sparks, steel blue palette'],
  ['gungame', 'A dramatic circular arrangement of many different weapons floating around one glowing golden pistol in the center, showcase lighting'],
  ['juggernaut', 'One huge heavily-armored juggernaut banana in a metal suit being attacked by many small fast banana hunters, david vs goliath, magenta accents'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function genOne(id, theme, attempt) {
  const body = {
    contents: [{ parts: [{ text: STYLE + ' Scene: ' + theme }] }],
    generationConfig: { imageConfig: { aspectRatio: '16:9', imageSize: '1K' } },
  };
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=' + KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 200);
    throw new Error('HTTP ' + r.status + ': ' + t);
  }
  const j = await r.json();
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  for (const p of parts) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) {
      fs.writeFileSync(path.join(OUT, id + '.png'), Buffer.from(d.data, 'base64'));
      return true;
    }
  }
  throw new Error('inget bild-svar (attempt ' + attempt + ')');
}

(async () => {
  let ok = 0, fail = 0;
  for (const [id, theme] of MODES) {
    const f = path.join(OUT, id + '.png');
    if (fs.existsSync(f) && fs.statSync(f).size > 50000) { console.log(id, 'finns redan — hoppar'); ok++; continue; }
    let done = false;
    for (let a = 1; a <= 3 && !done; a++) {
      try {
        await genOne(id, theme, a);
        console.log('OK:', id);
        ok++; done = true;
      } catch (e) {
        console.log('RETRY', id, '—', e.message);
        await sleep(4000 * a);
      }
    }
    if (!done) { console.log('FAIL:', id); fail++; }
    await sleep(1500);
  }
  console.log('KLART:', ok, 'ok,', fail, 'fail →', OUT);
  process.exit(fail ? 1 : 0);
})();
