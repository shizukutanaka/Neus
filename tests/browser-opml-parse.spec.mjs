// Neus — OPML.parse を**実ブラウザの実ソース**で固定する (round 66)
//
// OPML 取り込みは「利用者が選んだ任意の XML ファイル」という数少ない外部入力境界のひとつ。
// 実 Chromium で総当たり的に振る舞いを測った結果は次のとおり:
//
// | 入力                         | 実測結果                                    | 判定 |
// |------------------------------|---------------------------------------------|------|
// | 仕様どおりの `xmlUrl`        | 取り込み成功                                | OK   |
// | **小文字 `xmlurl`**          | **0件**(「OPMLにソースがありません」)      | 欠陥 |
// | XXE(外部エンティティ)      | parse error(ブラウザは外部実体を解決しない)| 安全 |
// | billion laughs(10^9)        | parse error / 11ms                          | 安全 |
// | 不正な XML                   | parse error                                 | 安全 |
// | `javascript:` URL            | parse は返すが取込側 `safeHref` が除外       | 安全 |
//
// **小文字 `xmlurl` は実在する**。XML の属性名は大小を区別するが、HTML パーサは属性名を
// ASCII 小文字化する規則なので、OPML を HTML として一度でも通した道具(cheerio / jsdom /
// BeautifulSoup の HTML モード、text/html で配信されたファイルなど)を経ると `xmlUrl` は
// `xmlurl` になる。この経路は本ラウンドで実測して確認した(下の再現テスト)。
// 修正前はそういうファイルが**無言で0件**になり、しかも「ソースが無い」という誤った
// 診断が出ていた(ファイルにはソースがある)。round 66 で属性を大小無視で読むようにした。
//
// billion laughs は Chromium(libxml2)側の実体展開上限が先に効いて **30,000〜300,000 文字の
// 間で parse error になる**ため、こちら側の追加防御は不要。憶測ではなく測って却下した。
//
// jsdom ではなく実ブラウザで検証する理由: DOMParser の XML 規則(実体展開の上限、属性名の
// 扱い)は実装差が出るところで、本番は実ブラウザで動く。round 57 の decodeEntities と同じ理由。

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractFunction, extractConst } from './helpers/from-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

// The real bytes from index.html — no mirror, so a regression in the source turns these red.
const REAL_SOURCE = [extractFunction('opmlAttr'), extractConst('OPML')].join('\n');

const OUTLINE = (attrs) => `<?xml version="1.0"?><opml version="2.0"><body><outline ${attrs}/></body></opml>`;

async function parse(page, xml) {
  return page.evaluate(([src, x]) => {
    // eslint-disable-next-line no-eval -- deliberate: run the REAL parser, not a copy
    const OPML = eval(`(()=>{${src}\nreturn OPML;})()`);
    try { return { ok: true, out: OPML.parse(x) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, [REAL_SOURCE, xml]);
}

test.describe('OPML.parse — real source in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
  });

  test('reads a spec-conformant file', async ({ page }) => {
    const r = await parse(page, OUTLINE('type="rss" text="HN" xmlUrl="https://news.ycombinator.com/rss"'));
    expect(r.ok).toBe(true);
    expect(r.out).toEqual([{ url: 'https://news.ycombinator.com/rss', name: 'HN' }]);
  });

  test('prefers title over text, per the OPML spec', async ({ page }) => {
    const r = await parse(page, OUTLINE('text="fallback" title="Preferred" xmlUrl="https://a.test/f"'));
    expect(r.out[0].name).toBe('Preferred');
  });

  test('falls back to the hostname when neither title nor text is present', async ({ page }) => {
    const r = await parse(page, OUTLINE('xmlUrl="https://example.com/feed.xml"'));
    expect(r.out[0].name).toBe('example.com');
  });

  test('finds feeds nested inside folder outlines', async ({ page }) => {
    // Every real exporter groups subscriptions under category outlines that carry no xmlUrl.
    const xml = '<opml version="2.0"><body><outline text="Tech">'
      + '<outline type="rss" text="HN" xmlUrl="https://a.test/rss"/></outline></body></opml>';
    const r = await parse(page, xml);
    expect(r.out).toEqual([{ url: 'https://a.test/rss', name: 'HN' }]);
  });

  test('a folder outline with no feed contributes nothing', async ({ page }) => {
    const r = await parse(page, '<opml version="2.0"><body><outline text="Empty folder"/></body></opml>');
    expect(r.out).toEqual([]);
  });

  test('an empty xmlUrl is not imported as a source', async ({ page }) => {
    expect((await parse(page, OUTLINE('text="A" xmlUrl=""'))).out).toEqual([]);
  });
});

