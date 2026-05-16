// BATTLE ROYALE — "LAST HUNT"
// 6000×6000 industri-stad. Krympande safe-zone över 5/10/15 min. FFA, no respawn.
// Loot-pickups på marken (vapen, HP, shield, ammo). Sista överlevare vinner.
// Återanvänder wall-kinds från andra arenor (concrete, wall_pillar, sandbag, crate,
// barrel, debris, barricade, pipe, truck, van, car_wreck, oil_drum, fire_drum,
// lamppost, broken_pillar, dumpster_fire, jersey_barrier, bollard, stairwell_door)
// + 3 NYA kinds för BR-specifika landmarks (shipping_container, silo, building).
'use strict';

const BATTLEROYALE_ARENA = {
  worldW: 6000,
  worldH: 6000,
  name: 'LAST HUNT',

  // 16 spawn-punkter spridda längs perimetern — räcker till 8 spelare + 8 bots
  // utan att 2 spawnar ovanpå varandra. Centrum av arenan lämnas till loot-rush.
  spawns: [
    // Top edge
    { x: 600,  y: 500  },
    { x: 2200, y: 400  },
    { x: 3800, y: 400  },
    { x: 5400, y: 500  },
    // Right edge
    { x: 5500, y: 1800 },
    { x: 5500, y: 4200 },
    // Bottom edge
    { x: 5400, y: 5500 },
    { x: 3800, y: 5600 },
    { x: 2200, y: 5600 },
    { x: 600,  y: 5500 },
    // Left edge
    { x: 500,  y: 4200 },
    { x: 500,  y: 1800 },
    // Inner ring (för fyllning vid 16 spelare)
    { x: 1500, y: 1500 },
    { x: 4500, y: 1500 },
    { x: 1500, y: 4500 },
    { x: 4500, y: 4500 },
  ],

  // Walls = AABB. Industri-stad med distinkta zoner:
  //   NW: skrot-yard (skrot + bilskelett + olja)
  //   NE: industri-fabrik (silos + containrar + skorstenar)
  //   SW: bostadskvarter (byggnader + gränder)
  //   SE: gas-station + parkering (pumpar + bilar + lamppor)
  //   Mid: torget (springbrunn-fountain + flag-pole + 4 stora cover-block)
  walls: [
    // === PERIMETER (4 segment, betong-mur 20 px tjock) ===
    { x: 0,    y: 0,    w: 6000, h: 20,   kind: 'concrete' },
    { x: 0,    y: 5980, w: 6000, h: 20,   kind: 'concrete' },
    { x: 0,    y: 0,    w: 20,   h: 6000, kind: 'concrete' },
    { x: 5980, y: 0,    w: 20,   h: 6000, kind: 'concrete' },

    // ====================================================================
    // === NW KVADRANT: SKROT-YARD (0,0)–(3000,3000) ===
    // ====================================================================
    // Bilskelett (utbrunna bilar — bra cover)
    { x: 400,  y: 800,  w: 110, h: 55, kind: 'car_wreck' },
    { x: 700,  y: 1100, w: 55,  h: 110, kind: 'car_wreck' },
    { x: 1100, y: 900,  w: 110, h: 55, kind: 'car_wreck' },
    { x: 1500, y: 1200, w: 110, h: 55, kind: 'car_wreck' },
    { x: 900,  y: 1500, w: 55,  h: 110, kind: 'car_wreck' },
    { x: 1800, y: 1700, w: 110, h: 55, kind: 'car_wreck' },
    { x: 400,  y: 2100, w: 110, h: 55, kind: 'car_wreck' },
    { x: 2200, y: 2400, w: 110, h: 55, kind: 'car_wreck' },
    // Oljefat (utspridda)
    { x: 600,  y: 600,  w: 32,  h: 32, kind: 'oil_drum' },
    { x: 1200, y: 700,  w: 32,  h: 32, kind: 'oil_drum' },
    { x: 1700, y: 1300, w: 32,  h: 32, kind: 'oil_drum' },
    { x: 2300, y: 1800, w: 32,  h: 32, kind: 'oil_drum' },
    { x: 800,  y: 2400, w: 32,  h: 32, kind: 'oil_drum' },
    { x: 2400, y: 2600, w: 32,  h: 32, kind: 'oil_drum' },
    // Brinnande fat (lyser i mörker, atmosfär)
    { x: 1000, y: 1900, w: 28,  h: 28, kind: 'fire_drum' },
    { x: 2000, y: 2200, w: 28,  h: 28, kind: 'fire_drum' },
    // Containrar (NEW kind — 4 stora frakt-containrar, color-coded)
    { x: 600,  y: 1700, w: 220, h: 80,  kind: 'shipping_container', color: 'orange' },
    { x: 1700, y: 2000, w: 80,  h: 220, kind: 'shipping_container', color: 'blue' },
    { x: 2400, y: 1100, w: 220, h: 80,  kind: 'shipping_container', color: 'rust' },
    { x: 1300, y: 2500, w: 220, h: 80,  kind: 'shipping_container', color: 'green' },
    // Dumpster fires (atmosphere)
    { x: 1400, y: 400,  w: 60,  h: 36, kind: 'dumpster_fire' },
    { x: 2500, y: 2900, w: 60,  h: 36, kind: 'dumpster_fire' },
    // Debris-högar
    { x: 850,  y: 1000, w: 50,  h: 50, kind: 'debris' },
    { x: 1600, y: 600,  w: 50,  h: 50, kind: 'debris' },
    { x: 2000, y: 1500, w: 50,  h: 50, kind: 'debris' },
    { x: 600,  y: 2700, w: 50,  h: 50, kind: 'debris' },
    // Barricader
    { x: 500,  y: 1500, w: 120, h: 22, kind: 'barricade' },
    { x: 2100, y: 800,  w: 120, h: 22, kind: 'barricade' },
    { x: 1900, y: 2700, w: 120, h: 22, kind: 'barricade' },

    // ====================================================================
    // === NE KVADRANT: INDUSTRI-FABRIK (3000,0)–(6000,3000) ===
    // ====================================================================
    // Silos (NEW kind — 3 stora cylindriska industri-silos)
    { x: 3400, y: 600,  w: 110, h: 110, kind: 'silo' },
    { x: 4500, y: 700,  w: 110, h: 110, kind: 'silo' },
    { x: 5300, y: 1100, w: 110, h: 110, kind: 'silo' },
    { x: 3800, y: 1900, w: 110, h: 110, kind: 'silo' },
    // Building (NEW kind — 4 stora industribyggnader med fönster)
    { x: 3200, y: 1100, w: 200, h: 280, kind: 'building' },
    { x: 4800, y: 1400, w: 280, h: 200, kind: 'building' },
    { x: 4100, y: 2300, w: 200, h: 280, kind: 'building' },
    { x: 5400, y: 2400, w: 280, h: 200, kind: 'building' },
    // Containers (industri-loading-bay)
    { x: 3800, y: 1200, w: 220, h: 80,  kind: 'shipping_container', color: 'yellow' },
    { x: 4500, y: 2700, w: 220, h: 80,  kind: 'shipping_container', color: 'red' },
    { x: 5100, y: 800,  w: 80,  h: 220, kind: 'shipping_container', color: 'blue' },
    { x: 3500, y: 2700, w: 80,  h: 220, kind: 'shipping_container', color: 'orange' },
    // Pelar-rader (atmosfär)
    { x: 3700, y: 400,  w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4100, y: 400,  w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4500, y: 400,  w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4900, y: 400,  w: 50, h: 50, kind: 'wall_pillar' },
    // Crates och sandbags (cover)
    { x: 3300, y: 1700, w: 80, h: 80, kind: 'crate' },
    { x: 4400, y: 600,  w: 80, h: 80, kind: 'crate' },
    { x: 5200, y: 1900, w: 80, h: 80, kind: 'crate' },
    { x: 4700, y: 2900, w: 80, h: 80, kind: 'crate' },
    { x: 3700, y: 2400, w: 100, h: 30, kind: 'sandbag' },
    { x: 4900, y: 2100, w: 100, h: 30, kind: 'sandbag' },
    { x: 5500, y: 1700, w: 30,  h: 100, kind: 'sandbag' },
    // Lamppost-rad längs industri-vägen
    { x: 3600, y: 900,  w: 14, h: 14, kind: 'lamppost' },
    { x: 4200, y: 900,  w: 14, h: 14, kind: 'lamppost' },
    { x: 4800, y: 900,  w: 14, h: 14, kind: 'lamppost' },
    { x: 5400, y: 900,  w: 14, h: 14, kind: 'lamppost' },
    // Fire drums (atmosfär)
    { x: 4200, y: 1700, w: 28, h: 28, kind: 'fire_drum' },
    { x: 5000, y: 2600, w: 28, h: 28, kind: 'fire_drum' },
    // Oljefat
    { x: 3300, y: 2100, w: 32, h: 32, kind: 'oil_drum' },
    { x: 5100, y: 2300, w: 32, h: 32, kind: 'oil_drum' },
    { x: 3900, y: 2900, w: 32, h: 32, kind: 'oil_drum' },

    // ====================================================================
    // === SW KVADRANT: BOSTADSKVARTER (0,3000)–(3000,6000) ===
    // ====================================================================
    // Buildings (4 hus i kvarter)
    { x: 400,  y: 3300, w: 280, h: 200, kind: 'building' },
    { x: 1500, y: 3200, w: 200, h: 280, kind: 'building' },
    { x: 800,  y: 4400, w: 280, h: 200, kind: 'building' },
    { x: 2000, y: 4500, w: 280, h: 200, kind: 'building' },
    { x: 400,  y: 5200, w: 200, h: 280, kind: 'building' },
    { x: 2200, y: 3500, w: 200, h: 280, kind: 'building' },
    // Truck & van på gatorna
    { x: 1100, y: 3500, w: 220, h: 80, kind: 'truck' },
    { x: 700,  y: 4100, w: 140, h: 60, kind: 'van' },
    { x: 1800, y: 4200, w: 220, h: 80, kind: 'truck' },
    { x: 2400, y: 5100, w: 140, h: 60, kind: 'van' },
    // Bilskelett (övergivna)
    { x: 500,  y: 3800, w: 110, h: 55, kind: 'car_wreck' },
    { x: 1900, y: 3900, w: 110, h: 55, kind: 'car_wreck' },
    { x: 1200, y: 5000, w: 110, h: 55, kind: 'car_wreck' },
    // Dumpsters
    { x: 900,  y: 4300, w: 60, h: 36, kind: 'dumpster_fire' },
    { x: 2700, y: 3800, w: 60, h: 36, kind: 'dumpster_fire' },
    { x: 1300, y: 5400, w: 60, h: 36, kind: 'dumpster_fire' },
    // Pelare i gränder
    { x: 1300, y: 3700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 700,  y: 4700, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1700, y: 5000, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2700, y: 4500, w: 50, h: 50, kind: 'broken_pillar' },
    // Lamppost-rad
    { x: 600,  y: 3650, w: 14, h: 14, kind: 'lamppost' },
    { x: 1300, y: 3650, w: 14, h: 14, kind: 'lamppost' },
    { x: 2000, y: 3650, w: 14, h: 14, kind: 'lamppost' },
    { x: 2700, y: 3650, w: 14, h: 14, kind: 'lamppost' },
    { x: 600,  y: 5800, w: 14, h: 14, kind: 'lamppost' },
    { x: 1500, y: 5800, w: 14, h: 14, kind: 'lamppost' },
    { x: 2400, y: 5800, w: 14, h: 14, kind: 'lamppost' },
    // Stairwell doors
    { x: 480,  y: 3270, w: 36, h: 60, kind: 'stairwell_door' },
    { x: 1580, y: 3170, w: 36, h: 60, kind: 'stairwell_door' },
    { x: 880,  y: 4370, w: 36, h: 60, kind: 'stairwell_door' },
    { x: 2080, y: 4470, w: 36, h: 60, kind: 'stairwell_door' },
    // Crates och cover-block i gränder
    { x: 900,  y: 4000, w: 80, h: 80, kind: 'crate' },
    { x: 2400, y: 4000, w: 80, h: 80, kind: 'crate' },
    { x: 1700, y: 5300, w: 80, h: 80, kind: 'crate' },
    { x: 500,  y: 4900, w: 100, h: 30, kind: 'sandbag' },
    { x: 2500, y: 4900, w: 100, h: 30, kind: 'sandbag' },

    // ====================================================================
    // === SE KVADRANT: GAS-STATION + PARKERING (3000,3000)–(6000,6000) ===
    // ====================================================================
    // Gas station building
    { x: 4400, y: 3300, w: 280, h: 200, kind: 'building' },
    // Pumpar (re-use pay_machine för bensinpump-likhet)
    { x: 4350, y: 3550, w: 22, h: 50, kind: 'pay_machine' },
    { x: 4750, y: 3550, w: 22, h: 50, kind: 'pay_machine' },
    { x: 4150, y: 3550, w: 22, h: 50, kind: 'pay_machine' },
    // Parkering med massa bilar
    { x: 3400, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 3700, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4000, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4300, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4600, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4900, y: 4000, w: 110, h: 55, kind: 'car_wreck' },
    { x: 3400, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    { x: 3700, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4000, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4300, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4600, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    { x: 4900, y: 4400, w: 110, h: 55, kind: 'car_wreck' },
    // Trucks och vans utanför parkeringen
    { x: 3200, y: 5200, w: 220, h: 80, kind: 'truck' },
    { x: 4400, y: 5300, w: 220, h: 80, kind: 'truck' },
    { x: 5200, y: 5400, w: 140, h: 60, kind: 'van' },
    { x: 5400, y: 3700, w: 220, h: 80, kind: 'truck' },
    { x: 3500, y: 5500, w: 140, h: 60, kind: 'van' },
    // Jersey barriers längs gatorna
    { x: 3100, y: 3700, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 5200, y: 3700, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 3100, y: 5800, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 5200, y: 5800, w: 220, h: 20, kind: 'jersey_barrier' },
    // Containrar
    { x: 5100, y: 4700, w: 220, h: 80, kind: 'shipping_container', color: 'blue' },
    { x: 3300, y: 4700, w: 220, h: 80, kind: 'shipping_container', color: 'red' },
    // Lamppost-rad på parkeringen
    { x: 3600, y: 4250, w: 14, h: 14, kind: 'lamppost' },
    { x: 4200, y: 4250, w: 14, h: 14, kind: 'lamppost' },
    { x: 4800, y: 4250, w: 14, h: 14, kind: 'lamppost' },
    { x: 5400, y: 4250, w: 14, h: 14, kind: 'lamppost' },
    { x: 3600, y: 4700, w: 14, h: 14, kind: 'lamppost' },
    { x: 4200, y: 4700, w: 14, h: 14, kind: 'lamppost' },
    { x: 4800, y: 4700, w: 14, h: 14, kind: 'lamppost' },
    // Bollards
    { x: 3400, y: 3700, w: 18, h: 18, kind: 'bollard' },
    { x: 4100, y: 3700, w: 18, h: 18, kind: 'bollard' },
    { x: 4900, y: 3700, w: 18, h: 18, kind: 'bollard' },
    { x: 5500, y: 3700, w: 18, h: 18, kind: 'bollard' },
    // Crates och oljefat
    { x: 3300, y: 5000, w: 80, h: 80, kind: 'crate' },
    { x: 5400, y: 5000, w: 80, h: 80, kind: 'crate' },
    { x: 3700, y: 5700, w: 32, h: 32, kind: 'oil_drum' },
    { x: 5200, y: 5700, w: 32, h: 32, kind: 'oil_drum' },

    // ====================================================================
    // === MID-TORG (centrum, runt 3000,3000) ===
    // ====================================================================
    // 4 stora cover-pelare runt mitten
    { x: 2700, y: 2700, w: 60, h: 60, kind: 'wall_pillar' },
    { x: 3240, y: 2700, w: 60, h: 60, kind: 'wall_pillar' },
    { x: 2700, y: 3240, w: 60, h: 60, kind: 'wall_pillar' },
    { x: 3240, y: 3240, w: 60, h: 60, kind: 'wall_pillar' },
    // Jersey-barriers runt torget (formar en cirkel av cover)
    { x: 2800, y: 2950, w: 100, h: 20, kind: 'jersey_barrier' },
    { x: 3100, y: 2950, w: 100, h: 20, kind: 'jersey_barrier' },
    { x: 2800, y: 3030, w: 100, h: 20, kind: 'jersey_barrier' },
    { x: 3100, y: 3030, w: 100, h: 20, kind: 'jersey_barrier' },
    // Container-fort i mitten (legendary loot här)
    { x: 2920, y: 2820, w: 160, h: 60, kind: 'shipping_container', color: 'gold' },
    // Sandbag-stack
    { x: 2900, y: 3120, w: 200, h: 25, kind: 'sandbag' },
    // Brinnande fat
    { x: 2850, y: 2900, w: 28, h: 28, kind: 'fire_drum' },
    { x: 3120, y: 2900, w: 28, h: 28, kind: 'fire_drum' },
  ],

  // Decorations — visuella overlays (ej collision)
  decorations: [
    // Stora skyltar (entré-zoner)
    { kind: 'sign', x: 2900, y: 200, w: 200, h: 40, text: '☠ LAST HUNT ☠', bg: '#2a2a2a', fg: '#ffd54a' },
    { kind: 'sign', x: 200,  y: 2900, w: 160, h: 30, text: 'SKROT-YARD', bg: '#3a2010', fg: '#ffaa30', rot: -0.05 },
    { kind: 'sign', x: 5700, y: 2900, w: 160, h: 30, text: 'INDUSTRI', bg: '#1a1a3a', fg: '#88ccff', rot: 0.05 },
    { kind: 'sign', x: 200,  y: 5750, w: 160, h: 30, text: 'KVARTERET', bg: '#3a1a1a', fg: '#ff8080', rot: -0.05 },
    { kind: 'sign', x: 5700, y: 5750, w: 160, h: 30, text: 'BENSIN', bg: '#103030', fg: '#9affaa', rot: 0.05 },

    // Graffiti — atmosfär (4 zoner)
    { kind: 'graffiti', x: 1500, y: 600, text: 'RUN OR DIE', color: '#ff3030', size: 30, rot: -0.1 },
    { kind: 'graffiti', x: 4500, y: 600, text: 'NO SURVIVORS', color: '#ff5a3a', size: 28, rot: 0.08 },
    { kind: 'graffiti', x: 1500, y: 5400, text: 'GAME OVER', color: '#5a5a5a', size: 32, rot: -0.05 },
    { kind: 'graffiti', x: 4500, y: 5400, text: 'WINNER TAKES ALL', color: '#ffd54a', size: 24, rot: 0.05 },
    { kind: 'graffiti', x: 3000, y: 2500, text: '☠ ZONE ☠', color: '#ff3030', size: 22, rot: 0 },
    { kind: 'graffiti', x: 3000, y: 3500, text: 'LOOT HERE', color: '#ffd54a', size: 24, rot: 0 },

    // Lyktor i hörnen
    { kind: 'lantern', x: 200,  y: 200,  color: '#ff7a3a' },
    { kind: 'lantern', x: 5800, y: 200,  color: '#3a7aff' },
    { kind: 'lantern', x: 200,  y: 5800, color: '#7a3aff' },
    { kind: 'lantern', x: 5800, y: 5800, color: '#3aff7a' },

    // Parking lines på SE-parkeringen
    { kind: 'parking_lines', x: 3550, y: 4000, count: 6, dir: 'h' },
    { kind: 'parking_lines', x: 3550, y: 4400, count: 6, dir: 'h' },

    // Pölar (vatten under regn)
    { kind: 'puddle', x: 1200, y: 1800, r: 70 },
    { kind: 'puddle', x: 4500, y: 2200, r: 65 },
    { kind: 'puddle', x: 1700, y: 4500, r: 80 },
    { kind: 'puddle', x: 4300, y: 4700, r: 75 },
    { kind: 'puddle', x: 3000, y: 3000, r: 55 },

    // Avloppsbrunnar
    { kind: 'drain', x: 1000, y: 2000 },
    { kind: 'drain', x: 4000, y: 1500 },
    { kind: 'drain', x: 1500, y: 4500 },
    { kind: 'drain', x: 4500, y: 4500 },
    { kind: 'drain', x: 3000, y: 3000 },

    // Övergivna shopping carts
    { kind: 'shopping_cart', x: 1800, y: 1100 },
    { kind: 'shopping_cart', x: 4300, y: 2800 },
    { kind: 'shopping_cart', x: 900,  y: 4700 },
    { kind: 'shopping_cart', x: 5100, y: 5200 },

    // Övergivna väskor
    { kind: 'abandoned_bag', x: 1300, y: 2300 },
    { kind: 'abandoned_bag', x: 4700, y: 1700 },
    { kind: 'abandoned_bag', x: 2100, y: 4900 },
    { kind: 'abandoned_bag', x: 5400, y: 4200 },

    // Trash piles
    { kind: 'trash_pile', x: 1600, y: 2700 },
    { kind: 'trash_pile', x: 3700, y: 800 },
    { kind: 'trash_pile', x: 2500, y: 5500 },
    { kind: 'trash_pile', x: 5300, y: 5100 },

    // Rubble
    { kind: 'rubble', x: 800,  y: 2600 },
    { kind: 'rubble', x: 2800, y: 1900 },
    { kind: 'rubble', x: 4900, y: 3000 },
    { kind: 'rubble', x: 1500, y: 4700 },

    // Broken glass
    { kind: 'broken_glass', x: 1100, y: 1100 },
    { kind: 'broken_glass', x: 4400, y: 2400 },
    { kind: 'broken_glass', x: 1800, y: 5100 },
    { kind: 'broken_glass', x: 4600, y: 5300 },

    // Traffic cones
    { kind: 'traffic_cone', x: 3100, y: 3700 },
    { kind: 'traffic_cone', x: 3140, y: 3720 },
    { kind: 'traffic_cone', x: 2900, y: 5200 },
    { kind: 'traffic_cone', x: 5100, y: 4900 },

    // Pallets
    { kind: 'pallet', x: 1900, y: 2300 },
    { kind: 'pallet', x: 4200, y: 1300 },
    { kind: 'pallet', x: 2300, y: 4700 },
    { kind: 'pallet', x: 5000, y: 5500 },

    // Fire hydrants
    { kind: 'fire_hydrant', x: 500,  y: 3300 },
    { kind: 'fire_hydrant', x: 5400, y: 1300 },
    { kind: 'fire_hydrant', x: 700,  y: 5500 },
    { kind: 'fire_hydrant', x: 5400, y: 5500 },

    // Caution tape
    { kind: 'caution_tape', x: 2200, y: 700, w: 100, rot: 0 },
    { kind: 'caution_tape', x: 4500, y: 700, w: 100, rot: 0 },
  ],

  // === LOOT-SPAWN-PUNKTER ===
  // 80 spawn-punkter spridda över hela kartan. Server slumpar tier + typ vid match-start.
  // Tier-tabell:
  //   common (60%):   pistol-ammo (refill), small HP-pack (+30 HP)
  //   uncommon (25%): smg/rifle/shotgun + ammo, armor-shard (+25 shield)
  //   rare (12%):     bow/sniper/revolver, big HP-pack (+60 HP), big armor (+50 shield)
  //   legendary (3%): minigun/rocket/plasma/sledge/railgun
  // En "center"-spawn (i mid-torget) gör ALLTID legendary för att skapa kontestbar punkt.
  lootSpawns: [
    // NW skrot-yard (20)
    { x: 500,  y: 700  }, { x: 950,  y: 1050 }, { x: 1300, y: 800  },
    { x: 1700, y: 1100 }, { x: 800,  y: 1400 }, { x: 1100, y: 1700 },
    { x: 1500, y: 1900 }, { x: 2000, y: 1500 }, { x: 2400, y: 1700 },
    { x: 700,  y: 2000 }, { x: 1300, y: 2200 }, { x: 1900, y: 2400 },
    { x: 2300, y: 2200 }, { x: 700,  y: 2500 }, { x: 1500, y: 2600 },
    { x: 2400, y: 2800 }, { x: 900,  y: 2800 }, { x: 2100, y: 600  },
    { x: 1100, y: 600  }, { x: 600,  y: 1200 },
    // NE industri (20)
    { x: 3500, y: 800  }, { x: 4100, y: 600  }, { x: 4600, y: 950  },
    { x: 5000, y: 1200 }, { x: 5500, y: 1400 }, { x: 3400, y: 1500 },
    { x: 3900, y: 1500 }, { x: 4500, y: 1800 }, { x: 5200, y: 1700 },
    { x: 3500, y: 2000 }, { x: 4000, y: 2200 }, { x: 4700, y: 2400 },
    { x: 5300, y: 2200 }, { x: 3400, y: 2500 }, { x: 4200, y: 2800 },
    { x: 4900, y: 2700 }, { x: 5500, y: 2700 }, { x: 3700, y: 700  },
    { x: 4400, y: 1100 }, { x: 5100, y: 600  },
    // SW bostäder (20)
    { x: 700,  y: 3400 }, { x: 1200, y: 3300 }, { x: 1900, y: 3400 },
    { x: 2500, y: 3600 }, { x: 600,  y: 3900 }, { x: 1500, y: 3900 },
    { x: 2200, y: 3900 }, { x: 2800, y: 4000 }, { x: 800,  y: 4300 },
    { x: 1700, y: 4400 }, { x: 2400, y: 4300 }, { x: 600,  y: 4700 },
    { x: 1400, y: 4800 }, { x: 2100, y: 4900 }, { x: 2700, y: 5000 },
    { x: 800,  y: 5200 }, { x: 1500, y: 5300 }, { x: 2300, y: 5400 },
    { x: 700,  y: 5700 }, { x: 1900, y: 5700 },
    // SE gas+parkering (20)
    { x: 3300, y: 3500 }, { x: 4000, y: 3500 }, { x: 4700, y: 3500 },
    { x: 5400, y: 3500 }, { x: 3300, y: 3900 }, { x: 5300, y: 3900 },
    { x: 3600, y: 4500 }, { x: 4400, y: 4500 }, { x: 5200, y: 4500 },
    { x: 3300, y: 4900 }, { x: 4100, y: 4900 }, { x: 4900, y: 4900 },
    { x: 5500, y: 4900 }, { x: 3500, y: 5200 }, { x: 4700, y: 5300 },
    { x: 5400, y: 5200 }, { x: 3900, y: 5600 }, { x: 4500, y: 5600 },
    { x: 5100, y: 5700 }, { x: 5500, y: 4400 },
    // CENTER (1 — alltid legendary)
    { x: 3000, y: 3000 },
  ],

  // Loot-tier probabilities (om inte center-spawn).
  // Justerat efter playtest: minskade common 60→45% (var skräp-spam), ökade
  // uncommon 25→35% så fler får primärvapen. Legendary 3→5% (för rare annars).
  lootTiers: {
    common: 0.45,
    uncommon: 0.35,
    rare: 0.15,
    legendary: 0.05,
  },

  // Vapen-pool per tier. Justerat efter balance + playtest-rapport:
  //   - Common: mindre ammo (var ratio-killer), mer hp_small + shield_small
  //   - Uncommon: rifle viktas LÄGRE (dominerade tier), shield_small viktas högre
  //   - Rare: lagt till grenade (var legendary — passar bättre här)
  //   - Legendary: minigun viktas lägre (DOMINANT), tagit bort grenade
  lootByTier: {
    common: [
      { kind: 'hp_small',     weight: 45 }, // +30 HP — primär common-roll
      { kind: 'shield_small', weight: 20 }, // +25 shield — ny i common (mer värde)
      { kind: 'ammo',         weight: 15 }, // ammo-refill för current vapen
      { kind: 'weapon', weaponId: 'pistol', weight: 10 },
      { kind: 'weapon', weaponId: 'knife',  weight: 10 },
    ],
    uncommon: [
      { kind: 'weapon', weaponId: 'smg',         weight: 20 },
      { kind: 'weapon', weaponId: 'rifle',       weight: 15 }, // nerf weight (var 25)
      { kind: 'weapon', weaponId: 'shotgun',     weight: 20 },
      { kind: 'weapon', weaponId: 'revolver',    weight: 15 },
      { kind: 'weapon', weaponId: 'burstpistol', weight: 10 }, // promoted från rare
      { kind: 'shield_small',                    weight: 20 }, // mer cover (var 15)
    ],
    rare: [
      { kind: 'weapon', weaponId: 'bow',         weight: 15 },
      { kind: 'weapon', weaponId: 'sniper',      weight: 15 },
      { kind: 'weapon', weaponId: 'crossbow',    weight: 12 },
      { kind: 'weapon', weaponId: 'tesla',       weight: 10 },
      { kind: 'weapon', weaponId: 'frost',       weight: 10 },
      { kind: 'weapon', weaponId: 'grenade',     weight: 10 }, // demoted från legendary
      { kind: 'weapon', weaponId: 'sonic',       weight: 8 },
      { kind: 'hp_big',                          weight: 10 },
      { kind: 'shield_big',                      weight: 10 },
    ],
    legendary: [
      { kind: 'weapon', weaponId: 'minigun', weight: 15 }, // nerf weight (var 25)
      { kind: 'weapon', weaponId: 'rocket',  weight: 20 },
      { kind: 'weapon', weaponId: 'plasma',  weight: 20 },
      { kind: 'weapon', weaponId: 'sledge',  weight: 15 },
      { kind: 'weapon', weaponId: 'railgun', weight: 15 },
      { kind: 'weapon', weaponId: 'lightsaber', weight: 8 }, // ny — 1-hit melee chase
      { kind: 'weapon', weaponId: 'energysword', weight: 7 },
    ],
  },

  // === ZONE-FASER ===
  // Tid-baserade faser. Durations skaleras med matchDurationSec (5/10/15 min)
  // så proportionerna är desamma. Faser baselade på 600s (10 min) som default.
  //   Phase 0 (loot, 15%):    full zon, ingen damage
  //   Phase 1 (shrink, 17%):  → 60% yta, dmg 1 hp/s utanför
  //   Phase 2 (shrink, 17%):  → 30% yta, dmg 3 hp/s utanför
  //   Phase 3 (shrink, 17%):  → 10% yta, dmg 8 hp/s utanför
  //   Phase 4 (final, 34%):   5% statisk yta, dmg 15 hp/s utanför
  // Zone centrum slumpas lätt mellan faser (±300 px) så slutspel inte alltid är samma plats.
  // Phase-progression — durations relativa till matchDurationSec.
  // Phase 0 har INGEN dmg så spelare hinner loota.
  // Justerat efter balance-rapport: phase 1 dmg 1→2 (annars för svag straff).
  // 5min match får snabbare loot-fas och kortare final via dynamic skalning i sim.
  phases: [
    { name: 'LOOT',     durationFrac: 0.15, areaFrac: 1.00, outsideDmg: 0  },
    { name: 'SHRINK 1', durationFrac: 0.17, areaFrac: 0.60, outsideDmg: 2  },
    { name: 'SHRINK 2', durationFrac: 0.17, areaFrac: 0.30, outsideDmg: 4  },
    { name: 'SHRINK 3', durationFrac: 0.17, areaFrac: 0.10, outsideDmg: 8  },
    { name: 'FINAL',    durationFrac: 0.34, areaFrac: 0.05, outsideDmg: 15 },
  ],

  // Match-duration-val (sek) — klient visar dem som 5/10/15 min
  matchDurations: [300, 600, 900],
  defaultMatchDuration: 600,
  matchDurationLabels: ['⚡ 5 MIN', '🔥 10 MIN', '👑 15 MIN'],

  // Spelare börjar med pistol (begränsad ammo) — tvingar dem att loota
  startWeapon: 'pistol',
  startHp: 100,
  startShield: 0, // ingen shield från början — måste plockas
  maxHp: 100,
  maxShield: 100,

  // Loot-pickup radie
  lootPickupRadius: 32,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BATTLEROYALE_ARENA };
}
if (typeof window !== 'undefined') {
  window.BATTLEROYALE_ARENA = BATTLEROYALE_ARENA;
}
