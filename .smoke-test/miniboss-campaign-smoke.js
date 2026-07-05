'use strict';
// Smoke-test: 10 dedicated campaign minibosses
// Verifies ENEMY_STATS, makeEnemy, spawnMiniBoss (simulated), and stage wiring.
// Run: node .smoke-test/miniboss-campaign-smoke.js

const path = require('path');
const { ENEMY_STATS, makeEnemy } = require(path.join(__dirname, '../server/sim/enemies'));
const { STAGES } = require(path.join(__dirname, '../shared/stages-data'));
const { BOSS_CONFIGS } = require(path.join(__dirname, '../shared/boss-configs'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  PASS:', msg);
    passed++;
  } else {
    console.error('  FAIL:', msg);
    failed++;
  }
}

// ── 1. ENEMY_STATS presence & key fields ────────────────────────────────────
const MINIBOSS_SPECS = [
  { type: 'forest_miniboss',       r: 22, hp: 45, speed: 70,  dmg: 16, behavior: 'lob_aoe',       aoeRadius: 80,  aoeDmg: 24,  bulletColor: '#9aff5a', shootRange: 320 },
  { type: 'desert_miniboss',       r: 23, hp: 55, speed: 90,  dmg: 22, behavior: 'charger',        dashSpeed: 540, dashDmg: 38, telegraphMs: 500 },
  { type: 'military_miniboss',     r: 23, hp: 50, speed: 70,  dmg: 0,  behavior: 'spread',         pellets: 5,     spreadDeg: 40, bulletDmg: 12, bulletColor: '#ff7a3a' },
  { type: 'ossuary_miniboss',      r: 23, hp: 52, speed: 70,  dmg: 20, behavior: 'root_hook',      rootMs: 1000,   rootMul: 0.40, bulletColor: '#7affd0', shootRange: 340 },
  { type: 'swamp_miniboss',        r: 23, hp: 58, speed: 95,  dmg: 18, behavior: 'lifesteal',      lifestealPct: 100 },
  { type: 'volcano_miniboss',      r: 23, hp: 55, speed: 80,  dmg: 20, behavior: 'burn_melee',     pBurnMs: 3000,  pBurnDps: 8 },
  { type: 'arctic_miniboss',       r: 23, hp: 50, speed: 75,  dmg: 16, behavior: 'homing',         homingStrength: 0.08, bulletColor: '#bfe8ff', shootRange: 400 },
  { type: 'crystal_cave_miniboss', r: 24, hp: 60, speed: 65,  dmg: 22, behavior: 'reflect_shield', reflectArc: 140, reflectSpeedMul: 0.85, reflectDmg: 12 },
  { type: 'omega_miniboss',        r: 23, hp: 50, speed: 60,  dmg: 0,  behavior: 'sniper',         bulletDmg: 42,  bulletSpeed: 950, telegraphMs: 800, bulletColor: '#26ffe6' },
  { type: 'fortress_miniboss',     r: 24, hp: 62, speed: 110, dmg: 22, behavior: 'charger',        dashSpeed: 480, dashDmg: 40, telegraphMs: 400 },
];

console.log('\n=== 1. ENEMY_STATS — base stats + behavior params ===');
for (const spec of MINIBOSS_SPECS) {
  const { type, ...expected } = spec;
  console.log(`\n  [${type}]`);
  assert(!!ENEMY_STATS[type], `ENEMY_STATS["${type}"] exists`);
  if (!ENEMY_STATS[type]) continue;
  const s = ENEMY_STATS[type];
  assert(s.r === expected.r,     `r=${expected.r}`);
  assert(s.hp === expected.hp,   `hp=${expected.hp}`);
  assert(s.speed === expected.speed, `speed=${expected.speed}`);
  assert(s.dmg === expected.dmg, `dmg=${expected.dmg}`);
  assert(s.behavior === expected.behavior, `behavior='${expected.behavior}'`);
  // behavior-specific params
  for (const [k, v] of Object.entries(expected)) {
    if (['r','hp','speed','dmg','behavior'].includes(k)) continue;
    assert(s[k] === v, `${k}=${JSON.stringify(v)}`);
  }
}

