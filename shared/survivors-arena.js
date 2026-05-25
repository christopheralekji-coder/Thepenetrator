// SURVIVORS-RUN — co-op PvE survival mode (v1.525 iteration 1)
//
// Spelare överlever 20 minuter mot eskalerande vågor av fiender som
// chasear dig (inte en core). Ingen byggsystem. Roguelite-element: var
// 60s erbjuds 3 random perk-val ur en stor pool.
//
// Karta: 4000×4000. Spelaren spawnar i center. Enemies spawnar 360° runt
// utkanten av synfält och chasear närmaste spelare.
//
// Match-end:
//   - WIN: 20:00 utgår, alla spelare lever
//   - LOSE: alla spelare downed/döda samtidigt
//
'use strict';

const SURVIVORS_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'SURVIVAL RUN',
  groundColor: '#2e3e22',           // mörk-grön gräs (samma palette som CD)
  plazaColor: '#5a5450',
  pathColor: '#6a5a48',

  // Center där spelare spawnar
  centerX: 2000,
  centerY: 2000,
  plazaRadius: 180,                 // visuell stenplaza vid spawn

  // === PLAYER SPAWN-POINTS (4-player coop) ===
  playerSpawns: [
    { x: 1940, y: 1940 },
    { x: 2060, y: 1940 },
    { x: 1940, y: 2060 },
    { x: 2060, y: 2060 },
  ],

  // === ENEMY SPAWN ===
  // Spawnar OFF-CAMERA runt närmaste spelare (radius ~700px från player).
  // Hanteras i server-sim — denna fil definierar bara takter.
  enemySpawnRadius: 700,            // hur långt från player de spawnar
  enemyDespawnRadius: 1400,         // om enemy avviker så långt → despawn

  // === MATCH-TIMER ===
  matchDurationSec: 1200,           // 20 minuter
  miniBossEverySec: 240,            // mini-boss var 4 min (4, 8, 12, 16 min)
  finalBossAtSec: 1200,             // final boss vid 20 min (eller WIN om alla mini-bosses döda)

  // === WAVE-SCALING ===
  // Spawn-takt baserad på elapsed time istället för wave-count.
  // Wave-event var 25s. Antal enemies per wave skalar med tid.
  // v1.607: tätare vågor + fler enemies per wave. Time-based + overlap.
  waveIntervalSec: 22,              // 22s mellan vågor (var 25s)
  waveBaseCount: 12,                // wave 0: 12 enemies (var 6)
  waveScalePerMinute: 6,            // +6/min (var 3) — så late-game blir riktigt intensivt
  enemyCapForWave: 120,             // höjt cap så vågor kan stacka (var 80)

  // === PLAYER START-STATE ===
  startHp: 100,
  maxHp: 100,
  startShield: 100,
  maxShield: 100,
  startWeapon: 'pistol',
  startGrenades: 2,
  grenadesPerMinute: 1,             // +1 granat var minute (för mid-game flexibilitet)

  // === PERK-SYSTEM (v1.527 iteration 3) ===
  // Var 60s erbjuds 3 random val. Stack-bara (samma perk kan tas flera ggr).
  // 4 raritys: gray/green/blue/purple. Tier-rates skiftar med elapsed time så
  // late-game känns kraftfullt (mer lila).
  perkSelectionIntervalSec: 60,
  firstPerkOfferAtSec: 1,            // v1.607: första perken pop UP DIREKT vid match-start
  perkChoicesPerSelection: 6,
  perkAutoPickTimeoutSec: 15,

  // Rarity-färger (centraliserade så HUD/overlay matchar)
  rarityColors: {
    gray:   { border: '#cccccc', glow: 'rgba(200,200,200,0.6)',  bgFrom: '#5a5a5a', bgTo: '#3a3a3a', text: '#ffffff' },
    green:  { border: '#5aff8a', glow: 'rgba(90,255,138,0.7)',   bgFrom: '#3a9a4a', bgTo: '#1a5a28', text: '#ffffff' },
    blue:   { border: '#5acaff', glow: 'rgba(90,202,255,0.7)',   bgFrom: '#3a7aca', bgTo: '#1a4a8a', text: '#ffffff' },
    purple: { border: '#c878ff', glow: 'rgba(200,120,255,0.75)', bgFrom: '#7a3aaa', bgTo: '#4a1a7a', text: '#ffffff' },
  },

  // v1.531/v1.532: FAST rarity-rates oavsett tid. Höjt purple från 7% till 12%
  // (balance-audit: bara 1.4 purple per match annars — game-changers för sällsynta).
  // [grayRate, greenRate, blueRate, purpleRate], summa = 1.0
  // v1.603: per user-request — gray 50%, green 30%, blue 15%, purple 5%
  rarityRatesFixed: [0.50, 0.30, 0.15, 0.05],
  // (Legacy time-baserad behållen för bakåtkompat men används inte längre)
  rarityRatesByMinute: [
    { until: 99, rates: [0.45, 0.30, 0.18, 0.07] },
  ],

  // PERK POOL (20 perks). effect.type är hook-typ, effect.value är effekt-styrka.
  // Stack-bara: alla. Samma perk tagen 3x stackar 3x värdet (utom max-cap i hooks).
  perks: [
    // === GRÅ (Common) — basala stat-bumpar ===
    { id: 'g_dmg',     rarity: 'gray',   icon: '💥', name: 'SKADA',          desc: '+10% vapen-skada',
      effect: { type: 'dmg',    value: 0.10 } },
    { id: 'g_rate',    rarity: 'gray',   icon: '⚡', name: 'FIRE RATE',      desc: '+10% eldhastighet',
      effect: { type: 'rate',   value: 0.10 } },
    { id: 'g_hp',      rarity: 'gray',   icon: '❤️', name: 'TJOCKARE',       desc: '+20 maxHP + full heal',
      effect: { type: 'hp',     value: 20 } },
    { id: 'g_speed',   rarity: 'gray',   icon: '👟', name: 'SNABBARE',       desc: '+8% rörelse',
      effect: { type: 'speed',  value: 0.08 } },

    // === GRÖN (Uncommon) — bättre basics + utility ===
    { id: 'gn_dmg',    rarity: 'green',  icon: '💥', name: 'SKADA II',        desc: '+20% vapen-skada',
      effect: { type: 'dmg',    value: 0.20 } },
    { id: 'gn_rate',   rarity: 'green',  icon: '⚡', name: 'FIRE RATE II',    desc: '+20% eldhastighet',
      effect: { type: 'rate',   value: 0.20 } },
    { id: 'gn_hp',     rarity: 'green',  icon: '❤️', name: 'TJOCKARE II',     desc: '+50 maxHP + full heal',
      effect: { type: 'hp',     value: 50 } },
    { id: 'gn_speed',  rarity: 'green',  icon: '👟', name: 'SNABBARE II',     desc: '+15% rörelse',
      effect: { type: 'speed',  value: 0.15 } },
    { id: 'gn_reload', rarity: 'green',  icon: '🔄', name: 'OMLADDNING',      desc: '−20% reload-tid',
      effect: { type: 'reload', value: 0.20 } },
    { id: 'gn_magnet', rarity: 'green',  icon: '🧲', name: 'MAGNET',          desc: '+60% pickup-radius',
      effect: { type: 'magnet', value: 0.60 } },

    // === BLÅ (Rare) — gameplay-affecting ===
    { id: 'b_dmg',     rarity: 'blue',   icon: '💥', name: 'SKADA III',        desc: '+35% vapen-skada',
      effect: { type: 'dmg',    value: 0.35 } },
    { id: 'b_rate',    rarity: 'blue',   icon: '⚡', name: 'FIRE RATE III',    desc: '+35% eldhastighet',
      effect: { type: 'rate',   value: 0.35 } },
    { id: 'b_hp',      rarity: 'blue',   icon: '❤️', name: 'TJOCKARE III',     desc: '+100 maxHP + full heal',
      effect: { type: 'hp',     value: 100 } },
    { id: 'b_crit',    rarity: 'blue',   icon: '🎯', name: 'KRITISK',          desc: '+15% kritisk-chans (2× dmg)',
      effect: { type: 'crit',   value: 0.15 } },
    { id: 'b_lifesteal', rarity: 'blue', icon: '🩸', name: 'LIFESTEAL',        desc: '+3% av dmg → HP',
      effect: { type: 'lifesteal', value: 0.03 } },
    { id: 'b_regen',   rarity: 'blue',   icon: '💚', name: 'REGEN',            desc: '+2 HP/sek',
      effect: { type: 'regen',  value: 2 } },

    // === LILA (Epic) — game-changers ===
    { id: 'p_dmg',     rarity: 'purple', icon: '💥', name: 'OBLITERATE',       desc: '+60% vapen-skada',
      effect: { type: 'dmg',    value: 0.60 } },
    { id: 'p_pierce',  rarity: 'purple', icon: '🏹', name: 'PIERCE',           desc: 'Kulor träffar +1 fiende (stackbar)',
      effect: { type: 'pierce', value: 1 } },
    { id: 'p_ricochet', rarity: 'purple', icon: '↩️', name: 'RICOCHET',         desc: 'Kulor studsar 2 ggr (stackbar)',
      effect: { type: 'ricochet', value: 2 } },
    { id: 'p_multishot', rarity: 'purple', icon: '🎆', name: 'MULTISHOT',       desc: '+1 extra kula per skott',
      effect: { type: 'multishot', value: 1 } },
    { id: 'p_thorns',  rarity: 'purple', icon: '🌵', name: 'THORNS',            desc: '8 dmg/sek till fiender inom 100px',
      effect: { type: 'thorns', value: 8 } },
    { id: 'p_regen_x', rarity: 'purple', icon: '💚', name: 'REGEN II',          desc: '+5 HP/sek',
      effect: { type: 'regen',  value: 5 } },

    // === v1.530: 7 nya lila game-changers ===
    { id: 'p_speed_mega', rarity: 'purple', icon: '⚡', name: 'BLIXTSNABB',       desc: '+40% rörelse',
      effect: { type: 'speed',   value: 0.40 } },
    // (p_dash_1s flyttad till 4-tier dash-kedja nedan, v1.531)
    { id: 'p_revive',     rarity: 'purple', icon: '✨', name: 'ANDRA CHANS',      desc: 'Återupplivas 1× med 1 HP',
      effect: { type: 'revive',  value: 1 } },
    { id: 'p_lifesteal_x',rarity: 'purple', icon: '🩸', name: 'LIFESTEAL II',     desc: '+6% av dmg → HP',
      effect: { type: 'lifesteal', value: 0.06 } },
    { id: 'p_double',     rarity: 'purple', icon: '🔫', name: 'DUBBELSKOTT',      desc: '+1 kula per skott',
      effect: { type: 'multishot', value: 1 } },
    { id: 'p_triple',     rarity: 'purple', icon: '🎆', name: 'TRIPPELSKOTT',     desc: '+2 kulor per skott',
      effect: { type: 'multishot', value: 2 } },
    { id: 'p_grow',       rarity: 'purple', icon: '🦣', name: 'GROW',             desc: '+25% storlek + +25% maxHP',
      effect: { type: 'grow',    value: 0.25 } },

    // === DASH-KEDJA (4 raritys, skalande cooldown-reduktion) ===
    // Default dash-cooldown = 3000ms. Perk-värdet är RAW cooldown i ms efter perk.
    { id: 'g_dash',       rarity: 'gray',   icon: '💨', name: 'DASH I',           desc: 'Dash cooldown 2.5s (var 3s)',
      effect: { type: 'dashCd',  value: 2500 } },
    { id: 'gn_dash',      rarity: 'green',  icon: '💨', name: 'DASH II',          desc: 'Dash cooldown 2s',
      effect: { type: 'dashCd',  value: 2000 } },
    { id: 'b_dash',       rarity: 'blue',   icon: '💨', name: 'DASH III',         desc: 'Dash cooldown 1.5s',
      effect: { type: 'dashCd',  value: 1500 } },
    { id: 'p_dash',       rarity: 'purple', icon: '💨', name: 'DASH IV',          desc: 'Dash cooldown 1s',
      effect: { type: 'dashCd',  value: 1000 } },

    // === HOMING-KEDJA (4 raritys, skalande styrka) ===
    // Användarens spec: svag → lite bättre → lite bättre → lite bättre. Tier 4
    // ska INTE auto-träffa utan bara hjälpa "rejält". Värdet är homing-strength
    // 0.04-0.18 (bullet velocity-adjustment per frame mot närmaste fiende).
    { id: 'g_homing',     rarity: 'gray',   icon: '🎯', name: 'HOMING I',         desc: 'Kulor styr svagt mot fiender',
      effect: { type: 'homing',  value: 0.04 } },
    { id: 'gn_homing',    rarity: 'green',  icon: '🎯', name: 'HOMING II',        desc: 'Kulor styr lite bättre',
      effect: { type: 'homing',  value: 0.08 } },
    { id: 'b_homing',     rarity: 'blue',   icon: '🎯', name: 'HOMING III',       desc: 'Kulor styr starkare',
      effect: { type: 'homing',  value: 0.13 } },
    { id: 'p_homing',     rarity: 'purple', icon: '🎯', name: 'HOMING IV',        desc: 'Kulor styr rejält (men träffar inte 100%)',
      effect: { type: 'homing',  value: 0.18 } },

    // === v1.533: 6 SYNERGY-PERKS (build-defining) ===
    { id: 'p_exploding', rarity: 'purple', icon: '💣', name: 'EXPLODERANDE',     desc: 'Kulor exploderar vid hit (25 AoE-dmg, 60px radius)',
      effect: { type: 'exploding', value: 25 } },
    { id: 'b_frost',     rarity: 'blue',   icon: '❄️', name: 'FROST-SKOTT',       desc: 'Träffade fiender saktas 60% i 1 sek',
      effect: { type: 'frost',     value: 1.0 } },
    { id: 'p_fire',      rarity: 'purple', icon: '🔥', name: 'ELDSTRÖM',          desc: 'Träffade fiender brinner 3 dmg/s i 4 sek',
      effect: { type: 'fire',      value: 3 } },
    { id: 'p_chain',     rarity: 'purple', icon: '⚡', name: 'CHAIN LIGHTNING',   desc: 'Kulor studsar till närmaste fiende (50% dmg, 150px)',
      effect: { type: 'chain',     value: 1 } },
    { id: 'b_berserker', rarity: 'blue',   icon: '🩸', name: 'BERSERKER',         desc: 'Vid HP<50%: upp till +50% dmg (skalat med saknad HP)',
      effect: { type: 'berserker', value: 1 } },
    { id: 'p_executioner', rarity: 'purple', icon: '☠️', name: 'EXECUTIONER',     desc: 'Instakill fiender <10% HP (inte bossar)',
      effect: { type: 'executioner', value: 1 } },
  ],

  // === ENEMY-CAP / DIFFICULTY ===
  // Skalar med tid. Wave-spawn capad så server inte stallnar.
  difficultyScalePerMinute: 1.10,   // enemy HP/dmg × 1.10 per minute (kompoundas)

  // === DOWN-STATE (samma som CD) ===
  downBleedoutSec: 25,
  downReviveSec: 4,
  downCrawlSpeedMul: 0.5,
  downReviveRadius: 60,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SURVIVORS_ARENA };
}
if (typeof window !== 'undefined') {
  window.SURVIVORS_ARENA = SURVIVORS_ARENA;
}
