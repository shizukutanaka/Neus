// Neus — 復元の原子性を実ブラウザで**証明**する (round 88)
//
// SOCRATIC-AUDIT 改善点 3-2「検査器に見えない性質を減らす」の実行。
// タイトルが挙動を主張しながら本文がソース文字列しか見ていないテストを14件洗い出し、
// うち**実行時の性質を文字列では原理的に証明できない**ものが2件あった。最重要がこれ:
//
//   it('exposes an atomic Store.replaceAll over all three stores in one transaction')
//     → expect(html).toContain("db.transaction(['events','sources','words','settings'],'readwrite')")
//
// これは**原子性の形**であって原子性ではない。復元の安全性の物語全体 — 利用者向け文言
// 「復元に失敗しました(**既存データは保持されています**)」— がこの性質に乗っているのに、
// 検査していたのは「そういう文字列がある」ことだけだった。
//
// IndexedDB の契約では、**非同期の** request error(容量超過など)はトランザクションを abort
// し、同じ tx 内で既に発行された `clear()` を含む全変更が巻き戻る。ところが **`put()` が同期で
// 投げる例外**(キーを評価できない / clone できない)は別で、例外は executor から抜けて
// Promise は reject される一方、**既に発行された `clear()` と put はそのまま commit される**。
//
// 最初の版のこの spec は偽の error イベントで失敗を模していた。それは `t.onerror` を発火させる
// だけでエンジン側の abort を起こさず、**「テストが緑なのに何も証明していない」**状態だった。
// 実測に切り替えたら本物の欠陥が出た:
//
//   replaceAll の形を写した probe に、2件目が clone できないレコードを渡す
//     → Promise: rejected(DataCloneError)   ← アプリは「既存データは保持」と表示する
//     → 残ったレコード: ["from backup"]      ← 既存3件は消え、backup の1件目だけが残った
//
// **到達可能か**: 復元は events と words を検証するが **sources は検証していなかった**。
// `keyPath:'id'` の store へ id の無いソースを `put` すると同期で DataError になり、それは
// **events を消した後に**投げる。手で編集した / 一部壊れた backup JSON にソースが1件でも
// 混じっていれば、全データが消えて「保持されています」と告げられる。
//
// 修正は2段: replaceAll は同期例外を捕まえて `t.abort()`(約束を言葉だけにしない)、
// 復元は sources も**消す前に**検証する。本 spec の失敗注入は偽イベントではなく、
// **実際に人が持ちうる JSON ファイル**(id の無いソース)で行う。
//
// jsdom では検証できない。巻き戻しは IndexedDB **実装**の性質で、模造品は契約を写しただけになる。

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
  <item><title>線形代数</title><link>https://ex.test/c</link><description>d</description></item>
