// Shared weapons data — speglar WEAPONS-arrayn i game.js:1102-1152.
// MÅSTE hållas i sync vid varje vapen-ändring. Phase 8 ska unifiera via UMD.
'use strict';

const WEAPONS = [
  { id: 'fists',     name: 'Knytnävar',         type: 'melee', price: 0,    dmg: 8,   rate: 380, range: 36,  color: '#dab27a' },
  { id: 'knuckles',  name: 'Mässingsknogar',    type: 'melee', price: 60,   dmg: 16,  rate: 320, range: 38,  color: '#c0a060' },
  { id: 'bat',       name: 'Påk',               type: 'melee', price: 120,  dmg: 28,  rate: 520, range: 50,  color: '#7a4a20' },
  { id: 'knife',     name: 'Kniv',              type: 'melee', price: 100,  dmg: 22,  rate: 240, range: 38,  color: '#bcc8d0' },
  { id: 'machete',   name: 'Machete',           type: 'melee', price: 200,  dmg: 38,  rate: 500, range: 56,  color: '#9aa8b0' },
  { id: 'katana',    name: 'Katana',            type: 'melee', price: 350,  dmg: 60,  rate: 460, range: 64,  color: '#e6e6f0' },
  { id: 'pistol',    name: 'Pistol',            type: 'gun',   price: 220,  dmg: 18,  rate: 340, speed: 700, mag: 12, reload: 1100, spread: 0.04, color: '#ffd14a' },
  { id: 'revolver',  name: 'Revolver',          type: 'gun',   price: 380,  dmg: 38,  rate: 580, speed: 750, mag: 6,  reload: 1500, spread: 0.03, color: '#ffae3a' },
  { id: 'shotgun',   name: 'Hagelgevär',        type: 'gun',   price: 500,  dmg: 14,  rate: 760, speed: 650, mag: 6,  reload: 1900, spread: 0.32, pellets: 6, color: '#ff6b3d' },
  { id: 'smg',       name: 'Kpist',             type: 'gun',   price: 650,  dmg: 13,  rate: 95,  speed: 720, mag: 30, reload: 1500, spread: 0.10, color: '#88ccff' },
  { id: 'rifle',     name: 'Automatkarbin',     type: 'gun',   price: 900,  dmg: 24,  rate: 130, speed: 820, mag: 30, reload: 1800, spread: 0.05, color: '#5fd95f' },
  { id: 'sniper',    name: 'Prickskyttegevär',  type: 'gun',   price: 1200, dmg: 100, rate: 1300,speed: 1400,mag: 5,  reload: 2400, spread: 0.0,  pierce: true, color: '#bb88ff' },
  { id: 'grenade',   name: 'Granatkastare',     type: 'gun',   price: 1500, dmg: 70,  rate: 950, speed: 480, mag: 6,  reload: 2400, spread: 0.04, explosive: 90,  color: '#9aff5a' },
  { id: 'rocket',    name: 'Raketgevär',        type: 'gun',   price: 2000, dmg: 130, rate: 1500,speed: 520, mag: 4,  reload: 3000, spread: 0.02, explosive: 130, color: '#ff3c3c' },
  { id: 'minigun',   name: 'Minigun',           type: 'gun',   price: 3500, dmg: 22,  rate: 55,  speed: 900, mag: 100,reload: 3500, spread: 0.14, color: '#3cf0ff' },
  // Melee
  { id: 'tonfa',     name: 'Tonfa',             type: 'melee', price: 80,   dmg: 14,  rate: 220, range: 36, color: '#444444' },
  { id: 'axe',       name: 'Yxa',               type: 'melee', price: 280,  dmg: 50,  rate: 580, range: 48, color: '#9a7a5a' },
  { id: 'sledge',    name: 'Slägga',            type: 'melee', price: 420,  dmg: 85,  rate: 780, range: 50, color: '#6a6a6a' },
  { id: 'spear',     name: 'Spjut',             type: 'melee', price: 320,  dmg: 42,  rate: 460, range: 80, color: '#bcbccc' },
  { id: 'whip',      name: 'Kedjepiska',        type: 'melee', price: 550,  dmg: 30,  rate: 380, range: 92, color: '#5a4a30' },
  { id: 'lightsaber',name: 'Laser-svärd',       type: 'melee', price: 1900, dmg: 95,  rate: 350, range: 72, color: '#3aff5a' },
  // Kasta/lätt ranged
  { id: 'shuriken',  name: 'Kaststjärnor',      type: 'gun',   price: 220,  dmg: 12,  rate: 140, speed: 620, mag: 20, reload: 1100, spread: 0.06, color: '#cccccc' },
  { id: 'throwknife',name: 'Kastkniv',          type: 'gun',   price: 350,  dmg: 30,  rate: 300, speed: 720, mag: 10, reload: 1300, spread: 0.04, color: '#aaaacc' },
  { id: 'crossbow',  name: 'Armborst',          type: 'gun',   price: 700,  dmg: 80,  rate: 900, speed: 950, mag: 4,  reload: 1700, spread: 0.0,  color: '#7a5a3a', pierce: true },
  { id: 'bow',       name: 'Compoundbåge',      type: 'gun',   price: 600,  dmg: 55,  rate: 540, speed: 920, mag: 1,  reload: 700,  spread: 0.0,  color: '#3a8a3a', pierce: true },
  // Energi/special
  { id: 'flame',     name: 'Eldkastare',        type: 'gun',   price: 1300, dmg: 9,   rate: 50,  speed: 380, mag: 80, reload: 2400, spread: 0.18, color: '#ff7a2a', burn: 4 },
  { id: 'plasma',    name: 'Plasma-gevär',      type: 'gun',   price: 2200, dmg: 85,  rate: 300, speed: 950, mag: 12, reload: 2200, spread: 0.0,  color: '#3acaff' },
  { id: 'tesla',     name: 'Tesla-pistol',      type: 'gun',   price: 1800, dmg: 35,  rate: 220, speed: 1100,mag: 12, reload: 1800, spread: 0.0,  color: '#ffeb3b', chain: 3 },
  { id: 'frost',     name: 'Frostkanon',        type: 'gun',   price: 1600, dmg: 24,  rate: 200, speed: 700, mag: 16, reload: 1900, spread: 0.04, color: '#9af2ff', slow: 1.6 },
  { id: 'sonic',     name: 'Sonic-kanon',       type: 'gun',   price: 1400, dmg: 32,  rate: 340, speed: 600, mag: 8,  reload: 1700, spread: 0.05, color: '#ff5ac4', knockback: 240 },
  // 8 nya
  { id: 'boxgloves', name: 'Boxhandskar',       type: 'melee', price: 50,   dmg: 12,  rate: 280, range: 38, color: '#aa3030' },
  { id: 'sickle',    name: 'Sickel',            type: 'melee', price: 280,  dmg: 38,  rate: 380, range: 60, color: '#9a9aa0' },
  { id: 'mace',      name: 'Stridsklubba',      type: 'melee', price: 480,  dmg: 70,  rate: 700, range: 52, color: '#5a4a3a', knockback: 180 },
  { id: 'glaive',    name: 'Glaiv',             type: 'melee', price: 700,  dmg: 50,  rate: 500, range: 75, color: '#dcdcdc' },
  { id: 'energysword',name: 'Energi-svärd',     type: 'melee', price: 1200, dmg: 95,  rate: 340, range: 76, color: '#ff8a3a', pierce: true },
  { id: 'burstpistol',name: 'Burst-pistol',     type: 'gun',   price: 380,  dmg: 14,  rate: 580, speed: 720, mag: 24, reload: 1500, spread: 0.05, color: '#ffae3a', burstCount: 3, burstDelay: 70, ammoCost: 3 },
  { id: 'railgun',   name: 'Railgun',           type: 'gun',   price: 2500, dmg: 140, rate: 1700,speed: 2000,mag: 2,  reload: 3000, spread: 0.0,  pierce: true, color: '#ffffff' },
  { id: 'blackhole', name: 'Svartphål-pistol',  type: 'gun',   price: 2800, dmg: 50,  rate: 1200,speed: 480, mag: 4,  reload: 2400, spread: 0.0,  color: '#aa3aff', pullRadius: 180 },
  // 5 kreativa
  { id: 'boomerang',  name: 'Boomerang',         type: 'gun',   price: 600,  dmg: 35,  rate: 800, speed: 600, mag: 2, reload: 1500, spread: 0.0, color: '#9a6a30', pierce: true, returns: true },
  { id: 'drone',      name: 'Drone-pistol',      type: 'gun',   price: 1500, dmg: 28,  rate: 600, speed: 700, mag: 4, reload: 2200, spread: 0.0, color: '#3acaff', summonsDrone: true },
  { id: 'timestop',   name: 'Tids-pistol',       type: 'gun',   price: 2200, dmg: 60,  rate: 900, speed: 1100,mag: 3, reload: 2500, spread: 0.0, color: '#9aff5a', timeStopMs: 800 },
  { id: 'pullwhip',   name: 'Drag-piska',        type: 'gun',   price: 800,  dmg: 25,  rate: 500, speed: 800, mag: 6, reload: 1700, spread: 0.0, color: '#5a4030', pullsEnemy: true },
  { id: 'mindcontrol',name: 'Tank-strålen',      type: 'gun',   price: 3000, dmg: 0,   rate: 2000,speed: 600, mag: 2, reload: 4000, spread: 0.0, color: '#ff5aff', mindControlMs: 5000 },
];

const W_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

module.exports = { WEAPONS, W_BY_ID };
