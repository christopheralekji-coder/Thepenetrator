// CASTLE DEFENSE — co-op tower defense (v2 REDESIGN: directional castle siege)
//
// OMDESIGN 2026-06-22: ett RIKTIGT SLOTT i NORR = det man skyddar (ersätter den
// gamla centrala obelisk-kärnan). Fienderna spawnar i SÖDER och marscherar NORRUT
// mot slottet. Spelarna bygger murar/portar/fällor i FÄLTET (mellan söder och
// slottet) för att tratta/sinka anmarschen, och eldar från slottet.
//
// Karta: 4000×4000 px. Slottet upptar norra mitten. Solida slottsväggar (blockerar
// ALLT inkl. kulor) med en central PORT-öppning. 6 battlement-slots på sydväggen =
// ENDA platsen för machinegun/bomber-torn. Inne i slottet: TRON (mitten, höjer
// slott-HP), HEAL-NPC (väster, helar spelare), REPAIR-NPC (öster, reparerar slottet).
//
'use strict';

// ── Slottets geometri (norra mitten) ─────────────────────────────────────────
// Footprint x:[1200,2800] y:[200,1000]. Interiör-golv innanför de ~50px tjocka väggarna.
const CASTLE = {
  x: 1200, y: 200, w: 1600, h: 800,          // ytterkant (footprint)
  interior: { x: 1250, y: 250, w: 1500, h: 700 }, // golv innanför väggarna
  wallThick: 50,
  // Central PORT-öppning i sydväggen (slottets egen entré — spelare gör utfall här,
  // fiender trattas in här om inget byggts framför). Gap i x.
  gate: { x: 1900, w: 200, y: 950, h: 50 },  // öppning x:[1900,2100] i sydväggen
};

// SOLIDA slottsväggar (kind:'castle_wall') — blockerar spelare, fiender OCH kulor/granater.
// Sydväggen är delad av port-gapet (x:1900–2100). Tjocklek 50.
const CASTLE_WALLS = [
  { x: 1200, y: 200,  w: 1600, h: 50 },   // NORR (hela bredden)
  { x: 1200, y: 200,  w: 50,   h: 800 },  // VÄSTER
  { x: 2750, y: 200,  w: 50,   h: 800 },  // ÖSTER
  { x: 1200, y: 950,  w: 700,  h: 50 },   // SÖDER-väst  (x:1200→1900)
  { x: 2100, y: 950,  w: 700,  h: 50 },   // SÖDER-öst   (x:2100→2800)
];

// 6 BATTLEMENT-SLOTS på sydväggen (skjutpositioner, vända söderut mot anmarschen).
// 3 väster om porten, 3 öster. ENDA platsen man får bygga machinegun/bomber.
const BATTLEMENT_SLOTS = [
  { id: 'slot0', x: 1380, y: 1000 },
  { id: 'slot1', x: 1620, y: 1000 },
  { id: 'slot2', x: 1850, y: 1000 },
  { id: 'slot3', x: 2150, y: 1000 },
  { id: 'slot4', x: 2380, y: 1000 },
  { id: 'slot5', x: 2620, y: 1000 },
];

