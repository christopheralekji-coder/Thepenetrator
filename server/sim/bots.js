// Bot-system: server-styrd AI som spelar med/mot riktiga spelare.
// En bot per match (MVP). Per-mode AI bestämmer mål och beteende.
//
// Bot är en virtuell "fake-ws"-member i sim.room.members. Den har playerState
// och tdmTeam precis som riktiga spelare, så buildPlayerList + broadcastWorld
// inkluderar den automatiskt. Klienten ser bot som en annan spelare.
//
// AI är pragmatic: walk-towards-target + shoot-when-in-range. Ingen path-finding,
// så bots kan fastna i hörn — acceptabelt för MVP. Räcker för testning/solo-play.
'use strict';

const { W_BY_ID } = require('../../shared/weapons-data');
const { KOTH_ARENA } = require('../../shared/koth-arena');
const { BATTLEROYALE_ARENA } = require('../../shared/battleroyale-arena');
// v1.666: vägg-medveten styrning — bots fastnade på väggar (ingen pathfinding) och
// strafe:ade "upp och ner i basen". Behöver mode-väggar + en punkt-blockerad-test.
const { CTF_ARENA, bulletHitsWall } = require('../../shared/ctf-arena');
const { SIEGE_ARENA } = require('../../shared/siege-arena');
const { GUNGAME_ARENA } = require('../../shared/gungame-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');
// V2: juggernaut/heist hade väggdata men kopplades ALDRIG in i bot-navigeringen →
// bots sprang rakt in i väggar (ingen pathfinding/LoS) i de lägena. Castledefense har
// tomma walls (öppen plaza) men egna world-dims för clamp.
const { JUGGERNAUT_ARENA } = require('../../shared/juggernaut-arena');
const { HEIST_ARENA } = require('../../shared/heist-arena');
// v1.667: riktig A*-pathfinding (nav-grid + string-pull) ersätter reaktiv steerAround
// som primär ruttläggning. steerAround behålls som lokal säkerhetsnät mellan waypoints.
const { nextWaypoint } = require('./pathfind');

// Väggar för aktivt mode (null = öppen arena, ingen styrning behövs).
function getActiveWalls(sim) {
  if (sim.ctfActive) return CTF_ARENA.walls;
  if (sim.siegeActive) return SIEGE_ARENA.walls;
  if (sim.gungameActive) return GUNGAME_ARENA.walls;
  if (sim.kothActive) return KOTH_ARENA.walls;
  if (sim.battleroyaleActive) return BATTLEROYALE_ARENA.walls;
  if (sim.juggernautActive) return JUGGERNAUT_ARENA.walls || null;
  if (sim.heistActive) return HEIST_ARENA.walls || null;
  if (sim.tdmActive) return TDM_ARENA.walls || null;
  return null;
}

// Arena-dimensioner per mode (delas av pathfinding + position-clamp).
function getWorldDims(sim) {
  if (sim.tdmArena && sim.tdmArena.worldW) return { worldW: sim.tdmArena.worldW, worldH: sim.tdmArena.worldH };
  if (sim.ctfActive) return { worldW: CTF_ARENA.worldW, worldH: CTF_ARENA.worldH };
  if (sim.siegeActive) return { worldW: SIEGE_ARENA.worldW || 5000, worldH: SIEGE_ARENA.worldH || 3000 };
  if (sim.juggernautActive) return { worldW: JUGGERNAUT_ARENA.worldW || 5000, worldH: JUGGERNAUT_ARENA.worldH || 3500 };
  if (sim.heistActive) return { worldW: HEIST_ARENA.worldW || 4000, worldH: HEIST_ARENA.worldH || 4000 };
  if (sim.castledefenseActive) return { worldW: 4000, worldH: 4000 };
  if (sim.battleroyaleActive) return { worldW: BATTLEROYALE_ARENA.worldW, worldH: BATTLEROYALE_ARENA.worldH };
  if (sim.gungameActive) return { worldW: GUNGAME_ARENA.worldW || 3500, worldH: GUNGAME_ARENA.worldH || 2000 };
  if (sim.kothActive) return { worldW: KOTH_ARENA.worldW || 3500, worldH: KOTH_ARENA.worldH || 2000 };
  return { worldW: 5000, worldH: 3000 };
}

// v1.671: Line-of-sight — är linjen (x0,y0)->(x1,y1) blockerad av en aktiv vägg?
// Samma wall-set som bulletHitsWall, så LoS-blockerad ⟺ kulan skulle träffa väggen
// FÖRE målet. Används för att (a) inte skjuta genom väggar, (b) tvinga boten runt
// väggar för att nå sitt kill-mål. Liang-Barsky segment-vs-AABB per vägg.
function losBlocked(sim, x0, y0, x1, y1) {
  const walls = getActiveWalls(sim);
  if (!walls || !walls.length) return false;
  const dx = x1 - x0, dy = y1 - y0;
  // PERF: bounding-box-broadphase. En LoS-linje är kort (≤720px); de allra flesta väggar
  // ligger helt utanför segmentets bbox och kan slängas med 4 jämförelser INNAN den dyra
  // Liang-Barsky-testen. Kritiskt i BR (2694 väggar) × många bots → annars [SLOW-TICK].
  const segMinX = x0 < x1 ? x0 : x1, segMaxX = x0 < x1 ? x1 : x0;
  const segMinY = y0 < y1 ? y0 : y1, segMaxY = y0 < y1 ? y1 : y0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.x > segMaxX || w.x + w.w < segMinX || w.y > segMaxY || w.y + w.h < segMinY) continue;
    let tMin = 0, tMax = 1, hit = true;
    const checks = [
      { p: -dx, q: x0 - w.x },
      { p:  dx, q: (w.x + w.w) - x0 },
      { p: -dy, q: y0 - w.y },
      { p:  dy, q: (w.y + w.h) - y0 },
    ];
    for (let c = 0; c < 4; c++) {
      const ch = checks[c];
      if (ch.p === 0) { if (ch.q < 0) { hit = false; break; } }
      else {
        const t = ch.q / ch.p;
        if (ch.p < 0) { if (t > tMax) { hit = false; break; } if (t > tMin) tMin = t; }
        else          { if (t < tMin) { hit = false; break; } if (t < tMax) tMax = t; }
      }
    }
    if (hit && tMin <= tMax) return true;
  }
  return false;
}

// Vägg-medveten styrning: gå mot (hx,hy) men om en probe-punkt framför är inne i en
// vägg, vrid undan (prova allt större vinklar) tills en fri riktning hittas. Gör att
// bots flödar RUNT väggar istället för att fastna (resolveCtfWall stoppade dem annars).
function steerAround(sim, ps, hx, hy, speed, dt) {
  const walls = getActiveWalls(sim);
  if (walls && walls.length) {
    const probe = 62, R = 16;
    const blocked = (nx, ny) => bulletHitsWall({ x: ps.x + nx * probe, y: ps.y + ny * probe, r: R }, walls);
    if (blocked(hx, hy)) {
      const baseAng = Math.atan2(hy, hx);
      const offs = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2];
      for (const o of offs) {
        const a = baseAng + o, nx = Math.cos(a), ny = Math.sin(a);
        if (!blocked(nx, ny)) { hx = nx; hy = ny; break; }
      }
      // Alla riktningar blockerade → behåll original (resolveCtfWall + unstick hanterar)
    }
  }
  ps.x += hx * speed * dt;
  ps.y += hy * speed * dt;
}

