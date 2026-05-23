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
  waveIntervalSec: 25,              // 25s mellan vågor (mer aggressivt än CD's 30s+pause)
  waveBaseCount: 6,                 // wave 0 (start): 6 enemies
  waveScalePerMinute: 3,            // +3 enemies per minut spelad
  enemyCapForWave: 80,              // max samtidiga enemies på fältet

  // === PLAYER START-STATE ===
  startHp: 100,
  maxHp: 100,
  startShield: 100,
  maxShield: 100,
  startWeapon: 'pistol',
  startGrenades: 2,
  grenadesPerMinute: 1,             // +1 granat var minute (för mid-game flexibilitet)

  // === PERK-SYSTEM (iteration 2 implementerar selection UI + applicering) ===
  // Var 60s erbjuds 3 random val. Stack-bara (samma perk kan tas flera ggr).
  perkSelectionIntervalSec: 60,
  perkChoicesPerSelection: 3,
  perks: [
    { id: 'fire_rate',    icon: '⚡', name: 'SNABBARE ELDDOP',  desc: '+15% fire rate (stackbar)' },
    { id: 'damage',       icon: '💥', name: 'MER SKADA',         desc: '+20% vapen-skada (stackbar)' },
    { id: 'max_hp',       icon: '❤️', name: 'TJOCKARE',           desc: '+25 maxHP + full heal (stackbar)' },
    { id: 'speed',        icon: '👟', name: 'SNABBARE',          desc: '+10% rörelsehastighet (stackbar)' },
    { id: 'magnet',       icon: '🧲', name: 'MAGNET',            desc: '+50% gold/ammo-pickup-radius (stackbar)' },
    { id: 'crit',         icon: '🎯', name: 'KRITISK',           desc: '+10% kritisk-chans (stackbar, max 60%)' },
    { id: 'pierce',       icon: '🏹', name: 'PIERCE',            desc: 'Alla kulor pierce första fienden (stackbar = +1 pierce)' },
    { id: 'lifesteal',    icon: '🩸', name: 'LIFESTEAL',         desc: '+2% av dmg → HP (stackbar)' },
    { id: 'regen',        icon: '💚', name: 'REGEN',             desc: '+1 HP/sek (stackbar)' },
    { id: 'ammo_cap',     icon: '🔫', name: 'STORT MAGASIN',     desc: '+30% mag-storlek (stackbar)' },
    { id: 'reload',       icon: '🔄', name: 'SNABB OMLADDNING',  desc: '-20% reload-tid (stackbar)' },
    { id: 'thorns',       icon: '🌵', name: 'THORNS',            desc: 'Fiender tar 5 dmg/sek om de är inom 100px (stackbar)' },
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
