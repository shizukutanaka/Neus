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

// v3: shell writes now key on pathname only (see the fetch handler) instead of the full
// request URL, so query-string variants (share target, bookmarklet, ?test=1, tracking
// params) stop each inserting their own ~325KB copy of index.html. Bumping the cache name
// drops any v2 cache already bloated by that bug via the activate handler below.
const CACHE = 'neus-shell-v3';
const SHELL = ['/', '/index.html', '/manifest.json'];
// Small Cache API namespace the main thread mirrors user prefs into (the SW can't read
// IndexedDB). Kept separate from CACHE so the activate handler's "delete anything that
// isn't the current shell cache" sweep doesn't wipe it out.
const PREFS_CACHE = 'neus-prefs-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== PREFS_CACHE).map(k => caches.delete(k))))
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
            // Write under a pathname-only key: reads already dedup across query strings via
            // ignoreSearch, but writes did not, so every distinct query string (share target,
            // bookmarklet, ?test=1, tracking params) used to insert its own full-size copy of
            // index.html that was never trimmed.
            if (res.ok) cache.put(new Request(url.origin + url.pathname), res.clone());
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
          if (res.ok && !res.headers.get('cache-control')?.includes('no-store')) cache.put(req, res.clone());
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
      // No active client: try to wake via Notification, but only if the user actually opted
      // in. The notify preference lives in IndexedDB, which the SW cannot read directly — the
      // main thread mirrors it into PREFS_CACHE (see AutoSync.syncPrefsToSW in index.html) so
      // this handler can honor it instead of always notifying regardless of consent.
      if (self.registration.showNotification) {
        try {
          const prefsCache = await caches.open(PREFS_CACHE);
          const res = await prefsCache.match('/__prefs');
          const prefs = res ? await res.json() : null;
          if (prefs?.notify) {
            // Honest copy: tapping this does not itself fetch anything — it just opens the
            // app, which still requires the user (or a future poll-on-launch) to refresh.
            await self.registration.showNotification('Neus', {
              body: 'Open Neus to check for updates',
              tag: 'neus-wake',
              silent: true,
            });
          }
        } catch {}
      }
      return;
    }
    // Delegate poll to exactly one tab (prefer focused, then visible, then any).
    // Messaging all tabs causes redundant concurrent fetches and wasted bandwidth.
    const target = clients.find(c => c.focused) || clients.find(c => c.visibilityState === 'visible') || clients[0];
    target.postMessage({ type: 'periodic-poll-request' });
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