// V2 TAKTIK-LAGER (throttlad ~350ms/bot — bara för smart>0, dvs normal/hard).
// Skannar närområdet EN gång per fönster och cachar på bot._tac: hur många fiender vs
// lagkamrater är nära (numerärt över/underläge), lagets tyngdpunkt (för regroup) och
// närmaste hot (för cover-retreat). Allt nedströmsbeteende läser cachen → inga extra
// O(members)-svep per tick.
function assessTactical(sim, botWs, now) {
  const bot = botWs._bot;
  if (bot._tac && now - (bot._tacAt || 0) < 350) return bot._tac;
  const ps = botWs.playerState;
  const px = ps.x, py = ps.y, team = botWs.tdmTeam;
  const R2 = 560 * 560;
  const isPvP = sim.tdmActive || sim.ctfActive || sim.siegeActive || sim.gungameActive ||
                sim.kothActive || sim.juggernautActive || sim.battleroyaleActive;
  let foes = 0, allies = 0, ax = 0, ay = 0;
  let threatX = null, threatY = null, threatD2 = Infinity;
  if (isPvP) {
    for (const [pid, ws] of sim.room.members) {
      if (pid === botWs.id) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      // I FFA-lägen (gungame/koth/jugg/br) finns inga lagkamrater → alla är hot.
      const sameTeam = team && ws.tdmTeam && ws.tdmTeam === team;
      if (sameTeam) { allies++; ax += ws.playerState.x; ay += ws.playerState.y; }
      else { foes++; if (d2 < threatD2) { threatD2 = d2; threatX = ws.playerState.x; threatY = ws.playerState.y; } }
    }
  } else {
    // PvE: hot = fiender, lagkamrater = andra spelare/bots (för regroup/cover)
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const dx = e.x - px, dy = e.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      foes++; if (d2 < threatD2) { threatD2 = d2; threatX = e.x; threatY = e.y; }
    }
    for (const [pid, ws] of sim.room.members) {
      if (pid === botWs.id) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
      if (dx * dx + dy * dy > R2) continue;
      allies++; ax += ws.playerState.x; ay += ws.playerState.y;
    }
  }
  const tac = {
    foes, allies,
    allyCx: allies ? ax / allies : px,
    allyCy: allies ? ay / allies : py,
    outnumbered: foes > allies + 1,   // genuint underläge (1v1 räknas inte)
    threatX, threatY,
  };
  bot._tac = tac; bot._tacAt = now;
  return tac;
}

// Hitta en cover-punkt som BRYTER line-of-sight till hotet (hård bot retirerar bakom
// vägg och läker i st.f. att bara springa rakt bort i öppen terräng). Throttlad ~400ms.
// Provar växande vinklar runt "bort-från-hot"-riktningen; första punkten som (a) inte
// ligger i en vägg och (b) är skymd från hotet vinner.
function findCoverPoint(sim, px, py, tx, ty, now, bot) {
  if (bot._coverPt !== undefined && now - (bot._coverAt || 0) < 400) return bot._coverPt;
  bot._coverAt = now;
  const walls = getActiveWalls(sim);
  if (!walls || !walls.length) { bot._coverPt = null; return null; }
  const away = Math.atan2(py - ty, px - tx);
  const dist = 200;
  const offs = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4, Math.PI];
  let best = null;
  for (const o of offs) {
    const a = away + o;
    const cx = px + Math.cos(a) * dist, cy = py + Math.sin(a) * dist;
    if (bulletHitsWall({ x: cx, y: cy, r: 16 }, walls)) continue;   // punkten är i en vägg
    if (losBlocked(sim, tx, ty, cx, cy)) { best = { x: cx, y: cy }; break; }  // skymd → bra cover
  }
  bot._coverPt = best;
  return best;
}

// Fallback-pool när host inte skickar botNames (lobbyn skickar alltid). Utökad till ≥24
// så en full BR-lobby inte tömmer poolen → undefined-namn. Matchar V2:s BOT_NAMES-ordning.
const BOT_NAMES = ['Hovigo', 'Jamlo', 'Kostefo', 'Wisämo', 'Salimius', 'Muzzius', 'Okanius',
  'Bahmo', 'Zaffo', 'Lindo', 'Nahro', 'Gabro', 'Shamiro', 'Aboodo', 'Tonyo', 'Eliyo',
  'Saro', 'Ninos', 'Ashuro', 'Malko', 'Robino', 'Sargo', 'Yakubo', 'Daniyo', 'Georgo',
  'Marawgo', 'Basho', 'Fadelo'];
let _botCounter = 0;

// Skill-presets: påverkar aim-jitter och fire-rate
// easy: tydligt sämre — bra för nybörjare
// normal: balanserad (default)
// hard: nästan perfekt aim, snabb fire-rate
const BOT_SKILL = {
  // v1.663: lade till fleeHp (HP-% under vilken boten kitar/retirerar) + leadAim
  // (siktar framför rörliga mål). reactionMs ANVÄNDS nu (var död config).
  // v1.673: OMBALANSERAT. Bottarna NAVIGERAR nu faktiskt (v1.672 nav-grid-fix), så
  // gamla värdena — satta när de fastnade vid basen — gjorde även "easy" dödlig.
  // Nya spakar: dmgMul (skott+melee-skada) + moveMul (rörelsefart = 180*mul), båda
  // skill-skalade. easy = dålig sikt, långsam eld, halv skada, långsam, retirerar
  // tidigt. hard = oförändrat vass.
  // V2: `smart` [0..1] driver det TAKTISKA lagret (cover-sökning, regroup vid
  // numerärt underläge, fokus-eld på svaga mål, retreat som bryter LoS). Det är detta
  // — inte bara aim/skada — som gör nivåerna KÄNNBART olika: easy rusar in dumt utan
  // cover, hard spelar positionellt. easy hoppar HELT över taktik-lagret (smart=0 →
  // ingen CPU-kostnad + medvetet korkat beteende).
  // hard tuning: "tuff men slåbar" (på begäran) — behåller LITE jitter/reaktion så den
  // känns mänsklig, inte aimbot (var 0.05/80ms → 0.06/110ms, leadAim 0.9→0.85).
  easy:   { aimJitter: 0.62, cooldownMul: 2.8, reactionMs: 700, fleeHp: 0.45, leadAim: 0.0,  dmgMul: 0.5,  moveMul: 0.72, smart: 0.0 },
  normal: { aimJitter: 0.16, cooldownMul: 1.45, reactionMs: 230, fleeHp: 0.30, leadAim: 0.4,  dmgMul: 0.85, moveMul: 0.92, smart: 0.5 },
  hard:   { aimJitter: 0.06, cooldownMul: 1.0,  reactionMs: 110, fleeHp: 0.42, leadAim: 0.85, dmgMul: 1.0,  moveMul: 1.0,  smart: 1.0 },
};

