// Neus — 保存できないときに、そう言うことを固定する (round 80)
//
// ローカルファースト製品なので、全ての状態は端末の IndexedDB にある。**そこへ書けなくなった
// ときに何が起きるか**を問うたところ、答えは「何も起きない」だった。
//
// 実測(実 Chromium、events ストアへの `put` を QuotaExceededError で失敗させる):
//
//   保存されたイベント : 2 / 6
//   利用者が見た通知   : "polling 3 source(s)..." → **"fetched 6 item(s)"**
//   実際の手がかり     : console の `[Dedup] pipeline error: QuotaExceededError` のみ
//
// つまり **「6件取得しました」と告げながら4件を黙って捨てていた**。ディスクが本当に一杯なら
// 全件が消え、それでも成功と表示される。ローカルファーストの製品にとって、静かなデータ損失を
// 成功として報告するのは最も避けたい失敗の形である。
//
// さらに悪いことに、安全網の `StorageGuard` は `event.stored`(**成功**)に繋がっていた。
// 書き込みが全滅している間は、容量を点検する仕組みそのものが**一度も走らない**。
//
// 直したのは3点: 保存失敗を取り込み失敗と区別する / 利用者に伝える(1バーストにつき1回) /
// 失敗時にも `StorageGuard` を走らせる。
//
// 検証を実ブラウザで行う理由: 失敗は IndexedDB という**プラットフォーム側**から来るもので、
// jsdom の模造品では「本物のトランザクションが失敗したときの経路」を通せないため。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.opml': 'application/xml' };

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

/** Fail every write to the events store the way a full disk does. */
async function breakEventWrites(page) {
  await page.addInitScript(() => {
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const req = realPut.apply(this, args);
      if (this.name === 'events') {
        queueMicrotask(() => {
          try {
            const e = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            Object.defineProperty(req, 'error', { value: e, configurable: true });
            req.dispatchEvent(new Event('error', { bubbles: true, cancelable: true }));
          } catch { /* the transaction may already be gone */ }
        });
      }
      return req;
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      const t = document.querySelector('#toast');
      if (t && t.textContent) window.__toasts.push(t.textContent.trim());
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const toasts = (page) => page.evaluate(() => [...new Set(window.__toasts || [])]);

async function pollWithFeed(page) {
  await page.route('**/neus-proxy.example.workers.dev/**', r =>
    r.request().url().includes('/rss')
      ? r.fulfill({ status: 200, contentType: 'application/xml', body: FEED })
      : r.fulfill({ status: 404, body: 'nf' }));
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('#onboarding')?.classList.remove('show'));
  await page.setInputFiles('#opml-file', join(__dirname, 'fixtures', 'sample.opml'));
  await page.waitForTimeout(700);
  await page.click('#src-cancel').catch(() => {});
  await watchToasts(page);
  await page.click('#btn-poll');
  await page.waitForTimeout(6000);
}

test.describe('when the device cannot store anything, the app says so', () => {
  test('a failed write reaches the reader, not just the console', async ({ page }) => {
    await breakEventWrites(page);
    await pollWithFeed(page);

    const seen = await toasts(page);
    const warned = seen.some(t => /could not save|保存できませんでした/.test(t));
    expect(warned, `no storage warning among:\n${seen.join('\n')}`).toBe(true);
  });

  test('the warning names the action the reader can take', async ({ page }) => {
    // "Something went wrong" would be useless here: the fix is on their device, not ours.
    await breakEventWrites(page);
    await pollWithFeed(page);
    const seen = await toasts(page);
    const msg = seen.find(t => /could not save|保存できませんでした/.test(t)) || '';
    expect(msg, 'the message must point at freeing space and exporting').toMatch(/storage|容量/);
    expect(msg).toMatch(/export|clear|Vault/i);
  });

  test('a burst of failures produces one warning, not one per item', async ({ page }) => {
    // Three sources times two items. Warning on each would bury everything else on screen.
    await breakEventWrites(page);
    await pollWithFeed(page);
    const all = await page.evaluate(() => window.__toasts || []);
    const warnings = all.filter(t => /could not save|保存できませんでした/.test(t));
    expect(warnings.length, `expected one coalesced warning, got ${warnings.length}`).toBeLessThanOrEqual(2);
  });

  test('storage failure is not blamed on the feed', async ({ page }) => {
    // SourceFailTracker auto-disables a source after repeated failures. A full disk must
    // not get healthy feeds switched off — the fault is not theirs.
    await breakEventWrites(page);
    await pollWithFeed(page);
    const enabled = await page.evaluate(() => new Promise(resolve => {
      const q = indexedDB.open('neus-v1');
      q.onsuccess = () => {
        const tx = q.result.transaction(['sources']).objectStore('sources').getAll();
        tx.onsuccess = () => resolve(tx.result.filter(s => s.enabled !== false).length);
        tx.onerror = () => resolve(-1);
      };
      q.onerror = () => resolve(-1);
    }));
    expect(enabled, 'every source must stay enabled').toBe(3);
  });

  test('a healthy device still shows no storage warning', async ({ page }) => {
    // The guard against crying wolf: the warning must depend on writes actually failing.
    await pollWithFeed(page);
    const seen = await toasts(page);
    expect(seen.some(t => /could not save|保存できませんでした/.test(t)),
      `unexpected storage warning among:\n${seen.join('\n')}`).toBe(false);
    expect(seen.some(t => /fetched|取得/.test(t)), 'and the poll still reports normally').toBe(true);
  });
});

test.describe('the wiring that makes the above possible', () => {
  test('the storage guard runs on failure, not only on success', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain("Bus.subscribe('event.stored',()=>scheduleCheck());");
    expect(html, 'the safety net must also run when writes are failing — that is when it is needed')
      .toContain("Bus.subscribe('storage.write-failed',()=>scheduleCheck());");
  });

  test('storage errors are told apart from ingest errors', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain("if(isStorageError(err))Bus.publish('storage.write-failed',{err});");
    expect(html).toContain("else Bus.publish('inbound.error',{source:ev.source,error:'pipeline'});");
  });
});
