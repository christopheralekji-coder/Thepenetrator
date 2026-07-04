// Enemy stats + AI för server-side simulation. Phase 2: alla 14 typer + status-effekter.
// Speglar makeEnemy (game.js:2315-2351) och updateEnemies (game.js:7253-7491).
// SKIPPED i Phase 2 (kommer i senare faser):
//   - Cover-seeking för shooter/soldier (kräver stageState.buildings → Phase 5)
//   - Boss-AI (e.isBoss → Phase 4)
//   - Building collision (Phase 5)
//   - explode() som kallas av bomber (Phase 3)
'use strict';

// MÅSTE matcha game.js:2315-2351. Vid ändringar i game.js måste denna uppdateras.
const ENEMY_STATS = {
  grunt:    { r: 12, hp: 20, speed: 90,  dmg: 10, color: '#5a6a3a', accent: '#1a1a1a', gold: 6,  name: '' },
  runner:   { r: 10, hp: 14, speed: 170, dmg: 8,  color: '#3a2a1a', accent: '#000',     gold: 9,  name: '' },
  brute:    { r: 19, hp: 70, speed: 70,  dmg: 18, color: '#5a2828', accent: '#3a1010', gold: 14, name: '' },
  shooter:  { r: 12, hp: 22, speed: 75,  dmg: 0,  color: '#3a3a5a', accent: '#1a1a2a', gold: 12, name: '',
              shootRange: 360, shootRate: 1400, bulletSpeed: 360, bulletDmg: 9, bulletColor: '#a070ff' },
  ninja:    { r: 10, hp: 18, speed: 200, dmg: 14, color: '#1a1a1a', accent: '#7a1a1a', gold: 11, name: '' },
  swordsman:{ r: 13, hp: 35, speed: 100, dmg: 16, color: '#3a3a1a', accent: '#bcbcbc', gold: 13, name: '' },
  soldier:  { r: 12, hp: 28, speed: 90,  dmg: 0,  color: '#4a5a2a', accent: '#1a1a1a', gold: 14, name: '',
              shootRange: 280, shootRate: 1100, bulletSpeed: 480, bulletDmg: 11, bulletColor: '#ffae3a' },
  robot:    { r: 16, hp: 90, speed: 65,  dmg: 22, color: '#5a5a64', accent: '#ff3a3a', gold: 22, name: '' },
  dog:      { r: 9,  hp: 12, speed: 230, dmg: 10, color: '#2a1810', accent: '#1a0a08', gold: 7,  name: '' },
  healer:   { r: 11, hp: 26, speed: 80,  dmg: 0,  color: '#3a5a2a', accent: '#9aff5a', gold: 20, name: '' },
  summoner: { r: 12, hp: 32, speed: 70,  dmg: 0,  color: '#3a1a44', accent: '#aa3aff', gold: 25, name: '' },
  bomber:   { r: 10, hp: 18, speed: 200, dmg: 50, color: '#7a2a1a', accent: '#ff3a14', gold: 14, name: '' },
  sniper:   { r: 11, hp: 22, speed: 60,  dmg: 0,  color: '#1a2a18', accent: '#ff3a3a', gold: 22, name: '',
              shootRange: 700, shootRate: 2200, bulletSpeed: 900, bulletDmg: 35, bulletColor: '#ff3a3a' },
  swarmer:  { r: 7,  hp: 6,  speed: 260, dmg: 6,  color: '#5a3a1a', accent: '#ff8a3a', gold: 4,  name: '' },
  // v2 FOREST BIOME (stage 1) — data-driven behavior system
  forest_mosshusk:    { r: 18, hp: 66, speed: 62,  dmg: 17, color: '#4a5a2a', accent: '#2a3a1a', gold: 14, name: '', behavior: 'melee' },
  forest_sporefly:    { r: 9,  hp: 16, speed: 235, dmg: 9,  color: '#7a8a2a', accent: '#3a4a10', gold: 9,  name: '', behavior: 'melee' },
  forest_chokecap:    { r: 12, hp: 24, speed: 95,  dmg: 8,  color: '#5a6a2a', accent: '#a08a2a', gold: 11, name: '', behavior: 'slow_melee', slowMul: 0.55, slowMs: 2500 },
  forest_sporespitter:{ r: 13, hp: 26, speed: 68,  dmg: 0,  color: '#8a9a3a', accent: '#b7e05a', gold: 14, name: '', behavior: 'spread',    shootRange: 300, shootRate: 1500, bulletSpeed: 340, bulletDmg: 8,  pellets: 4, spreadDeg: 40, bulletColor: '#b7e05a' },
  forest_cursewisp:   { r: 10, hp: 22, speed: 90,  dmg: 0,  color: '#3a5a2a', accent: '#7dff9a', gold: 16, name: '', behavior: 'homing',    shootRange: 340, shootRate: 1600, bulletSpeed: 230, bulletDmg: 9,  homingStrength: 0.09, bulletColor: '#7dff9a' },
  forest_vinelasher:  { r: 14, hp: 40, speed: 60,  dmg: 12, color: '#3a5a1a', accent: '#6a8a3a', gold: 18, name: '', behavior: 'root_hook', shootRange: 260, shootRate: 4000, bulletSpeed: 420, bulletDmg: 6,  rootMs: 900, rootMul: 0.35, bulletColor: '#6a8a3a' },
  forest_rotbloom:    { r: 13, hp: 30, speed: 100, dmg: 11, color: '#5a4a2a', accent: '#8a6a1a', gold: 12, name: '', behavior: 'split',     splitType: 'forest_sporeling', splitCount: 2 },
  forest_sporemother: { r: 17, hp: 78, speed: 66,  dmg: 14, color: '#4a7a2a', accent: '#9aff5a', gold: 26, name: '', behavior: 'lob_aoe',  shootRange: 320, shootRate: 3500, bulletSpeed: 300, aoeRadius: 70, aoeDmg: 18, bulletColor: '#9aff5a' },
  forest_sporeling:   { r: 8,  hp: 8,  speed: 200, dmg: 6,  color: '#6a8a3a', accent: '#a0c050', gold: 2,  name: '', behavior: 'melee' },
  // v2 DESERT BIOME (stage 2) — data-driven behavior system
  desert_jackal:    { r: 9,  hp: 14, speed: 235, dmg: 9,  color: '#b8934a', accent: '#7a5a2a', gold: 8,  name: '', behavior: 'melee' },
  desert_husk:      { r: 13, hp: 26, speed: 85,  dmg: 11, color: '#c8a96a', accent: '#8a6a3a', gold: 9,  name: '', behavior: 'split',     splitType: 'desert_huskling', splitCount: 2 },
  desert_reaver:    { r: 12, hp: 24, speed: 80,  dmg: 0,  color: '#b05a2a', accent: '#6a2a0a', gold: 14, name: '', behavior: 'spread',    shootRange: 300, shootRate: 1500, bulletSpeed: 420, bulletDmg: 7, pellets: 4, spreadDeg: 34, bulletColor: '#ffb24a' },
  desert_mirage:    { r: 10, hp: 20, speed: 120, dmg: 0,  color: '#6a8a9a', accent: '#2a4a5a', gold: 15, name: '', behavior: 'homing',    shootRange: 340, shootRate: 1700, bulletSpeed: 300, bulletDmg: 8, homingStrength: 0.09, bulletColor: '#7fe0ff' },
  desert_sandram:   { r: 17, hp: 60, speed: 95,  dmg: 16, color: '#9a5a2a', accent: '#5a2a0a', gold: 20, name: '', behavior: 'charger',   dashInterval: 3000, dashSpeed: 520, dashDmg: 26, telegraphMs: 260 },
  desert_lurker:    { r: 12, hp: 30, speed: 150, dmg: 15, color: '#6a5a3a', accent: '#3a2a1a', gold: 16, name: '', behavior: 'burrow',    burrowInterval: 5000, submergeMs: 1200, underSpeed: 230, resurfaceDmg: 15 },
  desert_tarspitter:{ r: 13, hp: 34, speed: 70,  dmg: 0,  color: '#5a4a1a', accent: '#2a1a0a', gold: 17, name: '', behavior: 'lob_aoe',  shootRange: 260, shootRate: 2600, bulletSpeed: 300, aoeRadius: 55, aoeDmg: 14, bulletColor: '#7a6a2a' },
  desert_warden:    { r: 16, hp: 78, speed: 70,  dmg: 18, color: '#aa8a2a', accent: '#6a5a0a', gold: 24, name: '', behavior: 'root_hook', shootRange: 320, shootRate: 4000, bulletSpeed: 420, bulletDmg: 10, rootMs: 900, rootMul: 0.40, bulletColor: '#d4af37' },
  desert_huskling:  { r: 8,  hp: 13, speed: 150, dmg: 6,  color: '#c0a060', accent: '#805030', gold: 2,  name: '', behavior: 'melee' },
  // v2 SWAMP BIOME (stage 5) — data-driven behavior system
  swamp_oozeling:  { r: 14, hp: 26, speed: 90,  dmg: 9,  color: '#3a5a2a', accent: '#1a3a1a', gold: 8,  name: '', behavior: 'split',     splitType: 'swamp_ooze_mini', splitCount: 2 },
  swamp_leech:     { r: 9,  hp: 16, speed: 175, dmg: 8,  color: '#1a3a1a', accent: '#4a7a2a', gold: 8,  name: '', behavior: 'lifesteal', lifestealPct: 100 },
  swamp_drowned:   { r: 12, hp: 30, speed: 110, dmg: 16, color: '#2a4a4a', accent: '#1a2a2a', gold: 13, name: '', behavior: 'burrow',    burrowInterval: 4200, submergeMs: 1200, underSpeed: 230, resurfaceDmg: 16 },
  swamp_spitter:   { r: 12, hp: 24, speed: 70,  dmg: 0,  color: '#4a7a3a', accent: '#8aff3a', gold: 13, name: '', behavior: 'spread',    shootRange: 300, shootRate: 1500, bulletSpeed: 340, bulletDmg: 8, pellets: 4, spreadDeg: 34, bulletColor: '#8aff3a' },
  swamp_wisp:      { r: 10, hp: 20, speed: 120, dmg: 0,  color: '#5a8a3a', accent: '#b6ff5a', gold: 14, name: '', behavior: 'homing',    shootRange: 340, shootRate: 1600, bulletSpeed: 240, bulletDmg: 9, homingStrength: 0.09, bulletColor: '#b6ff5a' },
  swamp_bloat:     { r: 12, hp: 24, speed: 150, dmg: 10, color: '#5a6a2a', accent: '#8aff3a', gold: 12, name: '', behavior: 'exploder',  fuseMs: 700, aoeRadius: 90, aoeDmg: 32 },
  swamp_angler:    { r: 13, hp: 34, speed: 65,  dmg: 12, color: '#3a5a4a', accent: '#9a8a5a', gold: 16, name: '', behavior: 'root_hook', shootRange: 260, shootRate: 3600, bulletSpeed: 420, bulletDmg: 6, rootMs: 900, rootMul: 0.40, bulletColor: '#9a8a5a' },
  swamp_bulwark:   { r: 18, hp: 95, speed: 62,  dmg: 20, color: '#3a5a2a', accent: '#1a3a1a', gold: 26, name: '', behavior: 'shielder',  dmgReduce: 70 },
  swamp_ooze_mini: { r: 8,  hp: 10, speed: 120, dmg: 6,  color: '#4a6a2a', accent: '#2a4a1a', gold: 2,  name: '', behavior: 'melee' },
  // v2 OSSUARY BIOME (stage 4) — data-driven behavior system
  ossuary_shambler:    { r: 12, hp: 18, speed: 95,  dmg: 9,  color: '#9a8a7a', accent: '#5a4a3a', gold: 6,  name: '', behavior: 'melee' },
  ossuary_colossus:    { r: 18, hp: 88, speed: 62,  dmg: 20, color: '#7a6a5a', accent: '#3a2a1a', gold: 24, name: '', behavior: 'melee' },
  ossuary_spitter:     { r: 12, hp: 24, speed: 78,  dmg: 0,  color: '#b8b48a', accent: '#7a7050', gold: 15, name: '', behavior: 'spread',    shootRange: 300, shootRate: 1600, bulletSpeed: 300, bulletDmg: 7,  pellets: 4, spreadDeg: 40, bulletColor: '#dfe8c8' },
  ossuary_wisp:        { r: 10, hp: 20, speed: 110, dmg: 0,  color: '#7affd0', accent: '#3ab888', gold: 16, name: '', behavior: 'homing',    shootRange: 340, shootRate: 1800, bulletSpeed: 240, bulletDmg: 8,  homingStrength: 0.09, bulletColor: '#7affd0' },
  ossuary_lancer:      { r: 14, hp: 40, speed: 120, dmg: 14, color: '#8a8a9a', accent: '#4a4a5a', gold: 18, name: '', behavior: 'charger',   dashInterval: 3000, dashSpeed: 520, dashDmg: 26, telegraphMs: 600 },
  ossuary_bulwark:     { r: 15, hp: 60, speed: 70,  dmg: 12, color: '#8a8070', accent: '#4a4030', gold: 20, name: '', behavior: 'shielder',  dmgReduce: 60 },
  ossuary_hook_wraith: { r: 11, hp: 26, speed: 85,  dmg: 6,  color: '#c9b48a', accent: '#8a7050', gold: 17, name: '', behavior: 'root_hook', shootRange: 360, shootRate: 3500, bulletSpeed: 420, bulletDmg: 6,  rootMs: 900, rootMul: 0.40, bulletColor: '#c9b48a' },
  ossuary_splitter:    { r: 13, hp: 30, speed: 100, dmg: 12, color: '#8a7a6a', accent: '#5a4a3a', gold: 12, name: '', behavior: 'split',     splitType: 'ossuary_crawler', splitCount: 2 },
  ossuary_crawler:     { r: 8,  hp: 8,  speed: 150, dmg: 7,  color: '#b8a890', accent: '#7a6850', gold: 2,  name: '', behavior: 'melee' },
  // v2 VOLCANO BIOME (stage 6) — data-driven behavior system
  volcano_cinderling:    { r: 9,  hp: 13, speed: 195, dmg: 7,  color: '#ff6a1a', accent: '#ff3a00', gold: 8,  name: '', behavior: 'burn_melee', pBurnMs: 2500, pBurnDps: 6 },
  volcano_magma_hound:   { r: 10, hp: 16, speed: 235, dmg: 9,  color: '#c03000', accent: '#802000', gold: 9,  name: '', behavior: 'melee' },
  volcano_slag_behemoth: { r: 18, hp: 88, speed: 62,  dmg: 20, color: '#7a3a1a', accent: '#3a1a0a', gold: 24, name: '', behavior: 'melee' },
  volcano_pyre_zealot:   { r: 12, hp: 26, speed: 78,  dmg: 0,  color: '#ff6a00', accent: '#c03000', gold: 14, name: '', behavior: 'spread',    shootRange: 340, shootRate: 1600, bulletSpeed: 340, bulletDmg: 8,  pellets: 4, spreadDeg: 34, bulletColor: '#ff6a1a' },
  volcano_ember_seer:    { r: 11, hp: 24, speed: 70,  dmg: 0,  color: '#ff9a3a', accent: '#c06010', gold: 18, name: '', behavior: 'homing',    shootRange: 400, shootRate: 1900, bulletSpeed: 250, bulletDmg: 10, homingStrength: 0.09, bulletColor: '#ffb03a' },
  volcano_obsidian_ram:  { r: 15, hp: 54, speed: 95,  dmg: 14, color: '#2a2a2a', accent: '#1a1a1a', gold: 20, name: '', behavior: 'charger',   dashInterval: 3000, dashSpeed: 520, dashDmg: 26, telegraphMs: 500 },
  volcano_molten_spawn:  { r: 13, hp: 40, speed: 110, dmg: 12, color: '#e05000', accent: '#a03000', gold: 16, name: '', behavior: 'split',     splitType: 'volcano_moltenling', splitCount: 2 },
  volcano_lava_warden:   { r: 13, hp: 46, speed: 74,  dmg: 0,  color: '#d04010', accent: '#901a00', gold: 22, name: '', behavior: 'lob_aoe',  shootRange: 300, shootRate: 2500, bulletSpeed: 300, aoeRadius: 55, aoeDmg: 16, bulletColor: '#ff5a1a' },
  volcano_moltenling:    { r: 8,  hp: 10, speed: 160, dmg: 8,  color: '#ff7a2a', accent: '#c04a00', gold: 2,  name: '', behavior: 'melee' },
};