// v1.663: skill-anpassat default-vapen för modes som INTE sätter bot-vapen själva
// (TDM/CTF/Siege/Story). GunGame/KOTH/Jugg/BR/CD skriver över via egen sim-logik.
// Pistol-only-bots var pushovers. Inga snipers på hard (sniper+låg-jitter = brutalt).
const BOT_WEAPON_POOL = {
  easy:   ['pistol', 'smg'],
  normal: ['rifle', 'smg', 'shotgun'],
  hard:   ['rifle', 'revolver', 'burstpistol'],
};
function pickBotWeapon(skillName) {
  const pool = BOT_WEAPON_POOL[skillName] || BOT_WEAPON_POOL.normal;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Spawna bot i ett sim-rum. Returnerar bot-id om lyckad.
// team='red'|'blue'|null (FFA). spawnPos sätts av caller efter mode.
// customName: om angivet (host pre-genererat) använd det — annars shuffle.
function addBot(sim, team, skill, customName) {
  _botCounter++;
  const botId = 'bot_' + _botCounter;
  let name;
  if (customName && typeof customName === 'string' && customName.trim()) {
    name = customName.trim();
  } else {
    // Shuffle namn per sim så samma "Hovigo" inte återkommer match efter match
    if (!sim._botNamePool || sim._botNamePool.length === 0) {
      sim._botNamePool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    }
    name = sim._botNamePool.shift();
  }
  // Fake-ws som efterliknar tillräckligt av WebSocket-API:n
  const botWs = {
    id: botId,
    name,
    _isBot: true,
    readyState: 1,
    send: () => {},                       // bots tar inte emot meddelanden
    close: () => {},
    playerState: {
      x: 1000, y: 1000,
      hp: 100, shield: 100, maxShield: 100,
      invulnUntil: Date.now() + 1500,
      weaponId: pickBotWeapon(skill),   // v1.663: riktigt vapen (var hårdkodad 'pistol')
      _history: [],
    },
    tdmTeam: team || null,
    _serverRtt: 0,
    // Bot-state (egen)
    _bot: {
      lastShotAt: 0,
      lastTargetSwapAt: 0,
      target: null,                       // ref till annan player/enemy/objective
      moveAngle: 0,                       // current heading
      stuckSince: 0,
      lastX: 1000, lastY: 1000,
      seed: Math.floor(Math.random() * 10000),  // per-bot offset så de inte rör sig synkat
      strafeFlipAt: 0,                          // när nästa strafe-byte ska ske
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      unstickUntil: 0,                          // tving sidoangle om fastnat
      skill: BOT_SKILL[skill] || BOT_SKILL.normal, // aim+cooldown-tuning per difficulty
      skillName: skill || 'normal',
    },
  };
  sim.room.members.set(botId, botWs);
  sim._botIds = sim._botIds || [];
  sim._botIds.push(botId);
  return { id: botId, name, team };
}

// Tick alla bots i sim. Körs efter player-history-snapshots så bots har samma
// snapshot-baseline som spelare för lag-comp (men de skjuter med rtt=0 = ingen rewind).
function tickBots(sim, dt, now) {
  if (!sim._botIds || sim._botIds.length === 0) return;
  for (const botId of sim._botIds) {
    const botWs = sim.room.members.get(botId);
    if (!botWs || !botWs.playerState) continue;
    if (botWs.playerState.hp <= 0) continue;       // dead — vänta på respawn
    if (botWs.playerState.gulagState) continue;    // GULAG (v1.791): bot i duell står still (off-map)
    const ps = botWs.playerState;
    // Skip bot-AI under count-down (samma som klient-paus)
    if (sim.simReadyAt && Date.now() < sim.simReadyAt) continue;
    // Skip under time-stop
    if (sim.timeStopUntil && Date.now() < sim.timeStopUntil) continue;

    const bot = botWs._bot;
    const skill = bot.skill || BOT_SKILL.normal;
    // v1.663: SJÄLVBEVARELSE — flagga för att kita/retirera när HP låg + ingen shield.
    // Skill-skalad (hard kitar tidigare = överlever längre = svårare motståndare).
    const maxHp = ps.maxHp || 100;
    bot.fleeing = (ps.hp / maxHp) < (skill.fleeHp || 0.3) && (ps.shield || 0) <= 0;

    // V2: throttlad taktik-bedömning (numerärt läge, lag-tyngdpunkt, närmaste hot).
    // Bara smart>0 (normal/hard) → easy förblir korkad OCH gratis CPU-mässigt.
    const smart = skill.smart || 0;
    if (smart > 0) assessTactical(sim, botWs, now);
    else bot._tac = null;

    // v1.665: FRIKOPPLAT rörelse-mål vs skjut-mål. Förut styrde ETT target båda →
    // boten "väntade" vid objektiv-mål (flagga/bas) och slogs aldrig på vägen, eller
    // stannade och slogs istället för att spela läget. Nu: marschera mot OBJEKTIVET
    // medan du skjuter närmaste fiende i räckvidd.
    // 1) RÖRELSE-MÅL — objektiv-styrt per mode.
    let moveTarget = chooseBotTarget(sim, botWs);
    bot.target = moveTarget;
    if (!moveTarget) continue;

    // V2: HÅRD bot som flyr söker COVER (bryter LoS bakom vägg och läker) i st.f. att
    // bara backa rakt i öppen terräng. Override:ar rörelse-målet — skjut-målet behålls
    // (kan fortfarande peppra om den råkar ha sikt på vägen till skyddet).
    if (bot.fleeing && smart > 0.7 && bot._tac && bot._tac.threatX != null) {
      const cover = findCoverPoint(sim, ps.x, ps.y, bot._tac.threatX, bot._tac.threatY, now, bot);
      if (cover) { moveTarget = { x: cover.x, y: cover.y, type: 'cover' }; bot.target = moveTarget; }
    }

    // 2) SKJUT-MÅL — närmaste fiende i räckvidd, oberoende av rörelsen. Faller tillbaka
    //    till rörelse-målet om det är skjutbart (fiende/player/core) och inget annat finns.
    let shootTarget = chooseShootTarget(sim, botWs);
    if (!shootTarget && (moveTarget.type === 'enemy' || moveTarget.type === 'player' || moveTarget.type === 'siege_core')
        && !losBlocked(sim, botWs.playerState.x, botWs.playerState.y, moveTarget.x, moveTarget.y)) {
      shootTarget = moveTarget;   // v1.671: bara om fri sikt — annars skjut inte genom vägg
    }

    // 3) REACTION TIME — gäller skjut-målet (när det byts).
    const sref = shootTarget && shootTarget.ref;
    if (sref !== bot._lastShootRef) {
      bot._lastShootRef = sref;
      bot._engageAt = now + (skill.reactionMs || 180);
    }

    // 4) Rör mot rörelse-målet (kitar vid låg HP via bot.fleeing)
    moveBotTowards(sim, botWs, moveTarget, dt);

    // 5) Skjut mot skjut-målet (override:ar aim mot det) om i räckvidd + reaktionstid klar
    if (shootTarget && now >= (bot._engageAt || 0)) shootIfReady(sim, botWs, shootTarget, now);
  }
}

// Pick a target depending on mode. Returns {x, y, type, ref} eller null.
function chooseBotTarget(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  const team = botWs.tdmTeam;

  // CTF: prioritera flag-mekaniken
  if (sim.ctfActive && !sim.ctfEnded) {
    return chooseCtfTarget(sim, botWs, team);
  }
  // SIEGE: enkel — gå mot närmsta motståndare-bas eller spelare
  if (sim.siegeActive && !sim.siegeEnded) {
    return chooseSiegeTarget(sim, botWs, team);
  }
  // KOTH (FFA): gå till aktiv zon om ingen fiende nära, annars kill
  if (sim.kothActive && !sim.kothEnded) {
    return chooseKothTarget(sim, botWs);
  }
  // GUNGAME (FFA): närmsta annan spelare (inkl bots)
  if (sim.gungameActive && !sim.gungameEnded) {
    return findClosestPlayer(sim, botWs, /*excludeTeam*/ null);
  }
  // BATTLE ROYALE: 3-substate-AI med target-stickiness.
  //   1) Loot-phase (phase 0 + ingen fiende inom 400px): gå mot närmsta loot
  //   2) Hunt-phase (fiende inom 600px): jaga + skjut
  //   3) Survive-phase (utanför zonen): gå till zonens centrum
  // STICKINESS: behåll target i 1.5s om det fortfarande är giltigt så bots
  // inte zig-zaggar mellan 2 fiender och dör.
  if (sim.battleroyaleActive && !sim.battleroyaleEnded) {
    const bot = botWs._bot;
    const now = Date.now();
    // Validera nuvarande target — om dead/borta, force re-pick
    let cur = bot._brStickyTarget;
    if (cur && cur.type === 'player' && cur.ref) {
      if (!cur.ref.playerState || cur.ref.playerState.hp <= 0) cur = null;
    } else if (cur && cur.type === 'br_loot' && cur.ref) {
      if (!cur.ref.available) cur = null;
      else if (cur.ref.unlockAt && now < cur.ref.unlockAt) cur = null;
    }
    // Behåll target om <1.5s sedan senast swap + fortfarande giltigt
    if (cur && (now - (bot._brStickySetAt || 0) < 1500)) {
      // Update pos från ref (player rör sig, loot är stilla)
      if (cur.type === 'player' && cur.ref && cur.ref.playerState) {
        cur.x = cur.ref.playerState.x;
        cur.y = cur.ref.playerState.y;
      }
      return cur;
    }
    // Re-pick
    const newTarget = chooseBattleRoyaleTarget(sim, botWs);
    bot._brStickyTarget = newTarget;
    bot._brStickySetAt = now;
    return newTarget;
  }
  // JUGGERNAUT: alla bots = hunters (kan aldrig vara JUG). Prioritera JUG som
  // target. Om JUG inte finns (mellan transfer), närmsta levande spelare.
  if (sim.juggernautActive && !sim.juggernautEnded) {
    if (sim.juggernautPid) {
      const jws = sim.room.members.get(sim.juggernautPid);
      if (jws && jws.playerState && jws.playerState.hp > 0 &&
          Date.now() >= (jws.playerState.invulnUntil || 0)) {
        return { x: jws.playerState.x, y: jws.playerState.y, type: 'player', ref: jws };
      }
    }
    return findClosestPlayer(sim, botWs, /*excludeTeam*/ null);
  }
  // TDM: närmsta motståndare-spelare
  if (sim.tdmActive && !sim.tdmEnded) {
    return findClosestPlayer(sim, botWs, /*excludeTeam*/ team);
  }
  // HEIST (co-op stealth): följ laget (vakter + objektiv-interaktion är ej bot-spelbara).
  if (sim.heistActive && !sim.heistEnded) {
    return chooseHeistTarget(sim, botWs);
  }
  // Story/coop (PvE): v1.663 — om en lagkamrat ligger nedslagen i närheten och boten
  // inte själv flyr, gå och återuppliva (updateRevive räddar när boten står inom 50px
  // i 5s). Annars närmsta enemy. Gör bots till riktiga co-op-lagkamrater.
  if (!botWs._bot.fleeing) {
    const reviveTarget = chooseReviveTarget(sim, botWs);
    if (reviveTarget) return reviveTarget;
  }
  return findClosestEnemy(sim, botWs);
}

// V2: HEIST-rörelse-mål. Vakter ligger i sim.heistNPCs (ej sim.enemies) och väska/borr/
// extract kräver klient-actions som bots inte skickar → bots kan inte "lösa" heisten
// själva. Minimal vettig roll: ESKORTERA närmaste levande människa genom banken (navigerar
// väggar korrekt nu) så de inte står frusna. All-bot → drift mot närmaste obärgade loot.
// (Full heist-combat/objektiv-AI = separat större jobb — kräver guard-combat-wiring +
// bot-interaktions-API.)
function chooseHeistTarget(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // 1) Nedslagen lagkamrat nära → revive (om heist använder deadBodies).
  if (!botWs._bot.fleeing) {
    const rev = chooseReviveTarget(sim, botWs);
    if (rev) return rev;
  }
  // 2) Följ närmaste levande MÄNNISKA (eskort-avstånd ~110px).
  let best = null, bestD2 = Infinity;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id || ws._isBot) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = ws; }
  }
  if (best) return { x: best.playerState.x, y: best.playerState.y, type: 'escort', ref: best };
  // 3) All-bot: närmaste obärgade loot så de rör sig framåt genom banken.
  if (HEIST_ARENA.lootSpots) {
    let bl = null, bd2 = Infinity;
    for (const lo of HEIST_ARENA.lootSpots) {
      if (sim.heistLootBagged && sim.heistLootBagged[lo.id]) continue;
      const dx = lo.x - px, dy = lo.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) { bd2 = d2; bl = lo; }
    }
    if (bl) return { x: bl.x, y: bl.y, type: 'br_loot' };   // br_loot = objektiv-stå-nära
  }
  return null;
}

