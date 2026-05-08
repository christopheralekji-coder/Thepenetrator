// Boss-config data — speglar BOSS_CONFIGS i game.js (måste hållas i sync).
// Uppdaterad till boss-revamp v119+: 9 finals med powerSet-array.
'use strict';

const BOSS_CONFIGS = {
  witheredelder:   { name: 'THE WITHERED ELDER',    subtitle: 'Skogens sista röst',                       hp: 3500, speed: 130, dmg: 48, r: 30, color: '#1a3018', accent: '#aaff5a', glow: '#5aff8a', ai: 'final_combo', powerSet: ['caster','tank_charger','cloaker'],         gold: 500 },
  ironclad:        { name: 'IRONCLAD HARBINGER',    subtitle: 'Pansrad rosthärlighet',                    hp: 4200, speed: 110, dmg: 56, r: 32, color: '#3a2018', accent: '#ff7a3a', glow: '#ffae5a', ai: 'final_combo', powerSet: ['brute_charger','gas_sniper','shielder'], gold: 650 },
  mirroredone:     { name: 'THE MIRRORED ONE',      subtitle: 'Den som ser ditt ansikte i varje glas',    hp: 4600, speed: 170, dmg: 46, r: 24, color: '#1a1a30', accent: '#5acaff', glow: '#aa5aff', ai: 'final_combo', powerSet: ['cloaker','caster','plasma'],             gold: 750 },
  ossarius:        { name: 'GENERAL OSSARIUS',      subtitle: 'Order i benhuset, kaos i ditt huvud',     hp: 5400, speed: 130, dmg: 60, r: 34, color: '#3a2a18', accent: '#ffd54a', glow: '#ff7a30', ai: 'final_combo', powerSet: ['brute_charger','tank_charger','avatar'], gold: 950 },
  vanguardatlas:   { name: 'VANGUARD ATLAS',        subtitle: 'Maskinen som glömde att den var en man',  hp: 5800, speed: 140, dmg: 56, r: 32, color: '#2a3a44', accent: '#3acaff', glow: '#5affaa', ai: 'final_combo', powerSet: ['plasma','gas_sniper','avatar'],          gold: 1100 },
  emberoracle:     { name: 'THE EMBER ORACLE',      subtitle: 'Hon ser askan av allt du älskat',          hp: 6300, speed: 175, dmg: 58, r: 28, color: '#3a0a14', accent: '#ff5a30', glow: '#ffae3a', ai: 'final_combo', powerSet: ['caster','jetpack','avatar'],             gold: 1300 },
  blightsovereign: { name: 'BLIGHT SOVEREIGN',      subtitle: 'Härskaren av allt som ruttnar',           hp: 6900, speed: 145, dmg: 54, r: 26, color: '#1a3a28', accent: '#9aff5a', glow: '#5affae', ai: 'final_combo', powerSet: ['gas_sniper','cloaker','caster'],         gold: 1500 },
  buriedcrown:     { name: 'THE BURIED CROWN',      subtitle: 'Begravd, men aldrig död',                  hp: 7700, speed: 115, dmg: 64, r: 32, color: '#1a1a2a', accent: '#ffd54a', glow: '#ff3a3a', ai: 'final_combo', powerSet: ['brute_charger','shielder','plasma'],     gold: 1800 },
  lastsovereign:   { name: 'THE LAST SOVEREIGN',    subtitle: 'Den sista på sin tron — du tar nästa.',    hp: 9500, speed: 155, dmg: 72, r: 36, color: '#3a0a14', accent: '#aa3aff', glow: '#ff1a1a', ai: 'final_combo', powerSet: ['avatar','jetpack','gas_sniper'],         gold: 3000 },
};

function getBossConfig(key) { return BOSS_CONFIGS[key]; }

module.exports = { BOSS_CONFIGS, getBossConfig };
