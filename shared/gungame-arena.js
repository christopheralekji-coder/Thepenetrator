// Shared GUNGAME arena. Mindre (3500×2000) close-quarters-arena designad
// för FFA snabba engagements. 8 spawn-points symmetriskt utspridda.
// Inga capture-zoner eller flaggor — bara kill-arena.
'use strict';

const GUNGAME_ARENA = {
  worldW: 3500,
  worldH: 2000,
  name: 'GUNGAME ARENA',

  // 8 spawn-punkter, symmetriskt utspridda. Server roterar mellan dem så
  // att respawn inte placerar dig framför en fiende.
  spawns: [
    { x: 300,  y: 300 },
    { x: 3200, y: 300 },
    { x: 300,  y: 1700 },
    { x: 3200, y: 1700 },
    { x: 1750, y: 200 },
    { x: 1750, y: 1800 },
    { x: 200,  y: 1000 },
    { x: 3300, y: 1000 },
  ],

  // Walls — cover och break-LoS. Inga byggnader, bara crates/sandbags/pillars.
  walls: [
    // === Center cluster (cross-shape, gives multi-angle cover) ===
    { x: 1700, y: 950, w: 100, h: 30, kind: 'sandbag' },
    { x: 1700, y: 1020, w: 100, h: 30, kind: 'sandbag' },
    { x: 1665, y: 920, w: 30, h: 160, kind: 'sandbag' },
    { x: 1805, y: 920, w: 30, h: 160, kind: 'sandbag' },
    { x: 1640, y: 880, w: 50, h: 50, kind: 'crate' },
    { x: 1810, y: 880, w: 50, h: 50, kind: 'crate' },
    { x: 1640, y: 1070, w: 50, h: 50, kind: 'crate' },
    { x: 1810, y: 1070, w: 50, h: 50, kind: 'crate' },

    // === Pillars i mid-zonen (break sight-lines mellan långa sides) ===
    { x: 1200, y: 700, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 1200, y: 1100, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 2260, y: 700, w: 40, h: 200, kind: 'wall_pillar' },
    { x: 2260, y: 1100, w: 40, h: 200, kind: 'wall_pillar' },

    // === Top corners cover (skydd för top-spawns) ===
    { x: 250, y: 450, w: 80, h: 30, kind: 'sandbag' },
    { x: 450, y: 250, w: 30, h: 80, kind: 'sandbag' },
    { x: 350, y: 380, w: 32, h: 32, kind: 'barrel' },

    { x: 3220, y: 450, w: 80, h: 30, kind: 'sandbag' },
    { x: 3020, y: 250, w: 30, h: 80, kind: 'sandbag' },
    { x: 3118, y: 380, w: 32, h: 32, kind: 'barrel' },

    // === Bottom corners cover ===
    { x: 250, y: 1520, w: 80, h: 30, kind: 'sandbag' },
    { x: 450, y: 1670, w: 30, h: 80, kind: 'sandbag' },
    { x: 350, y: 1608, w: 32, h: 32, kind: 'barrel' },

    { x: 3220, y: 1520, w: 80, h: 30, kind: 'sandbag' },
    { x: 3020, y: 1670, w: 30, h: 80, kind: 'sandbag' },
    { x: 3118, y: 1608, w: 32, h: 32, kind: 'barrel' },

    // === Side-lane cover (mellan top/bottom-spawns längs sides) ===
    { x: 600, y: 950, w: 80, h: 80, kind: 'crate' },
    { x: 2820, y: 950, w: 80, h: 80, kind: 'crate' },
    { x: 880, y: 750, w: 50, h: 50, kind: 'debris' },
    { x: 880, y: 1200, w: 50, h: 50, kind: 'debris' },
    { x: 2570, y: 750, w: 50, h: 50, kind: 'debris' },
    { x: 2570, y: 1200, w: 50, h: 50, kind: 'debris' },

    // === Top-bottom mid-lane cover ===
    { x: 1500, y: 400, w: 100, h: 25, kind: 'barricade' },
    { x: 1900, y: 400, w: 100, h: 25, kind: 'barricade' },
    { x: 1500, y: 1575, w: 100, h: 25, kind: 'barricade' },
    { x: 1900, y: 1575, w: 100, h: 25, kind: 'barricade' },

    // === Pipes (atmosfär + low cover) ===
    { x: 1000, y: 500, w: 180, h: 18, kind: 'pipe' },
    { x: 2320, y: 500, w: 180, h: 18, kind: 'pipe' },
    { x: 1000, y: 1482, w: 180, h: 18, kind: 'pipe' },
    { x: 2320, y: 1482, w: 180, h: 18, kind: 'pipe' },
  ],

  // Decorations
  decorations: [
    { kind: 'sign', x: 1650, y: 150, w: 200, h: 32, text: '⚔ GUNGAME ⚔', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'graffiti', x: 1750, y: 600, text: 'NO MERCY', color: '#ff5a3a', size: 22, rot: -0.08 },
    { kind: 'graffiti', x: 1750, y: 1400, text: '15 STEGEN', color: '#ffaa30', size: 20, rot: 0.05 },
    { kind: 'graffiti', x: 500, y: 1000, text: 'KILL', color: '#ff3030', size: 28, rot: -0.1 },
    { kind: 'graffiti', x: 3000, y: 1000, text: 'OR DIE', color: '#ff3030', size: 28, rot: 0.1 },
    // Lyktor i hörnen
    { kind: 'lantern', x: 200, y: 200, color: '#ff7a3a' },
    { kind: 'lantern', x: 3300, y: 200, color: '#ff7a3a' },
    { kind: 'lantern', x: 200, y: 1800, color: '#ff7a3a' },
    { kind: 'lantern', x: 3300, y: 1800, color: '#ff7a3a' },
  ],
};

