# WarParty — Ägarhandbok (backend/drift)

*Uppdaterad 2026-07-07. Detta är driftdokumentet för dig som äger spelet: var allt bor,
hur du övervakar, modererar, justerar och räddar. Klientfrågor (Godot/TestFlight) ligger
utanför — se minnes-/projektanteckningarna för dem.*

---

## 1. Arkitektur på en minut

- **En Node-process per region** kör ALLT: HTTP (health/admin/OAuth), WebSocket + UDP-transport,
  matchmaking, konton och varje matchrum som en 60 Hz-sim på **en delad event-loop**
  (ett långsamt rum bromsar alla — därför finns loop-lag-mätaren).
- **Klienten** (Godot/iOS) pratar UDP med binärt world-protokoll (JSON för events);
  WebSocket är fallback. Klient-build gate:as via `MIN_SUPPORTED_BUILD` (se §7).
- **Regioner** (konton är region-lokala — en spelare på US är ett separat konto!):

| Region | App | URL | Läge |
|---|---|---|---|
| EU (primär) | `warparty-eu` | https://warparty-eu.fly.dev | Alltid på (Stockholm/arn), persistent volym `wp_data` → `/data` |
| USA | `warparty-us` | https://warparty-us.fly.dev | Auto-stop (≈ $0 oanvänd), cold-start ~5-15 s |
| Asien | `warparty-asia` | https://warparty-asia.fly.dev | Auto-stop, som USA |

---

## 2. Deploy, rollback, loggar

- **Deploy = `git push` till `main`** i detta repo (workflow `.github/workflows/fly-deploy.yml`,
  matrix över alla tre regionerna, triggas av ändringar i `server/` eller `shared/`).
  Följ: `gh run list --workflow=fly-deploy.yml` → alla tre jobben gröna.
- **Verifiera deploy via BETEENDE, inte versionssträngen** (den glöms ofta):
  `curl "https://warparty-eu.fly.dev/health?verbose=1"` — svarar JSON = nya koden;
  `uptimeSec` liten = nyss omstartad.
- **Rollback:** `git revert <commit>` + push (rent) — eller akut:
  `flyctl releases -a warparty-eu` → `flyctl deploy --image <förra imagen> -a warparty-eu`.
- **Loggar:** `flyctl logs -a warparty-eu` (live) / `--no-tail` (senaste).
  flyctl ligger i `C:\Users\alekj\.fly\bin\flyctl.exe`, inloggad.
- **SSH in i maskinen:** `flyctl ssh console -a warparty-eu` (t.ex. `ls /data`).

---

## 3. Övervakning — vad du tittar på och när

### 3.1 `GET /health` (publik, text)
Snabbkoll: version, uptime, antal rum, antal loggade klientfel.

### 3.2 `GET /health?verbose=1` (publik, JSON) — huvudverktyget
| Fält | Betyder | Reagera när |
|---|---|---|
| `rooms[]` | per rum: `mode, members, started, tickAvg, tickMax, enemies, bullets` | `tickAvg > 8 ms` ihållande eller `tickMax > 50 ms` (= [SLOW-TICK]-territorium) |
| `simMsPerSec` | summerad sim-CPU ms/s över alla rum | närmar sig ~60+ på shared-cpu-1x = kvot-tak; överväg större maskin |
| `loopLag.emaMs/maxMs` | event-loop-fördröjning (GC, save-stalls, CPU-strypning — det [SLOW-TICK] INTE ser) | ema > 20 ms eller max > 100 ms |
| `memoryMB` | heap/RSS | heapUsed som kryper mot 320 (NODE_OPTIONS-taket i Dockerfile) |
| `errorsLogged` | klient-rapporterade fel (ringbuffer 100) | plötsligt hopp efter release |

Samma data visas i **admin-panelens SERVERSTATUS-kort** (auto-uppdatering var 15 s).

### 3.3 Server-loggen
- `[SLOW-TICK] <rumskod> <ms> ...` — tick > 50 ms, throttlad 1/2 s per rum.
- `[ACCT] ...` — kontohändelser (migrering, block, städning).
- In-game debug-overlayen (inställning i klienten) visar per-rums tickAvg/tickMax live.

