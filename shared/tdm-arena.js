// Shared TDM-arena: walls + spawns. Speglar pattern från ctf-arena.js så
// både server och klient laddar samma layout.
// Arena 4000×3000, symmetrisk runt x=2000. Lägg till cover så sniper-camp inte
// dominerar — tidigare var TDM helt öppet och sniper one-shot:ade från edge-to-edge.
'use strict';

const TDM_ARENA = {
  worldW: 4000,
  worldH: 3000,
  name: 'ARENA',

  // Spawn-positions (mid-vänster / mid-höger)
  spawns: {
    red:  { x: 400,  y: 1500 },
    blue: { x: 3600, y: 1500 },
  },

  // Cover-walls: 4 mid-zon cover-block + 4 flank-block + center-pillar.
  // Bryter sikten över arenan tillräckligt att sniper inte dominerar utan
  // att blockera flow till motståndarsidan.
  walls: [
    // Center pillar (vertikalt — bryter direkt edge-to-edge-sikt)
    { x: 1980, y: 1200, w: 40, h: 600, kind: 'wall_pillar' },
    // Mid-zon flank-crates (4 st runt mitten)
    { x: 1700, y: 1380, w: 80, h: 80, kind: 'crate' },
    { x: 2220, y: 1380, w: 80, h: 80, kind: 'crate' },
    { x: 1700, y: 1540, w: 80, h: 80, kind: 'crate' },
    { x: 2220, y: 1540, w: 80, h: 80, kind: 'crate' },
    // Top-lane cover (mirrored)
    { x: 1100, y: 700, w: 100, h: 80, kind: 'crate' },
    { x: 2800, y: 700, w: 100, h: 80, kind: 'crate' },
    { x: 1900, y: 500, w: 200, h: 30, kind: 'wall_divider' },
    // Bot-lane cover (mirrored)
    { x: 1100, y: 2220, w: 100, h: 80, kind: 'crate' },
    { x: 2800, y: 2220, w: 100, h: 80, kind: 'crate' },
    { x: 1900, y: 2470, w: 200, h: 30, kind: 'wall_divider' },
    // Sid-cover nära spawn (defenders har naturligt LoS-break)
    { x: 700, y: 1400, w: 60, h: 60, kind: 'crate' },
    { x: 700, y: 1540, w: 60, h: 60, kind: 'crate' },
    { x: 3240, y: 1400, w: 60, h: 60, kind: 'crate' },
    { x: 3240, y: 1540, w: 60, h: 60, kind: 'crate' },
  ],
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TDM_ARENA };
}
if (typeof window !== 'undefined') {
  window.TDM_ARENA = TDM_ARENA;
}