// v1.663: hitta närmsta nedslagna lagkamrat (deadBody) inom rimligt avstånd att gå till.
function chooseReviveTarget(sim, botWs) {
  if (!sim.deadBodies) return null;
  const px = botWs.playerState.x, py = botWs.playerState.y;
  let best = null, bestD2 = 750 * 750;   // gå bara om rimligt nära
  for (const pid of Object.keys(sim.deadBodies)) {
    if (pid === botWs.id) continue;
    const body = sim.deadBodies[pid];
    if (!body) continue;
    const dx = body.x - px, dy = body.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = { x: body.x, y: body.y, type: 'revive', ref: body }; }
  }
  return best;
}

function findClosestPlayer(sim, botWs, excludeTeam) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // V2: HP-viktningens STYRKA skalas med skill. easy (smart 0) → ren närhet (korkat,
  // ignorerar avslutningsbara mål). hard (smart 1) → stark fokus-eld på svaga.
  const smart = (botWs._bot && botWs._bot.skill && botWs._bot.skill.smart) || 0;
  const wgt = 0.5 * smart;
  let best = null, bestD2 = Infinity;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    // Exkludera same-team i team-modes
    if (excludeTeam && ws.tdmTeam && ws.tdmTeam === excludeTeam) continue;
    // Skip respawn-invuln targets (oskjutbara — slösa inte tid)
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    const hpFrac = Math.max(0, Math.min(1, (ws.playerState.hp || 100) / (ws.playerState.maxHp || 100)));
    const score = (dx * dx + dy * dy) * (1 - wgt + wgt * hpFrac);
    if (score < bestD2) { bestD2 = score; best = { x: ws.playerState.x, y: ws.playerState.y, type: 'player', ref: ws }; }
  }
  return best;
}

