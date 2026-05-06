# The Penetrator — Co-op Server

WebSocket relay-server för co-op-läget. Hostar rum, routar meddelanden mellan spelare.

## Kör lokalt (test)

```bash
cd server
npm install
npm start
```

Servern lyssnar på `ws://localhost:8080`. Hälsokontroll: `http://localhost:8080/health`.

## Deploy på Render.com (gratis)

1. **Skapa konto** på https://render.com (Google/GitHub-login)
2. Klicka **"New" → "Web Service"**
3. Välj **"Public Git Repository"**, klistra in din GitHub-repo-URL
   *(eller välj "Build and deploy from a Git repository" om du har repot förbunden)*
4. Settings:
   - **Name:** `penetrator-coop` (eller vad du vill)
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Klicka **"Deploy Web Service"**
6. Vänta 2-3 min, du får URL typ `https://penetrator-coop.onrender.com`
7. Sätt URL:en i klienten (se under)

## Sätt server-URL i klienten

I `game.js`, ändra `COOP_SERVER_URL`:

```js
const COOP_SERVER_URL = 'wss://penetrator-coop.onrender.com';
```

(notera `wss://` för secure WebSocket — Render använder HTTPS)

## Render Free Tier — viktigt att veta

- **Sover efter 15 min inaktivitet** — första anslutning väcker den (15-30 sek wake-up)
- **Cold-start:** First connect kan ta 30 sek att koppla upp
- För **always-on**: $7/månad (Render) eller använd UptimeRobot för att pinga `/health` var 14:e min

## Alternativ deploy

- **Fly.io** — `fly launch` (gratis tier)
- **Railway.app** — Connect GitHub repo
- **Glitch.com** — Importera från GitHub
- **Egen VPS** — `node server.js` på vilken Linux-server som helst

## API (för utveckling)

WebSocket-meddelanden:

### Klient → Server

```json
{ "type": "host" }                    // Skapa rum
{ "type": "join", "code": "ABCD" }    // Joina rum
{ "type": "relay", "to": "<peerId>", "data": {...} }  // Skicka meddelande
{ "type": "leave" }                   // Lämna rum
```

### Server → Klient

```json
{ "type": "hosted", "code": "ABCD", "peerId": "..." }
{ "type": "joined", "peerId": "...", "hostId": "..." }
{ "type": "peer_joined", "peerId": "..." }
{ "type": "peer_left", "peerId": "..." }
{ "type": "host_left" }
{ "type": "relay", "from": "...", "data": {...} }
{ "type": "error", "error": "..." }
```
