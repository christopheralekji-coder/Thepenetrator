// BATTLE ROYALE — "LAST HUNT" v3 — 10000×10000 STORKARTA
//
// Sex distinkta zoner i CENTER (2000-8000), wild outer-skog runt om.
//   NW FOREST (2000-5000, 2000-5000):       Tät skog, stigar, djup-skogs stuga
//   NE SCRAP (5000-8000, 2000-4000):        Dumpade containrar, brinnande grävmaskin
//   CENTRAL VILLAGE (4000-6500, 4000-6500): Bonde-by med 3 stugor + brunn
//   EAST CAMPING (6500-8000, 4000-6500):    Tält, lägereldar, admin-stuga
//   WEST LAKE (2000-4500, 5000-7500):       Sjö, bro, sommarstuga, båt
//   SOUTH WILD (4500-8000, 6500-8000):      Vild skog, hunter-stuga
//   OUTER WILDERNESS (0-2000 + 8000-10000): Tät vild skog överallt
'use strict';

const BATTLEROYALE_ARENA = {
  worldW: 10000,
  worldH: 10000,
  name: 'LAST HUNT',
  groundColor: '#2a3a1a',

  // Spawn-punkter (16) — spridda kring outer-ring + zon-edges
  spawns: [
    // Outer NW
    { x: 500,  y: 500  },
    { x: 1500, y: 800  },
    { x: 800,  y: 1500 },
    // Outer N
    { x: 3000, y: 400  },
    { x: 5000, y: 300  },
    { x: 7000, y: 400  },
    // Outer NE
    { x: 9200, y: 600  },
    { x: 9400, y: 2200 },
    // Outer E
    { x: 9400, y: 5000 },
    { x: 9200, y: 7500 },
    // Outer SE
    { x: 8500, y: 9300 },
    { x: 6500, y: 9400 },
    // Outer S
    { x: 4000, y: 9400 },
    { x: 2000, y: 9300 },
    // Outer SW + W
    { x: 500,  y: 8500 },
    { x: 300,  y: 5000 },
    // V2: +20 spawns så 24-bot-lobbies får UNIKA spridda spawns (var 16 → klustrade)
    { x: 2300, y: 1700 }, { x: 6000, y: 1500 }, { x: 8200, y: 1700 },
    { x: 1700, y: 3300 }, { x: 8400, y: 3400 }, { x: 4500, y: 2200 },
    { x: 1500, y: 6700 }, { x: 8600, y: 6300 }, { x: 3000, y: 8200 },
    { x: 7200, y: 8300 }, { x: 5000, y: 8600 }, { x: 9100, y: 4000 },
    { x: 1100, y: 2300 }, { x: 2600, y: 5000 }, { x: 7400, y: 5000 },
    { x: 4200, y: 4000 }, { x: 5800, y: 3200 }, { x: 3600, y: 6800 },
    { x: 6400, y: 6600 }, { x: 1900, y: 4200 },
  ],

  // === CABINS ===
  // Alla offset +2000,+2000 från original. Spelaren räknas som "inne" om inom bounds.
  cabins: [
    {
      id: 'cabin_deep_forest',
      name: 'JÄGAR-STUGAN',
      bounds: { x: 3450, y: 2750, w: 220, h: 180 },
      door: { side: 'south', offset: 90, width: 50 },
      windows: [
        { side: 'north', offset: 60, width: 40 },
        { side: 'north', offset: 140, width: 40 },
        { side: 'east', offset: 60, width: 40 },
      ],
      roof: { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' },
      floor: '#5a3a1a',
      interior: [
        { kind: 'bed',          x: 3490, y: 2800, w: 50, h: 70 },
        { kind: 'fireplace',    x: 3610, y: 2800, w: 40, h: 40 },
        { kind: 'table_round',  x: 3560, y: 2870, r: 18 },
        { kind: 'chair',        x: 3540, y: 2850 },
        { kind: 'chair',        x: 3580, y: 2890 },
        { kind: 'rug',          x: 3530, y: 2850, w: 80, h: 50 },
        { kind: 'oil_lamp',     x: 3520, y: 2800 },
        { kind: 'bookshelf',    x: 3480, y: 2870, w: 30, h: 40 },
        { kind: 'animal_skull', x: 3620, y: 2870 },
      ],
    },
    {
      id: 'cabin_village_red',
      name: 'RÖDA STUGAN',
      bounds: { x: 4750, y: 4650, w: 240, h: 200 },
      door: { side: 'east', offset: 80, width: 50 },
      windows: [
        { side: 'north', offset: 50, width: 40 },
        { side: 'north', offset: 150, width: 40 },
        { side: 'south', offset: 50, width: 40 },
        { side: 'south', offset: 150, width: 40 },
        { side: 'west', offset: 80, width: 40 },
      ],
      roof: { color: '#8a3030', accent: '#5a1818', style: 'tile' },
      floor: '#6a4828',
      interior: [
        { kind: 'bed',         x: 4780, y: 4700, w: 60, h: 80 },
        { kind: 'dresser',     x: 4780, y: 4790 },
        { kind: 'table_long',  x: 4870, y: 4730, w: 60, h: 30 },
        { kind: 'chair',       x: 4880, y: 4715 },
        { kind: 'chair',       x: 4920, y: 4715 },
        { kind: 'fireplace',   x: 4940, y: 4790, w: 40, h: 40 },
        { kind: 'rug',         x: 4820, y: 4780, w: 80, h: 50 },
        { kind: 'oil_lamp',    x: 4880, y: 4760 },
        { kind: 'kitchen_counter', x: 4870, y: 4660, w: 90, h: 25 },
        { kind: 'wall_painting', x: 4790, y: 4660 },
      ],
    },
    {
      id: 'cabin_village_yellow',
      name: 'GULA STUGAN',
      bounds: { x: 5700, y: 4700, w: 260, h: 220 },
      door: { side: 'west', offset: 110, width: 50 },
      windows: [
        { side: 'north', offset: 60, width: 40 },
        { side: 'north', offset: 160, width: 40 },
        { side: 'south', offset: 60, width: 40 },
        { side: 'south', offset: 160, width: 40 },
        { side: 'east', offset: 70, width: 40 },
        { side: 'east', offset: 140, width: 40 },
      ],
      roof: { color: '#a08020', accent: '#5a4810', style: 'thatch' },
      floor: '#7a5828',
      interior: [
        { kind: 'bed',         x: 5720, y: 4750, w: 60, h: 80 },
        { kind: 'bed',         x: 5720, y: 4840, w: 60, h: 60 },
        { kind: 'table_long',  x: 5820, y: 4780, w: 70, h: 35 },
        { kind: 'chair',       x: 5830, y: 4765 },
        { kind: 'chair',       x: 5870, y: 4765 },
        { kind: 'chair',       x: 5910, y: 4765 },
        { kind: 'fireplace',   x: 5900, y: 4880, w: 40, h: 40 },
        { kind: 'kitchen_counter', x: 5820, y: 4710, w: 120, h: 25 },
        { kind: 'rug',         x: 5800, y: 4830, w: 90, h: 60 },
        { kind: 'bookshelf',   x: 5700, y: 4890, w: 30, h: 30 },
        { kind: 'wall_painting', x: 5720, y: 4710 },
        { kind: 'oil_lamp',    x: 5870, y: 4810 },
      ],
    },
    {
      id: 'cabin_village_barn',
      name: 'LADAN',
      bounds: { x: 5200, y: 5700, w: 280, h: 220 },
      door: { side: 'north', offset: 120, width: 60 },
      windows: [
        { side: 'east', offset: 60, width: 40 },
        { side: 'east', offset: 140, width: 40 },
        { side: 'west', offset: 60, width: 40 },
        { side: 'west', offset: 140, width: 40 },
        { side: 'south', offset: 110, width: 60 }, // stort vindsfönster
      ],
      roof: { color: '#5a3818', accent: '#2a1808', style: 'wood_shingle' },
      floor: '#3a2810',
      interior: [
        { kind: 'haystack_inside', x: 5220, y: 5750, w: 80, h: 60 },
        { kind: 'haystack_inside', x: 5380, y: 5850, w: 80, h: 50 },
        { kind: 'woodpile_inside', x: 5220, y: 5830, w: 70, h: 30 },
        { kind: 'pitchfork',       x: 5320, y: 5760 },
        { kind: 'shovel',          x: 5340, y: 5770 },
        { kind: 'workbench',       x: 5400, y: 5760, w: 60, h: 30 },
        { kind: 'rope_coil',       x: 5300, y: 5820 },
        { kind: 'animal_skull',    x: 5460, y: 5870 },
      ],
    },
    {
      id: 'cabin_camp_admin',
      name: 'CAMPING-EXPEDITION',
      bounds: { x: 6800, y: 5650, w: 240, h: 200 },
      door: { side: 'south', offset: 100, width: 50 },
      windows: [
        { side: 'north', offset: 50, width: 40 },
        { side: 'north', offset: 150, width: 40 },
        { side: 'east', offset: 70, width: 40 },
        { side: 'west', offset: 70, width: 40 },
      ],
      roof: { color: '#306080', accent: '#102540', style: 'tile' },
      floor: '#4a4030',
      interior: [
        { kind: 'desk',           x: 6830, y: 5700, w: 70, h: 35 },
        { kind: 'chair',          x: 6870, y: 5745 },
        { kind: 'fireplace',      x: 6970, y: 5700, w: 40, h: 40 },
        { kind: 'bed',            x: 6830, y: 5760, w: 50, h: 70 },
        { kind: 'bookshelf',      x: 6920, y: 5760, w: 30, h: 40 },
        { kind: 'oil_lamp',       x: 6900, y: 5690 },
        { kind: 'wall_painting',  x: 6980, y: 5680 },
        { kind: 'map_on_wall',    x: 6840, y: 5680 },
        { kind: 'rug',            x: 6850, y: 5780, w: 70, h: 40 },
      ],
    },
    {
      id: 'cabin_lake_summer',
      name: 'SOMMARSTUGAN',
      bounds: { x: 3100, y: 5650, w: 260, h: 200 },
      door: { side: 'east', offset: 100, width: 55 },
      windows: [
        { side: 'north', offset: 60, width: 40 },
        { side: 'north', offset: 160, width: 40 },
        { side: 'south', offset: 60, width: 40 },
        { side: 'south', offset: 160, width: 40 },
        { side: 'west', offset: 80, width: 50 }, // panorama mot sjön
      ],
      roof: { color: '#d4d4c0', accent: '#7a7a6a', style: 'tile' },
      floor: '#a08060',
      interior: [
        { kind: 'bed',           x: 3120, y: 5700, w: 60, h: 80 },
        { kind: 'bed',           x: 3120, y: 5790, w: 60, h: 60 },
        { kind: 'table_round',   x: 3230, y: 5740, r: 22 },
        { kind: 'chair',         x: 3210, y: 5720 },
        { kind: 'chair',         x: 3260, y: 5720 },
        { kind: 'chair',         x: 3230, y: 5770 },
        { kind: 'fireplace',     x: 3310, y: 5700, w: 40, h: 40 },
        { kind: 'kitchen_counter', x: 3220, y: 5810, w: 130, h: 25 },
        { kind: 'rug',           x: 3180, y: 5760, w: 100, h: 60 },
        { kind: 'oil_lamp',      x: 3230, y: 5700 },
        { kind: 'wall_painting', x: 3140, y: 5680 },
        { kind: 'wall_painting', x: 3320, y: 5680 },
        { kind: 'bathtub',       x: 3310, y: 5760, w: 40, h: 60 },
      ],
    },
    {
      id: 'cabin_south_hunter',
      name: 'HUNTER-LYAN',
      bounds: { x: 6150, y: 7250, w: 200, h: 180 },
      door: { side: 'north', offset: 80, width: 45 },
      windows: [
        { side: 'south', offset: 50, width: 35 },
        { side: 'south', offset: 120, width: 35 },
        { side: 'east', offset: 70, width: 35 },
      ],
      roof: { color: '#3a2818', accent: '#1a0e08', style: 'wood_shingle' },
      floor: '#4a3018',
      interior: [
        { kind: 'bed',          x: 6170, y: 7300, w: 50, h: 65 },
        { kind: 'fireplace',    x: 6280, y: 7300, w: 40, h: 40 },
        { kind: 'workbench',    x: 6170, y: 7380, w: 60, h: 30 },
        { kind: 'chair',        x: 6250, y: 7360 },
        { kind: 'animal_skull', x: 6290, y: 7360 },
        { kind: 'animal_skull', x: 6310, y: 7370 },
        { kind: 'rope_coil',    x: 6210, y: 7375 },
        { kind: 'oil_lamp',     x: 6280, y: 7285 },
        { kind: 'rifle_rack',   x: 6170, y: 7290 },
      ],
    },
    // ========================================================================
    // === 13 NYA STUGOR (v1.333) — spridda ORGANISKT över hela kartan ===
    // Auto-genererade walls via preprocessCabinWalls.
    // Varierande layout/färg/sida för dörren.
    // ========================================================================
    // 8. SW Lake-cabin (annan plats än sommarstugan)
    { id: 'cabin_lake_west', name: 'FISKE-STUGAN', bounds: { x: 800, y: 3200, w: 200, h: 170 },
      door: { side: 'east', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#4060a0', accent: '#102540', style: 'tile' }, floor: '#7a5a30',
      interior: [
        { kind: 'bed', x: 820, y: 3240, w: 50, h: 65 }, { kind: 'fireplace', x: 920, y: 3240, w: 40, h: 40 },
        { kind: 'table_round', x: 880, y: 3320, r: 18 }, { kind: 'chair', x: 860, y: 3310 },
        { kind: 'oil_lamp', x: 870, y: 3245 }, { kind: 'rope_coil', x: 940, y: 3320 },
      ] },
    // 9. NW outer-stuga (gömd i skog)
    { id: 'cabin_nw_outer', name: 'GAMLA STUGAN', bounds: { x: 600, y: 1700, w: 210, h: 180 },
      door: { side: 'south', offset: 90, width: 45 },
      windows: [ { side: 'north', offset: 70, width: 40 }, { side: 'east', offset: 60, width: 40 }, { side: 'west', offset: 60, width: 40 } ],
      roof: { color: '#5a3018', accent: '#2a1808', style: 'wood_shingle' }, floor: '#5a3818',
      interior: [
        { kind: 'bed', x: 620, y: 1740, w: 50, h: 70 }, { kind: 'fireplace', x: 740, y: 1740, w: 40, h: 40 },
        { kind: 'table_long', x: 660, y: 1800, w: 60, h: 30 }, { kind: 'chair', x: 670, y: 1790 },
        { kind: 'animal_skull', x: 760, y: 1810 }, { kind: 'oil_lamp', x: 700, y: 1730 },
      ] },
    // 10. North-mid stuga (mellan NW och NE)
    { id: 'cabin_north_mid', name: 'BERG-STUGAN', bounds: { x: 4500, y: 800, w: 200, h: 170 },
      door: { side: 'south', offset: 75, width: 50 },
      windows: [ { side: 'north', offset: 50, width: 40 }, { side: 'north', offset: 110, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#6a6a70', accent: '#3a3a40', style: 'tile' }, floor: '#7a5a30',
      interior: [
        { kind: 'bed', x: 4520, y: 840, w: 50, h: 65 }, { kind: 'dresser', x: 4520, y: 920 },
        { kind: 'fireplace', x: 4620, y: 840, w: 40, h: 40 }, { kind: 'table_round', x: 4580, y: 920, r: 18 },
        { kind: 'chair', x: 4560, y: 905 }, { kind: 'oil_lamp', x: 4600, y: 825 },
        { kind: 'bookshelf', x: 4500, y: 945, w: 30, h: 25 },
      ] },
    // 11. NE outer-cabin
    { id: 'cabin_ne_outer', name: 'BRUKS-STUGAN', bounds: { x: 8400, y: 2500, w: 210, h: 180 },
      door: { side: 'west', offset: 80, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#7a3030', accent: '#3a1010', style: 'tile' }, floor: '#6a4828',
      interior: [
        { kind: 'bed', x: 8430, y: 2540, w: 50, h: 65 }, { kind: 'fireplace', x: 8540, y: 2540, w: 40, h: 40 },
        { kind: 'workbench', x: 8430, y: 2620, w: 60, h: 30 }, { kind: 'rope_coil', x: 8500, y: 2620 },
        { kind: 'oil_lamp', x: 8520, y: 2530 }, { kind: 'wall_painting', x: 8440, y: 2510 },
      ] },
    // 12. NE deep
    { id: 'cabin_ne_deep', name: 'GRÄNS-STUGAN', bounds: { x: 9000, y: 800, w: 190, h: 170 },
      door: { side: 'south', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 50, width: 40 }, { side: 'east', offset: 60, width: 40 }, { side: 'west', offset: 60, width: 40 } ],
      roof: { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' }, floor: '#5a3a1a',
      interior: [
        { kind: 'bed', x: 9020, y: 840, w: 50, h: 65 }, { kind: 'fireplace', x: 9120, y: 840, w: 40, h: 40 },
        { kind: 'table_long', x: 9050, y: 900, w: 60, h: 30 }, { kind: 'animal_skull', x: 9120, y: 910 },
        { kind: 'rifle_rack', x: 9020, y: 830 }, { kind: 'oil_lamp', x: 9080, y: 825 },
      ] },
    // 13. East-mid (mellan scrap och camping)
    { id: 'cabin_east_mid', name: 'KÖPMANNEN', bounds: { x: 7800, y: 3300, w: 230, h: 190 },
      door: { side: 'west', offset: 90, width: 50 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'north', offset: 140, width: 40 }, { side: 'south', offset: 80, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#a08020', accent: '#5a4810', style: 'thatch' }, floor: '#7a5828',
      interior: [
        { kind: 'desk', x: 7830, y: 3340, w: 70, h: 35 }, { kind: 'chair', x: 7870, y: 3385 },
        { kind: 'kitchen_counter', x: 7820, y: 3460, w: 120, h: 25 }, { kind: 'bookshelf', x: 7820, y: 3400, w: 30, h: 40 },
        { kind: 'wall_painting', x: 7860, y: 3320 }, { kind: 'fireplace', x: 7960, y: 3340, w: 40, h: 40 },
        { kind: 'oil_lamp', x: 7900, y: 3360 },
      ] },
    // 14. SW outer (vid stranden)
    { id: 'cabin_sw_strand', name: 'STRAND-STUGAN', bounds: { x: 700, y: 7700, w: 200, h: 170 },
      door: { side: 'east', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#d4d4c0', accent: '#7a7a6a', style: 'tile' }, floor: '#a08060',
      interior: [
        { kind: 'bed', x: 720, y: 7740, w: 50, h: 65 }, { kind: 'fireplace', x: 820, y: 7740, w: 40, h: 40 },
        { kind: 'table_round', x: 780, y: 7820, r: 18 }, { kind: 'chair', x: 760, y: 7805 },
        { kind: 'oil_lamp', x: 770, y: 7730 }, { kind: 'bathtub', x: 840, y: 7790, w: 35, h: 50 },
      ] },
    // 15. South outer (vild)
    { id: 'cabin_south_outer', name: 'SKOGS-VAKTAREN', bounds: { x: 3000, y: 8300, w: 200, h: 170 },
      door: { side: 'north', offset: 75, width: 45 },
      windows: [ { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#3a2818', accent: '#1a0e08', style: 'wood_shingle' }, floor: '#4a3018',
      interior: [
        { kind: 'bed', x: 3020, y: 8340, w: 50, h: 65 }, { kind: 'fireplace', x: 3120, y: 8340, w: 40, h: 40 },
        { kind: 'workbench', x: 3020, y: 8420, w: 60, h: 30 }, { kind: 'rifle_rack', x: 3020, y: 8330 },
        { kind: 'animal_skull', x: 3140, y: 8410 }, { kind: 'oil_lamp', x: 3080, y: 8330 },
      ] },
    // 16. SE outer — BORTTAGEN v1.374 (för nära alien-zonen)
    // 17. South deep (mellan wild och perimeter)
    { id: 'cabin_south_deep', name: 'JÄGAR-LADAN', bounds: { x: 5500, y: 8400, w: 230, h: 190 },
      door: { side: 'north', offset: 95, width: 55 },
      windows: [ { side: 'south', offset: 80, width: 50 }, { side: 'east', offset: 80, width: 40 }, { side: 'west', offset: 80, width: 40 } ],
      roof: { color: '#5a3818', accent: '#2a1808', style: 'wood_shingle' }, floor: '#3a2810',
      interior: [
        { kind: 'haystack_inside', x: 5520, y: 8440, w: 70, h: 50 }, { kind: 'woodpile_inside', x: 5520, y: 8500, w: 60, h: 30 },
        { kind: 'workbench', x: 5630, y: 8440, w: 60, h: 30 }, { kind: 'pitchfork', x: 5680, y: 8470 },
        { kind: 'rope_coil', x: 5600, y: 8550 }, { kind: 'animal_skull', x: 5680, y: 8550 },
      ] },
    // 18. East-edge cabin (på vägen mot scrap)
    { id: 'cabin_east_edge', name: 'STÅL-STUGAN', bounds: { x: 7200, y: 4000, w: 200, h: 170 },
      door: { side: 'south', offset: 75, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'north', offset: 130, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#5a5a60', accent: '#2a2a30', style: 'tile' }, floor: '#5a4030',
      interior: [
        { kind: 'bed', x: 7220, y: 4040, w: 50, h: 65 }, { kind: 'workbench', x: 7220, y: 4120, w: 60, h: 30 },
        { kind: 'fireplace', x: 7330, y: 4040, w: 40, h: 40 }, { kind: 'rope_coil', x: 7300, y: 4130 },
        { kind: 'oil_lamp', x: 7300, y: 4030 }, { kind: 'map_on_wall', x: 7230, y: 4020 },
      ] },
    // 19. SW small (mellan lake och south)
    { id: 'cabin_sw_small', name: 'LILLA STUGAN', bounds: { x: 2200, y: 8000, w: 180, h: 160 },
      door: { side: 'east', offset: 60, width: 40 },
      windows: [ { side: 'north', offset: 50, width: 35 }, { side: 'south', offset: 60, width: 35 }, { side: 'west', offset: 60, width: 35 } ],
      roof: { color: '#7a3030', accent: '#3a1010', style: 'tile' }, floor: '#6a4828',
      interior: [
        { kind: 'bed', x: 2220, y: 8030, w: 45, h: 60 }, { kind: 'fireplace', x: 2310, y: 8030, w: 40, h: 40 },
        { kind: 'chair', x: 2280, y: 8090 }, { kind: 'oil_lamp', x: 2270, y: 8020 },
      ] },
    // 20. North-deep (mellan NW skog och scrap)
    { id: 'cabin_north_deep', name: 'GRANSKOGS-STUGAN', bounds: { x: 2700, y: 1500, w: 200, h: 170 },
      door: { side: 'east', offset: 75, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' }, floor: '#5a3a1a',
      interior: [
        { kind: 'bed', x: 2720, y: 1540, w: 50, h: 65 }, { kind: 'fireplace', x: 2820, y: 1540, w: 40, h: 40 },
        { kind: 'table_round', x: 2780, y: 1620, r: 18 }, { kind: 'chair', x: 2760, y: 1605 },
        { kind: 'bookshelf', x: 2700, y: 1640, w: 30, h: 25 }, { kind: 'oil_lamp', x: 2770, y: 1530 },
      ] },
    // ========================================================================
    // === 20 NYA STUGOR (v1.369) — fokus: NW/NE/SW edges + utfyllnad ===
    // INTE i SE-hörnet (alien-mark). Sprida med varierande stilar/färger.
    // ========================================================================
    // --- LEFT EDGE TOP (x: 0-1500, y: 0-3000) ---
    // 21. NW-corner (mellan corner-trees)
    { id: 'cabin_nw_corner', name: 'HÖRN-STUGAN', bounds: { x: 1100, y: 1000, w: 200, h: 170 },
      door: { side: 'south', offset: 80, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'east', offset: 60, width: 40 }, { side: 'west', offset: 60, width: 40 } ],
      roof: { color: '#5a3018', accent: '#2a1808', style: 'wood_shingle' }, floor: '#5a3818',
      interior: [
        { kind: 'bed', x: 1120, y: 1040, w: 50, h: 65 }, { kind: 'fireplace', x: 1220, y: 1040, w: 40, h: 40 },
        { kind: 'table_long', x: 1160, y: 1110, w: 60, h: 30 }, { kind: 'chair', x: 1170, y: 1095 },
        { kind: 'oil_lamp', x: 1200, y: 1030 }, { kind: 'animal_skull', x: 1260, y: 1110 },
      ] },
    // 22. W-edge upper (mellan NW-outer och lake-west)
    { id: 'cabin_w_edge_upper', name: 'TYST-STUGAN', bounds: { x: 250, y: 2400, w: 190, h: 160 },
      door: { side: 'east', offset: 60, width: 40 },
      windows: [ { side: 'north', offset: 50, width: 35 }, { side: 'south', offset: 50, width: 35 }, { side: 'west', offset: 50, width: 35 } ],
      roof: { color: '#3a5a3a', accent: '#1a2a1a', style: 'wood_shingle' }, floor: '#5a3a1a',
      interior: [
        { kind: 'bed', x: 270, y: 2430, w: 45, h: 60 }, { kind: 'fireplace', x: 360, y: 2430, w: 40, h: 40 },
        { kind: 'chair', x: 330, y: 2490 }, { kind: 'oil_lamp', x: 320, y: 2420 },
      ] },
    // 23. NW north (mellan trees)
    { id: 'cabin_nw_north', name: 'SNÖ-STUGAN', bounds: { x: 1700, y: 500, w: 200, h: 170 },
      door: { side: 'south', offset: 80, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'east', offset: 60, width: 40 } ],
      roof: { color: '#d4d4c0', accent: '#7a7a6a', style: 'tile' }, floor: '#a08060',
      interior: [
        { kind: 'bed', x: 1720, y: 540, w: 50, h: 65 }, { kind: 'fireplace', x: 1820, y: 540, w: 40, h: 40 },
        { kind: 'dresser', x: 1720, y: 620 }, { kind: 'wall_painting', x: 1750, y: 520 },
        { kind: 'oil_lamp', x: 1800, y: 530 },
      ] },
    // 24. W-mid south (mellan lake-west och central)
    { id: 'cabin_w_mid_south', name: 'GRAN-STUGAN', bounds: { x: 1300, y: 2700, w: 200, h: 170 },
      door: { side: 'north', offset: 75, width: 45 },
      windows: [ { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 60, width: 40 }, { side: 'west', offset: 60, width: 40 } ],
      roof: { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' }, floor: '#5a3a1a',
      interior: [
        { kind: 'bed', x: 1320, y: 2740, w: 50, h: 65 }, { kind: 'fireplace', x: 1420, y: 2740, w: 40, h: 40 },
        { kind: 'table_round', x: 1380, y: 2820, r: 18 }, { kind: 'chair', x: 1360, y: 2805 },
        { kind: 'bookshelf', x: 1300, y: 2840, w: 30, h: 25 }, { kind: 'oil_lamp', x: 1370, y: 2730 },
      ] },

    // --- LEFT EDGE BOTTOM (x: 0-1500, y: 7000-10000) ---
    // 25. W lower-edge top
    { id: 'cabin_w_lower_top', name: 'MOSSA-STUGAN', bounds: { x: 250, y: 7000, w: 200, h: 170 },
      door: { side: 'east', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#3a5018', accent: '#1a2810', style: 'wood_shingle' }, floor: '#4a3018',
      interior: [
        { kind: 'bed', x: 270, y: 7040, w: 50, h: 65 }, { kind: 'fireplace', x: 370, y: 7040, w: 40, h: 40 },
        { kind: 'table_long', x: 300, y: 7120, w: 60, h: 30 }, { kind: 'rope_coil', x: 380, y: 7140 },
        { kind: 'oil_lamp', x: 320, y: 7030 }, { kind: 'animal_skull', x: 400, y: 7110 },
      ] },
    // 26. SW outside trees (north of corner-cluster)
    { id: 'cabin_sw_outside', name: 'GLÄNTAN', bounds: { x: 1900, y: 7400, w: 200, h: 170 },
      door: { side: 'west', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#7a3030', accent: '#3a1010', style: 'tile' }, floor: '#6a4828',
      interior: [
        { kind: 'bed', x: 1920, y: 7440, w: 50, h: 65 }, { kind: 'fireplace', x: 2020, y: 7440, w: 40, h: 40 },
        { kind: 'kitchen_counter', x: 1920, y: 7520, w: 80, h: 25 }, { kind: 'chair', x: 1960, y: 7500 },
        { kind: 'oil_lamp', x: 1990, y: 7430 }, { kind: 'wall_painting', x: 1940, y: 7420 },
      ] },
    // 27. SW far (deep south-west corner)
    { id: 'cabin_sw_far', name: 'ÖDE-STUGAN', bounds: { x: 350, y: 8900, w: 190, h: 160 },
      door: { side: 'north', offset: 65, width: 40 },
      windows: [ { side: 'south', offset: 50, width: 35 }, { side: 'east', offset: 60, width: 35 }, { side: 'west', offset: 60, width: 35 } ],
      roof: { color: '#3a2818', accent: '#1a0e08', style: 'wood_shingle' }, floor: '#4a3018',
      interior: [
        { kind: 'bed', x: 370, y: 8930, w: 45, h: 60 }, { kind: 'fireplace', x: 460, y: 8930, w: 40, h: 40 },
        { kind: 'workbench', x: 370, y: 8995, w: 60, h: 30 }, { kind: 'rifle_rack', x: 460, y: 8990 },
        { kind: 'oil_lamp', x: 410, y: 8920 },
      ] },
    // 28. S-W lower mid (mellan SW och south)
    { id: 'cabin_sw_lower_mid', name: 'RAGGAR-STUGAN', bounds: { x: 1500, y: 9100, w: 210, h: 170 },
      door: { side: 'north', offset: 85, width: 50 },
      windows: [ { side: 'south', offset: 70, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#5a5a60', accent: '#2a2a30', style: 'tile' }, floor: '#5a4030',
      interior: [
        { kind: 'bed', x: 1520, y: 9140, w: 50, h: 65 }, { kind: 'fireplace', x: 1630, y: 9140, w: 40, h: 40 },
        { kind: 'workbench', x: 1520, y: 9220, w: 60, h: 30 }, { kind: 'oil_lamp', x: 1600, y: 9130 },
        { kind: 'rope_coil', x: 1600, y: 9230 }, { kind: 'animal_skull', x: 1680, y: 9210 },
      ] },

    // --- RIGHT EDGE TOP (x: 8500-10000, y: 0-3000) — INTE i alien-hörnet! ---
    // 29. NE-corner mid
    { id: 'cabin_ne_corner_mid', name: 'BERGSPASS-STUGAN', bounds: { x: 8200, y: 2200, w: 190, h: 170 },
      door: { side: 'west', offset: 80, width: 45 },
      windows: [ { side: 'north', offset: 50, width: 40 }, { side: 'south', offset: 50, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#a08020', accent: '#5a4810', style: 'thatch' }, floor: '#7a5828',
      interior: [
        { kind: 'bed', x: 8220, y: 2240, w: 50, h: 65 }, { kind: 'fireplace', x: 8320, y: 2240, w: 40, h: 40 },
        { kind: 'desk', x: 8220, y: 2310, w: 60, h: 30 }, { kind: 'chair', x: 8250, y: 2345 },
        { kind: 'oil_lamp', x: 8290, y: 2230 }, { kind: 'map_on_wall', x: 8240, y: 2220 },
      ] },
    // 30. NE far-east (helt vid right-wall)
    { id: 'cabin_ne_far_east', name: 'GRÄNS-VAKT', bounds: { x: 9500, y: 2050, w: 190, h: 170 },
      door: { side: 'south', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 60, width: 40 } ],
      roof: { color: '#306080', accent: '#102540', style: 'tile' }, floor: '#a08060',
      interior: [
        { kind: 'bed', x: 9520, y: 2090, w: 50, h: 65 }, { kind: 'fireplace', x: 9620, y: 2090, w: 40, h: 40 },
        { kind: 'rifle_rack', x: 9520, y: 2080 }, { kind: 'animal_skull', x: 9620, y: 2160 },
        { kind: 'oil_lamp', x: 9580, y: 2080 }, { kind: 'rope_coil', x: 9580, y: 2180 },
      ] },
    // 31. NE south of trees
    { id: 'cabin_ne_south', name: 'JÄRN-STUGAN', bounds: { x: 8200, y: 3700, w: 200, h: 170 },
      door: { side: 'north', offset: 75, width: 45 },
      windows: [ { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#5a5a60', accent: '#2a2a30', style: 'tile' }, floor: '#5a4030',
      interior: [
        { kind: 'bed', x: 8220, y: 3740, w: 50, h: 65 }, { kind: 'fireplace', x: 8320, y: 3740, w: 40, h: 40 },
        { kind: 'workbench', x: 8220, y: 3820, w: 60, h: 30 }, { kind: 'rope_coil', x: 8300, y: 3830 },
        { kind: 'oil_lamp', x: 8300, y: 3730 }, { kind: 'map_on_wall', x: 8230, y: 3720 },
      ] },
    // 32. N-central (mellan north-mid och NE)
    { id: 'cabin_n_central', name: 'HÖGLANDS-STUGAN', bounds: { x: 6300, y: 1100, w: 210, h: 170 },
      door: { side: 'south', offset: 90, width: 50 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'north', offset: 130, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#6a6a70', accent: '#3a3a40', style: 'tile' }, floor: '#7a5a30',
      interior: [
        { kind: 'bed', x: 6320, y: 1140, w: 50, h: 65 }, { kind: 'dresser', x: 6320, y: 1220 },
        { kind: 'fireplace', x: 6440, y: 1140, w: 40, h: 40 }, { kind: 'table_round', x: 6400, y: 1220, r: 18 },
        { kind: 'chair', x: 6380, y: 1205 }, { kind: 'oil_lamp', x: 6420, y: 1130 },
        { kind: 'bookshelf', x: 6300, y: 1240, w: 30, h: 25 },
      ] },

    // --- MID-MAP GAPS (utfyllnad — undvik alien SE-corner) ---
    // 33. W-mid (mellan lake-west och nw-deep — flyttad ner under cont_w_1)
    { id: 'cabin_w_mid', name: 'BJÖRK-STUGAN', bounds: { x: 1750, y: 4700, w: 200, h: 170 },
      door: { side: 'east', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#d4d4c0', accent: '#7a7a6a', style: 'tile' }, floor: '#a08060',
      interior: [
        { kind: 'bed', x: 1770, y: 4740, w: 50, h: 65 }, { kind: 'fireplace', x: 1870, y: 4740, w: 40, h: 40 },
        { kind: 'table_round', x: 1830, y: 4820, r: 18 }, { kind: 'chair', x: 1810, y: 4805 },
        { kind: 'oil_lamp', x: 1820, y: 4730 }, { kind: 'bathtub', x: 1890, y: 4790, w: 35, h: 50 },
      ] },
    // 34. W-central (mellan lake och central village)
    { id: 'cabin_w_central', name: 'BÄCK-STUGAN', bounds: { x: 2200, y: 5800, w: 200, h: 170 },
      door: { side: 'north', offset: 75, width: 45 },
      windows: [ { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#4060a0', accent: '#102540', style: 'tile' }, floor: '#7a5a30',
      interior: [
        { kind: 'bed', x: 2220, y: 5840, w: 50, h: 65 }, { kind: 'fireplace', x: 2320, y: 5840, w: 40, h: 40 },
        { kind: 'table_long', x: 2240, y: 5920, w: 60, h: 30 }, { kind: 'chair', x: 2250, y: 5905 },
        { kind: 'rope_coil', x: 2320, y: 5930 }, { kind: 'oil_lamp', x: 2290, y: 5830 },
      ] },
    // 35. E-central (mellan camping och scrap)
    { id: 'cabin_e_central', name: 'TÅRNS-STUGAN', bounds: { x: 6800, y: 5200, w: 210, h: 170 },
      door: { side: 'west', offset: 75, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#7a3030', accent: '#3a1010', style: 'tile' }, floor: '#6a4828',
      interior: [
        { kind: 'bed', x: 6820, y: 5240, w: 50, h: 65 }, { kind: 'fireplace', x: 6920, y: 5240, w: 40, h: 40 },
        { kind: 'kitchen_counter', x: 6820, y: 5320, w: 90, h: 25 }, { kind: 'chair', x: 6870, y: 5300 },
        { kind: 'oil_lamp', x: 6890, y: 5230 }, { kind: 'wall_painting', x: 6840, y: 5220 },
      ] },
    // 36. Central-south (mellan village och south)
    { id: 'cabin_central_south', name: 'BONDE-LADAN', bounds: { x: 4200, y: 6800, w: 220, h: 180 },
      door: { side: 'north', offset: 90, width: 55 },
      windows: [ { side: 'south', offset: 80, width: 50 }, { side: 'east', offset: 80, width: 40 }, { side: 'west', offset: 80, width: 40 } ],
      roof: { color: '#5a3818', accent: '#2a1808', style: 'wood_shingle' }, floor: '#3a2810',
      interior: [
        { kind: 'haystack_inside', x: 4220, y: 6840, w: 70, h: 50 }, { kind: 'woodpile_inside', x: 4220, y: 6900, w: 60, h: 30 },
        { kind: 'workbench', x: 4330, y: 6840, w: 60, h: 30 }, { kind: 'pitchfork', x: 4380, y: 6870 },
        { kind: 'rope_coil', x: 4300, y: 6940 }, { kind: 'animal_skull', x: 4380, y: 6940 },
      ] },
    // 37. SW-mid (mellan lake och south)
    { id: 'cabin_sw_mid', name: 'KÄRR-STUGAN', bounds: { x: 1700, y: 6700, w: 200, h: 170 },
      door: { side: 'east', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#3a5018', accent: '#1a2810', style: 'wood_shingle' }, floor: '#4a3018',
      interior: [
        { kind: 'bed', x: 1720, y: 6740, w: 50, h: 65 }, { kind: 'fireplace', x: 1820, y: 6740, w: 40, h: 40 },
        { kind: 'table_long', x: 1740, y: 6820, w: 60, h: 30 }, { kind: 'chair', x: 1750, y: 6810 },
        { kind: 'rope_coil', x: 1810, y: 6830 }, { kind: 'oil_lamp', x: 1790, y: 6730 },
      ] },
    // 38. N-mid-west (mellan north-deep och village)
    { id: 'cabin_n_mid_west', name: 'KOLAR-STUGAN', bounds: { x: 3700, y: 1800, w: 200, h: 170 },
      door: { side: 'south', offset: 75, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 }, { side: 'west', offset: 70, width: 40 } ],
      roof: { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' }, floor: '#5a3a1a',
      interior: [
        { kind: 'bed', x: 3720, y: 1840, w: 50, h: 65 }, { kind: 'fireplace', x: 3820, y: 1840, w: 40, h: 40 },
        { kind: 'workbench', x: 3720, y: 1920, w: 60, h: 30 }, { kind: 'rifle_rack', x: 3720, y: 1830 },
        { kind: 'animal_skull', x: 3820, y: 1930 }, { kind: 'oil_lamp', x: 3780, y: 1830 },
      ] },
    // 39. East-far-mid (mellan east-mid och scrap)
    { id: 'cabin_e_far_mid', name: 'KORSVÄGS-STUGAN', bounds: { x: 8800, y: 5300, w: 200, h: 170 },
      door: { side: 'west', offset: 70, width: 45 },
      windows: [ { side: 'north', offset: 60, width: 40 }, { side: 'south', offset: 60, width: 40 }, { side: 'east', offset: 70, width: 40 } ],
      roof: { color: '#a08020', accent: '#5a4810', style: 'thatch' }, floor: '#7a5828',
      interior: [
        { kind: 'bed', x: 8820, y: 5340, w: 50, h: 65 }, { kind: 'fireplace', x: 8920, y: 5340, w: 40, h: 40 },
        { kind: 'kitchen_counter', x: 8820, y: 5420, w: 90, h: 25 }, { kind: 'desk', x: 8820, y: 5460, w: 60, h: 30 },
        { kind: 'oil_lamp', x: 8890, y: 5330 }, { kind: 'bookshelf', x: 8800, y: 5440, w: 30, h: 25 },
      ] },
    // 40. SW lake-cluster (mellan lake-west och sw-strand)
    { id: 'cabin_sw_lake_south', name: 'TRÄSKMARKEN', bounds: { x: 1200, y: 5200, w: 190, h: 160 },
      door: { side: 'north', offset: 65, width: 40 },
      windows: [ { side: 'south', offset: 60, width: 35 }, { side: 'east', offset: 60, width: 35 }, { side: 'west', offset: 60, width: 35 } ],
      roof: { color: '#4060a0', accent: '#102540', style: 'tile' }, floor: '#7a5a30',
      interior: [
        { kind: 'bed', x: 1220, y: 5230, w: 45, h: 60 }, { kind: 'fireplace', x: 1310, y: 5230, w: 40, h: 40 },
        { kind: 'table_round', x: 1280, y: 5310, r: 18 }, { kind: 'rope_coil', x: 1330, y: 5310 },
        { kind: 'oil_lamp', x: 1270, y: 5220 },
      ] },
  ],

  // === CONTAINER-CABINS — alla containrar är nu "miniature hus" ===
  // Auto-konverteras till cabins-arrayen via preprocess. Dörr på kortsidan,
  // garanterad legendary-loot inuti, tak försvinner när spelaren är inne.
  containerCabins: [
    // NE scrap-yard cluster (var staplade containrar)
    { id: 'cont_ne_1', name: 'CONTAINER-A1', x: 5300, y: 2400, w: 220, h: 80, color: 'rust' },
    { id: 'cont_ne_2', name: 'CONTAINER-B2', x: 5300, y: 2500, w: 220, h: 80, color: 'orange' },
    { id: 'cont_ne_3', name: 'CONTAINER-C3', x: 5600, y: 2700, w: 80,  h: 220, color: 'blue' },
    { id: 'cont_ne_4', name: 'CONTAINER-D4', x: 6100, y: 2300, w: 220, h: 80, color: 'green' },
    { id: 'cont_ne_5', name: 'CONTAINER-E5', x: 6100, y: 2400, w: 220, h: 80, color: 'yellow' },
    { id: 'cont_ne_6', name: 'CONTAINER-F6', x: 6500, y: 2600, w: 80,  h: 220, color: 'red' },
    { id: 'cont_ne_7', name: 'CONTAINER-G7', x: 7000, y: 2800, w: 220, h: 80, color: 'rust' },
    { id: 'cont_ne_8', name: 'CONTAINER-H8', x: 7300, y: 2400, w: 220, h: 80, color: 'blue' },
    { id: 'cont_ne_9', name: 'CONTAINER-J9', x: 7500, y: 3500, w: 80,  h: 220, color: 'orange' },
    // East camping
    { id: 'cont_e_1',  name: 'CONTAINER-K0', x: 7500, y: 6100, w: 220, h: 80, color: 'rust' },
    // ===== 10 NYA CONTAINRAR (v1.337) — spridda över hela kartan =====
    { id: 'cont_nw_1', name: 'CONTAINER-L1', x: 1200, y: 1200, w: 220, h: 80, color: 'green' },
    { id: 'cont_nw_2', name: 'CONTAINER-M2', x: 2500, y: 900,  w: 80,  h: 220, color: 'blue' },
    { id: 'cont_n_1',  name: 'CONTAINER-N3', x: 5500, y: 700,  w: 220, h: 80, color: 'yellow' },
    { id: 'cont_w_1',  name: 'CONTAINER-P4', x: 1500, y: 4500, w: 220, h: 80, color: 'orange' },
    { id: 'cont_w_2',  name: 'CONTAINER-Q5', x: 800,  y: 6200, w: 80,  h: 220, color: 'red' },
    { id: 'cont_e_2',  name: 'CONTAINER-R6', x: 8800, y: 4500, w: 80,  h: 220, color: 'green' },
    { id: 'cont_e_3',  name: 'CONTAINER-S7', x: 9200, y: 5800, w: 220, h: 80, color: 'rust' },
    { id: 'cont_sw_1', name: 'CONTAINER-T8', x: 1100, y: 8500, w: 220, h: 80, color: 'blue' },
    { id: 'cont_s_1',  name: 'CONTAINER-U9', x: 4500, y: 8800, w: 220, h: 80, color: 'yellow' },
    { id: 'cont_se_1', name: 'CONTAINER-V0', x: 7300, y: 8500, w: 80,  h: 220, color: 'orange' },
  ],

  walls: [
    // === PERIMETER (10000×10000) ===
    { x: 0,    y: 0,    w: 10000, h: 20,   kind: 'stone_wall' },
    { x: 0,    y: 9980, w: 10000, h: 20,   kind: 'stone_wall' },
    { x: 0,    y: 0,    w: 20,    h: 10000, kind: 'stone_wall' },
    { x: 9980, y: 0,    w: 20,    h: 10000, kind: 'stone_wall' },

    // ========================================================================
    // === EXTRA OUTER-CONTENT (v1.332) — utfyll alla 4 hörn + outer-ring ===
    // ========================================================================
    // NW HÖRN (0-2000, 0-2500)
    { x: 200,  y: 200,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 350,  y: 350,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 550,  y: 200,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 800,  y: 350,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 1000, y: 250,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 1300, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 1600, y: 250,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 250,  y: 650,  w: 55, h: 55, kind: 'tree_pine' },
    { x: 500,  y: 800,  w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 900,  y: 750,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 1200, y: 850,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 1500, y: 700,  w: 55, h: 55, kind: 'tree_pine' },
    { x: 1700, y: 950,  w: 60, h: 60, kind: 'tree_oak' },
    { x: 300,  y: 1100, w: 50, h: 50, kind: 'tree_pine' },
    { x: 750,  y: 1200, w: 65, h: 65, kind: 'tree_oak' },
    { x: 1100, y: 1300, w: 55, h: 55, kind: 'tree_pine' },
    { x: 1450, y: 1200, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1800, y: 1400, w: 55, h: 55, kind: 'tree_pine' },
    { x: 400,  y: 1600, w: 80, h: 60, kind: 'rock_large' },
    { x: 1200, y: 1800, w: 90, h: 70, kind: 'rock_large' },
    { x: 700,  y: 1800, w: 50, h: 40, kind: 'rock_small' },
    { x: 1600, y: 1700, w: 50, h: 40, kind: 'rock_small' },
    { x: 500,  y: 1500, w: 30, h: 30, kind: 'tree_stump' },
    { x: 1300, y: 1100, w: 30, h: 30, kind: 'tree_stump' },
    { x: 200,  y: 1900, w: 70, h: 70, kind: 'tree_pine' },
    { x: 1900, y: 1800, w: 65, h: 65, kind: 'tree_oak' },
    // Litet camp i NW outer (lägereld + tält + några stenar)
    { x: 900,  y: 1500, w: 80, h: 70, kind: 'tent', color: 'green' },
    { x: 1050, y: 1600, w: 50, h: 50, kind: 'campfire' },
    { x: 850,  y: 1650, w: 32, h: 32, kind: 'oil_drum' },

    // NE HÖRN (8000-10000, 0-2500)
    { x: 8100, y: 250,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 8350, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 8600, y: 250,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 8850, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 9100, y: 300,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 9400, y: 450,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 8200, y: 700,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 8550, y: 850,  w: 55, h: 55, kind: 'tree_pine' },
    { x: 8800, y: 750,  w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 9200, y: 900,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 9500, y: 800,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 8100, y: 1200, w: 60, h: 60, kind: 'tree_pine' },
    { x: 8450, y: 1300, w: 65, h: 65, kind: 'tree_oak' },
    { x: 8800, y: 1200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9200, y: 1400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 9500, y: 1300, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8300, y: 1700, w: 80, h: 60, kind: 'rock_large' },
    { x: 9100, y: 1900, w: 90, h: 70, kind: 'rock_large' },
    { x: 8700, y: 1900, w: 50, h: 40, kind: 'rock_small' },
    { x: 9500, y: 1700, w: 50, h: 40, kind: 'rock_small' },
    { x: 8500, y: 1500, w: 30, h: 30, kind: 'tree_stump' },
    { x: 9300, y: 1100, w: 30, h: 30, kind: 'tree_stump' },
    // Övergiven NE outer-stuga ruin (bara walls — ingen interior, ser ut som ruin)
    { x: 8800, y: 1800, w: 100, h: 12, kind: 'cabin_wall_wood' },
    { x: 8800, y: 1900, w: 100, h: 12, kind: 'cabin_wall_wood' },
    { x: 8800, y: 1800, w: 12,  h: 110, kind: 'cabin_wall_wood' },
    // Lägereld i NE
    { x: 9100, y: 2100, w: 50, h: 50, kind: 'campfire' },

    // SW HÖRN (0-2000, 7500-10000)
    { x: 200,  y: 7600, w: 70, h: 70, kind: 'tree_oak' },
    { x: 450,  y: 7800, w: 60, h: 60, kind: 'tree_pine' },
    { x: 700,  y: 7700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 950,  y: 7850, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1200, y: 7750, w: 70, h: 70, kind: 'tree_oak' },
    { x: 1500, y: 7900, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1800, y: 7800, w: 65, h: 65, kind: 'tree_oak' },
    { x: 300,  y: 8100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 600,  y: 8200, w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 950,  y: 8250, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1300, y: 8150, w: 65, h: 65, kind: 'tree_oak' },
    { x: 1600, y: 8300, w: 55, h: 55, kind: 'tree_pine' },
    { x: 250,  y: 8600, w: 60, h: 60, kind: 'tree_oak' },
    { x: 700,  y: 8700, w: 65, h: 65, kind: 'tree_pine' },
    { x: 1100, y: 8600, w: 55, h: 55, kind: 'tree_oak' },
    { x: 1500, y: 8750, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1800, y: 8650, w: 55, h: 55, kind: 'tree_oak' },
    { x: 400,  y: 9100, w: 70, h: 70, kind: 'tree_pine' },
    { x: 800,  y: 9200, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1200, y: 9100, w: 65, h: 65, kind: 'tree_pine' },
    { x: 1600, y: 9250, w: 60, h: 60, kind: 'tree_oak' },
    { x: 500,  y: 8400, w: 80, h: 60, kind: 'rock_large' },
    { x: 1300, y: 8500, w: 90, h: 70, kind: 'rock_large' },
    { x: 1700, y: 9000, w: 50, h: 40, kind: 'rock_small' },
    { x: 600,  y: 9500, w: 50, h: 40, kind: 'rock_small' },
    { x: 900,  y: 8000, w: 30, h: 30, kind: 'tree_stump' },
    { x: 1400, y: 8800, w: 30, h: 30, kind: 'tree_stump' },
    // Övergiven brunn i SW
    { x: 850,  y: 8500, w: 50, h: 50, kind: 'well' },

    // SE HÖRN (8000-10000, 7500-10000)
    { x: 8200, y: 7600, w: 70, h: 70, kind: 'tree_oak' },
    { x: 8500, y: 7800, w: 60, h: 60, kind: 'tree_pine' },
    { x: 8800, y: 7700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 9100, y: 7850, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9400, y: 7750, w: 70, h: 70, kind: 'tree_oak' },
    { x: 8300, y: 8100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8600, y: 8250, w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 8950, y: 8150, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9300, y: 8300, w: 65, h: 65, kind: 'tree_oak' },
    { x: 9600, y: 8200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8200, y: 8600, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8700, y: 8700, w: 65, h: 65, kind: 'tree_pine' },
    { x: 9100, y: 8600, w: 55, h: 55, kind: 'tree_oak' },
    { x: 9500, y: 8750, w: 60, h: 60, kind: 'tree_pine' },
    { x: 8400, y: 9100, w: 70, h: 70, kind: 'tree_pine' },
    { x: 8800, y: 9200, w: 60, h: 60, kind: 'tree_oak' },
    { x: 9200, y: 9100, w: 65, h: 65, kind: 'tree_pine' },
    { x: 9600, y: 9250, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8500, y: 8400, w: 80, h: 60, kind: 'rock_large' },
    { x: 9300, y: 8500, w: 90, h: 70, kind: 'rock_large' },
    { x: 8900, y: 9000, w: 50, h: 40, kind: 'rock_small' },
    { x: 9500, y: 9500, w: 50, h: 40, kind: 'rock_small' },
    { x: 8800, y: 8000, w: 30, h: 30, kind: 'tree_stump' },
    { x: 9400, y: 8800, w: 30, h: 30, kind: 'tree_stump' },
    // Övergiven bil i SE
    { x: 9000, y: 8500, w: 110, h: 55, kind: 'car_wreck' },
    // Liten standing-stone-grupp i SE (mystik)
    { x: 8500, y: 9500, w: 50, h: 50, kind: 'standing_stone' },
    { x: 8580, y: 9450, w: 50, h: 50, kind: 'standing_stone' },
    { x: 8660, y: 9500, w: 50, h: 50, kind: 'standing_stone' },

    // ========================================================================
    // === EDGE BOOST (v1.369) — mer content på vänster + höger edges ===
    // INTE i SE-hörn (alien-zon). Fyller upp:
    //   - LEFT EDGE TOP (x:0-1500, y:0-3000)
    //   - LEFT EDGE BOTTOM (x:0-1500, y:7000-10000)
    //   - RIGHT EDGE TOP (x:8500-10000, y:0-3000)
    // ========================================================================

    // --- LEFT EDGE TOP BOOST (NW, x:0-1500, y:0-3000) ---
    // Tätare skog i nord-mid + sydligt mellan-band (y:2000-3000)
    { x: 150,  y: 450,  w: 65, h: 65, kind: 'tree_pine' },
    { x: 700,  y: 100,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 1400, y: 100,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 50,   y: 1000, w: 65, h: 65, kind: 'tree_oak' },
    { x: 1450, y: 950,  w: 55, h: 55, kind: 'tree_pine' },
    { x: 350,  y: 2100, w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 700,  y: 2000, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1000, y: 2100, w: 65, h: 65, kind: 'tree_oak' },
    { x: 1300, y: 2050, w: 60, h: 60, kind: 'tree_pine' },
    { x: 200,  y: 2700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 700,  y: 2700, w: 55, h: 55, kind: 'tree_pine' },
    { x: 1000, y: 2800, w: 60, h: 60, kind: 'tree_giant_oak' },
    { x: 50,   y: 2400, w: 50, h: 50, kind: 'tree_pine' },
    // Stenar + stubbar
    { x: 950,  y: 600,  w: 80, h: 60, kind: 'rock_large' },
    { x: 150,  y: 1700, w: 50, h: 40, kind: 'rock_small' },
    { x: 1450, y: 2400, w: 50, h: 40, kind: 'rock_small' },
    { x: 900,  y: 2500, w: 30, h: 30, kind: 'tree_stump' },
    { x: 1100, y: 2900, w: 30, h: 30, kind: 'tree_stump' },
    // Camp + skogsmark (NW mellan-zon)
    { x: 1250, y: 2300, w: 80, h: 70, kind: 'tent', color: 'brown' },
    { x: 1400, y: 2200, w: 50, h: 50, kind: 'campfire' },
    { x: 80,   y: 2900, w: 32, h: 32, kind: 'oil_drum' },
    { x: 400,  y: 1300, w: 32, h: 32, kind: 'oil_drum' },
    // Övergiven brunn nord-väst
    { x: 1450, y: 1400, w: 50, h: 50, kind: 'well' },
    // Standing-stone-mystik
    { x: 200,  y: 350,  w: 50, h: 50, kind: 'standing_stone' },
    { x: 1550, y: 2920, w: 40, h: 60, kind: 'rune_stone' },

    // --- LEFT EDGE BOTTOM BOOST (SW, x:0-1500, y:7000-10000) ---
    // Mer skog + camps i SW-banding
    { x: 150,  y: 7150, w: 65, h: 65, kind: 'tree_oak' },
    { x: 500,  y: 7100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1000, y: 7050, w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 1300, y: 7200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 50,   y: 7400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1450, y: 7400, w: 65, h: 65, kind: 'tree_pine' },
    { x: 200,  y: 7700, w: 55, h: 55, kind: 'tree_pine' },
    { x: 1100, y: 7400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1450, y: 7700, w: 65, h: 65, kind: 'tree_giant_oak' },
    { x: 100,  y: 7900, w: 50, h: 50, kind: 'tree_pine' },
    { x: 1100, y: 8500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1450, y: 8500, w: 55, h: 55, kind: 'tree_pine' },
    { x: 100,  y: 9700, w: 60, h: 60, kind: 'tree_oak' },
    { x: 1000, y: 9700, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1450, y: 9700, w: 65, h: 65, kind: 'tree_giant_oak' },
    // Stenar och stubbar
    { x: 1200, y: 7050, w: 80, h: 60, kind: 'rock_large' },
    { x: 50,   y: 7800, w: 50, h: 40, kind: 'rock_small' },
    { x: 1450, y: 8000, w: 50, h: 40, kind: 'rock_small' },
    { x: 900,  y: 7300, w: 90, h: 70, kind: 'rock_large' },
    { x: 1400, y: 9800, w: 30, h: 30, kind: 'tree_stump' },
    { x: 200,  y: 7200, w: 30, h: 30, kind: 'tree_stump' },
    // Camp i SW
    { x: 1200, y: 7500, w: 80, h: 70, kind: 'tent', color: 'red' },
    { x: 1350, y: 7600, w: 50, h: 50, kind: 'campfire' },
    { x: 1100, y: 7650, w: 32, h: 32, kind: 'oil_drum' },
    // Övergiven car-wreck nere i SW
    { x: 1000, y: 9500, w: 110, h: 55, kind: 'car_wreck' },
    // Brunn i SW
    { x: 1200, y: 8000, w: 50, h: 50, kind: 'well' },
    // Mystik
    { x: 1450, y: 9100, w: 50, h: 50, kind: 'standing_stone' },
    { x: 50,   y: 9100, w: 40, h: 60, kind: 'rune_stone' },
    { x: 1413, y: 9402, w: 14, h: 65, kind: 'skull_totem' },

    // --- RIGHT EDGE TOP BOOST (NE, x:8500-10000, y:0-3000) ---
    // Mer skog i NE — INTE i alien-corner som börjar y>=7900
    { x: 8550, y: 100,  w: 70, h: 70, kind: 'tree_oak' },
    { x: 9000, y: 150,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 9700, y: 200,  w: 65, h: 65, kind: 'tree_giant_oak' },
    { x: 8500, y: 550,  w: 55, h: 55, kind: 'tree_pine' },
    { x: 9750, y: 550,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 8500, y: 1000, w: 60, h: 60, kind: 'tree_giant_oak' },
    { x: 9700, y: 1100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8700, y: 1500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 9050, y: 1600, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9750, y: 1500, w: 65, h: 65, kind: 'tree_oak' },
    { x: 8550, y: 2150, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9700, y: 2050, w: 70, h: 70, kind: 'tree_giant_oak' },
    { x: 8700, y: 2350, w: 60, h: 60, kind: 'tree_oak' },
    { x: 9000, y: 2400, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9300, y: 2350, w: 65, h: 65, kind: 'tree_oak' },
    { x: 9750, y: 2400, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8550, y: 2800, w: 60, h: 60, kind: 'tree_oak' },
    { x: 9750, y: 2800, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9300, y: 2900, w: 70, h: 70, kind: 'tree_giant_oak' },
    // Stenar och stubbar i NE
    { x: 9600, y: 350,  w: 80, h: 60, kind: 'rock_large' },
    { x: 8550, y: 1850, w: 90, h: 70, kind: 'rock_large' },
    { x: 9750, y: 950,  w: 50, h: 40, kind: 'rock_small' },
    { x: 8700, y: 2700, w: 50, h: 40, kind: 'rock_small' },
    { x: 9100, y: 1100, w: 30, h: 30, kind: 'tree_stump' },
    { x: 9450, y: 2750, w: 30, h: 30, kind: 'tree_stump' },
    // Litet NE-camp (uppe vid kanten)
    { x: 9400, y: 100,  w: 80, h: 70, kind: 'tent', color: 'blue' },
    { x: 9550, y: 200,  w: 50, h: 50, kind: 'campfire' },
    { x: 9300, y: 250,  w: 32, h: 32, kind: 'oil_drum' },
    // NE car-wreck
    { x: 8700, y: 2900, w: 110, h: 55, kind: 'car_wreck' },
    // NE brunn
    { x: 9500, y: 2600, w: 50, h: 50, kind: 'well' },
    // Mystik nere i NE (innan alien-zon!)
    { x: 9750, y: 350,  w: 40, h: 60, kind: 'rune_stone' },
    { x: 9700, y: 1700, w: 50, h: 50, kind: 'standing_stone' },
    { x: 8613, y: 2952, w: 14, h: 65, kind: 'skull_totem' },

    // ========================================================================
    // === ALIEN-OMRÅDE (SE-hörnet, x=7900-9800, y=7900-9800) ===
    // Crash-zon med UFO-vrak + crystals + skull-totems + alien-mark
    // ========================================================================
    // CENTRAL: KRASCHAT UFO — mindre (160x160 = lätt att gå runt)
    // + crash-debris (fragmenterade metallbitar) spridda runt vraket
    { x: 8754, y: 8820, w: 93, h: 61, kind: 'ufo_wreck' },
    // Crash-debris (mindre metallbitar spridda runt UFO:t)
    { x: 8614, y: 8706, w: 11, h: 19, kind: 'ufo_debris' },
    { x: 8912, y: 8704, w: 11, h: 19, kind: 'ufo_debris' },
    { x: 8564, y: 8906, w: 11, h: 19, kind: 'ufo_debris' },
    { x: 8966, y: 8956, w: 11, h: 19, kind: 'ufo_debris' },
    { x: 8692, y: 8984, w: 11, h: 19, kind: 'ufo_debris' },
    { x: 8834, y: 8646, w: 11, h: 19, kind: 'ufo_debris' },
    // CRYSTAL-FORMATIONER spridda runt UFO:t (lila glödande)
    { x: 8418, y: 8532, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 9023, y: 8536, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 8318, y: 8932, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 9120, y: 8934, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 8523, y: 9236, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 8918, y: 9332, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 8220, y: 8234, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 9318, y: 8232, w: 14, h: 17, kind: 'alien_crystal' },
    // SKULL-TOTEMS — gamla skogs-altare med skallar
    { x: 8113, y: 8402, w: 14, h: 65, kind: 'skull_totem' },
    { x: 9413, y: 8402, w: 14, h: 65, kind: 'skull_totem' },
    { x: 8113, y: 9402, w: 14, h: 65, kind: 'skull_totem' },
    { x: 9413, y: 9402, w: 14, h: 65, kind: 'skull_totem' },
    // EXTRA STENCIRKEL i alien-området
    { x: 8550, y: 8350, w: 50, h: 50, kind: 'standing_stone' },
    { x: 8700, y: 8320, w: 50, h: 50, kind: 'standing_stone' },
    { x: 8850, y: 8350, w: 50, h: 50, kind: 'standing_stone' },
    // RUNE-STONES i hörnen
    { x: 8000, y: 8000, w: 40, h: 60, kind: 'rune_stone' },
    { x: 9700, y: 8000, w: 40, h: 60, kind: 'rune_stone' },
    { x: 8000, y: 9700, w: 40, h: 60, kind: 'rune_stone' },
    { x: 9700, y: 9700, w: 40, h: 60, kind: 'rune_stone' },

    // === EXTRA MYSTIK spridd över kartan ===
    // NW deep mystik
    { x: 1500, y: 2500, w: 50, h: 50, kind: 'standing_stone' },
    { x: 1620, y: 2480, w: 50, h: 50, kind: 'standing_stone' },
    { x: 1400, y: 2300, w: 40, h: 60, kind: 'rune_stone' },
    // SW mystik (flyttad ut ur cabin_sw_mid)
    { x: 1963, y: 6902, w: 14, h: 65, kind: 'skull_totem' },
    { x: 600, y: 7500, w: 40, h: 60, kind: 'rune_stone' },
    // NE mystik (mellan scrap och alien)
    { x: 9018, y: 6532, w: 14, h: 17, kind: 'alien_crystal' },
    { x: 9313, y: 6802, w: 14, h: 65, kind: 'skull_totem' },
    // Inom skog
    { x: 3500, y: 5000, w: 40, h: 60, kind: 'rune_stone' },
    { x: 6513, y: 5802, w: 14, h: 65, kind: 'skull_totem' },

    // === RING-CONTENT (mellan zonerna och outer-perimeter) ===
    // Mellan zoner: N
    { x: 3200, y: 1500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 3800, y: 1700, w: 55, h: 55, kind: 'tree_pine' },
    { x: 4400, y: 1500, w: 65, h: 65, kind: 'tree_oak' },
    { x: 5000, y: 1700, w: 60, h: 60, kind: 'tree_pine' },
    { x: 5600, y: 1500, w: 55, h: 55, kind: 'tree_oak' },
    { x: 6200, y: 1700, w: 60, h: 60, kind: 'tree_pine' },
    { x: 6800, y: 1500, w: 65, h: 65, kind: 'tree_oak' },
    { x: 7400, y: 1700, w: 55, h: 55, kind: 'tree_pine' },
    // Mellan zoner: W
    { x: 1800, y: 4000, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1800, y: 4500, w: 55, h: 55, kind: 'tree_oak' },
    { x: 1800, y: 5500, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1800, y: 6800, w: 55, h: 55, kind: 'tree_oak' },
    // Mellan zoner: E
    { x: 8100, y: 4000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8100, y: 4800, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8100, y: 5800, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8100, y: 6800, w: 55, h: 55, kind: 'tree_pine' },
    // Mellan zoner: S
    { x: 3200, y: 8200, w: 60, h: 60, kind: 'tree_pine' },
    { x: 3800, y: 8400, w: 55, h: 55, kind: 'tree_oak' },
    { x: 4500, y: 8200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 5200, y: 8400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 5900, y: 8200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 6600, y: 8400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7300, y: 8200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 8000, y: 8400, w: 55, h: 55, kind: 'tree_oak' },

    // Extra stenar utspridda (utfyll outer-ring)
    { x: 2300, y: 1300, w: 70, h: 50, kind: 'rock_large' },
    { x: 4200, y: 1400, w: 80, h: 60, kind: 'rock_large' },
    { x: 5800, y: 1200, w: 70, h: 50, kind: 'rock_large' },
    { x: 7400, y: 1400, w: 80, h: 60, kind: 'rock_large' },
    { x: 1700, y: 5200, w: 70, h: 50, kind: 'rock_large' },
    { x: 8100, y: 5200, w: 80, h: 60, kind: 'rock_large' },
    { x: 3500, y: 8400, w: 70, h: 50, kind: 'rock_large' },
    { x: 6500, y: 8400, w: 80, h: 60, kind: 'rock_large' },

    // === OUTER WILDERNESS — TÄT VILD SKOG (norra ringen) ===
    // North outer (y < 1800)
    { x: 600,  y: 300,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 1100, y: 500,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 1800, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 2500, y: 300,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 3200, y: 500,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 3900, y: 400,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 4600, y: 300,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 5300, y: 500,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 6000, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 6700, y: 500,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 7400, y: 300,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 8100, y: 500,  w: 65, h: 65, kind: 'tree_oak' },
    { x: 8800, y: 400,  w: 60, h: 60, kind: 'tree_pine' },
    { x: 9400, y: 1000, w: 65, h: 65, kind: 'tree_oak' },
    // North row 2
    { x: 800,  y: 1100, w: 55, h: 55, kind: 'tree_oak' },
    { x: 1500, y: 1000, w: 60, h: 60, kind: 'tree_pine' },
    { x: 2200, y: 1200, w: 55, h: 55, kind: 'tree_oak' },
    { x: 2900, y: 1100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 3700, y: 1200, w: 55, h: 55, kind: 'tree_oak' },
    { x: 4500, y: 1100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 5200, y: 1300, w: 55, h: 55, kind: 'tree_oak' },
    { x: 6000, y: 1100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 6800, y: 1200, w: 55, h: 55, kind: 'tree_oak' },
    { x: 7600, y: 1100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 8400, y: 1300, w: 55, h: 55, kind: 'tree_oak' },
    { x: 9100, y: 1200, w: 60, h: 60, kind: 'tree_pine' },

    // West outer (x < 1800)
    { x: 400,  y: 2000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 700,  y: 2500, w: 55, h: 55, kind: 'tree_pine' },
    { x: 1200, y: 2300, w: 65, h: 65, kind: 'tree_oak' },
    { x: 500,  y: 3100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1300, y: 3000, w: 55, h: 55, kind: 'tree_oak' },
    { x: 400,  y: 4000, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1100, y: 4200, w: 65, h: 65, kind: 'tree_oak' },
    { x: 600,  y: 6500, w: 60, h: 60, kind: 'tree_pine' },
    { x: 1300, y: 6700, w: 55, h: 55, kind: 'tree_oak' },
    { x: 500,  y: 7300, w: 65, h: 65, kind: 'tree_pine' },
    { x: 1100, y: 7400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 800,  y: 8200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 1400, y: 8500, w: 65, h: 65, kind: 'tree_oak' },

    // East outer (x > 8200)
    { x: 8400, y: 2300, w: 65, h: 65, kind: 'tree_pine' },
    { x: 9100, y: 2500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8500, y: 3200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9300, y: 3500, w: 65, h: 65, kind: 'tree_oak' },
    { x: 8400, y: 4500, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9200, y: 4700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 8600, y: 5500, w: 60, h: 60, kind: 'tree_pine' },
    { x: 9300, y: 5800, w: 55, h: 55, kind: 'tree_oak' },
    { x: 8400, y: 6500, w: 65, h: 65, kind: 'tree_pine' },
    { x: 9100, y: 6700, w: 60, h: 60, kind: 'tree_oak' },
    { x: 8500, y: 7500, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9300, y: 7700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 8700, y: 8500, w: 60, h: 60, kind: 'tree_pine' },

    // South outer (y > 8500)
    { x: 1000, y: 8800, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2000, y: 8900, w: 55, h: 55, kind: 'tree_pine' },
    { x: 2900, y: 8800, w: 65, h: 65, kind: 'tree_oak' },
    { x: 3800, y: 9000, w: 60, h: 60, kind: 'tree_pine' },
    { x: 4700, y: 8900, w: 55, h: 55, kind: 'tree_oak' },
    { x: 5600, y: 9100, w: 65, h: 65, kind: 'tree_pine' },
    { x: 6500, y: 8900, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7400, y: 9000, w: 55, h: 55, kind: 'tree_pine' },
    { x: 8300, y: 9200, w: 65, h: 65, kind: 'tree_oak' },
    // Row 2 south
    { x: 1500, y: 9400, w: 60, h: 60, kind: 'tree_pine' },
    { x: 3000, y: 9500, w: 55, h: 55, kind: 'tree_oak' },
    { x: 4500, y: 9400, w: 65, h: 65, kind: 'tree_pine' },
    { x: 6000, y: 9500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7500, y: 9400, w: 55, h: 55, kind: 'tree_pine' },
    { x: 9000, y: 9300, w: 65, h: 65, kind: 'tree_oak' },

    // Outer-skog stenar
    { x: 600,  y: 600,  w: 70, h: 50, kind: 'rock_large' },
    { x: 3000, y: 200,  w: 80, h: 60, kind: 'rock_large' },
    { x: 7000, y: 700,  w: 70, h: 50, kind: 'rock_large' },
    { x: 8800, y: 3000, w: 80, h: 60, kind: 'rock_large' },
    { x: 9000, y: 6000, w: 70, h: 50, kind: 'rock_large' },
    { x: 600,  y: 7500, w: 80, h: 60, kind: 'rock_large' },
    { x: 5000, y: 9300, w: 80, h: 60, kind: 'rock_large' },

    // Outer-skog brunna gamla bilar (övergivna)
    { x: 1500, y: 600,  w: 110, h: 55, kind: 'car_wreck' },
    { x: 7500, y: 600,  w: 110, h: 55, kind: 'car_wreck' },
    { x: 800,  y: 8200, w: 110, h: 55, kind: 'car_wreck' },
    { x: 8700, y: 8500, w: 110, h: 55, kind: 'car_wreck' },

    // ========================================================================
    // === NW FOREST (2000-5000, 2000-5000) — TÄT SKOG ===
    // ========================================================================
    { x: 2250, y: 2500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2400, y: 2700, w: 55, h: 55, kind: 'tree_pine' },
    { x: 2600, y: 2550, w: 70, h: 70, kind: 'tree_oak' },
    { x: 2800, y: 2750, w: 60, h: 60, kind: 'tree_pine' },
    { x: 3000, y: 2600, w: 65, h: 65, kind: 'tree_oak' },
    { x: 2250, y: 2900, w: 55, h: 55, kind: 'tree_pine' },
    { x: 2500, y: 3000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2750, y: 3100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 2900, y: 2900, w: 65, h: 65, kind: 'tree_oak' },
    { x: 3150, y: 2900, w: 60, h: 60, kind: 'tree_pine' },
    { x: 2200, y: 3300, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2400, y: 3400, w: 55, h: 55, kind: 'tree_pine' },
    { x: 2700, y: 3500, w: 70, h: 70, kind: 'tree_oak' },
    { x: 2950, y: 3300, w: 60, h: 60, kind: 'tree_pine' },
    { x: 3200, y: 3500, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2250, y: 3700, w: 65, h: 65, kind: 'tree_pine' },
    { x: 2550, y: 3800, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2850, y: 3750, w: 70, h: 70, kind: 'tree_pine' },
    { x: 3100, y: 3900, w: 60, h: 60, kind: 'tree_oak' },
    { x: 3400, y: 3800, w: 65, h: 65, kind: 'tree_pine' },
    { x: 3700, y: 3700, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4000, y: 3900, w: 65, h: 65, kind: 'tree_pine' },
    { x: 4300, y: 3800, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4600, y: 3900, w: 65, h: 65, kind: 'tree_pine' },
    { x: 3500, y: 2300, w: 55, h: 55, kind: 'tree_pine' },
    { x: 3800, y: 2400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4050, y: 2250, w: 55, h: 55, kind: 'tree_pine' },
    { x: 4400, y: 2450, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4700, y: 2350, w: 55, h: 55, kind: 'tree_pine' },
    { x: 4700, y: 3000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4800, y: 3300, w: 55, h: 55, kind: 'tree_pine' },
    { x: 4750, y: 3700, w: 65, h: 65, kind: 'tree_oak' },

    // Stenar
    { x: 2300, y: 3100, w: 80, h: 60, kind: 'rock_large' },
    { x: 2600, y: 3400, w: 50, h: 40, kind: 'rock_small' },
    { x: 3300, y: 3100, w: 70, h: 50, kind: 'rock_large' },
    { x: 4100, y: 3300, w: 50, h: 40, kind: 'rock_small' },
    { x: 3900, y: 2600, w: 60, h: 45, kind: 'rock_small' },
    { x: 4400, y: 3000, w: 80, h: 60, kind: 'rock_large' },

    { x: 2700, y: 3250, w: 30, h: 30, kind: 'tree_stump' },
    { x: 3100, y: 3700, w: 30, h: 30, kind: 'tree_stump' },
    { x: 3900, y: 3500, w: 30, h: 30, kind: 'tree_stump' },

    // Cabin 1: Jägar-stugan walls
    { x: 3450, y: 2750, w: 220, h: 12, kind: 'cabin_wall_wood' },
    { x: 3450, y: 2918, w: 90,  h: 12, kind: 'cabin_wall_wood' },
    { x: 3590, y: 2918, w: 80,  h: 12, kind: 'cabin_wall_wood' },
    { x: 3450, y: 2750, w: 12,  h: 180, kind: 'cabin_wall_wood' },
    { x: 3658, y: 2750, w: 12,  h: 180, kind: 'cabin_wall_wood' },

    // ========================================================================
    // === NE SCRAP-YARD (5000-8000, 2000-4000) ===
    // ========================================================================
    // (Containrar konverteras nu till "container-cabins" — du kan gå IN i dem,
    //  taket försvinner när du är inne, och varje har garanterad loot.
    //  Se containerCabins-arrayen nedan.)

    { x: 5800, y: 3100, w: 130, h: 70, kind: 'burning_car' },
    { x: 6300, y: 3300, w: 130, h: 70, kind: 'burning_car' },
    { x: 7000, y: 3200, w: 200, h: 90, kind: 'burning_truck' },
    { x: 5500, y: 3500, w: 110, h: 60, kind: 'car_wreck' },
    { x: 6800, y: 3700, w: 110, h: 60, kind: 'car_wreck' },
    { x: 7400, y: 2800, w: 110, h: 60, kind: 'car_wreck' },

    { x: 6000, y: 2700, w: 120, h: 90, kind: 'excavator_wreck' },

    { x: 7660, y: 2186, w: 50, h: 98, kind: 'hunting_tower' },

    { x: 5700, y: 2350, w: 32, h: 32, kind: 'oil_drum' },
    { x: 5700, y: 2600, w: 32, h: 32, kind: 'oil_drum' },
    { x: 6400, y: 2950, w: 28, h: 28, kind: 'fire_drum' },
    { x: 7200, y: 3400, w: 28, h: 28, kind: 'fire_drum' },
    { x: 6700, y: 2400, w: 32, h: 32, kind: 'oil_drum' },

    { x: 5400, y: 3000, w: 70, h: 50, kind: 'debris' },
    { x: 6200, y: 2900, w: 60, h: 45, kind: 'debris' },
    { x: 6900, y: 2600, w: 65, h: 50, kind: 'debris' },
    { x: 7500, y: 3100, w: 70, h: 50, kind: 'debris' },

    { x: 6600, y: 3000, w: 130, h: 70, kind: 'truck' },

    { x: 5000, y: 2200, w: 55, h: 55, kind: 'tree_pine' },
    { x: 5050, y: 2800, w: 50, h: 50, kind: 'tree_pine' },
    { x: 5000, y: 3500, w: 55, h: 55, kind: 'tree_oak' },
    { x: 7900, y: 3200, w: 50, h: 50, kind: 'tree_pine' },

    { x: 5700, y: 3800, w: 80, h: 60, kind: 'rock_large' },
    { x: 7100, y: 2200, w: 70, h: 50, kind: 'rock_large' },

    // ========================================================================
    // === CENTRAL VILLAGE (4000-6500, 4000-6500) ===
    // ========================================================================
    { x: 4750, y: 4650, w: 240, h: 12, kind: 'cabin_wall_wood' },
    { x: 4750, y: 4838, w: 240, h: 12, kind: 'cabin_wall_wood' },
    { x: 4750, y: 4650, w: 12,  h: 200, kind: 'cabin_wall_wood' },
    { x: 4978, y: 4650, w: 12,  h: 80,  kind: 'cabin_wall_wood' },
    { x: 4978, y: 4780, w: 12,  h: 70,  kind: 'cabin_wall_wood' },

    { x: 5700, y: 4700, w: 260, h: 12, kind: 'cabin_wall_wood' },
    { x: 5700, y: 4908, w: 260, h: 12, kind: 'cabin_wall_wood' },
    { x: 5700, y: 4700, w: 12,  h: 110, kind: 'cabin_wall_wood' },
    { x: 5700, y: 4860, w: 12,  h: 60,  kind: 'cabin_wall_wood' },
    { x: 5948, y: 4700, w: 12,  h: 220, kind: 'cabin_wall_wood' },

    { x: 5200, y: 5700, w: 120, h: 12, kind: 'cabin_wall_wood' },
    { x: 5380, y: 5700, w: 100, h: 12, kind: 'cabin_wall_wood' },
    { x: 5200, y: 5908, w: 280, h: 12, kind: 'cabin_wall_wood' },
    { x: 5200, y: 5700, w: 12,  h: 220, kind: 'cabin_wall_wood' },
    { x: 5468, y: 5700, w: 12,  h: 220, kind: 'cabin_wall_wood' },

    { x: 5380, y: 5180, w: 50, h: 50, kind: 'well' },

    { x: 5550, y: 5400, w: 80, h: 80, kind: 'haystack' },
    { x: 5650, y: 5500, w: 60, h: 60, kind: 'haystack' },

    { x: 4900, y: 5500, w: 70, h: 30, kind: 'woodpile' },
    { x: 6000, y: 5550, w: 70, h: 30, kind: 'woodpile' },

    { x: 4400, y: 4500, w: 200, h: 18, kind: 'stone_wall_low' },
    { x: 6200, y: 4500, w: 200, h: 18, kind: 'stone_wall_low' },
    { x: 4400, y: 6480, w: 200, h: 18, kind: 'stone_wall_low' },
    { x: 6200, y: 6480, w: 200, h: 18, kind: 'stone_wall_low' },
    { x: 5100, y: 4700, w: 18, h: 100, kind: 'stone_wall_low' },
    { x: 5550, y: 4900, w: 100, h: 18, kind: 'stone_wall_low' },
    { x: 5050, y: 5100, w: 18, h: 80,  kind: 'stone_wall_low' },

    { x: 6000, y: 5400, w: 120, h: 12, kind: 'wooden_fence' },
    { x: 6000, y: 5400, w: 12,  h: 100, kind: 'wooden_fence' },
    { x: 6108, y: 5400, w: 12,  h: 100, kind: 'wooden_fence' },
    { x: 6000, y: 5490, w: 120, h: 12, kind: 'wooden_fence' },

    { x: 6201, y: 5686, w: 58, h: 77, kind: 'chicken_coop' },

    { x: 4700, y: 5000, w: 65, h: 65, kind: 'tree_oak' },
    { x: 6100, y: 5000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 5500, y: 6200, w: 70, h: 70, kind: 'tree_oak' },
    { x: 5700, y: 6300, w: 55, h: 55, kind: 'tree_pine' },

    { x: 5000, y: 5400, w: 70, h: 35, kind: 'picnic_table' },

    { x: 6310, y: 4598, w: 41, h: 40, kind: 'dumpster_fire' },

    // ========================================================================
    // === EAST CAMPING (6500-8000, 4000-6500) ===
    // ========================================================================
    { x: 6700, y: 4400, w: 80,  h: 70, kind: 'tent', color: 'red' },
    { x: 7100, y: 4700, w: 80,  h: 70, kind: 'tent', color: 'blue' },
    { x: 7500, y: 5000, w: 80,  h: 70, kind: 'tent', color: 'green' },
    { x: 6900, y: 5200, w: 80,  h: 70, kind: 'tent', color: 'orange' },

    { x: 6900, y: 4700, w: 50, h: 50, kind: 'campfire' },
    { x: 7300, y: 5300, w: 50, h: 50, kind: 'campfire' },

    { x: 7400, y: 4200, w: 150, h: 80, kind: 'burning_caravan' },
    { x: 6700, y: 6200, w: 150, h: 80, kind: 'burning_caravan' },

    { x: 7000, y: 6000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 6900, y: 5650, w: 130, h: 70, kind: 'truck' },

    { x: 6800, y: 5650, w: 240, h: 12, kind: 'cabin_wall_wood' },
    { x: 6800, y: 5838, w: 100, h: 12, kind: 'cabin_wall_wood' },
    { x: 6950, y: 5838, w: 90,  h: 12, kind: 'cabin_wall_wood' },
    { x: 6800, y: 5650, w: 12,  h: 200, kind: 'cabin_wall_wood' },
    { x: 7028, y: 5650, w: 12,  h: 200, kind: 'cabin_wall_wood' },

    { x: 6550, y: 4200, w: 60, h: 60, kind: 'tree_pine' },
    { x: 6600, y: 6000, w: 65, h: 65, kind: 'tree_pine' },
    { x: 7800, y: 4300, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7800, y: 5800, w: 65, h: 65, kind: 'tree_pine' },
    { x: 7200, y: 6400, w: 60, h: 60, kind: 'tree_oak' },

    { x: 6600, y: 5500, w: 70, h: 50, kind: 'rock_large' },
    { x: 7700, y: 5500, w: 50, h: 40, kind: 'rock_small' },

    // (stairwell_door borttagen — såg ut som dörr men var bara cover, förvirrande)

    // (container vid 7500,6100 konverterad till container-cabin — se nedan)

    { x: 7650, y: 4700, w: 32, h: 32, kind: 'oil_drum' },
    { x: 6800, y: 6400, w: 28, h: 28, kind: 'fire_drum' },

    // ========================================================================
    // === WEST LAKE (2000-4500, 5000-7500) ===
    // ========================================================================
    { x: 3100, y: 5650, w: 260, h: 12, kind: 'cabin_wall_wood' },
    { x: 3100, y: 5838, w: 260, h: 12, kind: 'cabin_wall_wood' },
    { x: 3100, y: 5650, w: 12,  h: 200, kind: 'cabin_wall_wood' },
    { x: 3348, y: 5650, w: 12,  h: 100, kind: 'cabin_wall_wood' },
    { x: 3348, y: 5805, w: 12,  h: 45,  kind: 'cabin_wall_wood' },

    // Båt på STRAND (utanför sjön, sydlig sida)
    { x: 2500, y: 7280, w: 110, h: 50, kind: 'boat' },

    // === 4-VÄGS BRO — flyttad till decorations (passabel, blockerar inte movement)

    // === MOUNTAIN MASSIV (vattenfall faller genom kanal i mitten) ===
    // Stora cliff-block ger bergets HÖJD och mass (ser ut som klippvägg uppifrån).
    // Små rocks på toppen ger detalj och bryter upp den fyrkantiga konturen.
    // Vattenfallet faller i 130px-bred kanal (x=2870..3000) mellan klipporna.
    //
    // VÄNSTER bergmassiv (huvudblock + topp-rocks)
    // Topp-rocks som bryter upp övre kanten (ser ut som klippspetsar)
    { x: 2383, y: 6420, w: 75, h: 60, kind: 'mountain_peak' },
    { x: 2493, y: 6405, w: 85, h: 70, kind: 'mountain_peak' },
    { x: 2603, y: 6415, w: 80, h: 65, kind: 'mountain_peak' },
    { x: 2703, y: 6435, w: 75, h: 60, kind: 'mountain_peak' },
    { x: 2783, y: 6450, w: 70, h: 55, kind: 'mountain_peak' },
    // HÖGER bergmassiv
    { x: 3003, y: 6450, w: 75, h: 55, kind: 'mountain_peak' },
    { x: 3093, y: 6420, w: 85, h: 70, kind: 'mountain_peak' },
    { x: 3193, y: 6405, w: 80, h: 65, kind: 'mountain_peak' },
    { x: 3293, y: 6415, w: 75, h: 60, kind: 'mountain_peak' },
    { x: 3383, y: 6430, w: 80, h: 65, kind: 'mountain_peak' },
    // Detalj-stenar längs vattenfalls-kanalens kanter (där vattnet rinner mellan dem)
    { x: 2820, y: 6450, w: 45, h: 35, kind: 'rock_small' },
    { x: 2830, y: 6540, w: 40, h: 30, kind: 'rock_small' },
    { x: 2825, y: 6620, w: 45, h: 35, kind: 'rock_small' },
    { x: 3010, y: 6440, w: 45, h: 35, kind: 'rock_small' },
    { x: 3005, y: 6530, w: 40, h: 30, kind: 'rock_small' },
    { x: 3010, y: 6615, w: 45, h: 35, kind: 'rock_small' },
    // Bas-stenar precis ovanför vattenytan — vattnet rinner mellan/över dem
    { x: 2790, y: 6705, w: 55, h: 38, kind: 'rock_small' },
    { x: 2860, y: 6720, w: 50, h: 35, kind: 'rock_small' },
    { x: 2920, y: 6725, w: 55, h: 38, kind: 'rock_small' },
    { x: 2985, y: 6720, w: 50, h: 35, kind: 'rock_small' },
    { x: 3045, y: 6705, w: 55, h: 38, kind: 'rock_small' },

    // === LAKE_WATER_BLOCK — 9 små block (~200×200) som approximerar sjö-polygon.
    // GAPS för bron: horisontell vid y=6935 (28px), vertikal vid x=2935 (28px).
    // Top-row (y=6700-6900) — UNDER vattenfallet, kort så water-block hindrar inte falling
    { x: 2680, y: 6700, w: 220, h: 230, kind: 'lake_water_block', passThroughBullets: true }, // top-west
    { x: 2960, y: 6700, w: 220, h: 230, kind: 'lake_water_block', passThroughBullets: true }, // top-east (gap för vertikal-bro)
    // Mid-row (y=6970-7100) — efter horisontal-bron
    { x: 2660, y: 6970, w: 220, h: 130, kind: 'lake_water_block', passThroughBullets: true },
    { x: 2960, y: 6970, w: 220, h: 130, kind: 'lake_water_block', passThroughBullets: true },
    // Bottom-row (y=7100-7220)
    { x: 2690, y: 7100, w: 220, h: 120, kind: 'lake_water_block', passThroughBullets: true },
    { x: 2960, y: 7100, w: 220, h: 120, kind: 'lake_water_block', passThroughBullets: true },

    { x: 2300, y: 5200, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2700, y: 5100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 3700, y: 5200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 4100, y: 5300, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2300, y: 7300, w: 60, h: 60, kind: 'tree_pine' },
    { x: 2700, y: 7300, w: 55, h: 55, kind: 'tree_oak' },
    // (tree_pine vid 3100,7200 borttagen — låg inne i sjön)
    { x: 3700, y: 7100, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4100, y: 7200, w: 60, h: 60, kind: 'tree_pine' },

    { x: 3900, y: 6400, w: 80, h: 60, kind: 'rock_large' },
    // (rock_large vid 2400,6700 borttagen — låg inne i sjön)

    { x: 3000, y: 7400, w: 30, h: 30, kind: 'tree_stump' },
    { x: 3800, y: 7500, w: 30, h: 30, kind: 'tree_stump' },

    { x: 3000, y: 5870, w: 70, h: 30, kind: 'woodpile' },

    { x: 2100, y: 6400, w: 80, h: 80, kind: 'cabin_wall_wood' },

    // ========================================================================
    // === SOUTH WILD (4500-8000, 6500-8000) ===
    // ========================================================================
    { x: 6150, y: 7250, w: 80,  h: 12, kind: 'cabin_wall_wood' },
    { x: 6275, y: 7250, w: 75,  h: 12, kind: 'cabin_wall_wood' },
    { x: 6150, y: 7418, w: 200, h: 12, kind: 'cabin_wall_wood' },
    { x: 6150, y: 7250, w: 12,  h: 180, kind: 'cabin_wall_wood' },
    { x: 6338, y: 7250, w: 12,  h: 180, kind: 'cabin_wall_wood' },

    // (tree_oak vid 4700,6700 + tree_pine vid 4700,7100 borttagna — kollade på kyrkogården)
    { x: 5000, y: 6800, w: 60, h: 60, kind: 'tree_pine' },
    { x: 5300, y: 6700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 5700, y: 6900, w: 70, h: 70, kind: 'tree_pine' },
    { x: 6000, y: 6750, w: 60, h: 60, kind: 'tree_oak' },
    { x: 6500, y: 6800, w: 65, h: 65, kind: 'tree_pine' },
    { x: 6800, y: 6900, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7200, y: 6750, w: 70, h: 70, kind: 'tree_pine' },
    { x: 7600, y: 6900, w: 65, h: 65, kind: 'tree_oak' },
    { x: 5100, y: 7200, w: 70, h: 70, kind: 'tree_oak' },
    { x: 5500, y: 7100, w: 60, h: 60, kind: 'tree_pine' },
    { x: 6500, y: 7200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 6900, y: 7300, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7300, y: 7200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 7700, y: 7400, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4800, y: 7500, w: 70, h: 70, kind: 'tree_oak' },
    { x: 5200, y: 7600, w: 60, h: 60, kind: 'tree_pine' },
    { x: 5700, y: 7500, w: 65, h: 65, kind: 'tree_oak' },
    { x: 6500, y: 7700, w: 70, h: 70, kind: 'tree_pine' },
    { x: 6900, y: 7650, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7300, y: 7700, w: 65, h: 65, kind: 'tree_pine' },
    { x: 7700, y: 7650, w: 60, h: 60, kind: 'tree_oak' },

    { x: 5300, y: 6900, w: 90, h: 70, kind: 'rock_large' },
    { x: 6000, y: 7500, w: 80, h: 60, kind: 'rock_large' },
    { x: 7500, y: 7100, w: 90, h: 70, kind: 'rock_large' },
    { x: 4900, y: 7800, w: 70, h: 50, kind: 'rock_small' },
    { x: 7100, y: 7800, w: 80, h: 60, kind: 'rock_large' },

    { x: 5400, y: 7400, w: 30, h: 30, kind: 'tree_stump' },
    { x: 6600, y: 7000, w: 30, h: 30, kind: 'tree_stump' },
    { x: 7400, y: 7500, w: 30, h: 30, kind: 'tree_stump' },

    { x: 6700, y: 7500, w: 50, h: 50, kind: 'campfire' },

    { x: 5000, y: 7300, w: 130, h: 70, kind: 'car_wreck' },

    // ========================================================================
    // === 6 STORA LANDMARKS — ger kartan personlighet ===
    // ========================================================================

    // 1. KRASCHAT PASSAGERARFLYGPLAN (i NE scrap-yard, gigantiskt vrak)
    //    Bestående av: fuselage (huvuddelen), vingar (sub-walls), motor (eld), stjärt
    { x: 6820, y: 1498, w: 360, h: 93, kind: 'plane_fuselage' }, // huvuddel
    { x: 6770, y: 1330, w: 221, h: 90, kind: 'plane_wing' },     // vänster vinge
    { x: 7120, y: 1600, w: 221, h: 90, kind: 'plane_wing' },     // höger vinge
    { x: 7164, y: 1468, w: 32,  h: 74, kind: 'plane_tail' },     // stjärt
    { x: 6700, y: 1530, w: 30,  h: 30, kind: 'fire_drum' },      // motor brinner
    { x: 7250, y: 1530, w: 30,  h: 30, kind: 'fire_drum' },      // motor brinner

    // 2. ÖDEKYRKA + DEDIKERAD KYRKOGÅRD (separerat område med JORD-bas)
    { x: 4504, y: 6399, w: 241, h: 322, kind: 'church_ruin' },
    // Trä-staket runt kyrkogården — flyttat YTTERLIGARE ner (y=6970+) så det
    // finns ett rent gap mellan kyrkan (slut y=6720) och gravplatsen (start y=6970).
    { x: 4380, y: 6970, w: 90,  h: 12, kind: 'wooden_fence' },   // top-left (gap mot kyrkan i mitten)
    { x: 4660, y: 6970, w: 220, h: 12, kind: 'wooden_fence' },   // top-right (efter gap)
    { x: 4380, y: 7270, w: 500, h: 12, kind: 'wooden_fence' },   // bottom
    { x: 4380, y: 6970, w: 12,  h: 312, kind: 'wooden_fence' },  // left
    { x: 4868, y: 6970, w: 12,  h: 312, kind: 'wooden_fence' },  // right
    // Gravstenar i 3×4 RUTNÄT, EXPLICIT unika namn + årtal per sten
    // Row 1 (y=7020)
    { x: 4446, y: 7022, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'BJÖRN', graveBirth: 1872, graveDeath: 1934 },
    { x: 4546, y: 7022, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'ASTRID', graveBirth: 1885, graveDeath: 1952 },
    { x: 4666, y: 7022, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'SVEN', graveBirth: 1860, graveDeath: 1921 },
    { x: 4786, y: 7022, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'INGA', graveBirth: 1891, graveDeath: 1968 },
    // Row 2 (y=7120)
    { x: 4446, y: 7122, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'OLAF', graveBirth: 1870, graveDeath: 1942 },
    { x: 4546, y: 7122, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'GUDRUN', graveBirth: 1903, graveDeath: 1976 },
    { x: 4666, y: 7122, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'ERIK', graveBirth: 1865, graveDeath: 1930 },
    { x: 4786, y: 7122, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'HELGA', graveBirth: 1888, graveDeath: 1960 },
    // Row 3 (y=7220)
    { x: 4446, y: 7222, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'LARS', graveBirth: 1876, graveDeath: 1948 },
    { x: 4546, y: 7222, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'SIGRID', graveBirth: 1899, graveDeath: 1971 },
    { x: 4666, y: 7222, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'MAGNUS', graveBirth: 1882, graveDeath: 1959 },
    { x: 4786, y: 7222, w: 22, h: 32, kind: 'cemetery_gravestone', graveName: 'EBBA', graveBirth: 1894, graveDeath: 1972 },

    // 3. VATTENFALLS från klippa till sjön (decoration handled separately)
    //    Klipp-vall som omger:
    { x: 1750, y: 6200, w: 220, h: 50, kind: 'cliff_edge' },    // klippkant
    { x: 1700, y: 6250, w: 40,  h: 100, kind: 'cliff_edge' },
    { x: 1970, y: 6250, w: 40,  h: 100, kind: 'cliff_edge' },

    // 4. STENCIRKEL / FORNTIDA ALTARE (i NW deep forest, mystiskt)
    { x: 3850, y: 3000, w: 60, h: 60, kind: 'standing_stone' },
    { x: 3970, y: 2960, w: 60, h: 60, kind: 'standing_stone' },
    { x: 4060, y: 3050, w: 60, h: 60, kind: 'standing_stone' },
    { x: 4030, y: 3170, w: 60, h: 60, kind: 'standing_stone' },
    { x: 3920, y: 3210, w: 60, h: 60, kind: 'standing_stone' },
    { x: 3810, y: 3140, w: 60, h: 60, kind: 'standing_stone' },
    { x: 3950, y: 3080, w: 50, h: 50, kind: 'altar_stone' },  // centrum

    // 5. PUMP-JACK OLJERIGG (i scrap-yard, animerad pump-arm)
    { x: 5408, y: 2216, w: 122, h: 66, kind: 'pump_jack' },

    // 6. FYRTORN PÅ KULLE (i south wild, tall landmark)
    { x: 7818, y: 7878, w: 52, h: 133, kind: 'lighthouse' },

    // ========================================================================
    // === STUGA-UTSIDAN DETALJER (bänk + blomkruka utanför varje stuga) ===
    // ========================================================================
    // Jägar-stugan (south door at 1450+90, 920)
    { x: 3490, y: 2960, w: 36, h: 18, kind: 'wooden_bench' },
    { x: 3590, y: 2960, w: 18, h: 18, kind: 'flower_pot' },
    { x: 3380, y: 2940, w: 50, h: 24, kind: 'woodpile' },
    // Röda stugan (east door)
    { x: 3010, y: 2730, w: 18, h: 18, kind: 'flower_pot' },
    { x: 3010, y: 2790, w: 18, h: 18, kind: 'flower_pot' },
    // Gula stugan (west door)
    { x: 3660, y: 2810, w: 36, h: 18, kind: 'wooden_bench' },
    { x: 3660, y: 2780, w: 18, h: 18, kind: 'flower_pot' },
    // Ladan (north door) — vedstapel utanför
    { x: 5290, y: 5650, w: 70, h: 30, kind: 'woodpile' },
    // Camp-admin (south door)
    { x: 6830, y: 5860, w: 36, h: 18, kind: 'wooden_bench' },
    { x: 6960, y: 5860, w: 18, h: 18, kind: 'flower_pot' },
    // Sommarstugan (east door)
    { x: 3370, y: 3760, w: 36, h: 18, kind: 'wooden_bench' },
    { x: 3370, y: 3700, w: 18, h: 18, kind: 'flower_pot' },
    // Hunter-lyan (north door)
    { x: 6190, y: 7220, w: 50, h: 24, kind: 'woodpile' },
    { x: 6300, y: 7220, w: 18, h: 18, kind: 'flower_pot' },

    // === ÖVRIGA NYA KÄNNINGAR ===
    // Övergiven varuvagn (på en stig i NW)
    { x: 2900, y: 4200, w: 100, h: 50, kind: 'wagon_cart' },
    // En STOR (gigant) ek som dominanslandmark mitt i NW forest
    { x: 2500, y: 2700, w: 120, h: 120, kind: 'tree_giant_oak' },
    { x: 7000, y: 6000, w: 110, h: 110, kind: 'tree_giant_oak' },
    // Runsten i south wild
    { x: 5800, y: 6400, w: 40, h: 60, kind: 'rune_stone' },
    { x: 3300, y: 7800, w: 40, h: 60, kind: 'rune_stone' },
  ],

  decorations: [
    // (Skogsgolv ritas nu seamless via drawBrForestFloor() i klienten — inga
    //  patches här eftersom det skapade fula raka kanter mellan tints.)

    // === BYNS GRÄSPLÄNN ===
    { kind: 'grass_open', x: 4400, y: 4400, w: 2100, h: 2100 },

    // === STIGAR (slingrar mellan zoner) ===
    { kind: 'dirt_path', x: 2800, y: 4000, x2: 4400, y2: 4400, w: 35 },
    { kind: 'dirt_path', x: 4400, y: 4400, x2: 5000, y2: 5000, w: 35 },
    { kind: 'dirt_path', x: 6500, y: 5000, x2: 7000, y2: 5300, w: 35 },
    { kind: 'dirt_path', x: 4400, y: 5500, x2: 3400, y2: 5700, w: 35 },
    { kind: 'dirt_path', x: 5500, y: 6500, x2: 6200, y2: 7300, w: 35 },
    { kind: 'dirt_path', x: 2500, y: 2800, x2: 3450, y2: 2900, w: 30 },
    { kind: 'dirt_path', x: 1000, y: 5000, x2: 2200, y2: 5500, w: 30 }, // outer-w to lake
    { kind: 'dirt_path', x: 1500, y: 2000, x2: 2400, y2: 2700, w: 30 }, // outer-nw to forest

    // === SJÖN — krympt YTTERLIGARE till ~500×500, rund form ===
    // Center (2950, 6950). Klipp + vattenfall NORR om sjön smelter ihop.
    { kind: 'lake_water_polygon', points: [
      [2750, 6700], [2900, 6680], [3050, 6700], [3180, 6780],
      [3220, 6900], [3200, 7050], [3120, 7170], [2980, 7220],
      [2820, 7210], [2700, 7130], [2650, 7000], [2680, 6850]
    ] },
    { kind: 'stream',     x: 3900, y: 6250, x2: 4400, y2: 6000, w: 22 },
    { kind: 'stream',     x: 4400, y: 6000, x2: 5000, y2: 5700, w: 22 },

    // === FALLNA STOCKAR — mindre & fler (50-65px = realistic-träd-rester) ===
    // NW Forest
    { kind: 'fallen_log', x: 2500, y: 3500, w: 55, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 3700, y: 3100, w: 60, h: 14, rot: -0.4 },
    { kind: 'fallen_log', x: 4200, y: 2600, w: 50, h: 14, rot: 0.2 },
    { kind: 'fallen_log', x: 2800, y: 2400, w: 55, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 3200, y: 2900, w: 50, h: 14, rot: 0.4 },
    { kind: 'fallen_log', x: 4500, y: 3400, w: 58, h: 14, rot: -0.3 },
    { kind: 'fallen_log', x: 2300, y: 3800, w: 52, h: 14, rot: 0.1 },
    // South Wild
    { kind: 'fallen_log', x: 5200, y: 6900, w: 55, h: 14, rot: 0.5 },
    { kind: 'fallen_log', x: 6400, y: 7500, w: 60, h: 14, rot: -0.3 },
    { kind: 'fallen_log', x: 7200, y: 7600, w: 50, h: 14, rot: 0.4 },
    { kind: 'fallen_log', x: 4800, y: 7200, w: 55, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 5800, y: 7700, w: 58, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 6900, y: 6800, w: 50, h: 14, rot: -0.4 },
    // West outer
    { kind: 'fallen_log', x: 1500, y: 4500, w: 55, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 800,  y: 3600, w: 50, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 1200, y: 5800, w: 60, h: 14, rot: 0.4 },
    { kind: 'fallen_log', x: 600,  y: 6800, w: 52, h: 14, rot: -0.3 },
    // East outer
    { kind: 'fallen_log', x: 8800, y: 5500, w: 55, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 9100, y: 3500, w: 50, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 8600, y: 7000, w: 58, h: 14, rot: -0.4 },
    { kind: 'fallen_log', x: 9200, y: 6300, w: 52, h: 14, rot: 0.2 },
    // North outer
    { kind: 'fallen_log', x: 2500, y: 800,  w: 55, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 5500, y: 1200, w: 50, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 7500, y: 900,  w: 58, h: 14, rot: 0.4 },
    { kind: 'fallen_log', x: 4200, y: 600,  w: 52, h: 14, rot: -0.3 },
    // South outer
    { kind: 'fallen_log', x: 4000, y: 9100, w: 55, h: 14, rot: 0.4 },
    { kind: 'fallen_log', x: 2000, y: 9200, w: 50, h: 14, rot: -0.2 },
    { kind: 'fallen_log', x: 6500, y: 9300, w: 58, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 8000, y: 9100, w: 52, h: 14, rot: -0.4 },
    // Camping + village edges
    { kind: 'fallen_log', x: 6300, y: 4400, w: 50, h: 14, rot: 0.3 },
    { kind: 'fallen_log', x: 5800, y: 5800, w: 55, h: 14, rot: -0.2 },

    // === BLOMMOR ===
    { kind: 'flowers', x: 2450, y: 3000, count: 8 },
    { kind: 'flowers', x: 2900, y: 3800, count: 6 },
    { kind: 'flowers', x: 3600, y: 3400, count: 10 },
    { kind: 'flowers', x: 4400, y: 3600, count: 7 },
    { kind: 'flowers', x: 5000, y: 5400, count: 8 },
    { kind: 'flowers', x: 5700, y: 5300, count: 6 },
    { kind: 'flowers', x: 3100, y: 6900, count: 9 },
    { kind: 'flowers', x: 5500, y: 6800, count: 7 },
    { kind: 'flowers', x: 1100, y: 4500, count: 6 }, // outer
    { kind: 'flowers', x: 8500, y: 5800, count: 7 }, // outer
    { kind: 'flowers', x: 4500, y: 9100, count: 6 }, // south outer

    // === SVAMPAR ===
    { kind: 'mushrooms', x: 2700, y: 3300, count: 5 },
    { kind: 'mushrooms', x: 3500, y: 3900, count: 6 },
    { kind: 'mushrooms', x: 6300, y: 7200, count: 5 },
    { kind: 'mushrooms', x: 7400, y: 7000, count: 4 },
    { kind: 'mushrooms', x: 1000, y: 3000, count: 4 }, // outer
    { kind: 'mushrooms', x: 9000, y: 4500, count: 5 }, // outer

    // === KOTTAR ===
    { kind: 'pine_cones', x: 3100, y: 2700, count: 7 },
    { kind: 'pine_cones', x: 2700, y: 3700, count: 5 },
    { kind: 'pine_cones', x: 6700, y: 7500, count: 6 },
    { kind: 'pine_cones', x: 800,  y: 6500, count: 5 }, // outer

    // === RÖK ===
    { kind: 'smoke', x: 5865, y: 3090, scale: 1.5, color: 'dark' },
    { kind: 'smoke', x: 6365, y: 3290, scale: 1.5, color: 'dark' },
    { kind: 'smoke', x: 7100, y: 3180, scale: 2.2, color: 'dark' },
    { kind: 'smoke', x: 7475, y: 4190, scale: 1.8, color: 'dark' },
    { kind: 'smoke', x: 6775, y: 6190, scale: 1.8, color: 'dark' },
    { kind: 'smoke', x: 6060, y: 2695, scale: 1.3, color: 'dark' },
    { kind: 'smoke', x: 6414, y: 2940, scale: 0.8, color: 'light' },
    { kind: 'smoke', x: 7214, y: 3390, scale: 0.8, color: 'light' },
    { kind: 'smoke', x: 6814, y: 6390, scale: 0.8, color: 'light' },
    { kind: 'smoke', x: 6925, y: 4725, scale: 0.9, color: 'light' },
    { kind: 'smoke', x: 7325, y: 5325, scale: 0.9, color: 'light' },
    { kind: 'smoke', x: 6725, y: 7525, scale: 0.9, color: 'light' },
    { kind: 'smoke', x: 6330, y: 4618, scale: 0.7, color: 'light' },

    // === VÄGSKYLT/TRÄSKYLT ===
    { kind: 'sign_wooden', x: 4400, y: 4700, w: 80, h: 30, text: 'BYN →', color: '#5a3a18' },
    { kind: 'sign_wooden', x: 6400, y: 4400, w: 80, h: 30, text: '← CAMP', color: '#3a5a8a' },
    { kind: 'sign_wooden', x: 3400, y: 5500, w: 80, h: 30, text: 'SJÖN', color: '#3a7aa0' },
    { kind: 'sign_wooden', x: 5000, y: 6600, w: 80, h: 30, text: 'WILD →', color: '#2a1a08' },
    { kind: 'sign_wooden', x: 2000, y: 4400, w: 80, h: 30, text: 'JÄGAR-STUGAN →', color: '#5a3a18' },
    { kind: 'sign_wooden', x: 5000, y: 2200, w: 80, h: 30, text: 'SCRAP-YARD ↑', color: '#3a1808' },

    // === GUNGDÄCK ===
    { kind: 'tire_swing', x: 5540, y: 6280 },

    // === TVÄTTLINOR ===
    { kind: 'clothes_line', x: 4900, y: 4900, x2: 5000, y2: 4950 },
    { kind: 'clothes_line', x: 3200, y: 5920, x2: 3300, y2: 5920 },

    // === BREVLÅDOR ===
    { kind: 'mailbox', x: 3430, y: 2950 },
    { kind: 'mailbox', x: 4730, y: 4780 },
    { kind: 'mailbox', x: 6780, y: 5700 },
    { kind: 'mailbox', x: 3380, y: 5760 },

    // === TRÄDGÅRDSLAND ===
    { kind: 'garden_patch', x: 6015, y: 5415, w: 90, h: 70 },

    // === LJUS LANTERS ===
    { kind: 'lantern', x: 3535, y: 2920, color: '#ff9030' },
    { kind: 'lantern', x: 4750, y: 4640, color: '#ff9030' },
    { kind: 'lantern', x: 5700, y: 4690, color: '#ff9030' },
    { kind: 'lantern', x: 5200, y: 5690, color: '#ff9030' },
    { kind: 'lantern', x: 6790, y: 5650, color: '#ff9030' },
    { kind: 'lantern', x: 3100, y: 5640, color: '#ff9030' },
    { kind: 'lantern', x: 6140, y: 7240, color: '#ff9030' },

    // === VASS ===
    { kind: 'reeds', x: 3000, y: 6250, w: 200 },
    { kind: 'reeds', x: 3500, y: 6350, w: 180 },
    { kind: 'reeds', x: 2600, y: 6400, w: 150 },

    // === NÄCKROSOR ===
    { kind: 'lily_pad', x: 2700, y: 6800 },
    { kind: 'lily_pad', x: 3200, y: 6700 },
    { kind: 'lily_pad', x: 3500, y: 7000 },
    { kind: 'lily_pad', x: 2900, y: 7100 },

    // === DJURSPÅR ===
    { kind: 'animal_track', x: 3300, y: 3600 },
    { kind: 'animal_track', x: 5300, y: 7400 },
    { kind: 'animal_track', x: 6400, y: 6800 },
    { kind: 'animal_track', x: 1200, y: 6000 }, // outer

    // === EXTRA OUTER DECORATIONS (v1.332) — utfyll alla 4 hörn ===
    // NW outer-decorations
    { kind: 'flowers', x: 600, y: 600, count: 7 },
    { kind: 'flowers', x: 1300, y: 900, count: 6 },
    { kind: 'flowers', x: 400, y: 1600, count: 8 },
    { kind: 'mushrooms', x: 800, y: 1200, count: 5 },
    { kind: 'mushrooms', x: 1500, y: 1500, count: 6 },
    { kind: 'pine_cones', x: 700, y: 350, count: 6 },
    { kind: 'pine_cones', x: 1100, y: 1300, count: 5 },
    { kind: 'bush', x: 1000, y: 500 },
    { kind: 'bush', x: 1700, y: 1100 },
    { kind: 'bush', x: 400, y: 1400 },
    { kind: 'animal_track', x: 900, y: 1600 },
    // NE outer-decorations
    { kind: 'flowers', x: 8500, y: 600, count: 7 },
    { kind: 'flowers', x: 9200, y: 1100, count: 6 },
    { kind: 'mushrooms', x: 8700, y: 1300, count: 5 },
    { kind: 'mushrooms', x: 9400, y: 1700, count: 5 },
    { kind: 'pine_cones', x: 8200, y: 1000, count: 6 },
    { kind: 'bush', x: 8400, y: 600 },
    { kind: 'bush', x: 9300, y: 1500 },
    { kind: 'animal_track', x: 9100, y: 1800 },
    // SW outer-decorations
    { kind: 'flowers', x: 600, y: 7800, count: 8 },
    { kind: 'flowers', x: 1400, y: 8500, count: 6 },
    { kind: 'flowers', x: 800, y: 9200, count: 7 },
    { kind: 'mushrooms', x: 1100, y: 8200, count: 5 },
    { kind: 'mushrooms', x: 1700, y: 9100, count: 6 },
    { kind: 'pine_cones', x: 500, y: 8400, count: 6 },
    { kind: 'pine_cones', x: 1300, y: 8800, count: 5 },
    { kind: 'bush', x: 400, y: 7900 },
    { kind: 'bush', x: 1100, y: 9000 },
    { kind: 'bush', x: 1800, y: 8400 },
    { kind: 'animal_track', x: 700, y: 8700 },
    // SE outer-decorations
    { kind: 'flowers', x: 8500, y: 7900, count: 7 },
    { kind: 'flowers', x: 9200, y: 8400, count: 6 },
    { kind: 'flowers', x: 8800, y: 9100, count: 8 },
    { kind: 'mushrooms', x: 9400, y: 8700, count: 5 },
    { kind: 'mushrooms', x: 8600, y: 8500, count: 6 },
    { kind: 'pine_cones', x: 9100, y: 8300, count: 6 },
    { kind: 'pine_cones', x: 8400, y: 9000, count: 5 },
    { kind: 'bush', x: 8700, y: 7800 },
    { kind: 'bush', x: 9300, y: 9000 },
    { kind: 'bush', x: 8900, y: 8700 },
    { kind: 'animal_track', x: 9200, y: 8600 },
    // Ring-decorations (mellan center och outer)
    { kind: 'flowers', x: 3000, y: 1600, count: 5 },
    { kind: 'flowers', x: 5000, y: 1600, count: 5 },
    { kind: 'flowers', x: 7000, y: 1600, count: 5 },
    { kind: 'flowers', x: 1900, y: 4500, count: 5 },
    { kind: 'flowers', x: 8200, y: 4500, count: 5 },
    { kind: 'flowers', x: 3500, y: 8500, count: 5 },
    { kind: 'flowers', x: 5500, y: 8500, count: 5 },
    { kind: 'flowers', x: 7500, y: 8500, count: 5 },
    { kind: 'mushrooms', x: 4500, y: 1800, count: 4 },
    { kind: 'mushrooms', x: 6500, y: 1800, count: 4 },
    { kind: 'mushrooms', x: 1900, y: 5800, count: 4 },
    { kind: 'mushrooms', x: 8200, y: 5800, count: 4 },

    // === BUSKAR ===
    { kind: 'bush', x: 2600, y: 3900 },
    { kind: 'bush', x: 3300, y: 4200 },
    { kind: 'bush', x: 4400, y: 3500 },
    { kind: 'bush', x: 5800, y: 6500 },
    { kind: 'bush', x: 7500, y: 6600 },
    { kind: 'bush', x: 4900, y: 7300 },
    { kind: 'bush', x: 1200, y: 3500 }, // outer
    { kind: 'bush', x: 9000, y: 4500 }, // outer
    { kind: 'bush', x: 7500, y: 9300 }, // outer
    { kind: 'bush', x: 2500, y: 9400 }, // outer

    // === CAUTION-TAPE ===
    { kind: 'caution_tape', x: 5300, y: 3900, w: 200, rot: 0 },
    { kind: 'caution_tape', x: 7500, y: 3900, w: 200, rot: 0 },

    // === GRAFFITI ===
    { kind: 'graffiti', x: 6000, y: 2600, text: 'NO RULES', color: '#ff3030', size: 30, rot: -0.1 },
    { kind: 'graffiti', x: 7200, y: 3700, text: 'BURN IT ALL', color: '#ff5a3a', size: 26, rot: 0.05 },
    { kind: 'graffiti', x: 5200, y: 4700, text: 'HOME', color: '#ffd54a', size: 28, rot: 0 },
    { kind: 'graffiti', x: 3300, y: 6400, text: 'PARADISE', color: '#3aff5a', size: 24, rot: -0.05 },
    { kind: 'graffiti', x: 6400, y: 7500, text: 'WILDLIFE', color: '#88ccff', size: 22, rot: 0.1 },
    { kind: 'graffiti', x: 1000, y: 5000, text: 'BEYOND', color: '#aa3aff', size: 28, rot: -0.05 }, // outer mystery
    { kind: 'graffiti', x: 9000, y: 5000, text: 'NO RETURN', color: '#5a5a5a', size: 30, rot: 0.05 }, // outer

    // === SKYLT-LANDMARK ===
    { kind: 'sign', x: 4900, y: 100, w: 200, h: 40, text: '☠ LAST HUNT ☠', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'sign', x: 200, y: 4900, w: 160, h: 26, text: 'FOREST', bg: '#1a2a08', fg: '#aaff7a', rot: -0.05 },
    { kind: 'sign', x: 8700, y: 3900, w: 160, h: 26, text: 'SCRAP', bg: '#3a1808', fg: '#ffaa30', rot: 0.05 },

    // === KYRKOGÅRDENS JORD-BAS (mörk-brun mark under gravarna) ===
    { kind: 'dirt_floor', x: 4380, y: 6975, w: 500, h: 305 },

    // === 4-VÄGS BRO som DECORATION (passabel — blockerar inte spelaren) ===
    { kind: 'bridge_deco', x: 2500, y: 6935, w: 920, h: 30 },
    { kind: 'bridge_deco', x: 2920, y: 6500, w: 30, h: 800 },

    // === SIGHTSEEING-DÄCK framför vattenfallet (avlång trä-platform) ===
    // Position: precis norr om sjön, söder om bergsfoten där folk kan se vattnet
    { kind: 'sightseeing_deck', x: 2540, y: 6640, w: 840, h: 32 },

    // === ALIEN-MARK i SE-hörnet (v1.371) — solid square 7900-10000 + 450px NW fade.
    // Bbox: 7450-10000 (utöver fade-zonen får renderaren förlita sig på solid-fill).
    { kind: 'alien_floor', x: 7450, y: 7450, w: 2550, h: 2550 },
    // alien_transition är nu no-op i renderaren (alien_floor gör allt).
    // Behåller entry för bakåtkompatibilitet med tidigare save-states.
    { kind: 'alien_transition', x: 5500, y: 5500, w: 5500, h: 5500 },

    // === ALIEN-MYSTIK decorations (crop circles, glödande svampar, märkliga spår) ===
    { kind: 'crop_circle', x: 8750, y: 9000 },
    { kind: 'crop_circle', x: 8400, y: 8400 },
    { kind: 'glow_mushrooms', x: 8200, y: 8800, count: 8 },
    { kind: 'glow_mushrooms', x: 9000, y: 9300, count: 7 },
    { kind: 'glow_mushrooms', x: 8500, y: 8100, count: 6 },
    { kind: 'alien_track', x: 8300, y: 8600 },
    { kind: 'alien_track', x: 8900, y: 8500 },
    { kind: 'alien_track', x: 9200, y: 9100 },
    // Spridd extra mystik (utanför alien-zonen)
    { kind: 'glow_mushrooms', x: 1500, y: 2700, count: 5 },
    { kind: 'glow_mushrooms', x: 6800, y: 6000, count: 4 },

    // === GLÄNTOR — ljusare öppningar i skogen där solljus tränger in ===
    { kind: 'glade', x: 1500, y: 5000, r: 180 },  // outer west glade
    { kind: 'glade', x: 8200, y: 5500, r: 200 },  // outer east glade
    { kind: 'glade', x: 3400, y: 2500, r: 160 },  // NW forest glade
    { kind: 'glade', x: 4300, y: 4100, r: 150 },  // village edge
    { kind: 'glade', x: 5500, y: 7000, r: 170 },  // south wild glade
    { kind: 'glade', x: 6700, y: 7600, r: 180 },  // south east glade
    { kind: 'glade', x: 2400, y: 4500, r: 140 },  // path glade
    { kind: 'glade', x: 7400, y: 4000, r: 150 },  // scrap edge glade

    // === VATTENFALL — vattnet sipprar fram mellan stenar på 3 nivåer
    // Tre cascades (smala) som ser ut som om vatten letar sig fram mellan stenarna
    { kind: 'waterfall', x: 2870, y: 6400, w: 50, h: 220 },
    { kind: 'waterfall', x: 2925, y: 6420, w: 55, h: 200 },
    { kind: 'waterfall', x: 2982, y: 6410, w: 45, h: 215 },
    // Splash-skum där vattnet landar i sjön (multipla för bredare splash-effekt)
    { kind: 'water_splash', x: 2890, y: 6735 },
    { kind: 'water_splash', x: 2935, y: 6735 },
    { kind: 'water_splash', x: 2980, y: 6735 },
    { kind: 'water_splash', x: 2910, y: 6760 },
    { kind: 'water_splash', x: 2960, y: 6760 },

    // === GROTTA ENTRANCE BAKOM vattenfallet (i klippan) ===
    { kind: 'cave_entrance', x: 2900, y: 6470, w: 80, h: 50 },

    // === SKORSTENS-RÖK från ALLA stugor (auto-spawnar ovan tak) ===
    { kind: 'smoke', x: 3604, y: 2756, scale: 0.8, color: 'light' }, // jägar
    { kind: 'smoke', x: 4920, y: 4656, scale: 0.8, color: 'light' }, // röda
    { kind: 'smoke', x: 5882, y: 4706, scale: 0.8, color: 'light' }, // gula
    { kind: 'smoke', x: 5392, y: 5706, scale: 0.8, color: 'light' }, // lada
    { kind: 'smoke', x: 6968, y: 5656, scale: 0.8, color: 'light' }, // camp
    { kind: 'smoke', x: 3282, y: 5656, scale: 0.8, color: 'light' }, // sommar
    { kind: 'smoke', x: 6290, y: 7256, scale: 0.8, color: 'light' }, // hunter

    // === RÖK från oljerigg + flygplan + fyrtorn ===
    { kind: 'smoke', x: 5470, y: 2200, scale: 1.4, color: 'dark' },  // pump_jack
    { kind: 'smoke', x: 6850, y: 1530, scale: 2.5, color: 'dark' },  // plane motor 1
    { kind: 'smoke', x: 7270, y: 1530, scale: 2.5, color: 'dark' },  // plane motor 2

    // === LJUS-STRÅLAR genom träden (light shafts — partiella diagonala) ===
    { kind: 'light_shaft', x: 2800, y: 3000, ang: 0.4, length: 180 },
    { kind: 'light_shaft', x: 4400, y: 3500, ang: -0.5, length: 200 },
    { kind: 'light_shaft', x: 6500, y: 7000, ang: 0.3, length: 220 },
    { kind: 'light_shaft', x: 7300, y: 6500, ang: -0.4, length: 200 },

    // === FALLNA LÖV (random färgklickar) ===
    { kind: 'fallen_leaves', x: 3000, y: 3500, count: 15 },
    { kind: 'fallen_leaves', x: 6500, y: 7000, count: 12 },
    { kind: 'fallen_leaves', x: 4500, y: 3700, count: 10 },
    { kind: 'fallen_leaves', x: 7200, y: 6200, count: 14 },
    { kind: 'fallen_leaves', x: 5500, y: 7400, count: 12 },

    // === MOSSIGA STENAR-LAGER (subtila mark-markings) ===
    { kind: 'moss_patch', x: 2600, y: 3100, w: 60, h: 40 },
    { kind: 'moss_patch', x: 4100, y: 3200, w: 50, h: 35 },
    { kind: 'moss_patch', x: 5500, y: 7100, w: 70, h: 45 },

    // === ÄLG-SKELETT (rare easter-egg i wild south) ===
    { kind: 'moose_skeleton', x: 7000, y: 7400 },
    { kind: 'moose_skeleton', x: 2800, y: 4600 },

    // === KOLDARE-STACK (rökigt) ===
    { kind: 'tar_pit', x: 6900, y: 1800, r: 50 },
    { kind: 'smoke', x: 6900, y: 1800, scale: 1.0, color: 'dark' },

    // === FÅGEL-FLOCK (decoration ovanpå) ===
    { kind: 'bird_flock', x: 5000, y: 1500 },
    { kind: 'bird_flock', x: 4500, y: 7800 },
  ],

  lootSpawns: [
    // OUTER WILDERNESS (12) — spread runt outer-ring
    { x: 700,  y: 700  }, { x: 1500, y: 1300 }, { x: 2300, y: 700 },
    { x: 5000, y: 800 }, { x: 7500, y: 700 }, { x: 9000, y: 1500 },
    { x: 9200, y: 4000 }, { x: 9200, y: 6500 }, { x: 1000, y: 4500 },
    { x: 1000, y: 7500 }, { x: 5000, y: 9200 }, { x: 8500, y: 9000 },
    // NW FOREST (16)
    { x: 2400, y: 2400 }, { x: 2700, y: 2600 }, { x: 3100, y: 2500 },
    { x: 3500, y: 2600 }, { x: 3900, y: 2500 }, { x: 4200, y: 2700 },
    { x: 2350, y: 3000 }, { x: 2800, y: 3200 }, { x: 3200, y: 3300 },
    { x: 3600, y: 3100 }, { x: 4000, y: 3200 }, { x: 4400, y: 3000 },
    { x: 2500, y: 3600 }, { x: 2900, y: 3700 }, { x: 3300, y: 3700 },
    { x: 3700, y: 3900 },
    // NE SCRAP-YARD (12)
    { x: 5200, y: 2300 }, { x: 5700, y: 2250 }, { x: 6200, y: 2200 },
    { x: 6700, y: 2350 }, { x: 7200, y: 2300 }, { x: 7700, y: 2400 },
    { x: 5400, y: 2800 }, { x: 6000, y: 3000 }, { x: 6400, y: 2800 },
    { x: 6900, y: 2700 }, { x: 7400, y: 2700 }, { x: 7500, y: 3200 },
    // CENTRAL VILLAGE (12)
    { x: 4500, y: 4600 }, { x: 4900, y: 4900 }, { x: 5300, y: 4700 },
    { x: 5700, y: 4950 }, { x: 6100, y: 4700 }, { x: 6400, y: 4900 },
    { x: 4600, y: 5300 }, { x: 5000, y: 5500 }, { x: 5500, y: 5200 },
    { x: 6000, y: 5300 }, { x: 6300, y: 5500 }, { x: 4700, y: 6200 },
    // EAST CAMPING (10)
    { x: 6600, y: 4200 }, { x: 7000, y: 4400 }, { x: 7400, y: 4500 },
    { x: 7700, y: 4700 }, { x: 6700, y: 4900 }, { x: 7200, y: 4900 },
    { x: 7600, y: 5200 }, { x: 6800, y: 5400 }, { x: 7300, y: 5700 },
    { x: 7700, y: 5900 },
    // WEST LAKE (10)
    { x: 2200, y: 5300 }, { x: 2600, y: 5500 }, { x: 3500, y: 5500 },
    { x: 4000, y: 5700 }, { x: 2800, y: 6000 }, { x: 3500, y: 6150 },
    { x: 4200, y: 6200 }, { x: 2400, y: 7000 }, { x: 3100, y: 7400 },
    { x: 4200, y: 7400 },
    // SOUTH WILD (8)
    { x: 4700, y: 6900 }, { x: 5300, y: 7000 }, { x: 5800, y: 6900 },
    { x: 6800, y: 7000 }, { x: 7400, y: 6900 }, { x: 5000, y: 7600 },
    { x: 6500, y: 7500 }, { x: 7200, y: 7700 },
    // EXTRA MEDKIT-spawns — spridda heals/shields över hela kartan (~30 st)
    // Procentuellt blir alla loot-tiers, men positionerna ger mer pickup-täthet
    // och eftersom common+uncommon-tier nu är hp-tunga → de flesta blir heals.
    { x: 1200, y: 2500 }, { x: 1800, y: 4500 }, { x: 1500, y: 6500 },
    { x: 1700, y: 8500 }, { x: 3500, y: 1500 }, { x: 5500, y: 1500 },
    { x: 8000, y: 1700 }, { x: 8500, y: 3500 }, { x: 8500, y: 5500 },
    { x: 8500, y: 7000 }, { x: 6800, y: 8800 }, { x: 3800, y: 8800 },
    { x: 2900, y: 3500 }, { x: 4600, y: 3700 }, { x: 6200, y: 3500 },
    { x: 5800, y: 5800 }, { x: 4400, y: 5700 }, { x: 3300, y: 4900 },
    { x: 7400, y: 5400 }, { x: 6900, y: 6500 }, { x: 5900, y: 6500 },
    { x: 4900, y: 6500 }, { x: 3500, y: 6800 }, { x: 7500, y: 8000 },
    { x: 2400, y: 7900 }, { x: 5500, y: 8400 }, { x: 6300, y: 4400 },
    { x: 4800, y: 4400 }, { x: 3700, y: 5200 }, { x: 5200, y: 3300 },
    // CENTER (legendary lock) — kyrkogården vid ödekyrkan (öppen mark, ingen wall)
    { x: 4700, y: 6700 },
  ],

  lootTiers: {
    common: 0.45,
    uncommon: 0.35,
    rare: 0.15,
    legendary: 0.05,
  },

  lootByTier: {
    // +20% vapen, +40% ammo (split ammo/granate 50/50 — granat ger +3 st)
    common: [
      { kind: 'hp_small',     weight: 48 },
      { kind: 'shield_small', weight: 25 },
      { kind: 'ammo',         weight: 7 },
      { kind: 'grenade',      weight: 7 },
      { kind: 'smoke',        weight: 6 },
      { kind: 'flashbang',    weight: 5 },
      { kind: 'weapon', weaponId: 'dualpistol',  weight: 7 },
      { kind: 'weapon', weaponId: 'smg',         weight: 6 },
    ],
    uncommon: [
      { kind: 'hp_small',                        weight: 20 },
      { kind: 'shield_small',                    weight: 14 },
      { kind: 'grenade',                         weight: 4 },
      { kind: 'smoke',                           weight: 4 },
      { kind: 'molotov',                         weight: 5 },
      { kind: 'gravity',                         weight: 4 },
      { kind: 'weapon', weaponId: 'smg',         weight: 18 },
      { kind: 'weapon', weaponId: 'autoshotgun', weight: 14 },
      { kind: 'weapon', weaponId: 'dualuzi',     weight: 12 },
      { kind: 'weapon', weaponId: 'lmg',         weight: 12 },
    ],
    rare: [
      { kind: 'hp_big',                          weight: 20 },
      { kind: 'shield_big',                      weight: 14 },
      { kind: 'weapon', weaponId: 'rifle',       weight: 20 },
      { kind: 'weapon', weaponId: 'shotgun',     weight: 16 },
      { kind: 'weapon', weaponId: 'flame',       weight: 13 },
      { kind: 'weapon', weaponId: 'ak',          weight: 12 },
      { kind: 'weapon', weaponId: 'grenade',     weight: 10 }, // granatgevär (lobb-AoE)
    ],
    legendary: [
      { kind: 'weapon', weaponId: 'minigun',    weight: 48 },
      { kind: 'weapon', weaponId: 'sniper',     weight: 30 },
      { kind: 'weapon', weaponId: 'rocket',     weight: 24 },
      { kind: 'hp_big',                         weight: 2 },
      { kind: 'shield_big',                     weight: 2 },
    ],
  },

  phases: [
    { name: 'LOOT',     durationFrac: 0.15, areaFrac: 1.00, outsideDmg: 0  },
    { name: 'SHRINK 1', durationFrac: 0.17, areaFrac: 0.60, outsideDmg: 4  }, // v1.698: 2→4 (storm dödade långsammare än fasen varar = ingen tidig press)
    { name: 'SHRINK 2', durationFrac: 0.17, areaFrac: 0.30, outsideDmg: 6  }, // v1.698: 4→6
    { name: 'SHRINK 3', durationFrac: 0.17, areaFrac: 0.10, outsideDmg: 8  },
    { name: 'FINAL',    durationFrac: 0.34, areaFrac: 0.05, outsideDmg: 15 },
  ],

  matchDurations: [600, 1200, 1800],
  defaultMatchDuration: 1200,
  matchDurationLabels: ['10 MIN', '20 MIN', '30 MIN'],

  startWeapon: 'pistol',
  startHp: 100,
  startShield: 200,
  maxHp: 100,
  maxShield: 200,
  lootPickupRadius: 50,   // V2: 32→50 — mer förlåtande "gå-över-för-att-plocka" (kändes oclaimbart)
};

// === CABIN-WALL PREPROCESSING ===
// För varje cabin: TA BORT alla manuellt-skrivna cabin_wall_wood-segments
// inom dess bounds, och REGENERERA väggarna med korrekta gaps för dörr OCH
// fönster. Fönster-walls får passThroughBullets-flagga så bullets passerar.
// Detta löser bug-v1.330 där bullets träffade gamla cabin-wall-segments
// SOM FORTFARANDE FANNS bakom fönster-walls.
function preprocessCabinWalls(arena) {
  if (arena._cabinWallsProcessed) return;
  arena._cabinWallsProcessed = true;
  const T = 12; // wall-tjocklek
  // Step 1: bygg en map över cabin-bounds + filtrera bort gamla cabin_wall_wood
  // som ligger inom någon cabins bbox (med 5px buffer).
  arena.walls = arena.walls.filter(w => {
    if (w.kind !== 'cabin_wall_wood') return true;
    for (const c of arena.cabins) {
      const b = c.bounds;
      if (w.x >= b.x - 6 && w.x + w.w <= b.x + b.w + 6 &&
          w.y >= b.y - 6 && w.y + w.h <= b.y + b.h + 6) {
        return false; // tillhör en cabin — ta bort, regenerera nedan
      }
    }
    return true; // fri-stående cabin_wall_wood (typ fiskestuga) — behåll
  });
  // Step 2: regenerera 4 sidor per cabin med korrekta gaps
  for (const cabin of arena.cabins) {
    const b = cabin.bounds;
    // Samla alla gaps per sida (dörrar + fönster)
    const gaps = { north: [], south: [], east: [], west: [] };
    if (cabin.door) {
      gaps[cabin.door.side].push({ offset: cabin.door.offset, width: cabin.door.width, type: 'door' });
    }
    if (cabin.windows) {
      for (const win of cabin.windows) {
        gaps[win.side].push({ offset: win.offset, width: win.width, type: 'window' });
      }
    }
    // För varje sida: sortera gaps och skapa wall-segments mellan dem
    for (const side of ['north', 'south', 'east', 'west']) {
      gaps[side].sort((a, b) => a.offset - b.offset);
      // Sidans bbox
      let sx, sy, isH, totalLen;
      if (side === 'north') { sx = b.x; sy = b.y; isH = true; totalLen = b.w; }
      else if (side === 'south') { sx = b.x; sy = b.y + b.h - T; isH = true; totalLen = b.w; }
      else if (side === 'east') { sx = b.x + b.w - T; sy = b.y; isH = false; totalLen = b.h; }
      else { sx = b.x; sy = b.y; isH = false; totalLen = b.h; }
      // Iterera och bygg wall-segments
      let cursor = 0;
      for (const g of gaps[side]) {
        // Wall-segment innan gap
        if (g.offset > cursor) {
          if (isH) {
            arena.walls.push({ x: sx + cursor, y: sy, w: g.offset - cursor, h: T, kind: 'cabin_wall_wood' });
          } else {
            arena.walls.push({ x: sx, y: sy + cursor, w: T, h: g.offset - cursor, kind: 'cabin_wall_wood' });
          }
        }
        // Fönster: lägg till cabin_window som BLOCKERAR movement men släpper igenom bullets
        if (g.type === 'window') {
          if (isH) {
            arena.walls.push({
              x: sx + g.offset, y: sy, w: g.width, h: T,
              kind: 'cabin_window', passThroughBullets: true, cabinId: cabin.id,
            });
          } else {
            arena.walls.push({
              x: sx, y: sy + g.offset, w: T, h: g.width,
              kind: 'cabin_window', passThroughBullets: true, cabinId: cabin.id,
            });
          }
        }
        // Door: ingen wall alls här (helt öppning)
        cursor = g.offset + g.width;
      }
      // Sista segment efter sista gap
      if (cursor < totalLen) {
        if (isH) {
          arena.walls.push({ x: sx + cursor, y: sy, w: totalLen - cursor, h: T, kind: 'cabin_wall_wood' });
        } else {
          arena.walls.push({ x: sx, y: sy + cursor, w: T, h: totalLen - cursor, kind: 'cabin_wall_wood' });
        }
      }
    }
  }
}

// === PROCEDURAL CONTENT GENERATION ===
// Spawnar extra träd/stenar/buskar med seedat slump-gen så de fördelas ORGANISKT
// över hela kartan utan ring-mönster. Anpassar density per biome-region.
function generateProceduralContent(arena) {
  if (arena._proceduralGenerated) return;
  arena._proceduralGenerated = true;
  // Seedat LCG (deterministic så samma karta varje gång)
  let _seed = 0xb16b00b5;
  const rng = () => {
    _seed = (_seed * 1664525 + 1013904223) >>> 0;
    return _seed / 0x100000000;
  };
  // Helper: checka om position kolliderar med någon existerande wall
  const tooClose = (x, y, minDist) => {
    for (const w of arena.walls) {
      const dx = x - (w.x + w.w / 2);
      const dy = y - (w.y + w.h / 2);
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  };
  const tooCloseToCabin = (x, y, buf) => {
    for (const c of arena.cabins) {
      const b = c.bounds;
      if (x > b.x - buf && x < b.x + b.w + buf && y > b.y - buf && y < b.y + b.h + buf) return true;
    }
    return false;
  };
  // Exklusions-zoner där procedural content INTE får spawna
  // Format: [xMin, xMax, yMin, yMax]
  const exclusionZones = [
    [2550, 3300, 6400, 7270],  // sjö + klippa + vattenfall (krympt)
    [4300, 4950, 6300, 7350],  // kyrkan + kyrkogården (utökad — inkl buffer)
    [5250, 7700, 2150, 3900],  // scrap-yard (containrar etc behöver sin yta)
    [7900, 10000, 7900, 10000],  // ALIEN-OMRÅDE (SE-hörnet) — matchar minimap-square
  ];
  // Försök spawna ett objekt — ger upp efter N försök om position upptaget
  const trySpawn = (xMin, xMax, yMin, yMax, minDist, cabinBuf, fn) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = xMin + rng() * (xMax - xMin);
      const y = yMin + rng() * (yMax - yMin);
      if (tooClose(x, y, minDist)) continue;
      if (cabinBuf && tooCloseToCabin(x, y, cabinBuf)) continue;
      // Skippa positioner inom exklusions-zoner
      let inExclusion = false;
      for (const [zxMin, zxMax, zyMin, zyMax] of exclusionZones) {
        if (x >= zxMin && x <= zxMax && y >= zyMin && y <= zyMax) {
          inExclusion = true;
          break;
        }
      }
      if (inExclusion) continue;
      fn(x, y);
      return true;
    }
    return false;
  };
  // === TRÄD (TRIPPLAT — 1500 träd, riktigt tät skog över hela kartan) ===
  const treeCount = 1500;
  for (let i = 0; i < treeCount; i++) {
    trySpawn(80, 9920, 80, 9920, 45, 30, (x, y) => {
      const r = rng();
      let kind = 'tree_oak';
      if (r < 0.45) kind = 'tree_oak';
      else if (r < 0.85) kind = 'tree_pine';
      else if (r < 0.93) kind = 'tree_giant_oak';
      else kind = 'tree_stump';
      const size = kind === 'tree_giant_oak' ? 100 + Math.floor(rng() * 25)
                 : kind === 'tree_stump' ? 25 + Math.floor(rng() * 10)
                 : 50 + Math.floor(rng() * 22);
      arena.walls.push({ x: Math.round(x - size / 2), y: Math.round(y - size / 2), w: size, h: size, kind });
    });
  }
  // === STENAR (200 totalt) ===
  for (let i = 0; i < 200; i++) {
    trySpawn(150, 9850, 150, 9850, 70, 40, (x, y) => {
      const isLarge = rng() < 0.5;
      const w = isLarge ? 65 + Math.floor(rng() * 30) : 40 + Math.floor(rng() * 18);
      const h = isLarge ? 45 + Math.floor(rng() * 22) : 30 + Math.floor(rng() * 15);
      arena.walls.push({
        x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h,
        kind: isLarge ? 'rock_large' : 'rock_small',
      });
    });
  }
  // === BUSKAR (300) ===
  for (let i = 0; i < 300; i++) {
    trySpawn(150, 9850, 150, 9850, 45, 25, (x, y) => {
      arena.decorations.push({ kind: 'bush', x: Math.round(x), y: Math.round(y) });
    });
  }
  // === BLOMMOR (180) ===
  for (let i = 0; i < 180; i++) {
    trySpawn(150, 9850, 150, 9850, 70, 30, (x, y) => {
      arena.decorations.push({ kind: 'flowers', x: Math.round(x), y: Math.round(y), count: 5 + Math.floor(rng() * 5) });
    });
  }
  // === SVAMP-KLUSTER (120) ===
  for (let i = 0; i < 120; i++) {
    trySpawn(150, 9850, 150, 9850, 70, 30, (x, y) => {
      arena.decorations.push({ kind: 'mushrooms', x: Math.round(x), y: Math.round(y), count: 4 + Math.floor(rng() * 4) });
    });
  }
  // === KOTTAR (100) ===
  for (let i = 0; i < 100; i++) {
    trySpawn(150, 9850, 150, 9850, 90, 30, (x, y) => {
      arena.decorations.push({ kind: 'pine_cones', x: Math.round(x), y: Math.round(y), count: 4 + Math.floor(rng() * 4) });
    });
  }
  // === Tre-infrastruktur (×3 från by) ===
  for (let i = 0; i < 30; i++) {
    trySpawn(200, 9800, 200, 9800, 100, 60, (x, y) => {
      arena.walls.push({ x: Math.round(x - 35), y: Math.round(y - 15), w: 70, h: 30, kind: 'woodpile' });
    });
  }
  for (let i = 0; i < 20; i++) {
    trySpawn(200, 9800, 200, 9800, 130, 80, (x, y) => {
      arena.walls.push({ x: Math.round(x - 40), y: Math.round(y - 40), w: 80, h: 80, kind: 'haystack' });
    });
  }
  for (let i = 0; i < 15; i++) {
    trySpawn(200, 9800, 200, 9800, 180, 100, (x, y) => {
      arena.walls.push({ x: Math.round(x - 25), y: Math.round(y - 25), w: 50, h: 50, kind: 'well' });
    });
  }
  // === Extra campfires + tents (mer äventyr) ===
  for (let i = 0; i < 25; i++) {
    trySpawn(300, 9700, 300, 9700, 130, 80, (x, y) => {
      arena.walls.push({ x: Math.round(x - 25), y: Math.round(y - 25), w: 50, h: 50, kind: 'campfire' });
    });
  }
  for (let i = 0; i < 20; i++) {
    trySpawn(300, 9700, 300, 9700, 170, 100, (x, y) => {
      const colors = ['red', 'blue', 'green', 'orange'];
      arena.walls.push({ x: Math.round(x - 40), y: Math.round(y - 35), w: 80, h: 70, kind: 'tent', color: colors[Math.floor(rng() * 4)] });
    });
  }
}

// === CONTAINER-PREPROCESSING ===
// Konvertera alla containerCabins till fullvärdiga cabins med door + interior + roof.
// Tak försvinner när spelaren går in. Garanterad loot vid centrum.
function preprocessContainerCabins(arena) {
  if (arena._containersProcessed) return;
  arena._containersProcessed = true;
  if (!arena.containerCabins) return;
  for (const c of arena.containerCabins) {
    const isHorizontal = c.w > c.h;
    // Dörr på kortsidan — BREDARE (60% av kortsidan, var 40%)
    const door = isHorizontal
      ? { side: 'east', offset: Math.floor(c.h * 0.2), width: Math.floor(c.h * 0.6) }
      : { side: 'south', offset: Math.floor(c.w * 0.2), width: Math.floor(c.w * 0.6) };
    // INGA fönster — containrar är tomma
    const windows = [];
    const palette = {
      orange: { main: '#c47a30', dark: '#7a4a18' },
      blue:   { main: '#2a5a8a', dark: '#15304a' },
      rust:   { main: '#7a4a30', dark: '#3a2418' },
      green:  { main: '#3a6a3a', dark: '#1a3a1a' },
      yellow: { main: '#aa8a20', dark: '#5a4a10' },
      red:    { main: '#8a2a2a', dark: '#5a1010' },
      gold:   { main: '#aa8030', dark: '#5a4010' },
    };
    const p = palette[c.color] || palette.orange;
    // Push som cabin med TOM interior
    arena.cabins.push({
      id: c.id,
      name: c.name,
      bounds: { x: c.x, y: c.y, w: c.w, h: c.h },
      door,
      windows,
      roof: { color: p.main, accent: p.dark, style: 'container' },
      floor: '#3a3a40',
      _isContainer: true,
      interior: [], // INGA interior items — containrar är tomma
    });
  }
}

preprocessContainerCabins(BATTLEROYALE_ARENA);
generateProceduralContent(BATTLEROYALE_ARENA);
// v1.743: 12 dedikerade SHOP-hus (shop:true). Funkar som vanliga hus (väggar +
// shoot-through-fönster via preprocessCabinWalls) men är buy-stations. Spridda,
// undviker SE-alien-hörnet. Ser ut som vanliga hus (varierande tak).
function addBrShopCabins(arena) {
  const spots = [
    // v1.8xx S8: spot 1 5380→5240 (överlappade cont_n_1) + spot 6 620→560 (cont_w_2)
    { x: 820, y: 760 }, { x: 5240, y: 700 }, { x: 8650, y: 1150 },
    { x: 1520, y: 3380 }, { x: 6720, y: 3260 }, { x: 9080, y: 4250 },
    { x: 560, y: 6180 }, { x: 3320, y: 6620 }, { x: 5820, y: 5560 },
    { x: 8720, y: 6420 }, { x: 2420, y: 8620 }, { x: 5220, y: 8780 },
  ];
  const roofs = [
    { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' },
    { color: '#6a4030', accent: '#3a2014', style: 'tile' },
    { color: '#7a6a42', accent: '#3a3320', style: 'thatch' },
  ];
  const W = 190, H = 160;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    arena.cabins.push({
      id: 'shop_cabin_' + i, name: 'HANDELSBOD', shop: true,
      bounds: { x: s.x, y: s.y, w: W, h: H },
      door: { side: (i % 2 === 0) ? 'south' : 'north', offset: W / 2 - 25, width: 50 },
      windows: [
        { side: 'east', offset: H / 2 - 20, width: 40 },
        { side: 'west', offset: H / 2 - 20, width: 40 },
        { side: (i % 2 === 0) ? 'north' : 'south', offset: W / 2 - 20, width: 40 },
      ],
      roof: roofs[i % roofs.length], floor: '#5a3a1a', interior: [],
    });
  }
}
addBrShopCabins(BATTLEROYALE_ARENA);

// V2: +40 NYA HUS (20 vanliga + 20 shoppar). Geometrin KLONAS från befintliga
// (redan bakade) hus → varje genererat väggsegment får en storlek som redan har
// en bakad obstacle-sprite (Arena.gd-nyckel = kind__WxH; POSITION ignoreras) →
// noll nya bakningar behövs, full visuell korrekthet. Deterministisk seedad
// placering (identisk karta varje match), undviker existerande hus, exklusions-
// zoner (sjö/kyrka/scrap/alien), spawns och kartkant. Körs FÖRE preprocessCabinWalls
// (väggar genereras för dem) och postProcessArena (loot-spawns + träd-rensning).
function addBrExtraCabins(arena) {
  if (arena._extraCabinsAdded) return;
  arena._extraCabinsAdded = true;
  const srcRegular = arena.cabins.filter(c => c && c.bounds && !c.shop && !c._isContainer);
  const srcShop = arena.cabins.filter(c => c && c.bounds && c.shop);
  if (!srcRegular.length || !srcShop.length) return;
  // Spridda mall-index för variation (olika tak/storlekar/dörr-sidor)
  const regTemplates = [];
  const stepT = Math.max(1, Math.floor(srcRegular.length / 8));
  for (let i = 0; i < srcRegular.length && regTemplates.length < 8; i += stepT) regTemplates.push(srcRegular[i]);
  const shopRoofs = [
    { color: '#4a2a18', accent: '#2a1408', style: 'wood_shingle' },
    { color: '#6a4030', accent: '#3a2014', style: 'tile' },
    { color: '#7a6a42', accent: '#3a3320', style: 'thatch' },
  ];
  // Seedad LCG (annan seed än generateProceduralContent)
  let _seed = 0x5eed1234;
  const rng = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 0x100000000; };
  const exclusion = [
    [2550, 3300, 6400, 7270],   // sjö/klippa
    [4300, 4950, 6300, 7350],   // kyrka/kyrkogård
    [5250, 7700, 2150, 3900],   // scrap-yard
    [7900, 10000, 7900, 10000], // alien-hörnet
  ];
  const farFromCabins = (x, y, w, h, buf) => {
    for (const c of arena.cabins) {
      const b = c.bounds;
      if (x < b.x + b.w + buf && x + w > b.x - buf && y < b.y + b.h + buf && y + h > b.y - buf) return false;
    }
    return true;
  };
  const farFromSpawns = (x, y, w, h) => {
    const cx = x + w / 2, cy = y + h / 2;
    for (const s of arena.spawns) { const dx = cx - s.x, dy = cy - s.y; if (dx * dx + dy * dy < 320 * 320) return false; }
    return true;
  };
  const inExclusion = (x, y, w, h) => {
    const cx = x + w / 2, cy = y + h / 2;
    for (const z of exclusion) if (cx >= z[0] && cx <= z[1] && cy >= z[2] && cy <= z[3]) return true;
    return false;
  };
  let placed = 0, shopCount = 0, regCount = 0, regTi = 0;
  for (let i = 0; i < 40; i++) {
    const isShop = (i % 2 === 1);           // jämn=vanlig (20), udda=shop (20)
    let tpl, roof;
    if (isShop) { tpl = srcShop[shopCount % srcShop.length]; roof = shopRoofs[shopCount % shopRoofs.length]; }
    else { tpl = regTemplates[regTi % regTemplates.length]; regTi++; roof = null; }
    const w = tpl.bounds.w, h = tpl.bounds.h;
    let ok = false, px = 0, py = 0;
    for (let attempt = 0; attempt < 80; attempt++) {
      px = Math.round(250 + rng() * (arena.worldW - 500 - w));
      py = Math.round(250 + rng() * (arena.worldH - 500 - h));
      if (inExclusion(px, py, w, h)) continue;
      if (!farFromCabins(px, py, w, h, 80)) continue;
      if (!farFromSpawns(px, py, w, h)) continue;
      ok = true; break;
    }
    if (!ok) continue;
    const dx = px - tpl.bounds.x, dy = py - tpl.bounds.y;
    const interior = (tpl.interior || []).map(it => Object.assign({}, it, { x: it.x + dx, y: it.y + dy }));
    const cab = {
      id: isShop ? ('shop_cabin_ext_' + shopCount) : ('cabin_extra_' + regCount),
      name: isShop ? 'HANDELSBOD' : (tpl.name || 'STUGA'),
      bounds: { x: px, y: py, w, h },
      door: JSON.parse(JSON.stringify(tpl.door)),
      windows: JSON.parse(JSON.stringify(tpl.windows || [])),
      roof: roof || JSON.parse(JSON.stringify(tpl.roof)),
      floor: tpl.floor || '#5a3a1a',
      interior,
    };
    if (isShop) { cab.shop = true; shopCount++; } else regCount++;
    arena.cabins.push(cab);
    placed++;
  }
  console.log('[BR] addBrExtraCabins: +' + placed + ' hus (' + shopCount + ' shoppar, ' + regCount + ' vanliga)');
}
addBrExtraCabins(BATTLEROYALE_ARENA);
// V2 (user 2026-06-24): inga shop-HUS längre — gör ALLA hus vanliga (strippa shop-flaggan
// + döp om HANDELSBOD→STUGA). Shoppar är nu 3 dedikerade NPC-handlare (brShops nedan) som
// står i öppen terräng, syns på minimapen och öppnar samma köp-panel via radie-närhet.
for (const _c of BATTLEROYALE_ARENA.cabins) {
  if (!_c) continue;
  _c.shop = false;
  if (_c.name === 'HANDELSBOD') _c.name = 'STUGA';
}
// 3 SHOP-NPC:er spridda över kartan (N / V / SÖ), i öppna ytor utanför exklusions-
// zonerna (sjö/kyrka/scrap/alien). r = interaktions-/markör-radie.
BATTLEROYALE_ARENA.brShops = [
  { id: 'shop_n',  name: 'VAPENHANDLARE', x: 5000, y: 1150, r: 150 },
  { id: 'shop_w',  name: 'FÄLTSHOP',      x: 1400, y: 5000, r: 150 },
  { id: 'shop_se', name: 'SVARTA BÖRSEN', x: 6900, y: 6900, r: 150 },
];
preprocessCabinWalls(BATTLEROYALE_ARENA);

// === POST-PROCESS: ta bort graffiti + caution_tape + auto-lägg loot i cabins ===
function postProcessArena(arena) {
  if (arena._postProcessed) return;
  arena._postProcessed = true;
  // 0. Ta bort huset VÄSTER om gravarna (cabin_central_south @ 4200,6800) + dess väggar.
  const _rmC = (arena.cabins || []).find(c => c.id === 'cabin_central_south');
  if (_rmC && _rmC.bounds) {
    const b = _rmC.bounds;
    arena.cabins = arena.cabins.filter(c => c !== _rmC);
    arena.walls = arena.walls.filter(w => {
      if (w.kind !== 'cabin_wall_wood' && w.kind !== 'cabin_window') return true;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      return !(cx > b.x - 6 && cx < b.x + b.w + 6 && cy > b.y - 6 && cy < b.y + b.h + 6);
    });
  }
  // 0b. PUNKT-STÄDNING (BR-feedback via koordinat-overlay):
  //   - picknickbord @~5000,5400 (såg ut som en lös "fyrkant") → BORT
  //   - "lång pinne bakom kyrkan" = stone_wall_low @~4500,6489 → BORT
  //   - stencirkeln @~3975,3105: gör RUND + ta bort "trä-boxen" (altar_stone) i mitten
  const _rmNear = (kind, px, py, rad) => {
    arena.walls = arena.walls.filter(w => {
      if (w.kind !== kind) return true;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      return Math.hypot(cx - px, cy - py) > rad;
    });
  };
  _rmNear('picnic_table', 5035, 5418, 90);
  _rmNear('stone_wall_low', 4500, 6489, 90);
  _rmNear('altar_stone', 3975, 3105, 140);
  // Runda stencirkeln: jämnt fördelade standing_stones runt sitt eget centrum.
  {
    const cz = arena.walls.filter(w => w.kind === 'standing_stone'
      && Math.hypot(w.x + w.w / 2 - 3975, w.y + w.h / 2 - 3105) < 250);
    if (cz.length >= 4) {
      let cx = 0, cy = 0;
      for (const s of cz) { cx += s.x + s.w / 2; cy += s.y + s.h / 2; }
      cx /= cz.length; cy /= cz.length;
      let rr = 0;
      for (const s of cz) rr += Math.hypot(s.x + s.w / 2 - cx, s.y + s.h / 2 - cy);
      rr = Math.max(135, rr / cz.length);
      cz.forEach((s, i) => {
        const ang = (i / cz.length) * Math.PI * 2 - Math.PI / 2;
        s.x = Math.round(cx + Math.cos(ang) * rr - s.w / 2);
        s.y = Math.round(cy + Math.sin(ang) * rr - s.h / 2);
      });
    }
  }
  // 1. Ta bort graffiti + caution_tape + fallen_log + stream + DIRT_PATH
  //    (user gillar inte stigar — de gick ibland under hus)
  arena.decorations = arena.decorations.filter(d => {
    return d.kind !== 'graffiti' && d.kind !== 'caution_tape'
        && d.kind !== 'fallen_log' && d.kind !== 'stream'
        && d.kind !== 'dirt_path';
  });
  // 1b. AGGRESSIV CLEANUP: ta bort PROCEDURELLA walls vars bbox överlappar
  //     någon cabin bounds (med 18px buffer) — fixar "träd inne i hus".
  //     Gäller även dekorationer (bush, mushrooms, flowers, pine_cones).
  const PROC_WALL_KINDS = new Set([
    'tree_oak', 'tree_pine', 'tree_giant_oak', 'tree_stump',
    'rock_large', 'rock_small',
    'woodpile', 'haystack', 'well', 'campfire', 'tent',
    // Mystik + edge-boost dekor (v1.370): aggressivt rensa även dessa
    // så de aldrig hamnar inuti hus eller blockerar dörrar.
    'standing_stone', 'rune_stone', 'skull_totem',
    'oil_drum', 'car_wreck',
  ]);
  const CABIN_BUF = 18;
  const overlapsAnyCabin = (x, y, w, h) => {
    for (const c of arena.cabins) {
      const b = c.bounds;
      if (x < b.x + b.w + CABIN_BUF && x + w > b.x - CABIN_BUF &&
          y < b.y + b.h + CABIN_BUF && y + h > b.y - CABIN_BUF) return true;
    }
    return false;
  };
  // Cemetery zone (gravstenar finns där — inga träd/buskar)
  const CEMETERY = { x: 4300, y: 6300, w: 650, h: 1050 };
  const inCemetery = (x, y, w, h) => {
    return x < CEMETERY.x + CEMETERY.w && x + w > CEMETERY.x &&
           y < CEMETERY.y + CEMETERY.h && y + h > CEMETERY.y;
  };
  // Alien-zon (v1.371) — solid SQUARE som matchar minimapen: (7900-10000, 7900-10000).
  // INGA gröna träd/buskar/blommor inne i solid-zonen. I fade-zonen (7450-7900 NW)
  // får träd vara — de skapar mjuk visuell blend mot skogen.
  const ALIEN_SX0 = 7900, ALIEN_SY0 = 7900, ALIEN_SX1 = 10000, ALIEN_SY1 = 10000;
  const GREEN_KINDS = new Set(['tree_oak', 'tree_pine', 'tree_giant_oak', 'tree_stump']);
  const GREEN_DECO_KINDS = new Set(['bush', 'flowers', 'mushrooms', 'pine_cones', 'fallen_leaves', 'moss_patch']);
  const inAlienSolid = (x, y, w, h) => {
    const cxw = x + w / 2, cyw = y + h / 2;
    return cxw >= ALIEN_SX0 && cxw <= ALIEN_SX1 && cyw >= ALIEN_SY0 && cyw <= ALIEN_SY1;
  };
  arena.walls = arena.walls.filter(w => {
    if (PROC_WALL_KINDS.has(w.kind)) {
      if (overlapsAnyCabin(w.x, w.y, w.w, w.h)) return false;
      if (inCemetery(w.x, w.y, w.w, w.h)) return false;
    }
    // Gröna träd inne i alien-solid-zonen tas bort (infekterad mark)
    if (GREEN_KINDS.has(w.kind) && inAlienSolid(w.x, w.y, w.w, w.h)) return false;
    return true;
  });
  arena.decorations = arena.decorations.filter(d => {
    const dx = d.x - 20, dy = d.y - 20, dw = 40, dh = 40;
    if (overlapsAnyCabin(dx, dy, dw, dh)) return false;
    if (inCemetery(dx, dy, dw, dh)) return false;
    // Gröna dekorationer (bush/flowers/etc) inne i alien-solid-zonen tas bort
    if (GREEN_DECO_KINDS.has(d.kind) && inAlienSolid(dx, dy, dw, dh)) return false;
    return true;
  });
  // 1c. DE-DUP: ta bort procedural walls vars bbox överlappar ELLER ligger
  //     mycket nära en TIDIGARE wall (procedural ELLER manuell). 8px buffer
  //     så objekt inte kysser varandra. Också check mot ALLA hardcoded walls,
  //     inte bara andra procedurella → fixar "sten över objekt" buggar.
  const keptAll = arena.walls.filter(w => !PROC_WALL_KINDS.has(w.kind));
  const keptProc = [];
  const DEDUP_BUF = 8;
  arena.walls = arena.walls.filter(w => {
    if (!PROC_WALL_KINDS.has(w.kind)) return true;
    // Kolla mot ALLA hardcoded walls + tidigare accepterade procedurella
    const wMinX = w.x - DEDUP_BUF, wMaxX = w.x + w.w + DEDUP_BUF;
    const wMinY = w.y - DEDUP_BUF, wMaxY = w.y + w.h + DEDUP_BUF;
    for (const k of keptAll) {
      if (wMinX < k.x + k.w && wMaxX > k.x && wMinY < k.y + k.h && wMaxY > k.y) return false;
    }
    for (const k of keptProc) {
      if (wMinX < k.x + k.w && wMaxX > k.x && wMinY < k.y + k.h && wMaxY > k.y) return false;
    }
    keptProc.push(w);
    return true;
  });
  // 1d. KRYMP COLLISION-BBOX för träd OCH stenar. Visuell storlek kvar via
  //     visual{X,Y,W,H}. Pine triangel = smal trunk, oak/giant rundare krona,
  //     stenar rundade så man kan gå nära dem utan att fastna.
  const VISUAL_COLL_FACTOR = {
    tree_pine: 0.35,
    tree_oak: 0.55,
    tree_giant_oak: 0.50,
    tree_stump: 0.75,
    rock_large: 0.62,
    rock_small: 0.65,
    // Alien-objekt: smala/oregelbundna former, krymp collision så spelaren
    // kan röra sig nära kristaller, totems och UFO-vrak utan att fastna i osynlig wall.
    alien_crystal: 0.45,    // smal kristall — bara nedre delen kollar
    skull_totem: 0.40,      // tunn pinne med skalle på toppen
    ufo_debris: 0.55,       // små vrakdelar
    ufo_wreck: 0.65,        // stora disken — kan luta sig mot kanten
    mountain_peak: 0.55,    // klippspets ovanpå huvud-cliff
  };
  // EXAKT per-objekt-kollision ur br-collision-table.json (mätt på varje bakad sprite):
  // träd = stam-rektangel (oak/pine/giant), sten/stubbe/topp = RUND som täcker kroppen,
  // skull_totem/ufo_wreck = rektangel, kristall/ufo_debris = rund. Foten = visual-rutans
  // mitt (= sprajtens bas, base-anchored i klienten). dx/dy = box-toppvänster rel. foten.
  // round=true → cirkel (radie (w+h)/4). Saknad storlek → fallback: gammal centrerad krymp.
  let BR_COLL_TABLE = {};
  try { if (typeof require !== 'undefined') BR_COLL_TABLE = require('./br-collision-table.json'); } catch (e) {}
  for (const w of arena.walls) {
    const f = VISUAL_COLL_FACTOR[w.kind];
    if (!f) continue;
    if (w.visualW != null) continue; // redan processad
    w.visualX = w.x; w.visualY = w.y; w.visualW = w.w; w.visualH = w.h;
    const footCx = w.x + w.w / 2, footCy = w.y + w.h / 2;
    const e = BR_COLL_TABLE[w.kind + '_' + Math.round(w.w) + 'x' + Math.round(w.h)];
    if (e) {
      w.x = Math.round(footCx + e.dx);
      w.y = Math.round(footCy + e.dy);
      w.w = e.w;
      w.h = e.h;
      if (e.shape === 'circle') w.round = true;   // annars rektangel (AABB)
    } else {
      // fallback: gamla centrerade krympningen (cirkel som förr)
      const nw = Math.round(w.w * f), nh = Math.round(w.h * f);
      w.x = Math.round(footCx - nw / 2);
      w.y = Math.round(footCy - nh / 2);
      w.w = nw; w.h = nh;
      w.round = true;
    }
  }
  // 1e. KYRKAN: kollision = byggnadens fotavtryck (fasaden, nedre ~58%, 80% bredd) i stället
  //     för hela sprajt-höjden — tornet/spiran upptill blir genomgång (man "står framför",
  //     som trädkronor). visualFill → klienten ritar sprajten oförändrat (centrerad, skala 1).
  for (const w of arena.walls) {
    if (w.kind !== 'church_ruin' || w.visualW != null) continue;
    w.visualX = w.x; w.visualY = w.y; w.visualW = w.w; w.visualH = w.h;
    w.visualFill = true;
    const cw = Math.round(w.w * 0.80), ch = Math.round(w.h * 0.58);
    w.x = Math.round(w.visualX + w.visualW / 2 - cw / 2);
    w.y = Math.round(w.visualY + w.visualH - ch);   // bottenfäst på byggnadens fot
    w.w = cw; w.h = ch;
  }
  // 1f. SCI-FI (kristall + UFO): försona storlek + SOLID kollision. Servern genererade smått
  //     (crystal 14, ufo 93) men klienten/sprajtarna är stora → kollisionen blev pyttig och man
  //     gick rakt igenom. Hård-sätt visual (UFO HALVERAD → 80) + en rejäl box vid foten.
  //     Klient-JSON re-exporteras härur så server/klient matchar exakt.
  const _SCIFI = {
    alien_crystal: { vw: 50, vh: 80, round: true,  dx: -13, dy: -85,  w: 84,  h: 84 },
    ufo_wreck:     { vw: 80, vh: 80, round: false, dx: -108, dy: -148, w: 215, h: 148 },
  };
  for (const w of arena.walls) {
    const sf = _SCIFI[w.kind];
    if (!sf) continue;
    const footCx = (w.visualX != null ? w.visualX + w.visualW / 2 : w.x + w.w / 2);
    const footCy = (w.visualY != null ? w.visualY + w.visualH / 2 : w.y + w.h / 2);
    w.visualW = sf.vw; w.visualH = sf.vh;
    w.visualX = Math.round(footCx - sf.vw / 2);
    w.visualY = Math.round(footCy - sf.vh / 2);
    w.x = Math.round(footCx + sf.dx);
    w.y = Math.round(footCy + sf.dy);
    w.w = sf.w; w.h = sf.h;
    if (sf.round) w.round = true; else delete w.round;
  }
  // 1g. NYA GEMINI-PROPS (gravsten/runesten/excavator): storlek + kollision.
  //     gravsten = STÖRRE, runesten = MINDRE (båda platta top-down-slabs, kollision = foten).
  //     excavator = full sprite (visualFill) men kollision BARA på HYTTEN (övre delen), ej armen.
  //     Alla 3 = visualFill-render (hela sprajten) + kollision på BARA den OPAKA kroppen
  //     (mätt alpha>200, EJ mjuka skuggan). dx/dy/cw/ch = solid-box rel. visual-rutans
  //     toppvänster. excavator-kollisionen = bara HYTTEN (armen nedanför = genomgång).
  const _PROP = {
    cemetery_gravestone: { vw: 44, vh: 60, dx: 17, dy: 16, cw: 24, ch: 42 },
    rune_stone:          { vw: 36, vh: 52, dx: 14, dy: 13, cw: 21, ch: 37 },
    excavator_wreck:     { vw: 100, vh: 238, dx: 38, dy: 57, cw: 59, ch: 77 },
    woodpile:            { vw: 90, vh: 96, dx: 16, dy: 33, cw: 71, ch: 61 },   // #4 större + ej kapad
    lighthouse:          { vw: 120, vh: 200, dx: 53, dy: 33, cw: 57, ch: 163 }, // #8 stor + hög, lite smalare
  };
  for (const w of arena.walls) {
    const p = _PROP[w.kind];
    if (!p) continue;
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    w.visualX = Math.round(cx - p.vw / 2); w.visualY = Math.round(cy - p.vh / 2);
    w.visualW = p.vw; w.visualH = p.vh; w.visualFill = true;
    w.x = w.visualX + p.dx; w.y = w.visualY + p.dy; w.w = p.cw; w.h = p.ch;
    delete w.round;
  }
  // 2. Lägg till loot-spawn inuti varje cabin (centrum av bounds).
  //    RANDOM tier (containers använder samma distribution som hus — ingen garanti).
  const centerLoot = arena.lootSpawns.pop();
  for (const cabin of arena.cabins) {
    const b = cabin.bounds;
    // v1.743: placera hus-loot något TILL VÄNSTER om centrum så den garanterade
    // hus-vapen-lådan (initBrLoot, centrum+36) hamnar BREDVID, ej ovanpå.
    arena.lootSpawns.push({ x: b.x + b.w / 2 - 36, y: b.y + b.h / 2 });
  }
  arena.lootSpawns.push(centerLoot);
  // 3. Audit: ta bort walls som ligger ENTRY-blockerande precis utanför cabin-dörrar.
  // För varje cabin, kolla en buffer-zon 40px ut från dörröppningen — om någon
  // procedural wall hamnat där, ta bort den.
  arena.walls = arena.walls.filter(w => {
    if (w.kind === 'cabin_wall_wood' || w.kind === 'cabin_window') return true;
    if (w.kind === 'wooden_fence' || w.kind === 'stone_wall' || w.kind === 'stone_wall_low') return true;
    if (w.kind === 'lake_water_block' || w.kind === 'bridge') return true;
    // Är denna wall i en cabins entry-buffer?
    for (const c of arena.cabins) {
      if (!c.door) continue;
      const b = c.bounds;
      const T = 12;
      let bx, by, bw, bh;
      const ENTRY_BUFFER = 50;
      if (c.door.side === 'north') {
        bx = b.x + c.door.offset - 5; by = b.y - ENTRY_BUFFER;
        bw = c.door.width + 10; bh = ENTRY_BUFFER;
      } else if (c.door.side === 'south') {
        bx = b.x + c.door.offset - 5; by = b.y + b.h;
        bw = c.door.width + 10; bh = ENTRY_BUFFER;
      } else if (c.door.side === 'east') {
        bx = b.x + b.w; by = b.y + c.door.offset - 5;
        bw = ENTRY_BUFFER; bh = c.door.width + 10;
      } else {
        bx = b.x - ENTRY_BUFFER; by = b.y + c.door.offset - 5;
        bw = ENTRY_BUFFER; bh = c.door.width + 10;
      }
      // Wall överlappar buffer-zon?
      if (w.x < bx + bw && w.x + w.w > bx && w.y < by + bh && w.y + w.h > by) {
        return false; // ta bort
      }
    }
    return true;
  });
  // 4. GALLRA + SPRID UT TRÄD OCH STENAR (deterministiskt, samma karta varje match):
  //    4a) hash-gallra → träd behåller 30%, STEN behåller 80% (−20% sten, användarkrav)
  //    4b) ta bort träd/sten som överlappar ett HUS (cabin bounds)
  //    4c) glesa ut greedy → INGET (träd/sten/prop) överlappar något annat. Träd läggs
  //        FÖRE sten (träd vinner vid krock → överlappande STEN tas bort, ej trädet).
  //        Greedy-listan seedas med ALLA stora propers visuella cirklar → träd/sten
  //        hamnar aldrig ovanpå excavator/fyr/kyrka/gravsten/UFO/brunn/tält m.fl.
  //    Behåller wall-ordningen (z). Klient-JSON synkas till EXAKT detta set.
  const TREE_KINDS = new Set(['tree_oak', 'tree_pine', 'tree_giant_oak', 'tree_stump']);
  const ROCK_KINDS = new Set(['rock_large', 'rock_small']);
  const VISUAL_SCALE = { tree_oak: 4.5, tree_pine: 4.0, tree_giant_oak: 3.0, tree_stump: 3.5 };
  const VISUAL_SCALE_DEF = 3.0;
  const _foot = w => ({
    x: (w.visualX != null ? w.visualX + w.visualW / 2 : w.x + w.w / 2),
    y: (w.visualY != null ? w.visualY + w.visualH / 2 : w.y + w.h / 2),
  });
  // Visuell radie = EXAKT klientens render-storlek (Arena.gd _add_wall): visualFill ritas på
  // sin visual-ruta (skala 1); annars uppskalad med VISUAL_SCALE (träd) / default 3.0 (sten/
  // sci-fi) om visualW finns, annars rå storlek (skala 1). 0.42 ≈ knappt halva bredden.
  const _visR = w => {
    const hasVis = (w.visualW != null);
    const vw = hasVis ? w.visualW : w.w, vh = hasVis ? w.visualH : w.h;
    let sc;
    if (w.visualFill) sc = 1.0;
    else if (hasVis) sc = (VISUAL_SCALE[w.kind] != null ? VISUAL_SCALE[w.kind] : VISUAL_SCALE_DEF);
    else sc = 1.0;
    return Math.max(vw, vh) * sc * 0.42;
  };
  // Linjära/genomgångbara walls + cabin-väggar är inga punkt-hinder → ej i avoid-listan.
  const _SKIP_AVOID = new Set(['cabin_wall_wood', 'cabin_window', 'wooden_fence',
    'stone_wall', 'stone_wall_low', 'lake_water_block', 'bridge']);
  const _cabB = (arena.cabins || []).map(c => c.bounds).filter(Boolean);
  // + KYRKAN (utökad norrut) → inga träd sticker upp "som en pinne" bakom taket
  const _ch = arena.walls.find(w => w.kind === 'church_ruin');
  if (_ch) {
    const vx = (_ch.visualX != null ? _ch.visualX : _ch.x), vy = (_ch.visualY != null ? _ch.visualY : _ch.y);
    const vw = (_ch.visualW != null ? _ch.visualW : _ch.w), vh = (_ch.visualH != null ? _ch.visualH : _ch.h);
    _cabB.push({ x: vx - 40, y: vy - 340, w: vw + 80, h: vh + 340 });
  }
  // SEED greedy-listan med alla STORA propers visuella cirklar (allt utom träd/sten/linjärt).
  const _kept = [];
  for (const w of arena.walls) {
    if (TREE_KINDS.has(w.kind) || ROCK_KINDS.has(w.kind) || _SKIP_AVOID.has(w.kind)) continue;
    const f = _foot(w);
    _kept.push({ x: f.x, y: f.y, r: _visR(w), rock: false });
  }
  // Träd FÖRST (vinner mot sten), sedan sten. Behåller relativ ordning inom varje grupp.
  const _order = [];
  for (const w of arena.walls) if (TREE_KINDS.has(w.kind)) _order.push(w);
  for (const w of arena.walls) if (ROCK_KINDS.has(w.kind)) _order.push(w);
  const _keep = new Set();
  for (const w of _order) {
    const isRock = ROCK_KINDS.has(w.kind);
    const f = _foot(w), r = _visR(w);
    // 4a hash → träd 30%, sten 80% (olika salt → gallras oberoende)
    const salt = isRock ? 0x9e3779b1 : 0;
    const hsh = (((Math.round(f.x) * 73856093) ^ (Math.round(f.y) * 19349663) ^ salt) >>> 0) % 1000;
    if (!isRock && hsh >= 300) continue;
    if (isRock && hsh >= 800) continue;
    // 4b hus-överlapp. TRÄD är base-anchored → sprajten reser sig UPPÅT från foten, så ett
    // träd vars fot står strax SÖDER om ett hus får kronan att gå IN i huset (användar-fynd
    // @2842,3736 + @3294,4125). Använd trädets uppåt-räckvidd (≈ full sprajthöjd) mot huset,
    // ej en symmetrisk fot-box. Sten reser sig ej → symmetrisk.
    let bad = false;
    const hr = r;                        // FULL krona-radie horisontellt (matchar synlig krona)
    const upR = isRock ? hr : r * 2.2;   // träd: hela sprajthöjden uppåt
    const dnR = isRock ? hr : r * 0.4;
    for (const b of _cabB) {
      if (f.x + hr > b.x - 6 && f.x - hr < b.x + b.w + 6 && (f.y - upR) < (b.y + b.h + 6) && (f.y + dnR) > (b.y - 6)) { bad = true; break; }
    }
    if (bad) continue;
    // 4c greedy spacing mot redan behållna (props + träd + sten). Träd-mot-träd = full
    // radie (bevarar den godkända skog-tätheten). Krock där en STEN är inblandad = mjukare
    // tolerans (träd är base-anchored, kronan reser sig ÖVER stenens fot → de får nudda lite,
    // annars rensas alldeles för många stenar i tät skog och kartan blir sten-kal).
    for (const k of _kept) {
      const dx = f.x - k.x, dy = f.y - k.y;
      const tol = (isRock || k.rock) ? 0.58 : 1.0;
      const md = (r + k.r) * tol + 12;
      if (dx * dx + dy * dy < md * md) { bad = true; break; }
    }
    if (bad) continue;
    _keep.add(w); _kept.push({ x: f.x, y: f.y, r, rock: isRock });
  }
  arena.walls = arena.walls.filter(w => (!TREE_KINDS.has(w.kind) && !ROCK_KINDS.has(w.kind)) || _keep.has(w));
}
postProcessArena(BATTLEROYALE_ARENA);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BATTLEROYALE_ARENA };
}
if (typeof window !== 'undefined') {
  window.BATTLEROYALE_ARENA = BATTLEROYALE_ARENA;
}
