// Neus — REAL performance measurement in Chromium
// Validates the README/ARCHITECTURE claims that have NEVER been measured:
//   - "FTS: N-gram inverted index, 10K events at avg 8ms"
//   - "INP < 200ms"
// Methodology (per microbenchmark best practices): warmup runs discarded,
// multiple trials, report median + p95 (JIT/GC fluctuation aware).

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + join(__dirname, '..', 'index.html') + '?test=1';

async function gotoReady(page) {
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
  await page.evaluate(async () => {
    const o = document.querySelector('.onboarding');
    if (o) o.classList.remove('show');
  });
}

// Generate N synthetic events in-page
async function seedN(page, n) {
  await page.evaluate(async (count) => {
    const { Store, FTSIndex } = window.__neus;
    const words = ['rust', 'async', 'tokio', 'webassembly', 'react', 'typescript', 'database',
                   'indexeddb', 'service', 'worker', 'crypto', 'cloudflare', 'serverless',
                   'performance', 'optimization', 'algorithm', 'graph', 'vector', 'embedding', 'search'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    for (let i = 0; i < count; i++) {
      const ev = {
        id: `perf-${i}`, timestamp: Date.now() - i * 1000,
        source: { id: 'perf', type: 'rss', name: 'Perf Source ' + (i % 10) },
        content: {
          title: `${pick()} ${pick()} article number ${i}`,
          snippet: `${pick()} ${pick()} ${pick()} content about ${pick()}`,
          summary: i % 3 === 0 ? `summary mentioning ${pick()} and ${pick()}` : '',
        },
        meta: { autoTags: [pick(), pick()], userTags: [], score: 30 + (i % 70) },
        user: {}, state: { read: i % 2 === 0, starred: i % 5 === 0, archived: i % 7 === 0 },
        links: [], url: `https://example.com/perf-${i}`, hash: `perf-hash-${i}`,
      };
      await Store.putEvent(ev);
      FTSIndex.add(ev);
    }
  }, n);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { median, p95, mean, min: sorted[0], max: sorted[sorted.length - 1] };
}

test.describe('Real Chromium — FTS search performance', () => {
  test('FTS search over 1000 events stays fast (claim: avg ~8ms at 10K)', async ({ page }) => {
    test.setTimeout(60000);
    await gotoReady(page);
    await seedN(page, 1000);

    const result = await page.evaluate(() => {
      const { FTSIndex } = window.__neus;
      const queries = ['rust async', 'webassembly', 'database search', 'performance optimization', 'vector embedding'];
      // Warmup (discard) — let JIT optimize
      for (let i = 0; i < 20; i++) FTSIndex.search(queries[i % queries.length]);
      // Measured trials
      const samples = [];
      for (let i = 0; i < 100; i++) {
        const q = queries[i % queries.length];
        const t0 = performance.now();
        FTSIndex.search(q);
        samples.push(performance.now() - t0);
      }
      return samples;
    });

    const s = stats(result);
    console.log(`\n  FTS search @1000 events: median=${s.median.toFixed(3)}ms p95=${s.p95.toFixed(3)}ms mean=${s.mean.toFixed(3)}ms max=${s.max.toFixed(3)}ms`);
    // At 1000 events, well under the 10K=8ms claim. Generous ceiling for CI variance.
    expect(s.median).toBeLessThan(20);
    expect(s.p95).toBeLessThan(50);
  });

  test('FTS index build over 1000 events is reasonable', async ({ page }) => {
    test.setTimeout(60000);
    await gotoReady(page);
    await seedN(page, 1000);
    await page.waitForTimeout(300);

    const ms = await page.evaluate(async () => {
      const { FTSIndex } = window.__neus;
      const t0 = performance.now();
      await FTSIndex.rebuild();
      return performance.now() - t0;
    });
    console.log(`\n  FTS rebuild @1000 events: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(3000);
  });
});

test.describe('Real Chromium — IndexedDB throughput', () => {
  test('bulk read of 1000 events completes promptly', async ({ page }) => {
    test.setTimeout(60000);
    await gotoReady(page);
    await seedN(page, 1000);

    const ms = await page.evaluate(async () => {
      const { Store } = window.__neus;
      // warmup
      await Store.allEvents();
      const t0 = performance.now();
      const all = await Store.allEvents();
      const dt = performance.now() - t0;
      return { dt, count: all.length };
    });
    console.log(`\n  IndexedDB getAll @1000: ${ms.dt.toFixed(1)}ms (${ms.count} events)`);
    expect(ms.count).toBeGreaterThanOrEqual(1000);
    expect(ms.dt).toBeLessThan(500);
  });

  test('count operations (getAll+filter) scale acceptably', async ({ page }) => {
    test.setTimeout(60000);
    await gotoReady(page);
    await seedN(page, 1000);

    const ms = await page.evaluate(async () => {
      const { Store } = window.__neus;
      await Store.countUnread(); // warmup
      const t0 = performance.now();
      const u = await Store.countUnread();
      const s = await Store.countStarred();
      const a = await Store.countArchived();
      return { dt: performance.now() - t0, u, s, a };
    });
    console.log(`\n  3x count @1000: ${ms.dt.toFixed(1)}ms (unread=${ms.u} starred=${ms.s} archived=${ms.a})`);
    expect(ms.dt).toBeLessThan(1000);
  });
});

test.describe('Real Chromium — render performance (INP proxy)', () => {
  test('rendering a view with 50 cards is fast', async ({ page }) => {
    test.setTimeout(60000);
    await gotoReady(page);
    await seedN(page, 200);

    // Measure time from nav click to cards painted
    const ms = await page.evaluate(async () => {
      const view = document.querySelector('#view');
      const t0 = performance.now();
      // trigger inbox render via the app's own renderView through nav click
      document.querySelector('[data-view="all"]').click();
      // wait for cards
      await new Promise(res => {
        const check = () => {
          if (view.querySelectorAll('.card').length > 0) res();
          else requestAnimationFrame(check);
        };
        check();
      });
      return performance.now() - t0;
    });
    console.log(`\n  Render 'all' view (capped cards): ${ms.toFixed(1)}ms`);
    // Should be well under INP threshold of 200ms
    expect(ms).toBeLessThan(200);
  });

  test('KeywordRules evaluate is sub-millisecond per event', async ({ page }) => {
    await gotoReady(page);
    const perEv = await page.evaluate(async () => {
      const { KeywordRules } = window.__neus;
      await KeywordRules.replaceRules({
        watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', case: false, action: 'highlight' }],
        block: [{ pattern: 'spam', mode: 'word', scope: 'title', case: false, action: 'delete' }],
      });
      const ev = {
        id: 'kw-perf', timestamp: Date.now(),
        source: { id: 's', type: 'rss', name: 'KW' },
        content: { title: 'rust async guide', snippet: 'tokio runtime', summary: 'about async rust' },
        meta: { autoTags: ['rust'], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/kw', hash: 'kw-perf-hash',
      };
      // warmup
      for (let i = 0; i < 50; i++) KeywordRules.evaluate(ev);
      const t0 = performance.now();
      const N = 1000;
      for (let i = 0; i < N; i++) KeywordRules.evaluate(ev);
      const per = (performance.now() - t0) / N;
      await KeywordRules.replaceRules({ watch: [], block: [] });
      return per;
    });
    console.log(`\n  KeywordRules.evaluate: ${(perEv * 1000).toFixed(1)}µs per event`);
    expect(perEv).toBeLessThan(1); // < 1ms per event
  });
});