function makeEnemy(type, x, y) {
  const base = ENEMY_STATS[type] || ENEMY_STATS.grunt;
  const e = {
    type, x, y,
    vx: 0, vy: 0,
    r: base.r,
    hp: base.hp, maxHp: base.hp,
    speed: base.speed, _origSpeed: base.speed,
    dmg: base.dmg,
    color: base.color, accent: base.accent,
    name: base.name || '',
    gold: base.gold,
    contactCd: 0,
    lastShot: 0,
    flashUntil: 0,
    isBoss: false,
    isMiniBoss: false,
    bossKey: '',
    phase: 0,
    facing: 0,
    walkPhase: Math.random() * Math.PI * 2,
    dead: false,
    // ranged extras
    shootRange: base.shootRange || 0,
    shootRate: base.shootRate || 0,
    bulletSpeed: base.bulletSpeed || 0,
    bulletDmg: base.bulletDmg || 0,
    bulletColor: base.bulletColor || '#ff5a5a',
    // status-effekter
    burnUntil: 0, burnDps: 0,
    slowUntil: 0, slowFactor: 1,
    mindControlled: false, mindControlUntil: 0,
    staggerUntil: 0,
    // type-specific
    healAt: 0, summonAt: 0, fuse: 0, aiming: false, aimAt: 0,
    // v2 C4/C3: FX-mål för world-paketets JSON-fält (ht/at). Påverkar INGEN AI —
    // sätts av healer/sniper-AI:n och läses bara av JSON-pkt-bygget i room-sim.
    _healTargetIdx: -1, _aimTargetPid: null,
    coverCheckUntil: 0, targetCover: null,
    // v2 forest/biome data-driven behavior system
    behavior:       base.behavior       || 'melee',
    pellets:        base.pellets        || 1,
    spreadDeg:      base.spreadDeg      || 40,
    homingStrength: base.homingStrength || 0,
    aoeRadius:      base.aoeRadius      || 0,
    aoeDmg:         base.aoeDmg        || 0,
    rootMs:         base.rootMs        || 0,
    rootMul:        base.rootMul       || 1,
    slowMul:        base.slowMul       || 0.55,
    slowMs:         base.slowMs        || 2500,
    splitType:      base.splitType     || null,
    splitCount:     base.splitCount    || 0,
    // v2 desert charger behavior
    dashInterval:   base.dashInterval  || 3000,
    dashSpeed:      base.dashSpeed     || 520,
    dashDmg:        base.dashDmg      || 26,
    telegraphMs:    base.telegraphMs   || 260,
    // v2 desert burrow behavior
    burrowInterval: base.burrowInterval || 5000,
    submergeMs:     base.submergeMs    || 1200,
    underSpeed:     base.underSpeed    || 230,
    resurfaceDmg:   base.resurfaceDmg  || 15,
    // v2 ossuary shielder behavior — 0 = no reduction (all other enemies)
    dmgReduce:      base.dmgReduce     || 0,
    // v2 swamp lifesteal behavior — 0 = no lifesteal (all other enemies)
    lifestealPct:   base.lifestealPct  || 0,
    // v2 swamp exploder behavior — fuse timer trigger (ms); fuse counter lives on e.fuse
    fuseMs:         base.fuseMs        || 700,
    // v2 volcano burn_melee behavior — player-burn params (pBurnMs/pBurnDps to avoid colliding
    // with the enemy's own burnUntil/burnDps status fields which track the ENEMY's own burn state)
    pBurnMs:        base.pBurnMs       || 0,
    pBurnDps:       base.pBurnDps      || 0,
  };
  return e;
}

