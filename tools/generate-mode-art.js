// Genererar skräddarsydd kort-art per spelläge via Gemini (användarens API-nyckel).
// v2 (användarfeedback): HUVUDPERSONERNA är spelets mänskliga soldater (samma
// stil som app-ikonen, skickas som referensbild) — max EN banan-karaktär och
// max EN pizza/ananas-karaktär per bild, resten vanliga gubbar.
//   node tools/generate-mode-art.js <API_KEY> <utkatalog> <referensbild.png>
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = process.argv[2];
const OUT = process.argv[3] || path.join(require('os').tmpdir(), 'mode_art2');
const REF = process.argv[4];
if (!KEY) { console.error('API-nyckel saknas'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const refB64 = REF ? fs.readFileSync(REF).toString('base64') : null;

const STYLE = 'Use the attached image ONLY as the art style and character reference: ' +
  'the dark-haired human soldier in a bulletproof vest is the game\'s hero character, ' +
  'and the banana with a face is his sidekick mascot. Create a brand NEW scene in the ' +
  'same vibrant painterly cartoon style: mobile game mode-select card artwork for a ' +
  'top-down military shooter. The main characters MUST be human cartoon soldiers like ' +
  'the hero in the reference (dark hair, tactical vests). You may include AT MOST ONE ' +
  'banana mascot character in the scene, and AT MOST ONE pizza-slice or pineapple mascot ' +
  'character — every other character must be a normal human soldier. ' +
  'Dramatic cinematic lighting, rich colors, dark moody background with glow accents. ' +
  'ABSOLUTELY NO TEXT, no letters, no numbers, no logos, no watermark. ' +
  'Composition must stay readable as a small card thumbnail.';

const MODES = [
  ['story', 'A squad of human soldiers storming an enemy military base at night, explosions and muzzle flashes, the banana mascot charging along beside them, heroic campaign feeling. The banana is the ONLY mascot in this scene — do NOT include any pizza or pineapple characters, all other characters are human soldiers'],
  ['survivors', 'A human soldier and the banana mascot back to back, surrounded by a huge horde of shadowy zombie aliens closing in, sickly green toxic glow, desperate last stand'],
  ['castledefense', 'A stone castle with mounted gun turrets on the walls, human soldiers defending against a wave of monsters charging the gate, warm torch light'],
  ['heist', 'Human robbers in black ski masks inside a golden bank vault carrying money bags, gold bars everywhere, laser security beams, one pineapple mascot as lookout, teal and gold palette'],
  ['bossrush', 'A gigantic terrifying boss monster with a glowing crown towering over one small brave human soldier holding his ground, epic scale contrast, purple and red'],
  ['sandbox', 'A weapons training range: a human soldier aiming at wooden target dummies, weapon rack with many guns, the banana mascot taking notes on a clipboard, workshop vibe'],
  ['stresstest', 'An absurdly massive swarm of hundreds of small enemies flooding toward one human soldier standing calm, red alert warning atmosphere, chaotic energy'],
  ['battleroyale', 'Human soldiers parachuting from the sky over a big island battlefield, a glowing purple storm circle closing on the horizon, one banana mascot parachuting among them, sunset'],
  ['tdm', 'Two teams of human soldiers, one glowing red and one glowing blue, clashing head-on in an arena firefight, symmetrical composition'],
  ['ctf', 'A human soldier sprinting mid-dive clutching a big red flag while the blue team chases shooting, the pizza-slice mascot cheering from the sideline, motion blur, adrenaline'],
  ['koth', 'A human soldier wearing a golden crown standing on a glowing capture zone on a hilltop, defending against attackers climbing from below, golden light'],
  ['siege', 'Armored human soldiers with riot shields pushing toward a fortified base with sandbags and turrets, smoke and sparks, steel blue palette'],
  ['gungame', 'A dramatic circular arrangement of many different weapons floating around one glowing golden pistol in the center, a human soldier reaching for it, showcase lighting'],
  ['juggernaut', 'One huge heavily-armored juggernaut in a metal suit being swarmed by many small fast human soldier hunters, david vs goliath energy, magenta accents'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function genOne(id, theme, attempt) {
  const parts = [];
  if (refB64) parts.push({ inline_data: { mime_type: 'image/png', data: refB64 } });
  parts.push({ text: STYLE + ' Scene: ' + theme });
  const body = {
    contents: [{ parts }],
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
  const prts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  for (const p of prts) {
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
