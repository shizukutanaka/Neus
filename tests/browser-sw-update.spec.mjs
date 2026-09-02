// Neus — デプロイした新版が実際に利用者へ届くことを固定する (round 86)
//
// 既存の SW spec は登録・キャッシュ・オフライン・旧キャッシュ削除・クロスオリジン非介入を
// 押さえているが、**最も結果の重い性質**が抜けていた:
//
//   **デプロイした新しいコードは、本当に利用者のところへ届くのか。**
//
// ここが壊れていると、本セッションで直した欠陥は**1つも利用者に届かない**。しかも壊れ方が
// 静かで、開発側からは正常に見える(サーバには新版がある)。
//
// `sw.js` はアプリシェルに **stale-while-revalidate** を使う。つまり設計上、
//   - 1回目の読み込み … **古いまま**(キャッシュを即返し、裏で新版を取得)
//   - 2回目の読み込み … **新版**
// という2段階になる。ソース中のコメントもそう述べている(「デプロイ後の新版が次回起動で反映」)。
// 本 spec はその2段階を**実際に測る** — 1回目が古いことも含めて固定するのは、そこが
// 「cache-first に戻す」変更で静かに永久停止へ変わる境目だからである。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let server, base, buildMarker = 'BUILD-1';

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const p = (req.url || '/').split('?')[0];
    const file = join(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    try {
      let body = await readFile(file);
      // Stamp the served HTML with the current "deploy". A meta tag leaves the inline
      // script bytes — and therefore the CSP hashes — untouched.
      if (extname(file) === '.html') {
        body = Buffer.from(String(body).replace('<title>',
          `<meta name="neus-build" content="${buildMarker}">\n<title>`));
      }
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[extname(file)]
        || 'application/octet-stream';
      // No HTTP caching, so anything stale can only have come from the Service Worker.
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache, no-store, must-revalidate' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));

const servedBuild = (page) =>
  page.evaluate(() => document.querySelector('meta[name="neus-build"]')?.content ?? '(none)');

async function swReady(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
}

test.describe('a deployed update actually reaches the reader', () => {
  test('the second load after a deploy serves the new build', async ({ page }) => {
    buildMarker = 'BUILD-1';
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await swReady(page);
    expect(await servedBuild(page), 'first ever load comes from the network').toBe('BUILD-1');

    // Deploy.
    buildMarker = 'BUILD-2';

    // Load 1 after the deploy: stale-while-revalidate serves the cached shell and fetches
    // the new one behind it. Old content here is the design, not the bug.
    await page.reload({ waitUntil: 'load' });
    await swReady(page);
    expect(await servedBuild(page), 'SWR serves the cached shell on the first load').toBe('BUILD-1');

    // Give the background revalidation time to land in the cache.
    await page.waitForTimeout(1500);

    // Load 2: the reader must now be running the new code.
    await page.reload({ waitUntil: 'load' });
    await swReady(page);
    expect(await servedBuild(page),
      'a reader stuck on the old build would never receive any fix').toBe('BUILD-2');
  });

  test('and keeps up with a second deploy — it is not a one-time catch-up', async ({ page }) => {
    buildMarker = 'BUILD-A';
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await swReady(page);

    for (const next of ['BUILD-B', 'BUILD-C']) {
      buildMarker = next;
      await page.reload({ waitUntil: 'load' });
      await swReady(page);
      await page.waitForTimeout(1500);
      await page.reload({ waitUntil: 'load' });
      await swReady(page);
      expect(await servedBuild(page), `deploy ${next} must reach the reader too`).toBe(next);
    }
  });

  test('the cached copy is refreshed, not merely bypassed', async ({ page, context }) => {
    // The update must live in the cache, or the reader loses it the moment they go offline —
    // which is exactly when a local-first app is supposed to keep working.
    buildMarker = 'BUILD-X';
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await swReady(page);

    buildMarker = 'BUILD-Y';
    await page.reload({ waitUntil: 'load' });
    await swReady(page);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'load' });
    await swReady(page);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    expect(await servedBuild(page), 'offline must serve the NEW build from cache').toBe('BUILD-Y');
    await context.setOffline(false);
  });

  test('the shell strategy is still revalidating, not cache-first (shape)', async () => {
    // The property above rests entirely on this. Reverting to cache-first would pin every
    // reader to whatever build they first saw, silently and permanently.
    const { readFileSync } = await import('fs');
    const sw = readFileSync(join(root, 'sw.js'), 'utf8');
    expect(sw).toContain('const fresh = fetch(req).then(res => {');
    expect(sw, 'the fetch result must be written back into the cache')
      .toContain('cache.put(new Request(url.origin + url.pathname), res.clone());');
    expect(sw, 'and the cached copy is returned first, with the fetch behind it')
      .toContain('return cached || fresh;');
  });
});