---

## 4. Admin-panelen

- **URL:** `https://warparty-eu.fly.dev/admin` (motsvarande för us/asia — separata konton per region!).
- **Inloggning:** fly-secreten `ADMIN_TOKEN` (`flyctl secrets list -a warparty-eu`;
  byt med `flyctl secrets set ADMIN_TOKEN=... -a warparty-eu`). Skickas som header,
  aldrig i URL. Brute-force-throttlad per IP.
- **Sektioner:**
  - **SERVERSTATUS** — live-rum/tick/minne/loop-lag (rött = över tröskel).
  - **RAPPORTER** — moderations-kön från spelarnas RAPPORTERA-knapp:
    när/rapportör/mål/orsak/läge + "Öppna mål" som hoppar till spelarkortet.
  - **Spelarlista** — sök/sortera; per spelare: **banna/avbanna, justera coins/gems/nivå,
    tvångs-byta namn, radera konto**. Flaggade namn filtrerbara (⚠).

### API-endpoints (alla utom /admin kräver `x-admin-token`-headern)
```
GET  /admin                      panelen (HTML)
GET  /admin/api/players?q=       spelarlista + stats
GET  /admin/api/reports?limit=   moderations-kön (nyaste först)
POST /admin/api/ban              {id, banned:true|false}
POST /admin/api/economy          {id, coins?, gems?, alevel?}   (server-auktoritativt, pushas live)
POST /admin/api/rename           {id, name}                     (nameForce — spelaren kan inte byta tillbaka gratis)
POST /admin/api/delete           {id}                           (som spelarens egen radering)
GET  /admin/api/ghosts           lista tomma gästkonton
POST /admin/api/ghosts/purge     {apply:true}                   (körs numera auto var 24:e h)
```
Exempel: `curl -H "x-admin-token: $TOK" "https://warparty-eu.fly.dev/admin/api/reports?limit=20"`

---

## 5. Moderation — hela kedjan

1. **Spelare rapporterar** (profil-popupen): orsak fusk/kränkande namn/trakasserier/annat →
   `reports.json` på volymen (ringbuffer 2000, rate-limit 5/10 min per konto).
2. **Du läser kön** i panelen → "Öppna mål" → banna/tvångs-döp/justera på spelarkortet.
3. **Spelare blockerar själva** (upp till 200/konto): blockade kan inte skicka vänförfrågningar
   eller invites till blockeraren (döljs tyst — blocken avslöjas aldrig).
4. **Automatiska skydd som redan står på:** namn-filter på kontonamn OCH på in-game-relayn
   (slur → "Player", clamp 20/24 tecken), relay-rate-limit 6 msg/s + 2 KB-cap,
   konto-skapande max 5/10 min/IP, klient-side visnings-cooldown för emote/vcmd-spam.

---

## 6. Kontodata på volymen (`/data` på EU)

```
/data/accounts/<id>.json            ett konto per fil (atomiska skrivningar, bara ändrade sparas)
/data/accounts.json.pre-split-backup  monolit-backupen från migreringen 2026-07-07 — RADERA ALDRIG
/data/reports.json                  moderations-kön
```
- **Retention:** konton lever tills de raderas (spelaren i appen, eller du via panelen).
  Helt orörda gästkonton (aldrig kopplade, noll progress/vänner/valuta) auto-rensas dagligen.
- **KATASTROF-ÅTERSTÄLLNING** (om kontodata skulle bli korrupt):
  1. `flyctl ssh console -a warparty-eu`
  2. `mv /data/accounts /data/accounts.broken`
  3. `cp /data/accounts.json.pre-split-backup /data/accounts.json`
  4. Starta om (`flyctl apps restart warparty-eu`) — loadern migrerar om från monoliten.
  *(Obs: backupen är från migreringsögonblicket — konton skapade därefter finns bara i
  per-konto-filerna. Plocka i så fall enskilda filer ur `accounts.broken`.)*
- En trasig kontofil stoppar ALDRIG boot (loggas + hoppas över).

