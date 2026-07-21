/* ============================================================
   sicr3p — service worker mínimo y honesto (PWA de tablet).

   Estrategias:
   · Navegaciones: NETWORK-FIRST con fallback a caché — el deploy del
     VPS (cron cada 30 min) siempre gana; sin red, el shell abre igual.
   · /assets/ y fuentes (archivos con hash inmutable de Vite):
     STALE-WHILE-REVALIDATE.
   · /api/: JAMÁS se cachea — todo cálculo es del servidor (regla dura
     del repo) y un dato viejo con apariencia de fresco sería mentir.

   skipWaiting + clients.claim: cada versión nueva reemplaza a la
   anterior de inmediato; los cachés viejos se limpian en activate.
   ============================================================ */
const VERSION = 'sicr3p-v1';
const CACHE_ASSETS = `${VERSION}-assets`;
const CACHE_PAGES = `${VERSION}-pages`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API: siempre red, nunca caché.
  if (url.pathname.startsWith('/api/')) return;

  // Navegaciones (documentos): red primero, caché de respaldo.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const resp = await fetch(event.request);
        const cache = await caches.open(CACHE_PAGES);
        cache.put(event.request, resp.clone());
        return resp;
      } catch {
        const cache = await caches.open(CACHE_PAGES);
        return (await cache.match(event.request)) || (await cache.match('/'))
          || Response.error();
      }
    })());
    return;
  }

  // Assets inmutables: caché primero, refresco en segundo plano.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_ASSETS);
      const enCache = await cache.match(event.request);
      const red = fetch(event.request).then((resp) => {
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }).catch(() => enCache);
      return enCache || red;
    })());
  }
});
