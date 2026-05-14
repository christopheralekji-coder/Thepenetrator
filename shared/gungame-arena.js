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

// 15-vapen-progression. Stigande tier: melee → pistols → guns → power → final melee.
// START med knife (var fists — för svag att ta sig från noll med). Sledge kvar
// som final-tier humiliation. Kill med melee → ev. demotion av offret.
// Demotion-floor: när offret är på tier ≥ 9 (level 10+) kan de INTE demoteras
// under tier 9 — annars hopplöst grind efter att ha klivit sig upp i late-game.
const GUNGAME_WEAPONS = [
  'knife',       // 1  — start, snabb melee (var fists, för svag)
  'pistol',      // 2  — basic gun
  'shuriken',    // 3  — rapid throwing
  'shotgun',     // 4  — close-range power
  'revolver',    // 5  — heavy pistol
  'burstpistol', // 6  — 3-burst
  'smg',         // 7  — auto-fire
  'bow',         // 8  — precision
  'rifle',       // 9  — standard auto
  'sonic',       // 10 — knockback gun (level 10 = demotion-floor)
  'sniper',      // 11 — one-shot precision
  'plasma',      // 12 — high-dmg
  'minigun',     // 13 — heavy auto (NY — fyller upp till 15 efter fists-borttag)
  'rocket',      // 14 — explosive
  'sledge',      // 15 — FINAL melee humiliation (TUNG)
];

// Demotion-floor: vid death med melee, om offret är på tier >= GUNGAME_DEMOTE_FLOOR
// så är det också det LÄGSTA de kan demoteras till. Skyddar late-game-spelare.
const GUNGAME_DEMOTE_FLOOR = 9; // = level 10 (1-indexed)

// Vilka vapen räknas som "melee" för demotion-mekanik?
// Killer med dessa → offret förlorar 1 tier (kan inte gå under 0).
const GUNGAME_MELEE_DEMOTERS = new Set([
  'fists', 'knife', 'knuckles', 'bat', 'machete', 'sickle', 'spear',
  'axe', 'mace', 'whip', 'sledge', 'katana', 'energysword', 'lightsaber',
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS, GUNGAME_DEMOTE_FLOOR };
}
if (typeof window !== 'undefined') {
  window.GUNGAME_ARENA = GUNGAME_ARENA;
  window.GUNGAME_WEAPONS = GUNGAME_WEAPONS;
  window.GUNGAME_MELEE_DEMOTERS = GUNGAME_MELEE_DEMOTERS;
  window.GUNGAME_DEMOTE_FLOOR = GUNGAME_DEMOTE_FLOOR;
}