// ── 2. makeEnemy — entity is well-formed ────────────────────────────────────
console.log('\n=== 2. makeEnemy — entity creation (all 10) ===');
for (const spec of MINIBOSS_SPECS) {
  const e = makeEnemy(spec.type, 100, 100);
  console.log(`\n  [${spec.type}]`);
  assert(e.type === spec.type,           `type set`);
  assert(e.hp === spec.hp,               `hp=${spec.hp}`);
  assert(e.behavior === spec.behavior,   `behavior='${spec.behavior}'`);
  assert(e.isMiniBoss === false,         `isMiniBoss=false (pre-spawnMiniBoss)`);
  assert(e.dead === false,               `dead=false`);
  assert(e.x === 100 && e.y === 100,     `position (100,100)`);
  // behavior-specific carry-through
  if (spec.aoeRadius)        assert(e.aoeRadius === spec.aoeRadius, `aoeRadius=${spec.aoeRadius}`);
  if (spec.dashSpeed)        assert(e.dashSpeed === spec.dashSpeed, `dashSpeed=${spec.dashSpeed}`);
  if (spec.pellets)          assert(e.pellets === spec.pellets, `pellets=${spec.pellets}`);
  if (spec.rootMs)           assert(e.rootMs === spec.rootMs, `rootMs=${spec.rootMs}`);
  if (spec.lifestealPct)     assert(e.lifestealPct === spec.lifestealPct, `lifestealPct=${spec.lifestealPct}`);
  if (spec.pBurnMs)          assert(e.pBurnMs === spec.pBurnMs, `pBurnMs=${spec.pBurnMs}`);
  if (spec.homingStrength)   assert(Math.abs(e.homingStrength - spec.homingStrength) < 0.001, `homingStrength=${spec.homingStrength}`);
  if (spec.reflectArc)       assert(e.reflectArc === spec.reflectArc, `reflectArc=${spec.reflectArc}`);
  if (spec.telegraphMs)      assert(e.telegraphMs === spec.telegraphMs, `telegraphMs=${spec.telegraphMs}`);
}

// ── 3. Simulated spawnMiniBoss — isMiniBoss flag + HP scaling ───────────────
console.log('\n=== 3. spawnMiniBoss simulation — HP scaling vs boss HP ===');