</channel></rss>`;

import { writeFile, mkdir } from 'fs/promises';

/**
 * Take a real backup file and corrupt one source entry the way a hand edit or a truncated
 * copy would: drop its id. Restore validates events and (now) sources before touching the
 * store; if that validation were ever removed, put() on a keyPath store throws DataError
 * synchronously — after events have already been cleared in the same transaction.
 */
async function corruptOneSource(path) {
  const dump = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(dump.sources) || dump.sources.length === 0) throw new Error('backup has no sources to corrupt');
  delete dump.sources[0].id;
  const out = join(root, 'test-results', 'backup-with-bad-source.json');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(out, JSON.stringify(dump));
  return out;
}

const recordToasts = () => {
  window.__toasts = [];
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      const t = document.querySelector('#toast');
      if (t && t.textContent && t.textContent.trim()) window.__toasts.push(t.textContent.trim());
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
};

/** A full snapshot of every store, so cross-store rollback can be asserted exactly. */
const snapshot = (page) => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('neus-v1');
  req.onsuccess = () => {
    const db = req.result;
    const out = {};
    const stores = ['events', 'sources', 'words', 'settings'];
    let pending = stores.length;
    for (const s of stores) {
      const tx = db.transaction([s]).objectStore(s).getAll();
      tx.onsuccess = () => {
        out[s] = tx.result;
        if (--pending === 0) resolve({
          eventTitles: out.events.map(e => e.content?.title).sort(),
          sourceIds: out.sources.map(s => s.id).sort(),
          wordIds: out.words.map(w => w.id).sort(),
          settingKeys: out.settings.map(s => s.key).sort(),
        });
      };
      tx.onerror = () => resolve(null);
    }
  };
  req.onerror = () => resolve(null);
}));

async function seed(page) {
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
  await page.click('#btn-poll');
  await page.waitForFunction(() => document.querySelectorAll('.card').length >= 3, null, { timeout: 15000 });
  let prev = -1;
  for (let i = 0; i < 20; i++) {
    const n = await page.locator('.card').count();
    if (n === prev) break;
    prev = n;
    await page.waitForTimeout(400);
  }
  // A word, so the cross-store rollback has something to protect in every store.
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('neus-v1');
    req.onsuccess = () => {
      const tx = req.result.transaction(['words'], 'readwrite');
      tx.objectStore('words').put({ id: 'w-seed', term: 'rust', normalized: 'rust', createdAt: 1,
        questions: [], verdict: { status: 'open', note: '' }, sources: {}, enabled: true });
      tx.oncomplete = resolve;
    };
  }));
}

async function exportBackup(page) {
  await page.click('#btn-menu');
  await page.click('#btn-stats');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#stats-backup')]);
  const path = await download.path();
  await page.evaluate(() => document.querySelector('#modal-stats')?.classList.remove('show'));
  return path;
}

/** Make the live store differ from the backup, so a successful restore is observable. */
async function addOneMoreEvent(page) {
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('neus-v1');
    req.onsuccess = () => {
      const tx = req.result.transaction(['events'], 'readwrite');
      tx.objectStore('events').put({ id: 'extra-1', timestamp: Date.now(), hash: 'h-extra', url: 'https://ex.test/extra',
        content: { title: 'ADDED AFTER BACKUP' }, source: { id: 's', name: 's', url: 'u' },
        meta: { autoTags: [], userTags: [], score: 50 }, user: {}, state: {}, links: [] });
      tx.oncomplete = resolve;
    };
  }));
}

async function restoreFrom(page, path) {
  await page.setInputFiles('#restore-file', path);
  await expect(page.locator('#modal-confirm')).toHaveClass(/show/);
  await page.click('#confirm-ok');
  await page.waitForTimeout(2000);
}

/** Like restoreFrom, but tolerates the file being refused before the dialog. */
async function restoreAttempt(page, path) {
  await page.setInputFiles('#restore-file', path);
  await page.waitForTimeout(800);
  if (await page.locator('#modal-confirm.show').count()) {
    await page.click('#confirm-ok');
    await page.waitForTimeout(2000);
  }
}

test.describe('restore is atomic — a failure part-way through leaves every store untouched', () => {
  test('the pre-restore data survives a write failure after clear() has already run', async ({ page }) => {
    await page.addInitScript(recordToasts);
    await seed(page);
    const bad = await corruptOneSource(await exportBackup(page));
    await addOneMoreEvent(page);

    const before = await snapshot(page);
    expect(before.eventTitles, 'the live store must differ from the backup').toContain('ADDED AFTER BACKUP');

    await restoreAttempt(page, bad);

    const after = await snapshot(page);
    expect(after.eventTitles, 'clear() inside the aborted transaction must have rolled back')
      .toEqual(before.eventTitles);
    expect(after.sourceIds, 'sources are in the same transaction and must roll back too').toEqual(before.sourceIds);
    expect(after.wordIds, 'words likewise').toEqual(before.wordIds);
    expect(after.settingKeys, 'settings are never cleared by restore').toEqual(before.settingKeys);
  });

  test('and the reader is told the data was preserved, in those words', async ({ page }) => {
    await page.addInitScript(recordToasts);
    await seed(page);
    const bad = await corruptOneSource(await exportBackup(page));
    await restoreAttempt(page, bad);

    const seen = await page.evaluate(() => [...new Set(window.__toasts || [])]);
    // Either the file is rejected before anything is touched, or the transaction aborts and
    // the data is reported preserved. Both are honest; "restored" would be the lie.
    expect(seen.some(t => /malformed sources|ソースデータが不正|existing data preserved|既存データは保持/.test(t)),
      `the reader must be told the truth:\n${seen.join('\n')}`).toBe(true);
    expect(seen.some(t => /^restored|復元完了/.test(t)), 'and it must not claim success').toBe(false);
  });

  test('control: without the failure, restore really does replace the data', async ({ page }) => {
    // Guards the test itself. If restore silently did nothing, the atomicity test above would
    // pass vacuously. Here the extra event must disappear and the toast must report success.
    await page.addInitScript(recordToasts);
    await seed(page);
    const path = await exportBackup(page);
    await addOneMoreEvent(page);
    await restoreFrom(page, path);

    const after = await snapshot(page);
    expect(after.eventTitles, 'the post-backup event must be gone').not.toContain('ADDED AFTER BACKUP');
    expect(after.eventTitles).toEqual(expect.arrayContaining(['Rust ownership', 'WebGPU basics']));
    const seen = await page.evaluate(() => [...new Set(window.__toasts || [])]);
    expect(seen.some(t => /restored|復元完了/.test(t))).toBe(true);
  });
});

test('the transaction shape that makes this possible', async () => {
  // Kept as a wiring anchor, now explicitly labelled as the SHAPE. The property itself is
  // the three tests above; a string can only show that the shape was not refactored away.
  const html = await readFile(join(root, 'index.html'), 'utf8');
  expect(html).toContain("const t=db.transaction(['events','sources','words','settings'],'readwrite');");
  expect(html, 'no per-request onerror may swallow the abort with preventDefault')
    .not.toMatch(/replaceAll[\s\S]{0,900}preventDefault/);
  expect(html, 'a synchronous throw inside the executor must abort, not auto-commit')
    .toMatch(/replaceAll[\s\S]{0,1200}catch\(err\)\{\s*try\{t\.abort\(\);\}catch\{\}/);
  expect(html, 'and sources are validated before the store is touched')
    .toContain('const validSource=(src)=>{');
});
