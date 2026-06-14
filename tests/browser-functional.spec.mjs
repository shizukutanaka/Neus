// Neus — REAL functional E2E in Chromium
// Unlike static checks, this ACTUALLY RUNS: IndexedDB, WebCrypto, FTS, KeywordRules, dedup.
// This verifies the product WORKS, not just that code is present.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + join(__dirname, '..', 'index.html') + '?test=1';

// Wait for the test hook to be ready
async function gotoApp(page) {
  const ready = page.waitForEvent('console', { predicate: m => m.text().includes('[Neus] ready'), timeout: 8000 }).catch(() => {});
  await page.goto(fileUrl);
  await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
  await ready;
}

test.describe('Real Chromium — WebCrypto (actual encryption)', () => {
  test('AES-GCM encrypt/decrypt round-trips a real API key', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const { Crypto } = window.__neus;
      const key = 'sk-ant-api03-SECRET-key-12345';
      const enc = await Crypto.encrypt(key, 'my-passphrase');
      const dec = await Crypto.decrypt(enc, 'my-passphrase');
      return { enc, dec, original: key, isB64: /^[A-Za-z0-9+/=]+$/.test(enc) };
    });
    expect(result.dec).toBe(result.original);
    expect(result.enc).not.toBe(result.original);
    expect(result.isB64).toBe(true);
  });

  test('decrypt fails with wrong passphrase (real GCM auth)', async ({ page }) => {
    await gotoApp(page);
    const failed = await page.evaluate(async () => {
      const { Crypto } = window.__neus;
      const enc = await Crypto.encrypt('secret', 'correct-pass');
      try { await Crypto.decrypt(enc, 'wrong-pass'); return false; }
      catch { return true; }
    });
    expect(failed).toBe(true);
  });
});

test.describe('Real Chromium — IndexedDB (actual persistence)', () => {
  test('putEvent then getEvent returns the same event', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = {
        id: 'e2e-test-1', timestamp: Date.now(),
        source: { id: 's1', type: 'rss', name: 'Test Source' },
        content: { title: 'E2E Test Event', snippet: 'snippet', summary: '' },
        meta: { autoTags: ['test'], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/e2e', hash: 'e2e-hash-1',
      };
      await Store.putEvent(ev);
      const back = await Store.getEvent('e2e-test-1');
      return { title: back?.content.title, score: back?.meta.score };
    });
    expect(result.title).toBe('E2E Test Event');
    expect(result.score).toBe(50);
  });

  test('data persists across page reload (real IndexedDB durability)', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(async () => {
      const { Store } = window.__neus;
      await Store.putEvent({
        id: 'persist-1', timestamp: Date.now(),
        source: { id: 's1', type: 'rss', name: 'Persist' },
        content: { title: 'Persisted Event', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 60 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/persist', hash: 'persist-hash',
      });
    });
    // Reload and verify
    await gotoApp(page);
    const title = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = await Store.getEvent('persist-1');
      return ev?.content.title;
    });
    expect(title).toBe('Persisted Event');
  });
});