test.describe('OPML.parse — attribute-name case (the round-66 defect)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
  });

  test('an HTML round-trip really does lowercase xmlUrl', async ({ page }) => {
    // The mechanism behind the defect, reproduced rather than asserted: HTML parsing
    // ASCII-lowercases attribute names, so any tool that touches OPML as HTML rewrites the file.
    const names = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(
        '<opml version="2.0"><body><outline text="HN" xmlUrl="https://a.test/rss"/></body></opml>', 'text/html');
      return [...doc.querySelector('outline').attributes].map(a => a.name);
    });
    expect(names).toContain('xmlurl');
    expect(names).not.toContain('xmlUrl');
  });

  test('imports a file whose attributes were lowercased', async ({ page }) => {
    const r = await parse(page, OUTLINE('type="rss" text="HN" xmlurl="https://a.test/rss"'));
    expect(r.out, 'lowercase xmlurl must still import').toEqual([{ url: 'https://a.test/rss', name: 'HN' }]);
  });

  test('title and text are matched case-insensitively too', async ({ page }) => {
    const r = await parse(page, OUTLINE('xmlurl="https://a.test/rss" TEXT="Shouty"'));
    expect(r.out[0].name).toBe('Shouty');
  });

  test('the spec spelling still wins when both are somehow present', async ({ page }) => {
    // Not valid XML to repeat an attribute, so the two differ only in case — the exact-match
    // fast path must be what answers, keeping conformant files on the cheap path.
    const r = await parse(page, OUTLINE('xmlUrl="https://spec.test/f" xmlurl2="ignored"'));
    expect(r.out[0].url).toBe('https://spec.test/f');
  });
});

test.describe('OPML.parse — hostile input is rejected by the parser itself', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
  });

  test('malformed XML throws instead of importing garbage', async ({ page }) => {
    const r = await parse(page, '<opml><body><outline xmlUrl="https://a.test/f"></body></opml>');
    expect(r.ok).toBe(false);
    expect(r.err).toBe('opml parse error');
  });

  test('an XXE attempt does not read local files', async ({ page }) => {
    const xml = '<?xml version="1.0"?><!DOCTYPE opml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
      + '<opml version="2.0"><body><outline text="&xxe;" xmlUrl="https://a.test/f"/></body></opml>';
    const r = await parse(page, xml);
    // Browsers do not resolve external entities at all; the reference is simply an error.
    expect(r.ok).toBe(false);
    expect(r.err).toBe('opml parse error');
  });

  test('billion laughs is capped by the browser, not by us', async ({ page }) => {
    // Measured in Chromium: expansion succeeds up to ~30k characters and errors past ~300k,
    // so the classic 10^9 payload is rejected in ~11ms. No hand-rolled guard is warranted.
    const bomb = (levels) => {
      let ents = '<!ENTITY a0 "LOL">';
      for (let i = 1; i <= levels; i++) ents += `<!ENTITY a${i} "${`&a${i - 1};`.repeat(10)}">`;
      return `<?xml version="1.0"?><!DOCTYPE opml [${ents}]>`
        + `<opml version="2.0"><body><outline text="&a${levels};" xmlUrl="https://a.test/f"/></body></opml>`;
    };
    const started = Date.now();
    const r = await parse(page, bomb(9));
    expect(r.ok, 'the 10^9 payload must not be expanded').toBe(false);
    expect(Date.now() - started, 'and must not hang the tab').toBeLessThan(5000);

    // A modest expansion is still allowed, so this is a cap and not a ban on entities.
    const small = await parse(page, bomb(3));
    expect(small.ok).toBe(true);
  });

  test('a javascript: URL survives parse but is the import handler\'s job to drop', async ({ page }) => {
    const r = await parse(page, OUTLINE('text="evil" xmlUrl="javascript:alert(1)"'));
    expect(r.out).toHaveLength(1); // parse is a reader, not a validator
  });
});

test.describe('the wiring that makes parse safe to call', () => {
  test('the import handler filters unsafe schemes before storing a source', async () => {
    // The line above is only harmless because of this guard. If it is ever removed, a
    // javascript: URL from an OPML file would be persisted as a subscription.
    expect(html).toContain("if(safeHref(p.url)==='#'){skipped++;continue;}");
  });

  test('parse still reports failure so the handler can toast "invalid OPML"', async () => {
    expect(html).toContain("throw new Error('opml parse error')");
    expect(html).toContain('parsed=OPML.parse(text);}catch{');
  });

  test('round-trip: what build() writes, parse() reads back', async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    const r = await page.evaluate((src) => {
      const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      // eslint-disable-next-line no-eval -- deliberate: run the REAL implementation
      const OPML = eval(`(()=>{${src}\nreturn OPML;})()`);
      const sources = [{ name: 'A & B', url: 'https://a.test/rss?x=1&y=2' }, { name: '日本語', url: 'https://b.test/f' }];
      return OPML.parse(OPML.build(sources));
    }, REAL_SOURCE);
    expect(r).toEqual([
      { url: 'https://a.test/rss?x=1&y=2', name: 'A & B' },
      { url: 'https://b.test/f', name: '日本語' },
    ]);
  });
});
