// Bygg www/ för Capacitor: kopiera ENBART webb-klientens filer (ej server/, ej
// .smoke-test, ej build-skript) till en ren mapp som Capacitor wrappar.
// Webb-versionen på GitHub Pages använder fortfarande root-filerna oförändrat.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const files = ['index.html', 'game.js', 'style.css', 'sw.js', 'manifest.json', 'icon-192.svg', 'icon-512.svg'];
const dirs = ['assets', 'shared'];

for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(www, f));
}
for (const d of dirs) {
  const src = path.join(root, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(www, d), { recursive: true });
}

const count = fs.readdirSync(www).length;
console.log(`✓ www/ byggd (${count} toppnivå-poster: ` + fs.readdirSync(www).join(', ') + ')');