test.describe('Real Chromium — FTS (actual search)', () => {
  test('indexed event is findable by full-text search', async ({ page }) => {
    await gotoApp(page);
    const hits = await page.evaluate(async () => {
      const { Store, FTSIndex } = window.__neus;
      const ev = {
        id: 'fts-1', timestamp: Date.now(),
        source: { id: 's1', type: 'rss', name: 'Search Test' },
        content: { title: 'Rust async programming guide', snippet: 'about tokio', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/fts', hash: 'fts-hash',
      };
      await Store.putEvent(ev);
      FTSIndex.add(ev);
      return FTSIndex.search('rust async');
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => h.id === 'fts-1')).toBe(true);
  });

  test('non-matching query returns no hits', async ({ page }) => {
    await gotoApp(page);
    const hits = await page.evaluate(async () => {
      const { FTSIndex } = window.__neus;
      return FTSIndex.search('zzzznonexistentqueryzzz');
    });
    expect(hits).toEqual([]);
  });
});

test.describe('Real Chromium — KeywordRules (actual rule engine)', () => {
  test('watch rule highlights matching event', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const { KeywordRules } = window.__neus;
      const ev = {
        id: 'kw-1', timestamp: Date.now(),
        source: { id: 's1', type: 'rss', name: 'KW' },
        content: { title: 'New Rust release', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/kw', hash: 'kw-hash',
      };
      await KeywordRules.replaceRules({
        watch: [{ pattern: 'rust', mode: 'contains', scope: 'all', case: false, action: 'highlight' }],
        block: [],
      });
      const matched = KeywordRules.evaluate(ev);
      KeywordRules.apply(ev, matched);
      // cleanup
      await KeywordRules.replaceRules({ watch: [], block: [] });
      return { score: ev.meta.score, matched: matched.watch.length };
    });
    expect(result.matched).toBe(1);
    expect(result.score).toBe(80); // 50 + 30 highlight
  });

  test('block delete rule signals skip', async ({ page }) => {
    await gotoApp(page);
    const skip = await page.evaluate(async () => {
      const { KeywordRules } = window.__neus;
      const ev = {
        id: 'kw-2', timestamp: Date.now(),
        source: { id: 's1', type: 'rss', name: 'KW' },
        content: { title: 'crypto airdrop scam', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/kw2', hash: 'kw-hash-2',
      };
      await KeywordRules.replaceRules({
        watch: [],
        block: [{ pattern: 'crypto', mode: 'contains', scope: 'all', case: false, action: 'delete' }],
      });
      const matched = KeywordRules.evaluate(ev);
      const result = KeywordRules.apply(ev, matched);
      await KeywordRules.replaceRules({ watch: [], block: [] });
      return result;
    });
    expect(skip).toBe(true);
  });
});

test.describe('Real Chromium — Dedup primitives (actual hashing)', () => {
  test('sha256 produces stable 64-char hex', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const { Dedup } = window.__neus;
      const h1 = await Dedup.sha256('hello world');
      const h2 = await Dedup.sha256('hello world');
      const h3 = await Dedup.sha256('different');
      return { h1, equal: h1 === h2, different: h1 !== h3, len: h1.length };
    });
    expect(result.equal).toBe(true);
    expect(result.different).toBe(true);
    expect(result.len).toBe(64);
  });

  test('jaccard similarity detects near-duplicates', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const { Dedup } = window.__neus;
      const a = new Set(Dedup.tokenize('the quick brown fox jumps'));
      const b = new Set(Dedup.tokenize('the quick brown fox leaps'));
      const c = new Set(Dedup.tokenize('completely different sentence here'));
      return { similar: Dedup.jaccard(a, b), dissimilar: Dedup.jaccard(a, c) };
    });
    expect(result.similar).toBeGreaterThan(0.5);
    expect(result.dissimilar).toBeLessThan(0.2);
  });
});

test.describe('Real Chromium — full pipeline (Bus integration)', () => {
  test('publishing inbound.fetched flows through to stored event', async ({ page }) => {
    await gotoApp(page);
    const stored = await page.evaluate(async () => {
      const { Bus, Store } = window.__neus;
      return await new Promise((resolve) => {
        let done = false;
        const unsub = Bus.subscribe('event.stored', (ev) => {
          if (ev.content.title === 'Pipeline Test Article' && !done) {
            done = true;
            resolve({ id: ev.id, title: ev.content.title, hasHash: !!ev.hash });
          }
        });
        Bus.publish('inbound.fetched', {
          raw: {
            title: 'Pipeline Test Article',
            link: 'https://example.com/pipeline-test',
            summary: 'A test of the full ingestion pipeline',
            publishedAt: Date.now(),
            author: 'tester',
          },
          source: { id: 'pipe', type: 'rss', name: 'Pipeline Source' },
        });
        setTimeout(() => { if (!done) resolve(null); }, 5000);
      });
    });
    expect(stored).not.toBeNull();
    expect(stored.title).toBe('Pipeline Test Article');
    expect(stored.hasHash).toBe(true);
  });
});

