// Network-only requests keep financial pages synchronized with the server.
const CACHE = 'trezia-static-v2';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/manifest.json', '/icon.svg']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isStaticAsset = url.origin === self.location.origin && (
    url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.json'
  );

  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
  }
  // Non-navigation, non-static requests (API calls, RSC payloads) always hit
  // the network — money data is never served from a stale cache.
});

// Web-push support. These handlers only display/route notifications sent by
// the server (src/lib/notifications/push.ts) — they do not touch the fetch
// handler above or any of its money-data caching rules.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Trezia', body: 'You have a new notification.' };
  }
  const title = data.title || 'Trezia';
  const body = data.body || '';
  const url = data.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: '/icon.svg',
      badge: '/icon.svg',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = event.notification.data?.url || '/';
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) {
          try {
            await existing.navigate(url);
          } catch {}
        }
      } else if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
