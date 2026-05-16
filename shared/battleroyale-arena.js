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
  ],

  walls: [
    // === PERIMETER (10000×10000) ===
    { x: 0,    y: 0,    w: 10000, h: 20,   kind: 'stone_wall' },
    { x: 0,    y: 9980, w: 10000, h: 20,   kind: 'stone_wall' },
    { x: 0,    y: 0,    w: 20,    h: 10000, kind: 'stone_wall' },
    { x: 9980, y: 0,    w: 20,    h: 10000, kind: 'stone_wall' },

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
    { x: 5300, y: 2400,  w: 220, h: 80, kind: 'shipping_container', color: 'rust' },
    { x: 5300, y: 2480,  w: 220, h: 80, kind: 'shipping_container', color: 'orange' },
    { x: 5600, y: 2700,  w: 80,  h: 220, kind: 'shipping_container', color: 'blue' },
    { x: 6100, y: 2300,  w: 220, h: 80, kind: 'shipping_container', color: 'green' },
    { x: 6100, y: 2380,  w: 220, h: 80, kind: 'shipping_container', color: 'yellow' },
    { x: 6500, y: 2600,  w: 80,  h: 220, kind: 'shipping_container', color: 'red' },
    { x: 7000, y: 2800,  w: 220, h: 80, kind: 'shipping_container', color: 'rust' },
    { x: 7300, y: 2400,  w: 220, h: 80, kind: 'shipping_container', color: 'blue' },
    { x: 7500, y: 3500,  w: 80,  h: 220, kind: 'shipping_container', color: 'orange' },

    { x: 5800, y: 3100, w: 130, h: 70, kind: 'burning_car' },
    { x: 6300, y: 3300, w: 130, h: 70, kind: 'burning_car' },
    { x: 7000, y: 3200, w: 200, h: 90, kind: 'burning_truck' },
    { x: 5500, y: 3500, w: 110, h: 60, kind: 'car_wreck' },
    { x: 6800, y: 3700, w: 110, h: 60, kind: 'car_wreck' },
    { x: 7400, y: 2800, w: 110, h: 60, kind: 'car_wreck' },

    { x: 6000, y: 2700, w: 120, h: 90, kind: 'excavator_wreck' },

    { x: 7650, y: 2200, w: 70, h: 70, kind: 'hunting_tower' },

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

    { x: 6200, y: 5700, w: 60, h: 50, kind: 'chicken_coop' },

    { x: 4700, y: 5000, w: 65, h: 65, kind: 'tree_oak' },
    { x: 6100, y: 5000, w: 60, h: 60, kind: 'tree_oak' },
    { x: 5500, y: 6200, w: 70, h: 70, kind: 'tree_oak' },
    { x: 5700, y: 6300, w: 55, h: 55, kind: 'tree_pine' },

    { x: 5000, y: 5400, w: 70, h: 35, kind: 'picnic_table' },

    { x: 6300, y: 4600, w: 60, h: 36, kind: 'dumpster_fire' },

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

    { x: 6750, y: 5400, w: 36, h: 60, kind: 'stairwell_door' },

    { x: 7500, y: 6100, w: 220, h: 80, kind: 'shipping_container', color: 'rust' },

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

    { x: 2800, y: 5950, w: 110, h: 50, kind: 'boat' },

    { x: 3500, y: 6000, w: 200, h: 25, kind: 'bridge' },

    { x: 2300, y: 5200, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2700, y: 5100, w: 55, h: 55, kind: 'tree_pine' },
    { x: 3700, y: 5200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 4100, y: 5300, w: 60, h: 60, kind: 'tree_oak' },
    { x: 2300, y: 7300, w: 60, h: 60, kind: 'tree_pine' },
    { x: 2700, y: 7300, w: 55, h: 55, kind: 'tree_oak' },
    { x: 3100, y: 7200, w: 65, h: 65, kind: 'tree_pine' },
    { x: 3700, y: 7100, w: 60, h: 60, kind: 'tree_oak' },
    { x: 4100, y: 7200, w: 60, h: 60, kind: 'tree_pine' },

    { x: 3900, y: 6400, w: 80, h: 60, kind: 'rock_large' },
    { x: 2400, y: 6700, w: 70, h: 50, kind: 'rock_large' },

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

    { x: 4700, y: 6700, w: 70, h: 70, kind: 'tree_oak' },
    { x: 5000, y: 6800, w: 60, h: 60, kind: 'tree_pine' },
    { x: 5300, y: 6700, w: 65, h: 65, kind: 'tree_oak' },
    { x: 5700, y: 6900, w: 70, h: 70, kind: 'tree_pine' },
    { x: 6000, y: 6750, w: 60, h: 60, kind: 'tree_oak' },
    { x: 6500, y: 6800, w: 65, h: 65, kind: 'tree_pine' },
    { x: 6800, y: 6900, w: 60, h: 60, kind: 'tree_oak' },
    { x: 7200, y: 6750, w: 70, h: 70, kind: 'tree_pine' },
    { x: 7600, y: 6900, w: 65, h: 65, kind: 'tree_oak' },
    { x: 4700, y: 7100, w: 60, h: 60, kind: 'tree_pine' },
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
    { x: 6800, y: 1500, w: 400, h: 90, kind: 'plane_fuselage' }, // huvuddel
    { x: 6750, y: 1350, w: 260, h: 50, kind: 'plane_wing' },     // vänster vinge
    { x: 7100, y: 1620, w: 260, h: 50, kind: 'plane_wing' },     // höger vinge
    { x: 7150, y: 1480, w: 60,  h: 50, kind: 'plane_tail' },     // stjärt
    { x: 6700, y: 1530, w: 30,  h: 30, kind: 'fire_drum' },      // motor brinner
    { x: 7250, y: 1530, w: 30,  h: 30, kind: 'fire_drum' },      // motor brinner

    // 2. ÖDEKYRKA + KYRKOGÅRD (mellan village och south wild)
    { x: 4500, y: 6400, w: 250, h: 320, kind: 'church_ruin' },          // ruin med spira
    { x: 4520, y: 6720, w: 35,  h: 35,  kind: 'cemetery_gravestone' },  // gravsten
    { x: 4580, y: 6730, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4650, y: 6720, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4720, y: 6730, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4790, y: 6720, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4560, y: 6790, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4630, y: 6800, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4700, y: 6790, w: 35,  h: 35,  kind: 'cemetery_gravestone' },
    { x: 4770, y: 6800, w: 35,  h: 35,  kind: 'cemetery_gravestone' },

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
    { x: 5400, y: 2200, w: 140, h: 100, kind: 'pump_jack' },

    // 6. FYRTORN PÅ KULLE (i south wild, tall landmark)
    { x: 7800, y: 7900, w: 90, h: 90, kind: 'lighthouse' },

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
    // === SKOGSGOLV-PATCHES med varierade tints (forest har olika nyanser) ===
    { kind: 'forest_floor', x: 200,  y: 200,  w: 9600, h: 1700, tint: 'dark_green' }, // hela norra
    { kind: 'forest_floor', x: 200,  y: 1900, w: 1800, h: 3000, tint: 'mossy' },      // västra övre
    { kind: 'forest_floor', x: 200,  y: 4900, w: 1800, h: 3200, tint: 'brown_leaf' }, // västra nedre (höstmark)
    { kind: 'forest_floor', x: 8000, y: 1900, w: 1800, h: 3000, tint: 'mossy' },      // östra övre
    { kind: 'forest_floor', x: 8000, y: 4900, w: 1800, h: 3200, tint: 'pine_needle' },// östra nedre
    { kind: 'forest_floor', x: 200,  y: 8100, w: 9600, h: 1700, tint: 'dark_green' }, // hela södra
    { kind: 'forest_floor', x: 2300, y: 2500, w: 2500, h: 2200, tint: 'pine_needle' },// NW forest tät
    { kind: 'forest_floor', x: 2300, y: 6500, w: 5600, h: 1500, tint: 'mossy' },      // south wild

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

    // === SJÖN — organic polygon (8 punkter, slingrar runt klippkanten) ===
    { kind: 'lake_water_polygon', points: [
      [2000, 6300], [2200, 6200], [2500, 6250], [2800, 6300],
      [3200, 6280], [3500, 6320], [3700, 6500], [3900, 6800],
      [3950, 7100], [3850, 7400], [3500, 7500], [3000, 7480],
      [2600, 7450], [2200, 7300], [2050, 7000], [2000, 6700]
    ] },
    // Behåll en stor "bas-water" som fallback (renderas FÖRST under polygon)
    { kind: 'lake_water', x: 2000, y: 6200, w: 1900, h: 1300, _opacity: 0 },
    { kind: 'stream',     x: 3900, y: 6250, x2: 4400, y2: 6000, w: 22 },
    { kind: 'stream',     x: 4400, y: 6000, x2: 5000, y2: 5700, w: 22 },

    // === FALLNA STOCKAR ===
    { kind: 'fallen_log', x: 2500, y: 3500, w: 100, h: 18, rot: 0.3 },
    { kind: 'fallen_log', x: 3700, y: 3100, w: 100, h: 18, rot: -0.4 },
    { kind: 'fallen_log', x: 4200, y: 2600, w: 90,  h: 18, rot: 0.2 },
    { kind: 'fallen_log', x: 5200, y: 6900, w: 100, h: 18, rot: 0.5 },
    { kind: 'fallen_log', x: 6400, y: 7500, w: 110, h: 18, rot: -0.3 },
    { kind: 'fallen_log', x: 7200, y: 7600, w: 90,  h: 18, rot: 0.4 },
    { kind: 'fallen_log', x: 1500, y: 4500, w: 100, h: 18, rot: 0.3 }, // outer
    { kind: 'fallen_log', x: 8800, y: 5500, w: 100, h: 18, rot: -0.2 }, // outer
    { kind: 'fallen_log', x: 4000, y: 9100, w: 110, h: 18, rot: 0.4 }, // south outer

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

    // === GLÄNTOR — ljusare öppningar i skogen där solljus tränger in ===
    { kind: 'glade', x: 1500, y: 5000, r: 180 },  // outer west glade
    { kind: 'glade', x: 8200, y: 5500, r: 200 },  // outer east glade
    { kind: 'glade', x: 3400, y: 2500, r: 160 },  // NW forest glade
    { kind: 'glade', x: 4300, y: 4100, r: 150 },  // village edge
    { kind: 'glade', x: 5500, y: 7000, r: 170 },  // south wild glade
    { kind: 'glade', x: 6700, y: 7600, r: 180 },  // south east glade
    { kind: 'glade', x: 2400, y: 4500, r: 140 },  // path glade
    { kind: 'glade', x: 7400, y: 4000, r: 150 },  // scrap edge glade

    // === VATTENFALLS (animerad) — i klippkanten vid sjön ===
    { kind: 'waterfall', x: 1860, y: 6250, w: 220, h: 100 },
    { kind: 'water_splash', x: 1970, y: 6360 },  // skum nedan

    // === GROTTA ENTRANCE vid vattenfalls ===
    { kind: 'cave_entrance', x: 1700, y: 6350, w: 60, h: 50 },

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
    common: [
      { kind: 'hp_small',     weight: 40 },
      { kind: 'shield_small', weight: 20 },
      { kind: 'ammo',         weight: 15 },
      { kind: 'weapon', weaponId: 'burstpistol', weight: 10 },
      { kind: 'weapon', weaponId: 'smg',         weight: 10 },
      { kind: 'weapon', weaponId: 'boomerang',   weight: 5 },
    ],
    uncommon: [
      { kind: 'weapon', weaponId: 'smg',         weight: 25 },
      { kind: 'weapon', weaponId: 'burstpistol', weight: 20 },
      { kind: 'weapon', weaponId: 'crossbow',    weight: 20 },
      { kind: 'weapon', weaponId: 'boomerang',   weight: 15 },
      { kind: 'shield_small',                    weight: 15 },
      { kind: 'hp_small',                        weight: 5 },
    ],
    rare: [
      { kind: 'weapon', weaponId: 'rifle',       weight: 25 },
      { kind: 'weapon', weaponId: 'sniper',      weight: 22 },
      { kind: 'weapon', weaponId: 'flame',       weight: 20 },
      { kind: 'weapon', weaponId: 'energysword', weight: 15 },
      { kind: 'hp_big',                          weight: 10 },
      { kind: 'shield_big',                      weight: 8 },
    ],
    legendary: [
      { kind: 'weapon', weaponId: 'minigun',    weight: 50 },
      { kind: 'weapon', weaponId: 'lightsaber', weight: 50 },
    ],
  },

  phases: [
    { name: 'LOOT',     durationFrac: 0.15, areaFrac: 1.00, outsideDmg: 0  },
    { name: 'SHRINK 1', durationFrac: 0.17, areaFrac: 0.60, outsideDmg: 2  },
    { name: 'SHRINK 2', durationFrac: 0.17, areaFrac: 0.30, outsideDmg: 4  },
    { name: 'SHRINK 3', durationFrac: 0.17, areaFrac: 0.10, outsideDmg: 8  },
    { name: 'FINAL',    durationFrac: 0.34, areaFrac: 0.05, outsideDmg: 15 },
  ],

  matchDurations: [300, 600, 900],
  defaultMatchDuration: 600,
  matchDurationLabels: ['⚡ 5 MIN', '🔥 10 MIN', '👑 15 MIN'],

  startWeapon: 'pistol',
  startHp: 100,
  startShield: 0,
  maxHp: 100,
  maxShield: 100,
  lootPickupRadius: 32,
};

