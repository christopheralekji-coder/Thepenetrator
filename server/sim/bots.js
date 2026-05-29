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

const BOT_NAMES = ['Hovigo', 'Jamlo', 'Kostefo', 'Wisämo', 'Salimius', 'Muzzius', 'Okanius'];
let _botCounter = 0;

// Skill-presets: påverkar aim-jitter och fire-rate
// easy: tydligt sämre — bra för nybörjare
// normal: balanserad (default)
// hard: nästan perfekt aim, snabb fire-rate
const BOT_SKILL = {
  // v1.663: lade till fleeHp (HP-% under vilken boten kitar/retirerar) + leadAim
  // (siktar framför rörliga mål). reactionMs ANVÄNDS nu (var död config).
  easy:   { aimJitter: 0.28, cooldownMul: 1.8, reactionMs: 350, fleeHp: 0.22, leadAim: 0.0 },
  normal: { aimJitter: 0.12, cooldownMul: 1.3, reactionMs: 180, fleeHp: 0.30, leadAim: 0.4 },
  hard:   { aimJitter: 0.05, cooldownMul: 1.0, reactionMs: 80,  fleeHp: 0.40, leadAim: 0.9 },
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

    // 1) Välj target baserat på mode
    const target = chooseBotTarget(sim, botWs);
    // v1.663: REACTION TIME — när target byts, sätt engage-fördröjning (skill-baserad)
    // så boten reagerar istället för att skjuta instant. Gör skill-nivåerna meningsfulla.
    const tref = target && target.ref;
    if (tref !== bot._lastTargetRef) {
      bot._lastTargetRef = tref;
      bot._engageAt = now + (skill.reactionMs || 180);
    }
    bot.target = target;
    if (!target) continue;

    // 2) Rör mot target (moveBotTowards läser bot.fleeing för kiting)
    moveBotTowards(sim, botWs, target, dt);

    // 3) Skjut om i range, cooldown klar OCH reaktionstid passerad
    if (now >= (bot._engageAt || 0)) shootIfReady(sim, botWs, target, now);
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
  // Story/coop (PvE): v1.663 — om en lagkamrat ligger nedslagen i närheten och boten
  // inte själv flyr, gå och återuppliva (updateRevive räddar när boten står inom 50px
  // i 5s). Annars närmsta enemy. Gör bots till riktiga co-op-lagkamrater.
  if (!botWs._bot.fleeing) {
    const reviveTarget = chooseReviveTarget(sim, botWs);
    if (reviveTarget) return reviveTarget;
  }
  return findClosestEnemy(sim, botWs);
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
  let best = null, bestD2 = Infinity;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    // Exkludera same-team i team-modes
    if (excludeTeam && ws.tdmTeam && ws.tdmTeam === excludeTeam) continue;
    // Skip respawn-invuln targets (oskjutbara — slösa inte tid)
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    // v1.663: HP-viktad poäng — föredra avslutningsbara (låg-HP) mål utan att
    // ignorera närhet (distans dominerar fortfarande). Fokus-eld på svaga.
    const hpFrac = Math.max(0, Math.min(1, (ws.playerState.hp || 100) / (ws.playerState.maxHp || 100)));
    const score = (dx * dx + dy * dy) * (0.6 + 0.4 * hpFrac);
    if (score < bestD2) { bestD2 = score; best = { x: ws.playerState.x, y: ws.playerState.y, type: 'player', ref: ws }; }
  }
  return best;
}

function findClosestEnemy(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  let best = null, bestD2 = Infinity;
  for (const e of sim.enemies) {
    if (e.dead) continue;
    const dx = e.x - px, dy = e.y - py;
    // v1.663: HP-viktad poäng — föredra avslutningsbara fiender (distans dominerar).
    const hpFrac = Math.max(0, Math.min(1, (e.hp || 1) / (e.maxHp || e.hp || 1)));
    const score = (dx * dx + dy * dy) * (0.6 + 0.4 * hpFrac);
    if (score < bestD2) { bestD2 = score; best = { x: e.x, y: e.y, type: 'enemy', ref: e }; }
  }
  return best;
}

