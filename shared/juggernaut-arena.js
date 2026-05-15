// JUGGERNAUT — underjordisk parkering 5000×3500. 1 spelare per match är JUG
// (5× HP, +35% speed, 1s dash CD, välj AK/Shotgun/Sledge). Övriga är hunters
// med pistol. JUG som dör → killer blir ny JUG. Vinst = mest tid-som-JUG.
'use strict';

const JUGGERNAUT_ARENA = {
  worldW: 5000,
  worldH: 3500,
  name: 'UNDERGROUND PARKING',

  // 10 spawn-punkter, väl utspridda runt arenan så ingen sida domineras
  spawns: [
    { x: 400,  y: 400 },
    { x: 2500, y: 300 },
    { x: 4600, y: 400 },
    { x: 300,  y: 1750 },
    { x: 4700, y: 1750 },
    { x: 400,  y: 3100 },
    { x: 2500, y: 3200 },
    { x: 4600, y: 3100 },
    { x: 1500, y: 1750 },
    { x: 3500, y: 1750 },
  ],

  // Walls — perimeter + 6×4 pelar-grid + cover-block (lastbilar, vakthytter,
  // bilskelett, ramper). Pelar-grid ger LoS-bryt utan att blockera rörelse.
  // Lastbilar/vakthytter ger stora cover-pinnar för flanking.
  walls: [
    // === PERIMETER (8 segment, lämnar inga öppna sidor) ===
    { x: 0,    y: 0,    w: 5000, h: 20,   kind: 'concrete' },     // top
    { x: 0,    y: 3480, w: 5000, h: 20,   kind: 'concrete' },     // bottom
    { x: 0,    y: 0,    w: 20,   h: 3500, kind: 'concrete' },     // left
    { x: 4980, y: 0,    w: 20,   h: 3500, kind: 'concrete' },     // right

    // === PELAR-GRID (klassisk parkering: 7 kolumner × 4 rader) ===
    // Pelare är 50×50, spacing 700px horisontellt, 800px vertikalt.
    // Lämnar bred gångväg mellan dem för chase-action.
    // Row 1 (y=700)
    { x: 700,  y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1400, y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2100, y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2800, y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 3500, y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4200, y: 700, w: 50, h: 50, kind: 'wall_pillar' },
    // Row 2 (y=1500) — center-NW pillar är "broken" som landmark
    { x: 700,  y: 1500, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1400, y: 1500, w: 50, h: 50, kind: 'broken_pillar' },  // landmark — exponerad rebar
    { x: 2100, y: 1500, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2800, y: 1500, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 3500, y: 1500, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4200, y: 1500, w: 50, h: 50, kind: 'wall_pillar' },
    // Row 3 (y=2300) — center-SE är "tagged" med röd graffiti som landmark
    { x: 700,  y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1400, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2100, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2800, y: 2300, w: 50, h: 50, kind: 'tagged_pillar' },  // landmark — röd graffiti
    { x: 3500, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4200, y: 2300, w: 50, h: 50, kind: 'broken_pillar' },  // landmark — andra hörnet
    // Row 4 (y=3100)
    { x: 700,  y: 3100, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1400, y: 3100, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2100, y: 3100, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2800, y: 3100, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 3500, y: 3100, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4200, y: 3100, w: 50, h: 50, kind: 'wall_pillar' },

    // === LASTBILAR / SKÅPBILAR (3 st, stora cover-block, hörnpositioner) ===
    // Lastbil top-vänster (220×80, horisontell)
    { x: 350,  y: 1050, w: 220, h: 80, kind: 'truck' },
    // Lastbil bottom-höger (220×80, horisontell)
    { x: 4430, y: 2400, w: 220, h: 80, kind: 'truck' },
    // Skåpbil center-top (140×60)
    { x: 2430, y: 1100, w: 140, h: 60, kind: 'van' },

    // === VAKTHYTTER / SÄKERHETSKURER (2 st, små rum) ===
    // Vakthytt vid top-mid
    { x: 1700, y: 200, w: 100, h: 90, kind: 'guardhouse' },
    // Vakthytt vid bottom-mid
    { x: 3200, y: 3210, w: 100, h: 90, kind: 'guardhouse' },

    // === BILSKELETT (utbrunna bilar, 5 st utspridda) ===
    { x: 950,  y: 1100, w: 110, h: 55, kind: 'car_wreck' },
    { x: 3900, y: 1900, w: 110, h: 55, kind: 'car_wreck' },
    { x: 1900, y: 2700, w: 110, h: 55, kind: 'car_wreck' },
    { x: 3000, y: 400,  w: 110, h: 55, kind: 'car_wreck' },
    { x: 100,  y: 2500, w: 55,  h: 110, kind: 'car_wreck' },

    // === BIL-RAMPER (2 st, smala diagonala block — sluttning visuellt) ===
    // Ramp upp-höger (top-right)
    { x: 4500, y: 850, w: 200, h: 40, kind: 'ramp' },
    // Ramp ner-vänster (bottom-left)
    { x: 200,  y: 2900, w: 200, h: 40, kind: 'ramp' },

    // === OLJEFAT / BARRELS (cover + visuell variation, 6 st) ===
    { x: 1200, y: 1300, w: 32, h: 32, kind: 'oil_drum' },
    { x: 2400, y: 1800, w: 32, h: 32, kind: 'oil_drum' },
    { x: 3700, y: 2700, w: 32, h: 32, kind: 'oil_drum' },
    { x: 600,  y: 2200, w: 32, h: 32, kind: 'oil_drum' },
    { x: 4400, y: 1300, w: 32, h: 32, kind: 'oil_drum' },
    { x: 2600, y: 600,  w: 32, h: 32, kind: 'oil_drum' },

    // === AVSKÄRMNINGAR / OUT-OF-ORDER-TAPE-block (4 st) ===
    { x: 1000, y: 500,  w: 80, h: 20, kind: 'barricade' },
    { x: 3800, y: 500,  w: 80, h: 20, kind: 'barricade' },
    { x: 1000, y: 2950, w: 80, h: 20, kind: 'barricade' },
    { x: 3800, y: 2950, w: 80, h: 20, kind: 'barricade' },
  ],

  // Decorations — 11 olika typer + dekorationer som inte är walls.
  // Klienten ritar dessa men de blockerar inte rörelse/skott.
  decorations: [
    // === Sign vid entrén ===
    { kind: 'sign', x: 2400, y: 100, w: 240, h: 38, text: '🚗 P-GARAGE 🚗', bg: '#1a1a1a', fg: '#ffd54a' },

    // === Trasiga lysrör (flackande) — 12 st i grid ovanför pelar-rader ===
    { kind: 'flicker_light', x: 700,  y: 350, color: '#a8d0ff', flickerHz: 4 },
    { kind: 'flicker_light', x: 1400, y: 350, color: '#a8d0ff', flickerHz: 6 },
    { kind: 'flicker_light', x: 2100, y: 350, color: '#a8d0ff', flickerHz: 3 },
    { kind: 'flicker_light', x: 2800, y: 350, color: '#a8d0ff', flickerHz: 5 },
    { kind: 'flicker_light', x: 3500, y: 350, color: '#a8d0ff', flickerHz: 4 },
    { kind: 'flicker_light', x: 4200, y: 350, color: '#a8d0ff', flickerHz: 7 },
    { kind: 'flicker_light', x: 700,  y: 2700, color: '#a8d0ff', flickerHz: 3 },
    { kind: 'flicker_light', x: 1400, y: 2700, color: '#a8d0ff', flickerHz: 5 },
    { kind: 'flicker_light', x: 2100, y: 2700, color: '#a8d0ff', flickerHz: 4 },
    { kind: 'flicker_light', x: 2800, y: 2700, color: '#a8d0ff', flickerHz: 6 },
    { kind: 'flicker_light', x: 3500, y: 2700, color: '#a8d0ff', flickerHz: 4 },
    { kind: 'flicker_light', x: 4200, y: 2700, color: '#a8d0ff', flickerHz: 3 },

    // === Sprinkler-pölar (vatten på golvet, blanka mörka fläckar) ===
    { kind: 'puddle', x: 1700, y: 1200, r: 60 },
    { kind: 'puddle', x: 3300, y: 2000, r: 70 },
    { kind: 'puddle', x: 900,  y: 2400, r: 50 },
    { kind: 'puddle', x: 4100, y: 900,  r: 65 },
    { kind: 'puddle', x: 2400, y: 2500, r: 55 },

    // === Oljefatseld (brinnande oljefat — ljuspölar) — 4 st ===
    { kind: 'fire_drum', x: 900,  y: 1700, color: '#ff7a30' },
    { kind: 'fire_drum', x: 4100, y: 1700, color: '#ff7a30' },
    { kind: 'fire_drum', x: 2500, y: 900,  color: '#ff7a30' },
    { kind: 'fire_drum', x: 2500, y: 2600, color: '#ff7a30' },

    // === Avloppsbrunnar / golvgaller (visuella) — 8 st ===
    { kind: 'drain', x: 1200, y: 900 },
    { kind: 'drain', x: 3800, y: 900 },
    { kind: 'drain', x: 1200, y: 2600 },
    { kind: 'drain', x: 3800, y: 2600 },
    { kind: 'drain', x: 2500, y: 1750 },
    { kind: 'drain', x: 500,  y: 1750 },
    { kind: 'drain', x: 4500, y: 1750 },
    { kind: 'drain', x: 2500, y: 3000 },

    // === Graffiti (visuell texture) ===
    { kind: 'graffiti', x: 600,  y: 1500, text: 'RUN', color: '#ff3a3a', size: 36, rot: -0.1 },
    { kind: 'graffiti', x: 4400, y: 1500, text: 'OR DIE', color: '#ff3a3a', size: 32, rot: 0.08 },
    { kind: 'graffiti', x: 2500, y: 1750, text: '👑 JUG 👑', color: '#ffd54a', size: 38, rot: -0.05 },
    { kind: 'graffiti', x: 1500, y: 2900, text: 'HUNT', color: '#ff7030', size: 28, rot: 0.12 },
    { kind: 'graffiti', x: 3500, y: 600,  text: 'NO EXIT', color: '#aa3030', size: 26, rot: -0.06 },

    // === Tape-avskärmningar ("OUT OF ORDER") — visuella ovanpå barricades ===
    { kind: 'caution_tape', x: 1040, y: 470, w: 80, rot: 0 },
    { kind: 'caution_tape', x: 3840, y: 470, w: 80, rot: 0 },
    { kind: 'caution_tape', x: 1040, y: 2920, w: 80, rot: 0 },
    { kind: 'caution_tape', x: 3840, y: 2920, w: 80, rot: 0 },

    // === Parkeringslinjer (visuella vita streck markering parkering-rutor) ===
    // Två rader av 6 P-rutor ovanpå/under varje pelar-rad
    { kind: 'parking_lines', x: 1050, y: 700, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 2750, y: 700, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 1050, y: 1500, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 2750, y: 1500, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 1050, y: 2300, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 2750, y: 2300, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 1050, y: 3100, count: 5, dir: 'h' },
    { kind: 'parking_lines', x: 2750, y: 3100, count: 5, dir: 'h' },

    // === Övergivna shopping-carts (3 st) ===
    { kind: 'shopping_cart', x: 1800, y: 600 },
    { kind: 'shopping_cart', x: 3200, y: 2900 },
    { kind: 'shopping_cart', x: 600,  y: 2900 },

    // === Övergivna väskor / kassar (4 st) ===
    { kind: 'abandoned_bag', x: 2200, y: 2100 },
    { kind: 'abandoned_bag', x: 3700, y: 1200 },
    { kind: 'abandoned_bag', x: 1300, y: 2200 },
    { kind: 'abandoned_bag', x: 4300, y: 2800 },

    // === Varningstrianglar (3 st, runt bilskelett) ===
    { kind: 'warning_triangle', x: 1080, y: 1180 },
    { kind: 'warning_triangle', x: 4030, y: 1980 },
    { kind: 'warning_triangle', x: 2030, y: 2780 },
  ],

  // JUG-specifika vapenval. Klient visar dessa i weapon-switch-UI när
  // spelaren är JUG; server validerar att val är inom denna lista.
  jugWeapons: ['rifle', 'shotgun', 'sledge'],
  jugDefaultWeapon: 'rifle',  // 'automatkarbinen' = rifle i weapons-data

  // Match-konfig
  matchDurations: [120, 360, 900], // sekunder att välja mellan
  defaultMatchDuration: 360,
  jugBaseHp: 400,
  jugHpPerHunter: 100,
  jugSpeedMul: 1.35,
  jugScale: 1.8,
  jugDashCdMs: 1500,              // 1.5s (var 1s — gav oändlig kiting). Hunter ~3s.
  hunterDmgVsJugMul: 1.0,         // ingen damage-bonus (5× HP + skalning hanterar balansen)
  hunterWeapon: 'pistol',
  minimapPulseIntervalMs: 5000,   // hunters ser JUG på minimap var 5s

  // JUG-vapen-balans: rifle var dominant (137 DPS @ 820px räckvidd) på pelar-banan,
  // sledge nästan obrukbar (kräver 52px kontakt). Multipliers premierar melee-risk.
  // Applied via getPvpDmg när shooter är JUG.
  jugWeaponDmgMul: {
    rifle:   0.75,  // -25% — kraftigt men inte gimped
    shotgun: 1.0,   // baseline
    sledge:  1.15,  // +15% — premierar high-risk melee
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JUGGERNAUT_ARENA };
}
if (typeof window !== 'undefined') {
  window.JUGGERNAUT_ARENA = JUGGERNAUT_ARENA;
}
