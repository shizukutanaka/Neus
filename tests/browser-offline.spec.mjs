// Neus — REAL Service Worker offline E2E in Chromium over HTTP
// Verifies the "offline-capable PWA" claim that has NEVER been tested in a real environment.
// file:// cannot register SW, so we serve over HTTP and toggle real offline mode.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let server, baseUrl;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
};

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      let path = req.url.split('?')[0];
      if (path === '/') path = '/index.html';
      const file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.slice(path.lastIndexOf('.'));
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Service-Worker-Allowed': '/',
      });
      res.end(data);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise(r => server.close(r));
});

test.describe('Real Service Worker — registration & lifecycle', () => {
  test('SW registers and becomes active', async ({ page }) => {
    await page.goto(baseUrl + '/index.html');
    // Wait until the page is controlled by an active SW
    const controlled = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready; // resolves only when active
      return !!reg.active;
    });
    expect(controlled).toBe(true);
  });

  test('SW cache contains the app shell', async ({ page }) => {
    await page.goto(baseUrl + '/index.html');
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active;
    }, { timeout: 8000 });
    // Give the SW a moment to populate cache
    await page.waitForTimeout(1000);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      if (names.length === 0) return { names: [], hasShell: false };
      const cache = await caches.open(names[0]);
      const keys = await cache.keys();
      const urls = keys.map(k => new URL(k.url).pathname);
      return { names, urls, hasShell: urls.some(u => u === '/' || u.endsWith('/index.html')) };
    });
    expect(cached.names.length).toBeGreaterThan(0);
    expect(cached.hasShell).toBe(true);
  });
});

test.describe('Real Service Worker — OFFLINE behavior (the untested claim)', () => {
  test('app loads from cache when offline after first visit', async ({ page, context }) => {
    // First visit online — populate cache + register SW
    await page.goto(baseUrl + '/index.html');
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active;
    }, { timeout: 8000 });
    await page.waitForTimeout(1500); // let cache settle

    // Go OFFLINE for real
    await context.setOffline(true);

    // Reload — must come from SW cache, not network
    await page.reload();
    // App shell should still render
    await page.waitForSelector('h1.brand', { timeout: 8000 });
    const title = await page.textContent('h1.brand');
    expect(title).toContain('NEUS');

    // Restore
    await context.setOffline(false);
  });

  test('IndexedDB data readable while offline', async ({ page, context }) => {
    await page.goto(baseUrl + '/index.html?test=1');
    await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active;
    }, { timeout: 8000 });

    // Seed an event online
    await page.evaluate(async () => {
      const { Store } = window.__neus;
      await Store.putEvent({
        id: 'offline-1', timestamp: Date.now(),
        source: { id: 's', type: 'rss', name: 'Offline Source' },
        content: { title: 'Cached Offline Article', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/offline-1', hash: 'offline-hash',
      });
    });
    await page.waitForTimeout(1000);

    // Go offline, reload, verify data persists and is readable
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
    const title = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = await Store.getEvent('offline-1');
      return ev?.content.title;
    });
    expect(title).toBe('Cached Offline Article');
    await context.setOffline(false);
  });

  test('POLL button disabled when offline', async ({ page, context }) => {
    await page.goto(baseUrl + '/index.html');
    await page.waitForSelector('h1.brand', { timeout: 8000 });
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active;
    }, { timeout: 8000 });

    // Trigger offline event
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForTimeout(500);

    const disabled = await page.evaluate(() => {
      const btn = document.querySelector('#btn-poll');
      return btn ? btn.disabled : null;
    });
    // NetworkMonitor should disable POLL when offline
    expect(disabled).toBe(true);

    // Back online re-enables
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(500);
    const reEnabled = await page.evaluate(() => document.querySelector('#btn-poll').disabled);
    expect(reEnabled).toBe(false);
  });
});

test.describe('Real Service Worker — update lifecycle', () => {
  test('second visit reuses active SW (no duplicate registration)', async ({ page }) => {
    await page.goto(baseUrl + '/index.html');
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active;
    }, { timeout: 8000 });
    await page.goto(baseUrl + '/index.html');
    await page.waitForTimeout(500);
    const regCount = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length;
    });
    expect(regCount).toBe(1);
  });
});