// === FÖNSTER-PREPROCESSING ===
// För varje cabin, generera fönster-walls (cabin_window) som blockerar movement
// men släpper igenom bullets (via passThroughBullets-flag).
// Processen körs EN GÅNG när modulen laddas så walls-arrayen utökas in-place.
function preprocessCabinWindows(arena) {
  if (arena._windowsProcessed) return;
  arena._windowsProcessed = true;
  for (const cabin of arena.cabins) {
    if (!cabin.windows || !cabin.windows.length) continue;
    const b = cabin.bounds;
    for (const win of cabin.windows) {
      // Räkna ut window-wall position baserat på side
      let wx, wy, ww, wh;
      const W = win.width || 40;
      if (win.side === 'north') {
        wx = b.x + (win.offset || 0); wy = b.y; ww = W; wh = 12;
      } else if (win.side === 'south') {
        wx = b.x + (win.offset || 0); wy = b.y + b.h - 12; ww = W; wh = 12;
      } else if (win.side === 'east') {
        wx = b.x + b.w - 12; wy = b.y + (win.offset || 0); ww = 12; wh = W;
      } else if (win.side === 'west') {
        wx = b.x; wy = b.y + (win.offset || 0); ww = 12; wh = W;
      }
      // Lägg till fönster-wall: blockerar movement (kollar AABB normalt) men
      // passThroughBullets gör att bulletHitsWall ignorerar denna.
      arena.walls.push({
        x: wx, y: wy, w: ww, h: wh,
        kind: 'cabin_window',
        passThroughBullets: true,
        cabinId: cabin.id,
      });
    }
  }
}

preprocessCabinWindows(BATTLEROYALE_ARENA);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BATTLEROYALE_ARENA };
}
if (typeof window !== 'undefined') {
  window.BATTLEROYALE_ARENA = BATTLEROYALE_ARENA;
}
