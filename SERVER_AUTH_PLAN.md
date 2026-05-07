# SERVER-AUTHORITATIVE MIGRATION PLAN — The Penetrator

## Översikt

Phase 1 är levererad: `server/sim/{wirefmt.js, enemies.js, room-sim.js}` kör en minimal grunt-AI bakom en `sim_start` opt-in. Klienten har INTE än någon kod-väg som skickar `sim_start` eller skippar den lokala host-simmen. Den delen införs successivt i Phase 7.

Den fulla simmen i `game.js` består av ca 14 357 rader. Sim-relaterade funktioner är ~1 500 rader sammanlagt + ~600 rader stage/layout-data + ~200 rader weapons/enemy-stats. Hela porten är realistisk på 4–6 fysiska faser à ~3–6 timmar (i praktiken 4 + integrations-fasen + lansering = 6).

Filer som påverkas:
- `game.js` — klient (befintlig)
- `server/server.js` — message-routing, sim-lifecycle
- `server/sim/room-sim.js` — tick-loop, world-broadcast
- `server/sim/enemies.js` — enemy-AI för alla typer
- `server/sim/wirefmt.js` — wire-protokoll
- NYA: `server/sim/{bullets.js, bosses.js, waves.js, pickups.js, hazards.js, world.js}`
- NYA shared: `shared/{weapons-data.js, enemy-stats.js, stages-data.js, boss-configs.js}`

---

## 1. Inventering av sim-funktioner i `game.js`

### Player-sim
| Funktion | Rader | Beroenden | Anteckning |
|---|---|---|---|
| `tryDash` | 2247–2266 | triggerVibrate, state.player, input | Klient-input — body skickas som event |
| `makePlayer` | 2268–2313 | save.upgrades, STAGES[0], W_BY_ID, hasPerk | Init-only |
| `updatePlayer` | 7162–7251 | input (klient!), Coop, save, WORLD, Audio | **Hybrid** — rörelse klient, server kör reload/regen/invuln |
| `tryShoot`, `spawnPlayerBullets` | 4889–5070 | state.bullets, Coop.broadcastShots, Audio | Server måste autoritativt spawna med RNG-spread |

### Enemy-sim
| Funktion | Rader | Beroenden | Anteckning |
|---|---|---|---|
| `makeEnemy` | 2315–2351 | Pure data | Flytta till shared/enemy-stats.js |
| `makeBoss` | 2353–2373 | getCoopMultiplier, getBossConfig | Pure data |
| `updateEnemies` | 7253–7491 | state.enemies/bullets/particles, Coop, stageState | **Root** — switch på e.type, ~10 sub-AI:er + status-effekter |
| `damageEnemy` | 5073–5116 | spawnDamageNumber, triggerHitStop/Shake, Audio | Server tar damage+kill, klient renderar damage-numbers |
| `killEnemy` | 5147–5296 | showToast, Achievements, Coop, save, Audio, Music, spawnPickup | **Root** — många UI-bivärkan |

### Boss-AI (10 typer, alla i `game.js`:7493–7827)
| Funktion | Rader | Anteckning |
|---|---|---|
| `updateBoss` | 7493–7536 | Dispatch till AI-funktion |
| `aiCaster` | 7554–7578 | Phase 2 cast + summon runners |
| `aiTankCharger` | 7581–7595 | Charge-rörelse |
| `aiCloaker` | 7598–7628 | **RISK**: använder setTimeout — server måste konvertera till tick-baserad burst-kö |
| `aiBruteCharger` | 7631–7651 | Charge + spread |
| `aiPlasma` | 7654–7674 | Dash + skott |
| `aiJetpack` | 7677–7699 | Hazard-trail |
| `aiGasSniper` | 7702–7731 | Sniper-burst + gas |
| `aiShielder` | 7734–7754 | Shield-charge |
| `aiAvatar` | 7757–7786 | Teleport + summon |
| `aiFinal` | 7789–7827 | 3 faser + spread + charge |

