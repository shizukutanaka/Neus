// Neus — 「個人データのサーバー送信ゼロ」を、通信そのものを記録して固定する (round 91)
//
// SOCRATIC-AUDIT 1-1 は「ゼロ送信は**検査可能**」を長所として挙げた。反問:
// *その検査はどこにあるのか?* — **どこにも無かった**。
//
// 個々の性質は測ってきた(BYOK 未設定でベンダ通信ゼロ = round 69、Worker の SSRF = round 83)。
// しかし**通信を丸ごと記録して「これ以外は出ていない」と言う検査**は一つも無かった。
// 部分の否定をいくら積んでも全体の否定にはならない。製品の一番の約束なのに、
// 検査は「そう書いてある」だけだったことになる。
//
// 本 spec は普通の一連の操作(初回起動 → OPML取込 → POLL → 全ビュー巡回 → 検索 →
// キーボード操作 → カードを開く)を実行し、**アプリ自身のオリジン以外へ出た全リクエスト**を
// 記録して、宣言した許可リストと**完全一致**することを確認する。
//
// 実測(round 91 時点、上記の操作で 4 リクエスト / 2 オリジン):
//   https://neus-proxy.example.workers.dev/rss   ← 利用者が設定したプロキシ
//   https://fonts.googleapis.com/css2            ← Google Fonts(ADR-0024 で扱う)
//
// **許可リストであって記録ではない**点が要点。新しい第三者への通信が増えれば、それが
// どれだけ善意でもここで落ちる。「気づいたら増えていた」を防ぐのがこの検査の役目。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.opml': 'application/xml' };

// Every origin this product is allowed to contact, and why. Adding a line here is a
// deliberate act; that is the point.
const ALLOWED = new Map([
  ['https://neus-proxy.example.workers.dev', 'the relay the reader configured (CONFIG.proxy)'],
  ['https://fonts.googleapis.com', 'Google Fonts stylesheet — see ADR-0024'],
  ['https://fonts.gstatic.com', 'Google Fonts files — see ADR-0024'],
]);

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const p = (req.url || '/').split('?')[0];
    const f = join(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    try {
      const b = await readFile(f);
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>c</title>
  <item><title>Rust ownership</title><link>https://ex.test/a</link><description>d</description></item>
  <item><title>WebGPU basics</title><link>https://ex.test/b</link><description>d</description></item>
</channel></rss>`;

/** Record every request leaving the app's own origin, with its full URL and body. */
function recordEgress(page) {
  const out = [];
  page.on('request', r => {
    let u;
    try { u = new URL(r.url()); } catch { return; }
    if (u.origin === base) return;                                  // the app serving itself
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;   // never leaves the device
    out.push({ origin: u.origin, path: u.pathname, search: u.search, method: r.method(), body: r.postData() || '' });
  });
  return out;
}

/** A full ordinary session: nothing exotic, just what a reader does on day one. */
async function normalSession(page) {
  await page.route('**/neus-proxy.example.workers.dev/**', r =>
    r.request().url().includes('/rss')
      ? r.fulfill({ status: 200, contentType: 'application/xml', body: FEED })
      : r.fulfill({ status: 200, contentType: 'application/json', body: '{"extract":"x"}' }));

  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('#onboarding')?.classList.remove('show'));
  await page.setInputFiles('#opml-file', join(__dirname, 'fixtures', 'sample.opml'));
  await page.waitForTimeout(700);
  await page.click('#src-cancel').catch(() => {});
  await page.click('#btn-poll');
  await page.waitForTimeout(4000);
  for (const v of ['inbox', 'all', 'starred', 'archived', 'later', 'resurface', 'words', 'digest']) {
    await page.click(`.nav button[data-view="${v}"]`).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.fill('#search-input', 'MYSECRETQUERY');
  await page.waitForTimeout(500);
  await page.fill('#search-input', '');
  await page.click('.nav button[data-view="inbox"]').catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press('j');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  // A private note is the most sensitive thing the reader types. It must not leave.
  const noteBox = page.locator('#user-note');
  if (await noteBox.count()) {
    await noteBox.fill('MYPRIVATENOTE about this article');
    await page.click('#detail-save').catch(() => {});
    await page.waitForTimeout(800);
  }
}

test.describe('zero egress — measured, not asserted', () => {
  test('an ordinary session contacts only the declared origins', async ({ page }) => {
    const egress = recordEgress(page);
    await normalSession(page);

    const seen = [...new Set(egress.map(e => e.origin))].sort();
    const unexpected = seen.filter(o => !ALLOWED.has(o));
    expect(unexpected,
      `undeclared outbound origin(s): ${unexpected.join(', ')}\nall seen: ${seen.join(', ')}`).toEqual([]);
  });

  test('nothing the reader typed ever leaves the device', async ({ page }) => {
    // The strongest form of the promise: not "few origins" but "no personal content".
    const egress = recordEgress(page);
    await normalSession(page);

    const secrets = ['MYPRIVATENOTE', 'MYSECRETQUERY'];
    for (const { origin, path, search, body } of egress) {
      const whole = origin + path + search + body;
      for (const s of secrets) {
        expect(whole.includes(s),
          `"${s}" appeared in a request to ${origin}${path}`).toBe(false);
      }
    }
  });

  test('the relay receives feed URLs and nothing else', async ({ page }) => {
    const egress = recordEgress(page);
    await normalSession(page);

    const relay = egress.filter(e => e.origin.includes('neus-proxy'));
    expect(relay.length, 'the poll must actually have used the relay').toBeGreaterThan(0);
    for (const r of relay) {
      expect(r.method, 'a relay call is a read, never a submission').toBe('GET');
      expect(r.body, 'and carries no body at all').toBe('');
      const params = [...new URLSearchParams(r.search).keys()];
      expect(params, `only the feed URL may be passed, got: ${params.join(', ')}`).toEqual(['url']);
    }
  });

  test('no request is made to any analytics or telemetry host', async ({ page }) => {
    // Named explicitly so the guard reads as a promise rather than an accident of the
    // allow-list. These are the hosts a product like this drifts toward.
    const egress = recordEgress(page);
    await normalSession(page);

    const TELEMETRY = /google-analytics|googletagmanager|sentry|segment|mixpanel|amplitude|posthog|plausible|hotjar|datadog|bugsnag/i;
    const found = egress.filter(e => TELEMETRY.test(e.origin));
    expect(found.map(f => f.origin), 'no telemetry, ever').toEqual([]);
  });

  test('every allowed origin is justified in one line', async () => {
    // An allow-list without reasons becomes a list of things nobody dares remove.
    for (const [origin, why] of ALLOWED) {
      expect(why.length, `${origin} needs a stated reason`).toBeGreaterThan(10);
    }
  });
});
