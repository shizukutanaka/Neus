// Neus — Service Worker REAL offline test
// Spins up an actual HTTP server (SW can't register on file://),
// registers the SW, then cuts the network and verifies the app still loads.
// This is the ONLY way to prove "offline support" actually works.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

let server, baseURL;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = join(root, path);
    // prevent path traversal
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // SW requires a secure context; localhost counts as secure.
      'Service-Worker-Allowed': '/',
    });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  baseURL = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
});

test.describe('Real Service Worker — registration & offline', () => {
  test('SW registers and reaches activated state', async ({ page }) => {
    await page.goto(baseURL + '/');
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sw = reg.active || reg.installing || reg.waiting;
      if (!sw) return 'no-worker';
      if (sw.state === 'activated') return 'activated';
      // Wait for it to reach activated
      await new Promise(resolve => {
        sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); });
        if (sw.state === 'activated') resolve();
        setTimeout(resolve, 3000);
      });
      return sw.state;
    });
    expect(state).toBe('activated');
  });

  test('app shell is cached after first load', async ({ page }) => {
    await page.goto(baseURL + '/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Give SW a moment to populate cache
    await page.waitForTimeout(500);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      if (names.length === 0) return { names, hasIndex: false };
      // Search EVERY cache, not names[0]. A second cache (neus-prefs-v1) was added later and
      // caches.keys() has no guaranteed order, so indexing [0] could open the prefs cache and
      // wrongly report the shell as uncached.
      const urls = [];
      for (const n of names) {
        const keys = await (await caches.open(n)).keys();
        for (const r of keys) urls.push(new URL(r.url).pathname);
      }
      return { names, urls, hasIndex: urls.some(u => u === '/' || u === '/index.html') };
    });
    expect(cached.names.length).toBeGreaterThan(0);
    expect(cached.hasIndex).toBe(true);
  });

  test('app loads OFFLINE after SW caches it (the real test)', async ({ page, context }) => {
    // First visit online — register SW + populate cache
    await page.goto(baseURL + '/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(800);

    // Cut the network entirely
    await context.setOffline(true);

    // Reload while offline — must be served from SW cache
    const resp = await page.goto(baseURL + '/').catch(e => ({ error: e.message }));
    // h1 must render from cached shell
    await page.waitForSelector('h1.brand', { timeout: 5000 });
    const title = await page.textContent('h1.brand');

    await context.setOffline(false);
    expect(title).toContain('NEUS');
  });

  test('offline reload preserves IndexedDB data', async ({ page, context }) => {
    await page.goto(baseURL + '/?test=1');
    await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
    // Seed an event
    await page.evaluate(async () => {
      const { Store } = window.__neus;
      await Store.putEvent({
        id: 'offline-1', timestamp: Date.now(),
        source: { id: 's', type: 'rss', name: 'Offline' },
        content: { title: 'Offline Event', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'http://x/offline', hash: 'offline-hash',
      });
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(500);

    // Go offline and reload
    await context.setOffline(true);
    await page.goto(baseURL + '/?test=1');
    await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
    const title = await page.evaluate(async () => {
      const ev = await window.__neus.Store.getEvent('offline-1');
      return ev?.content.title;
    });
    await context.setOffline(false);
    expect(title).toBe('Offline Event');
  });

  test('cross-origin requests are not hijacked by SW', async ({ page }) => {
    await page.goto(baseURL + '/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The SW fetch handler must early-return for cross-origin; verify it doesn't cache them
    const crossOriginCached = await page.evaluate(async () => {
      const names = await caches.keys();
      for (const n of names) {
        const cache = await caches.open(n);
        const keys = await cache.keys();
        if (keys.some(r => !r.url.startsWith(location.origin))) return true;
      }
      return false;
    });
    expect(crossOriginCached).toBe(false);
  });

  test('old caches are purged on activate (only the current shell + prefs cache remain)', async ({ page }) => {
    await page.goto(baseURL + '/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(300);
    const names = await page.evaluate(() => caches.keys());
    // Only the current shell cache and the small prefs mirror (round 28: AutoSync.syncPrefsToSW
    // writes the notify preference here so periodicsync can read it without IndexedDB access)
    // should exist — activate() explicitly spares both from its "delete anything else" sweep.
    expect(names.every(n => n === 'neus-shell-v3' || n === 'neus-prefs-v1')).toBe(true);
  });
});