// v1.522: 15-vapen-progression — användardesignad ordning. START med kastkniv.
// Sledge kvar som final-tier humiliation + speedMul 0.9 (movement -10%) som
// trade-off för 1-hit kill-melee. Kill med melee → ev. demotion av offret.
// Demotion-floor: när offret är på tier ≥ 9 (level 10+) kan de INTE demoteras
// under tier 9 — annars hopplöst grind efter att ha klivit sig upp i late-game.
// V2-arsenal (2026-06-17): 15 tiers, START PÅ PISTOL (ingen kniv), svag→stark,
// katana-finisher. Ordning per användarens val (sniper↔lmg bytta).
// AUDIT 2026-06-18 (C181/C182): demotions-ZONEN (tier 11+, index > golvet) får
// vid VARJE död -1 tier. De långsamma/orörliga vapnen (minigun moveSpeedMul 0.62
// + spin-up, samt AoE-lobben grenade/rocket) flyttades NER i den säkra zonen
// (tier ≤10, ingen demotion) så att de inte längre sitter i frustrations-loopen.
// Demotions-zonen + de sista 3 tiers är nu mobila & beslutsamma → matchen
// accelererar mot katana-finishern (inga AoE-lob-väggar precis före slutet).
const GUNGAME_WEAPONS = [
  'pistol',      // 1  — START, pålitlig prick
  'smg',         // 2  — mini uzi (eldstorm)
  'dualpistol',  // 3  — run-and-gun spray
  'flame',       // 4  — brännmark (situationell DoT)
  'autoshotgun', // 5  — full-auto hagel
  'shotgun',     // 6  — pump, stoppkraft
  'rifle',       // 7  — karbin (precision-burst)
  'minigun',     // 8  — tung kulspruta (orörlig: i SÄKRA zonen, ingen demotion)
  'grenade',     // 9  — granatgevär (AoE-lob: säker zon)
  'rocket',      // 10 — raketgevär (störst AoE, mag 1: säker zon, sista pre-golv)
  'sniper',      // 11 — AWP one-shot (mobil/beslutsam — demotions-zonen börjar här)
  'dualuzi',     // 12 — max närstrids-DPS (mobil)
  'ak',          // 13 — tunghand (mobil hög-DPS)
  'lmg',         // 14 — rörlig eldkraft
  'katana',      // 15 — FINAL melee-förnedring (klyver, mobil)
];

// Demotion-GOLV = stage 10 (1-indexed) = index 9. Man kan ALDRIG demoteras under
// stage 10. Demotions-ZONEN är stage 11+ (index > golvet): där nedrankas man 1 steg
// vid VARJE död (oavsett vapen). Stage 1-10 är säkra (ingen demotion).
const GUNGAME_DEMOTE_FLOOR = 9; // stage 10

// Vilka vapen räknas som "melee" (för wasMelee-display/haptik). Kniven borttagen.
const GUNGAME_MELEE_DEMOTERS = new Set(['fists', 'katana']);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS, GUNGAME_DEMOTE_FLOOR };
}
if (typeof window !== 'undefined') {
  window.GUNGAME_ARENA = GUNGAME_ARENA;
  window.GUNGAME_WEAPONS = GUNGAME_WEAPONS;
  window.GUNGAME_MELEE_DEMOTERS = GUNGAME_MELEE_DEMOTERS;
  window.GUNGAME_DEMOTE_FLOOR = GUNGAME_DEMOTE_FLOOR;
}
