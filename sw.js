// Service Worker — network-first för kod, cache-first för assets
const CACHE = 'penetrator-v134-wardrobe';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
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
