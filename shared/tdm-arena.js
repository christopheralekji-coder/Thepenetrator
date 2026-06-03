// Shared TDM-arena: "ÖVNINGSFÄLTET" — militär övningszon, fy_-koncept.
// Speglar pattern från ctf-arena.js så både server och klient laddar samma layout.
//
// KONCEPT (fy_ "fight yard"):
//  - Lagen spawnar längst BAK på var sin kortsida (RÖD uppe / BLÅ nere).
//  - Framför varje spawn ligger en RAD med olika vapen på marken man springer och greppar.
//  - GRANATER ligger i MITTEN (omstritt, mellan två containrar).
//  - Sidocover = väggsegment med LUCKOR emellan.
//  - Spawn-punkterna är spridda (+ servern väljer punkt längst från fiender vid respawn).
//  - LITEN bana (1700×2000) = frenetisk närstrid.
//
// Tema: tätt detaljerad militär övningszon — vakttorn, tält + supply-lastbil i depån,
// sandsäcks-skyttevärn, jersey-barriers, betongblock, shipping-containrar, ammolådor,
// olje-/eldfat, staket. Komponerad med 3 körfält (vänster/center/höger) som hålls öppna.
'use strict';

const TDM_W = 1700;
const TDM_H = 2000;
const TDM_MID_Y = TDM_H / 2; // 1000

function _mirrorWall(w) { return Object.assign({}, w, { y: TDM_H - w.y - w.h }); }
function _mirrorPt(p, extra) {
  const o = { x: p.x, y: TDM_H - p.y };
  if (extra) for (const k of extra) o[k] = p[k];
  return o;
}

// === RÖD SIDA (uppe, y < mitten) — speglas till blå sida nere ===
const _topWalls = [
  // --- Spawn-depå (bakre zon) ---
  { x: 55,   y: 70,  w: 92,  h: 92,  kind: 'hunting_tower' }, // vakttorn vänster
  { x: 1553, y: 70,  w: 92,  h: 92,  kind: 'hunting_tower' }, // vakttorn höger
  { x: 360,  y: 80,  w: 118, h: 86,  kind: 'tent', decor: true }, // genomgångbart (läger-tält)
  { x: 1222, y: 80,  w: 118, h: 86,  kind: 'tent', decor: true },
  { x: 740,  y: 70,  w: 220, h: 92,  kind: 'truck' },         // supply-lastbil
  { x: 300,  y: 188, w: 50,  h: 50,  kind: 'crate' },         // ammolådor vid tält
  { x: 1350, y: 188, w: 50,  h: 50,  kind: 'crate' },
  { x: 688,  y: 96,  w: 44,  h: 44,  kind: 'oil_drum' },      // fat vid lastbilen
  { x: 968,  y: 96,  w: 44,  h: 44,  kind: 'oil_drum' },
  { x: 150,  y: 62,  w: 150, h: 16,  kind: 'wooden_fence' },  // staket-accenter bak
  { x: 1400, y: 62,  w: 150, h: 16,  kind: 'wooden_fence' },
  // --- Skyttevärn (sandsäckar) framför vapenraden — segment med luckor ---
  { x: 150,  y: 460, w: 150, h: 34,  kind: 'sandbag' },
  { x: 560,  y: 460, w: 150, h: 34,  kind: 'sandbag' },
  { x: 990,  y: 460, w: 150, h: 34,  kind: 'sandbag' },
  { x: 1400, y: 460, w: 150, h: 34,  kind: 'sandbag' },
  // --- Mid-fält cover ---
  { x: 290,  y: 630, w: 30,  h: 150, kind: 'jersey_barrier' }, // vänster lane
  { x: 1380, y: 630, w: 30,  h: 150, kind: 'jersey_barrier' }, // höger lane
  { x: 470,  y: 668, w: 85,  h: 85,  kind: 'concrete' },
  { x: 1145, y: 668, w: 85,  h: 85,  kind: 'concrete' },
  { x: 700,  y: 700, w: 44,  h: 44,  kind: 'oil_drum' },       // center-kluster
  { x: 750,  y: 742, w: 44,  h: 44,  kind: 'fire_drum' },
  { x: 906,  y: 742, w: 44,  h: 44,  kind: 'fire_drum' },
  { x: 956,  y: 700, w: 44,  h: 44,  kind: 'oil_drum' },
  { x: 240,  y: 828, w: 74,  h: 74,  kind: 'crate' },          // lådstaplar
  { x: 1386, y: 828, w: 74,  h: 74,  kind: 'crate' },
  // --- Sido-segment längs kant — med LUCKA emellan (kika-runt) ---
  { x: 105,  y: 560, w: 38,  h: 130, kind: 'sandbag' },
  { x: 105,  y: 772, w: 34,  h: 130, kind: 'jersey_barrier' },
  { x: 1557, y: 560, w: 38,  h: 130, kind: 'sandbag' },
  { x: 1561, y: 772, w: 34,  h: 130, kind: 'jersey_barrier' },
];

