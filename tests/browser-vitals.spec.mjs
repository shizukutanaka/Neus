// Neus — Core Web Vitals の実測 (round 46)
//
// G10.06 は「Lighthouse Performance 90+」を要求しているが、本環境に Lighthouse は無く、
// 追加すれば devDependency が増えて G10.03(脆弱性ゼロ)と綱引きになる。
// そこで**要件の意図**(利用者にとって速いか)を、依存を増やさず実測する。
//
// Lighthouse Performance スコアの重みは概ね
//   TBT 30% / LCP 25% / CLS 25% / FCP 10% / Speed Index 10%
// であり、本 spec はそのうち **90% を占める4指標**を実ブラウザ(Chromium)で直接測る。
//
// **限界の明示**: これは Lighthouse スコアそのものではない。Lighthouse は Slow 4G 相当の
// ネットワーク絞りと 4x CPU スロットリング下で測るが、ここは localhost・スロットリング無し。
// したがって「Lighthouse 90+ を達成した」とは主張できない。主張できるのは
// 「スコアの大半を占める指標が、Lighthouse の good 閾値に対して桁違いの余裕を持つ」ことまで。
// 正式な G10.06 は実機 + Lighthouse で人間が確認すること(DEPLOY.md STEP 6)。
//
// 閾値は Lighthouse/web.dev の "good" 境界をそのまま使う(甘い自作基準を作らない):
//   FCP <= 1800ms / LCP <= 2500ms / CLS <= 0.1 / TBT <= 200ms
// 実測(round 46, localhost): FCP 160ms / LCP 160ms / CLS 0 / TBT 5ms
//
// ---------------------------------------------------------------------------
// round 95 — **空のアプリで測った数字は、使い込んだアプリの数字ではない**
//
// 総括 1-4「性能」に反問を当てた: *この測定は誰の端末を写しているのか。*
// 本 spec も `browser-lighthouse-score.spec.mjs` も **何も seed していなかった**
// (`indexedDB` への参照が 0)。つまり「Performance = 99」は**初日の空の状態**の数字で、
// 1年使った利用者の体験ではない。「永久に貯め続ける」製品でそれは物足りない。
//
// 実測(seed 済みプロファイルで再起動):
//
//   events=     0   FCP= 64ms  CLS=0  TBT=0ms  cards= 0
//   events=  2000   FCP= 68ms  CLS=0  TBT=0ms  cards=50
//   events= 10000   FCP= 52ms  CLS=0  TBT=0ms  cards=50
//
// **劣化しない。** 理由は2つあり、どちらも既存の設計判断である:
//   - round 28 で FTS/TagLearner/StorageGuard の全件スキャンを**初回描画の後ろへ**回した
//   - 初回描画は `listEvents({limit})` で、`CONFIG.maxViewItems` により**50枚で頭打ち**
//
// つまり 1-4 は規模に対しても成り立つ。**直すものは無い。** 下のテストは、その性質が
// 将来の変更(例: 起動時に全件を読む処理の追加)で静かに失われないようにするために置く。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

// web.dev / Lighthouse "good" thresholds.
const GOOD = { fcp: 1800, lcp: 2500, cls: 0.1, tbt: 200 };

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(root, path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));

test.describe('Core Web Vitals (the measurable part of G10.06)', () => {
  test('FCP, LCP, CLS and TBT are all inside the "good" band', async ({ page }) => {
    await page.addInitScript(() => {
      window.__v = { lcp: 0, cls: 0, tbt: 0, longtasks: 0 };
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; })
        .observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(l => {
        for (const e of l.getEntries()) { window.__v.longtasks++; window.__v.tbt += Math.max(0, e.duration - 50); }
      }).observe({ type: 'longtask', buffered: true });
    });

    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000); // let LCP/CLS settle after first paint

    const v = await page.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { fcp: fcp ? fcp.startTime : null, lcp: window.__v.lcp, cls: window.__v.cls, tbt: window.__v.tbt };
    });

    // Surface the numbers so a regression shows the actual value, not just a boolean.
    console.log(`  CWV: FCP=${Math.round(v.fcp)}ms LCP=${Math.round(v.lcp)}ms CLS=${v.cls.toFixed(3)} TBT=${Math.round(v.tbt)}ms`);

    expect(v.fcp, 'first contentful paint').not.toBeNull();
    expect(v.fcp, `FCP ${Math.round(v.fcp)}ms exceeds good threshold`).toBeLessThanOrEqual(GOOD.fcp);
    expect(v.lcp, `LCP ${Math.round(v.lcp)}ms exceeds good threshold`).toBeLessThanOrEqual(GOOD.lcp);
    expect(v.cls, `CLS ${v.cls} exceeds good threshold`).toBeLessThanOrEqual(GOOD.cls);
    expect(v.tbt, `TBT ${Math.round(v.tbt)}ms exceeds good threshold`).toBeLessThanOrEqual(GOOD.tbt);
  });

  test('layout is stable — no cumulative shift at all', async ({ page }) => {
    // CLS 0 is achievable here because the shell is a single document with no late-loading
    // images or injected banners above content. Guarding it keeps that property.
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => window.__cls)).toBeLessThanOrEqual(GOOD.cls);
  });

  test('the document itself stays within a sane transfer budget', async ({ page }) => {
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    const kb = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return Math.round((nav?.decodedBodySize || 0) / 1024);
    });
    console.log(`  index.html decoded: ${kb}KB (served uncompressed here; gzip is far smaller)`);
    // A single-file app has no code splitting, so the one document is the whole budget.
    expect(kb, `index.html grew to ${kb}KB`).toBeLessThan(600);
  });
});