// Hitta närmsta levande target. För companion-aggro: 25% av enemies (sticky
// per-enemy via e._companionAggro) preferar companion om finns + alive.
function findNearestPlayer(e, players) {
  // Filter companion-only och player-only
  let nearestPlayer = null, nearestPlayerD2 = Infinity;
  let nearestCompanion = null, nearestCompanionD2 = Infinity;
  for (const p of players) {
    if (p.hp <= 0) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (p._isCompanion) {
      if (d2 < nearestCompanionD2) { nearestCompanionD2 = d2; nearestCompanion = p; }
    } else {
      if (d2 < nearestPlayerD2) { nearestPlayerD2 = d2; nearestPlayer = p; }
    }
  }
  // Persistent aggro-flag: 25% av enemies targetar companion om den finns
  if (nearestCompanion) {
    if (e._companionAggro === undefined) e._companionAggro = Math.random() < 0.25;
    if (e._companionAggro && nearestCompanionD2 < nearestPlayerD2 * 2.25) {
      return nearestCompanion;
    }
  }
  return nearestPlayer || nearestCompanion;
}

function spawnHostileBullet(sim, e, target) {
  e._attackFxUntil = Date.now() + 220;   // attack-anim-telegraf (klient fx-bit 256)
  const dx = target.x - e.x, dy = target.y - e.y;
  const ang = Math.atan2(dy, dx);
  sim.bullets.push({
    x: e.x, y: e.y,
    vx: Math.cos(ang) * e.bulletSpeed,
    vy: Math.sin(ang) * e.bulletSpeed,
    dmg: e.bulletDmg, life: e.type === 'sniper' ? 1.5 : 2,
    r: e.type === 'sniper' ? 5 : 4,
    color: e.bulletColor, hostile: true,
  });
}