function chooseCtfTarget(sim, botWs, team) {
  // Prio 1: om jag bär en flagga → gå tillbaka till min bas
  for (const t of ['red', 'blue']) {
    const flag = sim.ctfFlags[t];
    if (flag && flag.carrierId === botWs.id) {
      return { x: sim.ctfFlags[team].baseX, y: sim.ctfFlags[team].baseY, type: 'home_base' };
    }
  }
  // Prio 2: om enemy-flag är droppad → gå hämta den
  const enemyTeam = team === 'red' ? 'blue' : 'red';
  const enemyFlag = sim.ctfFlags[enemyTeam];
  if (enemyFlag && !enemyFlag.atBase && !enemyFlag.carrierId) {
    return { x: enemyFlag.x, y: enemyFlag.y, type: 'enemy_flag' };
  }
  // Prio 3: om enemy-flag är vid bas → gå dit
  if (enemyFlag && enemyFlag.atBase) {
    return { x: enemyFlag.baseX, y: enemyFlag.baseY, type: 'enemy_flag_base' };
  }
  // Prio 4: skjut närmsta motståndare
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

function chooseSiegeTarget(sim, botWs, team) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  // Hitta närmaste enemy inom 300px — om en, prioritera kill (skydd)
  let nearestEnemyD2 = Infinity;
  for (const [pid, ws] of sim.room.members) {
    if (pid === botWs.id) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (ws.tdmTeam === team) continue;
    const dx = ws.playerState.x - px, dy = ws.playerState.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestEnemyD2) nearestEnemyD2 = d2;
  }
  if (nearestEnemyD2 < 300 * 300) {
    return findClosestPlayer(sim, botWs, team);
  }
  // Annars: hitta neutral/enemy-bas inom 800px och kapsa
  if (sim.siegeBases) {
    let bestBase = null, bestD2 = 800 * 800;
    for (const baseId of Object.keys(sim.siegeBases)) {
      const base = sim.siegeBases[baseId];
      if (base.owner === team) continue;       // skip egen
      const dx = base.x - px, dy = base.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestBase = base; }
    }
    if (bestBase) {
      return { x: bestBase.x, y: bestBase.y, type: 'siege_base', ref: bestBase };
    }
  }
  // Fallback: hitta närmsta motståndare även om långt borta
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
    || target.type === 'koth_zone' || target.type === 'br_loot' || target.type === 'br_zone_center'
    || target.type === 'revive';   // v1.663: stå nära nedslagen lagkamrat (revive-radie)
  // v1.663: vapen-räckvidds-medvetet skjutavstånd (var fast 250px för ALLA guns →
  // hagel-bot utom räckhåll, sniper-bot för nära). Långa vapen håller distans, korta
  // går in. + självbevarelse: kita undan vid låg HP.
  let desiredDist;
  if (isObjective) desiredDist = 30;
  else if (isMelee) desiredDist = Math.max(20, (w.range || 36) - 5);
  else {
    const LONG = ['sniper', 'railgun', 'crossbow', 'bow', 'rifle', 'minigun'];
    const SHORT = ['shotgun', 'flame', 'smg'];
    desiredDist = LONG.indexOf(ps.weaponId) >= 0 ? 460 : (SHORT.indexOf(ps.weaponId) >= 0 ? 150 : 260);
  }
  if (bot.fleeing && !isObjective) desiredDist = Math.max(desiredDist, 520);
  const speed = 180;

  // Wall-unstick: om bot rört sig <20px på 1s, lås in i sidoangle 90° för 1.5s
  const moved = Math.hypot(ps.x - bot.lastX, ps.y - bot.lastY);
  if (moved < 20 * dt * 30) {            // < ~20px per ~1s vid 30Hz
    if (bot.stuckSince === 0) bot.stuckSince = now;
    if (now - bot.stuckSince > 1000 && now > bot.unstickUntil) {
      bot.unstickUntil = now + 1500;
      bot.strafeDir = -bot.strafeDir;    // flippa riktning
    }
  } else {
    bot.stuckSince = 0;
  }
  bot.lastX = ps.x;
  bot.lastY = ps.y;

  // Per-bot strafe-flip timing (annars rör sig alla bots synkat med klockan)
  if (now > bot.strafeFlipAt) {
    bot.strafeFlipAt = now + 900 + (bot.seed % 600);  // 900-1500ms per bot
    bot.strafeDir = -bot.strafeDir;
  }

  // Force sido-angle om unstick aktiv — MEN inte om bot är i BR utanför zonen
  // (annars wobble: bot strafe:r 90° → tillbaka utanför zonen → unstick triggas
  // igen → loop. Måste prioritera "kom IN i zonen" framför wall-unstick.)
  const isBrZoneEscape = sim.battleroyaleActive && target.type === 'br_zone_center';
  if (now < bot.unstickUntil && !isBrZoneEscape) {
    const nx = -dy / d, ny = dx / d;
    ps.x += nx * speed * bot.strafeDir * dt;
    ps.y += ny * speed * bot.strafeDir * dt;
  } else if (d > desiredDist) {
    ps.x += (dx / d) * speed * dt;
    ps.y += (dy / d) * speed * dt;
  } else if (d < desiredDist - 60 && (!isMelee || bot.fleeing)) {
    // v1.663: backa undan — ranged kitar; melee gör det bara när de flyr (låg HP).
    ps.x -= (dx / d) * speed * 0.5 * dt;
    ps.y -= (dy / d) * speed * 0.5 * dt;
  } else {
    const nx = -dy / d, ny = dx / d;
    ps.x += nx * speed * 0.6 * dt * bot.strafeDir;
    ps.y += ny * speed * 0.6 * dt * bot.strafeDir;
  }

  // Dynamisk arena-clamp: läs från sim.tdmArena/CTF/SIEGE/GUNGAME_ARENA om satt,
  // fallback till stora 5000×3000 default. (Gungame är 3500×2000 men i de andra
  // modes kan bot tidigare inte nå höger del av Siege 5000×3000.)
  let worldW, worldH;
  if (sim.tdmArena && sim.tdmArena.worldW) {
    worldW = sim.tdmArena.worldW; worldH = sim.tdmArena.worldH;
  } else if (sim.juggernautActive) {
    worldW = 5000; worldH = 3500;
  } else if (sim.battleroyaleActive) {
    worldW = BATTLEROYALE_ARENA.worldW; worldH = BATTLEROYALE_ARENA.worldH;
  } else if (sim.gungameActive || sim.kothActive) {
    worldW = 3500; worldH = 2000;
  } else {
    worldW = 5000; worldH = 3000;
  }
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
  const p = { x: ps.x, y: ps.y, aimAngle: ang, r: 14, peerId: botWs.id };
  const params = { dmgMul: 1, perks: {}, cheats: {} };
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
