// Service Worker — network-first för kod, cache-first för assets
const CACHE = 'penetrator-v856';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=856',
  './game.js?v=856',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './icon-180.png?v=763',
  './icon-192.png?v=763',
  './icon-512.png?v=763',
  './assets/menu/warparty-menubg.jpg?v=690',
  './assets/menu/warparty-coopbg.jpg?v=690',
  './assets/menu/bg-shop.jpg?v=690',
  './assets/menu/bg-wardrobe.jpg?v=690',
  './assets/menu/bg-ach.jpg?v=690',
  './assets/menu/bg-settings.jpg?v=690',
  './assets/menu/bg-help.jpg?v=690',
  './assets/menu/warparty-logo.png?v=691',
  './assets/sfx/shootGun.ogg?v=759',
  './assets/sfx/shootRapid.ogg?v=759',
  './assets/sfx/shootShotgun.ogg?v=759',
  './assets/sfx/shootBig.ogg?v=759',
  './assets/sfx/shootEnergy.ogg?v=759',
  './assets/sfx/shootHeavy.ogg?v=759',
  './assets/sfx/shootThrow.ogg?v=759',
  './assets/sfx/shootMelee.ogg?v=759',
  './assets/sfx/hit.ogg?v=759',
  './assets/sfx/hitCrit.ogg?v=759',
  './assets/sfx/kill.ogg?v=759',
  './assets/sfx/explosion.ogg?v=759',
  './assets/sfx/dash.ogg?v=759',
  './assets/sfx/shield.ogg?v=759',
  './assets/sfx/grenadeThrow.ogg?v=759',
  './assets/sfx/goldPickup.ogg?v=759',
  './assets/sfx/reloadStart.ogg?v=759',
  './assets/sfx/reloadDone.ogg?v=759',
  './assets/sfx/purchase.ogg?v=759',
  './assets/sfx/uiClick.ogg?v=759',
  './assets/sfx/uiHover.ogg?v=759',
  './assets/sfx/uiBack.ogg?v=759',
  './assets/sfx/uiError.ogg?v=759',
  './assets/sfx/bossSpawn.ogg?v=759',
  './assets/sfx/bossDeath.ogg?v=759',
  './assets/sfx/pickupHealth.ogg?v=759',
  './assets/sfx/pickupShield.ogg?v=759',
  './assets/sfx/pickupAmmo.ogg?v=759',
  './assets/sfx/pickupWeapon.ogg?v=759',
  './assets/sfx/shieldBreak.ogg?v=759',
  './assets/sfx/downed.ogg?v=759',
  './assets/sfx/flagGrab.ogg?v=759',
  './assets/sfx/flagReturn.ogg?v=759',
  './assets/sfx/flagDrop.ogg?v=759',
  './assets/sfx/coreDestroyed.ogg?v=759',
  './assets/sfx/airstrikeWarning.ogg?v=759',
  './assets/sfx/stormWarning.ogg?v=759',
  './assets/sfx/uavActivate.ogg?v=759',
  './assets/sfx/countdownBeep.ogg?v=759',
  './assets/sfx/countdownGo.ogg?v=759',
  './assets/sfx/playerJoin.ogg?v=759',
  './assets/sfx/playerLeave.ogg?v=759',
  './shared/ctf-arena.js',
  './shared/gungame-arena.js',
  './shared/tdm-arena.js',
  './shared/siege-arena.js',
  './shared/koth-arena.js',
  './shared/juggernaut-arena.js',
  './shared/battleroyale-arena.js',
  './shared/castledefense-arena.js',
  './shared/survivors-arena.js',
  './shared/heist-arena.js',
  './shared/gulag-arenas.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  // VIKTIGT: INGEN self.skipWaiting() — annars aktiveras nya SW DIREKT när
  // de installeras, vilket triggar auto-reload mitt i gameplay (= "1-min DC").
  // Användaren får manuellt klicka NY VERSION-banner för att aktivera nya SW.
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Lyssna på SKIP_WAITING-meddelande från klienten (när användaren klickar
// NY VERSION-banner). Då aktiverar vi nya SW och tar över sidan.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isCode = url.pathname.endsWith('.html') ||
                 url.pathname.endsWith('.js') ||
                 url.pathname.endsWith('.css') ||
                 url.pathname.endsWith('.json') ||
                 url.pathname === '/' || url.pathname.endsWith('/');
  if (isCode) {
    // Network-first så dev-iterationer syns direkt
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      }).catch(() => caches.match(e.request).then(resp => resp || caches.match('./index.html')))
    );
  } else {
    // Cache-first för bilder/SVG/assets
    e.respondWith(
      caches.match(e.request).then(resp =>
        resp || fetch(e.request).then(r => {
          if (r.ok && url.origin === location.origin) {
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return r;
        })
      )
    );
  }
});