// Status-effekter — speglar game.js:7297-7314
// v2: allEnemies (valfri) för Kraftbrand-perkens eld-spridning
function updateStatus(e, dt, now, allEnemies) {
  let speedMul = 1;
  // v2: Kraftbrand — brinnande fiende tänder närmsta granne (ett hopp per fiende)
  if (e._fireSpread && !e._fireSpreadDone && e.burnUntil && now < e.burnUntil && allEnemies) {
    e._fireSpreadDone = true;
    let nearest = null, nd2 = 120 * 120;
    for (const o of allEnemies) {
      if (o === e || o.dead || (o.burnUntil && o.burnUntil > now)) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < nd2) { nd2 = d2; nearest = o; }
    }
    if (nearest) {
      nearest.burnUntil = now + 2500;
      nearest.burnDps = e.burnDps || 6;
      nearest._fireSpread = true;   // kedjar vidare (en gång per fiende)
      // v2 C311: bär med eldens ägare/vapen så en kedje-brand-kill krediteras
      // rätt spelare. _burnOwner/_burnWeapon sätts först i bullets.js
      // (applyBulletEffects) — tills dess undefined = oförändrat (null-credit).
      nearest._burnOwner = e._burnOwner;
      nearest._burnWeapon = e._burnWeapon;
    }
  }
  // burn (DoT)
  if (e.burnUntil && now < e.burnUntil) {
    e.hp -= (e.burnDps || 0) * dt;
    if (e.hp <= 0) {
      // v2 C311: kreditera burn-death (inkl. kedje-spridd eld) till eldens ägare.
      if (e._burnOwner) {
        e.lastDamagerPid = e._burnOwner;
        e.lastDamagerWeapon = e._burnWeapon || e.lastDamagerWeapon || 'fire';
      }
      e.dead = true; return false;
    }
  } else { e.burnUntil = 0; }
  // slow
  if (e.slowUntil && now < e.slowUntil) {
    speedMul = e.slowFactor || 0.6;
  } else { e.slowUntil = 0; e.slowFactor = 1; }
  // mind-control upphör
  if (e.mindControlled && now >= e.mindControlUntil) e.mindControlled = false;
  // tillämpa speed
  if (e._origSpeed === undefined) e._origSpeed = e.speed;
  e.speed = e._origSpeed * speedMul;
  return true;
}

// Mind-control AI: byt sida, attackera närmsta enemy
function updateMindControlled(e, dt, now, allEnemies) {
  let target = null, bestD = 600;
  for (const o of allEnemies) {
    if (o === e || o.dead || o.mindControlled) continue;
    const dx = o.x - e.x, dy = o.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; target = o; }
  }
  if (target) {
    const dx2 = target.x - e.x, dy2 = target.y - e.y;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    e.x += (dx2 / d2) * e.speed * dt;
    e.y += (dy2 / d2) * e.speed * dt;
    if (d2 < e.r + target.r + 4 && (!e.contactCd || e.contactCd <= 0)) {
      target.hp -= 25;
      e.contactCd = 0.6;
      e._attackFxUntil = now + 220;
      if (target.hp <= 0) {
        // v2 C310: kreditera kill till spelaren som castade mind-control. _mcOwner
        // sätts i bullets.js (mindcontrol-grenen) — tills dess null = oförändrat
        // beteende. Death-loopen läser lastDamagerPid/Weapon för enemy_killed.
        if (e._mcOwner) {
          target.lastDamagerPid = e._mcOwner;
          target.lastDamagerWeapon = 'mindcontrol';
        }
        target.dead = true;
      }
    }
  }
}

// ─── v2 Forest/biome data-driven behavior handlers ───────────────────────────
// Gemensam rörelse-hjälp: håll avstånd (ideal px), strafe med perioden freqMs.
function _rangedMove(e, dt, now, dx, dy, d, ideal, freqMs) {
  let mvx = 0, mvy = 0;
  if (d > ideal + 40) { mvx = dx / d; mvy = dy / d; }
  else if (d < ideal - 40) { mvx = -dx / d; mvy = -dy / d; }
  const st = Math.sin(now / freqMs + (e.walkPhase || 0));
  mvx += -dy / d * st * 0.4;
  mvy +=  dx / d * st * 0.4;
  e.x += mvx * e.speed * dt;
  e.y += mvy * e.speed * dt;
}

// 'spread' — forest_sporespitter: håll avstånd, skjut spread-salva.
function _behaviorSpread(e, dt, now, sim, p, dx, dy, d) {
  const range = e.shootRange || 300;
  _rangedMove(e, dt, now, dx, dy, d, range * 0.8, 700);
  if (d > range || now - e.lastShot < (e.shootRate || 1500)) return;
  e.lastShot = now;
  e._attackFxUntil = now + 220;
  const pellets = e.pellets || 4;
  const halfSpread = ((e.spreadDeg || 40) * Math.PI / 180) / 2;
  const step = pellets > 1 ? halfSpread * 2 / (pellets - 1) : 0;
  const baseAng = Math.atan2(dy, dx);
  const spd = e.bulletSpeed || 340;
  for (let pi = 0; pi < pellets; pi++) {
    const ang = baseAng - halfSpread + pi * step;
    sim.bullets.push({
      x: e.x, y: e.y,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      dmg: e.bulletDmg || 8, life: 2, r: 4,
      color: e.bulletColor || '#b7e05a', hostile: true,
    });
  }
}

// 'homing' — forest_cursewisp: håll avstånd, skjut självstyrande kula.
function _behaviorHoming(e, dt, now, sim, p, dx, dy, d) {
  const range = e.shootRange || 340;
  _rangedMove(e, dt, now, dx, dy, d, range * 0.8, 750);
  if (d > range || now - e.lastShot < (e.shootRate || 1600)) return;
  e.lastShot = now;
  e._attackFxUntil = now + 220;
  const spd = e.bulletSpeed || 230;
  const ang = Math.atan2(dy, dx);
  sim.bullets.push({
    x: e.x, y: e.y,
    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
    dmg: e.bulletDmg || 9, life: 2.5, r: 5,
    color: e.bulletColor || '#7dff9a', hostile: true,
    homing: true, homingStrength: e.homingStrength || 0.09, homingSpeed: spd,
  });
}

// 'lob_aoe' — forest_sporemother: håll avstånd ~shootRange, kasta spor-bomb.
// Kulan har dmg:0 och flaggan aoeOnExpire — AoE-skadan appliceras i bullets.js.
function _behaviorLobAoe(e, dt, now, sim, p, dx, dy, d) {
  const range = e.shootRange || 320;
  _rangedMove(e, dt, now, dx, dy, d, range, 900);
  if (d > range || now - e.lastShot < (e.shootRate || 3500)) return;
  e.lastShot = now;
  e._attackFxUntil = now + 220;
  const spd = e.bulletSpeed || 300;
  const ang = Math.atan2(dy, dx);
  sim.bullets.push({
    x: e.x, y: e.y,
    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
    dmg: 0, life: 1.6, r: 6,
    color: e.bulletColor || '#9aff5a', hostile: true,
    aoeOnExpire: { radius: e.aoeRadius || 70, dmg: e.aoeDmg || 18 },
  });
}

