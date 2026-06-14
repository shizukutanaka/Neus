/**
 * Neus Service Worker v2
 *
 * Strategy:
 *   - App shell: cache-first (index.html, manifest.json)
 *   - Worker proxy: network-only (RSS fetch must be fresh)
 *   - Same-origin GET: stale-while-revalidate
 *   - Cross-origin: passthrough
 *
 * Background:
 *   - periodicsync: notify main thread to poll (Chromium-only)
 *   - notificationclick: focus the app
 */

const CACHE = 'neus-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (SHELL.includes(url.pathname)) {
    // App shell: stale-while-revalidate.
    // 即座にキャッシュを返しつつ、裏で新版を取得してキャッシュ更新。
    // 単一HTMLアプリのため、これによりデプロイ後の新版が次回起動で反映される。
    // (cache-firstだと index.html が永遠に古いままになる問題を解消)
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req, { ignoreSearch: true }).then(cached => {
          const fresh = fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fresh;
        })
      )
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        const fetchAndPut = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchAndPut;
      })
    )
  );
});

/**
 * Periodic Background Sync (Chromium only)
 * SW cannot access IndexedDB lib code, so we delegate to main thread
 * by posting a message. If no client is active, we just skip — the user
 * will see new items next time they open the app.
 */
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'neus-poll') return;
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length === 0) {
      // No active client: try to wake via Notification (if granted)
      if (self.registration.showNotification) {
        try {
          await self.registration.showNotification('Neus', {
            body: 'Tap to fetch new events',
            tag: 'neus-wake',
            silent: true,
          });
        } catch {}
      }
      return;
    }
    for (const c of clients) c.postMessage({ type: 'periodic-poll-done' });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) return clients[0].focus();
    return self.clients.openWindow('/');
  })());
});