const CASTLEDEFENSE_ARENA = {
  worldW: 4000,
  worldH: 4000,
  name: 'NORDFÄSTET',
  groundColor: '#2e3e22',           // mörk-grön gräs-bas (fältet)
  plazaColor: '#5a5450',            // sten-golv (slottets interiör)
  pathColor: '#6a5a48',             // sten-väg söder→port

  // === SLOTTET (geometri) ===
  castle: CASTLE,
  castleWalls: CASTLE_WALLS,        // solida (blockerar allt inkl. kulor)
  battlementSlots: BATTLEMENT_SLOTS,

  // === CASTLE-HP (det man skyddar) — "core" för bakåtkompat med sim:ens lose-check.
  // Placerad i slottets mitt; fiender skadar den när de bryter igenom sydväggen/porten
  // och når interiören. TRON-uppgraderingen höjer maxHp (10 nivåer). Game-over vid hp<=0.
  core: {
    x: 2000, y: 600,                // slottets mitt
    r: 110,
    hp: 6000,
    maxHp: 6000,
    color: '#cfae6a',
    glowColor: '#ffe39a',
    runeColor: '#7fd0ff',
  },

  // === SLOTTS-INTERIÖR: TRON + 2 NPC:er (uppgraderas inifrån, börjar lvl 0) ===
  // Tron = mitten (höjer castle maxHp). Heal-NPC = väster (helar SPELARE i radie).
  // Repair-NPC = öster (reparerar SLOTTETS hp). Alla 10 nivåer, lvl 0 = ingen effekt.
  castleNpcs: {
    throne:     { x: 2000, y: 560, r: 26 },   // mitten
    heal_npc:   { x: 1500, y: 560, r: 22 },   // VÄSTER — helar spelare
    repair_npc: { x: 2500, y: 560, r: 22 },   // ÖSTER  — reparerar slottet
    weapon_vendor: { x: 2000, y: 340, r: 24 }, // BAKOM TRONEN (norr) — säljer vapen för guld
  },
  // Uppgraderings-kurvor för de tre slotts-spåren (lvl 1..10; lvl 0 = bas/ingen effekt).
  // BALANS 2026-06-23: plattare costExp + lägre bas så lvl 5-7 är nåbart mid-game.
  castleUpgrades: {
    // TRON: castle maxHp = base + per-nivå. lvl0=6000 → lvl10=21000.
    throne:     { baseCost: 700, costExp: 1.15, hpPerLvl: 1500 },
    // HEAL-NPC: helar spelare i radie. lvl0 = 0 hp/s. +4.0 hp/s per nivå → lvl10 = 40 hp/s. Större radie.
    heal_npc:   { baseCost: 450, costExp: 1.14, healPerSecPerLvl: 4.0, radius: 300 },
    // REPAIR-NPC: reparerar slottets hp. lvl0 = 0 hp/s. +16 hp/s per nivå → lvl10 = 160 hp/s.
    repair_npc: { baseCost: 520, costExp: 1.14, castleHealPerSecPerLvl: 16 },
  },
  // === VAPENHANDLARE (weapon_vendor) — köp vapen för GULD (engångs-grant + auto-equip).
  // Mycket dyrt = sen-spel-lyx; pris × difficulty-mul vid köp. sniper/rifle finns BARA här.
  weaponVendor: {
    knife:        { tier: 1, cost: 4000 },
    shotgun:      { tier: 1, cost: 5000 },
    dualpistol:   { tier: 1, cost: 5000 },
    smg:          { tier: 1, cost: 5500 },
    autoshotgun:  { tier: 2, cost: 8500 },
    ak:           { tier: 2, cost: 9000 },
    rifle:        { tier: 2, cost: 9000 },
    dualuzi:      { tier: 2, cost: 9500 },
    katana:       { tier: 2, cost: 10000 },
    lmg:          { tier: 2, cost: 11000 },
    flame:        { tier: 3, cost: 16000 },
    sniper:       { tier: 4, cost: 24000 },
    minigun:      { tier: 4, cost: 26000 },
    rocket:       { tier: 4, cost: 40000 },
  },

  // === PRE-BUILT FÄLT-MURAR === (inga — spelaren bygger allt i fältet)
  walls: [],

  // === PLAYER SPAWN-POINTS === (inne i slottet, nära porten för utfall)
  playerSpawns: [
    { x: 1950, y: 880 },
    { x: 2050, y: 880 },
    { x: 1850, y: 820 },
    { x: 2150, y: 820 },
  ],

  // === ENEMY SPAWN-RING === (SÖDRA kanten — 9 punkter; marscherar NORRUT mot slottet)
  enemySpawns: [
    { x: 500,  y: 3850 }, { x: 900,  y: 3850 }, { x: 1300, y: 3850 },
    { x: 1700, y: 3850 }, { x: 2100, y: 3850 }, { x: 2500, y: 3850 },
    { x: 2900, y: 3850 }, { x: 3300, y: 3850 }, { x: 3700, y: 3850 },
  ],
  // Fiendernas mål-punkt (porten i sydväggen) — flow-field byggs mot denna.
  enemyGoal: { x: 2000, y: 1000 },

  // === DECORATIONS (visuella — klienten läser direkt, ingen bandbredd) ===
  decorations: [
    // Facklor på battlement-slotsens kanter + port
    { kind: 'torch', x: 1300, y: 940 }, { kind: 'torch', x: 2700, y: 940 },
    { kind: 'torch', x: 1880, y: 940 }, { kind: 'torch', x: 2120, y: 940 },
    // Banér på sydväggen
    { kind: 'banner', x: 1500, y: 980 }, { kind: 'banner', x: 2500, y: 980 },
    // Sten-väg från söder mot porten
    { kind: 'path', x: 1950, y: 1000, w: 100, h: 2850 },
    // Spridda fält-stenar/träd (visuella, ingen kollision)
    { kind: 'rock', x: 700, y: 2400 }, { kind: 'rock', x: 3300, y: 2200 },
    { kind: 'tree', x: 1100, y: 2900 }, { kind: 'tree', x: 2950, y: 2700 },
    { kind: 'tree', x: 600, y: 1600 },  { kind: 'tree', x: 3500, y: 1500 },
  ],

  // === START-UTRUSTNING + SPELAR-STATS ===
  startWeapon: 'pistol',
  startGrenades: 2,
  startHp: 100,
  maxHp: 100,
  startShield: 100,                 // sköld-system (samma som PvP) — skydd mot minions
  maxShield: 100,
  weaponProgression: [
    'pistol',      // 0 — start
    'shotgun',     // 1 — boss 1 (wave 5)
    'smg',         // 2 — boss 2 (wave 10)
    'autoshotgun', // 3 — boss 3 (wave 15)
    'rifle',       // 4 — boss 4 (wave 20)
    'ak',          // 5 — boss 5 (wave 25)
    'flame',       // 6 — boss 6 (wave 30)
    'minigun',     // 7 — boss 7 (wave 35)
    'rocket',      // 8 — FINAL boss 8 (wave 40)
  ],
  grenadesPerWave: 2,

  // === 10 Hero-perks (unika per spelare) ===
  // STRATEGIST riktar nu mot SLOT-tornen (machinegun/bomber) i st.f. gamla auto-turrets.
  heroPerks: [
    { id: 'tank',         icon: '🛡', name: 'TANK',         desc: '+50% maxHP · -20% rörelse · -25% melee-dmg' },
    { id: 'builder',      icon: '🏗', name: 'BUILDER',      desc: '-30% bygg + uppgrade-cost · gratis första mur/wave' },
    { id: 'gunner',       icon: '💥', name: 'GUNNER',       desc: '+40% vapen-skada · +30% ammo-cap' },
    { id: 'medic',        icon: '💚', name: 'MEDIC',        desc: 'Auto-regen 2hp/s · revive 2x snabbare · heal-NPC +50%' },
    { id: 'scout',        icon: '⚡', name: 'SCOUT',        desc: '+40% rörelsehastighet · +50% dash-cooldown-reduction' },
    { id: 'sharpshooter', icon: '🎯', name: 'SHARPSHOOTER', desc: '25% chans crit (2x dmg) · +50% bullet-räckvidd' },
    { id: 'strategist',   icon: '🧠', name: 'STRATEGIST',   desc: 'Slott-torn (machinegun/bomber) får +35% dmg + range' },
    { id: 'berserker',    icon: '🔥', name: 'BERSERKER',    desc: 'Vid <50% hp: +1% dmg per saknad hp (max +50%)' },
    { id: 'looter',       icon: '💰', name: 'LOOTER',       desc: '+60% gold från kills · 10% chans ammo-drop' },
    { id: 'gambler',      icon: '🎲', name: 'GAMBLER',      desc: '15% chans efter kill: 3x gold / +1 granat / shield-refill' },
  ],

  // === PERK-TRÄD-SYSTEM (v3) — 5 träd × 3 noder (tier 1→3, betas uppifrån-ner). ===
  // Varje nod-köp höjer en RANK och sätter en FLAGGA (flag) = rankvärdet. Servern läser
  // flaggorna för effekter (cdFlags). tier N kräver tier N-1 (samma träd) rank>=1.
  // 1 perk-poäng VARANNAN clearad våg (perkPointEveryWaves). Ersätter heroPerks som
  // effekt-källa (heroPerks behålls orörd nedan för bakåtkompat). Klienten renderar
  // detta direkt från cd_started (perkTrees + perkPoints).
  perkPointEveryWaves: 2,
  perkTrees: [
    {
      id: 'juggernaut', name: 'JUGGERNAUT', icon: '🛡', color: '#5a9bd4',
      nodes: [
        { id: 'jug_hp',        tier: 1, maxRank: 3, flag: 'tank',      name: 'PANSAR',        desc: '+18% maxHP per rank' },
        { id: 'jug_regen',     tier: 2, maxRank: 2, flag: 'regen',     name: 'REGENERERING',  desc: '+2 hp/s per rank (passiv)' },
        { id: 'jug_last',      tier: 3, maxRank: 2, flag: 'berserker', name: 'BARSARK',       desc: 'Vid <40% hp: skada x1.2 per rank (x1.4 maxad)' },
        { id: 'jug_thorns',    tier: 4, maxRank: 2, flag: 'thorns',    name: 'TAGGPANSAR',    desc: 'Narstrids-anfall mot dig ger 30 skada tillbaka per rank' },
        { id: 'jug_laststand', tier: 5, maxRank: 2, flag: 'laststand', name: 'SISTA UTPOSTEN', desc: '1x/vag: overlev dodlig traff. r1 35% hp+1.75s. r2 45% hp+skold+2.5s' },
      ],
    },
    {
      id: 'artillerist', name: 'ARTILLERIST', icon: '💥', color: '#e08a3a',
      nodes: [
        { id: 'art_dmg',    tier: 1, maxRank: 3, flag: 'gunner',       name: 'GROVKALIBER',  desc: '+15% vapen-skada per rank' },
        { id: 'art_aim',    tier: 2, maxRank: 2, flag: 'sharpshooter', name: 'PRICKSKYTT',   desc: '+12% crit, +25% rackvidd per rank' },
        { id: 'art_over',   tier: 3, maxRank: 2, flag: 'overdmg',      name: 'OVERLADDNING', desc: 'All skada x1.125 per rank (x1.25 maxad)' },
        { id: 'art_rush',   tier: 4, maxRank: 2, flag: 'frenzy',       name: 'STRIDSRUS',    desc: 'Varje kill: +6% skada/rank per stack (max 5). Nollas efter 3s' },
        { id: 'art_pierce', tier: 5, maxRank: 2, flag: 'overpen',      name: 'GENOMSLAG',    desc: 'Kulor tranger genom 1 fiende per rank (2 maxad)' },
      ],
    },
    {
      id: 'arkitekt', name: 'ARKITEKT', icon: '🏗', color: '#54b59a',
      nodes: [
        { id: 'arch_cost',  tier: 1, maxRank: 2, flag: 'builder',    name: 'BYGGMASTARE', desc: '-15% bygg/uppgrade-kostnad per rank' },
        { id: 'arch_boost', tier: 2, maxRank: 2, flag: 'strategist', name: 'STRATEG',     desc: 'Dina torn nara dig +20% skada per rank' },
        { id: 'arch_fort',  tier: 3, maxRank: 2, flag: 'fortress',   name: 'FASTNING',    desc: 'Dina torn nara dig +10% rackvidd per rank (+20% maxad)' },
        { id: 'arch_mend',  tier: 4, maxRank: 2, flag: 'mender',     name: 'FALTINGENJOR', desc: 'Dina byggen nara dig repareras +15 hp/s per rank (gratis)' },
        { id: 'arch_salvo', tier: 5, maxRank: 2, flag: 'salvo',      name: 'ARTILLERISALVA', desc: 'Dina torn nara dig skjuter extra splitterkula: 25% skada/rank' },
      ],
    },
    {
      id: 'faltmedic', name: 'FALTMEDIC', icon: '💚', color: '#7bd47b',
      nodes: [
        { id: 'med_heal',  tier: 1, maxRank: 2, flag: 'medic',     name: 'FALTMEDIC',   desc: '+2 hp/s sjalv per rank, heal-NPC x1.5' },
        { id: 'med_rev',   tier: 2, maxRank: 2, flag: 'medicrev',  name: 'LIVRADDARE',  desc: 'Ateruppliva snabbare: x0.75 tid/rank (2x maxad)' },
        { id: 'med_hosp',  tier: 3, maxRank: 2, flag: 'medichosp', name: 'FALTSJUKHUS', desc: 'Aterupplivnings-radie +25% per rank (+50% maxad)' },
        { id: 'med_aura',  tier: 4, maxRank: 2, flag: 'medaura',   name: 'VARDAURA',    desc: 'Lagkamrater inom 200px regenererar +2 hp/s per rank' },
        { id: 'med_defib', tier: 5, maxRank: 2, flag: 'meddefib',  name: 'DEFIBRILLATOR', desc: 'Den du aterupplivar: r1 75% hp+3s. r2 full hp+skold+5s' },
      ],
    },
    {
      id: 'lycksokare', name: 'LYCKSOKARE', icon: '💰', color: '#e0c24a',
      nodes: [
        { id: 'for_loot',       tier: 1, maxRank: 2, flag: 'looter',     name: 'PLUNDRARE',  desc: '+40% guld fran kills per rank' },
        { id: 'for_speed',      tier: 2, maxRank: 2, flag: 'scout',      name: 'SPEJARE',    desc: '+20% gang-fart per rank, -0.5s dash-cd per rank' },
        { id: 'for_jack',       tier: 3, maxRank: 2, flag: 'gambler',    name: 'HASARDOR',   desc: 'Kill-jackpot 10%/rank (3x guld/granat/skold), +150 guld/vag per rank' },
        { id: 'for_bloodmoney', tier: 4, maxRank: 2, flag: 'bloodmoney', name: 'BLODSPENGAR', desc: '+1% skada per 1500 obrukat guld (max +15% per rank)' },
        { id: 'for_lastbet',    tier: 5, maxRank: 2, flag: 'lastbet',    name: 'SISTA SATSNINGEN', desc: 'Fuska doden: 16%/rank chans (45% hp+skold), 30s cd' },
      ],
    },
    {
      id: 'kryomant', name: 'KRYOMANT', icon: '❄', color: '#6fd0e0',
      nodes: [
        { id: 'cryo_aura',    tier: 1, maxRank: 3, flag: 'cryo_aura',    name: 'FROSTAURA',  desc: 'Fiender inom 140px saktas -12% fart per rank (golv 40%)' },
        { id: 'cryo_brittle', tier: 2, maxRank: 2, flag: 'cryo_brittle', name: 'SPRODIS',    desc: 'Saktade fiender tar +15% skada per rank (hela laget)' },
        { id: 'cryo_nova',    tier: 3, maxRank: 2, flag: 'cryo_nova',    name: 'FROSTNOVA',  desc: 'Var 12:e sek: nova fryser + 30 skada/rank i 220px' },
        { id: 'cryo_chill',   tier: 4, maxRank: 2, flag: 'cryo_chill',   name: 'RIMFROST',   desc: 'Fiender i din frostaura tar 8 frost-skada/s per rank' },
        { id: 'cryo_roar',    tier: 5, maxRank: 2, flag: 'warhorn',      name: 'STRIDSVRAL', desc: 'AKTIV (60s cd): knuffa + sakta alla fiender i 260px/rank' },
      ],
    },
    {
      id: 'ultimat', name: 'ULTIMAT', icon: '⭐', color: '#c9a0ff',
      nodes: [
        { id: 'cap_warlord',  tier: 1, maxRank: 2, flag: 'cap_warlord',  name: 'STALSTORM',  requires: ['jug_hp', 'art_dmg'],     desc: 'Kraver PANSAR+GROVKALIBER. Over 80% hp: all skada x1.15 per rank (x1.3 maxad)' },
        { id: 'cap_warchest', tier: 1, maxRank: 2, flag: 'cap_warchest', name: 'KRIGSKASSA', requires: ['arch_cost', 'for_loot'], desc: 'Kraver BYGGMASTARE+PLUNDRARE. 12.5%/rank av ditt kill-guld delas till laget' },
      ],
    },
  ],

  // === DOWN-STATE ===
  downBleedoutSec: 25,
  downReviveSec: 4,
  downCrawlSpeedMul: 0.5,
  downReviveRadius: 60,

  // === WAVE-SCALING ===
  waveBaseCount: 8,
  waveScalePerWave: 4,
  waveBetweenSec: 5,                 // 10→5: snabbare tempo mellan vågor (feedback)
  waveActiveMaxSec: 14,              // nästa våg överlappar in efter 14s även om fiender lever (ej boss)
  bossEveryWave: 5,

  // === BUILD-SYSTEM ===
  // BALANS 2026-06-23: mer start-guld (mur-linje+torn vid start), lägre flat wave-bonus
  // (kills ska betyda mer tidigt — kompenseras av höjt kill-guld i enemies.js).
  buildGridSize: 30,
  startGold: 900,                    // 700→900
  waveBonusBase: 140,                // 200→140
  waveBonusPerWave: 34,              // 38→34

  // === FÄLT-BYGGEN (radial-meny, alla 10 nivåer) ===
  // Mur/port = solida mot SPELARE + FIENDER (men kulor/granater går ÖVER). Fällor =
  // gå-bara (effekt vid överlappning). buildKind-flaggor styr sim-beteende i fas 2.
  buildables: {
    // 🧱 MUR — ogenomtränglig för spelare+fiender, kulor/granater går ÖVER.
    wall:         { cost: 60,  hp: 300, w: 30, h: 30, hpScalePerLvl: 1.2, solid: true, blocksBullets: false },
    // 🚪 PORT — som mur men SPELAR-passerbar; öppnas/stängs manuellt (fiender slinker
    // in medan öppen). Stängd = blockerar fiender; öppen = passerbar för alla.
    gate:         { cost: 100, hp: 500, w: 60, h: 30, hpScalePerLvl: 1.2, solid: true, blocksBullets: false, openable: true },
    // ⚔️ SPIKFÄLLA — dmg vid passage; SLUTAR funka efter killCapacity fiender.
    spike_trap:   { cost: 160, hp: 250, w: 30, h: 30, dmgOnPass: 60, killCapacity: 20, trap: true },
    // 🛢️ TJÄRGROP — saktar fiender i radie (slow-aura).
    tar_trap:     { cost: 250, hp: 120, w: 30, h: 30, slowMul: 0.4, slowDurSec: 2, radius: 140, trap: true },
    // 🔥 OLJEBRAND — AoE eld-DoT-zon mot fiender; TIDSBEGRÄNSAD (brinner ut).
    oil_fire:     { cost: 240, hp: 80,  w: 30, h: 30, dps: 45, radius: 95, burnSec: 12, trap: true },
    // 💥 KRUT-TUNNA — placeras ut; SKJUT på den → exploderar (AoE) + lämnar eld-spår.
    powder_barrel:{ cost: 170, hp: 70,  w: 30, h: 30, blastDmg: 380, blastRadius: 150, trailDps: 30, trailSec: 6, barrel: true },
  },

  // === SLOT-TORN (byggs ENDAST i de 6 battlement-slotsen; hybrid auto + sätt-dig) ===
  // Auto-skjuter mot närmaste fiende; sätter man sig får tornet manuell sikt + dmg-boost.
  // Bomber skjuter i BÅGE över fält-murarna.
  slotBuildables: {
    machinegun: { cost: 520, hp: 450, range: 420, dps: 32, fireRate: 4.0, manDpsMul: 1.8 },
    bomber:     { cost: 950, hp: 450, range: 520, dps: 60, fireRate: 0.85, blastRadius: 95, manDpsMul: 1.6, arcsOverWalls: true },
  },

  // === LEVEL-SYSTEM (10 uppgraderingsnivåer på ALLT: byggen, slot-torn, slott-spår) ===
  maxBuildLevel: 10,                 // 9→10 (10 uppgrade-nivåer)
  // BALANS 2026-06-23: plattare exponent så lvl 5-8 är nåbart mid-game (slapp dead-zone).
  upgradeCostBase: 0.55,             // 0.5→0.55 (lvl1-2 kostar lite mer)
  upgradeCostExp: 1.15,              // 1.2→1.15 (maxat torn ~17.5k i st f 22.5k)
  upgradeStatMul: {
    hp:    0.50,    // +50% hp/lvl
    dps:   0.45,    // +45% dps/lvl
    range: 0.10,    // +10% range/lvl
    heal:  0.40,    // +40% healing/lvl
    dmg:   0.40,    // +40% dmg/lvl (spik/oljebrand/krut-tunna)
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CASTLEDEFENSE_ARENA };
}