// 'root_hook' — forest_vinelasher: melé om nära, annars skjut krok-kula.
// Kula flaggas rootOnHit — slow appliceras i bullets.js vid player-träff.
// Kontaktskada (dmg:12) tas om handen av den vanliga applyContactDamage.
function _behaviorRootHook(e, dt, now, sim, p, dx, dy, d) {
  const range = e.shootRange || 260;
  // Avancera när > 60% av range; backa bara om extremt nära (<30% = melee-kontakt)
  let mvx = 0, mvy = 0;
  if (d > range * 0.6) { mvx = dx / d; mvy = dy / d; }
  else if (d < range * 0.3) { mvx = -dx / d; mvy = -dy / d; }
  const st = Math.sin(now / 800 + (e.walkPhase || 0));
  mvx += -dy / d * st * 0.3;
  mvy +=  dx / d * st * 0.3;
  e.x += mvx * e.speed * dt;
  e.y += mvy * e.speed * dt;
  // Skjut krok bara när utanför melee-räckvidd
  if (d <= range && d > 60 && now - e.lastShot >= (e.shootRate || 4000)) {
    e.lastShot = now;
    e._attackFxUntil = now + 220;
    const spd = e.bulletSpeed || 420;
    const ang = Math.atan2(dy, dx);
    sim.bullets.push({
      x: e.x, y: e.y,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      dmg: e.bulletDmg || 6, life: 1.2, r: 4,
      color: e.bulletColor || '#6a8a3a', hostile: true,
      rootOnHit: { ms: e.rootMs || 900, mul: e.rootMul || 0.35 },
    });
  }
}
// 'charger' — desert_sandram: jagar normalt; var dashInterval ms telegraferas + dashas i
// låst riktning. Telegraf: håll stilla + sätt _attackFxUntil (klient-lunge-fx). Dash: fast
// rak rörelse i låst riktning med förhöjt dmg (dashDmg). Dodgeable: riktning låses vid
// telegraftstart, inte vid dashstart. Per-enemy state: _nextDash/_dashUntil/_dashDx/_dashDy/_dashDmgActive.
function _behaviorCharger(e, dt, now, sim, p, dx, dy, d) {
  if (e._nextDash === undefined) e._nextDash = now + (e.dashInterval || 3000);
  if (e._baseDmg  === undefined) e._baseDmg  = e.dmg;

  // ── ACTIVE DASH ──
  if (e._dashUntil && now < e._dashUntil) {
    e.x += e._dashDx * (e.dashSpeed || 520) * dt;
    e.y += e._dashDy * (e.dashSpeed || 520) * dt;
    if (!e._dashDmgActive) { e.dmg = e.dashDmg || 26; e._dashDmgActive = true; }
    return;
  }
  if (e._dashDmgActive) {    // dash just ended — restore dmg + re-schedule
    e.dmg = e._baseDmg;
    e._dashDmgActive = false;
    e._dashUntil     = 0;
    e._nextDash      = now + (e.dashInterval || 3000);
    return;
  }

  // ── TELEGRAPH (windup before dash) ──
  if (e._telegraphUntil) {
    if (now < e._telegraphUntil) return;   // stand still during windup
    // Telegraph expired → launch dash immediately
    e._dashUntil      = now + 450;
    e._telegraphUntil = 0;
    return;
  }

  // ── NORMAL CHASE — trigger next dash when interval expires ──
  if (now >= e._nextDash) {
    const telegMs = e.telegraphMs || 260;
    e._nextDash       = now + 1e9;   // consumed; will be reset when dash finishes
    e._telegraphUntil = now + telegMs;
    e._attackFxUntil  = now + telegMs;
    e._dashDx = dx / d;   // lock direction at telegraph start (dodgeable)
    e._dashDy = dy / d;
    return;   // stand still first frame of telegraph
  }
  e.x += (dx / d) * e.speed * dt;
  e.y += (dy / d) * e.speed * dt;
}

