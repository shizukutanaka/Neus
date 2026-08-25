// Neus — データベースを開けないときの振る舞いを固定する (round 81)
//
// round 80 で「書けなくなったら何が起きるか」を問うたので、その手前を問うた:
// **そもそも開けなかったら何が起きるか。**
//
// 2つの実欠陥が出た。
//
// ## 1. `blocked` を拾っていなかった(画面が空のまま永久に待つ)
//
// `indexedDB.open()` の終わり方は success / error の2つではなく、**`blocked` を含む3つ**。
// 別タブが古い版の接続を握ったまま新しいタブが版を上げようとすると `blocked` が発火し、
// success も error も来ない。拾っていなかったので Promise は永久に未解決だった。
//
//   実測(blocked だけが発火する忠実な代役):
//     通知      : なし
//     モーダル  : なし
//     本文      : ""  ← 空のまま、理由も分からない
//
// タブを2つ開くのはウェブアプリでは日常的で、しかもこれは PWA である。
//
// 直し方は**報告ではなく消去**を選んだ。接続を持っている側に `onversionchange` を付けて
// 自分から手放させれば、相手の `blocked` はひとりでに解ける。`onblocked` 側の通知は、
// 相手が古いビルド(= `onversionchange` を持たない)だったときのための保険として残す。
// `blocked` で reject しないのは、相手が閉じれば open は続行するため — 待ちは残して
// 理由だけ伝えるのが正しい。
//
// ## 2. 原因を分けずに「全データを消すか」と訊いていた
//
// open 失敗時、アプリは常に「データベースの初期化に失敗しました。データを削除して
// 再生成しますか?」と訊いていた。しかし**保存領域そのものが使えない**とき
// (プライベートウィンドウ / サイトデータのブロック / 権限拒否)は削除しても直らない。
//
//   実測: 承諾 → deleteDatabase → 再 open → **同じ失敗**(`初期化に失敗しました: denied`)
//
// つまり**何の役にも立たない全データ消去に同意させていた**。後で設定を戻したときに戻って
// くるはずだったデータは、そのとき既に無い。破壊的な手当ては、それが効きうる原因に限る。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const p = (req.url || '/').split('?')[0];
    const f = join(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    try {
      const b = await readFile(f);
      res.writeHead(200, { 'content-type': extname(f) === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));

/** Record every toast from the first paint, before app code runs. */
const recordToasts = () => {
  window.__toasts = [];
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      const t = document.querySelector('#toast');
      if (t && t.textContent && t.textContent.trim()) window.__toasts.push(t.textContent.trim());
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
};
const toasts = (page) => page.evaluate(() => [...new Set(window.__toasts || [])]);

test.describe('another tab holds the database open', () => {
  test('the reader is told why, instead of staring at an empty screen', async ({ page }) => {
    await page.addInitScript(recordToasts);
    await page.addInitScript(() => {
      // Faithful stand-in for a real block: 'blocked' fires and nothing else ever does.
      indexedDB.open = function () {
        const t = new EventTarget();
        t.onsuccess = null; t.onerror = null; t.onblocked = null; t.onupgradeneeded = null;
        queueMicrotask(() => {
          const e = new Event('blocked');
          t.dispatchEvent(e);
          if (typeof t.onblocked === 'function') t.onblocked(e);
        });
        return t;
      };
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const seen = await toasts(page);
    expect(seen.some(t => /another tab|別のタブ/.test(t)), `no explanation among:\n${seen.join('\n')}`).toBe(true);
    const msg = seen.find(t => /another tab|別のタブ/.test(t));
    expect(msg, 'and it must say what to do about it').toMatch(/close|閉じる/);
  });

  test('the holding tab yields so the block resolves itself', async () => {
    // Reporting the problem is the fallback. Not having it is the fix: a tab that owns the
    // connection closes it when another tab needs a newer version.
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('db.onversionchange=()=>{');
    expect(html, 'it must actually release the connection').toMatch(/db\.onversionchange=\(\)=>\{\s*try\{db\.close\(\);\}catch\{\}/);
    expect(html, 'and tell that tab it now needs reloading').toMatch(/reload this tab|再読み込み/);
  });

  test('blocked does not reject — the open still completes if the other tab closes', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const at = html.indexOf('req.onblocked=()=>{');
    expect(at, 'onblocked must be handled at all').toBeGreaterThan(-1);
    const handler = html.slice(at, at + 400);
    expect(handler, 'rejecting here would give up on a wait that can still succeed')
      .not.toContain('reject(');
  });
});

test.describe('storage is unavailable on this device', () => {
  const denyOpen = () => {
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (...a) {
      const req = real(...a);
      queueMicrotask(() => {
        try {
          const e = new DOMException('denied', 'UnknownError');
          Object.defineProperty(req, 'error', { value: e, configurable: true });
          req.dispatchEvent(new Event('error', { bubbles: true }));
        } catch { /* already settled */ }
      });
      return req;
    };
  };

  test('the reader is never asked to delete data that deletion cannot save', async ({ page }) => {
    await page.addInitScript(recordToasts);
    await page.addInitScript(denyOpen);
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const asked = await page.locator('#modal-confirm.show').count();
    expect(asked, 'offering to destroy everything cannot help when storage is blocked').toBe(0);
  });

  test('and is told the actual cause instead', async ({ page }) => {
    await page.addInitScript(recordToasts);
    await page.addInitScript(denyOpen);
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const seen = await toasts(page);
    const msg = seen.find(t => /storage is unavailable|保存領域を使えません/.test(t));
    expect(msg, `no cause explained among:\n${seen.join('\n')}`).toBeTruthy();
    expect(msg, 'naming the two settings that actually cause this')
      .toMatch(/private browsing|site data|プライベート|サイトデータ/);
  });

  test('a recreatable failure still offers the repair', async () => {
    // The destructive path must not be removed, only aimed. A corrupt or mis-versioned
    // database is exactly the case where discarding it is the way forward.
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('function isRecreatable(err){');
    expect(html).toContain("name==='VersionError'");
    expect(html).toContain('if(!isRecreatable(err)){');
    expect(html, 'the delete-and-recreate branch must still exist for those cases')
      .toContain('indexedDB.deleteDatabase(CONFIG.dbName)');
  });

  test('an unknown failure is treated as not-recreatable', async () => {
    // Guessing wrong in this direction only costs a repair option; guessing wrong the other
    // way destroys someone's data. The default must be the non-destructive one.
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const at = html.indexOf('function isRecreatable(err){');
    const fn = html.slice(at, html.indexOf('\n}', at));
    expect(fn, 'it must be an allow-list of known-recreatable names, not a deny-list')
      .toMatch(/return name==='VersionError'\|\|/);
    expect(fn).not.toMatch(/return true;/);
  });
});
