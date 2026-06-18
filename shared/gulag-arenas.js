// GULAG — 1v1-arenor för Battle Royale. När en spelare dör helt (inget self-revive)
// hamnar de i en kö; servern parar ihop två döda spelare i ett av sex slumpade småspel.
// Vinnaren redeployar tillbaka i live-matchen, förloraren elimineras på riktigt.
//
// ARKITEKTUR: Gulag-matcher körs i SAMMA sim-värld som BR, fast på OFF-MAP-koordinater
// (långt utanför 10000×10000-kartan). Då återanvänds befintlig rörelse/kul/kollision/
// broadcast automatiskt (kameran följer spelaren dit). Servern äger regler/hp/vinst och
// LÄSER klient-positioner (rörelse är klient-auktoritär i PvP). Vägg-kollision + knockback
// + fall sker klient-side; servern detekterar utfall genom att läsa positioner.
'use strict';

// Off-map slot-origins — varje aktiv 1v1 får en egen ruta långt från kartan och från
// varandra (6000px isär; arenor är ~2000px breda → ingen överlapp, kulor kan ej korsa).
const GULAG_SLOT_COUNT = 8;
function gulagSlotOrigin(i) {
  // v1.792: POSITIVA off-map-koordinater INOM Int16-range (±32767). Wire-formatet
  // (server/sim/wirefmt.js) packar positioner som Int16 → de gamla -40000-koordinaterna
  // klampades till -32768, så spelaren hamnade utanför arenan (på void-koordinater) och
  // kameran kunde ej följa dit → svart skärm. 4×2-grid ovanför 10000×10000-kartan.
  // C168 (2026-06-18): sänkt bas 13000→12000 och stride 5000→4000 så slot 7 hamnar på
  // x=24000 (var 28000). Arena-halvbredd (~760) + spawn-offset + knockback (gulag_knockback
  // 620) tryckte tidigare spelaren mot x~28800 → tunn marginal mot Int16-taket 32767.
  // Nytt max ~24800 ger ~8000px buffert. x 12000–24000, y 12000–16000. Arenor ~±800px →
  // ryms med god marginal, och 4000px mellan centrum (arenor ~1600 breda, skjut-arenor har
  // perimeter-väggar) → kulor kan fortfarande ej korsa mellan samtidiga matcher.
  i = i % GULAG_SLOT_COUNT;
  return { x: 12000 + (i % 4) * 4000, y: 12000 + Math.floor(i / 4) * 4000 };
}

// ---- geometri-hjälpare (relativt arena-centrum 0,0; servern adderar origin) ----
function perimeter(halfW, halfH, t) {
  // 4 tjocka väggar precis UTANFÖR bounds (spelaren hålls inne i [-halfW,halfW]×[-halfH,halfH])
  t = t || 40;
  return [
    { x: -halfW - t, y: -halfH - t, w: 2 * halfW + 2 * t, h: t },          // topp
    { x: -halfW - t, y: halfH,      w: 2 * halfW + 2 * t, h: t },          // botten
    { x: -halfW - t, y: -halfH,     w: t, h: 2 * halfH },                  // vänster
    { x: halfW,      y: -halfH,     w: t, h: 2 * halfH },                  // höger
  ];
}
function abs(rect, ox, oy) { return { x: rect.x + ox, y: rect.y + oy, w: rect.w, h: rect.h }; }