// 'burrow' — desert_lurker: jagar normalt; var burrowInterval ms dyker ner underSpeed mot
// spelarens LIVE-position (snabb reposition); vid submergeMs-slut dyker upp + ger resurfaceDmg
// en gång om spelaren är nära. applyContactDamage supprimeras under dyk (e.dmg=0 varje tick).
// Varken osynlig eller odödlig — rör inte netcode-format.
// Per-enemy state: _nextBurrow / _diveUntil / _lurkerBaseDmg.
function _behaviorBurrow(e, dt, now, sim, p, dx, dy, d) {
  if (e._nextBurrow    === undefined) e._nextBurrow    = now + (e.burrowInterval || 5000);
  if (e._lurkerBaseDmg === undefined) e._lurkerBaseDmg = e.dmg;   // fångar basens dmg:15

  // ── ACTIVE DIVE (submerged) ──
  if (e._diveUntil) {
    if (now < e._diveUntil) {
      // Följ spelarens live-position snabbt under jord
      e.x += (dx / d) * (e.underSpeed || 230) * dt;
      e.y += (dy / d) * (e.underSpeed || 230) * dt;
      e.dmg = 0;   // supprimera applyContactDamage varje tick
      return;
    }
    // ── RESURFACE ──
    e._diveUntil = 0;
    e.dmg = e._lurkerBaseDmg;
    e._attackFxUntil = now + 220;
    // Tillämpa resurface-slag om spelaren är nära (speglar applyContactDamage-mönstret)
    const rsum = (p.r || 14) + e.r + 20;
    if (dx * dx + dy * dy < rsum * rsum && !p._isCompanion && !p._isCoreTarget) {
      const invulnOk = !p.invulnUntil || now >= p.invulnUntil;
      if (invulnOk) {
        let rem = e.resurfaceDmg || 15;
        if ((p.shield || 0) > 0) {
          const absorb = Math.min(p.shield, rem);
          p.shield -= absorb; rem -= absorb;
        }
        if (rem > 0) p.hp = Math.max(0, p.hp - rem);
        p._tookDamageFrom  = e;
        p._lastDamageAt    = now;
        p.invulnUntil      = now + 500;
        e.contactCd        = 0.6;   // hindra applyContactDamage samma tick
      }
    }
    e._nextBurrow = now + (e.burrowInterval || 5000);
    return;
  }

  // ── NORMAL CHASE ──
  if (now >= e._nextBurrow) {
    // Börja dyk
    e._diveUntil = now + (e.submergeMs || 1200);
    e.dmg = 0;   // omedelbar supprimering
    e.x += (dx / d) * (e.underSpeed || 230) * dt;
    e.y += (dy / d) * (e.underSpeed || 230) * dt;
    return;
  }
  e.x += (dx / d) * e.speed * dt;
  e.y += (dy / d) * e.speed * dt;
}
// 'exploder' — swamp_bloat: charges straight at the player; when within ~60px starts
// fusing (e.fuse accumulates dt seconds); when e.fuse*1000 >= fuseMs, runs the same
// AoE-vs-all-players loop as 'bomber' but parameterized by aoeRadius/aoeDmg, then
// sets e.dead = true. Mirrors the bomber block in updateEnemyAI exactly (early-return
// so it exits the dispatch before the melee branch runs).
function _behaviorExploder(e, dt, now, sim, p, dx, dy, d) {
  e.x += (dx / d) * e.speed * dt;
  e.y += (dy / d) * e.speed * dt;
  if (d < 60) e.fuse = (e.fuse || 0) + dt;
  const fuseMs = e.fuseMs || 700;
  if (e.fuse * 1000 >= fuseMs) {
    const blastR  = e.aoeRadius || 90;
    const blastDmg = e.aoeDmg  || 32;
    if (sim && sim.room && sim.room.members) {
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (now < (ws.playerState.invulnUntil || 0)) continue;
        const bdx = ws.playerState.x - e.x, bdy = ws.playerState.y - e.y;
        const bd2 = bdx * bdx + bdy * bdy;
        if (bd2 >= blastR * blastR) continue;
        const falloff = 1 - Math.sqrt(bd2) / blastR;
        let remaining = blastDmg * (0.4 + falloff * 0.6);
        if ((ws.playerState.shield || 0) > 0) {
          const absorb = Math.min(ws.playerState.shield, remaining);
          ws.playerState.shield -= absorb;
          remaining -= absorb;
        }
        if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
        ws.playerState._tookDamageFrom = e;
      }
    }
    e.dead = true;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Per-typ AI — speglar game.js:7316-7458
function updateEnemyAI(e, dt, now, sim, p, allEnemies) {
  const dxRaw = p.x - e.x, dyRaw = p.y - e.y;
  const dRaw = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw) || 1;
  const dx = dxRaw, dy = dyRaw, d = dRaw;

  // v2 forest/biome behavior dispatch — ranged+special behaviors return early;
  // 'melee'/'slow_melee'/'split'/'shielder'/'lifesteal' fall through to the melee branch.
  // 'shielder' uses melee movement; dmgReduce applied in damageEnemy (bullets.js).
  // 'lifesteal' uses melee movement; lifesteal heal applied in applyContactDamage.
  if (e.behavior && e.behavior !== 'melee' && e.behavior !== 'slow_melee' && e.behavior !== 'split' && e.behavior !== 'shielder' && e.behavior !== 'lifesteal' && e.behavior !== 'burn_melee') {
    switch (e.behavior) {
      case 'spread':    _behaviorSpread(e, dt, now, sim, p, dx, dy, d);    break;
      case 'homing':    _behaviorHoming(e, dt, now, sim, p, dx, dy, d);    break;
      case 'lob_aoe':   _behaviorLobAoe(e, dt, now, sim, p, dx, dy, d);   break;
      case 'root_hook': _behaviorRootHook(e, dt, now, sim, p, dx, dy, d); break;
      case 'charger':   _behaviorCharger(e, dt, now, sim, p, dx, dy, d);  break;
      case 'burrow':    _behaviorBurrow(e, dt, now, sim, p, dx, dy, d);   break;
      case 'exploder':  _behaviorExploder(e, dt, now, sim, p, dx, dy, d); break;
      default:          /* unknown: simple advance */ e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; break;
    }
    return;
  }

  if (e.type === 'healer') {
    // Heala närmsta dålig (within 200)
    let target = null, bestNeed = 0;
    for (const o of allEnemies) {
      if (o === e || o.dead || o.isBoss) continue;
      const need = 1 - o.hp / o.maxHp;
      if (need > 0.3 && need > bestNeed) {
        const ddx = o.x - e.x, ddy = o.y - e.y;
        if (ddx * ddx + ddy * ddy < 40000) { target = o; bestNeed = need; }
      }
    }
    if (target) {
      // v2 C4: aktiv heal-target → fx-bit 16 + JSON-fältet `ht` (beam-rendering)
      e._healTargetIdx = (typeof target._idx === 'number') ? target._idx : -1;
      const tdx = target.x - e.x, tdy = target.y - e.y;
      const td = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td > 80) { e.x += (tdx / td) * e.speed * dt; e.y += (tdy / td) * e.speed * dt; }
      if (now - e.healAt > 1500) {
        e.healAt = now;
        target.hp = Math.min(target.maxHp, target.hp + 8);
      }
    } else {
      e._healTargetIdx = -1;   // v2 C4: ingen heal-target → bit 16 av
      // backa från spelaren
      e.x -= (dx / d) * e.speed * dt;
      e.y -= (dy / d) * e.speed * dt;
    }
  } else if (e.type === 'summoner') {
    if (d < 320) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
    if (now - e.summonAt > 4500) {
      e.summonAt = now;
      // Cap-check: bara summa om vi är under cap
      if (sim.enemies.length < 80) {
        for (let i = 0; i < 2 && sim.enemies.length < 80; i++) {
          const a = Math.random() * Math.PI * 2;
          const sx = e.x + Math.cos(a) * 30, sy = e.y + Math.sin(a) * 30;
          const r = makeEnemy('runner', sx, sy);
          r._idx = sim.nextEnemyIdx++;
          sim.enemies.push(r);
        }
      }
    }
  } else if (e.type === 'bomber') {
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;
    if (d < 60) e.fuse = (e.fuse || 0) + dt;
    if (e.fuse > 0.6) {
      // v2 C113: AoE-detonation som SPEGLAR explode()-co-op-grenen (bullets.js):
      // iterera ALLA spelare i radien (inte bara AI-target), respektera
      // invulnUntil (annars instakill av nyss-respawnad/odödlig co-op-spelare),
      // dra av shield FÖRE hp och tillämpa avstånds-falloff. Bombers spawnar bara
      // i PvE/co-op → alla spelare är allierade (ingen friendly-fire-gate behövs).
      const blastR = 110;
      if (sim && sim.room && sim.room.members) {
        for (const [, ws] of sim.room.members) {
          if (!ws.playerState || ws.playerState.hp <= 0) continue;
          if (now < (ws.playerState.invulnUntil || 0)) continue;
          const bdx = ws.playerState.x - e.x, bdy = ws.playerState.y - e.y;
          const bd2 = bdx * bdx + bdy * bdy;
          if (bd2 >= blastR * blastR) continue;
          const falloff = 1 - Math.sqrt(bd2) / blastR;
          let remaining = e.dmg * (0.4 + falloff * 0.6);
          if ((ws.playerState.shield || 0) > 0) {
            const absorb = Math.min(ws.playerState.shield, remaining);
            ws.playerState.shield -= absorb;
            remaining -= absorb;
          }
          if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
          ws.playerState._tookDamageFrom = e;
        }
      }
      e.dead = true;
    }
  } else if (e.type === 'sniper') {
    // v1.425: I CD är sniper aggressivare — approachar till 220px (var: 500px
    // retreat). Tidigare stannade snipers vid världs-kanten + 500px från
    // target → osynliga campers. Player ska se dem!
    // CD-FIX: pathar vi mot kärnan (45px-waypoint framför) ska vi AVANCERA, inte retirera
    // från waypointen (annars backade snipern ut i hörnet och fastnade som shooter/soldier).
    const sniperPathing = !!(e._cdEnemy && p && p._isCoreTarget);
    const sniperRetreat = e._cdEnemy ? 220 : 500;
    if (sniperPathing) { e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; }
    else if (d < sniperRetreat) { e.x -= (dx / d) * e.speed * dt; e.y -= (dy / d) * e.speed * dt; }
    else { e.x += (dx / d) * e.speed * dt; e.y += (dy / d) * e.speed * dt; }
    if (d < e.shootRange && !e.aiming && now - e.lastShot > e.shootRate) {
      e.aiming = true; e.aimAt = now;
    }
    // v2 C3: target för sniper-laserlinjen (fx-bit 64 + JSON-fältet `at`).
    // CD/survivors-pseudo-targets ('__player_<pid>') mappas till riktig peerId;
    // core/byggnads-targets ('__core__'/'__target_*') → null (ingen laser).
    if (e.aiming) {
      const _tp = p.peerId || null;
      e._aimTargetPid = (_tp && _tp.indexOf('__player_') === 0) ? _tp.slice(9)
        : ((_tp && _tp.indexOf('__') === 0) ? null : _tp);
    }
    if (e.aiming && now - e.aimAt > 800) {
      e.aiming = false; e.lastShot = now;
      spawnHostileBullet(sim, e, p);
    }
  } else if (e.type === 'swarmer') {
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;
  } else if (e.type === 'shooter' || e.type === 'soldier') {
    // RANGED: håll avstånd, skjut, strafe (skip cover-seeking — Phase 5)
    // CD-FIX: när en CD-fiende FÖLJER FLÖDET mot kärnan är målet en 45px-waypoint RAKT
    // FRAMFÖR. Den gamla stand-off-logiken (280px) fick dem då att retirera FRÅN sin egen
    // waypoint → de backade ut i hörnet och fastnade. När vi pathar mot core (p._isCoreTarget)
    // ska vi AVANCERA. Stand-off gäller bara när vi kitar en riktig spelare (_isCoreTarget=false).
    const pathingToCore = !!(e._cdEnemy && p && p._isCoreTarget);
    let mvx = 0, mvy = 0;
    if (pathingToCore) {
      mvx = dx / d; mvy = dy / d;   // gå rakt mot kärnan längs flödet
    } else {
      const hpFrac = e.hp / e.maxHp;
      const ideal = hpFrac < 0.3 ? 420 : 280;
      if (d > ideal + 30) { mvx = dx / d; mvy = dy / d; }
      else if (d < ideal - 30) { mvx = -dx / d; mvy = -dy / d; }
    }
    // strafe (mindre sidled när vi pressar mot kärnan)
    const strafeT = Math.sin(now / 800 + (e.walkPhase || 0));
    const strafeAmt = pathingToCore ? 0.2 : 0.4;
    mvx += -dy / d * strafeT * strafeAmt;
    mvy += dx / d * strafeT * strafeAmt;
    e.x += mvx * e.speed * dt;
    e.y += mvy * e.speed * dt;
    if (d <= e.shootRange && now - e.lastShot >= e.shootRate) {
      e.lastShot = now;
      spawnHostileBullet(sim, e, p);
    }
  } else {
    // melee: grunt, runner, brute, ninja, swordsman, robot, dog
    // Stagger (push-back-effekt) — om aktiv, hoppa över rörelse.
    // Alla enemies (inkl hund) jagar oavsett distance — wander-AI togs bort.
    const staggerActive = e.staggerUntil && now < e.staggerUntil;
    if (!staggerActive) {
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
    }
  }
}

