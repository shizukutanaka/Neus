// Neus — データが「残る保証があるか」を利用者に見せることを固定する (round 82)
//
// round 80/81 は「プラットフォームが拒んだとき何と言うか」を問うた。その系統の最後に、
// **何も拒まれていないのに黙っている**箇所が残っていた。
//
// この製品の約束は「あなたのデータは端末の中だけにある」。ところが端末にあることは
// **残ることを意味しない**。`navigator.storage.persist()` が許可されていなければ、ブラウザは
// 容量逼迫時に**このオリジンのデータを丸ごと退避(削除)しうる**。
//
//   実測(通常の Chromium セッション):
//     navigator.storage.persisted()  ->  false
//     STATS の表示                   ->  "Storage | 0.0MB / 0.9GB"
//     永続化への言及                 ->  **どこにも無い**(console にすら出ない)
//
// つまり**データが消えうる状態であることを、利用者は知る術がなかった**。容量は見せていて
// 保持は見せていない、という抜けである。ローカルファーストを謳う製品にとって、
// 「どれだけ入るか」より「消えないか」の方が重要な事実になりうる。
//
// 起動時のトーストにはしなかった。毎回出れば読まれなくなるし、その瞬間に打てる手も無い。
// **容量を見に来た場所**に、状態と**次にできること**を並べて置く。

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

/** Force what the platform reports about persistence, before app code runs. */
const stubPersisted = (value) => (page) => page.addInitScript((v) => {
  if (v === 'missing') {
    Object.defineProperty(navigator.storage, 'persisted', { value: undefined, configurable: true });
    return;
  }
  Object.defineProperty(navigator.storage, 'persisted', { value: async () => v, configurable: true });
  Object.defineProperty(navigator.storage, 'persist', { value: async () => v, configurable: true });
}, value);

async function openStats(page) {
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#onboarding')?.classList.remove('show'));
  await page.click('#btn-menu');
  await page.click('#btn-stats');
  await expect(page.locator('#modal-stats')).toHaveClass(/show/);
  return page.locator('#modal-stats').innerText();
}

test.describe('STATS reports whether the data will actually be kept', () => {
  test('says so when the browser has NOT promised to keep it', async ({ page }) => {
    await stubPersisted(false)(page);
    const text = await openStats(page);
    expect(text, `no durability line in:\n${text}`).toMatch(/not persistent|未永続化/);
  });

  test('and names what the reader can do about it', async ({ page }) => {
    // State alone is not actionable. Installing the PWA is what grants persistence.
    await stubPersisted(false)(page);
    const text = await openStats(page);
    expect(text).toMatch(/installing helps|インストールすると改善/);
  });

  test('says so when the browser HAS promised', async ({ page }) => {
    await stubPersisted(true)(page);
    const text = await openStats(page);
    expect(text).toMatch(/persistent — will not be evicted|永続化済み/);
    expect(text, 'and must not simultaneously warn').not.toMatch(/not persistent|未永続化/);
  });

  test('admits when the browser cannot report it, rather than guessing', async ({ page }) => {
    // Claiming "safe" on an older browser would be the worst of the three answers.
    await stubPersisted('missing')(page);
    const text = await openStats(page);
    expect(text).toMatch(/cannot report it|判定できません/);
    expect(text).not.toMatch(/will not be evicted|永続化済み/);
  });

  test('the durability line sits with the storage figures, not somewhere else', async ({ page }) => {
    await stubPersisted(false)(page);
    const text = await openStats(page);
    const storageAt = text.search(/Storage|ストレージ/);
    const durabilityAt = text.search(/Data retention|データの保持/);
    expect(storageAt).toBeGreaterThan(-1);
    expect(durabilityAt).toBeGreaterThan(storageAt);
    expect(durabilityAt - storageAt, 'it belongs next to capacity, where the reader is already looking')
      .toBeLessThan(120);
  });

  test('nothing is toasted at startup about it', async ({ page }) => {
    // A warning on every launch stops being read, and there is nothing to do at that moment.
    await stubPersisted(false)(page);
    await page.addInitScript(() => {
      window.__toasts = [];
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => {
          const t = document.querySelector('#toast');
          if (t && t.textContent && t.textContent.trim()) window.__toasts.push(t.textContent.trim());
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const seen = await page.evaluate(() => [...new Set(window.__toasts || [])]);
    expect(seen.some(t => /persistent|永続化/.test(t)), `unexpected startup nag: ${seen.join(' / ')}`).toBe(false);
  });
});

test.describe('the wiring', () => {
  test('the guard reports persistence and distinguishes "unknown" from "no"', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('async function isPersisted(){');
    expect(html, 'a browser that cannot answer must yield null, not false')
      .toContain("if(!navigator.storage?.persisted)return null;");
    expect(html).toContain('scheduleCheck,isPersisted};');
  });

  test('all three durability strings exist in both languages', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    for (const key of ['stats.durability', 'stats.durability.persistent',
                       'stats.durability.evictable', 'stats.durability.unknown']) {
      const uses = html.split(`'${key}'`).length - 1;
      expect(uses, `${key} needs a JA entry, an EN entry and a use`).toBeGreaterThanOrEqual(3);
    }
  });
});