function findClosestEnemy(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // V2: skill-skalad fokus-eld (se findClosestPlayer).
  const smart = (botWs._bot && botWs._bot.skill && botWs._bot.skill.smart) || 0;
  const wgt = 0.5 * smart;
  let best = null, bestD2 = Infinity;
  for (const e of sim.enemies) {
    if (e.dead) continue;
    const dx = e.x - px, dy = e.y - py;
    const hpFrac = Math.max(0, Math.min(1, (e.hp || 1) / (e.maxHp || e.hp || 1)));
    const score = (dx * dx + dy * dy) * (1 - wgt + wgt * hpFrac);
    if (score < bestD2) { bestD2 = score; best = { x: e.x, y: e.y, type: 'enemy', ref: e }; }
  }
  return best;
}

// v1.665: separat SKJUT-mål — närmaste fiende/motståndare i vapen-räckvidd, oberoende
// av rörelse-objektivet. Låter bots slåss MEDAN de marscherar mot flagga/bas/core.
function chooseShootTarget(sim, botWs) {
  const ps = botWs.playerState;
  const px = ps.x, py = ps.y, team = botWs.tdmTeam;
  const w = W_BY_ID[ps.weaponId] || {};
  const range = w.type === 'melee' ? (w.range || 36) + 22 : 720;
  const r2 = range * range;
  const isPvP = sim.tdmActive || sim.ctfActive || sim.siegeActive || sim.gungameActive ||
                sim.kothActive || sim.juggernautActive || sim.battleroyaleActive;
  // PERF (24-bot-stöd): samla in-range-kandidater med distans (BILLIGT — ingen losBlocked),
  // sortera närmast först, och LoS-testa BARA nerifrån tills en är fri (cap). Förut: en
  // losBlocked per kandidat × varje bot × varje tick = O(bots·members·walls) → [SLOW-TICK]
  // i BR (2694 väggar). Nu max ~6 losBlocked/bot.
  const cands = [];
  if (isPvP) {
    const nowMs = Date.now();
    for (const [pid, ws] of sim.room.members) {
      if (pid === botWs.id) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      if (team && ws.tdmTeam === team) continue;            // skippa lagkamrater
      if (nowMs < (ws.playerState.invulnUntil || 0)) continue;
      const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) cands.push({ d2, x: ws.playerState.x, y: ws.playerState.y, ref: ws, enemy: false });
    }
  } else {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const dx = e.x - px, dy = e.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) cands.push({ d2, x: e.x, y: e.y, ref: e, enemy: true });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.d2 - b.d2);
  const maxChecks = cands.length < 6 ? cands.length : 6;   // skjut inte genom vägg — men cap LoS-tester
  for (let i = 0; i < maxChecks; i++) {
    const c = cands[i];
    if (!losBlocked(sim, px, py, c.x, c.y)) {
      return { x: c.x, y: c.y, type: c.enemy ? 'enemy' : 'player', ref: c.ref };
    }
  }
  return null;
}

// v1.665: CTF-rörelse-mål — situationell offensiv/försvar (skjut-mål hanteras separat).
function chooseCtfTarget(sim, botWs, team) {
  const enemyTeam = team === 'red' ? 'blue' : 'red';
  const myFlag = sim.ctfFlags[team];
  const enemyFlag = sim.ctfFlags[enemyTeam];
  // 1) Jag bär fiende-flaggan → spring hem och scora. MEN capture kräver att VÅR
  //    egen flagga är hemma. Är den stulen/dropad kan boten inte scora → utan
  //    detta dansar den upp/ner vid hembasen för evigt (v1.669-dödläge). Lös upp:
  if (enemyFlag && enemyFlag.carrierId === botWs.id) {
    if (myFlag && myFlag.atBase) {
      return { x: myFlag.baseX, y: myFlag.baseY, type: 'home_base' };   // kan scora → spring hem
    }
    // Vår flagga bärs av en fiende → jaga + döda bäraren (flaggan dropas då → kan returneras).
    if (myFlag && myFlag.carrierId) {
      const thief = sim.room.members.get(myFlag.carrierId);
      if (thief && thief.playerState && thief.playerState.hp > 0 && thief.tdmTeam !== team) {
        return { x: thief.playerState.x, y: thief.playerState.y, type: 'player', ref: thief };
      }
    }
    // Vår flagga ligger dropad → gå dit och returnera den (hold-to-return), sen kan boten scora.
    if (myFlag && !myFlag.atBase) {
      return { x: myFlag.x, y: myFlag.y, type: 'return_flag' };
    }
    return { x: myFlag.baseX, y: myFlag.baseY, type: 'home_base' };     // fallback
  }
  // 2) FÖRSVAR — vår flagga är STULEN (bärs av fiende) → jaga bäraren för att döda
  //    den och returnera flaggan. (Detta är "skydda sitt team".)
  if (myFlag && myFlag.carrierId) {
    const carrier = sim.room.members.get(myFlag.carrierId);
    if (carrier && carrier.playerState && carrier.playerState.hp > 0 && carrier.tdmTeam !== team) {
      return { x: carrier.playerState.x, y: carrier.playerState.y, type: 'player', ref: carrier };
    }
  }
  // 3) ESKORT — en lagkamrat bär fiende-flaggan → följ + skydda (håll dig nära dem).
  if (enemyFlag && enemyFlag.carrierId) {
    const carrier = sim.room.members.get(enemyFlag.carrierId);
    if (carrier && carrier.tdmTeam === team && carrier.playerState && carrier.playerState.hp > 0) {
      return { x: carrier.playerState.x, y: carrier.playerState.y, type: 'escort', ref: carrier };
    }
  }
  // 3b) FÖRSVAR (v1.671) — vår egen flagga ligger DROPAD på marken (varken hemma
  //     eller buren). Gå returnera den (hold-to-return inom pickupRadius) innan
  //     fienden hinner plocka upp den igen och scora. Tidigare ignorerade boten den
  //     och sprang offensivt → "boten plockar inte upp sin egna flagga".
  if (myFlag && !myFlag.atBase && !myFlag.carrierId) {
    return { x: myFlag.x, y: myFlag.y, type: 'return_flag' };
  }
  // 4) OFFENSIV — fiende-flaggan droppad på marken → hämta den.
  if (enemyFlag && !enemyFlag.atBase && !enemyFlag.carrierId) {
    return { x: enemyFlag.x, y: enemyFlag.y, type: 'enemy_flag' };
  }
  // 5) OFFENSIV — fiende-flaggan vid sin bas → gå och ta den.
  if (enemyFlag && enemyFlag.atBase) {
    return { x: enemyFlag.baseX, y: enemyFlag.baseY, type: 'enemy_flag_base' };
  }
  // 6) Fallback: närmaste motståndare.
  return findClosestPlayer(sim, botWs, team);
}

