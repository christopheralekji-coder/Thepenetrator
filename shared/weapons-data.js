// Shared weapons data — speglar WEAPONS-arrayn i game.js:1102-1152.
// MÅSTE hållas i sync vid varje vapen-ändring. Phase 8 ska unifiera via UMD.
'use strict';

// MÅSTE matcha game.js's WEAPONS-array. Borttagna: tonfa, boxgloves, glaive, drone.
const WEAPONS = [
  { id: 'fists',      type: 'melee', dmg: 8,   rate: 380, range: 36, color: '#dab27a' },
  { id: 'knuckles',   type: 'melee', dmg: 16,  rate: 320, range: 38, color: '#c0a060' },
  { id: 'knife',      type: 'melee', dmg: 22,  rate: 240, range: 38, color: '#bcc8d0' },
  { id: 'bat',        type: 'melee', dmg: 40,  rate: 440, range: 50, color: '#7a4a20' }, // v1.697: synk m. game.js (32→40)
  { id: 'machete',    type: 'melee', dmg: 42,  rate: 500, range: 56, color: '#9aa8b0' },
  { id: 'sickle',     type: 'melee', dmg: 44,  rate: 380, range: 62, color: '#9a9aa0' },
  { id: 'spear',      type: 'melee', dmg: 50,  rate: 460, range: 84, color: '#bcbccc' },
  { id: 'axe',        type: 'melee', dmg: 78,  rate: 580, range: 50, color: '#9a7a5a' }, // v1.697: synk m. game.js (60→78)
  { id: 'mace',       type: 'melee', dmg: 78,  rate: 700, range: 54, color: '#5a4a3a', knockback: 180 },
  { id: 'whip',       type: 'melee', dmg: 38,  rate: 380, range: 96, color: '#5a4a30' },
  { id: 'sledge',     type: 'melee', dmg: 130, rate: 700, range: 52, color: '#6a6a6a' }, // v1.697: dmg 100→130, rate 780→700
  { id: 'katana',     type: 'melee', dmg: 88,  rate: 360, range: 70, color: '#e6e6f0' },
  { id: 'energysword',type: 'melee', dmg: 120, rate: 340, range: 78, color: '#ff8a3a', pierce: true },
  { id: 'lightsaber', type: 'melee', dmg: 150, rate: 350, range: 78, color: '#3aff5a', pierce: true }, // (game.js har samma dmg/rate; price bara klient-side)
  { id: 'pistol',     type: 'gun',   dmg: 18,  rate: 340, speed: 700, mag: 12, reload: 1100, spread: 0.04, color: '#ffd14a' },
  { id: 'shuriken',   type: 'gun',   dmg: 14,  rate: 130, speed: 700, mag: 24, reload: 1100, spread: 0.06, color: '#cccccc', burn: 2 },
  { id: 'throwknife', type: 'gun',   dmg: 32,  rate: 280, speed: 760, mag: 12, reload: 1300, spread: 0.04, color: '#aaaacc' },
  { id: 'revolver',   type: 'gun',   dmg: 52,  rate: 580, speed: 760, mag: 6,  reload: 1500, spread: 0.02, color: '#ffae3a' },
  { id: 'burstpistol',type: 'gun',   dmg: 20,  rate: 480, speed: 720, mag: 24, reload: 1500, spread: 0.04, color: '#ffae3a', burstCount: 3, burstDelay: 70, ammoCost: 3 },
  { id: 'shotgun',    type: 'gun',   dmg: 20,  rate: 620, speed: 760, mag: 8,  reload: 1700, spread: 0.30, pellets: 6, color: '#ff6b3d' }, // v1.697: synk m. game.js (dmg/rate/speed/mag/reload/spread)
  { id: 'bow',        type: 'gun',   dmg: 90,  rate: 540, speed: 950, mag: 1,  reload: 500,  spread: 0.0,  color: '#3a8a3a', pierce: true },
  { id: 'smg',        type: 'gun',   dmg: 14,  rate: 95,  speed: 740, mag: 30, reload: 1500, spread: 0.07, color: '#88ccff' },
  { id: 'crossbow',   type: 'gun',   dmg: 110, rate: 900, speed: 950, mag: 4,  reload: 1700, spread: 0.0,  color: '#7a5a3a', pierce: true },
  { id: 'rifle',      type: 'gun',   dmg: 26,  rate: 130, speed: 820, mag: 30, reload: 1800, spread: 0.05, color: '#5fd95f' },
  { id: 'flame',      type: 'gun',   dmg: 11,  rate: 50,  speed: 400, mag: 80, reload: 2400, spread: 0.18, color: '#ff7a2a', burn: 6 },
  { id: 'sonic',      type: 'gun',   dmg: 38,  rate: 320, speed: 600, mag: 8,  reload: 1700, spread: 0.05, color: '#ff5ac4', knockback: 280 },
  { id: 'sniper',     type: 'gun',   dmg: 130, rate: 1300, speed: 1500, mag: 5, reload: 2400, spread: 0.0, pierce: true, color: '#bb88ff' },
  { id: 'frost',      type: 'gun',   dmg: 28,  rate: 180, speed: 720, mag: 16, reload: 1900, spread: 0.04, color: '#9af2ff', slow: 1.8 },
  { id: 'tesla',      type: 'gun',   dmg: 40,  rate: 200, speed: 1100, mag: 12, reload: 1800, spread: 0.0, color: '#ffeb3b', chain: 4 },
  { id: 'grenade',    type: 'gun',   dmg: 80,  rate: 950, speed: 480, mag: 6, reload: 2400, spread: 0.04, explosive: 100, color: '#9aff5a' },
  { id: 'boomerang',  type: 'gun',   dmg: 70,  rate: 550, speed: 600, mag: 8, reload: 1500, spread: 0.0, color: '#9a6a30', pierce: true, returns: true }, // v1.697: dmg 50→70 + synk m. game.js (rate 800→550, mag 4→8)
  { id: 'plasma',     type: 'gun',   dmg: 95,  rate: 280, speed: 950, mag: 12, reload: 2200, spread: 0.0, color: '#3acaff' },
  { id: 'rocket',     type: 'gun',   dmg: 150, rate: 1500, speed: 540, mag: 4, reload: 3000, spread: 0.02, explosive: 140, color: '#ff3c3c' },
  { id: 'pullwhip',   type: 'gun',   dmg: 35,  rate: 500, speed: 800, mag: 6, reload: 1700, spread: 0.0, color: '#5a4030', pullsEnemy: true },
  { id: 'timestop',   type: 'gun',   dmg: 100, rate: 900, speed: 1100, mag: 3, reload: 2500, spread: 0.0, color: '#9aff5a', timeStopMs: 1000 },
  { id: 'blackhole',  type: 'gun',   dmg: 90,  rate: 1200, speed: 480, mag: 4, reload: 2400, spread: 0.0, color: '#aa3aff', pullRadius: 200 },
  { id: 'mindcontrol',type: 'gun',   dmg: 0,   rate: 2000, speed: 600, mag: 2, reload: 4000, spread: 0.0, color: '#ff5aff', mindControlMs: 6000 },
  { id: 'railgun',    type: 'gun',   dmg: 280, rate: 1600, speed: 2200, mag: 3, reload: 3000, spread: 0.0, pierce: true, color: '#ffffff' },
  { id: 'minigun',    type: 'gun',   dmg: 22,  rate: 50,  speed: 920, mag: 100, reload: 3500, spread: 0.14, color: '#3cf0ff' },
  // turret_mg: värsting-MG som spelaren får när de mountar CTF-tornet. Hög DPS,
  // ingen reload, oändlig ammo. Bara åtkomlig via turret-enter, inte i shop.
  // BALANSERING: 14→11 dmg så MG-DPS inte är >1.4× rifle (immobil tradeoff).
  { id: 'turret_mg',  type: 'gun',   dmg: 11,  rate: 75,  speed: 1100, mag: 9999, reload: 0, spread: 0.07, color: '#ff5a3a' },
  // turret_rocket: explosivt rocket launcher i Siege-tornen. Långsamt rate
  // men HÖG dmg + AoE-explosion. BALANSERING: 120→70 dmg + 1400→1700ms rate
  // så det inte längre 1-shot:ar 200-EHP-spelare via direct+AoE-double-dip.
  { id: 'turret_rocket', type: 'gun', dmg: 70, rate: 1700, speed: 700, mag: 9999, reload: 0, spread: 0.0, color: '#ff8a3a', explosive: 80 },
  // GULAG: knockback-kanon (The Void) — 0 dmg, knuffar offret (hanteras i bullets.js BR-hook).
  // Endast åtkomlig i Gulag-1v1, aldrig i shop/loot.
  { id: 'gulag_knock', type: 'gun', dmg: 0, rate: 300, speed: 920, mag: 9999, reload: 0, spread: 0.03, color: '#5ac7ff', gulagKnock: true },
];

const W_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

module.exports = { WEAPONS, W_BY_ID };