test.describe('Real Chromium — InterestProfile (implicit interest learning)', () => {
  test('star learns positive, archive learns negative, boosts new events', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(async () => {
      const { InterestProfile } = window.__neus;
      await InterestProfile.reset();
      const mk = (id, title) => ({
        id, timestamp: Date.now(), source: { id: 's', type: 'rss', name: 'S' },
        content: { title, snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'u' + id, hash: 'h' + id,
      });
      for (let i = 0; i < 3; i++) await InterestProfile.learn(mk('r' + i, 'rust async programming tokio'), 'pos', 1);
      for (let i = 0; i < 3; i++) await InterestProfile.learn(mk('c' + i, 'crypto nft airdrop scam'), 'neg', 1);
      return {
        rust: InterestProfile.scoreBoost(mk('n1', 'rust webassembly tutorial')),
        crypto: InterestProfile.scoreBoost(mk('n2', 'crypto airdrop guide')),
        neutral: InterestProfile.scoreBoost(mk('n3', 'cooking recipe pasta')),
      };
    });
    expect(r.rust).toBeGreaterThan(0);
    expect(r.crypto).toBeLessThan(0);
    expect(r.neutral).toBe(0);
  });

  test('unstar cancels the learned positive signal', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(async () => {
      const { InterestProfile } = window.__neus;
      await InterestProfile.reset();
      const ev = {
        id: 'u1', timestamp: Date.now(), source: { id: 's', type: 'rss', name: 'S' },
        content: { title: 'unique topic xyzzy', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'u1', hash: 'h1',
      };
      await InterestProfile.learn(ev, 'pos', 1);
      const after = InterestProfile.stats().vocab;
      await InterestProfile.learn(ev, 'pos', -1);
      const undo = InterestProfile.stats().vocab;
      return { after, undo };
    });
    expect(r.after).toBeGreaterThan(0);
    expect(r.undo).toBe(0);
  });

  test('learned profile persists across reload', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(async () => {
      const { InterestProfile } = window.__neus;
      await InterestProfile.reset();
      await InterestProfile.learn({
        id: 'p1', timestamp: Date.now(), source: { id: 's', type: 'rss', name: 'S' },
        content: { title: 'persistent rust signal', snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [] }, user: {},
        state: { read: false, starred: false, archived: false }, links: [], url: 'p1', hash: 'hp1',
      }, 'pos', 1);
    });
    await gotoApp(page);
    const vocab = await page.evaluate(async () => {
      const { InterestProfile } = window.__neus;
      await InterestProfile.load();
      return InterestProfile.stats().vocab;
    });
    expect(vocab).toBeGreaterThan(0);
  });
});

test.describe('Real Chromium — feed parsing (tolerant/bozo pattern)', () => {
  test('decodes HTML entities in title', async ({ page }) => {
    await gotoApp(page);
    const title = await page.evaluate(() => {
      const xml = '<?xml version="1.0"?><rss><channel><item><title>Rust &amp; Go</title><link>https://x.com/1</link></item></channel></rss>';
      return window.__neus.RSSPoller.parseFeed(xml, { id: 't', name: 'T', url: 'x' })[0]?.raw.title;
    });
    expect(title).toBe('Rust & Go');
  });

  test('extracts enclosure media', async ({ page }) => {
    await gotoApp(page);
    const media = await page.evaluate(() => {
      const xml = '<?xml version="1.0"?><rss><channel><item><title>Pod</title><link>https://x.com/1</link><enclosure url="https://x.com/a.mp3" type="audio/mpeg"/></item></channel></rss>';
      return window.__neus.RSSPoller.parseFeed(xml, { id: 't', name: 'T', url: 'x' })[0]?.raw.media;
    });
    expect(media.url).toBe('https://x.com/a.mp3');
    expect(media.type).toBe('audio/mpeg');
  });

  test('tolerant: salvages valid items, strips HTML from summary', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => {
      const xml = '<?xml version="1.0"?><rss><channel>'
        + '<item><title>One</title><link>https://x.com/1</link><description>&lt;p&gt;hello&lt;/p&gt;</description></item>'
        + '<item><title>Two</title><link>https://x.com/2</link></item>'
        + '</channel></rss>';
      const items = window.__neus.RSSPoller.parseFeed(xml, { id: 't', name: 'T', url: 'x' });
      return { count: items.length, summary: items[0].raw.summary };
    });
    expect(r.count).toBe(2);
    expect(r.summary).toBe('hello');
  });

  test('parses Atom feed', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => {
      const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom Post</title><link href="https://x.com/2"/><summary>text</summary></entry></feed>';
      const items = window.__neus.RSSPoller.parseFeed(xml, { id: 't', name: 'T', url: 'x' });
      return { title: items[0]?.title, link: items[0]?.raw.link, count: items.length };
    });
    expect(r.count).toBe(1);
    expect(r.link).toBe('https://x.com/2');
  });
});