// KOTH bot-AI: prio 1 = kill fiende inom 250px (defense). Prio 2 = gå till
// aktiv zon. Prio 3 = närmsta spelare.
function chooseKothTarget(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // Fiende inom 250px → kill
  let nearestEnemyD2 = Infinity, nearestEnemy = null;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestEnemyD2) { nearestEnemyD2 = d2; nearestEnemy = ws; }
  }
  if (nearestEnemy && nearestEnemyD2 < 250 * 250) {
    return { x: nearestEnemy.playerState.x, y: nearestEnemy.playerState.y, type: 'player', ref: nearestEnemy };
  }
  // Annars: aktiv zon
  if (sim.kothActiveZoneIdx != null && KOTH_ARENA.zones) {
    const z = KOTH_ARENA.zones[sim.kothActiveZoneIdx];
    if (z) {
      // Om jag ÄR i zonen, hitta fiende att skjuta. Annars gå dit.
      const dxZ = z.x - px, dyZ = z.y - py;
      if (dxZ * dxZ + dyZ * dyZ <= z.r * z.r) {
        // I zonen: jaga fiende eller stå still (kill om någon i sikt)
        if (nearestEnemy) {
          return { x: nearestEnemy.playerState.x, y: nearestEnemy.playerState.y, type: 'player', ref: nearestEnemy };
        }
        // Ingen fiende inom range — stå still mitt i zonen
        return { x: z.x, y: z.y, type: 'koth_zone', ref: z };
      }
      return { x: z.x, y: z.y, type: 'koth_zone', ref: z };
    }
  }
  // Fallback
  return findClosestPlayer(sim, botWs, null);
}

// BR bot-AI: prio 1 = överlev (gå till zon om utanför). Prio 2 = jaga närmsta
// fiende inom 600px. Prio 3 = loot om phase 0 eller låg HP. Prio 4 = drift mot
// zonens centrum så bot inte bara står still.
function chooseBattleRoyaleTarget(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // 1) Utanför zonen? Gå till centrum med priority
  if (sim.battleroyaleZone) {
    const z = sim.battleroyaleZone;
    const dxZ = px - z.x, dyZ = py - z.y;
    if (dxZ * dxZ + dyZ * dyZ > z.r * z.r) {
      // Sikta mot zonens centrum (enkel + säker — bot kommer alltid in i zonen)
      return { x: z.x, y: z.y, type: 'br_zone_center' };
    }
  }
  // Hitta närmsta fiende
  let nearestEnemyD2 = Infinity, nearestEnemy = null;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestEnemyD2) { nearestEnemyD2 = d2; nearestEnemy = ws; }
  }
  // 2) Fiende inom 600px → hunt
  if (nearestEnemy && nearestEnemyD2 < 600 * 600) {
    return { x: nearestEnemy.playerState.x, y: nearestEnemy.playerState.y, type: 'player', ref: nearestEnemy };
  }
  // 3) Phase 0 (loot) ELLER låg HP → gå mot närmsta available loot
  const phase = sim.battleroyalePhase || 0;
  const lowHp = botWs.playerState.hp < 60;
  if ((phase === 0 || lowHp) && sim.battleroyaleLoot) {
    const nowMs = Date.now();
    // FIX: skip weapon-loot om bot redan har bra vapen (rare/legendary)
    // Hardcoded high-tier-set (snabbare än att slå upp i loot-tabellen per tick)
    const myW = botWs.playerState.weaponId;
    const HIGH_TIER = new Set([
      // legendary
      'minigun', 'lightsaber',
      // rare
      'rifle', 'sniper', 'flame', 'energysword',
    ]);
    const hasHighTierWeapon = HIGH_TIER.has(myW);
    let bestLoot = null, bestD2 = Infinity;
    for (const lo of sim.battleroyaleLoot) {
      if (!lo.available) continue;
      // FIX: skip locked loot (center-fortet första 30s) — annars står bot
      // och stirrar på låst container i 30s.
      if (lo.unlockAt && nowMs < lo.unlockAt) continue;
      // FIX: skip HP-pickup om bot redan har full HP (annars omotiverad detour)
      if (!lowHp && (lo.kind === 'hp_small' || lo.kind === 'hp_big')) continue;
      // FIX: skip weapon-loot om bot redan har rare/legendary (undvik onödig detour)
      if (hasHighTierWeapon && lo.kind === 'weapon') continue;
      const dx = lo.x - px, dy = lo.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestLoot = lo; }
    }
    if (bestLoot) {
      return { x: bestLoot.x, y: bestLoot.y, type: 'br_loot', ref: bestLoot };
    }
  }
  // 4) Drift mot zonens centrum (default), eller närmsta fiende om långt borta
  if (nearestEnemy) {
    return { x: nearestEnemy.playerState.x, y: nearestEnemy.playerState.y, type: 'player', ref: nearestEnemy };
  }
  if (sim.battleroyaleZone) {
    return { x: sim.battleroyaleZone.x, y: sim.battleroyaleZone.y, type: 'br_zone_center' };
  }
  return null;
}

// v1.665: Siege-rörelse-mål — spela ALLTID objektivet (kapa baser → attackera core).
// Skjut-mål hanteras separat så boten slåss på vägen. (Förut: stannade och slogs vid
// fiende inom 300px + kapade bara baser inom 800px → passiv om allt var långt bort.)
function chooseSiegeTarget(sim, botWs, team) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // 1) Kapa NÄRMASTE bas som inte är vår (neutral eller fiendens) — oavsett avstånd.
  if (sim.siegeBases) {
    let bestBase = null, bestD2 = Infinity;
    for (const baseId of Object.keys(sim.siegeBases)) {
      const base = sim.siegeBases[baseId];
      if (base.owner === team) continue;
      const dx = base.x - px, dy = base.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestBase = base; }
    }
    if (bestBase) return { x: bestBase.x, y: bestBase.y, type: 'siege_base', ref: bestBase };
  }
  // 2) Äger vi alla baser → attackera fiendens CORE (instant-win / "disable").
  if (sim.siegeCores) {
    let bestCore = null, bestD2 = Infinity;
    for (const coreId of Object.keys(sim.siegeCores)) {
      const core = sim.siegeCores[coreId];
      if (core.team === team) continue;                 // skippa egen core
      if (core.hp != null && core.hp <= 0) continue;
      const dx = core.x - px, dy = core.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestCore = core; }
    }
    if (bestCore) return { x: bestCore.x, y: bestCore.y, type: 'siege_core', ref: bestCore };
  }
  // 3) Fallback: närmaste motståndare.
  return findClosestPlayer(sim, botWs, team);
}