### Wave/Spawn-system
| Funktion | Rader | Anteckning |
|---|---|---|
| `loadStage` | 5644–5729 | **Root** — stage-init, hybrid (server enemy-init, klient HUD/Music) |
| `spawnBoss` | 5747–5760 | Init + Audio.bossSpawn |
| `spawnEnemyAtEdge` | 5792–5838 | RNG-bias mot goal-sidan, behöver buildings |
| `spawnMiniBoss` | 5850–5875 | Init |
| `updateZoneProgression` | 5877–5934 | **Root** — drives wave-flow |
| `onWaveComplete` | 5936–6001 | Hybrid — server beslutar, klient öppnar shop |

### Bullets / Hazards / Pickups
| Funktion | Rader | Anteckning |
|---|---|---|
| `updateBullets` | 7870–8010 | **Root** — collision-loop, bouncing, blackhole, pull-whip, boomerang |
| `applyBulletEffects` | 7829–7868 | Status: burn/slow/chain/knockback |
| `explode` | 5435–5458 | Radius-damage |
| `damagePlayer` | 5460–5502 | Hybrid — server validerar, klient gör shake/audio |
| `enterDeathState` | 5505–5532 | Server beslutar |
| `updatePickups` | 974–1033 | Magnet + collect, multi-target |
| `updateHazards` | 8059–8098 | Gas/flame DoT-zoner |

### World/Layout (deterministisk via `rngFor`)
| Funktion | Rader | Anteckning |
|---|---|---|
| `buildStageLayout` | 8187–8222 | Bygger stageState (buildings/decorations/hazards/collectibles) |
| `layoutForest..layoutCommand` | 8358–9028 | 9 layout-funktioner, alla deterministiska |
| `rngFor` | 8182–8186 | Seedad PRNG — guld: server kan generera identiskt med klient |
| `isInsideAnyBuilding` | 9031–9043 | Pure |
| `resolveBuildingCollision` | 9045–9074 | Pure |

---

## 2. Beroende-graf

**Bladfunktioner** (kan portas isolerat):
- `makeEnemy`, `makeBoss`, `getBossConfig`, `getBossEntrance`
- `getDiffMul`, `getNGPMul`, `getCoopMultiplier`, `rngFor`
- `placementOk`, `isInsideAnyBuilding`, `resolveBuildingCollision`
- `bossShoot`, `dropGasCloud`, `spawnPickup`
- `aiTankCharger`, `aiBruteCharger`, `aiPlasma`, `aiShielder`

**Mellan-noder**:
- `damageEnemy` → `killEnemy`
- `aiCaster/Avatar/Final` → `makeEnemy` (summon)
- `aiCloaker` → `bossShoot` med setTimeout (**kräver burst-kö**)
- `updateBoss` → 10 ai*-funktioner
- `spawnEnemyAtEdge` → `makeEnemy` + scaling-helpers + `isInsideAnyBuilding`

**Root-noder**:
- `updateEnemies` — anropar updateBoss + alla typ-AI:er
- `updateBullets` — full collision-graf
- `killEnemy` — drops + achievements + boss-cinematic
- `loadStage` — hela stage-init
- `onWaveComplete` — slut-of-stage flow

---

## 3. Faseplanering

### Phase 2 — Alla enemy-typer (~5h)
**Mål**: server kör 14 enemy-typer (grunt, runner, brute, shooter, ninja, swordsman, soldier, robot, dog, healer, summoner, bomber, sniper, swarmer) inkl status-effekter (burn DoT, slow, mind-control) + stagger.

**Filer**:
- `server/sim/enemies.js` — utöka ENEMY_STATS, dispatcher i updateEnemy + status-effekt-update (game.js:7297–7314)
- `server/sim/room-sim.js` — `state.bullets[]` så shooter/soldier/sniper kan spawna fientliga skott
- `shared/enemy-stats.js` — NY: extrahera ENEMY_STATS-tabell

**Klar vid**: identiska rörelsemönster för alla 14 typer i jämförelse. Healer helar närmaste skadade. Summoner spawnar runners. Sniper laddar 800ms innan skott.

**Risker**:
- Healer + summoner kan skapa många enemies → cap 80
- Mind-control kräver peerId-attribution

**Test**:
- Two-peer integration test
- A/B host-mode vs server-mode 60s
- Unit-test för burn(4dps) över 1s

---

### Phase 3 — Bullet-trafik + collision (~5h)
**Mål**: server auktoritativ över alla bullets. Klient skickar bara "shoot intent".

