const CACHE_NAME = 'debtsync-cache-v10';
const PRECACHE_ASSETS = [
  '/dash',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          // Also purge any stale share or accept routes that may have been cached
          return caches.open(name).then((cache) => {
            return cache.keys().then((requests) => {
              return Promise.all(
                requests
                  .filter((req) => req.url.includes('/share') || req.url.includes('/accept'))
                  .map((req) => cache.delete(req))
              );
            });
          });
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin requests, Supabase API calls, non-GET requests, localhost development,
  // AND NEVER intercept share links, acceptance links, or API calls!
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.pathname.startsWith('/share') ||
    url.pathname.startsWith('/accept') ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/admin')
  ) {
    return;
  }

  // Network-first strategy for navigation requests (HTML pages) and code chunks
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {});
          }).catch(() => {});
        }
        return networkResponse;
      })
      .catch(async () => {
        try {
          const matched = await caches.match(event.request);
          if (matched) return matched;
          if (event.request.mode === 'navigate') {
            const root = await caches.match('/dash');
            if (root) return root;
          }
        } catch (_) {}
        return new Response('Offline mode — page unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});

// ─── Background Web Push ────────────────────────────────────────────────────
// Runs even when no DebtSync tab/PWA window is open.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'DebtSync', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'DebtSync';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/transactions' },
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If the user is actively looking at the app, the in-app realtime
      // notification already covers it - avoid a redundant OS popup.
      const appFocused = clients.some((c) => c.focused && c.visibilityState === 'visible');
      if (appFocused) return undefined;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/transactions',
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