// Simulate spawnMiniBoss at veteran solo wave=1 for each stage entry
const STAGE_MINIBOSS_MAP = [
  { stageIdx: 0, bossKey: 'witheredelder',   mbs: [
      { type: 'forest_miniboss',       hpMul: 6,  dmgMul: 1.6, scale: 1.4, gold: 180, name: 'SPORE BEHEMOTH' },
      { type: 'forest_miniboss',       hpMul: 9,  dmgMul: 1.9, scale: 1.5, gold: 260, name: 'ELDER SPORE BEHEMOTH' },
    ]},
  { stageIdx: 1, bossKey: 'buriedcrown',     mbs: [
      { type: 'desert_miniboss',       hpMul: 6,  dmgMul: 1.6, scale: 1.4, gold: 200, name: 'TOMB COLOSSUS' },
      { type: 'desert_miniboss',       hpMul: 9,  dmgMul: 2.0, scale: 1.5, gold: 290, name: 'ANCIENT TOMB COLOSSUS' },
    ]},
  { stageIdx: 2, bossKey: 'ironclad',        mbs: [
      { type: 'military_miniboss',     hpMul: 6,  dmgMul: 1.7, scale: 1.4, gold: 200, name: 'JUGGER-MECH' },
      { type: 'military_miniboss',     hpMul: 9,  dmgMul: 2.0, scale: 1.5, gold: 290, name: 'SIEGE JUGGER-MECH' },
    ]},
  { stageIdx: 3, bossKey: 'ossarius',        mbs: [
      { type: 'ossuary_miniboss',      hpMul: 7,  dmgMul: 1.7, scale: 1.4, gold: 210, name: 'GRAVE TITAN' },
      { type: 'ossuary_miniboss',      hpMul: 10, dmgMul: 2.0, scale: 1.5, gold: 300, name: 'ELDER GRAVE TITAN' },
    ]},
  { stageIdx: 4, bossKey: 'blightsovereign', mbs: [
      { type: 'swamp_miniboss',        hpMul: 7,  dmgMul: 1.7, scale: 1.4, gold: 210, name: 'PLAGUE HULK' },
      { type: 'swamp_miniboss',        hpMul: 10, dmgMul: 2.0, scale: 1.5, gold: 300, name: 'ELDER PLAGUE HULK' },
    ]},
  { stageIdx: 5, bossKey: 'emberoracle',     mbs: [
      { type: 'volcano_miniboss',      hpMul: 7,  dmgMul: 1.8, scale: 1.4, gold: 220, name: 'MAGMA GOLEM' },
      { type: 'volcano_miniboss',      hpMul: 11, dmgMul: 2.1, scale: 1.5, gold: 310, name: 'ELDER MAGMA GOLEM' },
    ]},
  { stageIdx: 6, bossKey: 'mirroredone',     mbs: [
      { type: 'arctic_miniboss',       hpMul: 8,  dmgMul: 1.8, scale: 1.4, gold: 220, name: 'FROST WYRM' },
      { type: 'arctic_miniboss',       hpMul: 11, dmgMul: 2.1, scale: 1.5, gold: 310, name: 'ELDER FROST WYRM' },
    ]},
  { stageIdx: 7, bossKey: 'vanguardatlas',   mbs: [
      { type: 'crystal_cave_miniboss', hpMul: 8,  dmgMul: 1.9, scale: 1.4, gold: 240, name: 'GEODE GUARDIAN' },
      { type: 'crystal_cave_miniboss', hpMul: 12, dmgMul: 2.2, scale: 1.5, gold: 330, name: 'ELDER GEODE GUARDIAN' },
    ]},
  { stageIdx: 8, bossKey: 'lastsovereign',   mbs: [
      { type: 'omega_miniboss',        hpMul: 9,  dmgMul: 1.9, scale: 1.4, gold: 240, name: 'SENTINEL PRIME' },
      { type: 'omega_miniboss',        hpMul: 13, dmgMul: 2.3, scale: 1.55, gold: 340, name: 'APEX SENTINEL PRIME' },
    ]},
  { stageIdx: 9, bossKey: 'thewarden',       mbs: [
      { type: 'fortress_miniboss',     hpMul: 10, dmgMul: 2.0, scale: 1.45, gold: 260, name: 'BLACK KNIGHT' },
      { type: 'fortress_miniboss',     hpMul: 14, dmgMul: 2.5, scale: 1.55, gold: 360, name: 'IRON BLACK KNIGHT' },
    ]},
];

// wave=1, veteran (diff×1.0), solo (coop×1.0), ngp=0 (×1.0)
// boss HP also scaled by _sm = 0.74 + wave*0.052 = 0.792 at wave 1
const wave = 1;
const waveScale = Math.min(1 + (wave - 1) * 0.10, 4.0);  // 1.0
const diffHp = 1.0;
const ngpMul = 1.0;
const coopMul = 1.0;
const bossSm = 0.74 + wave * 0.052; // 0.792

