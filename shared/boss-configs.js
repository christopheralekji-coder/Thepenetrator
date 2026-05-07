// Boss-config data — speglar BOSS_CONFIGS i game.js:167-228.
// MÅSTE hållas i sync vid varje boss-ändring.
'use strict';

const BOSS_CONFIGS = {
  likvakare:    { name: 'Jimmys Likvakare', subtitle: 'Rebellprästen i skogen', hp: 580, speed: 110, dmg: 28, r: 26, color: '#3a2a44', accent: '#7a5aaa', glow: '#aaff5a', ai: 'caster', gold: 220 },
  benkrossare:  { name: 'Mourads Benkrossare', subtitle: 'Bepansrad legoknekt', hp: 780, speed: 90, dmg: 42, r: 30, color: '#7a4030', accent: '#3a1810', glow: '#ff5a30', ai: 'tank_charger', gold: 280 },
  strypare:     { name: 'Jimmys Strypare', subtitle: 'Cyber-mördare i lobbyn', hp: 720, speed: 200, dmg: 26, r: 20, color: '#1a1a22', accent: '#ff3a44', glow: '#ff3a44', ai: 'cloaker', gold: 320 },
  avrattare:    { name: 'Mourads Avrättare', subtitle: 'GENERALEN — pansrad krossare', hp: 1350, speed: 120, dmg: 45, r: 32, color: '#3a2418', accent: '#ff6a30', glow: '#ff8a30', ai: 'brute_charger', gold: 450 },
  kottkvarn:    { name: 'Jimmys Köttkvarn', subtitle: 'Kybernetisk experiment-vapen', hp: 1080, speed: 120, dmg: 34, r: 28, color: '#3a3a48', accent: '#3acaff', glow: '#3acaff', ai: 'plasma', gold: 380 },
  askmakare:    { name: 'Mourads Askmakare', subtitle: 'Pyromaniker med jetpack', hp: 1200, speed: 165, dmg: 36, r: 26, color: '#3a1a14', accent: '#ff8a30', glow: '#ff5a14', ai: 'jetpack', gold: 420 },
  lungrivare:   { name: 'Jimmys Lungrivare', subtitle: 'SKUGGAN — gasmask och gift', hp: 1450, speed: 150, dmg: 34, r: 22, color: '#2a3a30', accent: '#9aff5a', glow: '#9aff5a', ai: 'gas_sniper', gold: 500 },
  skallsprackare: { name: 'Mourads Skallspräckare', subtitle: 'Riot-shield, magnum, oöm', hp: 1230, speed: 105, dmg: 40, r: 28, color: '#3a3a44', accent: '#dcdcdc', glow: '#ff3a3a', ai: 'shielder', gold: 460 },
  sjalaatare:   { name: 'Jimmys Själaätare', subtitle: 'Avataren — dödar kropp och själ', hp: 1800, speed: 130, dmg: 42, r: 30, color: '#1a0a14', accent: '#aa3aff', glow: '#aa3aff', ai: 'avatar', gold: 700 },
  gravgravaren: { name: 'Mourad, Gravgrävaren', subtitle: 'Det riktiga slutet', hp: 3300, speed: 155, dmg: 55, r: 34, color: '#3a0a14', accent: '#ffd54a', glow: '#ff1a1a', ai: 'final', gold: 1500 },
};

function getBossConfig(key) { return BOSS_CONFIGS[key]; }

module.exports = { BOSS_CONFIGS, getBossConfig };