function moveBotTowards(sim, botWs, target, dt) {
  const ps = botWs.playerState;
  const bot = botWs._bot;
  const now = Date.now();
  const dx = target.x - ps.x;
  const dy = target.y - ps.y;
  const d = Math.hypot(dx, dy) || 1;
  const w = W_BY_ID[ps.weaponId] || {};
  const isMelee = w.type === 'melee';
  // Base-objectives (SIEGE-capture, CTF-flag-base, KOTH-zone): stå nära mitten
  // så capture-progress fortsätter ticka. Inte strafe utåt → ut ur radien.
  const isObjective = target.type === 'siege_base' || target.type === 'home_base'
    || target.type === 'enemy_flag' || target.type === 'enemy_flag_base'
    || target.type === 'return_flag'   // v1.669: gå returnera egen dropad flagga
    || target.type === 'koth_zone' || target.type === 'br_loot' || target.type === 'br_zone_center'
    || target.type === 'revive';   // v1.663: stå nära nedslagen lagkamrat (revive-radie)
  // v1.663: vapen-räckvidds-medvetet skjutavstånd (var fast 250px för ALLA guns →
  // hagel-bot utom räckhåll, sniper-bot för nära). Långa vapen håller distans, korta
  // går in. + självbevarelse: kita undan vid låg HP.
  let desiredDist;
  if (isObjective) {
    // v1.669: KRITISK fix — CTF-pickup-objektiv MÅSTE gå innanför pickupRadius
    // (28px) annars orbiterar boten precis utanför (desiredDist=30 > 28) och
    // strafe:ar vinkelrätt = "står kvar i basen och springer upp/ner" utan att
    // någonsin plocka upp flaggan. Capture-mål (home_base, captureRadius 50)
    // triggar redan under inmarsch vid d<50, så 30 är ok där.
    const isPickup = target.type === 'enemy_flag' || target.type === 'enemy_flag_base'
      || target.type === 'return_flag';   // return använder också pickupRadius (28)
    desiredDist = isPickup ? 16 : 30;
  }
  else if (isMelee) desiredDist = Math.max(20, (w.range || 36) - 5);
  else {
    const LONG = ['sniper', 'railgun', 'crossbow', 'bow', 'rifle', 'minigun'];
    const SHORT = ['shotgun', 'flame', 'smg'];
    desiredDist = LONG.indexOf(ps.weaponId) >= 0 ? 460 : (SHORT.indexOf(ps.weaponId) >= 0 ? 150 : 260);
  }
  if (target.type === 'escort') desiredDist = 110;   // v1.665: följ flagg-bäraren nära (skydda)
  if (bot.fleeing && !isObjective) desiredDist = Math.max(desiredDist, 520);
  if (target.type === 'cover') desiredDist = 12;     // V2: gå ända in i skyddet (bryt LoS)
  const speed = 180 * ((bot.skill && bot.skill.moveMul) || 1);   // v1.673: skill-skalad fart

  // Wall-unstick (v1.670 KRITISK FIX): mät förflyttning över ett ~700ms-FÖNSTER,
  // inte per-tick. Förr: `moved` jämförde bot.lastX (uppdaterad VARJE tick) mot en
  // per-tick-tröskel (~13px @ 45Hz) — men en bot i full fart rör sig bara ~4px/tick,
  // alltså ALLTID < tröskeln → flaggades permanent "fast" → evig vinkelrät strafe =
  // "springer i linje upp och ner" i alla lägen. Nu: bara om boten rört sig < 30px
  // på 700ms är den genuint fast → lås in sido-angle 90° i 1.5s.
  // v1.672: konservativare nu när A* faktiskt ger vägar (grid-konnektivitet fixad).
  // Fyra BARA vid genuint fast (< 18px på 900ms ≈ nästan stillastående) + kortare
  // strafe (900ms) så normal A*-navigering i trånga baser inte feltriggar upp/ner.
  if (bot._stuckRefAt === undefined) { bot._stuckRefAt = now; bot._stuckRefX = ps.x; bot._stuckRefY = ps.y; }
  if (now - bot._stuckRefAt >= 900) {
    const windowMoved = Math.hypot(ps.x - bot._stuckRefX, ps.y - bot._stuckRefY);
    if (windowMoved < 18 && now > bot.unstickUntil) {
      bot.unstickUntil = now + 900;
      bot.strafeDir = -bot.strafeDir;    // flippa riktning
    }
    bot._stuckRefAt = now; bot._stuckRefX = ps.x; bot._stuckRefY = ps.y;
  }
  bot.lastX = ps.x;
  bot.lastY = ps.y;

  // Per-bot strafe-flip timing (annars rör sig alla bots synkat med klockan)
  if (now > bot.strafeFlipAt) {
    bot.strafeFlipAt = now + 900 + (bot.seed % 600);  // 900-1500ms per bot
    bot.strafeDir = -bot.strafeDir;
  }

  // v1.671: jagar jag ett kill-mål men en vägg skymmer sikten? Då ska boten FORTSÄTTA
  // fram (A* rundar väggen) istället för att stanna på desiredDist och skjuta in i
  // väggen. Så snart fri sikt nås faller den tillbaka till normal håll-avstånd-och-skjut.
  const isKillTarget = target.type === 'player' || target.type === 'enemy' || target.type === 'siege_core';
  const mustClose = isKillTarget && losBlocked(sim, ps.x, ps.y, target.x, target.y);

  // Force sido-angle om unstick aktiv — MEN inte om bot är i BR utanför zonen
  // (annars wobble: bot strafe:r 90° → tillbaka utanför zonen → unstick triggas
  // igen → loop. Måste prioritera "kom IN i zonen" framför wall-unstick.)
  const isBrZoneEscape = sim.battleroyaleActive && target.type === 'br_zone_center';
  // V2: OVEREXTEND-SPÄRR — smart bot i numerärt underläge pushar INTE ensam mot ett
  // kill-mål. Den faller tillbaka mot lagets tyngdpunkt (regroup) men håller blicken mot
  // hotet (aim sätts mot target nedan), så den kan fortfarande skjuta medan den backar.
  const tac = bot._tac;
  const smartM = (bot.skill && bot.skill.smart) || 0;
  const overextend = smartM > 0.6 && tac && tac.outnumbered && tac.allies >= 1
    && !isObjective && !bot.fleeing && target.type !== 'cover' && isKillTarget
    && Math.hypot(tac.allyCx - ps.x, tac.allyCy - ps.y) > 90;
  if (now < bot.unstickUntil && !isBrZoneEscape) {
    const nx = -dy / d, ny = dx / d;
    ps.x += nx * speed * bot.strafeDir * dt;
    ps.y += ny * speed * bot.strafeDir * dt;
  } else if (overextend) {
    const gx = tac.allyCx - ps.x, gy = tac.allyCy - ps.y, gl = Math.hypot(gx, gy) || 1;
    steerAround(sim, ps, gx / gl, gy / gl, speed * 0.85, dt);
  } else if (mustClose || d > desiredDist) {
    // v1.667: A*-pathfinding — följ waypoints RUNT väggar. nextWaypoint returnerar
    // null om målet är fritt synligt (gå rakt) eller om ingen väg hittas. steerAround
    // körs ovanpå som lokal säkerhetsnät (mjukar hörn + täcker grov-gridens kanter).
    let hx = dx / d, hy = dy / d;
    const walls = getActiveWalls(sim);
    if (walls && walls.length) {
      const wd = getWorldDims(sim);
      const wp = nextWaypoint(bot, walls, wd.worldW, wd.worldH, ps.x, ps.y, target.x, target.y, now);
      if (wp) {
        const wdx = wp.x - ps.x, wdy = wp.y - ps.y, wl = Math.hypot(wdx, wdy) || 1;
        hx = wdx / wl; hy = wdy / wl;
      }
    }
    steerAround(sim, ps, hx, hy, speed, dt);
  } else if (d < desiredDist - 60 && (!isMelee || bot.fleeing)) {
    // v1.663: backa undan — ranged kitar; melee gör det bara när de flyr (låg HP).
    ps.x -= (dx / d) * speed * 0.5 * dt;
    ps.y -= (dy / d) * speed * 0.5 * dt;
  } else {
    const nx = -dy / d, ny = dx / d;
    ps.x += nx * speed * 0.6 * dt * bot.strafeDir;
    ps.y += ny * speed * 0.6 * dt * bot.strafeDir;
  }

  // Dynamisk arena-clamp (delad med pathfinding via getWorldDims).
  const { worldW, worldH } = getWorldDims(sim);
  ps.x = Math.max(50, Math.min(worldW - 50, ps.x));
  ps.y = Math.max(50, Math.min(worldH - 50, ps.y));
  ps.aim = Math.atan2(dy, dx);
}

