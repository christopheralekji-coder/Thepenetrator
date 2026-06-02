// Service Worker — network-first för kod, cache-first för assets
const CACHE = 'penetrator-v701-netcode';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=701',
  './game.js?v=701',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './assets/menu/warparty-menubg.jpg?v=690',
  './assets/menu/warparty-coopbg.jpg?v=690',
  './assets/menu/bg-shop.jpg?v=690',
  './assets/menu/bg-wardrobe.jpg?v=690',
  './assets/menu/bg-ach.jpg?v=690',
  './assets/menu/bg-settings.jpg?v=690',
  './assets/menu/bg-help.jpg?v=690',
  './assets/menu/warparty-logo.png?v=691',
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