---

## 7. Rattarna: miljövariabler (fly secrets / env)

| Variabel | Default | Vad den gör |
|---|---|---|
| `ADMIN_TOKEN` | — (krävs) | Admin-panelens nyckel |
| `MIN_SUPPORTED_BUILD` | `0` (av) | Tvinga app-uppdatering: klienter med lägre build får "UPPDATERA"-panel vid host/join. Klientens build: `CLIENT_BUILD` i `Net.gd` (nu 200) — bumpas per release |
| `ACCT_CREATE_MAX_PER_10MIN` | `5` | Nya konton per IP per 10 min |
| `SIM_TICK_HZ` | `60` | Sim-takt per rum (nödventil vid CPU-tryck: 45) |
| `SIM_BROADCAST_HZ` | `60` | World-broadcast-takt |
| `SIM_ENEMY_BUDGET` | `64` | Max fiende-deltan per world-paket |
| `SIM_DEBUG` | av | Extra sim-loggar |
| `SERVERAUTH_XP` / `_MODES` | `all` (live) | Server-ägd match-XP |
| `NONMATCH_XP_MAX` | `800` | Anti-fusk-tak för icke-match-XP |
| `ALLOW_CHEATS`, `DEV_ACCOUNT_IDS` | av / dev-id 86743226 | Dev-lägen — ALDRIG i prod utom ditt id |
| `GOOGLE_*`, `APPLE_*` | satta | OAuth/Sign-in-koppling |
| `UDP_PORT`/`UDP_BIND`, `PORT` | = PORT / 8080 | Transport-bind |
| `ACCOUNTS_DATA_DIR` | `/data` (fly.toml) | Volym-sökvägen |
| `NODE_OPTIONS` | `--max-old-space-size=320` (Dockerfile) | Heap-tak på 512 MB-maskinen |

---

## 8. Runbook — vanliga situationer

- **"Alla laggar i alla lägen"** → `/health?verbose=1`: högt `loopLag` men låga tickAvg =
  något utanför simmarna (GC/IO/CPU-strypning) → `flyctl logs`; högt `tickAvg` i ETT rum =
  det rummet drar ner alla → kolla mode/enemies/bullets i tabellen.
- **"Servern svarar inte"** → `flyctl status -a warparty-eu` (health-checks), `flyctl logs`;
  värsta fall `flyctl apps restart warparty-eu` (spelare får reconnect-flödet, rum går förlorade).
- **Fuskare/griefer** → panelen: RAPPORTER → Öppna mål → Banna. Ekonomi-exploat →
  justera coins/gems på kortet (pushas live även om spelaren är online).
- **Tvinga app-uppdatering** (efter protokolländring) →
  `flyctl secrets set MIN_SUPPORTED_BUILD=<n> -a warparty-eu` (+ us/asia). Sätt `n` =
  första kompatibla `CLIENT_BUILD`. Gamla klienter får en tydlig panel i stället för buggar.
- **Kostnadskoll** → EU alltid-på shared-cpu-1x ≈ $3–4/mån + volym; US/Asia ≈ $0 vid inaktivitet.
  Om `simMsPerSec` ofta > ~60: `flyctl scale vm shared-cpu-2x -a warparty-eu`.
- **Innan stora releaser** → kör CD-testsviten lokalt
  (`node server/test-castledefense-*.js` — v2/revive har kända pre-existerande timing-fel,
  övriga fem ska vara PASSED) + en lokal boot + `/health?verbose=1`-koll.

---

## 9. Vad som INTE är byggt än (medvetet)

- **StoreKit/riktiga köp** — kr-flödena visar "kommer snart"; kvittovalidering + restore
  är kvar på lanserings-checklistan, liksom hårdare anti-fusk på kontonivå före IAP.
- **Larm/notiser** — övervakningen är pull (panel/health). Vill du ha push-larm vid
  loop-lag/OOM är det en liten framtida byggsten (t.ex. fly checks → webhook).
- **Rapporter är append-only** — ingen "hanterad"-markering i kön än; bannlysningen syns
  dock direkt på spelarkortet.