// === MITTLINJE (symmetrisk runt y=1000) — ritas en gång ===
const _centerWalls = [
  { x: 555,  y: 936, w: 175, h: 128, kind: 'shipping_container' }, // vänster (korridor 730-970)
  { x: 970,  y: 936, w: 175, h: 128, kind: 'shipping_container' }, // höger
  { x: 195,  y: 933, w: 32,  h: 134, kind: 'jersey_barrier' },
  { x: 1473, y: 933, w: 32,  h: 134, kind: 'jersey_barrier' },
  { x: 470,  y: 978, w: 44,  h: 44,  kind: 'fire_drum' },          // flankerar korridoren
  { x: 1186, y: 978, w: 44,  h: 44,  kind: 'fire_drum' },
];

const TDM_ARENA = {
  worldW: TDM_W,
  worldH: TDM_H,
  name: 'ÖVNINGSFÄLTET',

  // 6 spridda spawns/lag på kortsidan (anti-spawn-camp + serverns pickFarthestSpawn).
  spawns: {
    red: [
      { x: 200, y: 265 }, { x: 460, y: 270 }, { x: 720, y: 262 },
      { x: 980, y: 270 }, { x: 1240, y: 262 }, { x: 1500, y: 268 },
    ],
    blue: null,
  },

  // Vapen på marken — RAD framför varje spawn. revolver/automatkarbin/burstpistol/sniper/hagel.
  weaponSpawns: [
    { x: 230,  y: 360, weaponId: 'revolver' },
    { x: 540,  y: 360, weaponId: 'rifle' },        // automatkarbin
    { x: 850,  y: 360, weaponId: 'burstpistol' },
    { x: 1160, y: 360, weaponId: 'sniper' },
    { x: 1470, y: 360, weaponId: 'shotgun' },      // hagelgevär
  ],

  // Granat-loot i MITTEN (korridoren mellan containrarna). v1.733: 8 spräng + 8 rök
  // att loota — man spawnar med 0 granater och greppar i mitten om man hinner.
  // 4×2-rutnät i den öppna korridoren (x 745-955, fri på all y mellan containrarna).
  grenadeSpawns: [ // 8 spränggranater (övre raderna)
    { x: 745, y: 900 }, { x: 815, y: 900 }, { x: 885, y: 900 }, { x: 955, y: 900 },
    { x: 745, y: 968 }, { x: 815, y: 968 }, { x: 885, y: 968 }, { x: 955, y: 968 },
  ],
  smokeSpawns: [ // 8 rökgranater (nedre raderna)
    { x: 745, y: 1032 }, { x: 815, y: 1032 }, { x: 885, y: 1032 }, { x: 955, y: 1032 },
    { x: 745, y: 1100 }, { x: 815, y: 1100 }, { x: 885, y: 1100 }, { x: 955, y: 1100 },
  ],

  // HP + shield i mid-fältet (symmetriskt)
  hpSpawns:     [{ x: 250, y: 1000 }, { x: 1450, y: 1000 }],
  shieldSpawns: [{ x: 850, y: 680 },  { x: 850, y: 1320 }],

  walls: [],
};

TDM_ARENA.spawns.blue = TDM_ARENA.spawns.red.map(p => _mirrorPt(p));
TDM_ARENA.weaponSpawns = TDM_ARENA.weaponSpawns.concat(
  TDM_ARENA.weaponSpawns.map(p => _mirrorPt(p, ['weaponId']))
);
// (hp/shield-arrayerna är redan symmetriska — spegla EJ, ger dubbletter)
TDM_ARENA.walls = _topWalls.concat(_topWalls.map(_mirrorWall)).concat(_centerWalls);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TDM_ARENA };
}
if (typeof window !== 'undefined') {
  window.TDM_ARENA = TDM_ARENA;
}
