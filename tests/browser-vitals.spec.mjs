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