// ---------------------------------------------------------------------------
// round 95: the same vitals, on a profile that has been used.
// ---------------------------------------------------------------------------

/** Fill the store the way a year of polling would, in batches so one transaction stays sane. */
async function seedEvents(page, n) {
  await page.evaluate(async (count) => {
    const db = await new Promise(res => { const q = indexedDB.open('neus-v1'); q.onsuccess = () => res(q.result); });
    const W = 'rust webgpu 機械学習 線形代数 量子計算 自然言語処理 ownership lifetime shader compute'.split(' ');
    for (let base = 0; base < count; base += 1000) {
      await new Promise(res => {
        const tx = db.transaction(['events'], 'readwrite');
        const os = tx.objectStore('events');
        for (let i = base; i < Math.min(base + 1000, count); i++) {
          os.put({
            id: 'e' + i, timestamp: Date.now() - i * 1000, publishedAt: Date.now() - i * 1000,
            content: { title: `${W[i % W.length]} ${W[(i * 7) % W.length]} ${i}`,
                       snippet: (W[(i * 3) % W.length] + ' ').repeat(40).slice(0, 500) },
            source: { id: 's', name: 'src', url: 'u' },
            meta: { autoTags: [], userTags: [], score: 50 },
            user: {}, state: { read: false, starred: false, archived: false },
            links: [], url: 'https://e.test/' + i, hash: 'h' + i,
          });
        }
        tx.oncomplete = res;
      });
    }
  }, n);
}

const vitalsOf = (page) => page.evaluate(() => {
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
  const cls = (performance.getEntriesByType('layout-shift') || [])
    .reduce((a, e) => a + (e.hadRecentInput ? 0 : e.value), 0);
  const tbt = (performance.getEntriesByType('longtask') || [])
    .reduce((a, e) => a + Math.max(0, e.duration - 50), 0);
  return { fcp: Math.round(fcp), cls: +cls.toFixed(4), tbt: Math.round(tbt),
           cards: document.querySelectorAll('.card').length };
});

test.describe('the same vitals on a profile that has been used (round 95)', () => {
  test('10,000 stored events do not slow the first paint', async ({ page }) => {
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await seedEvents(page, 10000);

    await page.goto(`${base}/index.html`, { waitUntil: 'load' });   // restart, now loaded
    await page.waitForTimeout(5000);
    const v = await vitalsOf(page);

    expect(v.cards, 'the seed must actually have landed and rendered').toBeGreaterThan(0);
    expect(v.fcp, `FCP with a full store: ${v.fcp}ms`).toBeLessThanOrEqual(GOOD.fcp);
    expect(v.cls, 'a large store must not introduce layout shift').toBeLessThanOrEqual(GOOD.cls);
    expect(v.tbt, `TBT with a full store: ${v.tbt}ms`).toBeLessThanOrEqual(GOOD.tbt);
  });

  test('the first render stays bounded regardless of how much is stored', async ({ page }) => {
    // This is why the numbers hold: the opening view asks for a limited page, so it cannot
    // grow with the store. If someone ever renders everything, this fails before the vitals do.
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await seedEvents(page, 10000);
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    const { cards } = await vitalsOf(page);
    expect(cards, `first view rendered ${cards} cards from a 10,000-event store`).toBeLessThanOrEqual(200);
  });

  test('the heavy scans are still ordered after the first paint', async () => {
    // The round-28 decision is what keeps the two tests above true. Pinned as shape, since
    // ordering inside init is not observable from outside.
    //
    // The first version of this assertion did not work. It took the FIRST render mark — there
    // are two, one in onboarding — and looked for any rebuild after it. Injecting a rebuild
    // before the startup paint still left the later legitimate one downstream of the
    // onboarding mark, so the test passed against the very regression it was written for.
    // Now it isolates the startup block and requires that no scan appear before its paint.
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');

    const anchor = html.indexOf('初期表示を最優先');
    expect(anchor, 'the round-28 comment marks the startup block').toBeGreaterThan(-1);
    const startupStart = html.lastIndexOf('await AutoSync.syncPrefsToSW();', anchor);
    const paint = html.indexOf("Perf.mark('render')", anchor);
    expect(startupStart, 'startup block start not found').toBeGreaterThan(-1);
    expect(paint, 'the startup paint must still exist').toBeGreaterThan(startupStart);

    const beforePaint = html.slice(startupStart, paint);
    for (const scan of ['FTSIndex.rebuild()', 'TagLearner.rebuild()', 'Store.allEvents()']) {
      expect(beforePaint.includes(scan),
        `${scan} runs before the first paint — round 28 moved it after, on purpose`).toBe(false);
    }
    // And the scan really does happen, later — otherwise search would simply be broken.
    expect(html.indexOf('FTSIndex.rebuild()', paint),
      'the scan must still run, just afterwards').toBeGreaterThan(paint);
  });
});
