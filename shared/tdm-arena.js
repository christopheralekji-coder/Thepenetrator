// Shared TDM-arena: "ÖVNINGSFÄLTET" — militär övningszon, fy_-koncept.
// Speglar pattern från ctf-arena.js så både server och klient laddar samma layout.
//
// KONCEPT (fy_ "fight yard"):
//  - Lagen spawnar längst BAK på var sin kortsida (RÖD uppe / BLÅ nere).
//  - Framför varje spawn ligger en RAD med olika vapen på marken man springer och greppar.
//  - GRANATER ligger i MITTEN (omstritt, exponerat mellan två containrar).
//  - Sidocover = väggsegment med LUCKOR emellan.
//  - Spawn-punkterna är spridda så man inte kan spawn-campa ett vapen (servern väljer
//    dessutom punkt längst från fiender vid respawn).
//  - Liten bana (2200×2600) = frenetisk närstrid.
//
// Tema: militär övningszon — sandsäckar, betongbarriärer, jersey-barriers,
// shipping-containrar, ammolådor, oljefat, vakttorn, tält, lastbil.
'use strict';

const TDM_W = 2200;
const TDM_H = 2600;
const TDM_MID_Y = TDM_H / 2; // 1300

// Spegla en vägg/punkt över horisontal-axeln (y = mitten) → blå sida.
function _mirrorWall(w) { return { x: w.x, y: TDM_H - w.y - w.h, w: w.w, h: w.h, kind: w.kind }; }
function _mirrorPt(p, extra) {
  const o = { x: p.x, y: TDM_H - p.y };
  if (extra) for (const k of extra) o[k] = p[k];
  return o;
}

// === RÖD SIDA (uppe, y < mitten) — speglas till blå sida nere ===
const _topWalls = [
  // Vakttorn i bakre hörnen (landmärken + cover vid spawn)
  { x: 70,   y: 95,  w: 95,  h: 95,  kind: 'hunting_tower' },
  { x: 2035, y: 95,  w: 95,  h: 95,  kind: 'hunting_tower' },
  // Tält + supply-lastbil i spawn-zonen
  { x: 470,  y: 100, w: 130, h: 95,  kind: 'tent' },
  { x: 1600, y: 100, w: 130, h: 95,  kind: 'tent' },
  { x: 980,  y: 95,  w: 240, h: 100, kind: 'truck' },
  // Sandsäcks-skyttevärn precis FRAMFÖR vapenraden — segment med luckor emellan
  { x: 230,  y: 665, w: 185, h: 38,  kind: 'sandbag' },
  { x: 760,  y: 665, w: 185, h: 38,  kind: 'sandbag' },
  { x: 1255, y: 665, w: 185, h: 38,  kind: 'sandbag' },
  { x: 1785, y: 665, w: 185, h: 38,  kind: 'sandbag' },
  // Sido-segment längs vänster/höger kant — med LUCKA emellan (kika-runt-cover)
  { x: 118,  y: 780,  w: 40, h: 175, kind: 'jersey_barrier' },
  { x: 118,  y: 1015, w: 40, h: 150, kind: 'sandbag' },
  { x: 2042, y: 780,  w: 40, h: 175, kind: 'jersey_barrier' },
  { x: 2042, y: 1015, w: 40, h: 150, kind: 'sandbag' },
  // Mid-fält cover (betong + fat + lådor) — symmetriskt vänster/höger
  { x: 520,  y: 905,  w: 95, h: 95, kind: 'concrete' },
  { x: 1585, y: 905,  w: 95, h: 95, kind: 'concrete' },
  { x: 870,  y: 880,  w: 52, h: 52, kind: 'oil_drum' },
  { x: 1278, y: 880,  w: 52, h: 52, kind: 'oil_drum' },
  { x: 330,  y: 1085, w: 80, h: 80, kind: 'crate' },
  { x: 1790, y: 1085, w: 80, h: 80, kind: 'crate' },
];

// === MITTLINJE (symmetrisk runt y=1300) — ritas en gång ===
const _centerWalls = [
  // Två shipping-containrar flankerar mitten → vertikal korridor i mitten där
  // granaterna ligger (exponerat & omstritt). Lämnar gap till sido-väggarna.
  { x: 700,  y: 1238, w: 175, h: 124, kind: 'shipping_container' },
  { x: 1325, y: 1238, w: 175, h: 124, kind: 'shipping_container' },
  // Jersey-barriers vid yttre mitten (sido-lane-cover)
  { x: 250,  y: 1233, w: 34,  h: 134, kind: 'jersey_barrier' },
  { x: 1916, y: 1233, w: 34,  h: 134, kind: 'jersey_barrier' },
];

const TDM_ARENA = {
  worldW: TDM_W,
  worldH: TDM_H,
  name: 'ÖVNINGSFÄLTET',

  // Spawn-pooler: 6 spridda punkter på var sin kortsida. Spridningen + serverns
  // pickFarthestSpawn (respawn) gör att man inte kan spawn-campa ett vapen.
  spawns: {
    red:  [
      { x: 260, y: 275 }, { x: 620, y: 285 }, { x: 980, y: 270 },
      { x: 1340, y: 285 }, { x: 1700, y: 275 }, { x: 1960, y: 285 },
    ].slice(),
    blue: null, // fylls nedan via spegling
  },

  // Vapen på marken — RAD framför varje spawn. Samma uppsättning för båda lag
  // (speglat i y). revolver / automatkarbin / burstpistol / sniper / hagelgevär.
  weaponSpawns: [
    { x: 300,  y: 470, weaponId: 'revolver' },
    { x: 720,  y: 470, weaponId: 'rifle' },        // automatkarbin
    { x: 1100, y: 470, weaponId: 'burstpistol' },
    { x: 1480, y: 470, weaponId: 'sniper' },
    { x: 1900, y: 470, weaponId: 'shotgun' },      // hagelgevär
  ],

  // Granater i mitten (omstritt). Ligger i korridoren mellan containrarna.
  grenadeSpawns: [
    { x: 950,  y: 1300 },
    { x: 1250, y: 1300 },
    { x: 1100, y: 1175 },
    { x: 1100, y: 1425 },
  ],

  walls: [],
};

// Spegla spawns → blå
TDM_ARENA.spawns.blue = TDM_ARENA.spawns.red.map(p => _mirrorPt(p));
// Spegla vapenrad → blå (lägg till blå-raden)
TDM_ARENA.weaponSpawns = TDM_ARENA.weaponSpawns.concat(
  TDM_ARENA.weaponSpawns.map(p => _mirrorPt(p, ['weaponId']))
);
// Bygg väggar: röd sida + speglad blå sida + mittlinje
TDM_ARENA.walls = _topWalls.concat(_topWalls.map(_mirrorWall)).concat(_centerWalls);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TDM_ARENA };
}
if (typeof window !== 'undefined') {
  window.TDM_ARENA = TDM_ARENA;
}
