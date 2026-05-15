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
    // Row 3 (y=2300) — landmark-pelare utan röd text (var: tagged_pillar med "JUG")
    { x: 700,  y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 1400, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2100, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 2800, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 3500, y: 2300, w: 50, h: 50, kind: 'wall_pillar' },
    { x: 4200, y: 2300, w: 50, h: 50, kind: 'broken_pillar' },  // landmark — exponerad rebar
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

    // === BRINNANDE OLJEFAT (4 st — solid collision + animated flame) ===
    { x: 900,  y: 1700, w: 28, h: 28, kind: 'fire_drum' },
    { x: 4100, y: 1700, w: 28, h: 28, kind: 'fire_drum' },
    { x: 2500, y: 900,  w: 28, h: 28, kind: 'fire_drum' },
    { x: 2500, y: 2600, w: 28, h: 28, kind: 'fire_drum' },

    // === LYKTSTOLPAR (12 st — collidable poles med tak-monterade lampor) ===
    { x: 700,  y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 1400, y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 2100, y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 2800, y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 3500, y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 4200, y: 350, w: 14, h: 14, kind: 'lamppost' },
    { x: 700,  y: 2700, w: 14, h: 14, kind: 'lamppost' },
    { x: 1400, y: 2700, w: 14, h: 14, kind: 'lamppost' },
    { x: 2100, y: 2700, w: 14, h: 14, kind: 'lamppost' },
    { x: 2800, y: 2700, w: 14, h: 14, kind: 'lamppost' },
    { x: 3500, y: 2700, w: 14, h: 14, kind: 'lamppost' },
    { x: 4200, y: 2700, w: 14, h: 14, kind: 'lamppost' },

    // === AVSKÄRMNINGAR / OUT-OF-ORDER-TAPE-block (4 st) ===
    { x: 1000, y: 500,  w: 80, h: 20, kind: 'barricade' },
    { x: 3800, y: 500,  w: 80, h: 20, kind: 'barricade' },
    { x: 1000, y: 2950, w: 80, h: 20, kind: 'barricade' },
    { x: 3800, y: 2950, w: 80, h: 20, kind: 'barricade' },

    // === BOLLARDS — betong-pollare (gula varnings-stoppblock, 14 st) ===
    { x: 250,  y: 1000, w: 18, h: 18, kind: 'bollard' },
    { x: 250,  y: 1400, w: 18, h: 18, kind: 'bollard' },
    { x: 250,  y: 2400, w: 18, h: 18, kind: 'bollard' },
    { x: 4750, y: 1000, w: 18, h: 18, kind: 'bollard' },
    { x: 4750, y: 1400, w: 18, h: 18, kind: 'bollard' },
    { x: 4750, y: 2400, w: 18, h: 18, kind: 'bollard' },
    { x: 1900, y: 250, w: 18, h: 18, kind: 'bollard' },
    { x: 2200, y: 250, w: 18, h: 18, kind: 'bollard' },
    { x: 2800, y: 250, w: 18, h: 18, kind: 'bollard' },
    { x: 3100, y: 250, w: 18, h: 18, kind: 'bollard' },
    { x: 1900, y: 3250, w: 18, h: 18, kind: 'bollard' },
    { x: 2200, y: 3250, w: 18, h: 18, kind: 'bollard' },
    { x: 2800, y: 3250, w: 18, h: 18, kind: 'bollard' },
    { x: 3100, y: 3250, w: 18, h: 18, kind: 'bollard' },

    // === BRINNANDE SOPCONTAINERS — dumpsters med eld (2 st) ===
    { x: 1300, y: 100, w: 60, h: 36, kind: 'dumpster_fire' },
    { x: 3500, y: 3300, w: 60, h: 36, kind: 'dumpster_fire' },

    // === TRAPPHUSDÖRRAR — exit-dörrar med EXIT-skylt (3 st) ===
    { x: 100, y: 100, w: 36, h: 60, kind: 'stairwell_door' },
    { x: 4760, y: 1700, w: 36, h: 60, kind: 'stairwell_door' },
    { x: 2400, y: 3400, w: 60, h: 36, kind: 'stairwell_door' },

    // === PAY-AUTOMATER — parkerings-betalningsstationer (3 st) ===
    { x: 800,  y: 350, w: 22, h: 50, kind: 'pay_machine' },
    { x: 3400, y: 350, w: 22, h: 50, kind: 'pay_machine' },
    { x: 2400, y: 2900, w: 22, h: 50, kind: 'pay_machine' },

    // === JERSEY-BETONGBARRIÄRER — låga betong-block (6 st) ===
    { x: 600, y: 1100, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 4180, y: 1100, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 600, y: 2400, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 4180, y: 2400, w: 220, h: 20, kind: 'jersey_barrier' },
    { x: 2300, y: 1700, w: 20, h: 100, kind: 'jersey_barrier' },
    { x: 2680, y: 1700, w: 20, h: 100, kind: 'jersey_barrier' },
  ],

  // Decorations — visuella overlays, ingen collision. Strukturerade i lager:
  //  1) Mark-paint (under allt annat): floor_marking, parking_lines
  //  2) Mark-detaljer: puddle, drain, caution_tape, abandoned_bag, warning_triangle, shopping_cart, graffiti
  //  3) Tak (ovanpå allt — "syns igenom" som ovanifrån-perspektiv):
  //     ceiling_pipe, cable_bundle, ceiling_drip
  decorations: [
    // (Floor-marking "P" + "EXIT →" borttagna — användaren bad ta bort
    // textinslag i mitten/golvet)

    // === Vatten-pölar (under ceiling_drips + sprinklers, 8 st) ===
    { kind: 'puddle', x: 1700, y: 1200, r: 60 },
    { kind: 'puddle', x: 3300, y: 2000, r: 70 },
    { kind: 'puddle', x: 900,  y: 2400, r: 50 },
    { kind: 'puddle', x: 4100, y: 900,  r: 65 },
    { kind: 'puddle', x: 2400, y: 2500, r: 55 },
    { kind: 'puddle', x: 2500, y: 2700, r: 58 },  // under new drip
    { kind: 'puddle', x: 3800, y: 1750, r: 52 },  // under new drip
    { kind: 'puddle', x: 650,  y: 1700, r: 48 },  // under new drip

    // === Avloppsbrunnar / golvgaller (visuella) — 8 st ===
    { kind: 'drain', x: 1200, y: 900 },
    { kind: 'drain', x: 3800, y: 900 },
    { kind: 'drain', x: 1200, y: 2600 },
    { kind: 'drain', x: 3800, y: 2600 },
    { kind: 'drain', x: 2500, y: 1750 },
    { kind: 'drain', x: 500,  y: 1750 },
    { kind: 'drain', x: 4500, y: 1750 },
    { kind: 'drain', x: 2500, y: 3000 },

    // === Graffiti — bara icke-röda färger (användaren bad ta bort röda) ===
    // (Tidigare hade vi RUN/OR DIE/HUNT/NO EXIT — alla rött. Alla borttagna.)

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

    // === TAK-RÖR: stora industri-rör som går EDGE-TO-EDGE över hela banan
    // Renderas halvtransparent som tak-overlay. Pipes har LEDs som blinkar.
    { kind: 'ceiling_pipe', x: 0,  y: 600, w: 5000, color: '#5a4030', dia: 14, leds: true },
    { kind: 'ceiling_pipe', x: 0,  y: 1400, w: 5000, color: '#3a3a45', dia: 16, leds: true },
    { kind: 'ceiling_pipe', x: 0,  y: 2200, w: 5000, color: '#5a4030', dia: 14, leds: true },
    { kind: 'ceiling_pipe', x: 0,  y: 3000, w: 5000, color: '#3a3a45', dia: 16, leds: true },
    // Tvärgående mindre rör (också edge-to-edge top→bottom)
    { kind: 'ceiling_pipe_v', x: 1100, y: 0, h: 3500, color: '#4a4a55', dia: 10, leds: true },
    { kind: 'ceiling_pipe_v', x: 2500, y: 0, h: 3500, color: '#4a4a55', dia: 10, leds: true },
    { kind: 'ceiling_pipe_v', x: 3900, y: 0, h: 3500, color: '#4a4a55', dia: 10, leds: true },

    // === KABEL-HÄRVOR i taket: tjocka kablar i klasar som svänger ===
    { kind: 'cable_bundle', x: 800,  y: 980, x2: 2200, y2: 1020 },
    { kind: 'cable_bundle', x: 2400, y: 980, x2: 3800, y2: 1020 },
    { kind: 'cable_bundle', x: 800,  y: 1780, x2: 2200, y2: 1820 },
    { kind: 'cable_bundle', x: 2400, y: 2380, x2: 3800, y2: 2420 },

    // === BRUSTNA RÖR (vatten gushar ut från sprickor i takröret, 7 st)
    // Spridda jämnt över banan, alla snappar till nearest pipe ovanför.
    { kind: 'ceiling_drip', x: 1700, y: 1200 }, // över puddle 1
    { kind: 'ceiling_drip', x: 3300, y: 2000 }, // över puddle 2
    { kind: 'ceiling_drip', x: 900,  y: 2400 }, // över puddle 3
    { kind: 'ceiling_drip', x: 4100, y: 900 },  // över puddle 4
    { kind: 'ceiling_drip', x: 2500, y: 2700 }, // mid-syd (under y=2200 pipe)
    { kind: 'ceiling_drip', x: 3800, y: 1750 }, // höger-mid (under y=1400 pipe)
    { kind: 'ceiling_drip', x: 650,  y: 1700 }, // vänster-mid (under y=1400 pipe)

    // === RUBBLE / krossad betong-hög (5 st utspridda) ===
    { kind: 'rubble', x: 1450, y: 1450 },
    { kind: 'rubble', x: 2860, y: 2350 },
    { kind: 'rubble', x: 4250, y: 1500 },
    { kind: 'rubble', x: 800,  y: 2000 },
    { kind: 'rubble', x: 3700, y: 800 },

    // === TRAFIK-KONOR (orange, varning, 6 st) ===
    { kind: 'traffic_cone', x: 1080, y: 1075 },
    { kind: 'traffic_cone', x: 1120, y: 1085 },
    { kind: 'traffic_cone', x: 4380, y: 2415 },
    { kind: 'traffic_cone', x: 2370, y: 1820 },
    { kind: 'traffic_cone', x: 3050, y: 425 },
    { kind: 'traffic_cone', x: 4030, y: 1995 },

    // === PALLETAR (trä-pallets, 4 st övergivna) ===
    { kind: 'pallet', x: 1820, y: 1900 },
    { kind: 'pallet', x: 3550, y: 1100 },
    { kind: 'pallet', x: 480,  y: 1300 },
    { kind: 'pallet', x: 2820, y: 2900 },

    // === BROKEN GLASS (utspridda skärvor, 6 st clusters) ===
    { kind: 'broken_glass', x: 1050, y: 1180 }, // runt bilskelett
    { kind: 'broken_glass', x: 1900, y: 2720 },
    { kind: 'broken_glass', x: 3950, y: 1880 },
    { kind: 'broken_glass', x: 2750, y: 600 },
    { kind: 'broken_glass', x: 4550, y: 2300 },
    { kind: 'broken_glass', x: 700,  y: 2800 },

    // === TRASH PILES (skräp + tidningar + flaskor, 5 st) ===
    { kind: 'trash_pile', x: 1600, y: 800 },
    { kind: 'trash_pile', x: 3400, y: 1600 },
    { kind: 'trash_pile', x: 2200, y: 3050 },
    { kind: 'trash_pile', x: 4400, y: 700 },
    { kind: 'trash_pile', x: 200,  y: 1500 },

    // === PARKING-NUMMER (mindre golv-text, 6 st: "P-XX") ===
    { kind: 'parking_number', x: 1150, y: 1100, text: 'P-12', size: 22 },
    { kind: 'parking_number', x: 2150, y: 1100, text: 'P-15', size: 22 },
    { kind: 'parking_number', x: 3150, y: 1100, text: 'P-18', size: 22 },
    { kind: 'parking_number', x: 1150, y: 2700, text: 'P-32', size: 22 },
    { kind: 'parking_number', x: 2850, y: 2700, text: 'P-38', size: 22 },
    { kind: 'parking_number', x: 4150, y: 2700, text: 'P-42', size: 22 },

    // === BRANDPOSTER (fire hydrants — röda metall-poster, 5 st) ===
    { kind: 'fire_hydrant', x: 380,  y: 600 },
    { kind: 'fire_hydrant', x: 4620, y: 600 },
    { kind: 'fire_hydrant', x: 380,  y: 2900 },
    { kind: 'fire_hydrant', x: 4620, y: 2900 },
    { kind: 'fire_hydrant', x: 2500, y: 1100 },

    // === VÄLTA SHOPPING-CARTS (3 st, sidan-down) ===
    { kind: 'overturned_cart', x: 1750, y: 2050, rot: 0.5 },
    { kind: 'overturned_cart', x: 3950, y: 1500, rot: -0.4 },
    { kind: 'overturned_cart', x: 650,  y: 2750, rot: 0.7 },

    // === PARKERINGS-SKYLTAR på stolpar (6 st) ===
    { kind: 'parking_sign', x: 500,  y: 250, text: 'P', color: '#1a3a8a' },
    { kind: 'parking_sign', x: 1700, y: 250, text: 'P', color: '#1a3a8a' },
    { kind: 'parking_sign', x: 3300, y: 250, text: 'P', color: '#1a3a8a' },
    { kind: 'parking_sign', x: 4500, y: 250, text: '⤓', color: '#3a8a3a' },
    { kind: 'parking_sign', x: 500,  y: 3250, text: '⇄', color: '#1a3a8a' },
    { kind: 'parking_sign', x: 4500, y: 3250, text: '⤓', color: '#3a8a3a' },

    // === WHEEL-STOPS (små betong-stopp vid parkerings-rutor, 10 st) ===
    { kind: 'wheel_stop', x: 1100, y: 900, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 2100, y: 900, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 3100, y: 900, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 4100, y: 900, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 1100, y: 2500, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 2100, y: 2500, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 3100, y: 2500, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 4100, y: 2500, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 1100, y: 3050, len: 60, dir: 'h' },
    { kind: 'wheel_stop', x: 3100, y: 3050, len: 60, dir: 'h' },

    // === PIPE-VALVES (rattar fastsatta på tak-rören, 6 st) ===
    { kind: 'pipe_valve', x: 800,  y: 600 },
    { kind: 'pipe_valve', x: 2200, y: 1400 },
    { kind: 'pipe_valve', x: 3700, y: 2200 },
    { kind: 'pipe_valve', x: 1500, y: 3000 },
    { kind: 'pipe_valve', x: 4200, y: 600 },
    { kind: 'pipe_valve', x: 600,  y: 2200 },
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
  jugScale: 1.4,
  jugDashCdMs: 1000,              // 1s — JUG samma som hunter (i praktiken liknande utfall)
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
