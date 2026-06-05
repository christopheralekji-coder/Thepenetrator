# WarParty → iPhone-app via TestFlight (utan Mac)

Det här gör spelet till en **riktig iPhone-app** du installerar via **TestFlight**.
Bygget sker i molnet (GitHub:s Mac-server) — du behöver **ingen egen Mac**.

Appens namn: **WarParty** · Bundle-ID: **com.warparty.game**
(Vill du byta bundle-ID: ändra i `capacitor.config.json` + `.github/workflows/ios-testflight.yml` + `fastlane/Fastfile`. Gör det FÖRE första uppladdningen — det kan inte ändras sen.)

---

## DIN del — en gång (~30 min + Apples godkännande 0–2 dygn)

### 1. Skaffa Apple Developer-konto ($99/år)
- Gå till **developer.apple.com** → **Account** → logga in med ditt Apple-ID
- **Enroll** i Apple Developer Program ($99/år, kort + ID-verifiering)
- Vänta tills det står "Active" (kan ta upp till 1–2 dygn)

### 2. Skapa appens Bundle-ID
- developer.apple.com → **Certificates, IDs & Profiles** → **Identifiers** → **+**
- Välj **App IDs** → **App** → Description: `WarParty`, Bundle ID (explicit): `com.warparty.game`
- Spara

### 3. Skapa appen i App Store Connect
- Gå till **appstoreconnect.apple.com** → **Apps** → **+** → **New App**
- Platform: iOS · Namn: `WarParty` · Bundle ID: välj `com.warparty.game` · SKU: `warparty`
- Skapa (du behöver INTE fylla i butiks-info nu — bara skapa appen)

### 4. Skapa en API-nyckel (så molnet får ladda upp åt dig)
- App Store Connect → **Users and Access** → fliken **Integrations** (eller "Keys") → **App Store Connect API**
- **+** → Namn: `CI` · Access: **App Manager** → Generate
- **Ladda ner .p8-filen** (går bara EN gång — spara den)
- Notera **Key ID** (vid nyckeln) och **Issuer ID** (högst upp på sidan)

### 5. Lägg in 3 hemligheter i GitHub
GitHub-repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Skapa tre:

| Namn | Värde |
|------|-------|
| `ASC_KEY_ID` | Key ID från steg 4 |
| `ASC_ISSUER_ID` | Issuer ID från steg 4 |
| `ASC_KEY_P8` | .p8-filens innehåll **base64-kodat** (se nedan) |

**Base64-koda .p8:** kör i en terminal (eller be mig):
- Mac/Linux: `base64 -i AuthKey_XXXX.p8 | pbcopy`
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard`
Klistra in resultatet som `ASC_KEY_P8`.

### 6. Kör bygget
- GitHub-repo → fliken **Actions** → **iOS → TestFlight** → **Run workflow**
- Det bygger på en moln-Mac (~10–15 min) och laddar upp till TestFlight

### 7. Installera på din iPhone
- App Store → ladda ner **TestFlight** (gratis, från Apple)
- I App Store Connect → din app → **TestFlight** → lägg till dig själv (+ vänner) som testare
- Du får en inbjudan → öppna i TestFlight → **Installera** → spela!

---

## MIN del (redan klar)
- ✅ Capacitor-skal runt webb-spelet (`capacitor.config.json`, `package.json`)
- ✅ `www/`-bygge (`scripts/build-www.mjs`) — paketerar klient-filerna
- ✅ App-ikon + splash (`resources/icon.png`, `resources/splash.png`)
- ✅ Moln-bygge + TestFlight-upload (`.github/workflows/ios-testflight.yml`, `fastlane/Fastfile`)

## Efter första bygget — dagligt flöde
`git push` → kör workflowen (eller automatisera) → nytt TestFlight-bygge → uppdatering på telefonen.
(Senare kan vi lägga **Capgo OTA** så att JS-ändringar når telefonen på minuter utan nytt TestFlight-bygge — webb-versionen på Pages fortsätter funka parallellt hela tiden.)

## Ärlig brasklapp
iOS-signering i CI är ökänt pilligt. Första körningen kan behöva 1–2 justeringsrundor
(certifikat/profil-detaljer). Det är normalt — skicka mig fel-loggen från Actions så fixar jag.
