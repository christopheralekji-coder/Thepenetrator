// Per-room simulation. Phase 4: bossar + waves + stages.
'use strict';

const { encodeWorldBinary } = require('./wirefmt');
const { makeEnemy, updateEnemy, resolveWallsCircle } = require('./enemies');
const { makeBoss } = require('./bosses');
const { spawnPlayerBullets, applyMelee, updateBullets, damageEnemy, explode, pveWalls } = require('./bullets');
const { enterGulag, gulagMatchmake, tickGulag, voidAllGulag, startGulagPractice } = require('./gulag');
const { addBot, tickBots, removeAllBots, resetBotAiState } = require('./bots');
const { tickGrenadeZones, tickPlayerBurn, pvpActive } = require('./grenades');
const { updateBoss } = require('./bosses');
const { loadStage, updateZoneProgression, spawnEnemyAtEdge, isStageComplete, onWaveComplete, checkBossDeath } = require('./waves');
const { getDiffMul: cdGetDiffMul, getCoopMultiplier: cdGetCoopMul, getCoopDmgMultiplier: cdGetCoopDmgMul, getCoopSpawnMultiplier: cdGetCoopSpawnMul } = require('../../shared/stages-data');
const { updatePickups, dropFromEnemyDeath } = require('./pickups');
const { getStage } = require('../../shared/stages-data');
const { CTF_ARENA, resolveCtfWall, bulletHitsWall, buildWallGrid, wallsInRect } = require('../../shared/ctf-arena');
const { TDM_ARENA } = require('../../shared/tdm-arena');
const { SIEGE_ARENA } = require('../../shared/siege-arena');
const { GUNGAME_ARENA, GUNGAME_WEAPONS, GUNGAME_MELEE_DEMOTERS } = require('../../shared/gungame-arena');
const { KOTH_ARENA } = require('../../shared/koth-arena');
const { JUGGERNAUT_ARENA } = require('../../shared/juggernaut-arena');
const { BATTLEROYALE_ARENA } = require('../../shared/battleroyale-arena');
const { CASTLEDEFENSE_ARENA } = require('../../shared/castledefense-arena');
const { encodeWorld } = require('../net/world-codec');  // AAA #1: binär world för bin-peers
const { SURVIVORS_ARENA } = require('../../shared/survivors-arena');
const { HEIST_ARENA } = require('../../shared/heist-arena');
const { BOSS_CONFIGS } = require('../../shared/boss-configs');
const { SpatialGrid } = require('./spatial');
const accounts = require('../accounts');   // server-auktoritativ match-XP (fas 1, bakom flagga)

// 45Hz → 60Hz (v1.391): tickar var 16.7ms istället för 22ms. Sparar ~3-6ms
// quantization-lag per tick + matchar 60fps-rendering på klient.
// Server-load är 99% idle (tick avg 0.3-5ms av nuvarande 22ms budget) så
// 33% mer ticks/sec är trivial cost. Mätbart bättre input→action-feel.
// Vid CPU-tryck (50+ samtida spelare): sätt SIM_TICK_HZ=45 env-var i Render.
const TICK_HZ = parseInt(process.env.SIM_TICK_HZ, 10) || 60;
const TICK_MS = 1000 / TICK_HZ;
// Broadcast-rate matchar tick — minimal input→pixel-delay. Per-peer-broadcast
// kostar mest i deflate, men threshold:256 skippar för små paket (~32B).
// Bandwidth: ~2.5KB/s → ~3.3KB/s per peer. Försumbart.
const BROADCAST_HZ = parseInt(process.env.SIM_BROADCAST_HZ, 10) || 60;
const BROADCAST_EVERY = Math.max(1, Math.round(TICK_HZ / BROADCAST_HZ));
const FULL_BROADCAST_MS = 1500;
const ENEMY_CAP = 80;
const CULL_DIST = 1100;
// AAA per-entitet-budget (V2): max enemy-entries i ETT delta-paket per peer. Över
// detta skjuts de FJÄRRAN upp till nästa tick (off-screen → osynligt). Generöst
// (täcker on-screen + buffert) → engagerar bara vid äkta trängsel. ENV-bar.
const ENEMY_DELTA_BUDGET = parseInt(process.env.SIM_ENEMY_BUDGET, 10) || 64;
// M5 (audit 2026-06-10): JSON-peers (Godot/_jsonWorld) MÅSTE alltid få full
// enemy-lista — klienten har ingen delta-hantering (frånvarande idx = borttagen
// enemy) → FULL_BROADCAST_MS/delta-mönstret kan inte användas för dem. Istället
// sänks SÄNDFREKVENSEN: world-paket till JSON-peers skickas bara var
// JSON_WORLD_EVERY:e broadcast (60Hz/2 = 30Hz). Godot lerpar positioner (14/s,
// ~70ms-fönster > paketintervallet) → visuellt oskiljbart från 60Hz men halverad
// parse/bandbredd. 2 valt över 3 efter användarens smoothness-fråga.
// sim_events går fortfarande varje tick, och
// binär-klienter (V1-webben) påverkas inte alls. Utan detta: full lista +
// JSON.stringify per peer per tick ≈ 700KB/s (survivors cap 120) till flera
// MB/s (stresstest cap 1500) per JSON-peer — exakt den encode-burst som
// v1.701-staggern infördes mot.
const JSON_WORLD_EVERY = 2;

function createSim(room) {
  const sim = {
    room,
    enemies: [],
    bullets: [],
    gasClouds: [],
    flameTrails: [],
    nextEnemyIdx: 0,
    spawnTimer: 1.5,
    waveActive: false,
    enemiesToSpawn: 0,
    activeZonePool: null,
    currentZone: -1,
    zoneState: 'idle',
    eventTimer: 0,
    eventTriggered: false,
    miniBossSpawned: false,
    bossAlive: false,
    bossDefeated: false,
    bossSequenceStep: 0,
    wave: 1,
    eventQueue: [],
    enemyGrid: new SpatialGrid(),     // built once per tick, used by bullets/explode/applySeparation
    config: { difficulty: 'veteran', ngpLevel: 0, mode: 'story' },
    timeStopUntil: 0,
    lastTick: Date.now(),
    lastFullAt: 0,
    seqByPeer: new Map(),
    lastSentEnemyByPeer: new Map(),
    interval: null,
    // TDM-state (PvP)
    tdmActive: false,
    tdmKills: { red: 0, blue: 0 },
    tdmTargetKills: 10,
    tdmEnded: false,
    tdmKillsByPid: {},   // peerId → kills (för leaderboard)
    tdmDeathsByPid: {},  // peerId → deaths
    // CS-runda-state: runda slutar när ett lag wipeas → 3s → alla respawnar + vapen
    // resettas. Kills ackumuleras tvärs rundor; match slutar vid tdmTargetKills.
    tdmRoundActive: false,
    tdmRoundNum: 0,
    tdmRoundResetAt: 0,
    tdmRoundWins: { red: 0, blue: 0 }, // v1.732: match vinns på rundvinster (tdmTargetKills = mål)
    _tdmRoundHadBoth: false, // hade rundan spelare i BÅDA lag? (annars ingen wipe-check)
    // CTF-state (Capture the Flag PVP)
    ctfActive: false,
    ctfCaptures: { red: 0, blue: 0 },
    ctfTargetCaptures: 3,
    ctfEnded: false,
    ctfKillsByPid: {},     // för leaderboard
    ctfCapturesByPid: {},  // peerId → captures
    ctfFlags: {            // flagga-state — carrierId === null betyder "på base/dropad/return-timer"
      red:  { x: 0, y: 0, baseX: 0, baseY: 0, carrierId: null, atBase: true, droppedAt: 0 },
      blue: { x: 0, y: 0, baseX: 0, baseY: 0, carrierId: null, atBase: true, droppedAt: 0 },
    },
    // CTF-turrets: en MG-torn per lag. occupantId === null = ledig, satt = en spelare sitter i.
    // hp <= 0 = destroyed (kan inte mountas igen). lastShotAt = rate-limit för MG-fire.
    ctfTurrets: {},
    // SIEGE THE BASE state
    siegeActive: false,
    siegeTargetPoints: 500,
    siegeEnded: false,
    siegeScores: { red: 0, blue: 0 },
    siegeKillsByPid: {},
    siegeBases: {},        // baseId → { id, x, y, r, owner, captureProgress, captureSide }
    siegeCores: {},        // coreId → { id, team, x, y, w, h, hp, maxHp, destroyed }
    siegeTurrets: {},      // turretId → same structure as ctfTurrets
    _siegePointAccum: { red: 0, blue: 0 }, // fractional points buffer
    _siegeLastTick: 0,
    // GUNGAME state (FFA, 15-tier progression)
    gungameActive: false,
    gungameEnded: false,
    gungameWinner: null,
    gungameTiers: {},        // peerId → 0..14 (current weapon tier)
    gungameKillsByPid: {},   // peerId → total kills (för stats)
    _gungameSpawnIdx: 0,     // roterar spawn-punkter så respawn inte upprepar
    // KOTH state (FFA, hold-the-hill, first to N points)
    kothActive: false,
    kothEnded: false,
    kothWinner: null,
    kothTargetPoints: 100,
    kothScores: {},          // peerId → points
    kothKillsByPid: {},      // peerId → kills (för stats)
    kothActiveZoneIdx: 0,    // current zone-index (rotates)
    _kothZoneRotateAt: 0,    // när nästa zone-rotation sker
    _kothPointAccum: {},     // peerId → fractional accumulator
    _kothSpawnIdx: 0,        // spawn-rotation
    // JUGGERNAUT state (FFA-roll, 1 JUG åt gången, mest tid-som-JUG vinner)
    juggernautActive: false,
    juggernautEnded: false,
    juggernautWinner: null,
    juggernautPid: null,           // nuvarande JUG (peerId), null = ingen
    juggernautWeapon: null,        // vapen JUG-spelaren valt (rifle/shotgun/sledge)
    juggernautScores: {},          // peerId → ackumulerad tid som JUG (sek)
    juggernautKillsByPid: {},      // peerId → kills som JUG
    juggernautHpMax: 0,            // beräknas vid match-start från hunterCount
    juggernautEndAt: 0,            // ms timestamp då matchen tar slut
    juggernautDmgToJug: {},        // peerId → ackumulerad dmg gjord mot current JUG (reset:as vid transfer)
    _juggernautLastPulseAt: 0,     // ms när senaste minimap-puls sändes
    _juggernautSpawnIdx: 0,        // roterar spawn-punkter
    _juggernautScoreAccum: 0,      // fractional second-accumulator för JUG score
    // BATTLE ROYALE state (FFA, no-respawn, shrinking zone)
    battleroyaleActive: false,
    battleroyaleEnded: false,
    battleroyaleWinner: null,
    battleroyaleMatchDurationSec: 600,
    battleroyaleStartedAt: 0,
    battleroyaleEndAt: 0,
    battleroyalePhase: 0,           // 0=LOOT, 1-3=SHRINK, 4=FINAL
    battleroyalePhaseStartedAt: 0,  // ms när nuvarande fas började
    battleroyalePhaseEndAt: 0,      // ms när nuvarande fas slutar
    battleroyaleZone: null,         // { x, y, r, nextX, nextY, nextR }
    battleroyaleLoot: [],           // [{ id, x, y, kind, weaponId, available, respawnAt }]
    battleroyaleKillsByPid: {},
    battleroyaleAliveCount: 0,
    battleroyaleEliminated: [],     // pids i ordning av elimination (för stats)
    battleroyaleRanks: {},          // pid → placering (1 = winner, N = först-eliminerad)
    _brZoneDmgTick: 0,              // ackumulator för outside-dmg-broadcasts
    _brPendingElim: {},            // #br-30s: pid -> disconnect-ts (uppskjuten elimination 30s)
    _brBroadcastTick: 0,
    _brLootIdCounter: 0,
    // BR ekonomi/armor-meta (Warzone-style) — v1.739
    brCash: {},                    // pid → cash (per-match)
    brBuyStations: [],             // [{ x, y, r, alien }] — disguised houses + alien-shop
    _brStartCash: 500,
    // BR contracts + supply drops (v1.746)
    brContracts: [],               // [{ id, x, y, type, available, takenBy, target, goalX, goalY, deadline }]
    brSupplyDrops: [],             // [{ id, x, y, landAt, landed, opened, fromContract }]
    brCritters: [],                // vilt (jakt): [{ id, type, x, y, dead, tx, ty, _repathAt, _atkAt, _face, _moving, _r }]
    _brCritterIdCtr: 0,
    _brContractIdCtr: 0,
    _brSupplyIdCtr: 0,
    _brBountyPingAccum: 0,
    _brNextSupplyAt: 0,
    // BR PRE-DROP / BATTLE BUS (additivt, gated på opts.brPredrop). Bussen flyger en
    // rak linje över kartan; spelarna åker den, trycker HOPPA → freefall (joystick-
    // styrt), fallskärm auto-deployar sent, landning → normalt spel (fas 0 LOOT).
    // Per-spelare på ws.playerState: brAir (0=landad,1=buss,2=freefall,3=fallskärm),
    // brJumpedAt (ms), brLandX/brLandY (fallback-spawn för bottar/forcerad landning).
    brPredrop: false,
    brBus: null,                 // { startX, startY, endX, endY, startAt, durMs }
    brPredropDeadlineAt: 0,
    _brPredropBroadcastAt: 0,
    // CASTLE DEFENSE state (co-op endless horde defense)
    castledefenseActive: false,
    castledefenseEnded: false,
    castledefenseStartedAt: 0,
    castledefenseWave: 0,                  // current wave (0 = pre-start)
    castledefenseWaveBetweenEndAt: 0,      // ms timestamp för nästa våg-start
    castledefenseWaveState: 'idle',        // 'idle' | 'between' | 'active'
    castledefenseCore: null,               // { x, y, r, hp, maxHp }
    castledefenseWalls: [],                // runtime-kopia av arena.walls med mutable hp
    castledefenseBuildings: [],            // [{ id, kind, x, y, w, h, hp, maxHp, ownerPid, ...kind-specific }]
    castledefenseScores: {},               // peerId → kills
    castledefenseGold: {},                 // peerId → per-match gold (för byggande, ej save.gold)
    castledefenseWeaponTier: {},           // peerId → vapen-tier (0 = pistol, 11 = sledge)
    castledefensePurchasedWeapons: {},     // peerId → Set av vapen köpta hos vapenhandlaren
    castledefensePerks: {},                // peerId → perk-id (10 hero-perks, unik per spelare — LEGACY)
    castledefensePerkRanks: {},            // v3 perk-träd: peerId → { nodeId: rank }
    castledefensePerkFlags: {},            // v3 perk-träd: peerId → { flag: rank } (effekt-lookup via cdFlags)
    castledefensePerkPoints: {},           // v3 perk-träd: peerId → antal okonsumerade perk-poäng
    castledefenseDownedPids: [],           // pids som är down (Phase 6)
    castledefenseRevivedCount: 0,
    _cdBuildIdCounter: 0,
    _cdBroadcastTick: 0,
    _cdWaveSpawnsRemaining: 0,
    _cdWaveSpawnTimer: 0,
  };
  return sim;
}

const CTF_FLAG_AUTORETURN_MS = 30000;
const CTF_CARRIER_SPEED_MUL = 0.80; // -25% speed för flag-carrier

function tickSim(sim) {
  const now = Date.now();
  const dt = Math.min(0.1, (now - sim.lastTick) / 1000);
  sim.lastTick = now;

  // v1.384: debug-stats broadcast var 500ms — så klient kan visa server-side
  // tick-tid i debug-overlay (toggleable via inställning).
  if (now - (sim._lastDbgBroadcastAt || 0) > 500) {
    sim._lastDbgBroadcastAt = now;
    sim.eventQueue.push({
      type: 'dbg_stats',
      tickAvg: Math.round((sim._tickMsEMA || 0) * 10) / 10,
      tickMax: Math.round((sim._tickMsMax || 0) * 10) / 10,
      members: sim.room.members.size,
      enemies: (sim.enemies && sim.enemies.length) || 0,
      bullets: (sim.bullets && sim.bullets.length) || 0,
    });
  }

  // Lag compensation: snapshot alla spelar-positioner FÖRE tick-logiken så vi
  // kan rewinda upp till 200ms när skott från en laggande klient anländer.
  // Ringbuffer per ws.playerState — håll bara 12 snapshots (~265ms @ 45Hz).
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    const ps = ws.playerState;
    if (!ps._history) ps._history = [];
    // C156 (audit 2026-06-18): återanvänd snapshot-objekten i st.f. att allokera ett
    // färskt {t,x,y} varje tick (var ~3600 small-objekt/s @ 60 members → GC-churn). Den
    // bortprunade slot:en muteras + återinsätts som nyaste → noll allokering per tick.
    // _history förblir en vanlig array ordnad äldst→nyast (index 0..len-1) → konsumenterna
    // (rewoundPosition i bullets.js + origin-clampen i applyShoot) är OFÖRÄNDRADE.
    let slot = null;
    // v1.705: Prune > 320ms — marginal över max rewind 250 (= RTT/2 + 60ms interp-delay, v1.701).
    // Förr 250 = exakt cap → noll marginal → högping-skytt föll på äldsta snapshot.
    while (ps._history.length > 0 && now - ps._history[0].t > 320) {
      slot = ps._history.shift();   // återanvänd ett av de prunade objekten
    }
    if (slot) { slot.t = now; slot.x = ps.x; slot.y = ps.y; }
    else slot = { t: now, x: ps.x, y: ps.y };
    ps._history.push(slot);
  }

  // Bot-AI: rör bots + skjuter. Skippar countdown och time-stop internt.
  // Körs FÖRE mode-specifika branches så bot-position är updated innan
  // bullets uppdateras / damage appliceras.
  tickBots(sim, dt, now);
  // V2: granat-zoner (molotov brinnande mark + gravitations-dragning). Bländgranat är
  // omedelbar (server.js). Skadefritt no-op om inga zoner.
  tickGrenadeZones(sim, dt, now);
  tickPlayerBurn(sim, now);   // lingrande brand-DoT (3s efter eldkastar-träff, PvP)
  // v2 forest+volcano: per-member transient status sweep (slow expiry + PvE burn DoT)
  for (const [, _sw] of sim.room.members) {
    const _ps = _sw && _sw.playerState;
    if (!_ps) continue;
    // expire player slow (slow_melee + root_hook bullet)
    if (_ps._slowUntil && now >= _ps._slowUntil) {
      _ps.speedMul   = _ps._baseSpeedMul || 1.0;
      _ps._slowUntil = 0;
    }
    // v2 volcano burn_melee: tick player burn-DoT in PvE/story modes.
    // tickPlayerBurn (grenades.js) handles PvP — skip here when PvP is active to
    // avoid double-ticking. In PvE, burnUntil/burnDps on the playerState is set by
    // applyContactDamage (burn_melee) and ticked continuously (dt-based) here.
    // Respects invulnUntil (spawn protection) and drains shield before HP, mirroring
    // the PvP path. No event emitted — HP change is broadcast via world snapshot.
    if (!pvpActive(sim) && _ps.burnUntil > now && _ps.hp > 0) {
      if (now >= (_ps.invulnUntil || 0)) {
        let _brem = (_ps.burnDps || 0) * dt;
        if (_brem > 0) {
          if ((_ps.shield || 0) > 0) { const _ab = Math.min(_ps.shield, _brem); _ps.shield -= _ab; _brem -= _ab; }
          if (_brem > 0) _ps.hp = Math.max(0, _ps.hp - _brem);
        }
      }
    }
  }

  // 5s startup-countdown: skicka world-snapshot (för synk) men frys enemy-AI/spawn/damage
  if (sim.simReadyAt && now < sim.simReadyAt) {
    broadcastWorld(sim, now);
    return;
  }
  if (sim.simReadyAt && now >= sim.simReadyAt) {
    sim.simReadyAt = 0;
    sim.eventQueue.push({ type: 'countdown_end' });
  }

  // v1.539: STRESS-TEST höjer cap drastiskt (500 vs 80) så vi KAN testa lager
  const _enemyCap = sim.stresstestActive ? 1500 : ENEMY_CAP;
  if (sim.enemies.length > _enemyCap) {
    const boss = sim.enemies.find(e => e.isBoss);
    sim.enemies = sim.enemies.slice(-_enemyCap);
    if (boss && !sim.enemies.includes(boss)) sim.enemies.push(boss);
  }

  // Time-stop fryser enemy-AI och bullets (mirror av game.js:7263)
  const timeStopped = sim.timeStopUntil && now < sim.timeStopUntil;

  // TDM-mode: skip enemy spawning/AI, but bullets MÅSTE tickas så spelare kan skjuta varandra
  if (sim.tdmActive) {
    const nowMs = Date.now();
    // Wall-collision för spelare (server-auth). resolveCtfWall muterar entity.x/y.
    for (const [, ws] of sim.room.members) {
      if (ws.playerState && ws.playerState.hp > 0) {
        const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
        resolveCtfWall(ent, TDM_ARENA.walls);
        ws.playerState.x = ent.x;
        ws.playerState.y = ent.y;
      }
    }
    if (!sim.tdmEnded) {
      if (!sim.tdmRoundActive) {
        // LOOT-FAS (5s): rundan avgjord men survivors kan fortf. röra sig + LOOTA
        // (greppa granater inför nästa runda). Pickups + bullets tickar; ingen wipe-check.
        tickPvpPickups(sim, now);
        updateBullets(sim, dt, now);
        if (sim.tdmRoundResetAt && nowMs >= sim.tdmRoundResetAt) {
          tdmStartRound(sim, nowMs);
        }
      } else {
        // AKTIV RUNDA — pickups + bullets + death (INGEN mid-runda-respawn)
        tickPvpPickups(sim, now);
        updateBullets(sim, dt, now);
        // Death-detection: markera död (ingen respawn-timer — CS-runda). Bullets.js
        // sätter _tdmDeadRound för player-kills; detta fyller luckor (explosion/PvE).
        for (const [pid, ws] of sim.room.members) {
          if (ws.playerState && ws.playerState.hp <= 0 && !ws._tdmDeadRound) {
            ws._tdmDeadRound = true;
            sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
            sim.eventQueue.push({ type: 'tdm_player_died', victim: pid, round: true });
          }
        }
        // TEAM-WIPE → runda slut (bara om rundan hade spelare i båda lag)
        if (sim._tdmRoundHadBoth) {
          let redAlive = 0, blueAlive = 0;
          for (const [, ws] of sim.room.members) {
            if (ws.playerState && ws.playerState.hp > 0) {
              if (ws.tdmTeam === 'red') redAlive++;
              else if (ws.tdmTeam === 'blue') blueAlive++;
            }
          }
          if ((redAlive === 0 || blueAlive === 0) && !sim.tdmEnded) {
            const winner = redAlive > 0 ? 'red' : (blueAlive > 0 ? 'blue' : null);
            sim.tdmRoundActive = false;
            sim.tdmRoundResetAt = nowMs + 5000; // 5s loot-fas (greppa granater inför nästa runda)
            // 17:41 #6e: ÖVERLEVARNA får FULL hp+shield DIREKT vid rundans slut
            // (förr först vid nästa rundas start → man lootade med halva barer och
            // kunde dödas under loot-fasen). Explicit event för att kringgå
            // shield-world-echo-gaten (samma skäl som tdm_player_respawned).
            for (const [hpid, hws] of sim.room.members) {
              if (!hws.playerState || hws.playerState.hp <= 0) continue;
              hws.playerState.hp = respawnHpFor(hws.playerState);
              hws.playerState.shield = respawnShieldFor(hws.playerState);
              sim.eventQueue.push({
                type: 'tdm_round_heal', peerId: hpid,
                hp: hws.playerState.hp, shield: hws.playerState.shield,
              });
            }
            // v1.734: LAG-baserad loadout-reset — hela förlorande LAGET tappar vapen+granater
            // (även de som överlevde), hela vinnande laget BEHÅLLER (även de som dog).
            sim._tdmLastLoser = winner ? (winner === 'red' ? 'blue' : 'red') : null;
            // v1.732: RUNDA-VINST-baserat — vinnaren får +1 rundvinst; match slutar vid målet
            if (!sim.tdmRoundWins) sim.tdmRoundWins = { red: 0, blue: 0 };
            if (winner) sim.tdmRoundWins[winner] = (sim.tdmRoundWins[winner] || 0) + 1;
            const target = sim.tdmTargetKills || 5; // repurposed: antal rundvinster till match-vinst
            sim.eventQueue.push({
              type: 'tdm_round_end', winner, roundNum: sim.tdmRoundNum,
              redKills: sim.tdmKills.red, blueKills: sim.tdmKills.blue,
              redWins: sim.tdmRoundWins.red, blueWins: sim.tdmRoundWins.blue,
              target, durationMs: 5000,
            });
            // Match slut?
            if (winner && sim.tdmRoundWins[winner] >= target) {
              sim.tdmEnded = true;
              sim.eventQueue.push({
                type: 'tdm_match_end', winner,
                redKills: sim.tdmKills.red, blueKills: sim.tdmKills.blue,
                redWins: sim.tdmRoundWins.red, blueWins: sim.tdmRoundWins.blue,
                stats: Object.keys(sim.tdmKillsByPid).map(pp => ({
                  peerId: pp, team: sim.room.members.get(pp) && sim.room.members.get(pp).tdmTeam,
                  kills: sim.tdmKillsByPid[pp] || 0, deaths: sim.tdmDeathsByPid[pp] || 0,
                })),
              });
            }
          }
        }
      }
    }
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }

  // CTF-mode: pickup/drop/capture-logik + bullets
  if (sim.ctfActive) {
    tickCtf(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // SIEGE-mode: capture-bases + core-damage + scoring
  if (sim.siegeActive) {
    tickSiege(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // KOTH-mode: hold-the-hill med roterande zon
  if (sim.kothActive) {
    tickKoth(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // GUNGAME-mode: FFA, 15-tier vapen-progression
  if (sim.gungameActive) {
    tickGungame(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // JUGGERNAUT-mode: 1 JUG (5× HP, +35% speed), övriga = hunters med pistol.
  // Mest tid-som-JUG vinner när timer går ut.
  if (sim.juggernautActive) {
    tickJuggernaut(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // BATTLE ROYALE: FFA, no-respawn, krympande zon. Sista överlevare vinner.
  if (sim.battleroyaleActive) {
    tickBattleRoyale(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // v1.637: HEIST HAR ABSOLUT PRIORITET — kollas FÖRE cd så cd-minions inte
  // kan spawna under heist-match (var bug: cd-flag leakade in i heist → minions
  // dök upp vilket gjorde matchen ospelbar).
  if (sim.heistActive) {
    // Defensiv: tvinga AV alla andra mode-flags så ingen leak kan ske
    sim.castledefenseActive = false;
    sim.survivorsActive = false;
    sim.waveActive = false;
    sim.battleroyaleActive = false;
    sim.juggernautActive = false;
    sim.tdmActive = false;
    sim.ctfActive = false;
    sim.siegeActive = false;
    sim.gungameActive = false;
    sim.kothActive = false;
    sim.enemiesToSpawn = 0;
    tickHeist(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // CASTLE DEFENSE: co-op endless horde defense. Skydda castle-core mot vågor.
  if (sim.castledefenseActive) {
    tickCastleDefense(sim, dt, now);
    sim._tickCount = (sim._tickCount || 0) + 1;
    if (sim._tickCount % BROADCAST_EVERY === 0) broadcastWorld(sim, now);
    return;
  }
  // Wave-spawn: spawnEnemyAtEdge
  if (sim.waveActive && sim.enemiesToSpawn > 0 && !timeStopped) {
    sim.spawnTimer -= dt;
    if (sim.spawnTimer <= 0 && sim.enemies.length < (sim.stresstestActive ? 1500 : ENEMY_CAP)) {
      const stage = _stageFor(sim, sim.wave);
      const players = buildPlayerList(sim);
      const beforeCount = sim.enemies.length;
      if (stage) spawnEnemyAtEdge(sim, stage, players);
      // v2: spawn-i-vägg-skydd — knuffa nyspawnade till närmaste fria kant direkt
      // (samma resolve som per-tick). null utan stageWalls (= V1 orört).
      if (sim.enemies.length > beforeCount) {
        const _spawnWalls = pveWalls(sim);
        if (_spawnWalls) {
          for (let k = beforeCount; k < sim.enemies.length; k++) {
            const _se = sim.enemies[k];
            const _seR = _se.r || 12;
            const _swCands = sim._pveWallGrid
              ? wallsInRect(sim._pveWallGrid, _se.x - _seR - 2, _se.y - _seR - 2, _se.x + _seR + 2, _se.y + _seR + 2)
              : _spawnWalls;
            resolveWallsCircle(_se, _swCands);
          }
        }
      }
      // Spam-skydd: bara logga första spawn per wave (annars 100+ logs/match)
      if (process.env.SIM_DEBUG || (sim._lastLogWave !== sim.wave)) {
        const spawned = sim.enemies.length > beforeCount;
        console.log('[SIM]', sim.room.code, 'spawn wave=' + sim.wave + ' zone=' + sim.currentZone + ' toSpawn=' + sim.enemiesToSpawn + ' players=' + players.length + ' spawned=' + spawned);
        sim._lastLogWave = sim.wave;
      }
      sim.enemiesToSpawn--;
      sim.spawnTimer = 0.4 + Math.random() * 0.4;
    }
  }

  // Bygg lista av "spelare"
  const players = buildPlayerList(sim);

  // Bygg spatial-grid över ALIVE enemies — används av bullets-collision,
  // applySeparation (i enemies.js), chain-effekter, explode. Sparar ~1M
  // ops/s vs linear scan vid 80 enemies × 200 bullets.
  // C138 (audit 2026-06-18): byggs nu FÖRE enemy-AI-loopen (var efter) så
  // applySeparation läser DENNA ticks positioner + nyspawnade fiender, inte föregående
  // ticks. AI nudgar bara positioner (lägger inte till/tar bort) → samma grid duger för
  // bullet-collision som körs efter AI (cull/death sker längre ned).
  sim.enemyGrid.clear();
  for (const e of sim.enemies) {
    if (!e.dead) sim.enemyGrid.insert(e);
  }

  // Enemy + boss AI (frozen vid time-stop)
  if (!timeStopped) {
    // v2: PvE-stage-väggar (story-husen) — samma cachade lista som kulorna
    // (bullets.js _pveWalls). null i PvP/CD/heist eller utan stageWalls
    // → hela resolve-steget hoppas över (= V1-vägar exakt orörda).
    const _enemyWalls = pveWalls(sim);
    for (const e of sim.enemies) {
      if (e.dead) continue;
      // v2 R10b (additivt): showcase-frusna enheter skippar AI/attack/rörelse.
      // Flaggan sätts aldrig i V1-vägar (kräver stresstest) → no-op här normalt.
      if (e._showcaseFrozen) continue;
      if (e.isBoss) {
        updateBoss(sim, e, dt, now, players);
      } else {
        updateEnemy(e, dt, now, sim, players);
      }
      // World bounds (förenklad)
      const stage = _stageFor(sim, sim.wave);
      const ww = stage ? stage.worldW : 4000;
      const wh = stage ? stage.worldH : 3000;
      e.x = Math.max(20, Math.min(ww - 20, e.x));
      e.y = Math.max(20, Math.min(wh - 20, e.y));
      // v2: lös överlapp mot husen EFTER att AI:n flyttat (ingen path-ändring) —
      // fienden glider längs väggen (minsta-penetrations-axeln) istället för fastna.
      // C225: wallsInRect-broadphase på _pveWallGrid (~3x snabbare vid 80+ walls).
      if (_enemyWalls) {
        const _eWr = e.r || 12;
        const _ewCands = sim._pveWallGrid
          ? wallsInRect(sim._pveWallGrid, e.x - _eWr - 2, e.y - _eWr - 2, e.x + _eWr + 2, e.y + _eWr + 2)
          : _enemyWalls;
        resolveWallsCircle(e, _ewCands);
      }
    }
  }

  // PvE lag-comp: snapshot enemy positions AFTER AI movement so bullets.js can
  // rewind enemies to where a human shooter saw them (mirrors player _history at :263).
  // Ring-buffer: prune entries older than 350ms + reuse pruned slot objects (noll-alloc
  // per tick). At 60Hz the window holds ≤22 entries — well within GC budget for 80 enemies.
  for (const e of sim.enemies) {
    if (e.dead) continue;
    if (!e._history) e._history = [];
    let _ehSlot = null;
    while (e._history.length > 0 && now - e._history[0].t > 350) {
      _ehSlot = e._history.shift();
    }
    if (_ehSlot) { _ehSlot.t = now; _ehSlot.x = e.x; _ehSlot.y = e.y; }
    else _ehSlot = { t: now, x: e.x, y: e.y };
    e._history.push(_ehSlot);
  }

  // Skriv tillbaka playerState.hp + invulnUntil från contact-damage
  if (!sim.deadBodies) sim.deadBodies = {};
  for (const p of players) {
    if (p._tookDamageFrom) {
      const ws = sim.room.members.get(p.peerId);
      if (ws && ws.playerState) {
        ws.playerState.hp = p.hp;
        ws.playerState.invulnUntil = p.invulnUntil;
        // v2 #68: skriv tillbaka shield-absorptionen (gated — V1 har baseShield 0)
        if (sim.baseShield > 0 && !p._isCompanion) ws.playerState.shield = p.shield || 0;
      }
    }
  }
  // Centraliserad death-detektering — täcker alla damage-källor (contact, hostile bullets, hazards, explosion)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    // C150 (audit 2026-06-18): bots är fulla room.members med playerState — en downad bot
    // ska INTE skapa deadBody/player_died/revive-prompt (co-op-revive är ett människo-system).
    if (ws._isBot) continue;
    if (ws.playerState.hp <= 0 && !sim.deadBodies[pid]) {
      sim.deadBodies[pid] = {
        x: ws.playerState.x,
        y: ws.playerState.y,
        reviveTimer: 0,
        revivedBy: null,
      };
      sim.eventQueue.push({ type: 'player_died', peerId: pid });
      // v2: Sista skrattet-perken — explosion vid din död (200 dmg, 250px)
      if (ws.playerState.perks && ws.playerState.perks.lastlaugh) {
        explode(sim, ws.playerState.x, ws.playerState.y, 250, 200, pid);
        sim.eventQueue.push({ type: 'grenade_thrown', fromX: ws.playerState.x, fromY: ws.playerState.y,
          toX: ws.playerState.x, toY: ws.playerState.y, flightMs: 1, kind: 'frag', radius: 250 });
      }
    }
  }
  // Revive-tick: om annan LEVANDE spelare står inom 50px av kroppen i 5s → revive
  updateRevive(sim, dt);

  // Bullet-uppdatering (frozen vid time-stop? Original-kod fryser BARA enemies, ej bullets)
  updateBullets(sim, dt, now);

  // Hazards: gasClouds + flameTrails — applicera DoT på spelare
  updateHazards(sim, dt, now, players);

  // v2 #58 (additivt): SANDBOX-dummies är ODÖDLIGA — toppa upp hp + häv died-flaggan
  // varje tick (täcker burn-DoT/explosioner/edge-paths utöver damageEnemy-guarden).
  // Flaggan sätts bara av sandbox-stages (V1 skickar aldrig sandbox) → no-op för V1.
  if (sim._hasSandboxDummies) {
    for (const e of sim.enemies) {
      if (e._sandboxDummy) {
        // V2: dummies är odödliga MEN ska visa skadesiffror (DPS-test). Räkna skadan
        // som togs denna tick (maxHp − hp) och skicka ett event INNAN vi toppar upp.
        const taken = (e.maxHp || 0) - (e.hp || 0);
        if (taken > 0.5) {
          sim.eventQueue.push({ type: 'dummy_damage', x: Math.round(e.x), y: Math.round(e.y - (e.r || 20)), dmg: Math.round(taken) });
        }
        e.hp = e.maxHp; e.dead = false;
      }
    }
  }

  // Boss-death tracking + pickup-droppar
  if (sim.enemies.some(e => e.dead)) {
    for (const e of sim.enemies) {
      if (!e.dead) continue;
      if (e.isBoss) checkBossDeath(sim, e);
      // Mini-boss interlude: när miniboss dör + fler i listan → spawn enemies
      // (server-side spegling av game.js:killEnemy)
      if (e.isMiniBoss && !e._miniBossNextSpawned) {
        e._miniBossNextSpawned = true;
        // Använd top-level imports (require är hot-loop-noise + crashar mid-tick
        // om modul-load fail. getStage + makeEnemy redan importerade.)
        const stage = _stageFor(sim, sim.wave);
        const list = stage && (stage.miniBosses || (stage.miniBoss ? [stage.miniBoss] : []));
        if (list && (sim.miniBossesSpawned || 0) < list.length) {
          sim._miniInterludeActive = true;
          sim._miniInterludeNextIdx = sim.miniBossesSpawned;
          // Spawn 5-7 interlude-enemies från stage-pool
          const zones = stage.zones || [];
          const pool = (zones[Math.min(sim.currentZone || 0, zones.length - 1)] || zones[0] || { pool: ['grunt'] }).pool;
          const count = 5 + Math.floor(Math.random() * 3);
          for (let i = 0; i < count; i++) {
            const t = pool[Math.floor(Math.random() * pool.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 350 + Math.random() * 200;
            const cx = e.x + Math.cos(angle) * dist;
            const cy = e.y + Math.sin(angle) * dist;
            const ne = makeEnemy(t,
              Math.max(40, Math.min(stage.worldW - 40, cx)),
              Math.max(40, Math.min(stage.worldH - 40, cy)));
            ne._idx = sim.nextEnemyIdx++;
            sim.enemies.push(ne);
          }
        }
      }
      // v2 forest split_on_death: spawn children INNAN splice (respekterar 80-cap)
      if (e.behavior === 'split' && !e._noSplit && e.splitType && sim.enemies.length < 80) {
        const _sc = Math.min(e.splitCount || 2, 80 - sim.enemies.length);
        for (let _si = 0; _si < _sc; _si++) {
          const _sx = e.x + (Math.random() - 0.5) * 30;
          const _sy = e.y + (Math.random() - 0.5) * 30;
          const _child = makeEnemy(e.splitType, _sx, _sy);
          _child._idx  = sim.nextEnemyIdx++;
          _child._noSplit = true;   // förhindra kedje-split
          sim.enemies.push(_child);
        }
      }
      // Drop pickup
      dropFromEnemyDeath(sim, e);
      if (sim.eventQueue) {
        sim.eventQueue.push({
          type: 'enemy_killed',
          i: e._idx,
          gold: e.gold || 0,
          killerPid: e.lastDamagerPid || null,
          weaponId: e.lastDamagerWeapon || null,   // v2 E6 (additivt — V1 ignorerar)
          isBoss: !!e.isBoss,
          isMiniBoss: !!e.isMiniBoss,
        });
      }
    }
    sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // Pickup-update (magnet, collect)
  updatePickups(sim, dt);

  // Wave progression
  if (sim.waveActive) {
    updateZoneProgression(sim, dt);
    if (isStageComplete(sim)) onWaveComplete(sim);
  }

  // Skicka world-snapshots — bara var BROADCAST_EVERY:te tick för att spara CPU
  sim._tickCount = (sim._tickCount || 0) + 1;
  if (sim._tickCount % BROADCAST_EVERY === 0) {
    broadcastWorld(sim, now);
  }
}

// Revive-system: levande spelare nära dead body 5s → respawn på platsen med 50% HP
const REVIVE_SEC = 5;  // v1.788: enda källan för revive-duration (co-op story/heist)
function updateRevive(sim, dt) {
  if (!sim.deadBodies) return;
  const nowMs = Date.now();
  for (const peerId of Object.keys(sim.deadBodies)) {
    const body = sim.deadBodies[peerId];
    let anyReviving = false;
    let reviverPid = null;
    for (const [pid, ws] of sim.room.members) {
      if (pid === peerId) continue;
      // C150 updated (bot-revive fix): bots ARE allowed to revive downed humans.
      // Only humans ever create deadBodies (bots are skipped at the death-detection
      // block, ~line 591), so a bot here always revives a human — "bot revives bot"
      // is structurally impossible. Removing the old gate fixes the permanent
      // soft-lock: human down + bot(s) alive → no-one revives → stage never ends.
      // Bots path to the body with desiredDist=30px (inside the 50px revive radius),
      // so the timer ticks normally once they arrive.
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - body.x;
      const dy = ws.playerState.y - body.y;
      if (dx * dx + dy * dy < 50 * 50) {
        anyReviving = true;
        reviverPid = pid;
        body.reviveTimer = (body.reviveTimer || 0) + dt;
        body.revivedBy = pid;
        if (body.reviveTimer >= REVIVE_SEC) {
          // Återuppliv!
          const deadWs = sim.room.members.get(peerId);
          if (deadWs && deadWs.playerState) {
            deadWs.playerState.x = body.x;
            deadWs.playerState.y = body.y;
            deadWs.playerState.hp = 50;
            // v2 #68: revive ger start-shield igen (gated — V1 har baseShield 0)
            if (sim.baseShield > 0) deadWs.playerState.shield = sim.baseShield;
            deadWs.playerState.invulnUntil = Date.now() + 2000;
          }
          delete sim.deadBodies[peerId];
          // v1.788: slut-progress (1.0) + revived till ALLA i samma batch (bar når 100% innan den försvinner)
          sim.eventQueue.push({ type: 'revive_progress', peerId, reviverPid: pid, progress: 1 });
          sim.eventQueue.push({ type: 'player_revived', peerId, revivedBy: pid });
        }
        break;
      }
    }
    if (!anyReviving) body.reviveTimer = Math.max(0, (body.reviveTimer || 0) - dt);
    // v1.788 SYNK-FIX: broadcasta SAMMA progress (0-1 float) till ALLA (reviver + revivee)
    // ~8Hz, exakt som Castle Defense. Båda parter ritar från detta → IDENTISK + smooth
    // nedräkning, ingen diff-tid. Ersätter den trasiga per-spelar-rT (var alltid 0).
    const stillDown = sim.deadBodies[peerId];
    if (stillDown && (body.reviveTimer > 0 || anyReviving)) {
      if (!body._lastProg || nowMs - body._lastProg > 120) {
        body._lastProg = nowMs;
        sim.eventQueue.push({
          type: 'revive_progress', peerId, reviverPid,
          progress: Math.min(1, (body.reviveTimer || 0) / REVIVE_SEC),
        });
      }
    }
  }
}

// v2-tillägg (additivt): custom stage-listor (Godot-klientens endless/bossrush m.fl.)
// — utan lista används STAGES exakt som förut.
function _stageFor(sim, w) {
  const cs = sim && sim.customStagesList;
  return (cs && cs[w - 1]) || getStage(w);
}

// Respawn-värden: spelarens FULLA hp/shield inkl. klient-rapporterade upgrades
// (_cliMaxHp/_cliMaxShield via sim_input). Tidigare hårdkodat 100 → en spelare med
// hp/shield-upgrades (max_hp 100+25/nv) respawnade på en bråkdel av sin bar (kändes
// ~20 hp). Gammal klient skickar ej fälten → fallback exakt som förr.
function respawnHpFor(ps) { return Math.max(1, Math.round(ps._cliMaxHp || ps.maxHp || 100)); }
function respawnShieldFor(ps) {
  if (ps._cliMaxShield != null) return Math.max(0, Math.round(ps._cliMaxShield));
  return ps.maxShield || 100;
}

// SPECTATE: medlemsantal EXKL. åskådare. Åskådare sitter i room.members (för world-
// broadcasts) men bidrar ingen eldkraft → de får ALDRIG skala co-op-svårighet,
// JUG-sköld/hunter-antal eller medic-regen. Bots räknas som förr (de strider faktiskt).
function _realMemberCount(sim) {
  let n = 0;
  for (const [, m] of sim.room.members) if (!m || !m.isSpectator) n++;
  return n;
}

function buildPlayerList(sim) {
  const stage = _stageFor(sim, sim.wave);
  const defaultX = stage ? stage.spawnPos.x : 1000;
  const defaultY = stage ? stage.spawnPos.y : 1000;
  const players = [];
  for (const [pid, ws] of sim.room.members) {
    // SPECTATE: en spectator är aldrig en spelare → syns aldrig i players[] (ingen
    // nod på någons skärm, ingen contact-damage-måltavla, ingen scoreboard-rad).
    if (ws.isSpectator) continue;
    // Late-joiner: init till stage spawn-pos så de inte hamnar på (1000,1000) random plats
    if (!ws.playerState) ws.playerState = { x: defaultX, y: defaultY, hp: 100 };
    const ps = ws.playerState;
    players.push({
      peerId: pid,
      x: ps.x, y: ps.y,
      hp: ps.hp != null ? ps.hp : 100,
      // v2 #68 (additivt): shield i co-op-contact-damage-flödet — BARA när baseShield
      // är satt (V1 skickar aldrig → 0 → applyContactDamage-absorben är no-op exakt
      // som idag, även om gammal PvP-shield råkar ligga kvar på playerState).
      shield: sim.baseShield > 0 ? (ps.shield || 0) : 0,
      // v1.430: inkludera aim + weaponId så broadcast-player-array har dem
      aim: typeof ps.aim === 'number' ? ps.aim : 0,
      weaponId: ps.weaponId || 'fists',
      invulnUntil: ps.invulnUntil || 0,
      r: 14,
      _wsRef: ws, // refs för companion-aggro-AI + damage-event-routing
    });
    // Companion som "fake player" så enemy-AI kan target den + ta kontakt-skada.
    // Markeras med _isCompanion så contact-damage routar till event istället för
    // direkt p.hp-modifikation.
    if (ws.companionState && ws.companionState.alive && ws.companionState.hp > 0) {
      const c = ws.companionState;
      players.push({
        peerId: pid,
        _isCompanion: true,
        _companionId: c.id,
        x: c.x, y: c.y,
        hp: c.hp,
        invulnUntil: 0,
        r: c.r || 12,
        _wsRef: ws,
      });
    }
  }
  return players;
}

function updateHazards(sim, dt, now, players) {
  // Gas clouds (mirror av game.js:8059-)
  if (sim.gasClouds && sim.gasClouds.length) {
    for (let i = sim.gasClouds.length - 1; i >= 0; i--) {
      const g = sim.gasClouds[i];
      g.life -= dt;
      if (g.life <= 0) { sim.gasClouds.splice(i, 1); continue; }
      // DoT på spelare (skippar companion — annars dubbel-räknat per ws)
      for (const p of players) {
        if (p.hp <= 0 || p._isCompanion) continue;
        const dx = p.x - g.x, dy = p.y - g.y;
        if (dx * dx + dy * dy < g.r * g.r) {
          p.hp = Math.max(0, p.hp - g.dps * dt);
          const ws = sim.room.members.get(p.peerId);
          if (ws && ws.playerState) ws.playerState.hp = p.hp;
        }
      }
    }
  }
  // Flame trails
  if (sim.flameTrails && sim.flameTrails.length) {
    for (let i = sim.flameTrails.length - 1; i >= 0; i--) {
      const f = sim.flameTrails[i];
      f.life -= dt;
      if (f.life <= 0) { sim.flameTrails.splice(i, 1); continue; }
      for (const p of players) {
        if (p.hp <= 0 || p._isCompanion) continue;
        const dx = p.x - f.x, dy = p.y - f.y;
        if (dx * dx + dy * dy < f.r * f.r) {
          p.hp = Math.max(0, p.hp - f.dps * dt);
          const ws = sim.room.members.get(p.peerId);
          if (ws && ws.playerState) ws.playerState.hp = p.hp;
        }
      }
    }
  }
}

// ============================================================
// CTF (Capture the Flag) — server-auktoritativ logic
// ============================================================
// Tickas istället för enemy-AI/wave-progression när sim.ctfActive=true.
// Hanterar: respawn, flag-carrier-follow, pickup, capture, drop, auto-return,
// wall-collision för spelare, samt bullets via befintlig updateBullets (som
// kollar walls via shared/ctf-arena).
function tickCtf(sim, dt, now) {
  // C147/C164 (audit 2026-06-18): efter match-end körde respawn-loopen nedan vidare tills
  // host:en gjorde sim_stop. Gate FÖRE respawn-loopen — behåll exakt den befintliga end-
  // vägens beteende (tickPvpPickups + broadcast varje tick, sedan return).
  if (sim.ctfEnded) {
    tickPvpPickups(sim, now);
    broadcastWorld(sim, now);
    return;
  }
  // Respawn döda spelare på random egna spawn-point
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && now >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const team = ws.tdmTeam || 'red';
        const pts = CTF_ARENA.spawns[team] || CTF_ARENA.spawns.red;
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = respawnHpFor(ws.playerState);
        ws.playerState.shield = respawnShieldFor(ws.playerState);
        ws.playerState.invulnUntil = Date.now() + 1500;
        // C117: rensa stale bot-AI-state (stale path/sticky från förra livet)
        if (ws._bot) resetBotAiState(ws._bot, sp.x, sp.y, Date.now());
        // Om spelare dog med en flagga, droppa den vid death-positionen (sker via
        // applyCtfDeath separat — denna respawn-path ger ny position).
        sim.eventQueue.push({
          type: 'ctf_player_respawned',
          peerId: pid,
          x: ws.playerState.x,
          y: ws.playerState.y,
          hp: ws.playerState.hp,
          shield: ws.playerState.shield,
        });
      }
    }
  }
  // PvP-pickups: respawn timer + collect-detection (shared mellan CTF + TDM)
  tickPvpPickups(sim, now);

  // Match-end: skippa allt
  if (sim.ctfEnded) {
    broadcastWorld(sim, now);
    return;
  }

  // Push spelare ur walls (collision)
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
    resolveCtfWall(e, CTF_ARENA.walls);
    ws.playerState.x = e.x;
    ws.playerState.y = e.y;
    // Klamp till arena-bounds
    ws.playerState.x = Math.max(20, Math.min(CTF_ARENA.worldW - 20, ws.playerState.x));
    ws.playerState.y = Math.max(20, Math.min(CTF_ARENA.worldH - 20, ws.playerState.y));
  }

  // Flagga-state: om carrier finns, flagga följer carrier-position
  for (const team of ['red', 'blue']) {
    const flag = sim.ctfFlags[team];
    if (flag.carrierId) {
      const ws = sim.room.members.get(flag.carrierId);
      if (ws && ws.playerState && ws.playerState.hp > 0) {
        flag.x = ws.playerState.x;
        flag.y = ws.playerState.y;
      } else {
        // Carrier disconnected/missing → returnera flagga
        flag.carrierId = null;
        flag.x = flag.baseX;
        flag.y = flag.baseY;
        flag.atBase = true;
        sim.eventQueue.push({ type: 'ctf_flag_returned', team, reason: 'carrier_lost' });
      }
    } else if (!flag.atBase) {
      // Dropped — kolla auto-return efter 30s
      if (now - flag.droppedAt > CTF_FLAG_AUTORETURN_MS) {
        flag.x = flag.baseX;
        flag.y = flag.baseY;
        flag.atBase = true;
        flag.droppedAt = 0;
        sim.eventQueue.push({ type: 'ctf_flag_returned', team, reason: 'timeout' });
      }
    }
  }

  // Pickup / capture / return-detection — iterera spelare
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const myTeam = ws.tdmTeam || 'red';
    const enemyTeam = myTeam === 'red' ? 'blue' : 'red';
    const px = ws.playerState.x, py = ws.playerState.y;

    // 1. Pickup enemy-flagga (om ledig)
    const enemyFlag = sim.ctfFlags[enemyTeam];
    let justPickedUp = false;
    if (!enemyFlag.carrierId) {
      const dx = px - enemyFlag.x, dy = py - enemyFlag.y;
      if (dx * dx + dy * dy < CTF_ARENA.pickupRadius * CTF_ARENA.pickupRadius) {
        enemyFlag.carrierId = pid;
        enemyFlag.atBase = false;
        enemyFlag.droppedAt = 0;
        justPickedUp = true;
        sim.eventQueue.push({
          type: 'ctf_flag_picked',
          peerId: pid,
          team: enemyTeam, // vilken flagga som plockades upp
          carrierTeam: myTeam,
        });
      }
    }

    // 2. Capture: jag bär enemy-flagga + jag är vid min egen flagga (som måste vara hemma)
    //    Skippa om vi just plockade upp denna tick → annars instant-capture-exploit
    if (justPickedUp) continue;
    if (enemyFlag.carrierId === pid) {
      const myFlag = sim.ctfFlags[myTeam];
      if (myFlag.atBase) {
        const dx = px - myFlag.baseX, dy = py - myFlag.baseY;
        if (dx * dx + dy * dy < CTF_ARENA.captureRadius * CTF_ARENA.captureRadius) {
          // CAPTURE!
          sim.ctfCaptures[myTeam] = (sim.ctfCaptures[myTeam] || 0) + 1;
          sim.ctfCapturesByPid[pid] = (sim.ctfCapturesByPid[pid] || 0) + 1;
          // Reset enemy-flagga tillbaka till sin bas
          enemyFlag.carrierId = null;
          enemyFlag.x = enemyFlag.baseX;
          enemyFlag.y = enemyFlag.baseY;
          enemyFlag.atBase = true;
          enemyFlag.droppedAt = 0;
          sim.eventQueue.push({
            type: 'ctf_flag_captured',
            peerId: pid,
            team: myTeam, // vilket lag scorade
            captures: { red: sim.ctfCaptures.red, blue: sim.ctfCaptures.blue },
          });
          // Match-end check
          if (sim.ctfCaptures[myTeam] >= sim.ctfTargetCaptures) {
            sim.ctfEnded = true;
            const stats = {
              red: sim.ctfCaptures.red,
              blue: sim.ctfCaptures.blue,
              perPlayer: {},
            };
            for (const [p, ws2] of sim.room.members) {
              if (ws2 && ws2.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
              stats.perPlayer[p] = {
                team: ws2.tdmTeam,
                captures: sim.ctfCapturesByPid[p] || 0,
                kills: sim.ctfKillsByPid[p] || 0,
                deaths: sim.tdmDeathsByPid[p] || 0,
              };
            }
            sim.eventQueue.push({
              type: 'ctf_match_end',
              winner: myTeam,
              captures: { red: sim.ctfCaptures.red, blue: sim.ctfCaptures.blue },
              stats,
            });
          }
        }
      }
    }

    // 3. Return own-flagga: hold-to-return (1s standing within radius) så defender
    //    inte råkar returnera av misstag när hen jagar fienden förbi den.
    const myFlag = sim.ctfFlags[myTeam];
    if (!myFlag.atBase && !myFlag.carrierId) {
      const dx = px - myFlag.x, dy = py - myFlag.y;
      const inRange = dx * dx + dy * dy < CTF_ARENA.pickupRadius * CTF_ARENA.pickupRadius;
      if (inRange) {
        const wasStarted = (ws._returnHoldT || 0) > 0;
        ws._returnHoldT = (ws._returnHoldT || 0) + dt;
        // Emit "started" event endast vid start (klient renderar progress-ring)
        if (!wasStarted) {
          sim.eventQueue.push({ type: 'ctf_return_started', peerId: pid, team: myTeam, durationMs: 1000 });
        }
        if (ws._returnHoldT >= 1.0) {
          ws._returnHoldT = 0;
          myFlag.x = myFlag.baseX;
          myFlag.y = myFlag.baseY;
          myFlag.atBase = true;
          myFlag.droppedAt = 0;
          sim.eventQueue.push({ type: 'ctf_flag_returned', team: myTeam, peerId: pid, reason: 'manual' });
        }
      } else if (ws._returnHoldT) {
        ws._returnHoldT = 0;
        sim.eventQueue.push({ type: 'ctf_return_cancelled', peerId: pid, team: myTeam });
      }
    } else if (ws._returnHoldT) {
      // Flaggan kom hem på annat sätt (auto-return, carrier-pickup) — rensa state
      ws._returnHoldT = 0;
    }
  }

  // Turret occupant position-lock: håll spelaren fast vid turret-pos
  if (sim.ctfTurrets) {
    for (const tid of Object.keys(sim.ctfTurrets)) {
      const t = sim.ctfTurrets[tid];
      if (t.destroyed) continue;
      if (t.occupantId) {
        const ws = sim.room.members.get(t.occupantId);
        if (!ws || !ws.playerState || ws.playerState.hp <= 0) {
          // Occupant disconnected/dog — släpp turret
          exitTurret(sim, tid, 'occupant_lost');
        } else {
          ws.playerState.x = t.x;
          ws.playerState.y = t.y;
        }
      }
    }
  }

  // CTF turret-rebuild: friendly team-spelare 20s nära förstörd turret = restore
  tickTurretRebuilds(sim, sim.ctfTurrets, dt, now, 'ctf');

  // Bullet-physics (kolla wall-hits via bullets.js: vi behöver toggla flagga
  // för wall-check inom updateBullets, så markeras via sim.ctfActive)
  updateBullets(sim, dt, now);

  // Centraliserad death-detection: explosions, hostile-bullets eller framtida
  // damage-källor som dödar en CTF-spelare måste få respawn + flag-drop. Bullets.js
  // sätter dem redan för direkt player-bullets, så vi fyller luckorna.
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = Date.now() + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'ctf_player_died', victim: pid, durationMs: 3000 });
      applyCtfDeath(sim, pid); // droppar flaggan om han bar någon + emit ctf_flag_dropped
    }
  }
}

// ============================================================
// PvP-pickups — HP- och shield-regen-pickups på TDM- och CTF-arenor
// ============================================================
// Symmetrisk placering: 4 HP + 4 shield per arena. Respawn 15s efter collect.
// PICKUP_HEAL = +40 (delvis återställning så spelare måste samla flera).
const PICKUP_RESPAWN_MS = 15000;
const PICKUP_HEAL = 40;
const PICKUP_RADIUS = 28;

function nextPickupId(sim) {
  sim._pickupIdCounter = (sim._pickupIdCounter || 0) + 1;
  return 'pu_' + sim._pickupIdCounter;
}

function buildKothPickups(sim) {
  // 3500×2000 arena. Pickups placerade NÄRA zon-positionerna så hill-defense
  // har strategiska resurser, men inte i zonen själv (då blir det auto-grab).
  return [
    // HP: i kvadrant-positioner runt arenan
    { id: nextPickupId(sim), x: 500,  y: 500,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3000, y: 500,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 500,  y: 1500, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3000, y: 1500, type: 'hp',     available: true, respawnAt: 0 },
    // Shield: nära mid och flank-zoner — kontestbara, värd risken
    { id: nextPickupId(sim), x: 1200, y: 1000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2300, y: 1000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1750, y: 600,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1750, y: 1400, type: 'shield', available: true, respawnAt: 0 },
    // Granater: spridda runt hörn + mid-flank för att inte hamna i zonen
    { id: nextPickupId(sim), x: 800,  y: 300,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2700, y: 300,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 800,  y: 1700, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2700, y: 1700, type: 'grenade', available: true, respawnAt: 0 },
  ];
}

function buildCtfPickups(sim) {
  // 4500×2800 arena, symmetrisk runt x=2250.
  // HP-pickups i flank-positioner (mellan baser och mitten).
  // Shield-pickups i mid-zon (riskabla att hämta — kontakt med fiender).
  return [
    // HP: 4 flanker
    { id: nextPickupId(sim), x: 1300, y: 700,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 700,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1300, y: 2100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 2100, type: 'hp',     available: true, respawnAt: 0 },
    // Shield: 4 mid-zon (mer kontestbara)
    { id: nextPickupId(sim), x: 2250, y: 350,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 2450, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1900, y: 1400, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2600, y: 1400, type: 'shield', available: true, respawnAt: 0 },
    // Granater: 4 symmetriska, mellan flanker och mid (taktiska val)
    { id: nextPickupId(sim), x: 800,  y: 1400, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3700, y: 1400, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2250, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
  ];
}

function buildTdmPickups(sim, arena) {
  // ÖVNINGSFÄLTET (fy_): vapen-på-marken-rad framför varje spawn + granater i mitten
  // + lite HP/shield i mid-fältet. Vapen-pickups är PERMANENTA (försvinner ej) — man
  // springer och greppar varje liv. Läser layout från TDM_ARENA så allt ligger på ett ställe.
  const list = [];
  // Vapen-pickups (permanenta, type:'weapon' + weaponId) — respawnAt/available oanvänt.
  for (const ws of (TDM_ARENA.weaponSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: ws.x, y: ws.y, type: 'weapon', weaponId: ws.weaponId, available: true, respawnAt: 0 });
  }
  // Granat-loot i mitten (2026-06-17): bländgranater + molotovs + gravitationsgranater,
  // SYMMETRISKT placerade (arena-arrayerna är redan speglade). Man spawnar med 0 granater.
  for (const g of (TDM_ARENA.flashSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: g.x, y: g.y, type: 'flash', available: true, respawnAt: 0 });
  }
  for (const g of (TDM_ARENA.molotovSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: g.x, y: g.y, type: 'molotov', available: true, respawnAt: 0 });
  }
  for (const g of (TDM_ARENA.gravitySpawns || [])) {
    list.push({ id: nextPickupId(sim), x: g.x, y: g.y, type: 'gravity', available: true, respawnAt: 0 });
  }
  // FRAG + RÖK (2026-06-21): 6 frag + 6 rök, symmetriskt (arena-arrayerna är speglade).
  // type:'grenade' = frag (grenadesGained), type:'smoke' = rök (smokeGained) — redan wirade.
  for (const g of (TDM_ARENA.fragSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: g.x, y: g.y, type: 'grenade', available: true, respawnAt: 0 });
  }
  for (const g of (TDM_ARENA.smokeSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: g.x, y: g.y, type: 'smoke', available: true, respawnAt: 0 });
  }
  // HP + shield i mid-fältet (symmetriskt, läses från arena)
  for (const p of (TDM_ARENA.hpSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: p.x, y: p.y, type: 'hp', available: true, respawnAt: 0 });
  }
  for (const p of (TDM_ARENA.shieldSpawns || [])) {
    list.push({ id: nextPickupId(sim), x: p.x, y: p.y, type: 'shield', available: true, respawnAt: 0 });
  }
  return list;
}

// CS-runda: starta ny TDM-runda — respawna ALLA, nollställ vapen (pistol) + alla
// pickups, ++rundnummer. Emiterar tdm_player_respawned per spelare + pvp_pickup_spawned
// per pickup + tdm_round_start.
function tdmStartRound(sim, nowMs) {
  const redIds = [], blueIds = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (ws.tdmTeam === 'red') redIds.push(pid); else if (ws.tdmTeam === 'blue') blueIds.push(pid);
  }
  const redSpawns = pickSpreadSpawns(TDM_ARENA.spawns.red, Math.max(1, redIds.length));
  const blueSpawns = pickSpreadSpawns(TDM_ARENA.spawns.blue, Math.max(1, blueIds.length));
  let ri = 0, bi = 0;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    const sp = ws.tdmTeam === 'red'
      ? (redSpawns[ri++] || TDM_ARENA.spawns.red[0])
      : (blueSpawns[bi++] || TDM_ARENA.spawns.blue[0]);
    // v1.734: LAG-baserad reset. Hela VINNANDE laget behåller vapen + granater
    // (även de som dog under rundan), hela FÖRLORANDE laget tappar → pistol + 0 granater.
    // Fallback till individuell död om ingen vinnare lagrats (t.ex. allra första rundan).
    const reset = sim._tdmLastLoser ? (ws.tdmTeam === sim._tdmLastLoser) : !!ws._tdmDeadRound;
    ws.playerState.x = sp.x;
    ws.playerState.y = sp.y;
    ws.playerState.hp = respawnHpFor(ws.playerState);
    ws.playerState.shield = respawnShieldFor(ws.playerState);
    ws.playerState.invulnUntil = nowMs + 1500;
    if (reset) {
      ws.playerState.weaponId = 'pistol'; // förlorande laget tappar vapnet; vinnare behåller
      ws._tdmPickedWeapons = [];          // v2 anti-cheat: förrådet nollställs med (spegel av klienten)
    }
    ws._tdmDeadRound = false;
    ws.tdmRespawnAt = 0;
    // C117: rensa stale bot-AI-state (path/sticky läcker annars från förra rundan)
    if (ws._bot) resetBotAiState(ws._bot, sp.x, sp.y, nowMs);
    sim.eventQueue.push({
      type: 'tdm_player_respawned', peerId: pid, x: sp.x, y: sp.y,
      hp: ws.playerState.hp, shield: ws.playerState.shield,
      weaponId: ws.playerState.weaponId || 'pistol',
      reset: reset, // klienten: true → nollställ förråd + granater + pistol; false → behåll
    });
  }
  // Återställ ALLA pickups (vapen + granater + hp + shield) för nya rundan
  if (sim.pvpPickups) {
    for (const pu of sim.pvpPickups) {
      pu.available = true;
      pu.respawnAt = 0;
      sim.eventQueue.push({ type: 'pvp_pickup_spawned', id: pu.id, x: pu.x, y: pu.y, ptype: pu.type });
    }
  }
  sim.tdmRoundNum = (sim.tdmRoundNum || 0) + 1;
  sim.tdmRoundActive = true;
  sim.tdmRoundResetAt = 0;
  sim._tdmRoundHadBoth = (redIds.length > 0 && blueIds.length > 0);
  sim.eventQueue.push({ type: 'tdm_round_start', roundNum: sim.tdmRoundNum });
}

// Tickas från CTF + TDM: respawn timer + collision-detection mot spelare.
// Emiterar pvp_pickup_collected (med uppdaterad hp/shield) + pvp_pickup_spawned.
function tickPvpPickups(sim, now) {
  if (!sim.pvpPickups) return;
  for (const pu of sim.pvpPickups) {
    // Respawn — i TDM auto-respawnar pickups EJ (CS-runda: återställs vid runda-start).
    if (!pu.available && now >= pu.respawnAt && !sim.tdmActive) {
      pu.available = true;
      sim.eventQueue.push({ type: 'pvp_pickup_spawned', id: pu.id, x: pu.x, y: pu.y, ptype: pu.type });
    }
    if (!pu.available) continue;
    // Collect: kolla alla levande spelare
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - pu.x, dy = ws.playerState.y - pu.y;
      if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue;
      // VAPEN-pickup (fy_ / CS-runda): KONSUMERAS vid upptag (försvinner för rundan,
      // återställs vid runda-start). Servern sätter EJ ws.playerState.weaponId här —
      // klienten avgör hand vs förråd (första→hand) och synkar via 'tdm_equip'. Så
      // andra ser rätt vapen i handen även när man bara LAGRAR det upplockade.
      if (pu.type === 'weapon') {
        pu.available = false;
        pu.respawnAt = now + PICKUP_RESPAWN_MS; // oanvänt i TDM (respawn gated av !tdmActive)
        // v2 anti-cheat: tracka vad spelaren FAKTISKT plockat (fy_-förrådet) så
        // applyShoot kan validera weaponId mot det. Lazy-init täcker late-joiners.
        if (sim.tdmActive && pu.weaponId) {
          if (!Array.isArray(ws._tdmPickedWeapons)) ws._tdmPickedWeapons = [];
          if (!ws._tdmPickedWeapons.includes(pu.weaponId)) ws._tdmPickedWeapons.push(pu.weaponId);
        }
        sim.eventQueue.push({
          type: 'pvp_pickup_collected', id: pu.id, peerId: pid, ptype: 'weapon',
          weaponId: pu.weaponId, hp: ws.playerState.hp, shield: ws.playerState.shield || 0,
          grenadesGained: 0, respawnAt: pu.respawnAt,
        });
        break; // konsumerad — nästa pickup
      }
      // Heal — använd spelarens faktiska maxHp (JUG har 400-1300, inte 100)
      const maxHp = ws.playerState.maxHp || 100;
      const maxShield = ws.playerState.maxShield || 100;
      let grenadesGained = 0;
      let smokeGained = 0;
      let flashGained = 0;
      let molotovGained = 0;
      let gravityGained = 0;
      if (pu.type === 'hp') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(maxHp, before + PICKUP_HEAL);
        if (ws.playerState.hp === before) continue; // redan full HP — skip pickup
      } else if (pu.type === 'shield') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(maxShield, before + PICKUP_HEAL);
        if (ws.playerState.shield === before) continue; // redan full shield
      } else if (pu.type === 'grenade') {
        grenadesGained = 1; // klient håller count, bumpar lokalt
      } else if (pu.type === 'smoke') {
        smokeGained = 1; // v1.733: rökgranat-loot
      } else if (pu.type === 'flash') {
        flashGained = 1; // 2026-06-17: TDM bländgranat-loot
      } else if (pu.type === 'molotov') {
        molotovGained = 1;
      } else if (pu.type === 'gravity') {
        gravityGained = 1;
      }
      pu.available = false;
      pu.respawnAt = now + PICKUP_RESPAWN_MS;
      sim.eventQueue.push({
        type: 'pvp_pickup_collected',
        id: pu.id,
        peerId: pid,
        ptype: pu.type,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
        grenadesGained,
        smokeGained,
        flashGained,
        molotovGained,
        gravityGained,
        respawnAt: pu.respawnAt,
      });
      break; // pickup borta — gå till nästa
    }
  }
}

// ============================================================
// CTF-turrets — enter/exit + damage-routing
// ============================================================
const TURRET_ENTER_RADIUS = 50;

// Rebuild: friendly team-spelare nära förstörd turret tickar timern.
// 20s totalt → restore full hp. Throttle progress-events till 4Hz.
const TURRET_REBUILD_MS = 20000;
const TURRET_REBUILD_RADIUS = 70;
const TURRET_REBUILD_EMIT_MS = 250;

function tickTurretRebuilds(sim, turrets, dt, now, mode) {
  if (!turrets) return;
  const radiusSq = TURRET_REBUILD_RADIUS * TURRET_REBUILD_RADIUS;
  for (const tid of Object.keys(turrets)) {
    const t = turrets[tid];
    if (!t.destroyed) continue;
    let friendlyNear = false;
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      if (ws.tdmTeam !== t.team) continue;
      const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
      if (dx * dx + dy * dy <= radiusSq) { friendlyNear = true; break; }
    }
    const wasRebuilding = (t.rebuildT || 0) > 0;
    if (friendlyNear) {
      t.rebuildT = (t.rebuildT || 0) + dt * 1000;
      if (t.rebuildT >= TURRET_REBUILD_MS) {
        // Restore — full hp, ej destroyed, ingen occupant
        t.destroyed = false;
        t.hp = t.maxHp;
        t.destroyedAt = 0;
        t.rebuildT = 0;
        t.occupantId = null;
        t._lastRebuildEmitAt = 0;
        sim.eventQueue.push({ type: mode + '_turret_rebuilt', turretId: t.id, hp: t.hp, maxHp: t.maxHp });
        continue;
      }
      if (!t._lastRebuildEmitAt || now - t._lastRebuildEmitAt >= TURRET_REBUILD_EMIT_MS) {
        t._lastRebuildEmitAt = now;
        sim.eventQueue.push({
          type: mode + '_turret_rebuild_progress',
          turretId: t.id,
          progress: Math.min(1, t.rebuildT / TURRET_REBUILD_MS),
        });
      }
    } else if (wasRebuilding) {
      t.rebuildT = 0;
      t._lastRebuildEmitAt = 0;
      sim.eventQueue.push({ type: mode + '_turret_rebuild_progress', turretId: t.id, progress: 0 });
    }
  }
}

function tryEnterTurret(sim, peerId, turretId) {
  // Diagnostisk logging för att hitta varför enter ibland inte funkar
  const fail = (reason) => {
    console.log('[TURRET-ENTER-FAIL]', sim.room && sim.room.code, peerId, 'turret=' + turretId, 'reason=' + reason);
    return false;
  };
  if (!sim.ctfActive) return fail('not_ctf_active');
  const t = sim.ctfTurrets && sim.ctfTurrets[turretId];
  if (!t) return fail('turret_not_found_' + turretId);
  if (t.destroyed) return fail('destroyed');
  if (t.occupantId) return fail('occupied_by_' + t.occupantId);
  const ws = sim.room.members.get(peerId);
  if (!ws) return fail('ws_missing');
  if (!ws.playerState) return fail('no_player_state');
  if (ws.playerState.hp <= 0) return fail('dead');
  // Lag-check: turret måste matcha spelarens team
  if (ws.tdmTeam !== t.team) return fail('wrong_team_' + ws.tdmTeam + '_vs_' + t.team);
  // Avstånds-check — använd en generös radie så enter inte misslyckas pga lag-jitter
  const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
  const d2 = dx * dx + dy * dy;
  const maxR = (CTF_ARENA.turretEnterRadius || 50) + 20; // +20px tolerance
  if (d2 > maxR * maxR) return fail('too_far_' + Math.round(Math.sqrt(d2)) + 'px');
  t.occupantId = peerId;
  ws._mountedCtfTurretId = turretId;
  // Lås spelare till turret-position
  ws.playerState.x = t.x;
  ws.playerState.y = t.y;
  console.log('[TURRET-ENTER-OK]', sim.room && sim.room.code, peerId, '→', turretId);
  sim.eventQueue.push({ type: 'ctf_turret_entered', peerId, turretId });
  return true;
}

function exitTurret(sim, turretId, reason) {
  const t = sim.ctfTurrets && sim.ctfTurrets[turretId];
  if (!t) return;
  const peerId = t.occupantId;
  t.occupantId = null;
  if (peerId) {
    const ws = sim.room.members.get(peerId);
    if (ws) {
      ws._mountedCtfTurretId = null;
      // Knuffa spelaren ~30px utåt så de inte direkt re-enterar
      if (ws.playerState) {
        const dir = t.team === 'red' ? 1 : -1; // röd står mer höger om sin turret
        ws.playerState.x = t.x + dir * 35;
        ws.playerState.y = t.y;
      }
    }
  }
  sim.eventQueue.push({ type: 'ctf_turret_exited', peerId, turretId, reason: reason || 'manual' });
}

// SIEGE-turret enter — mirror av CTF men för sim.siegeTurrets + använder turret.weaponId
function tryEnterSiegeTurret(sim, peerId, turretId) {
  const fail = (reason) => {
    console.log('[SIEGE-TURRET-ENTER-FAIL]', sim.room && sim.room.code, peerId, 'turret=' + turretId, 'reason=' + reason);
    return false;
  };
  if (!sim.siegeActive) return fail('not_siege_active');
  const t = sim.siegeTurrets && sim.siegeTurrets[turretId];
  if (!t) return fail('turret_not_found_' + turretId);
  if (t.destroyed) return fail('destroyed');
  if (t.occupantId) return fail('occupied_by_' + t.occupantId);
  const ws = sim.room.members.get(peerId);
  if (!ws) return fail('ws_missing');
  if (!ws.playerState) return fail('no_player_state');
  if (ws.playerState.hp <= 0) return fail('dead');
  if (ws.tdmTeam !== t.team) return fail('wrong_team_' + ws.tdmTeam + '_vs_' + t.team);
  const dx = ws.playerState.x - t.x, dy = ws.playerState.y - t.y;
  const d2 = dx * dx + dy * dy;
  const maxR = (SIEGE_ARENA.turretEnterRadius || 50) + 20;
  if (d2 > maxR * maxR) return fail('too_far_' + Math.round(Math.sqrt(d2)) + 'px');
  t.occupantId = peerId;
  ws._mountedSiegeTurretId = turretId;
  ws.playerState.x = t.x;
  ws.playerState.y = t.y;
  console.log('[SIEGE-TURRET-ENTER-OK]', sim.room && sim.room.code, peerId, '→', turretId, '(' + t.turretType + ')');
  sim.eventQueue.push({
    type: 'siege_turret_entered',
    peerId, turretId,
    weaponId: t.weaponId || 'turret_mg',
    turretType: t.turretType || 'mg',
  });
  return true;
}

function exitSiegeTurret(sim, turretId, reason) {
  const t = sim.siegeTurrets && sim.siegeTurrets[turretId];
  if (!t) return;
  const peerId = t.occupantId;
  t.occupantId = null;
  if (peerId) {
    const ws = sim.room.members.get(peerId);
    if (ws) {
      ws._mountedSiegeTurretId = null;
      if (ws.playerState) {
        const dir = t.team === 'red' ? 1 : -1;
        ws.playerState.x = t.x + dir * 35;
        ws.playerState.y = t.y;
      }
    }
  }
  sim.eventQueue.push({ type: 'siege_turret_exited', peerId, turretId, reason: reason || 'manual' });
}

// Hantera spelare-död under CTF: droppa flagga vid death-position
function applyCtfDeath(sim, peerId) {
  if (!sim.ctfActive) return;
  for (const team of ['red', 'blue']) {
    const flag = sim.ctfFlags[team];
    if (flag.carrierId === peerId) {
      const ws = sim.room.members.get(peerId);
      const dx = ws && ws.playerState ? ws.playerState.x : flag.baseX;
      const dy = ws && ws.playerState ? ws.playerState.y : flag.baseY;
      flag.carrierId = null;
      flag.atBase = false;
      flag.x = dx;
      flag.y = dy;
      flag.droppedAt = Date.now();
      sim.eventQueue.push({
        type: 'ctf_flag_dropped',
        team,
        x: dx, y: dy,
        droppedBy: peerId,
      });
    }
  }
}

// ============================================================
// SIEGE THE BASE — capture-bases + core-damage + scoring
// ============================================================
function tickSiege(sim, dt, now) {
  const nowMs = Date.now();

  // C147/C164 (audit 2026-06-18): gate hela ticken efter match-end så respawn-loopen
  // nedan inte re-spawnar döda spelare tills host:en gör sim_stop.
  if (sim.siegeEnded) return;

  // Respawn döda spelare på random egna spawn-point
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const team = ws.tdmTeam || 'red';
        const pts = SIEGE_ARENA.spawns[team] || SIEGE_ARENA.spawns.red;
        const sp = pts[Math.floor(Math.random() * pts.length)];
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = respawnHpFor(ws.playerState);
        ws.playerState.shield = respawnShieldFor(ws.playerState);
        ws.playerState.invulnUntil = Date.now() + 1500;
        // C117: rensa stale bot-AI-state
        if (ws._bot) resetBotAiState(ws._bot, sp.x, sp.y, Date.now());
        sim.eventQueue.push({
          type: 'siege_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
        });
      }
    }
  }

  // Pickups respawn + collect
  if (!sim.siegeEnded) tickPvpPickups(sim, now);

  // Match-end? Skip game-logic
  if (sim.siegeEnded) return;

  // Wall-collision för spelare + turret-collision (turrets är cirklar, push out)
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      // Hoppa över wall/turret-collision om spelaren sitter i sin turret
      if (ws._mountedSiegeTurretId) continue;
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, SIEGE_ARENA.walls);
      // Turret-collision: push player out om de överlappar med turret-radius
      if (sim.siegeTurrets) {
        for (const tid of Object.keys(sim.siegeTurrets)) {
          const t = sim.siegeTurrets[tid];
          const dx = e.x - t.x, dy = e.y - t.y;
          const rsum = t.r + e.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < rsum * rsum && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (rsum - d) / d;
            e.x += dx * push;
            e.y += dy * push;
          }
        }
      }
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }

  // Turret-occupant lock (BÅDE ctf och siege)
  if (sim.siegeTurrets) {
    for (const tid of Object.keys(sim.siegeTurrets)) {
      const t = sim.siegeTurrets[tid];
      if (t.destroyed) continue;
      if (t.occupantId) {
        const ws = sim.room.members.get(t.occupantId);
        if (!ws || !ws.playerState || ws.playerState.hp <= 0) {
          // Auto-eject
          exitSiegeTurret(sim, tid, 'occupant_lost');
        } else {
          ws.playerState.x = t.x;
          ws.playerState.y = t.y;
        }
      }
    }
  }

  // SIEGE turret-rebuild: båda lagens MG + rocket-turrets kan repas på 20s
  tickTurretRebuilds(sim, sim.siegeTurrets, dt, now, 'siege');

  // Capture-base-logik med 2-fas: NEUTRALIZE (5s om enemy äger) + CAPTURE (10s).
  // base.phase: null (neutral, fri att capturera) eller 'neutralize' (måste först
  // göra basen neutral) eller 'capture' (capturerar mot neutral base).
  const CAPTURE_TIME = SIEGE_ARENA.captureTimeSec || 10.0;
  const NEUTRALIZE_TIME = SIEGE_ARENA.neutralizeTimeSec || 5.0;
  for (const baseId of Object.keys(sim.siegeBases)) {
    const base = sim.siegeBases[baseId];
    let redOn = 0, blueOn = 0;
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - base.x, dy = ws.playerState.y - base.y;
      if (dx * dx + dy * dy <= base.r * base.r) {
        if (ws.tdmTeam === 'red') redOn++;
        else if (ws.tdmTeam === 'blue') blueOn++;
      }
    }
    const contested = redOn > 0 && blueOn > 0;
    const onlyRed = redOn > 0 && blueOn === 0;
    const onlyBlue = blueOn > 0 && redOn === 0;
    // Spara count för broadcast (klient visar "2 vs 1 contested")
    base.redOn = redOn;
    base.blueOn = blueOn;
    if (contested) {
      // Pausa progress (first-occupant-protection)
    } else if (onlyRed) {
      if (base.owner === 'red') {
        // Egen bas, reset eventuell progress
        base.captureProgress = 0;
        base.captureSide = null;
        base.phase = null;
      } else if (base.owner === 'blue') {
        // FAS 1: Neutralisera blå-basen först (5s)
        if (base.captureSide !== 'red' || base.phase !== 'neutralize') {
          base.captureProgress = 0;
          base.captureSide = 'red';
          base.phase = 'neutralize';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / NEUTRALIZE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = null;
          base.captureProgress = 0;
          base.phase = 'capture'; // direkt in i capture-fasen
          sim.eventQueue.push({ type: 'siege_base_neutralized', baseId, by: 'red' });
        }
      } else {
        // FAS 2 (eller direkt om neutral): Capturera neutral (10s)
        if (base.captureSide !== 'red' || base.phase !== 'capture') {
          base.captureProgress = 0;
          base.captureSide = 'red';
          base.phase = 'capture';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / CAPTURE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = 'red';
          base.captureProgress = 0;
          base.captureSide = null;
          base.phase = null;
          sim.eventQueue.push({ type: 'siege_base_captured', baseId, team: 'red' });
        }
      }
    } else if (onlyBlue) {
      if (base.owner === 'blue') {
        base.captureProgress = 0;
        base.captureSide = null;
        base.phase = null;
      } else if (base.owner === 'red') {
        if (base.captureSide !== 'blue' || base.phase !== 'neutralize') {
          base.captureProgress = 0;
          base.captureSide = 'blue';
          base.phase = 'neutralize';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / NEUTRALIZE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = null;
          base.captureProgress = 0;
          base.phase = 'capture';
          sim.eventQueue.push({ type: 'siege_base_neutralized', baseId, by: 'blue' });
        }
      } else {
        if (base.captureSide !== 'blue' || base.phase !== 'capture') {
          base.captureProgress = 0;
          base.captureSide = 'blue';
          base.phase = 'capture';
        }
        base.captureProgress = Math.min(1, base.captureProgress + dt / CAPTURE_TIME);
        if (base.captureProgress >= 1) {
          base.owner = 'blue';
          base.captureProgress = 0;
          base.captureSide = null;
          base.phase = null;
          sim.eventQueue.push({ type: 'siege_base_captured', baseId, team: 'blue' });
        }
      }
    } else {
      // Ingen på basen — decay progress (50% rate)
      if (base.captureProgress > 0) {
        const decayTime = base.phase === 'neutralize' ? NEUTRALIZE_TIME : CAPTURE_TIME;
        base.captureProgress = Math.max(0, base.captureProgress - dt / decayTime * 0.5);
        if (base.captureProgress === 0) {
          base.captureSide = null;
          base.phase = null;
        }
      }
    }
  }

  // Broadcasta capture-progress till klienten ungefär 5Hz (var 9 tick @ 45Hz)
  sim._siegeProgressBroadcastTick = (sim._siegeProgressBroadcastTick || 0) + 1;
  if (sim._siegeProgressBroadcastTick >= 9) {
    sim._siegeProgressBroadcastTick = 0;
    const progress = {};
    for (const baseId of Object.keys(sim.siegeBases)) {
      const b = sim.siegeBases[baseId];
      if (b.captureProgress > 0 || b.owner !== null || b.redOn || b.blueOn) {
        progress[baseId] = {
          owner: b.owner,
          captureProgress: b.captureProgress,
          captureSide: b.captureSide,
          phase: b.phase,
          redOn: b.redOn || 0,
          blueOn: b.blueOn || 0,
        };
      }
    }
    sim.eventQueue.push({ type: 'siege_base_progress', bases: progress });
  }

  // Passive points: varje ägd bas ger 1 pt/sek till owning team
  for (const baseId of Object.keys(sim.siegeBases)) {
    const base = sim.siegeBases[baseId];
    if (base.owner === 'red')  sim._siegePointAccum.red  += dt;
    if (base.owner === 'blue') sim._siegePointAccum.blue += dt;
  }
  // Flush integer-poäng från accumulator
  let scoreChanged = false;
  for (const team of ['red', 'blue']) {
    while (sim._siegePointAccum[team] >= 1) {
      sim._siegePointAccum[team] -= 1;
      sim.siegeScores[team] += 1;
      scoreChanged = true;
    }
  }
  if (scoreChanged) {
    sim.eventQueue.push({ type: 'siege_score_update', red: sim.siegeScores.red, blue: sim.siegeScores.blue });
    // Vinst-check via poäng
    if (sim.siegeScores.red >= sim.siegeTargetPoints || sim.siegeScores.blue >= sim.siegeTargetPoints) {
      const winner = sim.siegeScores.red >= sim.siegeTargetPoints ? 'red' : 'blue';
      endSiegeMatch(sim, winner, 'points');
      return;
    }
  }

  // Bullets — uppdaterad efter resolveCtfWall så de inte träffar inuti walls
  updateBullets(sim, dt, now);

  // Centraliserad death-detection
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'siege_player_died', victim: pid, durationMs: 3000 });
    }
  }
}

function endSiegeMatch(sim, winner, reason) {
  if (sim.siegeEnded) return; // dubbel-fire-guard
  sim.siegeEnded = true;
  const stats = { red: sim.siegeScores.red, blue: sim.siegeScores.blue, perPlayer: {} };
  for (const [p, ws] of sim.room.members) {
    if (ws && ws.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
    stats.perPlayer[p] = {
      team: ws.tdmTeam,
      kills: sim.siegeKillsByPid[p] || 0,
      deaths: sim.tdmDeathsByPid[p] || 0,
    };
  }
  sim.eventQueue.push({
    type: 'siege_match_end',
    winner, reason,
    scores: { red: sim.siegeScores.red, blue: sim.siegeScores.blue },
    stats,
  });
}

// === GUNGAME ===
// FFA mode: 15-tier vapen-progression. Varje kill promotar shooter +1 tier.
// Kill med melee-vapen → offret demoteras 1 tier (cap 0). Första som dödar
// någon på tier 15 (sledge) vinner. Inga teams — alla är fiender.
function tickGungame(sim, dt, now) {
  const nowMs = Date.now();

  // C147/C164 (audit 2026-06-18): gate hela ticken efter match-end så respawn-loopen
  // nedan inte re-spawnar döda spelare tills host:en gör sim_stop.
  if (sim.gungameEnded) return;

  // Respawn döda spelare på roterande spawn-point (anti-spawn-camp).
  // Försök upp till N spawn-punkter tills vi hittar en utan levande spelare
  // inom 120px — annars spawnar man rakt ovanpå en motståndare.
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = GUNGAME_ARENA.spawns;
        let sp = spawns[sim._gungameSpawnIdx % spawns.length];
        for (let tries = 0; tries < spawns.length; tries++) {
          const candidate = spawns[(sim._gungameSpawnIdx + tries) % spawns.length];
          let occupied = false;
          for (const [otherPid, otherWs] of sim.room.members) {
            if (otherPid === pid) continue;
            if (!otherWs.playerState || otherWs.playerState.hp <= 0) continue;
            const dx = otherWs.playerState.x - candidate.x;
            const dy = otherWs.playerState.y - candidate.y;
            if (dx * dx + dy * dy < 120 * 120) { occupied = true; break; }
          }
          if (!occupied) { sp = candidate; sim._gungameSpawnIdx += tries; break; }
        }
        sim._gungameSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = respawnHpFor(ws.playerState);
        ws.playerState.shield = respawnShieldFor(ws.playerState);
        ws.playerState.invulnUntil = nowMs + 1500;
        // Sätt vapen till current tier (kan ha demoterats)
        const tier = sim.gungameTiers[pid] || 0;
        ws.playerState.weaponId = GUNGAME_WEAPONS[tier];
        // C117: rensa stale bot-AI-state (path/sticky/cover + stale target-ref)
        if (ws._bot) resetBotAiState(ws._bot, sp.x, sp.y, nowMs);
        sim.eventQueue.push({
          type: 'gungame_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
          tier, weaponId: GUNGAME_WEAPONS[tier],
        });
      }
    }
  }

  // Pickups (HP/ammo) tickas också för gungame
  if (!sim.gungameEnded) tickPvpPickups(sim, now);

  // Match-end? Skip game-logic
  if (sim.gungameEnded) return;

  // Wall-collision för spelare
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, GUNGAME_ARENA.walls);
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }

  // Bullets uppdateras efter wall-collision
  updateBullets(sim, dt, now);

  // Death-detection + promote/demote-logik. Kill-attribution måste komma från
  // bullets.js som sätter sim._gungameLastKill { victim, killer, weaponId } per dödsfall.
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid = sim.tdmDeathsByPid || {};
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'gungame_player_died', victim: pid, durationMs: 3000 });
    }
  }
}

// === KOTH ===
// Hold-the-hill FFA. Spelare i aktiv zon får +1 pt/sek. Zone-position roterar
// var N sek så ingen kan sitta i samma hörn hela matchen. First to targetPoints.
function tickKoth(sim, dt, now) {
  const nowMs = Date.now();

  // C147/C164 (audit 2026-06-18): efter match-end körde respawn-loopen nedan vidare
  // (tdmRespawnAt re-spawnade döda) tills host:en tryckte sim_stop. Gate hela ticken
  // överst → ingen post-end-respawn. Match-end-eventet är redan köat + broadcastas av
  // tickSim efter detta return.
  if (sim.kothEnded) return;

  // Respawn (samma som gungame — roterande spawn, 3s cooldown)
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = KOTH_ARENA.spawns;
        const sp = spawns[sim._kothSpawnIdx % spawns.length];
        sim._kothSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.hp = respawnHpFor(ws.playerState);
        ws.playerState.shield = respawnShieldFor(ws.playerState);
        ws.playerState.invulnUntil = nowMs + 1500;
        // C117: rensa stale bot-AI-state
        if (ws._bot) resetBotAiState(ws._bot, sp.x, sp.y, nowMs);
        sim.eventQueue.push({
          type: 'koth_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
        });
      }
    }
  }

  if (sim.kothEnded) return;

  // Warning 5s före zone-byter — så spelare hinner springa till nästa zon
  const msToRotate = sim._kothZoneRotateAt - nowMs;
  if (msToRotate > 0 && msToRotate <= 5000 && !sim._kothWarningSent) {
    sim._kothWarningSent = true;
    const nextIdx = (sim.kothActiveZoneIdx + 1) % KOTH_ARENA.zones.length;
    const nextZ = KOTH_ARENA.zones[nextIdx];
    sim.eventQueue.push({
      type: 'koth_zone_warning',
      msToRotate,
      nextIdx,
      nextX: nextZ.x, nextY: nextZ.y, nextName: nextZ.name,
    });
  }
  // Zone-rotation
  if (nowMs >= sim._kothZoneRotateAt) {
    const next = (sim.kothActiveZoneIdx + 1) % KOTH_ARENA.zones.length;
    sim.kothActiveZoneIdx = next;
    sim._kothZoneRotateAt = nowMs + (KOTH_ARENA.zoneRotateSec || 45) * 1000;
    sim._kothWarningSent = false;
    const z = KOTH_ARENA.zones[next];
    sim.eventQueue.push({
      type: 'koth_zone_changed',
      idx: next,
      x: z.x, y: z.y, r: z.r, name: z.name,
      nextRotateAt: sim._kothZoneRotateAt,
    });
  }

  // Wall-collision + pickups
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const e = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(e, KOTH_ARENA.walls);
      ws.playerState.x = e.x;
      ws.playerState.y = e.y;
    }
  }
  tickPvpPickups(sim, now);

  // Bullets
  updateBullets(sim, dt, now);

  // Score: ENSAM i aktiv zon = +1 pt/sek. Contested (>1 spelare) = ingen får
  // poäng. Bryter genre-konventionen att man bara CAN hill om uncontested.
  // Detta gör att killing/utrensning av zonen blir taktisk.
  const zone = KOTH_ARENA.zones[sim.kothActiveZoneIdx];
  const inZone = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const dx = ws.playerState.x - zone.x, dy = ws.playerState.y - zone.y;
    if (dx * dx + dy * dy <= zone.r * zone.r) inZone.push(pid);
  }
  // Bara ensam-occupant tickar poäng. Multi-occupant = contested (pausad).
  if (inZone.length === 1) {
    const pid = inZone[0];
    sim._kothPointAccum[pid] = (sim._kothPointAccum[pid] || 0) + dt * (KOTH_ARENA.pointsPerSecond || 1);
    if (sim._kothPointAccum[pid] >= 1) {
      const whole = Math.floor(sim._kothPointAccum[pid]);
      sim._kothPointAccum[pid] -= whole;
      sim.kothScores[pid] = (sim.kothScores[pid] || 0) + whole;
    }
  }
  // Skicka contested-state om relevant så klient kan visa banner
  if (inZone.length > 1) {
    sim._kothContestedSent = sim._kothContestedSent || 0;
    if (now - sim._kothContestedSent > 1000) {
      sim._kothContestedSent = now;
      sim.eventQueue.push({ type: 'koth_zone_contested', count: inZone.length });
    }
  } else {
    sim._kothContestedSent = 0;
  }

  // Death-detection
  for (const [pid, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp <= 0 && !ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'koth_player_died', victim: pid, durationMs: 3000 });
    }
  }

  // Score-broadcast var sekund + win-check
  sim._kothBroadcastTick = (sim._kothBroadcastTick || 0) + dt;
  if (sim._kothBroadcastTick >= 1.0) {
    sim._kothBroadcastTick = 0;
    sim.eventQueue.push({
      type: 'koth_score_update',
      scores: { ...sim.kothScores },
      target: sim.kothTargetPoints,
    });
    // Win-check (v1.698: välj HÖGST poäng vid samtidig överträngning, ej insertion-ordning)
    let kWin = null, kBest = -1;
    for (const pid of Object.keys(sim.kothScores)) {
      // C230 (audit 2026-06-18): en bot får aldrig utropas till King of the Hill.
      const kws = sim.room.members.get(pid);
      if (kws && kws._isBot) continue;
      if (sim.kothScores[pid] >= sim.kothTargetPoints && sim.kothScores[pid] > kBest) {
        kBest = sim.kothScores[pid]; kWin = pid;
      }
    }
    if (kWin) { endKothMatch(sim, kWin, 'target_points'); return; }
  }
}

function endKothMatch(sim, winnerId, reason) {
  if (sim.kothEnded) return;
  sim.kothEnded = true;
  sim.kothWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p, _ws] of sim.room.members) {
    if (_ws && _ws.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
    stats.perPlayer[p] = {
      score: sim.kothScores[p] || 0,
      kills: sim.kothKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'koth_match_end',
    winner: winnerId, reason, stats,
  });
}

// ============================================================
// JUGGERNAUT — FFA-roll-mode: 1 JUG (kraftig, kollar 5× HP/+speed/dash)
// ============================================================
// pickSpreadSpawns — välj N spawns från pool så att de är MAXIMALT SPRIDDA.
// Best-candidate-algoritm: pick first random, sedan iterativt välj den
// spawn som har STÖRST min-distance till alla redan valda.
// Garanterar att spelare aldrig spawnar bredvid varandra (förutsatt att
// poolen har minst N spawns med vettigt avstånd).
function pickSpreadSpawns(pool, n) {
  if (n <= 0 || pool.length === 0) return [];
  const remaining = pool.slice();
  const chosen = [];
  // Pick first randomly
  const firstIdx = Math.floor(Math.random() * remaining.length);
  chosen.push(remaining[firstIdx]);
  remaining.splice(firstIdx, 1);
  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0, bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      let minDist = Infinity;
      for (const c of chosen) {
        const dx = remaining[i].x - c.x, dy = remaining[i].y - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDist) minDist = d2;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    chosen.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  // Om n > pool.length: lägg till jitter-kopior så två spelare inte hamnar
  // på exakt samma punkt
  if (chosen.length < n) {
    const need = n - chosen.length;
    for (let k = 0; k < need; k++) {
      const base = chosen[k % pool.length];
      chosen.push({
        x: base.x + (Math.random() - 0.5) * 200,
        y: base.y + (Math.random() - 0.5) * 200,
      });
    }
  }
  return chosen;
}

// Hitta spawn från pool som ligger LÄNGST bort från alla levande spelare.
// Används vid respawn så spelaren inte hamnar mitt i action.
function pickFarthestSpawn(pool, sim, excludePid) {
  if (pool.length === 0) return null;
  let best = pool[0], bestDist = -1;
  for (const sp of pool) {
    let minDist = Infinity;
    for (const [pid, ws] of sim.room.members) {
      if (pid === excludePid) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - sp.x, dy = ws.playerState.y - sp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDist) minDist = d2;
    }
    if (minDist > bestDist) { bestDist = minDist; best = sp; }
  }
  return best;
}

// Spawnar alla som hunters med pistol. Random human (aldrig bot) blir initial
// JUG. JUG-spelaren får 5× HP (skalat med spelarcount), +35% speed, 1s dash CD,
// valbart vapen (rifle/shotgun/sledge). Hunters har bara pistol.
// JUG dör → killer blir ny JUG (bot kan inte → human med högst dmg blir det).
// Vinst: mest sek-som-JUG när timer går ut.
// hpFrac: 1.0 = full HP (initial JUG), 0.6 = 60% HP (transfer mid-match —
// motverkar snowball där JUG dödar någon och får full HP omedelbart).
function applyJugStats(sim, ws, hpFrac) {
  if (!ws.playerState) return;
  const frac = (typeof hpFrac === 'number') ? Math.max(0.1, Math.min(1, hpFrac)) : 1;
  ws.playerState.maxHp = sim.juggernautHpMax;
  ws.playerState.hp = Math.round(sim.juggernautHpMax * frac);
  // JUG-specifik max-shield (200, var 100) — sätt FÖRE shield-räkningen
  // v1.700: skala shield med hunter-count vid N>4 (JUG var för svag vid 6-8 spelare;
  // shield ist f HP så 1v2-3 inte blir ännu mer ensidigt). +25/hunter över 4, cap +150.
  const _jugHunters = Math.max(0, _realMemberCount(sim) - 1);
  ws.playerState.maxShield = (JUGGERNAUT_ARENA.jugShieldMax || 200) + Math.min(150, 25 * Math.max(0, _jugHunters - 4));
  ws.playerState.shield = Math.round(ws.playerState.maxShield * frac);
  ws.playerState.isJug = true;
  ws.playerState.scaleMul = JUGGERNAUT_ARENA.jugScale;
  ws.playerState.speedMul = JUGGERNAUT_ARENA.jugSpeedMul;
  ws.playerState.dashCdMs = JUGGERNAUT_ARENA.jugDashCdMs;
  ws.playerState.weaponId = sim.juggernautWeapon || JUGGERNAUT_ARENA.jugDefaultWeapon;
}

function applyHunterStats(sim, ws) {
  if (!ws.playerState) return;
  ws.playerState.hp = 100;
  ws.playerState.maxHp = 100;
  ws.playerState.maxShield = JUGGERNAUT_ARENA.hunterShieldMax || 100;
  ws.playerState.shield = ws.playerState.maxShield;
  ws.playerState.isJug = false;
  ws.playerState.scaleMul = 1.0;
  ws.playerState.speedMul = JUGGERNAUT_ARENA.hunterSpeedMul || 1.10;
  // Server returnerar dashCdMs så klient kan rita CD-ring — uttryckligt 3s
  // (var 'null' vilket klient tolkade som default 3000ms; nu uttryckligt).
  ws.playerState.dashCdMs = 3000;
  ws.playerState.weaponId = JUGGERNAUT_ARENA.hunterWeapon;
}

function pickRandomHumanHunter(sim, excludePid) {
  const live = [];
  const fallback = [];
  for (const [pid, ws] of sim.room.members) {
    if (ws._isBot) continue;
    if (pid === excludePid) continue;
    if (!ws.playerState) continue;
    fallback.push(pid);
    // v1.698: föredra LEVANDE hunters — annars kunde en döende/respawnande hunter bli
    // JUG och återupplivas direkt (full HP, tdmRespawnAt=0).
    if (ws.playerState.hp > 0 && !ws.tdmRespawnAt) live.push(pid);
  }
  const pool = live.length ? live : fallback;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function transferJug(sim, newPid, reason) {
  if (sim.juggernautEnded) return;
  const oldPid = sim.juggernautPid;
  // Demote gamla JUG (kan vara null vid initial)
  if (oldPid) {
    const oldWs = sim.room.members.get(oldPid);
    if (oldWs && oldWs.playerState) {
      applyHunterStats(sim, oldWs);
      oldWs.playerState.invulnUntil = Date.now() + 1500;
    }
  }
  sim.juggernautPid = newPid;
  // Reset mobility-decay-tracker så nya JUG inte ärver gamla timer
  sim._jugLastMovePos = null;
  // Reset dmg-attribution när JUG byter (nya JUG ska få fresh dmg-tally mot sig)
  sim.juggernautDmgToJug = {};
  if (newPid) {
    const newWs = sim.room.members.get(newPid);
    if (newWs) {
      // Default-vapen: behåll current sim.juggernautWeapon om satt, annars default
      if (!sim.juggernautWeapon) sim.juggernautWeapon = JUGGERNAUT_ARENA.jugDefaultWeapon;
      // Full HP + shield för ny JUG (var: 60% mid-match — nu full per user-spec)
      applyJugStats(sim, newWs, 1.0);
      newWs.playerState.invulnUntil = Date.now() + 2000; // 2s invuln för ny JUG
      newWs.tdmRespawnAt = 0;
    }
  }
  sim.eventQueue.push({
    type: 'juggernaut_jug_changed',
    newJug: newPid,
    oldJug: oldPid,
    reason,
    weapon: sim.juggernautWeapon,
    jugHp: sim.juggernautHpMax,
  });
}

function tickJuggernaut(sim, dt, now) {
  const nowMs = Date.now();

  // C147/C164 (audit 2026-06-18): gate hela ticken efter match-end så respawn-loopen
  // nedan inte re-spawnar döda hunters tills host:en gör sim_stop. (Det fanns redan en
  // juggernautEnded-gate längre ned efter respawn/pickups/walls — denna flyttar den överst.)
  if (sim.juggernautEnded) return;

  // Respawn hunters (3s gungame-style, roterande spawn). JUG respawnar inte —
  // när JUG dör händer transferJug + ny JUG spawnar direkt på dödsplatsen.
  // Specialfall: om bot dödade förra JUG har sim._juggernautAwaitFirstRespawn
  // satts. Då blir den första humanen som respawnar ny JUG (istället för dmg-leaders).
  for (const [pid, ws] of sim.room.members) {
    if (ws.tdmRespawnAt && nowMs >= ws.tdmRespawnAt) {
      ws.tdmRespawnAt = 0;
      if (ws.playerState) {
        const spawns = JUGGERNAUT_ARENA.spawns;
        let sp = spawns[sim._juggernautSpawnIdx % spawns.length];
        for (let tries = 0; tries < spawns.length; tries++) {
          const candidate = spawns[(sim._juggernautSpawnIdx + tries) % spawns.length];
          let occupied = false;
          for (const [otherPid, otherWs] of sim.room.members) {
            if (otherPid === pid) continue;
            if (!otherWs.playerState || otherWs.playerState.hp <= 0) continue;
            const dx = otherWs.playerState.x - candidate.x;
            const dy = otherWs.playerState.y - candidate.y;
            if (dx * dx + dy * dy < 200 * 200) { occupied = true; break; }
          }
          if (!occupied) { sp = candidate; sim._juggernautSpawnIdx += tries; break; }
        }
        sim._juggernautSpawnIdx++;
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        // First-respawn-after-bot-kill = blir JUG istället för hunter
        const becomesJug = sim._juggernautAwaitFirstRespawn && !ws._isBot;
        if (becomesJug) {
          sim._juggernautAwaitFirstRespawn = false;
          // Aktivera JUG-stats + transfer
          transferJug(sim, pid, 'bot_killed_jug_first_respawn');
          // transferJug har redan satt invulnUntil + applyJugStats
        } else {
          applyHunterStats(sim, ws);
          ws.playerState.invulnUntil = nowMs + 1500;
        }
        // C117: rensa stale bot-AI-state
        if (ws._bot) resetBotAiState(ws._bot, ws.playerState.x, ws.playerState.y, nowMs);
        sim.eventQueue.push({
          type: 'juggernaut_player_respawned',
          peerId: pid,
          x: ws.playerState.x, y: ws.playerState.y,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
          isJug: becomesJug,
        });
      }
    }
  }

  // Pickups + walls (även när match slutar — bara score-tick stoppar)
  if (!sim.juggernautEnded) tickPvpPickups(sim, now);
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      resolveCtfWall(ent, JUGGERNAUT_ARENA.walls);
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  if (sim.juggernautEnded) return;

  updateBullets(sim, dt, now);

  // Death-detection — kompletterar bullets.js (explosioner, gas, mfl. ej-bullet-kills)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp > 0) continue;
    if (pid === sim.juggernautPid) {
      // JUG dog från icke-bullet-källa (explosion/oob etc) — random hunter blir ny JUG
      const fallback = pickRandomHumanHunter(sim, pid);
      ws.tdmRespawnAt = nowMs + 3000;
      sim.juggernautKillsByPid[pid] = sim.juggernautKillsByPid[pid] || 0;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'juggernaut_player_died', victim: pid, durationMs: 3000, wasJug: true });
      if (fallback) transferJug(sim, fallback, 'jug_suicide_or_environment');
      else {
        // Inga humans kvar — låt JUG stå tom + flagga first-respawn-blir-JUG
        // så match självläker när en human respawnar.
        sim.juggernautPid = null;
        sim._juggernautAwaitFirstRespawn = true;
      }
    } else if (!ws.tdmRespawnAt) {
      ws.tdmRespawnAt = nowMs + 3000;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      sim.eventQueue.push({ type: 'juggernaut_player_died', victim: pid, durationMs: 3000, wasJug: false });
    }
  }

  // Score-ackumulering: nuvarande JUG får dt-sek per tick
  if (sim.juggernautPid) {
    sim.juggernautScores[sim.juggernautPid] = (sim.juggernautScores[sim.juggernautPid] || 0) + dt;
  }

  // Anti-camping: JUG som inte rört sig >25px på 5s börjar tappa 2 HP/sek.
  // Tvingar JUG att hålla sig i rörelse istället för att fastna i ett hörn.
  if (sim.juggernautPid) {
    const jugWs = sim.room.members.get(sim.juggernautPid);
    if (jugWs && jugWs.playerState && jugWs.playerState.hp > 0) {
      const ps = jugWs.playerState;
      if (sim._jugLastMovePos == null) {
        sim._jugLastMovePos = { x: ps.x, y: ps.y, t: nowMs };
      } else {
        const dx = ps.x - sim._jugLastMovePos.x;
        const dy = ps.y - sim._jugLastMovePos.y;
        if (dx * dx + dy * dy > 25 * 25) {
          sim._jugLastMovePos = { x: ps.x, y: ps.y, t: nowMs };
        } else if (nowMs - sim._jugLastMovePos.t > 5000 && nowMs >= (ps.invulnUntil || 0)) {
          // Stationär >5s → drain 2 HP/sek.
          // C144 (audit 2026-06-18): gate på !invuln — en ny JUG som just transfererat
          // (invulnUntil=now+2000) och står stilla medan han orienterar sig ska inte börja
          // ta camp-skada genom sin invuln. Dränera shield FÖRE hp (konsekvent med övrig
          // dmg-väg) så camp-skadan inte hoppar över skölden.
          let drain = 2 * dt;
          if ((ps.shield || 0) > 0) {
            const absorb = Math.min(ps.shield, drain);
            ps.shield -= absorb; drain -= absorb;
          }
          if (drain > 0) ps.hp = Math.max(0, ps.hp - drain);
          // Throttla pvp_hp_changed till 2Hz för att inte spamma events
          sim._jugDecayBroadcast = (sim._jugDecayBroadcast || 0) + dt;
          if (sim._jugDecayBroadcast >= 0.5) {
            sim._jugDecayBroadcast = 0;
            sim.eventQueue.push({
              type: 'pvp_hp_changed',
              peerId: sim.juggernautPid,
              hp: ps.hp,
              shield: ps.shield || 0,
              decay: true,
            });
          }
        }
      }
    }
  } else {
    sim._jugLastMovePos = null;
  }

  // Score-broadcast var sekund (mirror av KOTH)
  sim._juggernautBroadcastTick = (sim._juggernautBroadcastTick || 0) + dt;
  if (sim._juggernautBroadcastTick >= 1.0) {
    sim._juggernautBroadcastTick = 0;
    const scoresRounded = {};
    for (const pid of Object.keys(sim.juggernautScores)) {
      scoresRounded[pid] = Math.floor(sim.juggernautScores[pid]);
    }
    sim.eventQueue.push({
      type: 'juggernaut_score_update',
      scores: scoresRounded,
      currentJug: sim.juggernautPid,
      msRemaining: Math.max(0, sim.juggernautEndAt - nowMs),
    });
  }

  // Minimap-puls var 5s — hunters får en kort blink av JUG-pos
  if (sim.juggernautPid && nowMs - sim._juggernautLastPulseAt >= JUGGERNAUT_ARENA.minimapPulseIntervalMs) {
    sim._juggernautLastPulseAt = nowMs;
    const jugWs = sim.room.members.get(sim.juggernautPid);
    if (jugWs && jugWs.playerState) {
      sim.eventQueue.push({
        type: 'juggernaut_minimap_pulse',
        x: Math.round(jugWs.playerState.x),
        y: Math.round(jugWs.playerState.y),
      });
    }
  }

  // Win-check: först till targetSec sekunder som JUG vinner.
  // (Tidigare: matchen tog slut på timer + mest-JUG-tid vann. Bytt till
  // "race-to-target" där match fortsätter tills någon når mål.)
  const targetSec = sim.juggernautMatchDurationSec || 360;
  for (const pid of Object.keys(sim.juggernautScores)) {
    if (sim.juggernautScores[pid] >= targetSec) {
      endJuggernautMatch(sim, pid, 'target_reached');
      return;
    }
  }
  // v1.698: wall-clock-fallback — matchen tog ALDRIG slut förr (race-to-target nås sällan
  // eftersom JUG-tiden delas mellan spelare). Vid timeout vinner mest ackumulerad JUG-tid.
  if (sim.juggernautEndAt && nowMs >= sim.juggernautEndAt) {
    let bestPid = null, bestScore = -1;
    for (const pid of Object.keys(sim.juggernautScores)) {
      if (sim.juggernautScores[pid] > bestScore) { bestScore = sim.juggernautScores[pid]; bestPid = pid; }
    }
    if (bestPid) endJuggernautMatch(sim, bestPid, 'time_up');
    return;
  }
}

// Kallas från bullets.js när en kill registreras i juggernaut-mode.
// Anropas via sim._handleJuggernautKill (exponerad vid startSim).
// v2 E6 (additivt): srcWeaponId (valfri, bara från explode) = källvapnet bakom en
// explosion. Nya fältet weaponId = srcWeaponId || weaponId; `weapon` oförändrat (V1).
function handleJuggernautKill(sim, killerPid, killerWs, victimPid, victimWs, weaponId, srcWeaponId) {
  if (sim.juggernautEnded) return;
  const wasJugKilled = (victimPid === sim.juggernautPid);
  sim.juggernautKillsByPid[killerPid] = (sim.juggernautKillsByPid[killerPid] || 0) + 1;
  sim.eventQueue.push({
    type: 'juggernaut_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
    weaponId: srcWeaponId || weaponId || null,   // v2 E6
    wasJugKilled,
  });
  if (wasJugKilled) {
    // JUG dog. Bot kan inte bli JUG.
    sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
    victimWs.tdmRespawnAt = Date.now() + 3000;
    sim.eventQueue.push({ type: 'juggernaut_player_died', victim: victimPid, durationMs: 3000, wasJug: true });
    // Hitta human med HÖGST damage mot denna JUG (killing-blow räknas också,
    // den har redan fått sina senaste dmg-poäng via _trackJuggernautDmg).
    let bestPid = null, bestDmg = -1;
    for (const pid of Object.keys(sim.juggernautDmgToJug)) {
      const ws = sim.room.members.get(pid);
      if (!ws || ws._isBot) continue;
      if (ws.playerState && ws.playerState.hp <= 0) continue; // skippa döda
      const d = sim.juggernautDmgToJug[pid];
      if (d > bestDmg) { bestDmg = d; bestPid = pid; }
    }
    let newJugPid = bestPid;
    if (!newJugPid) {
      // Ingen human i dmg-listan vid liv → first-respawn-fallback
      sim.juggernautPid = null;
      sim._juggernautAwaitFirstRespawn = true;
    }
    if (newJugPid) {
      // Spawn ny JUG ~400px från liket i random riktning. Tidigare spawnade vi
      // PÅ liket vilket gjorde "JUG-transfer = instant farm" av närvarande
      // hunters (spawn-camp loop). Nu får hunters tid att backa.
      const newWs = sim.room.members.get(newJugPid);
      if (newWs && newWs.playerState && victimWs.playerState) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 400;
        let nx = victimWs.playerState.x + Math.cos(angle) * dist;
        let ny = victimWs.playerState.y + Math.sin(angle) * dist;
        // Klampa till arena-bounds
        nx = Math.max(60, Math.min(JUGGERNAUT_ARENA.worldW - 60, nx));
        ny = Math.max(60, Math.min(JUGGERNAUT_ARENA.worldH - 60, ny));
        newWs.playerState.x = nx;
        newWs.playerState.y = ny;
      }
      transferJug(sim, newJugPid, 'jug_killed');
    }
  } else {
    // Hunter dödad — vanlig respawn
    sim.tdmDeathsByPid[victimPid] = (sim.tdmDeathsByPid[victimPid] || 0) + 1;
    victimWs.tdmRespawnAt = Date.now() + 3000;
    sim.eventQueue.push({ type: 'juggernaut_player_died', victim: victimPid, durationMs: 3000, wasJug: false });
  }
}

// Damage-attribution — kallas från bullets.js när hunter skadar JUG.
// Bot-dmg räknas också (för konsistens i siffrorna) men bots kan inte BLI JUG.
function trackJuggernautDmg(sim, shooterPid, victimPid, dmg) {
  if (victimPid !== sim.juggernautPid) return;
  if (shooterPid === sim.juggernautPid) return; // self-dmg (decay/explosion) räknas inte
  sim.juggernautDmgToJug[shooterPid] = (sim.juggernautDmgToJug[shooterPid] || 0) + dmg;
}

function endJuggernautMatch(sim, winnerId, reason) {
  if (sim.juggernautEnded) return;
  sim.juggernautEnded = true;
  sim.juggernautWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p, _ws] of sim.room.members) {
    if (_ws && _ws.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
    stats.perPlayer[p] = {
      timeAsJug: Math.floor(sim.juggernautScores[p] || 0),
      kills: sim.juggernautKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'juggernaut_match_end',
    winner: winnerId, reason, stats,
  });
}

// ============================================================
// BATTLE ROYALE — "LAST HUNT"
// ============================================================
// FFA, no-respawn. Krympande zon över N min (5/10/15). Loot på marken.
// Sista överlevare vinner. Bot kan vinna (samma rules).
// ============================================================
// CASTLE DEFENSE — co-op endless horde defense
// ============================================================
// Spelare försvarar tillsammans ett centralt castle (8 wall-segment + core)
// mot endless vågor av fiender som spawnar 360° runt utkanten. Bygg + reparera
// mellan attacker. Boss var 5:e våg.

// Beräkna antal fiender per våg (fas 2 scaling)
function cdEnemiesForWave(arena, wave) {
  return arena.waveBaseCount + (wave - 1) * arena.waveScalePerWave;
}

// v1.422: Difficulty-baserad price-multiplier för CD build/upgrade-kostnader.
// Casual ger -15% rabatt, insane ger +30% surcharge så hårdare mode = mer ekonomiskt
// tryck (utöver tuffare fiender). Tidigare ingen difference vilket gjorde
// "casual" mest distinkt på enemy HP/DMG.
function cdGetDifficultyPriceMul(difficulty) {
  switch (difficulty) {
    case 'casual': return 0.85;
    case 'hardcore': return 1.15;
    case 'insane': return 1.30;
    case 'recruit': return 0.90;       // legacy-namnet
    case 'nightmare': return 1.35;     // legacy-namnet
    case 'hard': return 1.15;          // legacy-namnet
    default: return 1.0;                // veteran
  }
}

// v1.416: Special wave themes var 3:e wave (skippas vid boss-wave)
const CD_WAVE_THEMES = ['speed_rush', 'bomb_squad', 'sniper_alley', 'elite', 'horde'];
function cdGetWaveTheme(wave, arena) {
  if (wave % (arena.bossEveryWave || 5) === 0) return null;
  if (wave < 3 || wave % 3 !== 0) return null;
  const idx = Math.floor(wave / 3) - 1;
  return CD_WAVE_THEMES[idx % CD_WAVE_THEMES.length];
}
function cdGetThemePool(theme) {
  if (theme === 'speed_rush') return ['runner', 'ninja', 'dog', 'swarmer'];
  if (theme === 'bomb_squad') return ['bomber', 'bomber', 'grunt', 'grunt'];
  if (theme === 'sniper_alley') return ['shooter', 'soldier', 'sniper'];
  return null; // elite/horde använder default-pool
}
function cdGetThemeCountMul(theme) {
  if (theme === 'elite') return 0.55;
  if (theme === 'horde') return 1.8;
  return 1.0;
}
function cdGetThemeStatMul(theme) {
  if (theme === 'elite') return { hp: 1.6, dmg: 1.6, gold: 1.8 };
  return null;
}
function cdGetThemeLabel(theme) {
  if (theme === 'speed_rush') return '⚡ SPEED RUSH';
  if (theme === 'bomb_squad') return '💣 BOMB SQUAD';
  if (theme === 'sniper_alley') return '🎯 SNIPER ALLEY';
  if (theme === 'elite') return '👑 ELITE GUARD';
  if (theme === 'horde') return '🐝 HORDE';
  return null;
}

// v1.415: Returnera enemy-typer som kan spawnas vid en specifik våg (för preview).
function cdGetWavePool(wave) {
  if (wave <= 2) return ['grunt', 'runner'];
  if (wave <= 4) return ['grunt', 'runner', 'swordsman'];
  if (wave <= 6) return ['grunt', 'runner', 'swordsman', 'brute'];
  if (wave <= 9) return ['grunt', 'runner', 'swordsman', 'brute', 'shooter'];
  if (wave <= 12) return ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier'];
  return ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier', 'sniper', 'ninja'];
}

// Pick enemy-type för current våg. Phase 5: mixad pool per våg-band.
// Använder existing enemy-typer; sapper-rollen täcks av 'bomber' (suicide-explode),
// flyer-rollen läggs på 'swarmer'/'dog' med _cdFlyer flag som skippar wall-collision.
function cdPickEnemyType(wave) {
  // Pool definieras per våg-band — bombers pushas till våg 10+ från playtest
  // (50 dmg one-shottar otränat spelare på våg 7 utan warning)
  let pool;
  if (wave <= 2) pool = ['grunt', 'grunt', 'grunt', 'runner'];
  else if (wave <= 4) pool = ['grunt', 'grunt', 'runner', 'runner', 'swordsman'];
  else if (wave <= 6) pool = ['grunt', 'runner', 'swordsman', 'brute'];
  else if (wave <= 9) pool = ['grunt', 'runner', 'swordsman', 'brute', 'shooter'];
  else if (wave <= 12) pool = ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier'];
  else pool = ['runner', 'brute', 'shooter', 'bomber', 'swarmer', 'soldier', 'sniper', 'ninja'];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Vissa typer agerar som "flyer" (ignorerar walls i castledefense).
// För variety: 30% av 'swarmer' och 'ninja' markeras som flyers.
function cdMaybeAssignFlyer(e) {
  if ((e.type === 'swarmer' || e.type === 'ninja') && Math.random() < 0.35) {
    e._cdFlyer = true;
  }
}

// Boss-rotation per boss-våg (fas 7)
const CD_BOSS_ROTATION = [
  'witheredelder', 'ironclad', 'mirroredone', 'ossarius', 'vanguardatlas',
  'emberoracle', 'blightsovereign', 'buriedcrown', 'lastsovereign',
];

function cdPickBossKey(wave) {
  // Wave 5 = idx 0, wave 10 = idx 1, etc. Cycle:as runt om hög våg.
  const idx = Math.floor(wave / 5) - 1;
  return CD_BOSS_ROTATION[idx % CD_BOSS_ROTATION.length];
}

// Per-tick uppdatering av alla aktiva castle-defense buildings.
// v1.661: återanvänd scratch för auto-turret target-query (noll-alloc). Säkert:
// single-threaded + fylls/läses inom en synkron turret-iteration.
const _cdTurretScratch = [];
const _cdAuraScratch = []; // CD_AURA_PASS_V1: reused scratch for perk-aura queries (zero-alloc).
// Auto-turret skjuter, traps skadar/slow:ar, repair-station regenererar walls,
// health-station regenererar spelare.
function updateCastleDefenseBuildings(sim, dt, nowMs) {
  // C162 (audit 2026-06-18): samla strategist-spelarnas positioner EN gång före
  // building-loopen istället för att scanna ALLA room.members per auto-turret per tick
  // (var O(torn×members)). Strategist-setet är litet + ändras sällan. Tom array → turret-
  // aura-loopen hoppas helt (vanligaste fallet: ingen har perken).
  // v3 perk-träd: STRATEG (arch_boost → +dmg) + FÄSTNING (arch_fort → +range) aura.
  // Spara boost/fort-rank på objektet så torn-loopen läser dem utan ny per-torn scan.
  const _cdAuraPlayers = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    const f = cdFlags(sim, pid);
    const boost = f.strategist || 0, fort = f.fortress || 0;
    const salvo = f.salvo || 0, mend = f.mender || 0;   // v3: ARTILLERISALVA + FALTINGENJOR aura-rank
    if (boost <= 0 && fort <= 0 && salvo <= 0 && mend <= 0) continue;
    _cdAuraPlayers.push({ ps: ws.playerState, boost, fort, salvo, mend });
  }
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0) continue;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    // === FALTINGENJOR (mender): byggen nara en mender-agare repareras gratis (+15 hp/s/rank) ===
    if (b.hp < b.maxHp) {
      let mendRank = 0;
      for (let mi = 0; mi < _cdAuraPlayers.length; mi++) {
        const a = _cdAuraPlayers[mi];
        if (a.mend <= 0) continue;
        const dxm = a.ps.x - bcx, dym = a.ps.y - bcy;
        if (dxm * dxm + dym * dym > 250 * 250) continue;
        if (a.mend > mendRank) mendRank = a.mend;
      }
      if (mendRank > 0) {
        b.hp = Math.min(b.maxHp, b.hp + 15 * mendRank * dt);
        if (!b._mendEvtAt || nowMs - b._mendEvtAt > 250) {
          b._mendEvtAt = nowMs;
          sim.eventQueue.push({ type: 'cd_building_damaged', id: b.id, hp: b.hp, maxHp: b.maxHp });
        }
      }
    }
    // === SLOT-TORN: MACHINEGUN / BOMBER (auto-skjut mot närmaste fiende; sätt-dig = dmg-boost) ===
    if (b.kind === 'machinegun' || b.kind === 'bomber') {
      if (b._fireCd > 0) b._fireCd -= dt;
      if (b._manFireCd > 0) b._manFireCd -= dt;   // manuell sitt-och-skjut-rate (del B)
      let stratMul = 1.0, fortRank = 0, salvoRank = 0;
      for (let si = 0; si < _cdAuraPlayers.length; si++) {
        const a = _cdAuraPlayers[si];
        const dxs = a.ps.x - bcx, dys = a.ps.y - bcy;
        if (dxs * dxs + dys * dys > 250 * 250) continue;   // behåll 250px-radien
        if (a.boost > 0) stratMul = Math.max(stratMul, 1 + 0.20 * a.boost);
        if (a.fort > 0) fortRank = Math.max(fortRank, a.fort);
        if (a.salvo > 0) salvoRank = Math.max(salvoRank, a.salvo);
      }
      // Hybrid: spelare som SITTER i tornet (b.occupantId) ger dmg-boost (manDpsMul).
      const manMul = b.occupantId ? (b.manDpsMul || 1.6) : 1.0;
      const effRange = b.range * (1 + 0.10 * fortRank);   // FASTNING: +10% rackvidd/rank (r2 +20%)
      if (!b.occupantId && b._fireCd <= 0 && (!b._reloadUntil || nowMs >= b._reloadUntil) && b.range > 0 && b.fireRate > 0) {   // bemannat torn = spelaren styr manuellt (del B)
        let best = null, bestD = effRange * effRange;
        if (sim.enemyGrid && sim.enemyGrid.size > 0) {
          sim.enemyGrid.queryInto(bcx, bcy, effRange, _cdTurretScratch);
          for (let qi = 0; qi < _cdTurretScratch.length; qi++) {
            const e = _cdTurretScratch[qi];
            if (e.dead) continue;
            const dx = e.x - bcx, dy = e.y - bcy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = e; }
          }
        } else {
          for (const e of sim.enemies) {
            if (e.dead) continue;
            const dx = e.x - bcx, dy = e.y - bcy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = e; }
          }
        }
        if (best) {
          const ang = Math.atan2(best.y - bcy, best.x - bcx);
          const isBomber = b.kind === 'bomber';
          const SPEED = isBomber ? 520 : 760;
          const bullet = {
            x: bcx + Math.cos(ang) * 20, y: bcy + Math.sin(ang) * 20,   // skott från MYNNINGEN (del B)
            vx: Math.cos(ang) * SPEED, vy: Math.sin(ang) * SPEED,
            dmg: (b.dps / b.fireRate) * stratMul * manMul,
            life: isBomber ? 1.8 : 1.4, r: isBomber ? 6 : 3,
            color: isBomber ? '#ff8a3a' : '#3acaff',
            hostile: false, ownerPid: b.ownerPid, _autoTurret: true, weaponId: 'turret',
          };
          if (isBomber) bullet._cdBlastR = b.blastRadius || 90;   // AoE vid träff (bullets.js)
          sim.bullets.push(bullet);
          if (salvoRank > 0) {   // === ARTILLERISALVA: extra splitterkula (25% skada/rank) om salvo-agare nara ===
            const sAng = isBomber ? (ang + 0.10) : (ang + (Math.random() < 0.5 ? -0.12 : 0.12));
            const salvoBullet = {
              x: bullet.x, y: bullet.y,
              vx: Math.cos(sAng) * SPEED, vy: Math.sin(sAng) * SPEED,
              dmg: bullet.dmg * 0.25 * salvoRank,
              life: bullet.life, r: bullet.r, color: bullet.color,
              hostile: false, ownerPid: b.ownerPid, _autoTurret: true, weaponId: 'turret',
            };
            if (isBomber) salvoBullet._cdBlastR = (b.blastRadius || 90) * 0.7;
            sim.bullets.push(salvoBullet);
          }
          b._fireCd = 1 / b.fireRate;
          b._mag = (b._mag || 0) + 1;
          const _magSize = isBomber ? 8 : 30;
          if (b._mag >= _magSize) {
            const _reloadMs = isBomber ? 1400 : 800;
            b._reloadUntil = nowMs + _reloadMs;
            b._mag = 0;
            sim.eventQueue.push({ type: 'cd_turret_reload', id: b.id, dur: _reloadMs });
          }
          sim.eventQueue.push({ type: 'cd_turret_fired', id: b.id, x: Math.round(bcx), y: Math.round(bcy), ang, kind: b.kind });
        }
      }
    }
    // === SPIKFÄLLA (dmg vid passage; slutar efter killCapacity fiender) ===
    else if (b.kind === 'spike_trap' && b.dmgOnPass > 0) {
      for (const e of sim.enemies) {
        if (e.dead) continue;
        if (e.x + e.r < b.x || e.x - e.r > b.x + b.w) continue;
        if (e.y + e.r < b.y || e.y - e.r > b.y + b.h) continue;
        e._spikeCdMs = e._spikeCdMs || {};
        if ((e._spikeCdMs[b.id] || 0) > nowMs) continue;
        e._spikeCdMs[b.id] = nowMs + 1200;
        e.hp -= b.dmgOnPass;
        if (e.hp <= 0) {
          e.dead = true;
          e.lastDamagerPid = b.ownerPid;       // kreditera ägaren (gold/score/perks)
          e.lastDamagerWeapon = 'spike_trap';
          b._spikeKills = (b._spikeKills || 0) + 1;
          const cap = b.killCapacity || 20;
          b.hp = Math.max(0, ((cap - b._spikeKills) / cap) * b.maxHp);
          sim.eventQueue.push({ type: 'cd_building_damaged', id: b.id, hp: b.hp, maxHp: b.maxHp });
          if (b._spikeKills >= cap) sim.eventQueue.push({ type: 'cd_building_destroyed', id: b.id });
        }
      }
    }
    // === TJÄRGROP (slow-aura) ===
    else if (b.kind === 'tar_trap' && b.slowDurSec > 0 && b.radius > 0) {
      const r2 = b.radius * b.radius;
      for (const e of sim.enemies) {
        if (e.dead) continue;
        const dx = e.x - bcx, dy = e.y - bcy;
        if (dx * dx + dy * dy > r2) continue;
        e.slowUntil = nowMs + b.slowDurSec * 1000;
        e.slowFactor = b.slowMul;
      }
    }
    // === OLJEBRAND (tidsbegränsad AoE eld-DoT mot fiender; brinner ut) ===
    else if (b.kind === 'oil_fire') {
      if (b._burnLeft == null) b._burnLeft = b.burnSec || 12;
      b._burnLeft -= dt;
      const r2 = (b.radius || 95) * (b.radius || 95);
      for (const e of sim.enemies) {
        if (e.dead) continue;
        const dx = e.x - bcx, dy = e.y - bcy;
        if (dx * dx + dy * dy > r2) continue;
        e.hp -= (b.dps || 45) * dt;
        e.burnUntil = nowMs + 400;
        if (e.hp <= 0) { e.dead = true; e.lastDamagerPid = b.ownerPid; e.lastDamagerWeapon = 'fire'; }
      }
      if (b._burnLeft <= 0) { b.hp = 0; sim.eventQueue.push({ type: 'cd_building_destroyed', id: b.id }); }
    }
    // powder_barrel: ingen per-tick — detonerar när man SKJUTER på den (bullets.js)
  }
}

// v2 REDESIGN: SLOTTS-NPC:er (inne i slottet, uppgraderas via tron/interaktion).
//  - heal_npc   helar SPELARE i radie (lvl 0 = 0 hp/s)
//  - repair_npc reparerar SLOTTET (core) (lvl 0 = 0 hp/s)
//  - throne     passiv (dess nivå sätter core.maxHp vid uppgradering)
function updateCastleNpcs(sim, dt, nowMs) {
  const npcs = sim.castledefenseNpcs;
  if (!npcs) return;
  const ups = CASTLEDEFENSE_ARENA.castleUpgrades;
  // MEDIC-perk (med_heal flag): någon LEVANDE medic → +50% på heal/repair-NPC (lag-resurs)
  let medicMul = 1.0;
  for (const [mpid, mws] of sim.room.members) {
    if (mws.playerState && mws.playerState.hp > 0 && !mws.playerState.cdDowned && cdFlags(sim, mpid).medic) { medicMul = 1.5; break; }
  }
  const hn = npcs.heal_npc;
  // #heal-tower: TVA oberoende healvagar — levelHp helar HP, levelShield helar SHIELD.
  // Bada healar lika mycket per level (samma healPerSecPerLvl) + kan hojas separat.
  if (hn && (hn.levelHp || 0) > 0) {
    const rate = hn.levelHp * ups.heal_npc.healPerSecPerLvl * medicMul;
    const rad = ups.heal_npc.radius || 230, r2 = rad * rad;
    for (const [, ws] of sim.room.members) {
      const ps = ws.playerState;
      if (!ps || ps.hp <= 0 || ps.cdDowned) continue;
      if (ps.hp >= (ps.maxHp || 100)) continue;
      const dx = ps.x - hn.x, dy = ps.y - hn.y;
      if (dx * dx + dy * dy > r2) continue;
      ps.hp = Math.min(ps.maxHp || 100, ps.hp + rate * dt);
    }
  }
  if (hn && (hn.levelShield || 0) > 0) {
    const rate = hn.levelShield * ups.heal_npc.healPerSecPerLvl * medicMul;
    const rad = ups.heal_npc.radius || 230, r2 = rad * rad;
    for (const [, ws] of sim.room.members) {
      const ps = ws.playerState;
      if (!ps || ps.hp <= 0 || ps.cdDowned) continue;
      const _msh = ps.maxShield || 100;
      if ((ps.shield || 0) >= _msh) continue;
      const dx = ps.x - hn.x, dy = ps.y - hn.y;
      if (dx * dx + dy * dy > r2) continue;
      ps.shield = Math.min(_msh, (ps.shield || 0) + rate * dt);
    }
  }
  const rn = npcs.repair_npc, core = sim.castledefenseCore;
  if (rn && rn.level > 0 && core && core.hp > 0 && core.hp < core.maxHp) {
    const rate = rn.level * ups.repair_npc.castleHealPerSecPerLvl * medicMul;
    core.hp = Math.min(core.maxHp, core.hp + rate * dt);
    if (!sim._cdCoreLastHealBroadcast || nowMs - sim._cdCoreLastHealBroadcast > 250) {
      sim._cdCoreLastHealBroadcast = nowMs;
      sim.eventQueue.push({ type: 'cd_core_damaged', hp: core.hp, maxHp: core.maxHp });
    }
  }
}

// ============================================================
// CASTLE DEFENSE — FLOW FIELD PATHFINDING (v1.398)
// ============================================================
// Pre-computed flow field — BFS från core utåt, lagrar för varje grid-cell
// vilken riktning enemy ska gå för att komma närmast core. Recomputeras vid
// building-place/destroy. Enemies hittar ALLTID väg om sådan finns.
function buildCdFlowField(sim) {
  const arena = CASTLEDEFENSE_ARENA;
  const grid = arena.buildGridSize;             // 30
  const cols = Math.ceil(arena.worldW / grid);
  const rows = Math.ceil(arena.worldH / grid);
  const cellCount = cols * rows;

  // Walkable-map: 1 = går igenom, 0 = blocked
  const walkable = new Uint8Array(cellCount);
  walkable.fill(1);

  // v2 REDESIGN: BARA murar blockerar flow-fältet i fältet. Port hanteras separat
  // (blockerar bara STÄNGD), och fällor/krut-tunna är walkable (effekt vid överlapp).
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0) continue;
    if (b.kind !== 'wall') continue;
    const ciStart = Math.floor(b.x / grid);
    const cjStart = Math.floor(b.y / grid);
    const ciEnd = Math.floor((b.x + b.w - 1) / grid);
    const cjEnd = Math.floor((b.y + b.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }
  // Legacy pre-built walls (om några)
  for (const w of sim.castledefenseWalls) {
    if (w.hp <= 0) continue;
    const ciStart = Math.floor(w.x / grid), cjStart = Math.floor(w.y / grid);
    const ciEnd = Math.floor((w.x + w.w - 1) / grid), cjEnd = Math.floor((w.y + w.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }
  // v2 REDESIGN: SOLIDA slottsväggar — alltid blocked (indestruktibla). Port-gapet i
  // sydväggen är INTE en vägg → cellerna där förblir walkable så flow-fältet (seedat
  // i slottets mitt) bara kan nå fältet GENOM porten = fiender trattas dit.
  for (const w of (sim.castledefenseCastleWalls || [])) {
    const ciStart = Math.floor(w.x / grid), cjStart = Math.floor(w.y / grid);
    const ciEnd = Math.floor((w.x + w.w - 1) / grid), cjEnd = Math.floor((w.y + w.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }
  // CLOSED PORT (port-byggen med open=false) blockerar också flow-fältet (öppen = walkable)
  for (const b of sim.castledefenseBuildings) {
    if (b.hp <= 0 || b.kind !== 'gate' || b.open) continue;
    const ciStart = Math.floor(b.x / grid), cjStart = Math.floor(b.y / grid);
    const ciEnd = Math.floor((b.x + b.w - 1) / grid), cjEnd = Math.floor((b.y + b.h - 1) / grid);
    for (let ci = ciStart; ci <= ciEnd; ci++) {
      for (let cj = cjStart; cj <= cjEnd; cj++) {
        if (ci >= 0 && ci < cols && cj >= 0 && cj < rows) walkable[cj * cols + ci] = 0;
      }
    }
  }

  // BFS från ALLA cells i en ring runt SLOTTS-KÄRNAN (i slottets mitt). Castle-väggarna
  // blockerar → BFS:en kan bara nå fältet GENOM port-gapet → fält-fiender flödar mot
  // porten, in, och till kärnan. (v2: seedat från core, ej borttagna arena.centerX/Y.)
  const cdGoalX = (sim.castledefenseCore ? sim.castledefenseCore.x : 2000);
  const cdGoalY = (sim.castledefenseCore ? sim.castledefenseCore.y : 600);
  const coreCi = Math.floor(cdGoalX / grid);
  const coreCj = Math.floor(cdGoalY / grid);
  const dist = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) dist[i] = -1;
  const queue = new Int32Array(cellCount);
  let qHead = 0, qTail = 0;

  const coreRange = (sim.castledefenseCore ? sim.castledefenseCore.r : 60) + grid;
  const coreRangeCells = Math.ceil(coreRange / grid);
  for (let dci = -coreRangeCells; dci <= coreRangeCells; dci++) {
    for (let dcj = -coreRangeCells; dcj <= coreRangeCells; dcj++) {
      const ci = coreCi + dci, cj = coreCj + dcj;
      if (ci < 0 || ci >= cols || cj < 0 || cj >= rows) continue;
      const cellX = ci * grid + grid / 2;
      const cellY = cj * grid + grid / 2;
      const ddx = cellX - cdGoalX, ddy = cellY - cdGoalY;
      if (ddx * ddx + ddy * ddy <= coreRange * coreRange) {
        const idx = cj * cols + ci;
        dist[idx] = 0;
        queue[qTail++] = idx;
      }
    }
  }

  // 4-dir BFS för Manhattan-distance
  const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qHead < qTail) {
    const idx = queue[qHead++];
    const ci = idx % cols;
    const cj = (idx - ci) / cols;
    const d = dist[idx];
    for (const [dx, dy] of nb4) {
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
      const nIdx = nj * cols + ni;
      if (!walkable[nIdx]) continue;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = d + 1;
      queue[qTail++] = nIdx;
    }
  }

  // Post-process: för varje walkable cell, hitta 8-dir neighbor med lägst dist.
  // Det är riktningen mot core (jämnare paths än ren 4-dir).
  const nextStep = new Int8Array(cellCount * 2);
  const nb8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      const idx = cj * cols + ci;
      if (dist[idx] === -1) { nextStep[idx * 2] = 0; nextStep[idx * 2 + 1] = 0; continue; }
      if (dist[idx] === 0) { nextStep[idx * 2] = 0; nextStep[idx * 2 + 1] = 0; continue; }
      let bestDist = dist[idx], bestDx = 0, bestDy = 0;
      for (const [dx, dy] of nb8) {
        const ni = ci + dx, nj = cj + dy;
        if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
        const nIdx = nj * cols + ni;
        if (dist[nIdx] === -1) continue;
        // Diagonal: kräv att båda ortogonala är walkable (annars cuttar vi hörn)
        if (dx !== 0 && dy !== 0) {
          if (!walkable[cj * cols + ni] || !walkable[nj * cols + ci]) continue;
        }
        if (dist[nIdx] < bestDist) {
          bestDist = dist[nIdx];
          bestDx = dx; bestDy = dy;
        }
      }
      nextStep[idx * 2] = bestDx;
      nextStep[idx * 2 + 1] = bestDy;
    }
  }

  return { cols, rows, grid, dist, nextStep, coreCi, coreCj };
}

function cdFlowLookup(field, x, y) {
  if (!field) return null;
  const ci = Math.floor(x / field.grid);
  const cj = Math.floor(y / field.grid);
  if (ci < 0 || ci >= field.cols || cj < 0 || cj >= field.rows) return null;
  const idx = cj * field.cols + ci;
  if (field.dist[idx] === -1) return null;       // unreachable
  return {
    dx: field.nextStep[idx * 2],
    dy: field.nextStep[idx * 2 + 1],
    dist: field.dist[idx],
  };
}

// === DOWN-STATE + REVIVE-SYSTEM (fas 6) ===
// Spelare med hp <= 0 går till crawl-state istället för att dö direkt.
// 30s bleed-out timer. Lagkamrat står över i 5s → revive med 50hp.
// Bleed-out → real death; respawn vid next wave-start.
function updateCastleDefenseDownState(sim, dt, nowMs) {
  const arena = CASTLEDEFENSE_ARENA;
  // Steg 1: Spelare som just blev "döda" → enter down-state istället
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    const ps = ws.playerState;
    if (ps.hp <= 0 && !ps.cdDowned && !ps.cdDownDead) {
      // [CD-LASTSTAND] last stand: skip down-state entirely, once per wave
      const fL = cdFlags(sim, pid);
      if (fL.laststand && ps._cdLastStandWave !== sim.castledefenseWave) {
        ps._cdLastStandWave = sim.castledefenseWave;
        const hpf = fL.laststand >= 2 ? 0.45 : 0.35;
        ps.hp = Math.round((ps.maxHp || 100) * hpf);
        if (fL.laststand >= 2) ps.shield = ps.maxShield || 100;
        ps.invulnUntil = nowMs + (fL.laststand >= 2 ? 2500 : 1750);
        sim.eventQueue.push({ type: 'cd_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield });
        continue;
      }
      // [CD-LASTBET] gambler last bet: chance to cheat death (30s cooldown)
      const fB = cdFlags(sim, pid);
      if (fB.lastbet && nowMs - (ps._cdLastBetAt || 0) > 30000 && Math.random() < 0.16 * fB.lastbet) {
        ps._cdLastBetAt = nowMs;
        ps.hp = Math.round((ps.maxHp || 100) * 0.45);
        ps.shield = ps.maxShield || 100;
        ps.invulnUntil = nowMs + 1500;
        sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: pid, kind: 'cheatdeath' });
        sim.eventQueue.push({ type: 'cd_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield });
        continue;
      }
      // Enter down-state
      cdForceDismount(sim, pid, ws); // satt i ett torn? kliv av → annars spök-torn som skjuter
      ps.cdDowned = true;
      ps.cdDownStartedAt = nowMs;
      ps.cdDownReviveProgress = 0;
      ps.hp = 1; // hold at 1 hp så player_died-detektion ej triggar
      ps._cdPrevWeapon = ps.weaponId;
      ps.weaponId = 'knife';
      ps._cdPrevSpeedMul = ps.speedMul;
      ps.speedMul = arena.downCrawlSpeedMul || 0.35;
      // Invulnerable under hela bleed-out — bleed-out timer är danger:n, inte enemies.
      // Sätts om vid revive (2s grace) eller cdDownDead (respawn-grace).
      ps.invulnUntil = nowMs + ((arena.downBleedoutSec || 30) * 1000) + 1000;
      sim.eventQueue.push({
        type: 'cd_player_downed',
        peerId: pid,
        x: Math.round(ps.x), y: Math.round(ps.y),
        // v1.789: skicka exakt bleed-out-duration (ms) från SERVERN → klienten räknar ner
        // mot sin egen klocka (klock-oberoende, ingen RTT-drift, ingen 25-vs-30-konstant-miss).
        bleedoutMs: (arena.downBleedoutSec || 30) * 1000,
      });
      sim.castledefenseDownedPids = sim.castledefenseDownedPids || [];
      if (!sim.castledefenseDownedPids.includes(pid)) sim.castledefenseDownedPids.push(pid);
    }
  }
  // Steg 2: Tickar för aktiv down-state — bleed-out + revive
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || !ws.playerState.cdDowned) continue;
    const ps = ws.playerState;
    // Bleed-out timer
    const elapsedSec = (nowMs - ps.cdDownStartedAt) / 1000;
    const bleedoutSec = arena.downBleedoutSec || 30;
    if (elapsedSec >= bleedoutSec) {
      // Real death (respawn vid next wave)
      ps.cdDowned = false;
      ps.cdDownDead = true;
      ps.hp = 0;
      ps.cdDownReviveProgress = 0;
      sim.castledefenseDownedPids = (sim.castledefenseDownedPids || []).filter(p => p !== pid);
      sim.eventQueue.push({
        type: 'cd_player_died_out',
        peerId: pid,
      });
      continue;
    }
    // Sök efter lagkamrat inom downReviveRadius för revive
    const baseReviveRadius = arena.downReviveRadius || 60;
    // Full scan: föredra en MEDIC i radien (deterministiskt → ingen flicker av 2× med
    // Map-ordning när flera står nära). v3: FÄLTSJUKHUS (med_hosp) ger +50% revive-radie.
    let reviverPid = null;
    let reviverIsMedic = false;
    for (const [pid2, ws2] of sim.room.members) {
      if (pid2 === pid) continue;
      if (!ws2.playerState || ws2.playerState.hp <= 0 || ws2.playerState.cdDowned) continue; // downade kan ej revive
      const f2 = cdFlags(sim, pid2);
      const isMedic = !!(f2.medicrev || f2.medichosp);
      const rr = baseReviveRadius * (1 + 0.25 * (f2.medichosp || 0));   // med_hosp: +25%/rank radius
      const dx = ws2.playerState.x - ps.x;
      const dy = ws2.playerState.y - ps.y;
      if (dx * dx + dy * dy >= rr * rr) continue;
      if (reviverPid === null || (isMedic && !reviverIsMedic)) {
        reviverPid = pid2;
        reviverIsMedic = isMedic;
        if (isMedic) break;   // medic = snabbast, sluta leta
      }
    }
    if (reviverPid) {
      ps.cdDownReviveProgress = (ps.cdDownReviveProgress || 0) + dt;
      // v3: revive 2× snabbare med LIVRÄDDARE (med_rev) el. FÄLTSJUKHUS (med_hosp).
      let reviveSec = arena.downReviveSec || 5;
      const fr = cdFlags(sim, reviverPid);
      if (fr.medicrev) reviveSec *= (1 - 0.25 * fr.medicrev);
      if (fr.medichosp) reviveSec *= 0.85;
      // Broadcast progress event (~5Hz)
      if (!ps._cdLastReviveBroadcast || nowMs - ps._cdLastReviveBroadcast > 200) {
        ps._cdLastReviveBroadcast = nowMs;
        sim.eventQueue.push({
          type: 'cd_revive_progress',
          peerId: pid,
          reviverPid,
          progress: Math.min(1, ps.cdDownReviveProgress / reviveSec),
        });
      }
      if (ps.cdDownReviveProgress >= reviveSec) {
        // REVIVED!
        // v1.431: emit FINAL progress=1.0 i samma batch som cd_player_revived så
        // BÅDA klienternas progress-bar går till 100% innan revived-eventet
        // clearar bar:n. Tidigare gick reviver's bar mot 95-100% medan revived's
        // ofta stannade på sista throttled-värde (~85%) → desync-känsla.
        sim.eventQueue.push({
          type: 'cd_revive_progress',
          peerId: pid, reviverPid,
          progress: 1.0,
        });
        ps.cdDowned = false;
        ps.cdDownStartedAt = 0;
        ps.cdDownReviveProgress = 0;
        ps.hp = Math.min(ps.maxHp || 100, 50);
        ps.weaponId = ps._cdPrevWeapon || arena.startWeapon;
        ps.speedMul = ps._cdPrevSpeedMul || 1.0;
        ps.invulnUntil = nowMs + 2000;
        // [CD-MEDDEFIB] defibrillator: revived player gets more hp/shield/grace
        if (fr.meddefib) {
          const full = fr.meddefib >= 2;
          ps.hp = full ? (ps.maxHp || 100) : Math.round((ps.maxHp || 100) * 0.75);
          if (full) ps.shield = ps.maxShield || 100;
          ps.invulnUntil = nowMs + (full ? 5000 : 3000);
        }
        sim.castledefenseRevivedCount += 1;
        sim.castledefenseDownedPids = (sim.castledefenseDownedPids || []).filter(p => p !== pid);
        sim.eventQueue.push({
          type: 'cd_player_revived',
          peerId: pid,
          reviverPid,
        });
      }
    } else {
      // Ingen revives → progress decay + broadcast så klientens revive-båge TÖMS synligt
      // (annars fryser bågen på sista värdet). En sista 0:a när golvet nås raderar bågen.
      if ((ps.cdDownReviveProgress || 0) > 0) {
        ps.cdDownReviveProgress = Math.max(0, ps.cdDownReviveProgress - dt * 0.5);
        const rsec = arena.downReviveSec || 5;
        if (!ps._cdLastReviveBroadcast || nowMs - ps._cdLastReviveBroadcast > 200 || ps.cdDownReviveProgress <= 0) {
          ps._cdLastReviveBroadcast = nowMs;
          sim.eventQueue.push({
            type: 'cd_revive_progress', peerId: pid, reviverPid: null,
            progress: Math.min(1, ps.cdDownReviveProgress / rsec),
          });
        }
      }
    }
  }
  // Steg 3: Respawn döda spelare vid next wave-start
  if (sim.castledefenseWaveState === 'active' && sim._cdLastWaveProcessed !== sim.castledefenseWave) {
    sim._cdLastWaveProcessed = sim.castledefenseWave;
    // Vid wave-start: alla cdDownDead spelare respawnar vid core
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || !ws.playerState.cdDownDead) continue;
      const ps = ws.playerState;
      ps.cdDownDead = false;
      ps.cdDownReviveProgress = 0;
      sim.castledefenseDownedPids = (sim.castledefenseDownedPids || []).filter(p => p !== pid);
      ps.x = sim.castledefenseCore ? sim.castledefenseCore.x : arena.centerX;
      ps.y = sim.castledefenseCore ? sim.castledefenseCore.y : arena.centerY;
      ps.weaponId = ps._cdPrevWeapon || arena.startWeapon;
      // v3 perk-träd: re-apply stats (tank-maxHp + scout-speedMul) från flaggor vid respawn
      applyCdTreeStats(sim, ps, pid);
      ps.hp = ps.maxHp;
      ps.invulnUntil = nowMs + 3000;
      sim.eventQueue.push({
        type: 'cd_player_respawned',
        peerId: pid,
        wave: sim.castledefenseWave,
      });
    }
  }
}

// v1.528/v1.533: SURVIVORS-RUN mini-boss-spawn — kallas vid 4/8/12/16 min elapsed.
// Shufflad lista garanterar OLIKA bossar per match (var random med replacement).
function spawnSurvivorsMiniBoss(sim) {
  // Lazy-init shuffled queue per match
  if (!sim.survivorsBossQueue || sim.survivorsBossQueue.length === 0) {
    const keys = Object.keys(BOSS_CONFIGS);
    // Fisher-Yates shuffle
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    sim.survivorsBossQueue = keys;
  }
  const key = sim.survivorsBossQueue.shift();
  if (!key) return;
  const arena = CASTLEDEFENSE_ARENA;
  // Spawna 700px från center i random direction
  const ang = Math.random() * Math.PI * 2;
  const dist = 700;
  const sx = arena.centerX + Math.cos(ang) * dist;
  const sy = arena.centerY + Math.sin(ang) * dist;
  // v1.697: mini-boss-HP sublinjärt (matchar story) i st f linjärt 8× @8p
  const coopMul = cdGetCoopMul(Math.max(1, _realMemberCount(sim)));
  const boss = makeBoss(key, sx, sy, coopMul);
  if (!boss) return;
  // v1.606: Mini-bossar ska INTE vara svårare än vanliga CD-bossar.
  // Base = 60% av regular boss, time-scale +5%/min (var +15% = för stark late).
  // Resultat: vid 4 min ~0.72×, 16 min ~1.08× regular boss. Mini-boss känns
  // som ett hot men inte överväldigande — perks ska räcka.
  const elapsedMin = (Date.now() - (sim.survivorsStartT || Date.now())) / 60000;
  const baseMul = 0.6;
  const timeMul = 1 + elapsedMin * 0.05;
  boss.hp = Math.max(1, Math.round(boss.hp * baseMul * timeMul));
  boss.maxHp = boss.hp;
  boss.dmg = Math.max(1, Math.round(boss.dmg * baseMul * timeMul));
  boss._idx = sim.nextEnemyIdx++;
  sim.enemies.push(boss);
  sim.eventQueue.push({
    type: 'survivors_miniboss_spawn',
    bossKey: boss.bossKey,
    name: boss.name,
    elapsedSec: Math.round((Date.now() - sim.survivorsStartT) / 1000),
    x: boss.x,
    y: boss.y,
  });
}

// v2 R10b (additivt): STRESSTEST-SHOWROOM — spawnar EN av varje standard-enemy,
// varje miniboss-power och varje boss i prydliga rader nedanför hosten (V1-paritet:
// game.js spawnEnemyShowcase, v1.581). Alla får _showcaseFrozen: AI/attack skippas
// i tick-looparna, de tar skada men gör ingen, och "död" återställs + positionen
// pinnas varje tick (odödliga-ish). Nås BARA via sim_stresstest {what:'showcase'}
// (kräver host + stresstestActive) — V1-webben skickar aldrig `what` → total no-op.
function applyStresstestShowcase(sim, px, py) {
  if (!sim || !sim.stresstestActive) return;
  const arena = CASTLEDEFENSE_ARENA;
  // Rensa allt levande så griden är ren (stresstest-only — ingen V1-väg hit)
  sim.enemies = [];
  const cols = 7;
  const spacingX = 110, spacingY = 140;
  // Klampa basen så hela griden (bredaste rad ±360, total höjd ~1150) ryms i arenan
  const baseX = Math.max(420, Math.min(arena.worldW - 420, px));
  const baseY = Math.max(60, Math.min(arena.worldH - 1260, py + 280));
  const place = (e, x, y, label) => {
    e._showcaseFrozen = true;
    e._showcaseX = x; e._showcaseY = y;
    e.x = x; e.y = y;
    e.dmg = 0;                       // bälte+hängslen: kan inte skada ens via edge-paths
    if (e.bulletDmg) e.bulletDmg = 0;
    e.gold = 0;                      // ingen guld-farm på odödliga dockor
    e._miniBossNextSpawned = true;   // ingen interlude-spawn om en ändå skulle "dö"
    if (label && !e.name) e.name = label;
    e._idx = sim.nextEnemyIdx++;
    sim.enemies.push(e);
  };
  // STANDARD ENEMIES (14) — samma lista + grid som V1:s showcase
  const standard = ['grunt', 'runner', 'brute', 'shooter', 'ninja', 'swordsman', 'soldier',
    'robot', 'dog', 'healer', 'summoner', 'bomber', 'sniper', 'swarmer'];
  let standardRows = 0;
  standard.forEach((type, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    if (row + 1 > standardRows) standardRows = row + 1;
    place(makeEnemy(type, 0, 0),
      baseX - (cols - 1) * spacingX / 2 + col * spacingX,
      baseY + row * spacingY, type.toUpperCase());
  });
  // MINI-BOSS-POWERS (9) — brute-bas + miniPower, som V1
  const miniPowers = ['caster', 'tank_charger', 'cloaker', 'brute_charger', 'plasma',
    'jetpack', 'gas_sniper', 'shielder', 'avatar'];
  const miniBaseY = baseY + standardRows * spacingY + 120;
  let miniRows = 0;
  miniPowers.forEach((power, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    if (row + 1 > miniRows) miniRows = row + 1;
    const e = makeEnemy('brute', 0, 0);
    e.isMiniBoss = true;
    e.miniPower = power;
    e.r = Math.round(e.r * 1.4);
    e.hp = e.maxHp = 300;
    e.name = power.toUpperCase().replace(/_/g, ' ');
    place(e, baseX - (cols - 1) * spacingX / 2 + col * spacingX,
      miniBaseY + row * spacingY);
  });
  // BOSSAR — alla nycklar ur BOSS_CONFIGS (10 st), större spacing pga radius
  const bossKeys = Object.keys(BOSS_CONFIGS);
  const bossBaseY = miniBaseY + miniRows * spacingY + 220;
  const bossCols = 5, bossSpacingX = 180, bossSpacingY = 200;
  bossKeys.forEach((key, i) => {
    const boss = makeBoss(key, 0, 0, 1);
    if (!boss) return;
    const col = i % bossCols, row = Math.floor(i / bossCols);
    place(boss, baseX - (bossCols - 1) * bossSpacingX / 2 + col * bossSpacingX,
      bossBaseY + row * bossSpacingY);
  });
  sim._showcaseActive = true;
  sim.eventQueue.push({
    type: 'stresstest_showcase',
    count: sim.enemies.length,
  });
}

function tickCastleDefense(sim, dt, now) {
  const nowMs = Date.now();
  const arena = CASTLEDEFENSE_ARENA;

  if (sim.castledefenseEnded) return;

  // v1.526: SURVIVORS-RUN iteration 2 — time-based win + lose-conditions.
  // v1.528: iter 4 — mini-boss-spawn var 4 min.
  if (sim.survivorsActive) {
    if (!sim.survivorsStartT) sim.survivorsStartT = nowMs;
    // v1.531: Match-duration från lobby-val (10/20/30 min) eller fallback 20 min
    const matchDurationMs = (sim.survivorsDurationSec || 1200) * 1000;
    const elapsedMs = nowMs - sim.survivorsStartT;
    if (elapsedMs >= matchDurationMs) {
      sim.castledefenseEnded = true;
      // v1.607: Match-end-bonus: 1000 gold per overlevande spelare (för meta-progression)
      const survivors = [];
      for (const [pid, ws] of sim.room.members) {
        if (ws.playerState && ws.playerState.hp > 0) {
          sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + 1000;
          sim.eventQueue.push({
            type: 'cd_gold_update', peerId: pid,
            gold: sim.castledefenseGold[pid], delta: 1000,
          });
          survivors.push(pid);
        }
      }
      sim.eventQueue.push({
        type: 'survivors_win',
        survivedSec: Math.round(elapsedMs / 1000),
        survivors,
      });
      return;
    }
    // Lose-check: alla real players döda/downed
    let anyAlive = false;
    for (const [, ws] of sim.room.members) {
      if (ws._isBot) continue;
      if (ws.playerState && ws.playerState.hp > 0 && !ws.playerState.cdDowned) {
        anyAlive = true; break;
      }
    }
    if (!anyAlive && sim.room.members.size > 0) {
      sim.castledefenseEnded = true;
      sim.eventQueue.push({
        type: 'survivors_lose',
        survivedSec: Math.round(elapsedMs / 1000),
      });
      return;
    }
    // v1.528: Mini-boss-spawn var 4 min (240s) — vid 4, 8, 12, 16 min
    // v1.616: HOPPAS i stresstest — showcase ska vara stilla utan spawn-flow
    const miniBossInterval = (SURVIVORS_ARENA && SURVIVORS_ARENA.miniBossEverySec) || 240;
    const elapsedSec = elapsedMs / 1000;
    const expectedMiniBosses = Math.floor(elapsedSec / miniBossInterval);
    sim.survivorsMiniBossesSpawned = sim.survivorsMiniBossesSpawned || 0;
    if (!sim.stresstestActive && expectedMiniBosses > sim.survivorsMiniBossesSpawned) {
      spawnSurvivorsMiniBoss(sim);
      sim.survivorsMiniBossesSpawned = expectedMiniBosses;
    }
    // v1.610: SLOW SHIELD-REGEN — 4 shield/s när man inte tagit skada de senaste 3s.
    // Broadcastar cd_hp_changed var 1s så HUD reflekterar regen.
    sim._survShieldRegenAccum = (sim._survShieldRegenAccum || 0) + dt;
    if (sim._survShieldRegenAccum >= 1.0) {
      sim._survShieldRegenAccum = 0;
      for (const [pid, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const ps = ws.playerState;
        const sinceHit = ps.invulnUntil ? (nowMs - (ps.invulnUntil - 150)) : 99999;
        const sinceHitMs = ps._lastDamageAt ? (nowMs - ps._lastDamageAt) : 99999;
        if (sinceHitMs < 3000) continue;
        const maxSh = ps.maxShield || 100;
        if ((ps.shield || 0) < maxSh) {
          ps.shield = Math.min(maxSh, (ps.shield || 0) + 4);
          sim.eventQueue.push({
            type: 'cd_hp_changed', peerId: pid,
            hp: ps.hp, shield: ps.shield,
          });
        }
      }
    }

    // v1.606: TIME-BASED wave-scheduler — var 25s spawn ny batch oavsett om
    // förra wavens minions är döda. Tidigare kill-baserat = långsamt om man
    // missade en sniper i hörn. Nu: konstant press, vågorna stackar.
    // v1.616: HOPPAS i stresstest — showcase ska vara stillastående grupp,
    // inte spammas över med wave-spawnade enemies som drabbar player.
    const survArena = SURVIVORS_ARENA || {};
    const waveIntervalMs = (survArena.waveIntervalSec || 25) * 1000;
    const waveBase = survArena.waveBaseCount || 6;
    const waveScalePerMin = survArena.waveScalePerMinute || 3;
    if (!sim._survNextWaveAt) {
      sim._survNextWaveAt = sim.survivorsStartT + 1500; // första vågen 1.5s in
    }
    if (!sim.stresstestActive && nowMs >= sim._survNextWaveAt) {
      sim._survNextWaveAt = nowMs + waveIntervalMs;
      // v1.607: Wave-bonus gold INNAN nästa wave startar (utom första wave).
      // v1.610: + shield-regen (50% av max) per wave så shield faktiskt fungerar.
      if (sim.castledefenseWave > 0) {
        const waveBonus = 80 + sim.castledefenseWave * 20;
        for (const [pid, ws] of sim.room.members) {
          if (!ws.playerState || ws.playerState.hp <= 0) continue;
          sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + waveBonus;
          sim.eventQueue.push({
            type: 'cd_gold_update', peerId: pid,
            gold: sim.castledefenseGold[pid], delta: waveBonus,
          });
          // Shield-regen (50% av maxShield) per wave-tick
          const maxSh = ws.playerState.maxShield || 100;
          const shRegen = Math.round(maxSh * 0.5);
          ws.playerState.shield = Math.min(maxSh, (ws.playerState.shield || 0) + shRegen);
          sim.eventQueue.push({
            type: 'cd_hp_changed', peerId: pid,
            hp: ws.playerState.hp, shield: ws.playerState.shield,
          });
        }
      }
      sim.castledefenseWave += 1;
      sim.castledefenseWaveState = 'active'; // håll alltid active i survivors
      const survElapsedMin = elapsedMs / 60000;
      // v1.697: svärmen växer med spelarantal (kompenserar för nu sublinjär HP + kapad dmg)
      const batchCount = Math.max(1, Math.round((waveBase + survElapsedMin * waveScalePerMin) * cdGetCoopSpawnMul(Math.max(1, _realMemberCount(sim)))));
      // Stacka på befintliga remaining så waves overlappar
      sim._cdWaveSpawnsRemaining = (sim._cdWaveSpawnsRemaining || 0) + batchCount;
      sim._cdWaveSpawnTimer = 0;
      // Theme: skippa boss-vågor i survivors (mini-bossar hanteras separat)
      const survTheme = cdGetWaveTheme(sim.castledefenseWave, arena);
      sim._cdActiveTheme = survTheme;
      sim.eventQueue.push({
        type: 'cd_wave_started',
        wave: sim.castledefenseWave,
        enemiesIncoming: sim._cdWaveSpawnsRemaining,
        isBoss: false,
        theme: survTheme,
        themeLabel: cdGetThemeLabel(survTheme),
      });
    }
  }

  // === FLOW FIELD + SOLID-LISTOR + KOLLISIONSGRIDER: bygg/rebygg om dirty ===
  // C225 (perf 2026-07-07): cdAllSolids/cdMoveSolids cachas på sim och byggs BARA när
  // structuren ändras (wall/gate byggs/säljs/förstörs/öppnas/hp=0 vid fiendeattack).
  // Samma dirty-signal (_cdFlowDirty) täcker ALLA mutationsvägar exakt — verifierat
  // mot: bygg (9666), sälj (9834), fiendeförstör (4055), gate-toggle (10019), start (8568).
  // buildWallGrid-grider byggs i samma block för O(local) wallsInRect-queries i enemy-loop.
  // PERF-not: grid är neutral/marginellt sämre för typisk CD (5+15=20 väggar) pga Map-
  // overhead, men fallback till linear körs automatiskt om grid saknas (null-check).
  if (sim._cdFlowDirty || !sim._cdFlowField) {
    const _lw = sim.castledefenseWalls.filter(w => w.hp > 0);
    const _lb = sim.castledefenseBuildings.filter(b => b.hp > 0);
    const _sb = _lb.filter(b => b.kind === 'wall' || (b.kind === 'gate' && !b.open));
    const _as = _lw.concat(_sb);
    const _ms = _as.concat(sim.castledefenseCastleWalls || []);
    sim._cdAllSolids     = _as;
    sim._cdMoveSolids    = _ms;
    // HYBRID: grid lonar sig forst vid ~50+ solids (differentiellt uppmatt
    // 1.9x LANGSAMMARE vid typiska ~20 pga Map-overhead). Under troskeln
    // lamnas griden null -> bada query-sites har redan linear-fallback.
    sim._cdMoveSolidsGrid = _ms.length > 48 ? buildWallGrid(_ms) : null;
    sim._cdAllSolidsGrid  = _as.length > 48 ? buildWallGrid(_as) : null;
    sim._cdFlowField = buildCdFlowField(sim);
    sim._cdFlowDirty = false;
  }
  // Lokala alias (kostnads-fri re-läsning av cachade arrayer)
  const cdAllSolids  = sim._cdAllSolids  || [];
  const cdMoveSolids = sim._cdMoveSolids || [];
  // cdLiveBuildings per-tick (ALLA levande byggnader, ej bara solida) — används av
  // cdSolidsForTarget (enemy targeting) som inkluderar machinegun/bomber etc.
  // Non-wall/gate byggnader triggerar EJ _cdFlowDirty vid tillägg, så den kan ej cachas.
  const cdLiveBuildings = sim.castledefenseBuildings.filter(b => b.hp > 0);

  // === PLAYER COLLISION ===
  // v2 REDESIGN: spelare kan INTE längre gå igenom murar — murar + STÄNGDA portar +
  // de solida slottsväggarna blockerar spelaren (bygg taktiskt). Öppna portar och
  // fällor/krut-tunna släpper igenom. SURVIVORS behåller pass-through (eget läge).
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      if (!sim.survivorsActive) {
        resolveCtfWall(ent, cdMoveSolids);
      }
      if (sim.castledefenseCore && sim.castledefenseCore.hp > 0 && !sim.survivorsActive) {
        const core = sim.castledefenseCore;
        const cc = core.chairColl;
        if (cc) {                       // FYRKANT-kollision = bara tron-stolen
          const er = ent.r || 14;
          if (ent.x + er > cc.x && ent.x - er < cc.x + cc.w && ent.y + er > cc.y && ent.y - er < cc.y + cc.h) {
            const dxL = (ent.x + er) - cc.x, dxR = (cc.x + cc.w) - (ent.x - er);
            const dyT = (ent.y + er) - cc.y, dyB = (cc.y + cc.h) - (ent.y - er);
            const m = Math.min(dxL, dxR, dyT, dyB);
            if (m === dxL) ent.x -= dxL; else if (m === dxR) ent.x += dxR;
            else if (m === dyT) ent.y -= dyT; else ent.y += dyB;
          }
        } else {                        // fallback: gamla r-cirkeln
          const dx = ent.x - core.x, dy = ent.y - core.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const minD = core.r + ent.r;
          if (d < minD && d > 0.01) { ent.x = core.x + (dx / d) * minD; ent.y = core.y + (dy / d) * minD; }
          else if (d < 0.01) { ent.x = core.x + minD; }
        }
      }
      ent.x = Math.max(20, Math.min(arena.worldW - 20, ent.x));
      ent.y = Math.max(20, Math.min(arena.worldH - 20, ent.y));
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  // === WAVE STATE MACHINE ===
  // v1.606: SURVIVORS har egen time-based scheduler ovanför — skippa CD:s state-machine
  if (!sim.survivorsActive && sim.castledefenseWaveState === 'between' && nowMs >= sim.castledefenseWaveBetweenEndAt) {
    // Starta nästa våg
    sim.castledefenseWaveState = 'active';
    sim.castledefenseWave += 1;
    const w = sim.castledefenseWave;
    const isBoss = w % arena.bossEveryWave === 0;
    // v1.416: special wave-theme (var 3:e wave, skippas vid boss)
    const theme = cdGetWaveTheme(w, arena);
    sim._cdActiveTheme = theme;
    if (isBoss) {
      const bossKey = cdPickBossKey(w);
      const sp = arena.enemySpawns[Math.floor(Math.random() * arena.enemySpawns.length)];
      // v1.697: boss-HP sublinjärt (matchar story-bossar) i st f linjärt 8× @8p
      const coopMul = cdGetCoopMul(Math.max(1, _realMemberCount(sim)));
      const boss = makeBoss(bossKey, sp.x, sp.y, coopMul);
      if (boss) {
        // v1.419: BOSS scaling = difficulty × wave-scaling × casual-relief.
        // Tidigare bug: boss-vågor saknade wave-scaling helt (lika svår på wave 5
        // som wave 50). cdWaveScale = 1 + (wave-1) × 0.08 ⇒ wave 5 = 1.32×, w10 = 1.72×.
        const bDiff = cdGetDiffMul(sim.config.difficulty);
        const bWaveScale = 1 + (w - 1) * 0.06;   // boss-HP mildare (var 0.08): w40 4.12x->3.34x
        const casualBossRelief = sim.config.difficulty === 'casual' ? 0.7 : 1.0;
        const totalMul = bDiff.enemyHp * bWaveScale * casualBossRelief;
        const bDmgWaveScale = 1 + (w - 1) * 0.04;   // boss-SKADA flackare an HP (var bWaveScale): w40 264->164
        const totalDmgMul = bDiff.enemyDmg * bDmgWaveScale * casualBossRelief;
        boss.hp = Math.max(1, Math.round(boss.hp * totalMul));
        boss.maxHp = boss.hp;
        boss.dmg = Math.max(1, Math.round(boss.dmg * totalDmgMul));
        if (boss.bulletDmg) boss.bulletDmg = Math.max(1, Math.round(boss.bulletDmg * totalDmgMul));
        boss._idx = sim.nextEnemyIdx++;
        boss._cdEnemy = true;
        boss._cdBossWave = w;
        sim.enemies.push(boss);
        sim.bossAlive = true;
        sim.eventQueue.push({
          type: 'boss_spawned',
          bossKey,
          name: boss.name,
          sub: boss.subtitle,
        });
      }
      sim._cdWaveSpawnsRemaining = Math.max(1, Math.round((3 + Math.floor(w / 5)) * cdGetCoopSpawnMul(Math.max(1, _realMemberCount(sim)))));
    } else {
      const base = cdEnemiesForWave(arena, w);
      const countMul = cdGetThemeCountMul(theme);
      // v1.697: coop-spawn-skalning så svärmen växer med spelarantal
      sim._cdWaveSpawnsRemaining = Math.max(1, Math.round(base * countMul * cdGetCoopSpawnMul(Math.max(1, _realMemberCount(sim)))));
    }
    sim._cdWaveSpawnTimer = 0;
    // timed advance: nästa våg får överlappa in efter waveActiveMaxSec även om
    // fiender lever kvar (icke-boss). Ger snabbare tempo utan att vänta ut stragglers.
    sim._cdWaveActiveDeadline = nowMs + (arena.waveActiveMaxSec || 14) * 1000;
    sim.eventQueue.push({
      type: 'cd_wave_started',
      wave: w,
      enemiesIncoming: sim._cdWaveSpawnsRemaining,
      isBoss,
      theme,
      themeLabel: cdGetThemeLabel(theme),
    });
  }

  // === SPAWN ENEMIES (under active-fasen) ===
  if (sim.castledefenseWaveState === 'active' && sim._cdWaveSpawnsRemaining > 0) {
    sim._cdWaveSpawnTimer -= dt;
    // v1.607: SURVIVORS höjt cap (120) så waves kan stacka. Stresstest 1500.
    const _spawnCap = sim.stresstestActive ? 1500 : (sim.survivorsActive ? 120 : ENEMY_CAP);
    if (sim._cdWaveSpawnTimer <= 0 && sim.enemies.length < _spawnCap) {
      const sp = arena.enemySpawns[Math.floor(Math.random() * arena.enemySpawns.length)];
      // v1.416: theme override pool
      const themePool = cdGetThemePool(sim._cdActiveTheme);
      const type = themePool ? themePool[Math.floor(Math.random() * themePool.length)] : cdPickEnemyType(sim.castledefenseWave);
      const e = makeEnemy(type, sp.x, sp.y);
      e._idx = sim.nextEnemyIdx++;
      e._cdEnemy = true;
      cdMaybeAssignFlyer(e);
      // v1.407: scale by difficulty + wave + co-op (samma formel som story-mode)
      // v1.606: SURVIVORS — wave-counter växer snabbt (time-based), så vi
      // skalar via elapsed-time istället för wave-number (+10%/min) så det
      // inte blir orimligt tankigt vid wave 30+.
      const cdWaveScale = sim.survivorsActive && sim.survivorsStartT
        ? (1 + ((Date.now() - sim.survivorsStartT) / 60000) * 0.10)
        : (1 + (sim.castledefenseWave - 1) * 0.08);
      const cdDiff = cdGetDiffMul(sim.config.difficulty);
      // v1.697: Tidigare STRIKT linjär coop-skalning (8p = 8× HP OCH 8× dmg) gjorde
      // höga spelarantal brutala — 8× skada per träff mot oskalad spelar-EHP, samtidigt
      // som svärmen INTE växte. Story-mode kapar medvetet (HP sublinjärt ~6.95× @8p,
      // dmg +15%/spelare = 2.05× @8p). Använd samma kurvor här; svärm-antalet växer
      // istället via cdGetCoopSpawnMul på wave-batch-count (se _cdWaveSpawnsRemaining).
      const _cdMembers = Math.max(1, _realMemberCount(sim));
      const cdCoopHp = cdGetCoopMul(_cdMembers);
      const cdCoopDmg = cdGetCoopDmgMul(_cdMembers);
      // v1.416: theme stat-multiplier (ELITE = +60% hp/dmg/gold)
      const themeStat = cdGetThemeStatMul(sim._cdActiveTheme);
      const themeHpMul = themeStat ? themeStat.hp : 1.0;
      const themeDmgMul = themeStat ? themeStat.dmg : 1.0;
      const themeGoldMul = themeStat ? themeStat.gold : 1.0;
      e.hp = Math.round(e.hp * cdWaveScale * cdDiff.enemyHp * cdCoopHp * themeHpMul);
      e.maxHp = e.hp;
      e.dmg = Math.round(e.dmg * cdWaveScale * cdDiff.enemyDmg * cdCoopDmg * themeDmgMul);
      if (e.bulletDmg) e.bulletDmg = Math.round(e.bulletDmg * cdDiff.enemyDmg * cdCoopDmg * themeDmgMul);
      if (e.gold) e.gold = Math.round(e.gold * themeGoldMul);
      // v1.410: speed-buff för "fast" enemy-typer — gör dem REALA hot. User-feedback
      // "vissa fiender ännu snabbare". runner/ninja/dog/swarmer +35%.
      if (type === 'runner' || type === 'ninja' || type === 'dog' || type === 'swarmer') {
        e.speed = Math.round(e.speed * 1.35);
      } else if (type === 'bomber') {
        e.speed = Math.round(e.speed * 1.15);
      }
      // v1.533: SURVIVORS-RUN late-game spike — efter 60% av matchen, +30% speed
      // och +20% dmg så det inte plateaur vid enemy-cap.
      if (sim.survivorsActive && sim.survivorsStartT) {
        const survElapsed = Date.now() - sim.survivorsStartT;
        const survDur = (sim.survivorsDurationSec || 1200) * 1000;
        if (survElapsed > survDur * 0.6) {
          e.speed = Math.round(e.speed * 1.3);
          e.dmg = Math.round(e.dmg * 1.2);
        }
      }
      e._origSpeed = e.speed;
      // v1.419: 75% siege (attackerar torn/walls) / 25% attacker (jagar player).
      // Var: 50/50. User-feedback "enemies attackerar sällan mina torn".
      e._cdRole = Math.random() < 0.25 ? 'attacker' : 'siege';
      sim.enemies.push(e);
      sim._cdWaveSpawnsRemaining -= 1;
      // v1.411: snabbare spawn-rate. Base 0.7→0.45, floor 0.25→0.12.
      sim._cdWaveSpawnTimer = Math.max(0.12, 0.45 - sim.castledefenseWave * 0.025)
        + Math.random() * 0.15;
    }
  }

  // === BUILDINGS RUNTIME — slot-torn-eld, fällor (spik/tjära/olja) ===
  if (sim.castledefenseBuildings.length > 0) {
    sim._cdCoreHealedThisTick = false; // v1.413: reset per tick — cap multi-repair-stack
    updateCastleDefenseBuildings(sim, dt, nowMs);
  }
  // v2 REDESIGN: slotts-NPC:er (heal-NPC helar spelare, repair-NPC reparerar slottet)
  if (!sim.survivorsActive) updateCastleNpcs(sim, dt, nowMs);

  // v3 perk-träd: passiv auto-regen — MEDIC (med_heal) +2/rank, REGEN (jug_regen) +2/rank
  // CD_AURA_PASS_V1: BRITTLE (cryo_brittle) global slow-amp; reset each tick, max:ed per player below.
  sim._cdSlowAmp = 1;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) continue;
    const f = cdFlags(sim, pid);
    let regenRate = 0;
    if (f.medic) regenRate += 2 * f.medic;
    if (f.regen) regenRate += 2 * f.regen;
    if (regenRate > 0) {
      const maxH = ws.playerState.maxHp || 100;
      if (ws.playerState.hp < maxH) {
        ws.playerState.hp = Math.min(maxH, ws.playerState.hp + regenRate * dt);
      }
    }
    // CD_AURA_PASS_V1: FROST tree - brittle-amp + cryo aura/chill + frost nova (pulsing player).
    if (f.cryo_brittle) sim._cdSlowAmp = Math.max(sim._cdSlowAmp, 1 + 0.15 * f.cryo_brittle);
    const _cx = ws.playerState.x, _cy = ws.playerState.y;
    if ((f.cryo_aura || f.cryo_chill) && sim.enemyGrid && sim.enemyGrid.size > 0) {
      const _ca = f.cryo_aura || 0, _cc = f.cryo_chill || 0;
      const _slowF = 1 - 0.12 * _ca;
      sim.enemyGrid.queryInto(_cx, _cy, 140, _cdAuraScratch);
      for (let _qi = 0; _qi < _cdAuraScratch.length; _qi++) {
        const _en = _cdAuraScratch[_qi];
        if (_en.dead) continue;
        const _dx = _en.x - _cx, _dy = _en.y - _cy;
        if (_dx * _dx + _dy * _dy > 140 * 140) continue;
        if (_ca) {
          _en.slowUntil = nowMs + 200;
          _en.slowFactor = Math.max(0.4, Math.min(_en.slowFactor || 1, _slowF));
        }
        if (_cc) {
          _en.hp -= 8 * _cc * dt;
          _en.lastDamagerPid = pid;
          if (_en.hp <= 0) _en.dead = true;
        }
      }
    }
    if (f.cryo_nova && sim.enemyGrid && sim.enemyGrid.size > 0 && nowMs - (ws._cdNovaAt || 0) > 12000) {
      ws._cdNovaAt = nowMs;
      sim.enemyGrid.queryInto(_cx, _cy, 220, _cdAuraScratch);
      for (let _qi = 0; _qi < _cdAuraScratch.length; _qi++) {
        const _en = _cdAuraScratch[_qi];
        if (_en.dead) continue;
        const _dx = _en.x - _cx, _dy = _en.y - _cy;
        if (_dx * _dx + _dy * _dy > 220 * 220) continue;
        _en.slowUntil = nowMs + 2500;
        _en.slowFactor = 0.15;
        _en.hp -= 30 * f.cryo_nova;
        _en.lastDamagerPid = pid;
        if (_en.hp <= 0) _en.dead = true;
      }
      sim.eventQueue.push({ type: 'cd_frost_nova', peerId: pid, x: _cx, y: _cy, r: 220 });
    }
  }
  // CD_AURA_PASS_V1: MEDAURA - pulsing team-heal to nearby teammates (skip self, cap maxHp).
  for (const [_maPid, _maWs] of sim.room.members) {
    if (!_maWs.playerState || _maWs.playerState.hp <= 0 || _maWs.playerState.cdDowned) continue;
    const _maRank = cdFlags(sim, _maPid).medaura;
    if (!_maRank) continue;
    const _maX = _maWs.playerState.x, _maY = _maWs.playerState.y;
    const _maHeal = 2 * _maRank * dt;
    for (const [_tgPid, _tgWs] of sim.room.members) {
      if (_tgPid === _maPid) continue;
      const _tp = _tgWs.playerState;
      if (!_tp || _tp.hp <= 0 || _tp.cdDowned) continue;
      const _ddx = _tp.x - _maX, _ddy = _tp.y - _maY;
      if (_ddx * _ddx + _ddy * _ddy > 200 * 200) continue;
      const _tMax = _tp.maxHp || 100;
      if (_tp.hp < _tMax) _tp.hp = Math.min(_tMax, _tp.hp + _maHeal);
    }
  }

  // === DOWN-STATE + REVIVE (fas 6) ===
  updateCastleDefenseDownState(sim, dt, nowMs);

  // === ENEMY AI + COLLISION + ATTACK ===
  // v1.401: Fienderna delas i två roller:
  //  - 'siege' (50%): targetar närmaste player-built solid building → core
  //  - 'attacker' (50%): targetar närmaste LEVANDE player → core
  //  Flyers + bossar går alltid rakt mot core (för dramatik).
  const corePos = sim.castledefenseCore;
  // Pre-compute lista av solida buildings (samma filter som collision)
  const cdSolidsForTarget = cdLiveBuildings.filter(b =>
    b.kind !== 'spike_trap' && b.kind !== 'slow_trap');
  // Pre-compute alive players (real, not bots — bots are members too)
  // C110 (audit 2026-06-18): beräkna varje spelares onSolid (står PÅ mur/byggnad → immun
  // mot melee) EN gång här i st.f. per enemy (var O(E×P×Solids), ~38k AABB-test/tick worst
  // case). Bär även ws-ref så melee-kontakten slipper reverse-lookup. onSolid beror bara
  // på spelarens position (oförändrad under enemy-loopen).
  const cdAlivePlayers = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (ws.playerState.cdDowned) continue; // downed räknas inte som mål
    const psX = ws.playerState.x, psY = ws.playerState.y;
    let onSolid = false;
    for (const sB of cdAllSolids) {
      if (sB.hp <= 0) continue;
      if (psX >= sB.x && psX <= sB.x + sB.w &&
          psY >= sB.y && psY <= sB.y + sB.h) { onSolid = true; break; }
    }
    // C225 (perf 2026-07-07): stash på playerState så bullets.js kan slå upp onSolid
    // i O(1) per spelare istf O(walls+buildings) per hostile-bullet × spelare.
    ws.playerState._cdOnSolid = onSolid;
    cdAlivePlayers.push({ peerId: pid, x: psX, y: psY, _ws: ws, _onSolid: onSolid });
  }
  for (const e of sim.enemies) {
    if (e.dead) continue;
    // v2 R10b (additivt): showcase-frusna enheter — ingen AI, ingen attack, ingen
    // rörelse. Flaggan sätts bara av applyStresstestShowcase → V1-vägar opåverkade.
    if (e._showcaseFrozen) continue;
    let target;
    // v1.411: Ranged enemies (shooter/soldier/sniper) ALLTID siege-role — skjuter
    // mot torn istället för att jaga players. Annars stannar de aldrig vid turrets.
    const isRangedType = (e.type === 'shooter' || e.type === 'soldier' || e.type === 'sniper');
    // v1.605: SURVIVORS-RUN — enemies målar NÄRMASTE player (Vampire Survivors-stil).
    // Tidigare målade alla core (centern) vilket gjorde att spelaren kunde stå
    // i utkanten och bara skjuta — ingen press. Nu chasear de DIG.
    // Fallback till core om inga players levande (mellan respawns).
    if (sim.survivorsActive) {
      let bestPlayer = null, bestPD2 = Infinity;
      for (const p of cdAlivePlayers) {
        const dx = p.x - e.x, dy = p.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestPD2) { bestPD2 = d2; bestPlayer = p; }
      }
      if (bestPlayer) {
        const newTargetId = '__player_' + bestPlayer.peerId;
        if (e._cdLastTargetId && e._cdLastTargetId !== newTargetId) {
          e.aiming = false; e.aimAt = 0;
        }
        e._cdLastTargetId = newTargetId;
        target = {
          peerId: newTargetId, _isCoreTarget: false,
          x: bestPlayer.x, y: bestPlayer.y,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14,
        };
      } else {
        target = corePos ? {
          peerId: '__core__', _isCoreTarget: true,
          x: corePos.x, y: corePos.y,
          hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60,
        } : { x: 2000, y: 2000, hp: 99999, r: 60, peerId: '__core__', invulnUntil: 0 };
      }
    } else if (e._cdFlyer || e.isBoss) {
      // Flyers + bossar: rakt mot core
      target = corePos ? {
        peerId: '__core__', _isCoreTarget: true,
        x: corePos.x, y: corePos.y,
        hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60,
      } : { x: 2000, y: 2000, hp: 99999, r: 60, peerId: '__core__', invulnUntil: 0 };
    } else {
      // CD-RANGED-TOWER-PRIORITY (tillagt): ranged-fiender (shooter/soldier/sniper) skjuter
      // NARMASTE levande machinegun/bomber-torn forst; faller tillbaka pa flow/core nedan
      // (if(!target)-blocket) nar inget torn ar i sikte. Melee opaverkade (isRangedType=false).
      if (isRangedType) {
        const sightR = (e.shootRange || 360) + 220;
        let bestTD2 = sightR * sightR, bestTower = null;
        for (let ti = 0; ti < cdSolidsForTarget.length; ti++) {
          const _tb = cdSolidsForTarget[ti];
          if (_tb.hp <= 0 || (_tb.kind !== 'machinegun' && _tb.kind !== 'bomber')) continue;
          const bcx = _tb.x + _tb.w / 2, bcy = _tb.y + _tb.h / 2;
          const tdx = bcx - e.x, tdy = bcy - e.y;
          const td2 = tdx * tdx + tdy * tdy;
          if (td2 < bestTD2) { bestTD2 = td2; bestTower = _tb; }
        }
        if (bestTower) {
          const _ttid = '__tower_' + bestTower.id;
          if (e._cdLastTargetId !== _ttid) { e.aiming = false; e.aimAt = 0; }
          e._cdLastTargetId = _ttid;
          target = { peerId: _ttid, _isCoreTarget: false, x: bestTower.x + bestTower.w / 2, y: bestTower.y + bestTower.h / 2, hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14 };
        }
      }
      if (!target) {
      // v2 REDESIGN: MARK-fiender följer FLOW-FÄLTET mot slotts-kärnan (core) MEN
      // aggrar en NÄRLIGGANDE sårbar spelare (positionering spelar roll → man kan dö).
      // Core förblir det egentliga målet; aggro har en leash mot kiting.
      let aggroP = null;
      if (!isRangedType) {
        if (e._cdAggroLeash > 0) {
          e._cdAggroLeash -= dt;   // nyss avhängd (kiting-skydd) → ignorera aggro en stund
        } else {
          let aggroD2 = 240 * 240;   // engage-radie ~240px
          for (let pi = 0; pi < cdAlivePlayers.length; pi++) {
            const ap = cdAlivePlayers[pi];
            if (ap._onSolid) continue;   // spelare PÅ mur = cover → lämnas ifred
            const adx = ap.x - e.x, ady = ap.y - e.y;
            const ad2 = adx * adx + ady * ady;
            if (ad2 < aggroD2) { aggroD2 = ad2; aggroP = ap; }
          }
          if (aggroP) {
            e._cdAggroTime = (e._cdAggroTime || 0) + dt;
            if (e._cdAggroTime > 3.5) { aggroP = null; e._cdAggroTime = 0; e._cdAggroLeash = 2.0; }
          } else { e._cdAggroTime = 0; }
        }
      }
      if (aggroP) {
        const _ntid = '__player_' + aggroP.peerId;
        if (e._cdLastTargetId !== _ntid) { e.aiming = false; e.aimAt = 0; }
        e._cdLastTargetId = _ntid;
        target = { peerId: _ntid, _isCoreTarget: false, x: aggroP.x, y: aggroP.y, hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14 };
      } else {
        // Kort, gradient-utjämnat flöde-steg (45px) → hugger gate-svängen och klipper
        // INTE slottsvägg-hörnet (gamla 200px-beelinen fastnade mot castle-muren).
        const _flow = cdFlowLookup(sim._cdFlowField, e.x, e.y);
        if (_flow && (_flow.dx !== 0 || _flow.dy !== 0)) {
          const _flen = Math.hypot(_flow.dx, _flow.dy) || 1;
          let sx = _flow.dx / _flen, sy = _flow.dy / _flen;
          const _f2 = cdFlowLookup(sim._cdFlowField, e.x + sx * 60, e.y + sy * 60);
          if (_f2 && (_f2.dx || _f2.dy)) { const l2 = Math.hypot(_f2.dx, _f2.dy) || 1; sx += _f2.dx / l2; sy += _f2.dy / l2; const ll = Math.hypot(sx, sy) || 1; sx /= ll; sy /= ll; }
          if (e._cdLastTargetId !== '__flow__') { e.aiming = false; e.aimAt = 0; }
          e._cdLastTargetId = '__flow__';
          target = { peerId: '__flow__', _isCoreTarget: true, x: e.x + sx * 45, y: e.y + sy * 45, hp: 99999, maxHp: 99999, invulnUntil: 0, r: 14 };
        } else {
          if (e._cdLastTargetId !== '__core__') { e.aiming = false; e.aimAt = 0; }
          e._cdLastTargetId = '__core__';
          target = corePos ? { peerId: '__core__', _isCoreTarget: true, x: corePos.x, y: corePos.y, hp: 99999, maxHp: 99999, invulnUntil: 0, r: corePos.r || 60 } : { x: 2000, y: 600, hp: 99999, r: 60, peerId: '__core__', invulnUntil: 0 };
        }
      }
      }
    }
    const players = [target];
    if (e.isBoss) {
      updateBoss(sim, e, dt, now, players);
    } else {
      updateEnemy(e, dt, now, sim, players);
    }
    // v1.400: Melee contact-damage på REAL players (eftersom AI targetar fake-building,
    // skulle riktiga spelare annars vara osårbara från melee). Skadar player om
    // enemy överlappar dem + cooldown + respect invuln + cdDowned.
    if (!e._cdFlyer && (e.dmg || 0) > 0) {
      if (e._cdPlayerContactCd > 0) e._cdPlayerContactCd -= dt;
      else e._cdPlayerContactCd = 0;
      if (e._cdPlayerContactCd <= 0) {
        // C110: iterera den för-byggda alive-player-listan (onSolid + ws redan beräknade)
        // → O(E×P) avstånd med O(1) onSolid-lookup, ingen reverse-lookup.
        for (let pi = 0; pi < cdAlivePlayers.length; pi++) {
          const ap = cdAlivePlayers[pi];
          const wsP = ap._ws;
          const psP = wsP.playerState;
          if (!psP || psP.hp <= 0 || psP.cdDowned) continue; // kan ha downats mid-loop
          if (Date.now() < (psP.invulnUntil || 0)) continue;
          // v1.422: Player står PÅ solid byggnad/mur (AABB) → immune mot melee.
          // Walls ÄR cover — du ska kunna repair/upgrade utan att kontakt-killas.
          if (ap._onSolid) continue;
          const ddx = psP.x - e.x, ddy = psP.y - e.y;
          const rsumP = (e.r || 12) + 14;
          if (ddx * ddx + ddy * ddy < rsumP * rsumP) {
            // v1.403: shield absorberar först
            let remaining = e.dmg;
            if ((psP.shield || 0) > 0) {
              const absorb = Math.min(psP.shield, remaining);
              psP.shield -= absorb;
              remaining -= absorb;
            }
            if (remaining > 0) psP.hp = Math.max(0, psP.hp - remaining);
            // CD-THORNS-REFLECT: thorns talent reflects contact damage onto the enemy (server-authoritative)
            const _thRank = cdFlags(sim, ap.peerId).thorns;
            if (_thRank) { e.hp -= 30 * _thRank; e.lastDamagerPid = ap.peerId; e.lastDamagerWeapon = 'thorns'; if (e.hp <= 0) e.dead = true; }
            psP.invulnUntil = Date.now() + 500;
            e._cdPlayerContactCd = 0.7;
            e._attackFxUntil = Date.now() + 220;   // attack-anim-telegraf
            e._cdAggroTime = 0;   // landar träffar → behåll aggro (leasha ej bort en nåbar spelare)
            // v1.404: broadcast hp+shield-ändring så klient ser shield-droppen.
            // C110: peerId finns redan på alive-player-recorden (ingen reverse-lookup).
            sim.eventQueue.push({
              type: 'cd_hp_changed', peerId: ap.peerId,
              hp: psP.hp, shield: psP.shield || 0,
            });
            break;
          }
        }
      }
    }
    // v2: SOFT PLAYER-SEPARATION (CD/survivors) — melee-fiende stannar vid spelarens kant
    // (e.r+14) ist.f. att ga in i kroppen. Efter contact-blocket (skada redan applicerad pa
    // overlappet -> touch-skada intakt). Bara dmg>0 (melee), hoppar onSolid (cover). Yielder
    // till wall/core-kollisionen nedan -> kan ej knuffas genom mur.
    if (!e._cdFlyer && (e.dmg || 0) > 0) {
      for (let pi = 0; pi < cdAlivePlayers.length; pi++) {
        const ap = cdAlivePlayers[pi];
        if (ap._onSolid) continue;
        const sdx = e.x - ap.x, sdy = e.y - ap.y;
        const smin = (e.r || 12) + 14;
        const sd2 = sdx * sdx + sdy * sdy;
        if (sd2 > 1e-6 && sd2 < smin * smin) {
          const sd = Math.sqrt(sd2);
          const sp = Math.min(smin - sd, 10);
          e.x += (sdx / sd) * sp;
          e.y += (sdy / sd) * sp;
        } else if (sd2 <= 1e-6) {
          e.x = ap.x + smin;
        }
      }
    }
    // Bounds-clamp
    e.x = Math.max(20, Math.min(arena.worldW - 20, e.x));
    e.y = Math.max(20, Math.min(arena.worldH - 20, e.y));
    // Wall-collision för enemies (skippa flyers — de ignorerar walls).
    // v2 REDESIGN: fiender blockas även av de solida slottsväggarna (cdMoveSolids) så
    // de bara kan ta sig in genom porten. Survivors behåller bara fält-strukturer.
    // C225: wallsInRect-broadphase per pass (margin=eR+80 ger SUPERSET av overlappande väggar).
    // Fallback till full lista om grid saknas (första tick eller under init).
    if (!e._cdFlyer) {
      const _grid = sim.survivorsActive ? sim._cdAllSolidsGrid : sim._cdMoveSolidsGrid;
      const _fallback = sim.survivorsActive ? cdAllSolids : cdMoveSolids;
      const _eMargin = (e.r || 12) + 80;
      for (let _p = 0; _p < 3; _p++) {
        const _near = _grid
          ? wallsInRect(_grid, e.x - _eMargin, e.y - _eMargin, e.x + _eMargin, e.y + _eMargin)
          : _fallback;
        resolveCtfWall(e, _near);
      }
    }
    // Core circle-collision för ALLA fiender (även flyers — annars kan de attacka
    // core från insidan). v1.398-fix: d=0 fallback för enemy också.
    // v1.547: I stress-test + survivors är core bara dekoration — disable enemy-collision
    if (sim.castledefenseCore && sim.castledefenseCore.hp > 0 && !sim.survivorsActive && !sim.stresstestActive) {
      const core = sim.castledefenseCore;
      const cc = core.chairColl;
      if (cc) {                         // FYRKANT-kollision = bara tron-stolen
        const er = e.r || 14;
        if (e.x + er > cc.x && e.x - er < cc.x + cc.w && e.y + er > cc.y && e.y - er < cc.y + cc.h) {
          const dxL = (e.x + er) - cc.x, dxR = (cc.x + cc.w) - (e.x - er);
          const dyT = (e.y + er) - cc.y, dyB = (cc.y + cc.h) - (e.y - er);
          const m = Math.min(dxL, dxR, dyT, dyB);
          if (m === dxL) e.x -= dxL; else if (m === dxR) e.x += dxR;
          else if (m === dyT) e.y -= dyT; else e.y += dyB;
        }
      } else {
      const dxe = e.x - core.x, dye = e.y - core.y;
      const de = Math.sqrt(dxe * dxe + dye * dye);
      const minDe = core.r + e.r;
      if (de < minDe && de > 0.01) {
        e.x = core.x + (dxe / de) * minDe;
        e.y = core.y + (dye / de) * minDe;
      } else if (de <= 0.01) {
        // Exakt på center — pusha åt höger
        e.x = core.x + minDe;
      }
      }
    }
    // Attack-timer
    if (e._cdAttackCd > 0) e._cdAttackCd -= dt;
    else e._cdAttackCd = 0;
    // === ENEMY ATTACK PÅ WALL/CORE ===
    // v1.400 fix: skippa redan-döda targets (mid-tick destruction från attack-loop
    // skulle annars trigga dubbel destroy-event)
    // C109 (audit 2026-06-18): EN scan över cdAllSolids istället för två (Pass 1 wall/
    // turret, Pass 2 station). Spara första wall/turret-träffen OCH första station-träffen,
    // välj wall>station efter loopen → halverar scannen, noll beteendeändring (samma
    // wall-före-station-prioritet, samma "första i listan"-tie-break per kategori).
    // C225: wallsInRect-broadphase på cdAllSolidsGrid (enemies angriper bara väggar de
    // berör fysiskt, e.r+1 = kontakt-radie). Fallback om grid saknas.
    let attackTarget = null;
    let attackStation = null;
    const _cr2 = (e.r + 1) * (e.r + 1);
    const _am = e.r + 1;
    const _atkCands = sim._cdAllSolidsGrid
      ? wallsInRect(sim._cdAllSolidsGrid, e.x - _am, e.y - _am, e.x + _am, e.y + _am)
      : cdAllSolids;
    for (const w of _atkCands) {
      if (w.hp <= 0) continue;
      const cx2 = Math.max(w.x, Math.min(e.x, w.x + w.w));
      const cy2 = Math.max(w.y, Math.min(e.y, w.y + w.h));
      const dx2 = e.x - cx2, dy2 = e.y - cy2;
      if (dx2 * dx2 + dy2 * dy2 >= _cr2) continue;
      const isWallOrTurret = (w.kind === 'wall' || w.kind === 'castle_wall' || w.kind === 'auto_turret' || w.kind === 'man_turret');
      if (isWallOrTurret) { attackTarget = w; break; } // prioriterat → klart
      if (!attackStation) attackStation = w; // första station-träffen (om inget mur/turret hittas)
    }
    if (!attackTarget) attackTarget = attackStation;
    // Eller core om i kontakt (om enemy lyckats nå inre)
    if (!attackTarget && sim.castledefenseCore && sim.castledefenseCore.hp > 0) {
      const core = sim.castledefenseCore;
      const dx3 = e.x - core.x, dy3 = e.y - core.y;
      const minD = e.r + core.r + 2;
      if (dx3 * dx3 + dy3 * dy3 < minD * minD) {
        attackTarget = core;
      }
    }
    if (attackTarget && e._cdAttackCd <= 0) {
      const isCore = (attackTarget === sim.castledefenseCore);
      // Robust kind-check: walls har kind='castle_wall', byggnader har kind matching buildable-key
      const isBuild = !isCore && attackTarget.kind && attackTarget.kind !== 'castle_wall';
      // Damage per attack (grunt=5 baseline)
      let dmg = e.dmg || 5;
      if (e.isBoss && isCore) dmg = Math.min(dmg, 90);   // bossar kan ej smalta core direkt (cap ~112 core-DPS)
      attackTarget.hp = Math.max(0, attackTarget.hp - dmg);
      e._cdAttackCd = 0.8; // attack-cooldown
      e._attackFxUntil = now + 220;   // attack-anim-telegraf (klient fx-bit 256)
      sim.eventQueue.push({
        type: isCore ? 'cd_core_damaged' : (isBuild ? 'cd_building_damaged' : 'cd_wall_damaged'),
        id: isCore ? 'core' : attackTarget.id,
        hp: attackTarget.hp,
        maxHp: attackTarget.maxHp,
      });
      if (attackTarget.hp <= 0) {
        // Solid building/wall förstörd → flow field måste recomputeras
        if (!isCore && (!attackTarget.kind || (attackTarget.kind !== 'spike_trap' && attackTarget.kind !== 'slow_trap'))) {
          sim._cdFlowDirty = true;
        }
        // v2 REDESIGN: om ett SLOT-TORN förstörs medan någon sitter i det → sparka av
        // (annars fryser deras rörelse-input via _mountedCdTowerId). + frigör slotten.
        if (!isCore) {
          // FRIGOR slotten ALLTID (aven obemannat torn) -> annars stale slot.towerId = slot_taken for evigt
          if (attackTarget.slotId && sim.castledefenseSlots) {
            const _sl = sim.castledefenseSlots.find(s => s.id === attackTarget.slotId);
            if (_sl && _sl.towerId === attackTarget.id) _sl.towerId = null;
          }
          if (attackTarget.occupantId) {
            const occWs = sim.room.members.get(attackTarget.occupantId);
            if (occWs && occWs._mountedCdTowerId === attackTarget.id) occWs._mountedCdTowerId = null;
            attackTarget.occupantId = null;
          }
        }
        sim.eventQueue.push({
          type: isCore ? 'cd_core_destroyed' : (isBuild ? 'cd_building_destroyed' : 'cd_wall_destroyed'),
          id: isCore ? 'core' : attackTarget.id,
        });
      }
    }
  }

  // Spatial grid (för bullet-collision)
  sim.enemyGrid.clear();
  for (const e of sim.enemies) {
    if (!e.dead) sim.enemyGrid.insert(e);
  }

  // v1.398: Fienderna targetar fake-core, ej real players. Ingen player-writeback
  // behövs (fake-core hp är dummy). Behåll deadBodies-init för andra systems.
  if (!sim.deadBodies) sim.deadBodies = {};

  // === BULLETS ===
  updateBullets(sim, dt, now);

  // === HAZARDS (gas clouds, flame trails) — för bossar med gas_sniper/avatar powers ===
  if ((sim.gasClouds && sim.gasClouds.length) || (sim.flameTrails && sim.flameTrails.length)) {
    // Bygg lista av riktiga spelare för hazard-skada (gas/eld måste kunna skada players)
    const realPlayers = buildPlayerList(sim);
    updateHazards(sim, dt, now, realPlayers);
    // Writeback från hazard-damage
    for (const p of realPlayers) {
      if (p._tookDamageFrom) {
        const ws = sim.room.members.get(p.peerId);
        if (ws && ws.playerState) {
          ws.playerState.hp = p.hp;
          ws.playerState.invulnUntil = p.invulnUntil;
        }
      }
    }
  }

  // === CORE HP-CHECK (game over) ===
  // v1.526: Skippas helt i survivors-mode (ingen core att förstöra).
  if (!sim.survivorsActive && sim.castledefenseCore && sim.castledefenseCore.hp <= 0 && !sim.castledefenseEnded) {
    sim.castledefenseEnded = true;
    const cdSb = []; // buildCdScoreboard
    for (const [pid] of sim.room.members) {
      cdSb.push({ peerId: pid, kills: (sim.castledefenseScores && sim.castledefenseScores[pid]) || 0, secured: (sim.castledefenseGold && sim.castledefenseGold[pid]) || 0 });
    }
    sim.eventQueue.push({
      type: 'cd_ended',
      reason: 'core_destroyed',
      wave: sim.castledefenseWave,
      survivedSec: Math.round((nowMs - sim.castledefenseStartedAt) / 1000),
      scoreboard: cdSb,
    });
    return;
  }

  // === ALLA-SPELARE-NERE-CHECK (game over) ===
  // Om alla RIKTIGA spelare är nere/döda finns ingen att återuppliva och slottet är
  // oförsvarat → nederlag. Utan detta: solo-död = "spring runt 0hp utan defeat", och på
  // boss-vågor SOFTLOCK (vågen kan ej avancera medan bossen lever → ingen respawn).
  if (sim.castledefenseActive && !sim.survivorsActive && !sim.castledefenseEnded) {
    let anyUp = false, anyHuman = false;
    for (const [, ws] of sim.room.members) {
      if (ws._isBot || !ws.playerState) continue;
      anyHuman = true;
      const ps = ws.playerState;
      if (ps.hp > 0 && !ps.cdDowned && !ps.cdDownDead) { anyUp = true; break; }
    }
    if (anyHuman && !anyUp) {
      sim.castledefenseEnded = true;
      const cdSb = [];
      for (const [pid] of sim.room.members) {
        cdSb.push({ peerId: pid, kills: (sim.castledefenseScores && sim.castledefenseScores[pid]) || 0, secured: (sim.castledefenseGold && sim.castledefenseGold[pid]) || 0 });
      }
      sim.eventQueue.push({
        type: 'cd_ended',
        reason: 'all_players_down',
        wave: sim.castledefenseWave,
        survivedSec: Math.round((nowMs - sim.castledefenseStartedAt) / 1000),
        scoreboard: cdSb,
      });
      return;
    }
  }

  // v2 R10b (additivt): SHOWROOM — frusna enheter är odödliga-ish: de tar skada
  // (hit-flash + hp-bar funkar) men "död" återställs till full hp INNAN death-
  // drop-blocket nedan (inga kill-events/drops), positionen pinnas på grid-platsen
  // (knockback/explosioner flyttar dem inte) och status-effekter släcks.
  // _showcaseActive sätts bara av applyStresstestShowcase → V1 helt opåverkad.
  if (sim._showcaseActive) {
    for (const e of sim.enemies) {
      if (!e._showcaseFrozen) continue;
      if (e.dead || e.hp <= 0) { e.hp = e.maxHp; e.dead = false; }
      e.x = e._showcaseX; e.y = e._showcaseY;
      e.burnUntil = 0; e.slowUntil = 0; e.staggerUntil = 0;
    }
  }

  // === ENEMY DEATH DROP-EVENTS ===
  if (sim.enemies.some(e => e.dead)) {
    for (const e of sim.enemies) {
      if (!e.dead) continue;
      // Drop pickup — bara SURVIVORS droppar hp/shield-mark-pickups; CD ger guld via
      // cd_gold_update-events (inga mark-droppar, pa anvandarens begaran).
      if (sim.survivorsActive) dropFromEnemyDeath(sim, e);
      // v1.401: Boss-kill = weapon upgrade för ALLA levande spelare
      // v1.526: Hoppa över i survivors-mode (perk-progression sker via perk-val,
      // inte boss-kills). Iteration 3 implementerar perk-selection.
      if (e.isBoss && !sim.survivorsActive) {
        sim.bossAlive = false;
        const progression = arena.weaponProgression || ['pistol'];
        for (const [pid, ws] of sim.room.members) {
          if (!ws.playerState) continue;
          if (ws._isBot) continue;          // bots skippas — egen AI hanterar inte uppgraderade vapen
          const oldTier = sim.castledefenseWeaponTier[pid] || 0;
          const newTier = Math.min(progression.length - 1, oldTier + 1);
          if (newTier !== oldTier) {
            sim.castledefenseWeaponTier[pid] = newTier;
            const newWeapon = progression[newTier];
            ws.playerState.weaponId = newWeapon;
            sim.eventQueue.push({
              type: 'cd_weapon_upgraded',
              peerId: pid,
              tier: newTier,
              weaponId: newWeapon,
              maxed: newTier === progression.length - 1,
            });
          } else if (oldTier === progression.length - 1) {
            // Redan på max — emit "maxed"-event så client kan visa feedback
            sim.eventQueue.push({
              type: 'cd_weapon_upgraded',
              peerId: pid,
              tier: oldTier,
              weaponId: progression[oldTier],
              maxed: true,
              noChange: true,
            });
          }
        }
      }
      sim.eventQueue.push({
        type: 'enemy_killed',
        i: e._idx,
        gold: e.gold || 0,
        killerPid: e.lastDamagerPid || null,
        weaponId: e.lastDamagerWeapon || null,   // v2 E6 (additivt — V1 ignorerar)
        isBoss: !!e.isBoss,
        isMiniBoss: !!e.isMiniBoss,
        // v1.608: skicka pos för klient-side death-flash + kill-explode-perk
        x: e.x, y: e.y,
      });
      // Score + per-match gold-grant
      if (e.lastDamagerPid) {
        sim.castledefenseScores[e.lastDamagerPid] = (sim.castledefenseScores[e.lastDamagerPid] || 0) + 1;
        // v3 perk-träd: PLUNDRARE (for_loot) +40%/rank gold, HASARDÖR (for_jack) 15% kill-bonus
        const killerFlags = cdFlags(sim, e.lastDamagerPid);
        // CD_AURA_PASS_V1: FRENZY (frenzy) kill-stacks -> temp buff (read in applyShoot via _cdRushUntil).
        if (killerFlags.frenzy) {
          const _fws = sim.room.members.get(e.lastDamagerPid);
          const p2 = _fws && _fws.playerState;
          if (p2) {
            if (now > (p2._cdRushUntil || 0)) p2._cdRushStacks = 0;
            p2._cdRushStacks = Math.min(5, (p2._cdRushStacks || 0) + 1);
            p2._cdRushUntil = now + 3000;
          }
        }
        // v1.607: SURVIVORS får gold från kills igen (för shop). Drops förblir bara
        // hp/shield visuellt — gold delas direkt till killer/team utan pickup-icon.
        let goldGain = e.gold || 0;
        if (killerFlags.looter) goldGain = Math.round(goldGain * (1 + 0.40 * killerFlags.looter));
        if (killerFlags.gambler && Math.random() < 0.10 * killerFlags.gambler) {
          const r = Math.random();
          if (r < 0.34) {
            goldGain *= 3;
            sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'gold' });
          } else if (r < 0.67) {
            sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'grenade' });
          } else {
            const lwsk = sim.room.members.get(e.lastDamagerPid);
            if (lwsk && lwsk.playerState) {
              lwsk.playerState.shield = lwsk.playerState.maxShield || 100;
              sim.eventQueue.push({ type: 'cd_hp_changed', peerId: e.lastDamagerPid, hp: lwsk.playerState.hp, shield: lwsk.playerState.shield });
              sim.eventQueue.push({ type: 'cd_gambler_reward', peerId: e.lastDamagerPid, kind: 'shield' });
            }
          }
        }
        if (goldGain > 0) {
          // Boss-gold splittas mellan ALLA levande spelare (annars ger 500-3000g till 1 spelare = swingar ekonomi).
          // Vanliga enemies: bara killer får gold.
          if (e.isBoss) {
            const alivePids = [];
            for (const [pid, ws] of sim.room.members) {
              if (ws.playerState && ws.playerState.hp > 0) alivePids.push(pid);
            }
            const share = Math.round((alivePids.length > 0 ? Math.floor(goldGain / alivePids.length) : goldGain) * (sim.config.goldMul || 1));
            for (const pid of alivePids) {
              const _pws = sim.room.members.get(pid);
              const _pgm = (_pws && _pws.playerState && _pws.playerState.perks && _pws.playerState.perks.goldMul) || 1;
              sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + Math.round(share * _pgm);
              sim.eventQueue.push({
                type: 'cd_gold_update', peerId: pid, gold: sim.castledefenseGold[pid], delta: share,
              });
            }
          } else if (sim.survivorsActive) {
            // v1.533: SURVIVORS-RUN — vanlig kill splittas också mellan alla levande
            // (skillnad mot CD där bara killer får gold). Coop-spec från playtest-audit.
            const survAlive = [];
            for (const [pid, ws] of sim.room.members) {
              if (ws.playerState && ws.playerState.hp > 0) survAlive.push(pid);
            }
            const survShare = Math.round((survAlive.length > 0 ? Math.floor(goldGain / survAlive.length) : goldGain) * (sim.config.goldMul || 1));
            for (const pid of survAlive) {
              sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + survShare;
              sim.eventQueue.push({
                type: 'cd_gold_update', peerId: pid, gold: sim.castledefenseGold[pid], delta: survShare,
              });
            }
          } else {
            sim.castledefenseGold[e.lastDamagerPid] = (sim.castledefenseGold[e.lastDamagerPid] || 0) + goldGain;
            sim.eventQueue.push({
              type: 'cd_gold_update', peerId: e.lastDamagerPid, gold: sim.castledefenseGold[e.lastDamagerPid], delta: goldGain,
            });
            // CD_AURA_PASS_V1: WARCHEST (cap_warchest) -> killer shares 12.5%/rank gold to each OTHER living teammate.
            if (killerFlags.cap_warchest) {
              const _wcShare = Math.round(goldGain * 0.125 * killerFlags.cap_warchest);
              if (_wcShare > 0) {
                for (const [_wcPid, _wcWs] of sim.room.members) {
                  if (_wcPid === e.lastDamagerPid) continue;
                  if (!_wcWs.playerState || _wcWs.playerState.hp <= 0) continue;
                  sim.castledefenseGold[_wcPid] = (sim.castledefenseGold[_wcPid] || 0) + _wcShare;
                  sim.eventQueue.push({
                    type: 'cd_gold_update', peerId: _wcPid, gold: sim.castledefenseGold[_wcPid], delta: _wcShare,
                  });
                }
              }
            }
          }
        }
      }
    }
    sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // === PICKUPS-UPDATE (gold/HP/ammo) ===
  updatePickups(sim, dt, now);

  // === WAVE COMPLETE? ===
  // v1.606: SURVIVORS skippar wave-complete — vågorna är time-based och stackar.
  // Ingen "between"-fas. Ingen gold-bonus heller (survivors har inget gold).
  // Klart när FÄLTET är rensat (snabb väg) ELLER när tidsgränsen passerats (överlapp:
  // nästa våg får starta trots kvarvarande fiender). ALDRIG förbi en levande boss.
  if (!sim.survivorsActive &&
      sim.castledefenseWaveState === 'active' &&
      sim._cdWaveSpawnsRemaining <= 0 &&
      (sim.enemies.length === 0 || nowMs >= (sim._cdWaveActiveDeadline || 0)) &&
      !sim.bossAlive) {
    sim.castledefenseWaveState = 'between';
    sim.castledefenseWaveBetweenEndAt = nowMs + arena.waveBetweenSec * 1000;
    const nextWave = sim.castledefenseWave + 1;
    const nextIsBoss = nextWave % arena.bossEveryWave === 0;
    const nextTheme = cdGetWaveTheme(nextWave, arena);
    const themePool = cdGetThemePool(nextTheme);
    const nextPool = themePool || cdGetWavePool(nextWave);
    const baseCount = cdEnemiesForWave(arena, nextWave);
    const nextCount = nextIsBoss ? (3 + Math.floor(nextWave / 5) + 1) : Math.round(baseCount * cdGetThemeCountMul(nextTheme));
    const nextBossKey = nextIsBoss ? cdPickBossKey(nextWave) : null;
    sim.eventQueue.push({
      type: 'cd_wave_complete',
      wave: sim.castledefenseWave,
      nextWaveInSec: arena.waveBetweenSec,
      nextIsBoss, nextWave, nextPool, nextCount, nextBossKey,
      nextTheme, nextThemeLabel: cdGetThemeLabel(nextTheme),
    });
    // Wave-clear gold-bonus + grenades + shield-regen så player är redo för nästa våg
    const bonus = Math.round(((arena.waveBonusBase || 150) + sim.castledefenseWave * (arena.waveBonusPerWave || 30)) * (sim.config.goldMul || 1));
    const grenadeGrant = arena.grenadesPerWave || 2;
    const shieldRegen = arena.shieldRegenPerWave || 50;
    for (const [pid, ws] of sim.room.members) {
      sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + bonus;
      // v1.403: shield regen
      if (ws.playerState) {
        const max = ws.playerState.maxShield || arena.maxShield || 100;
        ws.playerState.shield = Math.min(max, (ws.playerState.shield || 0) + shieldRegen);
      }
      sim.eventQueue.push({
        type: 'cd_wave_bonus',
        peerId: pid,
        gold: bonus,
        totalGold: sim.castledefenseGold[pid],
        grenades: grenadeGrant,
        shieldRegen,
        shield: ws.playerState ? ws.playerState.shield : 0,
        wave: sim.castledefenseWave,
      });
    }
    // v3 perk-träd: 1 perk-poäng VARANNAN clearad våg (var 2:a) → broadcast cd_perk_tree.
    const everyN = arena.perkPointEveryWaves || 2;
    if (sim.castledefenseWave % everyN === 0) {
      sim.castledefensePerkPoints = sim.castledefensePerkPoints || {};
      for (const [pid] of sim.room.members) {
        sim.castledefensePerkPoints[pid] = (sim.castledefensePerkPoints[pid] || 0) + 1;
        const ranks = (sim.castledefensePerkRanks && sim.castledefensePerkRanks[pid]) || {};
        sim.eventQueue.push({ type: 'cd_perk_tree', peerId: pid, ranks: { ...ranks }, points: sim.castledefensePerkPoints[pid] });
      }
    }
    // v3 perk-träd: HASARDÖR (for_jack/gambler) → +250 guld vid varje våg-clear.
    for (const [pid] of sim.room.members) {
      const _gjGambler = cdFlags(sim, pid).gambler; // CD_AURA_PASS_V1: gambler wave gold scales with rank.
      if (_gjGambler) {
        const _gjGold = 150 * _gjGambler;
        sim.castledefenseGold[pid] = (sim.castledefenseGold[pid] || 0) + _gjGold;
        sim.eventQueue.push({ type: 'cd_gold_update', peerId: pid, gold: sim.castledefenseGold[pid], delta: _gjGold });
      }
    }
  }

  // === HEARTBEAT BROADCAST FÖR HUD (varje 500ms) ===
  if (nowMs - (sim._cdHudBroadcastAt || 0) > 500) {
    sim._cdHudBroadcastAt = nowMs;
    sim.eventQueue.push({
      type: 'cd_hud_update',
      wave: sim.castledefenseWave,
      waveState: sim.castledefenseWaveState,
      enemiesAlive: sim.enemies.length,
      enemiesIncoming: sim._cdWaveSpawnsRemaining,
      coreHp: sim.castledefenseCore ? sim.castledefenseCore.hp : 0,
      coreMaxHp: sim.castledefenseCore ? sim.castledefenseCore.maxHp : 0,
      waveBetweenEndAt: sim.castledefenseWaveBetweenEndAt,
    });
  }
}

function tickBattleRoyale(sim, dt, now) {
  const nowMs = Date.now();
  // #br-30s: uppskjuten elimination — en frankopplad BR-spelare har 30s pa sig att ateransluta
  // innan de elimineras (annars spectator). Svep _brPendingElim varje tick.
  if (sim._brPendingElim) {
    for (const _pp in sim._brPendingElim) {
      if (nowMs - sim._brPendingElim[_pp] >= 30000) {
        if (sim.battleroyaleEliminated && !sim.battleroyaleEliminated.includes(_pp)) {
          sim.battleroyaleRanks[_pp] = sim.battleroyaleAliveCount;
          sim.battleroyaleEliminated.push(_pp);
          sim.battleroyaleAliveCount = Math.max(0, (sim.battleroyaleAliveCount || 0) - 1);
        }
        delete sim._brPendingElim[_pp];
      }
    }
  }
  const arena = BATTLEROYALE_ARENA;

  // Match-end? Skip game-logic men fortsätt broadcasta för spec-mode.
  if (sim.battleroyaleEnded) return;

  // === BR PRE-DROP / BATTLE BUS — flyger bussen, drar riders, deployar fallskärm,
  // landar spelare. Medan NÅGON är i luften: HELA combat-ticken hoppas (ingen zon/
  // storm/loot-skada/death/win) — starkaste skade-spärren. När alla landat (eller
  // deadline) flippar tickBrPredrop sim.brPredrop=false → vi faller igenom till normal BR.
  if (sim.brPredrop) {
    tickBrPredrop(sim, dt, nowMs);
    if (sim.brPredrop) {
      // Vilt rör sig ÄVEN under drop-fasen så luftburna spelare ser djuren röra sig.
      // OFARLIGT för skade-spärren: critter-targeting hoppar över brAir-spelare (ps.brAir)
      // → inga attacker/skador införs medan någon är i luften.
      tickBrCritters(sim, dt, nowMs);
      // Periodisk predrop-snapshot (1Hz) för late-join / paket-tapp.
      if (nowMs - (sim._brPredropBroadcastAt || 0) >= 1000) {
        sim._brPredropBroadcastAt = nowMs;
        sim.eventQueue.push({
          type: 'br_predrop_state', active: true,
          bus: sim.brBus ? {
            startX: sim.brBus.startX, startY: sim.brBus.startY,
            endX: sim.brBus.endX, endY: sim.brBus.endY,
            startAt: sim.brBus.startAt, durMs: sim.brBus.durMs,
          } : null,
          deadlineAt: sim.brPredropDeadlineAt, serverNow: nowMs,
        });
      }
      return;
    }
    // sim.brPredrop blev false denna tick (alla landat/deadline) → fall igenom till
    // normal BR-logik så fas-0 LOOT kör direkt.
  }

  // v1.655: Nollställ multi-pellet-kill-dedup-flaggan vid tick-start (ersätter
  // den tidigare per-kill 100ms-setTimeout som läckte timers).
  for (const [, ws] of sim.room.members) {
    if (ws._brCreditedKill) ws._brCreditedKill = false;
  }

  // Wall-collision för LEVANDE spelare (BR är no-respawn, dead = spectator).
  // GULAG (v1.790): hoppa över gulag-spelare — de är off-map; vägg-klamp skulle dra dem
  // tillbaka till kartan. Gulag-väggar enforceras klient-side.
  for (const [, ws] of sim.room.members) {
    if (ws.playerState && ws.playerState.gulagState) continue;
    if (ws.playerState && ws.playerState.brAir) continue; // luftburen (buss/freefall) → ingen vägg-klamp
    if (ws.playerState && ws.playerState.hp > 0) {
      const ent = { x: ws.playerState.x, y: ws.playerState.y, r: 14 };
      // PERF (BR): broadphase-grid → resolva bara mot väggar i spelarens celler (superset →
      // identisk push men O(candidates) ist. O(~1500 väggar) × alla members varje tick).
      if (sim.battleroyaleActive) {
        const _rg = sim._brResolveGrid || (sim._brResolveGrid = buildWallGrid(arena.walls));
        resolveCtfWall(ent, wallsInRect(_rg, ent.x - 62, ent.y - 62, ent.x + 62, ent.y + 62));
      } else {
        resolveCtfWall(ent, arena.walls);
      }
      // Klamp till arena-bounds
      ent.x = Math.max(20, Math.min(arena.worldW - 20, ent.x));
      ent.y = Math.max(20, Math.min(arena.worldH - 20, ent.y));
      ws.playerState.x = ent.x;
      ws.playerState.y = ent.y;
    }
  }

  // GULAG (v1.790): kör 1v1-duellerna + matchmaking FÖRE death-detection så förloraren
  // redan ligger i battleroyaleEliminated när loopen nedan körs (skippas där).
  tickGulag(sim, dt, Date.now());
  gulagMatchmake(sim, Date.now());

  // Phase-progression: kolla om current phase slutat
  if (sim.battleroyalePhaseEndAt && nowMs >= sim.battleroyalePhaseEndAt) {
    advanceBrPhase(sim);
  }

  // Zone-shrink: interpolera mellan current radius och next-radius över phase-tid.
  // Den första 50% av fasen är "warning"-fas (zon visar var den ska krympa till),
  // den sista 50% är själva shrink-animationen. Detta ger spelare tid att flytta sig.
  if (sim.battleroyaleZone) {
    const z = sim.battleroyaleZone;
    const phaseDur = sim.battleroyalePhaseEndAt - sim.battleroyalePhaseStartedAt;
    const phaseElapsed = nowMs - sim.battleroyalePhaseStartedAt;
    if (phaseDur > 0 && z.nextR != null) {
      // 1. Warning-fas (0-50% av phase): zon hålls stilla, klient ritar "next-zone"
      // 2. Shrink-fas (50-100% av phase): radien interpolerar från start till next
      const f = Math.max(0, Math.min(1, (phaseElapsed - phaseDur * 0.5) / (phaseDur * 0.5)));
      if (f > 0) {
        // Interpolera linjärt; clamping krävs inte (f är redan i [0,1])
        z.r = z.startR + (z.nextR - z.startR) * f;
        z.x = z.startX + (z.nextX - z.startX) * f;
        z.y = z.startY + (z.nextY - z.startY) * f;
      }
    }
  }

  // Outside-zone damage: applicera på spelare utanför zonen
  applyBrOutsideDamage(sim, dt);

  // Loot-pickup collision-detection
  tickBrLootPickups(sim, nowMs);

  // Bullets
  updateBullets(sim, dt, now);

  // Vilt (critters): ströva/fly/jaga + attack + väggkoll
  tickBrCritters(sim, dt, nowMs);

  // BR-meta: self-revive-channel, airstrike-impacts, UAV-pings (v1.740)
  tickBrMeta(sim, nowMs);
  tickBrContracts(sim, nowMs);

  // Centraliserad death-detection (täcker explosion/oob/zone-dmg)
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (ws.playerState.gulagState) continue; // GULAG (v1.790): hanteras av tickGulag
    if (ws.playerState.hp <= 0 && !sim.battleroyaleEliminated.includes(pid)) {
      // DOWNED (v1.740): har self-revive-kit + ej redan downed → gå "downed" (krypande,
      // sårbar) + auto-revive-channel istället för direkt elimination. Annars elimineras.
      if (!ws.playerState.brDowned && (ws.playerState.selfReviveKits || 0) > 0) {
        ws.playerState.selfReviveKits -= 1;
        ws.playerState.brDowned = true;
        ws.playerState.brReviveEnd = nowMs + 6000;
        ws.playerState.hp = 1;
        ws.playerState.speedMul = 0.45;
        sim.eventQueue.push({ type: 'br_downed', peerId: pid, reviveEnd: ws.playerState.brReviveEnd, kits: ws.playerState.selfReviveKits });
        sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: 1, shield: ws.playerState.shield || 0 });
        continue;
      }
      // GULAG (v1.790): FÖRSTA döden utan self-revive-kit → skicka till Gulag-kön
      // (1v1 om återkomst) istället för direkt elimination. Bara EN chans per match.
      if (!ws.playerState.gulagUsed) {
        ws.playerState.brDowned = false;
        ws.playerState.speedMul = 1;
        enterGulag(sim, pid, ws);
        continue;
      }
      // KILL-CREDIT vid RIKTIG elimination: kreditera senaste angripare om färsk (≤8s).
      // (Storm/miljö-död utan färsk angripare → ingen credit.)
      const la = ws.playerState._brLastAttacker;
      const laFresh = la && (Date.now() - (ws.playerState._brLastAttackerAt || 0) <= 8000);
      if (laFresh && la !== pid && sim.room.members.has(la) && !sim.battleroyaleEliminated.includes(la) && sim._handleBattleRoyaleKill) {
        sim._handleBattleRoyaleKill(sim, la, sim.room.members.get(la), pid, ws, ws.playerState._brLastWeapon);
      }
      ws.playerState.brDowned = false;
      // BR: ingen respawn. Markera som eliminated + flagga som spectator.
      const placement = sim.battleroyaleAliveCount; // current alive blir deras placering
      sim.battleroyaleRanks[pid] = placement;
      sim.battleroyaleEliminated.push(pid);
      sim.battleroyaleAliveCount = Math.max(0, sim.battleroyaleAliveCount - 1);
      ws.tdmRespawnAt = 0; // ingen respawn
      // C140 (audit 2026-06-18): sätt server-side spectating-flaggan vid RIKTIG elimination
      // (bara gulag-vägen gjorde det förr) → en enda sanningskälla för "är spectator".
      ws.playerState.spectating = true;
      sim.tdmDeathsByPid[pid] = (sim.tdmDeathsByPid[pid] || 0) + 1;
      // CORPSE-DROP: dropp current vapen + small HP-pack vid death-pos (kill-reward)
      const deathX = ws.playerState.x, deathY = ws.playerState.y;
      const droppedWeapon = ws.playerState.weaponId && ws.playerState.weaponId !== 'pistol' && ws.playerState.weaponId !== 'knife'
        ? ws.playerState.weaponId : null;
      if (droppedWeapon) {
        sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
        sim.battleroyaleLoot.push({
          id: 'br_loot_' + sim._brLootIdCounter,
          x: deathX + (Math.random() - 0.5) * 20,
          y: deathY + (Math.random() - 0.5) * 20,
          kind: 'weapon',
          weaponId: droppedWeapon,
          tier: 'corpse',
          available: true,
          unlockAt: 0,
        });
      }
      // Liten HP-pack också (mer reward även om vapen var pistol/knife)
      sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
      sim.battleroyaleLoot.push({
        id: 'br_loot_' + sim._brLootIdCounter,
        x: deathX + (Math.random() - 0.5) * 30,
        y: deathY + (Math.random() - 0.5) * 30,
        kind: 'hp_small',
        weaponId: null,
        tier: 'corpse',
        available: true,
        unlockAt: 0,
      });
      // BUGFIX: hårdkodad slice(-2) plockade fel items om bara hp_small pushades
      // (pistol/knife = ingen weapon-drop). Använd faktisk count.
      const dropCount = droppedWeapon ? 2 : 1;
      const newLoot = sim.battleroyaleLoot.slice(-dropCount);
      sim.eventQueue.push({
        type: 'br_corpse_drop',
        x: Math.round(deathX),
        y: Math.round(deathY),
        loot: newLoot.map(lo => ({
          id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: 0,
        })),
      });
      sim.eventQueue.push({
        type: 'br_player_eliminated',
        victim: pid,
        placement,
        aliveCount: sim.battleroyaleAliveCount,
      });
    }
  }

  // Win-check: 1 levande kvar (men bara om matchen startade med >=2 deltagare).
  // GULAG-GUARD: avsluta INTE matchen medan någon fortfarande är i gulag-kön eller en pågående
  // duell — annars kunde en batch-död (som drar aliveCount<=1) avsluta matchen + voidAllGulag,
  // så nyss-köade spelare aldrig fick sin duell ("dog utan chans att köra Gulag"). Gulag-vinnaren
  // redeployar → aliveCount stiger igen → win-check faller ut korrekt när kön är tom.
  var _gulagPending = ((sim.gulagQueue && sim.gulagQueue.length) || 0) > 0
    || ((sim.gulagMatches && sim.gulagMatches.length) || 0) > 0;
  if (sim.battleroyaleStartCount >= 2 && sim.battleroyaleAliveCount <= 1 && !_gulagPending) {
    // Hitta sista levande (om någon). Downed räknas EJ som vinnare (v1.748).
    let winner = null;
    for (const [pid, ws] of sim.room.members) {
      if (ws._isBot) continue; // C152 (audit 2026-06-18): en bot får aldrig utropas till BR-vinnare
      if (ws.playerState && ws.playerState.gulagState) continue; // GULAG: ej "levande på kartan"
      if (ws.playerState && ws.playerState.hp > 0 && !ws.playerState.brDowned) {
        winner = pid;
        break;
      }
    }
    // EDGE-CASE: båda sista dog samma tick → ingen levande. Pick LAST eliminated
    // (senast på listan = sist död) som "moral winner" — bättre än null.
    if (!winner && sim.battleroyaleEliminated.length > 0) {
      // Hitta senast eliminerad som inte är spectator (placement < 999)
      for (let i = sim.battleroyaleEliminated.length - 1; i >= 0; i--) {
        const pid = sim.battleroyaleEliminated[i];
        if ((sim.battleroyaleRanks[pid] || 0) < 999) {
          winner = pid;
          break;
        }
      }
    }
    endBattleRoyaleMatch(sim, winner, 'last_alive');
    return;
  }

  // Score-broadcast var sekund (timer + alive-count + phase)
  sim._brBroadcastTick = (sim._brBroadcastTick || 0) + dt;
  if (sim._brBroadcastTick >= 1.0) {
    sim._brBroadcastTick = 0;
    sim.eventQueue.push({
      type: 'br_state_update',
      aliveCount: sim.battleroyaleAliveCount,
      phase: sim.battleroyalePhase,
      msToNextPhase: Math.max(0, sim.battleroyalePhaseEndAt - nowMs),
      zoneX: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.x) : 0,
      zoneY: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.y) : 0,
      zoneR: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.r) : 0,
      nextZoneX: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextX || sim.battleroyaleZone.x) : 0,
      nextZoneY: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextY || sim.battleroyaleZone.y) : 0,
      nextZoneR: sim.battleroyaleZone ? Math.round(sim.battleroyaleZone.nextR || sim.battleroyaleZone.r) : 0,
    });
  }

  // Final timeout-skydd: om matchen pågår > matchDurationSec + 30s safety
  // → forced end (skydd mot stuck-final med 2 spelare som kampar i evighet)
  if (sim.battleroyaleEndAt && nowMs > sim.battleroyaleEndAt + 30000) {
    // Pick winner = LEVANDE spelare med högst HP (FILTRERA bort spectators/late-joiners)
    let bestPid = null, bestHp = -1;
    for (const [pid, ws] of sim.room.members) {
      if (ws._isBot) continue; // C152 (audit 2026-06-18): timeout-vinnare ska vara en människa
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      if (ws.playerState.hp > bestHp) {
        bestHp = ws.playerState.hp;
        bestPid = pid;
      }
    }
    // Fallback: om INGEN är levande (extrem edge case), välj senast eliminated
    if (!bestPid && sim.battleroyaleEliminated.length > 0) {
      bestPid = sim.battleroyaleEliminated[sim.battleroyaleEliminated.length - 1];
    }
    endBattleRoyaleMatch(sim, bestPid, 'timeout');
  }
}

// === BR PRE-DROP / BATTLE BUS state-maskin (server-auktoritativa bitar) ===
// Klienten ritar buss/freefall/fallskärm; servern äger "vem är fortfarande i luften"
// + en hård deadline, hoppar all combat (callern hoppar combat-ticken), forcerar ner
// stragglers/disconnects, och vid sista landningen flippar sim.brPredrop=false.
const BR_FREEFALL_MS = 4500;   // freefall innan fallskärm auto-deployar
const BR_CHUTE_MS = 5000;      // fallskärms-glid innan landning (LÄNGRE: ~9.5s luft efter hopp; klientens SKYDIVE_DESCENT_SEC speglar = 9.5)

function tickBrPredrop(sim, dt, nowMs) {
  const bus = sim.brBus;
  if (!bus) { sim.brPredrop = false; return; }
  const arena = BATTLEROYALE_ARENA;
  const busExitAt = bus.startAt + bus.durMs;
  // Bussens nuvarande pos (samma formel som klienten) → dra riders med.
  const bt = Math.max(0, Math.min(1, (nowMs - bus.startAt) / bus.durMs));
  const busX = Math.round(bus.startX + (bus.endX - bus.startX) * bt);
  const busY = Math.round(bus.startY + (bus.endY - bus.startY) * bt);
  bus.x = busX; bus.y = busY;

  let anyAirborneOrBus = false;
  for (const [pid, ws] of sim.room.members) {
    const ps = ws && ws.playerState;
    if (!ps) continue;
    if (ps.brAir === 1) {
      ps.x = busX; ps.y = busY;                 // åk med bussen
      if (!ws._isBot && ws.readyState !== 1) { landBrPlayer(sim, pid, ws, nowMs, false); continue; }
      if (ws._isBot) {
        if (!ps._brBotJumpAt) ps._brBotJumpAt = bus.startAt + Math.floor(bus.durMs * (0.15 + Math.random() * 0.7));
        if (nowMs >= ps._brBotJumpAt) startBrJump(sim, pid, ws, nowMs);
      }
      if (ps.brAir === 1 && nowMs >= busExitAt) startBrJump(sim, pid, ws, nowMs); // bussen ute → tvångshopp
      if (ps.brAir === 1) { anyAirborneOrBus = true; continue; }
    }
    if (ps.brAir >= 2) {
      const sinceJump = nowMs - (ps.brJumpedAt || nowMs);
      if (ps.brAir === 2 && sinceJump >= BR_FREEFALL_MS) {
        ps.brAir = 3;                           // fallskärm ut
        sim.eventQueue.push({ type: 'br_chute_deploy', peerId: pid });
      }
      if (sinceJump >= BR_FREEFALL_MS + BR_CHUTE_MS) {
        // NORMAL landning: människa landar där DEN styrde (klient-pos), bot på spawn.
        landBrPlayer(sim, pid, ws, nowMs, !ws._isBot);
        continue;
      }
      anyAirborneOrBus = true;
      continue;
    }
  }

  if (!anyAirborneOrBus || nowMs >= sim.brPredropDeadlineAt) {
    for (const [pid, ws] of sim.room.members) {
      const ps = ws && ws.playerState;
      if (!ps) continue;
      if (ps.brAir === 1 || ps.brAir >= 2) landBrPlayer(sim, pid, ws, nowMs, false);
    }
    sim.brPredrop = false;
    // Fas-klockan startar NU (loot-fönstret mäts från landning, ej match-start) så alla
    // får hela fas-0-looting-fönstret.
    const totalDurSec = sim.battleroyaleMatchDurationSec || 600;
    sim.battleroyalePhaseStartedAt = nowMs;
    sim.battleroyalePhaseEndAt = nowMs + arena.phases[0].durationFrac * totalDurSec * 1000;
    // Rebasa ÄVEN den absoluta match-deadline:n från landning (annars äts ~drop-tiden av
    // match-klockan → fas-sekvensen slutar efter battleroyaleEndAt + timeout-skyddet
    // (battleroyaleEndAt+30s, rad ~4299) kan slå mitt i en legitim slutfas).
    sim.battleroyaleStartedAt = nowMs;
    sim.battleroyaleEndAt = nowMs + totalDurSec * 1000;
    sim.eventQueue.push({ type: 'br_predrop_state', active: false, serverNow: nowMs });
    sim.eventQueue.push({ type: 'br_predrop_end', serverNow: nowMs, matchEndAt: sim.battleroyaleEndAt, phaseEndAt: sim.battleroyalePhaseEndAt });
  }
}

// Spelaren trycker HOPPA (eller auto-eject): lämna bussen → freefall.
function startBrJump(sim, pid, ws, nowMs) {
  const ps = ws && ws.playerState;
  if (!ps || ps.brAir !== 1) return;
  ps.brAir = 2;
  ps.brJumpedAt = nowMs;
  sim.eventQueue.push({ type: 'br_jumped', peerId: pid });
}

// Landning. useClientPos=true → landa där spelaren STYRDE (klient-pos, clampad till
// spelbara kartan); annars (bot/forcerad/disconnect) → snäpp till fallback-spawn.
function landBrPlayer(sim, pid, ws, nowMs, useClientPos) {
  const ps = ws && ws.playerState;
  if (!ps || ps.brAir === 0) return;
  const arena = BATTLEROYALE_ARENA;
  if (useClientPos) {
    // Aldrig styrt ut ur (off-map) buss-linjen — t.ex. AFK eller auto-eject vid bussens
    // ändpunkt → använd den tilldelade spridda spawn:en i st.f. att hård-klampa mot
    // kart-kanten/hörnet (annars klumpar idle-spelare ihop sig i hörnen).
    const outOfArena = ps.x < 120 || ps.x > arena.worldW - 120 || ps.y < 120 || ps.y > arena.worldH - 120;
    if (outOfArena && typeof ps.brLandX === 'number' && typeof ps.brLandY === 'number') {
      ps.x = ps.brLandX;
      ps.y = ps.brLandY;
    } else {
      ps.x = Math.max(120, Math.min(arena.worldW - 120, ps.x));
      ps.y = Math.max(120, Math.min(arena.worldH - 120, ps.y));
    }
  } else {
    if (typeof ps.brLandX === 'number') ps.x = ps.brLandX;
    if (typeof ps.brLandY === 'number') ps.y = ps.brLandY;
  }
  ps.brAir = 0;
  ps.brJumpedAt = 0;
  ps._brBotJumpAt = 0;
  ps.invulnUntil = nowMs + 1500;
  sim.eventQueue.push({ type: 'br_landed', peerId: pid, x: Math.round(ps.x), y: Math.round(ps.y) });
}

// Phase-advance: 0→1→2→3→4 (sista fasen körs tills sista spelare dör)
function advanceBrPhase(sim) {
  const arena = BATTLEROYALE_ARENA;
  const totalDurSec = sim.battleroyaleMatchDurationSec || 600;
  const nowMs = Date.now();
  const nextPhase = sim.battleroyalePhase + 1;
  if (nextPhase >= arena.phases.length) {
    // Sista fasen — den fortsätter tills nån dör. Sätt phaseEndAt långt fram.
    sim.battleroyalePhaseEndAt = nowMs + 999999999;
    return;
  }
  sim.battleroyalePhase = nextPhase;
  sim.battleroyalePhaseStartedAt = nowMs;
  const phaseCfg = arena.phases[nextPhase];
  const phaseDurMs = totalDurSec * 1000 * phaseCfg.durationFrac;
  sim.battleroyalePhaseEndAt = nowMs + phaseDurMs;
  // v1.378: final-zone-center pre-bestäms vid match-start (random på hela mapen).
  // Varje phase lerpar nuvarande center MOT final-target med fraction = phase/totalPhases.
  // Plus liten random noise per phase så det inte är perfekt linjärt.
  // Resultat: final-zonen hamnar på olika ställen varje match (inkl nära hörnen),
  // men progression är förutsägbar nog att spelare kan rotera.
  const cur = sim.battleroyaleZone;
  const newR = Math.round(Math.sqrt(arena.worldW * arena.worldH * phaseCfg.areaFrac / Math.PI));
  const totalShrinkPhases = arena.phases.length - 1;
  // V2: nå det slumpade slut-centret SNABBARE (×1.7) så zonen tydligt hamnar på olika
  // ställen redan från mitten av matchen (var för center-ig tidigt = "samma ställe").
  const t = totalShrinkPhases > 0 ? Math.min(1, (nextPhase / totalShrinkPhases) * 1.7) : 1;
  const finalCx = sim.brFinalCenterX != null ? sim.brFinalCenterX : (arena.worldW / 2);
  const finalCy = sim.brFinalCenterY != null ? sim.brFinalCenterY : (arena.worldH / 2);
  // Lerp mot final-target
  let nx = cur.x + (finalCx - cur.x) * t;
  let ny = cur.y + (finalCy - cur.y) * t;
  // Liten random noise (max 250px per phase) så det inte syns perfekt linjärt
  const noiseAng = Math.random() * Math.PI * 2;
  const noiseDist = Math.random() * Math.min(450, cur.r * 0.14);
  nx += Math.cos(noiseAng) * noiseDist;
  ny += Math.sin(noiseAng) * noiseDist;
  // Klamp inside current zone (fairness — players i safe-area får inte get screwed)
  const maxDrift = Math.max(0, cur.r - newR - 30);
  const dxc = nx - cur.x, dyc = ny - cur.y;
  const curDist = Math.hypot(dxc, dyc);
  if (curDist > maxDrift && maxDrift > 0) {
    const k = maxDrift / curDist;
    nx = cur.x + dxc * k;
    ny = cur.y + dyc * k;
  }
  // Map clamp (zonen får nudda edge)
  nx = Math.max(newR, Math.min(arena.worldW - newR, nx));
  ny = Math.max(newR, Math.min(arena.worldH - newR, ny));
  // Spara start- + next-värden för interpolation
  cur.startX = cur.x;
  cur.startY = cur.y;
  cur.startR = cur.r;
  cur.nextX = nx;
  cur.nextY = ny;
  cur.nextR = newR;
  sim.eventQueue.push({
    type: 'br_phase_changed',
    phase: nextPhase,
    name: phaseCfg.name,
    outsideDmg: phaseCfg.outsideDmg,
    phaseDurMs,
    nextZoneX: Math.round(nx),
    nextZoneY: Math.round(ny),
    nextZoneR: Math.round(newR),
  });
}

// Outside-zone damage: alla spelare utanför zonens current-radius tar phase-dmg/s
function applyBrOutsideDamage(sim, dt) {
  if (!sim.battleroyaleZone) return;
  if (sim.brPredrop) return; // ingen storm-skada under pre-drop/luftfas
  const arena = BATTLEROYALE_ARENA;
  const phaseCfg = arena.phases[sim.battleroyalePhase];
  if (!phaseCfg || phaseCfg.outsideDmg <= 0) return;
  const z = sim.battleroyaleZone;
  const r2 = z.r * z.r;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (ws.playerState.gulagState) continue; // GULAG (v1.790): off-map → ingen storm-skada
    // (v1.750) Downed spelare (self-revive-kanal aktiv) är immuna mot zone-damage.
    // Utan detta: hp=1 tar storm-skada → hp→0 → death-loopen ser brDowned=true+kits=0 → eliminerar.
    if (ws.playerState.brDowned) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - z.x;
    const dy = ws.playerState.y - z.y;
    if (dx * dx + dy * dy <= r2) {
      // I zonen — safe. v1.748: åldra ut gammal angripare (>3s) så storm-död EJ
      // krediterar någon som sköt en länge sedan.
      if (ws.playerState._brLastAttackerAt && Date.now() - ws.playerState._brLastAttackerAt > 3000) ws.playerState._brLastAttackerAt = 0;
      continue;
    }
    // Utanför — applicera dmg. GASMASK halverar zon-skadan (v1.739). Shield tar först.
    const dmg = phaseCfg.outsideDmg * dt * (ws.playerState.gasMask ? 0.5 : 1);
    let remaining = dmg;
    if ((ws.playerState.shield || 0) > 0) {
      const absorb = Math.min(ws.playerState.shield, remaining);
      ws.playerState.shield -= absorb;
      remaining -= absorb;
    }
    if (remaining > 0) {
      ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
    }
  }
  // Throttla broadcast så vi inte spammar pvp_hp_changed varje tick
  sim._brZoneDmgTick = (sim._brZoneDmgTick || 0) + dt;
  if (sim._brZoneDmgTick >= 0.2) {
    sim._brZoneDmgTick = 0;
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState) continue;
      const dx = ws.playerState.x - z.x;
      const dy = ws.playerState.y - z.y;
      if (dx * dx + dy * dy <= r2) continue;
      sim.eventQueue.push({
        type: 'pvp_hp_changed',
        peerId: pid,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
        zoneDmg: true,
      });
    }
  }
}

// Loot pickup collision (BR-specifik — speglar tickPvpPickups men för loot-typer)
function tickBrLootPickups(sim, nowMs) {
  if (!sim.battleroyaleLoot) return;
  // C157 (audit 2026-06-18): upplockad loot markeras lo.available=false men spliceades
  // aldrig → corpse-droppar pushar hela tiden så listan växer och scannas i sin helhet
  // varje tick. Svep bort otillgängliga var ~3s (ordning ej lastbärande) → per-tick-scanen
  // hålls proportionell mot LEVANDE loot. Speglar supply-drops-svepet i tickBrContracts.
  if (nowMs - (sim._brLootSweepAt || 0) > 3000) {
    sim._brLootSweepAt = nowMs;
    if (sim.battleroyaleLoot.some(l => !l.available)) {
      sim.battleroyaleLoot = sim.battleroyaleLoot.filter(l => l.available);
    }
  }
  for (const lo of sim.battleroyaleLoot) {
    if (!lo.available) continue;
    // Anti-rush: center-loot låst första 30s
    if (lo.unlockAt && nowMs < lo.unlockAt) continue;
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      const dx = ws.playerState.x - lo.x;
      const dy = ws.playerState.y - lo.y;
      const r = BATTLEROYALE_ARENA.lootPickupRadius;
      if (dx * dx + dy * dy > r * r) continue;
      // Pickup! Apply effect
      let applied = false;
      if (lo.kind === 'hp_small') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(ws.playerState.maxHp || 100, before + 60);
        if (ws.playerState.hp !== before) applied = true;
      } else if (lo.kind === 'hp_big') {
        const before = ws.playerState.hp;
        ws.playerState.hp = Math.min(ws.playerState.maxHp || 100, before + 120);
        if (ws.playerState.hp !== before) applied = true;
      } else if (lo.kind === 'shield_small') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(ws.playerState.maxShield || 100, before + 50);
        if (ws.playerState.shield !== before) applied = true;
      } else if (lo.kind === 'shield_big') {
        const before = ws.playerState.shield || 0;
        ws.playerState.shield = Math.min(ws.playerState.maxShield || 100, before + 100);
        if (ws.playerState.shield !== before) applied = true;
      } else if (lo.kind === 'ammo') {
        // Klient hanterar ammo lokalt; vi skickar event
        applied = true;
      } else if (lo.kind === 'grenade') {
        // BR grenade-pickup: ger +3 granater. Klient bumpar lokal counter.
        applied = true;
      } else if (lo.kind === 'smoke') {
        // BR rökgranat-pickup: ger +3 rökgranater (v1.748). Klient bumpar.
        applied = true;
      } else if (lo.kind === 'flashbang' || lo.kind === 'molotov' || lo.kind === 'gravity') {
        // V2: nya granat-typer som BR-loot. Klient bumpar rätt counter via event-kind.
        applied = true;
      } else if (lo.kind === 'weapon' && lo.weaponId) {
        // ANVÄNDARVAL: byt ALDRIG vapen automatiskt vid walkover. Loot-vapnet AUTO-PLOCKAS
        // till väskan (_brOwnedWeapons nedan) men spelaren BEHÅLLER sitt utrustade vapen och
        // byter själv via vapen-menyn. (Förr: auto-equip på startvapnet → kändes som
        // ofrivilliga vapenbyten när man gick på markvapen.)
        const equippedNow = false;
        // Trigger event ALLTID så klient kan lägga vapnet i sitt inventory
        applied = true;
        lo._brEquippedOnPickup = equippedNow;
        // v2 anti-cheat: vapnet hamnar i klientens inventory oavsett equip →
        // tracka server-side så applyShoot tillåter det.
        if (!(ws._brOwnedWeapons instanceof Set)) ws._brOwnedWeapons = new Set(['fists', 'knife', BATTLEROYALE_ARENA.startWeapon || 'pistol']);
        ws._brOwnedWeapons.add(lo.weaponId);
      }
      if (!applied) continue;
      lo.available = false;
      // CASH: varje lootbox ger pengar (tier-baserat) — Warzone-style ekonomi (v1.739).
      const CASH_BY_TIER = { common: 50, uncommon: 100, rare: 200, legendary: 400, corpse: 75, starter: 40, dropped: 40 };
      const lootCash = CASH_BY_TIER[lo.tier] != null ? CASH_BY_TIER[lo.tier] : 50;
      brAwardCash(sim, pid, lootCash);
      sim.eventQueue.push({
        type: 'br_loot_picked',
        peerId: pid,
        lootId: lo.id,
        kind: lo.kind,
        weaponId: lo.weaponId || null,
        tier: lo.tier || null,
        cash: lootCash,   // för loot-toast (klient visar "+X $")
        // For weapon pickups: did server auto-equip it? Client uses this för
        // att veta om state.player.weaponId ska uppdateras.
        equipped: lo._brEquippedOnPickup != null ? lo._brEquippedOnPickup : true,
        hp: ws.playerState.hp,
        shield: ws.playerState.shield || 0,
      });
      break; // pickup tagen — gå till nästa
    }
  }
}

// Helper: kolla om punkt (x,y) är inom en wall (med 20px buffer för pickup-radie)
function brPointInAnyWall(x, y, walls) {
  for (const w of walls) {
    // 20px buffer så loot inte spawnar precis bredvid wall heller
    if (x + 20 >= w.x && x - 20 <= w.x + w.w &&
        y + 20 >= w.y && y - 20 <= w.y + w.h) {
      return true;
    }
  }
  return false;
}

// Hitta närmaste fria punkt om original-pos är inuti wall (spiral-search)
function brFindFreeSpot(x, y, walls, worldW, worldH) {
  if (!brPointInAnyWall(x, y, walls)) return { x, y };
  // Spiral-search: prova punkter i ökande radie runt original
  for (let r = 40; r < 400; r += 30) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const nx = x + Math.cos(a) * r;
      const ny = y + Math.sin(a) * r;
      if (nx < 50 || nx > worldW - 50 || ny < 50 || ny > worldH - 50) continue;
      if (!brPointInAnyWall(nx, ny, walls)) {
        return { x: Math.round(nx), y: Math.round(ny) };
      }
    }
  }
  // Fallback: original (worst case)
  return { x, y };
}

// Initialisera loot vid match-start enligt arena.lootSpawns + lootByTier
function initBrLoot(sim) {
  const arena = BATTLEROYALE_ARENA;
  const loot = [];
  // Center-spawn (sista i lootSpawns) är ALLTID legendary, men UNLOCKAS först
  // efter 30s (anti-rush). Klient ser containern men kan inte plocka loot.
  const centerIdx = arena.lootSpawns.length - 1;
  const matchStartMs = Date.now();
  let movedCount = 0;
  for (let i = 0; i < arena.lootSpawns.length; i++) {
    const origSp = arena.lootSpawns[i];
    // VALIDATION: om loot-pos är inuti wall, hitta närmaste fria pos
    const sp = brFindFreeSpot(origSp.x, origSp.y, arena.walls, arena.worldW, arena.worldH);
    if (sp.x !== origSp.x || sp.y !== origSp.y) movedCount++;
    let tier;
    if (i === centerIdx || origSp.forceTier === 'legendary') {
      tier = 'legendary';   // center-spawn + grottan = garanterad legendary
    } else {
      const r = Math.random();
      const t = arena.lootTiers;
      if (r < t.common) tier = 'common';
      else if (r < t.common + t.uncommon) tier = 'uncommon';
      else if (r < t.common + t.uncommon + t.rare) tier = 'rare';
      else tier = 'legendary';
    }
    // Välj item från tier (viktad)
    const items = arena.lootByTier[tier];
    let totalW = 0;
    for (const it of items) totalW += it.weight;
    let rr = Math.random() * totalW;
    let chosen = items[0];
    for (const it of items) {
      rr -= it.weight;
      if (rr <= 0) { chosen = it; break; }
    }
    sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
    // Center-loot låst första 30s — anti-rush
    const unlockAt = (i === centerIdx) ? (matchStartMs + 30000) : 0;
    loot.push({
      id: 'br_loot_' + sim._brLootIdCounter,
      x: sp.x,
      y: sp.y,
      kind: chosen.kind,
      weaponId: chosen.weaponId || null,
      tier,
      available: true,
      unlockAt,
    });
  }
  // V2: GARANTERA att VARJE hus alltid har minst EN vapen-lootbox — även hus som
  // redan fick en heal/shield/granat på sin slumpade center-spawn. Den slumpade
  // center-loot:en (postProcessArena, centrum-36) ger heal/shield/variation; denna
  // loop lägger ALLTID en vapenlåda BREDVID (centrum+36). Varje vapenlåda ger cash
  // (CASH_BY_TIER i tickBrLootPickups). Användarkrav: "alla hus minst en vapenbox".
  const cabins = (arena.cabins || []).filter(c => c && c.bounds && !c._isContainer);
  const wpnPool = [];
  for (const tierName of ['common', 'uncommon', 'rare']) {
    for (const it of (arena.lootByTier[tierName] || [])) {
      if (it.kind === 'weapon' && it.weaponId) wpnPool.push({ weaponId: it.weaponId, tier: tierName });
    }
  }
  if (wpnPool.length) {
    let addedHouseWpn = 0;
    for (let c = 0; c < cabins.length; c++) {
      const b = cabins[c].bounds;
      // Hoppa bara över om huset RÅKADE få exakt en vapenlåda på sin slump-spawn
      // OCH den ligger till höger (ovanpå garanti-platsen) — annars dubblett. I praktiken
      // ger vi alltid en garanterad låda; check:en undviker bara två lådor på samma pixel.
      const pick = wpnPool[c % wpnPool.length];
      // placera vapnet TILL HÖGER om centrum (heal/shield-loot ligger centrum-36)
      // så de hamnar BREDVID varandra, ej ovanpå.
      const sp = brFindFreeSpot(b.x + b.w / 2 + 36, b.y + b.h / 2, arena.walls, arena.worldW, arena.worldH);
      const dupe = loot.some(lo => lo.kind === 'weapon' && lo.available &&
        Math.abs(lo.x - sp.x) < 8 && Math.abs(lo.y - sp.y) < 8);
      if (dupe) continue;
      sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
      loot.push({ id: 'br_loot_' + sim._brLootIdCounter, x: sp.x, y: sp.y, kind: 'weapon', weaponId: pick.weaponId, tier: pick.tier, available: true, unlockAt: 0 });
      addedHouseWpn++;
    }
    if (addedHouseWpn > 0) console.log('[BR] initBrLoot: +' + addedHouseWpn + ' garanterade hus-vapen');
  }
  if (movedCount > 0) {
    console.log('[BR] initBrLoot: ' + movedCount + ' loot-spawns flyttade ur walls');
  }
  return loot;
}

// =================================================================
// v1.619: HEIST — 3-fas bank-rån (stealth → alarm → extract)
// =================================================================
// Iter 1: foundation. Phase-timer + match-end-conditions. Camera-AI,
// guard-patrols, civilian-panic, drill, police-vågor kommer i iter 2-4.
function tickHeist(sim, dt, nowMs) {
  if (sim.heistEnded) return;
  const arena = HEIST_ARENA;
  const matchDurMs = (arena.matchDurationSec || 720) * 1000;
  const elapsedMs = nowMs - sim.heistStartT;
  const phaseElapsedMs = nowMs - sim.heistPhaseStartT;

  // === MATCH-TIMEOUT (säkerhets-cap, även om phase-flow brakar) ===
  if (elapsedMs >= matchDurMs) {
    sim.heistEnded = true;
    sim.heistActive = false;
    sim.eventQueue.push({
      type: 'heist_lose',
      reason: 'timeout',
      lootValue: sim.heistLootValue || 0,
      elapsedSec: Math.round(elapsedMs / 1000),
      scoreboard: _heistBuildScoreboard(sim),
    });
    return;
  }

  // === LOSE-CHECK: alla real players döda/downed ===
  let anyAlive = false;
  for (const [, ws] of sim.room.members) {
    if (ws._isBot) continue;
    if (ws.playerState && ws.playerState.hp > 0 && !ws.playerState.cdDowned) {
      anyAlive = true; break;
    }
  }
  if (!anyAlive && sim.room.members.size > 0) {
    sim.heistEnded = true;
    sim.heistActive = false;
    sim.eventQueue.push({
      type: 'heist_lose',
      reason: 'all_dead',
      lootValue: sim.heistLootValue || 0,
      elapsedSec: Math.round(elapsedMs / 1000),
      scoreboard: _heistBuildScoreboard(sim),
    });
    return;
  }

  // === PHASE STATE-MACHINE ===
  if (sim.heistPhase === 'stealth') {
    // Auto-alarm vid timeout (4 min) ELLER om en player triggat det manuellt
    // (drill-start, kill-civilian, etc — sätter sim.heistAlarmTriggered = true)
    const stealthMaxMs = (arena.stealthPhaseMaxSec || 240) * 1000;
    if (sim.heistAlarmTriggered || phaseElapsedMs >= stealthMaxMs) {
      _heistTransitionPhase(sim, 'alarm', sim.heistAlarmTriggered ? 'triggered' : 'timeout', nowMs);
    }
  } else if (sim.heistPhase === 'alarm') {
    // v1.625: ALARM-FAS TIMEOUT (8 min) — förhindrar match-lock om ingen drillar
    const alarmMaxMs = (arena.alarmPhaseMaxSec || 480) * 1000;
    // v1.650: warning vid 6/8 min så player förstår att drilla nu
    if (!sim._heistAlarmWarning2minSent && phaseElapsedMs >= alarmMaxMs - 120000 &&
        sim.heistDrillProgress < 1.0) {
      sim._heistAlarmWarning2minSent = true;
      sim.eventQueue.push({ type: 'heist_alarm_timeout_warning' });
    }
    if (phaseElapsedMs >= alarmMaxMs) {
      sim.heistEnded = true;
      sim.heistActive = false;
      sim.eventQueue.push({
        type: 'heist_lose',
        reason: 'alarm_timeout',
        lootValue: sim.heistLootValue || 0,
        elapsedSec: Math.round(elapsedMs / 1000),
        scoreboard: _heistBuildScoreboard(sim),
      });
      return;
    }
    // v1.620/v1.625: Drill kräver player-närvaro OCH inga cops inom 80px
    // → positional gameplay: "håll cops borta från drill" istället för "stand still"
    // v1.646: helper för båda drill-spotten (outer + inner)
    const copPauseR2 = 80 * 80;
    const _drillStatus = (spot) => {
      const r2 = (spot.r || 40) * (spot.r || 40);
      let player = false;
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const dx = ws.playerState.x - spot.x, dy = ws.playerState.y - spot.y;
        if (dx * dx + dy * dy < r2) { player = true; break; }
      }
      let cop = false;
      if (sim.enemies && sim.enemies.length > 0) {
        for (const e of sim.enemies) {
          if (!e || e.dead) continue;
          const dx = e.x - spot.x, dy = e.y - spot.y;
          if (dx * dx + dy * dy < copPauseR2) { cop = true; break; }
        }
      }
      return { player, cop };
    };
    // OUTER drill (open vault-outer först — gateway till outer-loot + inner-drill)
    const drillSpot = arena.drillSpot || { x: 2000, y: 1720, r: 40 };
    const outerStatus = _drillStatus(drillSpot);
    sim.heistDrilling = outerStatus.player && !outerStatus.cop && sim.heistDrillProgress < 1.0;
    sim.heistDrillBlocked = outerStatus.cop && sim.heistDrillProgress < 1.0;
    if (sim.heistDrilling) {
      const drillDurMs = (arena.drillDurationSec || 120) * 1000 * _heistDifficultyMul(sim).drillTime;
      sim.heistDrillProgress = Math.min(1.0, sim.heistDrillProgress + (dt * 1000 / drillDurMs));
      if (sim.heistDrillProgress >= 1.0 && !sim.heistVaultUnlocked) {
        sim.heistVaultUnlocked = true;
        sim.eventQueue.push({ type: 'heist_vault_unlocked' });
      }
    }
    // v1.646: INNER drill (öppnar inner-vault för gold-mega-stacks) — bara
    // möjligt efter outer är öppen. Optional bonus, kortare 90s drill, samma
    // cop-pause-mekanik som outer.
    if (sim.heistVaultUnlocked) {
      const drillSpotInner = arena.drillSpotInner || { x: 2000, y: 1100, r: 40 };
      const innerStatus = _drillStatus(drillSpotInner);
      sim.heistInnerDrilling = innerStatus.player && !innerStatus.cop && sim.heistInnerDrillProgress < 1.0;
      sim.heistInnerDrillBlocked = innerStatus.cop && sim.heistInnerDrillProgress < 1.0;
      if (sim.heistInnerDrilling) {
        const innerDurMs = (arena.innerVaultDrillSec || 90) * 1000 * _heistDifficultyMul(sim).drillTime;
        sim.heistInnerDrillProgress = Math.min(1.0, sim.heistInnerDrillProgress + (dt * 1000 / innerDurMs));
        if (sim.heistInnerDrillProgress >= 1.0 && !sim.heistInnerVaultUnlocked) {
          sim.heistInnerVaultUnlocked = true;
          sim.eventQueue.push({ type: 'heist_inner_vault_unlocked' });
        }
      }
    }
    // Trigga extract-fas när OUTER drill klar + minst en loot bagged
    // (inner-drill är optional — inte krav för extract)
    if (sim.heistDrillProgress >= 1.0 && Object.keys(sim.heistLootBagged).length > 0) {
      _heistTransitionPhase(sim, 'extract', 'drill_done', nowMs);
    }
  } else if (sim.heistPhase === 'extract') {
    // EXTRACT: spelaren måste komma till getaway-van inom 60s.
    const extractMaxMs = (arena.extractDurationSec || 60) * 1000;
    if (phaseElapsedMs >= extractMaxMs) {
      // v1.637: iterate ALL extract zones (front borttagen i v1.634 — server kraschade)
      let anyInZone = false;
      const zones = arena.extractZones || {};
      for (const k of Object.keys(zones)) {
        const ez = zones[k];
        if (!ez) continue;
        for (const [, ws] of sim.room.members) {
          if (!ws.playerState || ws.playerState.hp <= 0) continue;
          const dx = ws.playerState.x - (ez.x + ez.w / 2);
          const dy = ws.playerState.y - (ez.y + ez.h / 2);
          if (Math.abs(dx) < ez.w / 2 + 40 && Math.abs(dy) < ez.h / 2 + 40) {
            anyInZone = true; break;
          }
        }
        if (anyInZone) break;
      }
      sim.heistEnded = true;
      sim.heistActive = false;
      if (anyInZone) {
        sim.eventQueue.push({
          type: 'heist_win',
          lootValue: sim.heistLootValue || 0,
          elapsedSec: Math.round(elapsedMs / 1000),
          scoreboard: _heistBuildScoreboard(sim),
        });
      } else {
        sim.eventQueue.push({
          type: 'heist_lose',
          reason: 'extract_timeout',
          lootValue: sim.heistLootValue || 0,
          elapsedSec: Math.round(elapsedMs / 1000),
          scoreboard: _heistBuildScoreboard(sim),
        });
      }
    }
  }

  // === v1.621/v1.625: CAMERA-DETECTION per-camera timer (fix shared-timer-bug) ===
  // Tidigare delade alla kameror EN timer per spelare → timer leakade mellan
  // kameror. Nu per-(player, cam) via ws._heistCamDetect[camId].
  // v1.651: även global "seen by any player THIS TICK"-flag på sim per cam-id
  // som broadcastas → klient kan färga cone röd när player är i den.
  sim._heistSeenCamerasThisTick = {};
  if (sim.heistPhase === 'stealth') {
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState) continue;
      ws._heistCamDetect = ws._heistCamDetect || {};
      ws._heistCamSeenThisTick = {};
    }
    for (const cam of (arena.cameras || [])) {
      if (sim.heistDisabledCameras && sim.heistDisabledCameras[cam.id]) continue;
      const camRange2 = (cam.range || 250) * (cam.range || 250);
      const cone = cam.cone || 0.7;
      // v1.648: server-side sweep match klient-render (var statisk → klient
      // visade kameran sveppa men detection-cone stod still = desync).
      // Samma hash + Date.now() + sin-formel som game.js _drawHeistCamera.
      let h = 0;
      const camIdStr = cam.id || '';
      for (let i = 0; i < camIdStr.length; i++) h = ((h << 5) - h + camIdStr.charCodeAt(i)) | 0;
      const camPhase = (h % 1000) / 1000 * Math.PI * 2;
      const sweepAmp = cam.sweepAmp != null ? cam.sweepAmp : 0.5;
      const sweepPeriod = cam.sweepPeriod != null ? cam.sweepPeriod : 4500;
      const dir = (cam.dir || 0) + Math.sin(Date.now() / sweepPeriod * Math.PI * 2 + camPhase) * sweepAmp;
      for (const [, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        if (ws._heistCameraImmune) continue;
        const dx = ws.playerState.x - cam.x;
        const dy = ws.playerState.y - cam.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > camRange2) continue;
        const angToPlayer = Math.atan2(dy, dx);
        let angDiff = angToPlayer - dir;
        while (angDiff > Math.PI) angDiff -= 2 * Math.PI;
        while (angDiff < -Math.PI) angDiff += 2 * Math.PI;
        if (Math.abs(angDiff) > cone) continue;
        // v1.625: Också LOS-check så kameran inte ser genom väggar
        if (_heistLineBlockedByWall(cam.x, cam.y, ws.playerState.x, ws.playerState.y, arena)) continue;
        // PLAYER IN CONE — per-(player, cam) timer
        if (!ws._heistCamDetect[cam.id]) ws._heistCamDetect[cam.id] = nowMs;
        ws._heistCamSeenThisTick[cam.id] = true;
        // v1.651: global "någon player är i denna cam:s cone" → klient färgar röd
        sim._heistSeenCamerasThisTick[cam.id] = true;
        // v1.626: difficulty-skalad camera-grace (1000-3000ms)
        const camGrace = _heistDifficultyMul(sim).cameraGraceMs;
        if (nowMs - ws._heistCamDetect[cam.id] > camGrace) {
          sim.heistAlarmTriggered = true;
          sim.eventQueue.push({ type: 'heist_camera_detect', camId: cam.id });
        }
      }
    }
    // Decay per-camera-per-player om ej sedd denna tick
    for (const [, ws] of sim.room.members) {
      if (!ws._heistCamDetect) continue;
      for (const camId in ws._heistCamDetect) {
        if (!ws._heistCamSeenThisTick || !ws._heistCamSeenThisTick[camId]) {
          if (nowMs - ws._heistCamDetect[camId] > 500) {
            delete ws._heistCamDetect[camId];
          }
        }
      }
    }

    // v1.645: HACK-PROGRESS tick — completar pågående hacks utan att kräva
    // andra-tap. Cancel om player rört sig >50px från terminal mellan starts.
    for (const [, ws] of sim.room.members) {
      if (!ws._heistHackStart || !ws._heistHackTermId) continue;
      if (!ws.playerState || ws.playerState.hp <= 0) {
        ws._heistHackStart = 0; ws._heistHackTermId = null; continue;
      }
      const term = (arena.hackTerminals || []).find(t => t.id === ws._heistHackTermId);
      if (!term) { ws._heistHackStart = 0; ws._heistHackTermId = null; continue; }
      const dx = ws.playerState.x - term.x, dy = ws.playerState.y - term.y;
      if (dx * dx + dy * dy > 60 * 60) {
        // Rörde sig ut ur range — cancel hack
        sim.eventQueue.push({
          type: 'heist_hack_cancel',
          peerId: ws.id, terminalId: ws._heistHackTermId,
        });
        ws._heistHackStart = 0; ws._heistHackTermId = null;
        continue;
      }
      if (nowMs >= ws._heistHackFinishesAt) {
        sim.heistHackedTerminals = sim.heistHackedTerminals || {};
        if (!sim.heistHackedTerminals[term.id]) {
          sim.heistHackedTerminals[term.id] = true;
          sim.heistDisabledCameras = sim.heistDisabledCameras || {};
          for (const camId of (term.disables || [])) sim.heistDisabledCameras[camId] = true;
          sim.eventQueue.push({
            type: 'heist_terminal_hacked',
            terminalId: term.id,
            disabledCameras: term.disables,
            isMaster: !!term.master,
          });
        }
        ws._heistHackStart = 0; ws._heistHackTermId = null;
      }
    }
  }

  // v1.647: LOCKPICK-PROGRESS tick — fungerar i ALLA phases (stealth/alarm/extract).
  // Samma server-tick auto-complete-mönster som hack: spelare tappar EN gång,
  // server completar när finishesAt nådd och player står kvar inom 60px.
  for (const [, ws] of sim.room.members) {
    if (!ws._heistLockpickStart || !ws._heistLockpickDoorId) continue;
    if (!ws.playerState || ws.playerState.hp <= 0) {
      ws._heistLockpickStart = 0; ws._heistLockpickDoorId = null; continue;
    }
    const door = (arena.doors || []).find(d => d.id === ws._heistLockpickDoorId);
    if (!door) { ws._heistLockpickStart = 0; ws._heistLockpickDoorId = null; continue; }
    if (sim.heistUnlockedDoors && sim.heistUnlockedDoors[door.id]) {
      // Already unlocked (av annan spelare) — bara rensa state
      ws._heistLockpickStart = 0; ws._heistLockpickDoorId = null; continue;
    }
    const dcx = door.x + door.w / 2, dcy = door.y + door.h / 2;
    const dx = ws.playerState.x - dcx, dy = ws.playerState.y - dcy;
    if (dx * dx + dy * dy > 60 * 60) {
      // Rörde sig ut ur range — cancel
      sim.eventQueue.push({
        type: 'heist_lockpick_cancel',
        peerId: ws.id, doorId: ws._heistLockpickDoorId,
      });
      ws._heistLockpickStart = 0; ws._heistLockpickDoorId = null;
      continue;
    }
    if (nowMs >= ws._heistLockpickFinishesAt) {
      sim.heistUnlockedDoors = sim.heistUnlockedDoors || {};
      sim.heistUnlockedDoors[door.id] = true;
      if (door.kind === 'back_door') {
        if (arena.extractZones && arena.extractZones.back) {
          sim.heistBackExtractUnlocked = true;
        }
      }
      sim.eventQueue.push({
        type: 'heist_door_unlocked',
        peerId: ws.id, doorId: door.id,
      });
      ws._heistLockpickStart = 0; ws._heistLockpickDoorId = null;
    }
  }

  // === v1.641: BUILD spatial-hash innan bullets — annars hittar bullets-loopen
  // inga enemies via sim.enemyGrid.getNearby() (huvudloopens grid-rebuild på
  // line ~412 hoppas över eftersom heist-grenen tidigt-returnar). Detta var
  // varför poliser visade som odödliga: skott passerade rakt igenom dem. ===
  sim.enemyGrid.clear();
  for (const e of sim.enemies) {
    if (!e.dead) sim.enemyGrid.insert(e);
  }
  // === v1.638: BULLET-tick (var saknad — police-skott fastnade i luften!) ===
  updateBullets(sim, dt, nowMs);

  // === v1.622: NPC tick (civilians + guards) ===
  _heistTickNPCs(sim, dt, nowMs, arena);

  // === v1.622: MEDIC-role passiv regen (+2 HP/s) ===
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (ws._heistRole !== 'medic') continue;
    ws._heistMedicRegenAccum = (ws._heistMedicRegenAccum || 0) + dt;
    if (ws._heistMedicRegenAccum >= 1.0) {
      ws._heistMedicRegenAccum = 0;
      const max = ws.playerState.maxHp || 100;
      const regen = ws._heistMedicRegenRate || 6; // v1.624: 6 HP/s base, 8 solo
      if (ws.playerState.hp < max) {
        ws.playerState.hp = Math.min(max, ws.playerState.hp + regen);
        sim.eventQueue.push({
          type: 'cd_hp_changed', peerId: pid,
          hp: ws.playerState.hp, shield: ws.playerState.shield,
        });
      }
    }
  }

  // === v1.621: POLICE-VÅGOR under alarm-fas (skippas under cease-fire) ===
  // v1.655: inner-drill PAUSAR INTE längre polisen helt (det gjorde den farligaste,
  // högst-belönade fasen till ett gratis safe-room). Istället fortsätter vågorna men
  // i lugnare takt (35s vs 20s) → genuin greed-vs-risk utan att bli brutalt.
  const ceasefireActive = (sim.heistCeasefireUntil || 0) > nowMs;
  const innerDrilling = !!sim.heistInnerDrilling;
  if (sim.heistPhase === 'alarm' && !ceasefireActive) {
    if (!sim._heistNextPoliceAt) sim._heistNextPoliceAt = nowMs + 5000; // första vågen 5s in i alarm
    if (nowMs >= sim._heistNextPoliceAt) {
      sim._heistNextPoliceAt = nowMs + (innerDrilling ? 35000 : 20000); // lugnare under inner-drill
      _heistSpawnPoliceWave(sim, arena, nowMs);
    }
  } else if (sim.heistPhase === 'extract' && !ceasefireActive) {
    // Mer aggressivt under extract — police var 12s
    if (!sim._heistNextPoliceAt) sim._heistNextPoliceAt = nowMs + 3000;
    if (nowMs >= sim._heistNextPoliceAt) {
      sim._heistNextPoliceAt = nowMs + 12000;
      _heistSpawnPoliceWave(sim, arena, nowMs);
    }
  }

  // === v1.621: ENEMY-AI (cops targetar nearest player via updateEnemy) ===
  // v1.626: Under cease-fire FRYSER cops — ingen rörelse, inget skytte
  // v1.651: Cops som inte är inne i banken får en VIRTUELL player vid
  // bank-entry som target → de springer mot entrén FÖRSTA. När de når
  // entrén switchar de till riktiga players. Förhindrar att de fastnar
  // mot ytterväggen utanför entrén.
  if (sim.enemies && sim.enemies.length > 0 && !ceasefireActive) {
    const heistPlayers = [];
    for (const [pid, ws] of sim.room.members) {
      if (!ws.playerState || ws.playerState.hp <= 0) continue;
      heistPlayers.push({
        peerId: pid, _isCoreTarget: false,
        x: ws.playerState.x, y: ws.playerState.y,
        hp: 99999, maxHp: 99999, invulnUntil: ws.playerState.invulnUntil || 0,
        r: 14, _wsRef: ws,
      });
    }
    if (heistPlayers.length > 0) {
      for (const e of sim.enemies) {
        if (!e || e.dead) continue;
        e._prevX = e.x; e._prevY = e.y;
        // v1.651: cop med entry-target → MANUELL movement direkt mot entry
        // (bypass updateEnemy's ideal-range-behavior + shoot-AI). När cop
        // når entry, switcha till normal AI. Förhindrar att cops fastnar
        // 280px från entrén "skjutandes på tom gata".
        let useNormalAI = true;
        if (e._heistCop && e._heistEntryPoint && !e._heistEnteredBank) {
          const insideBank = (e.x >= 620 && e.x <= 3380 && e.y >= 720 && e.y <= 3380);
          if (insideBank) {
            e._heistEnteredBank = true;
            e._heistEntryPoint = null; // släpp virtual target → normal AI
          } else {
            // Manuell move mot entry-point
            const dx = e._heistEntryPoint.x - e.x;
            const dy = e._heistEntryPoint.y - e.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 0.5) {
              e.x += (dx / d) * e.speed * dt;
              e.y += (dy / d) * e.speed * dt;
              e.facing = Math.atan2(dy, dx);
            }
            // Skip updateEnemy → ingen skytte, ingen separation, bara walk
            useNormalAI = false;
          }
        }
        if (useNormalAI) {
          updateEnemy(e, dt, nowMs, sim, heistPlayers);
        }
        _heistResolveWalls(e, arena);
      }
    }
    // Cleanup dead enemies + broadcast kills
    let killedAny = false;
    for (const e of sim.enemies) {
      if (e.dead && !e._heistKillBroadcast) {
        e._heistKillBroadcast = true;
        killedAny = true;
        sim.eventQueue.push({
          type: 'enemy_killed',
          i: e._idx, gold: 0, killerPid: e.lastDamagerPid || null,
          weaponId: e.lastDamagerWeapon || null,   // v2 E6 (additivt — V1 ignorerar)
          isBoss: false, isMiniBoss: false, x: e.x, y: e.y,
        });
      }
    }
    if (killedAny) sim.enemies = sim.enemies.filter(e => !e.dead);
  }

  // === v1.621/v1.623: EXTRACT-VAN SECURE (bags secured när player i extract-zon)
  // v1.623: Också secura fysiska dropped-bags som ligger i extract-zonen
  if (sim.heistPhase === 'extract' || sim.heistPhase === 'alarm') {
    const checkZone = (ez) => {
      if (!ez) return;
      // Säkra spelar-carrying bags
      for (const [pid, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0) continue;
        const ps = ws.playerState;
        const dx = ps.x - (ez.x + ez.w / 2);
        const dy = ps.y - (ez.y + ez.h / 2);
        if (Math.abs(dx) > ez.w / 2 + 40 || Math.abs(dy) > ez.h / 2 + 40) continue;
        const carrying = ws._heistBagsCarrying || 0;
        const value = ws._heistBagsValue || 0;
        if (carrying > 0) {
          sim.heistLootValue = (sim.heistLootValue || 0) + value;
          // v1.626: per-player scoreboard-tracking
          ws._heistStatSecured = (ws._heistStatSecured || 0) + value;
          ws._heistStatBags = (ws._heistStatBags || 0) + carrying;
          ws._heistBagsCarrying = 0;
          ws._heistBagsValue = 0;
          ws._heistBagsWeight = 0;
          ps.speedMul = 1.0;
          sim.eventQueue.push({
            type: 'heist_bags_secured',
            peerId: pid, bagsSecured: carrying, value, totalValue: sim.heistLootValue,
          });
        }
      }
      // Säkra fysiska dropped-bags som ligger i zonen
      if (sim.heistDroppedBags && sim.heistDroppedBags.length > 0) {
        const remaining = [];
        for (const bag of sim.heistDroppedBags) {
          const dx = bag.x - (ez.x + ez.w / 2);
          const dy = bag.y - (ez.y + ez.h / 2);
          if (Math.abs(dx) < ez.w / 2 + 40 && Math.abs(dy) < ez.h / 2 + 40) {
            sim.heistLootValue = (sim.heistLootValue || 0) + bag.value;
            sim.eventQueue.push({
              type: 'heist_bag_secured_loose',
              bagId: bag.id, value: bag.value, totalValue: sim.heistLootValue,
            });
          } else {
            remaining.push(bag);
          }
        }
        sim.heistDroppedBags = remaining;
      }
    };
    // v1.637: iterera ALLA extract-zones (front borttagen)
    if (arena.extractZones) {
      for (const k of Object.keys(arena.extractZones)) {
        const ez = arena.extractZones[k];
        if (!ez) continue;
        if (ez.locked && !(k === 'back' && sim.heistBackExtractUnlocked) && !(sim.heistUnlockedDoors && sim.heistUnlockedDoors[k])) continue;
        checkZone(ez);
      }
    }
  }

  // === HUD-broadcast (var 500ms) ===
  if (nowMs - (sim._heistHudBroadcastAt || 0) > 500) {
    sim._heistHudBroadcastAt = nowMs;
    // Per-player carrying-data (klient slår upp egen pid)
    const carrying = {};
    for (const [pid, ws] of sim.room.members) {
      if (ws._heistBagsCarrying) carrying[pid] = {
        count: ws._heistBagsCarrying,
        value: ws._heistBagsValue || 0,
      };
    }
    sim.eventQueue.push({
      type: 'heist_hud',
      phase: sim.heistPhase,
      elapsedSec: Math.round(elapsedMs / 1000),
      phaseElapsedSec: Math.round(phaseElapsedMs / 1000),
      drillProgress: sim.heistDrillProgress || 0,
      drilling: !!sim.heistDrilling,
      drillBlocked: !!sim.heistDrillBlocked,
      // v1.646: inner-drill state (gold-mega-stack-access)
      innerDrillProgress: sim.heistInnerDrillProgress || 0,
      innerDrilling: !!sim.heistInnerDrilling,
      innerDrillBlocked: !!sim.heistInnerDrillBlocked,
      innerVaultUnlocked: !!sim.heistInnerVaultUnlocked,
      lootValue: sim.heistLootValue || 0,
      lootBaggedCount: Object.keys(sim.heistLootBagged || {}).length,
      lootBagged: Object.keys(sim.heistLootBagged || {}),  // ID-lista
      vaultUnlocked: !!sim.heistVaultUnlocked,
      carrying,  // { pid: { count, value } }
      // v1.623: fysiska dropped bags
      droppedBags: (sim.heistDroppedBags || []).map(b => ({
        id: b.id, x: Math.round(b.x), y: Math.round(b.y), value: b.value,
      })),
      backExtractUnlocked: !!sim.heistBackExtractUnlocked,
      unlockedDoors: sim.heistUnlockedDoors || {},
      // v1.626: cease-fire remaining ms
      ceasefireRemainMs: Math.max(0, (sim.heistCeasefireUntil || 0) - nowMs),
      // v1.650: total cease-fire-budget använt (för cap-visualisering)
      ceasefireTotalMs: sim.heistTotalCeasefireMs || 0,
      // v1.650: nästa police-våg countdown (negativ om "om x ms")
      nextPoliceInMs: (sim.heistPhase === 'alarm' || sim.heistPhase === 'extract')
        ? Math.max(0, (sim._heistNextPoliceAt || 0) - nowMs)
        : 0,
      // v1.651: cameras som ser någon player just nu → klient färgar cone röd
      seenCameras: Object.keys(sim._heistSeenCamerasThisTick || {}),
    });
  }
  // === v1.622: NPC-broadcast (var 200ms = 5Hz för positionssync) ===
  if (nowMs - (sim._heistNpcBroadcastAt || 0) > 200) {
    sim._heistNpcBroadcastAt = nowMs;
    const npcs = [];
    for (const n of (sim.heistNPCs || [])) {
      if (n.dead) continue;
      npcs.push({
        id: n.id, t: n.type, st: n.subType,
        x: Math.round(n.x), y: Math.round(n.y),
        s: n.state, f: Math.round(n.facing * 100) / 100,
        cn: n.cone || 0, rg: n.range || 0,
      });
    }
    sim.eventQueue.push({ type: 'heist_npcs', npcs });
  }
}

// v1.626: HEIST difficulty-multipliers (matchar CD-pattern)
function _heistDifficultyMul(sim) {
  const d = (sim && sim.config && sim.config.difficulty) || 'veteran';
  // [policeCount, copHP, copDmg, drillTime, cameraGraceMs, playerHpMul]
  switch (d) {
    case 'casual':    return { policeCount: 0.5, copHp: 0.7, copDmg: 0.6, drillTime: 0.7, cameraGraceMs: 3000, playerHp: 1.5 };
    case 'recruit':   return { policeCount: 0.7, copHp: 0.85, copDmg: 0.8, drillTime: 0.85, cameraGraceMs: 2500, playerHp: 1.2 };
    case 'veteran':   return { policeCount: 1.0, copHp: 1.0, copDmg: 1.0, drillTime: 1.0, cameraGraceMs: 2000, playerHp: 1.0 };
    case 'hard':      return { policeCount: 1.2, copHp: 1.15, copDmg: 1.15, drillTime: 1.15, cameraGraceMs: 1700, playerHp: 0.9 };
    case 'hardcore':  return { policeCount: 1.3, copHp: 1.2, copDmg: 1.2, drillTime: 1.2, cameraGraceMs: 1500, playerHp: 0.85 };
    case 'nightmare': return { policeCount: 1.5, copHp: 1.4, copDmg: 1.3, drillTime: 1.35, cameraGraceMs: 1200, playerHp: 0.75 };
    case 'insane':    return { policeCount: 1.6, copHp: 1.6, copDmg: 1.5, drillTime: 1.5, cameraGraceMs: 1000, playerHp: 0.6 };
    default:          return { policeCount: 1.0, copHp: 1.0, copDmg: 1.0, drillTime: 1.0, cameraGraceMs: 2000, playerHp: 1.0 };
  }
}

// v1.622: HEIST NPC tick — civilians + guards
function _heistTickNPCs(sim, dt, nowMs, arena) {
  if (!sim.heistNPCs) return;
  // Bygg quick player-list för range-checks
  const players = [];
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    players.push({
      peerId: pid,
      x: ws.playerState.x, y: ws.playerState.y,
      weaponId: ws.playerState.weaponId || 'pistol',
      _wsRef: ws,
    });
  }
  for (const npc of sim.heistNPCs) {
    if (npc.dead) continue;
    if (npc.type === 'civilian') _heistTickCivilian(npc, dt, nowMs, sim, players, arena);
    else if (npc.type === 'guard') _heistTickGuard(npc, dt, nowMs, sim, players, arena);
  }
}

function _heistTickCivilian(npc, dt, nowMs, sim, players, arena) {
  // v1.623: HOSTAGE-state — civilian sitter still, ingen panik, ingen alarm-trigger
  if (npc.state === 'hostage') {
    // Stå still; om alarm triggas av annan källa, hostages bara stannar
    return;
  }
  // v1.652: CALMED-state (Medic medic_calm action) — ingen panic på 15s
  if (npc.state === 'calmed') {
    if (nowMs > (npc._calmedUntil || 0)) {
      // Tillbaka till idle, kan paniska igen vid weapon-sight
      npc.state = 'idle';
    }
    // Annars stå still, ingen panic-trigger
    return;
  }
  // v1.644: spara prev-pos för tunnel-resistent wall-resolve
  npc._prevX = npc.x; npc._prevY = npc.y;
  if (npc.state === 'idle' && sim.heistPhase === 'stealth') {
    // v1.626: Cashier-patrol — lämnar counter var ~30s i ~10s (break-window)
    // Detta öppnar ett window för stealth-player att smyga genom counter-gap utan
    // att triggera panik. Bara cashier-typ får den här rörelsen.
    const isCashier = npc.subType === 'cashier';
    if (isCashier && !npc._cashierBreakUntil) {
      // Initiera break-schedule
      npc._cashierNextBreakAt = nowMs + 25000 + Math.random() * 10000;
    }
    if (isCashier && nowMs > (npc._cashierNextBreakAt || 0)) {
      npc._cashierBreakUntil = nowMs + 10000;
      npc._cashierNextBreakAt = nowMs + 35000 + Math.random() * 10000;
      // Walk to a "break room" position (söder om counter, lobby-zon)
      npc._wanderTarget = {
        x: npc.hx + (Math.random() - 0.5) * 200,
        y: npc.hy + 400 + Math.random() * 150,
      };
      npc._wanderUntil = nowMs + 12000;
    }
    if (isCashier && npc._cashierBreakUntil && nowMs > npc._cashierBreakUntil) {
      // Back to counter
      npc._cashierBreakUntil = 0;
      npc._wanderTarget = { x: npc.hx, y: npc.hy };
      npc._wanderUntil = nowMs + 8000;
    }
    // Wander runt home-position (default + break-rörelse)
    if (!npc._wanderTarget || nowMs > (npc._wanderUntil || 0)) {
      npc._wanderTarget = {
        x: npc.hx + (Math.random() - 0.5) * 80,
        y: npc.hy + (Math.random() - 0.5) * 60,
      };
      npc._wanderUntil = nowMs + 3000 + Math.random() * 4000;
    }
    const dx = npc._wanderTarget.x - npc.x;
    const dy = npc._wanderTarget.y - npc.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 4) {
      // Snabbare när på break-walk (target långt iväg)
      const speedMul = npc._cashierBreakUntil ? 0.6 : 0.3;
      npc.x += (dx / d) * (npc.speed * speedMul) * dt;
      npc.y += (dy / d) * (npc.speed * speedMul) * dt;
      npc.facing = Math.atan2(dy, dx);
    }
    // Detect player med vapen draget — kräver LOS (line-of-sight via walls)
    for (const p of players) {
      const pdx = p.x - npc.x, pdy = p.y - npc.y;
      if (pdx * pdx + pdy * pdy >= 180 * 180) continue;
      if (p.weaponId === 'fists') continue;
      // v1.625: LOS-check — wall mellan civilian och player → ingen panik
      if (_heistLineBlockedByWall(npc.x, npc.y, p.x, p.y, arena)) continue;
      npc.state = 'panic';
      npc._panicTarget = _heistNearestExit(npc.x, npc.y, arena);
      sim.eventQueue.push({ type: 'heist_civilian_panic', npcId: npc.id, x: npc.x, y: npc.y });
      break;
    }
  } else if (npc.state === 'panic') {
    // Spring mot närmaste exit
    if (!npc._panicTarget) npc._panicTarget = _heistNearestExit(npc.x, npc.y, arena);
    const dx = npc._panicTarget.x - npc.x;
    const dy = npc._panicTarget.y - npc.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 40) {
      // Reached exit → trigger alarm
      npc.state = 'escaped';
      npc.dead = true;
      if (sim.heistPhase === 'stealth') {
        sim.heistAlarmTriggered = true;
        sim.eventQueue.push({ type: 'heist_civilian_escaped', npcId: npc.id });
      }
    } else {
      // Snabbare under panik
      npc.x += (dx / d) * npc.speed * 1.8 * dt;
      npc.y += (dy / d) * npc.speed * 1.8 * dt;
      npc.facing = Math.atan2(dy, dx);
    }
  }
  // v1.641: blockera mot väggar så civilians inte panic-springer genom desks
  _heistResolveWalls(npc, arena);
}

function _heistTickGuard(npc, dt, nowMs, sim, players, arena) {
  // Bara aktiva i stealth-fas. Vid alarm: konverteras till enemies.
  if (sim.heistPhase !== 'stealth') return;
  // v1.644: spara prev-pos för tunnel-resistent wall-resolve
  npc._prevX = npc.x; npc._prevY = npc.y;
  // v1.652: DISTRACTED-state (Tank distract_guard action) — vänd bort, ingen
  // patrol-movement eller vision-detect på 5s. Bryts vid timeout.
  if (npc._distractedUntil && nowMs < npc._distractedUntil) {
    return; // stå still, ingen detect
  }
  if (npc._distractedUntil && nowMs >= npc._distractedUntil) {
    npc._distractedUntil = 0;
    if (npc.state === 'distracted') npc.state = 'patrol'; // tillbaka till normal
  }
  if (npc.state === 'patrol') {
    if (!npc.patrolPoints || npc.patrolPoints.length === 0) return;
    const target = npc.patrolPoints[npc.patrolIdx];
    const dx = target[0] - npc.x, dy = target[1] - npc.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 8) {
      // Pause vid waypoint, sen byt
      if (!npc._patrolPauseUntil) npc._patrolPauseUntil = nowMs + 1200;
      if (nowMs > npc._patrolPauseUntil) {
        npc.patrolIdx = (npc.patrolIdx + 1) % npc.patrolPoints.length;
        npc._patrolPauseUntil = 0;
      }
    } else {
      npc.x += (dx / d) * npc.speed * dt;
      npc.y += (dy / d) * npc.speed * dt;
      npc.facing = Math.atan2(dy, dx);
    }
    // Vision-cone check — kräver LOS (wall blockerar)
    for (const p of players) {
      const pdx = p.x - npc.x, pdy = p.y - npc.y;
      const d2 = pdx * pdx + pdy * pdy;
      if (d2 > npc.range * npc.range) continue;
      const angTo = Math.atan2(pdy, pdx);
      let angDiff = angTo - npc.facing;
      while (angDiff > Math.PI) angDiff -= 2 * Math.PI;
      while (angDiff < -Math.PI) angDiff += 2 * Math.PI;
      if (Math.abs(angDiff) > npc.cone) continue;
      // v1.625: LOS-check så guard inte ser genom väggar
      if (_heistLineBlockedByWall(npc.x, npc.y, p.x, p.y, arena)) continue;
      // Player seen!
      npc.state = 'alert';
      npc._alertUntil = nowMs + 1500;
      npc._alertTarget = { x: p.x, y: p.y };
      sim.eventQueue.push({ type: 'heist_guard_alert', guardId: npc.id });
      break;
    }
  } else if (npc.state === 'alert') {
    // Stå still och titta på senast sedda position
    if (npc._alertTarget) {
      const dx = npc._alertTarget.x - npc.x;
      const dy = npc._alertTarget.y - npc.y;
      npc.facing = Math.atan2(dy, dx);
    }
    if (nowMs > (npc._alertUntil || 0)) {
      // Bekräfta sight + trigga alarm
      sim.heistAlarmTriggered = true;
      sim.eventQueue.push({ type: 'heist_guard_alarm', guardId: npc.id });
      npc.state = 'patrol'; // återgår, men alarm har triggats
    }
  }
  // v1.641: blockera mot väggar så vaktar inte patrullerar genom väggarna
  _heistResolveWalls(npc, arena);
}

function _heistNearestExit(x, y, arena) {
  // v1.625: välj närmaste exit av front/back (om back är låst, default front)
  const exits = [{ x: 2000, y: 3500, id: 'front' }];
  if (arena && arena.extractZones && arena.extractZones.back) {
    exits.push({ x: 1950, y: 600, id: 'back' });
  }
  let best = exits[0], bestD2 = Infinity;
  for (const e of exits) {
    const dx = e.x - x, dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

// v1.625: Liang-Barsky line-vs-AABB — true om wall mellan (x0,y0) och (x1,y1)
function _heistLineBlockedByWall(x0, y0, x1, y1, arena) {
  if (!arena || !arena.walls) return false;
  const dx = x1 - x0, dy = y1 - y0;
  for (const w of arena.walls) {
    // Skip non-wall types (counter/pillar är lågt cover, blockerar inte LOS)
    if (w.kind !== 'wall' && w.kind !== 'wall_vault') continue;
    let tMin = 0, tMax = 1;
    const checks = [
      { p: -dx, q: x0 - w.x },
      { p:  dx, q: w.x + w.w - x0 },
      { p: -dy, q: y0 - w.y },
      { p:  dy, q: w.y + w.h - y0 },
    ];
    let blocked = true;
    for (const c of checks) {
      if (c.p === 0) {
        if (c.q < 0) { blocked = false; break; }
      } else {
        const t = c.q / c.p;
        if (c.p < 0) {
          if (t > tMax) { blocked = false; break; }
          if (t > tMin) tMin = t;
        } else {
          if (t < tMin) { blocked = false; break; }
          if (t < tMax) tMax = t;
        }
      }
    }
    if (blocked && tMin <= tMax) return true;
  }
  return false;
}

// v1.641: circle-vs-AABB push-out så NPCs/cops inte går igenom väggar.
// Samma wall-set som LOS-checken (kind='wall' eller 'wall_vault'). Counters/pillars
// behåller bullet-through-cover-pattern — de pushar inte heller actorn.
// v1.644: Tunnel-skydd. Om actor center hamnar INUTI en tunn vägg (h=25), använd
// actor._prevX/_prevY som referens för att välja vilken kant att pusha till —
// annars kan "närmaste kant"-fallbacken pusha actor IGENOM väggen till andra sidan.
function _heistResolveWalls(actor, arena) {
  if (!arena || !arena.walls) return;
  const r = actor.r || 14;
  for (const w of arena.walls) {
    if (w.kind !== 'wall' && w.kind !== 'wall_vault') continue;
    const cx = Math.max(w.x, Math.min(actor.x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(actor.y, w.y + w.h));
    const dx = actor.x - cx, dy = actor.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = r - d;
        actor.x += (dx / d) * push;
        actor.y += (dy / d) * push;
      } else {
        // Center inuti rect — använd prev pos om finns för att välja rätt sida
        const px = (typeof actor._prevX === 'number') ? actor._prevX : actor.x;
        const py = (typeof actor._prevY === 'number') ? actor._prevY : actor.y;
        const wasLeftOf = px < w.x;
        const wasRightOf = px > w.x + w.w;
        const wasAbove = py < w.y;
        const wasBelow = py > w.y + w.h;
        if (wasLeftOf)        actor.x = w.x - r;
        else if (wasRightOf)  actor.x = w.x + w.w + r;
        else if (wasAbove)    actor.y = w.y - r;
        else if (wasBelow)    actor.y = w.y + w.h + r;
        else {
          // Fallback: ingen prev-info → pusha till närmaste kant
          const dl = actor.x - w.x;
          const dright = (w.x + w.w) - actor.x;
          const dtop = actor.y - w.y;
          const dbot = (w.y + w.h) - actor.y;
          const minEdge = Math.min(dl, dright, dtop, dbot);
          if (minEdge === dl) actor.x = w.x - r;
          else if (minEdge === dright) actor.x = w.x + w.w + r;
          else if (minEdge === dtop) actor.y = w.y - r;
          else actor.y = w.y + w.h + r;
        }
      }
    }
  }
}

// v1.642: Applicera heist-role-effekter på ws. Återanvänds av både match-init
// (lobby-default 'hacker' om ej picked) och in-game role-picker (sim_heist_action
// type='pick_role'). Resetterar fält så re-apply inte stackar.
function _heistApplyRole(ws, role, sim, arena) {
  if (!ws || !ws.playerState) return;
  const validRoles = ['hacker', 'tank', 'medic', 'rogue'];
  if (validRoles.indexOf(role) < 0) role = 'hacker';
  // Reset role-specifika fält så re-apply är idempotent
  ws.playerState.speedMul = 1.0;
  ws._heistCameraImmune = false;
  ws._heistMedicRegenRate = 0;
  ws._heistMedicRegenAccum = 0;
  ws._heistRole = role;
  const _diffHpMul = _heistDifficultyMul(sim).playerHp;
  const baseMax = (arena && arena.maxHp) || 100;
  if (role === 'tank') {
    ws.playerState.maxHp = Math.round(baseMax * 1.5 * _diffHpMul);
    ws.playerState.speedMul = 0.9;
  } else if (role === 'medic') {
    ws.playerState.maxHp = Math.round(baseMax * _diffHpMul);
    ws._heistMedicRegenRate = _realMemberCount(sim) <= 1 ? 8 : 6;
  } else if (role === 'hacker') {
    ws.playerState.maxHp = Math.round(baseMax * _diffHpMul);
    ws._heistCameraImmune = true;
  } else if (role === 'rogue') {
    ws.playerState.maxHp = Math.round(baseMax * 0.9 * _diffHpMul);
    ws.playerState.speedMul = 1.1;
  }
  // Re-clamp HP mot ny maxHp (om sänkt) + topp upp om höjt
  ws.playerState.hp = Math.min(ws.playerState.hp || baseMax, ws.playerState.maxHp);
  if (ws.playerState.hp < ws.playerState.maxHp && !ws._heistRoleLocked) {
    // Före lock: topp upp full HP (lobby/start-of-match)
    ws.playerState.hp = ws.playerState.maxHp;
  }
  // Återapplicera bag-carry-weight ovanpå role-speed (rogue + bags = slow + 10%)
  if (ws._heistBagsWeight) {
    ws.playerState.speedMul *= Math.max(0.4, 1 - ws._heistBagsWeight);
  }
}

// v1.653: Tidigare konverterade vakter inuti banken till cops i samma position
// → spelaren såg "cops spawna i random rum" mid-alarm. Nu evakuerar vakterna
// istället (springer mot närmaste exit, försvinner) + sim triggar omedelbart
// första police-våg från GATAN. Clear separation: stealth=guards inne,
// alarm/extract=police utifrån.
function _heistConvertGuardsToEnemies(sim) {
  if (!sim.heistNPCs) return;
  // Sätt alla vakter till "panic"-state med exit som mål — de springer ut
  // som civilians, försvinner när de når exit.
  const arena = HEIST_ARENA;
  for (const npc of sim.heistNPCs) {
    if (npc.type !== 'guard' || npc.dead) continue;
    npc.state = 'panic'; // återanvänder civilian-panic-logik
    npc._panicTarget = _heistNearestExit(npc.x, npc.y, arena);
    npc._distractedUntil = 0;
    // _heistTickCivilian hanterar panic → 'escaped' + dead när reached exit.
    // Men guards har type='guard' så de tickas av _heistTickGuard. Override
    // typen så de hanteras av civilian-tick istället.
    npc.type = 'civilian';
    npc.subType = 'evacuating_guard'; // klient renderar dem fortfarande som guards
    npc.cone = 0; // ingen vision-cone-render
    npc.range = 0;
  }
  // Direkt police-våg så player inte står still i tomt rum vid alarm-start
  if (typeof _heistSpawnPoliceWave === 'function') {
    _heistSpawnPoliceWave(sim, arena, Date.now());
  }
}

// v1.621: Spawna en polis-våg från random arena.policeSpawns
// v1.626: Difficulty-skalning (casual=0.5x, veteran=1.0x, hardcore=1.3x, insane=1.6x)
// v1.651: Filterera bort needsBack-spawns om back-door inte är lockpickad
// (cops skulle fastna mot låst back-door wall). Plus tagga e._heistEntryPoint
// så _heistTickPoliceEntryNav kan styra dem mot bank-entry FÖRE player.
function _heistSpawnPoliceWave(sim, arena, nowMs) {
  if (!arena.policeSpawns || arena.policeSpawns.length === 0) return;
  const playerCount = Math.max(1, _realMemberCount(sim));
  const scaling = arena.scaling || {};
  const policeMul = 1 + ((playerCount - 1) * (scaling.policeMulPerPlayer || 0.25));
  const diffMul = _heistDifficultyMul(sim).policeCount;
  const baseCount = 3 + Math.floor(Math.random() * 3); // 3-5
  const totalCount = Math.max(1, Math.round(baseCount * policeMul * diffMul));
  const enemyCap = 120;
  // Filterera tillgängliga spawns: back-alley-spawns kräver back-door öppen
  const validSpawns = arena.policeSpawns.filter(sp =>
    !sp.needsBack || sim.heistBackExtractUnlocked
  );
  if (validSpawns.length === 0) return;
  let spawned = 0;
  for (let i = 0; i < totalCount && sim.enemies.length < enemyCap; i++) {
    const sp = validSpawns[Math.floor(Math.random() * validSpawns.length)];
    // Variera spawn-pos ±50px så hela vågen inte ligger på exakt samma punkt
    const sx = sp.x + (Math.random() - 0.5) * 80;
    const sy = sp.y + (Math.random() - 0.5) * 80;
    // Random soldier/shooter mix för variation
    const type = Math.random() < 0.3 ? 'shooter' : 'soldier';
    const e = makeEnemy(type, sx, sy);
    if (!e) continue;
    e._idx = sim.nextEnemyIdx++;
    e._heistCop = true;
    e._cdEnemy = true; // re-use CD-tagging för hit-detection-paths
    e._cdRole = 'attacker'; // chase player, not core
    // v1.651: entry-navigation — cop går till bank-entry FÖRE den jagar player.
    // Förhindrar att cops fastnar mot ytterväggen sökandes "kortaste vägen".
    if (sp.entry) {
      e._heistEntryPoint = { x: sp.entry.x, y: sp.entry.y };
      e._heistEnteredBank = false;
    }
    const dm = _heistDifficultyMul(sim);
    e.hp = Math.max(1, Math.round(e.hp * dm.copHp));
    e.maxHp = e.hp;
    e.dmg = Math.max(1, Math.round(e.dmg * dm.copDmg));
    if (e.bulletDmg) e.bulletDmg = Math.max(1, Math.round(e.bulletDmg * dm.copDmg));
    e._origSpeed = e.speed;
    sim.enemies.push(e);
    spawned++;
  }
  if (spawned > 0) {
    sim.eventQueue.push({ type: 'heist_police_wave', count: spawned });
  }
}

// v1.626: bygger per-player scoreboard för end-match-event
function _heistBuildScoreboard(sim) {
  const rows = [];
  for (const [pid, ws] of sim.room.members) {
    if (ws._isBot) continue;
    rows.push({
      peerId: pid,
      name: ws.name || 'Player',
      role: ws._heistRole || 'hacker',
      secured: ws._heistStatSecured || 0,
      bags: ws._heistStatBags || 0,
      hostages: ws._heistStatHostages || 0,
      alive: !!(ws.playerState && ws.playerState.hp > 0),
    });
  }
  rows.sort((a, b) => b.secured - a.secured);
  return rows;
}

function _heistTransitionPhase(sim, newPhase, reason, nowMs) {
  sim.heistPhase = newPhase;
  sim.heistPhaseStartT = nowMs;
  sim.eventQueue.push({
    type: 'heist_phase_change',
    phase: newPhase,
    reason,
  });
  // v1.622: vid stealth → alarm, konvertera alla guards till enemies
  if (newPhase === 'alarm' && typeof _heistConvertGuardsToEnemies === 'function') {
    _heistConvertGuardsToEnemies(sim);
  }
}

function endBattleRoyaleMatch(sim, winnerId, reason) {
  if (sim.battleroyaleEnded) return;
  sim.battleroyaleEnded = true;
  sim.battleroyaleWinner = winnerId;
  // GULAG (v1.790): matchen är slut — avbryt ev. pågående dueller, spelare blir spectators.
  voidAllGulag(sim);
  // Winner får placement 1 (om de var alive)
  if (winnerId && !sim.battleroyaleRanks[winnerId]) {
    sim.battleroyaleRanks[winnerId] = 1;
  }
  // v1.798: spelare som var i GULAG (kö ELLER duell) när matchen slutade saknar rank
  // (enterGulag eliminerar dem ej) → annars visar scoreboarden 999. Ge dem rank =
  // aliveCount (de var ej riktigt eliminerade) så placeringen blir rimlig.
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    if (!sim.battleroyaleRanks[pid] && !sim.battleroyaleEliminated.includes(pid)) {
      sim.battleroyaleRanks[pid] = pid === winnerId ? 1 : Math.max(2, sim.battleroyaleAliveCount);
    }
  }
  const stats = { perPlayer: {}, winner: winnerId, reason };
  for (const [p, _ws] of sim.room.members) {
    if (_ws && _ws.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
    stats.perPlayer[p] = {
      placement: sim.battleroyaleRanks[p] || 999,
      kills: sim.battleroyaleKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
    };
  }
  sim.eventQueue.push({
    type: 'br_match_end',
    winner: winnerId, reason, stats,
  });
}

// Kallas från bullets.js när PvP-kill registreras i BR
// GUARD: Shotgun spawnar flera pellets per tick — alla räknas som "kill" om
// vi guardar bara via eliminated-listan (som uppdateras senare i tick).
// Använd även victimWs._brCreditedKill för att markera at offret redan
// gett credit till en killer den här ticken.
// v2 E6 (additivt): srcWeaponId (valfri, bara från explode) — se handleJuggernautKill.
function handleBattleRoyaleKill(sim, killerPid, killerWs, victimPid, victimWs, weaponId, srcWeaponId) {
  if (sim.battleroyaleEnded) return;
  // PRE-DROP: inga kills medan luftfasen är aktiv, eller om någondera är på buss/i luft
  // (täcker en kula i farten vid predrop→LOOT-sömmen).
  if (sim.brPredrop) return;
  if (killerWs && killerWs.playerState && killerWs.playerState.brAir) return;
  if (victimWs && victimWs.playerState && victimWs.playerState.brAir) return;
  if (!sim.room.members.has(killerPid)) return;
  // GUARD 1: redan eliminated (force-stop)
  if (sim.battleroyaleEliminated.includes(victimPid)) return;
  // GUARD 2: redan crediterad denna tick (multi-pellet shotgun)
  if (victimWs._brCreditedKill) return;
  victimWs._brCreditedKill = true;
  // v1.655: Flaggan nollställs vid nästa tick-start i tickBattleRoyale (inte via
  // per-kill setTimeout — det läckte en timer per kill + höll ws-ref vid liv).
  sim.battleroyaleKillsByPid[killerPid] = (sim.battleroyaleKillsByPid[killerPid] || 0) + 1;
  // KILL-REWARD: $150 cash till killer (Warzone-style).
  brAwardCash(sim, killerPid, 150);
  // BOUNTY (v1.746): hade killern ett bounty-kontrakt på OFFRET → belöning $1200 + done.
  if (killerWs && killerWs.playerState && killerWs.playerState.brContract &&
      killerWs.playerState.brContract.type === 'bounty' && killerWs.playerState.brContract.target === victimPid) {
    brAwardCash(sim, killerPid, 1200);
    brFinishContract(sim, killerPid, true, 'Bounty +$1200!');
  }
  // Death-detection-loopen i tickBattleRoyale tar hand om eliminated-flag,
  // men vi emit:ar kill-event här för killfeed.
  sim.eventQueue.push({
    type: 'br_kill',
    killer: killerPid,
    victim: victimPid,
    weapon: weaponId || null,
    weaponId: srcWeaponId || weaponId || null,   // v2 E6
  });
}

// === BR EKONOMI/BUY-STATIONS/ARMOR (v1.739) ===
// Lägg till cash + emit:a br_cash_update (klampat ≥0, tak 999999).
function brAwardCash(sim, pid, amount) {
  if (!pid || !amount) return;
  if (!sim.brCash) sim.brCash = {};
  sim.brCash[pid] = Math.max(0, Math.min(999999, (sim.brCash[pid] || 0) + amount));
  sim.eventQueue.push({ type: 'br_cash_update', peerId: pid, cash: sim.brCash[pid] });
}

// Välj buy-stations: var 3:e stuga (utseende-identisk med vanliga hus) + alien-shop i
// lila SE-hörnet. Minst 12 vanliga. Deterministiskt (ingen RNG) → samma varje match.
function computeBrBuyStations(arena) {
  const stations = [];
  // V2 (user 2026-06-24): INGA shop-HUS längre — alla hus är vanliga. Shoppar är nu
  // 3 dedikerade NPC:er (arena.brShops): radie-baserade (man går FRAM till handlaren),
  // markerade npc:true så klienten ritar en tydlig shopkeeper + skylt + minimap-prick.
  for (const sh of (arena.brShops || [])) {
    stations.push({
      x: Math.round(sh.x), y: Math.round(sh.y),
      r: sh.r || 150,
      npc: true,
      name: sh.name || 'SHOP',
      alien: false,
    });
  }
  // ALIEN-SHOP = SJÄLVA UFO:t (användarkrav: "UFOT ska vara shoppen", ingen grön markör).
  // Stationen centrerad på UFO-vraket (collision { x:8754,y:8820,w:93,h:61 } → mitt 8800,8850)
  // + stor radie så man säkert kommer "nära nog" för att menyn ska upp (#UFO-shop-bug).
  stations.push({ x: 8800, y: 8850, r: 290, alien: true, name: 'ALIEN' });
  return stations;
}

// Validera att spelaren står vid en buy-station (anti-cheat). Hus-stationer kräver att
// man är HELT inne i husets bounds; alien-shoppen använder radie. Returnerar station|null.
function brStationNear(sim, ws) {
  if (!ws.playerState || !sim.brBuyStations) return null;
  const px = ws.playerState.x, py = ws.playerState.y;
  for (const s of sim.brBuyStations) {
    if (s.bounds) {
      const b = s.bounds;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return s;
    } else if (s.r) {
      const dx = px - s.x, dy = py - s.y;
      if (dx * dx + dy * dy <= s.r * s.r) return s;
    }
  }
  return null;
}

// ===========================================================================
// V2 BR-EKONOMI 2.0 — NIVÅ-BASERADE PERKS + BAG-FÖRBRUKNINGSVAROR
// ===========================================================================
// Perks köps en NIVÅ i taget (permanenta under matchen). costs[i] = pris för
// nivå i→i+1. cat = UI-kategori (move/surv/off). Bag-items är stackbara
// förbrukningsvaror som aktiveras under match. ENDA källan: alla shop-hus
// (house-stationer + alien-stationen) säljer samma katalog.
// OBS: håll dessa siffror i SYNK med V2-klientens BrLayer.PERK_DEFS/BAG_DEFS.
const BR_PERKS = {
  // RÖRELSE
  move_speed:  { cat: 'move', max: 5,  costs: [200, 260, 330, 410, 500] },                                   // +3% fart/nivå (klient)
  dash_cd:     { cat: 'move', max: 4,  costs: [200, 280, 380, 500] },                                         // -0.3s dash-cd/nivå (klient)
  // ÖVERLEVNAD
  max_hp:      { cat: 'surv', max: 4,  costs: [250, 320, 410, 520] },                                         // +25 maxHP/nivå (100→200)
  shield:      { cat: 'surv', max: 4,  costs: [250, 320, 410, 520] },                                         // +50 maxShield/nivå (200→400)
  dmg_redux:   { cat: 'surv', max: 10, costs: [150, 190, 230, 280, 330, 390, 450, 520, 600, 690] },           // -5% inkommande/nivå (tak -50%)
  // OFFENSIV
  self_revive: { cat: 'off',  max: 2,  costs: [350, 500] },                                                   // självåterupplivning (max 2)
  rapid_fire:  { cat: 'off',  max: 5,  costs: [220, 290, 370, 460, 560] },                                     // +5% eldhast/nivå (klient)
  fast_hands:  { cat: 'off',  max: 4,  costs: [200, 270, 350, 450] },                                          // +10% omladdning/nivå (klient)
  dmg:         { cat: 'off',  max: 10, costs: [200, 250, 310, 380, 460, 550, 650, 760, 880, 1010] },           // +5% skada/nivå (sim_shoot dmgMul)
};
// Bag-förbrukningsvaror (stackbara). field = playerState-räknarfält. max = stack-tak.
const BR_BAG = {
  uav:        { cost: 400, max: 5, field: 'uavCount' },
  medkit:     { cost: 250, max: 5, field: 'medkits' },
  shieldkit:  { cost: 250, max: 5, field: 'shieldkits' },
  adrenaline: { cost: 300, max: 5, field: 'adrenalines' },
  airstrike:  { cost: 500, max: 5, field: 'airstrikes' },
};
// ALIEN-SHOP (UFO, EME HIC-fliken) — ENGÅNGSKÖP (flagga på ps.brAlien[item]). Köps BARA vid
// alien-stationen (station.alien). Klient-applicerade: al_speed/al_dash_dist/al_dash_cd/al_zoom/
// al_skin/al_bighead (klienten reagerar på br_alien_bought). Server-applicerade: al_reveal
// (permanenta minimap-blips via UAV-loopen) + al_regen (passiv HP+shield i tickBrMeta).
const BR_ALIEN = {
  al_speed:     { cost: 750 },  // GRAVITAS NVLLA  — +15% move speed
  al_dash_dist: { cost: 500 },  // SALTVS LONGVS   — +25% dash distance
  al_dash_cd:   { cost: 550 },  // SALTVS CELER    — -1s dash cooldown
  al_reveal:    { cost: 700 },  // OCVLVS CAELI    — enemies near you on minimap
  al_zoom:      { cost: 500 },  // VISVS AMPLIOR   — zoom out ~25% (max med AWP, ej stack)
  al_regen:     { cost: 850 },  // SANATIO         — passiv HP+shield regen
  al_skin:      { cost: 300 },  // FIO ALIENIGENA  — alien-skin (kosmetiskt, matchen)
  al_bighead:   { cost: 300 },  // CAPVT MAGNVM    — stort alien-huvud (kosmetiskt)
};

// Inkommande-skada-reduktion från dmg_redux-perken (-5%/nivå, tak -50%). Läses
// LIVE av bullets.js (PvP) + _brAirstrikeDamage. Ersätter gamla armorLevel.
function brDmgRedux(ps) {
  const lvl = (ps && ps.brPerkLevels && ps.brPerkLevels.dmg_redux) || 0;
  return Math.min(0.5, 0.05 * lvl);
}

// Applicera en perk-nivås OMEDELBARA server-effekt (HP/shield-tak, self-revive-kit).
// move_speed/dash_cd/rapid_fire/fast_hands/dmg = klient-applicerade (server lagrar bara
// nivån + dmg clampas i applyShoot). dmg_redux = läses live via brDmgRedux.
function brApplyPerkEffect(sim, pid, ps, perk, level) {
  if (perk === 'max_hp') {
    ps.maxHp = Math.min(200, 100 + 25 * level);
    ps.hp = Math.min(ps.maxHp, (ps.hp || 0) + 25);
    sim.eventQueue.push({ type: 'br_maxstat', peerId: pid, maxHp: ps.maxHp, maxShield: ps.maxShield || 200, hp: ps.hp, shield: ps.shield || 0 });
  } else if (perk === 'shield') {
    ps.maxShield = Math.min(400, 200 + 50 * level);
    ps.shield = Math.min(ps.maxShield, (ps.shield || 0) + 50);
    sim.eventQueue.push({ type: 'br_maxstat', peerId: pid, maxHp: ps.maxHp || 100, maxShield: ps.maxShield, hp: ps.hp || 0, shield: ps.shield });
  } else if (perk === 'self_revive') {
    ps.selfReviveKits = level; // 1 eller 2
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'self_revive', count: ps.selfReviveKits });
  }
}

function applyBrBuy(sim, pid, itemKind) {
  if (!sim.battleroyaleActive || sim.battleroyaleEnded) return;
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  if (ws.playerState.brDowned) return; // ingen handel medan nedskjuten
  const station = brStationNear(sim, ws);
  if (!station) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'too_far' }); return; }
  const ps = ws.playerState;
  if (!ps.brPerkLevels) ps.brPerkLevels = {};
  const cash = sim.brCash[pid] || 0;
  // ── PERK (nivå-baserad) ──
  if (BR_PERKS[itemKind]) {
    const def = BR_PERKS[itemKind];
    const lvl = ps.brPerkLevels[itemKind] || 0;
    if (lvl >= def.max) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'full' }); return; }
    const cost = def.costs[lvl];
    if (cash < cost) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'no_cash' }); return; }
    ps.brPerkLevels[itemKind] = lvl + 1;
    brApplyPerkEffect(sim, pid, ps, itemKind, lvl + 1);
    brAwardCash(sim, pid, -cost);
    sim.eventQueue.push({ type: 'br_perk_level', peerId: pid, perk: itemKind, level: lvl + 1 });
    sim.eventQueue.push({ type: 'br_buy_ok', peerId: pid, item: itemKind });
    return;
  }
  // ── BAG-FÖRBRUKNINGSVARA (stackbar) ──
  if (BR_BAG[itemKind]) {
    const def = BR_BAG[itemKind];
    const cur = ps[def.field] || 0;
    if (cur >= def.max) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'full' }); return; }
    if (cash < def.cost) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'no_cash' }); return; }
    ps[def.field] = cur + 1;
    brAwardCash(sim, pid, -def.cost);
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: itemKind, count: ps[def.field] });
    sim.eventQueue.push({ type: 'br_buy_ok', peerId: pid, item: itemKind });
    return;
  }
  // ── ALIEN-SHOP (engångsköp, BARA vid alien-stationen / UFO:t) ──
  if (BR_ALIEN[itemKind]) {
    if (!station.alien) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'wrong_shop' }); return; }
    if (!ps.brAlien) ps.brAlien = {};
    if (ps.brAlien[itemKind]) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'owned' }); return; }
    const acost = BR_ALIEN[itemKind].cost;
    if (cash < acost) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'no_cash' }); return; }
    ps.brAlien[itemKind] = true;
    if (itemKind === 'al_regen') ps.passiveRegenActive = true;
    if (itemKind === 'al_reveal') ps.enemyRevealActive = true;
    if (itemKind === 'al_skin') ps.alienSkinActive = true;
    if (itemKind === 'al_bighead') ps.bigHeadActive = true;
    brAwardCash(sim, pid, -acost);
    sim.eventQueue.push({ type: 'br_alien_bought', peerId: pid, item: itemKind });
    sim.eventQueue.push({ type: 'br_buy_ok', peerId: pid, item: itemKind });
    return;
  }
  sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'unknown' });
}

// AUDIT C175: dev-cheat-allowlist. Bara dev-konton (default 86743226, utöka via DEV_ACCOUNT_IDS-env,
// komma-separerat) får trigga cheats — från VILKET bygge som helst (funkar även på TestFlight). Alla
// andra = no-op, även vid rå sim_br_infcash. Återanvänds av övriga cheat-handlers (sim_cd_infmoney m.fl.).
const DEV_ACCOUNTS = new Set((process.env.DEV_ACCOUNT_IDS || '86743226').split(',').map((s) => s.trim()).filter(Boolean));
function isDevAccount(ws) { return !!(ws && ws.accountId && DEV_ACCOUNTS.has(String(ws.accountId))); }

// Cash-cheat (4-klick nere till vänster → claima 100k) — dev-konto-gatad (säkerhets-gräns).
function applyBrInfCash(sim, pid) {
  if (!isDevAccount(sim.room.members.get(pid))) return;
  if (!sim.battleroyaleActive || sim.battleroyaleEnded) return;
  brAwardCash(sim, pid, 100000);
}

// Aktivera en bärbar UAV från bag → 20s fiende-reveal (v1.743).
function applyBrUseUav(sim, pid) {
  applyBrUseItem(sim, pid, 'uav');
}

// V2: aktivera en bag-förbrukningsvara (uav/medkit/shieldkit/adrenaline). Airstrike
// går via sim_br_airstrike (kräver minimap-markerad x,y). Server äger hp/shield →
// medkit/shieldkit appliceras server-side; adrenalin är klient-applicerad fart (server
// emit:ar bara fönstret) — anti-teleport-clampen (1000px/s) bundar ändå farten.
function applyBrUseItem(sim, pid, item) {
  if (!sim.battleroyaleActive || sim.battleroyaleEnded) return;
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.brDowned) return;
  const ps = ws.playerState;
  const now = Date.now();
  if (item === 'uav') {
    if ((ps.uavCount || 0) <= 0) return;
    ps.uavCount -= 1;
    ps.brUavUntil = now + 20000;
    sim.eventQueue.push({ type: 'br_uav_active', peerId: pid, until: ps.brUavUntil });
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'uav', count: ps.uavCount });
  } else if (item === 'medkit') {
    if ((ps.medkits || 0) <= 0) return;
    if ((ps.hp || 0) >= (ps.maxHp || 100)) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'full' }); return; }
    ps.medkits -= 1;
    // heal-over-time: 5 tick × 18 hp = 90 hp över 4s (en tick var 800ms)
    ps.brMedkitTicks = 5;
    ps.brMedkitNext = now + 800;
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'medkit', count: ps.medkits });
    sim.eventQueue.push({ type: 'br_heal_active', peerId: pid });
  } else if (item === 'shieldkit') {
    if ((ps.shieldkits || 0) <= 0) return;
    if ((ps.shield || 0) >= (ps.maxShield || 200)) { sim.eventQueue.push({ type: 'br_buy_fail', peerId: pid, reason: 'full' }); return; }
    ps.shieldkits -= 1;
    ps.shield = Math.min(ps.maxShield || 200, (ps.shield || 0) + 100);
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'shieldkit', count: ps.shieldkits });
    sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield });
  } else if (item === 'adrenaline') {
    if ((ps.adrenalines || 0) <= 0) return;
    ps.adrenalines -= 1;
    ps.brAdrenalineEnd = now + 8000;
    sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'adrenaline', count: ps.adrenalines });
    sim.eventQueue.push({ type: 'br_adrenaline', peerId: pid, until: ps.brAdrenalineEnd });
  }
}

// === CONTRACTS + SUPPLY DROPS (v1.746) ===
const BR_CONTRACT_SPOTS = [
  { x: 2000, y: 2000 }, { x: 7800, y: 2200 }, { x: 1800, y: 7400 },
  { x: 5000, y: 5000 }, { x: 8200, y: 5200 }, { x: 3800, y: 8400 },
];
const BR_CONTRACT_TYPES = ['bounty', 'dropbox', 'supply_run', 'hunt'];
const BR_SUPPLY_FALL_MS = 6000, BR_SUPPLY_INTERVAL_MS = 90000, BR_SUPPLY_PICK_R = 78; // 44→78: lådan är stor, plocka när man står FRAMFÖR den (ej exakt på mitten)

function computeBrContracts(sim, arena) {
  const out = [];
  for (let i = 0; i < BR_CONTRACT_SPOTS.length; i++) {
    const s = BR_CONTRACT_SPOTS[i];
    const sp = brFindFreeSpot(s.x, s.y, arena.walls, arena.worldW, arena.worldH);
    sim._brContractIdCtr = (sim._brContractIdCtr || 0) + 1;
    out.push({ id: 'brc_' + sim._brContractIdCtr, x: sp.x, y: sp.y, type: BR_CONTRACT_TYPES[i % BR_CONTRACT_TYPES.length], available: true, takenBy: null });
  }
  return out;
}

function brSpawnSupply(sim, x, y, fromContract) {
  const arena = BATTLEROYALE_ARENA;
  const sp = brFindFreeSpot(Math.max(200, Math.min(arena.worldW - 200, x)), Math.max(200, Math.min(arena.worldH - 200, y)), arena.walls, arena.worldW, arena.worldH);
  sim._brSupplyIdCtr = (sim._brSupplyIdCtr || 0) + 1;
  const drop = { id: 'brs_' + sim._brSupplyIdCtr, x: sp.x, y: sp.y, landAt: Date.now() + BR_SUPPLY_FALL_MS, landed: false, opened: false, fromContract: fromContract || null };
  sim.brSupplyDrops.push(drop);
  sim.eventQueue.push({ type: 'br_supply_spawn', id: drop.id, x: sp.x, y: sp.y, landAt: drop.landAt, fromContract: !!fromContract });
  return drop;
}

function applyBrAcceptContract(sim, pid, contractId) {
  if (!sim.battleroyaleActive || sim.battleroyaleEnded) return;
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.brDowned) return;
  const ps = ws.playerState;
  if (ps.brContract) { sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'busy' }); return; }
  const c = sim.brContracts.find(k => k.id === contractId);
  if (!c || !c.available) { sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'gone' }); return; }
  const dx = ps.x - c.x, dy = ps.y - c.y;
  if (dx * dx + dy * dy > 220 * 220) { sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'far' }); return; }
  c.available = false; c.takenBy = pid;
  const active = { id: c.id, type: c.type };
  if (c.type === 'bounty') {
    let cands = [];
    for (const [opid, ows] of sim.room.members) {
      // C143 (audit 2026-06-18): hoppa gulag-kämpar (off-map ~13000+, hp>0) som bounty-mål
      // — annars pingas en spelare mitt i sin gulag-duell ut på kartan.
      if (opid !== pid && ows.playerState && ows.playerState.hp > 0 && !ows.playerState.gulagState) cands.push(opid);
    }
    if (!cands.length) { c.available = true; c.takenBy = null; sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'no_target' }); return; }
    active.target = cands[(c.x + sim.battleroyaleAliveCount) % cands.length];
  } else if (c.type === 'supply_run') {
    // mål = en annan buy-station (helst en bit bort)
    let best = null, bestD = -1;
    for (const s of sim.brBuyStations) {
      if (s.alien) continue;
      const gx = s.bounds ? s.bounds.x + s.bounds.w / 2 : s.x, gy = s.bounds ? s.bounds.y + s.bounds.h / 2 : s.y;
      const d = (gx - ps.x) ** 2 + (gy - ps.y) ** 2;
      if (d > bestD && d > 400 * 400) { bestD = d; best = { x: gx, y: gy }; }
    }
    if (!best) best = { x: c.x + 600, y: c.y };
    active.goalX = Math.round(best.x); active.goalY = Math.round(best.y);
    active.deadline = Date.now() + 50000;
  } else if (c.type === 'dropbox') {
    const drop = brSpawnSupply(sim, c.x + 200, c.y + 120, pid);
    active.dropId = drop.id;
    active.goalX = drop.x; active.goalY = drop.y;
  } else if (c.type === 'hunt') {
    active.need = 5; active.got = 0;
  }
  ps.brContract = active;
  sim.eventQueue.push({ type: 'br_contract_active', peerId: pid, contract: active });
  sim.eventQueue.push({ type: 'br_contract_taken', id: c.id }); // alla: billboard-markör bort
}

// Belöning + slutför kontrakt. reason='done'|'fail'.
function brFinishContract(sim, pid, ok, msg) {
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || !ws.playerState.brContract) return;
  const ac = ws.playerState.brContract;
  ws.playerState.brContract = null;
  if (ok) sim.eventQueue.push({ type: 'br_contract_done', peerId: pid, contractType: ac.type, msg: msg || '' });
  else sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'expired' });
}

// Avbryt aktivt kontrakt (spelar-initierat). Frigor spelaren; billboard aterstalls ej.
function applyBrAbandonContract(sim, pid) {
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || !ws.playerState.brContract) return;
  ws.playerState.brContract = null;
  sim.eventQueue.push({ type: 'br_contract_fail', peerId: pid, reason: 'abandoned' });
}

// === BR CRITTERS (vilt) — jakt-kontrakt-mål + ambient liv ===
// 5 arter, ONE-SHOT (vilket spelar-skott som helst dödar). rabbit/deer/boar = passiva (flyr när
// spelare närmar sig, olika fart); wolf/bear = fientliga (jagar + attackerar). Samma vägg-kollision
// som spelare (resolveCtfWall via BR-broadphase-grid → O(local)).
const BR_CRITTER_SPECIES = [
  { type: 'rabbit', r: 13, speed: 205, wander: 72, flee: 360, hostile: false, hp: 1, count: 20 },
  { type: 'deer',   r: 20, speed: 150, wander: 62, flee: 320, hostile: false, hp: 1, count: 16 },
  { type: 'boar',   r: 22, speed: 92,  wander: 50, flee: 250, hostile: false, hp: 1, count: 11 },
  { type: 'wolf',   r: 20, speed: 150, wander: 74, flee: 0, hostile: true,  hp: 2, count: 9, detect: 560, atkR: 48, atkDmg: 10, atkCd: 800 },
  { type: 'bear',   r: 31, speed: 112, wander: 46, flee: 0, hostile: true,  hp: 3, count: 4, detect: 480, atkR: 62, atkDmg: 24, atkCd: 1100 },
];
function _brCritterSpec(type) {
  for (const s of BR_CRITTER_SPECIES) if (s.type === type) return s;
  return BR_CRITTER_SPECIES[0];
}
function spawnBrCritters(sim, arena) {
  sim.brCritters = [];
  const randPt = () => ({ x: 240 + Math.random() * (arena.worldW - 480), y: 240 + Math.random() * (arena.worldH - 480) });
  const addCritter = (type, x, y) => {
    const spec = _brCritterSpec(type);
    const sp = brFindFreeSpot(Math.max(240, Math.min(arena.worldW - 240, x)), Math.max(240, Math.min(arena.worldH - 240, y)), arena.walls, arena.worldW, arena.worldH);
    sim._brCritterIdCtr = (sim._brCritterIdCtr || 0) + 1;
    sim.brCritters.push({ id: 'brcr_' + sim._brCritterIdCtr, type, x: sp.x, y: sp.y,
      dead: false, hp: spec.hp, tx: sp.x, ty: sp.y, _repathAt: 0, _atkAt: 0, _aggroPid: null, _aggroUntil: 0, _face: 1, _moving: false, _r: spec.r });
  };
  // FLOCK/PACK-spawn: en kärna + medlemmar spridda nära (läses som ekosystem, ej jämna prickar)
  const group = (type, count, spread) => { const c = randPt(); for (let i = 0; i < count; i++) addCritter(type, c.x + (Math.random() - 0.5) * spread, c.y + (Math.random() - 0.5) * spread); };
  for (let i = 0; i < 4; i++) group('deer', 4, 380);    // 4 hjort-flockar = 16
  for (let i = 0; i < 3; i++) group('wolf', 3, 300);    // 3 varg-pack = 9
  for (let i = 0; i < 5; i++) group('boar', 2, 240);    // 5 vildsvins-par = 10
  addCritter('boar', randPt().x, randPt().y);           // +1 ensam = 11
  for (let i = 0; i < 4; i++) { const p = randPt(); addCritter('bear', p.x, p.y); }  // 4 ensamma björnar
  for (let i = 0; i < 5; i++) group('rabbit', 4, 220);  // 5 kanin-kullar = 20
}
// Hunt-kontrakt-kredit: öka got, emit progress, slutför vid need.
function brOnCritterKilled(sim, pid) {
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState) return;
  const ac = ws.playerState.brContract;
  if (!ac || ac.type !== 'hunt') return;
  ac.got = (ac.got || 0) + 1;
  sim.eventQueue.push({ type: 'br_contract_progress', peerId: pid, got: ac.got, need: ac.need });
  if (ac.got >= (ac.need || 5)) {
    brAwardCash(sim, pid, 700);
    sim.eventQueue.push({ type: 'br_grenades', peerId: pid, frag: 2 });
    brFinishContract(sim, pid, true, '+$700 + granater');
  }
}
// Varg/björn närkontakt-skada (shield→hp, som storm; död oaccrediterad = miljö).
function _brCritterAttack(sim, c, ps, vpid) {
  if (Date.now() < (ps.invulnUntil || 0)) return;
  const spec = _brCritterSpec(c.type);
  let remaining = spec.atkDmg;
  if ((ps.shield || 0) > 0) { const ab = Math.min(ps.shield, remaining); ps.shield -= ab; remaining -= ab; }
  if (remaining > 0) ps.hp = Math.max(1, ps.hp - remaining);   // ICKE-DÖDLIG: rovdjur chunkar dig till 1 hp (extremt farligt) men stjäl ej ditt gulag-liv
  if (vpid != null) {
    sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: vpid, hp: ps.hp, shield: ps.shield || 0, critterDmg: true });
    sim.eventQueue.push({ type: 'br_critter_attack', id: c.id, x: Math.round(c.x), y: Math.round(c.y), victim: vpid });
  }
}
// Per-tick AI. Kallas efter updateBullets i tickBattleRoyale.
function tickBrCritters(sim, dt, nowMs) {
  const arr = sim.brCritters;
  if (!arr || !arr.length) return;
  const arena = BATTLEROYALE_ARENA;
  const _rg = sim._brResolveGrid || (sim._brResolveGrid = buildWallGrid(arena.walls));
  let anyDead = false;
  for (const c of arr) {
    if (c.dead) { anyDead = true; continue; }
    const spec = _brCritterSpec(c.type);
    let np = null, npid = null, nd2 = Infinity;
    for (const [pid, ws] of sim.room.members) {
      const ps = ws.playerState;
      if (!ps || ps.hp <= 0 || ps.brDowned || ps.gulagState || ps.brAir) continue;
      const dx = ps.x - c.x, dy = ps.y - c.y, d2 = dx * dx + dy * dy;
      if (d2 < nd2) { nd2 = d2; np = ps; npid = pid; }
    }
    // sårad varg/björn jagar skytten (aggro) oavsett avstånd en stund
    if (spec.hostile && (c._aggroUntil || 0) > nowMs) {
      const aw = sim.room.members.get(c._aggroPid);
      if (aw && aw.playerState && aw.playerState.hp > 0 && !aw.playerState.brDowned && !aw.playerState.gulagState && !aw.playerState.brAir) {
        np = aw.playerState; npid = c._aggroPid; nd2 = (np.x - c.x) * (np.x - c.x) + (np.y - c.y) * (np.y - c.y);
      }
    }
    // Under BR drop-fasen: bara stroeva (ingen jakt/flykt/attack) saa inga skador infoers
    // medan combat aer fryst — men djuren roer sig saa luftburna spelare ser dem.
    if (sim.brPredrop) { np = null; npid = null; nd2 = Infinity; }
    let mvx = 0, mvy = 0, drifting = false;
    const chasing = spec.hostile && np && (nd2 < spec.detect * spec.detect || ((c._aggroUntil || 0) > nowMs && npid === c._aggroPid));
    const fleeing = !spec.hostile && np && nd2 < spec.flee * spec.flee;
    if (chasing) {
      const d = Math.sqrt(nd2) || 1; mvx = (np.x - c.x) / d; mvy = (np.y - c.y) / d;
      if (nd2 < spec.atkR * spec.atkR && nowMs - (c._atkAt || 0) >= spec.atkCd) { c._atkAt = nowMs; _brCritterAttack(sim, c, np, npid); }
    } else if (fleeing) {
      const d = Math.sqrt(nd2) || 1; mvx = (c.x - np.x) / d; mvy = (c.y - np.y) / d;
    } else {
      const _z = sim.battleroyaleZone;
      if (_z && ((c.x - _z.x) * (c.x - _z.x) + (c.y - _z.y) * (c.y - _z.y)) > (_z.r * 0.9) * (_z.r * 0.9)) {
        drifting = true;
        const zdx = _z.x - c.x, zdy = _z.y - c.y, zd = Math.sqrt(zdx * zdx + zdy * zdy) || 1; mvx = zdx / zd; mvy = zdy / zd;
      } else {
      if (nowMs >= (c._repathAt || 0) || ((c.tx - c.x) * (c.tx - c.x) + (c.ty - c.y) * (c.ty - c.y)) < 1600) {
        const ang = Math.random() * Math.PI * 2, dist = 200 + Math.random() * 600;
        const tp = brFindFreeSpot(Math.max(240, Math.min(arena.worldW - 240, c.x + Math.cos(ang) * dist)), Math.max(240, Math.min(arena.worldH - 240, c.y + Math.sin(ang) * dist)), arena.walls, arena.worldW, arena.worldH);
        c.tx = tp.x; c.ty = tp.y; c._repathAt = nowMs + 1500 + Math.random() * 2500;
      }
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.sqrt(dx * dx + dy * dy) || 1; mvx = dx / d; mvy = dy / d;
      }
    }
    const spd = (chasing || fleeing || drifting) ? spec.speed : spec.wander;
    if (mvx !== 0 || mvy !== 0) {
      if (mvx > 0.05) c._face = 1; else if (mvx < -0.05) c._face = -1;
      const ent = { x: c.x + mvx * spd * dt, y: c.y + mvy * spd * dt, r: spec.r };
      resolveCtfWall(ent, wallsInRect(_rg, ent.x - (spec.r + 40), ent.y - (spec.r + 40), ent.x + (spec.r + 40), ent.y + (spec.r + 40)));
      c.x = Math.max(30, Math.min(arena.worldW - 30, ent.x));
      c.y = Math.max(30, Math.min(arena.worldH - 30, ent.y));
      c._moving = true;
    } else { c._moving = false; }
  }
  if (anyDead && arr.length > 20) sim.brCritters = arr.filter(c => !c.dead);
}

// Tick: bounty-pings, supply-run-deadline/mål, supply-drops spawn+land+pickup. (v1.746)
function brSupplyLegendaryWeapon() {
  const arr = (BATTLEROYALE_ARENA.lootByTier && BATTLEROYALE_ARENA.lootByTier.legendary) || [];
  const wpns = arr.filter(it => it.kind === 'weapon' && it.weaponId);
  if (!wpns.length) return 'minigun';
  return wpns[(Math.random() * wpns.length) | 0].weaponId;
}
function tickBrContracts(sim, nowMs) {
  // 1. Bounty-pings var 5s
  sim._brBountyPingAccum = (sim._brBountyPingAccum || 0) + (nowMs - (sim._brBountyLast || nowMs));
  sim._brBountyLast = nowMs;
  const pingNow = sim._brBountyPingAccum >= 5000;
  if (pingNow) sim._brBountyPingAccum = 0;
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState; if (!ps || !ps.brContract) continue;
    const ac = ps.brContract;
    if (ac.type === 'bounty') {
      const tWs = sim.room.members.get(ac.target);
      if (!tWs || !tWs.playerState || tWs.playerState.hp <= 0 || sim.battleroyaleEliminated.includes(ac.target)) {
        // målet dog (ej av mig → handleKill sköter done); här = försvann → fail
        if (!tWs || !tWs.playerState) brFinishContract(sim, pid, false);
        continue;
      }
      // C143 (audit 2026-06-18): pinga inte målets off-map gulag-position medan det duellerar.
      if (tWs.playerState.gulagState) continue;
      if (pingNow) sim.eventQueue.push({ type: 'br_bounty_ping', peerId: pid, x: Math.round(tWs.playerState.x), y: Math.round(tWs.playerState.y) });
    } else if (ac.type === 'supply_run') {
      if (nowMs > ac.deadline) { brFinishContract(sim, pid, false); continue; }
      const dx = ps.x - ac.goalX, dy = ps.y - ac.goalY;
      if (dx * dx + dy * dy < 170 * 170) {
        brAwardCash(sim, pid, 500);
        sim.eventQueue.push({ type: 'br_grenades', peerId: pid, frag: 2 });
        sim.eventQueue.push({ type: 'br_grenades', peerId: pid, smoke: 2 });
        brFinishContract(sim, pid, true, '+$500 + granater');
      }
    }
  }
  // 2. Supply-drops: spawn periodiskt
  if (nowMs >= (sim._brNextSupplyAt || 0)) {
    sim._brNextSupplyAt = nowMs + BR_SUPPLY_INTERVAL_MS;
    const arena = BATTLEROYALE_ARENA;
    // sikta nära nuvarande zon-center så lådan är relevant
    const zx = sim.battleroyaleZone ? sim.battleroyaleZone.x : arena.worldW / 2;
    const zy = sim.battleroyaleZone ? sim.battleroyaleZone.y : arena.worldH / 2;
    const r = sim.battleroyaleZone ? sim.battleroyaleZone.r * 0.6 : 2500;
    brSpawnSupply(sim, zx + (((nowMs % 1000) / 1000) - 0.5) * r, zy + (((nowMs % 777) / 777) - 0.5) * r, null);
  }
  // 3. Supply-drops: land + pickup
  if (sim.brSupplyDrops && sim.brSupplyDrops.length) {
    for (const d of sim.brSupplyDrops) {
      if (d.opened) continue;
      if (!d.landed && nowMs >= d.landAt) { d.landed = true; sim.eventQueue.push({ type: 'br_supply_land', id: d.id, x: d.x, y: d.y }); }
      if (!d.landed) continue;
      for (const [pid, ws] of sim.room.members) {
        if (!ws.playerState || ws.playerState.hp <= 0 || ws.playerState.brDowned) continue;
        // En KONTRAKT-låda (dropbox) får BARA öppnas av ägaren — annars stjäl någon annan
        // looten OCH ägarens kontrakt fastnar (ingen deadline). Vanliga lådor: vem som helst.
        if (d.fromContract && d.fromContract !== pid) continue;
        const dx = ws.playerState.x - d.x, dy = ws.playerState.y - d.y;
        if (dx * dx + dy * dy > BR_SUPPLY_PICK_R * BR_SUPPLY_PICK_R) continue;
        d.opened = true;
        // v1.748: 50/50 — antingen ett top-tier-vapen ELLER cash, inte båda.
        let wpn = null, cash = 0;
        if (Math.random() < 0.5) { wpn = brSupplyLegendaryWeapon(); }
        else { cash = 700; brAwardCash(sim, pid, cash); }
        // v2 anti-cheat: vapnet hamnar i klientens save.owned → spegla server-side
        if (wpn) {
          if (!(ws._brOwnedWeapons instanceof Set)) ws._brOwnedWeapons = new Set(['fists', 'knife', BATTLEROYALE_ARENA.startWeapon || 'pistol']);
          ws._brOwnedWeapons.add(wpn);
        }
        sim.eventQueue.push({ type: 'br_supply_opened', id: d.id, peerId: pid, weaponId: wpn, cash: cash });
        // Dropbox-kontrakt slutfört om denna låda hörde till ett
        if (d.fromContract && ws.playerState.brContract && ws.playerState.brContract.type === 'dropbox' && ws.playerState.brContract.dropId === d.id) {
          brFinishContract(sim, pid, true, 'Epic loot!');
        }
        break;
      }
    }
    if (sim.brSupplyDrops.length > 30) sim.brSupplyDrops = sim.brSupplyDrops.filter(d => !d.opened);
  }
}

// AIR STRIKE (v1.740): förbruka en laddning, schemalägg fördröjt nedslag (telegraf 3s)
// med flera blast i en radie. Servern äger skada-appliceringen.
const BR_AIRSTRIKE = { delayMs: 1500, radius: 240, dmg: 400, blasts: 6, spreadMs: 1400 }; // 3000→1500: spräng efter 1.5s — chans att fly men svårt (klienten läser impactAt)
function applyBrAirstrike(sim, pid, x, y) {
  if (!sim.battleroyaleActive || sim.battleroyaleEnded) return;
  const ws = sim.room.members.get(pid);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.brDowned) return;
  if ((ws.playerState.airstrikes || 0) <= 0) return;
  const arena = BATTLEROYALE_ARENA;
  const tx = Math.max(0, Math.min(arena.worldW, +x || 0));
  const ty = Math.max(0, Math.min(arena.worldH, +y || 0));
  ws.playerState.airstrikes -= 1;
  const now = Date.now();
  if (!sim._brAirstrikes) sim._brAirstrikes = [];
  sim._brAirstrikes.push({ x: tx, y: ty, r: BR_AIRSTRIKE.radius, owner: pid, impactAt: now + BR_AIRSTRIKE.delayMs, done: false });
  sim.eventQueue.push({ type: 'br_airstrike_incoming', x: Math.round(tx), y: Math.round(ty), r: BR_AIRSTRIKE.radius, impactAt: now + BR_AIRSTRIKE.delayMs });
  sim.eventQueue.push({ type: 'br_item_count', peerId: pid, item: 'airstrike', count: ws.playerState.airstrikes });
}

// Applicera airstrike-skada i radie (armor → shield → hp). Krediterar owner via _brLastAttacker.
function _brAirstrikeDamage(sim, strike) {
  const r2 = strike.r * strike.r;
  for (const [pid, ws] of sim.room.members) {
    if (!ws.playerState || ws.playerState.hp <= 0) continue;
    if (pid === strike.owner) continue; // träffar ej den som kallade in den
    // v1.798: downed-spelare (hp=1) skyddas (annars → 0 hp = kringgår self-revive-kanalen),
    // och gulag-spelare är off-map (ska ej träffas av airstrike på kartan).
    if (ws.playerState.brDowned || ws.playerState.gulagState) continue;
    if (Date.now() < (ws.playerState.invulnUntil || 0)) continue;
    const dx = ws.playerState.x - strike.x, dy = ws.playerState.y - strike.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    const falloff = 1 - Math.sqrt(d2) / strike.r; // 1 i center → 0 vid kant
    // V2: exakt i center = full dmg (400), skalar ner mot kanten. Går genom hus
    // (ingen LoS-check). dmg_redux-perk (-5%/nivå, tak -50%) reducerar sedan.
    let remaining = BR_AIRSTRIKE.dmg * (0.18 + 0.82 * falloff) * (1 - brDmgRedux(ws.playerState));
    if (remaining > 0 && (ws.playerState.shield || 0) > 0) { const a = Math.min(ws.playerState.shield, remaining); ws.playerState.shield -= a; remaining -= a; }
    if (remaining > 0) ws.playerState.hp = Math.max(0, ws.playerState.hp - remaining);
    ws.playerState._brLastAttacker = strike.owner;
    ws.playerState._brLastWeapon = 'airstrike';
    ws.playerState._brLastAttackerAt = Date.now();
    sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ws.playerState.hp, shield: ws.playerState.shield || 0 });
  }
}

// BR-meta-tick: self-revive-channel, airstrike-impacts, UAV-pings. (v1.740)
function tickBrMeta(sim, nowMs) {
  // 1. Self-revive-channel: downed + levande + timer slut → res dig (50 hp).
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState;
    if (ps && ps.brDowned && ps.hp > 0 && nowMs >= ps.brReviveEnd) {
      ps.brDowned = false;
      ps.hp = Math.min(ps.maxHp || 200, 50);
      ps.speedMul = 1.0; // klienten återapplicerar ev. move_speed-perk + adrenalin lokalt
      ps.invulnUntil = nowMs + 1500;
      sim.eventQueue.push({ type: 'br_revived', peerId: pid, hp: ps.hp });
      sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield || 0 });
    }
  }
  // 1b. Medkit heal-over-time (server äger hp): 5 tick × 18 hp var 800ms.
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState;
    if (!ps || !(ps.brMedkitTicks > 0)) continue;
    if (ps.hp <= 0 || ps.brDowned) { ps.brMedkitTicks = 0; continue; } // avbryt om död/downed
    if (nowMs < (ps.brMedkitNext || 0)) continue;
    ps.brMedkitTicks -= 1;
    ps.brMedkitNext = nowMs + 800;
    const before = ps.hp;
    ps.hp = Math.min(ps.maxHp || 100, ps.hp + 18);
    if (ps.hp !== before) sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield || 0 });
    if (ps.hp >= (ps.maxHp || 100)) ps.brMedkitTicks = 0; // full → klart
  }
  // 1c. SANATIO (alien-shop): passiv HP+shield-regen var ~700ms, BARA utanför strid (>5s
  //     sedan man tog skada) och vid liv. Liten takt → meningsfull men ej OP.
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState;
    if (!ps || !ps.passiveRegenActive) continue;
    if (ps.hp <= 0 || ps.brDowned) continue;
    if (nowMs < (ps.brRegenNext || 0)) continue;
    if (nowMs - (ps._brLastAttackerAt || 0) < 5000) continue;
    ps.brRegenNext = nowMs + 700;
    const _bh = ps.hp, _bs = ps.shield || 0;
    ps.hp = Math.min(ps.maxHp || 100, ps.hp + 6);
    ps.shield = Math.min(ps.maxShield || 100, (ps.shield || 0) + 4);
    if (ps.hp !== _bh || ps.shield !== _bs) sim.eventQueue.push({ type: 'pvp_hp_changed', peerId: pid, hp: ps.hp, shield: ps.shield });
  }
  // 2. Airstrike-impacts: när impactAt nås → blast-VFX-events + skada.
  if (sim._brAirstrikes && sim._brAirstrikes.length) {
    for (const s of sim._brAirstrikes) {
      if (s.done) continue;
      if (nowMs >= s.impactAt) {
        s.done = true;
        // Flera blast-punkter spridda i radien (klient-VFX, deterministiskt index).
        const pts = [];
        for (let k = 0; k < BR_AIRSTRIKE.blasts; k++) {
          const ang = (k / BR_AIRSTRIKE.blasts) * Math.PI * 2 + (s.x % 7) * 0.3;
          const dist = s.r * (0.2 + 0.65 * ((k % 3) / 2));
          pts.push({ x: Math.round(s.x + Math.cos(ang) * dist), y: Math.round(s.y + Math.sin(ang) * dist) });
        }
        sim.eventQueue.push({ type: 'br_airstrike_blast', x: Math.round(s.x), y: Math.round(s.y), r: s.r, points: pts });
        _brAirstrikeDamage(sim, s);
      }
    }
    sim._brAirstrikes = sim._brAirstrikes.filter(s => !s.done);
  }
  // 3. UAV-pings: var ~1.5s emit:a fiende-blips till spelare med aktiv UAV.
  sim._brUavTick = (sim._brUavTick || 0) + (nowMs - (sim._brUavLast || nowMs));
  sim._brUavLast = nowMs;
  if (sim._brUavTick >= 1500) {
    sim._brUavTick = 0;
    for (const [pid, ws] of sim.room.members) {
      // UAV (tidsbegränsad) ELLER OCVLVS CAELI (alien, permanent) → få fiende-blips.
      if (!ws.playerState || (nowMs >= (ws.playerState.brUavUntil || 0) && !ws.playerState.enemyRevealActive)) continue;
      const blips = [];
      for (const [opid, ows] of sim.room.members) {
        if (opid === pid) continue;
        if (!ows.playerState || ows.playerState.hp <= 0) continue;
        // C128 (audit 2026-06-18): gulag-kämpar har hp>0 men lever off-map (~13000+) →
        // annars blippas de som minimap-prickar långt utanför kartan. Speglar airstrike-
        // guarden (gulagState/brDowned filtreras bort).
        if (ows.playerState.gulagState || ows.playerState.brDowned) continue;
        blips.push({ x: Math.round(ows.playerState.x), y: Math.round(ows.playerState.y) });
      }
      sim.eventQueue.push({ type: 'br_uav_ping', peerId: pid, blips });
    }
  }
}

// Pickup-builder för juggernaut-arenan — symmetrisk runt 2500,1750
function buildJuggernautPickups(sim) {
  return [
    // HP-pickups vid hörn-spawns (hunters behöver healing efter JUG-möte)
    { id: nextPickupId(sim), x: 900,  y: 900,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 4100, y: 900,  type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 900,  y: 2600, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 4100, y: 2600, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 1750, type: 'hp',     available: true, respawnAt: 0 },
    // Shield-pickups i flank-zoner (riskabla — JUG kan campa här)
    { id: nextPickupId(sim), x: 2500, y: 500,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 3000, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1500, y: 1750, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1750, type: 'shield', available: true, respawnAt: 0 },
    // Granater: 4 spridda runt mitten + flank (anti-JUG tool)
    { id: nextPickupId(sim), x: 1700, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3300, y: 900,  type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1700, y: 2600, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3300, y: 2600, type: 'grenade', available: true, respawnAt: 0 },
  ];
}

function endGungameMatch(sim, winnerId, reason) {
  if (sim.gungameEnded) return;
  sim.gungameEnded = true;
  sim.gungameWinner = winnerId;
  const stats = { perPlayer: {} };
  for (const [p, _ws] of sim.room.members) {
    if (_ws && _ws.isSpectator) continue;   // SPECTATE: ingen scoreboard-rad/XP åt åskådare
    stats.perPlayer[p] = {
      kills: sim.gungameKillsByPid[p] || 0,
      deaths: (sim.tdmDeathsByPid && sim.tdmDeathsByPid[p]) || 0,
      tier: sim.gungameTiers[p] || 0,
    };
  }
  sim.eventQueue.push({
    type: 'gungame_match_end',
    winner: winnerId, reason, stats,
  });
}

// Mappar match_end-event-typ → läges-sträng (matchar klientens PVP_MODES + serverns
// SERVER_XP_MODES). br_match_end → 'battleroyale'.
const _XP_EVENT_MODE = {
  tdm_match_end: 'tdm', ctf_match_end: 'ctf', siege_match_end: 'siege',
  koth_match_end: 'koth', juggernaut_match_end: 'juggernaut',
  gungame_match_end: 'gungame', br_match_end: 'battleroyale',
};
// Server-auktoritativ match-XP: skanna utgående events efter match_end, normalisera
// per-spelar-resultatet → [{peerId, kills, won}], kreditera XP server-side för bundna
// server-auth-konton (accounts.creditMatchEndXp no-op:ar för bots/oflaggade/ej-wired),
// och pusha acct_xp-events i SAMMA batch (klienten adopterar axp/alevel om peerId==self).
// Heterogena stats-former: tdm = array [{peerId,team,kills}]; övriga = {perPlayer:{pid:{...}}}.
// Lag-lägen (tdm/ctf/siege) har winner='red'/'blue'; FFA (koth/jugg/br/gungame) winner=peerId.
function creditServerXp(sim, events) {
  if (!process.env.SERVERAUTH_XP) return;   // flagga av (default) → noll kostnad, scanna inget
  let extra = null;
  for (const ev of events) {
    const mode = _XP_EVENT_MODE[ev && ev.type];
    if (!mode) continue;
    const teamWin = ev.winner === 'red' || ev.winner === 'blue';
    const rows = [];
    if (Array.isArray(ev.stats)) {
      for (const s of ev.stats) {
        if (!s || s.peerId == null) continue;
        rows.push({ peerId: String(s.peerId), kills: s.kills || 0, won: teamWin ? (s.team === ev.winner) : (String(s.peerId) === String(ev.winner)) });
      }
    } else if (ev.stats && ev.stats.perPlayer) {
      for (const pid of Object.keys(ev.stats.perPlayer)) {
        const s = ev.stats.perPlayer[pid] || {};
        rows.push({ peerId: String(pid), kills: s.kills || 0, won: teamWin ? (s.team === ev.winner) : (pid === String(ev.winner)) });
      }
    }
    for (const r of rows) {
      const ws = sim.room.members.get(r.peerId);
      if (!ws || ws._isBot || ws.isSpectator) continue;   // SPECTATE: aldrig konto-XP åt åskådare
      const res = accounts.creditMatchEndXp(ws, mode, r.kills, r.won);
      if (res) (extra || (extra = [])).push({ type: 'acct_xp', peerId: r.peerId, axp: res.axp, alevel: res.alevel, gained: res.gained });
    }
  }
  if (extra) for (const e of extra) events.push(e);
}

function broadcastWorld(sim, now) {
  const fullBroadcast = (now - sim.lastFullAt) > FULL_BROADCAST_MS;
  if (fullBroadcast) sim.lastFullAt = now;

  // Bygg player-array — companions inkluderas i sim's enemy-AI-targeting men FÅR INTE
  // skickas som spelare till klient (deras position renderas separat via companion-state).
  // BUG-FIX: tidigare läckte companions in i klient's player-rendering → host-companion
  // mappades till partner-slot → "kompis-gubbe följer dig hela tiden".
  const players = buildPlayerList(sim);
  const realPlayers = players.filter(p => !p._isCompanion);
  // v1.430: BUGFIX — aim + weapon var hardcoded `a: 0, w: 'fists'` → ALLA
  // partners verkade peka åt höger med fists. Server tog emot aim korrekt men
  // använde inte ws.playerState.aim/weaponId i broadcast. Använd nu p.aim
  // (set från input.aim i applyPlayerInput) + p.weaponId.
  // stable-slot: använd ws.stableSlot (tilldelat vid join i server.js) istället
  // för array-index i. Array-index skiftar när en peer lämnar → c:i pekar på
  // fel peerId hos klienten. stableSlot ändras aldrig under en peers session.
  // Fallback till array-index i (bakåtkompatibelt för test-stubs utan stableSlot).
  // CD down/revive self-healing snapshot-konstanter (beräknade EN gång per broadcast).
  const _cdActive = !!sim.castledefenseActive;
  const _cdBleedMs = (CASTLEDEFENSE_ARENA.downBleedoutSec || 30) * 1000;
  const _cdReviveSec = CASTLEDEFENSE_ARENA.downReviveSec || 5;
  const allPlayers = realPlayers.map((p, i) => {
    const _ps = (p._wsRef && p._wsRef.playerState) || {};
    const _sh = Math.round(_ps.shield || 0);
    const _hp = Math.round(p.hp);
    const _out = {
    c: (p._wsRef && p._wsRef.stableSlot != null) ? p._wsRef.stableSlot : i,
    x: Math.round(p.x), y: Math.round(p.y),
    hp: _hp,
    // v2 #68 (additivt): shield i world-paketet. Binär-encodern (V1-webben)
    // ignorerar okända fält → bara JSON-klienter (_jsonWorld/Godot) ser `sh`.
    sh: _sh,
    // v2 (additivt): per-spelare MAX hp/shield så ANDRA ser rätt hp-andel
    // (en spelare med hp-upgrades har max 100+25/nv → annars antog NetPlayer 100
    // och en halvskadad spelare såg ut som full). max() med hp/shield + server-
    // satt maxHp (juggernaut 400) → aldrig under verkligt max, aldrig > 100% bar.
    mh: Math.max(_ps.maxHp || 100, _ps._cliMaxHp || 0, _hp),
    msh: Math.max(_ps.maxShield || 100, _ps._cliMaxShield || 0, _sh),
    a: typeof p.aim === 'number' ? p.aim : 0,
    w: p.weaponId || 'fists',
    rT: Math.round(p.reviveTimer || 0),
  };
    // CD DOWN/REVIVE i world-snapshot (self-healing). Down/revive var tidigare ENBART
    // event-drivet + en-skotts → en klient som joinar/rejoinar EFTER att en lagkamrat
    // gått ner, eller tappar cd_player_downed-paketet, såg aldrig markören/bleed-out/
    // revive-bågen. Nu speglas den auktoritativa down-staten varje tick. Bara när CD
    // är aktivt OCH spelaren faktiskt är nere/död → 0 extra bytes annars. Binär-encodern
    // (V1) ignorerar okända fält precis som sh/mh.
    if (_cdActive && (_ps.cdDowned || _ps.cdDownDead)) {
      if (_ps.cdDowned) {
        _out.cdD = 1;
        // ms kvar av bleed-out räknat mot server-klockan → klienten re-ankrar mot sin
        // egen Time.get_ticks_msec() vid mottagning (klock-oberoende, samma trick som bleedoutMs).
        _out.cdBR = Math.max(0, Math.round(_cdBleedMs - (now - (_ps.cdDownStartedAt || now))));
        // revive-progress 0..1 (normaliserad mot bas-reviveSec; medic-fart är en minimal visuell nyans).
        _out.cdRP = Math.round(Math.min(1, (_ps.cdDownReviveProgress || 0) / _cdReviveSec) * 100) / 100;
      }
      if (_ps.cdDownDead) _out.cdDD = 1;
    }
    // BATTLE BUS / SKYDIVE (additivt): air 1=buss/2=freefall/3=fallskärm, dz=descent
    // 0..1 (för fjärr-render + lokal prediktions-korrigering). Utelämnas när landad.
    if (_ps.brAir) {
      _out.air = _ps.brAir;
      if (_ps.brAir >= 2) {
        const _sj = now - (_ps.brJumpedAt || now);
        _out.dz = Math.round(Math.min(1, _sj / (BR_FREEFALL_MS + BR_CHUTE_MS)) * 100) / 100;
      }
    }
    // ALIEN-kosmetik (alien-shop): andra spelare ser alien-skin / stort huvud hela matchen.
    if (_ps.alienSkinActive) _out.aln = 1;
    if (_ps.bigHeadActive) _out.bh = 1;
    return _out;
  });
  // Transport-pass (2026-06-10, JSON-vägen): egen players-payload för JSON-peers.
  // a avrundas till 2 decimaler (0.01 rad ≈ 0.57° — osynligt, sparar ~8-14 tecken/
  // spelare/paket) och rT utelämnas när 0 (NetLocalPlayer.gd: d.get("rT", 0) →
  // utelämnande identiskt; NetPlayer.gd läser inte rT alls). sh/w/hp behålls
  // ALLTID — V2-parsningen har sticky-defaults (d.get(fält, nuvarande)) så ute-
  // lämnande skulle frysa värdet vid övergång till 0. allPlayers rörs INTE —
  // binär-encodern (V1-webben) kvantiserar a×1000 själv → V1-bytes oförändrade.
  let _jsonPlayers = null;
  const getJsonPlayers = () => {
    if (_jsonPlayers) return _jsonPlayers;
    _jsonPlayers = allPlayers.map((p) => {
      const jp = { c: p.c, x: p.x, y: p.y, hp: p.hp, sh: p.sh, a: Math.round(p.a * 100) / 100, w: p.w, mh: p.mh, msh: p.msh };
      if (p.rT) jp.rT = p.rT;
      // CD down/revive self-healing (bara på Godot/JSON-vägen, bara när nere/död).
      if (p.cdD) { jp.cdD = 1; jp.cdBR = p.cdBR; jp.cdRP = p.cdRP; }
      if (p.cdDD) jp.cdDD = 1;
      // BATTLE BUS / SKYDIVE (air/dz).
      if (p.air) { jp.air = p.air; if (p.dz !== undefined) jp.dz = p.dz; }
      if (p.aln) jp.aln = 1;
      if (p.bh) jp.bh = 1;
      return jp;
    });
    return _jsonPlayers;
  };
  // PERF: pickups är IDENTISKA för alla peers → bygg den avrundade arrayen EN gång
  // (memoiserat som getJsonPlayers) i st.f. .map per peer i broadcast-loopen.
  let _jsonPickups = null;
  const getJsonPickups = () => {
    if (_jsonPickups) return _jsonPickups;
    _jsonPickups = sim.pickups.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), t: p.type }));
    return _jsonPickups;
  };
  // (S3: getJsonCritters + _critterMsg borttagna — critters byggs nu per-peer med box-cull)

  // Drain event-queue. Batch ALLA events i ett enda 'sim_events'-meddelande per
  // peer per tick — sparar 1 JSON.stringify + 1 ws.send per event per client.
  // Skipsa helt om inga events. Klienten hanterar bakåtkompat genom att stödja
  // både 'sim_event' (en) och 'sim_events' (lista).
  // Bugfix: dräna BARA om vi faktiskt har subscribers (annars förlorades
  // ctf_match_end om sista spelaren disconnectade samma tick).
  if (sim.eventQueue.length > 0 && sim.room.members.size > 0) {
    const events = sim.eventQueue.splice(0);
    // Server-auktoritativ match-XP (fas 1, no-op om flagga av / inga server-auth-konton):
    // kreditera + injicera acct_xp-events INNAN serialisering så de går i samma batch.
    creditServerXp(sim, events);
    // st (additivt, transport-pass 2026-06-10): server-tidsstämpel på batchen —
    // JSON-klienter (Godot) använder den för event↔world-tidslinjering i
    // interpolationsbufferten. V1-webben läser bara .events → okänt fält ignoreras.
    // S3 audience-filter: events med _aud:[] skickas bara till listade peers (t.ex.
    // gulag_tick → bara duellanter + spectators, ej alla levande BR-spelare).
    // Normal-case (ingen _aud) → snabb delad JSON-sträng som förut.
    const _hasAud = events.some(ev => ev._aud);
    let _sharedJson = null;
    for (const [peerId, ws] of sim.room.members) {
      if (ws.readyState !== 1) continue;
      // v1.431: Defensive backpressure — om WS-buffert är > 2MB är klienten så
      // efter att den är effektivt död. Logga + släpp paketet (skicka inte) men
      // KICKA INTE — klient kan återhämta sig om de catchar upp.
      // Critical events (cd_gold_update etc) re-syncs via cd_hud_update var 500ms.
      if (ws.bufferedAmount > 2 * 1024 * 1024) {
        console.log('[BACKPRESSURE-SKIP]', ws.id, 'buf=' + ws.bufferedAmount);
        ws._eventSkips = (ws._eventSkips || 0) + 1;
        // SLUTAUDIT 2 #14: events-batchen splice:as ur kön EN gång — en peer som
        // skippas här får ALDRIG batchen igen (ingen resync-väg för oersättliga
        // events som match_end/*_started → klienten fastnar i fel state). För
        // Godot-peers (_jsonWorld): stäng socketen — klientens auto-rejoin +
        // late-join-replayen i server.js läker hela state:t. Kort grace via
        // close(), hård terminate efter 2s om close-framen inte når fram (den
        // sitter ju bakom samma 2MB-buffert). V1-webben behåller gamla
        // skip-utan-kick-beteendet (cd_hud_update-resyncen täcker dess modes).
        if (ws._jsonWorld && !ws._backpressureKicked) {
          ws._backpressureKicked = true;
          try { ws.close(1013, 'backpressure'); } catch (e) {}
          setTimeout(() => { try { ws.terminate(); } catch (e) {} }, 2000);
        }
        continue;
      }
      let json;
      if (_hasAud) {
        const batch = events.filter(ev => !ev._aud || ev._aud.includes(peerId));
        if (batch.length === 0) continue;
        json = JSON.stringify({ type: 'sim_events', st: now, events: batch });
      } else {
        if (!_sharedJson) _sharedJson = JSON.stringify({ type: 'sim_events', st: now, events });
        json = _sharedJson;
      }
      try { ws.send(json); } catch (e) {}
    }
  }

  // M5: räknare för JSON-peer-nedsamplingen (per broadcastWorld-anrop, inte per
  // tick — broadcastWorld anropas redan bara var BROADCAST_EVERY:e tick).
  sim._worldCastNo = (sim._worldCastNo || 0) + 1;
  // AAA per-entitet-delta (V2): idx→levande-enemy-map, lazy (byggs först när en
  // JSON-peer behöver den) + cachad per broadcast. Används för (a) entity-remove
  // (idx i lastSent men EJ i mappen = död → reliable enemy_remove) och (b) budget-
  // prioritet (boss/telegraf-flaggor). Noll kostnad om inga JSON-peers.
  let _enemyByIdx = null;
  const getEnemyByIdx = () => {
    if (_enemyByIdx) return _enemyByIdx;
    _enemyByIdx = new Map();
    for (const e of sim.enemies) if (!e.dead) _enemyByIdx.set(e._idx, e);
    return _enemyByIdx;
  };
  for (const [peerId, ws] of sim.room.members) {
    // C115 (audit 2026-06-18): bots är riktiga room.members med readyState:1 och en
    // no-op send (bots.js). De läser sim-state direkt i tickBots och konsumerar aldrig
    // world-paket → skippa hela per-peer-encoden (sparar full world-encode/bot/tick) +
    // håller bot-ids ur lastSentEnemyByPeer/seqByPeer/_peerFullAt.
    if (ws._isBot) continue;
    // CRITTERS (vilt): per-peer box-cull ~700px, 10Hz (var 6:e cast). S3-fix:
    // Förut 60 djur × okullad JSON × 20Hz = ~70KB/s per peer (4× world-snapshot).
    // Nu: bara synliga djur (~0-6 st) per peer → ~3KB/s. Klient lerpar redan (k=12*delta)
    // → 10Hz är visuellt tillräckligt. Eget OTILLFÖRLITLIGT msg (kan ej rida world —
    // bin-peers tar binär world; encodeWorld känner ej critters-fältet).
    if (sim.battleroyaleActive && ws.readyState === 1 && (sim._worldCastNo % 6) === 0) {
      const _cpx = (ws.playerState && ws.playerState.x) || 1000;
      const _cpy = (ws.playerState && ws.playerState.y) || 1000;
      const _cr = [];
      if (sim.brCritters) {
        for (const c of sim.brCritters) {
          if (c.dead) continue;
          if (Math.abs(c.x - _cpx) < 700 && Math.abs(c.y - _cpy) < 700)
            _cr.push({ id: c.id, t: c.type, x: Math.round(c.x), y: Math.round(c.y), f: c._face || 1, m: c._moving ? 1 : 0 });
        }
      }
      if (_cr.length) {
        try { const _cm = JSON.stringify({ type: 'br_critters', st: now, critters: _cr }); (ws.sendUnreliable ? ws.sendUnreliable(_cm) : ws.send(_cm)); } catch (e) {}
      }
    }
    // Godot/V2-klienter: world-snapshot som JSON-text, alltid full lista (trivial
    // klient-rendering — ersätt hela listan) men bara var JSON_WORLD_EVERY:e
    // broadcast (20Hz) — se M5-kommentaren vid konstanten.
    const isJson = !!ws._jsonWorld;
    // v2 latens-polish (granskning 2026-06-12): rena PvP-lägen har inga PvE-
    // enemy-listor → world-paketet är litet (players+hb ≈ 0.3-1KB) → ge JSON-
    // peers FULL 60Hz där (halverar klientens interp-fönster-bas 33→16.7ms).
    // Co-op/survivors/BR behåller 30Hz (full enemy-lista per paket = dyrt).
    const jsonEvery = ((sim.tdmActive || sim.ctfActive || sim.siegeActive ||
      sim.kothActive || sim.gungameActive || sim.juggernautActive) ||
      (ws.playerState && ws.playerState.gulagState === 'fighting')) ? 1 : JSON_WORLD_EVERY;   // GULAG-duell → 60Hz opponent-sync
    if (isJson && (sim._worldCastNo % jsonEvery) !== 0) continue;
    let lastSent = sim.lastSentEnemyByPeer.get(peerId);
    // v1.701: stagga enemy-full-broadcasten PER PEER. Förr synkad per-sim (sim.lastFullAt)
    // → alla klienter fick sin tunga full-paket SAMMA tick = server-encode-burst + synkad
    // klient-decode-spik var 1500ms. Per-peer-timer med slumpad start-fas sprider lasten.
    if (!sim._peerFullAt) sim._peerFullAt = {};
    if (sim._peerFullAt[peerId] == null) sim._peerFullAt[peerId] = now - Math.floor(Math.random() * FULL_BROADCAST_MS);
    // AAA per-entitet-delta (V2): JSON-peers tvingar INTE längre full varje tick.
    // De får delta-positioner (otillförlitlig kanal) + per-enemy FULL-ENTRIES för
    // nya/flagg-ändrade fiender + reliable enemy_remove för döda. Periodisk full
    // (FULL_BROADCAST_MS) = cull-backstop. V1-binär behåller exakt gamla isJson-
    // lösa beteendet. Förstapaketet (!lastSent) tvingar full för båda.
    let forceFullForPeer = !lastSent || (now - sim._peerFullAt[peerId]) > FULL_BROADCAST_MS;
    if (forceFullForPeer) sim._peerFullAt[peerId] = now;
    if (!lastSent) lastSent = {};
    // Pre-scan: BARA V1-binär forcerar full-paket vid ny enemy (binär-klienten har
    // ingen per-entry-full-i-delta-paket-väg). V2 (isJson) skickar full-entry per
    // ny enemy inline → ingen per-packet-forcering behövs.
    if (!forceFullForPeer && !isJson) {
      for (const e of sim.enemies) {
        if (e.dead) continue;
        if (!lastSent[e._idx]) { forceFullForPeer = true; break; }
      }
    }
    const newSent = {};
    let enemiesPkt = [];
    const px = (ws.playerState && ws.playerState.x) || 1000;
    const py = (ws.playerState && ws.playerState.y) || 1000;
    const cullHyst = CULL_DIST * 1.18;   // AAA: anti-churn-hysteres (V2 delta)
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const adx = Math.abs(e.x - px), ady = Math.abs(e.y - py);
      // V2-hysteres: redan-sänd enemy hålls synlig till CULL_DIST*1.18 (mindre
      // re-spawn-churn vid oscillering runt cull-gränsen).
      // SPECTATE: en spectator har ingen egen position (playerState saknas → px/py
      // defaultar (1000,1000)) → kan följa VILKEN spelare som helst → skicka HELA
      // enemy-listan ocullad (annars ser de bara fiender nära (1000,1000)).
      const visible = ws.isSpectator || e.isBoss || e.isMiniBoss ||
                      (adx < CULL_DIST && ady < CULL_DIST) ||
                      (isJson && lastSent[e._idx] && adx < cullHyst && ady < cullHyst);
      if (!visible) continue;
      const ex = Math.round(e.x), ey = Math.round(e.y), eh = Math.round(e.hp);
      // fx = status-bitfält: 1=burn, 2=slow, 4=boss-charge, 8=boss-cloak,
      //   16=HEALING (healer m. aktiv heal-target — C4), 32=SUMMONING (summoner
      //   inom ~700ms före nästa summon-cast — C4), 64=SNIPER-AIM (aim-fasen,
      //   800ms före skott — C3), 128=BOMBER-ARMED (fuse tänd, ≤0.6s — C3). g=guld.
      // AAA: beräknas för ALLA synliga — V2-delta måste skicka full-entry när fx
      // ändras även om positionen står still (annars missas sniper-aim/charge-
      // telegraferna på stillastående fiender). V1 läser bara värdet i full-grenen.
      const _fx = ((e.burnUntil && e.burnUntil > now ? 1 : 0) | (e.slowUntil && e.slowUntil > now ? 2 : 0)
        | (e.chargeUntil && e.chargeUntil > now ? 4 : 0) | (e.cloakUntil && e.cloakUntil > now ? 8 : 0)
        | (e.type === 'healer' && e._healTargetIdx >= 0 ? 16 : 0)
        | (e.type === 'summoner' && (now - (e.summonAt || 0)) > 3800 ? 32 : 0)
        | (e.aiming ? 64 : 0)
        | (e.type === 'bomber' && (e.fuse || 0) > 0 ? 128 : 0)
        | (((e._attackFxUntil && e._attackFxUntil > now) || (e.isBoss && e.lastAttack && (now - e.lastAttack) < 220)) ? 256 : 0));
      const last = lastSent[e._idx];
      const isNew = !last;
      const fxChanged = !isNew && last.fx !== _fx;
      newSent[e._idx] = { x: ex, y: ey, hp: eh, fx: _fx };
      // TARGET-strålar (heal-beam 16 / sniper-laser 64): _tele byggs om från
      // paketets enemies VARJE tick → en stillastående strålande fiende måste skickas
      // varje tick annars FLIMRAR strålen (ht/at finns bara i full-entries). Burn/slow/
      // charge/cloak (1/2/4/8) persisterar däremot på klienten (apply_delta rör ej fx).
      const fxBeam = (_fx & 80) !== 0;
      // skip oförändrade befintliga (delta-paket); V2: behåll om fx ändrats el. strålar
      if (!forceFullForPeer && last && last.x === ex && last.y === ey && last.hp === eh
          && !(isJson && (fxChanged || fxBeam))) continue;
      // per-enemy FULL-ENTRY: forceFull (V1 + periodisk full) ELLER V2 ny/flagg-ändrad/
      // strålande (16|64 → behöver ht/at varje tick). Annars mager {i,x,y,hp}-delta.
      const sendFullEntry = forceFullForPeer || (isJson && (isNew || fxChanged || fxBeam));
      if (sendFullEntry) {
        let eo;
        if (isJson) {
          // Transport-pass (2026-06-10): strippa default-fält i full-entries till
          // JSON-peers. Varje strippat fält VERIFIERAT mot V2 NetEnemy.apply_full
          // (d.get-defaults): b/mb→0, n/bk→'', fx→0 (resettas varje apply_full);
          // g sticky men init 0 + server-värdet konstant per enemy → utelämna-vid-0
          // identiskt; p (→power) används bara för miniboss-aura där '' och '0'
          // renderar identiskt (POWER_COL-fallback + mb_-textur-gate kräver != '').
          // mh/t/r/c behålls alltid (t är dessutom full/delta-diskriminatorn i
          // NetGame._sync_enemies). Binär-vägen (else-grenen) är OFÖRÄNDRAD.
          eo = { i: e._idx, x: ex, y: ey, hp: eh, mh: e.maxHp, t: e.type, r: e.r, c: e.color };
          if (e.isBoss) eo.b = 1;
          if (e.isMiniBoss) eo.mb = 1;
          if (e.bossKey) eo.bk = e.bossKey;
          if (e.name) eo.n = e.name;
          if (e.phase) eo.p = e.phase;
          // SLUTAUDIT 2 #13: minibossarnas miniPower transmittades aldrig — p bär
          // boss-phase (krockar) → klientens POWER_COL-aura/mb_*-texturer onåbara.
          // EGET fält mp, bara för JSON-peers (binär-vägen orörd: wirefmt packar
          // ändå inga nya fält → V1-bytes oförändrade).
          if (e.isMiniBoss && e.miniPower) eo.mp = e.miniPower;
          if (_fx) eo.fx = _fx;
          if (e.gold) eo.g = e.gold;
        } else {
          eo = {
            i: e._idx, x: ex, y: ey, hp: eh, mh: e.maxHp,
            t: e.type, b: e.isBoss ? 1 : 0, mb: e.isMiniBoss ? 1 : 0,
            bk: e.bossKey || '', r: e.r, c: e.color, n: e.name || '', p: e.phase || 0,
            fx: _fx,
            g: e.gold || 0,
          };
        }
        // JSON-only target-fält (C4/C3): ht = heal-target enemy-idx (beam),
        // at = sniper-aim target-peerId (laserlinje). Sätts bara när biten är på.
        if ((_fx & 16) && e._healTargetIdx >= 0) eo.ht = e._healTargetIdx;
        if ((_fx & 64) && e._aimTargetPid) eo.at = e._aimTargetPid;
        enemiesPkt.push(eo);
      } else {
        enemiesPkt.push({ i: e._idx, x: ex, y: ey, hp: eh });
      }
    }
    // ── AAA per-peer budget + reliable entity-remove (V2/JSON, bara delta-paket) ──
    if (isJson && !forceFullForPeer) {
      // BUDGET: cappa enemy-entries i delta-paketet → skjut upp FJÄRRAN (carry-
      // forward i newSent → diffen re-fyrar nästa tick). Boss/telegraf-fiender +
      // närmast prioriteras. Engagerar bara vid äkta trängsel (> budget ändrade) →
      // vanliga fallet byte-för-byte oförändrat. Full-paket budgetas ALDRIG.
      if (enemiesPkt.length > ENEMY_DELTA_BUDGET) {
        const ebi = getEnemyByIdx();
        const scored = enemiesPkt.map((eo) => {
          const ent = ebi.get(eo.i);
          const imp = (ent && (ent.isBoss || ent.isMiniBoss || ent.aiming
            || (ent.chargeUntil && ent.chargeUntil > now) || (ent.fuse && ent.fuse > 0))) ? 1 : 0;
          const dx = eo.x - px, dy = eo.y - py;
          return { eo, k: (imp ? -1e15 : 0) + dx * dx + dy * dy };
        });
        scored.sort((a, b) => a.k - b.k);
        const kept = [];
        for (let k = 0; k < scored.length; k++) {
          if (k < ENEMY_DELTA_BUDGET) { kept.push(scored[k].eo); continue; }
          const prev = lastSent[scored[k].eo.i];
          if (prev) newSent[scored[k].eo.i] = prev;   // carry-forward → re-send nästa tick
        }
        const dropped = scored.length - kept.length;
        enemiesPkt = kept;
        sim._budgetDrops = (sim._budgetDrops || 0) + dropped;
        if (!sim._budgetLogAt || now - sim._budgetLogAt > 5000) {
          sim._budgetLogAt = now;
          console.log('[REPL-BUDGET]', sim.room.code, 'höll', kept.length,
            'sköt upp', dropped, '(tot ' + sim._budgetDrops + ')');
        }
      }
      // ENTITY-REMOVE: idx vi tidigare skickat men som EJ längre lever (död/borta)
      // → reliable enemy_remove (world går unreliable → absens ensam räcker ej).
      // Culled-men-LEVANDE (i lastSent, ej i newSent, men i mappen) tas EJ bort här
      // (off-screen; periodisk full städar dem). Deferrade (budget) lever → ej heller.
      const ebi2 = getEnemyByIdx();
      let removedIds = null;
      for (const k in lastSent) {
        const idx = +k;
        if (!ebi2.has(idx) && !newSent[idx]) (removedIds || (removedIds = [])).push(idx);
      }
      if (removedIds && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'enemy_remove', ids: removedIds })); } catch (e) {}
      }
    }
    sim.lastSentEnemyByPeer.set(peerId, newSent);

    // Hostile bullets only (player-bullets renderas lokalt på klient via Coop.broadcastShots)
    const hb = [];
    for (const b of sim.bullets) {
      if (!b.hostile) continue;
      // v1.727: 800→1300 så fiende-kulor syns från längre håll (mer förvarning) +
      // ingen hård edge-flicker på större skärmar.
      if (Math.abs(b.x - px) < 1300 && Math.abs(b.y - py) < 1300) {
        hb.push({
          x: Math.round(b.x), y: Math.round(b.y),
          vx: Math.round(b.vx), vy: Math.round(b.vy),
          c: b.color, r: b.r,
        });
      }
    }

    const seq = ((sim.seqByPeer.get(peerId) || 0) + 1) & 0xFFFF;
    sim.seqByPeer.set(peerId, seq);

    const pkt = {
      players: allPlayers,
      enemies: enemiesPkt,
      hb,
      full: forceFullForPeer ? 1 : 0,
      seq,
      // AAA #6: senast behandlade INPUT-seq för DENNA peer (≠ world-seq ovan).
      // Klientens NetLocalPlayer matchar mot sin pending-ring → latensfri reconcile.
      ack: (ws && ws.playerState && ws.playerState._ackSeq) || 0,
    };
    if (fullBroadcast) {
      pkt.gs = {
        w: sim.wave,
        cz: sim.currentZone,        // BUG-FIX: cz = current zone INDEX (0/1/etc), inte stage.kind. Klient räknar `cz + 1` aritmetiskt.
        zs: sim.zoneState,
        bss: sim.bossSequenceStep,
        bd: sim.bossDefeated ? 1 : 0,
      };
    }
    // Dead body — prioritera egen kropp (om dead), annars första partners. Klient renderar
    // kroppen + revive-timern. Multi-body stöd: bara en sänds via wireformat (begränsning).
    if (sim.deadBodies) {
      let bodyToSend = sim.deadBodies[peerId];  // egen kropp först
      if (!bodyToSend) {
        // C146 (audit 2026-06-18): wireformatet bär bara EN kropp → välj den NÄRMASTE
        // (eller den denna peer aktivt återupplivar) istället för första iterations-
        // nyckeln. Annars renderar man en avlägsen kropp medan en kompis bredvid en
        // ligger osynlig.
        let bestD2 = Infinity;
        for (const otherPid in sim.deadBodies) {
          const b = sim.deadBodies[otherPid];
          if (b.revivedBy === peerId) { bodyToSend = b; break; } // den jag reviver vinner
          const bdx = b.x - px, bdy = b.y - py;
          const d2 = bdx * bdx + bdy * bdy;
          if (d2 < bestD2) { bestD2 = d2; bodyToSend = b; }
        }
      }
      if (bodyToSend) {
        pkt.db = {
          x: bodyToSend.x,
          y: bodyToSend.y,
          reviveTimer: bodyToSend.reviveTimer || 0,
          revivedBy: bodyToSend.revivedBy || null,
          color: '#222',
        };
      }
    }
    // Pickups: skickas i full broadcast eller om något ändrats
    if (sim.pickups && sim.pickups.length > 0) {
      pkt.pickups = getJsonPickups();   // memoiserat (samma för alla peers)
    } else if (fullBroadcast) {
      pkt.pickups = [];
    }
    // (critters skickas som eget br_critters-msg ovan; pkt.critters funkade ej for bin-peers)
    // Godot/V2: skicka world som JSON-text. gs varje tick (klient håller annars
    // gammalt wave/zone tills nästa full-broadcast).
    if (isJson) {
      if (!pkt.gs) pkt.gs = {
        w: sim.wave, cz: sim.currentZone, zs: sim.zoneState,
        bss: sim.bossSequenceStep, bd: sim.bossDefeated ? 1 : 0,
      };
      // v2-tillägg: gas/flame-hazards (server-skadan får inte vara osynlig).
      // Cullas mot spelaren, cap 40. k: 0=gas, 1=flame. lf = liv-fraktion.
      if ((sim.gasClouds && sim.gasClouds.length) || (sim.flameTrails && sim.flameTrails.length)) {
        const hz = [];
        for (const g of (sim.gasClouds || [])) {
          if (hz.length >= 40) break;
          if (Math.abs(g.x - px) < 1300 && Math.abs(g.y - py) < 1300) {
            hz.push({ x: Math.round(g.x), y: Math.round(g.y), r: Math.round(g.r), k: 0, lf: Math.round((g.life / (g.maxLife || g.life || 1)) * 100) / 100 });
          }
        }
        for (const f of (sim.flameTrails || [])) {
          if (hz.length >= 40) break;
          if (Math.abs(f.x - px) < 1300 && Math.abs(f.y - py) < 1300) {
            hz.push({ x: Math.round(f.x), y: Math.round(f.y), r: Math.round(f.r), k: 1, lf: Math.round(Math.min(1, f.life / 2.5) * 100) / 100 });
          }
        }
        if (hz.length) pkt.hz = hz;
      }
      // Backpressure (transport-pass 2026-06-10): world-snapshots är ERSÄTTLIGA
      // (nästa paket bär hela tillståndet) — om peerens sändbuffer backar upp
      // (>64KB ≈ 4-8 paket) skippas detta paket så en hickande telefon inte drar
      // igång dödsspiralen (växande buffer → sekunder av lag → timeout). Events
      // skickas fortfarande (de är små + oersättliga, egen 2MB-gräns ovan).
      // Loggas throttlat (max 1/5s per peer) så en långsam klient inte spammar.
      if (ws && ws.readyState === 1) {
        if (ws.bufferedAmount > 65536) {
          ws._worldSkips = (ws._worldSkips || 0) + 1;
          if (!ws._lastBpLogAt || now - ws._lastBpLogAt > 5000) {
            ws._lastBpLogAt = now;
            console.log('[BACKPRESSURE-WORLD-SKIP]', ws.id, 'buf=' + ws.bufferedAmount, 'totalSkips=' + ws._worldSkips);
          }
        } else {
          pkt.players = getJsonPlayers();
          pkt.type = 'world';
          // st (additivt): server-tidsstämpel för klientens interpolationsbuffert
          // (render-tid = st − buffertfönster i stället för ankomst-tid → jämn
          // rörelse även när paket-ankomsten jittrar).
          pkt.st = now;
          // UDP-peers (V2): world går på den OTILLFÖRLITLIGA kanalen (nyaste vinner,
          // släng gamla) → ett tappat world-paket blockerar aldrig nästa = inga
          // TCP-head-of-line-stalls. WS-peers (legacy) saknar sendUnreliable → vanlig
          // (tillförlitlig) send. Events går alltid ws.send (tillförlitligt) ovan/nedan.
          // AAA #1: bin-peers (UDP + bin:1) får BINÄR world (−76% + ingen JSON.parse
          // på telefonen = mindre värme). Magic 0xB1 → klienten skiljer från JSON-events.
          try {
            if (ws._binWorld && ws.sendUnreliable) {
              ws.sendUnreliable(encodeWorld(pkt));
            } else {
              const _wjson = JSON.stringify(pkt);
              (ws.sendUnreliable ? ws.sendUnreliable(_wjson) : ws.send(_wjson));
            }
          } catch (e) {}
        }
      }
      continue;
    }
    const payload = encodeWorldBinary(pkt);
    if (ws && ws.readyState === 1) {
      // Backpressure-guard: om klient inte hänger med (buffer fullt), skippa
      // denna tick. Klient re-syncs vid nästa full-broadcast (var 1500ms).
      // Tröskel 32KB är generös; klient adaptiv-rate kicked in vid 15KB.
      if (ws.bufferedAmount > 32768) continue;
      const out = Buffer.alloc(1 + payload.length);
      out[0] = 0;
      payload.copy(out, 1);
      try { ws.send(out, { binary: true }); } catch (e) {}
    }
  }

  // Cleanup peers som lämnat — både enemy-delta-cache OCH seq-tracker (annars
  // växer seqByPeer obegränsat över sessionens livstid).
  if (sim.lastSentEnemyByPeer.size > sim.room.members.size) {
    for (const peerId of [...sim.lastSentEnemyByPeer.keys()]) {
      if (!sim.room.members.has(peerId)) {
        sim.lastSentEnemyByPeer.delete(peerId);
        sim.seqByPeer.delete(peerId);
      }
    }
  }
  // C171 (audit 2026-06-18): _peerFullAt är ett plain object och städades ALDRIG ovan
  // (Map-guarden täcker bara lastSentEnemyByPeer/seqByPeer) → läckte en nyckel per peer
  // som lämnat över sessionens livstid. Pruna det separat (oberoende av guarden ovan).
  if (sim._peerFullAt) {
    for (const peerId in sim._peerFullAt) {
      if (!sim.room.members.has(peerId)) delete sim._peerFullAt[peerId];
    }
  }
}

function startSim(sim, opts) {
  if (sim.interval) return;
  // Bugfix: nollställ ALLA PvP-flags vid varje startSim. Annars läckte
  // tdmActive/ctfActive från föregående match in i nästa (rematch / mode-byte
  // i samma rum) och triggade fel logik-gren.
  sim.tdmActive = false;
  sim.ctfActive = false;
  sim.siegeActive = false;
  sim.gungameActive = false;
  sim.tdmEnded = false;
  sim.ctfEnded = false;
  sim.siegeEnded = false;
  sim.gungameEnded = false;
  sim.gungameWinner = null;
  sim.tdmKills = { red: 0, blue: 0 };
  sim.ctfCaptures = { red: 0, blue: 0 };
  sim.siegeScores = { red: 0, blue: 0 };
  sim.tdmKillsByPid = {};
  sim.tdmDeathsByPid = {};
  sim.tdmRoundActive = false;
  sim.tdmRoundNum = 0;
  sim.tdmRoundResetAt = 0;
  sim.tdmRoundWins = { red: 0, blue: 0 };
  sim._tdmRoundHadBoth = false;
  sim.ctfKillsByPid = {};
  sim.ctfCapturesByPid = {};
  sim.siegeKillsByPid = {};
  sim.gungameTiers = {};
  sim.gungameKillsByPid = {};
  sim._gungameSpawnIdx = 0;
  // KOTH reset
  sim.kothActive = false;
  sim.kothEnded = false;
  sim.kothWinner = null;
  sim.kothScores = {};
  sim.kothKillsByPid = {};
  sim.kothActiveZoneIdx = 0;
  sim._kothPointAccum = {};
  sim._kothSpawnIdx = 0;
  sim._kothZoneRotateAt = 0;
  sim._kothBroadcastTick = 0;
  // C233 (audit 2026-06-18): warning/contested-flaggor nollades EJ här → i en back-to-back-
  // match satt _kothWarningSent kvar (rensas annars bara vid zone-rotation) och första
  // zon-varningen suppressades. Nollställ båda vid match-start.
  sim._kothWarningSent = false;
  sim._kothContestedSent = 0;
  // JUGGERNAUT reset
  sim.juggernautActive = false;
  sim.juggernautEnded = false;
  sim.juggernautWinner = null;
  sim.juggernautPid = null;
  sim.juggernautWeapon = null;
  sim.juggernautScores = {};
  sim.juggernautKillsByPid = {};
  sim.juggernautHpMax = 0;
  sim.juggernautEndAt = 0;
  sim._juggernautLastPulseAt = 0;
  sim._juggernautSpawnIdx = 0;
  sim._juggernautScoreAccum = 0;
  sim._juggernautBroadcastTick = 0;
  sim._juggernautAwaitFirstRespawn = false;
  sim.juggernautDmgToJug = {};
  // BATTLE ROYALE reset
  sim.battleroyaleActive = false;
  sim.battleroyaleEnded = false;
  sim.battleroyaleWinner = null;
  sim.battleroyaleStartedAt = 0;
  sim.battleroyaleEndAt = 0;
  sim.battleroyalePhase = 0;
  sim.battleroyalePhaseStartedAt = 0;
  sim.battleroyalePhaseEndAt = 0;
  sim.battleroyaleZone = null;
  sim.battleroyaleLoot = [];
  sim.battleroyaleKillsByPid = {};
  sim.battleroyaleAliveCount = 0;
  sim.battleroyaleEliminated = [];
  sim.battleroyaleRanks = {};
  sim._brZoneDmgTick = 0;
  sim._brBroadcastTick = 0;
  sim._brLootIdCounter = 0;
  sim.battleroyaleStartCount = 0;
  // v1.748: nollställ ekonomi/meta-state vid (re)start så rematch i samma rum ej ärver
  sim.brCash = {};
  sim.brBuyStations = [];
  sim.brContracts = [];
  sim.brSupplyDrops = [];
  sim.brCritters = [];
  sim._brCritterIdCtr = 0;
  sim._brAirstrikes = [];
  sim._brContractIdCtr = 0;
  sim._brSupplyIdCtr = 0;
  sim._brBountyPingAccum = 0;
  sim._brBountyLast = 0;
  sim._brUavTick = 0;
  sim._brUavLast = 0;
  sim._brNextSupplyAt = 0;
  // CASTLE DEFENSE reset
  sim.castledefenseActive = false;
  sim.castledefenseEnded = false;
  sim.castledefenseStartedAt = 0;
  sim.castledefenseWave = 0;
  sim.castledefenseWaveBetweenEndAt = 0;
  sim.castledefenseWaveState = 'idle';
  sim.castledefenseCore = null;
  sim.castledefenseWalls = [];
  sim.castledefenseBuildings = [];
  sim.castledefenseScores = {};
  sim.castledefenseGold = {};
  sim.castledefenseWeaponTier = {};
  sim.castledefensePurchasedWeapons = {};
  sim.castledefensePerks = {};
  sim.castledefensePerkRanks = {};
  sim.castledefensePerkFlags = {};
  sim.castledefensePerkPoints = {};
  sim.castledefenseDownedPids = [];
  sim.castledefenseRevivedCount = 0;
  sim._cdBuildIdCounter = 0;
  sim._cdBroadcastTick = 0;
  sim._cdWaveSpawnsRemaining = 0;
  sim._cdWaveSpawnTimer = 0;
  sim._cdLastWaveProcessed = -1;   // v1.395 fix: rematch lämnade stale-värde annars
  sim._cdHudBroadcastAt = 0;
  sim._cdFlowField = null;          // pathfinding flow field (recomputed on first tick + on building changes)
  sim._cdFlowDirty = true;          // force first-tick build
  // v1.624: HEIST reset — annars läcker drillProgress=1, vault-unlocked, etc till nästa match
  sim.heistActive = false;
  sim.heistEnded = false;
  sim.heistPhase = 'stealth';
  sim.heistStartT = 0;
  sim.heistPhaseStartT = 0;
  sim.heistLootBagged = {};
  sim.heistLootValue = 0;
  sim.heistDrillProgress = 0;
  sim.heistDrilling = false;
  sim.heistAlarmTriggered = false;
  sim.heistVaultUnlocked = false;
  sim.heistNPCs = [];
  sim.heistRoles = {};
  sim.heistDroppedBags = [];
  sim.heistHackedTerminals = {};
  sim.heistDisabledCameras = {};
  sim.heistUnlockedDoors = {};
  sim.heistBackExtractUnlocked = false;
  sim.heistCeasefireUntil = 0;
  sim._heistNextPoliceAt = 0;
  sim._heistNextBagId = 1;
  sim._heistHudBroadcastAt = 0;
  sim._heistNpcBroadcastAt = 0;
  sim.bossAlive = false;            // även för CD-bossar — annars läcker till andra modes
  sim._siegePointAccum = { red: 0, blue: 0 };
  sim.pvpPickups = null;
  sim.bullets = [];
  sim.enemies = [];
  // Nollställ kvarvarande granat-/hazard-zoner per match — annars kan en stale gravity-
  // zon (2.6s livstid) från en tidigare PvP-match dra luftburna buss-riders i nästa
  // BR-predrop (gravity-pull saknar invuln-guard, till skillnad från eld-DoT).
  sim.grenadeZones = [];
  sim.gasClouds = [];
  sim.flameTrails = [];
  sim.eventQueue.length = 0;
  // v2 #62/#68 (additivt): nollställ per-match — V1 skickar aldrig fälten → 0 → no-op
  sim.countdownMs = 0;
  sim.baseShield = 0;
  sim._hasSandboxDummies = false;
  if (opts) {
    if (opts.difficulty) sim.config.difficulty = opts.difficulty;
    if (opts.ngpLevel) sim.config.ngpLevel = opts.ngpLevel;
    if (opts.mode) sim.config.mode = opts.mode;
    if (opts.wave) sim.wave = opts.wave;
    // v2-tillägg: dagliga modifiers (clampade i server.js, default 1 = no-op)
    if (opts.enemySpeedMul) sim.config.enemySpeedMul = opts.enemySpeedMul;
    if (opts.goldMul) sim.config.goldMul = opts.goldMul;
    // v2 #62: countdown-längd (clampad 1000-8000 i server.js). 0 = default 5000 (3000 heist).
    if (opts.countdownMs) sim.countdownMs = opts.countdownMs;
    // v2 #68: start-shield i alla modes (clampad 0-100 i server.js). 0 = V1-beteende.
    if (opts.baseShield > 0) sim.baseShield = Math.min(100, opts.baseShield);
    if (opts.tdm) {
      sim.tdmActive = true;
      sim.tdmTargetKills = opts.tdmTargetKills || 5;
    }
    if (opts.ctf) {
      sim.ctfActive = true;
      sim.ctfTargetCaptures = opts.ctfTargetCaptures || 3;
    }
    if (opts.siege) {
      sim.siegeActive = true;
      sim.siegeTargetPoints = opts.siegeTargetPoints || 500;
    }
    if (opts.gungame) {
      sim.gungameActive = true;
    }
    if (opts.koth) {
      sim.kothActive = true;
      sim.kothTargetPoints = opts.kothTargetPoints || 100;
    }
    if (opts.juggernaut) {
      sim.juggernautActive = true;
      sim.juggernautMatchDurationSec = opts.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration;
    }
    if (opts.battleroyale) {
      sim.battleroyaleActive = true;
      sim.battleroyaleMatchDurationSec = opts.battleroyaleMatchDurationSec || BATTLEROYALE_ARENA.defaultMatchDuration;
    }
    if (opts.castledefense) {
      sim.castledefenseActive = true;
    }
    // v1.525: SURVIVORS-RUN iteration 1 — återanvänder CD-sim som bas.
    // Iteration 2+ kommer ta bort byggsystem och göra time-based match-end.
    if (opts.survivors) {
      sim.castledefenseActive = true;
      sim.survivorsActive = true;
      sim.survivorsDurationSec = opts.survivorsDurationSec || 1200;
    }
    // v1.537: STRESS-TEST aktiverar survivors-pipeline + stresstest-flag
    if (opts.stresstest) {
      sim.castledefenseActive = true;
      sim.survivorsActive = true;
      sim.stresstestActive = true;
      sim.survivorsDurationSec = 3600; // 60 min så vi inte trippas av timeout
    }
    // v1.619: HEIST iteration 1 — egen mode med phase state-machine (stealth → alarm → extract)
    if (opts.heist) {
      sim.heistActive = true;
      sim.heistPhase = 'stealth';            // 'stealth' | 'alarm' | 'extract' | 'ended'
      sim.heistStartT = Date.now();
      sim.heistPhaseStartT = Date.now();
      sim.heistLootBagged = {};              // { lootId: true } när bagged
      sim.heistLootValue = 0;                // total $ value bagged
      sim.heistDrillProgress = 0;            // 0..1 vault OUTER drill (120s)
      sim.heistDrilling = false;             // någon spelare på outer-drill-spot
      // v1.646: INNER vault — andra-tier drill, 90s efter outer-vault är öppen.
      // gold_mega_stacks (15k×3 + cash 7.5k×2 + safe 5k×2 = ~58k extra) ligger i
      // inner-vault. Optional bonus — extract-fas kan börja efter bara outer-drill.
      sim.heistInnerDrillProgress = 0;       // 0..1 vault INNER drill (90s)
      sim.heistInnerDrilling = false;        // någon spelare på inner-drill-spot
      sim.heistInnerVaultUnlocked = false;
      sim.heistEnded = false;
      sim.heistRoles = opts.heistRoles || {}; // { peerId: 'hacker'|'tank'|'medic'|'rogue' }
      // v1.622: NPC-init (civilians + guards) — startposition från arena-data
      sim.heistNPCs = [];
      let nidx = 1;
      for (const cs of (HEIST_ARENA.civilianSpawns || [])) {
        sim.heistNPCs.push({
          id: 'civ' + (nidx++), type: 'civilian', subType: cs.kind || 'customer',
          x: cs.x, y: cs.y, hx: cs.x, hy: cs.y,
          state: 'idle', stateUntil: 0,
          facing: Math.random() * Math.PI * 2,
          speed: 100, hp: 30, maxHp: 30, dead: false,
        });
      }
      for (const gs of (HEIST_ARENA.guardSpawns || [])) {
        sim.heistNPCs.push({
          id: 'g' + (nidx++), type: 'guard', subType: gs.kind || 'lobby_guard',
          x: gs.x, y: gs.y, hx: gs.x, hy: gs.y,
          state: 'patrol', stateUntil: 0,
          facing: gs.facing || 0,
          speed: 70, hp: 60, maxHp: 60, dead: false,
          patrolPoints: gs.patrol || [[gs.x, gs.y]], patrolIdx: 0,
          cone: 0.7, range: 200,
        });
      }
    }
  }
  // Bot-spawn: lägg bot(s) som virtuella members INNAN mode-init så loopen tilldelar
  // dem team + spawn-pos precis som riktiga spelare. Pre-set team respekteras
  // av mode-init-loopen via ws._isBot-check.
  const botCount = Math.max(0, Math.min(24, (opts && opts.addBot) ? (opts.botCount || 1) : 0));
  if (botCount > 0) {
    const inTeamMode = sim.tdmActive || sim.ctfActive || sim.siegeActive;
    const skill = (opts && opts.botSkill) || 'normal';
    // V2: per-bot skill-mix. opts.botSkills[bi] (giltig nivå) > opts.botSkill > 'normal'.
    const perBotSkills = (opts && Array.isArray(opts.botSkills)) ? opts.botSkills : null;
    // stable-slot: bots tilldelas nästa stabila slot-index efter de riktiga
    // spelarna. Slot lagras på botWs.stableSlot och broadcastWorld läser det
    // via p._wsRef.stableSlot (precis som för riktiga peers). colorIdx i
    // bot_joined-eventet måste matcha så klientens slotToPeerId är konsistent.
    // room._nextSlot/-freeSlots kan vara oinitierade i test-stubs; fall tillbaka
    // till sim.room.members.size (positional) för bakåtkompatibilitet.
    const roomRef = sim.room;
    // Beräkna host-team-prediction (host hamnar typiskt i loop-index 0 = red).
    // 'auto'-default sätter bot på MOTSATT sida så solo-spelare får en motståndare,
    // inte en teammate. Med flera bots: alternera red/blue.
    const realCount = [...sim.room.members.values()].filter(m => !m._isBot).length;
    const hostPredictTeam = realCount > 0 ? 'red' : 'red'; // host typiskt i=0 → red
    for (let bi = 0; bi < botCount; bi++) {
      let botTeam = null;
      if (inTeamMode) {
        // Prio: per-bot-override från host-free-pick > botTeamMode > auto
        const perBotOverride = (opts && Array.isArray(opts.botTeams)) ? opts.botTeams[bi] : null;
        if (perBotOverride === 'red' || perBotOverride === 'blue') {
          botTeam = perBotOverride;
        } else {
          const tm = opts.botTeam || 'auto';
          if (tm === 'red') botTeam = 'red';
          else if (tm === 'blue') botTeam = 'blue';
          else {
            // AUTO: motsatt host. Med 1 bot = motsatt. Flera bots: alternera men
            // första boten på motsatt sida för balans.
            const oppHost = hostPredictTeam === 'red' ? 'blue' : 'red';
            if (botCount === 1) botTeam = oppHost;
            else botTeam = (bi % 2 === 0) ? oppHost : hostPredictTeam;
          }
        }
      }
      // Använd host-skickat namn om tillgängligt (synkar lobby ↔ match),
      // annars fall tillbaka till server-shuffle från BOT_NAMES.
      const customName = (opts && Array.isArray(opts.botNames) && opts.botNames[bi]) || null;
      const thisSkill = (perBotSkills && (perBotSkills[bi] === 'easy' || perBotSkills[bi] === 'normal' || perBotSkills[bi] === 'hard'))
        ? perBotSkills[bi] : skill;
      const botInfo = addBot(sim, botTeam, thisSkill, customName);
      // Tilldela stableSlot på botens fake-ws (samma mekanism som riktiga peers).
      // Bots återanvänder lediga slots precis som riktiga spelare.
      const botWs = roomRef.members.get(botInfo.id);
      let botSlot;
      if (botWs && roomRef._freeSlots) {
        if (roomRef._freeSlots.length > 0) {
          roomRef._freeSlots.sort((a, b) => a - b);
          botSlot = roomRef._freeSlots.shift();
        } else {
          botSlot = (roomRef._nextSlot != null) ? roomRef._nextSlot++ : roomRef.members.size - 1;
        }
        botWs.stableSlot = botSlot;
      } else if (botWs) {
        // Test-stub utan _freeSlots: falla tillbaka på positional
        botSlot = roomRef.members.size - 1;
        botWs.stableSlot = botSlot;
      } else {
        botSlot = roomRef.members.size - 1;
      }
      // Skicka bot_joined så klienter lägger in bot i sin Coop.players-map.
      // Ingen #N-suffix längre — namnen är redan unika via shuffle-poolen.
      sim.eventQueue.push({
        type: 'bot_joined',
        peerId: botInfo.id,
        name: botInfo.name,
        team: botTeam,
        colorIdx: botSlot,
      });
    }
  }
  console.log('[SIM]', sim.room.code, 'started mode=' + (sim.castledefenseActive ? 'castledefense' : (sim.battleroyaleActive ? 'battleroyale' : (sim.juggernautActive ? 'juggernaut' : (sim.ctfActive ? 'ctf' : (sim.tdmActive ? 'tdm' : sim.config.mode))))) + ' diff=' + sim.config.difficulty + (opts && opts.addBot ? ' +bot' : ''));
  // v2 #62 (additivt): countdown-längd. V1 skickar aldrig countdownMs → cdMs = 5000
  // exakt som de gamla hårdkodade värdena. Heist-grenen defaultar 3000 (som förut).
  const cdMs = sim.countdownMs || 5000;
  // Anti-mode-leakage: rensa JUG-flaggor från ev. förra match på alla members.
  // Annars kan en spelare som var JUG i förra rundan behålla isJug=true / scaleMul=1.8
  // / speedMul=1.35 / dashCdMs=1000 / maxHp=500 in i nästa mode.
  for (const [, ws] of sim.room.members) {
    if (!ws.playerState) continue;
    ws.playerState.isJug = false;
    ws.playerState.scaleMul = 1.0;
    ws.playerState.speedMul = 1.0;
    ws.playerState.dashCdMs = null;
    if (ws.playerState.maxHp > 100) ws.playerState.maxHp = 100;
    // ny match → släpp klientens rapporterade max (re-skickas i sim_input inom en
    // tick). Annars läcker t.ex. BR-perk-maxHp in i nästa TDM/gungame-respawn.
    ws.playerState._cliMaxHp = null;
    ws.playerState._cliMaxShield = null;
    // v1.769 KRITISK livscykel-fix: nollställ hp till full vid VARJE match-start.
    // Dog spelaren i förra matchen låg ws.playerState.hp kvar på 0 → buildPlayerList
    // la dem i deadBodies redan tick 1 → player_died-event → INSTANT DEATH på "try
    // again". PvP-grenarna nedan sätter ändå om hp+pos (opåverkade); detta räddar
    // co-op/story + castledefense/survivors/heist som saknade hp-reset.
    ws.playerState.hp = 100;
    // build 4 KRIT (survivors "respawn död"-buggen): nollställ DOWNED-flaggorna vid
    // VARJE match-start. Förr återställdes hp men cdDowned/cdDownDead låg kvar från
    // förra gamet → survivors lose-check (hp>0 && !cdDowned) såg ingen levande →
    // 'survivors_lose' tick 1 → instant loss på "spela igen", om och om igen.
    ws.playerState.cdDowned = false;
    ws.playerState.cdDownDead = false;
    // build 4 ("fixa det helt — alla lägen"): nollställ ÄVEN PvP-död-flaggorna så
    // ingen stale död-/respawn-state läcker in i en ny match oavsett mode.
    ws._tdmDeadRound = false;
    ws.tdmRespawnAt = 0;
    // G3-fix 2026-06-15 (rematch-gummiband): sätt _lastInputT till 1s bakåt så
    // anti-teleport-clampen i applyPlayerInput alltid får dt=0.25s (max) vid FÖRSTA
    // input i ny match. castledefenseActive (survivors/CD) körs med inPvP=true →
    // clampen aktiveras. Med stale _lastInputT som råkar vara exakt nu (input skickades
    // precis innan sim_start) → dt=0.001 → maxDelta=5px → klienten klampas vid spawn.
    // "undefined" gav samma problem (undefined → lastT=now → dt≈0). 1s bakåt garanterar
    // dt=min(0.25, 1.0)=0.25s → maxDelta=254px → normal rörelse alltid tillåten.
    ws._lastInputT = Date.now() - 1000;
    ws.playerState.invulnUntil = Date.now() + 1500;
    // v2 #68 (additivt): start-shield i ALLA modes (inkl. co-op-story + bots).
    // V1 skickar aldrig baseShield → grenen körs aldrig → gammalt beteende exakt.
    // PvP/CD/heist-grenarna nedan kan skriva över (PvP = 100 som förut).
    if (sim.baseShield > 0) {
      ws.playerState.shield = sim.baseShield;
      if (!ws.playerState.maxShield || ws.playerState.maxShield < sim.baseShield) {
        ws.playerState.maxShield = Math.max(100, sim.baseShield);
      }
    }
  }
  if (sim.ctfActive) {
    // CTF: dedikerad arena (4500×2800 med walls). Symmetrisk röd/blå.
    sim.simReadyAt = Date.now() + cdMs;
    // Init flag-state från CTF_ARENA
    for (const team of ['red', 'blue']) {
      const fs = CTF_ARENA.flags[team];
      sim.ctfFlags[team] = {
        baseX: fs.baseX, baseY: fs.baseY,
        x: fs.baseX, y: fs.baseY,
        carrierId: null, atBase: true, droppedAt: 0,
      };
    }
    // Init turret-state per lag (full hp, ingen occupant, ej destroyed)
    sim.ctfTurrets = {};
    for (const t of CTF_ARENA.turrets) {
      sim.ctfTurrets[t.id] = {
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r,
        hp: t.maxHp, maxHp: t.maxHp,
        occupantId: null, destroyed: false, destroyedAt: 0,
        lastShotAt: 0, aim: 0,
      };
    }
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      // Bot:s tdmTeam är pre-satt av addBot — respektera. Andra spelare alternerar.
      const team = ws.tdmTeam || (i % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      ws.playerState = ws.playerState || {};
      // Spawn på random egna spawn-point (slumpa per spelare så 8-mannarum
      // inte staplar players ovanpå varandra på samma pixel).
      const pts = CTF_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.ctfKillsByPid[pid] = 0;
      sim.ctfCapturesByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    // PvP-pickups på CTF-arenan — symmetrisk 4 HP + 4 shield, respawn 15s
    sim.pvpPickups = buildCtfPickups(sim);
    sim.eventQueue.push({
      type: 'ctf_started',
      targetCaptures: sim.ctfTargetCaptures,
      teams,
      arena: { worldW: CTF_ARENA.worldW, worldH: CTF_ARENA.worldH, name: CTF_ARENA.name },
      flags: {
        red:  { baseX: CTF_ARENA.flags.red.baseX,  baseY: CTF_ARENA.flags.red.baseY  },
        blue: { baseX: CTF_ARENA.flags.blue.baseX, baseY: CTF_ARENA.flags.blue.baseY },
      },
      spawns: CTF_ARENA.spawns,
      walls: CTF_ARENA.walls,
      pickupRadius: CTF_ARENA.pickupRadius,
      captureRadius: CTF_ARENA.captureRadius,
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
      turrets: Object.values(sim.ctfTurrets).map(t => ({
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r, maxHp: t.maxHp, hp: t.hp,
      })),
      turretEnterRadius: CTF_ARENA.turretEnterRadius,
      decorations: CTF_ARENA.decorations || [],
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
  } else if (sim.tdmActive) {
    // PvP-mode: dedikerad TDM-arena (4000×3000 öppet fält). Inget enemy-spawn,
    // ingen wave-progression. Lagen spawnar på motsatta sidor.
    sim.simReadyAt = Date.now() + cdMs;
    sim.tdmArena = { worldW: TDM_ARENA.worldW, worldH: TDM_ARENA.worldH, name: TDM_ARENA.name };
    const arena = sim.tdmArena;
    // Team-tilldelning först — alternering så lag blir jämna
    const teams = {};
    const redIds = [], blueIds = [];
    let tIdx = 0;
    for (const [pid, ws] of sim.room.members) {
      const team = ws.tdmTeam || (tIdx % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      teams[pid] = team;
      if (team === 'red') redIds.push(pid); else blueIds.push(pid);
      tIdx++;
    }
    // Spawn-pool per team (array av punkter från arena-config)
    const redPool = TDM_ARENA.spawns.red;
    const bluePool = TDM_ARENA.spawns.blue;
    const redSpawns = pickSpreadSpawns(redPool, redIds.length);
    const blueSpawns = pickSpreadSpawns(bluePool, blueIds.length);
    // Tilldela varje spelare en UNIK spawn från sin team-pool
    let ri = 0, bi = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = ws.tdmTeam === 'red' ? redSpawns[ri++] : blueSpawns[bi++];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      // fy_: alla startar med pistol; vapen greppas från marken
      ws.playerState.weaponId = 'pistol';
      // v2 anti-cheat: serverns spegel av fy_-förrådet (fylls i tickPvpPickups,
      // nollställs för förlorande laget i resetTdmRound). Används av
      // clampWeaponToModeArsenal i applyShoot.
      ws._tdmPickedWeapons = [];
      ws.tdmRespawnAt = 0;
      ws._tdmDeadRound = false;
      sim.tdmKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
    }
    // CS-runda 1 startar direkt (spelarna spawnades redan ovan)
    sim.tdmRoundNum = 1;
    sim.tdmRoundActive = true;
    sim.tdmRoundResetAt = 0;
    sim._tdmRoundHadBoth = (redIds.length > 0 && blueIds.length > 0);
    // Legacy fallback-spawn-coords (top/bottom-orienterad arena: röd uppe, blå nere)
    const spawnX = Math.floor(arena.worldW * 0.50);
    const redSpawnY = Math.floor(arena.worldH * 0.10);
    const blueSpawnY = Math.floor(arena.worldH * 0.90);
    // PvP-pickups på arenan — vapen-rad + center-granater + HP/shield
    sim.pvpPickups = buildTdmPickups(sim, arena);
    // Skicka arena-info + walls (TDM har nu cover så sniper inte one-shots edge-to-edge)
    sim.eventQueue.push({
      type: 'tdm_started',
      targetKills: sim.tdmTargetKills,
      teams,
      arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
      walls: TDM_ARENA.walls,
      spawns: { red: { x: spawnX, y: redSpawnY }, blue: { x: spawnX, y: blueSpawnY } },
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type, weaponId: p.weaponId })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
  } else if (sim.siegeActive) {
    // SIEGE THE BASE: 5000×3000 arena med 2 cores + 6 capture-bases.
    sim.simReadyAt = Date.now() + cdMs;
    // Init cores
    sim.siegeCores = {};
    for (const c of SIEGE_ARENA.cores) {
      sim.siegeCores[c.id] = {
        id: c.id, team: c.team, x: c.x, y: c.y, w: c.w, h: c.h,
        hp: c.maxHp, maxHp: c.maxHp, destroyed: false,
      };
    }
    // Init bases — ALLA startar NEUTRALA (grå)
    sim.siegeBases = {};
    for (const b of SIEGE_ARENA.bases) {
      sim.siegeBases[b.id] = {
        id: b.id, x: b.x, y: b.y, r: b.r,
        owner: null,                // alla starts neutral
        captureProgress: 0,         // 0..1
        captureSide: null,          // 'red' / 'blue' / null
        phase: null,                // 'neutralize' / 'capture' / null
      };
    }
    // Init turrets — bevara weaponId + turretType per torn
    sim.siegeTurrets = {};
    for (const t of SIEGE_ARENA.turrets) {
      sim.siegeTurrets[t.id] = {
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r,
        hp: t.maxHp, maxHp: t.maxHp,
        occupantId: null, destroyed: false, destroyedAt: 0,
        weaponId: t.weaponId || 'turret_mg',
        turretType: t.turretType || 'mg',
      };
    }
    // Team-tilldelning + spawn
    const teams = {};
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      // Bot:s tdmTeam är pre-satt av addBot — respektera. Andra alternerar.
      const team = ws.tdmTeam || (i % 2 === 0 ? 'red' : 'blue');
      ws.tdmTeam = team;
      ws.playerState = ws.playerState || {};
      const pts = SIEGE_ARENA.spawns[team];
      const sp = pts[Math.floor(Math.random() * pts.length)];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      teams[pid] = team;
      sim.siegeKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    sim.pvpPickups = buildSiegePickups(sim);
    sim.eventQueue.push({
      type: 'siege_started',
      targetPoints: sim.siegeTargetPoints,
      teams,
      arena: { worldW: SIEGE_ARENA.worldW, worldH: SIEGE_ARENA.worldH, name: SIEGE_ARENA.name },
      spawns: SIEGE_ARENA.spawns,
      walls: SIEGE_ARENA.walls,
      cores: Object.values(sim.siegeCores).map(c => ({ id: c.id, team: c.team, x: c.x, y: c.y, w: c.w, h: c.h, maxHp: c.maxHp, hp: c.hp })),
      bases: Object.values(sim.siegeBases).map(b => ({ id: b.id, x: b.x, y: b.y, r: b.r, owner: b.owner })),
      turrets: Object.values(sim.siegeTurrets).map(t => ({
        id: t.id, team: t.team, x: t.x, y: t.y, r: t.r, maxHp: t.maxHp, hp: t.hp,
        weaponId: t.weaponId, turretType: t.turretType,
      })),
      turretEnterRadius: SIEGE_ARENA.turretEnterRadius,
      captureTimeSec: SIEGE_ARENA.captureTimeSec,
      neutralizeTimeSec: SIEGE_ARENA.neutralizeTimeSec,
      decorations: SIEGE_ARENA.decorations || [],
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
    // Bullets.js behöver kunna kalla endSiegeMatch när core förstörs.
    // Eftersom funktionen är local i denna fil exponerar vi via sim-objektet.
    sim._endSiegeMatch = endSiegeMatch;
  } else if (sim.gungameActive) {
    // GUNGAME: FFA på 3500×2000 close-quarters arena, 15-tier progression.
    // Start-vapen = pistol (tier 0, ingen kniv). Tier 15 = katana (final melee).
    sim.simReadyAt = Date.now() + cdMs;
    // FFA — alla är fiender → använd max-spread så ingen spawnar bredvid varandra.
    const playerCount = sim.room.members.size;
    const spreadSpawns = pickSpreadSpawns(GUNGAME_ARENA.spawns, playerCount);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = spreadSpawns[i];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.playerState.weaponId = GUNGAME_WEAPONS[0]; // pistol (tier 0)
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA - inget team
      sim.gungameTiers[pid] = 0;
      sim.gungameKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      i++;
    }
    sim._gungameSpawnIdx = i; // fortsätt rotera vid respawn
    // Gungame: INGA pickups (varken hp/shield/granater — granater finns inte i GG)
    sim.pvpPickups = [];
    sim.eventQueue.push({
      type: 'gungame_started',
      arena: { worldW: GUNGAME_ARENA.worldW, worldH: GUNGAME_ARENA.worldH, name: GUNGAME_ARENA.name },
      walls: GUNGAME_ARENA.walls,
      spawns: GUNGAME_ARENA.spawns,
      decorations: GUNGAME_ARENA.decorations || [],
      pvpPickups: [],
      weapons: GUNGAME_WEAPONS,
      totalTiers: GUNGAME_WEAPONS.length,
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
    // Exponera promote/demote till bullets.js
    sim._endGungameMatch = endGungameMatch;
  } else if (sim.kothActive) {
    // KOTH: hold-the-hill FFA på 3500×2000 close-quarters arena.
    sim.simReadyAt = Date.now() + cdMs;
    // Bot:s vapen-roterande i KOTH — random från common-arsenal så de inte alla
    // har samma vapen. Riktiga spelare behåller sin equipped.
    const KOTH_BOT_WEAPONS = ['pistol', 'smg', 'rifle', 'shotgun', 'ak', 'dualpistol'];
    // FFA — max-spread så ingen spawnar bredvid varandra.
    const kothPlayerCount = sim.room.members.size;
    const kothSpreadSpawns = pickSpreadSpawns(KOTH_ARENA.spawns, kothPlayerCount);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = kothSpreadSpawns[i];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = 100;
      ws.playerState.shield = 100;
      ws.playerState.maxShield = 100;
      ws.playerState.invulnUntil = Date.now() + 1500;
      // Bots får random gun, riktiga spelare behåller sin equipped (default pistol).
      if (ws._isBot) {
        ws.playerState.weaponId = KOTH_BOT_WEAPONS[Math.floor(Math.random() * KOTH_BOT_WEAPONS.length)];
      } else if (!ws.playerState.weaponId) {
        ws.playerState.weaponId = 'pistol';
      }
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.kothScores[pid] = 0;
      sim.kothKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      sim._kothPointAccum[pid] = 0;
      i++;
    }
    sim._kothSpawnIdx = i;
    sim.kothActiveZoneIdx = 0;
    sim._kothZoneRotateAt = Date.now() + (KOTH_ARENA.zoneRotateSec || 45) * 1000;
    // PvP-pickups: 4 HP + 4 shield runt arenan
    sim.pvpPickups = buildKothPickups(sim);
    sim.eventQueue.push({
      type: 'koth_started',
      arena: { worldW: KOTH_ARENA.worldW, worldH: KOTH_ARENA.worldH, name: KOTH_ARENA.name },
      walls: KOTH_ARENA.walls,
      spawns: KOTH_ARENA.spawns,
      decorations: KOTH_ARENA.decorations || [],
      zones: KOTH_ARENA.zones,
      activeZoneIdx: sim.kothActiveZoneIdx,
      zoneRotateSec: KOTH_ARENA.zoneRotateSec,
      nextRotateAt: sim._kothZoneRotateAt,
      targetPoints: sim.kothTargetPoints,
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: 100,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
    sim._endKothMatch = endKothMatch;
  } else if (sim.juggernautActive) {
    // JUGGERNAUT: 5000×3500 underjordisk parkering. Random human blir initial JUG.
    // Spawn-logik: JUG ensam på ena sidan, ALLA HUNTERS klustrade på motsatt sida
    // — så hunters kan koordinera mot JUG direkt utan att JUG kan one-shot:a en
    // ensam hunter vid match-start.
    sim.simReadyAt = Date.now() + cdMs;
    const humanIds = [];
    const allPids = [];
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      if (!ws._isBot) humanIds.push(pid);
      allPids.push(pid);
    }
    // Välj initial JUG först (random human)
    let initialJug = null;
    if (humanIds.length > 0) initialJug = humanIds[Math.floor(Math.random() * humanIds.length)];
    // JUG-spawn: pick random från pool. Hunters-spawn-base: spawn LÄNGST från JUG.
    const allSpawns = JUGGERNAUT_ARENA.spawns;
    const jugSpawn = allSpawns[Math.floor(Math.random() * allSpawns.length)];
    // Hitta spawn längst bort från JUG → hunters samlas där
    let hunterBase = allSpawns[0];
    let bestD2 = -1;
    for (const sp of allSpawns) {
      const dx = sp.x - jugSpawn.x, dy = sp.y - jugSpawn.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) { bestD2 = d2; hunterBase = sp; }
    }
    // Tilldela spawns: JUG på sin spawn, hunters klustrade runt hunterBase med jitter
    const hunterCount2 = allPids.length - (initialJug ? 1 : 0);
    let hunterIdx = 0;
    for (const pid of allPids) {
      const ws = sim.room.members.get(pid);
      let sp;
      if (pid === initialJug) {
        sp = jugSpawn;
      } else {
        // Hunter: kluster runt hunterBase med jitter så de inte stackar
        const angle = (hunterIdx / Math.max(1, hunterCount2)) * Math.PI * 2;
        const radius = 60 + (hunterIdx % 3) * 30; // 60-120px
        sp = {
          x: hunterBase.x + Math.cos(angle) * radius,
          y: hunterBase.y + Math.sin(angle) * radius,
        };
        hunterIdx++;
      }
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      // Default = hunter — JUG-roll appliceras efter spawning
      applyHunterStats(sim, ws);
      ws.playerState.invulnUntil = Date.now() + 1500;
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.juggernautScores[pid] = 0;
      sim.juggernautKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
    }
    sim._juggernautSpawnIdx = allPids.length;
    sim.juggernautWeapon = JUGGERNAUT_ARENA.jugDefaultWeapon;
    // Beräkna JUG HP utifrån hunter-count (snapshot vid start)
    const hunterCount = Math.max(1, sim.room.members.size - 1);
    sim.juggernautHpMax = JUGGERNAUT_ARENA.jugBaseHp + JUGGERNAUT_ARENA.jugHpPerHunter * hunterCount;
    sim.juggernautEndAt = Date.now() + (sim.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration) * 1000;
    // Pickups
    sim.pvpPickups = buildJuggernautPickups(sim);
    // Aktivera JUG-stats på den valde
    if (initialJug) {
      const jws = sim.room.members.get(initialJug);
      if (jws) applyJugStats(sim, jws);
      sim.juggernautPid = initialJug;
    }
    sim.eventQueue.push({
      type: 'juggernaut_started',
      arena: { worldW: JUGGERNAUT_ARENA.worldW, worldH: JUGGERNAUT_ARENA.worldH, name: JUGGERNAUT_ARENA.name },
      walls: JUGGERNAUT_ARENA.walls,
      spawns: JUGGERNAUT_ARENA.spawns,
      decorations: JUGGERNAUT_ARENA.decorations || [],
      pvpPickups: sim.pvpPickups.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
      shieldMax: JUGGERNAUT_ARENA.hunterShieldMax || 100,
      initialJug,
      jugWeapons: JUGGERNAUT_ARENA.jugWeapons,
      jugDefaultWeapon: JUGGERNAUT_ARENA.jugDefaultWeapon,
      jugHpMax: sim.juggernautHpMax,
      jugShieldMax: JUGGERNAUT_ARENA.jugShieldMax || 200,
      jugSpeedMul: JUGGERNAUT_ARENA.jugSpeedMul,
      jugScale: JUGGERNAUT_ARENA.jugScale,
      jugDashCdMs: JUGGERNAUT_ARENA.jugDashCdMs,
      hunterWeapon: JUGGERNAUT_ARENA.hunterWeapon,
      hunterSpeedMul: JUGGERNAUT_ARENA.hunterSpeedMul || 1.10,
      hunterShieldMax: JUGGERNAUT_ARENA.hunterShieldMax || 100,
      hunterDashCdMs: 3000,
      matchDurationSec: sim.juggernautMatchDurationSec || JUGGERNAUT_ARENA.defaultMatchDuration,
      matchEndAt: sim.juggernautEndAt,
      minimapPulseIntervalMs: JUGGERNAUT_ARENA.minimapPulseIntervalMs,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
    // Exponera kill-handler + dmg-tracker till bullets.js
    sim._handleJuggernautKill = handleJuggernautKill;
    sim._trackJuggernautDmg = trackJuggernautDmg;
  } else if (sim.battleroyaleActive) {
    // BATTLE ROYALE: 6000×6000 FFA no-respawn arena. Krympande zon.
    sim.simReadyAt = Date.now() + cdMs;
    const arena = BATTLEROYALE_ARENA;
    // Initial zon = täcker HELA kartan inklusive hörn. Diagonal/2 + buffer.
    // För 10000×10000 ger sqrt(2)*5000 ≈ 7071, +200 buffer = 7272 så hörn-spawns ligger inne.
    const initialR = Math.round(Math.sqrt(2) * Math.max(arena.worldW, arena.worldH) / 2 + 200);
    sim.battleroyaleZone = {
      x: arena.worldW / 2,
      y: arena.worldH / 2,
      r: initialR,
      startX: arena.worldW / 2,
      startY: arena.worldH / 2,
      startR: initialR,
      nextX: arena.worldW / 2,
      nextY: arena.worldH / 2,
      nextR: initialR,
    };
    // v1.378: pre-bestäm var FINAL-zonen ska hamna (random på hela mapen).
    // Varje shrink-phase lerpar mot detta target → variation match-till-match.
    const finalAreaFrac = arena.phases[arena.phases.length - 1].areaFrac;
    const finalR = Math.round(Math.sqrt(arena.worldW * arena.worldH * finalAreaFrac / Math.PI));
    sim.brFinalCenterX = finalR + Math.random() * (arena.worldW - 2 * finalR);
    sim.brFinalCenterY = finalR + Math.random() * (arena.worldH - 2 * finalR);
    sim.battleroyalePhase = 0;
    sim.battleroyaleStartedAt = Date.now();
    sim.battleroyaleEndAt = Date.now() + sim.battleroyaleMatchDurationSec * 1000;
    sim.battleroyalePhaseStartedAt = Date.now();
    const totalDurSec = sim.battleroyaleMatchDurationSec;
    sim.battleroyalePhaseEndAt = Date.now() + arena.phases[0].durationFrac * totalDurSec * 1000;
    // === BR PRE-DROP / BATTLE BUS (additivt, gated på opts.brPredrop) ===
    // Bussen flyger en rak linje genom kartans mitt i en slumpvinkel; båda ändpunkter
    // ligger UTANFÖR kartan så den syns flyga in och ut. Spelarna åker den (visuellt på
    // klienten), trycker HOPPA → freefall, styr med joysticken, fallskärm deployar sent.
    // Servern kör en state-maskin + hård deadline (så fasen aldrig hänger).
    sim.brPredrop = !!(opts && opts.brPredrop);
    if (sim.brPredrop) {
      const _now = Date.now();
      const W = arena.worldW, H = arena.worldH;
      const ang = Math.random() * Math.PI * 2;
      const cx = W / 2, cy = H / 2;
      const half = Math.sqrt(W * W + H * H) / 2 + 600;   // start/slut strax utanför kartan
      const BUS_DUR_MS = (opts && opts.brBusDurMs) || 20000;   // LÄNGRE fly time (var 13000); klienten läser durMs ur br_started
      // Bussen startar EFTER countdown-gaten släppt (cdMs) så tidslinjen matchar alla
      // andra lägen (klienten är input-låst under countdown ändå).
      sim.brBus = {
        startX: Math.round(cx - Math.cos(ang) * half),
        startY: Math.round(cy - Math.sin(ang) * half),
        endX: Math.round(cx + Math.cos(ang) * half),
        endY: Math.round(cy + Math.sin(ang) * half),
        startAt: _now + cdMs,
        durMs: BUS_DUR_MS,
      };
      // Hård deadline: countdown + buss-överfart + max-luft (freefall+fallskärm) + marginal.
      sim.brPredropDeadlineAt = _now + cdMs + BUS_DUR_MS + BR_FREEFALL_MS + BR_CHUTE_MS + 4000;
      sim._brPredropBroadcastAt = 0;
    } else {
      sim.brBus = null;
      sim.brPredropDeadlineAt = 0;
    }
    // Init loot från arena
    sim.battleroyaleLoot = initBrLoot(sim);
    // Init alla spelare på spridd spawn-punkt — MAX-SPREAD via pickSpreadSpawns
    // så ingen spawnar bredvid varandra ens i en full lobby.
    let aliveCount = 0;
    const brSpreadSpawns = pickSpreadSpawns(arena.spawns, sim.room.members.size);
    let i = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = brSpreadSpawns[i];
      if (sim.brPredrop) {
        // Åk bussen: starta vid bussens startpunkt. brLandX/Y = den spridda spawn-
        // punkten (fallback-landning för bottar/forcerad landning; en spelare som styr
        // i freefall landar där DEN flög, se landBrPlayer).
        ws.playerState.x = sim.brBus.startX;
        ws.playerState.y = sim.brBus.startY;
        ws.playerState.brLandX = sp.x;
        ws.playerState.brLandY = sp.y;
        ws.playerState.brAir = 1;            // på bussen
        ws.playerState.brJumpedAt = 0;
        // Odödlig hela luftfasen (ingen skada i luften ändå) + landnings-grace; sätts om
        // till +1500ms vid landning (landBrPlayer).
        ws.playerState.invulnUntil = sim.brPredropDeadlineAt + 1500;
      } else {
        ws.playerState.x = sp.x;
        ws.playerState.y = sp.y;
        ws.playerState.brAir = 0;            // ej predrop → "redan landad"
        ws.playerState.brJumpedAt = 0;
        ws.playerState.invulnUntil = Date.now() + 1500;
      }
      ws.playerState.hp = arena.startHp;
      ws.playerState.maxHp = arena.maxHp;
      ws.playerState.shield = arena.startShield;
      ws.playerState.maxShield = arena.maxShield;
      ws.playerState.weaponId = arena.startWeapon;
      ws.playerState._brWeaponTier = 'starter'; // för tier-baserad pickup-jämförelse
      // v2 anti-cheat: serverns spegel av BR-inventoriet (starter-trion, speglar
      // klientens save.owned-reset i br_started). Fylls på vid loot/supply/shop.
      ws._brOwnedWeapons = new Set(['fists', 'knife', arena.startWeapon || 'pistol']);
      ws.playerState.isJug = false;
      ws.playerState.scaleMul = 1.0;
      ws.playerState.speedMul = 1.0;
      ws.playerState.dashCdMs = null;
      // V2 BR-meta 2.0: nivå-baserade perks + stackbara bag-förbrukningsvaror + per-match-cash.
      ws.playerState.brPerkLevels = {};   // nivåer: move_speed/dash_cd/max_hp/shield/dmg_redux/self_revive/rapid_fire/fast_hands/dmg
      ws.playerState.gasMask = false;     // (kvar för storm-kod; ej längre köpbar)
      ws.playerState.selfReviveKits = 0;  // self_revive-perk → auto-används vid down
      ws.playerState.airstrikes = 0;      // bag: airstrike-laddningar
      ws.playerState.uavCount = 0;        // bag: UAV-laddningar
      ws.playerState.medkits = 0;         // bag: medkit (heal-over-time)
      ws.playerState.shieldkits = 0;      // bag: shieldkit (shield-refill)
      ws.playerState.adrenalines = 0;     // bag: adrenalin (+50% fart 8s)
      ws.playerState.brMedkitTicks = 0;   // pågående medkit-heal-tick-räknare
      ws.playerState.brMedkitNext = 0;
      ws.playerState.brAdrenalineEnd = 0;
      ws.playerState.brUavUntil = 0;      // UAV-reveal aktiv till (ms)
      ws.playerState.brDowned = false;
      ws.playerState.brReviveEnd = 0;
      // GULAG (v1.790): nollställ per-match så förra matchens gulag-state ej bleeder in
      ws.playerState.gulagUsed = false;
      ws.playerState.gulagState = null;
      ws.playerState._gulagMatchId = null;
      ws.playerState._gulagGame = null;
      ws.playerState._gulagWeapon = null;
      ws.playerState._gulagNoShoot = false;
      ws.playerState.spectating = false;
      // v1.798: nollställ kill-credit-state vid match-start (annars kan stale attacker
      // från förra matchen ge fel kill-credit på första döden).
      ws.playerState._brLastAttacker = null;
      ws.playerState._brLastWeapon = null;
      ws.playerState._brLastAttackerAt = 0;
      ws._brCreditedKill = false;
      // v1.807: defensiv nollställning av ALLA gulag-temp-fält vid match-start (clearGulagFields
      // gör det vid resolve, men en reconnect/edge utan teardown ska ej läcka buffs till live-BR).
      ws.playerState.gulagState = null;
      ws.playerState._gulagWeapons = null; ws.playerState._gulagWeapon = null;
      ws.playerState._gulagDmgUntil = 0; ws.playerState._gulagVampUntil = 0;
      ws.playerState._gulagSpeedUntil = 0; ws.playerState._gulagGunUntil = 0;
      ws.playerState._gulagFrozenUntil = 0; ws.playerState._gulagSlowUntil = 0;
      ws.playerState._gulagConfuseUntil = 0; ws.playerState._gulagMagnetUntil = 0;
      ws.playerState._gulagKnockUntil = 0;
      ws.playerState.brPerkLevels = {};   // V2: nivå-baserade perks (nollställ per match)
      ws.playerState.brContract = null;   // (v1.746) aktivt kontrakt {id,type,...}
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // FFA
      sim.battleroyaleKillsByPid[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      sim.brCash[pid] = sim._brStartCash; // startkapital
      aliveCount++;
      i++;
    }
    sim.battleroyaleAliveCount = aliveCount;
    // BUY STATIONS (v1.739): välj ≥12 stugor (utseende-identiska med vanliga hus) +
    // 1 alien-shop i lila SE-hörnet. Deterministiskt urval (var 3:e stuga) så det
    // är spritt över kartan. Servern validerar köp mot dessa positioner (anti-cheat).
    sim.brBuyStations = computeBrBuyStations(arena);
    // CONTRACTS (v1.746): placera kontrakt på billboards spridda över kartan.
    sim.brContracts = computeBrContracts(sim, arena);
    spawnBrCritters(sim, arena);
    sim._brNextSupplyAt = Date.now() + 75000; // första supply-drop efter ~75s
    // v1.655: Antal deltagare vid start. Win-checken (<=1 levande) får INTE
    // trigga om matchen startade med en ensam spelare (0 bots) → annars
    // avslutas matchen direkt på första ticken. Kräver >=2 för att aktiveras.
    sim.battleroyaleStartCount = aliveCount;
    // GULAG (v1.790): referens till arenan för redeploy-pos + nollställ ev. gulag-state
    sim._brArena = arena;
    sim.gulagQueue = [];
    sim.gulagMatches = [];
    if (sim._gulagSlotsUsed) sim._gulagSlotsUsed.clear();
    sim._gulagMatchCounter = 0;
    sim._gulagLoneSince = 0; // v1.798: nollställ deadlock-timern (defensiv state-hygien)
    sim.eventQueue.push({
      type: 'br_started',
      arena: { worldW: arena.worldW, worldH: arena.worldH, name: arena.name },
      // walls (274KB!) + decorations (35KB) UTELÄMNADE: klienten läser dem ALDRIG ur
      // br_started — den bygger banan lokalt (Arena.gd, res://data/arenas) + cabins nedan.
      // Drar ner br_started 400KB→~90KB → klienten dränker inte reliable-kanalen (rel-giveup/
      // backpressure-disconnect i predrop). Server-auktoritär på kollision oförändrat.
      spawns: arena.spawns,
      // KRITISKT: skicka BARA de cabin-fält klienten faktiskt RITAR (BrLayer._setup_cabins):
      // bounds/door/windows/roof/floor/shop/_isContainer. Strippa interior(18KB)/name/id —
      // br_started 90KB→~60KB (~55 frag). Klientens UdpSock har MAX_FRAGS=64 → ett reliable-
      // meddelande >64 fragment (>70KB) FÖRKASTAS osett → aldrig ackat → server rel-giveup-
      // disconnect (det som bröt BR i predrop). Håll br_started gott under 64 frag.
      cabins: (arena.cabins || []).map(c => ({
        bounds: c.bounds, door: c.door, windows: c.windows,
        roof: c.roof, floor: c.floor, shop: c.shop, _isContainer: c._isContainer,
      })),
      buyStations: sim.brBuyStations,
      contracts: sim.brContracts.map(c => ({ id: c.id, x: c.x, y: c.y, type: c.type, available: c.available })),
      startCash: sim._brStartCash,
      loot: sim.battleroyaleLoot.map(lo => ({
        id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: lo.unlockAt || 0,
      })),
      phases: arena.phases,
      matchDurationSec: sim.battleroyaleMatchDurationSec,
      matchEndAt: sim.battleroyaleEndAt,
      phaseEndAt: sim.battleroyalePhaseEndAt,
      currentPhase: 0,
      zone: {
        x: sim.battleroyaleZone.x,
        y: sim.battleroyaleZone.y,
        r: sim.battleroyaleZone.r,
      },
      aliveCount,
      startWeapon: arena.startWeapon,
      startHp: arena.startHp,
      maxHp: arena.maxHp,
      maxShield: arena.maxShield,
      lootPickupRadius: arena.lootPickupRadius,
      shieldMax: arena.maxShield,
      worldW: arena.worldW,
      worldH: arena.worldH,
      // BR PRE-DROP / BATTLE BUS-bana (klienten räknar buss-pos ur banan + world.st,
      // samma klocka servern drar riders med → synkat utan extra paket). Null när av.
      predrop: sim.brPredrop,
      bus: sim.brBus ? {
        startX: sim.brBus.startX, startY: sim.brBus.startY,
        endX: sim.brBus.endX, endY: sim.brBus.endY,
        startAt: sim.brBus.startAt, durMs: sim.brBus.durMs,
      } : null,
      serverNow: Date.now(),
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
    if (sim.brPredrop) {
      sim.eventQueue.push({
        type: 'br_predrop_state', active: true,
        bus: {
          startX: sim.brBus.startX, startY: sim.brBus.startY,
          endX: sim.brBus.endX, endY: sim.brBus.endY,
          startAt: sim.brBus.startAt, durMs: sim.brBus.durMs,
        },
        deadlineAt: sim.brPredropDeadlineAt, serverNow: Date.now(),
      });
    }
    sim._endBattleRoyaleMatch = endBattleRoyaleMatch;
    sim._handleBattleRoyaleKill = handleBattleRoyaleKill;
    sim._brOnCritterKilled = brOnCritterKilled;
    // DEBUG: gulagPractice → droppa host + bot direkt i valt gulag-spel (solo-bugfix)
    if (opts && opts.gulagPractice) {
      startGulagPractice(sim, opts.gulagPractice, Date.now());
    }
  } else if (sim.castledefenseActive) {
    // CASTLE DEFENSE init — fasta walls + core + spawn-spelare inne i castle
    sim.simReadyAt = Date.now() + cdMs;
    const arena = CASTLEDEFENSE_ARENA;
    // Runtime-kopia av walls så vi kan mutera hp utan att röra arena-konstanten
    sim.castledefenseWalls = arena.walls.map(w => ({ ...w }));
    sim.castledefenseCore = { ...arena.core };
    // v1.526: SURVIVORS-RUN — core är immun mot skada (ingen core att försvara).
    if (sim.survivorsActive) {
      sim.castledefenseCore.hp = Infinity;
      sim.castledefenseCore.maxHp = Infinity;
      sim.survivorsStartT = Date.now();
    }
    sim.castledefenseBuildings = [];
    // v2 REDESIGN: SOLIDA slottsväggar (indestruktibla — blockerar rörelse + kulor),
    // 6 battlement-slots (torn-platser), slotts-NPC:er + tron (uppgraderas, börjar lvl 0),
    // samt fiendernas mål-punkt (porten) som flow-fältet byggs mot.
    sim.castledefenseCastleWalls = (arena.castleWalls || []).map(w => ({ ...w, kind: 'castle_wall' }));
    sim.castledefenseSlots = (arena.battlementSlots || []).map(s => ({ id: s.id, x: s.x, y: s.y, towerId: null }));
    sim.castledefenseNpcs = {
      throne:     { level: 0, x: arena.castleNpcs.throne.x,     y: arena.castleNpcs.throne.y },
      heal_npc:   { levelHp: 0, levelShield: 0, x: arena.castleNpcs.heal_npc.x,   y: arena.castleNpcs.heal_npc.y },
      repair_npc: { level: 0, x: arena.castleNpcs.repair_npc.x, y: arena.castleNpcs.repair_npc.y },
    };
    sim.castledefenseGoal = arena.enemyGoal ? { ...arena.enemyGoal } : { x: arena.core.x, y: arena.core.y };
    sim._cdFlowDirty = true;
    sim.castledefenseStartedAt = Date.now();
    sim.castledefenseWave = 0;
    sim.castledefenseWaveState = 'between';
    // Första vågen startar efter 10 sek så spelare hinner orientera sig + bygga
    sim.castledefenseWaveBetweenEndAt = Date.now() + 10000;
    // Spawn spelare på fasta points inne i castle. Cykla genom 4 punkter om fler spelare.
    const cdSpawns = pickSpreadSpawns(arena.playerSpawns, sim.room.members.size);
    let cdIdx = 0;
    for (const [pid, ws] of sim.room.members) {
      ws.playerState = ws.playerState || {};
      const sp = cdSpawns[cdIdx % cdSpawns.length] || arena.playerSpawns[cdIdx % arena.playerSpawns.length];
      ws.playerState.x = sp.x;
      ws.playerState.y = sp.y;
      ws.playerState.hp = arena.startHp;
      ws.playerState.maxHp = arena.maxHp;
      // v2 #68: explicit baseShield vinner; annars arena-default (100) som förut.
      ws.playerState.shield = sim.baseShield > 0 ? sim.baseShield : arena.startShield;
      ws.playerState.maxShield = Math.max(arena.maxShield, sim.baseShield || 0);
      ws.playerState.invulnUntil = Date.now() + 2000;
      ws.playerState.weaponId = arena.startWeapon;
      ws.playerState.isJug = false;
      ws.playerState.scaleMul = 1.0;
      ws.playerState.speedMul = 1.0;
      ws.playerState.dashCdMs = null;
      // v1.431: CRITICAL — rensa CD-specifika flags från eventuell tidigare match.
      // Tidigare: om player slutade en match downed/dead behöll ws.playerState
      // cdDowned=true → ny match → de var "frozen" + kunde inte styras → upplevdes
      // som "fast i annan gubbe". Root cause för stuck-together-buggen.
      ws.playerState.cdDowned = false;
      ws.playerState.cdDownDead = false;
      ws.playerState.cdDownStartedAt = 0;
      ws.playerState.cdDownReviveProgress = 0;
      ws.playerState._cdLastReviveBroadcast = 0;
      ws.playerState._cdPrevWeapon = null;
      ws.playerState._cdPrevSpeedMul = null;
      ws.playerState._cdPlayerContactCd = 0;
      ws.playerState.spectating = false;
      ws.playerState.aim = 0;
      // Cleara mounted-turret-state från ev. PvP-match
      ws._mountedCtfTurretId = null;
      ws._mountedSiegeTurretId = null;
      ws._mountedCdTowerId = null;
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null; // Co-op (alla är "allies")
      sim.castledefenseScores[pid] = 0;
      sim.tdmDeathsByPid[pid] = 0;
      // Castle Defense gold är per-match (inte save.gold). Lagras på sim per peerId.
      sim.castledefenseGold = sim.castledefenseGold || {};
      // v1.607: SURVIVORS startar med 100 gold (knappt nog för billigt vapen)
      sim.castledefenseGold[pid] = opts.survivors ? 100 : (arena.startGold || 400);
      // v3 perk-trad: 1 perk-poang att VALJA DIREKT vid start
      sim.castledefensePerkPoints = sim.castledefensePerkPoints || {};
      sim.castledefensePerkPoints[pid] = (sim.castledefensePerkPoints[pid] || 0) + 1;  // START
      // v1.401: vapen-tier startar på 0 (pistol)
      sim.castledefenseWeaponTier = sim.castledefenseWeaponTier || {};
      sim.castledefenseWeaponTier[pid] = 0;
      sim.castledefensePurchasedWeapons = sim.castledefensePurchasedWeapons || {};
      sim.castledefensePurchasedWeapons[pid] = new Set();
      cdIdx++;
    }
    // svårighets-justerad vapenhandlar-katalog så klienten visar EXAKT serverns pris
    // (servern debiterar spec.cost × difficulty-mul; utan detta driver pris/grå-ning).
    const _vendorMul = cdGetDifficultyPriceMul(sim.config.difficulty);
    const cdVendorCatalog = {};
    for (const _wk in arena.weaponVendor) {
      cdVendorCatalog[_wk] = { tier: arena.weaponVendor[_wk].tier, cost: Math.max(1, Math.round(arena.weaponVendor[_wk].cost * _vendorMul)) };
    }
    sim.eventQueue.push({
      type: 'cd_started',
      arena: {
        worldW: arena.worldW,
        worldH: arena.worldH,
        name: arena.name,
        groundColor: arena.groundColor,
        plazaColor: arena.plazaColor,
        pathColor: arena.pathColor,
        startWeapon: arena.startWeapon,
        startGrenades: arena.startGrenades,
        weaponProgression: arena.weaponProgression,
      },
      // v2 REDESIGN: slott-geometri (klienten ritar slottet + solida väggar + slots/NPC)
      castle: arena.castle,
      castleWalls: sim.castledefenseCastleWalls.map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
      battlementSlots: arena.battlementSlots,
      castleNpcs: {
        throne: { ...sim.castledefenseNpcs.throne },
        heal_npc: { ...sim.castledefenseNpcs.heal_npc },
        repair_npc: { ...sim.castledefenseNpcs.repair_npc },
        weapon_vendor: { ...arena.castleNpcs.weapon_vendor },
      },
      weaponVendor: cdVendorCatalog,
      downReviveRadius: arena.downReviveRadius || 60,
      slotBuildables: arena.slotBuildables,
      enemyGoal: sim.castledefenseGoal,
      walls: [],                          // inga pre-built fält-murar
      core: { ...sim.castledefenseCore },
      playerSpawns: arena.playerSpawns,
      enemySpawns: arena.enemySpawns,
      decorations: arena.decorations || [],
      buildables: arena.buildables,
      buildGridSize: arena.buildGridSize,
      maxBuildLevel: arena.maxBuildLevel,
      startHp: arena.startHp,
      maxHp: arena.maxHp,
      startGold: sim.castledefenseGold,  // {pid: amount}
      waveBetweenEndAt: sim.castledefenseWaveBetweenEndAt,
      bossEveryWave: arena.bossEveryWave,
      // v3 perk-träd: spec + initial poäng så klienten kan rendera träd-panelen.
      perkTrees: arena.perkTrees,
      perkPoints: 1,   // 1 poang att valja en perk vid start
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: cdMs });
  } else if (sim.heistActive) {
    // v1.619: HEIST init — bank-rån. Player spawnar utanför front-door.
    // v2 #62: explicit countdownMs vinner; annars 3000 som förut.
    sim.simReadyAt = Date.now() + (sim.countdownMs || 3000);
    const arena = HEIST_ARENA;
    // Spawn alla players på street utanför banken
    let hIdx = 0;
    for (const [pid, ws] of sim.room.members) {
      // SLUTAUDIT 2 #2: var `continue` — V2-hosten saknar playerState vid
      // sim_start så HELA initen (sköld/spawn/vapen/roll/invuln) skippades.
      // Samma mönster som CTF (6575) och BR (6997).
      ws.playerState = ws.playerState || {};
      const spawn = arena.playerSpawns[hIdx % arena.playerSpawns.length];
      ws.playerState.x = spawn.x;
      ws.playerState.y = spawn.y;
      ws.playerState.hp = arena.startHp || 100;
      ws.playerState.maxHp = arena.maxHp || 100;
      // v2 #68: explicit baseShield vinner; annars arena-default (0) som förut.
      ws.playerState.shield = sim.baseShield > 0 ? sim.baseShield : (arena.startShield || 0);
      ws.playerState.maxShield = arena.maxShield || 100;
      ws.playerState.weaponId = arena.startWeapon || 'pistol';
      ws.playerState.invulnUntil = Date.now() + 3000;
      ws.playerState.cdDowned = false;
      ws.playerState.cdDownDead = false;
      ws.playerState.spectating = false;
      ws.playerState.speedMul = 1.0;
      ws.tdmTeam = null; // Co-op
      ws._heistLootCarrying = null;
      ws._heistBagsCarrying = 0;
      ws._heistBagsValue = 0;
      ws._heistBagsWeight = 0;
      // v1.624 BUG5 fix: rensa alla heist-state-flags på ws så förra matchens
      // mid-lockpick inte ger instant-unlock-exploit
      ws._heistLockpickStart = 0;
      ws._heistLockpickDoorId = null;
      ws._heistLockpickFinishesAt = 0;
      // v1.645: samma reset för nya hack-progress-timer
      ws._heistHackStart = 0;
      ws._heistHackTermId = null;
      ws._heistHackFinishesAt = 0;
      // v1.652: Tank distract + Medic calm cooldowns
      ws._heistDistractCdUntil = 0;
      ws._heistCalmCdUntil = 0;
      ws._heistCamDetectStart = 0;
      ws._heistCamDetect = {}; // v1.625: per-cam timer
      ws._heistCamSeenThisTick = {};
      ws._heistMedicRegenAccum = 0;
      ws._heistCameraImmune = false; // återställs i role-block om Hacker
      // v1.642: Match-start = lås av (in-game-picker öppnas på klient). Om lobby
      // hade role förvald (legacy / quick-pick) appliceras den; annars defaultar
      // helpern till 'hacker' och spelaren får ändra in-game.
      ws._heistRoleLocked = false;
      const role = (sim.heistRoles && sim.heistRoles[pid]) || 'hacker';
      _heistApplyRole(ws, role, sim, arena);
      hIdx++;
    }
    sim.eventQueue.push({
      type: 'heist_started',
      arena: {
        worldW: arena.worldW,
        worldH: arena.worldH,
        name: arena.name,
        streetColor: arena.streetColor,
        sidewalkColor: arena.sidewalkColor,
        bankFloorColor: arena.bankFloorColor,
        vaultFloorColor: arena.vaultFloorColor,
        carpetColor: arena.carpetColor,
        serverFloorColor: arena.serverFloorColor,
        matchDurationSec: arena.matchDurationSec,
        stealthPhaseMaxSec: arena.stealthPhaseMaxSec,
        drillDurationSec: arena.drillDurationSec,
        extractDurationSec: arena.extractDurationSec,
        startWeapon: arena.startWeapon,
        startHp: arena.startHp,
        maxHp: arena.maxHp,
        startShield: arena.startShield,
        maxShield: arena.maxShield,
        extractZones: arena.extractZones,
        drillSpot: arena.drillSpot,
      },
      walls: arena.walls,
      doors: arena.doors,
      decorations: arena.decorations,
      cameras: arena.cameras,
      hackTerminals: arena.hackTerminals,
      civilianSpawns: arena.civilianSpawns,
      guardSpawns: arena.guardSpawns,
      lootSpots: arena.lootSpots,
      playerSpawns: arena.playerSpawns,
    });
    sim.eventQueue.push({ type: 'countdown_start', durationMs: sim.countdownMs || 3000 });
  } else {
    loadStage(sim, sim.wave);
  }
  sim.lastTick = Date.now();
  // Tick-profiling: logga slow ticks i prod. Throttled 2s max.
  // Tröskel 50ms = klart över 16.7ms-budgeten men under normalt GC-jitter-buller.
  // Om en tick FAKTISKT tar >50ms syns det i `flyctl logs` / Render-loggar.
  // wave-info inkluderas för CD-mode (castledefenseActive) — det är den
  // enda PvE-mode med per-wave enemy-acceleration som kan orsaka spike.
  sim._slowTickLogAt = 0;
  sim.interval = setInterval(() => {
    const t0 = process.hrtime.bigint();
    try { tickSim(sim); } catch (e) { console.error('sim-tick error:', e.message, e.stack); }
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    // v1.384: tick-tid EMA + max för debug-overlay
    sim._tickMsEMA = sim._tickMsEMA == null ? elapsedMs : sim._tickMsEMA * 0.92 + elapsedMs * 0.08;
    // Max decay: efter 5s utan spike, glömmer servern bort gamla spikes
    sim._tickMsMax = Math.max((sim._tickMsMax || 0) * 0.995, elapsedMs);
    if (elapsedMs > 50) {
      const now = Date.now();
      if (now - sim._slowTickLogAt > 2000) {
        sim._slowTickLogAt = now;
        const waveInfo = sim.castledefenseActive
          ? ' wave=' + sim.castledefenseWave + '/' + sim.castledefenseWaveState
          : (sim.survivorsActive ? ' survWave=' + sim.castledefenseWave : '');
        console.warn('[SLOW-TICK]', sim.room.code, elapsedMs.toFixed(1) + 'ms',
          'enemies=' + sim.enemies.length,
          'bullets=' + sim.bullets.length,
          'members=' + sim.room.members.size + waveInfo);
      }
    }
  }, TICK_MS);
}

// Pickups för siege-arena — symmetrisk runt mitten + flank-positions
function buildSiegePickups(sim) {
  return [
    // HP-pickups vid mid-bases
    { id: nextPickupId(sim), x: 1800, y: 1100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 1100, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1800, y: 1900, type: 'hp',     available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3200, y: 1900, type: 'hp',     available: true, respawnAt: 0 },
    // Shield-pickups i mid och vid hörn
    { id: nextPickupId(sim), x: 2500, y: 800,  type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 2500, y: 2200, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1200, y: 1500, type: 'shield', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3800, y: 1500, type: 'shield', available: true, respawnAt: 0 },
    // Granater: 4 spridda mellan baser/mid
    { id: nextPickupId(sim), x: 1500, y: 1100, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1100, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 1500, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
    { id: nextPickupId(sim), x: 3500, y: 1900, type: 'grenade', available: true, respawnAt: 0 },
  ];
}

function stopSim(sim) {
  // v1.655: Flagga sim:en som stoppad så fördröjda setTimeout-callbacks
  // (granat-explode i server.js, andra-boss-spawn i waves.js) inte kör mot
  // en nedlagd sim och läcker spök-skada/state in i NÄSTA match.
  sim._stopped = true;
  if (sim.interval) {
    clearInterval(sim.interval);
    sim.interval = null;
    console.log('[SIM]', sim.room.code, 'stopped');
  }
  // Broadcasta bot_left till klienter INNAN vi rensar — annars hänger bot
  // kvar i Coop.players även efter match-end.
  if (sim._botIds && sim._botIds.length && sim.room && sim.room.members) {
    for (const botId of sim._botIds) {
      const msg = JSON.stringify({ type: 'sim_events', events: [{ type: 'bot_left', peerId: botId }] });
      for (const [, ws] of sim.room.members) {
        if (ws._isBot) continue;
        if (ws.readyState === 1) try { ws.send(msg); } catch (_) {}
      }
    }
  }
  // Rensa bots ur room.members så de inte hänger kvar till nästa match
  removeAllBots(sim);
  // v1.431: Rensa per-WS state som annars läcker över till nästa match.
  // Tidigare: ws.playerState behöll cdDowned/cdDownDead/mounted-turret-id etc
  // mellan matcher → ny match började med stale state → stuck/frozen-buggar.
  if (sim.room && sim.room.members) {
    for (const [, ws] of sim.room.members) {
      if (!ws.playerState) continue;
      ws.playerState.cdDowned = false;
      ws.playerState.cdDownDead = false;
      ws.playerState.cdDownStartedAt = 0;
      ws.playerState.cdDownReviveProgress = 0;
      ws.playerState._cdLastReviveBroadcast = 0;
      ws.playerState._cdPrevWeapon = null;
      ws.playerState._cdPrevSpeedMul = null;
      ws.playerState._cdPlayerContactCd = 0;
      ws.playerState.spectating = false;
      ws.playerState.invulnUntil = 0;
      ws._mountedCtfTurretId = null;
      ws._mountedSiegeTurretId = null;
      ws._mountedCdTowerId = null;
      ws._eventSkips = 0;
      // v1.657: rensa TDM/PvP-respawn-state. tdmRespawnAt läckte → om en spelare
      // dog i sista sekunden av en match var timern kvar → "respawn" triggades i
      // NÄSTA match för en död de aldrig visste om.
      ws.tdmRespawnAt = 0;
      ws.tdmTeam = null;
      // v1.697: Heist ws-state läckte mellan matcher. Reset låg bara i heist-START-
      // grenen (startSim) → slutade man heist och startade ETT ANNAT läge behölls
      // bag-vikt/speedMul/lockpick+hack-timers/role. Symptom: spelaren började slö,
      // bar fantom-bags, och en pågående lockpick/hack kunde auto-completa i första
      // ticken av nästa match. Återställ här så ALLA lägen börjar rent.
      ws.playerState.speedMul = 1.0;
      ws._heistLootCarrying = null;
      ws._heistBagsCarrying = 0;
      ws._heistBagsValue = 0;
      ws._heistBagsWeight = 0;
      ws._heistLockpickStart = 0;
      ws._heistLockpickDoorId = null;
      ws._heistLockpickFinishesAt = 0;
      ws._heistHackStart = 0;
      ws._heistHackTermId = null;
      ws._heistHackFinishesAt = 0;
      ws._heistDistractCdUntil = 0;
      ws._heistCalmCdUntil = 0;
      ws._heistCamDetect = {};
      ws._heistCamSeenThisTick = {};
      ws._heistCameraImmune = false;
      ws._heistMedicRegenRate = 0;
      ws._heistMedicRegenAccum = 0;
      ws._heistRoleLocked = false;
      ws._heistRole = null;
      ws._heistStatSecured = 0;
      ws._heistStatBags = 0;
      ws._heistStatHostages = 0;
      ws._lastShieldUseAt = 0;
      // v1.771: companionState togs aldrig bort → stale companion (med stale hp) kunde
      // dingla in i nästa match. BR-state (armor/vapen-tier/downed/kits) gav oförtjänt
      // fördel om man gick BR → annan mode i samma rum. Nollställ till known-good.
      ws.companionState = null;
      ws.playerState._brWeaponTier = null;
      ws.playerState.brPerkLevels = {};
      ws.playerState.gasMask = false;
      ws.playerState.selfReviveKits = 0;
      ws.playerState.airstrikes = 0;
      ws.playerState.uavCount = 0;
      ws.playerState.medkits = 0;
      ws.playerState.shieldkits = 0;
      ws.playerState.adrenalines = 0;
      ws.playerState.brMedkitTicks = 0;
      ws.playerState.brAdrenalineEnd = 0;
      ws.playerState.brUavUntil = 0;
      ws.playerState.brDowned = false;
      ws.playerState.brReviveEnd = 0;
    }
  }
  // v1.432: Rensa SIM-LEVEL state också. Tidigare läckte dessa mellan matcher
  // om samma sim-objekt reanvändes utan createSim. Defensive — reset till known-good.
  sim.castledefenseActive = false;
  sim.castledefenseEnded = false;
  sim.castledefenseWalls = [];
  sim.castledefenseBuildings = [];
  sim.castledefenseCore = null;
  sim.castledefenseGold = {};
  sim.castledefenseScores = {};
  sim.castledefenseWeaponTier = {};
  sim.castledefensePurchasedWeapons = {};
  sim.castledefensePerks = {};
  sim.castledefensePerkRanks = {};
  sim.castledefensePerkFlags = {};
  sim.castledefensePerkPoints = {};
  sim.castledefenseDownedPids = [];
  sim.castledefenseRevivedCount = 0;
  sim.castledefenseWave = 0;
  sim.castledefenseWaveState = 'idle';
  sim.castledefenseWaveBetweenEndAt = 0;
  sim._cdWaveSpawnsRemaining = 0;
  sim._cdWaveSpawnTimer = 0;
  sim._cdActiveTheme = null;
  sim._cdFlowField = null;
  sim._cdFlowDirty = true;
  // C225: rensa cachade solid-listor/grider så de rebuilds nästa match
  sim._cdAllSolids = null;
  sim._cdMoveSolids = null;
  sim._cdAllSolidsGrid = null;
  sim._cdMoveSolidsGrid = null;
  sim._cdLastWaveProcessed = -1;
  sim._cdHudBroadcastAt = 0;
  sim._cdCoreHealedThisTick = false;
  sim._cdCoreLastHealBroadcast = 0;
  sim._lastTurretDmgEvtAt = 0;
  // v1.698: HEIST sim-level state (stopSim rensade bara castledefense*). Latent — ofarligt
  // så länge sim_start alltid kör createSim, men defensivt om sim-objektet återanvänds.
  sim.heistActive = false;
  sim.heistEnded = false;
  sim.heistPhase = 'stealth';
  sim.heistStartT = 0;
  sim.heistPhaseStartT = 0;
  sim.heistLootBagged = {};
  sim.heistLootValue = 0;
  sim.heistDrillProgress = 0;
  sim.heistDrilling = false;
  sim.heistAlarmTriggered = false;
  sim.heistVaultUnlocked = false;
  sim.heistInnerDrillProgress = 0;
  sim.heistInnerVaultUnlocked = false;
  sim.heistNPCs = [];
  sim.heistRoles = {};
  sim.heistDroppedBags = [];
  sim.heistHackedTerminals = {};
  sim.heistDisabledCameras = {};
  sim.heistUnlockedDoors = {};
  sim.heistBackExtractUnlocked = false;
  sim.heistCeasefireUntil = 0;
  sim._heistNextPoliceAt = 0;
  // Drain event-queue så stale events från slut-fas inte broadcastas vid restart
  if (sim.eventQueue) sim.eventQueue.length = 0;
}

// AAA #6 (2026-06-13): klient-prediktion + server-sim + reconcile.
// Dash-medveten max-fart (px/s) för PvP-positionsklampen. Ersätter den gamla
// 460 px/s + 12 px-fudgen som var dash-skör (dash = 918 px/s slank bara igenom
// vid 40 Hz → klampades på termik-strypta 30 Hz-telefoner). 1000 täcker dash +
// adrenalin (459) med marginal; tidsskalad (cap·dt) = paketförlust-robust
// (ett tappat input → nästa absolutposition catchar via större dt-budget).
const MOVE_SPEED_CAP = 1000;
// Wrap-medveten "a nyare än b" i 16-bitars seq-rum (inputs = otillförlitlig
// UDP-kanal → omordnade/duplicerade paket släpps = gratis dedup, newest-wins).
function _seqNewer(a, b) {
  const d = (a - b) & 0xFFFF;
  return d !== 0 && d < 0x8000;
}

function applyPlayerInput(sim, peerId, input) {
  const ws = sim.room.members.get(peerId);
  if (!ws) return;
  // SPECTATE: ignorera all input från en spectator (de rör/skjuter aldrig + ska
  // aldrig lazy-skapa en playerState här).
  if (ws.isSpectator) return;
  if (!ws.playerState) ws.playerState = { x: 1000, y: 1000, hp: 100 };
  // AAA #6: input-sekvensnummer. Stale/omordnad input (inte nyare än senast
  // bekräftade) släpps HELT — strömmen är 40 Hz self-superseding, en färsk
  // input med ny aim/pos följer inom ≤25ms. Första inputen (_ackSeq undefined)
  // passerar alltid. Klienter utan seq (gammal/V1) → _inputSeq=-1, ingen drop.
  let _inputSeq = -1;
  if (typeof input.seq === 'number' && isFinite(input.seq)) {
    _inputSeq = input.seq & 0xFFFF;
    if (ws.playerState._ackSeq !== undefined && !_seqNewer(_inputSeq, ws.playerState._ackSeq)) {
      return;
    }
  }
  // v2: persistenta spelar-perks (skickas med första inputen / vid ändring).
  // Saniteras: bara kända booleans + clampad goldMul. V1-klienter skickar aldrig fältet.
  if (input.perks && typeof input.perks === 'object') {
    ws.playerState.perks = {
      phantombody: !!input.perks.phantombody,
      lastlaugh: !!input.perks.lastlaugh,
      magnetism: !!input.perks.magnetism,
      goldMul: Math.max(1, Math.min(2.5, +input.perks.goldMul || 1)),
      // thorns: new wire — fraction (0.15..0.60) of enemy contact damage reflected back. Clamped 0..1.
      thorns: Math.min(1, Math.max(0, +(input.perks.thorns) || 0)),
    };
  }
  // Mounted turret-spelare: position låst av server. Ignorera klient-position
  // helt så ingen kan skjuta från fel pos eller bypass turret-occupant.
  if (ws._mountedSiegeTurretId || ws._mountedCtfTurretId || ws._mountedCdTowerId) {
    if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
    if (input.weaponId) ws.playerState.weaponId = input.weaponId;
    if (_inputSeq >= 0) ws.playerState._ackSeq = _inputSeq;  // AAA #6: bekräfta även bemannad
    return;
  }
  // PvP anti-cheat / carrier-slow enforcement: klampa positionsdelta per tick
  // till rimlig max-speed. Klient kan annars skicka godtycklig x/y och teleporta
  // genom väggar eller kringgå CTF_CARRIER_SPEED_MUL (-25% när man bär flagga).
  // v1.382: extended to ALL PvP modes (TDM/CTF/Siege/Gungame/KOTH/JUG/BR).
  // v1.383 (post-audit fix): spawn-grace skulle frysa spelaren även under
  // PvP-shield (3s invuln) och hit-invuln (500ms). FIX: spawn-grace triggar
  // BARA om både invuln AND klient-pos avviker >500px från server-pos
  // (= riktig spawn-resync, inte mid-game shield).
  const inPvP = sim.tdmActive || sim.ctfActive || sim.siegeActive ||
                sim.gungameActive || sim.kothActive ||
                sim.juggernautActive || sim.battleroyaleActive ||
                sim.castledefenseActive;
  // v1.799: FREEZE (Frenzy-powerup) — frusen spelare kan ej röra sig. Ignorera klient-
  // position helt (server-enforce; klienten blockerar också lokalt). Aim/vapen tillåts.
  const _gulagFrozen = (ws.playerState._gulagFrozenUntil || 0) > Date.now();
  if (_gulagFrozen) {
    // håll position — ingen rörelse medan frusen
  } else if (inPvP && typeof input.x === 'number' && typeof input.y === 'number'
             && isFinite(input.x) && isFinite(input.y)) {
    // C124 (audit 2026-06-18): isFinite-guard — annars ger ett Infinity-input ett
    // Infinity-delta → scale=maxDelta/Infinity=0 → x += Infinity*0 = NaN-position.
    const now = Date.now();
    const isInvuln = (ws.playerState.invulnUntil || 0) > now;
    const _dxRaw = input.x - ws.playerState.x;
    const _dyRaw = input.y - ws.playerState.y;
    const _isHugeJump = (_dxRaw * _dxRaw + _dyRaw * _dyRaw) > 500 * 500;
    const isSpawnResync = isInvuln && _isHugeJump;
    // BATTLE BUS / SKYDIVE: medan luftburen får fart-capen INTE gälla — en freefall-
    // styrning korsar 10000px-kartan på sekunder (>>1000px/s). brAir===1 (på bussen):
    // positionen är buss-ägd (sätts i tickBrPredrop) → ignorera klient-x/y helt (anti-
    // pre-jump-teleport). brAir>=2 (freefall/fallskärm): acceptera klient-x/y rått, ingen
    // cap. Skada/kollision är redan av (brAir = invuln; vägg-klamp hoppar luftburna).
    const _brAir = ws.playerState.brAir || 0;
    if (_brAir === 1) {
      ws._lastInputT = now;   // bussen äger positionen — flytta inte
    } else if (_brAir >= 2) {
      ws._lastInputT = now;
      // Fri freefall-styrning (ingen fart-cap) men klampa till arenan så figuren inte
      // kan slängas off-map på fjärr-skärmar (kosmetiskt — skada är av i luften).
      const _brA = BATTLEROYALE_ARENA;
      ws.playerState.x = Math.max(120, Math.min(_brA.worldW - 120, input.x));
      ws.playerState.y = Math.max(120, Math.min(_brA.worldH - 120, input.y));
    } else if (!isSpawnResync) {
      const lastT = ws._lastInputT || now;
      const dt = Math.max(0.001, Math.min(0.25, (now - lastT) / 1000));
      ws._lastInputT = now;
      // AAA #6: dash-medveten cap (1000 px/s) i st.f. gamla 460+12. Tidsskalad
      // (cap·dt) → paketförlust-robust + ingen dash-clampning på 30 Hz-telefoner.
      let maxSpeed = MOVE_SPEED_CAP;
      // C193 ÖVERVÄGT + FÖRKASTAT: att multiplicera dash-cap:en (1000 px/s) med
      // moveSpeedMul skulle klampa LEGITIMA dashar för tunga vapen (minigun 0.62 → 620 <
      // dash-fart) → rubber-band. MOVE_SPEED_CAP räcker som anti-speedhack-tak; per-vapen-
      // farten enforce:as redan klient-sidan. Lämnas oförändrad.
      if (sim.ctfActive) {
        const isCarrier = sim.ctfFlags && (
          (sim.ctfFlags.red && sim.ctfFlags.red.carrierId === peerId) ||
          (sim.ctfFlags.blue && sim.ctfFlags.blue.carrierId === peerId)
        );
        if (isCarrier) maxSpeed *= CTF_CARRIER_SPEED_MUL; // 0.75 — flaggbärar-broms (server-enforce)
      }
      const maxDelta = maxSpeed * dt + 4; // liten rundnings-marginal (x/y skickas som heltal)
      const d = Math.hypot(_dxRaw, _dyRaw);
      if (d > maxDelta && d > 0) {
        const scale = maxDelta / d;
        ws.playerState.x += _dxRaw * scale;
        ws.playerState.y += _dyRaw * scale;
      } else {
        ws.playerState.x = input.x;
        ws.playerState.y = input.y;
      }
    }
    // isSpawnResync = true: ignorera klient x/y. Server-spawnen står fast,
    // klient snappar via world-packet (klient-side discrepancy check).
  } else {
    // Non-PvP (coop story etc.): acceptera klient x/y unchecked
    // C124 (audit 2026-06-18): isFinite-guard — typeof===number släpper igenom Infinity/NaN
    // (1e400) → annars läcker en icke-finit spelar-position in i bullet-origin/broadcast.
    if (typeof input.x === 'number' && isFinite(input.x)) ws.playerState.x = input.x;
    if (typeof input.y === 'number' && isFinite(input.y)) ws.playerState.y = input.y;
  }
  // GULAG (v1.790): hp är SERVER-auktoritärt under duell (loadout + bullets/melee/lava).
  // Ignorera klient-hp så (a) den döda spelarens hp=0 ej skriver över loadout-hp vid start,
  // (b) ingen hp-cheat i gulagen.
  // M2-fix (V2 iPhone-test 2026-06-11): i RENA PvP-lägen är klient-hp bara ett
  // eko (all skada är server-side) — ett stale hp<=0-eko får ALDRIG döda en
  // server-levande spelare. V2 fortsatte skicka hp=0 efter server-respawnen →
  // respawnen skrevs över → EVIG DÖD i TDM (ingen runda-ress, lik låg kvar).
  // Täcker även V1:s död→respawn-lagg-race. OBS: castledefense/co-op undantas —
  // där är klient-hp legitimt auktoritärt i V1 (klienten räknar kontakt-skada).
  const _pureP2P = sim.tdmActive || sim.ctfActive || sim.siegeActive ||
                   sim.gungameActive || sim.kothActive ||
                   sim.juggernautActive || sim.battleroyaleActive;
  if (typeof input.hp === 'number' && ws.playerState.gulagState !== 'fighting') {
    if (!_pureP2P) {
      // CO-OP/story: klient-hp är legitimt auktoritärt (klienten räknar kontakt-skada).
      // Stale-death-echo-skydd: en klient som ekar hp<=0 MEDAN servern har spelaren
      // LEVANDE (hp>0) = fördröjt/stale eko, applicera INTE. Drabbade CO-OP REMATCH:
      // gamla scenens hp=0-inputs anländer efter respawn-reset → EVIG DÖD-LOOP.
      const staleDeathEcho = input.hp <= 0 && ws.playerState.hp > 0;
      if (!staleDeathEcho) ws.playerState.hp = input.hp;
    }
    // _pureP2P (TDM/CTF/siege/koth/gungame/jugg/BR): servern ÄGER hp helt (all skada är
    // server-auth via bullets/granater). Klient-hp-ekot IGNORERAS — annars kunde en SEN
    // sim_input med hp=5 (värdet före respawn) skriva över serverns respawn-hp=100 →
    // "spawnar med 5 hp + 100 shield" (shield skyddades av 600ms-echo-gate, hp ej).
  }
  // v2: klient-rapporterad max hp/shield (hp-upgrade/glasscannon/shield-perk) →
  // respawn återställer till FULLT istället för hårdkodat 100. Saniterat (1..2000).
  // Egna fält så lägen som SÄTTER maxHp server-side (juggernaut 400, gulag-loadout)
  // inte skrivs över av input-echot.
  if (typeof input.maxHp === 'number' && isFinite(input.maxHp)) {
    ws.playerState._cliMaxHp = Math.max(1, Math.min(2000, input.maxHp));
  }
  if (typeof input.maxShield === 'number' && isFinite(input.maxShield)) {
    ws.playerState._cliMaxShield = Math.max(0, Math.min(2000, input.maxShield));
  }
  if (typeof input.aim === 'number') ws.playerState.aim = input.aim;
  // GULAG: servern äger vapnet under en duell (loadout/frenzy). Sena/stale klient-echo av
  // det GAMLA BR-vapnet (skickas medan man är downed/köad innan menu_locked hinner sättas)
  // klobbade annars ps.weaponId → fjärrspelare/spectators såg FEL vapen hela duellen.
  if (input.weaponId && ws.playerState.gulagState !== 'fighting') {
    ws.playerState.weaponId = input.weaponId;
    // BR: när klient SKICKAR vapen-byte (via radial/menu) skicka ALSO weaponTier
    // så servern vet vilken tier nu equipped (för auto-equip-jämförelse vid nästa pickup).
    if (sim.battleroyaleActive && input.weaponTier) {
      ws.playerState._brWeaponTier = input.weaponTier;
    }
  }
  // Companion-state: server är AUKTORITET för hp + alive (klient kan annars skriva
  // över server-side damage genom att skicka full hp). Klient skickar position +
  // metadata; server preservar hp/alive om companion redan finns.
  if (input.companion) {
    const prev = ws.companionState;
    if (prev && prev.id === input.companion.id) {
      // Existing companion: behåll server-auth hp + alive, uppdatera bara pos/r.
      prev.x = input.companion.x;
      prev.y = input.companion.y;
      prev.r = input.companion.r || prev.r;
      prev.maxHp = input.companion.maxHp || prev.maxHp;
    } else {
      // Ny companion (första input eller byte) — initiera från klient.
      ws.companionState = {
        id: input.companion.id,
        x: input.companion.x,
        y: input.companion.y,
        hp: typeof input.companion.hp === 'number' ? input.companion.hp : 100,
        maxHp: input.companion.maxHp || 100,
        alive: input.companion.alive !== false,
        r: input.companion.r || 12,
        lastAggroAt: 0,
      };
    }
  } else if (ws.companionState) {
    ws.companionState = null;
  }
  // AAA #6: bekräfta senast behandlade input-seq (broadcastWorld → pkt.ack →
  // klientens precisa reconcile). Sätts EFTER all rörelse/clamp så ack:en svarar
  // mot positionen vi just skrev. Stale inputs returnerade redan ovan.
  if (_inputSeq >= 0) ws.playerState._ackSeq = _inputSeq;
}

// ============ v2 ANTI-CHEAT: MODE-ARSENAL-VALIDERING (server-sanning) ============
// CLAMPAR otillåtet weaponId till mode-default och BEHÅLLER skottet (mjukt mot
// latency/races) istället för att kasta det. V1-webben skickar redan giltiga vapen
// i alla dessa lägen → no-op för V1 (verifierat mot V1-klientens faktiska regler):
//   - CTF/Siege/KOTH (+ JUG-hunters): radialen visar save.owned = fists+COOP_WEAPONS
//     (game.js:16074/38579) → tillåtna listan måste vara HELA coop-arsenalen, inte
//     bara fists/knife/pistol.
//   - TDM fy_: pistol + det spelaren FAKTISKT plockat (server trackar pickups i
//     tickPvpPickups → ws._tdmPickedWeapons; vinnare behåller över rundor, förlorare
//     nollställs i resetTdmRound — speglar v1.734-semantiken).
//   - Gungame: exakt aktuellt tier-vapen (sim.gungameTiers) + fists (V1 sätter
//     save.owned=['fists'] i GG → melee-demote-mekaniken, game.js:26592).
//   - BR: starter-trion + lootat/köpt (server vet looten → ws._brOwnedWeapons).
//   - Story-familjen/survivors/CD/heist: servern känner inte save.owned → validera
//     bara att id finns i vapenkatalogen. (CD har dessutom redan tier-låset ovan.)
// Gulag-duellen forcerar redan sitt vapen FÖRE detta steg; mounted turret forceras
// EFTER (override vinner alltid).
// BALANS 2026-06-18: + ak + lmg — objektiv-lägena (CTF/KOTH/Siege/Jugg) erbjöd bara
// 8 vapen; bästa rifle-klassen (ak, nu nerfad) och rörlig eldkraft (lmg) saknades.
const COOP_ARSENAL = ['fists', 'knife', 'pistol', 'smg', 'autoshotgun', 'shotgun', 'sniper', 'rifle', 'ak', 'lmg'];
const TDM_BASE_WEAPONS = ['fists', 'knife', 'pistol'];

function _logWeaponClamp(sim, peerId, from, to, why) {
  // Throttlat (max 1 log / 2s per rum) så fusk syns utan log-spam
  const now = Date.now();
  sim._weaponClampCount = (sim._weaponClampCount || 0) + 1;
  if (!sim._weaponClampLogAt || now - sim._weaponClampLogAt > 2000) {
    sim._weaponClampLogAt = now;
    console.log('[ANTICHEAT]', sim.room.code, 'weapon clamp #' + sim._weaponClampCount,
      peerId, String(from) + ' → ' + to, '(' + why + ')');
  }
}

function clampWeaponToModeArsenal(sim, ws, ps, weaponId, peerId) {
  // Gulag-duellen har redan låst vapnet (inkl. specialet gulag_knock) — rör ej.
  if (ps.gulagState === 'fighting') return weaponId;
  const W_BY_ID = require('../../shared/weapons-data').W_BY_ID;
  if (sim.gungameActive) {
    const tier = Math.max(0, Math.min(GUNGAME_WEAPONS.length - 1, sim.gungameTiers[peerId] || 0));
    const tierWeapon = GUNGAME_WEAPONS[tier];
    if (weaponId === tierWeapon || weaponId === 'fists') return weaponId;
    _logWeaponClamp(sim, peerId, weaponId, tierWeapon, 'gungame tier ' + tier);
    return tierWeapon;
  }
  if (sim.tdmActive) {
    if (TDM_BASE_WEAPONS.includes(weaponId)) return weaponId;
    if (Array.isArray(ws._tdmPickedWeapons) && ws._tdmPickedWeapons.includes(weaponId)) return weaponId;
    _logWeaponClamp(sim, peerId, weaponId, 'pistol', 'tdm ej i förrådet');
    return 'pistol';
  }
  if (sim.ctfActive || sim.siegeActive || sim.kothActive) {
    if (COOP_ARSENAL.includes(weaponId)) return weaponId;
    _logWeaponClamp(sim, peerId, weaponId, 'pistol', sim.ctfActive ? 'ctf' : (sim.siegeActive ? 'siege' : 'koth'));
    return 'pistol';
  }
  if (sim.juggernautActive) {
    const isJug = sim.juggernautPid === peerId;
    // Hunters: hela coop-arsenalen (V1-radialen tillåter den). JUG: dito + jug-vapnen
    // (sledge). Pistol-shots från en NYBLIVEN jug (event-latency) clampas inte.
    if (COOP_ARSENAL.includes(weaponId)) return weaponId;
    if (isJug && JUGGERNAUT_ARENA.jugWeapons.includes(weaponId)) return weaponId;
    const fb = isJug
      ? (sim.juggernautWeapon || JUGGERNAUT_ARENA.jugDefaultWeapon || 'rifle')
      : (JUGGERNAUT_ARENA.hunterWeapon || 'pistol');
    _logWeaponClamp(sim, peerId, weaponId, fb, isJug ? 'juggernaut (jug)' : 'juggernaut (hunter)');
    return fb;
  }
  if (sim.battleroyaleActive) {
    // Lazy-init (late-join/gulag-redeploy-edge): starter-trion + serverns hand-vapen
    if (!(ws._brOwnedWeapons instanceof Set)) {
      ws._brOwnedWeapons = new Set(['fists', 'knife', BATTLEROYALE_ARENA.startWeapon || 'pistol']);
      if (ps.weaponId && W_BY_ID[ps.weaponId]) ws._brOwnedWeapons.add(ps.weaponId);
    }
    if (ws._brOwnedWeapons.has(weaponId)) return weaponId;
    const fb = BATTLEROYALE_ARENA.startWeapon || 'pistol';
    _logWeaponClamp(sim, peerId, weaponId, fb, 'br ej lootat');
    return fb;
  }
  // Story-familjen/survivors/CD/heist: katalog-existens räcker (servern vet inte save.owned)
  if (W_BY_ID[weaponId]) return weaponId;
  const fb = (ps.weaponId && W_BY_ID[ps.weaponId]) ? ps.weaponId : 'pistol';
  _logWeaponClamp(sim, peerId, weaponId, fb, 'okänt vapen-id');
  return fb;
}

function applyShoot(sim, peerId, msg) {
  const ws = sim.room.members.get(peerId);
  if (!ws) return;
  // v2 (additivt): Godot-klientens aktuella interp-fönster (ms) för exakt
  // lag-komp-rewind (bullets.js rewoundPosition). Clamp 0-200 (anti-cheat —
  // ingen kan begära att träffa längre bakåt än rewind-capen ändå tillåter).
  // V1 skickar aldrig fältet → förblir undefined → 60ms-default.
  if (typeof msg.interp === 'number' && isFinite(msg.interp)) {
    ws._clientInterpMs = Math.max(0, Math.min(200, msg.interp));
  }
  if (!ws.playerState) {
    ws.playerState = {
      x: typeof msg.x === 'number' ? msg.x : 1000,
      y: typeof msg.y === 'number' ? msg.y : 1000,
      hp: 100,
    };
  }
  const ps = ws.playerState;
  // BR downed (v1.740): krypande spelare kan inte skjuta (server-enforce).
  if (ps.brDowned) return;
  // BATTLE BUS / SKYDIVE: inget skjutande på bussen eller i luften (server-enforce).
  if (ps.brAir) return;
  // GULAG (v1.790): no-shoot-spel (Bomb Tag/Floor is Lava) blockerar skott helt.
  if (ps.gulagState === 'fighting' && ps._gulagNoShoot) return;
  // Castle Defense down-state: bara knife tillåten (server-enforce, annars
  // kan klient skicka rifle/sniper-shots medan downed).
  if (ps.cdDowned) {
    // Tillåt bara knife-shots. Om client försöker skjuta annat → reject.
    if (msg.weaponId && msg.weaponId !== 'knife') return;
  }
  // Mounted turret: tvinga rätt vapen-id + position. Annars kan client säga
  // "weaponId: railgun" och få railgun-dmg från turret-position.
  let weaponId = msg.weaponId || ps.weaponId || 'pistol';
  // GULAG (v1.790): tvinga duellens vapen (anti-cheat — ingen rocket i gulagen)
  if (ps.gulagState === 'fighting' && ps._gulagWeapon) {
    // v1.800: Frenzy — tillåt byte mellan UPPLOCKADE vapen (radialen) + pistol; annars
    // lås till duell-vapnet (anti-cheat: ingen rocket i void osv).
    if (ps._gulagGame === 'frenzy' && (msg.weaponId === 'pistol' || (Array.isArray(ps._gulagWeapons) && ps._gulagWeapons.includes(msg.weaponId)))) {
      weaponId = msg.weaponId;
    } else {
      weaponId = ps._gulagWeapon;
    }
  }
  if (ps.cdDowned) weaponId = 'knife';
  // v1.401 anti-cheat: Castle Defense — validera mot vapen-tier
  if (sim.castledefenseActive && msg.weaponId) {
    const cdArena = CASTLEDEFENSE_ARENA;
    const tier = sim.castledefenseWeaponTier[peerId] || 0;
    const allowed = ['fists', 'knife'];
    const prog = (cdArena && cdArena.weaponProgression) || [];
    for (let i = 0; i <= tier && i < prog.length; i++) allowed.push(prog[i]);
    // vapen köpta hos vapenhandlaren får också skjutas
    const cdBought = sim.castledefensePurchasedWeapons && sim.castledefensePurchasedWeapons[peerId];
    if (cdBought && cdBought.has(msg.weaponId)) allowed.push(msg.weaponId);
    if (!allowed.includes(msg.weaponId)) {
      // Cheat-försök — fallback till server-side weapon
      weaponId = ps.weaponId || prog[tier] || 'pistol';
    }
  }
  // v2 anti-cheat: mode-arsenal-validering (clamp + behåll skottet). Mounted
  // turret override:ar weaponId NEDAN — den vinner alltid över clampen.
  weaponId = clampWeaponToModeArsenal(sim, ws, ps, weaponId, peerId);
  let posX = typeof msg.x === 'number' ? msg.x : ps.x;
  let posY = typeof msg.y === 'number' ? msg.y : ps.y;
  // Mounted turret: tvinga vapen + skjut från MYNNINGEN (center + 20px längs aim;
  // shootPlayerBullet lägger till ytterligare ~14px pip → mynningsspetsen). CD: MG =
  // CTF:s turret_mg (sitt-och-sikta själv); bomber skapar bomb-projektil direkt.
  const _mzAng = (typeof msg.ang === 'number' && isFinite(msg.ang)) ? msg.ang : (ps.aim || 0);
  const _MZ = 20;
  if (ws._mountedSiegeTurretId && sim.siegeTurrets) {
    const t = sim.siegeTurrets[ws._mountedSiegeTurretId];
    if (t) { weaponId = t.weaponId || 'turret_mg'; posX = t.x + Math.cos(_mzAng) * _MZ; posY = t.y + Math.sin(_mzAng) * _MZ; }
  } else if (ws._mountedCtfTurretId && sim.ctfTurrets) {
    const t = sim.ctfTurrets[ws._mountedCtfTurretId];
    if (t) { weaponId = t.weaponId || 'turret_mg'; posX = t.x + Math.cos(_mzAng) * _MZ; posY = t.y + Math.sin(_mzAng) * _MZ; }
  } else if (ws._mountedCdTowerId && sim.castledefenseBuildings) {
    const _cb = sim.castledefenseBuildings.find(x => x.id === ws._mountedCdTowerId && x.hp > 0);
    if (_cb) {
      const _ccx = _cb.x + _cb.w / 2, _ccy = _cb.y + _cb.h / 2;
      if (_cb.kind === 'bomber') {
        // manuell BOMBER: skapa bomb-projektil direkt (arc + AoE), rate-gated server-side
        if (!(_cb._manFireCd > 0)) {
          _cb._manFireCd = 1 / (_cb.fireRate || 0.85);
          const _bsp = 560;
          sim.bullets.push({
            x: _ccx + Math.cos(_mzAng) * _MZ, y: _ccy + Math.sin(_mzAng) * _MZ,
            vx: Math.cos(_mzAng) * _bsp, vy: Math.sin(_mzAng) * _bsp,
            dmg: (_cb.dps / _cb.fireRate) * 1.5, life: 1.8, r: 6, color: '#ff8a3a',
            hostile: false, ownerPid: peerId, weaponId: 'turret', _cdBlastR: _cb.blastRadius || 95,
          });
          sim.eventQueue.push({ type: 'cd_turret_fired', id: _cb.id, x: Math.round(_ccx), y: Math.round(_ccy), ang: _mzAng, kind: 'bomber' });
        }
        return;  // bomber hanteras helt här (ej via shootPlayerBullet)
      }
      weaponId = 'turret_mg'; posX = _ccx + Math.cos(_mzAng) * _MZ; posY = _ccy + Math.sin(_mzAng) * _MZ;
      sim.eventQueue.push({ type: 'cd_turret_fired', id: _cb.id, x: Math.round(_ccx), y: Math.round(_ccy), ang: _mzAng, kind: 'machinegun' });
    }
  }
  // ANTI-CHEAT (AAA): validera skott-ORIGIN mot spelarens AUKTORITATIVA positioner
  // (server-pos + rewind-historiken ps._history). Klienten skickar legitimt sin pos-
  // vid-avfyrning (responsivt + lag-komp), MEN ett origin långt från någon rimlig
  // nyligen-position = teleport-skott/aimbot-från-valfri-plats. Då clampas origin till
  // server-pos (skottet BEHÅLLS — mjukt mot latens, samma filosofi som vapen-clampen).
  // Bara PvP (co-op-pos är klient-betrodd + ofarlig); hoppar mounted turret (legit fast
  // pos) + gulag (off-map-arena, egen pos-logik). 400px täcker prediktion+RTT+dash.
  const _spvp = sim.tdmActive || sim.ctfActive || sim.siegeActive ||
                sim.gungameActive || sim.kothActive ||
                sim.juggernautActive || sim.battleroyaleActive;
  if (_spvp && !(ws._mountedSiegeTurretId || ws._mountedCtfTurretId || ws._mountedCdTowerId) &&
      ps.gulagState !== 'fighting' && typeof msg.x === 'number' && typeof msg.y === 'number') {
    const MAX_DEV2 = 400 * 400;
    let best2 = (posX - ps.x) * (posX - ps.x) + (posY - ps.y) * (posY - ps.y);
    const hist = ps._history;
    if (hist) {
      for (let i = 0; i < hist.length; i++) {
        const dx = posX - hist[i].x, dy = posY - hist[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best2) best2 = d2;
      }
    }
    if (best2 > MAX_DEV2) {
      sim._originClampCount = (sim._originClampCount || 0) + 1;
      const _ocNow = Date.now();
      if (!sim._originClampLogAt || _ocNow - sim._originClampLogAt > 2000) {
        sim._originClampLogAt = _ocNow;
        console.log('[ANTICHEAT]', sim.room.code, 'skott-origin clamp #' + sim._originClampCount,
          peerId, 'origin=(' + Math.round(posX) + ',' + Math.round(posY) + ') → server-pos=(' +
          Math.round(ps.x) + ',' + Math.round(ps.y) + ') dev=' + Math.round(Math.sqrt(best2)));
      }
      posX = ps.x;
      posY = ps.y;
    }
  }
  const p = {
    x: posX, y: posY,
    // C124 (audit 2026-06-18): isFinite-guard (speglar msg.interp-guarden) — en JSON-
    // producer kan emit:a Infinity (1e400) → annars NaN-velocity-kulor som aldrig cullas.
    aimAngle: (typeof msg.ang === 'number' && isFinite(msg.ang)) ? msg.ang : (ps.aim || 0),
    r: 14, peerId,
  };
  // Diagnostik (avstängt i prod via env-var)
  if (process.env.SIM_DEBUG) {
    console.log('[SIM]', sim.room.code, 'shoot from', peerId, 'weapon=' + weaponId, 'pos=(' + p.x + ',' + p.y + ')', 'enemies=' + sim.enemies.length, 'bullets=' + sim.bullets.length);
  }
  // AUDIT C269/C275/C178/C203 (2026-06-18): klient-levererade combat-multiplikatorer var OKLAMPADE
  // → moddad klient kunde skicka dmgMul=1e9/Infinity och one-shotta allt (även bossar). Bounda alla
  // till finita, generösa tak som ligger TYDLIGT över legit max-stack (upgrades×mastery×combo×glass_cannon×temp
  // ≈ 25-30) så inga riktiga builds nerfas. critChance är en sannolikhet → måste vara [0,1].
  // (Full server-auktoritativ härledning kommer i ekonomi/auktoritets-vågen.)
  const params = {
    dmgMul: Math.max(0, Math.min(50, +msg.dmgMul || 1)),
    bspeedMul: Math.max(0.1, Math.min(5, +msg.bspeedMul || 1)),
    explMul: Math.max(0, Math.min(10, +msg.explMul || 1)),
    kbMul: Math.max(0, Math.min(10, +msg.kbMul || 1)),
    critChance: Math.max(0, Math.min(1, +msg.critChance || 0)),
    adrenalineDmg: Math.max(0, Math.min(5, +msg.adrenalineDmg || 1)),
    stealthBonus: Math.max(0, Math.min(5, +msg.stealthBonus || 1)),
    mrangeMul: Math.max(1, Math.min(2, +msg.mrangeMul || 1)),   // v2: melee-räckvidd-upgrade
    perks: msg.perks || {}, cheats: msg.cheats || {},
  };
  // v1.799/807: GULAG Frenzy BERSERK-powerup → 2× skada i 6s. gulagState-guard (v1.807):
  // BARA under aktiv duell → berserk läcker aldrig till live-BR.
  if (ps.gulagState === 'fighting' && ps._gulagDmgUntil && Date.now() < ps._gulagDmgUntil) params.dmgMul *= 2;
  // v3 perk-träd: Apply CD perk-flag effects to params (ARTILLERIST + JUGGERNAUT-finisher)
  if (sim.castledefenseActive) {
    const f = cdFlags(sim, peerId);
    if (f.gunner) params.dmgMul *= (1 + 0.15 * f.gunner);          // art_dmg
    if (f.sharpshooter) {                                          // art_aim
      params.critChance = Math.min(1, params.critChance + 0.12 * f.sharpshooter);
      params.bspeedMul *= (1 + 0.25 * f.sharpshooter);
    }
    if (f.berserker) {                                             // jug_last
      const hpPct = (ps.hp || 1) / (ps.maxHp || 100);
      if (hpPct < 0.40) params.dmgMul *= (1 + 0.20 * f.berserker);
    }
    if (f.overdmg) params.dmgMul *= (1 + 0.125 * f.overdmg);     // art_over
    // v3-cd-dmg-rescale (group C): frenzy CONSUME / bloodmoney / cap_warlord / overpen (grant=D, pierce=E)
    if (f.frenzy) {                                              // *_rush (consume; grant=D)
      const _rushNow = Date.now();
      const _rushSt = (ps._cdRushUntil && _rushNow < ps._cdRushUntil) ? (ps._cdRushStacks || 0) : 0;
      params.dmgMul *= (1 + 0.06 * f.frenzy * Math.min(5, _rushSt));
    }
    if (f.bloodmoney) {                                          // *_bloodmoney
      const _bmGold = sim.castledefenseGold[peerId] || 0;
      params.dmgMul *= (1 + Math.min(0.15, _bmGold / 150000) * f.bloodmoney);
    }
    if (f.cap_warlord && (ps.hp || 1) / (ps.maxHp || 100) > 0.80) // cap_warlord
      params.dmgMul *= (1 + 0.15 * f.cap_warlord);
    if (f.overpen) params.pierceCount = f.overpen;               // *_overpen (consumed in bullets.js, group E)
  }
  // Melee i PvP-modes: direkt hit-check, ingen bullet spawnas.
  // (Story-mode melee körs lokalt på klient mot state.enemies.)
  const w = require('../../shared/weapons-data').W_BY_ID[weaponId];
  if (w && w.type === 'melee') {
    applyMelee(sim, p, weaponId, params);
    return;
  }
  const _bBefore = sim.bullets.length;
  spawnPlayerBullets(sim, p, weaponId, params);
  // GULAG (v1.795): markera kulor från duellanter så de INTE cullas av map-bounds
  // (off-map-arenan ligger på 13000+ > worldMaxX → annars dog kulan direkt och nådde
  // aldrig motståndaren = "vapnet puttar inte bak / skjuter inga skott").
  if (ps.gulagState === 'fighting') {
    for (let i = _bBefore; i < sim.bullets.length; i++) sim.bullets[i].gulag = true;
  }
  // VARIANT B (v1.729): server-källat visuellt skott-event → ANDRA klienter ser kulan
  // TILLFÖRLITLIGT (server är auktoritativ + eventet droppas ej, till skillnad från den
  // gamla peer-broadcasten som stryptes av skyttens telefon vid backpressure → "ser
  // träffen men inte kulan"). Klienten dedupar egna skott via ownerPid.
  if (sim.bullets.length > _bBefore) {
    const bs = [];
    for (let i = _bBefore; i < sim.bullets.length && bs.length < 14; i++) {
      const b = sim.bullets[i];
      bs.push({
        x: Math.round(b.x), y: Math.round(b.y),
        vx: Math.round(b.vx), vy: Math.round(b.vy),
        c: b.color, r: b.r, l: b.life, s: b.style,
      });
    }
    if (bs.length) sim.eventQueue.push({ type: 'pvp_shot', ownerPid: peerId, bs });
  }
}

// BR: spelaren dropar ett vapen från inventory → spawna loot vid sin pos
function applyBrDropWeapon(sim, peerId, msg) {
  if (!sim.battleroyaleActive) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const weaponId = msg && msg.weaponId;
  if (!weaponId) return;
  // Block default-starter dropp (fists/knife/pistol kan inte tas bort)
  if (weaponId === 'fists' || weaponId === 'knife' || weaponId === 'pistol') return;
  const px = ws.playerState.x, py = ws.playerState.y;
  sim._brLootIdCounter = (sim._brLootIdCounter || 0) + 1;
  const lo = {
    id: 'br_loot_' + sim._brLootIdCounter,
    x: px + (Math.random() - 0.5) * 30,
    y: py + (Math.random() - 0.5) * 30,
    kind: 'weapon',
    weaponId,
    tier: 'dropped',
    available: true,
    unlockAt: 0,
  };
  sim.battleroyaleLoot.push(lo);
  // Server-side equip: byt till nästa vapen klienten skickade (eller pistol fallback)
  if (msg.newWeaponId) ws.playerState.weaponId = msg.newWeaponId;
  sim.eventQueue.push({
    type: 'br_corpse_drop',
    x: Math.round(lo.x),
    y: Math.round(lo.y),
    loot: [{ id: lo.id, x: lo.x, y: lo.y, kind: lo.kind, weaponId: lo.weaponId, tier: lo.tier, unlockAt: 0 }],
  });
}

// BATTLE BUS: klienten trycker HOPPA → lämna bussen och börja freefall. Idempotent —
// bara giltigt medan PÅ bussen (brAir===1) under aktiv predrop.
function applyBrJump(sim, peerId) {
  if (!sim.battleroyaleActive || !sim.brPredrop) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.brAir !== 1) return;
  startBrJump(sim, peerId, ws, Date.now());
}

// Ny: host kan köra "next stage" via sim_load_stage-meddelande
function applyLoadStage(sim, peerId, msg) {
  if (sim.room.hostId !== peerId) return;
  // Klient skickar maxStages så server vet stage-count. Annars fallback till
  // generös 30 (säkrare mot orimliga värden men låter custom-modes köra).
  const maxStages = (typeof msg.maxStages === 'number' && msg.maxStages > 0)
    ? Math.min(50, msg.maxStages)
    : 30;
  const wave = Math.max(1, Math.min(maxStages, msg.wave || 1));
  // Reset deadBodies vid stage-load så ev. icke-revivad spelare från förra stage
  // inte är stuck. Spelare som dog precis innan stage-clear ska respawna fresh.
  sim.deadBodies = {};
  loadStage(sim, wave);
}

// ============================================================
// CASTLE DEFENSE — build + repair-handlers (client → server)
// ============================================================
function applyCastleDefenseBuild(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) return;
  const arena = CASTLEDEFENSE_ARENA;
  const kind = msg && msg.kind;
  const isSlotTower = !!(arena.slotBuildables && arena.slotBuildables[kind]);
  const spec = isSlotTower ? arena.slotBuildables[kind] : (arena.buildables && arena.buildables[kind]);
  if (!kind || !spec) return;
  const grid = arena.buildGridSize;
  // v3 perk-träd: BYGGMÄSTARE (arch_cost) -15%/rank + difficulty price-mul
  const buildCostMul = Math.max(0, 1 - 0.15 * (cdFlags(sim, peerId).builder || 0));
  const diffPriceMul = cdGetDifficultyPriceMul(sim.config.difficulty);
  const effectiveCost = Math.max(1, Math.round(spec.cost * buildCostMul * diffPriceMul));
  const playerGold = sim.castledefenseGold[peerId] || 0;
  if (playerGold < effectiveCost) {
    sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'insufficient_gold', kind });
    return;
  }

  let x, y, w, h, slotRef = null;
  if (isSlotTower) {
    // SLOT-TORN (machinegun/bomber): BARA i en av de 6 battlement-slotsen, tom slot,
    // och spelaren måste stå nära slotten.
    const slot = (sim.castledefenseSlots || []).find(s => s.id === (msg && msg.slot));
    if (!slot) { sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'bad_slot', kind }); return; }
    if (slot.towerId) {
      const _occ = sim.castledefenseBuildings.find(bb => bb.id === slot.towerId && bb.hp > 0);
      if (_occ) { sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'slot_taken', kind }); return; }
      slot.towerId = null;   // stale ref till dott torn -> rensa & tillat ombygge
    }
    const pdx = ws.playerState.x - slot.x, pdy = ws.playerState.y - slot.y;
    if (pdx * pdx + pdy * pdy > 100 * 100) { sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'too_far', kind }); return; }
    w = 36; h = 36;
    x = Math.round(slot.x - w / 2); y = Math.round(slot.y - h / 2);
    slotRef = slot;
  } else {
    // FÄLT-BYGGE (mur/port/spik/tjära/olja/krut-tunna): grid-snap, inom kartan, INTE
    // på/inne i slottet, ingen överlapp.
    x = Math.floor((+msg.x || 0) / grid) * grid;
    y = Math.floor((+msg.y || 0) / grid) * grid;
    w = spec.w; h = spec.h;
    if (spec.openable && (+msg.rot)) { const _tw = w; w = h; h = _tw; }   // PORT: rotera (liggande <-> stående)
    if (x < 20 || y < 20 || x + w > arena.worldW - 20 || y + h > arena.worldH - 20) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'out_of_bounds', kind }); return;
    }
    const C = arena.castle;
    if (C && x < C.x + C.w && x + w > C.x && y < C.y + C.h && y + h > C.y) {
      sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'inside_castle', kind }); return;
    }
    for (const b of sim.castledefenseBuildings) {
      if (b.hp <= 0) continue;
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) {
        sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_building', kind }); return;
      }
    }
    // Solida (mur/port) får ej placeras på levande spelare/fiende (de skulle fastna).
    // Fällor/krut-tunna får läggas under fiender (de skadar/triggas där).
    const isSolid = (kind === 'wall' || kind === 'gate');
    if (isSolid) {
      for (const [, ws2] of sim.room.members) {
        if (!ws2.playerState || ws2.playerState.hp <= 0) continue;
        const ps = ws2.playerState, r = 14;
        const ccx = Math.max(x, Math.min(ps.x, x + w)), ccy = Math.max(y, Math.min(ps.y, y + h));
        const ddx = ps.x - ccx, ddy = ps.y - ccy;
        if (ddx * ddx + ddy * ddy < r * r) { sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_player', kind }); return; }
      }
      for (const e of sim.enemies) {
        if (e.dead) continue;
        const ccx2 = Math.max(x, Math.min(e.x, x + w)), ccy2 = Math.max(y, Math.min(e.y, y + h));
        const eddx = e.x - ccx2, eddy = e.y - ccy2;
        if (eddx * eddx + eddy * eddy < (e.r || 12) * (e.r || 12)) { sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'overlap_enemy', kind }); return; }
      }
    }
  }

  // OK → deducera gold + skapa byggnad
  sim.castledefenseGold[peerId] = playerGold - effectiveCost;
  sim._cdBuildIdCounter = (sim._cdBuildIdCounter || 0) + 1;
  const building = {
    id: 'build_' + sim._cdBuildIdCounter,
    kind, x, y, w, h,
    hp: spec.hp, maxHp: spec.hp,
    ownerPid: peerId,
    fireRate: spec.fireRate || 0, range: spec.range || 0, dps: spec.dps || 0,
    dmgOnPass: spec.dmgOnPass || 0, killCapacity: spec.killCapacity || 0,
    slowMul: spec.slowMul || 1, slowDurSec: spec.slowDurSec || 0, radius: spec.radius || 0,
    burnSec: spec.burnSec || 0, blastRadius: spec.blastRadius || 0, blastDmg: spec.blastDmg || 0,
    trailDps: spec.trailDps || 0, trailSec: spec.trailSec || 0, manDpsMul: spec.manDpsMul || 0,
    open: kind === 'gate' ? false : undefined,   // PORT börjar STÄNGD (= mur tills öppnad)
    slotId: slotRef ? slotRef.id : null,
    level: 0,
    _baseCost: spec.cost,
    _baseStats: {
      hp: spec.hp, dps: spec.dps || 0, range: spec.range || 0,
      dmgOnPass: spec.dmgOnPass || 0, fireRate: spec.fireRate || 0,
      slowMul: spec.slowMul || 1, radius: spec.radius || 0,
    },
    _fireCd: 0, occupantId: null,
    _totalInvested: effectiveCost,
  };
  sim.castledefenseBuildings.push(building);
  if (slotRef) slotRef.towerId = building.id;
  // Solida fält-strukturer (mur / STÄNGD port) ändrar pathfinding → rebuild flow field.
  if (kind === 'wall' || kind === 'gate') sim._cdFlowDirty = true;
  sim.eventQueue.push({
    type: 'cd_building_placed',
    id: building.id, kind: building.kind,
    x: building.x, y: building.y, w: building.w, h: building.h,
    hp: building.hp, maxHp: building.maxHp, ownerPid: peerId,
    range: building.range, radius: building.radius, open: building.open,
    slotId: building.slotId, level: 0, totalInvested: building._totalInvested,
  });
  sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -effectiveCost });
}

function applyCastleDefenseRepair(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const id = msg && msg.id;
  if (!id) return;
  let target = null;
  let isBuild = false;
  for (const w of sim.castledefenseWalls) {
    if (w.id === id && w.hp > 0 && w.hp < w.maxHp) { target = w; break; }
  }
  if (!target) {
    for (const b of sim.castledefenseBuildings) {
      if (b.id === id && b.hp > 0 && b.hp < b.maxHp) { target = b; isBuild = true; break; }
    }
  }
  if (!target) return;
  // v1.419: AABB med tolerans — REPARERA-knappen öppnas nära tornet, inte exakt PÅ det.
  // Slot-torn (machinegun/bomber) sitter PÅ sydmuren (ytterkant) → spelaren står ofta
  // INNE i slottet (bakom 50px-muren) när de vill laga. Större tolerans så man når
  // reparationen inifrån utan att behöva springa ut framför muren (användarkrav).
  const _RTOL = (target.kind === 'machinegun' || target.kind === 'bomber') ? 95 : 34;
  const px = ws.playerState.x, py = ws.playerState.y;
  if (px < target.x - _RTOL || px > target.x + target.w + _RTOL || py < target.y - _RTOL || py > target.y + target.h + _RTOL) return;
  // v1.415: Repair-cost scaling efter dmg-pct + total invest.
  // 99% damaged → cost ≈ 0.75 × totalInvested. 1% damaged → cost ≈ 0.0075 × totalInvested.
  const dmgPct = 1 - (target.hp / target.maxHp);
  if (dmgPct < 0.01) return; // i princip full hp, ingen reparation behövs
  const invested = target._totalInvested || 50;
  const REPAIR_COST = Math.max(1, Math.ceil(0.75 * invested * dmgPct));
  if ((sim.castledefenseGold[peerId] || 0) < REPAIR_COST) {
    sim.eventQueue.push({ type: 'cd_build_failed', peerId, reason: 'insufficient_gold', kind: 'repair', cost: REPAIR_COST });
    return;
  }
  sim.castledefenseGold[peerId] -= REPAIR_COST;
  // FULL HEAL till maxHp (var: +80hp). Mer intuitivt + matchar cost-scaling.
  target.hp = target.maxHp;
  sim.eventQueue.push({
    type: isBuild ? 'cd_building_damaged' : 'cd_wall_damaged',
    id: target.id, hp: target.hp, maxHp: target.maxHp,
  });
  sim.eventQueue.push({
    type: 'cd_gold_update',
    peerId, gold: sim.castledefenseGold[peerId], delta: -REPAIR_COST,
  });
}

// v1.407: Upgrade existing building. Increments level + scales stats + deducts gold.
// v2 REDESIGN: spec-lookup som täcker BÅDE fält-byggen och slot-torn.
function _cdSpecOf(kind) {
  const A = CASTLEDEFENSE_ARENA;
  return (A.buildables && A.buildables[kind]) || (A.slotBuildables && A.slotBuildables[kind]) || {};
}
// Engångs-saker (spik = kapacitet, olja = tidsbegränsad, krut-tunna = triggas) — ej uppgraderbara.
const _CD_NO_UPGRADE = { spike_trap: 1, oil_fire: 1, powder_barrel: 1 };

function _cdUpgradeCost(sim, peerId, b) {
  const arena = CASTLEDEFENSE_ARENA;
  const baseCost = b._baseCost || _cdSpecOf(b.kind).cost || 100;
  const ucBase = arena.upgradeCostBase || 0.5, ucExp = arena.upgradeCostExp || 1.2;
  const upgMul = Math.max(0, 1 - 0.15 * (cdFlags(sim, peerId).builder || 0));   // v3: arch_cost
  const diff = cdGetDifficultyPriceMul(sim.config.difficulty);
  return Math.max(1, Math.round(baseCost * ucBase * Math.pow((b.level || 0) + 1, ucExp) * upgMul * diff));
}

function _cdApplyUpgradeStats(b, arena) {
  const mul = arena.upgradeStatMul || {};
  const base = b._baseStats || {};
  const lvl = b.level;
  const spec = _cdSpecOf(b.kind);
  if (base.hp) {
    const hpScale = spec.hpScalePerLvl != null ? spec.hpScalePerLvl : (mul.hp || 0.5);
    const newMax = Math.round(base.hp * (1 + lvl * hpScale));
    const hpPct = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    b.maxHp = newMax; b.hp = Math.round(newMax * hpPct);
  }
  if (base.dps) b.dps = base.dps * (1 + lvl * (mul.dps || 0.45));
  if (base.range) b.range = Math.round(base.range * (1 + lvl * (mul.range || 0.10)));
  if (base.dmgOnPass) b.dmgOnPass = Math.round(base.dmgOnPass * (1 + lvl * (mul.dmg || 0.40)));
  // TJÄRGROP: större radie + starkare slow per nivå (lägre slowMul = mer slow).
  if (b.kind === 'tar_trap') {
    if (base.radius) b.radius = Math.round(base.radius * (1 + lvl * 0.12));
    b.slowMul = Math.max(0.15, (base.slowMul || 0.4) - lvl * 0.02);
  }
}

// v2 REDESIGN: uppgradera 1 nivå (msg.max=true → så många nivåer man har råd med).
function applyCastleDefenseUpgrade(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) return;
  const arena = CASTLEDEFENSE_ARENA;
  const id = msg && msg.id;
  if (!id) return;
  const b = sim.castledefenseBuildings.find(x => x.id === id && x.hp > 0);
  if (!b) return;
  if (_CD_NO_UPGRADE[b.kind]) { sim.eventQueue.push({ type: 'cd_upgrade_failed', peerId, id, reason: 'not_upgradeable' }); return; }
  // Närhets-check (AABB + tolerans). 34 ≥ klientens panel-marginal (30) så att en
  // spelare som KOLLISIONS-blockeras vid murkanten fortfarande kan uppgradera.
  const px = ws.playerState.x, py = ws.playerState.y, tol = 34;
  if (px < b.x - tol || px > b.x + b.w + tol || py < b.y - tol || py > b.y + b.h + tol) return;
  const maxLevel = arena.maxBuildLevel || 10;
  const wantMax = !!(msg && msg.max);
  let did = 0;
  do {
    if ((b.level || 0) >= maxLevel) { if (did === 0) sim.eventQueue.push({ type: 'cd_upgrade_failed', peerId, id, reason: 'max_level' }); break; }
    const cost = _cdUpgradeCost(sim, peerId, b);
    const gold = sim.castledefenseGold[peerId] || 0;
    if (gold < cost) { if (did === 0) sim.eventQueue.push({ type: 'cd_upgrade_failed', peerId, id, reason: 'insufficient_gold', cost }); break; }
    sim.castledefenseGold[peerId] = gold - cost;
    b._totalInvested = (b._totalInvested || b._baseCost || 0) + cost;
    b.level = (b.level || 0) + 1;
    _cdApplyUpgradeStats(b, arena);
    did++;
    sim.eventQueue.push({
      type: 'cd_building_upgraded', id: b.id, level: b.level, peerId,
      hp: b.hp, maxHp: b.maxHp, dps: b.dps, range: b.range,
      dmgOnPass: b.dmgOnPass, radius: b.radius, upgradeCost: cost, totalInvested: b._totalInvested,
    });
    sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -cost });
  } while (wantMax);
}

// v1.411: Sälja byggnad — bara owner får sälja, refund = 50% av totalt invest
function applyCastleDefenseSell(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  // v1.413: blockera sell om player är död eller downed (matchar repair/build/upgrade)
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  if (ws.playerState.cdDowned) return;
  const id = msg && msg.id;
  if (!id) return;
  const b = sim.castledefenseBuildings.find(x => x.id === id && x.hp > 0);
  if (!b) return;
  // Co-op: ALLA i laget får sälja (delad resurs) — owner-check borttagen (användarfeedback)
  // AABB + tolerans 34 (matchar uppgradering; spelaren blockeras vid murkanten av
  // kollisionen och kan annars inte stå "inuti" muren för att sälja)
  const sellPx = ws.playerState.x, sellPy = ws.playerState.y, sellTol = 34;
  if (sellPx < b.x - sellTol || sellPx > b.x + b.w + sellTol || sellPy < b.y - sellTol || sellPy > b.y + b.h + sellTol) {
    sim.eventQueue.push({ type: 'cd_sell_failed', peerId, id, reason: 'not_in_range' });
    return;
  }
  const refund = Math.round((b._totalInvested || 0) * 0.5);
  sim.castledefenseGold[peerId] = (sim.castledefenseGold[peerId] || 0) + refund;
  b.hp = 0;
  // v2 REDESIGN: sälja ett SLOT-TORN → frigör slotten (annars permanent "upptagen")
  // + sparka av ev. sittande spelare.
  if (b.slotId && sim.castledefenseSlots) {
    const slot = sim.castledefenseSlots.find(s => s.id === b.slotId);
    if (slot && slot.towerId === b.id) slot.towerId = null;
    if (b.occupantId) {
      const occWs = sim.room.members.get(b.occupantId);
      if (occWs && occWs._mountedCdTowerId === b.id) occWs._mountedCdTowerId = null;
    }
  }
  // Bara MUR/PORT ändrar pathfinding → flow field dirty
  if (b.kind === 'wall' || b.kind === 'gate') sim._cdFlowDirty = true;
  sim.eventQueue.push({ type: 'cd_building_sold', id: b.id, peerId, refund });
  sim.eventQueue.push({ type: 'cd_building_destroyed', id: b.id });
  sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: refund });
}

// v1.416: Hero-perk selection — unik per spelare (rejects duplicate).
function applyCastleDefensePerk(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState) return;
  const perkId = msg && msg.perkId;
  if (!perkId) return;
  // Validera mot arena.heroPerks
  const arena = CASTLEDEFENSE_ARENA;
  const validPerk = (arena.heroPerks || []).find(p => p.id === perkId);
  if (!validPerk) {
    sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'invalid_id' });
    return;
  }
  // Kolla att inte annan spelare redan har den
  for (const [otherPid, otherPerk] of Object.entries(sim.castledefensePerks)) {
    if (otherPid !== peerId && otherPerk === perkId) {
      sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'taken', perkId });
      return;
    }
  }
  // OK — sätt perk (LEGACY string-perk; effekter går numera via perk-träd-flaggor)
  sim.castledefensePerks[peerId] = perkId;
  applyCdTreeStats(sim, ws.playerState, peerId);
  sim.eventQueue.push({
    type: 'cd_perk_selected', peerId, perkId,
    allPerks: { ...sim.castledefensePerks },
  });
}

// v1.416: Applicera at-start-effekter för perk (resten är passiva via flags)
// v1.419: ABSOLUTA värden (idempotent) — annars multipliceras vid re-event/respawn-reapply.
function applyCdPerkEffects(ps, perkId) {
  if (!ps) return;
  if (perkId === 'tank') {
    ps.maxHp = 150;
    ps.hp = 150;
    ps.speedMul = 0.8;
  } else if (perkId === 'scout') {
    ps.maxHp = 100;
    ps.speedMul = 1.4;
  } else {
    // Övriga perks: passiva (gunner/sharpshooter/strategist/berserker/looter/gambler/medic/builder).
    // Säkerställ default speedMul=1.0 så att eventuell tidigare TANK/SCOUT-värde inte spöker kvar.
    ps.maxHp = ps.maxHp || 100;
    ps.speedMul = 1.0;
  }
}

// === PERK-TRÄD (v3) ========================================================
// cdFlags: returnerar en spelares flagg→rank-map ({} om inga). Alla CD-effekter
// (combat/heal/revive/gold/aura) läser HÄRifrån i st.f. den gamla string-perken.
function cdFlags(sim, pid) {
  return (sim.castledefensePerkFlags && sim.castledefensePerkFlags[pid]) || {};
}

// applyCdTreeStats: idempotent ABSOLUT-stat-applicering från perk-flaggor (kör vid
// köp + respawn). maxHp drivs av 'tank'-rank, speedMul av 'scout'-rank. Behåller hp-andel.
function applyCdTreeStats(sim, ps, pid) {
  if (!ps) return;
  const f = cdFlags(sim, pid);
  const prevMax = ps.maxHp || 100;
  const hpPct = prevMax > 0 ? Math.max(0, Math.min(1, (ps.hp || 0) / prevMax)) : 1;
  ps.maxHp = Math.round(100 * (1 + 0.18 * (f.tank || 0)));
  ps.hp = Math.round(ps.maxHp * hpPct);
  ps.speedMul = 1 + 0.20 * (f.scout || 0);
}

// applyCastleDefensePerkBuy: klient → server köp av en perk-träd-nod. Validerar poäng,
// maxRank, tier-gate (tier N kräver tier N-1 rank>=1 i samma träd) → drar 1 poäng,
// höjer rank + flagga, applicerar stats, broadcastar cd_perk_tree till alla.
function applyCastleDefensePerkBuy(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState) return;
  const nodeId = msg && msg.node;
  if (!nodeId) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'invalid_id' }); return; }
  const arena = CASTLEDEFENSE_ARENA;
  let tree = null, node = null;
  for (const t of (arena.perkTrees || [])) {
    const n = t.nodes.find(nn => nn.id === nodeId);
    if (n) { tree = t; node = n; break; }
  }
  if (!tree || !node) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'invalid_id', node: nodeId }); return; }
  sim.castledefensePerkPoints = sim.castledefensePerkPoints || {};
  sim.castledefensePerkRanks = sim.castledefensePerkRanks || {};
  sim.castledefensePerkFlags = sim.castledefensePerkFlags || {};
  if ((sim.castledefensePerkPoints[peerId] || 0) < 1) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'no_points', node: nodeId }); return; }
  const ranks = sim.castledefensePerkRanks[peerId] = sim.castledefensePerkRanks[peerId] || {};
  const flags = sim.castledefensePerkFlags[peerId] = sim.castledefensePerkFlags[peerId] || {};
  const rank = ranks[nodeId] || 0;
  if (rank >= node.maxRank) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'maxed', node: nodeId }); return; }
  if (Array.isArray(node.requires)) {
    // v3 cross-tree: explicit requires-list -- every id must already have rank>=1 (may span trees); skips tier prereq
    for (let ri = 0; ri < node.requires.length; ri++) {
      if ((ranks[node.requires[ri]] || 0) < 1) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'locked', node: nodeId }); return; }
    }
  } else if (node.tier > 1) {
    const prereq = tree.nodes.find(nn => nn.tier === node.tier - 1);
    if (!prereq || (ranks[prereq.id] || 0) < 1) { sim.eventQueue.push({ type: 'cd_perk_failed', peerId, reason: 'locked', node: nodeId }); return; }
  }
  sim.castledefensePerkPoints[peerId] = (sim.castledefensePerkPoints[peerId] || 0) - 1;
  ranks[nodeId] = rank + 1;
  flags[node.flag] = rank + 1;
  applyCdTreeStats(sim, ws.playerState, peerId);
  sim.eventQueue.push({ type: 'cd_perk_tree', peerId, ranks: { ...ranks }, points: sim.castledefensePerkPoints[peerId] });
}

// v3 perk-ABILITY: warhorn war-roar -- AoE knockback + stagger + slow around the player.
// 60s per-player cooldown (ws._cdAbilityAt). Radius scales with warhorn rank.
function applyCastleDefenseAbility(sim, peerId) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState) return;
  const warhorn = cdFlags(sim, peerId).warhorn || 0;
  if (warhorn < 1) return;
  const now = Date.now();
  if (ws._cdAbilityAt && now - ws._cdAbilityAt < 60000) return;
  ws._cdAbilityAt = now;
  const ps = ws.playerState;
  const radius = 220 + 40 * warhorn;
  const r2 = radius * radius;
  if (sim.enemyGrid && sim.enemyGrid.size > 0) {
    sim.enemyGrid.queryInto(ps.x, ps.y, radius, _cdTurretScratch);
    for (let qi = 0; qi < _cdTurretScratch.length; qi++) {
      const e = _cdTurretScratch[qi];
      if (e.dead) continue;
      const dx = e.x - ps.x, dy = e.y - ps.y;
      if (dx * dx + dy * dy > r2) continue;
      const ang = Math.atan2(dy, dx);
      e.x += Math.cos(ang) * 120;
      e.y += Math.sin(ang) * 120;
      e.staggerUntil = now + 400;
      e.slowUntil = now + 3000;
      e.slowFactor = 0.5;
    }
  } else {
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const dx = e.x - ps.x, dy = e.y - ps.y;
      if (dx * dx + dy * dy > r2) continue;
      const ang = Math.atan2(dy, dx);
      e.x += Math.cos(ang) * 120;
      e.y += Math.sin(ang) * 120;
      e.staggerUntil = now + 400;
      e.slowUntil = now + 3000;
      e.slowFactor = 0.5;
    }
  }
  sim.eventQueue.push({ type: 'cd_war_roar', x: Math.round(ps.x), y: Math.round(ps.y), r: radius });
}

// v1.407: DEBUG infinity-money — ger spelaren 5000 gold per call. Tas bort i prod.
function applyCastleDefenseInfMoney(sim, peerId, msg) {
  if (!sim.castledefenseActive) return;
  // DEV-KONTO-only (86743226) → fungerar i PROD utan ALLOW_CHEATS-env, men låst för alla andra
  if (!isDevAccount(sim.room.members.get(peerId))) return;
  if (!sim.castledefenseGold[peerId]) sim.castledefenseGold[peerId] = 0;
  sim.castledefenseGold[peerId] += 100000;
  sim.eventQueue.push({
    type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: 100000,
  });
}

// v2 REDESIGN: PORT öppna/stäng (bara nära porten). Öppen = passerbar för ALLA
// (fiender kan slinka in); stängd = mur. Påverkar flow-field + kollision direkt.
function applyCastleDefenseGate(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState) return;
  const b = sim.castledefenseBuildings.find(x => x.id === (msg && msg.id) && x.kind === 'gate' && x.hp > 0);
  if (!b) return;
  const px = ws.playerState.x, py = ws.playerState.y, tol = 45;
  if (px < b.x - tol || px > b.x + b.w + tol || py < b.y - tol || py > b.y + b.h + tol) return;
  // anti dubbel-fyr (iOS emul-mus / snabb dubbel-tap toggle:ar open->close = ingen effekt)
  const _ntg = Date.now();
  if (b._lastGateToggle && _ntg - b._lastGateToggle < 250) return;
  b._lastGateToggle = _ntg;
  b.open = !b.open;
  sim._cdFlowDirty = true;
  sim.eventQueue.push({ type: 'cd_gate_toggled', id: b.id, open: b.open });
}

// v2 REDESIGN: SÄTT DIG i ett slot-torn (machinegun/bomber) → dmg-boost (manDpsMul).
function applyCastleDefenseEnterTower(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) return;
  const b = sim.castledefenseBuildings.find(x => x.id === (msg && msg.id) && (x.kind === 'machinegun' || x.kind === 'bomber') && x.hp > 0);
  if (!b) return;
  if (b.occupantId && b.occupantId !== peerId) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = ws.playerState.x - cx, dy = ws.playerState.y - cy;
  if (dx * dx + dy * dy > 80 * 80) return;
  b.occupantId = peerId;
  ws._mountedCdTowerId = b.id;
  ws.playerState.x = cx; ws.playerState.y = cy;
  sim.eventQueue.push({ type: 'cd_tower_entered', id: b.id, peerId, x: Math.round(cx), y: Math.round(cy) });
}

function applyCastleDefenseExitTower(sim, peerId, msg) {
  const ws = sim.room.members.get(peerId);
  const tid = (ws && ws._mountedCdTowerId) || (msg && msg.id);
  if (!tid) return;
  const b = sim.castledefenseBuildings.find(x => x.id === tid);
  if (b && b.occupantId === peerId) b.occupantId = null;
  if (ws) {
    ws._mountedCdTowerId = null;
    if (ws.playerState) ws.playerState.y -= 60; // kliv av INÅT (norr, in i slottet) — slots ligger nu utanför muren
  }
  sim.eventQueue.push({ type: 'cd_tower_exited', id: tid, peerId });
}

// [CD-MOUNT] Tvinga AV ett spelare ur ett bemannat torn (down/dö/revive/respawn/reset).
// Rensar BÅDA flaggorna (b.occupantId + ws._mountedCdTowerId) och säger till klienten att ta
// bort gun-overlayen. Annars blir ett "spök-torn" kvar som fortsätter skjuta från muzzlen
// (skotten force-routas via _mountedCdTowerId, auto-eld suppras via occupantId, rörelse låst).
function cdForceDismount(sim, pid, ws) {
  if (!ws || !ws._mountedCdTowerId) return;
  const tid = ws._mountedCdTowerId;
  const b = sim.castledefenseBuildings && sim.castledefenseBuildings.find(x => x.id === tid);
  if (b && b.occupantId === pid) b.occupantId = null;
  ws._mountedCdTowerId = null;
  sim.eventQueue.push({ type: 'cd_tower_exited', id: tid, peerId: pid });
}

// v2 REDESIGN: uppgradera slotts-spår (throne/heal_npc/repair_npc), 1 nivå el. max.
function applyCastleDefenseNpcUpgrade(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0) return;
  const which = msg && msg.npc;
  const path = (msg && msg.path === 'shield') ? 'shield' : 'hp';   // #heal-tower (default hp)
  const npcs = sim.castledefenseNpcs;
  if (!npcs || !npcs[which]) return;
  const npc = npcs[which];
  const cfg = CASTLEDEFENSE_ARENA.castleUpgrades[which];
  if (!cfg) return;
  const dx = ws.playerState.x - npc.x, dy = ws.playerState.y - npc.y;
  if (dx * dx + dy * dy > 110 * 110) return;
  const maxLevel = CASTLEDEFENSE_ARENA.maxBuildLevel || 10;
  const wantMax = !!(msg && msg.max);
  const diff = cdGetDifficultyPriceMul(sim.config.difficulty);
  const builderMul = Math.max(0, 1 - 0.15 * (cdFlags(sim, peerId).builder || 0));   // v3: arch_cost
  // #heal-tower: heal_npc har tva levlar (levelHp/levelShield); ovriga NPC:er en (level).
  const lk = (which === 'heal_npc') ? (path === 'shield' ? 'levelShield' : 'levelHp') : 'level';
  let did = 0;
  do {
    if ((npc[lk] || 0) >= maxLevel) { if (did === 0) sim.eventQueue.push({ type: 'cd_npc_upgrade_failed', peerId, npc: which, reason: 'max_level' }); break; }
    const cost = Math.max(1, Math.round(cfg.baseCost * Math.pow((npc[lk] || 0) + 1, cfg.costExp || 1.2) * builderMul * diff));
    const gold = sim.castledefenseGold[peerId] || 0;
    if (gold < cost) { if (did === 0) sim.eventQueue.push({ type: 'cd_npc_upgrade_failed', peerId, npc: which, reason: 'insufficient_gold', cost }); break; }
    sim.castledefenseGold[peerId] = gold - cost;
    npc[lk] = (npc[lk] || 0) + 1;
    did++;
    if (which === 'throne' && sim.castledefenseCore) {
      const core = sim.castledefenseCore, add = cfg.hpPerLvl || 1500;
      core.maxHp += add;
      core.hp = Math.min(core.maxHp, core.hp + add);
      sim.eventQueue.push({ type: 'cd_core_damaged', hp: core.hp, maxHp: core.maxHp });
    }
    sim.eventQueue.push({ type: 'cd_npc_upgraded', npc: which, level: npc[lk], path: path, peerId, cost });
    sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -cost });
  } while (wantMax);
}

// VAPENHANDLARE: köp ett vapen för guld (engångs → läggs i arsenalen + auto-equippas).
// Mycket dyrt; pris × difficulty-mul. Anti-fusk-listan (applyShoot) utökas med köpet.
function applyCastleDefenseBuyWeapon(sim, peerId, msg) {
  if (!sim.castledefenseActive || sim.castledefenseEnded) return;
  const ws = sim.room.members.get(peerId);
  if (!ws || !ws.playerState || ws.playerState.hp <= 0 || ws.playerState.cdDowned) return;
  const arena = CASTLEDEFENSE_ARENA;
  const vendor = arena.castleNpcs && arena.castleNpcs.weapon_vendor;
  if (!vendor) return;
  const dx = ws.playerState.x - vendor.x, dy = ws.playerState.y - vendor.y;
  if (dx * dx + dy * dy > 110 * 110) { sim.eventQueue.push({ type: 'cd_buy_weapon_failed', peerId, reason: 'too_far' }); return; }
  const wid = msg && msg.weaponId;
  const spec = wid && arena.weaponVendor && arena.weaponVendor[wid];
  if (!spec) { sim.eventQueue.push({ type: 'cd_buy_weapon_failed', peerId, reason: 'unknown', weaponId: wid }); return; }
  if (!sim.castledefensePurchasedWeapons[peerId]) sim.castledefensePurchasedWeapons[peerId] = new Set();
  if (!spec.grenadeKind && sim.castledefensePurchasedWeapons[peerId].has(wid)) { sim.eventQueue.push({ type: 'cd_buy_weapon_failed', peerId, reason: 'owned', weaponId: wid }); return; }
  const diff = cdGetDifficultyPriceMul(sim.config.difficulty);
  const cost = Math.max(1, Math.round(spec.cost * diff));
  const gold = sim.castledefenseGold[peerId] || 0;
  if (gold < cost) { sim.eventQueue.push({ type: 'cd_buy_weapon_failed', peerId, reason: 'insufficient_gold', weaponId: wid, cost }); return; }
  sim.castledefenseGold[peerId] = gold - cost;
  if (spec.grenadeKind) {
    // GRANAT: konsumerbar, obegransade omkop, inget auto-equip -> oka bara klientens raknare.
    sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -cost });
    sim.eventQueue.push({ type: 'cd_grenade_bought', peerId, grenadeKind: spec.grenadeKind, amount: spec.amount || 1, cost });
    return;
  }
  sim.castledefensePurchasedWeapons[peerId].add(wid);
  ws.playerState.weaponId = wid;   // auto-equip (spegel av cd_weapon_upgraded)
  // gold-update FÖRE bought så klientens game.gold hinner uppdateras innan
  // vapen-shoppen byggs om (annars visar shoppen gammalt guld en frame).
  sim.eventQueue.push({ type: 'cd_gold_update', peerId, gold: sim.castledefenseGold[peerId], delta: -cost });
  sim.eventQueue.push({ type: 'cd_weapon_bought', peerId, weaponId: wid, cost, tier: spec.tier || 1 });
}

module.exports = { createSim, startSim, stopSim, tickSim, applyPlayerInput, applyShoot, applyLoadStage, applyBrDropWeapon, applyBrJump, applyBrBuy, applyBrInfCash, applyBrAirstrike, applyBrUseUav, applyBrUseItem, applyBrAcceptContract, applyBrAbandonContract, tryEnterTurret, exitTurret, tryEnterSiegeTurret, exitSiegeTurret, applyCastleDefenseBuild, applyCastleDefenseRepair, applyCastleDefenseUpgrade, applyCastleDefenseSell, applyCastleDefensePerk, applyCastleDefensePerkBuy, applyCastleDefenseInfMoney, applyCastleDefenseGate, applyCastleDefenseAbility, applyCastleDefenseEnterTower, applyCastleDefenseExitTower, applyCastleDefenseNpcUpgrade, applyCastleDefenseBuyWeapon, applyStresstestShowcase, _heistApplyRole, _heistLineBlockedByWall, pickRandomHumanHunter, transferJug, isDevAccount, ENEMY_CAP };