**Filer**:
- `server/sim/bullets.js` — NY: updateBullets, applyBulletEffects, explode, bouncing, blackhole, pull-whip, boomerang, time-stop
- `server/sim/world.js` — NY: isInsideAnyBuilding, resolveBuildingCollision, placementOk
- `server/server.js` — `sim_shoot`-handler: { weaponId, x, y, ang, crit, perks }
- `shared/weapons-data.js` — NY: WEAPONS + W_BY_ID

**Klar vid**: klient skickar sim_shoot → server spawnar + collision + damage + status. Boss-bullets fungerar.

**Risker**:
- RNG-spread: server kör egen → kan inte fuskas av klient
- 100+ bullets/s med minigun + multi-pellet
- Pierce/explosive/chain/blackhole — 6+ post-hit-beteenden
- Decoration-collision kräver Phase 5 layout

**Test**:
- Skjut grunt → damage-respons
- Tesla chain: 3 närmaste tar damage
- Lag-test 200ms artificial: ghost-bullets på klient

**Klient**: när server-sim aktiv, tryShoot skickar sim_shoot, lokal "ghost"-bullet rensas vid server-confirm

---

### Phase 4 — Boss-AI + waves + stage-flow (~6h)
**Mål**: 10 boss-AI:er + spawn-flow + wave-progression.

**Filer**:
- `server/sim/bosses.js` — NY: 10 AI-funktioner. **aiCloaker setTimeout → burst-kö** (b.burstQueue)
- `server/sim/waves.js` — NY: loadStage, startZone, spawnBoss/MiniBoss/EnemyAtEdge, updateZoneProgression, onWaveComplete (server-sidan, ingen UI)
- `shared/boss-configs.js` — NY
- `shared/stages-data.js` — NY: STAGES, getDiffMul, getNGPMul, getCoopMultiplier
- `server/sim/hazards.js` — NY: gas/flame DoT
- `server/server.js` — `sim_load_stage`-handler: { wave, mode, difficulty, ngpLevel, dailyMod }

**Klar vid**:
- Solo + sim_start: stage 1 → boss-död → event "stage_complete" → klient öppnar shop → next stage
- Alla 10 bossar testkörda
- Stage 9 (två-boss-sekvens) fungerar

**Risker**:
- setTimeout-konvertering (cloaker, boss-death cinematic)
- Daily/endless modifiers från klient
- Achievements: server kan inte skriva save → broadcasta events, klient uppdaterar

**Test**:
- Stage 1 från start till boss-död
- Cloaker-boss: 5 burst-skott över 400ms
- Final-boss fas-skift triggar shockwave

---

### Phase 5 — Pickups + hazards + decorations (~3h)
**Mål**: server kör pickup-magnet, gas-cloud DoT, fire-trail DoT, decoration-explosions.

**Filer**:
- `server/sim/pickups.js` — NY: spawnPickup, updatePickups med multi-spelare-magnet
- `server/sim/hazards.js` — komplettera (gasClouds, flameTrails, decoration fuel_drum/fire_barrel)
- `server/sim/world.js` — stage-decorations från buildStageLayout

**Klar vid**: pickup-magnet, gas-DoT, decoration-explosions fungerar.

**Risker**:
- Magnet-multiplayer: server måste se båda spelare
- Pickup-effekter (temp_dmg → tempDmgUntil) synk via player-paket

**Klient**: `updatePickups` skippas helt

---

### Phase 6 — Damage-validering, weapons, status, truck, companion (~5h)
**Mål**: stäng "klient-fusk"-vägar. Truck + companion server-side.

**Filer**:
- `server/sim/bullets.js` — komplettera weapon-effekter (alla 30+ vapen)
- `server/sim/truck.js` — NY: setupTruck, updateTruck, mount-system server-validerat
- `server/sim/companion.js` — NY (valfri)
- player-stats: skickas vid sim_start (weapons + masteries + perks + cheats)

**Klar vid**:
- Klient kan inte spam-spoofa damage
- Status burn/slow/mindcontrol bug-fri
- Truck-mode full-cycle co-op

**Risker**:
- Save-data integration: weapon-level/mastery → playerStats-payload
- Truck-mount-konflikt: server resolverar
- Cheats: skickas i sim_start-payload

---

### Phase 7 — Klient-integration (opt-in flow) (~4h)
**Mål**: lobby-toggle "Server-side sim (beta)". Klient skippar lokal sim när aktiv.