function shootIfReady(sim, botWs, target, now) {
  const ps = botWs.playerState;
  const w = W_BY_ID[ps.weaponId];
  if (!w) return;
  const bot = botWs._bot;
  const rate = w.rate || 400;
  const skillMul = (bot.skill && bot.skill.cooldownMul) || 1.3;
  const cooldown = rate * skillMul;          // skill-baserad — easy = saktare, hard = snabbare
  if (now - bot.lastShotAt < cooldown) return;
  // Check att target är inom range (melee) eller LoS-distans (gun)
  const dx = target.x - ps.x, dy = target.y - ps.y;
  const d = Math.hypot(dx, dy);
  const maxRange = w.type === 'melee' ? (w.range || 36) + 14 : 700;
  if (d > maxRange) return;
  // v1.671: skjut ALDRIG genom en vägg (ultimat chokepoint — täcker alla target-
  // källor inkl. move-target-fallbacken). Boten håller elden tills den har fri sikt;
  // move-logiken (mustClose) rundar väggen under tiden. Gäller skjutvapen.
  if (w.type !== 'melee' && losBlocked(sim, ps.x, ps.y, target.x, target.y)) return;
  bot.lastShotAt = now;
  // Använd applyShoot via lokal-import för att slippa cirkulär require
  // (bots.js → room-sim.js → bots.js). Vi anropar bullets.js direkt.
  const { spawnPlayerBullets, applyMelee } = require('./bullets');
  // Aim-jitter skalad med distans + skill-baseline. easy=0.28, normal=0.12, hard=0.05.
  const baseJitter = (bot.skill && bot.skill.aimJitter) || 0.12;
  const jitterMag = baseJitter + Math.min(0.30, d / 700 * 0.30);
  const jitter = (Math.random() - 0.5) * jitterMag;
  // v1.663: AIM-LEADING — sikta framför rörliga mål, skalat med skill.leadAim (hard
  // leder nästan helt, easy inte alls). Hastighet skattas från target-pos-delta mellan
  // skott. Gör bots träffsäkra mot rörliga mål istället för att alltid skjuta bakom.
  let aimX = target.x, aimY = target.y;
  const lead = (bot.skill && bot.skill.leadAim) || 0;
  if (lead > 0 && w.type !== 'melee') {
    const pv = bot._aimPrev;
    if (pv && pv.ref === target.ref) {
      const vdt = (now - pv.t) / 1000;
      if (vdt > 0.01 && vdt < 0.6) {
        const vx = (target.x - pv.x) / vdt, vy = (target.y - pv.y) / vdt;
        const tHit = Math.min(0.5, d / (w.speed || 700));
        aimX = target.x + vx * tHit * lead;
        aimY = target.y + vy * tHit * lead;
      }
    }
    bot._aimPrev = { ref: target.ref, x: target.x, y: target.y, t: now };
  }
  const ang = Math.atan2(aimY - ps.y, aimX - ps.x) + jitter;
  ps.aim = ang;   // v1.665: vänd boten mot det den SKJUTER (rörelsen kan gå mot ett objektiv)
  const p = { x: ps.x, y: ps.y, aimAngle: ang, r: 14, peerId: botWs.id };
  const params = { dmgMul: (bot.skill && bot.skill.dmgMul) || 1, perks: {}, cheats: {} };   // v1.673: skill-skalad skada
  if (w.type === 'melee') {
    applyMelee(sim, p, ps.weaponId, params);
    // Slash-VFX-event så klienten renderar bot:s melee-swing
    sim.eventQueue.push({
      type: 'bot_swing',
      peerId: botWs.id,
      x: ps.x, y: ps.y, ang,
      weaponId: ps.weaponId,
    });
  } else {
    spawnPlayerBullets(sim, p, ps.weaponId, params);
    // Bot-bullet-event så klient renderar lokala visuella bullets (player-bullets
    // skickas inte i world-paket — vanligtvis hanteras de via klient-relay men
    // bots har ingen klient). Skicka pos + vinkel + vapen så klient kan
    // spawna lokal "fake" bullet med samma trajectory.
    sim.eventQueue.push({
      type: 'bot_shot',
      peerId: botWs.id,
      x: ps.x, y: ps.y, ang,
      weaponId: ps.weaponId,
    });
  }
}

// Ta bort alla bots ur sim (vid stopSim eller match-end)
function removeAllBots(sim) {
  if (!sim._botIds) return;
  for (const botId of sim._botIds) {
    sim.room.members.delete(botId);
  }
  sim._botIds = [];
}

module.exports = { addBot, tickBots, removeAllBots };