// ============================ DE SEX SPELEN ============================
// Varje spel:
//   id, name, emoji, hint            — klient-display
//   shape                            — 'platform' | 'arena' | 'ring' | 'tilegrid'
//   loadout {weaponId, hp, shield}   — sätts på BÅDA spelarna vid start
//   noShoot                          — true = skjutning blockeras (Bomb Tag, Floor is Lava)
//   maxMs                            — hård tidsgräns (backstop)
//   build(ox,oy)                     — returnerar resolverad ABS-geometri + spel-params
const GULAG_GAMES = {

  // 1) THE VOID — knockback-sumo. Knuffa ut motståndaren över plattformskanten.
  void: {
    id: 'void', name: 'THE VOID', emoji: '🕳️',
    hint: 'Knuffa ut motståndaren i tomheten!',
    shape: 'platform',
    loadout: { weaponId: 'gulag_knock', hp: 100, shield: 0 }, // tar aldrig skada — fall = förlust
    groundColor: '#070712',
    maxMs: 35000,
    // v1.796: krymper snabbare (full krymp vid 24s, var 36s) + mindre slutplattform +
    // hårdare knuff → tvingar avgörande närkamp, undviker timeout-tiebreak.
    platformR0: 440, platformRmin: 105, shrinkStartMs: 4000, shrinkMs: 20000,
    knockForce: 205,  // B1.2 (2026-06-17): användaren ville ha ~25% av 820 (≈180px) →
                      // 205 ger ~45px knuff. Klientens event-force räknas ur knockForce.
    build(ox, oy) {
      return {
        shape: 'platform', groundColor: '#070712',
        platformX: ox, platformY: oy, platformR: 440,
        walls: [],
        spawns: [
          { x: ox - 280, y: oy, facing: 0 },
          { x: ox + 280, y: oy, facing: Math.PI },
        ],
      };
    },
  },

  // 2) ONE-SHOT — sudden death med mycket hinder. En träff = död.
  oneshot: {
    id: 'oneshot', name: 'ONE-SHOT', emoji: '🎯',
    hint: 'En träff dödar. Smyg mellan skydden!',
    shape: 'arena',
    loadout: { weaponId: 'pistol', hp: 1, shield: 0 },
    groundColor: '#241526',
    maxMs: 26000,  // v1.796: kortare (var 40s) — 1-hit-spel ska ej dra ut i camp-stalemate
    build(ox, oy) {
      const HW = 760, HH = 520;
      // Symmetriskt hinder-mönster (massa skydd) — v1.794: tätare labyrint-känsla
      const rel = [
        // mittpelare + två flankerande mittväggar
        { x: -45, y: -45, w: 90, h: 90 },
        { x: -20, y: -250, w: 40, h: 140 },
        { x: -20, y: 110, w: 40, h: 140 },
        // fyra långa väggar i ett kors-mönster
        { x: -260, y: -200, w: 60, h: 180 },
        { x: 200, y: -200, w: 60, h: 180 },
        { x: -260, y: 20, w: 60, h: 180 },
        { x: 200, y: 20, w: 60, h: 180 },
        // små pelare utspridda
        { x: -560, y: -360, w: 70, h: 70 },
        { x: 490, y: -360, w: 70, h: 70 },
        { x: -560, y: 290, w: 70, h: 70 },
        { x: 490, y: 290, w: 70, h: 70 },
        { x: -120, y: -380, w: 240, h: 55 },
        { x: -120, y: 325, w: 240, h: 55 },
        { x: -610, y: -40, w: 55, h: 80 },
        { x: 555, y: -40, w: 55, h: 80 },
        // v1.799: ett par diagonala block för flank-skydd (var 14 extra → för många)
        { x: -420, y: -130, w: 55, h: 55 },
        { x: 365, y: 75, w: 55, h: 55 },
      ];
      return {
        shape: 'arena', groundColor: '#241526',
        bounds: { x: ox - HW, y: oy - HH, w: 2 * HW, h: 2 * HH },
        walls: perimeter(HW, HH, 40).map(r => abs(r, ox, oy))
          .concat(rel.map(r => abs(r, ox, oy))),
        spawns: [
          { x: ox - HW + 90, y: oy, facing: 0 },
          { x: ox + HW - 90, y: oy, facing: Math.PI },
        ],
      };
    },
  },

  // 3) BLADE BRAWL — laser-svärds-närstrid i krympande ring (lava utanför).
  blade: {
    id: 'blade', name: 'BLADE BRAWL', emoji: '⚔️',
    hint: 'Katana! ~3 träffar. Håll dig i ringen!',
    shape: 'ring',
    loadout: { weaponId: 'katana', hp: 320, shield: 0 },
    groundColor: '#160707',
    maxMs: 35000,
    // v1.796: ringen krymper snabbare (full krymp vid 23s, var 37s) + mindre slutring
    // (range 78 → vid 120px ingen kiting) så svärdet avgör, inte timeouten.
    ringR0: 430, ringRmin: 120, shrinkStartMs: 3000, shrinkMs: 20000,
    lavaDps: 60,
    build(ox, oy) {
      return {
        shape: 'ring', groundColor: '#160707',
        ringX: ox, ringY: oy, ringR: 430,
        walls: [],
        spawns: [
          { x: ox - 250, y: oy, facing: 0 },
          { x: ox + 250, y: oy, facing: Math.PI },
        ],
      };
    },
  },

  // 4) POWERUP FRENZY — kaos-gunfight med slumpade powerups.
  frenzy: {
    id: 'frenzy', name: 'POWERUP FRENZY', emoji: '⚡',
    hint: 'Snappa powerups och döda motståndaren!',
    shape: 'arena',
    // v1.796: hp 140 (var 100) så vapen-powerups inte är instant-kill → counterplay.
    loadout: { weaponId: 'pistol', hp: 140, shield: 0 },
    groundColor: '#161630',
    maxMs: 32000,
    powerupEverMs: 900,           // v1.805: snabb spam (var 1700) + 10 förplacerade vid start
    build(ox, oy) {
      const HW = 680, HH = 500;
      const rel = [
        { x: -50, y: -180, w: 100, h: 60 },
        { x: -50, y: 120, w: 100, h: 60 },
        { x: -330, y: -30, w: 60, h: 60 },
        { x: 270, y: -30, w: 60, h: 60 },
      ];
      // powerup-spawn-punkter (relativt) — v1.794: många fler spots (kaos!)
      const pus = [
        { x: 0, y: 0 }, { x: -420, y: -300 }, { x: 420, y: -300 },
        { x: -420, y: 300 }, { x: 420, y: 300 }, { x: 0, y: -330 }, { x: 0, y: 330 },
        { x: -560, y: 0 }, { x: 560, y: 0 }, { x: -220, y: -180 }, { x: 220, y: -180 },
        { x: -220, y: 180 }, { x: 220, y: 180 }, { x: -560, y: -340 }, { x: 560, y: -340 },
        { x: -560, y: 340 }, { x: 560, y: 340 }, { x: -200, y: 0 }, { x: 200, y: 0 },
      ];
      return {
        shape: 'arena', groundColor: '#161630',
        bounds: { x: ox - HW, y: oy - HH, w: 2 * HW, h: 2 * HH },
        walls: perimeter(HW, HH, 40).map(r => abs(r, ox, oy))
          .concat(rel.map(r => abs(r, ox, oy))),
        powerupSpawns: pus.map(p => ({ x: p.x + ox, y: p.y + oy })),
        spawns: [
          { x: ox - HW + 80, y: oy, facing: 0 },
          { x: ox + HW - 80, y: oy, facing: Math.PI },
        ],
      };
    },
  },

  // 5) BOMB TAG — heta potatisen. Ingen skjutning. Nudda för att lämna över bomben.
  bombtag: {
    id: 'bombtag', name: 'BOMB TAG', emoji: '💣',
    hint: 'Nudda motståndaren för att lämna över bomben!',
    shape: 'arena',
    loadout: { weaponId: 'fists', hp: 100, shield: 0 }, // ingen skada — bomben avgör
    noShoot: true,
    groundColor: '#2a2a10',
    maxMs: 40000,
    bombMs: 22000, passCooldownMs: 750, contactRange: 72,  // B (2026-06-17): 48→72 — vid
    // 48 krävdes nästan full överlapp för att lämna över; 72 = "nudda" räcker. +15% fart hållaren.
    build(ox, oy) {
      const HW = 540, HH = 410;
      const rel = [
        { x: -180, y: -120, w: 70, h: 70 },
        { x: 110, y: -120, w: 70, h: 70 },
        { x: -180, y: 50, w: 70, h: 70 },
        { x: 110, y: 50, w: 70, h: 70 },
      ];
      return {
        shape: 'arena', groundColor: '#2a2a10',
        bounds: { x: ox - HW, y: oy - HH, w: 2 * HW, h: 2 * HH },
        walls: perimeter(HW, HH, 40).map(r => abs(r, ox, oy))
          .concat(rel.map(r => abs(r, ox, oy))),
        // v1.794: spawna NÄRA varandra (±170 = 340px isär, var ±460 = 920px) så
        // bomb-hållaren faktiskt har en chans att nudda över bomben innan tiden går ut.
        spawns: [
          { x: ox - 170, y: oy - 80, facing: 0 },
          { x: ox + 170, y: oy + 80, facing: Math.PI },
        ],
      };
    },
  },

  // 6) FLOOR IS LAVA — golvplattor faller bort. Sist kvar på fast mark vinner.
  floorlava: {
    id: 'floorlava', name: 'FLOOR IS LAVA', emoji: '🌋',
    hint: 'Plattorna faller! Knuffa ner motståndaren — sist på mark vinner!',
    shape: 'tilegrid',
    // B (2026-06-17): knuff-kanon så man kan PUTTA varandra ner i hålen (0 dmg, fall=förlust)
    loadout: { weaponId: 'gulag_knock', hp: 100, shield: 0 },
    noShoot: false,
    knockForce: 450,   // ~99px knuff — nog för att stöta motståndaren mot ett hål
    groundColor: '#3a1505',
    maxMs: 34000,                 // v1.796: kortare svans (var 45s)
    cols: 9, rows: 7, tile: 150,
    fallStartMs: 5000,            // grace innan första plattan VARNAS (v1.796: 5s)
    fallEveryMs: 750,             // bas-intervall mellan plattfall (accelererar, se tickGulag)
    warnMs: 650,                  // bas röd blink-förvarning (skalas i tickGulag, v1.796)
    standCrumbleMs: 2600,         // hur länge man kan stå på en platta innan den vacklar
    build(ox, oy) {
      const COLS = 9, ROWS = 7, T = 150;
      const gx = ox - (COLS * T) / 2;
      const gy = oy - (ROWS * T) / 2;
      const tiles = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          tiles.push({ c, r, x: gx + c * T + T / 2, y: gy + r * T + T / 2 });
        }
      }
      return {
        shape: 'tilegrid', groundColor: '#3a1505',
        cols: COLS, rows: ROWS, tile: T, gridX: gx, gridY: gy,
        tiles,
        walls: [],
        spawns: [
          { x: gx + 1 * T + T / 2, y: gy + 3 * T + T / 2, facing: 0 },
          { x: gx + 7 * T + T / 2, y: gy + 3 * T + T / 2, facing: Math.PI },
        ],
      };
    },
  },
};

const GULAG_GAME_IDS = Object.keys(GULAG_GAMES);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GULAG_GAMES, GULAG_GAME_IDS, GULAG_SLOT_COUNT, gulagSlotOrigin };
}
if (typeof window !== 'undefined') {
  window.GULAG_GAMES = GULAG_GAMES;
  window.GULAG_GAME_IDS = GULAG_GAME_IDS;
}