// Enemy-enemy separation (lätt push-effekt) — använder spatial-grid om
// tillgängligt (O(E) totalt istället för O(E²)). Fallback linear scan.
function applySeparation(e, allEnemies, grid) {
  // v2 C167: ackumulera alla push:ar under en READ-ONLY pass (mot e:s position vid
  // ankomst) och tillämpa EN gång efter. Förr muterades e.x/e.y mitt i query:n →
  // resultatet berodde på grannarnas iterations-ordning och var inkonsistent med
  // grid:ens bucketing av e (e flyttades men re-bucketades aldrig). Inga nya
  // per-frame-allokeringar: två lokala nummer-ackumulatorer.
  let ax = 0, ay = 0;
  if (grid) {
    // Max-radius vi behöver söka: e.r + worst-case other.r ≈ 60px
    const r = (e.r || 14) + 60;
    grid.queryRadius(e.x, e.y, r, other => {
      if (other === e || other.dead) return;
      const dx = e.x - other.x, dy = e.y - other.y;
      const d2 = dx * dx + dy * dy;
      const min = e.r + other.r;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
    });
    { const _SM = 10, _m2 = ax * ax + ay * ay; if (_m2 > _SM * _SM) { const _k = _SM / Math.sqrt(_m2); ax *= _k; ay *= _k; } }
    e.x += ax;
    e.y += ay;
    return;
  }
  // Fallback (utan grid)
  for (const other of allEnemies) {
    if (other === e || other.dead) continue;
    const dx = e.x - other.x, dy = e.y - other.y;
    const d2 = dx * dx + dy * dy;
    const min = e.r + other.r;
    if (d2 > 0 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      ax += (dx / d) * push;
      ay += (dy / d) * push;
    }
  }
  { const _SM = 10, _m2 = ax * ax + ay * ay; if (_m2 > _SM * _SM) { const _k = _SM / Math.sqrt(_m2); ax *= _k; ay *= _k; } }
  e.x += ax;
  e.y += ay;
}

// v2: SOFT PLAYER-SEPARATION — melee-fiende STANNAR vid spelarens kant (e.r+player_r)
// istallet for att ga rakt in i kroppen. Kors EFTER applyContactDamage: AI:n penetrerar
// spelaren i borjan av varje tick (fore damage-checken) -> kontaktskada triggar som vanligt,
// vi resolvar bara overlappet efterat. Bara kontakt-fiender (dmg>0). Hoppar fake core/flow-mal.
function applyPlayerSeparation(e, players) {
  if ((e.dmg || 0) <= 0) return;
  for (const p of players) {
    if (!p || p._isCompanion || p._isCoreTarget) continue;
    if (p.hp != null && p.hp <= 0) continue;
    const min = e.r + (p.r || 14);
    const dx = e.x - p.x, dy = e.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 1e-6 && d2 < min * min) {
      const d = Math.sqrt(d2);
      const push = Math.min(min - d, 10);
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
    } else if (d2 <= 1e-6) {
      e.x = p.x + min;
    }
  }
}

// Stuck-detection: om enemy inte rört sig nämnvärt på 1s, sidestepa för att gå runt obstacles.
// Bossar undantagna — telegraph-windups (charge prep, slam) behöver hålla position
// för att vara läsbara. Stagger initial check med per-enemy random offset så alla inte
// kollar exakt samtidigt (annars synkad sidestep-dans när spelaren står still).
function applyStuckSidestep(e, dt, now, target) {
  if (!target) return;
  if (e.isBoss) return;
  if (e._lastPosCheck === undefined) {
    e._lastPosCheck = now - Math.random() * 1000;
    e._lastCheckX = e.x; e._lastCheckY = e.y; e._sidestepUntil = 0;
  }
  if (e._sidestepUntil && now < e._sidestepUntil) {
    const pdx = target.x - e.x, pdy = target.y - e.y;
    const pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
    const sgn = e._sidestepDir || 1;
    e.x += (-pdy / pd) * sgn * e.speed * dt * 1.1;
    e.y += (pdx / pd) * sgn * e.speed * dt * 1.1;
  } else if (now - e._lastPosCheck > 1000) {
    const dx = e.x - e._lastCheckX, dy = e.y - e._lastCheckY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved < 30 && !e.staggerUntil) {
      e._sidestepUntil = now + 600;
      e._sidestepDir = Math.random() < 0.5 ? -1 : 1;
    }
    e._lastPosCheck = now;
    e._lastCheckX = e.x;
    e._lastCheckY = e.y;
  }
}

