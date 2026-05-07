# The Penetrator — Co-op Server

WebSocket relay-server för co-op-läget. Hostar rum, routar meddelanden mellan spelare.

## Kör lokalt (test)

```bash
cd server
npm install
npm start
```

Servern lyssnar på `ws://localhost:8080`. Hälsokontroll: `http://localhost:8080/health`.

---

## ⚡ Optimal deploy för låg latens (Sverige-spelare)

Latens har störst effekt på upplevd lagg. Mål: **så nära Stockholm som möjligt**.

### Bästa: Hetzner Falkenstein eller Helsinki (5–15 ms RTT, ~5 €/mån)
- Skapa CX11-instans på https://www.hetzner.com/cloud (Falkenstein DE eller Helsinki FI)
- `apt install nodejs npm git`, `git clone <repo>`, `cd server && npm install && npm start`
- Använd `pm2` eller `systemd` för auto-restart
- Öppna port 8080 i firewall (eller proxy via nginx på 443 med Let's Encrypt cert)

### Näst bäst: Render Frankfurt (30–50 ms RTT, gratis tier)
1. Skapa konto på https://render.com
2. **New → Web Service → Public Git Repository** (eller koppla GitHub)
3. **Region: Frankfurt** ← VIKTIGT, default är Oregon (USA, ~150ms RTT)
4. Settings:
   - **Name:** `penetrator-coop-eu` (eller vad du vill)
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Klicka **"Deploy Web Service"**, vänta 2–3 min
6. Du får en URL typ `https://penetrator-coop-eu.onrender.com`
7. Sätt URL:en i klienten — i `game.js` runt rad 2839:
   ```js
   const COOP_SERVER_URL = '...' || 'wss://penetrator-coop-eu.onrender.com';
   ```
   (notera `wss://` för secure WebSocket)

### Andra EU-alternativ
- **Fly.io** — `fly launch --region arn` (Stockholm! ~5 ms RTT, gratis tier)
- **Railway.app** — välj EU-West-region
- **Vercel/Netlify** stöder INTE WebSockets — använd inte dessa

---

## ⚡ Always-on (slipp 30s cold-start på Render free)

Render free tier sover efter 15 min inaktivitet. Lösningar:

### Gratis: UptimeRobot pingar /health var 5:e min
1. Skapa konto på https://uptimerobot.com (gratis)
2. **Add New Monitor → HTTP(s)**
3. URL: `https://din-render-url.onrender.com/health`
4. Monitoring Interval: **5 minutes**
5. Klart — servern hålls vaken så länge UptimeRobot pingar

### Betald: Render Starter ($7/mån)
- Always-on, snabbare CPU, ingen cold-start

---

## API (för utveckling)

WebSocket-meddelanden:

### JSON kontroll-plane (host/join/lobby/event/etc)

#### Klient → Server
```json
{ "type": "host" }
{ "type": "join", "code": "ABCD" }
{ "type": "relay", "to": "<peerId>", "data": {...} }
{ "type": "relay", "data": {...} }
{ "type": "leave" }
```

#### Server → Klient
```json
{ "type": "hosted", "code": "ABCD", "peerId": "..." }
{ "type": "joined", "peerId": "...", "hostId": "..." }
{ "type": "peer_joined", "peerId": "..." }
{ "type": "peer_left", "peerId": "..." }
{ "type": "host_left" }
{ "type": "relay", "from": "...", "data": {...} }
{ "type": "error", "error": "..." }
```

### Binär data-plane (high-frequency world packets)

För world-snapshots (15-20 Hz) använder klienten **binära WebSocket-frames**
istället för JSON för att minska bandbredd 3-5×. Format:

```
[u8 routeByte][u8 idLen][idBytes...][payload...]
```

- `routeByte = 0` → broadcast till alla i rummet (utom avsändaren)
- `routeByte = 1` → directed till peer med id `idBytes`
- Server prepend:ar avsändarens id på utgående frame:
  ```
  [u8 fromIdLen][fromIdBytes...][payload...]
  ```

Payload är opaque för servern — det är klient-till-klient binärt format.
