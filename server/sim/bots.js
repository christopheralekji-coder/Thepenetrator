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

const BOT_NAMES = ['Hovigo', 'Jamlo', 'Kostefo', 'Wisämo', 'Salimius', 'Muzzius', 'Okanius'];
let _botCounter = 0;

// Skill-presets: påverkar aim-jitter och fire-rate
// easy: tydligt sämre — bra för nybörjare
// normal: balanserad (default)
// hard: nästan perfekt aim, snabb fire-rate
const BOT_SKILL = {
  easy:   { aimJitter: 0.28, cooldownMul: 1.8, reactionMs: 350 },
  normal: { aimJitter: 0.12, cooldownMul: 1.3, reactionMs: 180 },
  hard:   { aimJitter: 0.05, cooldownMul: 1.0, reactionMs: 80 },
};

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
      weaponId: 'pistol',
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

    // 1) Välj target baserat på mode
    const target = chooseBotTarget(sim, botWs);
    botWs._bot.target = target;
    if (!target) continue;

    // 2) Rör mot target
    moveBotTowards(sim, botWs, target, dt);

    // 3) Skjut om i range och cooldown är klar
    shootIfReady(sim, botWs, target, now);
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
  // Story/coop: närmsta enemy (sim.enemies)
  return findClosestEnemy(sim, botWs);
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
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = { x: ws.playerState.x, y: ws.playerState.y, type: 'player', ref: ws }; }
  }
  return best;
}

function findClosestEnemy(sim, botWs) {
  const px = botWs.playerState.x, py = botWs.playerState.y;
  let best = null, bestD2 = Infinity;
  for (const e of sim.enemies) {
    if (e.dead) continue;
    const dx = e.x - px, dy = e.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = { x: e.x, y: e.y, type: 'enemy', ref: e }; }
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
    || target.type === 'koth_zone';
  const desiredDist = isObjective ? 30 : (isMelee ? Math.max(20, (w.range || 36) - 5) : 250);
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

  // Force sido-angle om unstick aktiv
  if (now < bot.unstickUntil) {
    const nx = -dy / d, ny = dx / d;
    ps.x += nx * speed * bot.strafeDir * dt;
    ps.y += ny * speed * bot.strafeDir * dt;
  } else if (d > desiredDist) {
    ps.x += (dx / d) * speed * dt;
    ps.y += (dy / d) * speed * dt;
  } else if (d < desiredDist - 60 && !isMelee) {
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
  const ang = Math.atan2(dy, dx) + jitter;
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