// Kontaktskada till närmsta spelare. Respekterar player.invulnUntil så multipla enemies
// inte dödar spelaren på 1 sekund (matchar klient-side damagePlayer's invuln-frames).
function applyContactDamage(e, p, sim) {
  if (e.contactCd > 0 || e.dmg <= 0) return;
  const now = Date.now();
  if (p.invulnUntil && now < p.invulnUntil) return;
  const dx = p.x - e.x, dy = p.y - e.y;
  const rsum = (p.r || 14) + e.r;
  if (dx * dx + dy * dy < rsum * rsum) {
    if (p._isCompanion && p._wsRef && p._wsRef.companionState) {
      // Companion-fallet: uppdatera server-side companion-state + skicka event
      const c = p._wsRef.companionState;
      c.hp = Math.max(0, c.hp - e.dmg);
      if (sim && sim.eventQueue) {
        sim.eventQueue.push({
          type: 'companion_damaged',
          peerId: p.peerId,
          hp: c.hp,
          maxHp: c.maxHp,
          dmg: e.dmg,
        });
      }
      if (c.hp <= 0) {
        c.alive = false;
        if (sim && sim.eventQueue) {
          sim.eventQueue.push({
            type: 'companion_died',
            peerId: p.peerId,
            companionId: c.id,
          });
        }
      }
      p.hp = c.hp; // för konsistent return-state
    } else {
      // v1.549: STRESSTEST gör spelaren odödlig (pure prestanda-test, ingen död)
      if (sim && sim.stresstestActive) {
        p.invulnUntil = now + 500;
        e.contactCd = 0.6;
        return;
      }
      // v1.531: Shield absorberar damage först (var bug: damage gick direkt på HP)
      let dmgRemaining = e.dmg;
      if (p.shield && p.shield > 0) {
        const absorbed = Math.min(dmgRemaining, p.shield);
        p.shield -= absorbed;
        dmgRemaining -= absorbed;
      }
      if (dmgRemaining > 0) {
        p.hp = Math.max(0, p.hp - dmgRemaining);
      }
      p._tookDamageFrom = e;
      p._lastDamageAt = now;
      // v1.610: SURVIVORS sänker invuln 500→150ms så 20 enemies kan döda dig på
      // rimlig tid. Tidigare: 500ms blockerade alla andra enemies → 1 hit/0.5s
      // oavsett hur många runt dig = 15-20s att dö trots omringning.
      p.invulnUntil = now + (sim && sim.survivorsActive ? 150 : 500);
      // v2 forest slow_melee: sätt transient player-slow (expires i tickSim-sweep)
      if (e.behavior === 'slow_melee' && !p._isCompanion && !p._isCoreTarget) {
        if (typeof p._baseSpeedMul !== 'number') p._baseSpeedMul = (p.speedMul || 1.0);
        p.speedMul  = e.slowMul || 0.55;
        p._slowUntil = now + (e.slowMs || 2500);
      }
      // v2 swamp lifesteal: after dealing contact damage to player, heal enemy by
      // e.dmg * (lifestealPct/100), capped at maxHp. Uses e.dmg (total intended damage:
      // shield+hp combined) as the heal base — simpler and avoids a separate
      // "total dealt" tracker. Only applies when hitting a real player (not companion/core).
      if (e.behavior === 'lifesteal' && e.lifestealPct > 0 && !p._isCompanion && !p._isCoreTarget) {
        e.hp = Math.min(e.maxHp, e.hp + e.dmg * (e.lifestealPct / 100));
      }
      // v2 volcano burn_melee: after contact, ignite the player with a burn DoT.
      // The DoT is ticked in the per-member sweep in tickSim (PvE/story) or tickPlayerBurn (PvP).
      // Uses pBurnMs/pBurnDps (enemy-param names) to avoid colliding with e.burnUntil/e.burnDps
      // (the enemy's own burn-status fields set by player fire weapons).
      if (e.behavior === 'burn_melee' && e.pBurnMs > 0 && !p._isCompanion && !p._isCoreTarget) {
        p.burnUntil = now + e.pBurnMs;
        p.burnDps   = e.pBurnDps;
      }
    }
    e.contactCd = 0.6;
    e._attackFxUntil = now + 220;   // attack-anim-telegraf (klient fx-bit 256)
  }
}

// v2: FIENDE-vs-PvE-STAGE-VÄGGAR (story-husen från Godot-klientens sim_start.stageWalls).
// Kulor stoppades redan server-side (bullets.js _pveWalls) men fiender gick rakt
// genom husen (V1 solo körde klient-side kollision → V2-spelare såg fiender gå
// genom väggar). Klassisk cirkel-vs-rect-resolve EFTER att AI:n flyttat (ingen
// path-ändring): knuffa ut längs minsta-penetrations-axeln så fienden GLIDER
// längs väggen istället för att fastna (V1-klientens beteende). Anropas BARA
// när walls finns (caller gate:ar på pveWalls(sim) != null) → V1-vägar orörda.
// Täcker även spawn-i-vägg (center inne i rect → knuffas till närmaste fria kant).
function resolveWallsCircle(e, walls) {
  const r = e.r || 12;
  for (let i = 0; i < walls.length; i++) {
    const wl = walls[i];
    // Närmaste punkt på rect till cirkelcentrum
    const cx = Math.max(wl.x, Math.min(wl.x + wl.w, e.x));
    const cy = Math.max(wl.y, Math.min(wl.y + wl.h, e.y));
    const dx = e.x - cx, dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;       // ingen överlapp
    if (d2 > 1e-6) {
      // Centrum utanför rect: knuffa ut längs kontakt-normalen. Vid kant-kontakt är
      // normalen axel-rät (= bara den penetrerande axeln resolvas) → tangentiella
      // rörelsekomponenten består = glid. Vid hörn blir det diagonalt (naturligt).
      const d = Math.sqrt(d2);
      const pen = r - d;
      e.x += (dx / d) * pen;
      e.y += (dy / d) * pen;
    } else {
      // Centrum INNE i rect (spawn i vägg / hög fart): ut längs minsta-penetrations-axeln
      const left = e.x - wl.x, right = wl.x + wl.w - e.x;
      const top = e.y - wl.y, bottom = wl.y + wl.h - e.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) e.x = wl.x - r;
      else if (m === right) e.x = wl.x + wl.w + r;
      else if (m === top) e.y = wl.y - r;
      else e.y = wl.y + wl.h + r;
    }
  }
}

// Huvud-uppdatering per fiende. Anropas från room-sim.js för varje enemy.
function updateEnemy(e, dt, now, sim, players) {
  if (e.dead) return;
  if (e.contactCd > 0) e.contactCd -= dt;
  // Status-effekter (kan döda enemy)
  if (!updateStatus(e, dt, now, sim.enemies)) return;
  // Mind-control byter sida
  if (e.mindControlled && now < e.mindControlUntil) {
    updateMindControlled(e, dt, now, sim.enemies);
    return;
  }
  // Hitta target
  const target = findNearestPlayer(e, players);
  if (!target) return;
  // Per-typ AI
  if (!e.isBoss) {
    updateEnemyAI(e, dt, now, sim, target, sim.enemies);
  }
  // Smartare AI: gå runt obstacles om stuck
  applyStuckSidestep(e, dt, now, target);
  // Fysik: separation + contact damage
  applySeparation(e, sim.enemies, sim.enemyGrid);
  applyContactDamage(e, target, sim);
  applyPlayerSeparation(e, players);   // v2: stanna vid spelarens kant (efter kontaktskada)
}

module.exports = {
  ENEMY_STATS,
  makeEnemy,
  updateEnemy,
  findNearestPlayer,
  resolveWallsCircle,
};
