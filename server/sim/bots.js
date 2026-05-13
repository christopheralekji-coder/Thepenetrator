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

const BOT_NAMES = ['Echo', 'Vega', 'Nyx', 'Atlas', 'Onyx', 'Raven', 'Zane', 'Kira'];
let _botCounter = 0;

// Spawna bot i ett sim-rum. Returnerar bot-id om lyckad.
// team='red'|'blue'|null (FFA). spawnPos sätts av caller efter mode.
function addBot(sim, team) {
  _botCounter++;
  const botId = 'bot_' + _botCounter;
  const name = BOT_NAMES[(_botCounter - 1) % BOT_NAMES.length];
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
  // GUNGAME (FFA): närmsta annan spelare (inkl bots)
  if (sim.gungameActive && !sim.gungameEnded) {
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

function chooseSiegeTarget(sim, botWs, team) {
  // MVP: gå mot närmsta motståndare-spelare. (Base-capture-mekaniken är komplex —
  // kräver att man står i radie länge — skip för nu.)
  return findClosestPlayer(sim, botWs, team);
}

function moveBotTowards(sim, botWs, target, dt) {
  const ps = botWs.playerState;
  const dx = target.x - ps.x;
  const dy = target.y - ps.y;
  const d = Math.hypot(dx, dy) || 1;
  const w = W_BY_ID[ps.weaponId] || {};
  const isMelee = w.type === 'melee';
  // För melee: hoppa in tätt (range ~ w.range). För gun: håll avstånd (~250-400px).
  const desiredDist = isMelee ? Math.max(20, (w.range || 36) - 5) : 250;
  const speed = 180;                         // px/s, matcha grunt-AI roughly
  if (d > desiredDist) {
    // Närma sig
    ps.x += (dx / d) * speed * dt;
    ps.y += (dy / d) * speed * dt;
  } else if (d < desiredDist - 60 && !isMelee) {
    // Backa lite om för nära (bara för gun-bots — melee vill stå nära)
    ps.x -= (dx / d) * speed * 0.5 * dt;
    ps.y -= (dy / d) * speed * 0.5 * dt;
  } else {
    // Strafe i sidled för att vara svår att träffa
    const nx = -dy / d, ny = dx / d;          // perpendikulär
    const strafeDir = (Math.floor(Date.now() / 1200) % 2) === 0 ? 1 : -1;
    ps.x += nx * speed * 0.6 * dt * strafeDir;
    ps.y += ny * speed * 0.6 * dt * strafeDir;
  }
  // Clamp inom arena-bounds (use sim.config eller default 4000x3000)
  // Per-mode worldW/worldH skulle vara bättre men 4000x3000 räcker som safety
  ps.x = Math.max(50, Math.min(4400, ps.x));
  ps.y = Math.max(50, Math.min(3000, ps.y));
  // Spara aim-vinkel (för shoot)
  ps.aim = Math.atan2(dy, dx);
}

function shootIfReady(sim, botWs, target, now) {
  const ps = botWs.playerState;
  const w = W_BY_ID[ps.weaponId];
  if (!w) return;
  const bot = botWs._bot;
  const rate = w.rate || 400;
  const cooldown = rate * 1.3;               // bots skjuter lite saktare än rate cap
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
  // Lite aim-jitter så bots inte är perfekta (5% spread i radianer)
  const jitter = (Math.random() - 0.5) * 0.10;
  const ang = Math.atan2(dy, dx) + jitter;
  const p = { x: ps.x, y: ps.y, aimAngle: ang, r: 14, peerId: botWs.id };
  const params = { dmgMul: 1, perks: {}, cheats: {} };
  if (w.type === 'melee') {
    applyMelee(sim, p, ps.weaponId, params);
  } else {
    spawnPlayerBullets(sim, p, ps.weaponId, params);
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