**Filer**:
- `game.js:runFrame` — gren `if (Coop.active && state.serverSimActive) skip(updateEnemies, updateBullets, updatePickups, ...)`
- `game.js:Coop` — sim_started/sim_stopped-handlers
- `game.js:tryShoot` — när serverSim, skicka sim_shoot, ghost-bullet lokalt
- `game.js` lobby UI — toggle "Server-side sim (beta)"
- `server/server.js` — sim_input med playerState

**Klar vid**: lobby-toggle fungerar. Solo + co-op gameplay end-to-end. Alla 9 stages.

**Risker**:
- Client-side prediction: utan, känns laggig vid >50ms RTT
- Save-data sync: events ("kill", "boss_kill") → klient uppdaterar save
- Disconnection mid-stage: server fortsätter, klient reconnectar

---

### Phase 8 — Polering, lansering, testning (~4h)
- Telemetri: tick-tid, perf, memory leak-test 30min
- Edge-cases: host-leave med sim aktiv
- Wire-protokoll-bump om utökat (WP_MAGIC = 0xA4)
- Dokumentation
- Feature-flag på i prod, default off, gradvis aktivering

---

## 4. Shared moduler (struktur)

```
shared/
  weapons-data.js       # WEAPONS, W_BY_ID, weaponCategory()
  enemy-stats.js        # ENEMY_STATS, makeEnemy() (pure)
  stages-data.js        # STAGES + getStage/DiffMul/NGPMul
  boss-configs.js       # BOSS_CONFIGS, getBossConfig/Entrance
  prng.js               # rngFor(stage, salt)
```

**Loading-pattern (UMD)**:
```js
(function(g) {
  const def = { WEAPONS: [...], W_BY_ID: {...} };
  if (typeof module === 'object' && module.exports) module.exports = def;
  else { Object.assign(g, def); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- Server: `const { WEAPONS } = require('../../shared/weapons-data.js')`
- Klient: `<script src="shared/weapons-data.js"></script>` före `game.js`

---

## 5. Klient-ändringar per fas

| Fas | Klient-ändring |
|---|---|
| 2 | Inga (testa via devtools) |
| 3 | tryShoot skickar sim_shoot + ghost-bullet |
| 4 | runFrame skippar updateEnemies/Zone, lyssnar på event-meddelanden |
| 5 | updatePickups/Hazards skippas |
| 6 | updateTruck skippas, sim_mount_req för turret-claim |
| 7 | Lobby-toggle, full feature-flag, player-prediction, save-event-handlers |
| 8 | Telemetri, fallback |

---

## 6. Risker

**Hög**:
- Cloaker-boss-burst (setTimeout × 5) → burst-kö-port
- Bullet-collision-perf vid 8 spelare × minigun + chain → server-tick <33ms
- Save-state-divergens i Phase 7

**Medel**:
- Tick-rate-känslig boss-AI (jetpack drop-trail)
- RNG-driven spawn (acceptera server är truth)
- Layout-determinism (rngFor — verifiera tidigt i Phase 4)

**Låg**:
- Pickup-magnet
- Enemy-typ-AI

---

## 7. Tidsuppskattning

| Fas | Timmar |
|---|---|
| Phase 2 — alla enemy-typer | 5 |
| Phase 3 — bullets + collision | 5 |
| Phase 4 — bossar + waves + stages | 6 |
| Phase 5 — pickups + hazards | 3 |
| Phase 6 — damage + truck + companion | 5 |
| Phase 7 — klient-integration | 4 |
| Phase 8 — polering + lansering | 4 |
| **Totalt** | **32h** |

Kritisk path: Phase 2 → 3 → 4 → 7. Phase 5–6 kan flätas in parallellt.

---

## Status

**Phase 1 KLART** (denna session):
- ✅ `server/sim/wirefmt.js` — binär encoder
- ✅ `server/sim/enemies.js` — ENEMY_STATS + grunt-AI
- ✅ `server/sim/room-sim.js` — tick-loop 30Hz, broadcast
- ✅ `server/server.js` — sim_start/sim_stop/sim_input handlers
- ✅ Integration-test: server-sim startar, broadcastar binära world-paket, klient tar emot
- ⏸ Klient saknar fortfarande sim_start-koppling (Phase 7)