for (const { stageIdx, bossKey, mbs } of STAGE_MINIBOSS_MAP) {
  const stage = STAGES[stageIdx];
  const bossConfig = BOSS_CONFIGS[bossKey];
  const bossHp = Math.round(bossConfig.hp * bossSm);
  console.log(`\n  Stage ${stageIdx + 1} [${stage.kind}] boss=${bossKey} bossTankHP=${bossHp}`);

  // Verify stage wiring matches expected
  assert(stage.miniBosses.length === 2,
    `miniBosses has exactly 2 entries (was ${stage.miniBosses.length})`);

  for (let i = 0; i < mbs.length; i++) {
    const m = mbs[i];
    const staged = stage.miniBosses[i];
    assert(staged.type === m.type, `  entry${i} type='${m.type}'`);
    assert(staged.name === m.name, `  entry${i} name='${m.name}'`);
    assert(staged.power === '', `  entry${i} power=''`);

    // Simulate spawnMiniBoss
    const e = makeEnemy(m.type, 500, 500);
    const scaledHp = Math.round(e.hp * m.hpMul * waveScale * diffHp * ngpMul * coopMul);
    const scaledR  = Math.round(e.r * m.scale);
    // Apply isMiniBoss flag (as spawnMiniBoss does)
    e.isMiniBoss = true;
    e.hp = scaledHp;
    e.maxHp = scaledHp;
    e.r = scaledR;
    e.gold = m.gold;
    e.name = m.name;

    const pct = ((scaledHp / bossHp) * 100).toFixed(1);
    assert(e.isMiniBoss === true,    `  isMiniBoss=true`);
    assert(scaledHp > 0,             `  scaledHP=${scaledHp} (${pct}% of bossHP ${bossHp})`);
    assert(scaledHp < bossHp,        `  scaledHP ${scaledHp} < bossHP ${bossHp}`);
    assert(e.behavior === ENEMY_STATS[m.type].behavior, `  behavior preserved`);
    console.log(`    ${m.name}: HP=${scaledHp} (${pct}% of boss), r=${scaledR}, gold=${e.gold}`);
  }
}

// ── 4. Stage wiring completeness — all 10 stages have new types ─────────────
console.log('\n=== 4. Stage wiring — all 10 stages use dedicated miniboss types ===');
const NEW_MB_TYPES = new Set(MINIBOSS_SPECS.map(s => s.type));
for (const stage of STAGES) {
  const allNew = stage.miniBosses.every(mb => NEW_MB_TYPES.has(mb.type));
  assert(allNew,
    `Stage ${stage.id} (${stage.kind}): all miniBosses use dedicated types (${stage.miniBosses.map(m=>m.type).join(', ')})`);
}

// ── 5. No old elite types leak into miniBosses ───────────────────────────────
console.log('\n=== 5. Old elite-enemy types purged from miniBosses ===');
const OLD_TYPES = ['forest_mosshusk','forest_sporemother','forest_vinelasher',
  'desert_sandram','desert_warden','desert_lurker','soldier','sniper',
  'ossuary_colossus','ossuary_lancer','ossuary_bulwark',
  'swamp_bulwark','swamp_bloat','swamp_angler',
  'volcano_slag_behemoth','volcano_obsidian_ram','volcano_lava_warden',
  'arctic_behemoth','arctic_avalanche','arctic_mirrorsentinel',
  'crystal_cave_facet_guardian','crystal_cave_prism_lance','crystal_cave_refraction_lurker',
  'omega_core_juggernaut','omega_arc_lance','omega_aegis_dish',
  'fortress_colossus','fortress_lancer','fortress_tower_shield'];
for (const stage of STAGES) {
  const leaked = stage.miniBosses.filter(mb => OLD_TYPES.includes(mb.type));
  assert(leaked.length === 0,
    `Stage ${stage.id}: no old elite types (found: ${leaked.map(m=>m.type).join(', ')||'none'})`);
}

// ── 6. Regression: pre-existing ENEMY_STATS still intact ────────────────────
console.log('\n=== 6. Regression — pre-existing ENEMY_STATS not clobbered ===');
const LEGACY_SPOT_CHECK = ['grunt','runner','brute','shooter','ninja','sniper',
  'forest_mosshusk','desert_sandram','swamp_leech','volcano_cinderling',
  'arctic_rimeguard','crystal_cave_crawler','omega_chrome_husk','fortress_ironguard'];
for (const t of LEGACY_SPOT_CHECK) {
  assert(!!ENEMY_STATS[t], `ENEMY_STATS["${t}"] still present`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
